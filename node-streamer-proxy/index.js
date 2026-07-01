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
	
	var obj={
        status: "success",
        authenticated: true,
        sessionToken: "manual-mock-token" 
    }
	
	obj={
    "role": {
        "id": 543368717,
        "name": "Admin",
        "ty": "Admin",
        "default_settings": null,
        "permissions": {
            "allow_add_hosts": true,
            "maximum_bitrate_kbps": null,
            "allow_codec_h264": true,
            "allow_codec_h265": true,
            "allow_codec_av1": true,
            "allow_hdr": true,
            "allow_transport_webrtc": true,
            "allow_transport_websockets": true
        }
    }
}

    res.json();
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
		wss.on('connection', (ws, request) => {
			console.log('Client connected to /host/stream');
			
			// 1. Initial Handshake: Wait for the first "Init" message
			ws.once('message', async (data) => {
				try {
					const initMessage = JSON.parse(data.toString());
					if (initMessage.type !== 'Init') {
						console.warn("Expected Init message, closing connection");
						ws.close();
						return;
					}

					// 2. Dummy Placeholders for DB/Auth lookups
					const hostData = await getHostDataFromDB(initMessage.host_id);
					const app = await getAppFromHost(hostData, initMessage.app_id);
					const pairInfo = await getPairInfo(hostData);

					// 3. Spawn the Streamer Process
					const streamer = spawn(STREAMER_PATH, [], {
						stdio: ['pipe', 'pipe', 'pipe']
					});

					console.log(`Streamer spawned with PID: ${streamer.pid}`);

					// 4. Send Initial Config to Streamer via Stdin
					const serverIpcInit = {
						type: 'Init',
						config: APP_CONFIG,
						host_address: hostData.address,
						// ... map other fields from your Rust Init struct
					};
					streamer.stdin.write(JSON.stringify(serverIpcInit) + '\n');

					// 5. IPC Handling: Streamer Stdout -> WebSocket
					streamer.stdout.on('data', (data) => {
						// Assuming streamer sends JSON IPC messages
						// You may need to parse stream chunks if they are not newline-delimited
						ws.send(data); 
					});

					// 6. WebSocket -> Streamer Stdin
					ws.on('message', (message) => {
					 console.log('Received:', message.toString());
						// Forward WS traffic to streamer process
						streamer.stdin.write(message);
					});

					// Cleanup on close
					ws.on('close', () => {
					 console.log('Received:', message.toString());
						console.log("WS closed, killing streamer...");
						streamer.kill();
					});

					streamer.on('exit', () => {
						console.log("Streamer process exited");
						ws.close();
					});

				} catch (err) {
					console.error("Initialization error:", err);
					ws.close();
				}
			});
		});
		   
   // --- End WebSocket Server Code ---

    // Start the server using the http server instance
    server.listen(PORT, HOST, () => {
        console.log(`INFO server::server: starting service: "node-web-service-${HOST}:${PORT}", worker PID: ${process.pid}, listening on: ${HOST}:${PORT}`);
    });
}

const { spawn } = require('child_process');

// --- Configuration Placeholder ---
const STREAMER_PATH = "/path/to/your/streamer";
const APP_CONFIG = {
    webrtc: { /* fill from your config */ },
    logLevel: "info"
};

// --- Dummy Placeholder Functions ---
async function getHostDataFromDB(hostId) {
    console.log(`[TODO]: Lookup host ${hostId} in database`);
    return { address: "127.0.0.1", port: 8080 };
}

async function getAppFromHost(host, appId) {
    console.log(`[TODO]: Validate app ${appId} for host`);
    return { id: appId };
}

async function getPairInfo(host) {
    console.log(`[TODO]: Retrieve crypto keys for host pairing`);
    return { client_private_key: "...", client_certificate: "..." };
}