/**
 * @module embeddingService
 * @description Service for creating and managing embeddings with logging.
 */

const { createModuleLogger } = require('../utils/logger');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { createOllamaEmbeddings } = require('../utils/ollama');

const logger = createModuleLogger('embeddingService');

/**
 * Creates embeddings instance based on configuration
 * @returns {Object} Embeddings instance (OpenAI or Ollama)
 */
const createEmbeddingsInstance = () => {
    const useOllama = process.env.OLLAMA_EMBEDDING_ENABLED === '1';
    
    logger.info('Creating embeddings instance', 'createEmbeddingsInstance', {
        provider: useOllama ? 'Ollama' : 'OpenAI'
    });

    if (useOllama) {
        return createOllamaEmbeddings();
    }

    return new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: 'text-embedding-ada-002'
    });
};

/**
 * Creates and wraps embeddings with logging
 * @returns {Object} Wrapped embeddings instance with logging
 */
const createEmbeddingsWithLogging = () => {
    logger.info('Creating embeddings instance with logging', 'createEmbeddingsWithLogging');

    try {
        const embeddings = createEmbeddingsInstance();
        const provider = process.env.OLLAMA_EMBEDDING_ENABLED === '1' ? 'Ollama' : 'OpenAI';

        // Wrap embedDocuments with logging
        const originalEmbedDocuments = embeddings.embedDocuments.bind(embeddings);
        embeddings.embedDocuments = async (documents) => {
            logger.info('Creating embeddings', 'embedDocuments', {
                provider,
                documentCount: documents.length,
                averageLength: Math.round(documents.reduce((sum, doc) => sum + doc.length, 0) / documents.length)
            });

            try {
                logger.debug(`Sending request to ${provider} API`, 'embedDocuments', {
                    documentCount: documents.length,
                    sampleLength: documents[0]?.length
                });

                const result = await originalEmbedDocuments(documents);

                logger.debug('Successfully created embeddings', 'embedDocuments', {
                    documentCount: documents.length,
                    embeddingDimensions: result[0]?.length,
                    provider
                });

                return result;
            } catch (error) {
                logger.error('Failed to create embeddings', 'embedDocuments', {
                    error: error.message,
                    stack: error.stack,
                    documentCount: documents.length,
                    provider
                });
                throw error;
            }
        };

        logger.debug('Successfully created embeddings instance', 'createEmbeddingsWithLogging', {
            provider
        });
        return embeddings;
    } catch (error) {
        logger.error('Failed to create embeddings instance', 'createEmbeddingsWithLogging', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
};

// Create a single instance of embeddings for performance
logger.info('Initializing embeddings instance', 'embeddingService');
const embeddings = createEmbeddingsWithLogging();

/**
 * Embeds documents using the created embeddings instance
 * @param {Array} documents - The documents to embed
 * @returns {Promise<Array>} The embeddings for the provided documents
 */
const embedDocuments = async (documents) => {
    logger.info('Starting document embedding', 'embedDocuments', {
        documentCount: documents.length
    });

    try {
        const result = await embeddings.embedDocuments(documents);

        logger.debug('Successfully embedded documents', 'embedDocuments', {
            documentCount: documents.length,
            embeddingDimensions: result[0]?.length
        });

        return result;
    } catch (error) {
        logger.error('Failed to embed documents', 'embedDocuments', {
            error: error.message,
            stack: error.stack,
            documentCount: documents.length
        });
        throw error;
    }
};

module.exports = {
    embedDocuments
};
