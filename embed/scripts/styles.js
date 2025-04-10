const chatStyles = `
/* Full-screen mode */
.chat-embed-widget.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    border-radius: 0;
    z-index: 10000;
}

.fullscreen-toggle {
    position: absolute;
    top: 20px;
    right: 20px;
    background: transparent;
    border: none;
    color: #666;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
}

.fullscreen-toggle:hover {
    background: rgba(0, 0, 0, 0.05);
    color: #333;
}

.fullscreen-toggle svg {
    width: 16px;
    height: 16px;
}

/* Modern Chat Widget Styles */
.chat-embed-widget {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    position: fixed;
    bottom: 30px;
    right: 30px;
    width: 380px;
    height: 600px;
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid rgba(0, 0, 0, 0.08);
    z-index: 1000;
    transition: all 0.3s ease;
}

.chat-embed-widget h3 {
    margin: 0;
    padding: 20px;
    font-size: 1.1em;
    color: #1a1a1a;
    background: #f8f9fa;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
}

.chat-embed-widget h3::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    background: #4CAF50;
    border-radius: 50%;
    margin-right: 8px;
}

.chat-messages {
    flex-grow: 1;
    overflow-y: auto;
    padding: 20px;
    scroll-behavior: smooth;
    background: #ffffff;
    /* Improved scrollbar styling */
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
}

.chat-messages::-webkit-scrollbar {
    width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
    background: transparent;
}

.chat-messages::-webkit-scrollbar-thumb {
    background-color: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
}

.chat-message {
    margin-bottom: 16px;
    line-height: 1.5;
    font-size: 0.95em;
    opacity: 0;
    transform: translateY(10px);
    animation: messageAppear 0.3s ease forwards;
}

@keyframes messageAppear {
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.chat-message-user {
    text-align: right;
}

.chat-message-user span {
    display: inline-block;
    background: #2962FF;
    color: white;
    padding: 10px 16px;
    border-radius: 16px 16px 0 16px;
    max-width: 85%;
    word-wrap: break-word;
    overflow-wrap: break-word;
    white-space: pre-wrap;
    box-shadow: 0 2px 4px rgba(41, 98, 255, 0.1);
}

.chat-message-assistant span {
    display: inline-block;
    background: #f1f3f4;
    color: #1a1a1a;
    padding: 10px 16px;
    border-radius: 16px 16px 16px 0;
    max-width: 85%;
    word-wrap: break-word;
    overflow-wrap: break-word;
    white-space: pre-wrap;
}

.chat-message-system {
    text-align: center;
    color: #666;
    font-size: 0.85em;
    margin: 16px 0;
    font-style: italic;
}

.chat-message h3 {
    font-size: 1em;
    margin: 0 0 8px 0;
    padding: 0;
    background: none;
    border: none;
    word-break: break-word;
    max-width: 100%;
    overflow-wrap: break-word;
}

.chat-input {
    display: flex;
    align-items: center;
    padding: 16px;
    background: #f8f9fa;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
    gap: 10px;
}

.chat-input input {
    flex-grow: 1;
    border: 1px solid rgba(0, 0, 0, 0.1);
    padding: 12px 16px;
    border-radius: 24px;
    font-size: 0.95em;
    background: white;
    transition: all 0.2s ease;
    font-family: inherit;
}

.chat-input input:focus {
    outline: none;
    border-color: #2962FF;
    box-shadow: 0 0 0 3px rgba(41, 98, 255, 0.1);
}

.chat-input button {
    background: #2962FF;
    color: white;
    border: none;
    padding: 12px 20px;
    border-radius: 24px;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.95em;
    transition: all 0.2s ease;
    font-family: inherit;
}

.chat-input button:hover {
    background: #1e4bd8;
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(41, 98, 255, 0.2);
}

.chat-input button:active {
    transform: translateY(0);
    box-shadow: none;
}

.chat-input button:disabled {
    background: #e0e0e0;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
}

/* Loading animation */
.chat-message-system.loading::after {
    content: '';
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid #666;
    border-radius: 50%;
    border-top-color: transparent;
    animation: spin 1s linear infinite;
    margin-left: 8px;
    vertical-align: middle;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* Responsive adjustments */
@media (max-width: 480px) {
    .chat-embed-widget {
        width: 100%;
        height: 100%;
        bottom: 0;
        right: 0;
}

/* Rich text content styling */
.chat-message pre {
background: #1f2937;
color: #e5e7eb;
padding: 12px;
border-radius: 8px;
overflow-x: auto;
margin: 8px 0;
}

.chat-message code {
    font-family: 'Fira Code', monospace;
    font-size: 0.9em;
    white-space: pre-wrap;
    word-break: break-word;
    max-width: 100%;
    display: inline-block;
}

.chat-message a {
    color: #2962FF;
    text-decoration: none;
}

.chat-message a:hover {
    text-decoration: underline;
}

.chat-message ul, .chat-message ol {
    margin: 8px 0;
    padding-left: 24px;
}

.chat-message blockquote {
    border-left: 4px solid #e5e7eb;
    padding-left: 16px;
    margin: 8px 0;
    color: #4b5563;
}
`;