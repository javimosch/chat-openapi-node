// Chat Application
if (document.getElementById('app')) {
    console.log('Initializing chat application')
    const { createApp } = Vue

    // Configure marked options
    console.log('Checking marked availability:', !!window.marked)
    if (window.marked) {
        console.log('Configuring marked options')
        marked.setOptions({
            breaks: true,
            gfm: true,
            sanitize: false
        })
    }

    createApp({
        data() {
            console.log('Initializing Vue data')
            return {
                messages: [],
                newMessage: '',
                isLoading: false,
                ws: null,
                inputFormat: localStorage.getItem('inputFormat') || 'json'
            }
        },

        methods: {
            connectWebSocket() {
                console.log('Connecting WebSocket...')
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
                const wsUrl = `${protocol}//${window.location.host}`
                console.log('WebSocket URL:', wsUrl)
                
                this.ws = new WebSocket(wsUrl)

                this.ws.onopen = () => {
                    console.log('WebSocket connected successfully')
                }

                this.ws.onmessage = (event) => {
                    console.log('Received WebSocket message:', event.data)
                    try {
                        const data = JSON.parse(event.data)
                        console.log('Parsed message data:', data)
                        
                        if (data.type === 'chat_response') {
                            console.log('Processing chat response')
                            this.messages.push({
                                role: 'assistant',
                                content: data.data.text || data.data.message || 'No response content',
                                id: Date.now()
                            })
                            this.isLoading = false
                        } else if (data.type === 'error') {
                            console.log('Processing error response')
                            this.messages.push({
                                role: 'system',
                                content: 'Error: ' + (data.data.message || data.message || 'Unknown error'),
                                id: Date.now()
                            })
                            this.isLoading = false
                        }
                    } catch (error) {
                        console.error('Failed to parse WebSocket message:', error)
                        this.isLoading = false
                    }
                }

                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error)
                    this.messages.push({
                        role: 'system',
                        content: 'Connection error. Please try again.',
                        id: Date.now()
                    })
                    this.isLoading = false
                }

                this.ws.onclose = () => {
                    console.log('WebSocket connection closed')
                }
            },

            sendMessage() {
                console.log('sendMessage called with:', this.newMessage)
                if (!this.newMessage.trim() || this.isLoading) {
                    console.log('Message empty or loading, returning')
                    return
                }

                console.log('Processing new message')
                this.isLoading = true
                const messageContent = this.newMessage.trim()
                
                this.messages.push({
                    role: 'user',
                    content: messageContent,
                    id: Date.now()
                })
                console.log('Added message to messages array:', this.messages)

                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    console.log('WebSocket not connected, reconnecting...')
                    this.connectWebSocket()
                    setTimeout(() => {
                        console.log('Attempting to send message after reconnection')
                        this.sendMessageToServer(messageContent)
                    }, 1000)
                } else {
                    console.log('WebSocket connected, sending message directly')
                    this.sendMessageToServer(messageContent)
                }

                this.newMessage = ''
            },

            sendMessageToServer(content) {
                console.log('sendMessageToServer called, WebSocket state:', this.ws?.readyState)
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    const payload = {
                        type: 'chat',
                        query: content
                    }
                    console.log('Sending payload:', payload)
                    this.ws.send(JSON.stringify(payload))
                } else {
                    console.error('WebSocket not ready')
                    this.messages.push({
                        role: 'system',
                        content: 'Error: Could not connect to server. Please try again.',
                        id: Date.now()
                    })
                    this.isLoading = false
                }
            },

            formatMessage(content) {
                if (!content) return '';
                
                // If marked is not available or content is not markdown, return as is
                if (!window.marked || typeof content !== 'string') {
                    return content;
                }

                try {
                    // Check if content looks like markdown
                    const hasMarkdown = /[*#`_~]/.test(content);
                    if (!hasMarkdown) {
                        return content;
                    }

                    return marked.parse(content);
                } catch (error) {
                    console.error('Error parsing markdown:', error);
                    return content;
                }
            }
        },

        mounted() {
            console.log('Vue app mounted')
            this.connectWebSocket()
        }
    }).mount('#app')
}

