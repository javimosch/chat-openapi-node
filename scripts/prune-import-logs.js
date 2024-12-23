require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { Pinecone } = require('@pinecone-database/pinecone');
const { createModuleLogger } = require('../utils/logger');

const logger = createModuleLogger('prune-import-logs');

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
                    // Get the base filename without extension
                    const baseFileName = path.parse(match.metadata.fileName).name;
                    files.add(baseFileName);
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

async function getImportLogs() {
    try {
        const importsDir = path.join(__dirname, '..', 'imports');
        const files = await fs.readdir(importsDir);
        
        // Group files by their base name (without timestamp and extension)
        const fileGroups = new Map();
        
        files.filter(file => !file.startsWith('.')).forEach(file => {
            // Extract the original filename from the import log filename
            // Format: YYYY-MM-DDTHH-mm_originalfilename.json
            const match = file.match(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}_(.+)\.json$/);
            if (match) {
                const baseFileName = match[1];
                if (!fileGroups.has(baseFileName)) {
                    fileGroups.set(baseFileName, []);
                }
                fileGroups.get(baseFileName).push(file);
            }
        });
        
        return fileGroups;
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.info('Imports directory does not exist', 'getImportLogs');
            return new Map();
        }
        logger.error('Failed to read imports directory', 'getImportLogs', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

async function removeOrphanedLogs(importLogs, vectorFiles) {
    const importsDir = path.join(__dirname, '..', 'imports');
    let removedCount = 0;
    let errorCount = 0;
    let keptCount = 0;

    for (const [baseFileName, logFiles] of importLogs) {
        try {
            if (!vectorFiles.has(baseFileName)) {
                // Remove all log files for this base filename
                for (const logFile of logFiles) {
                    await fs.unlink(path.join(importsDir, logFile));
                    logger.info('Removed orphaned log file', 'removeOrphanedLogs', { 
                        baseFileName,
                        logFile 
                    });
                    removedCount++;
                }
            } else {
                // Keep only the most recent log file if there are multiple
                logFiles.sort().reverse(); // Sort in descending order
                for (let i = 1; i < logFiles.length; i++) {
                    await fs.unlink(path.join(importsDir, logFiles[i]));
                    logger.info('Removed older log file', 'removeOrphanedLogs', { 
                        baseFileName,
                        logFile: logFiles[i] 
                    });
                    removedCount++;
                }
                keptCount += logFiles.length > 0 ? 1 : 0;
            }
        } catch (error) {
            logger.error('Failed to remove log file', 'removeOrphanedLogs', {
                baseFileName,
                error: error.message
            });
            errorCount++;
        }
    }

    return { removedCount, errorCount, keptCount };
}

async function main() {
    try {
        logger.info('Starting cleanup of orphaned import logs', 'main');

        // Get files from both sources
        const [importLogs, vectorFiles] = await Promise.all([
            getImportLogs(),
            getVectorFiles()
        ]);

        logger.info('Files found', 'main', {
            importLogGroups: importLogs.size,
            vectorFiles: vectorFiles.size
        });

        // Remove orphaned logs
        const { removedCount, errorCount, keptCount } = await removeOrphanedLogs(importLogs, vectorFiles);

        logger.info('Cleanup completed', 'main', {
            totalLogGroups: importLogs.size,
            totalVectorFiles: vectorFiles.size,
            removed: removedCount,
            kept: keptCount,
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

module.exports = { getVectorFiles, getImportLogs, removeOrphanedLogs };
