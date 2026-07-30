"use strict";

const WebSocket = require("ws");
const { defaultUser } = require("../auth");

/**
 * The endpoint streamer daemons dial INTO (new architecture).
 *   GET /api/streamer/connect
 *
 * Handshake (this step only - no browser relay yet):
*   1. streamer opens the WS and sends:  { "type":"register", "id":"<streamer_id>", "device_id":"<hostname>", "token":"<auth_token>", "address":"<ip>", "http_port":<port> }
 *      address/http_port let Node auto-create a Host record on first
 *      register - see autoLinkStreamerToHost below.
 *   2. Node checks the token, registers the connection, replies:
 *        { "type":"registered", "id":"<id>" }        on success
 *        { "type":"error", "reason":"..." } + close   on failure
 *   3. either side may send { "type":"ping" } / { "type":"pong" } to keep alive.
 *
 * Auth: a single shared token from config for now (config.streamer_gateway.token).
 * If no token is configured, auth is skipped (dev only) with a warning.
 *
 * This is ADDITIVE. The old spawn-based /api/host/stream path is untouched.
 */
function registerStreamerEndpoint(app, ctx, registry) {
  const gwConfig = ctx.config.streamer_gateway || {};
  const expectedToken = gwConfig.token || null;

  if (!expectedToken) {
    console.warn(
      "[StreamerGW] no streamer_gateway.token configured - accepting any streamer (DEV ONLY)"
    );
  }

  app.ws("/api/streamer/connect", (ws, req) => {
    let registered = null; // StreamerConnection once handshake completes
    const peer = (req && req.socket && req.socket.remoteAddress) || "unknown";
    console.log(`[StreamerGW] incoming streamer connection from ${peer}`);

    // Give the streamer a short window to register before we drop it.
    const registerTimer = setTimeout(() => {
      if (!registered) {
        console.warn("[StreamerGW] streamer did not register in time, closing");
        safeSend(ws, { type: "error", reason: "register timeout" });
        ws.close();
      }
    }, 10000);

    ws.on("message", (data, isBinary) => {
      // Treat as binary if flagged OR if the payload isn't valid JSON text.
      // (Node<->Node ws sometimes delivers Buffers with isBinary=false.)
      if (isBinary) {
        if (!registered) return ws.close();
        registered.deliver({ __binary: Buffer.from(data) });
        return;
      }

      const text = data.toString();
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        // Not JSON: if we're registered, it's opaque binary media -> deliver.
        if (registered) {
          registered.deliver({ __binary: Buffer.from(data) });
        } else {
          console.warn("[StreamerGW] non-JSON before register, ignoring");
        }
        return;
      }

      // ---- Registration handshake ----------------------------------------
      if (!registered) {
        if (msg.type !== "register") {
          safeSend(ws, { type: "error", reason: "expected register first" });
          return ws.close();
        }
        if (expectedToken && msg.token !== expectedToken) {
          console.warn(`[StreamerGW] streamer "${msg.id}" bad token, rejecting`);
          safeSend(ws, { type: "error", reason: "bad token" });
          return ws.close();
        }
        if (!msg.id || typeof msg.id !== "string") {
          safeSend(ws, { type: "error", reason: "missing id" });
          return ws.close();
        }

clearTimeout(registerTimer);
        const deviceId =
          typeof msg.device_id === "string" && msg.device_id ? msg.device_id : null;
        const address = typeof msg.address === "string" && msg.address ? msg.address : null;
        const httpPort = Number.isInteger(msg.http_port) ? msg.http_port : null;
        registered = registry.add(msg.id, ws, deviceId);
        autoLinkStreamerToHost(ctx, msg.id, deviceId, address, httpPort);
        safeSend(ws, { type: "registered", id: msg.id });
        return;
      }

      registry.touch(registered.id);

      // Control frames carry a top-level "type" (ping/pong). Everything else is
      // an IPC message ({WebSocket:...}/{WebSocketTransport:...}/"Stop") destined
      // for the currently-attached browser session.
      if (msg && typeof msg.type === "string") {
        if (msg.type === "ping") {
          safeSend(ws, { type: "pong" });
        } else if (msg.type === "response") {
          // Reply to a Node -> streamer request (e.g. GetAppList).
          registered.handleResponse(msg);
        }
        // "pong" and unknown control types: ignore.
        return;
      }

      // IPC message -> route to the attached browser.
      registered.deliver(msg);
    });

    ws.on("close", () => {
      clearTimeout(registerTimer);
      if (registered) {
        registered.failAllPending("streamer disconnected");
        registry.remove(registered.id, ws);
      }
      console.log(`[StreamerGW] connection from ${peer} closed`);
    });

    ws.on("error", (err) => {
      console.warn(`[StreamerGW] socket error (${peer}):`, err.message);
    });
  });

  // Small read-only status endpoint so you can see who's connected.
  app.get("/api/streamer/list", (req, res) => {
    res.json({ streamers: registry.list() });
  });
}

/**
 * Runs on every register, so it also self-heals if a host's link is ever
 * lost.
 *
 * Matching rule:
 *   1. Already linked to this exact streamerId?              -> nothing to do.
 *   2. Exactly ONE unlinked host record shares this deviceId? -> link it.
 *   3. Zero such candidates, and this register included an address?
 *        -> create the Host record outright, owned by the configured
 *           default user, then link it. Both streamer types (Rust and
 *           Sunshine) now send their own address/http_port in "register",
 *           so there's nothing left for a human to fill in.
 *   4. Zero candidates, no address given (older streamer build)?
 *        -> leave it alone and log why, same as before.
 *   5. MULTIPLE candidates?
 *        -> leave it alone and log why, rather than risk attaching to the
 *           wrong host. (Two different physical machines sharing a deviceId
 *           still needs a manual/admin resolution.)
 */
function autoLinkStreamerToHost(ctx, streamerId, deviceId, address, httpPort) {
  if (!deviceId) return; // nothing to match on
  const storage = ctx.storage;

  if (storage.getHostByStreamerId(streamerId)) return; // already linked

  const candidates = storage.getHostsByDeviceId(deviceId).filter((h) => !h.streamerId);
  if (candidates.length === 1) {
    const host = candidates[0];
    storage.patchHost(host.id, { deviceId, streamerId });
    console.log(`[StreamerGW] auto-linked streamer "${streamerId}" -> host ${host.id} (machine "${deviceId}")`);
    return;
  }

  if (candidates.length === 0) {
    if (address) {
      const owner = defaultUser(ctx);
      if (!owner) {
        console.warn(
          `[StreamerGW] no unlinked host for machine "${deviceId}" and no default_user_id configured - ` +
          `can't auto-create, add/link it manually`
        );
        return;
      }
      const host = storage.addHost({ address, httpPort, ownerId: owner.id });
      storage.patchHost(host.id, { deviceId, streamerId });
      console.log(`[StreamerGW] auto-created host ${host.id} (machine "${deviceId}") for streamer "${streamerId}"`);
    } else {
      console.log(`[StreamerGW] no unlinked host found for machine "${deviceId}" (streamer "${streamerId}") - add/link it manually`);
    }
    return;
  }

  console.warn(
    `[StreamerGW] ${candidates.length} unlinked hosts share machine "${deviceId}" - ` +
    `can't auto-link streamer "${streamerId}", resolve manually`
  );
}

function safeSend(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

module.exports = { registerStreamerEndpoint };
