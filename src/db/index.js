const mongoose = require('mongoose');
const { SpecFile, EmbeddingChunk } = require('./models');
const { isDbSystemEnabled } = require('./config');
const { createModuleLogger } = require('../utils/logger');

const logger = createModuleLogger('mongodb');
let isConnected = false;

// MongoDB connection options
const mongoOptions = {
    dbName: process.env.DB_NAME,
    connectTimeoutMS: 10000, // 10 seconds
    socketTimeoutMS: 45000,  // 45 seconds
    serverSelectionTimeoutMS: 10000, // 10 seconds
    heartbeatFrequencyMS: 1000,     // 1 second
    retryWrites: true,
    retryReads: true,
    maxPoolSize: 10,
    minPoolSize: 1,
    maxIdleTimeMS: 60000,  // 1 minute
};

// MongoDB connection with retry
async function connectWithRetry(retries = 3, delay = 2000) {
    if (!isDbSystemEnabled()) {
        logger.info('MongoDB not configured, skipping connection');
        return;
    }

    if (isConnected) {
        logger.debug('Using existing MongoDB connection', 'connectWithRetry');
        return;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            logger.info('Connecting to MongoDB...', 'connectWithRetry', {
                attempt,
                total: retries,
                uri: process.env.MONGO_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') // Hide credentials in logs
            });

            await mongoose.connect(process.env.MONGO_URI, mongoOptions);
            isConnected = true;
            
            logger.info('Successfully connected to MongoDB', 'connectWithRetry', {
                database: process.env.DB_NAME,
                attempt
            });
            return;
        } catch (error) {
            const errorInfo = {
                attempt,
                total: retries,
                error: error.message,
                code: error.code,
                name: error.name
            };

            logger.error('MongoDB connection failed', 'connectWithRetry', errorInfo);

            if (attempt === retries) {
                logger.error('Maximum connection attempts reached', 'connectWithRetry', {
                    attempts: retries,
                    lastError: error.message
                });
                throw new Error(`Failed to connect after ${retries} attempts: ${error.message}`);
            }

            logger.info(`Retrying connection in ${delay}ms...`, 'connectWithRetry', {
                nextAttempt: attempt + 1,
                total: retries
            });

            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// MongoDB connection
async function connectDB() {
    try {
        logger.info('Initializing MongoDB connection', 'connectDB');
        await connectWithRetry();
    } catch (error) {
        isConnected = false;
        logger.error('MongoDB connection initialization failed', 'connectDB', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// File operations
async function createSpecFile(fileName, specId, content) {
    const file = new SpecFile({
        fileName,
        specId,
        content
    });
    return await file.save();
}

async function updateSpecFileStatus(specId, status, error = null) {
    return await SpecFile.findOneAndUpdate(
        { specId },
        { 
            status,
            error,
            updatedAt: new Date(),
            ...(error && { error })
        },
        { new: true }
    );
}

async function updateChunkProgress(specId, totalChunks, processedChunks) {
    return await SpecFile.findOneAndUpdate(
        { specId },
        { 
            totalChunks,
            processedChunks,
            updatedAt: new Date()
        },
        { new: true }
    );
}

async function getSpecFileStatus(specId) {
    return await SpecFile.findOne({ specId });
}

async function getAllSpecFiles() {
    return await SpecFile.find({}, {
        fileName: 1,
        specId: 1,
        status: 1,
        totalChunks: 1,
        processedChunks: 1,
        createdAt: 1
    }).sort({ createdAt: -1 });
}

// Embedding operations
async function saveEmbedding(specId, chunkType, content, embedding, metadata = {}) {
    const chunk = new EmbeddingChunk({
        specId,
        chunkType,
        content,
        embedding,
        metadata
    });
    return await chunk.save();
}

async function findSimilarChunks(embedding, limit = 5) {
    // Using dot product similarity
    const chunks = await EmbeddingChunk.aggregate([
        {
            $addFields: {
                similarity: {
                    $reduce: {
                        input: { $zip: { inputs: ['$embedding', embedding] } },
                        initialValue: 0,
                        in: { $add: ['$$value', { $multiply: ['$$this.0', '$$this.1'] }] }
                    }
                }
            }
        },
        { $sort: { similarity: -1 } },
        { $limit: limit }
    ]);

    return chunks.map(chunk => ({
        text: chunk.content,
        metadata: {
            ...chunk.metadata,
            chunk_type: chunk.chunkType,
            similarity: chunk.similarity
        }
    }));
}

async function deleteSpecFileAndEmbeddings(specId) {
    await Promise.all([
        SpecFile.deleteOne({ specId }),
        EmbeddingChunk.deleteMany({ specId })
    ]);
}

module.exports = {
    connectDB,
    createSpecFile,
    updateSpecFileStatus,
    updateChunkProgress,
    getSpecFileStatus,
    getAllSpecFiles,
    saveEmbedding,
    findSimilarChunks,
    deleteSpecFileAndEmbeddings
};
