/**
 * @module statusService
 * @description Handles processing status and file spec management
 */

const { createModuleLogger } = require('../../utils/logger');
const { SpecFile } = require('../../db/models');
const { formatStatusResponse } = require('../../utils/responseFormatter');

const logger = createModuleLogger('statusService');

/**
 * Get current processing status
 * @returns {Promise<Object>} Status object with file specs merged
 */
async function getProcessingStatus() {
    try {
        logger.info('Fetching processing status', 'getProcessingStatus');
        
        // Get file specs from database
        const fileSpecs = await SpecFile.find({}).lean();
        logger.info('Retrieved file specs', 'getProcessingStatus', { 
            fileSpecsCount: fileSpecs.length,
            fileSpecIds: fileSpecs.map(f => f._id.toString())
        });
        
        // Get current processing status
        const status = { ...global.processingStatus };
        logger.info('Current processing status', 'getProcessingStatus', { 
            isProcessing: status.isProcessing,
            progress: status.progress,
            totalChunks: status.totalChunks,
            processedChunks: status.processedChunks,
            currentFile: status.currentFile
        });

        // Merge file specs with status
        const mergedStatus = await mergeFileSpecs(status, fileSpecs);
        
        return formatStatusResponse(mergedStatus);
    } catch (error) {
        logger.error('Failed to get processing status', 'getProcessingStatus', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

/**
 * Merge file specs with status
 * @param {Object} status - Current processing status
 * @param {Array} fileSpecs - File specs from database
 * @returns {Object} Merged status object
 */
async function mergeFileSpecs(status, fileSpecs) {
    try {
        logger.debug('Merging file specs with status', 'mergeFileSpecs', {
            statusFilesCount: status.embeddedFiles.length,
            fileSpecsCount: fileSpecs.length
        });

        // Create set of existing fileNames
        const existingFileNames = new Set(status.embeddedFiles.map(file => file.fileName));
        
        // Filter out new files
        const newFiles = fileSpecs.filter(file => !existingFileNames.has(file.fileName));
        
        logger.debug('Filtered new files', 'mergeFileSpecs', {
            existingFilesCount: existingFileNames.size,
            newFilesCount: newFiles.length
        });

        // Merge files, replacing existing ones with the same fileName
        status.embeddedFiles = [
            ...status.embeddedFiles.filter(file => !newFiles.some(newFile => newFile.fileName === file.fileName)),
            ...newFiles
        ];
        
        logger.info('Successfully merged file specs', 'mergeFileSpecs', {
            totalFiles: status.embeddedFiles.length
        });

        return status;
    } catch (error) {
        logger.error('Failed to merge file specs', 'mergeFileSpecs', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

module.exports = {
    getProcessingStatus,
    mergeFileSpecs
};
