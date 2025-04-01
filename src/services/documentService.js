const { connectToMongoDB, isDbSystemEnabled } = require('../db/config');
const Metadata = require('../models/metadata');
const { createModuleLogger } = require('../utils/logger');
const logger = createModuleLogger('documentService');


async function enrichDocsWithMetadata(relevantDocs) {
    if (!await isDbSystemEnabled()) return relevantDocs;
    
    logger.info('Enriching documents with MongoDB metadata', 'enrichDocsWithMetadata');
    try {
        await connectToMongoDB();
        const endpoints = relevantDocs.map(doc => doc.metadata.endpoint);
        const mongoMetadata = await Metadata.find({ endpoint: { $in: endpoints } });
        
        // Create a map for quick lookup
        const metadataMap = new Map(mongoMetadata.map(m => [m.endpoint, m.toJSON()]));
        
        // Enrich each doc with its MongoDB metadata
        const enrichedDocs = relevantDocs.map(doc => {
            const metadata = metadataMap.get(doc.metadata.endpoint);
            return {
                ...doc.metadata,
                ...(metadata||{})
            };
        });

        logger.info('Successfully enriched documents with MongoDB metadata', 'enrichDocsWithMetadata', {
            totalDocs: relevantDocs.length,
            enrichedCount: mongoMetadata.length
        });
        return enrichedDocs;
    } catch (err) {
        logger.error('Failed to enrich documents with MongoDB metadata', 'enrichDocsWithMetadata', {
            message: err.message,
            stack: err.stack
        });
        return relevantDocs;
    }
}

module.exports = {
    enrichDocsWithMetadata
}