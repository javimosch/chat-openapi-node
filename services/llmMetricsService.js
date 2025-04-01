const { observeOpenAI, Langfuse } = require('langfuse');
const isProduction = process.env.NODE_ENV === 'production';

const traceMap = new Map();

const langfuse = new Langfuse({
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    baseUrl: process.env.LANGFUSE_BASEURL, // 🇪🇺 EU region
    release: "v1.0.0",
    requestTimeout: 10000,
    enabled: true,
});

//langfuse.debug();

function createTrace(options = {}) {
    const trace = langfuse.trace({
        ...options,
        name: options.name||"chat-app-trace",
        metadata: options.metadata||{},
        tags: [isProduction ? "production" : "development", ...(options.tags || [])],
    });
    traceMap.set(options.id||trace.id, trace);
    return trace;
}

function getTrace(traceId) {
    return traceMap.get(traceId);
}

function destroyTrace(traceId) {
    traceMap.delete(traceId);
}

function createSpan(traceId, options = {}) {
    const trace = getTrace(traceId);
    if (!trace) {
        throw new Error('Trace not found');
    }
    return trace.span({
        ...options,
        name: options.name||"span",
        metadata: options.metadata||{},
        tags: [isProduction ? "production" : "development", ...(options.tags || [])],
    });
}


module.exports = {
    createTrace,
    getTrace,
    destroyTrace,
    createSpan
};
    