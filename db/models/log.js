const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
    timestamp: {
        type: Date,
        required: true,
        default: Date.now
    },
    level: {
        type: String,
        required: true,
        enum: ['error', 'warn', 'info', 'debug'],
        index: true
    },
    module: {
        type: String,
        required: true,
        index: true
    },
    operation: {
        type: String,
        required: true,
        index: true
    },
    message: {
        type: String,
        required: true
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    error: {
        name: String,
        message: String,
        stack: String
    }
}, {
    timestamps: true
});

// Create indexes for common queries
logSchema.index({ timestamp: -1 });
logSchema.index({ level: 1, timestamp: -1 });
logSchema.index({ module: 1, timestamp: -1 });
logSchema.index({ operation: 1, timestamp: -1 });

const Log = mongoose.model('Log', logSchema);

module.exports = Log;
