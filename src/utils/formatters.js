function formatDocsContext(docs) {
    if(!docs?.length) return docs;
    if(!Array.isArray(docs)) return docs;
    return docs.map(doc => 
    {
        doc = typeof doc === 'string' ? doc : JSON.stringify(doc);
        return doc.split('\n').join('').trim().split(' ').join('')
    }
    ).join('\n\n');
}
module.exports = {
    formatDocsContext
};
