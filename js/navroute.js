// Routes to follow outdoors (Freddy 17.11.: "import a route and ride it, show the next segment"): route files (.gpx route or
// track, .tcx course or activity, .fit course or activity), simplified to at most ~2000 points, followed live: distance and
// climb left, off route, turn hints from the line's geometry (not street-aware navigation), and the next Strava segment ahead.
// Pure functions without the DOM (Node tests: tools/route-test.mjs).
import { decodeFIT } from './actfile.js';

const R_E = 6371008.8, rad = x => x * Math.PI / 180, deg = x => x * 180 / Math.PI;
export function dist(a, b) { const dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]), x = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2; return 2 * R_E * Math.asin(Math.min(1, Math.sqrt(x))); }
/** compass bearing a -> b in degrees (0 = north, 90 = east) */
export function bearing(a, b) { const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0])), x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1])); return (deg(Math.atan2(y, x)) + 360) % 360; }
/** signed difference b - a in -180 … 180 (positive = clockwise = right) */
export const turnOf = (a, b) => ((b - a + 540) % 360) - 180;

// ---------------- files ----------------
const ent = s => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e] ?? String.fromCharCode(+e.slice(1))).trim();
const tag = (s, t) => { const m = s.match(new RegExp(`<(?:[\\w-]+:)?${t}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${t}>`)); return m ? ent(m[1]) : null; };
const num = v => v == null || v === '' || !Number.isFinite(+v) ? null : +v;
const ok = p => p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 && !(p[0] === 0 && p[1] === 0);
/** GPX points of one kind (rtept = planned route from Komoot/RideWithGPS, trkpt = a recorded or exported track) */
function gpxPts(text, k) {
  const out = [];
  for (const m of text.matchAll(new RegExp(`<(?:[\\w-]+:)?${k}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${k}>)`, 'g'))) {
    const at = n => num((m[1].match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']+)`)) || [])[1]); out.push([at('lat'), at('lon'), num(tag(m[2] || '', 'ele'))]);
  }
  return out.filter(ok);
}
/** any route file -> { name, pts: [[lat, lon, ele|null]] }; throws with a readable message */
export function parseRoute(fileName, data) {
  const u8 = data instanceof Uint8Array ? data : typeof data === 'string' ? null : new Uint8Array(data), base = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  let pts = [], name = null;
  if (u8 && (/\.fit$/i.test(fileName) || (u8.length > 12 && String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) === '.FIT'))) {
    const f = decodeFIT(u8); pts = f.records.map(r => [r.lat, r.lon, r.ele]).filter(ok); name = f.sports[0]?.name || null;
  } else {
    const text = u8 ? new TextDecoder().decode(u8) : data;
    if (/<gpx[\s>]/i.test(text)) {
      const rte = gpxPts(text, 'rtept'), trk = gpxPts(text, 'trkpt'); pts = trk.length >= rte.length ? trk : rte;
      const blk = (text.match(pts === trk ? /<trk\b[^>]*>([\s\S]*?)<trkseg/ : /<rte\b[^>]*>([\s\S]*?)<rtept/) || [])[1] || '';
      name = tag(blk, 'name') || tag(text.split(/<(?:trk|rte|wpt)\b/)[0], 'name');
    } else if (/<TrainingCenterDatabase[\s>]/.test(text)) {
      for (const m of text.matchAll(/<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint>/g)) pts.push([num(tag(m[1], 'LatitudeDegrees')), num(tag(m[1], 'LongitudeDegrees')), num(tag(m[1], 'AltitudeMeters'))]);
      pts = pts.filter(ok); const c = text.match(/<Course\b[^>]*>([\s\S]*?)<\/Course>/); name = c ? tag(c[1].split(/<Track\b/)[0], 'Name') : null;
    } else throw new Error('Unknown file type. Please choose a .gpx, .tcx or .fit file.');
  }
  if (pts.length < 2) throw new Error('No route in this file (no points with a position).');
  return { name: name || base || 'Route', pts };
}

// ---------------- shape ----------------
/** Douglas-Peucker in metres, the tolerance grows until at most max points are left (start and end always stay) */
export function simplify(pts, max = 2000) {
  const p = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]); if (p.length <= 2) return p;
  const k = Math.cos(rad(p[0][0])), xy = p.map(q => [rad(q[1]) * k * R_E, rad(q[0]) * R_E]);
  const off = (i, a, b) => { const [x, y] = xy[i], [ax, ay] = xy[a], [bx, by] = xy[b], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const u = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0; return Math.hypot(x - ax - u * dx, y - ay - u * dy); };
  const run = eps => { const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1; const st = [[0, p.length - 1]];
    while (st.length) { const [a, b] = st.pop(); let m = -1, md = eps; for (let i = a + 1; i < b; i++) { const d = off(i, a, b); if (d > md) { md = d; m = i; } } if (m > 0) { keep[m] = 1; st.push([a, m], [m, b]); } }
    return p.filter((_, i) => keep[i]); };
  let eps = 1.5, out = run(eps); while (out.length > max) { eps *= 1.6; out = run(eps); } return out;
}
const cumOf = pts => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i])); return c; };
/** climb so far at every point (3 m hysteresis against the noise of file heights) */
export function climbOf(pts) {
  const c = [0]; let anchor = null, g = 0;
  for (let i = 0; i < pts.length; i++) { const e = pts[i][2]; if (e != null) { if (anchor == null || e < anchor) anchor = e; else if (e - anchor >= 3) { g += e - anchor; anchor = e; } } if (i) c.push(g); }
  return c;
}
/** a stored route: simplified, rounded, with length and climb */
export function makeRoute(name, raw, x = {}) {
  const pts = simplify(raw).map(q => [+q[0].toFixed(6), +q[1].toFixed(6), q[2] != null ? Math.round(q[2] * 10) / 10 : null]);
  const cl = climbOf(pts), cum = cumOf(pts);
  return { id: x.id || 'rt' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36), name: String(name || 'Route').slice(0, 80), pts, len: Math.round(cum[cum.length - 1]), climb: Math.round(cl[cl.length - 1]), at: Date.now(), ...x };
}

