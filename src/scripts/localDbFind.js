#!/usr/bin/env node
require('dotenv').config();
const { initVectorDb } = require('../services/vectorDbService');
const { createModuleLogger } = require('../utils/logger');

const logger = createModuleLogger('localDbFind');

async function searchByMetadata(searchTerm) {
    try {
        logger.info('Starting metadata search', 'searchByMetadata', { searchTerm });

        // Initialize ChromaDB
        const vectorStore = await initVectorDb();
        
        // Get all documents
        const results = await vectorStore.collection.get();

        // Filter documents by searching in metadata fields
        const matches = results.metadatas.map((metadata, index) => {
            // Convert all metadata values to strings for searching
            const metadataString = JSON.stringify(metadata).toLowerCase();
            
            // Check if search term exists in any metadata field
            if (metadataString.includes(searchTerm.toLowerCase())) {
                return {
                    id: results.ids[index],
                    metadata,
                    text: metadata.text || ''
                };
            }
            return null;
        }).filter(Boolean); // Remove null entries

        // Log and display results
        logger.info('Search complete', 'searchByMetadata', {
            totalMatches: matches.length
        });

        if (matches.length === 0) {
            console.log('No matches found.');
            return;
        }

        console.log(`Found ${matches.length} matches:\n`);
        matches.forEach((match, index) => {
            console.log(`Match ${index + 1}:`);
            console.log('ID:', match.id);
            console.log('Method:', match.metadata.method);
            console.log('Endpoint:', match.metadata.endpoint);
            console.log('Description:', match.metadata.description);
            console.log('Text:', match.text);
            console.log('---\n');
        });

    } catch (err) {
        logger.error('Failed to search metadata', 'searchByMetadata', {
            message: err.message,
            stack: err.stack
        });
        throw err;
    }
}

async function main() {
    try {
        const searchTerm = process.argv[2];
        if (!searchTerm) {
            console.error('Please provide a search term as an argument');
            process.exit(1);
        }

        await searchByMetadata(searchTerm);

    } catch (error) {
        logger.error('Script failed', 'main', {
            message: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}

// Execute if run directly
if (require.main === module) {
    main();
}
