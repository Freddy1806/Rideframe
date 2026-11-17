// Test helper only (tools/import-test.mjs, tools/import-ui.cjs): writes small FIT activity files the way a watch does,
// following the FIT protocol (14-byte header with its CRC, definition + data messages, little or big endian, developer
// fields, compressed timestamp headers, file CRC). Not used by the app.
import { crc16 } from '../js/actfile.js';

const SZ = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 0, 8: 4, 10: 1, 11: 2, 12: 4, 13: 1 };
const SET = { 0: 'Uint8', 1: 'Int8', 2: 'Uint8', 3: 'Int16', 4: 'Uint16', 5: 'Int32', 6: 'Uint32', 8: 'Float32', 10: 'Uint8', 11: 'Uint16', 12: 'Uint32', 13: 'Uint8' };
export const INVALID = { 0: 0xFF, 2: 0xFF, 4: 0xFFFF, 5: 0x7FFFFFFF, 6: 0xFFFFFFFF };
export const FIT_EPOCH = 631065600;
export const fitTime = ms => Math.round(ms / 1000) - FIT_EPOCH;

export class FitWriter {
  constructor() { this.parts = []; this.defs = {}; }
  /** fields: [[fieldNum, size, baseType]]; o.be = big endian; o.dev = [[num, size, devIndex]] */
  def(local, global, fields, o = {}) {
    const b = [0x40 | (o.dev ? 0x20 : 0) | local, 0, o.be ? 1 : 0, ...(o.be ? [global >> 8, global & 255] : [global & 255, global >> 8]), fields.length];
    for (const f of fields) b.push(f[0], f[1], f[2]);
    if (o.dev) { b.push(o.dev.length); for (const d of o.dev) b.push(...d); }
    this.parts.push(Uint8Array.from(b)); this.defs[local] = { fields, be: !!o.be, devSize: (o.dev || []).reduce((a, d) => a + d[1], 0) };
    return this;
  }
  /** values in field order (null = the type's invalid value); o.cts = seconds offset for a compressed timestamp header (local 0..3) */
  data(local, values, o = {}) {
    const d = this.defs[local], size = d.fields.reduce((a, f) => a + f[1], 0) + d.devSize, buf = new Uint8Array(1 + size), dv = new DataView(buf.buffer);
    buf[0] = o.cts != null ? 0x80 | (local << 5) | (o.cts & 31) : local;
    let p = 1;
    d.fields.forEach(([, sz, bt], i) => {
      const base = bt & 31; let v = values[i];
      if (base === 7) { const s = new TextEncoder().encode(String(v ?? '')); buf.set(s.subarray(0, sz - 1), p); }
      else { if (v == null) v = INVALID[base] ?? 0; dv['set' + SET[base]](p, v, !d.be); }
      p += sz;
    });
    for (let i = 0; i < d.devSize; i++) buf[p + i] = 0xAB; // developer bytes the reader must skip
    this.parts.push(buf); return this;
  }
  bytes({ damage = false } = {}) {
    const n = this.parts.reduce((a, b) => a + b.length, 0), out = new Uint8Array(14 + n + 2), dv = new DataView(out.buffer);
    out[0] = 14; out[1] = 0x20; dv.setUint16(2, 2132, true); dv.setUint32(4, n, true); out.set([46, 70, 73, 84], 8); dv.setUint16(12, crc16(out.subarray(0, 12)), true);
    let p = 14; for (const b of this.parts) { out.set(b, p); p += b.length; }
    dv.setUint16(p, crc16(out.subarray(0, p)), true);
    if (damage) out[20] ^= 0x55;
    return out;
  }
}

/** a complete ice-skating activity: 600 s on a loop, HR, altitude with 12 m of climb, a session with the totals */
export function iceSkateFit(startMs = Date.UTC(2026, 10, 15, 9, 0, 0)) {
  const w = new FitWriter(), t0 = fitTime(startMs);
  w.def(0, 0, [[0, 1, 0], [1, 2, 0x84], [4, 4, 0x86]]).data(0, [4, 1, t0]); // file_id: activity, Garmin
  w.def(1, 12, [[0, 1, 0], [1, 1, 0], [3, 16, 7]]).data(1, [33, 0, 'Skating']); // sport: ice_skating
  w.def(2, 20, [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [2, 2, 0x84], [3, 1, 2], [4, 1, 2], [5, 4, 0x86], [6, 2, 0x84]]);
  const sc = 2 ** 31 / 180;
  for (let i = 0; i < 600; i++) {
    const a = i / 600 * 2 * Math.PI, lat = 52.52 + 0.0009 * Math.sin(a), lon = 13.40 + 0.0015 * Math.cos(a), ele = 34 + 6 * (1 - Math.cos(a));
    w.data(2, [t0 + i, Math.round(lat * sc), Math.round(lon * sc), Math.round((ele + 500) * 5), 120 + (i % 40), null, Math.round(i * 5.2 * 100), 5200]);
  }
  w.def(3, 18, [[253, 4, 0x86], [2, 4, 0x86], [5, 1, 0], [6, 1, 0], [7, 4, 0x86], [8, 4, 0x86], [9, 4, 0x86], [11, 2, 0x84], [16, 1, 2], [17, 1, 2], [22, 2, 0x84]]);
  w.data(3, [t0 + 610, t0, 33, 0, 610000, 600000, 311480, 300, 140, 170, 12]);
  return w.bytes();
}
/** an indoor virtual ride with power: big-endian record definition, developer fields, compressed timestamps */
export function virtualRideFit(startMs = Date.UTC(2026, 10, 14, 17, 0, 0), secs = 1500) {
  const w = new FitWriter(), t0 = fitTime(startMs);
  w.def(0, 0, [[0, 1, 0], [4, 4, 0x86]]).data(0, [4, t0]);
  w.def(1, 20, [[253, 4, 0x86], [3, 1, 2], [4, 1, 2], [7, 2, 0x84], [5, 4, 0x86]], { be: true, dev: [[0, 2, 0]] }); // full timestamp
  w.def(2, 20, [[3, 1, 2], [4, 1, 2], [7, 2, 0x84], [5, 4, 0x86]], { be: true }); // compressed timestamp records
  for (let i = 0; i < secs; i++) {
    const pw = i < 300 ? 150 : i < 1500 ? 250 : 150, v = [130 + (i % 20), 90, pw, i * 900];
    if (i % 30 === 0) w.data(1, [t0 + i, ...v]); else w.data(2, v, { cts: (t0 + i) & 31 });
  }
  w.def(3, 18, [[253, 4, 0x86], [2, 4, 0x86], [5, 1, 0], [6, 1, 0], [7, 4, 0x86], [8, 4, 0x86], [9, 4, 0x86]]);
  w.data(3, [t0 + secs, t0, 2, 58, secs * 1000, secs * 1000, secs * 900]);
  return w.bytes();
}
