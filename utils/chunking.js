const { v4: uuidv4 } = require('uuid');
const { createModuleLogger } = require('./logger');
const logger = createModuleLogger('chunking');

/**
 * Chunks an OpenAPI specification into smaller, meaningful pieces
 */
class OpenAPIChunker {
  constructor(specification) {
    this.spec = specification;
    this.specId = uuidv4();
  }

  /**
   * Process the OpenAPI specification and generate all chunks
   */
  async processSpecification() {
    logger.info('Starting specification processing', 'processSpecification');
    
    try {
      const chunks = [
        ...await this.createInfoChunk(),
        ...await this.createPathChunks(),
        ...await this.createComponentChunks(),
        ...await this.createSchemaChunks()
      ];

      logger.info('Specification processing complete', 'processSpecification', {
        totalChunks: chunks.length
      });

      return chunks;
    } catch (error) {
      logger.error('Error processing specification', 'processSpecification', { error });
      throw error;
    }
  }

  /**
   * Create a chunk for the API info section
   */
  async createInfoChunk() {
    logger.debug('Creating info chunk', 'createInfoChunk');
    
    const { info } = this.spec;
    if (!info) return [];

    const chunk = {
      text: this.formatInfoText(info),
      metadata: {
        spec_id: this.specId,
        chunk_id: uuidv4(),
        component_type: 'info'
      }
    };

    return [chunk];
  }

  /**
   * Create chunks for each path+method combination
   */
  async createPathChunks() {
    logger.debug('Creating path chunks', 'createPathChunks');
    
    const chunks = [];
    const { paths } = this.spec;
    
    if (!paths) return chunks;

    for (const [path, pathItem] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (typeof operation !== 'object') continue;

        const { text, metadata: schemaMetadata } = this.formatPathText(path, method, operation);

        const chunk = {
          text,
          metadata: {
            spec_id: this.specId,
            chunk_id: uuidv4(),
            path,
            method: method.toUpperCase(),
            component_type: 'path',
            ...schemaMetadata
          }
        };

        chunks.push(chunk);
        logger.debug('Created path chunk', 'createPathChunks', { 
          path, 
          method,
          requestSchemas: schemaMetadata.request_schemas,
          responseSchemas: schemaMetadata.response_schemas
        });
      }
    }

