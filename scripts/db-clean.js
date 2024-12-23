require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');
const { createModuleLogger } = require('../utils/logger');
const readline = require('readline');

const logger = createModuleLogger('db-clean');

// Initialize Pinecone client
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
});

function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.toLowerCase());
        });
    });
}

async function deleteAllVectors() {
    try {
        const index = pinecone.index(process.env.PINECONE_INDEX);
        
        // Get current stats
        const beforeStats = await index.describeIndexStats();
        const totalVectors = beforeStats.totalVectorCount;
        
        logger.info('Current index stats', 'deleteAllVectors', {
            totalVectors,
            namespaces: Object.keys(beforeStats.namespaces || {})
        });

        if (totalVectors === 0) {
            logger.info('Database is already empty', 'deleteAllVectors');
            return;
        }

        // Confirm deletion
        console.log('\nWARNING: This will delete all vectors from your Pinecone index.');
        console.log(`Total vectors to delete: ${totalVectors}`);
        console.log('This action cannot be undone!\n');

        const answer = await prompt('Are you sure you want to proceed? (yes/no): ');
        
        if (answer !== 'yes') {
            console.log('Operation cancelled.');
            return;
        }

        // Delete all vectors
        logger.info('Starting vector deletion', 'deleteAllVectors');
        await index.deleteAll();

        // Verify deletion
        const afterStats = await index.describeIndexStats();
        
        logger.info('Deletion completed', 'deleteAllVectors', {
            beforeCount: totalVectors,
            afterCount: afterStats.totalVectorCount
        });

        console.log(`\nSuccessfully deleted ${totalVectors} vectors.`);
        console.log('Database is now empty.');

    } catch (error) {
        logger.error('Failed to delete vectors', 'deleteAllVectors', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

async function main() {
    try {
        // Additional safety check: require confirmation in .env
        if (process.env.ALLOW_DB_CLEAN !== '1') {
            console.error('\nError: Database cleaning is not enabled.');
            console.error('To enable, add ALLOW_DB_CLEAN=1 to your .env file.');
            console.error('This is a safety measure to prevent accidental database cleaning.');
            process.exit(1);
        }

        await deleteAllVectors();
    } catch (error) {
        logger.error('Failed to complete database cleaning', 'main', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { deleteAllVectors };
