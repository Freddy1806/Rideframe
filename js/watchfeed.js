// The watch's own segment timing and route following (19.11.): the twin of garmin/source/Feed.mc, line by line, so the
// logic is tested in Node (tools/watchfeed-test.mjs) although the watch code cannot be compiled here. Pure, no DOM.
// The rules are the phone's (js/segtrack.js SegTracker, js/navroute.js SegAhead / RouteNav / needSpeed / deltaTxt) in their
// simplest robust form, on flat arrays of local metres (the watch keeps no per-second lists and no nested point arrays):
//   warn   within 300 m of a segment start (or under 45 s away), closing in, heading at the start or along the first leg
//   start  within 25 m of the start point      progress  nearest point on the line in a forward window
//   finish within 25 m of the end (85 % done)  lost      more than 60 m off for more than 10 s
//   route  on it within 40 m, off after 8 s further away; metres along, metres off, the next turn
// Outputs are the flow's segment events (js/watchflow.js segment): warn / live / end, and none (popup away).
import { BOX } from './watchflow.js';

export const WARN_M = 300, WARN_ETA = 45, WARN_MAX = 1500, GATE_M = 25, LOST_M = 60, LOST_S = 10, COOL_S = 120, WIN = 60, OFF_M = 40, OFF_S = 8, AHEAD_M = 1000;
const RE = 6371008.8, RAD = Math.PI / 180;
/** degrees -> local metres around an origin (equirectangular, plenty for a few km) */
export class Proj {
  constructor(lat0, lon0) { this.lat0 = lat0; this.lon0 = lon0; this.k = Math.cos(lat0 * RAD) * RAD * RE; }
  x(lat, lon) { return (lon - this.lon0) * this.k; }
  y(lat) { return (lat - this.lat0) * RAD * RE; }
}
const hyp = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
/** compass bearing of a step (0 = north, 90 = east) */
export const brg = (dx, dy) => (Math.atan2(dx, dy) / RAD + 360) % 360;
export const turnOf = (a, b) => ((b - a + 540) % 360) - 180;
/** js/navroute.js needSpeed: m/s over the rest to still beat ref seconds; 0 = out of reach or unknown */
export function needSpeed(len, el, ref, prog) {
  if (!(len > 0) || !(ref > 0)) return 0; const left = ref - el, p = Math.min(1, Math.max(0, prog)), rest = len * (1 - p);
  if (left <= 0 || rest <= 0) return 0; const v = rest / left; return v > 40 ? 0 : v;
}
/** the nearest point of polyline xs / ys (from index a to b, segments i..i+1) to x, y: [index, distance, metres along] */
function nearest(xs, ys, cum, o, a, b, x, y) {
  let bi = a, bd = Infinity, ba = cum[o + a];
  for (let i = a; i < b; i++) {
    const ax = xs[o + i], ay = ys[o + i], dx = xs[o + i + 1] - ax, dy = ys[o + i + 1] - ay, l = dx * dx + dy * dy;
    let u = l > 0 ? ((x - ax) * dx + (y - ay) * dy) / l : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
    const d = hyp(x - ax - u * dx, y - ay - u * dy); if (d < bd) { bd = d; bi = i; ba = cum[o + i] + (cum[o + i + 1] - cum[o + i]) * u; }
  }
  return [bi, bd, ba];
}

