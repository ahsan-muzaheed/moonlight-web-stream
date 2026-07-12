// Node.js equivalent of src/api/stream.rs (start_host) + common/src/ipc.rs
// Wire protocol to the streamer: newline-delimited JSON (NDJSON) on stdin/stdout,
// plain log lines on stderr. Message envelope = serde externally-tagged enum.
//
// Requires: npm i ws express express-ws   (Node 18+, ESM)

import { spawn } from "node:child_process";
import readline from "node:readline";

// ---------------------------------------------------------------------------
// IPC envelope helpers  (mirror ServerIpcMessage / StreamerIpcMessage)
//
// serde externally-tagged rules the streamer expects:
//   - struct/newtype variant  ->  { "VariantName": <payload> }
//   - unit variant            ->  "VariantName"   (bare JSON string)
//   - bytes::Bytes            ->  array of u8 integers, e.g. [12,34,...]
// ---------------------------------------------------------------------------

const ServerIpc = {
  init: (payload) => ({ Init: payload }),                     // {"Init": {...}}
  webSocket: (msg) => ({ WebSocket: msg }),                   // {"WebSocket": <StreamClientMessage>}
  webSocketTransport: (buf) => ({ WebSocketTransport: Array.from(buf) }), // Buffer -> [u8]
  stop: () => "Stop",                                         // bare string, NOT {"Stop":null}
};

// Incoming StreamerIpcMessage discriminator (what the streamer sends back)
function parseStreamerMessage(obj) {
  if (obj === "Stop") return { kind: "Stop" };
  if (obj && typeof obj === "object") {
    if ("WebSocket" in obj) return { kind: "WebSocket", msg: obj.WebSocket };
    if ("WebSocketTransport" in obj)
      // int array -> Buffer
      return { kind: "WebSocketTransport", data: Buffer.from(obj.WebSocketTransport) };
  }
  return { kind: "Unknown", raw: obj };
}

// ---------------------------------------------------------------------------
// ChildIpc  (mirror create_child_ipc / ipc_sender / IpcReceiver)
// ---------------------------------------------------------------------------

class ChildIpc {
  #child;
  #onMessage;
  #onExit;

  constructor(streamerPath, { onMessage, onExit }) {
    this.#onMessage = onMessage;
    this.#onExit = onExit;

    // kill_on_drop(true) + piped stdin/stdout/stderr  (stream.rs lines 208-213)
    this.#child = spawn(streamerPath, [], { stdio: ["pipe", "pipe", "pipe"] });

    // stdout: one JSON message per line  (ipc.rs create_lines / IpcReceiver::recv)
    const rl = readline.createInterface({ input: this.#child.stdout });
    rl.on("line", (line) => {
      if (!line) return;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        console.warn("[Ipc] failed to deserialize message:", line);
        return; // ipc.rs returns None on bad line; loop continues
      }
      this.#onMessage(parseStreamerMessage(obj));
    });

    // stderr: streamer's log output, printed verbatim  (ipc.rs lines 71-83)
    readline
      .createInterface({ input: this.#child.stderr })
      .on("line", (l) => console.log(`[streamer] ${l}`));

    this.#child.on("exit", (code) => this.#onExit?.(code));
  }

  // ipc_sender: stringify -> append '\n' -> write -> (implicit flush)  (ipc.rs 154-176)
  send(message) {
    if (!this.#child.stdin.writable) return;
    this.#child.stdin.write(JSON.stringify(message) + "\n");
  }

  kill() {
    try {
      this.#child.kill(); // SIGTERM; use "SIGKILL" to force
    } catch (err) {
      console.warn("failed to kill streamer child:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// WebSocket route: GET /api/host/stream   (mirror start_host)
//
// `deps` is your app layer, equivalent to what stream.rs pulls from
// App/user/host/pair_info before building the Init:
//   deps.streamerPath
//   deps.buildInitPayload({ user, hostId, appId, videoFrameQueueSize, audioSampleQueueSize })
//     -> the full ServerIpcMessage::Init body (host_address, http_port, the three
//        Pem certs, webrtc config, permissions, queue sizes, ...). The cert/config
//        JSON shapes must match Rust serde (pem 3.x + WebRtcConfig) exactly.
// ---------------------------------------------------------------------------

export function registerStreamRoute(app, deps) {
  // with express-ws: app.ws("/api/host/stream", handler)
  app.ws("/api/host/stream", async (ws /*, req */) => {
    let ipc = null;
    let closedWarned = false;

    // -- Phase 1: first browser message MUST be Init  (stream.rs lines 48-83)
    const onFirstMessage = async (raw, isBinary) => {
      if (isBinary) return ws.close(); // binary before init -> bail (line 51)

      let clientMsg;
      try {
        clientMsg = JSON.parse(raw.toString());
      } catch {
        return ws.close();
      }

      // Expect { "Init": { host_id, app_id, video_frame_queue_size, audio_sample_queue_size } }
      const init = clientMsg?.Init;
      if (!init) {
        console.warn("WebSocket didn't send init as first message, closing it");
        return ws.close();
      }

      // -- Build the richer ServerIpcMessage::Init from your app layer
      let initPayload;
      try {
        initPayload = await deps.buildInitPayload({
          hostId: init.host_id,
          appId: init.app_id,
          videoFrameQueueSize: init.video_frame_queue_size,
          audioSampleQueueSize: init.audio_sample_queue_size,
        });
      } catch (err) {
        console.warn("failed to start stream:", err);
        return ws.close();
      }

      // -- Phase 2: spawn streamer + wire streamer -> browser (stream.rs 208-317)
      ipc = new ChildIpc(deps.streamerPath, {
        onMessage: (m) => {
          switch (m.kind) {
            case "WebSocket": // text frame back to browser
              try {
                ws.send(JSON.stringify(m.msg));
              } catch {
                if (!closedWarned) {
                  ipc.send(ServerIpc.stop());
                  closedWarned = true;
                }
              }
              break;
            case "WebSocketTransport": // binary frame back to browser
              try {
                ws.send(m.data, { binary: true });
              } catch {
                if (!closedWarned) {
                  ipc.send(ServerIpc.stop());
                  closedWarned = true;
                }
              }
              break;
            case "Stop":
              ws.close();
              break;
          }
        },
        onExit: () => {
          // streamer crashed/exited -> close the socket (stream.rs 304-310)
          try { ws.close(); } catch {}
        },
      });

      // -- Send Init into the streamer  (stream.rs 319-337)
      ipc.send(ServerIpc.init(initPayload));

      // -- Phase 3: browser -> streamer relay  (stream.rs 339-357)
      ws.on("message", (data, isBinary) => {
        if (isBinary) {
          ipc.send(ServerIpc.webSocketTransport(data)); // Buffer -> [u8]
        } else {
          let msg;
          try {
            msg = JSON.parse(data.toString());
          } catch {
            console.warn("[Stream] failed to deserialize from json");
            return ws.close();
          }
          ipc.send(ServerIpc.webSocket(msg)); // wrap, pass inner through opaque
        }
      });
    };

    // one-shot handler for the init message, then the loop above takes over
    ws.once("message", onFirstMessage);

    ws.on("close", () => {
      ipc?.kill(); // kill_on_drop equivalent (stream.rs 312-315)
    });
  });
}
