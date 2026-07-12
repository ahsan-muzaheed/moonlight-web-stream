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

/**
 * Build the streamer's Init payload from stored host + pairing data.
 * This is the piece the earlier stand-alone relay left as a stub.
 */
async function buildInitPayload(ctx, user, { hostId, appId, videoFrameQueueSize, audioSampleQueueSize }) {
  const { storage, config } = ctx;

  const host = storage.getHostForUser(user, hostId); // throws HostNotFound/Forbidden
  if (!host.pairInfo) throw new Error("HostNotPaired");

  // Confirm the requested app exists on the host.
  const apps = await moonlight.listApps(host, user.hostUniqueId);
  const app = apps.find((a) => a.app_id === Number(appId));
  if (!app) throw new Error("AppNotFound");

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
      app_id: Number(appId),
      video_frame_queue_size: videoFrameQueueSize ?? 8,
      audio_sample_queue_size: audioSampleQueueSize ?? 8,
      permissions,
    },
    app,
  };
}

function registerStreamRoutes(app, ctx) {
  const streamerPath = ctx.config.streamer.path;
  const logLevel = ctx.config.streamer.log_level;

  app.ws("/api/host/stream", (ws, req) => {
    // Same auth as the REST routes; the streamer must only run for a real user.
    const user = resolveUser(req, ctx);
    if (!user) {
      ws.close();
      return;
    }

    let streamer = null;

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
        });
      } catch (err) {
        console.warn("[Stream] failed to start:", err.message);
        sendClientText({ DebugLog: { message: `Failed to start stream: ${err.message}`, ty: "FatalDescription" } });
        return ws.close();
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
    });
  });
}

module.exports = { registerStreamRoutes, StreamerProcess, buildInitPayload };