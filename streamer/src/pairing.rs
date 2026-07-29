// streamer/src/pairing.rs
//
// Self-pairing. On first run the streamer generates its own client identity,
// runs the 5-phase GameStream handshake against Sunshine using a fixed PIN
// from config, and caches the resulting 3 PEMs on disk. Every run after that
// it just loads the cache. Node is not involved either way.

use std::{fs, path::Path, time::Duration};

use moonlight_common::{
    crypto::openssl::OpenSSLCryptoBackend,
    high::{MoonlightClientError, tokio::MoonlightHost},
    http::{
        ClientIdentifier, ClientSecret, ServerIdentifier,
        client::{
            RequestError,
            tokio_hyper::{HyperError, TokioHyperClient},
        },
        pair::{PairPin, PairingCryptoBackend},
    },
};
use serde::{Deserialize, Serialize};
use tokio::time::sleep;
use tracing::{info, warn};

/// How many times to retry reaching Sunshine on the cached-identity fast
/// path before giving up on this stream attempt. Covers the case where the
/// streamer and Sunshine both launch around boot and Sunshine just isn't
/// listening yet.
const SUNSHINE_RETRY_ATTEMPTS: u32 = 10;
const SUNSHINE_RETRY_INTERVAL_SECS: u64 = 2;

/// True if `err` means Sunshine simply isn't reachable (connection refused /
/// timed out) as opposed to a real pairing/cert/protocol problem worth
/// surfacing immediately instead of retrying.
fn is_offline(err: &MoonlightClientError) -> bool {
    match err {
        MoonlightClientError::Backend(inner) => inner
            .downcast_ref::<HyperError>()
            .map(|e| e.is_connect())
            .unwrap_or(false),
        _ => false,
    }
}

#[derive(Serialize, Deserialize)]
struct StoredIdentity {
    client_certificate: String,
    client_private_key: String,
    server_certificate: String,
}

/// "1234" -> PairPin. Must be exactly 4 digits (Sunshine enforces this too).
fn parse_pin(pin: &str) -> Option<PairPin> {
    let d: Vec<u8> = pin.chars().filter_map(|c| c.to_digit(10).map(|v| v as u8)).collect();
    if d.len() != 4 || pin.len() != 4 {
        return None;
    }
    PairPin::new(d[0], d[1], d[2], d[3])
}

