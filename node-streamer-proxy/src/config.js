"use strict";

const fs = require("fs");
const path = require("path");

// Mirrors the Rust config.json. Anything absent falls back to these defaults.
const DEFAULTS = {
  web_server: {
    address: "0.0.0.0",
    port: 8080,
    url_path_prefix: "/",
    // When set, trust a reverse proxy to supply the username:
    //   { "username_header": "Remote-User" }
    forwarded_header: null,
    first_login_create_admin: true,
    session_cookie_expiration_secs: 60 * 60 * 24 * 7, // 7 days
    session_cookie_secure: false,
    static_dir: "static", // "dist" in the Rust debug build
  },
  moonlight: {
    default_http_port: 47989,
    // HTTPS port Sunshine listens on = http_port + 1 (47984 by default)
  },
  streamer: {
    // Path to the Rust streamer binary that this server spawns.
    path: "./streamer",
    // Passed inside the Init payload; also overridable with RUST_LOG.
    log_level: "Info", // Off | Error | Warn | Info | Debug | Trace
  },
  // Handed to the streamer verbatim inside Init.config.webrtc
  webrtc: {
    ice_servers: [{ urls: ["stun:stun.l.google.com:19302"] }],
  },
  storage: {
    path: "storage.json",
  },
};

function deepMerge(base, override) {
  if (override === null || override === undefined) return base;
  if (typeof base !== "object" || Array.isArray(base)) return override;

  const out = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = deepMerge(base[key], override[key]);
  }
  return out;
}

function loadConfig(configPath = "config.json") {
  const full = path.resolve(configPath);

  if (!fs.existsSync(full)) {
    console.warn(`[Config] ${full} not found, using defaults`);
    return DEFAULTS;
  }

  const raw = fs.readFileSync(full, "utf8");
  const parsed = JSON.parse(raw);

  return deepMerge(DEFAULTS, parsed);
}

module.exports = { loadConfig, DEFAULTS };
