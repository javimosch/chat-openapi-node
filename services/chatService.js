const { createModuleLogger } = require('../utils/logger');
const { querySimilarChunks } = require('./vectorDbService');
const logger = createModuleLogger('chatService');
const { OpenAI } = require('openai');
const { estimateContextConsumption } = require('../utils/ai');
const { formatDocsContext } = require('../utils/formatters');
const { observeOpenAI } = require('langfuse');

// Generate description from metadata
function generateDescription(metadata) {
    if (metadata.component_type === 'auth') {
        return `Authentication information: ${metadata.description || 'No description available'}`;
    }

    if (metadata.method && metadata.path) {
        return `${metadata.method.toUpperCase()} endpoint at ${metadata.path}: ${metadata.description || 'No description available'}`;
    }

    if (metadata.type === 'schema') {
        return `Schema definition for ${metadata.name || 'unknown type'}: ${metadata.description || 'No description available'}`;
    }

    return metadata.description || 'No description available';
}

/**
 * 
 * @param {*} query 
 * @param {String|Array<Object>} context 
 * @returns 
 */
async function generateOpenAPILLMCompletion(query, context) {

    const formattedContext = formatDocsContext(context);
    
    // Generate response
    const messages = [
        {
            role: 'system',
            content: `You are an AI assistant helping users understand an OpenAPI specification.
                 You specialize in explaining API endpoints, authentication methods, and schema definitions.
                 
                 Style Guide:
                 1. Format your responses in Markdown
                 2. Use code blocks with \`\`\` for:
                    - Endpoint paths
                    - Request/response examples
                    - Headers
                 3. Use bullet points or numbered lists for multiple items
                 4. Use headers (##) to organize different sections (titles)
                 5. Use bold (**) for important terms that are not titles
                 6. Use tables for comparing multiple endpoints or parameters
                 7. Do not combine ** with ##
                 8. Remember to write valid simple markdown
                 
                 When describing authentication endpoints:
                 1. Always mention the HTTP method
                 2. List any required headers
                 3. Describe the expected request body if POST/PUT
                 4. Explain the response format
                 5. Note any required scopes or permissions
                 
                 Below is the relevant context from the specification.
                 Use this context to answer the user's question precisely and technically.
                 If you find authentication-related information, be sure to explain the required credentials and how to use them.
                 If you cannot find relevant information in the context, say so.
                 
                 Context:
                 ${formattedContext}`
        },
        {
            role: 'user',
            content: query
        }
    ];

    try {

        let useOllama = !!process.env.OLLAMA_LLM_COMPLETION_MODEL && !!process.env.OLLAMA_BASE_URL;
        const canUseOpenRouter = !!process.env.OPENROUTER_API_KEY && !!process.env.OPENROUTER_MODEL;

        if (canUseOpenRouter && !!process.env.LLM_COMPLETION_PREFERENCE && process.env.LLM_COMPLETION_PREFERENCE !== 'ollama') {
            useOllama = false;
        }

        logger.info('Generating chat completion', 'generateOpenAPILLMCompletion', {
            modelName: useOllama ? process.env.OLLAMA_LLM_COMPLETION_MODEL : process.env.OPENROUTER_MODEL,
            messageCount: messages.length,
            contextLength: context.length,
            contextConsumption: estimateContextConsumption(messages)
        });

        if (useOllama) {
            const response = await axios.post(`${process.env.OLLAMA_BASE_URL}/api/chat`, {
                model: process.env.OLLAMA_LLM_COMPLETION_MODEL || 'llama2',
                messages,
                stream: false,
                temperature:0.3,
                "options": {
                    "num_ctx": 8192
                }
            });

            return response.data.message.content;
        } else {

            const openai = observeOpenAI(new OpenAI({
                apiKey: process.env.OPENROUTER_API_KEY,
                baseURL: 'https://openrouter.ai/api/v1',
                headers: {
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-App-Name': process.env.APP_NAME || 'chat-openapi-node'
                }
            }));

            const response = await openai.chat.completions.create({
                model: process.env.OPENROUTER_MODEL,
                messages,
                temperature: 0.3
            });

           /*  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'http://localhost:3000',
                    'Content-Type': 'application/json',
                    'X-App-Name': process.env.APP_NAME || 'chat-openapi-node'
                },
                body: JSON.stringify({
                    model: process.env.OPENROUTER_MODEL,
                    messages: messages,
                    temperature: 0.3 // Lower temperature for more precise responses
                })
            });

            if (!response.ok) {
                throw new Error(`OpenRouter API error: ${response.status}`);
            }

            const data = await response.json();

            const content = data.choices[0].message.content; */
            
            const content = response.choices[0].message.content;

            logger.info('Chat completion response', 'generateOpenAPILLMCompletion', {
                contentLen: content.length
            });

            return content || 'No response generated';
        }

    } catch (error) {
        logger.error('Failed to generate chat response', 'generateOpenAPILLMCompletion', { error });
        return 'I encountered an error while generating the response. Please try again or check if the OpenAPI specification is properly loaded.';
    }
}

// Generate chat response
async function generateChatResponse(query) {
    logger.info('Generating chat response', 'generateChatResponse', { query });

    // Get similar chunks
    const similarChunks = await querySimilarChunks(query);

    // Extract text from chunks
    const context = similarChunks.map(chunk => {
        const metadata = chunk.metadata || {};
        const text = metadata.text || metadata.content || '';
        const type = metadata.component_type || metadata.type || 'info';
        const path = metadata.path || '';
        const method = metadata.method || '';
        const score = chunk.score || 0;

        // If no text content, generate a description from the metadata
        const description = text || generateDescription(metadata);

        return {
            text: description,
            type,
            path,
            method,
            score
        };
    }).filter(chunk => chunk.text);

    // Log extracted context
    logger.info('Extracted context', 'generateChatResponse', {
        contextItems: context.map(c => ({
            type: c.type,
            path: c.path,
            method: c.method,
            score: c.score,
            textPreview: c.text.substring(0, 100) + '...'
        }))
    });

    // If no context found, try a broader search
    if (!context.length) {
        logger.info('No context found, returning guidance', 'generateChatResponse');
        return "I don't see any OpenAPI specification loaded yet. Please upload an OpenAPI specification file first, and then I can help you understand its endpoints and features.";
    }

    // Format context for chat
    const contextText = context.map(chunk => {
        let header = `[${chunk.type.toUpperCase()}]`;
        if (chunk.path) header += ` ${chunk.method || ''} ${chunk.path}`;
        if (chunk.score) header += ` (relevance: ${chunk.score.toFixed(2)})`;
        return `${header}\n${chunk.text}`;
    }).join('\n\n');

    return generateOpenAPILLMCompletion(query, contextText);
}

module.exports = {
    generateChatResponse,
    generateOpenAPILLMCompletion
};
