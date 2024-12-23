const csvParse = require('csv-parse');
const { v4: uuidv4 } = require('uuid');
const { createModuleLogger } = require('./logger');

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

            return {
                records: { records },
                info: {
                    lines: records.length + 1,
                    records: records.length
                }
            };
        } catch (error) {
            logger.error('Error parsing CSV', 'parseCSV', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Generate chunks from CSV records
     */
    async generateChunks(records) {
        const { records: rows, info } = records;
        logger.info('Generating chunks from CSV records', 'generateChunks', {
            recordCount: rows.length,
            totalLines: info.lines
        });

        const chunks = [];
        const errors = [];

        for (let i = 0; i < rows.length; i++) {
            const record = rows[i];
            const lineNumber = i + 2; // Add 2 to account for 0-based index and header row

            try {
                logger.debug('Processing record', 'generateChunks', {
                    lineNumber,
                    endpoint: record.ENDPOINT,
                    method: record.METHOD
                });

                // Validate required fields
                if (!record.ENDPOINT || !record.METHOD) {
                    throw new Error('Missing required fields: ENDPOINT and METHOD are required');
                }

                // Parse JSON strings in fields if they exist
                const parameters = this.parseJsonField(record.PARAMETERS, 'PARAMETERS', lineNumber);
                const requestBody = this.parseJsonField(record.REQUEST_BODY, 'REQUEST_BODY', lineNumber);
                const responses = this.parseJsonField(record.RESPONSES, 'RESPONSES', lineNumber);
                const security = this.parseJsonField(record.SECURITY, 'SECURITY', lineNumber);
                const servers = this.parseJsonField(record.SERVERS, 'SERVERS', lineNumber);
                const schemas = this.parseJsonField(record.SCHEMAS, 'SCHEMAS', lineNumber);

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
                        parameters,
                        requestBody,
                        responses,
                        security,
                        servers,
                        schemas,
                        tags: record.TAGS ? record.TAGS.split(',').map(t => t.trim()) : []
                    }
                };

                chunks.push(chunk);
                logger.debug('Successfully processed record', 'generateChunks', {
                    lineNumber,
                    endpoint: record.ENDPOINT
                });
            } catch (error) {
                const errorInfo = {
                    lineNumber,
                    endpoint: record.ENDPOINT,
                    method: record.METHOD,
                    error: error.message
                };
                errors.push(errorInfo);
                logger.error('Error processing record', 'generateChunks', errorInfo);
                // Continue processing other records
            }
        }

        // Log summary
        logger.info('Chunk generation complete', 'generateChunks', {
            totalRecords: rows.length,
            successfulChunks: chunks.length,
            failedRecords: errors.length,
            errors: errors
        });

        if (errors.length > 0) {
            throw new Error(`Failed to process ${errors.length} records. Check logs for details.`);
        }

        return chunks;
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
}

module.exports = { OpenAPICSVProcessor };
