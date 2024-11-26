# RAG (Retrieval-Augmented Generation) Architecture

This document explains how RAG is implemented in this project and how different services interact with each other to provide an intelligent chat interface for OpenAPI specifications.

## Overview

The project implements a RAG system that enables users to chat with their OpenAPI specifications. The system processes OpenAPI specs, stores them as embeddings, and uses these embeddings to provide context-aware responses to user queries.

## Core Components

### 1. Embedding Generation
- **Service**: `embeddingService.js`
- **Purpose**: Creates vector embeddings for text using OpenAI's embedding model
- **Key Features**:
  - Uses OpenAI's ada-002 model for generating embeddings
  - Implements batch processing for efficient embedding generation
  - Includes comprehensive logging for monitoring and debugging

### 2. Vector Storage
- **Service**: `vectorDbService.js`
- **Purpose**: Manages interactions with the Pinecone vector database
- **Key Features**:
  - Stores and retrieves vector embeddings
  - Handles metadata storage for files
  - Implements similarity search functionality
  - Manages vector database initialization and connection

### 3. Embedding Storage
- **Service**: `embeddingStorageService.js`
- **Purpose**: Orchestrates the process of storing embeddings and managing file processing
- **Key Features**:
  - Chunks OpenAPI specifications
  - Manages batch processing of embeddings
  - Handles file metadata storage
  - Tracks processing status

### 4. WebSocket Communication
- **Service**: `websocketService.js`
- **Purpose**: Manages real-time communication with clients
- **Key Features**:
  - Handles file uploads
  - Processes chat messages
  - Manages WebSocket connections
  - Formats and sends responses

## Data Flow

1. **File Upload Process**:
   ```
   Client -> WebSocket -> handleUploadMessage -> processOpenAPISpec -> 
   OpenAPIChunker -> embedDocuments -> storeVectors
   ```

2. **Chat Process**:
   ```
   Client -> WebSocket -> handleChatMessage -> querySimilarChunks -> 
   generateChatResponse -> Client
   ```

## Service Interactions

### Upload Flow
1. Client sends OpenAPI spec through WebSocket
2. `websocketService` receives the file and initiates processing
3. `embeddingStorageService` chunks the specification
4. `embeddingService` generates embeddings for chunks
5. `vectorDbService` stores embeddings in Pinecone
6. Status updates are sent back to client via WebSocket

### Query Flow
1. Client sends query through WebSocket
2. `websocketService` handles the chat message
3. `vectorDbService` performs similarity search
4. Retrieved context is used to generate response
5. Response is sent back to client via WebSocket

## Key Features

### 1. Batch Processing
- Implements efficient batch processing for large files
- Manages memory usage through controlled batch sizes
- Tracks progress and provides status updates

### 2. Error Handling
- Comprehensive error handling across all services
- Detailed logging for debugging and monitoring
- Status tracking for long-running processes

### 3. Metadata Management
- Stores file metadata for tracking processed files
- Maintains processing status and history
- Enables efficient file management and retrieval

### 4. Real-time Communication
- WebSocket-based communication for real-time updates
- Progress tracking during file processing
- Immediate response to chat queries

## Configuration

The system requires several environment variables:
- OpenAI API credentials for embedding generation
- Pinecone API credentials for vector storage
- Database configuration for metadata storage

## Performance Considerations

1. **Embedding Generation**:
   - Batch processing to optimize API calls
   - Caching of embeddings to prevent redundant processing

2. **Vector Storage**:
   - Efficient similarity search using Pinecone
   - Metadata filtering for improved search results

3. **Memory Management**:
   - Controlled batch sizes for large files
   - Streaming of results to manage memory usage

## Security

1. **API Keys**:
   - Secure storage of API credentials
   - No exposure of sensitive information in logs

2. **Data Processing**:
   - Input validation for all user data
   - Secure WebSocket communication

## Monitoring and Logging

- Comprehensive logging across all services
- Progress tracking for long-running operations
- Error tracking and reporting
- Status monitoring for system health

## Future Improvements

1. **Scalability**:
   - Implement worker processes for embedding generation
   - Add support for distributed processing

2. **Performance**:
   - Implement caching layer for frequent queries
   - Optimize chunk size for better context retrieval

3. **Features**:
   - Add support for more document types
   - Implement advanced query preprocessing
   - Add support for custom embedding models
