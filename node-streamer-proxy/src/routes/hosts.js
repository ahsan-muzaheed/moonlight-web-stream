"use strict";

const express = require("express");
const crypto = require("crypto");
const { requireAuth } = require("../auth");
const moonlight = require("../moonlight/client");
const { wake } = require("../moonlight/wol");

/**
 * Hosts + apps + pairing. Mirrors Rust src/api/{host,app}.rs.
 *
 * Two endpoints stream results as they arrive, matching the Rust
 * "response streaming" (StreamedResponse). We emit newline-delimited JSON:
 * an initial object, then follow-up objects. The frontend already reads this.
 */
function hostRoutes(ctx) {
  const router = express.Router();
  const { storage } = ctx;
  const auth = requireAuth(ctx);

  const uniqueId = (user) => user.hostUniqueId || "0123456789ABCDEF";
  const publicHost = (h) => ({
    host_id: h.id,
    address: h.address,
    http_port: h.httpPort,
    owner: h.ownerId,
  });

  // ---- List (streamed: cached rows first, live serverinfo as it lands) ---

  router.get("/hosts", auth, async (req, res) => {
    const hosts = storage.listHostsForUser(req.user);

    res.set("Content-Type", "application/x-ndjson");
    // Initial payload: whatever we already know.
    res.write(
      JSON.stringify({
        hosts: hosts.map((h) => ({ ...publicHost(h), ...(h.cache || {}) })),
      }) + "\n"
    );

    // Then refresh each host live and stream the update.
    await Promise.all(
      hosts.map(async (h) => {
        try {
          const info = await moonlight.serverInfo(h, uniqueId(req.user));
          const detail = {
            host_id: h.id,
            name: info.hostname,
            online: true,
            paired: info.PairStatus === "1",
          };
          storage.patchHost(h.id, { cache: { name: info.hostname } });
          res.write(JSON.stringify(detail) + "\n");
        } catch {
          res.write(JSON.stringify({ host_id: h.id, online: false }) + "\n");
        }
      })
    );

    res.end();
  });

  router.get("/host", auth, async (req, res) => {
    try {
      const host = storage.getHostForUser(req.user, req.query.host_id);
      let detail = publicHost(host);
      try {
        const info = await moonlight.serverInfo(host, uniqueId(req.user));
        detail = { ...detail, name: info.hostname, online: true };
      } catch {
        detail = { ...detail, online: false };
      }
      res.json({ host: detail });
    } catch (err) {
      res.status(errStatus(err)).json({ error: err.message });
    }
  });

  router.post("/host", auth, (req, res) => {
    if (!storage.getRole(req.user.roleId)?.permissions.allow_add_hosts) {
      return res.status(403).json({ error: "Forbidden: adding hosts not allowed" });
    }
    const { address, http_port } = req.body || {};
    if (!address) return res.status(400).json({ error: "address required" });

    const host = storage.addHost({
      address,
      httpPort: http_port || ctx.config.moonlight.default_http_port,
      ownerId: req.user.id,
    });
    res.json({ host: publicHost(host) });
  });

  router.patch("/host", auth, (req, res) => {
    const { host_id: hostId, change_owner, owner } = req.body || {};
    try {
      const host = storage.getHostForUser(req.user, hostId);
      if (change_owner) {
        if (!storage.isAdmin(req.user)) return res.status(403).json({ error: "Forbidden" });
        storage.patchHost(host.id, { ownerId: owner || null });
      }
      res.status(200).end();
    } catch (err) {
      res.status(errStatus(err)).json({ error: err.message });
    }
  });

  router.delete("/host", auth, (req, res) => {
    try {
      storage.getHostForUser(req.user, req.query.host_id); // ownership check
      storage.deleteHost(req.query.host_id);
      res.status(200).end();
    } catch (err) {
      res.status(errStatus(err)).json({ error: err.message });
    }
  });

  router.post("/host/wake", auth, async (req, res) => {
    try {
      const host = storage.getHostForUser(req.user, req.body.host_id);
      const mac = host.cache && host.cache.mac;
      if (!mac) return res.status(400).json({ error: "no MAC known for host" });
      await wake(mac);
      res.status(200).end();
    } catch (err) {
      res.status(errStatus(err)).json({ error: err.message });
    }
  });

  // ---- Refresh a paired host's deviceId without re-pairing --------------
  // Fixes hosts paired BEFORE the auto-capture-at-pairing-time logic above
  // existed (their storage.json record has no deviceId, so a Copy-URL
  // deviceid-only link 404s with HostNotFound even though the host is
  // paired and reachable). Re-running the full PIN handshake just to pick up
  // one field is unnecessary and disruptive - this hits the same paired
  // /api/machine-info endpoint the pairing flow does, using the cert this
  // host already has, and just patches the one field. 
	router.post("/host/refresh-device-info", auth, async (req, res) => {
	
	console.log(`/host/refresh-device-info`)
	
    let host;
    try {
      host = storage.getHostForUser(req.user, req.body.host_id);
    } catch (err) {
      return res.status(errStatus(err)).json({ error: err.message });
    }

    const { device_id: wantDeviceId, streamer_id: wantStreamerId } = req.body;
    let conn = null;
    if (wantStreamerId) {
      conn = ctx.streamerRegistry.get(wantStreamerId);
    } else if (wantDeviceId) {
      conn = ctx.streamerRegistry.pickByDeviceId(wantDeviceId);
    }
    if (!conn) {
      return res.status(409).json({
        error:
          "NoStreamerConnected: pass device_id or streamer_id for a currently-connected " +
          "streamer (see GET /api/streamer/list)",
      });
    }

    try {
      const result = await conn.request("GetDeviceInfo", {});
      const deviceId = result && result.deviceid;
      if (!deviceId) {
        throw new Error("streamer returned no deviceid");
      }
      storage.patchHost(host.id, { deviceId });
      console.log(
        `[DeviceInfo] host ${host.id} linked to machine "${deviceId}" ` +
        `(via streamer "${conn.id}")`
      );
      res.json({ host_id: host.id, device_id: deviceId });
    } catch (err) {
      console.warn(`[DeviceInfo] host ${host.id} refresh failed:`, err.message);
      res.status(502).json({ error: err.message });
    }
  });
  
  
  // ---- Cancel the running app (Rust: POST /host/cancel) ------------------
  // The frontend's "quit" button calls this (web/api.ts:422). Closing the tab
  // only kills the streamer; Sunshine keeps the app running on purpose so the
  // session can be resumed. This is what actually terminates it.
  router.post("/host/cancel", auth, async (req, res) => {
    try {
      const host = storage.getHostForUser(req.user, req.body.host_id);
      const success = await moonlight.cancelApp(host, uniqueId(req.user));
      res.json({ success });
    } catch (err) {
      console.warn("[Cancel] failed:", err.message);
      res.status(errStatus(err)).json({ error: err.message });
    }
  });

  // ---- Apps --------------------------------------------------------------

  router.get("/apps", auth, async (req, res) => {
    try {
      const host = storage.getHostForUser(req.user, req.query.host_id);

      const conn = host.deviceId ? ctx.streamerRegistry.pickByDeviceId(host.deviceId) : null;
      if (!conn) {
        return res.status(409).json({
          error: "NoStreamerConnected: this host's streamer must be online to list apps (self-pairing runs on the streamer, not Node)",
        });
      }

      const apps = await conn.request("GetAppList", {
        client_unique_id: uniqueId(req.user),
      });
      res.json({ apps });
    } catch (err) {
      res.status(errStatus(err)).json({ error: err.message });
    }
  });

  router.get("/app/image", auth, async (req, res) => {
    try {
      const host = storage.getHostForUser(req.user, req.query.host_id);
      const image = await moonlight.appImage(host, uniqueId(req.user), req.query.app_id);

      // ETag / 304, matching the Rust handler.
      const etag = `"${crypto.createHash("sha256").update(image).digest("hex")}"`;
      const force = req.query.force_refresh === "true";
      if (!force && req.headers["if-none-match"] === etag) {
        return res.status(304).set("ETag", etag).end();
      }

      res
        .set("ETag", etag)
        .set("Cache-Control", "private, no-cache, must-revalidate")
        .set("Content-Type", "image/png")
        .send(image);
    } catch (err) {
      res.status(errStatus(err)).json({ error: err.message });
    }
  });

  return router;
}

function errStatus(err) {
  switch (err.message) {
    case "HostNotFound":
    case "UserNotFound":
    case "RoleNotFound":
      return 404;
    case "Forbidden":
      return 403;
    case "HostNotPaired":
      return 400;
    default:
      return 500;
  }
}

module.exports = { hostRoutes };