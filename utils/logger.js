const winston = require('winston');
const { format } = winston;

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Create custom format for text output
const textFormat = format.printf(({ level, message, timestamp, module, function: func, ...metadata }) => {
  let msg = `${timestamp} - [${level.toUpperCase()}] - ${message}`;
  if (module) msg += ` - ${module}`;
  if (func) msg += `.${func}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` - ${JSON.stringify(metadata)}`;
  }
  return msg;
});

// Create the logger
const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    process.env.LOG_FORMAT === 'json' ? format.json() : textFormat
  ),
  transports: [
    process.env.LOG_OUTPUT === 'file' && process.env.LOG_FILE_PATH
      ? new winston.transports.File({ filename: process.env.LOG_FILE_PATH })
      : new winston.transports.Console()
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

module.exports = { createModuleLogger };
