"use strict";

const http = require("http");
const https = require("https");
const xml2js = require("xml2js");
const c = require("./crypto");

/**
 * Replaces the HTTP half of the `moonlight-common` Rust crate.
 *
 * !! THE PAIRING LADDER IS UNVERIFIED — test against a real Sunshine host. !!
 * Everything else (serverinfo/applist/appasset/launch) is a straightforward
 * request/response and much lower risk.
 *
 * Sunshine speaks:
 *   - HTTP  on httpPort      (default 47989) — unpaired calls (serverinfo, pair)
 *   - HTTPS on httpPort + 1  (default 47984) — paired calls, client-cert auth
 */

// Sunshine port layout (base 47989):
//   47984 = HTTPS  (base - 5)   <- paired/authenticated GameStream calls
//   47989 = HTTP   (base)       <- serverinfo, pairing
//   47990 = Web UI (base + 1)   <- config page; returns JSON, NOT GameStream
// serverinfo reports the real value in <HttpsPort>; a host may override it.
function httpsPortOf(host) {
  if (typeof host === "number") return host - 5; // legacy: plain port in
  if (host && host.httpsPort) return host.httpsPort;
  return (host.httpPort || 47989) - 5;
}

/** GET returning the raw body. `pairInfo` present => HTTPS + client cert. */
function request(host, path, { pairInfo = null, binary = false, timeout = 10000 } = {}) {
  const useTls = !!pairInfo;
  const port = useTls ? httpsPortOf(host) : host.httpPort;
  const scheme = useTls ? https : http;

  const options = {
    host: host.address,
    port,
    path,
    method: "GET",
    timeout,
    agent: false, // no connection pooling: Sunshine closes sockets between phases
    headers: { Connection: "close" },
  };

  if (useTls) {
    options.cert = pairInfo.clientCertificate;
    options.key = pairInfo.clientPrivateKey;
    // Sunshine uses a self-signed cert; we pin via the client cert instead.
    options.rejectUnauthorized = false;
  }

  return new Promise((resolve, reject) => {
    const req = scheme.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve(binary ? body : body.toString("utf8"));
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(
        new Error(
          `timeout after ${timeout}ms contacting ${host.address}:${port} (path ${path.split("?")[0]})`
        )
      );
    });
    req.on("error", reject);
    req.end();
  });
}

/** Sunshine replies in XML; unwrap to a flat object. */
async function parseXml(xml) {
  const head = String(xml).trimStart();
  if (head.startsWith("{") || head.startsWith("[")) {
    throw new Error(
      `expected XML but got JSON - wrong port? (Sunshine's web UI answers JSON): ${head.slice(0, 120)}`
    );
  }
  const parsed = await xml2js.parseStringPromise(xml, {
    explicitArray: false,
    trim: true,
  });
  return parsed.root || parsed;
}

