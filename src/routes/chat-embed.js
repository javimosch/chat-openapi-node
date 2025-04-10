const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { createModuleLogger } = require('../utils/logger');

const router = express.Router();
const logger = createModuleLogger('chat-embed');

const SCRIPTS_DIR = path.join(__dirname, '../../embed/scripts');
const TEMPLATES_DIR = path.join(__dirname, '../../embed/html-templates');
const STYLES_PATH = path.join(SCRIPTS_DIR, 'styles.js');

router.get('/integration.js', async (req, res) => {
    logger.info('Integration script requested', 'integration.js', { query: req.query });
    try {
        // 1. Read JS files from ./scripts (excluding styles.js for now)
        const scriptFiles = await fs.readdir(SCRIPTS_DIR);
        let jsContent = '';
        for (const file of scriptFiles) {
            // Skip styles.js as we handle it separately
            if (path.extname(file) === '.js' && file !== 'styles.js') {
                const filePath = path.join(SCRIPTS_DIR, file);
                jsContent += await fs.readFile(filePath, 'utf-8') + '\n\n';
                logger.debug('Read JS file', 'integration.js', { file });
            }
        }

        // 2. Read HTML templates from ./html-templates
        const templateFiles = await fs.readdir(TEMPLATES_DIR);
        const templates = {};
        for (const file of templateFiles) {
            if (path.extname(file) === '.html') {
                const filePath = path.join(TEMPLATES_DIR, file);
                const templateName = path.basename(file, '.html');
                templates[templateName] = await fs.readFile(filePath, 'utf-8');
                logger.debug('Read HTML template', 'integration.js', { file: templateName });
            }
        }
        const templatesJs = `const chatEmbedTemplates = ${JSON.stringify(templates, null, 2)};\n\n`;

        // 3. Read styles from embed/scripts/styles.js
        let stylesContent = '';
        try {
            // Read the styles.js file
            const stylesFileContent = await fs.readFile(STYLES_PATH, 'utf-8');
            // Extract the content of the template literal `const chatStyles = \`...\`;`
            const match = stylesFileContent.match(/const\s+chatStyles\s*=\s*`([\s\S]*?)`;/);
            if (match && match[1]) {
                stylesContent = match[1];
                logger.debug('Read styles from embed/scripts/styles.js');
            } else {
                 logger.warn('Could not extract styles from embed/scripts/styles.js, using default.');
                 // Provide default styles as fallback
                 stylesContent = `
                    .chat-embed-widget { border: 1px solid red; padding: 10px; font-family: sans-serif; width: 300px; height: 400px; background: #fff; position: fixed; bottom: 20px; right: 20px; z-index: 1000; }
                    /* Add other minimal default styles */
                 `;
            }
        } catch (err) {
             logger.error('Error reading styles file, using default.', { error: err.message });
             stylesContent = `/* Error loading styles */ .chat-embed-widget { border: 1px solid red; }`;
        }

        // --- Make UI Bigger ---
        // Modify the styles string to increase size (or ensure styles.js has the desired size)
        // Let's target the .chat-embed-widget rule. We'll replace existing width/height if found, or add them.
        let updatedStyles = stylesContent;
        

        const stylesJs = `
(function() {
    const styleElement = document.createElement('style');
    // Use the potentially modified styles read from the file
    styleElement.textContent = \`${updatedStyles}\`;
    document.head.appendChild(styleElement);
    console.log('ChatEmbed: Styles injected.');
})();
\n\n`;

        // 4. Combine everything into the bundle
        const bundle = `
(function() {
    // Style injection first
    ${stylesJs}

    // Define templates within this scope
    ${templatesJs}
    console.log('ChatEmbed Integration: chatEmbedTemplates defined in scope.');

    // Define the ChatEmbed object via main.js content
    ${jsContent}

    // --- Initialization Logic ---
    if (typeof ChatEmbed === 'undefined') {
         console.error('ChatEmbed Integration: ChatEmbed object not found. Check embed/scripts/main.js');
         return;
    }

    const currentScript = document.currentScript;
    if (!currentScript) {
        console.error('ChatEmbed Integration: Could not find the current script element.');
    }

    const scriptSrc = currentScript ? currentScript.src : '';
    const scriptUrl = new URL(scriptSrc || window.location.href);
    const params = scriptUrl.searchParams;

    const fnInit = params.get('fnInit') || 'initChat';
    const manualInit = params.get('manualInit') === 'true';

    console.log('ChatEmbed Integration: Checking init conditions...');
    console.log('ChatEmbed Integration: Script Source =', scriptSrc);
    console.log('ChatEmbed Integration: manualInit =', manualInit, '(from script query:', params.get('manualInit'), ')');
    console.log('ChatEmbed Integration: fnInit =', fnInit);
    console.log('ChatEmbed Integration: typeof window[fnInit] =', typeof window[fnInit]);

    if (manualInit) {
        if (typeof window[fnInit] === 'function') {
            console.log(\`ChatEmbed Integration: Manual init - Found function '\${fnInit}', calling it.\`);
            try {
                setTimeout(() => {
                     window[fnInit](ChatEmbed);
                }, 0);
            } catch (e) {
                console.error(\`ChatEmbed Integration: Error calling init function '\${fnInit}':\`, e);
            }
        } else {
            console.warn(\`ChatEmbed Integration: Manual init - Function '\${fnInit}' not found on window object.\`);
        }
    } else {
        if (typeof window[fnInit] === 'function') {
             console.warn(\`ChatEmbed Integration: Auto init mode - Found function '\${fnInit}' but manualInit is not true.\`);
        } else {
             console.log('ChatEmbed Integration: Auto init mode - No init function found or manualInit not set.');
        }
    }
})();
`;

        res.setHeader('Content-Type', 'application/javascript');
        res.send(bundle);
        logger.info('Integration script sent successfully', 'integration.js');

    } catch (error) {
        logger.error('Failed to generate integration script', 'integration.js', { error: error.message, stack: error.stack });
        res.status(500).send(`// Error generating integration script: ${error.message}`);
    }
});

module.exports = router;