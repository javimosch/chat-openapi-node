const { OpenAPIChunker } = require('./chunking');
const { OpenAPICSVProcessor } = require('./csv-processor');
const { createModuleLogger } = require('./logger');
const path = require('path');

const logger = createModuleLogger('embeddings-processor');

class EmbeddingsProcessor {
  constructor() {
    this.jsonProcessor = new OpenAPIChunker();
    this.csvProcessor = new OpenAPICSVProcessor();
  }

  /**
   * Process a file and generate embeddings chunks
   */
  async processFile(fileContent, fileName) {
    logger.info('Processing file for embeddings', 'processFile', { fileName });

    try {
      const fileExtension = path.extname(fileName).toLowerCase();
      let chunks;

      if (fileExtension === '.csv') {
        chunks = await this.processCSVFile(fileContent);
      } else if (fileExtension === '.json' || fileExtension === '.yaml' || fileExtension === '.yml') {
        chunks = await this.processJSONFile(fileContent);
      } else {
        throw new Error(`Unsupported file type: ${fileExtension}`);
      }

      logger.info('File processing complete', 'processFile', {
        fileName,
        chunkCount: chunks.length
      });

      return chunks;
    } catch (error) {
      logger.error('Error processing file', 'processFile', { error, fileName });
      throw error;
    }
  }

  /**
   * Process CSV file content
   */
  async processCSVFile(fileContent) {
    logger.info('Processing CSV file', 'processCSVFile');

    try {
      // Parse CSV content
      const records = await this.csvProcessor.parseCSV(fileContent);

      // Process each row and validate
      const processedRows = [];
      for (const row of records) {
        const errors = this.csvProcessor.validateRow(row);
        if (errors.length > 0) {
          logger.warn('Validation errors in CSV row', 'processCSVFile', { errors, row });
          continue;
        }

        const processedRow = this.csvProcessor.processRow(row);
        processedRows.push(processedRow);
      }

      // Generate chunks from processed rows
      const chunks = this.csvProcessor.generateChunks(processedRows);

      logger.info('CSV processing complete', 'processCSVFile', {
        recordCount: records.length,
        chunkCount: chunks.length
      });

      return chunks;
    } catch (error) {
      logger.error('Error processing CSV file', 'processCSVFile', { error });
      throw error;
    }
  }

  /**
   * Process JSON/YAML file content
   */
  async processJSONFile(fileContent) {
    logger.info('Processing JSON/YAML file', 'processJSONFile');

    try {
      // Use existing OpenAPIChunker for JSON/YAML processing
      this.jsonProcessor.spec = typeof fileContent === 'string' ? JSON.parse(fileContent) : fileContent;
      const chunks = await this.jsonProcessor.processSpecification();

      logger.info('JSON processing complete', 'processJSONFile', {
        chunkCount: chunks.length
      });

      return chunks;
    } catch (error) {
      logger.error('Error processing JSON file', 'processJSONFile', { error });
      throw error;
    }
  }
}

module.exports = { EmbeddingsProcessor };