    return chunks;
  }

  /**
   * Create chunks for each component
   */
  async createComponentChunks() {
    logger.debug('Creating component chunks', 'createComponentChunks');
    
    const chunks = [];
    const { components } = this.spec;
    
    if (!components) return chunks;

    for (const [componentType, componentGroup] of Object.entries(components)) {
      if (componentType === 'schemas') continue; // Skip schemas, handled separately
      for (const [name, component] of Object.entries(componentGroup)) {
        const chunk = {
          text: this.formatComponentText(componentType, name, component),
          metadata: {
            spec_id: this.specId,
            chunk_id: uuidv4(),
            component_type: componentType,
            component_name: name
          }
        };

        chunks.push(chunk);
        logger.debug('Created component chunk', 'createComponentChunks', { 
          componentType, 
          name 
        });
      }
    }

    return chunks;
  }

  /**
   * Create chunks for schema components
   */
  async createSchemaChunks() {
    logger.debug('Creating schema chunks', 'createSchemaChunks');
    
    const chunks = [];
    const { components } = this.spec;
    
    if (!components?.schemas) return chunks;

    for (const [schemaName, schema] of Object.entries(components.schemas)) {
      const text = [
        `Schema: ${schemaName}`,
        `Description: ${schema.description || 'No description'}`,
        'Properties:',
        ...Object.entries(schema.properties || {}).map(([propName, prop]) => {
          const type = Array.isArray(prop.type) ? prop.type.join(' | ') : prop.type;
          const required = prop.required ? ' (required)' : '';
          const format = prop.format ? ` (format: ${prop.format})` : '';
          const defaultValue = prop.default ? ` (default: ${prop.default})` : '';
          return `- ${propName}: ${type}${required}${format}${defaultValue}`;
        })
      ].join('\n');

      const chunk = {
        text,
        metadata: {
          spec_id: this.specId,
          chunk_id: uuidv4(),
          component_type: 'schemas',
          component_name: schemaName,
          schema_type: schema.type,
          schema_format: schema.format,
          schema_properties: Object.keys(schema.properties || {}),
          schema_required: schema.required || []
        }
      };

      chunks.push(chunk);
      logger.debug('Created schema chunk', 'createSchemaChunks', { schemaName });
    }

    return chunks;
  }

  /**
   * Format info section text
   */
  formatInfoText(info) {
    const parts = [];
    
    if (info.title) parts.push(`API Title: ${info.title}`);
    if (info.version) parts.push(`Version: ${info.version}`);
    if (info.description) parts.push(`Description: ${info.description}`);
    
    return parts.join('\n');
  }

  /**
   * Format path operation text
   */
  formatPathText(path, method, operation) {
    const parts = [];
    const schemaRefs = {
      request: new Set(),
      response: new Set(),
      requestDetails: [],  
      responseDetails: []  
    };
    
    if (operation.summary) parts.push(operation.summary);
    if (operation.description) parts.push(operation.description);
    
    parts.push(`${method.toUpperCase()} ${path}`);

    // Handle request body schemas
    if (operation.requestBody?.content) {
      parts.push('\nRequest Body:');
      Object.entries(operation.requestBody.content).forEach(([contentType, content]) => {
        if (content.schema) {
          const schemaRef = content.schema.$ref;
          if (schemaRef) {
            const schemaName = schemaRef.split('/').pop();
            schemaRefs.request.add(schemaName);
            const schema = this.resolveSchemaRef(schemaRef);
            if (schema) {
              schemaRefs.requestDetails.push(
                `${schemaName}:${contentType}`,
                ...((schema.required || []).map(prop => `required:${prop}`)),
                ...(Object.keys(schema.properties || {}).map(prop => `property:${prop}`))
              );
              
              parts.push(`\nContent-Type: ${contentType}`);
              parts.push(`Schema (${schemaName}):`);
              Object.entries(schema.properties || {}).forEach(([propName, prop]) => {
                const type = Array.isArray(prop.type) ? prop.type.join(' | ') : prop.type;
                const required = schema.required?.includes(propName) ? ' (required)' : '';
                parts.push(`- ${propName}: ${type}${required}`);
              });
            }
          }
        }
      });
    }

    // Handle response schemas
    if (operation.responses) {
      parts.push('\nResponses:');
      Object.entries(operation.responses).forEach(([code, response]) => {
        parts.push(`\n${code}: ${response.description || 'No description'}`);
        if (response.content) {
          Object.entries(response.content).forEach(([contentType, content]) => {
            if (content.schema) {
              const schemaRef = content.schema.$ref;
              if (schemaRef) {
                const schemaName = schemaRef.split('/').pop();
                schemaRefs.response.add(schemaName);
                const schema = this.resolveSchemaRef(schemaRef);
                if (schema) {
                  schemaRefs.responseDetails.push(
                    `${schemaName}:${contentType}:${code}`,
                    ...(Object.keys(schema.properties || {}).map(prop => `property:${prop}`))
                  );
                }
              }
            }
          });
        }
      });
    }

    return {
      text: parts.join('\n'),
      metadata: {
        request_schemas: Array.from(schemaRefs.request),
        response_schemas: Array.from(schemaRefs.response),
        request_schema_details: schemaRefs.requestDetails,
        response_schema_details: schemaRefs.responseDetails
      }
    };
  }

  /**
   * Resolve schema reference
   */
  resolveSchemaRef(ref) {
    try {
      const parts = ref.split('/');
      let current = this.spec;
      
      // Skip the first empty part and '#'
      for (let i = 1; i < parts.length; i++) {
        current = current[parts[i]];
        if (!current) return null;
      }
      
      // If this schema has nested references, resolve them too
      if (current && typeof current === 'object') {
        const resolvedSchema = { ...current };
        
        // Resolve property references
        if (resolvedSchema.properties) {
          Object.entries(resolvedSchema.properties).forEach(([propName, propSchema]) => {
            if (propSchema.$ref) {
              resolvedSchema.properties[propName] = this.resolveSchemaRef(propSchema.$ref) || propSchema;
            }
          });
        }
        
        // Resolve array item references
        if (resolvedSchema.items && resolvedSchema.items.$ref) {
          resolvedSchema.items = this.resolveSchemaRef(resolvedSchema.items.$ref) || resolvedSchema.items;
        }
        
        return resolvedSchema;
      }
      
      return current;
    } catch (error) {
      logger.error('Error resolving schema reference', 'resolveSchemaRef', { ref, error });
      return null;
    }
  }

  /**
   * Format component text
   */
  formatComponentText(type, name, component) {
    // Special handling for security schemes
    if (type === 'securitySchemes') {
      const parts = [`Security Scheme: ${name}`];
      
      if (component.type) parts.push(`Type: ${component.type}`);
      if (component.description) parts.push(`Description: ${component.description}`);
      
      // OAuth2 specific fields
      if (component.type === 'oauth2') {
        if (component.flows) {
          parts.push('OAuth2 Flows:');
          Object.entries(component.flows).forEach(([flowType, flow]) => {
            parts.push(`\n${flowType}:`);
            if (flow.authorizationUrl) parts.push(`  Authorization URL: ${flow.authorizationUrl}`);
            if (flow.tokenUrl) parts.push(`  Token URL: ${flow.tokenUrl}`);
            if (flow.refreshUrl) parts.push(`  Refresh URL: ${flow.refreshUrl}`);
            if (flow.scopes) {
              parts.push('  Scopes:');
              Object.entries(flow.scopes).forEach(([scope, desc]) => {
                parts.push(`    ${scope}: ${desc}`);
              });
            }
          });
        }
      }
      
      // OpenID Connect specific fields
      else if (component.type === 'openIdConnect') {
        if (component.openIdConnectUrl) {
          parts.push(`OpenID Connect URL: ${component.openIdConnectUrl}`);
        }
      }
      
      // HTTP specific fields
      else if (component.type === 'http') {
        if (component.scheme) parts.push(`Scheme: ${component.scheme}`);
        if (component.bearerFormat) parts.push(`Bearer Format: ${component.bearerFormat}`);
      }
      
      // API Key specific fields
      else if (component.type === 'apiKey') {
        if (component.in) parts.push(`Location: ${component.in}`);
        if (component.name) parts.push(`Name: ${component.name}`);
      }

      return parts.join('\n');
    }
    
    // Default handling for other components
    return `${type} ${name}:\n${JSON.stringify(component, null, 2)}`;
  }
}

module.exports = { OpenAPIChunker };
