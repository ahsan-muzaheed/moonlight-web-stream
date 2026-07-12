# moonlight-web-stream — Node.js web server port

CommonJS (`require`) port of the Rust web server in `src/`. Same routes, same
`config.json` shape, same `mlSession` cookie, same NDJSON streamer protocol.

## Run
    npm install
    node src/index.js          # reads ./config.json (all fields optional)

Point `streamer.path` in config.json at the compiled Rust streamer binary.
Set `RUST_LOG=debug` to see the streamer's video-setup and offer logs.

## Status
- Verified here: module loading, PBKDF2 password parity, storage, auth,
  login/host/list flow over real HTTP, cert/AES/signature primitives.
- NOT verified: `src/moonlight/client.js` pairing ladder + `crypto.js` —
  reimplemented from the GameStream protocol, never tested against real
  Sunshine. Debug this first; it's the one high-risk module.

## Layout
    src/index.js            entry point / wiring
    src/config.js           config.json loader + defaults
    src/password.js         PBKDF2-HMAC-SHA256 (parity with Rust)
    src/storage.js          JSON store: users, roles, hosts, sessions
    src/auth.js             sessions, cookie, forwarded-header, middleware
    src/moonlight/crypto.js GameStream pairing crypto      [UNVERIFIED]
    src/moonlight/client.js serverinfo/pair/applist/appasset [pair UNVERIFIED]
    src/moonlight/wol.js    wake-on-lan
    src/routes/core.js      auth + users + roles + settings
    src/routes/hosts.js     hosts + apps + pairing (NDJSON streamed)
    src/routes/stream.js    /api/host/stream relay + real buildInitPayload
