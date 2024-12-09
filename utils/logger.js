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
    new winston.transports.Console(),
    (process.env.LOG_OUTPUT || "")
      .toLowerCase() // Normalize to lowercase for comparison
      .split(",")
      .map((s) => s.trim()) // Remove leading/trailing whitespace
      .includes("file")
      ? new winston.transports.File({
          filename: process.env.LOG_FILE_PATH || `${process.cwd()}/logs/stdout.log`,
        })
      : null,
  ].filter(Boolean)
});

// Helper function to create a logger for a specific module
function createModuleLogger(moduleName) {
  const loggerInstance = {
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
    },
    trackElapsed: async function(asyncFn, loggerText, ...args) {
      const startTime = Date.now();
      try {
        await asyncFn(...args);
      } finally {
        const endTime = Date.now();
        const executionTime = (endTime - startTime) / 1000; // in seconds
        this.info(`${loggerText} in ${executionTime} seconds`, {
          args,
        });
      }
    }
  };
  
  return loggerInstance;
}

module.exports = { createModuleLogger };
