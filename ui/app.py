import streamlit as st
import chromadb
import os
import pandas as pd
import numpy as np

st.set_page_config(page_title="ChromaDB Browser", layout="wide")

# Initialize ChromaDB client
@st.cache_resource
def init_client():
    host = os.getenv("CHROMA_HOST", "localhost")
    port = os.getenv("CHROMA_PORT", "8000")
    return chromadb.HttpClient(host=host, port=port)

client = init_client()

st.title("ChromaDB Browser")

# Get all collections
collections = client.list_collections()
collection_names = [col.name for col in collections]

if not collection_names:
    st.warning("No collections found in ChromaDB")
else:
    # Collection selector
    selected_collection = st.selectbox(
        "Select Collection",
        collection_names
    )

    if selected_collection:
        collection = client.get_collection(selected_collection)
        
        # Collection info
        st.subheader("Collection Information")
        metadata = collection.metadata
        info = {
            "id": collection.id,
            "name": collection.name
        }
        if metadata:
            info.update(metadata)
        st.json(info)

        # Get all items
        items = collection.get(include=['metadatas', 'documents', 'embeddings'])
        
        if items and items['ids']:
            st.subheader("Collection Contents")
            
            # Create a dataframe for better visualization
            df_data = []
            for i in range(len(items['ids'])):
                embedding_size = 0
                if ('embeddings' in items and 
                    isinstance(items['embeddings'], (list, np.ndarray)) and 
                    len(items['embeddings']) > i):
                    embedding_size = len(items['embeddings'][i])
                
                row = {
                    'ID': items['ids'][i],
                    'Document': items['documents'][i] if items['documents'] else None,
                    'Metadata': str(items['metadatas'][i]) if items['metadatas'] else None,
                    'Embedding Size': embedding_size
                }
                df_data.append(row)
            
            df = pd.DataFrame(df_data)
            
            # Display stats
            col1, col2, col3 = st.columns(3)
            with col1:
                st.metric("Total Items", len(items['ids']))
            with col2:
                st.metric("Embedding Dimensions", df['Embedding Size'].iloc[0] if not df.empty else 0)
            with col3:
                st.metric("Has Metadata", "Yes" if items['metadatas'] else "No")

            # Search functionality
            st.subheader("Search Documents")
            search_query = st.text_input("Enter search query")
            top_k = st.slider("Number of results", min_value=1, max_value=10, value=3)
            
            if search_query:
                results = collection.query(
                    query_texts=[search_query],
                    n_results=top_k,
                    include=['metadatas', 'documents', 'distances']
                )
                
                st.subheader("Search Results")
                for i, (doc, metadata, distance) in enumerate(zip(
                    results['documents'][0],
                    results['metadatas'][0],
                    results['distances'][0]
                )):
                    with st.expander(f"Result {i+1} (Distance: {distance:.4f})"):
                        st.write("Document:", doc)
                        st.write("Metadata:", metadata)

            # Display all documents
            st.subheader("All Documents")
            st.dataframe(df, use_container_width=True)

            # Download options
            st.download_button(
                "Download as CSV",
                df.to_csv(index=False).encode('utf-8'),
                "chromadb_export.csv",
                "text/csv",
                key='download-csv'
            )
        else:
            st.info("No items found in this collection")
