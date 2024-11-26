# Embedding Providers

This document explains the text embedding providers available in the OpenAPI Chat application and how to configure them.

## Currently Supported Providers

### 1. OpenAI (Default)

**Model:** text-embedding-ada-002
**Dimensions:** 1536

**Pros:**
- High-quality embeddings
- Production-ready and stable
- Consistent performance
- Well-documented
- Regular updates and improvements

**Cons:**
- Requires API key
- Cost based on usage
- Cloud-dependent
- Rate limits on free tier

**Configuration:**
```env
OLLAMA_EMBEDDING_ENABLED=0  # or remove this line
OPENAI_API_KEY=your_api_key
```

### 2. Ollama (Local)

**Model:** nomic-embed-text
**Dimensions:** 768

**Pros:**
- Free and open-source
- Runs locally
- No API key required
- No usage limits
- Privacy-friendly
- Good for development

**Cons:**
- Requires local GPU for best performance
- Quality may vary compared to OpenAI
- Higher latency on CPU
- Resource intensive

**Configuration:**
```env
OLLAMA_EMBEDDING_ENABLED=1
OLLAMA_MODEL=nomic-embed-text
OLLAMA_BASE_URL=http://localhost:11434
```

**Setup:**
1. Install Ollama: [https://ollama.ai/](https://ollama.ai/)
2. Pull the model:
```bash
ollama pull nomic-embed-text
```

## Switching Between Providers

1. Update your `.env` file with the appropriate configuration
2. Restart your application
3. Reindex your data if necessary (embedding dimensions will change)

Note: When switching providers, you may need to recreate your vector database indexes due to different vector dimensions.

## Vector Dimensions and Compatibility

Different embedding providers produce vectors of different dimensions:

| Provider | Model | Dimensions |
|----------|-------|------------|
| OpenAI | text-embedding-ada-002 | 1536 |
| Ollama | nomic-embed-text | 768 |

The application automatically handles these differences in the vector store service.

## Performance Considerations

### OpenAI
- Consistent latency (~100-200ms)
- Rate limits based on tier
- Scales automatically
- Cost: ~$0.0001 per 1K tokens

### Ollama
- Variable latency (depends on hardware)
- No rate limits
- Scales with hardware
- Cost: Free (hardware costs only)

## Other Embedding Alternatives

### 1. Hugging Face Models

**Pros:**
- Many model options
- Open-source
- Can be run locally
- Community support

**Cons:**
- Variable quality
- Setup complexity
- Resource intensive

### 2. Cohere

**Pros:**
- High-quality embeddings
- Multilingual support
- Good documentation
- Enterprise features

**Cons:**
- API key required
- Usage-based pricing
- Less community adoption

### 3. Sentence Transformers

**Pros:**
- Python-based
- Many pre-trained models
- Active development
- Research-backed

**Cons:**
- Requires Python runtime
- Memory intensive
- Setup complexity

### 4. FastAI

**Pros:**
- Simple API
- Good documentation
- Active community
- Educational focus

**Cons:**
- Limited production use
- Python dependency
- Less optimized

## Choosing the Right Provider

Consider these factors when choosing an embedding provider:

1. **Use Case Requirements**
   - Development/Testing: Ollama
   - Production: OpenAI
   - Privacy-sensitive: Ollama or self-hosted models
   - Multi-lingual: Cohere or specialized models

2. **Infrastructure Considerations**
   - Cloud-based: OpenAI, Cohere
   - On-premise: Ollama, Hugging Face
   - Hybrid: Mix based on needs

3. **Cost Analysis**
   - Free tier needs: Ollama
   - Pay-per-use: OpenAI
   - Enterprise: Cohere, OpenAI
   - Self-hosted: Consider infrastructure costs

4. **Quality Requirements**
   - Highest quality: OpenAI
   - Good enough: Ollama
   - Specialized needs: Hugging Face models
   - Research: Sentence Transformers

## Integration Examples

### OpenAI Implementation
```javascript
const { OpenAIEmbeddings } = require('@langchain/openai');

const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: 'text-embedding-ada-002'
});
```

### Ollama Implementation
```javascript
const { createOllamaEmbeddings } = require('./utils/ollama');

const embeddings = createOllamaEmbeddings({
    baseUrl: process.env.OLLAMA_BASE_URL,
    model: process.env.OLLAMA_MODEL
});
```

## Future Improvements

Planned enhancements for embedding support:

1. Add support for more providers:
   - Hugging Face models
   - Cohere
   - Custom models
2. Implement provider fallback
3. Add caching layer
4. Batch processing optimization
5. Automated quality benchmarking

## Contributing

To add support for a new embedding provider:

1. Create a new utility file in `utils/`
2. Implement the standard interface:
   - `embedDocuments(texts)`
   - `embedText(text)`
3. Update the embedding service
4. Add configuration options
5. Update documentation
6. Create tests

See the existing implementations in `utils/ollama.js` for examples.

## Troubleshooting

Common issues and solutions:

1. **OpenAI Rate Limits**
   - Implement exponential backoff
   - Use batch processing
   - Monitor usage

2. **Ollama Performance**
   - Ensure GPU availability
   - Optimize batch size
   - Monitor resource usage

3. **Dimension Mismatch**
   - Check vector store configuration
   - Verify model settings
   - Reindex if necessary

4. **Memory Issues**
   - Implement batch processing
   - Monitor resource usage
   - Adjust concurrent processing
