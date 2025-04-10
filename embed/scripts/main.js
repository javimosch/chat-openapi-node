// Main script for the chat embed

const ChatEmbed = {
    config: {},
    elements: {},
    ws: null,
    messages: [], // Store message history { role: 'user'/'assistant'/'system', content: '...' }
    isLoading: false,
    isConnected: false,
    messageQueue: [], // Queue messages if sent before connection is ready
    // templates: {}, // No longer needed here, will use chatEmbedTemplates from bundle scope

    init: function(options) {
        console.log("ChatEmbed.init called with options:", options);
        this.config = options || {};
        const targetElement = document.querySelector(this.config.el);

        if (!targetElement) {
            console.error(`ChatEmbed Error: Target element "${this.config.el}" not found.`);
            return;
        }

        // --- DEBUGGING ---
        console.log("ChatEmbed.init: Checking for chatEmbedTemplates in scope...");
        console.log("ChatEmbed.init: typeof chatEmbedTemplates:", typeof chatEmbedTemplates);
        if (typeof chatEmbedTemplates !== 'undefined') {
            console.log("ChatEmbed.init: Keys in chatEmbedTemplates:", Object.keys(chatEmbedTemplates));
            console.log("ChatEmbed.init: Value of chatEmbedTemplates['chat-widget']:", chatEmbedTemplates['chat-widget'] ? "[HTML Content Present]" : "[Not Found or Empty]");
        }
        // --- END DEBUGGING ---

        // Use the templates defined in the bundle's scope
        if (typeof chatEmbedTemplates !== 'undefined' && chatEmbedTemplates['chat-widget']) {
            targetElement.innerHTML = chatEmbedTemplates['chat-widget']; // Use the template content
            console.log("Chat widget template injected using chatEmbedTemplates.");

            // Store references to elements within the widget
            this.elements.widget = targetElement.querySelector('.chat-embed-widget');
            this.elements.messagesContainer = this.elements.widget.querySelector('.chat-messages');
            this.elements.input = this.elements.widget.querySelector('.chat-input input');
            this.elements.sendButton = this.elements.widget.querySelector('.chat-input button');

            // Add event listeners
            this.elements.sendButton.addEventListener('click', () => this.sendMessage());
            this.elements.input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendMessage();
                }
            });

            // Full-screen toggle
            this.elements.fullscreenToggle = this.elements.widget.querySelector('.fullscreen-toggle');
            if (this.elements.fullscreenToggle) {
                this.elements.fullscreenToggle.addEventListener('click', () => {
                    this.elements.widget.classList.toggle('fullscreen');
                    // Update icon based on state
                    const isFullscreen = this.elements.widget.classList.contains('fullscreen');
                    this.elements.fullscreenToggle.innerHTML = isFullscreen ? 
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6L21 21M4 10h6m0 0V4m0 6L3 3m17 7h-6m0 0V4m0 6L21 3"/></svg>' :
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';
                });
            }

            // Initial message or setup
            this.addMessage('System', 'Initializing chat...');

            // Connect WebSocket
            this.connectWebSocket();

        } else {
            console.error("ChatEmbed Error: Chat widget template (chatEmbedTemplates['chat-widget']) not found or chatEmbedTemplates object missing.");
            targetElement.innerHTML = '<p style="color: red;">Error loading chat widget template.</p>';
        }
    },

    connectWebSocket: function() {
        console.log('ChatEmbed: Connecting WebSocket...');
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Assuming the backend server is running on the same host/port
        const wsUrl = `${protocol}//${window.location.host}`;
        console.log('ChatEmbed: WebSocket URL:', wsUrl);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('ChatEmbed: WebSocket connected successfully');
            this.isConnected = true;
            this.addMessage('System', 'Connected.');
            this.setLoading(false); // In case it was stuck loading
            // Send any queued messages
            this.messageQueue.forEach(msg => this.sendMessageToServer(msg.query, msg.history));
            this.messageQueue = [];
        };

        this.ws.onmessage = (event) => {
            console.log('ChatEmbed: Received WebSocket message:', event.data);
            try {
                const data = JSON.parse(event.data);
                console.log('ChatEmbed: Parsed message data:', data);

                if (data.type === 'chat_response') {
                    console.log('ChatEmbed: Processing chat response');
                    let content = data.data.text || data.data.message || 'No response content';
                    this.addMessage('Assistant', content); // Pass raw content to addMessage
                } else if (data.type === 'error') {
                    console.log('ChatEmbed: Processing error response');
                    this.addMessage('System', 'Error: ' + (data.data.message || data.message || 'Unknown error'));
                } else {
                    console.log('ChatEmbed: Received unhandled message type:', data.type);
                }
            } catch (error) {
                console.error('ChatEmbed: Failed to parse WebSocket message:', error);
                this.addMessage('System', 'Error processing server message.');
            } finally {
                this.setLoading(false);
            }
        };

        this.ws.onerror = (error) => {
            console.error('ChatEmbed: WebSocket error:', error);
            this.addMessage('System', 'Connection error. Please try refreshing.');
            this.isConnected = false;
            this.setLoading(false);
        };

        this.ws.onclose = () => {
            console.log('ChatEmbed: WebSocket connection closed');
            this.isConnected = false;
            this.setLoading(false);
        };
    },

    setLoading: function(isLoading) {
        this.isLoading = isLoading;
        if (this.elements.sendButton) {
            this.elements.sendButton.disabled = isLoading;
            this.elements.sendButton.textContent = isLoading ? '...' : 'Send';
        }
        if (this.elements.input) {
            this.elements.input.disabled = isLoading;
        }
    },

    sendMessage: function() {
        const messageText = this.elements.input.value.trim();
        if (!messageText || this.isLoading) {
            return;
        }

        this.setLoading(true);
        this.addMessage('User', messageText); // Add user message to UI immediately

        const history = this.messages
            .filter(msg => msg.role === 'user' || msg.role === 'assistant')
            .slice(-10)
            .map(msg => ({ role: msg.role, content: msg.content }));

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log('ChatEmbed: WebSocket not connected, queuing message.');
            this.messageQueue.push({ query: messageText, history: history });
            if (!this.isConnected && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
                this.connectWebSocket();
            }
        } else {
            console.log('ChatEmbed: WebSocket connected, sending message.');
            this.sendMessageToServer(messageText, history);
        }

        this.elements.input.value = '';
    },

    sendMessageToServer: function(query, history) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const payload = {
                type: 'chat',
                query: query,
                history: history || []
            };
            console.log('ChatEmbed: Sending payload:', payload);
            this.ws.send(JSON.stringify(payload));
        } else {
            console.error('ChatEmbed: Attempted to send message but WebSocket is not open.');
            this.addMessage('System', 'Error: Not connected. Message not sent.');
            this.setLoading(false);
            if (!this.messageQueue.some(m => m.query === query)) {
                 this.messageQueue.push({ query: query, history: history });
            }
        }
    },

    addMessage: function(sender, text) {
        const role = sender.toLowerCase();
        this.messages.push({ role: role, content: text });

        if (this.elements.messagesContainer) {
            const initialMessages = ['Loading chat...', 'Initializing chat...', 'Connected.'];
            const placeholder = this.elements.messagesContainer.querySelector('p');
            if (placeholder && initialMessages.some(msg => placeholder.textContent === msg)) {
                 this.elements.messagesContainer.innerHTML = '';
            }

            const messageElement = document.createElement('div');
            messageElement.classList.add('chat-message', `chat-message-${role}`);

            const senderElement = document.createElement('strong');
            senderElement.textContent = `${sender}: `;
            messageElement.appendChild(senderElement);

            const contentElement = document.createElement('span');
            if (role === 'assistant' && typeof marked !== 'undefined') {
                try {
                    contentElement.innerHTML = marked.parse(text);
                } catch (e) {
                    console.error("ChatEmbed: Error parsing markdown", e);
                    contentElement.textContent = text;
                }
            } else {
                contentElement.textContent = text;
            }
            messageElement.appendChild(contentElement);

            if (role === 'assistant') {
                 messageElement.classList.add('markdown');
            }

            this.elements.messagesContainer.appendChild(messageElement);
            this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        } else {
            console.error("ChatEmbed Error: Messages container not found.");
        }
    }
};

console.log("embed/scripts/main.js loaded, ChatEmbed defined.");