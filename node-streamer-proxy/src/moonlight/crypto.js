"use strict";

const crypto = require("crypto");
const forge = require("node-forge");

/**
 * Replaces the crypto half of the `moonlight-common` Rust crate.
 *
 * !! UNVERIFIED AGAINST A REAL SUNSHINE HOST !!
 * This implements the NVIDIA GameStream pairing crypto from the protocol as
 * documented by moonlight-common-c. It is the one module here that is a
 * reimplementation rather than a translation. Test it before trusting it.
 */

/**
 * Generate the self-signed client identity Sunshine pins against.
 * moonlight-common-c uses RSA-2048 + SHA-256, valid ~20 years.
 * Returns PEM strings, which is exactly what the streamer's Init wants.
 */
function generateClientCertificate() {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 20);

  const attrs = [{ name: "commonName", value: "NVIDIA GameStream Client" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs); // self-signed

  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Rust's rustls/awc backend only accepts PKCS#8 (BEGIN PRIVATE KEY).
  // node-forge emits PKCS#1 (BEGIN RSA PRIVATE KEY), so convert.
  const pkcs1 = forge.pki.privateKeyToPem(keys.privateKey);

  return {
    certificate: forge.pki.certificateToPem(cert),
    privateKey: toPkcs8(pkcs1),
  };
}

/**
 * Normalize any RSA private key PEM to PKCS#8 (BEGIN PRIVATE KEY), and to LF
 * line endings. Accepts PKCS#1 or PKCS#8 in; always returns PKCS#8.
 * Used both at generation time and when reading keys that were stored earlier.
 */
function toPkcs8(pem) {
  const key = crypto.createPrivateKey(pem);
  return key.export({ type: "pkcs8", format: "pem" }).replace(/\r\n/g, "\n");
}

/** A 4-digit PIN, as shown to the user and typed into Sunshine. */
function randomPin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, "0");
}

/** 16 random bytes; sent to the host as the pairing salt. */
function randomSalt() {
  return crypto.randomBytes(16);
}

/**
 * AES key = SHA-256(salt || pin), truncated to 16 bytes.
 * (Gen-7+ / Sunshine. Older GameStream used SHA-1 — not implemented.)
 */
function deriveAesKey(salt, pin) {
  const digest = crypto.createHash("sha256")
    .update(Buffer.concat([salt, Buffer.from(pin, "utf8")]))
    .digest();
  return digest.subarray(0, 16);
}

// GameStream uses raw AES-128-ECB, no padding: data must be a 16-byte multiple.
function aesEcbEncrypt(key, data) {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(pad16(data)), cipher.final()]);
}

function aesEcbDecrypt(key, data) {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Zero-pad up to a 16-byte boundary. */
function pad16(buf) {
  const rem = buf.length % 16;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(16 - rem)]);
}

function sha256(...buffers) {
  const h = crypto.createHash("sha256");
  for (const b of buffers) h.update(b);
  return h.digest();
}

/** Sign with the client private key (RSA + SHA-256), as the pairing ladder requires. */
function signData(privateKeyPem, data) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(data);
  return signer.sign(privateKeyPem);
}

/** Verify the host's signature over its pairing secret, using the server cert. */
function verifySignature(certPem, data, signature) {
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(data);
    return verifier.verify(certPem, signature);
  } catch (err) {
    console.warn("[Pair] signature verification threw:", err.message);
    return false;
  }
}

/** Raw signature bytes out of a PEM cert — mixed into the challenge hashes. */
function certSignature(certPem) {
  const cert = forge.pki.certificateFromPem(certPem);
  return Buffer.from(cert.signature, "binary");
}

/** Sunshine passes certs around as hex-encoded PEM. */
function pemToHex(pem) {
  return Buffer.from(pem, "utf8").toString("hex").toUpperCase();
}

function hexToPem(hex) {
  return Buffer.from(hex, "hex").toString("utf8");
}

module.exports = {
  generateClientCertificate,
  toPkcs8,
  randomPin,
  randomSalt,
  deriveAesKey,
  aesEcbEncrypt,
  aesEcbDecrypt,
  sha256,
  signData,
  verifySignature,
  certSignature,
  pemToHex,
  hexToPem,
};