// streamer/src/pairing.rs
//
// Self-pairing. On first run the streamer generates its own client identity,
// runs the 5-phase GameStream handshake against Sunshine using a fixed PIN
// from config, and caches the resulting 3 PEMs on disk. Every run after that
// it just loads the cache. Node is not involved either way.

use std::{fs, path::Path};

use moonlight_common::{
    crypto::openssl::OpenSSLCryptoBackend,
    high::tokio::MoonlightHost,
    http::{
        ClientIdentifier, ClientSecret, ServerIdentifier,
        client::tokio_hyper::TokioHyperClient,
        pair::{PairPin, PairingCryptoBackend},
    },
};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

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
        info!("[pairing] loaded cached identity from {pairing_file}");
        return host
            .set_identity(ident, secret, server)
            .await
            .map_err(|e| format!("failed to apply cached identity: {e:?}"));
    }

    // -- First run: generate an identity and pair.
    info!("[pairing] no cached identity, pairing with Sunshine as '{device_name}'");

    let pin = parse_pin(pin).ok_or_else(|| "pairing_pin must be exactly 4 digits".to_string())?;

    let crypto = OpenSSLCryptoBackend;
    let (ident, secret) = crypto
        .generate_client_identity()
        .map_err(|e| format!("failed to generate client identity: {e:?}"))?;

    host.pair(&ident, &secret, device_name.to_string(), pin, crypto)
        .await
        .map_err(|e| format!("pairing failed: {e:?}"))?;

    // pair() stores the identity itself on success; read it back out to cache.
    let (ident, secret, server) = host
        .identity()
        .await
        .ok_or_else(|| "paired but no identity present".to_string())?;

    if let Err(err) = save(pairing_file, &ident, &secret, &server) {
        // Not fatal: we're paired for this run, we'll just re-pair next boot.
        warn!("[pairing] paired but failed to cache to {pairing_file}: {err}");
    } else {
        info!("[pairing] paired and cached to {pairing_file}");
    }

    Ok(())
}