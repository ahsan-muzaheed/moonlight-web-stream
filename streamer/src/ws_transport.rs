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
    info!("[ws] connected, registering as '{}'", cfg.streamer_id);

    let (mut ws_write, mut ws_read) = ws_stream.split();

    // ---- Register handshake -------------------------------------------------
    let register = serde_json::json!({
        "type": "register",
        "id": cfg.streamer_id,
        "token": cfg.auth_token,
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

    // Task A: WS text frames from Node -> write JSON + '\n' into ipc_read_half.
    let span_a = span.clone();
    tokio::spawn(async move {
        while let Some(item) = ws_read.next().await {
            match item {
                Ok(Message::Text(text)) => {
                    // Skip control frames (heartbeat) - only IPC JSON goes to the pipe.
                    if is_control_frame(&text) {
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
        let mut lines = BufReader::new(&mut bridge_read).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.is_empty() {
                        continue;
                    }
                    if ws_write.send(Message::Text(line)).await.is_err() {
                        warn!(parent: &span_b, "[ws] failed to send to Node");
                        break;
                    }
                }
                Ok(None) => break,
                Err(err) => {
                    warn!(parent: &span_b, "[ws] pipe read error: {err}");
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
/// (register/registered/ping/pong/error). Real IPC messages are the streamer's
/// externally-tagged enum JSON and never have a top-level "type".
fn is_control_frame(text: &str) -> bool {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(v) => v.get("type").and_then(|t| t.as_str()).is_some(),
        Err(_) => false,
    }
}
