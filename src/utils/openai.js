/**
 * @module openai
 * @description OpenAI configuration and utility functions
 */

require('dotenv').config();
const { OpenAIEmbeddings } = require('@langchain/openai');

/**
 * Creates an OpenAI embeddings instance with the configured API key
 * @returns {OpenAIEmbeddings} OpenAI embeddings instance
 */
function createOpenAIEmbeddings() {
    return new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: 'text-embedding-ada-002'
    });
}

module.exports = {
    createOpenAIEmbeddings
};
