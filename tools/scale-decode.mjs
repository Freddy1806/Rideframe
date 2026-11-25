// eufy smart scales over Bluetooth LE (25.11.): the frames the scale bridge (tools/scale-bridge/, Swift on the Mac mini) forwards
// raw, decoded here on the server, so a wrong offset is fixed without rebuilding the bridge. Pure: no I/O, time is passed in.
//
// Sources (details and the frames used as test vectors in tools/scale-bridge/README.md and tools/scale-test.mjs):
//  [L] bdr99/eufylife-ble-client (MIT, the library behind Home Assistant's "eufylife_ble"), client.py / auth_handler.py, commit 8916e44
//  [B] KristianP26/ble-scale-sync (GPL-3.0): src/scales/eufy-p2.ts, eufy-c20-p3.ts and their tests with real captured frames, commit b3daf97
//  [O] oliexdev/openScale: EufyP2Lib.kt, EufyC20Handler.kt, EufyP2LibTest.kt, commit 2f5eeb7
//  No code is copied; offsets were checked against the captured frames, never the other way round.
//
// Transport facts (macOS CoreBluetooth): kCBAdvDataManufacturerData holds the 2-byte company id (little-endian) FIRST, then the
// payload that Android / BlueZ / bleak hand out without it. So `mfr` below is the raw value: [idLo, idHi, ...payload].
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const MODELS = {
  T9120: { name: 'Smart Scale A1', link: 'connect' },
  T9130: { name: 'Smart Scale C20', link: 'broadcast' },
  T9140: { name: 'Smart Scale', link: 'connect' },
  T9146: { name: 'Smart Scale C1', link: 'broadcast' },
  T9147: { name: 'Smart Scale P1', link: 'broadcast' },
  T9148: { name: 'Smart Scale P2', link: 'broadcast', bia: true }, // weight in the advertisement; impedance only over an authenticated connection
  T9149: { name: 'Smart Scale P2 Pro', link: 'broadcast', bia: true },
  T9150: { name: 'Smart Scale P3', link: 'broadcast' },
};
export const P2_COMPANY = 0xff48;
const KG_LO = 2, KG_HI = 250;

export const hexOf = b => Buffer.from(b).toString('hex');
export const bytes = h => Buffer.from(String(h || '').replace(/[^0-9a-f]/gi, ''), 'hex');
const xor = (b, from = 0, to = b.length) => { let x = 0; for (let i = from; i < to; i++) x ^= b[i]; return x; };
const macStr = b => [...b].map(x => x.toString(16).padStart(2, '0')).join(':').toUpperCase();
/** a GATT uuid as CoreBluetooth prints it ("FFF1") or in full ("0000fff1-0000-1000-8000-00805f9b34fb") -> "FFF1" / full upper-case */
export const shortUuid = u => { const s = String(u || '').toUpperCase(); const m = s.match(/^0000([0-9A-F]{4})-0000-1000-8000-00805F9B34FB$/); return m ? m[1] : s; };

/** which model is this advertiser? name = local name (scan response), mfr = raw manufacturer data. Returns 'T9148' … or null */
export function identify(name, mfr) {
  const m = String(name || '').match(/eufy\s*(T91\d\d)/i); // "eufy T9148", also "eufy T9146 C1" (Home Assistant core#193433)
  if (m && MODELS[m[1].toUpperCase()]) return m[1].toUpperCase();
  const b = bytes(mfr);
  if (b.length >= 21 && (b[0] | b[1] << 8) === P2_COMPANY && b[2 + 6] === 0xcf) return 'T9148'; // P2 or P2 Pro: the same frames [B][O]
  return null;
}
/** the scale's MAC address when the advertisement carries it (P2 family: payload [0..5]; C20/P3: company-id high byte + payload [0..4], [B]) */
export function macOf(model, mfr) {
  const b = bytes(mfr); if (b.length < 8) return null;
  if ((model === 'T9148' || model === 'T9149') && (b[0] | b[1] << 8) === P2_COMPANY && b.length >= 21) return macStr(b.subarray(2, 8));
  if ((model === 'T9130' || model === 'T9150') && b.length >= 20 && b[2 + 5] === 0) return macStr(b.subarray(1, 7));
  return null;
}

