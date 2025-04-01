/**
 * Global state for tracking processing status
 */
let processingStatus = global.processingStatus = {
    isProcessing: false,
    progress: 0,
    error: null,
    embeddedFiles: [],
    processedChunks: 0,
    totalChunks: 0,
    currentFile: null
};

/**
 * Get the current processing status
 */
function getProcessingStatus() {
    return {
        ...processingStatus,
        processedChunksCount: processingStatus.processedChunks,
        totalChunksCount: processingStatus.totalChunks
    };
}

/**
 * Reset processing status to initial state
 */
function resetProcessingStatus() {
    processingStatus = global.processingStatus = {
        isProcessing: false,
        progress: 0,
        error: null,
        embeddedFiles: processingStatus.embeddedFiles, // Preserve embedded files list
        processedChunks: 0,
        totalChunks: 0,
        currentFile: null
    };
}

module.exports = {
    processingStatus,
    getProcessingStatus,
    resetProcessingStatus
};
