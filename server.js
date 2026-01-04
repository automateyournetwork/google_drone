const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Route for the root URL: Read index.html and inject the API Key
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading index.html:', err);
            return res.status(500).send('Error loading Flight Deck');
        }
        
        // Inject the API Key from the .env file
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
            console.error('CRITICAL: GOOGLE_MAPS_API_KEY not found in .env');
            return res.status(500).send('API Key Configuration Error. Check server logs.');
        }

        const result = data.replace('GOOGLE_MAPS_API_KEY_PLACEHOLDER', apiKey);
        res.send(result);
    });
});

// Serve static files from current directory, BUT disable default index serving
// so our custom route above handles '/'
app.use(express.static(__dirname, { index: false }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.listen(PORT, () => {
    console.log(`🚀 Drone Flight Deck initialized!`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log(`🔒 Security: API Key injected via server-side processing.`);
});