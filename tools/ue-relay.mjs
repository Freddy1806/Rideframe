// Relay between RIDEFRAME (browser) and the Unreal view: node tools/ue-relay.mjs -> ws://localhost:8790
// Every text message a client sends goes to all other clients. No dependencies (RFC 6455, text frames only).
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const port = +process.env.UE_PORT || 8790, clients = new Set();
const frame = s => { const p = Buffer.from(s), n = p.length, h = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255])]); return Buffer.concat([h, p]); };
const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(`RIDEFRAME Unreal-Relay, ${clients.size} verbunden\n`); });
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key']; if (!key) return sock.destroy();
  const acc = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  sock.setNoDelay(true); clients.add(sock); let buf = Buffer.alloc(0), parts = [];
  const bye = () => { clients.delete(sock); sock.destroy(); };
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80; let n = buf[1] & 127, o = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); o = 4; } else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); o = 10; }
      const mo = o; if (masked) o += 4; if (buf.length < o + n) return;
      const pl = Buffer.from(buf.subarray(o, o + n)); if (masked) for (let i = 0; i < n; i++) pl[i] ^= buf[mo + (i & 3)];
      buf = buf.subarray(o + n);
      if (op === 8) return bye();
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, pl.length]), pl])); continue; } // ping -> pong (small payloads)
      if (op === 1 || op === 0) { parts.push(pl); if (fin) { const msg = Buffer.concat(parts).toString(); parts = []; const f = frame(msg); for (const c of clients) if (c !== sock && c.writable) c.write(f); } }
    }
  });
  sock.on('error', bye); sock.on('close', bye);
});
server.listen(port, '127.0.0.1', () => console.log(`Unreal-Relay läuft auf ws://localhost:${port}`));