/** turns from the geometry: the line resampled every 10 m, the heading over 30 m before vs 30 m after; bends > 35 deg, one per corner */
export function turnsOf(pts, cum = cumOf(pts)) {
  const len = cum[cum.length - 1], S = [], step = 10; let j = 0;
  for (let a = 0; a <= len; a += step) { while (j < pts.length - 2 && cum[j + 1] < a) j++; const sl = cum[j + 1] - cum[j], u = sl ? (a - cum[j]) / sl : 0; S.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u]); }
  const K = 3, raw = [];
  for (let i = K; i < S.length - K; i++) { const t = turnOf(bearing(S[i - K], S[i]), bearing(S[i], S[i + K])); raw.push(Math.abs(t) > 35 ? { at: i * step, ang: t } : null); }
  const out = []; let grp = null;
  const close = () => { if (!grp) return; const last = out[out.length - 1]; if (last && grp.at - last.at < 50) { if (Math.abs(grp.ang) > Math.abs(last.ang)) out[out.length - 1] = grp; } else out.push(grp); grp = null; };
  for (const r of raw) { if (!r) { close(); continue; } if (!grp || Math.abs(r.ang) > Math.abs(grp.ang)) grp = { ...r, dir: undefined }; }
  close();
  return out.map(t => ({ at: t.at, ang: Math.round(t.ang), dir: Math.abs(t.ang) > 150 ? 'uturn' : t.ang > 0 ? 'right' : 'left' }));
}
export const turnText = (t, d) => (t.dir === 'uturn' ? 'U-turn' : `Turn ${t.dir}`) + (d <= 20 ? ' now' : ` in ${d >= 100 ? Math.round(d / 50) * 50 : Math.round(d / 10) * 10} m`);

