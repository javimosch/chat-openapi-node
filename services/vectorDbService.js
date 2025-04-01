const { createModuleLogger } = require('../utils/logger');
const { embedDocuments } = require('./embeddingService');
const { wrapPineconeIndex } = require('../utils/pinecone');
const { wrapChromaStore } = require('../utils/chromadb');
const { getProcessingStatus } = require('../config/state');

const logger = createModuleLogger('vectorDbService');

let vectorStore = null;

/**
 * Initialize vector database based on configuration
 */
async function initVectorDb() {
    logger.info('Starting vector database initialization', 'initVectorDb');

    try {
        const provider = process.env.VECTOR_STORE_PROVIDER || 'pinecone';
        
        logger.debug('Creating vector store instance', 'initVectorDb', {
            provider
        });

        if (provider === 'chromadb') {
            vectorStore = await wrapChromaStore().initialize();
        } else {
            vectorStore = wrapPineconeIndex();
        }

        logger.debug('Loading existing embeddings', 'initVectorDb');
        await loadExistingEmbeddings(vectorStore);

        logger.info('Vector database initialized successfully', 'initVectorDb', {
            provider
        });
        return vectorStore;
    } catch (error) {
        logger.error('Failed to initialize vector database', 'initVectorDb', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

/**
 * Store vectors in the database
 */
async function storeVectors(vectors) {
    logger.info('Storing vectors', 'storeVectors', {
        vectorCount: vectors.length
    });

    try {
        if (process.env.VECTOR_STORE_PROVIDER === 'chromadb') {
            await vectorStore.addVectors(vectors);
        } else {
            await vectorStore.upsert({
                vectors: vectors
            });
        }

        logger.debug('Successfully stored vectors', 'storeVectors', {
            vectorCount: vectors.length
        });
    } catch (error) {
        logger.error('Failed to store vectors', 'storeVectors', {
            error: error.message,
            stack: error.stack,
            vectorCount: vectors.length
        });
        throw error;
    }
}

/**
 * Query vectors from the database
 */
async function queryVectors(queryEmbedding, options = {}) {
    logger.info('Querying vectors', 'queryVectors', options);

    try {
        // Handle different vector store implementations
        let results;
        if (process.env.VECTOR_STORE_PROVIDER === 'chromadb') {
            // Don't use a filter for simple queries
            results = await vectorStore.queryVectors(queryEmbedding, {
                topK: options.topK || 10,
                filter: options.filter
            });
        } else {
            const queryParams = {
                vector: queryEmbedding,
                topK: options.topK || 10,
                includeMetadata: options.includeMetadata !== false,
                includeValues: options.includeValues || false
            };
            if (options.filter) {
                queryParams.filter = options.filter;
            }
            results = await vectorStore.query(queryParams);
        }

        logger.debug('Successfully queried vectors', 'queryVectors', {
            matchCount: results.matches?.length
        });

        return results;
    } catch (error) {
        logger.error('Failed to query vectors', 'queryVectors', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// Load existing embeddings from vector store
async function loadExistingEmbeddings(store) {
    logger.info('Starting to load existing embeddings', 'loadExistingEmbeddings');
    const { embeddedFiles } = getProcessingStatus();

    try {
        // Query for files with metadata flag
        logger.debug('Querying for files with metadata flag', 'loadExistingEmbeddings');
        
        let queryResponse;
        if (process.env.VECTOR_STORE_PROVIDER === 'chromadb') {
            // Use a zero vector with the correct dimensions for ChromaDB
            const zeroVector = new Array(768).fill(0); // nomic-embed-text dimensions
            queryResponse = await store.queryVectors(zeroVector, {
                topK: 10000,
                filter: { is_metadata: true }
            });
        } else {
            queryResponse = await store.query({
                vector: new Array(1536).fill(0),
                topK: 10000,
                filter: { is_metadata: true },
                includeMetadata: true
            });
        }

        if (queryResponse.matches && queryResponse.matches.length > 0) {
            logger.debug('Processing metadata files', 'loadExistingEmbeddings', {
                matchCount: queryResponse.matches.length
            });

            // Process files with metadata flag
            for (const match of queryResponse.matches) {
                const { fileName, totalChunks, timestamp, specId } = match.metadata;
                if (fileName && !embeddedFiles.find(f => f.fileName === fileName)) {
                    logger.debug('Adding file to embedded files list', 'loadExistingEmbeddings', {
                        fileName,
                        totalChunks,
                        timestamp
                    });

                    embeddedFiles.push({
                        fileName,
                        totalChunks,
                        timestamp,
                        status: 'completed',
                        specId
                    });
                }
            }
        }

        logger.info('Successfully loaded existing files', 'loadExistingEmbeddings', {
            fileCount: embeddedFiles.length,
            totalChunks: embeddedFiles.reduce((sum, file) => sum + file.totalChunks, 0)
        });
    } catch (error) {
        logger.error('Failed to load existing embeddings', 'loadExistingEmbeddings', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

/**
 * 
 * @param {*} query 
 * @param {Object} options 
 * @param {number} options.topK - Number of similar chunks to return
 * @returns 
 */
async function querySimilarChunks(query, options = {}) {
    logger.info('Starting similar chunks query', 'querySimilarChunks', {
        query,
        queryLength: query.length
    });

    try {
        // Generate query embedding
        logger.debug('Generating query embedding', 'querySimilarChunks', { query });
        const [queryEmbedding] = await embedDocuments([query]);

        // Query without filter first
        logger.debug('Querying vector database', 'querySimilarChunks', {
            embeddingDimensions: queryEmbedding.length
        });

        const results = await queryVectors(queryEmbedding, {
            topK: options.topK || 4,
            includeMetadata: true,
            includeValues: false
        });

        // Log full results for debugging
        logger.debug('Raw query results', 'querySimilarChunks', {
            matches: results.matches?.map(m => ({
                score: m.score,
                metadata: m.metadata,
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

module.exports = {
    initVectorDb,
    loadExistingEmbeddings,
    querySimilarChunks,
    storeVectors,
    queryVectors
};
