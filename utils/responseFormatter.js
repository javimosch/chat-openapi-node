/**
 * @module responseFormatter
 * @description Standardizes response formats for WebSocket and HTTP responses
 */

const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('responseFormatter');

/**
 * Format WebSocket response
 * @param {string} type - Response type
 * @param {Object} data - Response data
 * @returns {Object} Formatted response
 */
function formatWebSocketResponse(type, data) {
    return {
        type,
        data,
        timestamp: new Date().toISOString()
    };
}

/**
 * Format HTTP response
 * @param {Object} data - Response data
 * @param {Object} options - Additional options
 * @returns {Object} Formatted response
 */
function formatHttpResponse(data, options = {}) {
    return {
        success: true,
        data,
        timestamp: new Date().toISOString(),
        ...options
    };
}

/**
 * Format status response
 * @param {Object} status - Status object
 * @returns {Object} Formatted status response
 */
function formatStatusResponse(status) {
    return {
        success: true,
        data: {
            isProcessing: status.isProcessing,
            progress: status.progress,
            error: status.error,
            currentFile: status.currentFile,
            processedChunks: status.processedChunks,
            totalChunks: status.totalChunks,
            embeddedFiles: status.embeddedFiles.map(file => ({
                fileName: file.fileName,
                totalChunks: file.totalChunks,
                timestamp: file.timestamp,
                status: file.status,
                _id: file._id
            }))
        },
        timestamp: new Date().toISOString()
    };
}

/**
 * Format error response
 * @param {Error} error - Error object
 * @returns {Object} Formatted error response
 */
function formatErrorResponse(error) {
    const errorResponse = {
        success: false,
        error: {
            message: error.message || 'Internal server error',
            code: error.code || 500,
            type: error.name || 'Error'
        },
        timestamp: new Date().toISOString()
    };

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development') {
        errorResponse.error.stack = error.stack;
    }

    return errorResponse;
}

module.exports = {
    formatWebSocketResponse,
    formatHttpResponse,
    formatStatusResponse,
    formatErrorResponse
};