/** Strava segments near the watch (GET /api/watch/segments) and the one being timed */
export class SegFeed {
  constructor() { this.clear(); this.coolId = []; this.coolAt = []; }
  clear() { this.n = 0; this.ids = []; this.names = []; this.lens = []; this.prs = []; this.koms = []; this.first = []; this.cnt = []; this.xs = []; this.ys = []; this.cum = []; this.prev = [];
    this.proj = null; this.active = -1; this.idx = 0; this.t0 = 0; this.offAt = -1; this.warned = false; }
  /** segs = the answer's segs: [{ id, n, len, pr, kom, p: [[lat, lon]] }]; never while one is timed (the caller waits) */
  load(segs, lat, lon) {
    this.clear(); this.proj = new Proj(lat, lon);
    for (const s of segs || []) {
      const p = Array.isArray(s?.p) ? s.p : []; if (p.length < 2) continue;
      this.ids.push(String(s.id)); this.names.push(String(s.n || 'Segment')); this.prs.push(s.pr | 0); this.koms.push(s.kom | 0); this.first.push(this.xs.length); this.cnt.push(p.length); this.prev.push(-1);
      let c = 0;
      for (let i = 0; i < p.length; i++) { const x = this.proj.x(p[i][0], p[i][1]), y = this.proj.y(p[i][0]); if (i) c += hyp(x - this.xs[this.xs.length - 1], y - this.ys[this.ys.length - 1]); this.xs.push(x); this.ys.push(y); this.cum.push(c); }
      this.lens.push(+s.len > 0 ? +s.len : c); this.n++;
    }
  }
  cooling(s, now) { const i = this.coolId.indexOf(this.ids[s]); return i >= 0 && now - this.coolAt[i] < COOL_S; }
  cool(s, now) { const i = this.coolId.indexOf(this.ids[s]); if (i >= 0) this.coolAt[i] = now; else { this.coolId.push(this.ids[s]); this.coolAt.push(now); if (this.coolId.length > 20) { this.coolId.shift(); this.coolAt.shift(); } } }
  /** the reference: the PR, else the KOM; [seconds, 'PR' | 'KOM' | ''] */
  ref(s) { return this.prs[s] > 0 ? [this.prs[s], 'PR'] : this.koms[s] > 0 ? [this.koms[s], 'KOM'] : [0, '']; }
  /** one GPS point a second: heading in degrees (-1 = unknown), v in m/s, now in s -> a segment event or null */
  step(lat, lon, heading, v, now) {
    if (!this.proj || !this.n) return null;
    const x = this.proj.x(lat, lon), y = this.proj.y(lat);
    if (this.active >= 0) {
      const s = this.active, o = this.first[s], c = this.cnt[s], last = Math.min(c - 1, this.idx + WIN), len = this.cum[o + c - 1];
      const [bi, bd, ba] = nearest(this.xs, this.ys, this.cum, o, this.idx, last, x, y);
      if (bd > LOST_M) { if (this.offAt < 0) this.offAt = now; if (now - this.offAt > LOST_S) { this.active = -1; this.cool(s, now); return { k: 'none', lost: true }; } }
      else { this.offAt = -1; this.idx = bi; this.along = ba; }
      const prog = len > 0 ? Math.min(1, (this.along || 0) / len) : 0, el = now - this.t0, [ref, lab] = this.ref(s), L = this.lens[s];
      if (prog > .85 && hyp(x - this.xs[o + c - 1], y - this.ys[o + c - 1]) < GATE_M) {
        this.active = -1; this.cool(s, now);
        return { k: 'end', name: this.names[s], len: L, time: el, delta: ref ? el - ref : 0, pr: this.prs[s] > 0 && el < this.prs[s], ref: lab };
      }
      return { k: 'live', name: this.names[s], len: L, done: prog * L, delta: ref ? Math.round(el - ref * prog) : 0, need: needSpeed(L, el, ref, prog), time: el, ref: lab };
    }
    let best = -1, bd = 0;
    for (let s = 0; s < this.n; s++) {
      if (this.cooling(s, now)) continue;
      const o = this.first[s], sx = this.xs[o], sy = this.ys[o], d = hyp(sx - x, sy - y), pv = this.prev[s]; this.prev[s] = d;
      if (d < GATE_M) { this.active = s; this.t0 = now; this.idx = 0; this.along = 0; this.offAt = -1; this.warned = false; const [ref, lab] = this.ref(s);
        return { k: 'live', name: this.names[s], len: this.lens[s], done: 0, delta: 0, need: needSpeed(this.lens[s], 0, ref, 0), time: 0, ref: lab }; }
      const eta = d / Math.max(.5, v || 0);
      if (d > WARN_MAX || !(d <= WARN_M || eta < WARN_ETA) || pv < 0 || d >= pv) continue; // near, and closing in
      const k = Math.min(this.cnt[s] - 1, 3), leg = brg(this.xs[o + k] - sx, this.ys[o + k] - sy), at = brg(sx - x, sy - y);
      if (d > 30 && (heading < 0 || (Math.abs(turnOf(heading, at)) > 60 && Math.abs(turnOf(heading, leg)) > 60))) continue;
      if (best < 0 || d < bd) { best = s; bd = d; }
    }
    if (best >= 0) { this.warned = true; return { k: 'warn', name: this.names[best], len: this.lens[best], eta: Math.round(bd / Math.max(.5, v || 0)), pr: this.prs[best] }; }
    if (this.warned) { this.warned = false; return { k: 'none' }; }
    return null;
  }
}

