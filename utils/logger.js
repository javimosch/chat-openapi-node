/**
 * @module logger
 * @description Configurable logger that supports console and MongoDB output
 */

const { Log } = require('../db/models');

/**
 * Create a logger instance for a specific module
 * @param {string} module - Module name for the logger
 * @returns {Object} Logger instance with log methods
 */
function createModuleLogger(module) {
    const logLevels = ['error', 'warn', 'info', 'debug'];
    const currentLevel = process.env.LOG_LEVEL || 'info';
    const useMongoLogs = process.env.MONGO_LOGS === '1';
    
    // Get numeric value for current log level
    const currentLevelIndex = logLevels.indexOf(currentLevel);

    /**
     * Log a message with specific level
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {string} operation - Operation name
     * @param {Object} metadata - Additional metadata
     */
    async function log(level, message, operation, metadata = {}) {
        const levelIndex = logLevels.indexOf(level);
        
        // Check if we should log this level
        if (levelIndex > currentLevelIndex) {
            return;
        }

        const timestamp = new Date();
        const logData = {
            timestamp,
            level,
            module,
            operation,
            message,
            metadata
        };

        // Add error information if present
        if (metadata.error) {
            logData.error = {
                name: metadata.error.name,
                message: metadata.error.message,
                stack: metadata.error.stack
            };
        }

        // Console logging
        const consoleMessage = `[${timestamp.toISOString()}] ${level.toUpperCase()} [${module}] ${operation}: ${message}`;
        if (metadata && Object.keys(metadata).length > 0) {
            console[level](consoleMessage, metadata);
        } else {
            console[level](consoleMessage);
        }

        // MongoDB logging if enabled
        if (useMongoLogs) {
            try {
                await Log.create(logData);
            } catch (error) {
                console.error('Failed to write log to MongoDB:', error);
                // Fallback to console
                console.error('Log that failed to write:', logData);
            }
        }
    }

    // Create logger methods for each level
    const logger = {};
    logLevels.forEach(level => {
        logger[level] = (message, operation, metadata) => log(level, message, operation, metadata);
    });

    return logger;
}

module.exports = {
    createModuleLogger
};
