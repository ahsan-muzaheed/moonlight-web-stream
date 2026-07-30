// streamer/src/ws_transport.rs
//
// NEW ARCHITECTURE (additive). Dials OUT to the Node server, performs the
// register handshake, then bridges the WebSocket to the SAME newline-delimited
// JSON IPC the streamer already uses - so the entire rest of main.rs is
// unchanged. The trick: we tunnel the WS through an in-memory byte pipe
// (tokio::io::duplex) whose two halves look exactly like stdin/stdout, then
// hand those to the existing create_process_ipc().
//
// Wire mapping:
//   Node -> streamer : WS text frame  (one ServerIpcMessage JSON)  ==> pipe (+ '\n')
//   streamer -> Node : pipe line (one StreamerIpcMessage JSON)     ==> WS text frame
//
// Control frames used ONLY for the handshake/heartbeat are JSON objects with a
// "type" field ({"type":"register"...}, {"type":"registered"}, {"type":"ping"}).
// IPC messages are the streamer's normal enum JSON (externally tagged, e.g.
// {"WebSocket":{...}} or {"Init":{...}}) and never contain a top-level "type",
// so the two are easy to tell apart.

use common::ipc::{
    IpcReceiver, IpcSender, ServerIpcMessage, StreamerIpcMessage, create_stream_ipc,
};
use futures::{SinkExt, StreamExt};
use moonlight_common::{
    high::tokio::MoonlightHost,
    http::{
        ClientIdentifier, ClientSecret, ServerIdentifier,
        client::tokio_hyper::TokioHyperClient,
    },
};
use tokio::sync::mpsc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};
use tracing::{Span, info, warn};

use crate::transport_config::TransportConfig;

