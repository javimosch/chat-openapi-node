require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { Pinecone } = require('@pinecone-database/pinecone');
const { createModuleLogger } = require('../utils/logger');

const logger = createModuleLogger('print-files');

// Initialize Pinecone client
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
});

async function getVectorFileMetadata() {
    try {
        const index = pinecone.index(process.env.PINECONE_INDEX);
        
        // Query for metadata records
        const queryResponse = await index.query({
            vector: Array(1536).fill(0.000001), // Non-zero vector to match all
            topK: 10000,
            filter: { is_metadata: true },
            includeMetadata: true
        });

        // Count actual chunks (non-metadata vectors)
        const statsResponse = await index.query({
            vector: Array(1536).fill(0.000001),
            topK: 10000,
            filter: { is_metadata: { $ne: true } }, // Exclude metadata vectors
            includeMetadata: true
        });

        // Extract file metadata and count chunks per file
        const files = new Map();
        if (queryResponse.matches) {
            queryResponse.matches.forEach(match => {
                if (match.metadata && match.metadata.fileName) {
                    const fileChunks = statsResponse.matches.filter(
                        chunk => chunk.metadata.computed_filename === match.metadata.fileName
                    ).length;

                    files.set(match.metadata.fileName, {
                        specId: match.metadata.spec_id,
                        timestamp: match.metadata.timestamp,
                        totalChunks: fileChunks, // Use actual chunk count
                        vectorId: match.id
                    });
                }
            });
        }

        return files;
    } catch (error) {
        logger.error('Failed to query Pinecone', 'getVectorFileMetadata', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

async function checkFileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

async function getFileStats(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return {
            exists: true,
            size: formatBytes(stats.size),
            modified: stats.mtime.toISOString()
        };
    } catch {
        return {
            exists: false,
            size: 'N/A',
            modified: 'N/A'
        };
    }
}

async function main() {
    try {
        logger.info('Fetching file information from Pinecone', 'main');

        // Get vector metadata
        const vectorFiles = await getVectorFileMetadata();
        const uploadsDir = path.join(__dirname, '..', 'uploads');

        console.log('\nFile Status Report:');
        console.log('==================\n');

        // Sort files by timestamp (most recent first)
        const sortedFiles = Array.from(vectorFiles.entries())
            .sort((a, b) => (b[1].timestamp || '').localeCompare(a[1].timestamp || ''));

        // Track statistics
        let totalFiles = 0;
        let existingFiles = 0;
        let missingFiles = 0;
        let totalChunks = 0;

        // Print file information
        for (const [fileName, metadata] of sortedFiles) {
            totalFiles++;
            totalChunks += metadata.totalChunks;

            const filePath = path.join(uploadsDir, fileName);
            const stats = await getFileStats(filePath);

            if (stats.exists) {
                existingFiles++;
                console.log('[✓]', fileName);
            } else {
                missingFiles++;
                console.log('[✗]', fileName);
            }

            console.log(`   Spec ID:     ${metadata.specId}`);
            console.log(`   Vector ID:   ${metadata.vectorId}`);
            console.log(`   Chunks:      ${metadata.totalChunks}`);
            console.log(`   Timestamp:   ${metadata.timestamp || 'N/A'}`);
            console.log(`   File Size:   ${stats.size}`);
            console.log(`   Last Modified: ${stats.modified}`);
            console.log(`   Status:      ${stats.exists ? 'File exists' : 'File missing'}`);
            console.log('');
        }

        // Print summary
        console.log('Summary:');
        console.log('========');
        console.log(`Total Files:     ${totalFiles}`);
        console.log(`Existing Files:  ${existingFiles}`);
        console.log(`Missing Files:   ${missingFiles}`);
        console.log(`Total Chunks:    ${totalChunks}`);
        console.log('');

    } catch (error) {
        logger.error('Failed to complete file check', 'main', {
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

module.exports = { getVectorFileMetadata, getFileStats };
