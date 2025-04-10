Embed example:

```html
<script>
    function initChat(chat){
        chat.init({
            el: '#chat' //or document.querySelector('#chat')
            //all other useful options to make the chat fit perfectly in any existing website and allow simple color or styles customization
        })
    }

    // Dynamically load the integration.js script
    const script = document.createElement('script');
    script.src = '/integration.js?fnInit=initChat&manualInit=true';
    script.async = true; // Optional: loads script asynchronously
    document.head.appendChild(script);
</script>
```