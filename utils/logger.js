const winston = require('winston');
const util = require('util');

// Helper function to pretty print objects
function prettyFormat(obj) {
    // Filter out winston internal symbols
    const cleanObj = Object.entries(obj).reduce((acc, [key, value]) => {
        if (typeof key === 'string' && !key.startsWith('Symbol(')) {
            acc[key] = value;
        }
        return acc;
    }, {});

    return util.inspect(cleanObj, {
        colors: true,
        depth: null, // Show all levels
        maxArrayLength: null, // Show all array elements
        compact: false,
        breakLength: 80
    });
}

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Create custom format for text output
const textFormat = winston.format.printf(({ timestamp, level, message, module, ...rest }) => {
  // Format metadata object for better readability
  let formattedMetadata = '';
  
  if (rest.summary) {
    formattedMetadata = '\n=== Summary ===\n';
    const summary = rest.summary;
    formattedMetadata += `• Total Files: ${summary.totalFiles}\n`;
    formattedMetadata += `• Existing Files: ${summary.existingFiles}\n`;
    formattedMetadata += `• Missing Files: ${summary.missingFiles}\n`;
    formattedMetadata += `• Vectors Repaired: ${summary.vectorsRepaired}\n`;
    formattedMetadata += `• MongoDB Records:\n`;
    formattedMetadata += `  - Created: ${summary.mongoRecordsCreated}\n`;
    formattedMetadata += `  - Updated: ${summary.mongoRecordsUpdated}\n`;
    formattedMetadata += `  - Unchanged: ${summary.mongoRecordsOk}\n`;
    formattedMetadata += `  - Errors: ${summary.mongoErrors}`;
  } else if (rest.files) {
    formattedMetadata = '\n=== File Details ===\n';
    rest.files.forEach(file => {
      formattedMetadata += `• ${file.fileName}\n`;
      formattedMetadata += `  - Status: ${file.status}\n`;
      formattedMetadata += `  - Pinecone Chunks: ${file.chunks}\n`;
      formattedMetadata += `  - Chunks Repaired: ${file.repairedChunks}\n`;
      formattedMetadata += `  - MongoDB: ${file.mongoStatus}\n`;
    });
  } else if (Object.keys(rest).length > 0) {
    formattedMetadata = '\n' + prettyFormat(rest);
  }

  return `${timestamp} - [${level.toUpperCase()}] - ${message} - ${module}${formattedMetadata}`;
});

// Create the logger
const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    process.env.LOG_FORMAT === 'json' ? winston.format.json() : textFormat
  ),
  transports: [
    process.env.LOG_OUTPUT === 'file' && process.env.LOG_FILE_PATH
      ? new winston.transports.File({ filename: process.env.LOG_FILE_PATH })
      : new winston.transports.Console({
          // Enable colors in console output
          format: winston.format.combine(
            winston.format.colorize({
              all: true,
              colors: {
                info: 'blue',
                warn: 'yellow',
                error: 'red',
                debug: 'grey'
              }
            })
          )
        })
  ].filter(Boolean)
});

// Helper function to create a logger for a specific module
function createModuleLogger(moduleName) {
  return {
    error: (message, func = '', meta = {}) => {
      logger.error(message, { module: moduleName, function: func, ...meta });
    },
    warn: (message, func = '', meta = {}) => {
      logger.warn(message, { module: moduleName, function: func, ...meta });
    },
    info: (message, func = '', meta = {}) => {
      logger.info(message, { module: moduleName, function: func, ...meta });
    },
    debug: (message, func = '', meta = {}) => {
      logger.debug(message, { module: moduleName, function: func, ...meta });
    }
  };
}

module.exports = { createModuleLogger, prettyFormat };
