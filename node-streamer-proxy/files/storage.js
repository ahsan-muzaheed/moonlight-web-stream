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
 *   hosts:    { [hostId]: { id, address, httpPort, ownerId, pairInfo, cache } },
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
};

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
      this.data = { ...EMPTY, ...JSON.parse(fs.readFileSync(this.path, "utf8")) };
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

  _ensureDefaultRoles() {
    if (Object.keys(this.data.roles).length > 0) return;

    for (const [id, name, ty] of [
      ["admin", "Admin", "Admin"],
      ["user", "User", "User"],
    ]) {
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
    return this.data.users[userId] || null;
  }

  getUserByName(name) {
    return this.listUsers().find((u) => u.name === name) || null;
  }

  addUser({ name, password, roleId }) {
    if (this.getUserByName(name)) throw new Error("UserAlreadyExists");

    const id = crypto.randomUUID();
    const user = {
      id,
      name,
      password, // already a hashed record from password.js
      roleId,
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
    Object.assign(user, patch);
    this.save();
    return user;
  }

  deleteUser(userId) {
    if (!this.data.users[userId]) throw new Error("UserNotFound");
    delete this.data.users[userId];
    // Drop that user's sessions too.
    for (const [token, s] of Object.entries(this.data.sessions)) {
      if (s.userId === userId) delete this.data.sessions[token];
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
    return this.data.roles[roleId] || null;
  }

  addRole({ name, ty, defaultSettings, permissions }) {
    const id = crypto.randomUUID();
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
    if (!this.data.roles[roleId]) throw new Error("RoleNotFound");
    delete this.data.roles[roleId];
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
    return this.data.hosts[hostId] || null;
  }

  /** Throws unless the user owns the host (or is an admin). */
  getHostForUser(user, hostId) {
    const host = this.getHost(hostId);
    if (!host) throw new Error("HostNotFound");
    if (!this.isAdmin(user) && host.ownerId !== user.id) throw new Error("Forbidden");
    return host;
  }

  addHost({ address, httpPort, ownerId }) {
    const id = crypto.randomUUID();
    const host = {
      id,
      address,
      httpPort,
      ownerId,
      pairInfo: null, // { clientCertificate, clientPrivateKey, serverCertificate } (PEM strings)
      cache: null, // last known serverinfo, for the "undetailed" list view
    };
    this.data.hosts[id] = host;
    this.save();
    return host;
  }

  patchHost(hostId, patch) {
    const host = this.getHost(hostId);
    if (!host) throw new Error("HostNotFound");
    Object.assign(host, patch);
    this.save();
    return host;
  }

  deleteHost(hostId) {
    if (!this.data.hosts[hostId]) throw new Error("HostNotFound");
    delete this.data.hosts[hostId];
    this.save();
  }

  setPairInfo(hostId, pairInfo) {
    return this.patchHost(hostId, { pairInfo });
  }

  // ---- Sessions ----------------------------------------------------------

  createSession(userId, expirationSecs) {
    const token = crypto.randomBytes(32).toString("base64url");
    this.data.sessions[token] = {
      userId,
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

module.exports = { Storage, DEFAULT_PERMISSIONS };
