"use strict";

/**
 * Registry of streamer daemons that have dialed IN over a WebSocket.
 *
 * NEW ARCHITECTURE (additive - does not touch the old spawn path):
 *   Old: Node spawns streamer.exe as a child, talks over stdin/stdout.
 *   New: streamer.exe runs on its own, dials OUT to this Node server over a
 *        WebSocket and registers here. Node never needs Sunshine exposed.
 *
 * This file is ONLY the registry + connection bookkeeping. It does not yet
 * relay browser signaling - that comes in a later step. For now a streamer can:
 *   connect -> register -> heartbeat -> disconnect, and Node tracks it.
 *
 * One streamer per id for now (single-streamer phase). Multi-streamer / picking
 * a free one for a user is a later step; the map already supports many entries.
 */

class StreamerConnection {
  constructor(id, ws, machineId) {
    this.id = id;
    this.machineId = machineId || null;
    this.ws = ws;
    this.connectedAt = Date.now();
    this.lastSeen = Date.now();
    this.busy = false; // true while a browser session is attached
    // True once we've told this streamer to Stop/exit. It may still have an
    // OPEN socket for a moment while it shuts down + relaunches, but it must
    // NOT be handed to a new viewer during that window.
    this.draining = false;
    // The currently-attached browser handler. Streamer -> browser messages are
    // routed here. null when idle.
    this.onMessage = null;
    // In-flight request/response calls (e.g. GetAppList). Keyed by request id.
    // The streamer echoes the id back so replies can be matched to callers.
    this.pending = new Map();
    this.nextRequestId = 1;
  }

  /**
   * Send a request to the streamer and await its reply.
   * Used for things Node needs FROM Sunshine but can't reach directly - the
   * streamer is co-located with Sunshine, so it makes the call locally.
   *
   * Wire: Node -> {"type":"request","id":N,"method":"...","params":{...}}
   *       Streamer -> {"type":"response","id":N,"ok":true,"result":...}
   *                or {"type":"response","id":N,"ok":false,"error":"..."}
   */
  request(method, params = {}, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (!this.isAlive()) {
        return reject(new Error("streamer not connected"));
      }
      const id = this.nextRequestId++;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`streamer request "${method}" timed out`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.ws.send(JSON.stringify({ type: "request", id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /** Called by the gateway when a {"type":"response"} frame arrives. */
  handleResponse(msg) {
    const entry = this.pending.get(msg.id);
    if (!entry) return; // late/unknown reply
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error || "streamer request failed"));
  }

  /** Reject everything in flight (called on disconnect). */
  failAllPending(reason) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }

  /**
   * Attach a browser session. `handler(obj)` receives each decoded message the
   * streamer sends (the {WebSocket:...}/{WebSocketTransport:...}/"Stop" enum).
   * Returns false if the streamer is already busy with another session.
   */
  attach(handler) {
    if (this.busy || this.draining) return false;
    this.busy = true;
    this.onMessage = handler;
    return true;
  }

  /** Detach the current browser session. Does NOT close the streamer socket -
   *  the streamer stays connected and reusable for the next stream. */
  detach() {
    this.busy = false;
    this.onMessage = null;
  }

  /** Called by the gateway when the streamer sends an IPC message. */
  deliver(obj) {
    if (this.onMessage) this.onMessage(obj);
  }

  // Same shape as StreamerProcess.send(obj) so the relay can treat both alike later.
  send(message) {
    if (this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(message));
    }
  }

  isAlive() {
    return this.ws.readyState === 1;
  }

  // Available = connected, not serving anyone, and not shutting down.
  isAvailable() {
    return this.isAlive() && !this.busy && !this.draining;
  }
}

class StreamerRegistry {
  constructor() {
    this.byId = new Map();
    this.byMachine = new Map();
  }

  add(id, ws, machineId) {
    const existing = this.byId.get(id);
    if (existing && existing.ws !== ws) {
      console.warn(`[Registry] streamer "${id}" reconnected, replacing old socket`);
      this._deindexMachine(existing);
      try { existing.ws.close(); } catch { /* ignore */ }
    }

    const conn = new StreamerConnection(id, ws, machineId);
    this.byId.set(id, conn);
    if (conn.machineId) {
      let set = this.byMachine.get(conn.machineId);
      if (!set) { set = new Set(); this.byMachine.set(conn.machineId, set); }
      set.add(id);
    }
    console.log(
      `[Registry] streamer "${id}" registered on machine "${conn.machineId || "?"}" (${this.byId.size} total)`
    );
    return conn;
  }

  remove(id, ws) {
    const conn = this.byId.get(id);
    if (conn && conn.ws === ws) {
      this.byId.delete(id);
      this._deindexMachine(conn);
      console.log(`[Registry] streamer "${id}" removed (${this.byId.size} left)`);
    }
  }

  _deindexMachine(conn) {
    if (!conn || !conn.machineId) return;
    const set = this.byMachine.get(conn.machineId);
    if (!set) return;
    set.delete(conn.id);
    if (set.size === 0) this.byMachine.delete(conn.machineId);
  }

get(id) {
    return this.byId.get(id) || null;
  }

  pickByMachineId(machineId) {
    const set = this.byMachine.get(machineId);
    if (!set || set.size === 0) return null;
    for (const id of set) {
      const conn = this.byId.get(id);
      if (conn && conn.isAvailable()) return conn;
    }
    return null;
  }

  list() {
    return Array.from(this.byId.values()).map((c) => ({
      id: c.id,
      machineId: c.machineId,
      busy: c.busy,
      draining: c.draining,
      connectedAt: c.connectedAt,
      lastSeen: c.lastSeen,
      alive: c.isAlive(),
    }));
  }

  touch(id) {
    const conn = this.byId.get(id);
    if (conn) conn.lastSeen = Date.now();
  }
}

module.exports = { StreamerRegistry, StreamerConnection };
