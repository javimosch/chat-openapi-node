// Chat Application
if (document.getElementById('app')) {
    const { createApp, ref, onMounted, nextTick } = Vue

    createApp({
        setup() {
            const messages = ref([])
            const input = ref('')
            const chatContainer = ref(null)
            const ws = ref(null)
            const isConnected = ref(false)
            const isLoading = ref(false)

            // Configure marked options
            marked.setOptions({
                breaks: true,  // Convert \n to <br>
                gfm: true,     // Enable GitHub Flavored Markdown
                sanitize: true // Sanitize HTML input
            })

            const scrollToBottom = async () => {
                await nextTick()
                if (chatContainer.value) {
                    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
                }
            }

            const connectWebSocket = () => {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
                const wsUrl = `${protocol}//${window.location.host}`
                ws.value = new WebSocket(wsUrl)

                ws.value.onopen = () => {
                    console.log('WebSocket connected')
                    isConnected.value = true
                }

                ws.value.onclose = () => {
                    console.log('WebSocket disconnected')
                    isConnected.value = false
                    // Try to reconnect after 2 seconds
                    setTimeout(connectWebSocket, 2000)
                }

                ws.value.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data)
                        if (data.type === 'chat_response') {
                            messages.value.push({
                                role: 'assistant',
                                content: data.data.text,
                                id: Date.now()
                            })
                            isLoading.value = false
                            scrollToBottom()
                        } else if (data.type === 'error') {
                            messages.value.push({
                                role: 'system',
                                content: 'Error: ' + data.data.message,
                                id: Date.now()
                            })
                            isLoading.value = false
                            scrollToBottom()
                        }
                    } catch (error) {
                        console.error('Failed to parse WebSocket message:', error)
                        isLoading.value = false
                    }
                }

                ws.value.onerror = (error) => {
                    console.error('WebSocket error:', error)
                    messages.value.push({
                        role: 'system',
                        content: 'Connection error. Trying to reconnect...',
                        id: Date.now()
                    })
                    isLoading.value = false
                    scrollToBottom()
                }
            }

            const sendMessage = () => {
                if (!input.value.trim() || !isConnected.value || isLoading.value) return

                isLoading.value = true
                const message = {
                    role: 'user',
                    content: input.value,
                    id: Date.now()
                }

                messages.value.push(message)
                ws.value.send(JSON.stringify({
                    type: 'chat',
                    query: input.value
                }))
                input.value = ''
                scrollToBottom()
            }

            onMounted(() => {
                connectWebSocket()
            })

            return {
                messages,
                input,
                sendMessage,
                chatContainer,
                isConnected,
                isLoading,
                marked: window.marked
            }
        }
    }).mount('#app')
}

// Upload Application
if (document.getElementById('upload')) {
    const { createApp, ref } = Vue

    createApp({
        data() {
            return {
                selectedFile: null,
                isUploading: false,
                status: null,
                ws: null
            }
        },
        methods: {
            handleFileChange(event) {
                this.selectedFile = event.target.files[0]
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
                            const content = JSON.parse(e.target.result)
                            this.ws.send(JSON.stringify({
                                type: 'upload',
                                content: content,
                                fileName: this.selectedFile.name
                            }))
                        } catch (error) {
                            this.status = 'Error: Invalid JSON file'
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
