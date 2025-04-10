## Chat Embed into external websites

This spec describes how to embed the chat into external websites

### Implementation

- HTML blocks are stored in html files in ./html-templates
- JS is stored in multiple files in ./scripts folder
- /integration.js route at src/routes/chat-embed.js compiles templates (html blocks) and js (concatenates files) and return a single bundle (js file)

## integration.js computation

- Concatenate all JS files in ./scripts folder
- Concatenate all HTML files in ./html-templates folder into a templates js variable
- Inject styles into bundle so that is injected into website once integration.js is loaded (styles should only affect chat UI, scoped)
- Return a single bundle (js file)

## Coding rules and stack

- Modularization
- No external libraries
- No external dependencies
- Pretty styles (use styles.js) (inspire from tailwind/shadcdn) (use native emoticons)

## Embed example:

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
    script.src = '/chat-embed/integration.js?fnInit=initChat&manualInit=true';
    script.async = true; // Optional: loads script asynchronously
    document.head.appendChild(script);
</script>
```

## Demo website

- Write demo website example at public/chat-example.html that uses the /chat-embed endpoint (which serves src/routes/chat-embed.js#/integration.js endpoint)