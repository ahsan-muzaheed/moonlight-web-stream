const cluster = require('cluster');
const express = require('express');
const path = require('path');
const http = require('http'); // Required for WebSocket integration
const WebSocket = require('ws'); // Ensure 'ws' is installed via npm

// Matching the configuration from the Actix logs
const numWorkers = 1; 
const PORT = 8080;
const HOST = '0.0.0.0';

if (cluster.isPrimary) {
    // This is the main process that orchestrates the workers
    console.log(`INFO server::builder: starting ${numWorkers} workers`);
    console.log(`INFO server::server: Node runtime found; starting in cluster mode`);

    // Fork a process for each worker
    for (let i = 0; i < numWorkers; i++) {
        cluster.fork();
    }

    // Automatically restart a worker if it crashes
    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died. Restarting a new worker...`);
        cluster.fork();
    });

} else {
    // This code runs inside the child worker
    const app = express();
    const server = http.createServer(app); // Create HTTP server instance

    // 1. Path to your frontend distribution folder
    const distPath = path.join(__dirname, '..', 'dist');
    // 2. Path to your root directory
   // const rootPath = path.join(__dirname, '..');
   
   
   // Add this to handle API routing
//const httpProxy = require('http-proxy');
//const proxy = httpProxy.createProxyServer({});

// With this syntax:



    // 3. Serve all static assets from the 'dist' folder
    app.use(express.static(distPath));
    // 4. Serve any additional static assets from the root directory
   // app.use(express.static(rootPath));

    // 5. Explicitly serve stream.html when hitting the /stream.html route
    app.get('/stream.html', (req, res) => {
        res.sendFile(path.join(distPath, 'stream.html'), (err) => {
            if (err) {
                console.error(`Error sending stream.html: ${err}`);
                res.status(err.status).end();
            }
        });
    });
	
app.get('/api/authenticate', (req, res) => {
    // 1. You must set the correct content type so fetchApi knows how to process it
    res.setHeader('Content-Type', 'application/json');

    // 2. Return the exact JSON structure your Moonlight frontend expects 
    // for a successful authentication handshake.
    // NOTE: If you don't know the exact JSON structure, check the original 
    // Rust server code or browser Network tab for a successful response.
    res.json({
        status: "success",
        authenticated: true,
        sessionToken: "manual-mock-token" 
    });
});

app.get('/api/role', (req, res) => {
    // 1. You must set the correct content type so fetchApi knows how to process it
    res.setHeader('Content-Type', 'application/json');

    // 2. Return the exact JSON structure your Moonlight frontend expects 
    // for a successful authentication handshake.
    // NOTE: If you don't know the exact JSON structure, check the original 
    // Rust server code or browser Network tab for a successful response.
    res.json({
        status: "success",
        authenticated: true,
        sessionToken: "manual-mock-token" 
    });
});

    // --- WebSocket Server Code ---
    const wss = new WebSocket.Server({ noServer: true });

    // Handle WebSocket upgrade requests
    server.on('upgrade', (request, socket, head) => {
        if (request.url === '/host/stream') {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        } else {
            socket.destroy();
        }
    });

    // Connection handler
    wss.on('connection', (ws) => {
        console.log('Client connected to WebSocket /host/stream');
        
        ws.on('message', (message) => {
            console.log('Received:', message.toString());
            // Add your Moonlight protocol logic here
        });

        ws.on('close', () => console.log('Client disconnected'));
    });
    // --- End WebSocket Server Code ---

    // Start the server using the http server instance
    server.listen(PORT, HOST, () => {
        console.log(`INFO server::server: starting service: "node-web-service-${HOST}:${PORT}", worker PID: ${process.pid}, listening on: ${HOST}:${PORT}`);
    });
}