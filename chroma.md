# Chroma OpenAPI Specification

## API Endpoints

### Version 1

- **GET** `/api/v1` - Root
- **POST** `/api/v1/reset` - Reset
- **GET** `/api/v1/version` - Version
- **GET** `/api/v1/heartbeat` - Heartbeat
- **GET** `/api/v1/pre-flight-checks` - Pre Flight Checks
- **POST** `/api/v1/databases` - Create Database V1
- **GET** `/api/v1/databases/{database}` - Get Database V1
- **POST** `/api/v1/tenants` - Create Tenant V1
- **GET** `/api/v1/tenants/{tenant}` - Get Tenant V1
- **GET** `/api/v1/collections` - List Collections V1
- **POST** `/api/v1/collections` - Create Collection V1
- **GET** `/api/v1/count_collections` - Count Collections V1
- **POST** `/api/v1/collections/{collection_id}/add` - Add V1
- **POST** `/api/v1/collections/{collection_id}/update` - Update V1
- **POST** `/api/v1/collections/{collection_id}/upsert` - Upsert V1
- **POST** `/api/v1/collections/{collection_id}/get` - Get V1
- **POST** `/api/v1/collections/{collection_id}/delete` - Delete V1
- **GET** `/api/v1/collections/{collection_id}/count` - Count V1
- **POST** `/api/v1/collections/{collection_id}/query` - Get Nearest Neighbors V1
- **GET** `/api/v1/collections/{collection_name}` - Get Collection V1
- **DELETE** `/api/v1/collections/{collection_name}` - Delete Collection V1
- **PUT** `/api/v1/collections/{collection_id}` - Update Collection V1

### Version 2

- **GET** `/api/v2` - Root
- **POST** `/api/v2/reset` - Reset
- **GET** `/api/v2/version` - Version
- **GET** `/api/v2/heartbeat` - Heartbeat
- **GET** `/api/v2/pre-flight-checks` - Pre Flight Checks
- **GET** `/api/v2/auth/identity` - Get User Identity
- **POST** `/api/v2/tenants/{tenant}/databases` - Create Database
- **GET** `/api/v2/tenants/{tenant}/databases/{database_name}` - Get Database
- **POST** `/api/v2/tenants` - Create Tenant
- **GET** `/api/v2/tenants/{tenant}` - Get Tenant
- **GET** `/api/v2/tenants/{tenant}/databases/{database_name}/collections` - List Collections
- **POST** `/api/v2/tenants/{tenant}/databases/{database_name}/collections` - Create Collection
- **GET** `/api/v2/tenants/{tenant}/databases/{database_name}/collections_count` - Count Collections
- **POST** `/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/add` - Add
- **POST** `/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/update` - Update
- **POST** `/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/upsert` - Upsert
- **POST** `/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/get` - Get
- **POST** `/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/delete` - Delete
- **GET** `/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/count` - Count
- **POST** `/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/query` - Get Nearest Neighbors
- **GET** `/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_name}` - Get Collection
- **DELETE** `/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_name}` - Delete Collection
- **PUT** `/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}` - Update Collection

## Client Specification

### JavaScript Client

The Chroma JavaScript client allows you to interact with the Chroma server from your JavaScript applications. Below are the main methods available in the client:

#### Installation

To install the Chroma JavaScript client, use one of the following package managers:

```bash
# Using yarn
yarn add chromadb chromadb-default-embed

# Using npm
npm install chromadb chromadb-default-embed

# Using pnpm
pnpm add chromadb chromadb-default-embed
```

#### Usage

Here is an example of how to use the Chroma JavaScript client:

```javascript
import { ChromaClient } from 'chromadb';

const client = new ChromaClient({
  apiKey: 'your-api-key',
  baseUrl: 'http://localhost:8123',
});

// Example: Creating a collection
const collection = await client.createCollection('my-collection');

// Example: Adding an embedding
await collection.addEmbedding({
  embeddingId: 'embedding-id',
  vector: [0.1, 0.2, 0.3],
});

// Example: Querying embeddings
const results = await collection.queryEmbeddings({
  queryVector: [0.1, 0.2, 0.3],
  topK: 5,
});

console.log(results);
```

#### Methods

- **createCollection(name: string): Promise<Collection>**
  - Creates a new collection with the specified name.

- **getCollection(name: string): Promise<Collection>**
  - Retrieves an existing collection by name.

- **listCollections(): Promise<Collection[]>**
  - Lists all collections.

- **deleteCollection(name: string): Promise<void>**
  - Deletes a collection by name.

### Collection Methods

- **addEmbedding(embedding: { embeddingId: string, vector: number[] }): Promise<void>**
  - Adds a new embedding to the collection.

- **queryEmbeddings(query: { queryVector: number[], topK: number }): Promise<Embedding[]>**
  - Queries the collection for the nearest embeddings to the provided query vector.

- **deleteEmbedding(embeddingId: string): Promise<void>**
  - Deletes an embedding from the collection by its ID.

- **updateEmbedding(embedding: { embeddingId: string, vector: number[] }): Promise<void>**
  - Updates an existing embedding in the collection.

For more details, refer to the [official documentation](https://docs.trychroma.com/reference/js-client).

## Schemas

### AddEmbedding

- **embedding_id**: `str`
  - Description: Unique identifier for the embedding.
  - Constraints: Must be a valid UUID.
- **vector**: `List[float]`
  - Description: The vector representation of the embedding.
  - Constraints: Must be a list of floats.

### CreateCollection

- **name**: `str`
  - Description: The name of the collection.
  - Constraints: Maximum length of 255 characters.

### CreateDatabase

- **database_name**: `str`
  - Description: The name of the database.
  - Constraints: Maximum length of 255 characters.

### CreateTenant

- **tenant_id**: `str`
  - Description: Unique identifier for the tenant.
  - Constraints: Must be a valid UUID.

### DeleteEmbedding

- **embedding_id**: `str`
  - Description: Unique identifier for the embedding to delete.
  - Constraints: Must be a valid UUID.

### GetEmbedding

- **embedding_id**: `str`
  - Description: Unique identifier for the embedding to retrieve.
  - Constraints: Must be a valid UUID.

### HTTPValidationError

- **detail**: `List[ValidationError]`
  - Description: List of validation errors.

### IncludeEnum

- **value**: `str`
  - Description: Enum value for inclusion.
  - Constraints: Must be one of the predefined enum values.

### QueryEmbedding

- **query_vector**: `List[float]`
  - Description: The vector to query against the embeddings.
  - Constraints: Must be a list of floats.

### UpdateCollection

- **collection_id**: `str`
  - Description: Unique identifier for the collection to update.
  - Constraints: Must be a valid UUID.
- **new_name**: `str`
  - Description: New name for the collection.
  - Constraints: Maximum length of 255 characters.

### UpdateEmbedding

- **embedding_id**: `str`
  - Description: Unique identifier for the embedding to update.
  - Constraints: Must be a valid UUID.
- **new_vector**: `List[float]`
  - Description: The new vector representation of the embedding.
  - Constraints: Must be a list of floats.

### ValidationError

- **loc**: `List[Union[str, int]]`
  - Description: Location of the error.
- **msg**: `str`
  - Description: Error message.
- **type**: `str`
  - Description: Type of error.
