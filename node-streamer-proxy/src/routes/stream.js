"use strict";
//curl http://localhost:8080/api/streamer/list
const { spawn } = require("child_process");
const readline = require("readline");
const WebSocket = require("ws");
const { resolveUser } = require("../auth");
const moonlight = require("../moonlight/client");

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
 * Fetch the host's app list.
 *
 * Preferred path: ask the CONNECTED streamer. It sits on the same machine as
 * Sunshine, so it can reach it on localhost - this is what makes a REMOTE Node
 * server work, since Node itself may have no route to Sunshine at all.
 * Address comes from the streamer's own streamer.toml; the pairing certs are
 * sent along with the request, because Node is what did the pairing.
 *
 * Fallback: call Sunshine directly (old spawn architecture, or Node and
 * Sunshine on the same box).
 */
async function fetchAppList(host, user, streamerConn) {
  if (streamerConn && typeof streamerConn.request === "function") {
    const apps = await streamerConn.request("GetAppList", {
      client_unique_id: user.hostUniqueId,
    });
    if (Array.isArray(apps)) {
      console.log(`[Init] applist via streamer: ${apps.length} apps`);
      return apps;
    }
    throw new Error("streamer returned a bad app list");
  }
  throw new Error(`no streamer connected for host ${host.id}`);
}

/**
 * Build the streamer's Init payload from stored host + pairing data.
 * This is the piece the earlier stand-alone relay left as a stub.
 */

