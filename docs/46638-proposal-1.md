# Implementation Proposal: CSV Support for Chunking and Embedding (Tasks 1.1 & 1.2)

## Overview
This proposal outlines the implementation approach for adding CSV support to the chunking and embedding systems, based on the actual CSV structure representing OpenAPI specifications.

## Current CSV Structure

The CSV file follows this format:
```csv
ENDPOINT,METHOD,SUMMARY,DESCRIPTION,PARAMETERS,REQUEST_BODY,RESPONSES,TAGS,SECURITY,SERVERS,SCHEMAS
/path,GET,Summary text,Description text,[{...}],{...},{...},[tags],[security],[servers],{schemas}
```

Column details:
1. **ENDPOINT**: The API endpoint path
2. **METHOD**: HTTP method (GET, POST, etc.)
3. **SUMMARY**: Brief description of the endpoint
4. **DESCRIPTION**: Detailed description
5. **PARAMETERS**: JSON array of parameter objects
6. **REQUEST_BODY**: JSON object for request body schema
7. **RESPONSES**: JSON object mapping status codes to response objects
8. **TAGS**: JSON array of endpoint tags
9. **SECURITY**: JSON array of security requirements
10. **SERVERS**: JSON array of server objects
11. **SCHEMAS**: JSON object containing schema definitions

## 1.1 CSV Chunking Logic

The chunking logic will be implemented in `utils/csv-processor.js`:

1. CSV Parsing Strategy:
   ```javascript
   const csvProcessor = {
     parseCSV: async (fileContent) => {
       // Use csv-parse with following configuration
       const config = {
         columns: true,           // Use headers as column names
         skip_empty_lines: true,  // Skip empty lines
         relax_column_count: true,// Allow varying column counts
         cast: true,             // Auto-cast numbers and booleans
         delimiter: ',',          // Use comma as delimiter
       };
       
       return await parse(fileContent, config);
     },
     
     processRow: (row) => {
       return {
         endpoint: row.ENDPOINT,
         method: row.METHOD,
         summary: row.SUMMARY,
         description: row.DESCRIPTION,
         parameters: JSON.parse(row.PARAMETERS || '[]'),
         requestBody: JSON.parse(row.REQUEST_BODY || '{}'),
         responses: JSON.parse(row.RESPONSES || '{}'),
         tags: JSON.parse(row.TAGS || '[]'),
         security: JSON.parse(row.SECURITY || '[]'),
         servers: JSON.parse(row.SERVERS || '[]'),
         schemas: JSON.parse(row.SCHEMAS || '{}')
       };
     }
   };
   ```

2. Chunk Generation:
   ```javascript
   const chunkGenerator = {
     createChunks: (processedRow) => {
       const chunks = [];
       
       // Main endpoint chunk
       chunks.push({
         type: 'endpoint',
         content: {
           path: processedRow.endpoint,
           method: processedRow.method,
           summary: processedRow.summary,
           description: processedRow.description
         }
       });

       // Parameters chunks (one per parameter)
       processedRow.parameters.forEach(param => {
         chunks.push({
           type: 'parameter',
           content: {
             endpoint: processedRow.endpoint,
             method: processedRow.method,
             parameter: param
           }
         });
       });

       // Response chunks (one per status code)
       Object.entries(processedRow.responses).forEach(([status, response]) => {
         chunks.push({
           type: 'response',
           content: {
             endpoint: processedRow.endpoint,
             method: processedRow.method,
             status,
             response
           }
         });
       });

       // Schema chunks
       Object.entries(processedRow.schemas).forEach(([name, schema]) => {
         chunks.push({
           type: 'schema',
           content: {
             name,
             schema
           }
         });
       });

       return chunks;
     }
   };
   ```

3. Error Handling:
   ```javascript
   const errorHandler = {
     validateRow: (row) => {
       const required = ['ENDPOINT', 'METHOD'];
       const errors = [];

       required.forEach(field => {
         if (!row[field]) {
           errors.push(`Missing required field: ${field}`);
         }
       });

       // Validate JSON fields
       const jsonFields = ['PARAMETERS', 'REQUEST_BODY', 'RESPONSES', 'TAGS', 'SECURITY', 'SERVERS', 'SCHEMAS'];
       jsonFields.forEach(field => {
         if (row[field]) {
           try {
             JSON.parse(row[field]);
           } catch (e) {
             errors.push(`Invalid JSON in field ${field}: ${e.message}`);
           }
         }
       });

       return errors;
     }
   };
   ```

## 1.2 CSV Embedding Logic

Extend the embedding system in `utils/embeddings.js`:

1. Chunk-specific embedding templates:
   ```javascript
   const embedTemplates = {
     endpoint: (chunk) => `
       ${chunk.method} ${chunk.path}
       Summary: ${chunk.summary}
       Description: ${chunk.description}
     `,
     
     parameter: (chunk) => `
       Parameter for ${chunk.method} ${chunk.endpoint}:
       ${chunk.parameter.name} (${chunk.parameter.in})
       Type: ${chunk.parameter.schema?.type}
       Description: ${chunk.parameter.description}
     `,
     
     response: (chunk) => `
       Response ${chunk.status} for ${chunk.method} ${chunk.endpoint}:
       ${chunk.response.description}
     `,
     
     schema: (chunk) => `
       Schema ${chunk.name}:
       ${JSON.stringify(chunk.schema)}
     `
   };
   ```

## Technical Requirements

### Dependencies
```json
{
  "csv-parse": "^4.16.3",
  "csv-stringify": "^6.2.0"
}
```

### Configuration
```env
CSV_DELIMITER=","               # CSV delimiter character
CSV_VALIDATE_HEADERS=true       # Validate CSV headers match expected format
CSV_ESCAPE_CHAR="\""           # Character for escaping special chars
CSV_RELAX_COLUMN_COUNT=true    # Allow varying column counts
```

## Implementation Steps

1. CSV Processing (3 days)
   - Implement CSV parser with proper JSON field handling
   - Create row processor with validation
   - Add error handling for malformed JSON

2. Chunking System (3 days)
   - Create chunk generators for different aspects
   - Implement JSON field parsing
   - Add validation for required fields

3. Embedding System (2 days)
   - Create type-specific embedding templates
   - Implement field-specific embedding strategies
   - Add JSON content handling

4. Testing (2 days)
   - Unit tests for CSV parsing and JSON handling
   - Integration tests for chunking
   - Embedding accuracy tests
   - Performance testing with large CSV files

Total estimated time: 10 days