fn load(path: &str) -> Option<(ClientIdentifier, ClientSecret, ServerIdentifier)> {
    if !Path::new(path).exists() {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    let stored: StoredIdentity = serde_json::from_str(&text).ok()?;

    let client_cert = pem::parse(stored.client_certificate.as_bytes()).ok()?;
    let client_key = pem::parse(stored.client_private_key.as_bytes()).ok()?;
    let server_cert = pem::parse(stored.server_certificate.as_bytes()).ok()?;

    Some((
        ClientIdentifier::from_pem(client_cert),
        ClientSecret::from_pem(client_key),
        ServerIdentifier::from_pem(server_cert),
    ))
}

fn save(
    path: &str,
    ident: &ClientIdentifier,
    secret: &ClientSecret,
    server: &ServerIdentifier,
) -> Result<(), String> {
    let stored = StoredIdentity {
        client_certificate: pem::encode(&ident.to_pem()),
        client_private_key: pem::encode(&secret.to_pem()),
        server_certificate: pem::encode(&server.to_pem()),
    };
    let text = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
	
	if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
	
	
    fs::write(path, text).map_err(|e| e.to_string())
}

/// Load cached certs if present, otherwise pair once and cache them.
/// Either way the host ends up authenticated.
pub async fn ensure_paired(
    host: &MoonlightHost<TokioHyperClient>,
    pin: &str,
    pairing_file: &str,
    device_name: &str,
) -> Result<(), String> {
    // -- Fast path: we've paired before.
    if let Some((ident, secret, server)) = load(pairing_file) {
        info!("[pairing] status=PAIRED source=cache file='{pairing_file}' - applying cached identity");

        let target = host.address().to_string();
        let mut attempt: u32 = 1;

        loop {
            match host
                .set_identity(ident.clone(), secret.clone(), server.clone())
                .await
            {
                Ok(()) => {
                    info!("[pairing] status=READY - cached identity applied, host authenticated");
                    return Ok(());
                }
                Err(err) if is_offline(&err) && attempt < SUNSHINE_RETRY_ATTEMPTS => {
                    warn!(
                        "[pairing] status=RETRYING attempt={attempt}/{SUNSHINE_RETRY_ATTEMPTS} \
                         target={target} - Sunshine is not reachable yet, retrying in \
                         {SUNSHINE_RETRY_INTERVAL_SECS}s..."
                    );
                    sleep(Duration::from_secs(SUNSHINE_RETRY_INTERVAL_SECS)).await;
                    attempt += 1;
                }
                Err(err) if is_offline(&err) => {
                    let waited = SUNSHINE_RETRY_ATTEMPTS as u64 * SUNSHINE_RETRY_INTERVAL_SECS;
                    let msg = format!(
                        "Sunshine is not running on this host ({target}) - gave up after \
                         {waited}s"
                    );
                    warn!("[pairing] status=ERROR - {msg}");
                    return Err(msg);
                }
                Err(err) => {
                    let msg = format!("failed to apply cached identity: {err:?}");
                    warn!("[pairing] status=ERROR - {msg}");
                    return Err(msg);
                }
            }
        }
    }

    // -- First run: generate an identity and pair.
    // The crate's pair() call below is a single opaque async call covering
    // all 5 GameStream handshake phases internally - it does not expose
    // per-phase hooks, so this is the finest-grained trail we can log
    // without forking moonlight-common-rust. What we CAN show clearly:
    // which step we're on, what target/PIN/name are in play, and exactly
    // where in the sequence a failure happened.
    let target = host.address().to_string();
    info!(
        "[pairing] status=NOT_PAIRED target={target} device_name='{device_name}' pin={} file='{pairing_file}' - starting pairing",
        "*".repeat(pin.len())
    );

    let pin = parse_pin(pin).ok_or_else(|| {
        let msg = "pairing_pin must be exactly 4 digits".to_string();
        warn!("[pairing] status=ERROR step=validate_pin - {msg}");
        msg
    })?;

    info!("[pairing] step=1/3 generating local client identity (cert + key)...");
    let crypto = OpenSSLCryptoBackend;
    let (ident, secret) = crypto.generate_client_identity().map_err(|e| {
        let msg = format!("failed to generate client identity: {e:?}");
        warn!("[pairing] status=ERROR step=1/3 - {msg}");
        msg
    })?;
    info!("[pairing] step=1/3 done");

    info!(
        "[pairing] step=2/3 running GameStream handshake against {target} (this blocks until Sunshine accepts or rejects the PIN)..."
    );
    host.pair(&ident, &secret, device_name.to_string(), pin, crypto)
        .await
        .map_err(|e| {
            let msg = format!("pairing failed: {e:?}");
            warn!(
                "[pairing] status=ERROR step=2/3 - {msg}. Most likely cause: pairing_pin in \
                 streamer.toml does not match auto_pair_pin in sunshine.conf on {target}, or \
                 Sunshine is unreachable."
            );
            msg
        })?;
    info!("[pairing] step=2/3 done - handshake accepted");

    // pair() stores the identity itself on success; read it back out to cache.
    let (ident, secret, server) = host.identity().await.ok_or_else(|| {
        let msg = "paired but no identity present".to_string();
        warn!("[pairing] status=ERROR step=3/3 - {msg}");
        msg
    })?;

    info!("[pairing] step=3/3 caching credentials to '{pairing_file}'...");
    if let Err(err) = save(pairing_file, &ident, &secret, &server) {
        // Not fatal: we're paired for this run, we'll just re-pair next boot.
        warn!("[pairing] step=3/3 FAILED to cache to '{pairing_file}': {err} - will re-pair on next restart");
    } else {
        info!("[pairing] step=3/3 done - status=PAIRED, streamer is now paired with Sunshine");
    }

    Ok(())
}