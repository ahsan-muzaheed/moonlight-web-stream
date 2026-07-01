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

    res.json(obj);
});
var http_obj = require('http').Server(app);
//var https = require('https').Server(ssCertOptions, app);
    // --- WebSocket Server Code ---
    const wss = new WebSocket.Server({ 
        //noServer: true 
    server: http_obj
    });

        // Handle WebSocket upgrade requests
    server.on('upgrade', (request, socket, head) => {
        // Look for the full path the client is actually sending
        if (request.url === '/api/host/stream') {
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
                    var fsgsg=data.toString()
					
					console.log("page-> ws message :"+fsgsg);
					
					
					const parsed = JSON.parse(fsgsg);

                    const initData = parsed.Init
					//if (initData.type !== 'Init') 
                    if (parsed && parsed.Init)    
                    {
						
						 // --- LOG: Init Received ---
            console.log(`[Stream]: Received Init message for host: ${initData.host_id || 'UNKNOWN_HOST'}, app: ${initData.app_id || 'UNKNOWN_APP'}`);

            console.log(`[Stream]: spawning streamer process: streamer_path=${STREAMER_PATH}, cwd=${process.cwd()}`);

						
						
					}
                    else
                    {
						console.warn("Expected Init message, closing connection");
						ws.close();
						return;
					}

					// 2. Dummy Placeholders for DB/Auth lookups
					const hostData = await getHostDataFromDB(initData.host_id);
					const app = await getAppFromHost(hostData, initData.app_id);
					const pairInfo = await getPairInfo(hostData);

					// 3. Spawn the Streamer Process
					const streamer = spawn(STREAMER_PATH, [], {
						stdio: ['pipe', 'pipe', 'pipe']
					});

					console.log(`Streamer spawned with PID: ${streamer.pid}`);
					if (streamer.pid) {
                console.log(`[Stream]: Streamer spawned successfully with PID: ${streamer.pid}`);
            } else {
                console.error("[Stream]: FAILED to spawn streamer process");
            }

				/* 
								 let init = ServerIpcMessage::Init {
											config: StreamerConfig {
												webrtc: web_app.config().webrtc.clone(),
												log_level: web_app.config().log.level_filter,
											},
											host_address: address,
											host_http_port: http_port,
											client_unique_id: Some(client_unique_id),
											client_private_key: pair_info.client_private_key,
											client_certificate: pair_info.client_certificate,
											server_certificate: pair_info.server_certificate,
											app_id: app_id.0,
											demo_param,
											video_frame_queue_size,
											audio_sample_queue_size,
											permissions,
										};
								// 4. Send Initial Config to Streamer via Stdin
				 
				 
								 let obj11 = ServerIpcMessage::Init {
									 
											config: StreamerConfig {
												webrtc: web_app.config().webrtc.clone(),
												log_level: "Info",
											},
											
											
											host_address: "localhost",
											host_http_port: 47989,
											client_unique_id: "abc",
											
											
											client_private_key: pair_info.client_private_key,
											client_certificate: pair_info.client_certificate,
											server_certificate: pair_info.server_certificate,
											app_id: 1551091393,
											demo_param:None,
											video_frame_queue_size:3,
											audio_sample_queue_size:20,
											
											permissions:parsed.Init.role.permissions,
										};
				 
					const serverIpcInit = {
						type: 'Init',
						config: APP_CONFIG,
						host_address: hostData.address,
						// ... map other fields from your Rust Init struct
					};
					
					const keyPath = path.join(__dirname, `../${config_universal.sslKeyFilePath}`);
					const certPath = path.join(__dirname, `../${config_universal.sslCertFilePath}`);
					console.log("keyPath: "+keyPath);
					console.log("certPath: "+certPath);
					if (config.UseHTTPS) {
						//HTTPS certificate details
						ssCertOptions = {
							key: fs.readFileSync(keyPath),
							cert: fs.readFileSync(certPath)
						};	
					
					 */


				 
					 
					var fwsfsg={
					  "Init": {
						"config": {
						  "webrtc": {
							"ice_servers": [
							  {
								"is_default": false,
								"urls": [
								  "stun:stun.l.google.com:19302",
								  "stun:stun.l.google.com:5349",
								  "stun:stun1.l.google.com:3478",
								  "stun:stun1.l.google.com:5349",
								  "stun:stun2.l.google.com:19302",
								  "stun:stun2.l.google.com:5349",
								  "stun:stun3.l.google.com:3478",
								  "stun:stun3.l.google.com:5349",
								  "stun:stun4.l.google.com:19302",
								  "stun:stun4.l.google.com:5349"
								],
								"username": "",
								"credential": ""
							  }
							],
							"ice_server_script": null,
							"port_range": null,
							"nat_1to1": null,
							"network_types": [
							  "Udp4",
							  "Udp6"
							],
							"include_loopback_candidates": true
						  },
						  "log_level": "Info"
						},
						"host_address": "localhost",
						"host_http_port": 47989,
						"client_unique_id": "abc",
						"client_private_key": {
						  "tag": "PRIVATE KEY",
						  "headers": {},
						  "contents": []
						},
						"client_certificate": {
						  "tag": "CERTIFICATE",
						  "headers": {},
						  "contents": []
						},
						"server_certificate": {
						  "tag": "CERTIFICATE",
						  "headers": {},
						  "contents": []
						},
						"app_id": 1551091393,
						"demo_param": null,
						"video_frame_queue_size": 3,
						"audio_sample_queue_size": 20,
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
					
					// --- LOG: Sending Init ---
				// NOTE: Redact secrets in production!
				console.log(`[Stream]: Sending Init to streamer: ${JSON.stringify(fwsfsg, null, 2)}`);


					var fsgsg=JSON.stringify(fwsfsg) + '\n'
					
					console.warn('streamer.stdin.write fsgsg :',fwsfsg);
					
					streamer.stdin.write(fsgsg);

					// 5. IPC Handling: Streamer Stdout -> WebSocket
					streamer.stdout.on('data', (chunk) => {
						
						console.warn('Streamer -> ws chunk :', chunk.toString('utf8'));
						
						// Assuming streamer sends JSON IPC messages
						// You may need to parse stream chunks if they are not newline-delimited
						 //if (ws.readyState === WebSocket.OPEN) 
							 ws.send(chunk);
						
						//ws.send(chunk); 
					});


				streamer.stderr.on('data', (err) => {
                // --- LOG: Streamer Stderr ---
                console.error(`[Streamer Stderr]: ${err.toString()}`);
            });
					// 6. WebSocket -> Streamer Stdin
					ws.on('message', (message1) => 
					{
						
						if(message1)
						{
							console.log('Received:', message1.toString());
							// Forward WS traffic to streamer process
							streamer.stdin.write(message1);
						}
						else 
							console.warn('ws -> Streamer undefined message:');
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
const fs = require('fs');
// 1. Construct the absolute path correctly
// Ensure the path is relative to your server file location
const STREAMER_PATH = path.resolve(__dirname, '../target/debug/streamer.exe');
//C:\Users\e3ds\Desktop\moonlight-web-stream\target\debug\streamer.exe
// 2. Use fs.statSync to verify it's a file that exists



try {
    const stats = fs.statSync(STREAMER_PATH);
    if (!stats.isFile()) {
        throw new Error("Path exists but is not a file");
    }
    console.log(`INFO: Streamer binary verified at: ${STREAMER_PATH}`);
} catch (err) {
    console.error(`FATAL ERROR: Streamer binary not found at: ${STREAMER_PATH}`);
    console.error(`Details: ${err.message}`);
    process.exit(1);
}

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