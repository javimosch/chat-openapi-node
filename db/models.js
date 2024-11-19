const mongoose = require('mongoose');

// Schema for OpenAPI specification files
const specFileSchema = new mongoose.Schema({
    fileName: {
        type: String,
        required: true
    },
    specId: {
        type: String,
        required: true,
        unique: true
    },
    content: {
        type: String
    },
    status: {
        type: String,
        enum: ['processing', 'completed', 'error', 'migrated'],
        default: 'processing'
    },
    error: {
        type: String
    },
    totalChunks: {
        type: Number,
        default: 0
    },
    processedChunks: {
        type: Number,
        default: 0
    },
    progress: {
        type: Number,
        default: 0
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Schema for embedding chunks
const embeddingChunkSchema = new mongoose.Schema({
    text: {
        type: String,
        required: true
    },
    fileName: {
        type: String,
        required: true
    },
    chunkType: {
        type: String,
        required: true
    },
    embedding: {
        type: [Number],
        required: true
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
});

// Index for vector similarity search
embeddingChunkSchema.index({ 'metadata.pineconeId': 1 }, { unique: true });
embeddingChunkSchema.index({ fileName: 1 });
embeddingChunkSchema.index({ chunkType: 1 });

const SpecFile = mongoose.model('SpecFile', specFileSchema);
const EmbeddingChunk = mongoose.model('EmbeddingChunk', embeddingChunkSchema);

module.exports = {
    SpecFile,
    EmbeddingChunk
};
