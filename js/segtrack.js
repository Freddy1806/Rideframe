// Strava segments live on the outdoor ride (Freddy 15.11.): the rider's starred segments plus popular ones nearby are drawn
// on the map and timed while riding (start gate 25 m, follow the line, finish gate 25 m). Strava's official time comes after upload.
const R_E = 6371008.8, rad = x => x * Math.PI / 180;
export function dist(a, b) { const dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]), x = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2; return 2 * R_E * Math.asin(Math.sqrt(x)); }
/** Google encoded polyline -> [[lat, lon]] */
export function decode(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const k of [0, 1]) { let b, sh = 0, r = 0; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32 && i < str.length); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k) lon += d; else lat += d; }
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}
export class SegTracker {
  constructor() { this.segs = new Map(); this.active = null; this.cool = new Map(); }
  add(list) { let n = 0; for (const s of list) { if (this.segs.has(s.id) || !s.line) continue; const pts = decode(s.line); if (pts.length < 2) continue;
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i])); this.segs.set(s.id, { ...s, pts, cum, len: cum[cum.length - 1] }); n++; } return n; }
  /** feed every accepted GPS point with the ride clock (s); returns { type: 'start' | 'finish' | 'lost', seg, t } or null */
  update(pt, t) {
    const a = this.active;
    if (a) {
      const s = a.seg; let best = a.idx, bd = Infinity;
      for (let i = a.idx; i < Math.min(s.pts.length, a.idx + 60); i++) { const d = dist(pt, s.pts[i]); if (d < bd) { bd = d; best = i; } }
      if (bd > 60) { if (++a.off > 4) { this.active = null; this.cool.set(s.id, t); return { type: 'lost', seg: s, t: t - a.t0 }; } } else { a.off = 0; a.idx = best; }
      a.prog = s.cum[a.idx] / s.len;
      if (a.prog > .85 && dist(pt, s.pts[s.pts.length - 1]) < 25) { this.active = null; this.cool.set(s.id, t); return { type: 'finish', seg: s, t: Math.round(t - a.t0) }; }
      return null;
    }
    for (const s of this.segs.values()) {
      if (t - (this.cool.get(s.id) ?? -1e9) < 120) continue;
      if (dist(pt, s.pts[0]) < 25) { this.active = { seg: s, t0: t, idx: 0, off: 0, prog: 0 }; return { type: 'start', seg: s, t: 0 }; }
    }
    return null;
  }
}
