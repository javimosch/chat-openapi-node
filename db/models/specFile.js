const mongoose = require('mongoose');

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

const SpecFile = mongoose.model('SpecFile', specFileSchema);

module.exports = SpecFile;