// ---------------- following ----------------
/** follows one route: feed every GPS point with its time (s). Off route after > OFF m for > 8 s. Progress searches ahead of
 *  the last match first (out-and-back, a route crossing itself), the whole route only when that fails. */
export class RouteNav {
  constructor(route, { hint = 200 } = {}) {
    this.r = route; this.pts = route.pts; this.cum = cumOf(this.pts); this.len = this.cum[this.cum.length - 1]; this.cl = climbOf(this.pts); this.climb = this.cl[this.cl.length - 1];
    this.turns = turnsOf(this.pts, this.cum); this.hint = hint; this.OFF = 40;
    this.idx = 0; this.along = 0; this.started = false; this.offAt = null; this.off = false; this.offD = 0; this.back = null; this.done = false; this.told = new Set();
  }
  /** nearest point of segment i: { i, d, a (metres along), q (the point) } */
  proj(pt, i) {
    const A = this.pts[i], B = this.pts[i + 1], k = Math.cos(rad(pt[0])), ax = (A[1] - pt[1]) * k, ay = A[0] - pt[0], bx = (B[1] - pt[1]) * k, by = B[0] - pt[0], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const u = l ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l)) : 0, q = [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u];
    return { i, d: dist(pt, q), a: this.cum[i] + (this.cum[i + 1] - this.cum[i]) * u, q };
  }
  match(pt) {
    let loc = null;
    if (this.started) for (let i = Math.max(0, this.idx - 3); i < this.pts.length - 1 && this.cum[i] <= this.along + 1000; i++) { // ahead first; a jump far ahead costs a little
      const c = this.proj(pt, i); c.s = c.d + .05 * Math.max(0, c.a - this.along - 50) + .2 * Math.max(0, this.along - c.a - 30); if (!loc || c.s < loc.s) loc = c; }
    if (loc && loc.d <= this.OFF) return loc;
    const all = []; let best = Infinity; for (let i = 0; i < this.pts.length - 1; i++) { const c = this.proj(pt, i); all.push(c); best = Math.min(best, c.d); }
    const lim = best <= this.OFF ? this.OFF : best + 15, near = all.filter(c => c.d <= lim); near.sort((x, y) => Math.abs(x.a - this.along) - Math.abs(y.a - this.along)); // equally near: the one closest to where we were
    near[0].best = best; return near[0];
  }
  /** -> { along, left, climbLeft, off, offD, back (bearing to the route), turn: { dir, d, text } | null, events: ['off'|'on'|'turn'|'complete'] } */
  update(pt, t) {
    const m = this.match(pt), ev = [];
    if (m.d <= this.OFF) {
      if (this.off) ev.push('on');
      this.idx = m.i; this.along = m.a; this.started = true; this.offAt = null; this.off = false; this.offD = m.d; this.back = null;
    } else {
      this.offD = m.best ?? m.d; this.back = bearing(pt, m.q); if (this.offAt == null) this.offAt = t;
      if (!this.off && t - this.offAt > 8) { this.off = true; ev.push('off'); }
    }
    if (!this.done && this.started && this.along >= this.len - 25) { this.done = true; ev.push('complete'); }
    let turn = null;
    if (!this.off && !this.done && this.started) { const n = this.turns.find(x => x.at > this.along + 3); const d = n ? n.at - this.along : Infinity;
      if (n && d <= this.hint) { turn = { dir: n.dir, d: Math.round(d), text: turnText(n, d) }; if (!this.told.has(n.at)) { this.told.add(n.at); ev.push('turn'); } } }
    return this.state(turn, ev);
  }
  state(turn = null, events = []) { return { along: this.along, left: Math.max(0, this.len - this.along), climbLeft: Math.max(0, this.climb - this.climbAt(this.along)), off: this.off, offD: Math.round(this.offD), back: this.back, turn, done: this.done, events }; }
  climbAt(a) { let i = 0; while (i < this.cum.length - 2 && this.cum[i + 1] < a) i++; const sl = this.cum[i + 1] - this.cum[i] || 1; return this.cl[i] + (this.cl[i + 1] - this.cl[i]) * Math.min(1, Math.max(0, (a - this.cum[i]) / sl)); }
  /** where the route passes a segment's start in the segment's direction (metres along, every pass) */
  passes(seg) {
    const s0 = seg.pts[0], s1 = seg.pts[Math.min(seg.pts.length - 1, 3)], sb = bearing(s0, s1), out = [];
    for (let i = 0; i < this.pts.length - 1; i++) { const c = this.proj(s0, i); if (c.d > 30) continue;
      if (Math.abs(turnOf(bearing(this.pts[i], this.pts[i + 1]), sb)) > 60) continue; if (out.length && c.a - out[out.length - 1] < 100) continue; out.push(c.a); }
    return out;
  }
}

