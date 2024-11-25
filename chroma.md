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
