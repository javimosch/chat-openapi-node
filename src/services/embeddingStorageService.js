const { createModuleLogger } = require('../../utils/logger');
const { embedDocuments } = require('./embeddingService');
const { storeVectors } = require('./vectorDbService');
const { OpenAPIChunker } = require('../../utils/chunking');

const { processingStatus, resetProcessingStatus } = require('../config/state');
const yaml = require('js-yaml');

const logger = createModuleLogger('embeddingStorageService');

// Process OpenAPI specification in background
async function processOpenAPISpec(specContent, fileName) {
    logger.info('Starting OpenAPI spec processing', 'processOpenAPISpec', { fileName });

    if (processingStatus.isProcessing) {
        logger.warn('Attempted to process while another file is being processed', 'processOpenAPISpec', {
            currentFile: processingStatus.currentFile,
            attemptedFile: fileName
        });
        return {
            status: 'already_processing',
            message: 'Already processing a file'
        };
    }

    resetProcessingStatus();
    processingStatus.isProcessing = true;
    processingStatus.currentFile = fileName;

    try {
        // Parse OpenAPI spec
        logger.debug('Parsing OpenAPI specification', 'processOpenAPISpec', { fileName });
        const spec = yaml.load(specContent);

        // Create chunks from specification
        logger.debug('Creating chunks from specification', 'processOpenAPISpec', { fileName });
        const chunker = new OpenAPIChunker(spec);
        const chunks = await chunker.processSpecification();

        // Update status
        processingStatus.totalChunks = chunks.length;
        processingStatus.processedChunks = 0;

        logger.info('Starting background processing', 'processOpenAPISpec', {
            fileName,
            totalChunks: chunks.length
        });

        // Process chunks in background
        processInBackground(chunks, fileName).catch(error => {
            logger.error('Background processing failed', 'processOpenAPISpec', {
                error: error.message,
                stack: error.stack,
                fileName
            });
            processingStatus.error = error.message;
        });

        return {
            status: 'processing',
            message: 'Started processing file'
        };
    } catch (error) {
        logger.error('Failed to process OpenAPI spec', 'processOpenAPISpec', {
            error: error.message,
            stack: error.stack,
            fileName
        });
        processingStatus.error = error.message;
        processingStatus.isProcessing = false;
        throw error;
    }
}

// Process chunks in background
async function processInBackground(chunks, fileName) {
    logger.info('Starting background chunk processing', 'processInBackground', {
        fileName,
        chunkCount: chunks.length
    });

    try {
        logger.debug('Processing specification chunks', 'processInBackground', {
            fileName,
            chunkCount: chunks.length,
            storageType: 'Pinecone'
        });

        // Process chunks with MongoDB if enabled

        // Store file metadata
        logger.info('Storing file metadata', 'processInBackground', { fileName });
        await storeFileMetadata({
            fileName,
            totalChunks: chunks.length,
            timestamp: new Date().toISOString(),
            is_metadata: true
        });

        // Process chunks in batches
        logger.info('Processing chunks with vector database', 'processInBackground', { fileName });
        await storeEmbeddingsInBatches(chunks, fileName, processingStatus);


        // Update status
        processingStatus.isProcessing = false;
        processingStatus.progress = 100;
        processingStatus.embeddedFiles.push({
            fileName,
            totalChunks: chunks.length,
            timestamp: new Date().toISOString(),
            status: 'completed'
        });

        logger.info('Successfully completed processing', 'processInBackground', {
            fileName,
            totalChunks: chunks.length,
            processingTime: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Failed to process chunks', 'processInBackground', {
            error: error.message,
            stack: error.stack,
            fileName,
            chunkCount: chunks.length
        });
        processingStatus.error = error.message;
        processingStatus.isProcessing = false;
        throw error;
    }
}

/**
 * Stores document chunks with their embeddings in the vector database
 */
