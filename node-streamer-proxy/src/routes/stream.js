"use strict";

const { spawn } = require("child_process");
const readline = require("readline");
const WebSocket = require("ws");
const { resolveUser } = require("../auth");
const moonlight = require("../moonlight/client");
const { toPkcs8 } = require("../moonlight/crypto");

/**
 * The signaling relay + streamer lifecycle.
 * Combines the earlier stream-relay work with a real buildInitPayload that
 * pulls host/app/cert data out of storage (Rust src/api/stream.rs 88-337).
 */

// Log level string -> what the streamer's tracing filter expects.
const LOG_LEVELS = { Off: "OFF", Error: "ERROR", Warn: "WARN", Info: "INFO", Debug: "DEBUG", Trace: "TRACE" };

class StreamerProcess {
  constructor(streamerPath, logLevel) {
    this.child = spawn(streamerPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, RUST_LOG: process.env.RUST_LOG || (LOG_LEVELS[logLevel] || "INFO").toLowerCase() },
    });
    this.onMessage = null;
    this.onExit = null;

    readline.createInterface({ input: this.child.stdout }).on("line", (line) => {
      if (!line) return;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        console.warn("[streamer] non-JSON stdout line:", line);
        return;
      }
      if (this.onMessage) this.onMessage(obj);
    });

    readline
      .createInterface({ input: this.child.stderr })
      .on("line", (l) => console.log(`[streamer] ${l}`));

    this.child.on("exit", (code) => {
      if (this.onExit) this.onExit(code);
    });
  }

  send(message) {
    if (this.child.stdin.writable) this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  stop() {
    try {
      this.send("Stop");
      this.child.kill();
    } catch {
      /* already gone */
    }
  }
}

// Coerce one URL component (origin or path) to a bounded, control-char-free
// string. Caps length so a hostile URL can't bloat the Init or the app env.
function sanitizeUrlPart(value, maxLen) {
  if (typeof value !== "string") return "";
  // strip CR/LF/NUL so the value can't inject into headers or env blocks
  return value.replace(/[\r\n\0]/g, "").slice(0, maxLen);
}

// Coerce the query params into a safe flat string->string map.
// Caps the number of params and each value's length.
function sanitizeUrlParams(params) {
  const out = {};
  if (!params || typeof params !== "object") return out;
  let n = 0;
  for (const [k, v] of Object.entries(params)) {
    if (n++ >= 64) break;                          // cap number of params
    if (typeof k !== "string") continue;
    const key = k.replace(/[\r\n\0]/g, "").slice(0, 128);   // cap key length
    const val = String(v ?? "").replace(/[\r\n\0]/g, "").slice(0, 4096); // cap value length
    out[key] = val;
  }
  return out;
}

/**
 * Build the streamer's Init payload from stored host + pairing data.
 * This is the piece the earlier stand-alone relay left as a stub.
 */
async function buildInitPayload(ctx, user, { hostId, appId, videoFrameQueueSize, audioSampleQueueSize, urlOrigin, urlPath, urlParams }) {
	
	console.log("[Init] urlParams:", JSON.stringify(urlParams), "appId:", appId);
	
  const { storage, config } = ctx;

  const host = storage.getHostForUser(user, hostId); // throws HostNotFound/Forbidden
  if (!host.pairInfo) throw new Error("HostNotPaired");

  // Confirm the requested app exists on the host.
  const apps = await moonlight.listApps(host, user.hostUniqueId);
  
  
//const app = apps.find((a) => a.app_id === Number(appId));
  //if (!app) throw new Error("AppNotFound");
  
// Prefer an app NAME if the URL supplied one - ids are CRC32(name+image), so
// they change if an app is renamed, silently breaking saved links. Names are stable.
const wantedName = urlParams && urlParams.appName;

/* let app;
if (wantedName) {
  app = apps.find((a) => a.title === wantedName);
  if (!app) throw new Error(`ss-> AppNotFound: no app named "${wantedName}"`);
} else {
  app = apps.find((a) => a.app_id === Number(appId));
  if (!app) throw new Error("AppNotFound");
} */

// Find the app to launch.
// Prefer ?appName= when present: Sunshine derives app ids as CRC32(name + image),
// so renaming an app changes its id and breaks saved links. Names are stable.
let app = null;

if (wantedName) 
{
  // Look up by name
  console.log("[Init] apps.length:", apps.length);
  console.log("[Init] wantedName:",wantedName);
  
  for (let i = 0; i < apps.length; i++) {
	  
	   console.log("[Init] apps[i].title:", apps[i].title);
	   
    if (apps[i].title === wantedName) {
      app = apps[i];
      break;
    }
  }
  if (app === null) {
    throw new Error(`AppNotFound: no app named "${wantedName}"`);
  }
} else {
  // Look up by numeric id
  const wantedId = Number(appId);
    console.log("[Init] wantedId:",wantedId);
  for (let i = 0; i < apps.length; i++) {
	  
	   console.log("[Init] apps[i].app_id:", apps[i].app_id);
	   
	   
    if (apps[i].app_id === wantedId) {
      app = apps[i];
      break;
    }
  }
  if (app === null) {
    throw new Error(`AppNotFound: no app with id ${appId}`);
  }
}

// use the resolved id everywhere downstream
const resolvedAppId = app.app_id;

  
  
  

  const role = storage.getRole(user.roleId);
  const permissions = role ? role.permissions : {};

  // Field names/shapes here must match Rust ServerIpcMessage::Init exactly.
  return {
    payload: {
      config: {
        webrtc: config.webrtc,
        log_level: config.streamer.log_level,
      },
      host_address: host.address,
      host_http_port: host.httpPort,
      client_unique_id: user.hostUniqueId,
      client_private_key: toPkcs8(host.pairInfo.clientPrivateKey),
      client_certificate: host.pairInfo.clientCertificate,
      server_certificate: host.pairInfo.serverCertificate,
      app_id: app.app_id,//Number(appId),
      video_frame_queue_size: videoFrameQueueSize ?? 8,
      audio_sample_queue_size: audioSampleQueueSize ?? 8,
      permissions,
      // ---- URL passthrough -------------------------------------------------
      // The browser's full stream URL, split into components so the streamer
      // and Sunshine can rebuild it on demand without hitting a query-string
      // length limit (components stay separate params instead of one nested,
      // double-encoded blob). Rebuild: url_origin + url_path + "?" + encode(url_params)
      //
      // url_origin : scheme + host + port, e.g. "http://172.7.191.71:8080" (no trailing slash)
      // url_path   : path only, e.g. "/stream.html"
      // url_params : flat string->string map of every query param (hostId, appId, + custom)
      url_origin: sanitizeUrlPart(urlOrigin, 512),
      url_path: sanitizeUrlPart(urlPath, 512),
      url_params: sanitizeUrlParams(urlParams),
    },
    app,
  };
}

