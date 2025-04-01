require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { Pinecone } = require('@pinecone-database/pinecone');
const { createModuleLogger } = require('../utils/logger');

const logger = createModuleLogger('prune-uploads');

// Initialize Pinecone client
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
});

async function getVectorFiles() {
    try {
        const index = pinecone.index(process.env.PINECONE_INDEX);
        
        // Query for metadata records
        const queryResponse = await index.query({
            vector: Array(1536).fill(0), // Zero vector to match all
            topK: 10000,
            filter: { is_metadata: true },
            includeMetadata: true
        });

        // Extract unique filenames
        const files = new Set();
        if (queryResponse.matches) {
            queryResponse.matches.forEach(match => {
                if (match.metadata && match.metadata.fileName) {
                    files.add(match.metadata.fileName);
                }
            });
        }

        return files;
    } catch (error) {
        logger.error('Failed to query Pinecone', 'getVectorFiles', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

async function getUploadedFiles() {
    try {
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        const files = await fs.readdir(uploadsDir);
        return files.filter(file => !file.startsWith('.')); // Exclude hidden files
    } catch (error) {
        logger.error('Failed to read uploads directory', 'getUploadedFiles', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

async function removeOrphanedFiles(uploadedFiles, vectorFiles) {
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    let removedCount = 0;
    let errorCount = 0;

    for (const file of uploadedFiles) {
        if (!vectorFiles.has(file)) {
            try {
                await fs.unlink(path.join(uploadsDir, file));
                logger.info('Removed orphaned file', 'removeOrphanedFiles', { file });
                removedCount++;
            } catch (error) {
                logger.error('Failed to remove file', 'removeOrphanedFiles', {
                    file,
                    error: error.message
                });
                errorCount++;
            }
        }
    }

    return { removedCount, errorCount };
}

async function main() {
    try {
        logger.info('Starting cleanup of orphaned upload files', 'main');

        // Get files from both sources
        const [uploadedFiles, vectorFiles] = await Promise.all([
            getUploadedFiles(),
            getVectorFiles()
        ]);

        logger.info('Files found', 'main', {
            uploadedCount: uploadedFiles.length,
            vectorCount: vectorFiles.size
        });

        // Remove orphaned files
        const { removedCount, errorCount } = await removeOrphanedFiles(uploadedFiles, vectorFiles);

        logger.info('Cleanup completed', 'main', {
            totalUploaded: uploadedFiles.length,
            totalVectors: vectorFiles.size,
            removed: removedCount,
            errors: errorCount
        });

    } catch (error) {
        logger.error('Failed to complete cleanup', 'main', {
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

module.exports = { getVectorFiles, getUploadedFiles, removeOrphanedFiles };
