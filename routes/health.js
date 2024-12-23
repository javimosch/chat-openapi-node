const express = require('express');
const router = express.Router();
const { createModuleLogger } = require('../utils/logger');
const { OpenAPICSVProcessor } = require('../utils/csv-processor');
const fs = require('fs').promises;
const path = require('path');
const { Pinecone } = require('@pinecone-database/pinecone');
const Metadata = require('../models/metadata');
const mongoose = require('mongoose');

const logger = createModuleLogger('health');

// Helper function to find CSV file and link it to metadata
async function findAndLinkCSVFile(pineconeIndex, vectorMetadata = null) {
    let csvFilePath;
    let vectorId = null;

    // If we have vector metadata, try to use its filepath
    if (vectorMetadata && vectorMetadata.filepath) {
        try {
            await fs.access(vectorMetadata.filepath);
            csvFilePath = vectorMetadata.filepath;
            vectorId = vectorMetadata.id;
            logger.info('Using existing filepath from metadata', 'findAndLinkCSVFile', { filepath: csvFilePath });
            return { csvFilePath, vectorId };
        } catch (error) {
            logger.warn('Existing filepath not accessible', 'findAndLinkCSVFile', { 
                filepath: vectorMetadata.filepath,
                error: error.message 
            });
        }
    }

    // If no filepath or it's not accessible, look for CSV files
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    try {
        const files = await fs.readdir(uploadsDir);
        const csvFiles = files.filter(file => file.toLowerCase().endsWith('.csv'));
        
        if (csvFiles.length === 0) {
            throw new Error('No CSV files found in uploads directory');
        }

        // Use the first CSV file found
        csvFilePath = path.join(uploadsDir, csvFiles[0]);
        
        // If we have vector metadata, update it with the new filepath
        if (vectorMetadata) {
            vectorId = vectorMetadata.id;
            const metadata = {
                ...vectorMetadata,
                filepath: csvFilePath
            };

            // Update Pinecone
            await pineconeIndex.upsert([{
                id: vectorId,
                metadata: metadata,
                values: new Array(1536).fill(0)
            }]);

            // Update MongoDB
            await Metadata.findOneAndUpdate(
                { vector_id: vectorId },
                { $set: { filepath: csvFilePath } },
                { new: true }
            );

            logger.info('Updated metadata with new filepath', 'findAndLinkCSVFile', {
                vectorId,
                filepath: csvFilePath
            });
        }

        return { csvFilePath, vectorId };
    } catch (error) {
        throw new Error(`Failed to access uploads directory: ${error.message}`);
    }
}

// Helper function to generate endpoint text
function generateEndpointText(row) {
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

async function findInCSV(query) {
    try {
        const pinecone = new Pinecone({
            apiKey: process.env.PINECONE_API_KEY,
        });
        const index = pinecone.index(process.env.PINECONE_INDEX);

        // Query for file metadata vectors
        const queryResponse = await index.query({
            vector: new Array(1536).fill(0),
            filter: { is_file_metadata: true },
            topK: 1,
            includeMetadata: true
        });

        // Find and link CSV file
        const { csvFilePath } = await findAndLinkCSVFile(
            index, 
            queryResponse.matches[0]?.metadata
        );

        // Read and parse the CSV file
        const fileContent = await fs.readFile(csvFilePath, 'utf-8');
        const csvProcessor = new OpenAPICSVProcessor();
        const parseResult = await csvProcessor.parseCSV(fileContent);
        
        logger.info('CSV parse result', 'findInCSV', {
            resultKeys: Object.keys(parseResult),
            recordsType: typeof parseResult.records,
            recordsKeys: parseResult.records ? Object.keys(parseResult.records) : null,
            error: parseResult.error
        });
        
        if (parseResult.error) {
            throw new Error(`Failed to parse CSV: ${parseResult.error}`);
        }

        // Process each row and update MongoDB
        const results = [];
        const rows = Array.isArray(parseResult.records) ? parseResult.records : 
                    (parseResult.records && Array.isArray(parseResult.records.records)) ? 
                    parseResult.records.records : [];
                    
        logger.info('Processing rows', 'findInCSV', {
            rowCount: rows.length,
            firstRow: rows[0]
        });

        for (const row of rows) {
            try {
                const endpoint = row.ENDPOINT;
                const method = row.METHOD;

                // Create metadata fields
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
                    filepath: csvFilePath,
                    vector_id: `${endpoint}-${method}`.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                    file_name: path.basename(csvFilePath),
                    chunk_index: 0,
                    is_file_metadata: false,
                    spec_id: csvProcessor.specId,
                    type: 'endpoint',
                    text: generateEndpointText(row)
                };

                // Log the metadata being saved
                logger.debug('Saving metadata', 'findInCSV', {
                    endpoint,
                    method,
                    vector_id: metadataFields.vector_id
                });

                // Update or create metadata in MongoDB
                const result = await Metadata.findOneAndUpdate(
                    { endpoint, method },
                    { $set: metadataFields },
                    { 
                        upsert: true, 
                        new: true,
                        runValidators: true 
                    }
                );

                results.push({
                    status: 'updated',
                    endpoint,
                    method
                });
            } catch (error) {
                logger.error('Failed to process row', 'findInCSV', {
                    error: error.message,
                    row
                });
                results.push({
                    status: 'error',
                    error: error.message,
                    endpoint: row.ENDPOINT,
                    method: row.METHOD
                });
            }
        }

        return {
            total: results.length,
            results: results.slice(0, 10),
            source: path.basename(csvFilePath)
        };
    } catch (error) {
        logger.error('Error in findInCSV', 'findInCSV', { error });
        throw error;
    }
}

