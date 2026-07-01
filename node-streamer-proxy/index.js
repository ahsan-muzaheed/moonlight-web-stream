const cluster = require('cluster');
const express = require('express');
const path = require('path');

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

    // 1. Path to your frontend distribution folder
    const distPath = path.join(__dirname, '..', 'dist');
    // 2. Path to your root directory
    const rootPath = path.join(__dirname, '..');

    // 3. Serve all static assets from the 'dist' folder
    app.use(express.static(distPath));
    // 4. Serve any additional static assets from the root directory
    app.use(express.static(rootPath));

    // 5. Explicitly serve stream.html when hitting the /stream.html route
    app.get('/stream.html', (req, res) => {
        res.sendFile(path.join(distPath, 'stream.html'), (err) => {
            if (err) {
                console.error(`Error sending stream.html: ${err}`);
                res.status(err.status).end();
            }
        });
    });

    // Start the server
    app.listen(PORT, HOST, () => {
        console.log(`INFO server::server: starting service: "node-web-service-${HOST}:${PORT}", worker PID: ${process.pid}, listening on: ${HOST}:${PORT}`);
    });
}