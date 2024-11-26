const { ChromaClient } = require('chromadb');
const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('chromaUtils');

class ChromaVectorStore {
    constructor() {
        this.client = null;
        this.collection = null;
        this.baseUrl = process.env.CHROMA_BASE_URL || 'http://chroma:8000';
        this.collectionName = 'openapi_specs';
        this.dimensions = 768; // Match nomic-embed-text dimensions

        logger.info('Initializing ChromaDB configuration', 'constructor', {
            baseUrl: this.baseUrl,
            dimensions: this.dimensions
        });
    }

    async initialize() {
        try {
            logger.info('Initializing ChromaDB client', 'initialize', {
                baseUrl: this.baseUrl
            });

            this.client = new ChromaClient({
                path: this.baseUrl
            });

            // Get or create collection with specified dimensions
            this.collection = await this.client.getOrCreateCollection({
                name: this.collectionName,
                metadata: { 
                    "description": "OpenAPI specifications and their embeddings",
                    "timestamp": new Date().toISOString()
                },
                dimensions: this.dimensions // Ensure the collection has the correct dimensions
            });

            logger.info('Successfully initialized ChromaDB', 'initialize', {
                collection: this.collectionName
            });

            return this;
        } catch (error) {
            logger.error('Failed to initialize ChromaDB', 'initialize', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async addVectors(vectors) {
        try {
            logger.info('Adding vectors to ChromaDB', 'addVectors', {
                vectorCount: vectors.length
            });

            const documents = vectors.map(v => v.metadata.text || '');
            const metadatas = vectors.map(v => ({
                ...v.metadata,
                timestamp: new Date().toISOString()
            }));
            const ids = vectors.map(v => v.id);
            const embeddings = vectors.map(v => {
                if (v.values.length !== this.dimensions) {
                    logger.warn('Vector dimensions mismatch', 'addVectors', {
                        expected: this.dimensions,
                        actual: v.values.length,
                        id: v.id
                    });
                    // Pad or truncate to match required dimensions
                    const adjusted = [...v.values];
                    while (adjusted.length < this.dimensions) {
                        adjusted.push(0);
                    }
                    if (adjusted.length > this.dimensions) {
                        adjusted.length = this.dimensions;
                    }
                    return adjusted;
                }
                return v.values;
            });

            await this.collection.add({
                ids,
                embeddings,
                metadatas,
                documents
            });

            logger.debug('Successfully added vectors', 'addVectors', {
                vectorCount: vectors.length,
                sampleId: ids[0]
            });

            return true;
        } catch (error) {
            logger.error('Failed to add vectors', 'addVectors', {
                error: error.message,
                stack: error.stack,
                vectorCount: vectors.length
            });
            throw error;
        }
    }

    async queryVectors(queryEmbedding, options = {}) {
        try {
            const { topK = 10, filter = {} } = options;

            logger.info('Querying vectors from ChromaDB', 'queryVectors', {
                topK,
                filter
            });

            // Ensure queryEmbedding is properly formatted and has correct dimensions
            let queryEmbeddingArray;
            if (Array.isArray(queryEmbedding[0])) {
                // If it's already an array of arrays, use the first one
                queryEmbeddingArray = queryEmbedding[0];
            } else {
                // If it's a single array, use it
                queryEmbeddingArray = queryEmbedding;
            }

            // Validate embedding dimensions
            if (queryEmbeddingArray.length !== this.dimensions) {
                logger.warn('Query embedding dimensions mismatch', 'queryVectors', {
                    expected: this.dimensions,
                    actual: queryEmbeddingArray.length
                });
                // Pad or truncate to match required dimensions
                const adjusted = [...queryEmbeddingArray];
                while (adjusted.length < this.dimensions) {
                    adjusted.push(0);
                }
                if (adjusted.length > this.dimensions) {
                    adjusted.length = this.dimensions;
                }
                queryEmbeddingArray = adjusted;
            }

            const results = await this.collection.query({
                queryEmbeddings: [queryEmbeddingArray],
                nResults: topK,
                where: filter,
                include: ["metadatas", "documents", "distances"]
            });

            // Format results to match Pinecone response structure
            const matches = (results.ids?.[0] || []).map((id, index) => ({
                id,
                score: results.distances?.[0]?.[index] || 0,
                metadata: results.metadatas?.[0]?.[index] || {},
                text: results.documents?.[0]?.[index] || ''
            }));

            logger.debug('Successfully queried vectors', 'queryVectors', {
                matchCount: matches.length,
                topScore: matches[0]?.score
            });

            return { matches };
        } catch (error) {
            logger.error('Failed to query vectors', 'queryVectors', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
}

function wrapChromaStore() {
    return new ChromaVectorStore();
}

module.exports = {
    wrapChromaStore
};