/** the next segment start ahead: along the route when one is followed and passes the start, else straight-line while closing
 *  in (distance shrinking, start within 60 deg of the heading). Warns when the ETA is under 45 s, or under 300 m when slow. */
export class SegAhead {
  constructor() { this.prev = new Map(); this.pass = new Map(); this.nav = null; }
  update(segs, pos, heading, speed, nav = null, skip = () => false) {
    if (nav !== this.nav) { this.nav = nav; this.pass.clear(); }
    let best = null;
    for (const s of segs) {
      if (skip(s)) continue;
      let d = null, via = 'line';
      if (nav && nav.started && !nav.off) { if (!this.pass.has(s.id)) this.pass.set(s.id, nav.passes(s)); const a = this.pass.get(s.id).find(x => x > nav.along - 5 && x - nav.along < 3000); if (a != null) { d = Math.max(0, a - nav.along); via = 'route'; } }
      const dl = dist(pos, s.pts[0]), pv = this.prev.get(s.id); this.prev.set(s.id, dl);
      if (d == null) { if (dl > 1500 || heading == null || pv == null || dl >= pv) continue; if (Math.abs(turnOf(heading, bearing(pos, s.pts[0]))) > 60 && dl > 30) continue; d = dl; }
      const v = Math.max(.5, speed || 0), eta = d / v;
      if (!(eta < 45 || (v < 3 && d < 300))) continue;
      if (!best || d < best.d) best = { seg: s, d: Math.round(d), eta: Math.round(eta), via };
    }
    return best;
  }
}
/** "−0:04" (ahead) / "+0:07" (behind): the time now against a reference time spread evenly over the segment's length */
export function deltaTxt(elapsed, ref, prog) { const d = Math.round(elapsed - ref * prog), a = Math.abs(d); return (d <= 0 ? '−' : '+') + Math.floor(a / 60) + ':' + String(a % 60).padStart(2, '0'); }
/** the average speed (m/s) needed over the rest of a segment to still beat `ref` seconds; null when out of reach or unknown */
export function needSpeed(len, elapsed, ref, prog) { if (!(len > 0) || !(ref > 0)) return null; const left = ref - elapsed, rest = len * (1 - Math.min(1, Math.max(0, prog || 0)));
  if (left <= 0 || rest <= 0) return null; const v = rest / left; return v > 40 ? null : v; }
/** Strava's KOM/QOM text ("5:17", "1:02:03", "37s") -> seconds */
export function xomSec(v) { if (v == null) return null; if (typeof v === 'number') return v; const s = String(v).trim(), m = s.match(/^(\d+)\s*s$/); if (m) return +m[1];
  if (!/^\d+(:\d{1,2}){1,2}$/.test(s)) return null; return s.split(':').reduce((a, x) => a * 60 + +x, 0); }
