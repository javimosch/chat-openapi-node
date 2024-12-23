const csvParse = require('csv-parse');
const { v4: uuidv4 } = require('uuid');
const { createModuleLogger } = require('./logger');
const path = require('path');
const Metadata = require('../models/metadata');

const logger = createModuleLogger('csv-processor');

class OpenAPICSVProcessor {
    constructor() {
        this.specId = uuidv4();
    }

    /**
     * Pre-process CSV content to handle escaped JSON fields
     */
    preprocessCSV(content) {
        // Split into lines
        const lines = content.split('\n');
        const header = lines[0];
        
        // Process each data line
        const processedLines = lines.slice(1).map(line => {
            // Find all JSON-like fields (starting with [ or {)
            const parts = [];
            let inQuote = false;
            let currentPart = '';
            let char;
            
            for (let i = 0; i < line.length; i++) {
                char = line[i];
                
                if (char === '"' && (i === 0 || line[i-1] !== '\\')) {
                    inQuote = !inQuote;
                }
                
                if (char === ',' && !inQuote) {
                    // End of field
                    parts.push(currentPart);
                    currentPart = '';
                } else {
                    currentPart += char;
                }
            }
            if (currentPart) {
                parts.push(currentPart);
            }

            // Process each part
            const processedParts = parts.map(part => {
                // If it looks like JSON (starts with [ or {)
                if (part.trim().match(/^["']?\[/) || part.trim().match(/^["']?\{/)) {
                    // Remove surrounding quotes if present
                    part = part.trim().replace(/^["']|["']$/g, '');
                    // Fix double-escaped quotes
                    part = part.replace(/\\"\\"/g, '"').replace(/\\\\/g, '\\');
                    return `"${part}"`;
                }
                return part;
            });

            return processedParts.join(',');
        });

        // Reconstruct CSV
        return [header, ...processedLines].join('\n');
    }

    /**
     * Parse CSV content with OpenAPI specifications, storing raw string values
     */
    async parseCSV(fileContent) {
        logger.info('Starting CSV parsing', 'parseCSV');

        try {
            // Split into lines and get headers
            const lines = fileContent.trim().split('\n');
            const headers = lines[0].split(',');
            
            logger.debug('CSV headers', 'parseCSV', { headers });

            // Process each line
            const records = [];
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                const record = {};
                let currentPos = 0;
                let currentField = '';
                let inQuotes = false;

                // Parse each field in the line
                for (let j = 0; j < headers.length; j++) {
                    currentField = '';
                    inQuotes = false;

                    // Skip leading whitespace
                    while (currentPos < line.length && line[currentPos] === ' ') {
                        currentPos++;
                    }

                    // Handle quoted field
                    if (line[currentPos] === '"') {
                        inQuotes = true;
                        currentPos++; // Skip opening quote
                        
                        while (currentPos < line.length) {
                            if (line[currentPos] === '"' && line[currentPos + 1] === '"') {
                                // Handle escaped quote
                                currentField += '"';
                                currentPos += 2;
                            } else if (line[currentPos] === '"') {
                                // End of quoted field
                                currentPos++;
                                break;
                            } else {
                                currentField += line[currentPos];
                                currentPos++;
                            }
                        }
                    } else {
                        // Handle unquoted field
                        while (currentPos < line.length && line[currentPos] !== ',') {
                            currentField += line[currentPos];
                            currentPos++;
                        }
                    }

                    // Store raw field value
                    const fieldName = headers[j].trim();
                    record[fieldName] = currentField.trim();

                    // Skip comma
                    if (currentPos < line.length && line[currentPos] === ',') {
                        currentPos++;
                    }
                }

                records.push(record);
            }

            logger.info('CSV parsing complete', 'parseCSV', {
                totalRecords: records.length,
                firstRecord: records[0] ? Object.keys(records[0]) : []
            });

            return records;

        } catch (error) {
            logger.error('Failed to parse CSV', 'parseCSV', { error });
            throw new Error(`Failed to parse CSV: ${error.message}`);
        }
    }

    /**
     * Generate chunks from CSV records
     */
    async generateChunks(records) {
        const chunks = [];
        const errors = [];

        logger.info('Starting chunk generation', 'generateChunks', {
            recordCount: records.length
        });

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const lineNumber = i + 2; // Add 2 to account for 0-based index and header row

            try {
                // Skip records without required fields
                if (!record.ENDPOINT || !record.METHOD) {
                    errors.push({
                        lineNumber,
                        endpoint: record.ENDPOINT || '',
                        method: record.METHOD || '',
                        error: 'Missing required fields: ENDPOINT and METHOD are required'
                    });
                    continue; // Skip this record but continue processing
                }

                // Create chunk with metadata
                const chunk = {
                    text: this.formatEndpointText(record, lineNumber),
                    metadata: {
                        spec_id: this.specId,
                        type: 'endpoint',
                        endpoint: record.ENDPOINT,
                        method: record.METHOD,
                        summary: record.SUMMARY,
                        description: record.DESCRIPTION,
                        line_number: lineNumber,
                        vector_id: `${this.specId}-${lineNumber}`, // Add vector_id for Pinecone
                        parameters: this.parseJsonField(record.PARAMETERS, 'PARAMETERS', lineNumber),
                        requestBody: this.parseJsonField(record.REQUEST_BODY, 'REQUEST_BODY', lineNumber),
                        responses: this.parseJsonField(record.RESPONSES, 'RESPONSES', lineNumber),
                        security: this.parseJsonField(record.SECURITY, 'SECURITY', lineNumber),
                        servers: this.parseJsonField(record.SERVERS, 'SERVERS', lineNumber),
                        schemas: this.parseJsonField(record.SCHEMAS, 'SCHEMAS', lineNumber),
                        tags: record.TAGS ? record.TAGS.split(',').map(t => t.trim()) : []
                    }
                };

                logger.info('Creating chunk from row', 'generateChunks', {
                    lineNumber,
                    endpoint: record.ENDPOINT,
                    method: record.METHOD
                });

                chunks.push(chunk);
                logger.debug('Successfully processed record', 'generateChunks', {
                    lineNumber,
                    endpoint: record.ENDPOINT,
                    method: record.METHOD
                });

            } catch (error) {
                logger.error('Error processing record', 'generateChunks', {
                    lineNumber,
                    endpoint: record.ENDPOINT || '',
                    method: record.METHOD || '',
                    error: error.message
                });
                errors.push({
                    lineNumber,
                    endpoint: record.ENDPOINT || '',
                    method: record.METHOD || '',
                    error: error.message
                });
                // Continue processing other records
            }
        }

        // Log summary
        logger.info('Chunk generation complete', 'generateChunks', {
            totalRecords: records.length,
            successfulChunks: chunks.length,
            failedRecords: errors.length,
            errors
        });

        // Only throw if all records failed
        if (chunks.length === 0) {
            throw new Error('Failed to process any records. Check logs for details.');
        }

        return { chunks, errors }; // Return both chunks and errors
    }

    /**
     * Create a chunk from a CSV row
     */
    createChunkFromRow(row) {
        const text = this.formatEndpointText(row);
        const endpoint = row.ENDPOINT;
        const method = row.METHOD;

        return {
            text,
            metadata: {
                endpoint,
                method,
                vector_id: `${endpoint}-${method}`.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                type: 'endpoint',
                spec_id: this.specId
            }
        };
    }

    /**
     * Parse a potential JSON field
     */
    parseJsonField(field, fieldName, lineNumber) {
        if (!field) return null;
        try {
            // Log the raw field value for debugging
            logger.debug('Parsing JSON field', 'parseJsonField', {
                fieldName,
                lineNumber,
                rawValue: field.substring(0, 200) + (field.length > 200 ? '...' : ''),
                type: typeof field
            });

            // If it's the SCHEMAS field, check for the simpler format first
            if (fieldName === 'SCHEMAS' && typeof field === 'string' && !field.startsWith('{') && !field.startsWith('[')) {
                // Parse simpler schema format: name,type,...
                const schemaLines = field.split('\n').filter(line => line.trim().startsWith('schema,'));
                if (schemaLines.length > 0) {
                    const schemas = {};
                    schemaLines.forEach(line => {
                        const [_, name, ...rest] = line.split(',');
                        if (name) {
                            const properties = {};
                            const propertyDefs = rest.join(',').split(';');
                            propertyDefs.forEach(def => {
                                const [propName, propType] = def.split(':');
                                if (propName && propType) {
                                    properties[propName.trim()] = {
                                        type: propType.trim()
                                    };
                                }
                            });
                            schemas[name.trim()] = {
                                type: 'object',
                                properties
                            };
                        }
                    });
                    
                    logger.debug('Parsed simple schema format', 'parseJsonField', {
                        fieldName,
                        lineNumber,
                        schemaCount: Object.keys(schemas).length,
                        schemaNames: Object.keys(schemas)
                    });
                    
                    return schemas;
                }
            }

            // Try parsing as JSON
            const parsed = typeof field === 'string' ? JSON.parse(field) : field;
            
            // Log the parsed result
            logger.debug('Parsed JSON field result', 'parseJsonField', {
                fieldName,
                lineNumber,
                hasValue: !!parsed,
                type: typeof parsed,
                isArray: Array.isArray(parsed),
                keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
                preview: JSON.stringify(parsed).substring(0, 100) + '...'
            });

            return parsed;
        } catch (error) {
            logger.warn('Failed to parse JSON field', 'parseJsonField', {
                fieldName,
                lineNumber,
                error: error.message,
                rawValue: field.substring(0, 200) + (field.length > 200 ? '...' : ''),
                type: typeof field
            });
            return null; // Return null instead of unparsed field on error
        }
    }

    /**
     * Format endpoint text for embedding
     */
    formatEndpointText(record, lineNumber) {
        const parts = [];
        
        parts.push(`Endpoint: ${record.METHOD} ${record.ENDPOINT}`);
        if (record.SUMMARY) parts.push(`Summary: ${record.SUMMARY}`);
        if (record.DESCRIPTION) parts.push(`Description: ${record.DESCRIPTION}`);
        
        if (record.PARAMETERS) {
            const params = this.parseJsonField(record.PARAMETERS, 'PARAMETERS', lineNumber);
            if (Array.isArray(params)) {
                parts.push('Parameters:');
                params.forEach(param => {
                    parts.push(`- ${param.name} (${param.in}): ${param.description || 'No description'}`);
                });
            }
        }

        if (record.RESPONSES) {
            const responses = this.parseJsonField(record.RESPONSES, 'RESPONSES', lineNumber);
            if (typeof responses === 'object') {
                parts.push('Responses:');
                Object.entries(responses).forEach(([code, details]) => {
                    parts.push(`- ${code}: ${details.description || 'No description'}`);
                });
            }
        }

        return parts.join('\n');
    }

    /**
     * Process a CSV row and store metadata in MongoDB
     */
    async processCSVRowAndStoreMetadata(row, csvFilePath) {
        try {
            const endpoint = row.ENDPOINT;
            const method = row.METHOD;

            if (!endpoint || !method) {
                throw new Error('Missing required fields: ENDPOINT and METHOD');
            }

            // Create metadata fields
            const metadataFields = {
                endpoint,
                method,
                summary: row.SUMMARY || '',
                description: row.DESCRIPTION || '',
                parameters: row.PARAMETERS || '',
                requestBody: row.REQUEST_BODY || '',
                responses: row.RESPONSES || '',
                security: row.SECURITY || '',
                servers: row.SERVERS || '',
                schemas: row.SCHEMAS || '',
                tags: row.TAGS ? row.TAGS.split(',').map(t => t.trim()) : [],
                filepath: csvFilePath,
                vector_id: `${endpoint}-${method}`.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                file_name: path.basename(csvFilePath),
                chunk_index: 0,
                is_file_metadata: false,
                spec_id: this.specId,
                type: 'endpoint'
            };

            // Log the metadata being saved
            logger.debug('Saving metadata', 'processCSVRowAndStoreMetadata', {
                endpoint,
                method,
                vector_id: metadataFields.vector_id
            });

            // Update or create metadata in MongoDB
            const result = await Metadata.findOneAndUpdate(
                { endpoint, method },
                { $set: metadataFields },
                { 
                    upsert: true, 
                    new: true,
                    runValidators: true 
                }
            );

            return {
                status: 'updated',
                endpoint,
                method,
                mongoId: result._id
            };

        } catch (error) {
            logger.error('Failed to process CSV row', 'processCSVRowAndStoreMetadata', {
                error: error.message,
                row
            });
            return {
                status: 'error',
                error: error.message,
                endpoint: row.ENDPOINT,
                method: row.METHOD
            };
        }
    }

    /**
     * Process multiple CSV rows and store metadata
     */
    async processCSVRowsAndStoreMetadata(rows, csvFilePath) {
        logger.info('Processing CSV rows', 'processCSVRowsAndStoreMetadata', {
            rowCount: rows.length,
            csvFile: path.basename(csvFilePath)
        });

        const results = [];
        for (const row of rows) {
            const result = await this.processCSVRowAndStoreMetadata(row, csvFilePath);
            results.push(result);
        }

        const successCount = results.filter(r => r.status === 'updated').length;
        const errorCount = results.filter(r => r.status === 'error').length;

        logger.info('Finished processing CSV rows', 'processCSVRowsAndStoreMetadata', {
            total: results.length,
            success: successCount,
            error: errorCount
        });

        return results;
    }
}

module.exports = { OpenAPICSVProcessor };
