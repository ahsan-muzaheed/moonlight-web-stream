"use strict";

const { verifyPassword, newPassword, needsRehash } = require("./password");

// Same cookie name as the Rust server, so existing frontends keep working.
const COOKIE_SESSION_TOKEN_NAME = "mlSession";

/**
 * Resolve a request to a user. Mirrors extract_user_auth in Rust src/api/auth.rs,
 * in the same precedence order:
 *   1. reverse-proxy header (if config.web_server.forwarded_header is set)
 *   2. Authorization: Bearer <token>
 *   3. mlSession cookie
 */
function resolveUser(req, ctx) {
  const { config, storage } = ctx;
  const headerAuth = config.web_server.forwarded_header;

  // 1. Trusted reverse proxy supplies the username.
  if (headerAuth && headerAuth.username_header) {
    const username = req.headers[headerAuth.username_header.toLowerCase()];
    if (username) {
      let user = storage.getUserByName(username);
      // Auto-provision users the proxy vouches for.
      if (!user) {
        const role = storage.listRoles().find((r) => r.ty === "User");
        user = storage.addUser({
          name: username,
          password: null, // proxy-authenticated; no local password
          roleId: role ? role.id : null,
        });
      }
      return user;
    }
  }

  // 2. Bearer token.
  const authHeader = req.headers.authorization;
  if (authHeader) {
    if (!authHeader.startsWith("Bearer")) return null;
    const token = authHeader.slice("Bearer".length).trim();
    const session = storage.getSession(token);
    return session ? storage.getUser(session.userId) : null;
  }

  // 3. Session cookie.
  const cookieToken = req.cookies && req.cookies[COOKIE_SESSION_TOKEN_NAME];
  if (cookieToken) {
    const session = storage.getSession(cookieToken);
    return session ? storage.getUser(session.userId) : null;
  }

  return null;
}

/** Require any authenticated user; attaches req.user. */
function requireAuth(ctx) {
  return (req, res, next) => {
    const user = resolveUser(req, ctx);
    if (!user) {
      // Clear a stale cookie so the browser stops resending it.
      res.clearCookie(COOKIE_SESSION_TOKEN_NAME, {
        path: ctx.config.web_server.url_path_prefix,
      });
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = user;
    next();
  };
}

/** Require an admin; must run after requireAuth. */
function requireAdmin(ctx) {
  return (req, res, next) => {
    if (!req.user || !ctx.storage.isAdmin(req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

function cookieOptions(config) {
  const ws = config.web_server;
  return {
    path: ws.url_path_prefix,
    httpOnly: true, // not readable from JS
    sameSite: "strict",
    secure: ws.session_cookie_secure,
    maxAge: ws.session_cookie_expiration_secs * 1000,
  };
}

/**
 * Verify a username/password, honouring first_login_create_admin:
 * if enabled and no users exist yet, the first login *creates* the admin.
 */
function login(ctx, name, password) {
  const { storage, config } = ctx;

  if (config.web_server.first_login_create_admin && storage.userCount() === 0) {
    const adminRole = storage.listRoles().find((r) => r.ty === "Admin");
    return storage.addUser({
      name,
      password: newPassword(password),
      roleId: adminRole ? adminRole.id : null,
    });
  }

  const user = storage.getUserByName(name);
  if (!user || !user.password) return null;
  if (!verifyPassword(user.password, password)) return null;

  // Upgrade the hash if the iteration count has since increased.
  if (needsRehash(user.password)) {
    storage.patchUser(user.id, { password: newPassword(password) });
  }

  return user;
}

module.exports = {
  COOKIE_SESSION_TOKEN_NAME,
  resolveUser,
  requireAuth,
  requireAdmin,
  cookieOptions,
  login,
};