/* ---- one advertisement -> one frame: { kg, final, hr?, status?, end?, quiet? } or null (not a weight frame) ---- */
export function decodeAdv(model, mfr) {
  const b = bytes(mfr); if (b.length < 4) return null;
  const p = b.subarray(2); // payload after the company id
  if (model === 'T9148' || model === 'T9149') {
    // [L] _handle_advertisement_weight_update_t9148_t9149 on data[6:]; [B] eufy-p2.ts: [0..5] MAC, [6] 0xCF, [7] heart rate
    // (valid when [8] >> 6 == 0b11), [9..10] weight LE / 100, [15] 0x00 = final. Verified with the P2 Pro capture of eufylife-ble-client#8.
    // [18] is the XOR of [6..17]: true for both captured frames (own finding, not in the sources), so a broken frame is dropped.
    if ((b[0] | b[1] << 8) !== P2_COMPANY || p.length !== 19 || p[6] !== 0xcf || xor(p, 6, 18) !== p[18]) return null;
    const kg = (p[9] | p[10] << 8) / 100, f = { kg, final: p[15] === 0x00 };
    if (p[8] >> 6 === 0b11 && p[7] > 0) f.hr = p[7];
    return f;
  }
  if (model === 'T9130' || model === 'T9150') {
    // [B] eufy-c20-p3.ts, checked against Home Assistant logs in eufylife-ble-client#3 and #5: [5] 0x00, [6..9] scale clock,
    // [10] status (0x00/0x0D idle, 0x01 live, 0x05 0x15 0x25 0x65 0xA5 locked weight while it measures), [11] 0x80 = last frame of
    // the weigh-in, 0x40 = switching off, [12..13] weight LE / 100, [15] heart rate from status 0xA5 on.
    // [17..18] / 10 looks like an impedance but was never compared with the app: NOT used.
    if (p.length < 18 || p[5] !== 0x00) return null;
    const st = p[10], kg = (p[12] | p[13] << 8) / 100;
    if (st === 0x00 || st === 0x0d) return { kg: 0, final: false, quiet: true, status: st };
    if (st === 0x01) return { kg, final: false, status: st };
    if (![0x05, 0x15, 0x25, 0x65, 0xa5].includes(st)) return null;
    const f = { kg, final: true, status: st, end: (p[11] & 0x80) !== 0 };
    if (st === 0xa5 && p[15] > 0) f.hr = p[15];
    return f;
  }
  if (model === 'T9146' || model === 'T9147') {
    // [L] only (no capture found): 18 bytes, [4] 0xCF, [4..14] an 11-byte frame whose last byte is the XOR of the others;
    // in it [3..4] weight LE / 100, [9] 0x00 final, 0x02 over the limit. GUESS until a real frame is seen.
    if (p.length !== 18 || p[4] !== 0xcf) return null;
    return frame11(p.subarray(4, 15));
  }
  return null;
}
function frame11(d) { // the 11-byte CF frame of A1 / C1 / P1 ([L] _handle_weight_update_t9146_t9147 / _t9120)
  if (d.length !== 11 || d[0] !== 0xcf || xor(d, 0, 10) !== d[10]) return null;
  if (d[9] === 0x02) return { kg: 0, final: false, over: true };
  return { kg: (d[3] | d[4] << 8) / 100, final: d[9] === 0x00 };
}

