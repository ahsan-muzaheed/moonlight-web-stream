// streamer/src/transport_config.rs
//
// NEW ARCHITECTURE (additive). Lets streamer.exe run standalone and dial OUT to
// the Node server over a WebSocket, instead of being spawned by Node and talking
// over stdin/stdout. Which mode is used is chosen by a config FILE, so the old
// behaviour stays the default and this new path is opt-in.
//
// Config file: looked up (in order) at
//   1. the path in env var  STREAMER_CONFIG
//   2. ./streamer.toml  next to the executable / working dir
// If no file is found, we default to Stdio mode == exactly the old behaviour.
//
// Example streamer.toml for the NEW websocket mode:
//   transport   = "websocket"
//   server_url  = "ws://your-node-host:8080/api/streamer/connect"
//   streamer_id = "streamer-1"
//   auth_token  = "secret123"
//
// Example for the OLD mode (or just omit the file entirely):
//   transport = "stdio"

use std::{env, fs, path::PathBuf};

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportMode {
    /// Old behaviour: read stdin / write stdout. Node spawns us.
    Stdio,
    /// New behaviour: dial OUT to the Node server over a WebSocket.
    Websocket,
}

impl Default for TransportMode {
    fn default() -> Self {
        TransportMode::Stdio
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TransportConfig {
    #[serde(default)]
    pub transport: TransportMode,

    /// Required when transport = "websocket".
    #[serde(default)]
    pub server_url: Option<String>,

    /// Identifies this streamer to the Node registry. Defaults to "streamer".
    #[serde(default = "default_streamer_id")]
    pub streamer_id: String,

    /// Shared secret sent in the register handshake. Optional in dev.
    #[serde(default)]
    pub auth_token: Option<String>,
}

fn default_streamer_id() -> String {
    "streamer".to_string()
}

impl Default for TransportConfig {
    fn default() -> Self {
        TransportConfig {
            transport: TransportMode::Stdio,
            server_url: None,
            streamer_id: default_streamer_id(),
            auth_token: None,
        }
    }
}

impl TransportConfig {
    /// Load from STREAMER_CONFIG env var, else ./streamer.toml, else default (Stdio).
    /// Never panics: a missing or malformed file falls back to the old behaviour,
    /// logging a warning, so we can't accidentally brick the streamer.
    pub fn load() -> Self {
        let candidates = Self::candidate_paths();

        for path in candidates {
            if !path.exists() {
                continue;
            }
            match fs::read_to_string(&path) {
                Ok(text) => match toml::from_str::<TransportConfig>(&text) {
                    Ok(cfg) => {
                        eprintln!(
                            "[transport] loaded {} -> mode={:?}",
                            path.display(),
                            cfg.transport
                        );
                        return cfg;
                    }
                    Err(err) => {
                        eprintln!(
                            "[transport] failed to parse {}: {err} - falling back to stdio",
                            path.display()
                        );
                        return TransportConfig::default();
                    }
                },
                Err(err) => {
                    eprintln!(
                        "[transport] failed to read {}: {err} - falling back to stdio",
                        path.display()
                    );
                    return TransportConfig::default();
                }
            }
        }

        eprintln!("[transport] no config file found - using stdio (old behaviour)");
        TransportConfig::default()
    }

    fn candidate_paths() -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Ok(p) = env::var("STREAMER_CONFIG") {
            out.push(PathBuf::from(p));
        }
        // next to the current working dir
        out.push(PathBuf::from("streamer.toml"));
        // next to the executable
        if let Ok(exe) = env::current_exe() {
            if let Some(dir) = exe.parent() {
                out.push(dir.join("streamer.toml"));
            }
        }
        out
    }
}