async function storeEmbeddingsInBatches(chunks, fileName, processingStatus) {
    logger.info('Starting batch embedding storage', 'storeEmbeddingsInBatches', {
        fileName,
        chunkCount: chunks.length,
        batchSize: 100
    });

    try {
        const batchSize = 100;
        const totalBatches = Math.ceil(chunks.length / batchSize);

        logger.debug('Processing chunks in batches', 'storeEmbeddingsInBatches', {
            fileName,
            totalBatches,
            batchSize
        });

        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;

            logger.debug('Processing batch', 'storeEmbeddingsInBatches', {
                fileName,
                batchNumber,
                totalBatches,
                batchSize: batch.length
            });

            await processBatch(batch, i, fileName, totalBatches, processingStatus);
        }

        logger.info('Successfully completed batch processing', 'storeEmbeddingsInBatches', {
            fileName,
            totalChunks: chunks.length,
            totalBatches
        });
    } catch (error) {
        logger.error('Failed to store embeddings in batches', 'storeEmbeddingsInBatches', {
            error: error.message,
            stack: error.stack,
            fileName,
            chunkCount: chunks.length
        });
        throw new Error('Failed to store embeddings: ' + error.message);
    }
}

/**
 * Processes a single batch of chunks
 */
async function processBatch(batch, startIndex, fileName, totalBatches, processingStatus) {
    const batchNumber = Math.floor(startIndex / batch.length) + 1;
    logger.debug('Starting batch processing', 'processBatch', {
        fileName,
        batchNumber,
        totalBatches,
        batchSize: batch.length,
        startIndex
    });

    try {
        // Generate embeddings for batch
        logger.debug('Generating embeddings for batch', 'processBatch', {
            fileName,
            batchNumber,
            documentCount: batch.length
        });
        const texts = batch.map(chunk => chunk.text);
        const batchEmbeddings = await embedDocuments(texts);

        // Prepare vectors for batch
        logger.debug('Preparing vectors for storage', 'processBatch', {
            fileName,
            batchNumber,
            vectorCount: batchEmbeddings.length
        });
        const vectors = batchEmbeddings.map((embedding, idx) => ({
            id: `${fileName}:${startIndex + idx}`,
            values: embedding,
            metadata: {
                ...batch[idx].metadata,
                fileName,
                chunk_index: startIndex + idx
            }
        }));

        // Store vectors
        logger.debug('Storing vectors in database', 'processBatch', {
            fileName,
            batchNumber,
            vectorCount: vectors.length
        });
        await storeVectors(vectors);

        // Update progress if status object is provided
        if (processingStatus) {
            processingStatus.processedChunks += batch.length;
            processingStatus.progress = Math.round((processingStatus.processedChunks / processingStatus.totalChunks) * 100);

            logger.debug('Updated processing status', 'processBatch', {
                fileName,
                batchNumber,
                progress: processingStatus.progress,
                processedChunks: processingStatus.processedChunks,
                totalChunks: processingStatus.totalChunks
            });
        }

        logger.info('Successfully processed batch', 'processBatch', {
            batchNumber,
            totalBatches,
            progress: processingStatus?.progress
        });
    } catch (error) {
        logger.error('Failed to process batch', 'processBatch', {
            error: error.message,
            stack: error.stack,
            fileName,
            batchNumber,
            totalBatches,
            startIndex
        });
        throw error;
    }
}

/**
 * Stores metadata about a file in the vector database
 */
async function storeFileMetadata(fileMetadata) {
    logger.info('Storing file metadata', 'storeFileMetadata', {
        fileName: fileMetadata.fileName,
        timestamp: fileMetadata.timestamp
    });

    try {
        await storeVectors([{
            id: `file:${fileMetadata.fileName}`,
            values: Array(1536).fill(0), // Default dimension for ada-002
            metadata: {
                ...fileMetadata,
                type: 'metadata'
            }
        }]);

        logger.debug('Successfully stored file metadata', 'storeFileMetadata', {
            fileName: fileMetadata.fileName,
            metadata: fileMetadata
        });
    } catch (error) {
        logger.error('Failed to store file metadata', 'storeFileMetadata', {
            error: error.message,
            stack: error.stack,
            fileName: fileMetadata.fileName
        });
        throw error;
    }
}

module.exports = {
    storeEmbeddingsInBatches,
    storeFileMetadata,
    processOpenAPISpec
};
