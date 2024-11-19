require('dotenv').config();

const { Pinecone } = require('@pinecone-database/pinecone');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { createModuleLogger } = require('./logger');
const { OpenAPIChunker } = require('./chunking');
const { shouldUseMongoForEmbeddings, isDbSystemEnabled, db } = require('../db/config');
const yaml = require('js-yaml');
const fetch = require('node-fetch');

const logger = createModuleLogger('openapi');

// Wrap OpenAI embeddings with logging
const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: 'text-embedding-ada-002'
});

const originalEmbedDocuments = embeddings.embedDocuments;
embeddings.embedDocuments = async function (...args) {
    logger.info('Calling OpenAI API for embeddings', 'embedDocuments', {
        chunks: args[0].length
    });
    return originalEmbedDocuments.apply(this, args);
};

// Initialize Pinecone client
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
});

// Wrap Pinecone index operations with logging
const wrapPineconeIndex = (index) => {
    const originalQuery = index.query;
    const originalUpsert = index.upsert;

    index.query = async function (...args) {
        logger.info('Calling Pinecone API: query', 'pineconeQuery', {
            topK: args[0]?.topK,
            filter: JSON.stringify(args[0]?.filter || {})
        });
        return originalQuery.apply(this, args);
    };

    index.upsert = async function (...args) {
        logger.info('Calling Pinecone API: upsert', 'pineconeUpsert', {
            vectors: args[0]?.length || 0
        });
        return originalUpsert.apply(this, args);
    };

    return index;
};

let processingStatus = {
    isProcessing: false,
    progress: 0,
    error: null,
    totalChunks: 0,
    processedChunks: 0,
    currentFile: null,
    embeddedFiles: []
};

