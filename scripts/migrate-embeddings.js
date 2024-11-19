#!/usr/bin/env node
require('dotenv').config();
const { initPinecone } = require('../utils/openapi');
const db = require('../db');
const { isDbSystemEnabled, shouldUseMongoForEmbeddings } = require('../db/config');
const { createModuleLogger } = require('../utils/logger');
const { SpecFile: SpecFileModel, EmbeddingChunk: ChunkModel } = require('../db/models');
const { v4: uuidv4 } = require('uuid');

const logger = createModuleLogger('migrate');

async function migrateData() {
    try {
        // Check if MongoDB is properly configured
        if (!isDbSystemEnabled()) {
            logger.info('MongoDB not properly configured, skipping migration');
            process.exit(0);
        }

        if (!shouldUseMongoForEmbeddings()) {
            logger.info('USE_MONGODB_FOR_EMBEDDINGS is not enabled, skipping migration');
            process.exit(0);
        }

        logger.info('Starting data migration');

        // Connect to MongoDB
        await db.connectDB();
        logger.info('Connected to MongoDB');

        // Initialize Pinecone
        const index = await initPinecone();
        logger.info('Querying existing vectors from Pinecone');

        // Query all vectors from Pinecone
        const batchSize = 100;
        let processedSpecIds = [];
        let cursor = null;
        let totalMigrated = 0;

        do {
            // Query batch of vectors
            const queryResponse = await index.query({
                vector: Array(1536).fill(0),
                topK: batchSize,
                includeMetadata: true,
                filter: processedSpecIds.length > 0 ? {
                    spec_id: { $nin: processedSpecIds }
                } : undefined,
                ...(cursor ? { cursor } : {})
            });

            if (!queryResponse.matches || queryResponse.matches.length === 0) {
                break;
            }

            logger.info('Fetching vectors with spec_id filter', 'queryBatch', {
                currentSize: queryResponse.matches.length,
                processedSpecIds: processedSpecIds.length
            });

            // Group vectors by spec_id
            const vectorsBySpec = {};
            for (const match of queryResponse.matches) {
                const metadata = match.metadata || {};
                const specId = metadata.spec_id;
                
                if (specId && !vectorsBySpec[specId]) {
                    vectorsBySpec[specId] = [];
                }
                
                if (specId) {
                    vectorsBySpec[specId].push({
                        ...match,
                        metadata
                    });
                }
            }

            // Process each spec
            for (const [specId, vectors] of Object.entries(vectorsBySpec)) {
                logger.info('Processing spec', 'processSpec', { specId });

                try {
                    // Check if spec already exists
                    const existingSpec = await SpecFileModel.findOne({ specId });
                    if (!existingSpec) {
                        // Create spec file entry
                        const specFile = new SpecFileModel({
                            fileName: `openapi_spec_${specId}.json`,
                            specId,
                            status: 'migrated',
                            totalChunks: vectors.length,
                            processedChunks: vectors.length,
                            progress: 100
                        });
                        await specFile.save();
                    }

                    // Process vectors for this spec
                    for (const vector of vectors) {
                        const metadata = vector.metadata || {};
                        
                        // Skip file metadata entries
                        if (metadata.isFileMetadata) {
                            continue;
                        }

                        // Check if chunk already exists
                        const existingChunk = await ChunkModel.findOne({
                            'metadata.pineconeId': vector.id
                        });

                        if (!existingChunk) {
                            // Create chunk document
                            const chunk = new ChunkModel({
                                text: metadata.content || metadata.text || '',
                                fileName: metadata.fileName || `openapi_spec_${specId}.json`,
                                chunkType: metadata.chunk_type || 'info',
                                embedding: vector.values,
                                metadata: {
                                    ...metadata,
                                    pineconeId: vector.id,
                                    spec_id: specId
                                }
                            });

                            await chunk.save();
                            totalMigrated++;

                            if (totalMigrated % 10 === 0) {
                                logger.info('Migration progress', {
                                    totalMigrated,
                                    currentSpec: specId
                                });
                            }
                        }
                    }
                } catch (error) {
                    logger.error('Failed to process spec', 'processSpec', {
                        specId,
                        error: error.message
                    });
                }

                processedSpecIds.push(specId);
            }

            cursor = queryResponse.cursor;

            logger.info('Query complete', 'queryComplete', {
                totalVectors: queryResponse.matches.length,
                uniqueSpecIds: Object.keys(vectorsBySpec).length,
                totalMigrated
            });

        } while (cursor);

        logger.info('Migration completed', {
            totalSpecs: processedSpecIds.length,
            totalChunks: totalMigrated
        });

    } catch (error) {
        logger.error('Migration failed', 'migrateData', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// Run migration
migrateData().catch(error => {
    logger.error('Migration failed', { error: error.message, stack: error.stack });
    process.exit(1);
});