router.get('/csv_health', async (req, res) => {
    try {
        logger.info('Starting CSV health check');
        
        // Check MongoDB connection
        logger.info('Checking MongoDB connection', {
            readyState: mongoose.connection.readyState,
            host: mongoose.connection.host,
            name: mongoose.connection.name,
            collections: await mongoose.connection.db.listCollections().toArray()
        });
        
        // Initialize Pinecone
        const pinecone = new Pinecone({
            apiKey: process.env.PINECONE_API_KEY,
        });
        const index = pinecone.index(process.env.PINECONE_INDEX);

        // Find and link CSV file
        const { csvFilePath } = await findAndLinkCSVFile(index);

        // Read and parse the CSV file
        const fileContent = await fs.readFile(csvFilePath, 'utf-8');
        const csvProcessor = new OpenAPICSVProcessor();
        const parseResult = await csvProcessor.parseCSV(fileContent);
        
        logger.info('CSV parse result', 'csvHealth', {
            resultKeys: Object.keys(parseResult),
            recordsType: typeof parseResult.records,
            recordsKeys: parseResult.records ? Object.keys(parseResult.records) : null,
            error: parseResult.error
        });
        
        if (parseResult.error) {
            throw new Error(`Failed to parse CSV: ${parseResult.error}`);
        }

        // Process each row and update MongoDB
        const results = [];
        const rows = Array.isArray(parseResult.records) ? parseResult.records : 
                    (parseResult.records && Array.isArray(parseResult.records.records)) ? 
                    parseResult.records.records : [];
                    
        logger.info('Processing rows', 'csvHealth', {
            rowCount: rows.length,
            firstRow: rows[0]
        });

        for (const row of rows) {
            try {
                const endpoint = row.ENDPOINT;
                const method = row.METHOD;

                // Create metadata fields
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
                    filepath: csvFilePath,
                    vector_id: `${endpoint}-${method}`.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                    file_name: path.basename(csvFilePath),
                    chunk_index: 0,
                    is_file_metadata: false,
                    spec_id: csvProcessor.specId,
                    type: 'endpoint'
                };

                // Log the metadata being saved
                logger.debug('Saving metadata', 'csvHealth', {
                    endpoint,
                    method,
                    vector_id: metadataFields.vector_id
                });

                // Update or create metadata in MongoDB
                const result = await Metadata.findOneAndUpdate(
                    { endpoint, method },
                    { $set: metadataFields },
                    { 
                        upsert: true, 
                        new: true,
                        runValidators: true 
                    }
                );

                results.push({
                    status: 'updated',
                    endpoint,
                    method
                });
            } catch (error) {
                logger.error('Failed to process row', 'csvHealth', {
                    error: error.message,
                    row
                });
                results.push({
                    status: 'error',
                    error: error.message,
                    endpoint: row.ENDPOINT,
                    method: row.METHOD
                });
            }
        }

        res.json({
            status: 'success',
            processed: results.length,
            results,
            csvFile: path.basename(csvFilePath)
        });
    } catch (error) {
        logger.error('Health check failed', 'csvHealth', { error });
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

module.exports = router;
