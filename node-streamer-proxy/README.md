# node-streamer-proxy


Done. I built and tested the Node middleman. It lives in node-streamer-proxy/:

File	Role
index.js	The proxy — transparent stdio relay both directions + logging
streamer-proxy.cmd	Bridge the web-server spawns (it passes no args, so this .cmd launches node index.js <real-streamer>)
README.md	Wiring + config
How it works
The web-server doesn't have a separate websocket.exe — it is the WebSocket side and spawns the streamer as a child over newline-delimited JSON on stdin/stdout (stderr = streamer logs), per ipc.rs. The proxy takes the streamer's place:

process.stdin → child.stdin — web-server's messages forwarded to the real streamer
child.stdout → process.stdout — streamer's replies forwarded back to the web-server
child.stderr → process.stderr — streamer logs pass straight through (so the web-server still logs them)
Forwarding is done with .pipe() (byte-exact, with backpressure). A separate non-consuming "tap" splits each stream into lines and writes them to ipc-proxy.log with direction + timestamp. Long fields are truncated and client_private_key is redacted in the log only — forwarded data is never altered.

Wire it in (one line)
In server/config.json, change:


"streamer_path": "node-streamer-proxy/streamer-proxy.cmd",
Restart the web-server, start a stream, and watch node-streamer-proxy/ipc-proxy.log. The .cmd defaults REAL_STREAMER_PATH to ..\target\debug\streamer.exe — edit it if you use a release build.

Verified
I ran the proxy against an echo stand-in: messages piped in came back through stdout correctly, and the log captured both server->streamer and streamer->server lines plus startup/exit. Modern Rust spawns .cmd files via cmd /c, and the web-server passes no args, so the bridge works cleanly.

One caveat: this inserts Node + cmd into the streamer's hot path. For debugging/inspection that's fine; for sustained high-bitrate streaming the extra copy adds a little latency/overhead. If you later want zero overhead, the same taps could be added directly in the Rust IPC layer (ipc.rs) instead.

Want me to set the streamer_path config to the proxy now so it's active on the next run?


A transparent stdio middleman between the moonlight **web-server** and **streamer.exe**.

```
web-server  --stdin-->  [ node proxy ]  --stdin-->  streamer.exe
web-server  <-stdout--  [ node proxy ]  <-stdout--  streamer.exe
web-server  <-stderr--  [ node proxy ]  <-stderr--  streamer.exe (logs)
```

The web-server spawns its streamer as a child process and exchanges
newline-delimited JSON over stdin/stdout (stderr carries the streamer's logs) —
see `common/src/ipc.rs`. This proxy takes the streamer's place: it forwards all
three streams **byte-for-byte** in both directions, and logs every message to
`ipc-proxy.log` so you can see exactly what the web-server and streamer exchange.

## Wiring it in

1. Make sure the real streamer is built: `target/debug/streamer.exe`.
2. Point the web-server at the proxy. In `server/config.json`:

   ```jsonc
   "streamer_path": "node-streamer-proxy/streamer-proxy.cmd",
   ```

   (An absolute path also works and is more robust.)
3. Restart the web-server and start a stream. Watch `node-streamer-proxy/ipc-proxy.log`.

The web-server calls `streamer_path` with **no arguments** and piped stdio, so
`streamer-proxy.cmd` is the bridge: it launches `node index.js <real-streamer>`,
inheriting those pipes.

## Configuration (env vars, optional)

- `REAL_STREAMER_PATH` — path to the actual streamer exe.
  Default: `..\target\debug\streamer.exe` relative to the `.cmd`.
- `PROXY_LOG_FILE` — where to write the IPC log.
  Default: `ipc-proxy.log` next to `index.js`.

Edit the defaults at the top of `streamer-proxy.cmd` if your build lives elsewhere
(e.g. `target\release\streamer.exe`).

## Log format

```
<iso-timestamp> server->streamer {...json...}
<iso-timestamp> streamer->server {...json...}
```

Long strings (certs / byte arrays) are truncated and `client_private_key` is
redacted to keep the log readable. Forwarded traffic is never modified — only the
log view is shaped.

## Requirements

Node.js on PATH (tested with v19). No npm dependencies.