/** a route from GET /api/watch/route followed by GPS: metres along, metres off, and the position in the route page's box */
export class RouteTrack {
  constructor(r) {
    const p = r.p; this.proj = new Proj(p[0][0], p[0][1]); this.xs = []; this.ys = []; this.cum = []; let c = 0;
    for (let i = 0; i < p.length; i++) { const x = this.proj.x(p[i][0], p[i][1]), y = this.proj.y(p[i][0]); if (i) c += hyp(x - this.xs[i - 1], y - this.ys[i - 1]); this.xs.push(x); this.ys.push(y); this.cum.push(c); }
    this.len = c; this.idx = 0; this.along = 0; this.started = false; this.offAt = -1; this.off = 0;
    // the route page's box (js/watchflow.js routeFace): one scale, north up
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < this.xs.length; i++) { x0 = Math.min(x0, this.xs[i]); x1 = Math.max(x1, this.xs[i]); y0 = Math.min(y0, this.ys[i]); y1 = Math.max(y1, this.ys[i]); }
    this.sc = Math.min(BOX[0] / Math.max(1, x1 - x0), BOX[1] / Math.max(1, y1 - y0)); this.ox = (BOX[0] - (x1 - x0) * this.sc) / 2; this.oy = (BOX[1] - (y1 - y0) * this.sc) / 2; this.x0 = x0; this.y1 = y1;
  }
  /** [u, v] of a point in the box (0..1 of its width / height) */
  uv(x, y) { return [(this.ox + (x - this.x0) * this.sc) / BOX[0], (this.oy + (this.y1 - y) * this.sc) / BOX[1]]; }
  /** -> { along, off, u, v } */
  step(lat, lon, now) {
    const x = this.proj.x(lat, lon), y = this.proj.y(lat), n = this.xs.length; let hit = null;
    if (this.started) { // ahead first (out and back, a route crossing itself), then the whole route
      let b = this.idx; while (b < n - 1 && this.cum[b] <= this.along + AHEAD_M) b++;
      const h = nearest(this.xs, this.ys, this.cum, 0, Math.max(0, this.idx - 3), b, x, y); if (h[1] <= OFF_M) hit = h;
    }
    if (!hit) { const h = nearest(this.xs, this.ys, this.cum, 0, 0, n - 1, x, y); if (h[1] <= OFF_M) hit = h; else this.offD = h[1]; }
    if (hit) { this.idx = hit[0]; this.along = hit[2]; this.started = true; this.offAt = -1; this.off = 0; }
    else { if (this.offAt < 0) this.offAt = now; if (now - this.offAt > OFF_S) this.off = Math.max(1, Math.round(this.offD)); }
    const [u, v] = this.uv(x, y); return { along: this.along, off: this.off, u, v };
  }
}
