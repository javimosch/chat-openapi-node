const mongoose = require('mongoose');
const { createModuleLogger } = require('../utils/logger');
const Todo = require('../models/todo');

const logger = createModuleLogger('db-config');

async function testMongoConnection() {
    try {
        // List all collections
        const collections = await mongoose.connection.db.listCollections().toArray();
        logger.info('Available collections', 'testMongoConnection', {
            collections: collections.map(c => c.name)
        });

        return true;
    } catch (error) {
        logger.error('Failed to test MongoDB connection', 'testMongoConnection', {
            error: error.message,
            stack: error.stack
        });
        return false;
    }
}

async function connectToMongoDB() {
    try {
        // Log environment variables (without sensitive info)
        logger.info('MongoDB configuration', 'connectToMongoDB', {
            dbName: process.env.DB_NAME,
            hasMongoUri: !!process.env.MONGO_URI,
            hasUsername: !!process.env.MONGO_USER,
            hasPassword: !!process.env.MONGO_PASSWORD
        });

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI, {
            dbName: process.env.DB_NAME,
            useNewUrlParser: true,
            useUnifiedTopology: true
        });

        logger.info('Connected to MongoDB', 'connectToMongoDB');

        // Test the connection
        const isConnected = await testMongoConnection();
        if (!isConnected) {
            throw new Error('MongoDB connection test failed');
        }

        return mongoose;
    } catch (error) {
        logger.error('Failed to connect to MongoDB', 'connectToMongoDB', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

function isDbSystemEnabled() {
    const enabled = process.env.MONGO_URI && 
           typeof process.env.MONGO_URI === 'string' &&
           process.env.DB_NAME && 
           typeof process.env.DB_NAME === 'string';
    
    logger.info('Checking DB system status', 'isDbSystemEnabled', {
        enabled,
        hasMongoUri: !!process.env.MONGO_URI,
        hasDbName: !!process.env.DB_NAME
    });
    
    return enabled;
}

module.exports = {
    connectToMongoDB,
    isDbSystemEnabled,
    mongoose,
    db: mongoose.connection
};
