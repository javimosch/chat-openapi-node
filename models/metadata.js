const mongoose = require('mongoose');

const metadataSchema = new mongoose.Schema({
    vector_id: {
        type: String,
        required: true,
        index: true
    },
    file_name: {
        type: String,
        required: true,
        index: true
    },
    chunk_index: {
        type: Number,
        required: true
    },
    is_file_metadata: {
        type: Boolean,
        default: false,
        index: true
    },
    
    // File metadata specific fields
    total_chunks: Number,
    timestamp: Date,
    
    // Essential metadata (duplicated in Pinecone for quick access)
    endpoint: {
        type: String,
        index: true
    },
    method: {
        type: String,
        index: true
    },
    summary: String,
    tags: [String],
    
    // Detailed metadata (only in MongoDB)
    parameters: mongoose.Schema.Types.Mixed,
    requestBody: mongoose.Schema.Types.Mixed,
    responses: mongoose.Schema.Types.Mixed,
    security: mongoose.Schema.Types.Mixed,
    servers: mongoose.Schema.Types.Mixed,
    schemas: mongoose.Schema.Types.Mixed,
    
    // Additional fields
    description: String,
    text: String, // The text used for embedding
    spec_id: {
        type: String,
        index: true
    },
    type: String,
    line_number: Number,
    
    created_at: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    strict: false // Allow additional fields not specified in schema
});

// Compound indexes for efficient retrieval
metadataSchema.index({ file_name: 1, chunk_index: 1 });
metadataSchema.index({ spec_id: 1 });
metadataSchema.index({ is_file_metadata: 1, file_name: 1 });
metadataSchema.index({ endpoint: 1, method: 1 });

const Metadata = mongoose.model('Metadata', metadataSchema);

module.exports = Metadata;
