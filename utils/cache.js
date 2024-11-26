const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger').createModuleLogger('cache');

const CACHE_DIR = path.join(process.cwd(), 'cache');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

class CacheManager {
    constructor(namespace) {
        this.namespace = namespace;
        this.init();
    }

    async init() {
        try {
            await fs.mkdir(CACHE_DIR, { recursive: true });
        } catch (error) {
            logger.error('Failed to create cache directory', 'cacheDir', { error });
        }
    }

    generateCacheKey(data) {
        const hash = crypto.createHash('md5');
        hash.update(this.namespace + JSON.stringify(data));
        return hash.digest('hex');
    }

    async get(key) {
        const cachePath = path.join(CACHE_DIR, `${key}.json`);
        try {
            const cacheStats = await fs.stat(cachePath);
            if (Date.now() - cacheStats.mtimeMs < CACHE_TTL) {
                const cachedData = JSON.parse(await fs.readFile(cachePath, 'utf8'));
                logger.info('Retrieved results from cache', `${this.namespace}Cache`, { key });
                return cachedData;
            }
        } catch (error) {
            // Cache miss or error reading cache
            return null;
        }
        return null;
    }

    async set(key, data) {
        const cachePath = path.join(CACHE_DIR, `${key}.json`);
        try {
            await fs.writeFile(cachePath, JSON.stringify(data));
            logger.info('Cached results', `${this.namespace}Cache`, { key });
        } catch (error) {
            logger.error('Failed to cache results', `${this.namespace}Cache`, { error });
        }
    }
}

module.exports = CacheManager;