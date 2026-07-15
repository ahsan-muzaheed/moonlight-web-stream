"use strict";

const path = require("path");
const express = require("express");
const expressWs = require("express-ws");
const cookieParser = require("cookie-parser");

const { loadConfig } = require("./config");
const { Storage } = require("./storage");
const { coreRoutes } = require("./routes/core");
const { hostRoutes } = require("./routes/hosts");
const { registerStreamRoutes } = require("./routes/stream");
// NEW architecture (additive): streamers dial IN over a WebSocket.
const { StreamerRegistry } = require("./streamer-registry");
const { registerStreamerEndpoint } = require("./routes/streamer-endpoint");

function main() {
  const config = loadConfig(process.env.CONFIG_PATH || "config.json");
  const storage = new Storage(config.storage.path);
  // Registry of streamer daemons connected via the new WS gateway.
  const streamerRegistry = new StreamerRegistry();
  const ctx = { config, storage, streamerRegistry };

  const app = express();
  expressWs(app); // must run before any app.ws(...)

  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());

  // Serves the frontend's runtime config, like Rust web.rs /config.js.
  app.get("/config.js", (_req, res) => {
    const body = `export default ${JSON.stringify({
      path_prefix: config.web_server.url_path_prefix,
    })}`;
    res.type("text/javascript").send(body);
  });

  // REST API under /api (auth is enforced per-route inside these routers).
  app.use("/api", coreRoutes(ctx));
  app.use("/api", hostRoutes(ctx));

  // WebSocket signaling relay: /api/host/stream  (OLD spawn-based path - kept)
  registerStreamRoutes(app, ctx);

  // NEW: gateway that streamer daemons dial into: /api/streamer/connect
  //      + read-only /api/streamer/list. Does not affect the old path.
  registerStreamerEndpoint(app, ctx, streamerRegistry);

  // Static frontend (built assets). SPA fallback to index.html.
  const staticDir = path.resolve(config.web_server.static_dir);
  
  
  //app.use(express.static(staticDir));
  //app.get("*", (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
  
  
  
  
  // Collapse any accidental double slashes before routing
app.use((req, _res, next) => {
  req.url = req.url.replace(/\/{2,}/g, "/");
  next();
});

app.use(express.static(staticDir));

// SPA fallback — never for /api, never for non-HTML requests
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path === "/config.js") return next();
  if (!req.accepts("html")) return next();
  res.sendFile(path.join(staticDir, "index.html"));
});

// Real JSON 404 so fetch() never sees HTML
app.use((req, res) => res.status(404).json({ error: "Not found", path: req.path }));

  

  const { address, port } = config.web_server;
  app.listen(port, address, () => {
    console.log(`[Server] listening on http://${address}:${port}`);
    console.log(`[Server] static dir: ${staticDir}`);
    console.log(`[Server] streamer:   ${config.streamer.path}`);
    console.log(`[Server] streamer gateway: ws://${address}:${port}/api/streamer/connect`);
  });
}

main();
