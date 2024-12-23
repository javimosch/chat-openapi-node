require('dotenv').config();

const { Pinecone } = require('@pinecone-database/pinecone');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { createModuleLogger } = require('./logger');
const { OpenAPIChunker, OpenAPICSVProcessor } = require('./chunking');
const { isDbSystemEnabled, db, mongoose } = require('../db/config');
const yaml = require('js-yaml');
const fetch = require('node-fetch');
const Metadata = require('../models/metadata');
const fs = require('fs').promises;
const path = require('path');
let pinecone = null
const logger = createModuleLogger('openapi');

// Initialize OpenAI embeddings
const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: 'text-embedding-ada-002'
});

// Wrap embedQuery for logging
const originalEmbedQuery = embeddings.embedQuery;
embeddings.embedQuery = async function (...args) {
    logger.info('Calling OpenAI API for embeddings', 'embedQuery', {
        textLength: args[0]?.length,
        preview: args[0]?.substring(0, 100)
    });
    try {
        const result = await originalEmbedQuery.apply(this, args);
        logger.debug('Got embeddings from OpenAI', 'embedQuery', {
            resultLength: result?.length,
            sampleValues: result?.slice(0, 5),
            hasValues: Array.isArray(result) && result.length > 0
        });
        return result;
    } catch (error) {
        logger.error('Failed to get embeddings from OpenAI', 'embedQuery', {
            error: error.message,
            stack: error.stack,
            response: error.response?.data
        });
        throw error;
    }
};

// Wrap embedDocuments for logging
const originalEmbedDocuments = embeddings.embedDocuments;
embeddings.embedDocuments = async function (...args) {
    logger.info('Calling OpenAI API for batch embeddings', 'embedDocuments', {
        chunks: args[0]?.length,
        sampleText: args[0]?.[0]?.substring(0, 100)
    });
    try {
        const result = await originalEmbedDocuments.apply(this, args);
        logger.debug('Got batch embeddings from OpenAI', 'embedDocuments', {
            resultCount: result?.length,
            sampleLength: result[0]?.length,
            sampleValues: result[0]?.slice(0, 5),
            hasValues: result.every(v => Array.isArray(v) && v.length > 0)
        });
        return result;
    } catch (error) {
        logger.error('Failed to get batch embeddings from OpenAI', 'embedDocuments', {
            error: error.message,
            stack: error.stack,
            response: error.response?.data
        });
        throw error;
    }
};

// Helper functions to extract simplified metadata
function extractFieldNames(parameters) {
    if (!parameters) return [];
    try {
        if (typeof parameters === 'string') {
            parameters = JSON.parse(parameters);
        }
        if (Array.isArray(parameters)) {
            return parameters.map(p => p.name || '').filter(Boolean);
        }
        return Object.keys(parameters);
    } catch (e) {
        return [];
    }
}

function extractResponseCodes(responses) {
    if (!responses) return [];
    try {
        if (typeof responses === 'string') {
            responses = JSON.parse(responses);
        }
        return Object.keys(responses);
    } catch (e) {
        return [];
    }
}

