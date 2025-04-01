#!/usr/bin/env node
require('dotenv').config()
const path = require('path');
const fs = require('fs').promises;
const { createModuleLogger } = require('../utils/logger');
const { OpenAPICSVProcessor } = require('../utils/csv-processor');
const { initVectorDb } = require('../services/vectorDbService');
const { embedDocuments } = require('../services/embeddingService');

const logger = createModuleLogger('localEmbed');

const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

const prompt = (question) => new Promise((resolve) => readline.question(question, resolve));

async function main() {
    try {
        let csvPath = path.join(process.cwd(),process.env.OPENAPI_CSV_PATH);

        // Initialize ChromaDB client early to check collection
        const { ChromaClient } = require('chromadb');
        const client = new ChromaClient({ path: process.env.CHROMA_BASE_URL || 'http://localhost:8123' });
        
        const collectionName = 'openapi_specs';
        
        // Check if collection exists and has data
        let collection = await client.getOrCreateCollection({
            name: collectionName
        });
        
        const count = await collection.count();
        if (count > 0) {
            logger.info('Found existing data in ChromaDB', 'main', { count });
            const answer = await prompt('Database contains existing data. Delete it before proceeding? (y/N): ');
            if (answer.toLowerCase() === 'y') {
                await client.deleteCollection({ name: collectionName });
                logger.info('Collection deleted', 'main');
                // Recreate collection after deletion
                collection = await client.createCollection({
                    name: collectionName,
                    metadata: { 
                        description: 'OpenAPI specifications and their embeddings',
                        timestamp: new Date().toISOString()
                    }
                });
                logger.info('Collection recreated', 'main');
            } else {
                logger.info('Keeping existing data', 'main');
                readline.close();
                process.exit(0);
            }
        }

        if (!csvPath) {
            logger.error('CSV path not provided', 'main');
            process.exit(1);
        }

        logger.info('Starting OpenAPI CSV embedding process', 'main', {
            csvPath
        });

        // Initialize CSV processor
        const processor = new OpenAPICSVProcessor();
        
        // Read CSV file
        const csvContent = await fs.readFile(csvPath, 'utf-8');
        logger.info('CSV file read successfully', 'main', {
            contentLength: csvContent.length
        });

        // Process CSV content
        const records = await processor.parseCSV(csvContent);
        logger.info('CSV records parsed', 'main', {
            totalRows: records.length
        });
        
        // Transform records into structured entries
        const entries = records.map(record => {
            const { ENDPOINT: endpoint, METHOD: method, SUMMARY: summary, DESCRIPTION: description, PARAMETERS: parameters, REQUEST_BODY: requestBody, RESPONSES: responses } = record;


            // Parse JSON fields safely
            const parseJsonSafely = (str) => {
                try {
                    return str ? JSON.parse(str) : null;
                } catch (err) {
                    logger.warn('Failed to parse JSON field', 'parseJsonSafely', {
                        str,
                        error: err.message
                    });
                    return null;
                }
            };

            return {
                endpoint: endpoint,
                method: method?.toUpperCase(),
                description: (description || summary),
                parameters: parseJsonSafely(parameters) || [],
                requestBody: parseJsonSafely(requestBody),
                responses: parseJsonSafely(responses) || {}
            };
        }).filter(entry => entry.endpoint && entry.method && entry.description);
        logger.info('CSV processing completed', 'main', {
            totalRows: records.length,
            validEntries: entries.length,
            skippedEntries: records.length - entries.length
        });

        if (records.length !== entries.length) {
            logger.warn('Some entries were skipped due to missing required fields', 'main', {
                skippedCount: records.length - entries.length
            });
        }

        // Initialize vector store
        const vectorStore = await initVectorDb();
        
        // Prepare documents for embedding
        const documents = entries.map(entry => {
            const text = `${entry.method} ${entry.endpoint} - ${entry.description}`;
            logger.debug('Processing entry', 'main', { text });
            return {
                text,
                metadata: {
                    source: 'openapi',
                    endpoint: entry.endpoint,
                    method: entry.method,
                    description: entry.description,
                    parameters: entry.parameters,
                    specId: processor.specId
                }
            };
        });

        // Process in batches
        const batchSize = parseInt(process.env.EMBEDDING_BATCH_SIZE || '50');
        const totalBatches = Math.ceil(documents.length / batchSize);
        let totalProcessed = 0;

        for (let i = 0; i < documents.length; i += batchSize) {
            const batch = documents.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            logger.info('Processing batch', 'main', {
                batchNumber,
                totalBatches,
                batchSize: batch.length,
                progress: `${batchNumber}/${totalBatches}`
            });

            const embeddings = await embedDocuments(
                batch.map(doc => doc.text)
            );

            // Format vectors for ChromaDB
            const vectors = batch.map((doc, idx) => ({
                id: `${processor.specId}-${i + idx}`, // Fixed to use global index
                values: embeddings[idx],
                metadata: {
                    text: doc.text,
                    ...doc.metadata
                }
            }));

            await vectorStore.addVectors(vectors);
            totalProcessed += batch.length;

            logger.info('Batch processed', 'main', {
                batchNumber,
                totalBatches,
                totalProcessed,
                remaining: documents.length - totalProcessed
            });
        }

        // Verify final count in ChromaDB
        // Get a fresh reference to the collection
        collection = await client.getCollection({ name: collectionName });
        const finalCount = await collection.count();
        logger.info('Embedding process completed', 'main', {
            sourceRows: records.length,
            validEntries: entries.length,
            processedDocuments: documents.length,
            chromaDbCount: finalCount,
            validationStatus: finalCount === documents.length ? 'OK' : 'MISMATCH'
        });

        if (finalCount !== documents.length) {
            logger.warn('Number of documents in ChromaDB does not match processed documents', 'main', {
                processedDocuments: documents.length,
                chromaDbCount: finalCount,
                difference: documents.length - finalCount
            });
        }

        if (records.length !== documents.length) {
            logger.warn('Number of processed documents does not match source CSV rows', 'main', {
                sourceRows: records.length,
                processedDocuments: documents.length,
                difference: records.length - documents.length
            });
        }
    } catch (err) {
        logger.error('Failed to process and embed OpenAPI CSV', 'main', {
            message: err.message,
            stack: err.stack
        });
        process.exit(1);
    } finally {
        readline.close();
    }
}

// Execute if run directly
if (require.main === module) {
    main();
}

module.exports = { main };