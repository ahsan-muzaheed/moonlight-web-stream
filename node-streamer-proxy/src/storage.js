"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * JSON-file storage, equivalent to Rust src/app/storage/json/.
 *
 * Shape on disk:
 * {
 *   version: 1,
 *   users:    { [userId]: { id, name, password: {salt,hash,iterations}, roleId, hostUniqueId } },
 *   roles:    { [roleId]: { id, name, ty: "Admin"|"User", defaultSettings, permissions } },
 *   hosts:    { [hostId]: { id, address, httpPort, ownerId, pairInfo, cache, deviceId, streamerId } },
 *     deviceId  - stable hostname reported by the streamer daemon (may collide
 *                  across different physical machines - not unique alone).
 *     streamerId - the connecting streamer's own id, captured at register time.
 *                  Together with deviceId this is what disambiguates two
 *                  different physical machines that happen to report the same
 *                  deviceId. hostId (the record's own id) stays internal-only;
 *                  the streaming path never sends or needs it anymore.
 *   sessions: { [token]: { userId, expiresAt } }
 * }
 *
 * Writes are serialized through a promise chain and written atomically
 * (temp file + rename) so a crash mid-write can't corrupt the store.
 */

const DEFAULT_PERMISSIONS = {
  allow_add_hosts: true,
  maximum_bitrate_kbps: null, // null = unlimited
  allow_codec_h264: true,
  allow_codec_h265: true,
  allow_codec_av1: true,
  allow_hdr: true,
  allow_transport_webrtc: true,
  allow_transport_websockets: true,
};

const EMPTY = {
  version: 1,
  users: {},
  roles: {},
  hosts: {},
  sessions: {},
  nextIds: { user: 1, role: 1, host: 1 },
};

// IDs are NUMBERS (u32), matching Rust HostId/UserId/RoleId. The frontend calls
// Number.parseInt() on them (web/stream.ts:47), so UUIDs would parse to NaN.
// JSON object keys are strings, so normalize every id before indexing.
function num(id) {
  if (id === null || id === undefined || id === "") return null;
  const n = Number(id);
  return Number.isInteger(n) ? n : null;
}

class Storage {
  constructor(filePath) {
    this.path = path.resolve(filePath);
    this.data = EMPTY;
    this._writeChain = Promise.resolve();
    this._load();
    this._ensureDefaultRoles();
  }

  _load() {
    if (!fs.existsSync(this.path)) {
      console.log(`[Storage] ${this.path} not found, starting empty`);
      this.data = JSON.parse(JSON.stringify(EMPTY));
      return;
    }
    try {
      const loaded = JSON.parse(fs.readFileSync(this.path, "utf8"));
      this.data = { ...JSON.parse(JSON.stringify(EMPTY)), ...loaded };
      if (!this.data.nextIds) this.data.nextIds = { user: 1, role: 1, host: 1 };
    } catch (err) {
      throw new Error(`[Storage] failed to parse ${this.path}: ${err.message}`);
    }
  }

  /** Serialized + atomic write. */
  save() {
    this._writeChain = this._writeChain.then(() => {
      const tmp = `${this.path}.tmp`;
      const json = JSON.stringify(this.data, null, 2);
      return fs.promises
        .writeFile(tmp, json, "utf8")
        .then(() => fs.promises.rename(tmp, this.path))
        .catch((err) => console.error("[Storage] write failed:", err));
    });
    return this._writeChain;
  }

  /** Allocate the next integer id for a collection. */
  _allocId(kind) {
    const id = this.data.nextIds[kind];
    this.data.nextIds[kind] = id + 1;
    return id;
  }

  _ensureDefaultRoles() {
    if (Object.keys(this.data.roles).length > 0) return;

    for (const [name, ty] of [
      ["Admin", "Admin"],
      ["User", "User"],
    ]) {
      const id = this._allocId("role");
      this.data.roles[id] = {
        id,
        name,
        ty,
        defaultSettings: {},
        permissions: { ...DEFAULT_PERMISSIONS },
      };
    }
    this.save();
  }

  // ---- Users -------------------------------------------------------------

  listUsers() {
    return Object.values(this.data.users);
  }

  getUser(userId) {
    const id = num(userId);
    return id === null ? null : this.data.users[id] || null;
  }

  getUserByName(name) {
    return this.listUsers().find((u) => u.name === name) || null;
  }

  addUser({ name, password, roleId }) {
    if (this.getUserByName(name)) throw new Error("UserAlreadyExists");

    const id = this._allocId("user");
    const user = {
      id,
      name,
      password, // already a hashed record from password.js
      roleId: num(roleId),
      // Stable per-user Moonlight client id (Sunshine pairs against this).
      hostUniqueId: crypto.randomBytes(8).toString("hex"),
    };

    this.data.users[id] = user;
    this.save();
    return user;
  }

  patchUser(userId, patch) {
    const user = this.getUser(userId);
    if (!user) throw new Error("UserNotFound");
    if (patch.roleId !== undefined) patch.roleId = num(patch.roleId);
    Object.assign(user, patch);
    this.save();
    return user;
  }

  deleteUser(userId) {
    const id = num(userId);
    if (id === null || !this.data.users[id]) throw new Error("UserNotFound");
    delete this.data.users[id];
    // Drop that user's sessions too.
    for (const [token, s] of Object.entries(this.data.sessions)) {
      if (s.userId === id) delete this.data.sessions[token];
    }
    this.save();
  }

  userCount() {
    return Object.keys(this.data.users).length;
  }

  // ---- Roles -------------------------------------------------------------

  listRoles() {
    return Object.values(this.data.roles);
  }

  getRole(roleId) {
    const id = num(roleId);
    return id === null ? null : this.data.roles[id] || null;
  }

  addRole({ name, ty, defaultSettings, permissions }) {
    const id = this._allocId("role");
    const role = {
      id,
      name,
      ty: ty || "User",
      defaultSettings: defaultSettings || {},
      permissions: { ...DEFAULT_PERMISSIONS, ...(permissions || {}) },
    };
    this.data.roles[id] = role;
    this.save();
    return role;
  }

  patchRole(roleId, patch) {
    const role = this.getRole(roleId);
    if (!role) throw new Error("RoleNotFound");
    Object.assign(role, patch);
    this.save();
    return role;
  }

  deleteRole(roleId) {
    const id = num(roleId);
    if (id === null || !this.data.roles[id]) throw new Error("RoleNotFound");
    delete this.data.roles[id];
    this.save();
  }

  isAdmin(user) {
    const role = this.getRole(user.roleId);
    return !!role && role.ty === "Admin";
  }

  // ---- Hosts -------------------------------------------------------------

  listHosts() {
    return Object.values(this.data.hosts);
  }

  /** Admins see every host; users see only the ones they own. */
  listHostsForUser(user) {
    if (this.isAdmin(user)) return this.listHosts();
    return this.listHosts().filter((h) => h.ownerId === user.id);
  }

  getHost(hostId) {
    const id = num(hostId);
    return id === null ? null : this.data.hosts[id] || null;
  }

  /** Reverse lookup: stable machine id (hostname) -> host record.
   *  Returns the FIRST match only - kept for callers that know deviceId is
   *  unique for their case. When two physical machines can share a deviceId,
   *  use getHostsByDeviceId() instead and disambiguate further. */
  getHostByDeviceId(deviceId) {
    if (!deviceId) return null;
    return this.listHosts().find((h) => h.deviceId === deviceId) || null;
  }

  /** Same lookup, but returns EVERY host record sharing that deviceId - the
   *  collision case (two different physical machines reporting the same
   *  hostname/deviceId). Caller disambiguates further, e.g. by checking
   *  which one's streamer actually has the wanted app. */
  getHostsByDeviceId(deviceId) {
    if (!deviceId) return [];
    return this.listHosts().filter((h) => h.deviceId === deviceId);
  }

  /** Exact link: a specific streamer connection's own id -> its host record.
   *  Set at register time (see streamer-endpoint.js), this is what
   *  disambiguates two host records that share a deviceId. */
  getHostByStreamerId(streamerId) {
    if (!streamerId) return null;
    return this.listHosts().find((h) => h.streamerId === streamerId) || null;
  }

  /** Same ownership rule as getHostForUser, but keyed by deviceId. */
  getHostByDeviceIdForUser(user, deviceId) {
    const host = this.getHostByDeviceId(deviceId);
    if (!host) throw new Error("HostNotFound");
    if (!this.isAdmin(user) && host.ownerId !== user.id) throw new Error("Forbidden");
    return host;
  }

  /** Throws unless the user owns the host (or is an admin). */
  getHostForUser(user, hostId) {
    const host = this.getHost(hostId);
    if (!host) throw new Error("HostNotFound");
    if (!this.isAdmin(user) && host.ownerId !== user.id) throw new Error("Forbidden");
    return host;
  }
  

  addHost({ address, httpPort, ownerId }) {
    const id = this._allocId("host");
    const host = {
      id,
      address,
      httpPort,
      ownerId: num(ownerId),
      cache: null, // last known serverinfo, for the "undetailed" list view
    };
    this.data.hosts[id] = host;
    this.save();
    return host;
  }

  patchHost(hostId, patch) {
    const host = this.getHost(hostId);
    if (!host) throw new Error("HostNotFound");
    if (patch.ownerId !== undefined) patch.ownerId = num(patch.ownerId);
    Object.assign(host, patch);
    this.save();
    return host;
  }

  deleteHost(hostId) {
    const id = num(hostId);
    if (id === null || !this.data.hosts[id]) throw new Error("HostNotFound");
    delete this.data.hosts[id];
    this.save();
  }

  // ---- Sessions ----------------------------------------------------------

  createSession(userId, expirationSecs) {
    const token = crypto.randomBytes(32).toString("base64url");
    this.data.sessions[token] = {
      userId: num(userId),
      expiresAt: Date.now() + expirationSecs * 1000,
    };
    this.save();
    return token;
  }

  getSession(token) {
    const session = this.data.sessions[token];
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      delete this.data.sessions[token];
      this.save();
      return null;
    }
    return session;
  }

  deleteSession(token) {
    if (this.data.sessions[token]) {
      delete this.data.sessions[token];
      this.save();
    }
  }
}

module.exports = { Storage, DEFAULT_PERMISSIONS, num };
