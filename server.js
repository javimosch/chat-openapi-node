require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
//const { createModuleLogger } = require('./utils/logger');
//const { handleConnection } = require('./services/websocketService');
//const { initializeApp, initializeServices, getPort } = require('./services/configService');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const multer = require('multer');
const fs = require('fs').promises;
const { initPinecone, processOpenAPISpec, getProcessingStatus } = require('./utils/openapi');
const { querySimilarChunks,initVectorDb } = require('./services/vectorDbService');
const { createModuleLogger } = require('./utils/logger');
const basicAuth = require('express-basic-auth');
const { connectToMongoDB, isDbSystemEnabled } = require('./db/config');
const { generateOpenAPILLMCompletion } = require('./services/chatService');
const { enrichDocsWithMetadata } = require('./services/documentService');

const logger = createModuleLogger('server');

// Create Express app and HTTP server
const app = express();

initVectorDb();

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: async function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        try {
            await fs.access(uploadDir);
        } catch {
            await fs.mkdir(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

/*
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
*/

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
    res.render('upload', {
        inputFormat: process.env.INPUT_FORMAT?.toLowerCase() || 'csv'
    });
});

app.get('/settings', (req, res) => {
    res.render('settings', {
        inputFormat: process.env.INPUT_FORMAT?.toLowerCase() || 'csv'
    });

});

// Initialize Pinecone
let pineconeIndex;
initPinecone().then(index => {
    pineconeIndex = index;
}).catch(error => {
    logger.error('Failed to initialize Pinecone', 'init', { error });
});

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        logger.info('File uploaded successfully', 'upload', {
            originalName: req.file.originalname,
            filename: req.file.filename,
            onlyUpload: req.body.onlyUpload === 'true'
        });

        // Create file metadata in Pinecone
        const pinecone = new Pinecone({
            apiKey: process.env.PINECONE_API_KEY,
        });
        const index = pinecone.index(process.env.PINECONE_INDEX);

        // Store file metadata in Pinecone
        const fileMetadata = {
            is_file_metadata: true,
            file_name: req.file.filename,
            original_name: req.file.originalname,
            upload_date: new Date().toISOString(),
            file_size: req.file.size,
            file_type: 'csv',
            processed: false
        };

        const fileVector = {
            id: req.file.filename,
            metadata: fileMetadata,
            values: new Array(1536).fill(0) // Placeholder vector
        };

        await index.upsert([fileVector]);

        // Create MongoDB metadata entry for the file
        const metadataDoc = new Metadata({
            vector_id: req.file.filename,
            file_name: req.file.filename,
            is_file_metadata: true,
            original_name: req.file.originalname,
            upload_date: new Date(),
            file_size: req.file.size,
            file_type: 'csv',
            processed: false
        });

        await metadataDoc.save();

        logger.info('File metadata stored', 'upload', {
            filename: req.file.filename,
            vectorId: req.file.filename
        });

        // Return early if only uploading
        if (req.body.onlyUpload === 'true') {
            return res.json({
                message: 'File uploaded successfully',
                file: {
                    filename: req.file.filename,
                    originalName: req.file.originalname
                }
            });
        }

        // Process file if not onlyUpload
        const fileContent = await fs.readFile(req.file.path, 'utf-8');
        const result = await processOpenAPISpec(fileContent, req.file.filename);
        res.json(result);
    } catch (error) {
        logger.error('Error in file upload', 'upload', {
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: 'Error processing upload' });
    }
});

