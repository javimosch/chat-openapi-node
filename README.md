# OpenAPI Chat POC

A simple chat interface for exploring OpenAPI specs, powered by Node.js, Vue.js, and AI (OpenAI + OpenRouter).

## Features

- File upload for OpenAPI specifications
- Real-time chat interface
- Vector-based search using Pinecone
- OpenAI embeddings for semantic search
- OpenRouter LLM integration

## Prerequisites

- Node.js >= 14
- NPM >= 6
- OpenAI API key
- OpenRouter API key
- Pinecone API key and environment

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment configuration:
   ```bash
   cp .env.example .env
   ```
4. Configure your environment variables in `.env`

## Development

Start the development server:
```bash
npm run dev
```

The server will be available at http://localhost:3000

## Project Structure

```
node-poc/
├── public/
│   └── js/
│       └── app.js        # Vue.js frontend code
├── views/
│   ├── layout.ejs       # Base template
│   ├── index.ejs        # Chat interface
│   └── upload.ejs       # File upload interface
├── server.js            # Express server and Socket.IO
├── package.json         # Dependencies
└── .env                 # Environment configuration
```

## Technologies Used

- Backend:
  - Node.js
  - Express.js
  - Socket.IO
  - EJS templating
- Frontend:
  - Vue.js (via CDN)
  - Tailwind CSS (via CDN)
- Services:
  - Pinecone (vector store)
  - OpenAI (embeddings)
  - OpenRouter (LLM)

## How It Works

The chat-openapi system processes and interacts with OpenAPI specifications through several key components:

### 1. File Processing & Chunking
- OpenAPI specifications (JSON/YAML) are uploaded through the web interface
- Files are parsed and validated as valid OpenAPI/Swagger specs
- Specifications are broken down into semantic chunks:
  - Info Chunks: API metadata, descriptions, and version info
  - Path Chunks: Individual endpoint definitions and operations
  - Component Chunks: Schema definitions and reusable components

### 2. Vector Embeddings
The system supports two storage modes for embeddings:

#### Pinecone Mode (Default)
- Chunks are converted to vector embeddings using OpenAI's text-embedding-ada-002
- Embeddings are stored in Pinecone vector database
- Similarity search is performed using Pinecone's vector search capabilities

#### MongoDB Mode (Optional)
- Enable by setting `USE_MONGODB_FOR_EMBEDDING=true`
- Embeddings are stored in MongoDB with vector similarity search
- Reduces dependency on external vector database services
- Requires MongoDB 4.2+ for vector operations

### 3. File Metadata Storage
- File processing status and metadata can be stored in either:
  - Memory (default): State is reset on server restart
  - MongoDB (optional): Persistent storage across restarts
- Tracks file status, chunk counts, and processing progress
- MongoDB storage is enabled when valid `MONGO_URI` is provided

### 4. Chat Interface
- Users interact with specifications through natural language queries
- System retrieves relevant chunks using similarity search
- Context from similar chunks is used to generate accurate responses
- Streaming responses provide real-time feedback

### 5. Background Processing
- File processing and embedding generation run asynchronously
- Progress is tracked and reported through the UI
- Error handling with automatic recovery
- Supports multiple file uploads with queue management

### Data Migration
The system includes a migration script for moving data between storage systems:
```bash
npm run migrate
```
- Migrates file metadata to MongoDB (if enabled)
- Optionally migrates embeddings based on USE_MONGODB_FOR_EMBEDDING setting
- Preserves existing data and relationships
- Safe to run multiple times (idempotent)

## Ollama on runpod

```bash
runpodctl create pod \
  --imageName ollama/ollama:latest \
  --name ollama-cpu-pod \
  --ports "11434/tcp" \
  --volumeSize 20 \
  --vcpu 16 \
  --mem 32 \
  --env "OLLAMA_HOST=0.0.0.0" \
  --gpuCount 1 \
  --gpuType "NVIDIA GeForce RTX 3090"

# SSH into pod using runpod dashboard and pull model
# Click connect in pod details to get pod IP with ollama port mapped i.g 80.15.7.37:41740
# Add to .env

```

## Limitations

This is a proof-of-concept implementation with the following limitations:

- No authentication
- Basic error handling
- No conversation persistence
- Limited OpenAPI validation
- No rate limiting
- Minimal security measures

## License

MIT
