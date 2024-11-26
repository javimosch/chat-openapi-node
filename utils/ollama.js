const fetch = require('node-fetch');
const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('ollamaUtils');

class OllamaEmbeddings {
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.model = config.model || process.env.OLLAMA_MODEL || 'nomic-embed-text';
        this.dimensions = 768; // nomic-embed-text default dimensions
        
        logger.info('Initializing Ollama embeddings', 'constructor', {
            baseUrl: this.baseUrl,
            model: this.model,
            dimensions: this.dimensions
        });
    }

    async embedDocuments(texts) {
        logger.debug('Embedding multiple documents', 'embedDocuments', {
            documentCount: texts.length
        });

        const embeddings = await Promise.all(
            texts.map(text => this.embedText(text))
        );
        return embeddings;
    }

    async embedText(text) {
        try {
            logger.debug('Generating embedding for text', 'embedText', {
                textLength: text.length,
                model: this.model
            });

            const response = await fetch(`${this.baseUrl}/api/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    prompt: text
                })
            });

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.status}`);
            }

            const data = await response.json();
            
            logger.debug('Successfully generated embedding', 'embedText', {
                embeddingLength: data.embedding.length
            });

            return data.embedding;
        } catch (error) {
            logger.error('Failed to generate embedding', 'embedText', {
                error: error.message,
                stack: error.stack,
                textLength: text.length
            });
            throw new Error(`Failed to generate embedding: ${error.message}`);
        }
    }
}

function createOllamaEmbeddings(config = {}) {
    return new OllamaEmbeddings(config);
}

module.exports = {
    createOllamaEmbeddings
};