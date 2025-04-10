
const express = require('express');
const router = express.Router();

router.post('/set', (req, res) => {
    global.OPENROUTER_MODEL = req.body.model;
    console.log('Model set successfully', { model: global.OPENROUTER_MODEL });
    res.send('Model set successfully');
});

module.exports = router;
