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
  unpair,
  cancelApp,
  listApps,
  appImage,
  httpsPortOf,
};