async function startServer() {
    try {
        // Initialize MongoDB connection if enabled
        if (isDbSystemEnabled()) {
            await connectToMongoDB();
        }

        // Initialize Pinecone
        let pineconeIndex;
        await initPinecone().then(index => {
            pineconeIndex = index;
        }).catch(error => {
            logger.error('Failed to initialize Pinecone', 'init', { error });
        });

        const server = http.createServer(app);
        const wss = new WebSocket.Server({ server });

        // WebSocket connection handler
        wss.on('connection', (ws) => {
            logger.info('Client connected', 'wsConnection');

            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);
                    logger.info('Received message', 'wsMessage', { type: data.type });

                    switch (data.type) {
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
                                const enrichedDocs = await enrichDocsWithMetadata(context);
                                const response = await generateOpenAPILLMCompletion(data.query, enrichedDocs, data.history || []);

                                await fs.writeFile('relevantDocs.json', JSON.stringify(context, null, 2));

                                logger.info('Response:', 'wsChat', {response});

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

                        case 'update_settings':
                            try {
                                // Update INPUT_FORMAT in process.env
                                process.env.INPUT_FORMAT = data.settings.inputFormat;
                                
                                ws.send(JSON.stringify({
                                    type: 'settings_updated'
                                }));
                            } catch (error) {
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    data: { message: error.message }
                                }));
                            }
                            break;

                        case 'upload':
                            logger.info('Processing upload', 'wsMessage', { 
                                fileName: data.fileName,
                                onlyUpload: data.onlyUpload 
                            });
                            try {
                                // Create uploads directory if it doesn't exist
                                const uploadDir = path.join(__dirname, 'uploads');
                                try {
                                    await fs.access(uploadDir);
                                } catch {
                                    await fs.mkdir(uploadDir, { recursive: true });
                                }

                                // Generate unique filename
                                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                                const ext = path.extname(data.fileName);
                                const filename = `file-${uniqueSuffix}${ext}`;
                                const filepath = path.join(uploadDir, filename);

                                // Save file content
                                await fs.writeFile(filepath, data.content);

                                if (data.onlyUpload) {
                                    // Store metadata without processing
                                    const fileMetadata = {
                                        is_file_metadata: true,
                                        file_name: filename,
                                        original_name: data.fileName,
                                        upload_date: new Date().toISOString(),
                                        file_type: data.fileType,
                                        processed: false,
                                        filepath: filepath
                                    };

                                    // Store in Pinecone
                                    const fileVector = {
                                        id: filename,
                                        metadata: fileMetadata,
                                        values: new Array(1536).fill(0) // Placeholder vector
                                    };
                                    await pineconeIndex.upsert([fileVector]);

                                    // Store in MongoDB
                                    const metadataDoc = new Metadata({
                                        vector_id: filename,
                                        file_name: filename,
                                        is_file_metadata: true,
                                        original_name: data.fileName,
                                        upload_date: new Date(),
                                        file_type: data.fileType,
                                        processed: false,
                                        filepath: filepath
                                    });
                                    await metadataDoc.save();

                                    ws.send(JSON.stringify({
                                        type: 'upload_response',
                                        data: {
                                            status: 'success',
                                            message: 'File uploaded successfully',
                                            filename: filename
                                        }
                                    }));
                                } else {
                                    // Process the file normally
                                    const result = await processOpenAPISpec(data.content, filename);
                                    ws.send(JSON.stringify({
                                        type: 'upload_response',
                                        data: result
                                    }));
                                }
                            } catch (error) {
                                logger.error('Upload processing failed', 'wsMessage', { error });
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    data: {
                                        message: error.message
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
                    logger.error('WebSocket message error', 'wsMessage', {
                        error: error.message,
                        stack: error.stack
                    });
                    ws.send(JSON.stringify({
                        type: 'error',
                        data: {
                            message: 'Failed to process message'
                        }
                    }));
                }
            });

            ws.on('error', (error) => {
                logger.error('WebSocket error', 'wsError', {
                    error: error.message,
                    stack: error.stack
                });
            });

            ws.on('close', () => {
                logger.info('Client disconnected', 'wsClose');
            });
        });

        const port = process.env.PORT || 3000;
        server.listen(port, () => {
            logger.info(`Server is running on port ${port}`, 'startup');
        });

    } catch (error) {
        logger.error('Failed to start server', 'startup', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}

startServer();
