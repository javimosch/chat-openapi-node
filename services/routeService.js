/**
 * @module routeService
 * @description Handles route setup and request handling
 */

const { createModuleLogger } = require('../utils/logger');
const { getProcessingStatus } = require('./statusService');
const { formatHttpResponse, formatErrorResponse } = require('../utils/responseFormatter');

const logger = createModuleLogger('routeService');

/**
 * Set up all routes for the application
 * @param {Express} app - Express application instance
 */
function setupRoutes(app) {
    logger.info('Setting up routes', 'setupRoutes');

    // Main routes
    app.get('/', handleIndexRoute);
    app.get('/status', handleStatusRoute);
    app.get('/upload', handleUploadRoute);

    logger.info('Routes setup completed', 'setupRoutes');
}

/**
 * Handle index route
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
async function handleIndexRoute(req, res) {
    try {
        logger.info('Handling index route', 'handleIndexRoute');
        res.render('index');
    } catch (error) {
        logger.error('Error handling index route', 'handleIndexRoute', {
            error: error.message,
            stack: error.stack
        });
        handleError(error, res);
    }
}

/**
 * Handle status route
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
async function handleStatusRoute(req, res) {
    try {
        logger.info('Handling status route', 'handleStatusRoute');
        const status = await getProcessingStatus();
        res.json(status);
    } catch (error) {
        logger.error('Error handling status route', 'handleStatusRoute', {
            error: error.message,
            stack: error.stack
        });
        handleError(error, res);
    }
}

/**
 * Handle upload route
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
async function handleUploadRoute(req, res) {
    try {
        logger.info('Handling upload route', 'handleUploadRoute');
        res.render('upload');
    } catch (error) {
        logger.error('Error handling upload route', 'handleUploadRoute', {
            error: error.message,
            stack: error.stack
        });
        handleError(error, res);
    }
}

/**
 * Handle route errors
 * @param {Error} error - Error object
 * @param {Response} res - Express response object
 */
function handleError(error, res) {
    const errorResponse = formatErrorResponse(error);
    const statusCode = error.statusCode || error.code || 500;
    res.status(statusCode).json(errorResponse);
}

module.exports = {
    setupRoutes,
    handleIndexRoute,
    handleStatusRoute,
    handleUploadRoute
};
