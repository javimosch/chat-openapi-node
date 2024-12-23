require('dotenv').config();

const { Pinecone } = require('@pinecone-database/pinecone');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { createModuleLogger } = require('./logger');
const { OpenAPIChunker, OpenAPICSVProcessor } = require('./chunking');
const { shouldUseMongoForEmbeddings, isDbSystemEnabled, db, mongoose } = require('../db/config');
const yaml = require('js-yaml');
const fetch = require('node-fetch');
const Metadata = require('../models/metadata');

const logger = createModuleLogger('openapi');

// Wrap OpenAI embeddings with logging
const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: 'text-embedding-ada-002'
});

// Wrap embedding methods with logging
const originalEmbedQuery = embeddings.embedQuery;
embeddings.embedQuery = async function (text) {
    logger.info('Generating embedding for text', 'embedQuery', {
        textLength: text.length,
        preview: text.substring(0, 100) + (text.length > 100 ? '...' : '')
    });

    try {
        const vector = await originalEmbedQuery.call(this, text);
        logger.debug('Generated embedding', 'embedQuery', {
            dimensions: vector.length,
            hasNonZero: vector.some(v => v !== 0),
            firstValues: vector.slice(0, 5)
        });
        return vector;
    } catch (error) {
        logger.error('Failed to generate embedding', 'embedQuery', {
            error: error.message,
            textLength: text.length
        });
        throw error;
    }
};

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
    logger.info('Starting OpenAPI processing', 'processOpenAPISpec', { fileName });

    // Reset processing status
    processingStatus = {
        isProcessing: true,
        progress: 0,
        error: null,
        totalChunks: 0,
        processedChunks: 0,
        currentFile: fileName,
        embeddedFiles: processingStatus.embeddedFiles
    };

    // Add file to embedded files list
    const fileEntry = {
        fileName,
        status: 'processing',
        error: null,
        timestamp: new Date().toISOString()
    };

    const existingIndex = processingStatus.embeddedFiles.findIndex(f => f.fileName === fileName);
    if (existingIndex >= 0) {
        processingStatus.embeddedFiles[existingIndex] = fileEntry;
    } else {
        processingStatus.embeddedFiles.push(fileEntry);
    }

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
    logger.info('Processing file', 'processInBackground', { fileName });

    try {
        let chunks;
        const fileType = process.env.INPUT_FORMAT?.toLowerCase() || 'json';
        const isCSV = fileName.toLowerCase().endsWith('.csv') || fileType === 'csv';

        logger.debug('Processing file', 'processInBackground', {
            fileName,
            fileType,
            isCSV,
            contentLength: typeof specContent === 'string' ? specContent.length : 'binary'
        });

        if (isCSV) {
            // Process CSV file
            const csvProcessor = new OpenAPICSVProcessor();
            try {
                const records = await csvProcessor.parseCSV(specContent);
                chunks = await csvProcessor.generateChunks(records);
                logger.debug('Parsed CSV file', 'processInBackground', {
                    fileName,
                    recordCount: records.length,
                    chunkCount: chunks.length
                });
            } catch (csvError) {
                logger.error('CSV processing error', 'processInBackground', {
                    error: csvError.message,
                    fileName
                });
                throw new Error(`Failed to process CSV file: ${csvError.message}`);
            }
        } else {
            // Process JSON/YAML file
            let jsonSpec;
            try {
                if (typeof specContent === 'string') {
                    if (fileName.toLowerCase().endsWith('.yaml') || fileName.toLowerCase().endsWith('.yml')) {
                        jsonSpec = yaml.load(specContent);
                    } else {
                        jsonSpec = JSON.parse(specContent);
                    }
                } else {
                    jsonSpec = specContent;
                }

                const chunker = new OpenAPIChunker(jsonSpec);
                chunks = await chunker.processSpecification();
            } catch (parseError) {
                throw new Error(`Failed to parse file: ${parseError.message}`);
            }
        }

        processingStatus.progress = 30;
        processingStatus.totalChunks = chunks.length;

        // Update embedded files list with chunk count
        const fileIndex = processingStatus.embeddedFiles.findIndex(f => f.fileName === fileName);
        if (fileIndex >= 0) {
            processingStatus.embeddedFiles[fileIndex].totalChunks = chunks.length;
        }

        logger.info('Created chunks from specification', 'processInBackground', {
            fileName,
            chunkCount: chunks.length
        });

        // Store file metadata vector
        logger.info('Storing file metadata vector', 'processInBackground', {
            fileName,
            totalChunks: chunks.length
        });

        const fileMetadataVector = {
            id: `file:${fileName}`,
            values: await embeddings.embedQuery(`File: ${fileName}`),
            metadata: {
                fileName,
                totalChunks: chunks.length,
                timestamp: new Date().toISOString(),
                isFileMetadata: true
            }
        };

        logger.debug('Generated file metadata vector', 'processInBackground', {
            fileName,
            vectorId: fileMetadataVector.id,
            vectorDimensions: fileMetadataVector.values.length,
            hasNonZero: fileMetadataVector.values.some(v => v !== 0)
        });

        const index = wrapPineconeIndex(pinecone.index(process.env.PINECONE_INDEX));
        await index.upsert([fileMetadataVector]);

        // Process chunks in batches
        logger.info('Starting chunk processing', 'processInBackground', {
            fileName,
            totalChunks: chunks.length
        });

        const batchSize = 100;
        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const vectors = await processChunkBatch(batch, fileName, i);
            await index.upsert(vectors);
            processingStatus.processedChunks += batch.length;
            processingStatus.progress = Math.round((processingStatus.processedChunks / chunks.length) * 100);

            logger.info('Processed chunk batch', 'processInBackground', {
                fileName,
                batchStart: i,
                batchSize: batch.length,
                progress: processingStatus.progress
            });
        }

        // Update file status to completed
        const finalFileIndex = processingStatus.embeddedFiles.findIndex(f => f.fileName === fileName);
        if (finalFileIndex >= 0) {
            processingStatus.embeddedFiles[finalFileIndex].status = 'completed';
        }

        return {
            success: true,
            chunks: chunks.length,
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

async function processChunkBatch(batch, fileName, startIndex) {
    logger.info('Processing chunk batch', 'processChunkBatch', {
        batchSize: batch.length,
        fileName,
        startIndex
    });

    const vectors = await Promise.all(
        batch.map(async (chunk, index) => {
            const chunkIndex = startIndex + index;
            const vectorId = `${fileName}:${chunkIndex}`;

            try {
                // Log metadata before saving
                logger.debug('Saving metadata to MongoDB', 'processChunkBatch', {
                    vectorId,
                    endpoint: chunk.metadata.endpoint,
                    method: chunk.metadata.method
                });

                // Store full metadata in MongoDB
                const metadataDoc = new Metadata({
                    vector_id: vectorId,
                    file_name: fileName,
                    chunk_index: chunkIndex,
                    // Essential metadata (duplicated in Pinecone)
                    endpoint: chunk.metadata.endpoint,
                    method: chunk.metadata.method,
                    summary: chunk.metadata.summary,
                    tags: Array.isArray(chunk.metadata.tags) ? chunk.metadata.tags : [],
                    // Detailed metadata (only in MongoDB)
                    parameters: chunk.metadata.parameters,
                    requestBody: chunk.metadata.requestBody,
                    responses: chunk.metadata.responses,
                    security: chunk.metadata.security,
                    servers: chunk.metadata.servers,
                    schemas: chunk.metadata.schemas,
                    // Additional fields
                    description: chunk.metadata.description,
                    text: chunk.text
                });

                const savedDoc = await metadataDoc.save();
                
                logger.info('Saved metadata to MongoDB', 'processChunkBatch', {
                    vectorId,
                    mongoId: savedDoc._id.toString()
                });

                // Create vector with minimal metadata for Pinecone
                const vector = {
                    id: vectorId,
                    values: await embeddings.embedQuery(chunk.text),
                    metadata: {
                        endpoint: chunk.metadata.endpoint,
                        method: chunk.metadata.method,
                        summary: chunk.metadata.summary,
                        tags: Array.isArray(chunk.metadata.tags) ? chunk.metadata.tags : [],
                        mongo_ref: savedDoc._id.toString()
                    }
                };

                return vector;
            } catch (error) {
                logger.error('Failed to save metadata', 'processChunkBatch', {
                    error: error.message,
                    stack: error.stack,
                    vectorId,
                    endpoint: chunk.metadata.endpoint
                });
                throw error;
            }
        })
    );

    logger.info('Processed chunk batch', 'processChunkBatch', {
        batchSize: batch.length,
        vectorCount: vectors.length
    });

    return vectors;
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
    
    logger.info('Processing similar chunks', 'generateChatResponse', {
        chunkCount: similarChunks.length,
        hasMongoRefs: similarChunks.some(chunk => chunk.metadata?.mongo_ref)
    });

    // Extract text from chunks
    const context = await Promise.all(similarChunks.map(async (chunk, index) => {
        const metadata = chunk.metadata || {};
        let mongoMetadata;

        // Try to fetch full metadata from MongoDB if we have a reference
        if (metadata.mongo_ref) {
            try {
                mongoMetadata = await Metadata.findById(metadata.mongo_ref);

                logger.debug('Fetched MongoDB metadata by ID', 'generateChatResponse', {
                    index,
                    mongo_ref: metadata.mongo_ref,
                    found: !!mongoMetadata
                });
            } catch (error) {
                logger.error('Failed to fetch MongoDB metadata by ID', 'generateChatResponse', {
                    error: error.message,
                    mongo_ref: metadata.mongo_ref
                });
            }
        }

        // If no metadata found by ID, try finding by endpoint and method
        if (!mongoMetadata && metadata.endpoint && metadata.method) {
            try {
                mongoMetadata = await Metadata.findOne({
                    endpoint: metadata.endpoint,
                    method: metadata.method
                });
                logger.debug('Fetched MongoDB metadata by endpoint/method', 'generateChatResponse', {
                    index,
                    endpoint: metadata.endpoint,
                    method: metadata.method,
                    found: !!mongoMetadata
                });
            } catch (error) {
                logger.error('Failed to fetch MongoDB metadata by endpoint/method', 'generateChatResponse', {
                    error: error.message,
                    endpoint: metadata.endpoint,
                    method: metadata.method
                });
            }
        }

        // Use MongoDB metadata if found, otherwise use Pinecone metadata
        const finalMetadata = mongoMetadata?._doc || metadata;

        logger.debug('Final metadata for chunk', 'generateChatResponse', {
            index,
            hasMongoData: !!mongoMetadata,
            score: chunk.score,
            metadata: finalMetadata
        });

        return {
            ...finalMetadata,
            score: chunk.score || 0
        };
    }));

    // Format context for chat
    const contextText = context.map(chunk => {
        const lines = [];
        
        // Add endpoint info
        lines.push(`## ${chunk.method} ${chunk.endpoint}`);
        if (chunk.summary) lines.push(`Summary: ${chunk.summary}`);
        if (chunk.description) lines.push(`Description: ${chunk.description}`);
        
        // Add parameters if present
        if (chunk.parameters) {
            lines.push('### Parameters');
            lines.push(chunk.parameters);
        }
        
        // Add request body if present
        if (chunk.requestBody) {
            lines.push('### Request Body');
            lines.push(chunk.requestBody);
        }
        
        // Add responses if present
        if (chunk.responses) {
            lines.push('### Responses');
            lines.push(chunk.responses);
        }
        
        // Add security if present
        if (chunk.security) {
            lines.push('### Security');
            lines.push(chunk.security);
        }
        
        // Add servers if present
        if (chunk.servers) {
            lines.push('### Servers');
            lines.push(chunk.servers);
        }
        
        // Add schemas if present
        if (chunk.schemas) {
            lines.push('### Schemas');
            lines.push(chunk.schemas);
        }

        // Add relevance score
        lines.push(`\nRelevance Score: ${chunk.score.toFixed(3)}`);
        
        return lines.join('\n\n');
    }).join('\n\n---\n\n');  // Add separator between endpoints

    // Log extracted context
    logger.info('Extracted context', 'generateChatResponse', {
        contextItems: context.map(item => ({
            endpoint: item.endpoint,
            method: item.method,
            score: item.score,
            summary: item.summary
        }))
    });

    // If no context found, try a broader search
    if (!context.length) {
        logger.info('No context found, returning guidance', 'generateChatResponse');
        return "I don't see any OpenAPI specification loaded yet. Please upload an OpenAPI specification file first, and then I can help you understand its endpoints and features.";
    }

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
                     1. Always mention the HTTP method and full endpoint path
                     2. List any required headers from the security schemes
                     3. Describe the expected request body format
                     4. Explain the response format and possible status codes
                     5. Note any required scopes or permissions
                     6. Provide example curl commands when possible
                     
                     Below is the relevant context from the OpenAPI specification.
                     Each section is separated by "---" and contains complete endpoint information.
                     Use this context to answer the user's question precisely and technically.
                     
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

// Search OpenAPI specification
async function searchOpenAPISpec(query, options = {}) {
    logger.info('Searching OpenAPI specification', 'searchOpenAPISpec', { query });

    try {
        const index = wrapPineconeIndex(pinecone.index(process.env.PINECONE_INDEX));
        const queryEmbedding = await embeddings.embedQuery(query);

        const searchResponse = await index.query({
            vector: queryEmbedding,
            topK: options.topK || 5,
            includeMetadata: true
        });

        // Fetch full metadata from MongoDB for matches
        const results = await Promise.all(
            searchResponse.matches.map(async match => {
                try {
                    const fullMetadata = await Metadata.findById(match.metadata.mongo_ref);

                    if (!fullMetadata) {
                        logger.warn('MongoDB metadata not found for vector', 'searchOpenAPISpec', {
                            vectorId: match.id
                        });
                        return match;
                    }

                    return {
                        ...match,
                        metadata: {
                            ...match.metadata,
                            parameters: fullMetadata.parameters,
                            requestBody: fullMetadata.requestBody,
                            responses: fullMetadata.responses,
                            security: fullMetadata.security,
                            servers: fullMetadata.servers,
                            schemas: fullMetadata.schemas,
                            description: fullMetadata.description,
                            text: fullMetadata.text
                        }
                    };
                } catch (error) {
                    logger.error('Failed to fetch MongoDB metadata', 'searchOpenAPISpec', {
                        error: error.message,
                        vectorId: match.id
                    });
                    return match;
                }
            })
        );

        logger.info('Search completed', 'searchOpenAPISpec', {
            query,
            resultCount: results.length,
            topScore: results[0]?.score
        });

        return results;
    } catch (error) {
        logger.error('Search failed', 'searchOpenAPISpec', {
            error: error.message,
            query
        });
        throw error;
    }
}

module.exports = {
    initPinecone,
    processOpenAPISpec,
    querySimilarChunks,
    generateChatResponse,
    getProcessingStatus,
    searchOpenAPISpec
}
