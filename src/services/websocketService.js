/**
 * @module websocketService
 * @description Handles WebSocket connections and message processing
 */

const { createModuleLogger } = require('../../utils/logger');
const { processOpenAPISpec } = require('./embeddingStorageService');
const { querySimilarChunks } = require('./vectorDbService');
const { generateChatResponse } = require('./chatService');
const { formatWebSocketResponse, formatErrorResponse } = require('../../utils/responseFormatter');

const logger = createModuleLogger('websocketService');

/**
 * Handle new WebSocket connections
 * @param {WebSocket} ws - WebSocket connection
 */
function handleConnection(ws) {
    logger.info('Client connected', 'handleConnection');

    ws.on('message', (message) => handleMessage(ws, message));
    ws.on('close', () => logger.info('Client disconnected', 'handleConnection'));
    ws.on('error', (error) => handleError(ws, error));
}

/**
 * Process incoming WebSocket messages
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} message - Raw message from client
 */
async function handleMessage(ws, message) {
    try {
        const data = JSON.parse(message);
        logger.info('Received message', 'handleMessage', { type: data.type });

        switch (data.type) {
            case 'upload':
                await handleUploadMessage(ws, data);
                break;

            case 'chat':
                await handleChatMessage(ws, data);
                break;

            default:
                logger.warn('Unknown message type', 'handleMessage', { type: data.type });
                sendResponse(ws, 'error', { message: 'Unknown message type' });
        }
    } catch (error) {
        handleError(ws, error);
    }
}

/**
 * Handle upload messages
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} data - Message data
 */
async function handleUploadMessage(ws, data) {
    try {
        const result = await processOpenAPISpec(data.content, data.fileName);
        sendResponse(ws, 'upload_response', result);
    } catch (error) {
        logger.error('Upload error', 'handleUploadMessage', {
            error: error.message,
            stack: error.stack,
            fileName: data.fileName
        });
        handleError(ws, error);
    }
}

/**
 * Handle chat messages
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} data - Message data
 */
async function handleChatMessage(ws, data) {
    try {
        const context = await querySimilarChunks(data.query);
        const response = await generateChatResponse(data.query, context);
        sendResponse(ws, 'chat_response', { text: response });
    } catch (error) {
        logger.error('Chat error', 'handleChatMessage', {
            error: error.message,
            stack: error.stack,
            query: data.query
        });
        handleError(ws, error);
    }
}

/**
 * Send formatted response to client
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} type - Response type
 * @param {Object} data - Response data
 */
function sendResponse(ws, type, data) {
    try {
        const response = formatWebSocketResponse(type, data);
        ws.send(JSON.stringify(response));
    } catch (error) {
        logger.error('Failed to send response', 'sendResponse', {
            error: error.message,
            stack: error.stack,
            type,
            data
        });
    }
}

/**
 * Handle WebSocket errors
 * @param {WebSocket} ws - WebSocket connection
 * @param {Error} error - Error object
 */
function handleError(ws, error) {
    logger.error('WebSocket error', 'handleError', {
        error: error.message,
        stack: error.stack
    });

    const errorResponse = formatErrorResponse(error);
    ws.send(JSON.stringify({
        type: 'error',
        data: errorResponse
    }));
}

module.exports = {
    handleConnection
};
