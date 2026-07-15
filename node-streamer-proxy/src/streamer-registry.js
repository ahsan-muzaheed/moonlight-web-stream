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
  constructor(id, ws) {
    this.id = id;
    this.ws = ws;
    this.connectedAt = Date.now();
    this.lastSeen = Date.now();
    this.busy = false; // true while a browser session is attached
    // The currently-attached browser handler. Streamer -> browser messages are
    // routed here. null when idle.
    this.onMessage = null;
  }

  /**
   * Attach a browser session. `handler(obj)` receives each decoded message the
   * streamer sends (the {WebSocket:...}/{WebSocketTransport:...}/"Stop" enum).
   * Returns false if the streamer is already busy with another session.
   */
  attach(handler) {
    if (this.busy) return false;
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
}

class StreamerRegistry {
  constructor() {
    this.byId = new Map(); // id -> StreamerConnection
  }

  add(id, ws) {
    // If a streamer with this id was already connected, drop the stale one.
    const existing = this.byId.get(id);
    if (existing && existing.ws !== ws) {
      console.warn(`[Registry] streamer "${id}" reconnected, replacing old socket`);
      try {
        existing.ws.close();
      } catch {
        /* ignore */
      }
    }

    const conn = new StreamerConnection(id, ws);
    this.byId.set(id, conn);
    console.log(`[Registry] streamer "${id}" registered (${this.byId.size} total)`);
    return conn;
  }

  remove(id, ws) {
    const conn = this.byId.get(id);
    // Only remove if it's the same socket (avoid a late close nuking a reconnect).
    if (conn && conn.ws === ws) {
      this.byId.delete(id);
      console.log(`[Registry] streamer "${id}" removed (${this.byId.size} left)`);
    }
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  list() {
    return Array.from(this.byId.values()).map((c) => ({
      id: c.id,
      busy: c.busy,
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
