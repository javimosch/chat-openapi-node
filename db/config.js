const logger = require('../utils/logger');

function isDbSystemEnabled() {
    // Only consider MongoDB enabled if we're actually using it for embeddings
    return shouldUseMongoForEmbeddings() && 
           process.env.MONGO_URI && 
           typeof process.env.MONGO_URI === 'string' &&
           process.env.DB_NAME && 
           typeof process.env.DB_NAME === 'string';
}

function shouldUseMongoForEmbeddings() {
    return process.env.USE_MONGODB_FOR_EMBEDDINGS === 'true' || 
           process.env.USE_MONGODB_FOR_EMBEDDINGS === '1';
}

module.exports = {
    isDbSystemEnabled,
    shouldUseMongoForEmbeddings
};
