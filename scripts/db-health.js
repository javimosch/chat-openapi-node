require('dotenv').config();

const { Pinecone } = require('@pinecone-database/pinecone');
const { createModuleLogger } = require('../utils/logger');
const { isDbSystemEnabled, connectToMongoDB } = require('../db/config');
const { OpenAPICSVProcessor } = require('../utils/csv-processor');
const Metadata = require('../models/metadata');
const path = require('path');
const fs = require('fs').promises;
const mongoose = require('mongoose');
const logger = createModuleLogger('db-health');

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

async function generateEndpointText(row) {
    const parts = [];
    parts.push(`${row.METHOD} ${row.ENDPOINT}`);
    
    if (row.SUMMARY) {
        parts.push(`Summary: ${row.SUMMARY}`);
    }
    
    if (row.DESCRIPTION) {
        parts.push(`Description: ${row.DESCRIPTION}`);
    }
    
    if (row.PARAMETERS) {
        parts.push(`Parameters: ${row.PARAMETERS}`);
    }
    
    if (row.REQUEST_BODY) {
        parts.push(`Request Body: ${row.REQUEST_BODY}`);
    }
    
    if (row.RESPONSES) {
        parts.push(`Responses: ${row.RESPONSES}`);
    }
    
    if (row.SECURITY) {
        parts.push(`Security: ${row.SECURITY}`);
    }
    
    return parts.join('\n\n');
}

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
        logger.info('Checking MongoDB connection', {
            readyState: mongoose.connection.readyState,
            host: mongoose.connection.host,
            name: mongoose.connection.name
        });

        const fileName = metadataVector.metadata.fileName;
        const specId = metadataVector.metadata.spec_id;
        const isCSV = fileName?.toLowerCase().endsWith('.csv');
        const filePath = path.join(process.cwd(), 'uploads', fileName);

        // First handle file-level metadata
        const fileVectorId = `metadata-${specId}`;
        let fileMetadata = await Metadata.findOne({
            vector_id: fileVectorId,
            is_file_metadata: true
        });

        if (!fileMetadata) {
            fileMetadata = new Metadata({
                spec_id: specId,
                file_name: fileName,
                computed_filename: fileName,
                original_filename: fileName,
                timestamp: metadataVector.metadata.timestamp || new Date().toISOString(),
                status: 'completed',
                type: isCSV ? 'csv' : 'openapi',
                vector_id: fileVectorId,
                chunk_index: 0,
                is_file_metadata: true,
                filepath: filePath
            });
            await fileMetadata.save();
        }

        // For CSV files, process each row and create/update metadata records
        if (isCSV) {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            const csvProcessor = new OpenAPICSVProcessor();
            const records = await csvProcessor.parseCSV(fileContent);

            logger.info('CSV parse result', {
                recordCount: records.length,
                firstRecord: records[0] ? Object.keys(records[0]) : null
            });

            if (!Array.isArray(records)) {
                throw new Error('Failed to parse CSV: Invalid records format');
            }

            const rows = records;

            /* logger.info('Processing rows', {
                rowCount: rows.length,
                firstRow: rows[0]
            });
 */
            let createdCount = 0;
            let updatedCount = 0;
            let errorCount = 0;

            // Get all chunks from Pinecone for this file
            const index = new Pinecone({
                apiKey: process.env.PINECONE_API_KEY,
            }).index(process.env.PINECONE_INDEX);

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
            const chunksByEndpoint = new Map();
            
            // Index chunks by endpoint for faster lookup
            chunks.forEach(chunk => {
                if (chunk.metadata.endpoint && chunk.metadata.method) {
                    const key = `${chunk.metadata.endpoint}-${chunk.metadata.method}`.toLowerCase();
                    chunksByEndpoint.set(key, chunk);
                }
            });

            for (const row of rows) {
                try {
                    const endpoint = row.ENDPOINT;
                    const method = row.METHOD;
                    const vectorId = `${endpoint}-${method}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
                    
                    // Get corresponding chunk from Pinecone
                    const chunk = chunksByEndpoint.get(vectorId);
                    
                    // Create metadata fields for each row
                    const metadataFields = {
                        endpoint,
                        method,
                        summary: row.SUMMARY || '',
                        description: row.DESCRIPTION || '',
                        parameters: row.PARAMETERS || '',
                        requestBody: row.REQUEST_BODY || '',
                        responses: row.RESPONSES || '',
                        security: row.SECURITY || '',
                        servers: row.SERVERS || '',
                        schemas: row.SCHEMAS || '',
                        tags: row.TAGS ? row.TAGS.split(',').map(t => t.trim()) : [],
                        filepath: filePath,
                        vector_id: vectorId,
                        file_name: fileName,
                        chunk_index: chunk?.metadata?.chunk_index || 0,
                        is_file_metadata: false,
                        spec_id: specId,
                        type: 'endpoint',
                        text: await generateEndpointText(row),
                        param_names: extractFieldNames(row.PARAMETERS),
                        response_codes: extractResponseCodes(row.RESPONSES)
                    };

                    /* logger.info('Saving metadata record', {
                        endpoint,
                        method,
                        vectorId: metadataFields.vector_id
                    }); */

                    const result = await Metadata.findOneAndUpdate(
                        { endpoint, method },
                        { $set: metadataFields },
                        { 
                            upsert: true, 
                            new: true,
                            runValidators: true 
                        }
                    );

                    /* logger.info('Metadata record saved', {
                        endpoint,
                        method,
                        isNew: result.isNew,
                        id: result._id
                    }); */

                    if (result.isNew) {
                        createdCount++;
                    } else {
                        updatedCount++;
                    }

                } catch (error) {
                    errorCount++;
                    logger.error('Failed to process row', {
                        error: error.message,
                        row
                    });
                }
            }

            return {
                status: 'processed',
                created: createdCount,
                updated: updatedCount,
                errors: errorCount,
                totalRows: rows.length
            };
        }

        return { status: 'ok', id: fileMetadata._id };

    } catch (error) {
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
        const records = await csvProcessor.parseCSV(fileContent);

        logger.info('CSV parse result', {
            recordCount: records.length,
            firstRecord: records[0] ? Object.keys(records[0]) : null
        });

        if (!Array.isArray(records)) {
            throw new Error('Failed to parse CSV: Invalid records format');
        }

        const rows = records;

/*         logger.info('Processing rows', {
            rowCount: rows.length,
            firstRow: rows[0]
        });
 */
        return {
            success: true,
            rows,
            specId: csvProcessor.specId
        };
    } catch (error) {
        
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
                if (mongoRepair.status === 'processed') {
                    results.summary.mongoRecordsCreated += mongoRepair.created;
                    results.summary.mongoRecordsUpdated += mongoRepair.updated;
                    results.summary.mongoErrors += mongoRepair.errors;
                    fileResult.details.mongodb = {
                        status: mongoRepair.status,
                        action: `Processed ${mongoRepair.totalRows} rows (${mongoRepair.created} created, ${mongoRepair.updated} updated, ${mongoRepair.errors} errors)`,
                        error: mongoRepair.error
                    };
                } else {
                    fileResult.details.mongodb = {
                        status: mongoRepair.status,
                        action: mongoRepair.status === 'created' ? 'Created new record' :
                               mongoRepair.status === 'updated' ? 'Updated existing record' :
                               mongoRepair.status === 'ok' ? 'No changes needed' :
                               'Failed to process',
                        error: mongoRepair.error
                    };

                    if (mongoRepair.status === 'created') results.summary.mongoRecordsCreated++;
                    else if (mongoRepair.status === 'updated') results.summary.mongoRecordsUpdated++;
                    else if (mongoRepair.status === 'ok') results.summary.mongoRecordsOk++;
                    else if (mongoRepair.status === 'error') results.summary.mongoErrors++;
                }

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
        
        logger.error('Health check failed', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}

main();
