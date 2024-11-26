/**
 * @module configService
 * @description Handles server configuration and initialization
 */

const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const basicAuth = require('express-basic-auth');
const { createModuleLogger } = require('../utils/logger');
const { initVectorDb } = require('./vectorDbService');
const { connectDB } = require('../db');
const { setupRoutes } = require('./routeService');

const logger = createModuleLogger('configService');

/**
 * Initialize Express application with middleware and settings
 * @param {Express} app - Express application instance
 */
function initializeApp(app) {
    logger.info('Initializing Express application', 'initializeApp');

    // View engine setup
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'views'));
    app.use(expressLayouts);
    app.set('layout extractScripts', true);
    app.set('layout extractStyles', true);
    app.set('layout', './layout');

    // Middleware
    app.use(express.static('public'));
    app.use(express.json());

    // Authentication if configured
    setupAuth(app);

    // Routes
    setupRoutes(app);

    logger.info('Express application initialized', 'initializeApp');
}

/**
 * Set up authentication if configured
 * @param {Express} app - Express application instance
 */
function setupAuth(app) {
    if (process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASSWORD) {
        logger.info('Setting up basic authentication', 'setupAuth');
        
        app.use(basicAuth({
            users: {
                [process.env.BASIC_AUTH_USER]: process.env.BASIC_AUTH_PASSWORD
            },
            challenge: true
        }));

        logger.info('Basic authentication configured', 'setupAuth');
    } else {
        logger.info('Skipping authentication setup - no credentials configured', 'setupAuth');
    }
}

/**
 * Initialize all required services
 * @returns {Promise<void>}
 */
async function initializeServices() {
    logger.info('Starting services initialization', 'initializeServices');

    try {
        await Promise.all([
            initVectorDb(),
            connectDB()
        ]);

        logger.info('All services initialized successfully', 'initializeServices');
    } catch (error) {
        logger.error('Failed to initialize services', 'initializeServices', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

/**
 * Get configured port number
 * @returns {number} Port number
 */
function getPort() {
    const port = process.env.PORT || 3000;
    logger.debug('Retrieved port configuration', 'getPort', { port });
    return port;
}

module.exports = {
    initializeApp,
    setupAuth,
    initializeServices,
    getPort
};
