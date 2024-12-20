require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const { initPinecone, processOpenAPISpec, getProcessingStatus, generateChatResponse, querySimilarChunks } = require('./utils/openapi');
const { createModuleLogger } = require('./utils/logger');
const basicAuth = require('express-basic-auth');
const fs = require('fs');

const logger = createModuleLogger('server');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Setup middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout extractScripts', false);
app.set('layout extractStyles', true);
app.set('layout', './layout');
app.use(express.static('public'));
app.use(express.json());

if (process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASSWORD) {
    app.use(basicAuth({
        users: {
            [process.env.BASIC_AUTH_USER]: process.env.BASIC_AUTH_PASSWORD
        },
        challenge: true
    }));
}

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/upload', (req, res) => {
    res.render('upload');
});

app.get('/admin', (req, res) => {
    res.render('admin');
});

app.get('/admin/logs', (req, res) => {
    res.render('admin-logs');
});

app.get('/api/admin/logs', (req, res) => {
    const logFilePath = process.env.LOG_FILE_PATH || `${process.cwd()}/logs/stdout.log`;
    fs.readFile(logFilePath, 'utf8', (err, data) => {
        if (err) {
            res.status(500).json({ error: 'Failed to read log file' });
        } else {
            const logs = data.split('\n').slice(-200).reverse();
            res.json(logs);
        }
    });
});

// Initialize global variable for dynamic Pinecone index
global.DYNAMIC_PINECONE_INDEX = process.env.PINECONE_INDEX;

// API endpoint to update Pinecone index
app.post('/api/admin/pinecone-index', (req, res) => {
    try {
        const { pineconeIndex } = req.body;
        if (!pineconeIndex) {
            return res.status(400).json({ error: 'Pinecone index is required' });
        }
        global.DYNAMIC_PINECONE_INDEX = pineconeIndex;
        logger.info('Updated Pinecone index', 'admin', { newIndex: pineconeIndex });
        res.json({ success: true, message: 'Pinecone index updated successfully' });
    } catch (error) {
        logger.error('Failed to update Pinecone index', 'admin', { error });
        res.status(500).json({ error: 'Failed to update Pinecone index' });
    }
});

// Initialize Pinecone
let pineconeIndex;
initPinecone().then(index => {
    pineconeIndex = index;
}).catch(error => {
    logger.error('Failed to initialize Pinecone', 'init', { error });
});

// WebSocket connection handler
wss.on('connection', (ws) => {
    logger.info('Client connected', 'wsConnection');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            logger.info('Received message', 'wsMessage', { type: data.type });

            switch (data.type) {
                case 'upload':
                    const result = await processOpenAPISpec(data.content, data.fileName);
                    ws.send(JSON.stringify({
                        type: 'upload_response',
                        data: result
                    }));
                    break;

                case 'status':
                    const status = getProcessingStatus();
                    ws.send(JSON.stringify({
                        type: 'status_response',
                        data: status
                    }));
                    break;

                case 'chat':
                    try {
                        const context = await querySimilarChunks(data.query);
                        const response = await generateChatResponse(data.query, context);
                        ws.send(JSON.stringify({
                            type: 'chat_response',
                            data: {
                                text: response
                            }
                        }));
                    } catch (error) {
                        logger.error('Chat error', 'wsChat', { error });
                        ws.send(JSON.stringify({
                            type: 'error',
                            data: {
                                message: 'Failed to generate response'
                            }
                        }));
                    }
                    break;

                default:
                    logger.warn('Unknown message type', 'wsMessage', { type: data.type });
                    ws.send(JSON.stringify({
                        type: 'error',
                        data: {
                            message: 'Unknown message type'
                        }
                    }));
            }
        } catch (error) {
            logger.error('WebSocket error', 'wsError', { error });
            ws.send(JSON.stringify({
                type: 'error',
                data: {
                    message: 'Internal server error'
                }
            }));
        }
    });

    ws.on('close', () => {
        logger.info('Client disconnected', 'wsClose');
    });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    logger.info(`Server running on port ${port}`, 'serverStart');
});