/* ---- one GATT notification -> frame or null ---- */
export function decodeNotify(model, char, hex) {
  const d = bytes(hex), c = shortUuid(char);
  if (model === 'T9148' || model === 'T9149') {
    // FFF2, 16 bytes: [0] 0xCF, [1] 0x0E, [2] 0x00, [3] 0xCF, [4..5] impedance LE / 10 (0 without skin contact), [6..7] weight LE / 100,
    // [12] 0x00 = final, [15] XOR of [2..14]. [B] eufy-p2.ts, verified there against real P2 Pro frames with the app's figures (#289);
    // [L] and [O] read the impedance from [8..10] instead; [B]'s comparison of two people rules that out, so [4..5] it is.
    if (c !== 'FFF2' || d.length !== 16 || d[0] !== 0xcf || d[2] !== 0x00) return null;
    const kg = (d[6] | d[7] << 8) / 100, imp = (d[4] | d[5] << 8) / 10, f = { kg, final: d[12] === 0x00 };
    if (imp >= 200 && imp <= 1000) f.impedance = imp; // the band [B] accepts
    return f;
  }
  if (model === 'T9146' || model === 'T9147' || model === 'T9120') return d.length === 11 ? frame11(d) : null; // [L]; T9120 without checksum check there, here with
  if (model === 'T9140') {
    // [L] _notification_handler for T9140: "AC 02 …" packets, two 7/8-byte halves per 16/17-byte packet; weight BIG-endian [2..3] / 10,
    // [6] 0xCA final, 0xCE live. GUESS (no capture found).
    if (d.length < 7 || d[0] !== 0xac || d[1] !== 0x02) return null;
    const parts = d.length === 16 ? [d.subarray(0, 8), d.subarray(8, 15)] : d.length === 17 ? [d.subarray(0, 9), d.subarray(9, 16)] : [d];
    for (const x of parts) if (x.length >= 7 && (x[6] === 0xca || x[6] === 0xce)) return { kg: (x[2] << 8 | x[3]) / 10, final: x[6] === 0xca };
    return null;
  }
  return null;
}

/* ---- a weigh-in: frames -> exactly one final measurement ----
 * The scale says "final" more than once: P2 repeats the final advertisement for ~30 s (and may still settle, [B] #284: keep the
 * last), C20/P3 keep the locked weight through 0x05…0xA5 while measuring impedance / heart rate and end with [11] 0x80.
 * Emitted when the weigh-in ends: an end flag, the scale going idle, a new live weight, or SETTLE ms without a changed final frame.
 * The same weight again within REPEAT ms after an emission is the same weigh-in still on the air. */
export const SETTLE = 4000, REPEAT = 60e3;
export const session = () => ({ fin: null, lastChange: 0, sent: null });
/** feeds one frame; returns { s, out } where out is a measurement { kg, hr?, impedance?, t } or null */
export function feed(s, f, now) {
  if (!f) return { s, out: null };
  if (f.quiet || (!f.final && f.kg > 0 && s.fin && Math.abs(f.kg - s.fin.kg) > 0.5)) { const r = flush(s, now, true); return { s: r.s, out: r.out }; } // idle, or someone new stepped on
  if (!f.final) return { s, out: null };
  if (!(f.kg >= KG_LO && f.kg <= KG_HI)) return { s, out: null };
  if (s.sent && Math.abs(s.sent.kg - f.kg) < 0.001 && now - s.sent.at < REPEAT && !s.fin) return { s, out: null }; // still on the air
  const fin = s.fin || { kg: f.kg, t: now }, changed = !s.fin || fin.kg !== f.kg || (f.hr && f.hr !== fin.hr) || (f.impedance && f.impedance !== fin.impedance);
  const next = { ...s, fin: { ...fin, kg: f.kg, hr: f.hr || fin.hr, impedance: f.impedance || fin.impedance }, lastChange: changed ? now : s.lastChange };
  if (f.end) return flush(next, now, true);
  return { s: next, out: null };
}
/** call regularly (and on idle): emits the pending weigh-in once it settled; force = now */
export function flush(s, now, force = false) {
  if (!s.fin || (!force && now - s.lastChange < SETTLE)) return { s, out: null };
  const out = { kg: s.fin.kg, t: s.fin.t }; if (s.fin.hr) out.hr = s.fin.hr; if (s.fin.impedance) out.impedance = s.fin.impedance;
  return { s: { fin: null, lastChange: 0, sent: { kg: out.kg, at: now } }, out };
}