/// Connect to Node, register, and return the SAME IPC pair the stdio path
/// produces. On success the rest of main() proceeds identically.
pub async fn connect_websocket_ipc(
    span: Span,
    cfg: &TransportConfig,
) -> anyhow::Result<(IpcSender<StreamerIpcMessage>, IpcReceiver<ServerIpcMessage>)> {
    let url = cfg
        .server_url
        .clone()
        .ok_or_else(|| anyhow::anyhow!("transport=websocket but server_url is not set"))?;

    info!("[ws] connecting to {url}");
    let request = url.into_client_request()?;
    let (ws_stream, _resp) = connect_async(request).await?;
   info!(
        "[ws] connected, registering as '{}' (machine '{}')",
        cfg.streamer_id, cfg.device_id
    );

    let (mut ws_write, mut ws_read) = ws_stream.split();

    // ---- Register handshake -------------------------------------------------
    let register = serde_json::json!({
        "type": "register",
        "id": cfg.streamer_id,
        "device_id": cfg.device_id,
        "token": cfg.auth_token,
        // Lets Node auto-create a Host record on first register instead of
        // requiring a manual add - see autoLinkStreamerToHost in
        // streamer-endpoint.js. Sunshine's own address/port dial in.
        "address": cfg.sunshine_address,
        "http_port": cfg.sunshine_http_port,
    });
    ws_write.send(Message::Text(register.to_string())).await?;

    // Wait for {"type":"registered"} (or an error) before proceeding.
    loop {
        match ws_read.next().await {
            Some(Ok(Message::Text(text))) => {
                let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
                match v.get("type").and_then(|t| t.as_str()) {
                    Some("registered") => {
                        info!("[ws] registered with Node");
                        break;
                    }
                    Some("error") => {
                        let reason = v
                            .get("reason")
                            .and_then(|r| r.as_str())
                            .unwrap_or("unknown");
                        anyhow::bail!("registration rejected: {reason}");
                    }
                    _ => {
                        // ignore anything unexpected before we're registered
                    }
                }
            }
            Some(Ok(_)) => {} // ignore non-text control frames
            Some(Err(err)) => anyhow::bail!("ws error during registration: {err}"),
            None => anyhow::bail!("ws closed during registration"),
        }
    }

    // ---- Bridge WS <-> in-memory byte pipe ---------------------------------
    // node_side halves get handed to create_process_ipc as "stdin"/"stdout".
    // We copy bytes between the WS and those halves.
    let (ipc_read_half, mut bridge_write) = duplex(64 * 1024); // Node -> streamer bytes
    let (mut bridge_read, ipc_write_half) = duplex(64 * 1024); // streamer -> Node bytes

    // All outbound WS frames funnel through this channel, because two
    // producers need the socket: the IPC bridge (task B) and the request
    // handler (spawned from task A, replying to GetAppList). Only task B
    // actually owns ws_write.
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Message>();

	// Sunshine's location comes from OUR config, not from Node, so requests can
    // be served before Init ever arrives.
    let sunshine_address = cfg.sunshine_address.clone();
    let sunshine_http_port = cfg.sunshine_http_port;
    // Copy-URL: this machine's own stable id, already computed at startup
    // (transport_config.rs default_device_id()). GetDeviceInfo answers from
    // this directly - no HTTP call to Sunshine, no dependency on Sunshine (or
    // this box) having any reachable/static address. Same value Sunshine's own
    // util::sanitize_device_id(get_host_name()) would report, since they run
    // on the same machine and apply the identical sanitize rule.
    let device_id = cfg.device_id.clone();
    // Self-pairing: when a PIN is configured the streamer owns its own certs
    // (cached in pairing_file) and ignores whatever Node sends per request.
    // Threaded down the same way device_id is - handle_request/get_app_list
    // never see the whole TransportConfig.
    let pairing_pin = cfg.pairing_pin.clone();
    let pairing_file = cfg.pairing_file.clone();


    // Task A: WS text frames from Node -> write JSON + '\n' into ipc_read_half.
    let span_a = span.clone();
    // Cloned BEFORE the spawn: the closure takes ownership of whatever it
    // captures, and the line-pump task below needs its own sender too.
    let request_tx = out_tx.clone();
    tokio::spawn(async move {
        while let Some(item) = ws_read.next().await {
            match item {
                Ok(Message::Text(text)) => {
                    // Control frames (heartbeat, requests) never reach the IPC pipe.
                    if let Some(kind) = control_frame_type(&text) {
                        if kind == "request" {
                            // Node is asking us to do something on its behalf -
                            // typically fetch the app list from the Sunshine
                            // running next to us. Handled off-task so a slow
                            // HTTP call can't stall the message loop.
							let reply_tx = request_tx.clone();
                            let addr = sunshine_address.clone();
                            let mid = device_id.clone();
                            let pin = pairing_pin.clone();
                            let pfile = pairing_file.clone();
                            let span_req = span_a.clone();
                            tokio::spawn(async move {
                                handle_request(
                                    span_req,
                                    text,
                                    addr,
                                    sunshine_http_port,
                                    mid,
                                    pin,
                                    pfile,
                                    reply_tx,
                                )
                                .await;
                            });
                        }
                        continue;
                    }
                    if bridge_write.write_all(text.as_bytes()).await.is_err() {
                        break;
                    }
                    if bridge_write.write_all(b"\n").await.is_err() {
                        break;
                    }
                    let _ = bridge_write.flush().await;
                }
                Ok(Message::Binary(_)) => { /* media relay: later step */ }
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                Ok(Message::Close(_)) | Err(_) => {
                    warn!(parent: &span_a, "[ws] Node closed the connection");
                    break;
                }
                _ => {}
            }
        }
    });

    // Task B: lines the streamer writes (StreamerIpcMessage JSON) -> WS text frames.
    let span_b = span.clone();
    tokio::spawn(async move {
        // Single writer: everything bound for Node arrives on out_rx, whether
        // it came from the IPC pipe (task B2 below) or from a request handler.
        // Avoids select! over next_line(), whose cancellation behaviour would
        // otherwise risk dropping half a line mid-read.
        while let Some(msg) = out_rx.recv().await {
            if ws_write.send(msg).await.is_err() {
                warn!(parent: &span_b, "[ws] failed to send to Node");
                break;
            }
        }
    });

    // Task B2: lines the streamer writes (StreamerIpcMessage JSON) -> outbound
    // channel -> WS. Kept separate from the socket writer so there is exactly
    // one thing touching ws_write.
    let span_b2 = span.clone();
    let line_tx = out_tx.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(&mut bridge_read).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.is_empty() {
                        continue;
                    }
                    if line_tx.send(Message::Text(line)).is_err() {
                        break; // writer gone
                    }
                }
                Ok(None) => break,
                Err(err) => {
                    warn!(parent: &span_b2, "[ws] pipe read error: {err}");
                    break;
                }
            }
        }
    });

    // Hand the pipe halves to the EXISTING ipc constructor. From here on the
    // rest of main() is byte-for-byte identical to the stdio path.
    let (ipc_sender, ipc_receiver) =
        create_stream_ipc::<ServerIpcMessage, StreamerIpcMessage, _, _>(
            span,
            ipc_read_half,
            ipc_write_half,
        )
        .await;

    Ok((ipc_sender, ipc_receiver))
}

/// Control frames are small JSON objects carrying a top-level "type"
/// (register/registered/ping/pong/error/request). Real IPC messages are the
/// streamer's externally-tagged enum JSON and never have a top-level "type",
/// which is how the two are told apart. Returns the type when it is a control
/// frame, so callers can dispatch on it.
fn control_frame_type(text: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    v.get("type")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
}

