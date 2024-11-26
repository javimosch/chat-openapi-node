const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');
const path = require('path');
const yaml = require('js-yaml');

const app = express();
const port = process.env.PORT || 3000;

// Swagger configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Example Node API',
            version: '1.0.0',
            description: 'A simple Express API with Swagger documentation',
        },
        servers: [
            {
                url: `http://localhost:${port}`,
                description: 'Development server',
            },
        ],
    },
    apis: [path.join(__dirname, 'index.js')], // Path to the API docs
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);

// Serve Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Serve OpenAPI spec in JSON format
app.get('/api-spec.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerDocs);
});

// Serve OpenAPI spec in YAML format
app.get('/api-spec.yaml', (req, res) => {
    const yamlString = yaml.dump(swaggerDocs);
    res.setHeader('Content-Type', 'text/yaml');
    res.send(yamlString);
});

app.use(express.json());

/**
 * @swagger
 * tags:
 *   - name: General
 *     description: General endpoints
 * 
 * components:
 *   schemas:
 *     Message:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *           example: Hello World!
 */

/**
 * @swagger
 * /:
 *   get:
 *     tags: [General]
 *     summary: Returns a hello world message
 *     description: A simple endpoint that returns a greeting message
 *     responses:
 *       200:
 *         description: Hello world message
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 */
app.get('/', (req, res) => {
    res.json({ message: 'Hello World!' });
});

/**
 * @swagger
 * /hello/{name}:
 *   get:
 *     tags: [General]
 *     summary: Returns a personalized hello message
 *     description: Takes a name parameter and returns a personalized greeting
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         description: Name of the person to greet
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Personalized hello message
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Hello, John!
 */
app.get('/hello/:name', (req, res) => {
    const name = req.params.name;
    res.json({ message: `Hello, ${name}!` });
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`Swagger documentation available at http://localhost:${port}/api-docs`);
});
