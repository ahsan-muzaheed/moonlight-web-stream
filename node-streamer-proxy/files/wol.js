"use strict";

const dgram = require("dgram");

// Equivalent of broadcast_magic_packet from moonlight-common.
// Magic packet = 6x 0xFF, then the MAC repeated 16 times.
function buildMagicPacket(mac) {
  const clean = mac.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length !== 12) throw new Error(`invalid MAC address: ${mac}`);

  const macBytes = Buffer.from(clean, "hex");
  const parts = [Buffer.alloc(6, 0xff)];
  for (let i = 0; i < 16; i++) parts.push(macBytes);

  return Buffer.concat(parts);
}

function wake(mac, { address = "255.255.255.255", port = 9 } = {}) {
  return new Promise((resolve, reject) => {
    const packet = buildMagicPacket(mac);
    const socket = dgram.createSocket("udp4");

    socket.once("error", (err) => {
      socket.close();
      reject(err);
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 0, packet.length, port, address, (err) => {
        socket.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

module.exports = { wake, buildMagicPacket };
