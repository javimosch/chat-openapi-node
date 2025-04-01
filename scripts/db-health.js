require('dotenv').config();

const { Pinecone } = require('@pinecone-database/pinecone');
const { createModuleLogger } = require('../utils/logger');
const { isDbSystemEnabled, connectToMongoDB } = require('../db/config');
const { OpenAPICSVProcessor } = require('../utils/csv-processor');
const Metadata = require('../models/metadata');
const path = require('path');
const fs = require('fs').promises;

async function checkFileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function getMetadataVectors() {
    try {
        const index = new Pinecone({
            apiKey: process.env.PINECONE_API_KEY,
        }).index(process.env.PINECONE_INDEX);
        const queryResponse = await index.query({
            vector: Array(1536).fill(0.000001),
            topK: 10000,
            filter: { is_metadata: true },
            includeMetadata: true
        });

        return queryResponse.matches || [];
    } catch (error) {
        const logger = createModuleLogger('db-health');
        logger.error('Failed to get metadata vectors', {
            error: error.message,
            stack: error.stack,
            context: {
                hasApiKey: !!process.env.PINECONE_API_KEY,
                hasIndex: !!process.env.PINECONE_INDEX
            }
        });
        return [];
    }
}

async function repairFileVectors(metadataVector) {
    try {
        const index = new Pinecone({
            apiKey: process.env.PINECONE_API_KEY,
        }).index(process.env.PINECONE_INDEX);
        const fileName = metadataVector.metadata.fileName;
        const specId = metadataVector.metadata.spec_id;

        // Get all vectors for this file
        const chunksResponse = await index.query({
            vector: Array(1536).fill(0.000001),
            topK: 10000,
            filter: {
                $and: [
                    { spec_id: specId },
                    { is_metadata: { $ne: true } }
                ]
            },
            includeMetadata: true
        });

        const chunks = chunksResponse.matches || [];
        const updates = [];

        // Update each chunk's metadata
        for (const chunk of chunks) {
            if (!chunk.metadata.computed_filename || chunk.metadata.computed_filename !== fileName) {
                updates.push({
                    id: chunk.id,
                    values: chunk.values || Array(1536).fill(0.000001),
                    metadata: {
                        ...chunk.metadata,
                        computed_filename: fileName,
                        original_filename: fileName
                    }
                });
            }
        }

        if (updates.length > 0) {
            await index.upsert(updates);
            const logger = createModuleLogger('db-health');
            logger.info('Updated chunk vectors', {
                fileName,
                specId,
                updatedCount: updates.length,
                updateDetails: {
                    totalChunks: chunks.length,
                    updatedChunks: updates.length,
                    unchangedChunks: chunks.length - updates.length
                }
            });
        }

        return {
            totalChunks: chunks.length,
            updatedChunks: updates.length
        };
    } catch (error) {
        const logger = createModuleLogger('db-health');
        logger.error('Failed to repair vectors', {
            error: error.message,
            stack: error.stack,
            context: {
                fileName: metadataVector.metadata.fileName,
                specId: metadataVector.metadata.spec_id,
                hasApiKey: !!process.env.PINECONE_API_KEY,
                hasIndex: !!process.env.PINECONE_INDEX
            }
        });
        return { totalChunks: 0, updatedChunks: 0 };
    }
}

async function repairMongoMetadata(metadataVector) {
    if (!isDbSystemEnabled()) {
        return { status: 'skipped', reason: 'MongoDB not enabled' };
    }

    try {
        await connectToMongoDB();
        const fileName = metadataVector.metadata.fileName;
        const specId = metadataVector.metadata.spec_id;
        const isCSV = fileName?.toLowerCase().endsWith('.csv');

        // Generate a consistent vector_id
        const vector_id = `${fileName}-metadata`;

        // Check if metadata exists
        let metadata = await Metadata.findOne({
            $or: [
                { spec_id: specId },
                { file_name: fileName }
            ]
        });

        if (!metadata) {
            // Create new metadata record
            metadata = new Metadata({
                spec_id: specId,
                file_name: fileName,
                computed_filename: fileName,
                original_filename: fileName,
                timestamp: metadataVector.metadata.timestamp || new Date().toISOString(),
                status: 'completed',
                type: isCSV ? 'csv' : 'openapi',
                vector_id,
                chunk_index: 0,  // Metadata records are always chunk 0
                is_file_metadata: true
            });
            await metadata.save();
            return { status: 'created', id: metadata._id };
        }

        // Update existing metadata if needed
        let updated = false;
        if (!metadata.computed_filename) {
            metadata.computed_filename = fileName;
            updated = true;
        }
        if (!metadata.original_filename) {
            metadata.original_filename = fileName;
            updated = true;
        }
        if (!metadata.spec_id) {
            metadata.spec_id = specId;
            updated = true;
        }
        if (!metadata.type) {
            metadata.type = isCSV ? 'csv' : 'openapi';
            updated = true;
        }
        if (!metadata.vector_id) {
            metadata.vector_id = vector_id;
            updated = true;
        }
        if (metadata.chunk_index === undefined) {
            metadata.chunk_index = 0;
            updated = true;
        }
        if (metadata.is_file_metadata === undefined) {
            metadata.is_file_metadata = true;
            updated = true;
        }

        if (updated) {
            await metadata.save();
            return { status: 'updated', id: metadata._id };
        }

        return { status: 'ok', id: metadata._id };
    } catch (error) {
        const logger = createModuleLogger('db-health');
        logger.error('Failed to repair MongoDB metadata', {
            error: error.message,
            stack: error.stack,
            context: {
                fileName: metadataVector.metadata.fileName,
                specId: metadataVector.metadata.spec_id
            }
        });
        return { status: 'error', error: error.message };
    }
}

