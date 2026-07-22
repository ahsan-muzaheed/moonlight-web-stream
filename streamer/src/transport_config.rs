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
//   sunshine_address   = "127.0.0.1"   # optional, this is the default
//   sunshine_http_port = 47989         # optional, this is the default
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

    /// Where Sunshine lives, as seen FROM THIS MACHINE. The streamer and
    /// Sunshine are co-located, so the default localhost value is almost always
    /// right. Having this in config (rather than waiting for Node to push it in
    /// Init) is what lets the streamer answer GetAppList requests at any time -
    /// Node needs the app list BEFORE it can build Init, so the streamer cannot
    /// depend on Init to know where Sunshine is.
    #[serde(default = "default_sunshine_address")]
    pub sunshine_address: String,

    /// Sunshine's GameStream HTTP port. The HTTPS port used for authenticated
    /// requests (like /applist) is derived from it as http_port - 5, which is
    /// the standard Sunshine offset (47989 -> 47984).
    #[serde(default = "default_sunshine_http_port")]
    pub sunshine_http_port: u16,

    /// Base directory for path-based app launching. When the browser URL
    /// supplies owner/appName/version, the streamer builds:
    ///   {app_directory}/{owner}/{appName}/{version}/{appName}.exe
    /// and launches that. If unset, or the params are absent, the streamer
    /// falls back to app-id launching. Example: "z:\\0.apps".
    #[serde(default)]
    pub app_directory: Option<String>,
}

// fn default_streamer_id() -> String {
    // "streamer".to_string()
// }

/// Default streamer id: "<hostname>-<pid>", sanitized.
///
/// The hostname keeps ids human-readable and stable per machine; the PID suffix
/// guarantees two streamers on the SAME machine never collide on one registry
/// key. If two default ids ever matched, the registry's add() would drop one
/// socket in favour of the other — this makes that impossible without anyone
/// having to hand-set streamer_id in streamer.toml.
fn default_streamer_id() -> String {
    let host = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "streamer".to_string());

    let pid = std::process::id();

    let host = sanitize_id_segment(&host);
    let host = if host.is_empty() {
        "streamer".to_string()
    } else {
        host
    };

    format!("{host}-{pid}")
}

/// Whitelist sanitizer: keep ASCII letters/digits/hyphen; turn every other
/// character (space, underscore, dot, slash, backslash, colon, quotes, ...)
/// into a hyphen; collapse runs of hyphens; trim them off both ends.
///
/// Whitelisting rather than blacklisting means any character we didn't think of
/// is still made safe by default. Underscore is the notable one — it's why
/// `connector_ms6` caused trouble as a host label — and it becomes a hyphen here.
fn sanitize_id_segment(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_hyphen = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_hyphen = false;
        } else if !prev_hyphen {
            out.push('-');
            prev_hyphen = true;
        }
    }
    out.trim_matches('-').to_string()
}


fn default_sunshine_address() -> String {
    "127.0.0.1".to_string()
}

fn default_sunshine_http_port() -> u16 {
    47989
}

impl Default for TransportConfig {
    fn default() -> Self {
        TransportConfig {
            transport: TransportMode::Stdio,
            server_url: None,
            streamer_id: default_streamer_id(),
            auth_token: None,
            sunshine_address: default_sunshine_address(),
            sunshine_http_port: default_sunshine_http_port(),
            app_directory: None,
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
