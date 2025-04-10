// This file is currently not used by the chat-embed.js route.
// Styles are defined directly in chat-embed.js for simplicity.
// You could modify chat-embed.js to read styles from here if needed.

const chatStyles = `
.chat-embed-widget {
    /* More detailed styles could go here */
    border: 1px solid #eee;
    background-color: #f9f9f9;
}

.chat-messages {
    height: 200px;
    overflow-y: auto;
    border-bottom: 1px solid #eee;
    margin-bottom: 10px;
    padding: 5px;
}

.chat-input {
    display: flex;
}

.chat-input input {
    flex-grow: 1;
    border: 1px solid #ccc;
    padding: 8px;
    border-radius: 3px 0 0 3px;
}

.chat-input button {
    padding: 8px 15px;
    border: 1px solid #ccc;
    border-left: none;
    background-color: #007bff;
    color: white;
    cursor: pointer;
    border-radius: 0 3px 3px 0;
}

.chat-input button:hover {
    background-color: #0056b3;
}


.chat-embed-widget h1 { font-size: 2.25rem; font-weight: bold; margin-bottom: 2rem; padding-bottom: 0.75rem; border-bottom: 4px solid #D1D5DB; }
.chat-embed-widget h2 { font-size: 1.875rem; font-weight: 600; margin-top: 2.5rem; margin-bottom: 1.25rem; color: #1E3A8A; background-color: #BFDBFE; padding: 1rem; border-radius: 0.5rem; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }
.chat-embed-widget h2 code { font-size: 1.875rem; }
.chat-embed-widget h3 { font-size: 1.25rem; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.75rem; color: #4B5563; }
.chat-embed-widget p { margin-bottom: 1.25rem; line-height: 1.625; color: #374151; }
.chat-embed-widget ul { list-style-type: disc; margin-left: 2rem; margin-bottom: 1.25rem; }
.chat-embed-widget ol { list-style-type: decimal; margin-left: 2rem; margin-bottom: 1.25rem; }
.chat-embed-widget li { color: #374151; }
.chat-embed-widget code { background-color: #E5E7EB; padding: 0.5rem 0.5rem; border-radius: 0.25rem; font-family: monospace; font-size: 0.875rem; color: #1E40AF; }
.chat-embed-widget pre { background-color: #1F2937; color: #E5E5E5; padding: 1.25rem; border-radius: 0.5rem; margin-bottom: 1.25rem; overflow-x: auto; }
.chat-embed-widget pre code { background-color: transparent; padding: 0; color: #E5E5E5; }
.chat-embed-widget table { width: 100%; margin-bottom: 1.25rem; border-collapse: collapse; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }
.chat-embed-widget th { background-color: #E5E7EB; border: 1px solid #D1D5DB; padding: 0.75rem; text-align: left; }
.chat-embed-widget td { border: 1px solid #D1D5DB; padding: 0.75rem; }
.chat-embed-widget blockquote { border-left: 4px solid #D1D5DB; padding-left: 1rem; margin-bottom: 1.25rem; color: #4B5563; }
`;




// Export or make available if chat-embed.js is modified to use it
// module.exports = chatStyles; // If using CommonJS in a Node context for bundling
// Or just let chat-embed.js read this file content directly.