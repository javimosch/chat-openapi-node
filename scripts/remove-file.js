require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');
const { createModuleLogger } = require('../utils/logger');
const { isDbSystemEnabled, db, mongoose } = require('../db/config');
const Metadata = require('../models/metadata');
const path = require('path');
const fs = require('fs').promises;

const logger = createModuleLogger('remove-file');

// Initialize Pinecone client
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
});

async function findFileMetadata(specId, fileName) {
    try {
        const index = pinecone.index(process.env.PINECONE_INDEX);
        let mongoMetadata = null;
        
        // Query for metadata records in Pinecone
        const queryResponse = await index.query({
            vector: Array(1536).fill(0.000001),
            topK: 10000,
            filter: { is_metadata: true },
            includeMetadata: true
        });

        if (!queryResponse.matches) {
            return { pineconeMetadata: null, mongoMetadata: null };
        }

        // Find the matching metadata record in Pinecone
        const pineconeMatch = queryResponse.matches.find(m => {
            if (specId) {
                return m.metadata.spec_id === specId;
            }
            return m.metadata.fileName === fileName || 
                   m.metadata.computed_filename === fileName ||
                   m.metadata.original_filename === fileName;
        });

        // If MongoDB is enabled, find metadata there too
        if (isDbSystemEnabled() && pineconeMatch) {
            try {
                await db();
                mongoMetadata = await Metadata.findOne({
                    $or: [
                        { spec_id: pineconeMatch.metadata.spec_id },
                        { file_name: pineconeMatch.metadata.fileName }
                    ]
                });
            } catch (error) {
                logger.error('Failed to query MongoDB', 'findFileMetadata', {
                    error: error.message,
                    stack: error.stack
                });
            }
        }

        return { pineconeMetadata: pineconeMatch, mongoMetadata };
    } catch (error) {
        logger.error('Failed to query Pinecone', 'findFileMetadata', {
            error: error.message,
            stack: error.stack,
            specId,
            fileName
        });
        throw error;
    }
}

async function deleteMongoMetadata(mongoMetadata) {
    if (!mongoMetadata) {
        return false;
    }

    try {
        await db();
        await Metadata.deleteOne({ _id: mongoMetadata._id });
        logger.info('Deleted MongoDB metadata', 'deleteMongoMetadata', {
            id: mongoMetadata._id,
            fileName: mongoMetadata.file_name
        });
        return true;
    } catch (error) {
        logger.error('Failed to delete MongoDB metadata', 'deleteMongoMetadata', {
            error: error.message,
            stack: error.stack,
            id: mongoMetadata._id
        });
        return false;
    }
}

async function deleteFileVectors(fileMetadata) {
    try {
        const index = pinecone.index(process.env.PINECONE_INDEX);
        
        // Get all vectors for this file
        const chunksResponse = await index.query({
            vector: Array(1536).fill(0.000001),
            topK: 10000,
            filter: {
                $or: [
                    // Match metadata vector
                    { spec_id: fileMetadata.metadata.spec_id, is_metadata: true },
                    // Match content vectors
                    { 
                        $and: [
                            { computed_filename: fileMetadata.metadata.fileName },
                            { is_metadata: { $ne: true } }
                        ]
                    }
                ]
            },
            includeMetadata: true
        });

        if (!chunksResponse.matches?.length) {
            logger.warn('No vectors found for file', 'deleteFileVectors', {
                fileName: fileMetadata.metadata.fileName,
                specId: fileMetadata.metadata.spec_id
            });
            return 0;
        }

        // Get vector IDs to delete
        const vectorIds = chunksResponse.matches.map(m => m.id);
        
        // Delete vectors
        await index.deleteMany(vectorIds);

        logger.info('Deleted vectors', 'deleteFileVectors', {
            fileName: fileMetadata.metadata.fileName,
            specId: fileMetadata.metadata.spec_id,
            deletedCount: vectorIds.length
        });

        return vectorIds.length;
    } catch (error) {
        logger.error('Failed to delete vectors', 'deleteFileVectors', {
            error: error.message,
            stack: error.stack,
            fileName: fileMetadata.metadata.fileName,
            specId: fileMetadata.metadata.spec_id
        });
        throw error;
    }
}

async function main() {
    try {
        // Parse command line arguments
        const args = process.argv.slice(2);
        let specId = null;
        let fileName = null;

        args.forEach(arg => {
            if (arg.startsWith('--specId=')) {
                specId = arg.split('=')[1];
            } else if (arg.startsWith('--name=')) {
                fileName = arg.split('=')[1];
            }
        });

        if (!specId && !fileName) {
            console.error('Error: Either --specId or --name must be provided');
            console.log('\nUsage:');
            console.log('  npm run file:remove -- --specId=<spec-id>');
            console.log('  npm run file:remove -- --name=<file-name>');
            process.exit(1);
        }

        // Find file metadata
        const { pineconeMetadata, mongoMetadata } = await findFileMetadata(specId, fileName);
        if (!pineconeMetadata && !mongoMetadata) {
            console.error('Error: File not found in database');
            process.exit(1);
        }

        // Print file info
        console.log('\nFile to remove:');
        console.log('==============');
        if (pineconeMetadata) {
            console.log(`File Name:     ${pineconeMetadata.metadata.fileName}`);
            console.log(`Spec ID:       ${pineconeMetadata.metadata.spec_id}`);
            console.log(`Vector ID:     ${pineconeMetadata.id}`);
            console.log(`Timestamp:     ${pineconeMetadata.metadata.timestamp}`);
        }
        if (mongoMetadata) {
            console.log(`MongoDB ID:    ${mongoMetadata._id}`);
            console.log(`MongoDB File:  ${mongoMetadata.file_name}`);
        }

        // Confirm deletion
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });

        await new Promise((resolve) => {
            readline.question('\nAre you sure you want to remove this file from the databases? (yes/no): ', async (answer) => {
                readline.close();
                if (answer.toLowerCase() !== 'yes') {
                    console.log('Operation cancelled');
                    process.exit(0);
                }
                resolve();
            });
        });

        // Delete vectors and metadata
        let results = {
            vectorsDeleted: 0,
            mongoDeleted: false
        };

        if (pineconeMetadata) {
            results.vectorsDeleted = await deleteFileVectors(pineconeMetadata);
        }
        
        if (mongoMetadata) {
            results.mongoDeleted = await deleteMongoMetadata(mongoMetadata);
        }

        console.log('\nOperation completed successfully:');
        if (results.vectorsDeleted > 0) {
            console.log(`- Removed ${results.vectorsDeleted} vectors from Pinecone`);
        }
        if (results.mongoDeleted) {
            console.log(`- Removed metadata from MongoDB`);
        }
        console.log(`- File remains in uploads directory`);

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    } finally {
        // Close MongoDB connection if it was opened
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.close();
        }
    }
}

// Run the script
if (require.main === module) {
    main();
}