function query(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

/** Params every GameStream call carries. */
function baseParams(uniqueId) {
  return { uniqueid: uniqueId, uuid: require("crypto").randomUUID() };
}

// ---- Unauthenticated ------------------------------------------------------

/** Host status/name/paired-state. Works before pairing. */
async function serverInfo(host, uniqueId) {
  const pairInfo = host.pairInfo || null;
  const path = `/serverinfo?${query(baseParams(uniqueId))}`;
  const xml = await request(host, path, { pairInfo });
  return parseXml(xml);
}

// ---- Pairing --------------------------------------------------------------

/**
 * The 5-phase GameStream pairing handshake.
 *
 * The user must type `pin` into Sunshine's web UI while this runs.
 * On success, returns the PEM triple the streamer's Init payload needs.
 *
 * !! UNVERIFIED. The hash/ordering below follows moonlight-common-c, but the
 *    exact byte layout is easy to get subtly wrong. Expect to debug this. !!
 */
const PIN_ENTRY_TIMEOUT = 120000; // 2 min for the user to type the PIN into Sunshine

// Wrap a phase so raw socket errors (ECONNRESET / hang up) say WHICH phase died,
// and log the raw XML Sunshine returned for inspection.
async function phase(label, host, path, opts) {
  try {
    const raw = await request(host, path, opts);
    console.log(`[Pair] ${label} raw response:`, raw.slice(0, 400));
    return await parseXml(raw);
  } catch (err) {
    console.warn(`[Pair] ${label} transport error:`, err.message);
    throw new Error(`${label}: ${err.message}`);
  }
}

async function pair(host, uniqueId, pin) {
  const client = c.generateClientCertificate();
  const salt = c.randomSalt();
  const aesKey = c.deriveAesKey(salt, pin);

  // -- Phase 1: send our cert + salt, get the host's cert back.
  const p1 = await phase(
    "phase1-getservercert",
    host,
    `/pair?${query({
      ...baseParams(uniqueId),
      devicename: "roth",
      updateState: 1,
      phrase: "getservercert",
      salt: salt.toString("hex").toUpperCase(),
      clientcert: c.pemToHex(client.certificate),
    })}`,
    // Sunshine holds this request open until the PIN is entered.
    { timeout: PIN_ENTRY_TIMEOUT }
  );

  if (p1.paired !== "1" || !p1.plaincert) {
    throw new Error("pairing phase 1 failed (is the PIN correct?)");
  }
  const serverCertPem = c.hexToPem(p1.plaincert);

  // -- Phase 2: client challenge (16 random bytes, AES-ECB encrypted).
  const clientChallenge = require("crypto").randomBytes(16);
  const p2 = await phase(
    "phase2-clientchallenge",
    host,
    `/pair?${query({
      ...baseParams(uniqueId),
      clientchallenge: c.aesEcbEncrypt(aesKey, clientChallenge).toString("hex").toUpperCase(),
    })}`
  );
  if (p2.paired !== "1") throw new Error("pairing phase 2 failed");

  // Decrypts to: serverResponse(32) || serverChallenge(16)
  const decrypted2 = c.aesEcbDecrypt(aesKey, Buffer.from(p2.challengeresponse, "hex"));
  const serverResponse = decrypted2.subarray(0, 32);
  const serverChallenge = decrypted2.subarray(32, 48);

  // -- Phase 3: answer the host's challenge, prove we hold the private key.
  const clientSecret = require("crypto").randomBytes(16);
  const clientCertSig = c.certSignature(client.certificate);
  const challengeResponseHash = c.sha256(serverChallenge, clientCertSig, clientSecret);

  const p3 = await phase(
    "phase3-serverchallengeresp",
    host,
    `/pair?${query({
      ...baseParams(uniqueId),
      serverchallengeresp: c
        .aesEcbEncrypt(aesKey, challengeResponseHash)
        .toString("hex")
        .toUpperCase(),
    })}`
  );
  if (p3.paired !== "1") throw new Error("pairing phase 3 failed");

  // pairingsecret = serverSecret(16) || serverSignature(256)
  const pairingSecret = Buffer.from(p3.pairingsecret, "hex");
  const serverSecret = pairingSecret.subarray(0, 16);
  const serverSignature = pairingSecret.subarray(16);

  // -- Phase 4 (local): verify the host actually holds its cert's key,
  //    and that its earlier response matches the secret it just revealed.
  if (!c.verifySignature(serverCertPem, serverSecret, serverSignature)) {
    throw new Error("pairing failed: bad server signature (MITM?)");
  }

  const serverCertSig = c.certSignature(serverCertPem);
  const expected = c.sha256(clientChallenge, serverCertSig, serverSecret);
  if (!expected.equals(serverResponse)) {
    throw new Error("pairing failed: server response mismatch (wrong PIN?)");
  }

  // -- Phase 5: hand over our secret, signed.
  const clientPairingSecret = Buffer.concat([
    clientSecret,
    c.signData(client.privateKey, clientSecret),
  ]);

  const p5 = await phase(
    "phase5-clientpairingsecret",
    host,
    `/pair?${query({
      ...baseParams(uniqueId),
      clientpairingsecret: clientPairingSecret.toString("hex").toUpperCase(),
    })}`
  );
  if (p5.paired !== "1") throw new Error("pairing phase 5 failed");

  // -- Phase 6: confirm over TLS with our new client cert.
  const pairInfo = {
    clientCertificate: client.certificate,
    clientPrivateKey: client.privateKey,
    serverCertificate: serverCertPem,
  };

  const p6 = await phase(
    "phase6-pairchallenge-tls",
    host,
    `/pair?${query({ ...baseParams(uniqueId), phrase: "pairchallenge" })}`,
    { pairInfo }
  );
  if (p6.paired !== "1") throw new Error("pairing phase 6 (TLS challenge) failed");

  return pairInfo;
}

/**
 * Tell Sunshine to end the current session and terminate the running app.
 * Sunshine registers ^/cancel$ on the HTTPS (47984) server, so this needs
 * the client cert. Without this call Sunshine deliberately keeps the app
 * alive after a stream drops, so you can reconnect and resume it.
 */
async function cancelApp(host, uniqueId) {
  if (!host.pairInfo) throw new Error("HostNotPaired");

//curl -b cookies.txt -H "Content-Type: application/json" -d "{\"host_id\":1}" http://172.7.191.71:8080/api/host/cancel
//{"success":true}
  const xml = await request(host, `/cancel?${query(baseParams(uniqueId))}`, {
    pairInfo: host.pairInfo,
  });
  const parsed = await parseXml(xml);
  return parsed.cancel === "1" || parsed.$?.status_code === "200";
}

/** Tell the host to forget us. */
async function unpair(host, uniqueId) {
  return request(host, `/unpair?${query(baseParams(uniqueId))}`);
}

// ---- Paired (HTTPS + client cert) ----------------------------------------

async function listApps(host, uniqueId) {
  if (!host.pairInfo) throw new Error("HostNotPaired");

  const xml = await request(host, `/applist?${query(baseParams(uniqueId))}`, {
    pairInfo: host.pairInfo,
  });
  const parsed = await parseXml(xml);

  let apps = parsed.App || [];
  if (!Array.isArray(apps)) apps = [apps];

  return apps.map((app) => ({
    app_id: parseInt(app.ID, 10),
    title: app.AppTitle,
    is_hdr_supported: app.IsHdrSupported === "1",
  }));
}

/** Box art for one app (PNG bytes). */
async function appImage(host, uniqueId, appId) {
  if (!host.pairInfo) throw new Error("HostNotPaired");

  return request(
    host,
    `/appasset?${query({
      ...baseParams(uniqueId),
      appid: appId,
      AssetType: 2, // box art
      AssetIdx: 0,
    })}`,
    { pairInfo: host.pairInfo, binary: true }
  );
}


module.exports = {
  serverInfo,
  pair,
  unpair,
  cancelApp,
  listApps,
  appImage,
  httpsPortOf,
};