// Initialize Pinecone client
async function initPinecone() {
    logger.info('Initializing Pinecone client', 'initPinecone', {
        index: process.env.PINECONE_INDEX
    });

    try {
        pinecone = new Pinecone({
            apiKey: process.env.PINECONE_API_KEY,
        });

        return pinecone.index(process.env.PINECONE_INDEX);
    } catch (error) {
        logger.error('Failed to initialize Pinecone', 'initPinecone', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

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

// Reset processing status
function resetProcessingStatus() {
    processingStatus = {
        isProcessing: false,
        progress: 0,
        error: null,
        embeddedFiles: [],
        processedChunks: 0,
        totalChunks: 0
    };
    logger.debug('Reset processing status', 'resetProcessingStatus');
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
                        computed_filename: fileName,
                        original_filename: fileName,
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
    logger.info('Starting OpenAPI processing', 'processOpenAPISpec', {
        fileName
    });

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
    // Reset status before starting new processing
    resetProcessingStatus();

    processingStatus.isProcessing = true;
    processingStatus.progress = 0;

    try {
        let chunks;
        const fileType = process.env.INPUT_FORMAT?.toLowerCase() || 'csv';
        const isCSV = fileName.toLowerCase().endsWith('.csv') || fileType === 'csv';

        logger.debug('Processing file', 'processInBackground', {
            fileName,
            fileType,
            isCSV
        });

        if (isCSV) {
            logger.info('Processing CSV file', 'processInBackground', {
                fileName
            });
            const csvProcessor = new OpenAPICSVProcessor();
            const fileContent = specContent.toString();

            // Parse and process CSV
            const records = await csvProcessor.parseCSV(fileContent);
            logger.info('Parsed CSV records', 'processInBackground', {
                recordCount: records.length,
                firstRecord: records[0] ? Object.keys(records[0]) : []
            });

            // Generate chunks
            const result = await csvProcessor.generateChunks(records);
            chunks = result.chunks;
            const processingErrors = result.errors;

            // Log import errors if any
            if (processingErrors && processingErrors.length > 0) {
                logger.info('Logging import errors', 'processInBackground', {
                    errorCount: processingErrors.length,
                    fileName: fileName
                });

                await logImportErrors(
                    fileName,
                    fileName,
                    processingErrors
                );
            }

            logger.info('Generated chunks from CSV', 'processInBackground', {
                chunkCount: chunks.length,
                errorCount: processingErrors.length,
                fileName
            });

        } else {
            chunks = await processOpenAPISpec(specContent, fileName);
        }

        // Get existing embeddings
        const index = await initPinecone();
        const existingEmbeddings = await loadExistingEmbeddings(index);

        // Process chunks in batches
        const batchSize = 100;
        const totalBatches = Math.ceil(chunks.length / batchSize);

        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            logger.info('Processing chunk batch', 'processInBackground', {
                batchNumber: Math.floor(i / batchSize) + 1,
                totalBatches,
                batchSize: batch.length
            });

            try {
                await processChunkBatch(batch, fileName, i);
                processingStatus.progress = Math.round(((i + batch.length) / chunks.length) * 100);
            } catch (error) {
                logger.error('Failed to process batch', 'processInBackground', {
                    error: error.message,
                    stack: error.stack,
                    batchNumber: Math.floor(i / batchSize) + 1,
                    startIndex: i
                });
                // Continue with next batch
            }
        }

        logger.info('File processing completed', 'processInBackground', {
            fileName,
            chunks: chunks.length
        });

    } catch (error) {
        logger.error('Failed to process file', 'processInBackground', {
            error: error.message,
            stack: error.stack
        });
        processingStatus.error = error.message;
        throw error;
    } finally {
        processingStatus.isProcessing = false;
    }
}

async function logImportErrors(originalFilename, computedFilename, errors) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const logFileName = `${timestamp}_${path.basename(originalFilename, path.extname(originalFilename))}.json`;
    const logFilePath = path.join(process.cwd(), 'imports', logFileName);

    const logData = {
        fileName: originalFilename,
        originalFilename,
        computedFilename,
        timestamp: new Date().toISOString(),
        errors: errors.map(error => ({
            rowNumber: error.lineNumber,
            endpoint: error.endpoint,
            method: error.method,
            error: error.error
        }))
    };

    try {
        await fs.writeFile(logFilePath, JSON.stringify(logData, null, 2));
        logger.info('Import errors logged', 'logImportErrors', {
            logFile: logFilePath,
            errorCount: errors.length
        });
    } catch (error) {
        logger.error('Failed to log import errors', 'logImportErrors', {
            error: error.message,
            logFile: logFilePath
        });
    }
}

async function processChunkBatch(batch, fileName, startIndex) {
    logger.info('Processing chunk batch', 'processChunkBatch', {
        batchSize: batch.length,
        startIndex
    });

    try {
        // Generate embeddings for the batch
        const texts = batch.map(chunk => chunk.text);
        logger.info('Generating embeddings for batch', 'processChunkBatch', {
            textCount: texts.length,
            sampleText: texts[0]?.substring(0, 100)
        });

        const embeddingResults = await embeddings.embedDocuments(texts);
        logger.info('Got embeddings for batch', 'processChunkBatch', {
            embeddingCount: embeddingResults.length,
            firstEmbeddingLength: embeddingResults[0]?.length
        });

        // Create vectors for Pinecone with minimal metadata
        const vectors = batch.map((chunk, i) => ({
            id: chunk.metadata.vector_id,
            values: embeddingResults[i],
            metadata: {
                spec_id: chunk.metadata.spec_id,
                type: chunk.metadata.type,
                endpoint: chunk.metadata.endpoint,
                method: chunk.metadata.method,
                line_number: chunk.metadata.line_number,
                vector_id: chunk.metadata.vector_id,
                computed_filename: fileName, // Add computed filename to every vector
                original_filename: fileName, // Add original filename to every vector
                summary: chunk.metadata.summary || '',
                description: chunk.metadata.description || '',
                // Store simplified versions of JSON fields
                param_names: extractFieldNames(chunk.metadata.parameters),
                response_codes: extractResponseCodes(chunk.metadata.responses),
                tags: chunk.metadata.tags || [],
                text: chunk.text // Keep text for retrieval
            }
        }));

        // Log vector details for debugging
        logger.debug('Created vectors', 'processChunkBatch', {
            vectorCount: vectors.length,
            sampleVectorId: vectors[0]?.id,
            sampleMetadata: vectors[0]?.metadata,
            sampleValues: vectors[0]?.values?.slice(0, 5),
            hasValues: vectors.every(v => Array.isArray(v.values) && v.values.length > 0)
        });

        // Create metadata vector at the end of processChunkBatch
        const metadataVector = {
            id: `metadata-${batch[0].metadata.spec_id}`,
            values: Array(1536).fill(0.000001), // Small non-zero value to satisfy Pinecone requirements
            metadata: {
                is_metadata: true,
                spec_id: batch[0].metadata.spec_id,
                fileName,
                computed_filename: fileName,
                original_filename: fileName,
                timestamp: new Date().toISOString(),
                totalChunks: batch.length
            }
        };

        // Upsert both chunk vectors and metadata vector
        const index = await initPinecone();
        logger.info('Upserting vectors to Pinecone', 'processChunkBatch', {
            vectorCount: vectors.length + 1, // +1 for metadata vector
            batchStartIndex: startIndex,
            sampleId: vectors[0]?.id,
            metadataId: metadataVector.id,
            payload: {
                sample_vector: {
                    id: vectors[0]?.id,
                    metadata: vectors[0]?.metadata
                },
                metadata_vector: {
                    id: metadataVector.id,
                    metadata: metadataVector.metadata
                }
            }
        });

        try {
            const upsertResult = await index.upsert([...vectors, metadataVector]);

            // Log successful upsert
            logger.info('Upserted vectors to Pinecone', 'processChunkBatch', {
                upsertedCount: upsertResult?.upsertedCount,
                batchSize: vectors.length + 1,
                startIndex
            });
        } catch (error) {
            // Enhanced error logging with payload details
            logger.error('Failed to upsert vectors', 'processChunkBatch', {
                error: error.message,
                stack: error.stack,
                batchStartIndex: startIndex,
                vectorCount: vectors.length,
                sampleVector: {
                    id: vectors[0]?.id,
                    metadata: vectors[0]?.metadata,
                    valuesSample: vectors[0]?.values?.slice(0, 5),
                    hasZeroValues: vectors[0]?.values?.every(v => v === 0),
                    valuesLength: vectors[0]?.values?.length
                },
                metadataVector: {
                    id: metadataVector.id,
                    metadata: metadataVector.metadata,
                    valuesSample: metadataVector.values.slice(0, 5),
                    hasZeroValues: metadataVector.values.every(v => v === 0),
                    valuesLength: metadataVector.values.length
                }
            });
            throw error;
        }
    } catch (error) {
        logger.error('Failed to process chunk batch', 'processChunkBatch', {
            error: error.message,
            stack: error.stack,
            batchSize: batch.length,
            startIndex,
            fileName
        });
        throw error;
    }
}

async function querySimilarChunks(query) {
    logger.info('Querying similar chunks', 'querySimilarChunks', {
        query
    });

    try {
        // Generate query embedding
        const queryEmbedding = await embeddings.embedQuery(query);
        if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
            logger.error('Invalid query embedding', 'querySimilarChunks', {
                embedding: queryEmbedding
            });
            return [];
        }

        // Query Pinecone using dynamic index
        const index = wrapPineconeIndex(pinecone.index(process.env.PINECONE_INDEX));

        // Query for non-metadata vectors only
        const results = await index.query({
            vector: queryEmbedding,
            topK: 10,
            includeMetadata: true,
            includeValues: false,
            filter: { is_metadata: { $ne: true } } // Exclude metadata vectors
        });

        // Log query details for debugging
        logger.debug('Query details', 'querySimilarChunks', {
            vectorLength: queryEmbedding.length,
            vectorSample: queryEmbedding.slice(0, 5),
            matchCount: results.matches?.length || 0,
            filter: { is_metadata: { $ne: true } }
        });

        // Log full results for debugging
        logger.info('Raw query results', 'querySimilarChunks', {
            matches: results.matches?.map(m => ({
                score: m.score,
                metadata: {
                    ...m.metadata,
                    text: m.metadata?.text?.substring(0, 100) + '...' // Truncate text for logging
                },
                id: m.id
            }))
        });

        return results.matches || [];
    } catch (error) {
        logger.error('Failed to query similar chunks', 'querySimilarChunks', {
            error: error.message,
            stack: error.stack,
            query
        });
        return [];
    }
}

// Generate chat response
async function generateChatResponse(query) {
    logger.info('Generating chat response', 'generateChatResponse', {
        query
    });

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
        logger.error('Failed to generate chat response', 'generateChatResponse', {
            error: error.message,
            stack: error.stack
        });
        return 'I encountered an error while generating the response. Please try again or check if the OpenAPI specification is properly loaded.';
    }
}

// Generate description from metadata
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
    logger.info('Searching OpenAPI specification', 'searchOpenAPISpec', {
        query
    });

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
