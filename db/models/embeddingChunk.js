const mongoose = require('mongoose');

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

const EmbeddingChunk = mongoose.model('EmbeddingChunk', embeddingChunkSchema);

module.exports = EmbeddingChunk;