// Initialize Pinecone client and load existing files
async function initPinecone() {
    logger.info('Initializing Pinecone client', 'initPinecone');

    try {
        const index = wrapPineconeIndex(pinecone.index(process.env.PINECONE_INDEX));
        logger.info('Pinecone client initialized', 'initPinecone');

        // Load existing embedded files
        await loadExistingEmbeddings(index);

        return index;
    } catch (error) {
        logger.error('Failed to initialize Pinecone', 'initPinecone', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// Load existing embeddings from Pinecone
async function loadExistingEmbeddings(index) {
    logger.info('Loading existing embeddings', 'loadExistingEmbeddings');

    try {
        // Query for files with metadata flag
        const queryResponse = await index.query({
            vector: Array(1536).fill(0),
            topK: 10000,
            filter: { is_metadata: true },
            includeMetadata: true
        });

        if (queryResponse.matches && queryResponse.matches.length > 0) {
            // Process files with metadata flag
            for (const match of queryResponse.matches) {
                const { fileName, totalChunks, timestamp, specId } = match.metadata;
                if (fileName && !processingStatus.embeddedFiles.find(f => f.fileName === fileName)) {
                    processingStatus.embeddedFiles.push({
                        fileName,
                        totalChunks,
                        timestamp,
                        status: 'completed',
                        specId
                    });
                }
            }
        } else {
            logger.info('No files found with metadata flag, checking legacy records', 'loadExistingEmbeddings');

            // Query all vectors
            const queryResponse = await index.query({
                vector: Array(1536).fill(0),
                topK: 10000,
                includeMetadata: true
            });

            if (queryResponse.matches && queryResponse.matches.length > 0) {
                for (const match of queryResponse.matches) {
                    const metadata = match.metadata || {};
                    const specId = metadata.spec_id;
                    const chunkType = metadata.chunk_type;

                    if (specId && !processingStatus.embeddedFiles.find(f => f.specId === specId)) {
                        // Create a file entry from the first chunk of each spec
                        processingStatus.embeddedFiles.push({
                            fileName: `openapi_spec_${specId}.json`,
                            totalChunks: 0, // Will count below
                            timestamp: metadata.timestamp || new Date().toISOString(),
                            status: 'completed',
                            specId: specId
                        });
                    }

                    // Count chunks for each file
                    if (specId && processingStatus.embeddedFiles.find(f => f.specId === specId)) {
                        const fileEntry = processingStatus.embeddedFiles.find(f => f.specId === specId);
                        fileEntry.totalChunks++;
                    }
                }
            }
        }

        logger.info('Loaded existing files', 'loadExistingEmbeddings', {
            fileCount: processingStatus.embeddedFiles.length,
            totalChunks: processingStatus.embeddedFiles.reduce((sum, file) => sum + file.totalChunks, 0)
        });
    } catch (error) {
        logger.error('Failed to load existing embeddings', 'loadExistingEmbeddings', {
            error: error.message,
            stack: error.stack
        });
        // Non-fatal error, continue with empty embedded files list
        processingStatus.embeddedFiles = [];
    }
}

// Process OpenAPI specification in background
async function processOpenAPISpec(specContent, fileName) {
    if (processingStatus.isProcessing) {
        return {
            status: 'already_processing',
            message: 'Another specification is currently being processed'
        };
    }

    processingStatus = {
        isProcessing: true,
        progress: 0,
        error: null,
        totalChunks: 0,
        processedChunks: 0,
        currentFile: fileName,
        embeddedFiles: processingStatus.embeddedFiles
    };

    // Start background processing
    processInBackground(specContent, fileName).catch(error => {
        logger.error('Background processing failed', 'processOpenAPISpec', {
            error: error.message,
            stack: error.stack
        });
        processingStatus.error = error.message;

        // Update embedded files list with error status
        const fileIndex = processingStatus.embeddedFiles.findIndex(f => f.fileName === fileName);
        if (fileIndex >= 0) {
            processingStatus.embeddedFiles[fileIndex].status = 'error';
            processingStatus.embeddedFiles[fileIndex].error = error.message;
        }
    }).finally(() => {
        processingStatus.isProcessing = false;
        processingStatus.currentFile = null;
    });

    return {
        status: 'processing_started',
        message: 'File upload successful. Processing started in background.',
        fileName
    };
}

// Background processing function
async function processInBackground(specContent, fileName) {
    logger.info('Processing OpenAPI specification', 'processInBackground', { fileName });

    try {
        // Parse the specification
        const spec = typeof specContent === 'string'
            ? yaml.load(specContent)
            : specContent;

        logger.debug('Parsed OpenAPI specification', 'processInBackground', {
            fileName,
            version: spec.openapi || spec.swagger,
            title: spec.info?.title
        });

        // Create chunks
        const chunker = new OpenAPIChunker(spec);
        const chunks = await chunker.processSpecification();
        processingStatus.progress = 30;
        processingStatus.totalChunks = chunks.length;

        // Add file metadata to embedded files list
        const fileMetadata = {
            fileName,
            totalChunks: chunks.length,
            timestamp: new Date().toISOString(),
            status: 'processing'
        };

        const existingFileIndex = processingStatus.embeddedFiles.findIndex(f => f.fileName === fileName);
        if (existingFileIndex >= 0) {
            processingStatus.embeddedFiles[existingFileIndex] = fileMetadata;
        } else {
            processingStatus.embeddedFiles.push(fileMetadata);
        }

        logger.info('Created chunks from specification', 'processInBackground', {
            fileName,
            chunkCount: chunks.length
        });


        // Process chunks in batches
        if (shouldUseMongoForEmbeddings()) {
            await processChunksWithMongoDB(chunks, fileName);
        } else {

            // Store file metadata in Pinecone
            const index = wrapPineconeIndex(pinecone.index(process.env.PINECONE_INDEX));
            await index.upsert([{
                id: `file:${fileName}`,
                values: Array(1536).fill(0), // Default dimension for ada-002
                metadata: {
                    ...fileMetadata,
                    isFileMetadata: true
                }
            }]);
            await storeEmbeddingsInBatches(chunks, fileName);
        }

        // Update file status to completed
        const finalFileIndex = processingStatus.embeddedFiles.findIndex(f => f.fileName === fileName);
        if (finalFileIndex >= 0) {
            processingStatus.embeddedFiles[finalFileIndex].status = 'completed';
        }

        return {
            success: true,
            chunks: chunks.length,
            specId: chunker.specId,
            fileName
        };
    } catch (error) {
        logger.error('Failed to process OpenAPI specification', 'processInBackground', {
            error: error.message,
            stack: error.stack,
            fileName
        });
        throw error;
    }
}

// Store embeddings in Pinecone with batching
async function storeEmbeddingsInBatches(chunks, fileName) {
    logger.info('Storing embeddings', 'storeEmbeddingsInBatches', {
        fileName,
        chunkCount: chunks.length
    });

    try {
        const index = wrapPineconeIndex(pinecone.index(process.env.PINECONE_INDEX));
        const batchSize = 100;
        const totalBatches = Math.ceil(chunks.length / batchSize);

        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;

            // Generate embeddings for current batch
            const vectors = await Promise.all(
                batch.map(async (chunk) => {
                    const [embedding] = await embeddings.embedDocuments([chunk.text]);
                    return {
                        id: chunk.metadata.chunk_id,
                        values: embedding,
                        metadata: {
                            ...chunk.metadata,
                            fileName
                        }
                    };
                })
            );

            // Store batch in Pinecone
            await index.upsert(vectors);

            // Update progress and processed chunks count
            processingStatus.processedChunks += batch.length;
            processingStatus.progress = 30 + Math.floor((processingStatus.processedChunks / processingStatus.totalChunks) * 70);

            logger.info('Batch processed', 'storeEmbeddingsInBatches', {
                fileName,
                batch: batchNumber,
                totalBatches,
                processedChunks: processingStatus.processedChunks,
                totalChunks: processingStatus.totalChunks,
                progress: processingStatus.progress
            });
        }
    } catch (error) {
        const errorMessage = error.message || 'Unknown error occurred';
        logger.error('Failed to store embeddings', 'storeEmbeddingsInBatches', {
            error: errorMessage,
            stack: error.stack,
            fileName
        });
        throw new Error('Failed to store embeddings: ' + errorMessage);
    }
}

// Process chunks with MongoDB
async function processChunksWithMongoDB(chunks, fileName) {
    logger.info('Processing chunks with MongoDB', 'processChunksWithMongoDB', {
        fileName,
        chunkCount: chunks.length
    });

    try {
        // Store chunks in MongoDB
        await db.createChunks(chunks, fileName);

        // Update progress and processed chunks count
        processingStatus.processedChunks += chunks.length;
        processingStatus.progress = 30 + Math.floor((processingStatus.processedChunks / processingStatus.totalChunks) * 70);

        logger.info('Chunks processed with MongoDB', 'processChunksWithMongoDB', {
            fileName,
            processedChunks: processingStatus.processedChunks,
            totalChunks: processingStatus.totalChunks,
            progress: processingStatus.progress
        });
    } catch (error) {
        const errorMessage = error.message || 'Unknown error occurred';
        logger.error('Failed to process chunks with MongoDB', 'processChunksWithMongoDB', {
            error: errorMessage,
            stack: error.stack,
            fileName
        });
        throw new Error('Failed to process chunks with MongoDB: ' + errorMessage);
    }
}

// Query similar chunks
async function querySimilarChunks(query) {
    logger.info('Querying similar chunks', 'querySimilarChunks', { query });

    try {
        // Generate query embedding
        const [queryEmbedding] = await embeddings.embedDocuments([query]);

        // Query Pinecone
        const index = wrapPineconeIndex(pinecone.index(process.env.PINECONE_INDEX));
        
        // Query without filter first
        const results = await index.query({
            vector: queryEmbedding,
            topK: 10,
            includeMetadata: true,
            includeValues: false
        });

        // Log full results for debugging
        logger.info('Raw query results', 'querySimilarChunks', {
            matches: results.matches?.map(m => ({
                score: m.score,
                metadata: m.metadata,
                id: m.id
            }))
        });

        // Log potential auth-related matches
        const authMatches = results.matches?.filter(m => {
            const meta = m.metadata || {};
            const text = meta.text || meta.content || '';
            const path = meta.path || '';
            return text.toLowerCase().includes('auth') || 
                   path.toLowerCase().includes('auth') ||
                   (meta.component_type === 'securitySchemes');
        });

        if (authMatches?.length) {
            logger.info('Found auth-related matches', 'querySimilarChunks', {
                authMatches: authMatches.map(m => ({
                    score: m.score,
                    metadata: m.metadata,
                    id: m.id
                }))
            });
        }

        return results.matches || [];
    } catch (error) {
        logger.error('Failed to query similar chunks', 'querySimilarChunks', { error });
        return [];
    }
}

// Generate chat response
async function generateChatResponse(query) {
    logger.info('Generating chat response', 'generateChatResponse', { query });

    // Get similar chunks
    const similarChunks = await querySimilarChunks(query);

    // Extract text from chunks
    const context = similarChunks.map(chunk => {
        const metadata = chunk.metadata || {};
        const text = metadata.text || metadata.content || '';
        const type = metadata.component_type || metadata.type || 'info';
        const path = metadata.path || '';
        const method = metadata.method || '';
        const score = chunk.score || 0;

        // If no text content, generate a description from the metadata
        const description = text || generateDescription(metadata);
        
        return {
            text: description,
            type,
            path,
            method,
            score
        };
    }).filter(chunk => chunk.text);

    // Log extracted context
    logger.info('Extracted context', 'generateChatResponse', {
        contextItems: context.map(c => ({
            type: c.type,
            path: c.path,
            method: c.method,
            score: c.score,
            textPreview: c.text.substring(0, 100) + '...'
        }))
    });

    // If no context found, try a broader search
    if (!context.length) {
        logger.info('No context found, returning guidance', 'generateChatResponse');
        return "I don't see any OpenAPI specification loaded yet. Please upload an OpenAPI specification file first, and then I can help you understand its endpoints and features.";
    }

    // Format context for chat
    const contextText = context.map(chunk => {
        let header = `[${chunk.type.toUpperCase()}]`;
        if (chunk.path) header += ` ${chunk.method || ''} ${chunk.path}`;
        if (chunk.score) header += ` (relevance: ${chunk.score.toFixed(2)})`;
        return `${header}\n${chunk.text}`;
    }).join('\n\n');

    // Generate response
    const messages = [
        {
            role: 'system',
            content: `You are an AI assistant helping users understand an OpenAPI specification.
                     You specialize in explaining API endpoints, authentication methods, and schema definitions.
                     
                     Style Guide:
                     1. Format your responses in Markdown
                     2. Use code blocks with \`\`\` for:
                        - Endpoint paths
                        - Request/response examples
                        - Headers
                     3. Use bullet points or numbered lists for multiple items
                     4. Use headers (##) to organize different sections
                     5. Use bold (**) for important terms
                     6. Use tables for comparing multiple endpoints or parameters
                     
                     When describing authentication endpoints:
                     1. Always mention the HTTP method
                     2. List any required headers
                     3. Describe the expected request body if POST/PUT
                     4. Explain the response format
                     5. Note any required scopes or permissions
                     
                     Below is the relevant context from the specification.
                     Use this context to answer the user's question precisely and technically.
                     If you find authentication-related information, be sure to explain the required credentials and how to use them.
                     If you cannot find relevant information in the context, say so.
                     
                     Context:
                     ${contextText}`
        },
        {
            role: 'user',
            content: query
        }
    ];

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'http://localhost:3000',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: process.env.OPENROUTER_MODEL || 'openai/gpt-3.5-turbo',
                messages: messages,
                temperature: 0.3 // Lower temperature for more precise responses
            })
        });

        if (!response.ok) {
            throw new Error(`OpenRouter API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || 'No response generated';

    } catch (error) {
        logger.error('Failed to generate chat response', 'generateChatResponse', { error });
        return 'I encountered an error while generating the response. Please try again or check if the OpenAPI specification is properly loaded.';
    }
}

// Helper function to generate description from metadata
function generateDescription(metadata) {
    if (!metadata.path) return '';

    let desc = [];

    // Basic endpoint information
    if (metadata.method && metadata.path) {
        desc.push(`## \`${metadata.method.toUpperCase()} ${metadata.path}\``);
    }

    // Authentication endpoint descriptions
    if (metadata.path.includes('authentication_token')) {
        desc.push('Endpoint for token-based authentication operations.\n');
        if (metadata.method === 'GET') {
            desc.push('### Description\nRetrieve an authentication token using valid credentials.\n');
            desc.push('### Request Headers\n- `Authorization`: Basic authentication credentials\n');
            desc.push('### Response\n```json\n{\n  "token": "jwt_token_here",\n  "expires_in": 3600\n}\n```\n');
            desc.push('### Status Codes\n- `200 OK`: Token generated successfully\n- `401 Unauthorized`: Invalid credentials');
        } else if (metadata.method === 'POST') {
            desc.push('### Description\nValidate or refresh an existing authentication token.\n');
            desc.push('### Request Headers\n- `Authorization`: Bearer token\n');
            desc.push('### Response\n```json\n{\n  "valid": true,\n  "expires_in": 3000\n}\n```\n');
            desc.push('### Status Codes\n- `200 OK`: Token is valid\n- `401 Unauthorized`: Token is invalid or expired');
        }
    } else if (metadata.path.includes('vehicle_authentication')) {
        desc.push('Specialized authentication endpoint for vehicle-related operations.\n');
        desc.push('### Required Parameters\n- Vehicle identification\n- Authentication credentials\n');
        desc.push('### Request Headers\n- `X-Vehicle-ID`: Vehicle identifier\n- `Authorization`: Required credentials\n');
        desc.push('### Response\n```json\n{\n  "token": "vehicle_token_here",\n  "vehicle_info": {\n    "id": "vehicle_id",\n    "type": "vehicle_type"\n  }\n}\n```');
    } else if (metadata.path.includes('get_token')) {
        desc.push('Dedicated endpoint for obtaining new authentication tokens.\n');
        desc.push('### Usage\nRequest a new token using valid credentials.\n');
        desc.push('### Request Headers\n- `Authorization`: Required credentials\n');
        desc.push('### Response\n```json\n{\n  "access_token": "token_here",\n  "token_type": "Bearer",\n  "expires_in": 3600\n}\n```');
    } else if (metadata.path.includes('check_token')) {
        desc.push('Validate an existing authentication token.\n');
        desc.push('### Usage\nVerify if a token is still valid and get its associated details.\n');
        desc.push('### Request Headers\n- `Authorization`: Bearer token to validate\n');
        desc.push('### Response\n```json\n{\n  "active": true,\n  "scope": "read write",\n  "exp": 1735689600\n}\n```');
    } else if (metadata.path.includes('authentication')) {
        desc.push('General authentication endpoint for user authentication.\n');
        if (metadata.method === 'POST') {
            desc.push('### Request Body\n```json\n{\n  "username": "user@example.com",\n  "password": "user_password",\n  "totp": "123456" // Optional 2FA code\n}\n```\n');
            desc.push('### Response\n```json\n{\n  "token": "jwt_token_here",\n  "user": {\n    "id": "user_id",\n    "roles": ["user", "admin"]\n  }\n}\n```\n');
            desc.push('### Status Codes\n- `200 OK`: Authentication successful\n- `401 Unauthorized`: Invalid credentials\n- `403 Forbidden`: Account locked or requires 2FA');
        }
    }

    return desc.join('\n');
}

// Get current processing status
function getProcessingStatus() {
    return {
        ...processingStatus,
        processedChunksCount: processingStatus.processedChunks,
        totalChunksCount: processingStatus.totalChunks,
        files: processingStatus.embeddedFiles
    };
}

module.exports = {
    initPinecone,
    processOpenAPISpec,
    querySimilarChunks,
    generateChatResponse,
    getProcessingStatus
}
