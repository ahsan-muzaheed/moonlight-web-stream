#!/usr/bin/env node
'use strict';

/*
 * node-streamer-proxy
 * -------------------
 * Transparent stdio middleman between the moonlight web-server (the "websocket"
 * side, which terminates the browser WebSocket) and the real streamer.exe.
 *
 *   web-server  --stdin-->  [ this proxy ]  --stdin-->  streamer.exe
 *   web-server  <-stdout--  [ this proxy ]  <-stdout--  streamer.exe
 *   web-server  <-stderr--  [ this proxy ]  <-stderr--  streamer.exe (logs)
 *
 * The web-server speaks newline-delimited JSON over the child's stdin/stdout and
 * uses stderr for the streamer's log output (see common/src/ipc.rs). This proxy
 * forwards all three streams byte-for-byte, so the web-server cannot tell it is
 * not talking to streamer.exe directly, while logging every message in both
 * directions to a file for debugging.
 *
 * Usage:
 *   node index.js <path-to-real-streamer-exe>
 * The path may also come from REAL_STREAMER_PATH. The IPC log location can be
 * overridden with PROXY_LOG_FILE (default: ./ipc-proxy.log next to this file).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const realStreamer = process.argv[2] || process.env.REAL_STREAMER_PATH;
if (!realStreamer) {
  process.stderr.write(
    '[proxy] No streamer path given. Pass it as argv[1] or set REAL_STREAMER_PATH.\n'
  );
  process.exit(2);
}

const logFile = process.env.PROXY_LOG_FILE || path.join(__dirname, 'ipc-proxy.log');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

const ts = () => new Date().toISOString();
const logLine = (text) => logStream.write(`${ts()} ${text}\n`);

// Keep the log readable: truncate long strings (certs / byte arrays) and redact
// the private key. Does NOT affect forwarded data — this only shapes the log.
function summarize(value) {
  if (typeof value === 'string') {
    return value.length > 200 ? `${value.slice(0, 200)}…(${value.length} chars)` : value;
  }
  if (Array.isArray(value)) {
    return value.length > 32 ? `[array len=${value.length}]` : value.map(summarize);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /private_key/i.test(k) ? '<redacted>' : summarize(v);
    }
    return out;
  }
  return value;
}

function logMessage(direction, line) {
  if (!line) return;
  let rendered = line;
  try {
    rendered = JSON.stringify(summarize(JSON.parse(line)));
  } catch {
    if (rendered.length > 500) rendered = `${rendered.slice(0, 500)}…`;
  }
  logLine(`${direction} ${rendered}`);
}

// Observe (don't consume) a stream: buffer chunks and emit one log entry per
// newline-delimited JSON message. The actual forwarding is done by .pipe().
function makeLineTap(direction) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      logMessage(direction, line);
    }
  };
}

logLine(`[proxy] starting; real streamer = ${realStreamer}`);
// One line to web-server's stderr so it shows up in the server log too.
process.stderr.write(`[proxy] active -> ${realStreamer}\n`);

const child = spawn(realStreamer, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

child.on('error', (err) => {
  logLine(`[proxy] failed to spawn streamer: ${err.message}`);
  process.stderr.write(`[proxy] failed to spawn streamer: ${err.message}\n`);
  process.exit(1);
});

// web-server --> streamer (stdin). pipe() forwards bytes + ends child stdin on EOF.
process.stdin.pipe(child.stdin);
process.stdin.on('data', makeLineTap('server->streamer'));

// streamer --> web-server (stdout).
child.stdout.pipe(process.stdout);
child.stdout.on('data', makeLineTap('streamer->server'));

// streamer logs (stderr) pass straight through to the web-server.
child.stderr.pipe(process.stderr);

// Swallow EPIPE etc. so a closed peer doesn't crash the proxy.
for (const s of [process.stdin, process.stdout, process.stderr, child.stdin]) {
  s.on('error', () => {});
}

const shutdown = (signal) => {
  logLine(`[proxy] received ${signal}, killing streamer`);
  try { child.kill(); } catch {}
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code, signal) => {
  logLine(`[proxy] streamer exited code=${code} signal=${signal}`);
  logStream.end(() => process.exit(code == null ? 0 : code));
});