async function processCSVContent(filePath) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const csvProcessor = new OpenAPICSVProcessor();
        const parseResult = await csvProcessor.parseCSV(fileContent);

        if (parseResult.error) {
            throw new Error(`Failed to parse CSV: ${parseResult.error}`);
        }

        const rows = Array.isArray(parseResult.records) ? parseResult.records :
            (parseResult.records && Array.isArray(parseResult.records.records)) ?
                parseResult.records.records : [];

        return {
            success: true,
            rows,
            specId: csvProcessor.specId
        };
    } catch (error) {
        const logger = createModuleLogger('db-health');
        logger.error('Failed to process CSV file', {
            error: error.message,
            context: {
                filePath
            }
        });
        return {
            success: false,
            error: error.message
        };
    }
}

async function main() {
    try {
        const logger = createModuleLogger('db-health');
        logger.info('Starting database health check');
        
        const results = {
            summary: {
                totalFiles: 0,
                existingFiles: 0,
                missingFiles: 0,
                vectorsRepaired: 0,
                mongoRecordsCreated: 0,
                mongoRecordsUpdated: 0,
                mongoRecordsOk: 0,
                mongoErrors: 0
            },
            files: {
                openapi: [],
                csv: []
            }
        };

        // Get all metadata vectors
        logger.info('Fetching metadata vectors from Pinecone');
        const metadataVectors = await getMetadataVectors();
        results.summary.totalFiles = metadataVectors.length;
        
        // Process each file
        for (const metadataVector of metadataVectors) {
            const fileName = metadataVector.metadata.fileName;
            const filePath = path.join(process.cwd(), 'uploads', fileName);
            const fileExists = await checkFileExists(filePath);
            const isCSV = fileName?.toLowerCase().endsWith('.csv');
            
            const fileResult = {
                fileName,
                specId: metadataVector.metadata.spec_id,
                status: fileExists ? 'exists' : 'missing',
                details: {
                    pinecone: {
                        totalChunks: 0,
                        repairedChunks: 0
                    },
                    mongodb: {
                        status: null,
                        action: null,
                        error: null
                    }
                }
            };

            if (fileExists) {
                results.summary.existingFiles++;
                logger.info('Processing existing file', {
                    fileName,
                    specId: metadataVector.metadata.spec_id,
                    type: isCSV ? 'CSV' : 'OpenAPI'
                });

                // Process CSV content if it's a CSV file
                if (isCSV) {
                    const csvResult = await processCSVContent(filePath);
                    if (csvResult.success) {
                        fileResult.details.csv = {
                            totalRows: csvResult.rows.length
                        };
                        logger.info('CSV file processed', {
                            fileName,
                            rowCount: csvResult.rows.length
                        });
                    } else {
                        fileResult.details.csv = {
                            error: csvResult.error
                        };
                        logger.error('Failed to process CSV file', {
                            error: csvResult.error,
                            context: {
                                filePath
                            }
                        });
                    }
                }

                // Repair vectors
                const vectorRepair = await repairFileVectors(metadataVector);
                fileResult.details.pinecone = {
                    totalChunks: vectorRepair.totalChunks,
                    repairedChunks: vectorRepair.updatedChunks
                };
                results.summary.vectorsRepaired += vectorRepair.updatedChunks;

                // Repair MongoDB metadata
                const mongoRepair = await repairMongoMetadata(metadataVector);
                fileResult.details.mongodb = {
                    status: mongoRepair.status,
                    action: mongoRepair.status === 'created' ? 'Created new record' :
                           mongoRepair.status === 'updated' ? 'Updated existing record' :
                           mongoRepair.status === 'ok' ? 'No changes needed' :
                           'Failed to process',
                    error: mongoRepair.error
                };

                // Update summary stats
                if (mongoRepair.status === 'created') results.summary.mongoRecordsCreated++;
                else if (mongoRepair.status === 'updated') results.summary.mongoRecordsUpdated++;
                else if (mongoRepair.status === 'ok') results.summary.mongoRecordsOk++;
                else if (mongoRepair.status === 'error') results.summary.mongoErrors++;

            } else {
                results.summary.missingFiles++;
                logger.warn('File not found in uploads directory', {
                    fileName,
                    specId: metadataVector.metadata.spec_id
                });
            }

            // Add to appropriate category
            if (isCSV) {
                results.files.csv.push(fileResult);
            } else {
                results.files.openapi.push(fileResult);
            }
        }

        // Log final summary
        logger.info('Health check summary', { summary: results.summary });

        // Log detailed results by file type
        if (results.files.csv.length > 0) {
            const csvFiles = results.files.csv.map(f => ({
                fileName: f.fileName,
                status: f.status,
                chunks: f.details.pinecone.totalChunks,
                repairedChunks: f.details.pinecone.repairedChunks,
                mongoStatus: f.details.mongodb.action
            }));

            logger.info('CSV Files', { files: csvFiles });
        }

        if (results.files.openapi.length > 0) {
            const openapiFiles = results.files.openapi.map(f => ({
                fileName: f.fileName,
                status: f.status,
                chunks: f.details.pinecone.totalChunks,
                repairedChunks: f.details.pinecone.repairedChunks,
                mongoStatus: f.details.mongodb.action
            }));

            logger.info('OpenAPI Files', { files: openapiFiles });
        }

        process.exit(0);
    } catch (error) {
        const logger = createModuleLogger('db-health');
        logger.error('Health check failed', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}

main();
