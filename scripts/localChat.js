#!/usr/bin/env node
require('dotenv').config();
const { createModuleLogger } = require('../utils/logger');
const { initVectorDb, querySimilarChunks } = require('../services/vectorDbService');
const fs = require('fs');
const { connectToMongoDB, isDbSystemEnabled } = require('../db/config');
const Metadata = require('../models/metadata');
const { generateOpenAPILLMCompletion } = require('../services/chatService');
const logger = createModuleLogger('localChat');

    
async function main() {
    try {
        const query = process.argv[2];
        if (!query) {
            console.error('Please provide a query as an argument');
            process.exit(1);
        }

        logger.info('Starting chat interaction', 'main', { query });

        // Initialize vector store
        const vectorStore = await initVectorDb();

        // Get relevant chunks from vector store
        const relevantDocs = await querySimilarChunks(query);
        
        if (!relevantDocs?.length) {
            logger.warn('No relevant API documentation found', 'main');
            return console.log('I could not find any relevant API documentation to help answer your question.');
        }

        // Enrich with MongoDB metadata if available
        let enrichedDocs = relevantDocs;
        if (await isDbSystemEnabled()) {
            logger.info('Enriching documents with MongoDB metadata', 'main');
            try {
                await connectToMongoDB();
                const endpoints = relevantDocs.map(doc => doc.metadata.endpoint);
                const mongoMetadata = await Metadata.find({ endpoint: { $in: endpoints } });
                
                // Create a map for quick lookup
                const metadataMap = new Map(mongoMetadata.map(m => [m.endpoint, m.toJSON()]));
                
                // Enrich each doc with its MongoDB metadata
                enrichedDocs = relevantDocs.map(doc => {
                    const metadata = metadataMap.get(doc.metadata.endpoint);
                    return {
                        ...doc.metadata,
                        ...(metadata||{})
                    };
                });

                logger.info('Successfully enriched documents with MongoDB metadata', 'main', {
                    totalDocs: relevantDocs.length,
                    enrichedCount: mongoMetadata.length
                });
            } catch (err) {
                logger.error('Failed to enrich documents with MongoDB metadata', 'main', {
                    message: err.message,
                    stack: err.stack
                });
            }
        }

        //write relevant docs to json file as json array
        fs.writeFileSync('relevantDocs.json', JSON.stringify(enrichedDocs, null, 2));

        //console.log('Relevant docs written to relevantDocs.json');
        //process.exit(0)

        const context = enrichedDocs.map(doc => JSON.stringify(doc).split('\n').join('').trim().split(' ').join('')).join('\n\n');

        const response = await generateOpenAPILLMCompletion(query, context);
        
        if (response) {
            console.log('\nResponse:', response);
        } else {
            console.log('\nNo response generated');
        }
        process.exit(0)

    } catch (err) {
        logger.error('Failed to process chat interaction', 'main', {
            message: err.message,
            stack: err.stack
        });
        console.error('Error:', err.message);
        process.exit(1);
    }
}

// Execute if run directly
if (require.main === module) {
    main();
}

module.exports = { main };
