const { Pinecone } = require('@pinecone-database/pinecone');
const { createModuleLogger } = require('./logger');
const logger = createModuleLogger('pinecone');

const CacheManager = require('./cache');

const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
});

const wrapPineconeIndex = (index) => {

    index = index || pinecone.index(process.env.PINECONE_INDEX)

    const cacheManager = new CacheManager('pinecone');

    return {
        ...index,
        /**
         * Wrapped query method with logging and caching
         * @param {...*} args - Arguments passed to the query method
         * @returns {Promise<Object>} Query results from Pinecone
         */
        query: async (...args) => {
            const cacheKey = cacheManager.generateCacheKey(args);
            
            // Try to get from cache
            const cachedResult = await cacheManager.get(cacheKey);
            if (cachedResult) {
                logger.info('Retrieving from cache', 'pineconeQuery', {
                    vectorCount: args.length,
                    fromCache: true
                });
                return cachedResult;
            }

            logger.info('Calling Pinecone API: query', 'pineconeQuery', {
                args: args.map(arg => ({
                    ...arg,
                    vector: arg.vector ? `[${arg.vector.length} dimensions]` : undefined
                }))
            });

            const results = await index.query(...args);

            // Only cache if results are not empty
            if (!(results.matches && results.matches.length === 0 && 
                results.namespace === "" && 
                results.usage && results.usage.readUnits === 5)) {
                await cacheManager.set(cacheKey, results);
            }

            return results;
        },
        /**
         * Wrapped upsert method with logging
         * @param {...*} args - Arguments passed to the upsert method
         * @returns {Promise<Object>} Upsert results from Pinecone
         */
        upsert: async (...args) => {
            logger.info('Calling Pinecone API: upsert', 'pineconeUpsert', {
                vectorCount: args[0]?.vectors?.length || 0,
                namespace: args[0]?.namespace
            });
            return await index.upsert(...args);
        }
    };
};

module.exports = {wrapPineconeIndex};