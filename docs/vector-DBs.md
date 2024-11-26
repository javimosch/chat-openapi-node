# Vector Database Configuration

This document explains the vector database options available in the OpenAPI Chat application and how to configure them.

## Currently Supported Vector Databases

### 1. Pinecone (Default)

**Pros:**
- Fully managed service
- High scalability
- Optimized for production workloads
- Automatic sharding and replication
- Built-in monitoring and analytics

**Cons:**
- Requires API key and cloud connectivity
- Cost increases with data volume and queries
- Limited free tier

**Configuration:**
```env
VECTOR_STORE_PROVIDER=pinecone
PINECONE_API_KEY=your_api_key
PINECONE_ENVIRONMENT=your_environment
PINECONE_INDEX=your_index
```

### 2. ChromaDB

**Pros:**
- Open-source and free
- Can run locally via Docker
- Simple setup and maintenance
- Good for development and testing
- Supports multiple embedding providers
- Active community and development

**Cons:**
- Less scalable than Pinecone
- Requires local infrastructure
- Limited production-grade features
- No built-in monitoring

**Configuration:**
```env
VECTOR_STORE_PROVIDER=chromadb
CHROMA_BASE_URL=http://localhost:8123
```

**Docker Setup:**
```yaml
services:
  chroma:
    image: chromadb/chroma:latest
    volumes:
      - ./chroma_data:/chroma/chroma
    ports:
      - "8123:8000"
    environment:
      - ALLOW_RESET=true
      - ANONYMIZED_TELEMETRY=false
```

## Switching Between Vector Databases

1. Stop your application
2. Update the `VECTOR_STORE_PROVIDER` in your `.env` file
3. Configure the chosen provider's settings
4. Start your application

Note: Vector data is not automatically migrated between providers. You'll need to reindex your data when switching providers.

## Vector Dimensions

The application handles different vector dimensions based on the embedding provider:

- **OpenAI Embeddings**: 1536 dimensions
- **Ollama (nomic-embed-text)**: 768 dimensions

The vector store service automatically handles these differences.

## Other Vector Database Alternatives

### 1. Milvus

**Pros:**
- Open-source
- High performance
- Scalable architecture
- Cloud and self-hosted options
- Rich feature set

**Cons:**
- Complex setup
- Higher resource requirements
- Steeper learning curve

### 2. Qdrant

**Pros:**
- Written in Rust for performance
- Simple HTTP API
- Can run embedded or as service
- Good documentation
- Active development

**Cons:**
- Newer in the market
- Smaller community
- Limited cloud offering

### 3. Weaviate

**Pros:**
- GraphQL-based API
- Multi-modal support
- Built-in schema management
- Cloud and self-hosted options

**Cons:**
- More complex API
- Higher resource usage
- Steeper learning curve

### 4. pgvector (PostgreSQL Extension)

**Pros:**
- Uses existing PostgreSQL infrastructure
- Simple to add to existing apps
- ACID compliance
- Familiar SQL interface

**Cons:**
- Limited scalability
- Not optimized for vector operations
- Performance trade-offs

## Choosing the Right Vector Database

Consider these factors when choosing a vector database:

1. **Scale Requirements**
   - Small scale: ChromaDB or pgvector
   - Medium scale: Qdrant or Weaviate
   - Large scale: Pinecone or Milvus

2. **Infrastructure Preferences**
   - Fully managed: Pinecone
   - Self-hosted: ChromaDB, Qdrant
   - Hybrid: Milvus, Weaviate

3. **Cost Considerations**
   - Free/Open-source: ChromaDB, pgvector
   - Usage-based: Pinecone
   - Self-hosted costs: Consider infrastructure and maintenance

4. **Feature Requirements**
   - Basic vector search: ChromaDB, pgvector
   - Advanced filtering: Pinecone, Qdrant
   - Multi-modal: Weaviate
   - Complex queries: Milvus

## Future Improvements

Planned enhancements for vector database support:

1. Add migration tools between providers
2. Support for more vector database options
3. Better monitoring and analytics
4. Automated backup and recovery
5. Performance optimization tools

## Contributing

To add support for a new vector database:

1. Create a new utility file in `utils/`
2. Implement the standard interface:
   - `initialize()`
   - `addVectors()`
   - `queryVectors()`
3. Update the vector store service
4. Add documentation
5. Create tests

See the existing implementations in `utils/pinecone.js` and `utils/chromadb.js` for examples.
