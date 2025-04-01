#!/usr/bin/env node
require('dotenv').config();
const { ChromaClient } = require('chromadb');
const { createModuleLogger } = require('../utils/logger');

const logger = createModuleLogger('localDbHealth');

async function main() {
    try {
        const baseUrl = process.env.CHROMA_BASE_URL || 'http://localhost:8123';
        const collectionName = 'openapi_specs';

        logger.info('Connecting to ChromaDB', 'main', { baseUrl });
        const client = new ChromaClient({ path: baseUrl });

        // List collections
        const collections = await client.listCollections();
        logger.info('Found collections', 'main', { 
            count: collections.length,
            names: collections.map(c => c.name)
        });

        // Get our collection
        const collection = await client.getCollection({ name: collectionName });
        logger.info('Got collection details', 'main', {
            name: collection.name,
            metadata: collection.metadata
        });

        // Get collection stats
        const count = await collection.count();
        logger.info('Collection stats', 'main', { count });

        // Get some sample items
        if (count > 0) {
            const results = await collection.peek({ limit: 5 });
            console.log('\nSample documents:');
            results.metadatas.forEach((metadata, i) => {
                console.log('\nDocument', i + 1);
                console.log('ID:', results.ids[i]);
                console.log('Metadata:', JSON.stringify(metadata, null, 2));
                console.log('Content:', results.documents[i]);
            });
        }

    } catch (err) {
        logger.error('Failed to check database health', 'main', {
            message: err.message,
            stack: err.stack
        });
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