// Cancels scheduled but not yet fired, keyed by host id. Lets a quick reconnect
// abort the pending teardown instead of losing the session to a network blip.
const pendingCancels = new Map();

function registerStreamRoutes(app, ctx) {
  const streamerPath = ctx.config.streamer.path;
  const logLevel = ctx.config.streamer.log_level;

  // Free the host for the next user when a stream drops.
  // grace secs = 0 -> cancel immediately on disconnect.
  const cancelOnDisconnect = ctx.config.streamer.cancel_app_on_disconnect !== false;
  const graceSecs = ctx.config.streamer.cancel_grace_secs ?? 10;

  app.ws("/api/host/stream", (ws, req) => {
    // Same auth as the REST routes; the streamer must only run for a real user.
    const user = resolveUser(req, ctx);
    if (!user) {
      ws.close();
      return;
    }

    let streamer = null;
    let activeHost = null; // captured at Init, needed by the close handler

    const sendClientText = (inner) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(inner));
    };

    ws.on("message", async (data, isBinary) => {
      // Once running, relay everything through.
      if (streamer) {
        if (isBinary) {
          streamer.send({ WebSocketTransport: [...data] });
        } else {
          let msg;
          try {
            msg = JSON.parse(data.toString());
          } catch {
            return ws.close();
          }
          streamer.send({ WebSocket: msg });
        }
        return;
      }

      // First message must be Init.
      let clientMsg;
      try {
        clientMsg = JSON.parse(data.toString());
      } catch {
        return ws.close();
      }
      const init = clientMsg && clientMsg.Init;
      if (!init) {
        console.warn("[Stream] first message was not Init");
        return ws.close();
      }

      let built;
      try {
        built = await buildInitPayload(ctx, user, {
          hostId: init.host_id,
          appId: init.app_id,
          videoFrameQueueSize: init.video_frame_queue_size,
          audioSampleQueueSize: init.audio_sample_queue_size,
          // URL components the browser now sends (see sendInitMessage in the frontend)
          urlOrigin: init.url_origin,
          urlPath: init.url_path,
          urlParams: init.url_params,
        });
      } catch (err) {
        console.warn("[Stream] failed to start:", err.message);
        sendClientText({ DebugLog: { message: `Failed to start stream: ${err.message}`, ty: "FatalDescription" } });
        return ws.close();
      }

      // Reconnecting to a host whose teardown is still pending? Abort it.
      activeHost = ctx.storage.getHost(init.host_id);
      const pending = pendingCancels.get(String(init.host_id));
      if (pending) {
        clearTimeout(pending);
        pendingCancels.delete(String(init.host_id));
        console.log(`[Stream] reconnect to host ${init.host_id}, pending cancel aborted`);
      }

      // Tell the client which app is launching (Rust sends UpdateApp here).
      sendClientText({ UpdateApp: { app: built.app } });

      streamer = new StreamerProcess(streamerPath, logLevel);

      streamer.onMessage = (obj) => {
        if (obj === "Stop") {
          ws.close();
        } else if (obj.WebSocket) {
          sendClientText(obj.WebSocket);
        } else if (obj.WebSocketTransport) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(Buffer.from(obj.WebSocketTransport), { binary: true });
          }
        }
      };

      streamer.onExit = () => {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      };

      streamer.send({ Init: built.payload });
    });

    ws.on("close", () => {
      if (streamer) streamer.stop();

      // Killing the streamer only drops the Moonlight client; Sunshine keeps the
      // app running so it can be resumed. Explicitly cancel to free the machine.
      if (!cancelOnDisconnect || !activeHost) return;

      const hostKey = String(activeHost.id);
      if (pendingCancels.has(hostKey)) return; // already scheduled

      const fire = async () => {
        pendingCancels.delete(hostKey);
        try {
          // Re-read: pairInfo may have changed since Init.
          const host = ctx.storage.getHost(activeHost.id);
          if (!host) return;
          await moonlight.cancelApp(host, user.hostUniqueId);
          console.log(`[Stream] app cancelled on host ${hostKey}, machine freed`);
        } catch (err) {
          console.warn(`[Stream] cancel failed on host ${hostKey}:`, err.message);
        }
      };

      if (graceSecs > 0) {
        console.log(
          `[Stream] client gone; cancelling app on host ${hostKey} in ${graceSecs}s unless it reconnects`
        );
        pendingCancels.set(hostKey, setTimeout(fire, graceSecs * 1000));
      } else {
        fire();
      }
    });
  });
}

module.exports = { registerStreamRoutes, StreamerProcess, buildInitPayload };