/* ---- P2 / P2 Pro authentication (only for impedance; the weight needs none) ----
 * [L] auth_handler.py, [B] eufy-p2.ts, [O] EufyP2Lib.kt agree: key = MD5(MAC without ':' upper-case ASCII), AES-128-CBC with IV =
 * sixteen ASCII '0' (0x30), PKCS#7. C0 (client -> FFF1) = hex(base64(AES(15-char client id))) in segments of 15 base64 characters:
 * [prefix, segments, index, base64 length, ...data, XOR]; the scale answers C1 on FFF4 (its device id, same framing), the client sends
 * C2 = AES("<client>_<device>"), C3 01 00 01 <status> <XOR>: status 0 = authenticated. ~1 s between writes ([L], [B]: faster drops). */
const IV = Buffer.from('0000000000000000', 'ascii');
export const keyOf = mac => { const c = String(mac || '').replace(/[:-]/g, '').toUpperCase(); if (!/^[0-9A-F]{12}$/.test(c)) throw new Error('bad MAC'); return createHash('md5').update(c, 'utf8').digest(); };
const enc = (txt, key) => { const c = createCipheriv('aes-128-cbc', key, IV); return Buffer.concat([c.update(txt, 'utf8'), c.final()]); };
const dec = (buf, key) => { const d = createDecipheriv('aes-128-cbc', key, IV); return Buffer.concat([d.update(buf), d.final()]).toString('utf8'); };
/** splits hex-of-base64 into the scale's segment frames */
export function segments(dataHex, prefix) {
  const n = Math.max(1, Math.ceil(dataHex.length / 30)), out = [];
  for (let i = 0; i < n; i++) { const body = Buffer.concat([Buffer.from([prefix, n, i, dataHex.length / 2]), Buffer.from(dataHex.slice(i * 30, (i + 1) * 30), 'hex')]);
    out.push(Buffer.concat([body, Buffer.from([xor(body)])])); }
  return out;
}
const encHex = (txt, key) => Buffer.from(enc(txt, key).toString('base64'), 'ascii').toString('hex');
/** one handshake; client = 15-character id (random when left out). Methods return frames (Buffers) to write, or null */
export function p2Auth(mac, client = randomBytes(8).toString('hex').slice(0, 15)) {
  const key = keyOf(mac); let buf = Buffer.alloc(0), next = 0, total = 0;
  const a = { key, client, device: null, ok: null,
    c0: () => segments(encHex(client, key), 0xc0),
    /** feed an FFF4 notification; returns C2 frames once C1 is complete, true/false after C3, else null */
    onAuth(frame) {
      const f = Buffer.from(frame); if (f.length < 5) return null;
      if (f[0] === 0xc3) { a.ok = f[4] === 0; return a.ok; }
      if (f[0] !== 0xc1 || xor(f, 0, f.length - 1) !== f[f.length - 1]) return null;
      if (f[2] === 0) { buf = Buffer.alloc(0); next = 0; total = f[3]; }
      if (f[2] !== next) return null;
      buf = Buffer.concat([buf, f.subarray(4, f.length - 1)]); next++;
      if (f[2] !== f[1] - 1) return null;
      if (buf.length !== total) return null;
      a.device = dec(Buffer.from(buf.toString('ascii'), 'base64'), key);
      return segments(encHex(`${client}_${a.device}`, key), 0xc2);
    } };
  return a;
}
/** the scale's side of the handshake, for tests and the --replay self-check: answers a client id with C1 frames for device */
export const scaleC1 = (mac, device) => segments(encHex(device, keyOf(mac)), 0xc1);
