const { createModuleLogger } = require('../utils/logger');
const { querySimilarChunks } = require('./vectorDbService');
const logger = createModuleLogger('chatService');
const { OpenAI } = require('openai');
const { estimateContextConsumption } = require('../utils/ai');
const { formatDocsContext } = require('../utils/formatters');
const { observeOpenAI } = require('langfuse');
const { getTrace } = require('../services/llmMetricsService');
const fs = require('fs').promises;

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
async function generateOpenAPILLMCompletion(query, context, history, options = {}) {

    const { traceId } = options;



    const formattedContext = formatDocsContext(context);

    // Generate response
    const messages = [
        {
            "role": "system",
            "content": "You are an expert AI assistant specializing in OpenAPI specifications. Your primary goal is to provide clear, accurate, and **well-formatted** answers based *only* on the provided OpenAPI specification data.\n\n## Core Objective\nAnswer user questions about API endpoints, authentication methods, request/response schemas, and other details found within the OpenAPI document.\n\n## Formatting & Style (**Crucial for Readability**)\n- **Clarity First:** Prioritize readable and well-structured Markdown output.\n- **Markdown Usage:**\n    - Use Markdown consistently for all responses.\n    - **Use whitespace (blank lines)** generously between sections (like headers, parameters, responses) and logical blocks to improve readability and create visual separation (simulate margins).\n    - Use Level 3 headings (starting with '### ') for major sections like endpoint details.\n    - Use **bold** (surrounding text with double asterisks) for key terms, HTTP methods, status codes, parameter names, and section titles within the endpoint template (e.g., **Parameters**, **Request Body**).\n    - Use inline code formatting (typically rendered using single backticks around the text) for single identifiers like paths (e.g., format /users/{id} with inline code style), operation IDs (e.g., format getUser with inline code style), content types (e.g., format application/json with inline code style), specific header names (e.g., format Authorization with inline code style), and field names (e.g., format userId with inline code style).\n    - Use fenced code blocks (typically starting and ending with triple backticks, optionally followed by a language identifier) for multi-line examples, especially JSON/YAML snippets, complex schema definitions, or lists of headers. Specify the language (e.g., json) if possible.\n    - Use bullet points (starting lines with '- ') for lists of items (e.g., listing parameters, responses). Use nested bullets for sub-details if necessary.\n    - Use numbered lists (starting lines with '1. ') primarily for user choices (selecting an endpoint) or sequential steps if explicitly requested.\n    - Use tables (using Markdown table syntax with pipes and hyphens) *only* when specifically comparing multiple similar items side-by-side if it enhances clarity. Prefer lists/structured text otherwise.\n- **Tone:** Be technically precise, concise, and helpful. Avoid conversational filler, greetings, or closings. Stick strictly to the requested information.\n\n## Content Requirements & Structure\n- **Source:** Base all answers strictly on the provided OpenAPI context. If information is missing, state clearly: \"Information not available in the provided specification.\"\n- **Endpoint Details Template:** When describing a specific endpoint, **strictly adhere** to the following structure and formatting principles (imagine the formatting described above is applied):\n\n    ### Endpoint: [HTTP Method formated bold] [Path formatted with inline code style]\n\n    *(Optional: Include the summary/description from the spec here if available)*\n\n    - **Operation ID:** [operationId formatted with inline code style] *(If available)*\n    - **Security:** *(List required security schemes, if any. E.g., \"Requires: [schemeName formatted with inline code style]\")*\n\n    **Parameters:**\n    *(List parameters: path, query, header, cookie. Use bullets)*\n    - [parameter_name formatted with inline code style] ([in], **Required**/**Optional**): [Type/Description]. *(Example: \"- userId (path, **Required**): User's unique identifier.\" - format 'userId' and 'path' using inline code style)*\n    *(If no parameters, state: \"- None\")*\n\n    **Request Body:**\n    *(If applicable. Describe content type and schema)*\n    - **Content-Type:** [content-type formatted with inline code style]\n    - **Schema:** *(Provide schema details or reference. Use a fenced code block for complex structures)*\n        (Code block showing JSON Schema Example or Description)\n    *(If no request body, state: \"- None\")*\n\n    **Responses:**\n    *(List relevant status codes and their descriptions/schemas. Use bullets)*\n    - **[Status Code formatted bold]**: [Description]\n        - **Content-Type:** [content-type formatted with inline code style]\n        - **Schema:** *(Provide schema details or reference. Use a fenced code block for complex structures)*\n            (Code block showing JSON Schema Example or Description)\n    *(Example: \"- **200 OK**: Successful retrieval. - **Content-Type:** application/json ...\" - format '200 OK' as bold, 'application/json' using inline code style)*\n\n    *(Ensure blank lines before/after major sections like Parameters, Request Body, Responses)*\n\n- **Authentication Details:** When asked specifically about authentication:\n    - Describe the security scheme(s) defined (e.g., API Key, OAuth2, Basic Auth).\n    - Specify how/where credentials are provided (e.g., Header: [Header Name formatted with inline code style]: Bearer <token>, Query parameter: [param_name formatted with inline code style]=...). Format header and parameter names using inline code style.\n    - Mention relevant flows if applicable (e.g., OAuth2 authorization code flow details).\n\n## Interaction Logic\n- **Multiple Matches:** If a query matches multiple endpoints, list them concisely using numbers and applying **bold** to the method and inline code style to the path:\n  \"Multiple endpoints match your query:\n  1. **POST** /users\n  2. **GET** /users/{userId}\n  Please reply with the number corresponding to the endpoint you're interested in (e.g., '1').\"\n  *(Format paths like '/users' and '/users/{userId}' using inline code style)*.\n- **Focus:** Answer *only* the question asked. Do not provide unsolicited information.\n\n## Constraints\n- **No Speculation:** Do not infer information not present in the spec.\n- **Text-Based:** Provide responses purely in text using the specified Markdown format instructions."
        },
        ...history,
        {
            role: 'user',
            content: `
            
            Provided OpenAPI details (context):

            ${formattedContext}

            Question/Instruction:

            ${query}

            `
        }
    ];

    try {

        let useOllama = !!process.env.OLLAMA_LLM_COMPLETION_MODEL && !!process.env.OLLAMA_BASE_URL;
        const canUseOpenRouter = !!process.env.OPENROUTER_API_KEY && !!process.env.OPENROUTER_MODEL;

        if (canUseOpenRouter && !!process.env.LLM_COMPLETION_PREFERENCE && process.env.LLM_COMPLETION_PREFERENCE !== 'ollama') {
            useOllama = false;
        }

        logger.info('Generating chat completion', 'generateOpenAPILLMCompletion', {
            modelName: useOllama ? process.env.OLLAMA_LLM_COMPLETION_MODEL : global.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL,
            messageCount: messages.length,
            contextLength: context.length,
            contextConsumption: estimateContextConsumption(messages)
        });

        let content;
        if (useOllama) {
           /*  const response = await axios.post(`${process.env.OLLAMA_BASE_URL}/api/chat`, {
                model: process.env.OLLAMA_LLM_COMPLETION_MODEL || 'llama2',
                messages,
                stream: false,
                temperature: 0.3,
                "options": {
                    "num_ctx": 8192
                }
            });

            content = response.data.message.content; */

            const openai = await observeOpenAI(new OpenAI({
                apiKey: 'ollama',
                baseURL: `${process.env.OLLAMA_BASE_URL}/v1`,
            }, {
                clientInitParams: {
                    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
                    secretKey: process.env.LANGFUSE_SECRET_KEY,
                    baseUrl: process.env.LANGFUSE_BASEURL,
                },
            }));

            await fs.writeFile('completion.input.json', JSON.stringify(messages, null, 2));

            const response = await openai.chat.completions.create({
                model: process.env.OLLAMA_LLM_COMPLETION_MODEL,
                messages,
                temperature: 0.7
            });
            content = response.choices[0].message.content;

            await fs.writeFile('completion.output.json', JSON.stringify({
                content
            }, null, 2));

        } else {

            const openai = await observeOpenAI(new OpenAI({
                apiKey: process.env.OPENROUTER_API_KEY,
                baseURL: 'https://openrouter.ai/api/v1',
                headers: {
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-App-Name': process.env.APP_NAME || 'chat-openapi-node'
                }
            }, {
                clientInitParams: {
                    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
                    secretKey: process.env.LANGFUSE_SECRET_KEY,
                    baseUrl: process.env.LANGFUSE_BASEURL,
                },
            }));



            const response = await openai.chat.completions.create({
                model: global.OPENROUTER_MODEL ||process.env.OPENROUTER_MODEL,
                messages,
                temperature: 0.3
            });

            content = response.choices[0].message.content;
           
        }

        logger.info('Chat completion response', 'generateOpenAPILLMCompletion', {
            contentLen: content.length
        });

        return content || 'No response generated';

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
