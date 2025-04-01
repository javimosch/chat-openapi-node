#!/usr/bin/env node

require('dotenv').config();

//utils/logger.js
//_DEPS_
const { createModuleLogger } = require('../utils/logger');

//services/vectorDbService.js
//_DEPS_
const { initVectorDb, querySimilarChunks } = require('../services/vectorDbService');

//utils/fileSystem.js
//_DEPS_
const fs = require('fs');


//services/chatService.js
//_DEPS_
const { generateOpenAPILLMCompletion } = require('../services/chatService');

const { enrichDocsWithMetadata } = require('../services/documentService');


//utils/logger.js
//_CODE_
const logger = createModuleLogger('localChat');

//this-file:
//_CODE_
async function main() {
    try {
        const query = process.argv[2];
        if (!query) {
            console.error('Please provide a query as an argument');
            process.exit(1);
        }

        logger.info('Starting chat interaction', 'main', { query });

        // Initialize vector store and get relevant chunks
        await initVectorDb();
        const relevantDocs = await querySimilarChunks(query);
        
        if (!relevantDocs?.length) {
            logger.warn('No relevant API documentation found', 'main');
            return console.log('I could not find any relevant API documentation to help answer your question.');
        }

        // Enrich with MongoDB metadata if available
        const enrichedDocs = await enrichDocsWithMetadata(relevantDocs);

        // Save docs for debugging
        fs.writeFileSync('relevantDocs.json', JSON.stringify(enrichedDocs, null, 2));

        // Format context and generate completion
        
        const response = await generateOpenAPILLMCompletion(query, enrichedDocs);
        
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