// Upload Application
if (document.getElementById('upload')) {
    const { createApp } = Vue

    createApp({
        data() {
            return {
                selectedFile: null,
                isUploading: false,
                status: null,
                ws: null,
                inputFormat: localStorage.getItem('inputFormat') || 'json'
            }
        },

        methods: {
            handleFileChange(event) {
                const file = event.target.files[0]
                const fileExtension = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json'
                
                if (fileExtension !== this.inputFormat) {
                    this.status = `Error: Only ${this.inputFormat.toUpperCase()} files are currently accepted`
                    event.target.value = null
                    return
                }
                
                this.selectedFile = file
                this.status = null
            },

            connectWebSocket() {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
                const wsUrl = `${protocol}//${window.location.host}`
                this.ws = new WebSocket(wsUrl)

                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data)
                        if (data.type === 'upload_response') {
                            this.status = 'Upload complete!'
                            this.isUploading = false
                        } else if (data.type === 'error') {
                            this.status = 'Error: ' + data.data.message
                            this.isUploading = false
                        }
                    } catch (error) {
                        console.error('Failed to parse WebSocket message:', error)
                        this.status = 'Error: Failed to process server response'
                        this.isUploading = false
                    }
                }
            },

            async uploadFile() {
                if (!this.selectedFile) return
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    this.connectWebSocket()
                    await new Promise(resolve => setTimeout(resolve, 1000))
                }

                this.isUploading = true
                this.status = 'Uploading...'

                try {
                    const reader = new FileReader()
                    reader.onload = (e) => {
                        try {
                            let content = e.target.result
                            const fileType = this.selectedFile.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json'

                            // For JSON files, parse and validate
                            if (fileType === 'json') {
                                content = JSON.parse(content)
                            }

                            this.ws.send(JSON.stringify({
                                type: 'upload',
                                content: content,
                                fileName: this.selectedFile.name,
                                fileType: fileType
                            }))
                        } catch (error) {
                            this.status = 'Error: Invalid file format'
                            this.isUploading = false
                        }
                    }
                    reader.readAsText(this.selectedFile)
                } catch (error) {
                    this.status = 'Error: ' + error.message
                    this.isUploading = false
                }
            }
        },

        mounted() {
            this.connectWebSocket()
        }
    }).mount('#upload')
}

// Settings Application
if (document.getElementById('settings')) {
    const { createApp } = Vue

    createApp({
        data() {
            return {
                inputFormat: localStorage.getItem('inputFormat') || document.querySelector('#settings').dataset.inputFormat || 'json',
                status: null,
                ws: null
            }
        },

        methods: {
            setInputFormat(format) {
                this.inputFormat = format
                localStorage.setItem('inputFormat', format)
                this.status = `Input format updated to ${format.toUpperCase()}`

                // Update server setting via WebSocket
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    this.connectWebSocket()
                    setTimeout(() => this.updateServerSetting(), 1000)
                } else {
                    this.updateServerSetting()
                }
            },

            connectWebSocket() {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
                const wsUrl = `${protocol}//${window.location.host}`
                this.ws = new WebSocket(wsUrl)

                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data)
                        if (data.type === 'settings_updated') {
                            this.status = 'Settings updated successfully'
                        } else if (data.type === 'error') {
                            this.status = 'Error: ' + data.data.message
                        }
                    } catch (error) {
                        console.error('Failed to parse WebSocket message:', error)
                        this.status = 'Error: Failed to process server response'
                    }
                }
            },

            updateServerSetting() {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        type: 'update_settings',
                        settings: {
                            inputFormat: this.inputFormat
                        }
                    }))
                }
            }
        },

        mounted() {
            this.connectWebSocket()
        }
    }).mount('#settings')
}