/// Serve a request from Node.
///
/// Node cannot reach Sunshine in the connected architecture (Sunshine is
/// private, only the streamer sits beside it), so it delegates. We take the
/// ADDRESS from our own config and the CREDENTIALS from the request - Node did
/// the pairing and owns the certs, we merely borrow them for this call.
///
/// Wire: in  {"type":"request","id":N,"method":"GetAppList","params":{...}}
///       out {"type":"response","id":N,"ok":true,"result":[...]}
///        or {"type":"response","id":N,"ok":false,"error":"..."}
async fn handle_request(
    span: Span,
    text: String,
    sunshine_address: String,
    sunshine_http_port: u16,
    device_id: String,
    pairing_pin: Option<String>,
    pairing_file: String,
    reply_tx: mpsc::UnboundedSender<Message>,
) {
    let v: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(err) => {
            warn!(parent: &span, "[ws] unparseable request: {err}");
            return;
        }
    };

    let id = v.get("id").cloned().unwrap_or(serde_json::Value::Null);
    let method = v.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = v.get("params").cloned().unwrap_or(serde_json::Value::Null);

    let result = match method {
        "GetAppList" => {
            get_app_list(
                &span,
                &sunshine_address,
                sunshine_http_port,
                &params,
                pairing_pin.as_deref(),
                &pairing_file,
                &device_id,
            )
            .await
        }
        // Copy-URL: Node asks the streamer (already dialed-out, reachable
        // regardless of any static/public IP) for its machine id, rather than
        // Node calling Sunshine's HTTP API directly. Answered from our own
        // config - no network call, no address dependency at all.
        "GetDeviceInfo" => Ok(serde_json::json!({ "deviceid": device_id })),
        other => Err(format!("unknown request method '{other}'")),
    };

    let reply = match result {
        Ok(value) => serde_json::json!({
            "type": "response", "id": id, "ok": true, "result": value
        }),
        Err(err) => {
            warn!(parent: &span, "[ws] request '{method}' failed: {err}");
            serde_json::json!({
                "type": "response", "id": id, "ok": false, "error": err
            })
        }
    };

    let _ = reply_tx.send(Message::Text(reply.to_string()));
}

/// Fetch the app list from the Sunshine on this machine.
///
/// A short-lived host is built per request rather than reusing the streaming
/// host, because this can be called BEFORE Init has arrived (Node needs the app
/// list in order to build Init at all) - so no streaming host exists yet.
async fn get_app_list(
    span: &Span,
    address: &str,
    http_port: u16,
    params: &serde_json::Value,
    pairing_pin: Option<&str>,
    pairing_file: &str,
    device_name: &str,
) -> Result<serde_json::Value, String> {
    let field = |name: &str| -> Result<String, String> {
        params
            .get(name)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("GetAppList: missing '{name}'"))
    };

    let client_unique_id = field("client_unique_id")?;

    info!(parent: span, "[ws] GetAppList -> {address}:{http_port}");

    let host: MoonlightHost<TokioHyperClient> =
        MoonlightHost::new(address.to_string(), http_port, Some(client_unique_id))
            .map_err(|err| format!("failed to create host: {err:?}"))?;

    match pairing_pin {
        // NEW: self-paired. Credentials come from our own local pairing file,
        // so Node does not need to hold (or send) any certs at all. Whatever
        // cert params Node may still be sending are ignored here.
        Some(pin) => {
            crate::pairing::ensure_paired(&host, pin, pairing_file, device_name).await?;
        }
        // OLD: Node did the pairing and owns the certs, we merely borrow them
        // for this call. Parsing lives inside this arm so that self-paired mode
        // does not fail on the missing params.
        None => {
            // Certs arrive as raw PEM TEXT here. (Init doesn't need this step:
            // serde decodes those fields straight into pem::Pem, see
            // common/src/ipc.rs.)
            let parse_pem = |name: &str, text: String| -> Result<pem::Pem, String> {
                pem::parse(text.as_bytes())
                    .map_err(|err| format!("GetAppList: bad '{name}' PEM: {err}"))
            };

            let client_private_key = parse_pem("client_private_key", field("client_private_key")?)?;
            let client_certificate = parse_pem("client_certificate", field("client_certificate")?)?;
            let server_certificate = parse_pem("server_certificate", field("server_certificate")?)?;

            host.set_identity(
                ClientIdentifier::from_pem(client_certificate),
                ClientSecret::from_pem(client_private_key),
                ServerIdentifier::from_pem(server_certificate),
            )
            .await
            .map_err(|err| format!("failed to set pairing info: {err:?}"))?;
        }
    }

    let apps = host
        .app_list()
        .await
        .map_err(|err| format!("failed to fetch app list: {err:?}"))?;

    // Shape matches what Node's own moonlight.listApps() returns, so callers
    // can't tell which path produced the list.
    let out: Vec<serde_json::Value> = apps
        .iter()
        .map(|app| {
            serde_json::json!({
                "app_id": app.id,
                "title": app.title,
                "is_hdr_supported": app.is_hdr_supported,
            })
        })
        .collect();

    info!(parent: span, "[ws] GetAppList -> {} apps", out.len());
    Ok(serde_json::Value::Array(out))
}
