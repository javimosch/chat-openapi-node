require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createModuleLogger } = require('./utils/logger');
const { handleConnection } = require('./services/websocketService');
const { initializeApp, initializeServices, getPort } = require('./services/configService');

const logger = createModuleLogger('server');

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Initialize application
initializeApp(app);

// WebSocket connection handler
wss.on('connection', handleConnection);

// Get configured port
const port = getPort();

// Start server
initializeServices()
    .then(() => {
        server.listen(port, () => {
            logger.info('Server started successfully', 'startServer', { port });
        });
    })
    .catch(error => {
        logger.error('Failed to start server', 'startServer', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    });