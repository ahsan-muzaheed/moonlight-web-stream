"use strict";

const crypto = require("crypto");

// Exact parity with Rust src/app/password.rs:
//   PBKDF2-HMAC-SHA256, 600_000 iterations, 16-byte salt, 32-byte hash.
// Hashes produced by the Rust server verify here and vice versa.
const HASH_ITERATIONS = 600000;
const SALT_LEN = 16;
const HASH_LEN = 32;
const DIGEST = "sha256";

function hash(salt, iterations, password) {
  if (!password) throw new Error("PasswordEmpty");
  return crypto.pbkdf2Sync(password, salt, iterations, HASH_LEN, DIGEST);
}

/** Create a new stored password record. */
function newPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const digest = hash(salt, HASH_ITERATIONS, password);

  return {
    salt: salt.toString("base64"),
    hash: digest.toString("base64"),
    iterations: HASH_ITERATIONS,
  };
}

/** Constant-time verification against a stored record. */
function verifyPassword(stored, password) {
  if (!password || !stored) return false;

  const salt = Buffer.from(stored.salt, "base64");
  const expected = Buffer.from(stored.hash, "base64");
  const actual = hash(salt, stored.iterations, password);

  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function needsRehash(stored) {
  return stored.iterations < HASH_ITERATIONS;
}

module.exports = { newPassword, verifyPassword, needsRehash, HASH_ITERATIONS };