async function buildInitPayload(ctx, user, { hostId, appId, videoFrameQueueSize, audioSampleQueueSize, urlOrigin, urlPath, urlParams }, streamerConn) {
 
  console.log("[Init] urlParams:", JSON.stringify(urlParams), "appId:", appId);
 
  const { storage, config } = ctx;
 
 // const host = storage.getHostForUser(user, hostId); // throws HostNotFound/Forbidden
  
  const host = hostId
    ? storage.getHostForUser(user, hostId) // throws HostNotFound/Forbidden
    : storage.getHostByDeviceIdForUser(user, urlParams && urlParams.deviceid);
	
  // Self-pairing streamers pair directly with Sunshine using their own
  // configured PIN - Node never sees cert data for them, so this only
  // gates the legacy direct-to-Sunshine path (no streamer connected).
  //if (!streamerConn && !host.pairInfo) throw new Error("HostNotPaired");
  
  if (!streamerConn && !host.pairInfo) {
    if (host.streamerId) throw new Error("StreamerUnavailable");
    throw new Error("HostNotPaired");
  }
 
  // Prefer an app NAME if the URL supplied one - ids are CRC32(name+image), so
  // they change if an app is renamed, silently breaking saved links.
  const wantedName = urlParams && urlParams.appName;
  const isPathMode = urlParams && urlParams.app; // presence of `app` = exe-path launch
 
  let app = null;
 
  if (isPathMode) {
    // Path-based launch: the streamer builds the exe path from owner/app/version.
    // Nothing to resolve against Sunshine's applist, and app_id is unused because
    // Sunshine prioritises web_exe_path. Note we never fetch the applist here.
    app = { app_id: 0, title: urlParams.app };
    console.log(`[Init] path-mode launch: ${urlParams.owner}/${urlParams.app}/${urlParams.version}`);
  } else {
    // Both remaining modes resolve against the host's live app list, so fetch it
    // now (and only now).
    const apps = await fetchAppList(host, user, streamerConn);
 
    if (wantedName) {
      console.log("[Init] apps.length:", apps.length);
      console.log("[Init] wantedName:", wantedName);
 
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
      const wantedId = Number(appId);
      console.log("[Init] wantedId:", wantedId);
 
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
  }
 
  const role = storage.getRole(user.roleId);
  const permissions = role ? role.permissions : {};
 
  // Field names/shapes here must match Rust ServerIpcMessage::Init exactly.
  return {
	host,
    payload: {
      config: {
        webrtc: config.webrtc,
        log_level: config.streamer.log_level,
      },
      host_address: host.address,
      host_http_port: host.httpPort,
      client_unique_id: user.hostUniqueId,
      // No pairing certs sent - the streamer self-pairs with Sunshine
      // directly using the shared PIN in its own config.
      // The id resolved above - NOT the raw ?appId= from the URL. When the
      // caller used ?appName=, this is the id we looked up for that name.
      app_id: app.app_id,
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

  // NEW architecture: when enabled, route the browser to a streamer that has
  // dialed IN (registry) instead of spawning streamer.exe. Old spawn path stays
  // the default so nothing breaks when this is off.
  const useConnectedStreamer = ctx.config.streamer.use_connected === true;
  const registry = ctx.streamerRegistry;

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
    // True only once THIS ws actually owns the stream (spawned a streamer or
    // successfully attached a connected one). A rejected 2nd viewer must NOT
    // run the cancel/teardown path - that would kill the 1st viewer's stream.
    let ownsStream = false;
    // Streamer chosen for this session. Picked before Init is built because it
    // is also our route to Sunshine for the app list.
    let pickedConn = null;
    let requestedTarget = null;

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
        // In connected mode, choose the streamer FIRST: it is our route to
        // Sunshine (app list lookup), and we need it before building Init.
		if (useConnectedStreamer) {
          const params = init.url_params || {};
          const wantStreamerId = params.streamer || null;
          const wantDeviceId = params.deviceid || null;

          if (wantStreamerId) {
            requestedTarget = { kind: "streamer", id: wantStreamerId };
            pickedConn = registry.get(wantStreamerId);
          } else if (wantDeviceId) {
            requestedTarget = { kind: "machine", id: wantDeviceId };
            pickedConn = registry.pickByDeviceId(wantDeviceId);
          } else {
            pickedConn = registry
              .list()
              .filter((st) => !st.busy && !st.draining && st.alive)
              .map((st) => registry.get(st.id))[0];
          }
        }
		console.log("[Stream] picked:", pickedConn ? `streamer=${pickedConn.id} machine=${pickedConn.deviceId} alive=${pickedConn.isAlive()}` : "NONE", "requested:", JSON.stringify(requestedTarget));
        built = await buildInitPayload(ctx, user, {
          hostId: init.host_id,
          appId: init.app_id,
          videoFrameQueueSize: init.video_frame_queue_size,
          audioSampleQueueSize: init.audio_sample_queue_size,
          // URL components the browser now sends (see sendInitMessage in the frontend)
          urlOrigin: init.url_origin,
          urlPath: init.url_path,
          urlParams: init.url_params,
        }, pickedConn);
	} catch (err) {
        console.warn("[Stream] failed to start:", err.message);
        const retryable = err.message === "StreamerUnavailable";
        sendClientText({ DebugLog: { message: retryable ? "No machine available" : `Failed to start stream: ${err.message}`, ty: retryable ? "Retryable" : "FatalDescription" } });
        return ws.close();
      }

      // Reconnecting to a host whose teardown is still pending? Abort it.
      //activeHost = ctx.storage.getHost(init.host_id);
	    activeHost = built.host;
      const pending = pendingCancels.get(String(init.host_id));
      if (pending) {
        clearTimeout(pending);
        pendingCancels.delete(String(init.host_id));
        console.log(`[Stream] reconnect to host ${init.host_id}, pending cancel aborted`);
      }

      // Tell the client which app is launching (Rust sends UpdateApp here).
      sendClientText({ UpdateApp: { app: built.app } });

      // Handler for messages coming FROM the streamer TO this browser. Same
      // logic whether the streamer was spawned or is a connected daemon.
      const handleStreamerMessage = (obj) => {
        if (obj && obj.__binary) {
          // connected-streamer binary frame (media/transport)
          if (ws.readyState === WebSocket.OPEN) ws.send(obj.__binary, { binary: true });
        } else if (obj === "Stop") {
          ws.close();
        } else if (obj && obj.WebSocket) {
          sendClientText(obj.WebSocket);
        } else if (obj && obj.WebSocketTransport) {
          // spawned-streamer binary frame arrives as an int array
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(Buffer.from(obj.WebSocketTransport), { binary: true });
          }
        }
      };

      if (useConnectedStreamer) {
        // ---- NEW: attach to a streamer that dialed in --------------------
        // For now, single streamer: use the requested id if given, else the
        // first connected one. (Multi-streamer picking is a later step.)
        const conn = pickedConn;

		 // If a requested-by-id streamer is draining/busy, treat as unavailable.
        // const usable = conn && typeof conn.isAvailable === "function" ? conn.isAvailable() : !!conn;
        // if (conn && !usable) {
          // console.warn("[Stream] requested streamer not available (busy/draining)");
          // sendClientText({ DebugLog: { message: "No machine available", ty: "Retryable" } });
          // return ws.close();
        // }
		
		
		const unavailableMsg =
          requestedTarget && requestedTarget.kind === "machine"
            ? `Machine "${requestedTarget.id}" is unavailable`
            : requestedTarget && requestedTarget.kind === "streamer"
            ? `Streamer "${requestedTarget.id}" is unavailable`
            : "No machine available";

        const usable = conn && typeof conn.isAvailable === "function" ? conn.isAvailable() : !!conn;
        if (conn && !usable) {
          console.warn(`[Stream] target not available: ${unavailableMsg}`);
          sendClientText({ DebugLog: { message: unavailableMsg, ty: "Retryable" } });
          return ws.close();
        }
		

		if (!conn) {
          console.warn(`[Stream] target unavailable: ${unavailableMsg}`);
          sendClientText({ DebugLog: { message: unavailableMsg, ty: "Retryable" } });
	  
		  /* sendClientText({
			DebugLog: {
			  message: "No machine available right now — retrying shortly…",
			  ty: "Retryable",   // was "FatalDescription"
			},
		  }); */
		  
		  // both reject branches (no streamer / busy), changed from:
//   { message: "No streamer available", ty: "FatalDescription" }
//   { message: "Streamer is busy",      ty: "FatalDescription" }
// to:
  		 return ws.close();
        }
        if (!conn.attach(handleStreamerMessage)) {
          console.warn(`[Stream] streamer "${conn.id}" is busy`);
          //sendClientText({ DebugLog: { message: "Streamer is busy", ty: "FatalDescription" } });
           
          sendClientText({ DebugLog: { message: "No machine available", ty: "Retryable" } });
          return ws.close();
        }

        streamer = conn; // has .send(); detached (not stopped) on close
        ownsStream = true; // we successfully took the streamer
        console.log(`[Stream] attached to connected streamer "${conn.id}"`);
        streamer.send({ Init: built.payload });
      } else {
        // ---- OLD: spawn streamer.exe as a child --------------------------
        streamer = new StreamerProcess(streamerPath, logLevel);
        streamer.onMessage = handleStreamerMessage;
        streamer.onExit = () => {
          if (ws.readyState === WebSocket.OPEN) ws.close();
        };
        ownsStream = true; // spawned one for ourselves
        streamer.send({ Init: built.payload });
      }
    });

    ws.on("close", () => {
      // A rejected viewer (no free streamer / busy) never owned the stream.
      // Do nothing on close - otherwise we'd cancel the app the CURRENT viewer
      // is using and tear down their session.
      if (!ownsStream) {
        return;
      }

      const spawned = streamer && !useConnectedStreamer;
      const connected = streamer && useConnectedStreamer && typeof streamer.detach === "function";

      // For the SPAWNED path, keep old behaviour: Stop kills the child, and the
      // cancel-to-Sunshine (below) is done directly by Node.
      if (spawned && typeof streamer.stop === "function") {
        streamer.stop();
      }

      if (!cancelOnDisconnect || !activeHost) {
        // No cancel wanted: still stop/detach the connected streamer.
        if (connected) { streamer.send("Stop"); streamer.detach(); }
        return;
      }

      const hostKey = String(activeHost.id);
      if (pendingCancels.has(hostKey)) return; // already scheduled

      // Keep a handle to the streamer for the deferred cancel (the outer
      // `streamer` var could be reused if another browser attaches meanwhile;
      // for single-streamer that isn't a concern, but capture it to be safe).
      const conn = connected ? streamer : null;

      // Mark draining IMMEDIATELY (synchronous), before any timer/await, so a
      // viewer arriving in the same tick can't be handed this dying streamer.
      if (conn) conn.draining = true;

      const fire = async () => {
        pendingCancels.delete(hostKey);
        try {
          if (conn) {
            // NEW: route cancel THROUGH the streamer (co-located with Sunshine).
            // Order matters: Cancel first so Sunshine quits the app, THEN Stop
            // so the streamer tears down. Works same-box or remote.
            conn.send("Cancel");
            conn.send("Stop");
            conn.detach();
            console.log(`[Stream] cancel routed via streamer for host ${hostKey}`);
          } else {
            // SPAWNED path: Node calls Sunshine directly (same box only).
            const host = ctx.storage.getHost(activeHost.id);
            if (!host) return;
            await moonlight.cancelApp(host, user.hostUniqueId);
            console.log(`[Stream] app cancelled on host ${hostKey}, machine freed`);
          }
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
