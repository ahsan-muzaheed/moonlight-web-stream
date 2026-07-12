"use strict";

const express = require("express");
const {
  COOKIE_SESSION_TOKEN_NAME,
  requireAuth,
  requireAdmin,
  cookieOptions,
  login,
} = require("../auth");
const { newPassword } = require("../password");

/**
 * Auth + users + roles + settings.
 * Mirrors Rust src/api/{auth,user,role,settings}.rs.
 */
function coreRoutes(ctx) {
  const router = express.Router();
  const { storage, config } = ctx;
  const auth = requireAuth(ctx);
  const admin = requireAdmin(ctx);

  // ---- Auth --------------------------------------------------------------

  router.post("/login", (req, res) => {
    const { name, password } = req.body || {};
    if (!name || !password) {
      return res.status(400).json({ error: "name and password required" });
    }

    const user = login(ctx, name, password);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const token = storage.createSession(
      user.id,
      config.web_server.session_cookie_expiration_secs
    );

    res.cookie(COOKIE_SESSION_TOKEN_NAME, token, cookieOptions(config));
    res.status(200).end();
  });

  router.post("/logout", auth, (req, res) => {
    const token = req.cookies && req.cookies[COOKIE_SESSION_TOKEN_NAME];
    if (token) storage.deleteSession(token);

    res.clearCookie(COOKIE_SESSION_TOKEN_NAME, {
      path: config.web_server.url_path_prefix,
    });
    res.status(200).end();
  });

  // Cheap "am I logged in?" probe for the frontend.
  router.get("/authenticate", auth, (_req, res) => res.status(200).end());

  // ---- Users -------------------------------------------------------------

  const publicUser = (u) => ({ id: u.id, name: u.name, role: u.roleId });

  router.get("/users", auth, admin, (_req, res) => {
    res.json({ users: storage.listUsers().map(publicUser) });
  });

  router.get("/user", auth, (req, res) => {
    // No id => "who am I". An id is admin-only.
    const userId = req.query.user_id;
    if (!userId) return res.json({ user: publicUser(req.user) });

    if (!storage.isAdmin(req.user)) return res.status(403).json({ error: "Forbidden" });

    const user = storage.getUser(userId);
    if (!user) return res.status(404).json({ error: "UserNotFound" });
    res.json({ user: publicUser(user) });
  });

  router.post("/user", auth, admin, (req, res) => {
    const { name, password, role } = req.body || {};
    if (!name || !password) {
      return res.status(400).json({ error: "name and password required" });
    }
    try {
      const user = storage.addUser({
        name,
        password: newPassword(password),
        roleId: role,
      });
      res.json({ user: publicUser(user) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch("/user", auth, (req, res) => {
    const { user_id: userId, name, password, role } = req.body || {};
    const target = userId || req.user.id;

    // Non-admins may only edit themselves, and may not change their role.
    const isSelf = target === req.user.id;
    if (!isSelf && !storage.isAdmin(req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (role !== undefined && !storage.isAdmin(req.user)) {
      return res.status(403).json({ error: "Forbidden: cannot change own role" });
    }

    const patch = {};
    if (name !== undefined) patch.name = name;
    if (password !== undefined) patch.password = newPassword(password);
    if (role !== undefined) patch.roleId = role;

    try {
      res.json({ user: publicUser(storage.patchUser(target, patch)) });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.delete("/user", auth, admin, (req, res) => {
    try {
      storage.deleteUser(req.query.user_id);
      res.status(200).end();
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // ---- Roles -------------------------------------------------------------

  router.get("/roles", auth, admin, (_req, res) => {
    res.json({ roles: storage.listRoles() });
  });

  router.get("/role", auth, (req, res) => {
    const roleId = req.query.role_id || req.user.roleId;
    const role = storage.getRole(roleId);
    if (!role) return res.status(404).json({ error: "RoleNotFound" });
    res.json({ role });
  });

  router.post("/role", auth, admin, (req, res) => {
    const { name, ty, default_settings, permissions } = req.body || {};
    const role = storage.addRole({
      name,
      ty,
      defaultSettings: default_settings,
      permissions,
    });
    res.json({ role });
  });

  router.patch("/role", auth, admin, (req, res) => {
    const { role_id: roleId, name, ty, default_settings, permissions } = req.body || {};
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (ty !== undefined) patch.ty = ty;
    if (default_settings !== undefined) patch.defaultSettings = default_settings;
    if (permissions !== undefined) patch.permissions = permissions;

    try {
      res.json({ role: storage.patchRole(roleId, patch) });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.delete("/role", auth, admin, (req, res) => {
    try {
      storage.deleteRole(req.query.role_id);
      res.status(200).end();
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // ---- Settings ----------------------------------------------------------

  router.get("/settings/default", auth, (req, res) => {
    const role = storage.getRole(req.user.roleId);
    res.json(role ? role.defaultSettings : {});
  });

  router.get("/settings/permissions", auth, (req, res) => {
    const role = storage.getRole(req.user.roleId);
    res.json(role ? role.permissions : {});
  });

  return router;
}

module.exports = { coreRoutes };
