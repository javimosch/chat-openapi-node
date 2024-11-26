function isDbSystemEnabled() {
    // Only consider MongoDB enabled if we're actually using it for embeddings
    return process.env.MONGO_URI && 
           typeof process.env.MONGO_URI === 'string' &&
           process.env.DB_NAME && 
           typeof process.env.DB_NAME === 'string';
}


module.exports = {
    isDbSystemEnabled
};
