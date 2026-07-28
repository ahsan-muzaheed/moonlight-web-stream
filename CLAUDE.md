# CLAUDE.md — moonlight-web-stream

> Handoff context for Claude. Read this before touching the repo so you can pick up
> where prior sessions left off instead of re-deriving the architecture.
> Fork of https://github.com/ahsan-muzaheed/moonlight-web-stream
>
> **Line numbers here are approximate** — the working Windows tree is the source of
> truth and drifts from any snapshot. Match by the quoted anchor text, not the number.

---

## 1. What this project is

Browser-based remote game/app streaming. The chain:

```
browser  →  signaling server (Node.js)  →  streamer (Rust)  →  Sunshine (C++ GameStream host)  →  the app/game
```

- **Signaling server** — Node.js. Auth, sessions, signaling, and (currently) owns the
  pairing certificates. Windows folder: `node-streamer-proxy\`. Referred to as the
  "signaling server" — NOT "node" (that shorthand is disliked).
- **Streamer** — Rust. Pass-through of Sunshine's H.264 into WebRTC. Windows folder: `streamer\`.
- **Frontend** — TypeScript, under `web\`.
- **Sunshine** — forked GameStream host at `C:/0.sunshine/Sunshine`.
- **moonlight-common** — forked at `C:/0.sunshine/moonlight-common-rust`.

Windows repo root: `C:\Users\e3ds\Desktop\moonlight-web-stream\`

The streamer does **not** re-encode. It forwards Sunshine's already-encoded H.264
stream over WebRTC. This single fact drives most of the behavior below.

---

## 2. Transport modes

Two ways the streamer connects to the signaling server:

- **stdio (OLD)** — signaling server spawns `streamer.exe` as a child process.
- **dial-out / websocket (NEW)** — `streamer.exe` runs standalone, reads `streamer.toml`,
  and dials OUT via WebSocket to the signaling gateway at `/api/streamer/connect`,
  registers, and waits.

Switch (both halves must agree, or you get ECONNREFUSED):
- `streamer.toml`: `transport = "websocket" | "stdio"`
- signaling `config.json`: `streamer.use_connected = true | false`

**Config trap — do not confuse these two:**
- signaling `config.json` → `web_server.bind_address` = where the signaling server
  LISTENS (local interface, e.g. `0.0.0.0:8081` or `127.0.0.1:8081`).
- `streamer.toml` → `server_url` = where the streamer DIALS (public host).

Gateway files (dial-out): `src/routes/streamer-endpoint.js`, `streamer-registry.js`.

---

## 3. Identifiers (do not conflate)

- **app_id** — CRC32 of the app name. Picks which app to launch.
- **host_id** — identifies a PAIRED Sunshine within one user's account. About
  certs/pairing, NOT a physical machine.
- **user_id** — which account. `default_user_id` = public no-login URLs.

## moonlight termination codes (for user-facing messaging)

`0` = graceful / stream ended · `-100` = NO_VIDEO_TRAFFIC (firewall) ·
`-101` = NO_VIDEO_FRAME (host stopped video) · `-102` = UNEXPECTED_EARLY_TERMINATION
(host app closed/offline) · `-103` = PROTECTED_CONTENT (DRM) ·
`-104` = FRAME_CONVERSION (host processing error).

## Sunshine ports

HTTP 47989 · HTTPS-paired 47984 · web UI 47990 · UDP 47998–48010.

---

## 4. ★ THE CORE PERFORMANCE PROBLEM — read this before debugging any lag ★

**Symptom:** On a weak/remote client the game feels frozen. Player presses jump; nothing
happens; ~1 minute later the browser suddenly shows the player already landed. The
*transition* frames are missing — it is NOT slow motion, it is a freeze then a jump to
the present. On the host machine the game is responding normally the whole time.

**Root cause: there is no congestion-control loop.**

The browser continuously measures its downlink and sends REMB
(Receiver Estimated Maximum Bitrate) back up. The streamer receives it and
**throws it away.** In `streamer/src/transport/webrtc/video.rs` (~line 159), inside the
RTCP handler:

```rust
if let Some(_max_bitrate) = packet.downcast_ref::<ReceiverEstimatedMaximumBitrate>() {
    // Moonlight doesn't support dynamic bitrate changing :(
}
```

Note the `_` prefix — the value is deliberately unused. Meanwhile the bitrate toward
Sunshine is set ONCE at launch and never changes: `streamer/src/main.rs` (~line 771),
`bitrate: settings.bitrate_kbps` in `MoonlightStreamSettings`. So Sunshine encodes at a
fixed rate regardless of what the client link can actually carry.

**The failure sequence when link < fixed bitrate:**

1. Excess data cannot be sent, so it **queues** — in the host's OS socket buffer and in
   whichever router on the path is the bottleneck (for outbound streaming this is usually
   the **host's upload side**; check host upload speed first). This is bufferbloat →
   growing delay.
2. When a buffer fills it **tail-drops**: new packets are discarded at the door while
   already-queued (old) packets still get delivered. So the client keeps receiving OLD
   frames late, and the CURRENT frames are the ones lost. This is why you watch the past.
3. H.264 P-frames are deltas. One lost packet makes every following P-frame undecodable
   (broken reference chain). The decoder discards them all — freeze on last good frame.
4. Browser sends PictureLossIndication. Streamer catches it (`needs_idr.store(true, ...)`
   in the same handler, ~line 157) and requests a fresh IDR keyframe from Sunshine.
5. The IDR is a complete picture of the world **as it is now** — so it shows the landing,
   not the jump. The arc was in the discarded P-frames and is gone forever.

**Amplification spiral:** an IDR is ~10–50× larger than a P-frame. Sending a big keyframe
into an already-saturated link worsens congestion → more loss → another PLI → another IDR.
Long freezes punctuated by sudden jumps is the signature of this spiral.

**Diagnostic checklist (all stats already displayed in the panel):**
- `webrtcPacketsLost` — climbs during a bad episode (0 in a healthy moment).
- `webrtcFramesDropped` — undecodable frames discarded.
- `webrtcKeyFramesDecoded` — THE giveaway. Healthy ≈ one per few seconds. Several per
  second = the IDR spiral is confirmed.
- `webrtcNackCount` — retransmission requests, rises with loss.

**Confirm the cause directly:** change the dead REMB block to log instead of discard —
`debug!("browser REMB estimate: {} bps", _max_bitrate.bitrate)` — and compare against the
configured `bitrate_kbps`. REMB well below configured = confirmed.

**Fixes, least → most effort:**
1. Lower `bitrate_kbps` to fit the worst-case client. Blunt but it's the only knob today.
   Gate per-user via the existing `maximum_bitrate_kbps` role permission.
2. Rate-limit IDR requests: ignore PLIs arriving within ~500ms of the last keyframe.
   Breaks the amplification spiral (stay frozen slightly longer but actually recover).
3. Bound the send queue: if queue depth exceeds a threshold, drop pending frames and force
   one IDR — trade a visible hitch for bounded latency (right trade for interactive).
4. Prefer **intra-refresh** over full IDRs: spread intra-coded blocks across many frames so
   recovery is gradual and doesn't spike bitrate when the link is already drowning. Correct
   fix for lossy links. (Same technique used on the Unreal Pixel Streaming side.)
5. Check the ICE path: if media is relayed via TURN-over-TCP you get reliable, in-order,
   ever-growing delay regardless of bitrate. Inspect the selected candidate pair; if it's
   `relay` + `tcp`, fix the UDP path first.

**Who plays fine:** a client with sustained bandwidth headroom above the fixed bitrate has
no problem — which is why it works on LAN and breaks remotely. Caveats: it's the **floor**
that matters, not peak (a fast but erratic WiFi link still spikes the queue; stable wired
30 Mbps beats erratic 200 Mbps WiFi). Bandwidth does not fix **RTT** — a distant user has a
latency floor no bandwidth can lower (~40–80 ms glass-to-glass even on a perfect link).

**Strategic:** the missing REMB loop is the strongest case for the Phase-1 plan of embedding
WebRTC directly into the Sunshine fork. With encoder + transport in one process, REMB feeds
straight into NVENC and the loop closes — which is how Unreal Pixel Streaming already works.
The author's comment in `video.rs` is them hitting exactly the wall this fork is meant to remove.

---

## 5. FPS layers (there are ~8; only three matter)

1. Game render FPS on host (e.g. 120) — app/Unreal frame cap.
2. **Sunshine capture FPS** = `settings.fps` (`main.rs`, also `fps_x100`). Grabs newest
   frame at this cadence; uncaptured game frames (61–120) are never encoded — costs nothing.
3. NVENC encode FPS — normally 1:1 with capture.
4. Arrival FPS at streamer (moonlight/ENet UDP) — matches #3 on the same box.
5. WebRTC send FPS — equals #4 (pass-through, no re-encode). **This is where the queue builds.**
6. **Browser decode FPS** — `webrtcFps` (browser-reported) and `webrtcFpsComputed` (ours).
   The low 10–16 number during trouble is here.
7. Compositor paint FPS — capped by requestAnimationFrame / display refresh.
8. Display refresh (60 / 120 / 144 Hz).

The three that matter: **#2 (configured), #6 (measured), and they should be equal.** Any gap
is the problem. The `60 fps` on the stats top line is #2 (negotiated capture rate) and stays
60 no matter how bad #6 gets — that's why the computed value was added. Legit frame drops
happen at #1→#2 (capture skip) and #6→#8 (paint skip); both are free. The pathological path
is #5→#6 where frames arrive late or are lost.

---

## 6. Frontend stats — computed FPS

`web/stream/transport/webrtc.ts`, in the `getStats()` method of class `WebRTCTransport`.

- The browser-reported line already exists: `statsData.webrtcFps = value.framesPerSecond`
  (guarded by `value.framesPerSecond != null`). **Leave it exactly as-is** — Chromium-only
  and undefined for the first ~second, but keep it: when both it and the computed value
  appear and track, both paths are healthy; when only the computed one appears, the browser
  wasn't supplying the field.
- Added a self-labeled computed value, `webrtcFpsComputed`, derived from `framesDecoded`
  (reported by every browser) across polls. The panel prints record keys verbatim (that's
  why an unset key silently vanishes rather than showing blank), so it renders as
  `webrtcFpsComputed: 59.4` with no type changes — `statsData` is
  `Record<string, StatValue>`.
- **Stateful across polls**, so it needs two class fields. These MUST live INSIDE the class
  body (this file's style puts each field directly above the method that uses it — mirror
  `private wasConnected = false` above `onConnectionStateChange`). If they end up flush-left
  they've fallen after the class's closing brace → module-level → the
  `does not exist on type 'WebRTCTransport'` errors seen before. The four-space indent is the
  tell; verify the class's final `}` sits below all three lines.

```ts
    private prevFramesDecoded: number | undefined
    private prevStatsTimestamp: number | undefined

    async getStats(): Promise<Record<string, StatValue>> {
```

Inside the stats loop, after the existing `framesPerSecond` block:

```ts
            if ("framesDecoded" in value && value.framesDecoded != null) {
                statsData.webrtcFramesDecoded = value.framesDecoded
                if (this.prevFramesDecoded != null && this.prevStatsTimestamp != null) {
                    const dFrames = value.framesDecoded - this.prevFramesDecoded
                    const dMs = value.timestamp - this.prevStatsTimestamp
                    if (dMs > 0) {
                        statsData.webrtcFpsComputed =
                            Math.round(((dFrames * 1000) / dMs) * 10) / 10
                    }
                }
                this.prevFramesDecoded = value.framesDecoded
                this.prevStatsTimestamp = value.timestamp
            }
```

UI note: the stats panel currently renders transparent over the control buttons (both
unreadable). A solid background + higher `z-index` on that overlay fixes it.

---

## 7. URL / query parsing (frontend)

- Query string needs a real `?`. A URL like `.../default&version=2` has NO query string —
  everything after `/v5/` is path, so `&version=2` becomes part of the last path segment and
  `URLSearchParams` sees nothing (also corrupts `/v5` pretty-URL parsing: the final segment
  reads `default&version=2` instead of `default`). Correct form: `.../default?version=2`.
- Watch for an inverted default guard. Correct shape:
  ```js
  if (versionStr === null) { versionStr = "1"; }
  ```
  (A bug was seen doing the opposite — overwriting the found value with "1" in the `else`.)
- Param NAME must match what the frontend reads. Earlier demo URLs used `appVersion`
  (e.g. `?appVersion=1`), not `version`. If the reader looks for `appVersion` and the URL
  sends `version=2`, you get `null` even with a correct `?`.

---

## 8. HTTPS for the signaling gateway (reverse proxy; NOT yet deployed)

Plan: a reverse proxy terminates TLS; the signaling server stays plain HTTP on
`127.0.0.1:8081`. WebRTC media is UDP peer-to-peer and does NOT pass through the proxy —
only signaling + the streamer gateway are proxied.

**DNS first:** use a hyphenated hostname, e.g. `connector-ms6.eagle3dstreaming.com`. The
underscore form `connector_ms6` is an invalid hostname and breaks wildcard matching — this
silently wastes time. The wildcard cert covers the hyphenated name.

**Then three changes (same for either proxy):**
- signaling `config.json` → `web_server.bind_address = 127.0.0.1:8081`
- `streamer.toml` → `server_url = wss://connector-ms6.eagle3dstreaming.com/api/streamer/connect`
  (`wss`, and **no port**)
- browser URLs → `https://connector-ms6.eagle3dstreaming.com/v5/...` (no port)

**Mixed-content trap:** the page is `https:`, so every WebSocket must be `wss:`. Frontend
should derive the scheme from `location.protocol`; grep for hardcoded `ws:` before cutover.
Upside: HTTPS = secure context (`window.isSecureContext`), which pointer lock / clipboard /
some mobile input paths want.

### Option A — Caddy (least work; auto WebSocket upgrade, auto cert)
```
connector-ms6.eagle3dstreaming.com {
    reverse_proxy 127.0.0.1:8081
}
```
Caddy obtains and renews the cert itself — no separate client, no scheduled task. If using
an existing paid cert instead, add `tls C:/certs/wildcard.crt C:/certs/wildcard.key`.
Install as a Windows service so it survives reboot.

### Option B — nginx (must spell out WebSocket headers; does NOT auto-cert)
GoDaddy cert: concatenate leaf THEN intermediate bundle (order matters):
`copy /b wildcard.crt + gd_bundle-g2-g1.crt C:\certs\fullchain.pem`
(verify: `openssl x509 -in ... -noout -subject -issuer`). `.pfx` → PEM first via
`openssl pkcs12`.

```nginx
server {
    listen 443 ssl;
    server_name connector-ms6.eagle3dstreaming.com;

    ssl_certificate     C:/certs/fullchain.pem;
    ssl_certificate_key C:/certs/wildcard.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:8081;

        # WebSocket upgrade — REQUIRED for /api/streamer/connect and browser signaling.
        # Without these three lines nginx downgrades the upgrade → 400, "page loads but
        # the stream never starts".
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Long-lived sockets: nginx default is 60s → idle streamer dropped after a minute.
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
    }
}
server {                       # optional http→https
    listen 80;
    server_name connector-ms6.eagle3dstreaming.com;
    return 301 https://$host$request_uri;
}
```
`nginx -t` before reload (catches Windows backslash-vs-forward-slash typos in cert paths).

**Auto free cert on nginx/Windows:** nginx has no built-in ACME. Pair with **win-acme**
(`wacs.exe`, run as admin). HTTP-01 for a single hostname (needs port 80 publicly reachable
during issuance) — simplest. DNS-01 only if a real wildcard is required (needs GoDaddy API
key). Serve the challenge and keep it ahead of the redirect:
```nginx
location /.well-known/acme-challenge/ { root C:/nginx/html; }
```
Store as PEM, set the install step to run `C:\nginx\nginx.exe -s reload`; win-acme adds a
renewal scheduled task (~60 days). Trap: if port 80 is firewalled after moving to 443,
renewal silently fails later. (Caddy avoids this whole section.)

---

## 9. Pairing model (current)

The signaling server contributes NOTHING cryptographically — pairing is fundamentally
streamer↔Sunshine. It holds certs only for PERSISTENCE (the old stdio streamer was
disposable/stateless). Pairing can't be "turned off": it's baked into the GameStream wire
protocol; Sunshine rejects unpaired clients at the TLS layer.

Current mechanics (verified in code):
- The client CERTIFICATE is self-signed and GENERATED, not fetched
  (`crypto.js` `generateClientCertificate()`), like an ID card the client makes for itself.
- `pairInfo` = the OUTPUT of pairing = 3 stored PEM credentials
  `{clientCertificate, clientPrivateKey, serverCertificate}` (`storage.js` ~line 249).
- The PIN is used ONLY at setup (one-time), never during streaming; the streaming user never
  sees it. It defeats MITM on the unencrypted phase-1 exchange (both sides derive the same
  AES key only if the PIN matches).
- SETUP (once, admin): admin `POST /pair` → signaling generates a PIN + runs the 6-phase
  handshake ITSELF with Sunshine → saves `pairInfo` (`storage.setPairInfo`).
- STREAMING (every session): browser connects → signaling picks a streamer → reads `pairInfo`
  → sends 3 certs to the streamer in the Init message (`stream.js` ~lines 171–174) → streamer
  uses them for mutual-TLS to Sunshine 47984 (app list / launch / cancel). Same 4 fields on
  the `fetchAppList` path (`stream.js` ~99–117).

So today the SIGNALING SERVER owns/generates/stores certs and does the pairing; the streamer
holds no certs of its own and is handed them fresh each session.

Removing certs from the signaling side = RELOCATING the handshake to the Rust streamer
(self-pairing), not deleting it — Sunshine still demands a paired client. Only a Sunshine
fork that skips the client-cert check for `127.0.0.1` removes pairing outright, and that
REQUIRES binding Sunshine to loopback-only or it's an open door.

Diagrams from prior sessions: `current-architecture.svg` (accurate current model),
`pairing-flow.svg` (target/self-pairing model).

---

## 10. Per-user machine-pool routing (designed, NOT implemented)

Backward-compatible URL contract:
- optional `user` = which user's machine pool (absent = default pool).
- optional `fallback` = `locked` (default) or `priority`. `locked` = only that pool, wait if
  all busy; `priority` = prefer that pool, spill to default/free if busy. Absent → `locked`
  (never silently cross pools). `priority` with no `user` = no-op.
- Streamer side: `owner_user` in `streamer.toml` (absent/empty = default pool), sent in the
  register frame.

Pending ~4 edits: `transport_config.rs` (field), `ws_transport.rs` (register frame),
`streamer-registry.js` (store owner), `stream.js` (picker filter + URL parsing). Open:
`owner_user` string-name vs numeric user_id (string easier, but server must resolve + reject
unknown names to avoid phantom pools); bind host_id ↔ picked connection so the picker doesn't
hand a box paired under a different host_id (cert mismatch).

---

## 11. Streamer ID (hostname+PID; delivered, NOT yet applied/built)

`default_streamer_id()` (`streamer/src/transport_config.rs` ~84–86) currently returns the
literal `"streamer"` → collision risk (two default machines clash; registry `add()` replaces
the socket). Fix delivered but not compiled (no Rust toolchain in sandbox):
- `Cargo.toml`: add `hostname = "0.4"`.
- Generator: `host = hostname::get()...unwrap_or("streamer")`, `pid = std::process::id()`,
  sanitize host, `format!("{host}-{pid}")` → e.g. `DESKTOP-ABC123-48213`.
- `sanitize_id_segment()`: whitelist ASCII alphanumeric, replace all else with hyphen,
  collapse runs, trim ends. Underscore is the key hazard (same lesson as `connector_ms6`).
  Explicit `streamer_id` in the toml still overrides (NOT sanitized — keep it clean manually).

Build: `cargo build --release --package streamer` (MSVC / vcvars64).

---

## 12. Stream-stop / disconnect messaging (applied)

`web/stream/index.ts`. Two top-level functions ABOVE `export class Stream` (after the two
const declarations, NOT inside the class):
- `describeTerminationCode(code)` maps moonlight codes → human strings (see §3).
- `describeShutdown(reason)` maps `disconnect`→"stream ended", `failed`→"connection lost —
  host offline / net dropped", `failednoconnect`→"couldn't reach host", default→"stopped
  unexpectedly".

Wire-up: `ConnectionTerminated` handler uses `describeTerminationCode(code)` (type
`fatalDescription`); `startConnection` declares `let shutdownReason: TransportShutdown |
undefined` ONCE inside the method, assigns it in all three branches, ends with
`this.debugLog(describeShutdown(shutdownReason), { type: "fatal" })`. Build fix: annotate
`private async tryWebSocketTransport(): Promise<TransportShutdown | undefined>` (bare returns
in guard clauses). `TransportShutdown = "failednoconnect" | "failed" | "disconnect"`.

Caveat: ICE `disconnected`→`failed` escalation lags 5–30s (frozen frame persists in that
window; only `failed` acts). `TransportShutdown` imported ~line 13.

---

## 13. Touch / mobile input (fix pending)

`web/stream/input.ts`, pointAndDrag mode. Gesture map: quick tap <350ms = left click;
hold >350ms = RIGHT click; two-finger tap = right; double-tap-drag = hold-left-drag;
two-finger move >3px = scroll; three-finger = keyboard.

Constants (~line 14): `TOUCH_AS_CLICK_MAX_DISTANCE = 2` is BRUTALLY strict on phones — a
finger roll >2px silently suppresses the click. **Fix:** bump to ~10 (optionally
`TOUCH_AS_CLICK_MAX_TIME_MS` 350→500). Make Point-and-Drag the default for touch. Then
`npm run build-light`, copy dist→static.

---

## 14. Build & deploy

- Frontend rebuild (after bindings exist): `npm run build-light` then copy `dist` → `static`.
  Helper: `build-deploy.bat` (does `call npm run build-light`, then MERGE via
  `xcopy .\dist .\node-streamer-proxy\static /E /I /Y` — overwrites matches, keeps extras,
  does NOT delete). `call` is essential or npm.cmd never returns. Merge caveat: stale renamed
  files linger ("old version still loading") — occasionally clean or one-off `robocopy /MIR`.
- **Fresh machine — run full `npm run build`, not `build-light`.** `web/api_bindings.ts` is a
  GENERATED, gitignored file produced by `npm run generate-bindings`
  (= `cargo test export_bindings --package common`, a CARGO command needing the Rust
  toolchain). `build-light` skips it → 45 TS2307 "Cannot find module '../api_bindings.js'"
  errors. Also ensure `npm install` actually ran in the project folder (typescript is a
  declared dep but `node_modules/.bin/tsc` must exist). `dist` may be tracked-before-ignored:
  `git rm -r --cached dist` then commit. (Node version 19-vs-24 was a RED HERRING — not the
  cause of past failures.)
- Streamer: `cargo build --release --package streamer` (MSVC vcvars64). Launch via
  `run-streamer.bat` relauncher.
- Provisioning helper: `install-startup.bat` — auto-starts streamer + Sunshine at login
  (login-start, not boot-start; enable auto-login via netplwiz for hands-free; sets each
  shortcut's WorkingDirectory to its own folder — CRITICAL for Sunshine's relative asset
  paths). Install ViGEmBus. Let each machine generate its own certs and pair separately.

---

## 15. Security notes (for window-only streaming, when locked down)

Window-only capture controls only what's SEEN. **Input injection is GLOBAL** — Sunshine
injects to the whole OS, so Win+R etc. execute on the host even if not visible (blind escape).
Mitigations weakest→strongest: (a) filter dangerous keys in the fork (Super/Win, Ctrl+Esc,
Alt+Tab, Alt+F4; Ctrl+Alt+Del can't be injected anyway); (b) pin focus to the target window;
(c) STRONGEST — isolate the session via a dedicated Windows desktop object (`CreateDesktop`,
no Start menu/Run) or a locked-down standard user account. Bind Sunshine to `127.0.0.1`.

Also outstanding: the `/api/streamer/list` endpoint is UNAUTHENTICATED (leaks machine ids +
busy state) — lock it down or bind local before exposing publicly. Signaling public surface
wants an API key (streamer↔signaling auth).

---

## 16. Recurring failure patterns when editing this repo

- **Match by anchor text, not line numbers.** The Windows tree is newer than any snapshot.
- **Paste-over-paste:** old lines left below new ones — the old one wins at runtime.
- **Wholesale-overwrite** of a block reverts unseen edits. Prefer surgical anchored edits.
- Frontend ↔ Rust wire types are matched by hand — keep them in sync.
- CMake junctions in the Sunshine tree break Explorer copies; asset paths are cwd-relative.
- Class fields pasted flush-left land outside the class → "does not exist on type" errors.

---

## 17. Biggest lever / direction

Phase-1: embed libwebrtc directly into the Sunshine fork to replace the pass-through streamer.
Closes the REMB→NVENC congestion loop (§4), removes pairing via a localhost cert-check bypass
(§9), and lets key-injection filtering live in one place (§15). Handoff doc from prior work:
`streamer-into-sunshine-handoff.md`. Phase-2: reshape toward an Unreal Pixel Streaming-style
architecture.



# CLAUDE.md — Copy-URL feature (handoff for a fresh chat / new account)

Repo: https://github.com/ahsan-muzaheed/moonlight-web-stream
This file covers ONE feature (a "Copy URL" share button) plus the true architecture of this
repo, so a fresh Claude can finish the work without re-deriving anything.

> **Read this first — the repo does NOT match the older CLAUDE.md.** A prior handoff described
> a Node.js signaling server with a dial-out streamer registry (`streamer-registry.js`,
> `machine_id`, "pick any streamer on that machine"). **None of that exists in this public
> repo.** That design was private/unpushed or a different fork. Do not look for it here; build
> against what's actually below.

---

## 1. Actual architecture of THIS repo

- **Signaling server = Rust** (`src/`, actix-web), NOT Node. Entry `src/main.rs`,
  stream route `src/api/stream.rs`.
- **Streamer = Rust** (`streamer/`), spawned as a **stdio child process** by the signaling
  server on demand — `src/api/stream.rs` ~line 208: `Command::new(&web_app.config().streamer_path)
  .stdin(piped).stdout(piped).stderr(piped).spawn()`. There is **no** dial-out / websocket
  registration and **no** streamer registry.
- **Frontend = TypeScript** (`web/`), plain DOM components (no framework). Built with `tsc`.
- **common** (`common/`, Rust) generates `web/api_bindings.ts` via
  `cargo test export_bindings --package common` (gitignored; needs the Rust toolchain).

**"Which machine" = `host_id`.** The client opens a WebSocket to `/host/stream` and sends
`Init { host_id, app_id, video_frame_queue_size, audio_sample_queue_size }`
(`common` `StreamClientMessage::Init`, handled in `src/api/stream.rs` ~line 70). The signaling
server resolves the host (its address, port, and pair certs), then spawns a local streamer
pointed at that host's Sunshine. `host_id` = which paired Sunshine within the user's account;
`app_id` = which app.

**The shareable deep-link scheme ALREADY EXISTS.** `web/stream.ts` reads from the query
string: `hostId`, `appId` (required), plus optional `bitrate`, `fps`, `hdr`, `videoSize`,
`videoSizeCustom.width/height`, `dataTransport`, `language`. So this URL already works and
launches a specific app on a specific host:

```
https://<domain>/stream.html?hostId=<id>&appId=<id>
```

That means the "Copy URL" feature is NOT new routing — it is just producing that URL and
putting it on the clipboard.

---

## 2. What was DONE this session (web app-list Copy-URL button)

Implemented the Copy-URL action in the existing web app list (the in-repo equivalent of a
"button on the apps page"). Committed to none — these are working-tree edits only; review,
build, and commit them.

**Files changed (6):**
- `web/component/game/index.ts`
  - Added `getStreamUrl(): string` — builds the absolute shareable URL
    (`buildUrl('/stream.html?hostId=..&appId=..')`; `buildUrl` already prefixes
    `window.location.origin` + configured `path_prefix`, so it's paste-ready).
  - Refactored `startStream()` to reuse `getStreamUrl()`.
  - Added `copyStreamUrl()` — `navigator.clipboard.writeText(url)` with an `info`
    notification on success, and a `showMessage(url)` fallback for insecure-context/blocked
    clipboard.
  - Added a **"Copy URL"** entry to the right-click context menu in `onContextMenu` (next to
    "Show Details" / "Open"). Imported `showNotification`.
- `web/locales/en.ts` + `zh-CN.ts` + `pt-BR.ts` + `fr-FR.ts` + `ko-KR.ts`
  - Added `game.copyUrl` and `game.copyUrlSuccess` to every locale. **Required** because
    `type Translations = typeof en` (locales/en.ts ~line 196) — a key missing from any locale
    is a compile error.

**How to use it once built:** right-click an app in the list → **Copy URL** → paste anywhere.
Clipboard needs a secure context (https or localhost); otherwise the fallback dialog shows the
URL to copy manually.

---

## 3. UNFINISHED — do these next

### 3a. Build + verify the web edits (blocked here on toolchain)
- Could not run `tsc` in the handoff sandbox because `web/api_bindings.ts` is generated by
  cargo and **no Rust toolchain was available**. On a full machine:
  1. `npm install` (dev deps: typescript, cpx, npm-watch).
  2. `npm run generate-bindings` (= `cargo test export_bindings --package common`) — needs
     Rust/MSVC. On a fresh machine this MUST run or tsc dies with TS2307 on `api_bindings.js`.
  3. `npm run build` (full: generate-bindings + tsc + copy-static) or `npm run build-light`
     (tsc + copy-static, only if bindings already exist).
- The edits are localized and type-consistent (all 5 locales updated, imports added), but they
  have NOT been compiled. Confirm a clean `tsc` and click-test Copy URL over https.

### 3b. Copy-URL button inside Sunshine's own apps page (C++ — DEFERRED by the user)
The user will provide the Sunshine fork code in a later chat. The plan agreed on:
- The button lives in Sunshine's apps web UI (edit the Sunshine fork).
- It must build the SAME URL: `https://<domain>/stream.html?hostId=<id>&appId=<id>`.
- **Open problem to resolve with the user:** Sunshine does not know its `host_id` — `host_id`
  is assigned by the *signaling server* per user account, not by Sunshine. So the button in
  Sunshine cannot know which hostId to embed. Options to discuss:
  1. Keep Copy-URL in the moonlight-web UI (done in §2), not in Sunshine — simplest, since
     that UI already knows hostId+appId.
  2. Have Sunshine's page ask the operator to paste in the hostId (from the moonlight-web
     host list) once, stored in Sunshine config alongside a `signaling_domain` field.
  3. Only meaningful once/if a self-pairing or dial-out model is added (not in this repo).
- Decisions already locked from the design chat: URL param name would be `machineid=` **only
  if** a machine-key model is added later; in THIS repo the working params are `hostId` +
  `appId`. Offline target → hard-fail "unavailable" (no fallback). Button placement → Sunshine
  page (per user), pending the hostId-source question above.

### 3c. Optional polish on the web Copy-URL
- Add a visible button (not only the right-click entry) if the user wants one-tap on mobile
  (right-click/long-press is less discoverable on touch). The list element is
  `web/component/game/index.ts` `divElement`.
- Optionally carry current settings (bitrate/fps/hdr/videoSize) into the copied URL — the
  stream page already parses them (`web/stream.ts` `parseSettingsFromQuery`). Currently
  Copy-URL emits only hostId+appId (clean default).

---

## 4. Backlog still valid against THIS repo (from earlier sessions — verify before trusting)

These were carried in from prior chats. Some may already be present or may live only in the
user's private tree — CONFIRM against the code before acting.
- **Congestion / no adaptive bitrate.** The streamer discards the browser's REMB and uses a
  fixed bitrate. In this repo see `streamer/src/transport/web_socket/mod.rs` (RTT/`needs_idr`
  handling) and `streamer/src/video.rs` — grep for `bitrate`, `needs_idr`, `RttInfo`. Fix
  path: log REMB, then lower/gate bitrate, rate-limit IDR (~500ms), bound the send queue, or
  intra-refresh. (This was the big performance topic; anchors differ from the old CLAUDE.md
  because that referenced a different tree.)
- **Computed-FPS stat.** `web/stream/transport/webrtc.ts` `getStats()` — add
  `webrtcFpsComputed` from `framesDecoded` deltas; two stateful fields must sit INSIDE the
  class. Verify whether already present before re-adding.
- **Touch click tolerance.** `web/stream/input.ts` — the "registered as a click" distance/time
  constants (top of file, ~line 15); loosen for phones.
- **Security.** Any public endpoint (e.g. host/stream) should sit behind auth; check
  `src/api/*` guards. Bind Sunshine to loopback if isolating.

---

## 5. Repo cheat-sheet (verified this session)

- Stream launch URL: `web/stream.ts` → reads `hostId`, `appId`, optional settings.
- App list + click-to-stream: `web/component/game/index.ts` (`startStream`, `getStreamUrl`,
  `onContextMenu`) and `web/component/game/list.ts`.
- Absolute-URL helper: `web/config_.ts` `buildUrl(path)` = origin + path_prefix + path.
- Notifications: `web/component/notification.ts` `showNotification(msg, "info"|"warn"|"error")`.
- Context menu: `web/component/context_menu.ts` `setContextMenu(event, { elements: [{name, callback}] })`.
- i18n: canonical `web/locales/en.ts` defines `type Translations = typeof en`; other locales
  must match key-for-key. `getTranslations(getCurrentLanguage())`.
- Stream init on the server: `src/api/stream.rs` — `StreamClientMessage::Init { host_id, app_id, .. }`,
  host resolve via `user.host(host_id)`, streamer spawned as stdio child (~line 208).
- Build: `npm run build` (needs Rust for bindings) / `npm run build-light` (bindings must
  exist) / `npm run generate-bindings` (cargo). Streamer: `cargo build --release --package streamer`.

---

## 6. One-paragraph status for the next Claude

The Copy-URL share feature is implemented on the web side: right-click an app → Copy URL copies
`https://<domain>/stream.html?hostId=<id>&appId=<id>` (this URL scheme already existed; only the
copy action and i18n were added, across 6 files, uncommitted). It has NOT been compiled here
(no Rust toolchain to generate `api_bindings.ts`), so first run `npm install` →
`npm run generate-bindings` → `npm run build`, then click-test over https and commit. The
remaining piece is the Sunshine-fork C++ button, deferred until the user shares that code — and
its real open question is that Sunshine doesn't know its signaling `host_id`, so decide with the
user how the button obtains it (or keep Copy-URL in the web UI where hostId is already known).



## 


A "Copy URL" button, placed on Sunshine's own Apps page, that copies a link.
Anyone who pastes that link gets the moonlight-web-stream frontend, which
streams **that exact app** from **that exact machine** (the one whose
Sunshine the button was on) — no login, no menu navigation, no picking a
host. This matters because the user distributes the streamer+Sunshine bundle
to many people, each running it on their own machine, and each needs to be
able to generate a working share-link for their own box without any central
setup.

**Link shape:** `https://<domain>/stream.html?appId=<id>&machineid=<id>`

---

## 1. Two repositories, two languages, one feature

| Repo | Language | Role | GitHub |
|---|---|---|---|
| moonlight-web-stream | Rust (streamer + signaling server) + TypeScript (frontend) | Browser <-> signaling <-> streamer <-> Sunshine relay | github.com/ahsan-muzaheed/moonlight-web-stream, branch ahsan4-ws-ss---streamer |
| Sunshine | C++ | The GameStream host, forked by the user | github.com/eagle3dstreaming/Sunshine, branch AHSAN1 |

**Local paths on the user's machines** (from their messages):
- `C:\0.sunshine\moonlight-web-stream\` — signaling server + frontend (machine 1, static IP, Node only)
- `C:\0.sunshine\Sunshine\` — Sunshine build (co-located with a streamer on machine 2/3, per Sunshine box)
- A third, STALE tree also exists at `C:\Users\e3ds\Desktop\moonlight-web-stream\` — this is a DIFFERENT, older architecture (a Rust-only `server/` binary, not the Node signaling server). **Ignore this tree.** It is not what's being run. Its presence in a leftover `config.json` `"path2"` key caused early confusion but is otherwise inert (the code never reads `path2`).

--

## 2. CORRECTING THE OLD CLAUDE.md — verified architecture

An earlier CLAUDE.md (written before the repo was actually cloned/inspected)
described a **different, wrong architecture**: Node.js signaling server with
dial-out streamer registry, `machine_id`/`streamer_id`, etc. That guess
turned out to be **directionally right** but was reconstructed blind. This
session cloned both real repos and built the ACTUAL feature against the real
code. Trust this file, not that one, for file/line specifics.

**Confirmed real architecture (verified by cloning, this session):**
- Signaling server: **Node.js/Express**, folder `node-streamer-proxy/`, entry `src/index.js`.
- Streamer: **Rust**, folder `streamer/`, **dial-out over WebSocket** to the
  signaling server's `/api/streamer/connect` (confirmed: `config.json` has
  `"streamer": { "use_connected": true }`, and Node logs
  `[StreamerGW] incoming streamer connection from <ip>`).
- Frontend: **TypeScript**, folder `web/`, compiled via Vite/tsc into
  `node-streamer-proxy/static/`.
- Existing (pre-session) shareable link scheme: `stream.html?hostId=<id>&appId=<id>`
  — this ALREADY existed and already worked before this session. The
  Copy-URL feature extends it with an alternative, `machineid=`, that needs
  no `hostId` at all.

---

## 3. Core concepts — do not conflate these terms

- **`hostId`** — Node's own bookkeeping id for a *paired* Sunshine
  (`storage.json` -> `hosts.<id>`). Holds `address`, `httpPort`, `ownerId`,
  and `pairInfo` (the 3 PEM certs from the GameStream pairing handshake).
  Sunshine has NO WAY to know its own hostId — it's assigned by Node, per
  user account, at pairing time. This is exactly why the Copy-URL button
  living on Sunshine's OWN page cannot embed `hostId` — it must use
  `machineid` instead.
- **`machineId`** — a NEW field this session added onto a host record
  (`hosts.<id>.machineId`). It's the **stable, sanitized hostname** of the
  physical box running that Sunshine + its streamer. Same value on both
  sides (streamer computes it in Rust, Sunshine computes it in C++, using
  IDENTICAL sanitize rules — see section 5). This is what Copy-URL links
  carry. **A host record has no `machineId` until you explicitly link it**
  (section 7) — it is NOT set automatically by pairing.
- **`streamerId`** — the Rust streamer's OWN per-process registration id in
  the Node registry = `<machineId>-<pid>`. Changes every restart. Multiple
  streamers can run on one machine (rare) — they'd share one `machineId` but
  have different `streamerId`s. The registry can be asked "any available
  streamer for this machineId" (`pickByMachineId`).
- **`appId`** — the REAL numeric GameStream app id (CRC32-derived,
  `calculate_app_id()` in Sunshine's `process.cpp`). This is what `/applist`
  reports as `<ID>` and what Node parses. **It is NOT the array index** shown
  in Sunshine's Apps page Vue component — that was a real bug found and
  fixed this session (section 6).

---
