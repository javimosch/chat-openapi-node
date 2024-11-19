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
        ...await this.createComponentChunks()
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

        const chunk = {
          text: this.formatPathText(path, method, operation),
          metadata: {
            spec_id: this.specId,
            chunk_id: uuidv4(),
            path,
            method: method.toUpperCase(),
            component_type: 'path'
          }
        };

        chunks.push(chunk);
        logger.debug('Created path chunk', 'createPathChunks', { path, method });
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
    
    if (operation.summary) parts.push(operation.summary);
    if (operation.description) parts.push(operation.description);
    
    parts.push(`${method.toUpperCase()} ${path}`);

    // Add security information
    if (operation.security || this.spec.security) {
      const security = operation.security || this.spec.security;
      parts.push('\nSecurity Requirements:');
      security.forEach(requirement => {
        Object.entries(requirement).forEach(([scheme, scopes]) => {
          parts.push(`- ${scheme}${scopes.length ? ` (scopes: ${scopes.join(', ')})` : ''}`);
        });
      });
    }

    if (operation.parameters) {
      const params = operation.parameters.map(p => 
        `${p.name} (${p.in}): ${p.description || 'No description'}`
      );
      parts.push('\nParameters:', ...params);
    }

    if (operation.requestBody) {
      parts.push('\nRequest Body:', 
        JSON.stringify(operation.requestBody, null, 2));
    }

    if (operation.responses) {
      const responses = Object.entries(operation.responses)
        .map(([code, res]) => `${code}: ${res.description || 'No description'}`);
      parts.push('\nResponses:', ...responses);
    }

    return parts.join('\n');
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
