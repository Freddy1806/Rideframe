// Road centreline + terrain height field for the 3D world. No three.js here so the
// self-test (tools/selftest.mjs) can run the exact same maths in node.
import { createNoise2D } from '../../vendor/simplex-noise.js';
import { STEP } from '../track.js';

export function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

export const ROAD_W = 3.3;     // half width of the asphalt
export const DS = 2.5;         // metres between dense centreline samples
const SUB = STEP / DS;         // dense samples per track sample

// Real Lofoten elevation (assets/dem): the mountain chain is turned so it runs along the route (north)
// Same ground area in two resolutions: lofoten_dtm10.bin (2048², ~10.8 m, from the Mac) or lofoten.bin (1536², ~14.4 m)
export const DEM_ROT = 27.5 * Math.PI / 180, DEM_P0 = [127 / 1536, 940 / 1536], DEM_SIZE = 1536 * 14.35; // metres across
/** Elevation grid for a world. info = track.dem for a real route ({file, n, size_m, start_px}: unrotated,
 *  start_px = route start in DEM pixels); without it the built-in Lofoten DEM turned along the coast route. */
export async function loadDEM(info = null) {
  const list = info ? [[info.file, info.n]] : [['lofoten_dtm10.bin', 2048], ['lofoten.bin', 1536]];
  for (const [file, n] of list) {
    try {
      const url = new URL('../../assets/dem/' + file, import.meta.url);
      let data;
      if (typeof window === 'undefined') { const fs = await import('node:fs'); const b = fs.readFileSync(url); data = new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
      else { const r = await fetch(url); if (!r.ok) continue; data = new Uint16Array(await r.arrayBuffer()); }
      if (data.length !== n * n) continue;
      return info ? { data, n, rot: 0, p0: [info.start_px[0] / n, info.start_px[1] / n], size: info.size_m, real: true }
        : { data, n, rot: DEM_ROT, p0: DEM_P0, size: DEM_SIZE, real: false };
    } catch { /* try the next one */ }
  }
  console.warn('DEM fehlt, Berge aus Rauschen'); return null;
}

const cr = (p0, p1, p2, p3, t) => { // Catmull-Rom
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

export class Field {
  constructor(track, dem = null) {
    this.track = track; this.dem = dem;
    const rot = dem?.rot ?? DEM_ROT; this.dc = Math.cos(rot); this.ds = Math.sin(rot);
    this.p0 = dem?.p0 ?? DEM_P0; this.demSize = dem?.size ?? DEM_SIZE;
    this.real = !!dem?.real; // real road on its real ground: the sea is where the DEM says, no forced coast or invented islands
    const n = track.ele.length, R = 6371008.8, la0 = track.lat[0] * Math.PI / 180;
    const X = new Float64Array(n), Z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      X[i] = (track.lon[i] - track.lon[0]) * Math.PI / 180 * R * Math.cos(la0);
      Z[i] = -(track.lat[i] - track.lat[0]) * Math.PI / 180 * R;
    }
    // dense spline centreline: smooth curves and hairpins instead of 10 m chords
    const m = (n - 1) * SUB + 1;
    this.n = m;
    this.x = new Float32Array(m); this.z = new Float32Array(m); this.e = new Float32Array(m);
    const E = track.ele, c = k => Math.max(0, Math.min(n - 1, k));
    for (let j = 0; j < m; j++) {
      const i = Math.min(n - 2, Math.floor(j / SUB)), t = j / SUB - i;
      this.x[j] = cr(X[c(i - 1)], X[i], X[c(i + 1)], X[c(i + 2)], t);
      this.z[j] = cr(Z[c(i - 1)], Z[i], Z[c(i + 1)], Z[c(i + 2)], t);
      this.e[j] = lerp(E[i], E[i + 1], t); // linear in height: exactly the grade the trainer gets
    }
    this.tx = new Float32Array(m); this.tz = new Float32Array(m);
    for (let j = 0; j < m; j++) {
      const a = Math.max(0, j - 1), b = Math.min(m - 1, j + 1);
      const dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a], l = Math.hypot(dx, dz) || 1;
      this.tx[j] = dx / l; this.tz[j] = dz / l;
    }
    // land parameters per dense sample, smoothed along the road so transitions are gentle
    const sea = new Float32Array(m), cliff = new Float32Array(m), beach = new Float32Array(m);
    const segs = track.segments || [];
    for (let j = 0; j < m; j++) {
      const d = j * DS, s = segs.find(s => d >= s.from && d < s.to) || segs[segs.length - 1] || {};
      sea[j] = s.land === 'coast' || s.land === 'cliff' ? 1 : 0;
      cliff[j] = s.land === 'cliff' ? 1 : 0;
      beach[j] = s.beach ? 1 : 0;
    }
    const sm = (a, r) => { // moving average via prefix sums
      const P = new Float64Array(m + 1); for (let j = 0; j < m; j++) P[j + 1] = P[j] + a[j];
      const o = new Float32Array(m); for (let j = 0; j < m; j++) { const lo = Math.max(0, j - r), hi = Math.min(m, j + r + 1); o[j] = (P[hi] - P[lo]) / (hi - lo); }
      return o; };
    this.sea = sm(sea, 120); this.cliff = sm(cliff, 120); this.beach = sm(beach, 120);
    if (track.dem?.tunnels?.length) { this.tunnel = new Uint8Array(m); track.dem.tunnels.forEach(([a, b], k) => { if (track.dem.tunnelKinds?.[k] === 'avalanche_protector') return;
      const set = (lo, hi, arr) => { for (let j = Math.max(0, Math.floor(lo / DS)); j <= Math.min(m - 1, hi / DS); j++) arr[j] = 1; };
      set(a + 1, b - 1, this.tunnel); // mountain raised over the whole tube
      set(a - 1, Math.min(b, a + 22), this.tunnelHole ||= new Uint8Array(m)); set(Math.max(a, b - 22), b + 1, this.tunnelHole); }); } // terrain cut open at both mouths (see holeAt)
    if (track.dem?.bridges?.length) { this.bridge = new Uint8Array(m); for (const [a, b] of track.dem.bridges) for (let j = Math.max(0, Math.floor(a / DS)); j <= Math.min(m - 1, b / DS); j++) this.bridge[j] = 1; }
    // spatial hashes over every 4th dense sample (10 m): fine and coarse
    this.fine = this._hash(40, SUB); this.coarse = this._hash(250, SUB * 8); this.huge = this._hash(1000, SUB * 8);
    const r = rng(77); this.n1 = createNoise2D(r); this.n2 = createNoise2D(r); this.n3 = createNoise2D(r);
  }
  _hash(cell, every) {
    const m = new Map();
    for (let i = 0; i < this.n; i += every) {
      const k = (Math.floor(this.x[i] / cell) + 32768) * 65536 + Math.floor(this.z[i] / cell) + 32768; // numeric key: no string building per lookup
      (m.get(k) || m.set(k, []).get(k)).push(i);
    }
    return { m, cell };
  }
  _query(h, x, z, rad) {
    const out = [], cx = Math.floor(x / h.cell), cz = Math.floor(z / h.cell), rc = Math.ceil(rad / h.cell);
    for (let a = -rc; a <= rc; a++) for (let b = -rc; b <= rc; b++) { const l = h.m.get((cx + a + 32768) * 65536 + cz + b + 32768); if (l) for (const i of l) out.push(i); }
    return out;
  }
  /** Nearest point on the dense centreline: signed lateral offset (+ = right of travel), road height, smoothed nearby height. */
  road(x, z) {
    let best = -1, bd = 1e12;
    const nearest = l => { for (const i of l) { const dx = x - this.x[i], dz = z - this.z[i], d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = i; } } };
    const reach = () => Math.sqrt(4.24 * bd + 14400); // radius holding every sample with a smoothing weight > e^-9 (sig2 below)
    let list = this._query(this.fine, x, z, 120);
    if (list.length) nearest(list);
    else { // away from the road: widen step by step instead of always scanning 7 km (coarse and huge hold the same samples)
      list = this._query(this.coarse, x, z, 500); nearest(list);
      if (best < 0 || reach() > 500) { best = -1; bd = 1e12; list = this._query(this.huge, x, z, 2500); nearest(list);
        if (best < 0 || reach() > 2500) { best = -1; bd = 1e12; list = this._query(this.huge, x, z, 7000); nearest(list); } }
    }
    if (best < 0) return null;
    // smooth averages over nearby road: the further away, the wider (no seams where the nearest sample flips)
    const sig2 = 1600 + bd * 0.36; let ws = 0, we = 0, wsea = 0, wcl = 0, wbe = 0;
    for (const i of list) {
      const dx = x - this.x[i], dz = z - this.z[i], q = (dx * dx + dz * dz - bd) / sig2; if (q > 9) continue; const w = Math.exp(-q);
      ws += w; we += w * this.e[i]; wsea += w * this.sea[i]; wcl += w * this.cliff[i]; wbe += w * this.beach[i];
    }
    // refine on the dense samples around the hit, then project onto the segment
    const lo = Math.max(0, best - SUB * 2), hi = Math.min(this.n - 1, best + SUB * 2);
    for (let i = lo; i <= hi; i++) { const dx = x - this.x[i], dz = z - this.z[i], d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = i; } }
    const i = best, dx = x - this.x[i], dz = z - this.z[i];
    const along = dx * this.tx[i] + dz * this.tz[i], side = dx * -this.tz[i] + dz * this.tx[i];
    const f = Math.max(-1, Math.min(1, along / DS)), j = Math.max(0, Math.min(this.n - 1, i + Math.sign(f)));
    const eHere = lerp(this.e[i], this.e[j], Math.abs(f));
    const near = smooth(30, 8, Math.abs(side)); // right at the road use the exact local values
    return { i, d: Math.abs(side), side, e: eHere, ew: we / ws,
      sea: lerp(wsea / ws, this.sea[i], near), cliff: lerp(wcl / ws, this.cliff[i], near), beach: lerp(wbe / ws, this.beach[i], near) };
  }
  /** Real elevation (m) at world x,z; mirrored beyond the edges so it never ends. */
  demH(x, z) {
    if (!this.dem) return null;
    const D = this.dem.data, N = this.dem.n, px_m = this.demSize / N;
    let px = (this.dc * x - this.ds * z) / px_m + this.p0[0] * N, py = (this.ds * x + this.dc * z) / px_m + this.p0[1] * N;
    const M = N - 1, w = v => { v = Math.abs(v) % (2 * M); return v > M ? 2 * M - v : v; };
    this.demOut = Math.max(0, -px, px - M, -py, py - M) * px_m; // metres beyond the DEM edge (real routes fade into open sea there)
    px = w(px); py = w(py);
    const i = Math.min(M - 1, Math.floor(px)), j = Math.min(M - 1, Math.floor(py)), u = px - i, v = py - j, k = j * N + i;
    return ((D[k] * (1 - u) + D[k + 1] * u) * (1 - v) + (D[k + N] * (1 - u) + D[k + N + 1] * u) * v) * 0.1;
  }
  ridged(x, z) { // Lofoten-style peaks
    let s = 0, a = 1, f = 1 / 900, w = 0;
    for (let o = 0; o < 5; o++) { const v = 1 - Math.abs(this.n1(x * f, z * f)); s += v * v * a; w += a; a *= 0.5; f *= 2.1; }
    return s / w;
  }
  /** Terrain height at world x,z. On and next to the asphalt it is always a little below the road. */
  height(x, z) {
    const r = this.road(x, z);
    if (!r) return -30;
    const detail = this.n2(x / 38, z / 38) * 1.6 + this.n3(x / 9, z / 9) * 0.35;
    const out = r.d - ROAD_W - 1.5;                     // metres beyond the shoulder
    const flat = smooth(0, 7, out);                     // 0 on the road, 1 away from it
    const base = lerp(r.e - 0.25, r.ew, smooth(2, 25, out));
    // land: gentle slope off the road, then the real mountains (DEM) take over
    const real = this.demH(x, z);
    const rough = this.n1(x / 140, z / 140) * 6 + this.n3(x / 45, z / 45) * 2.5; // break up the 14 m DEM smoothness
    const hills = (this.n2(x / 1800, z / 1800) * .5 + .5) * 45;
    const mtn = real === null ? (this.n2(x / 2600, z / 2600) * .5 + .5) * 260 + Math.pow(this.ridged(x, z), 1.25) * 900
      : lerp(-14, hills * smooth(5, 60, real) + real + rough * smooth(20, 200, real), smooth(0, 4, real)); // DEM sea = fjords
    const nearLand = base + Math.min(35, Math.max(0, out) * 0.18) + detail * smooth(0, 15, out);
    const target = real === null ? Math.max(mtn, nearLand) : lerp(mtn, Math.max(mtn, nearLand), smooth(0, 30, real));
    if (this.real && real !== null) { // the DEM is the truth here: only a short flat shoulder blends into it, sea stays sea
      const ground = lerp(real <= 0.5 ? -4 - smooth(0, 40, out) * 12 : real + rough * smooth(20, 200, real), -16, smooth(0, 1200, this.demOut));
      if (this.bridge?.[r.i]) return Math.min(ground, r.e - 3); // on a bridge: water (or the valley) right under the deck
      if (this.tunnel?.[r.i]) return Math.max(ground, r.e + 9); // rock tunnel: the mountain stays closed above the tube
      const h = lerp(base + detail * smooth(0, 15, out), ground, smooth(3, 35, out));
      const hh = lerp(r.e - 0.25, h, flat);
      return out < 3 ? Math.min(hh, r.e - 0.25 + Math.max(0, out) * 0.4) : hh;
    }
    const land = lerp(nearLand, target, smooth(60, 700, out));
    // sea side (left on coastal sections; always open sea far out on the left)
    const shore = lerp(lerp(14, 45, r.beach), 4, r.cliff) + this.n2(x / 70, z / 70) * 8 * (1 - 0.8 * r.cliff); // cliffs: edge right behind the guard rail
    const drop = lerp(lerp(28, 70, r.beach), 14 + r.e * 0.15, r.cliff);
    const seaH = lerp(base + detail * 0.4 * smooth(0, 10, out) - Math.max(0, out) * 0.05, -9, smooth(shore, shore + drop, out)) - 22 * smooth(shore + drop, shore + drop + 120, out)
      + this.ridged(x * 3, z * 3) * 10 * smooth(shore, shore + 20, out) * (1 - r.beach) * smooth(80, 30, out); // skerries
    // islands: only the highest real peaks of a shifted DEM rise out of the sea
    const isl = real === null ? Math.max(0, this.ridged(x * 1.3 + 5000, z * 1.3) - 0.70) * 2600
      : Math.max(0, (this.demH(x - 7000, z + 3000) - 330) * 1.6);
    const seaFar = seaH + isl * smooth(400, 1100, out);
    const sideSea = smooth(-1, -6, r.side) * Math.max(r.sea, smooth(900, 2200, out + this.n2(x / 1100, z / 1100) * 700 + this.n3(x / 300, z / 300) * 150));
    const h = lerp(land, seaFar, sideSea);
    // never above the road surface within the shoulder band
    const hh = lerp(r.e - 0.25, h, flat);
    return out < 3 ? Math.min(hh, r.e - 0.25 + Math.max(0, out) * 0.4) : hh;
  }
  /** Height of a terrain mesh vertex for a grid with spacing S: coarse grids are pulled down near the road
   *  so that the interpolated triangles never cover the asphalt. */
  /** True when a rock tunnel (or its mouth) lies within [d - back, d + ahead]: no shouting into a tunnel. */
  tunnelNear(d, back = 40, ahead = 160) {
    const t = this.tunnelHole; if (!t) return false;
    for (let j = Math.max(0, Math.floor((d - back) / DS)), e = Math.min(t.length - 1, (d + ahead) / DS); j <= e; j += 4) if (t[j] || this.tunnel[j]) return true;
    return false;
  }
  /** Terrain vertex inside the slot right behind a tunnel mouth: its triangles are left out, so the raised mountain never closes the tube. */
  holeAt(x, z) {
    if (!this.tunnelHole) return false;
    const r = this.road(x, z); return !!(r && this.tunnelHole[r.i] && r.d < ROAD_W + 3);
  }
  vertexHeight(x, z, S) {
    const h = this.height(x, z);
    if (S <= 2.1) return h;
    const r = this.road(x, z);
    return r && r.d < ROAD_W + S * 1.5 ? Math.min(h, r.e - 0.3 - S * 0.12) : h;
  }
  /** Position + unit tangent on the centreline at distance d (m). */
  at(d) {
    const u = Math.max(0, Math.min(this.n - 1.0001, d / DS)), i = Math.floor(u), t = u - i;
    return { x: lerp(this.x[i], this.x[i + 1], t), z: lerp(this.z[i], this.z[i + 1], t), e: lerp(this.e[i], this.e[i + 1], t),
      tx: lerp(this.tx[i], this.tx[i + 1], t), tz: lerp(this.tz[i], this.tz[i + 1], t), i };
  }
  /** Rider camera target pose at distance d: eye position and a look point, both on the road. */
  pose(d, lane = 1.2, eye = 1.55) {
    const p = this.at(d), l = Math.hypot(p.tx, p.tz) || 1, rx = -p.tz / l, rz = p.tx / l;
    // look direction: average of the road ahead (6-22 m), so curves turn the view gradually
    let lx = 0, ly = 0, lz = 0, w = 0;
    const end = (this.n - 1.0001) * DS;
    for (let k = 6; k <= 22; k += 2) { const q = this.at(d + k), wk = 1 / k; const ql = Math.hypot(q.tx, q.tz) || 1;
      const over = Math.max(0, d + k - end); // past the finish: keep looking straight ahead, never into the ground
      lx += (q.x + q.tx / ql * over - q.tz / ql * lane) * wk; ly += q.e * wk; lz += (q.z + q.tz / ql * over + q.tx / ql * lane) * wk; w += wk; }
    // the view tilts with only 40 % of the road's pitch, so a climb visibly rises in the picture (fully pitched it looks flat)
    return { x: p.x + rx * lane, y: p.e + eye, z: p.z + rz * lane, lx: lx / w, ly: p.e + (ly / w - p.e) * 0.4 + eye - 0.3, lz: lz / w };
  }
}
