// Open-world island (Freddy 18.11.): the layout of draft 1 (tools/insel_proto.py, INSELPLAN.md in Drive 261118) turned into
// ridable geometry: real switchbacks with their real length, a 13 m height grid for the whole island, every road cut into it.
// Deterministic (fixed seed): the Mac and the cloud build identical files, nothing big has to be copied.
//
//   node tools/island.mjs           -> assets/dem/insel.bin       4096² Uint16 decimetres, sea = 0 (like kueste60.bin)
//                                      assets/dem/insel_net.json  the network: nodes + edges (10 m polylines with heights)
//                                      assets/dem/insel_*.json    fixed tours in the kueste60.json format (ridable today)
//   node tools/island.mjs --stats   -> only the table (lengths, climbs, max grades)
//
// Draft coordinates are km with y pointing NORTH (as on the map). The grid and the game use metres, x east, y SOUTH.
import fs from 'node:fs';
import { createNoise2D } from '../vendor/simplex-noise.js';

export const N = 4096, PX = 13, SIZE = N * PX;           // 53 km square, island 48 x 34 km in the middle
export const W_KM = 48, H_KM = 34, OX = (SIZE - W_KM * 1000) / 2, OY = (SIZE - H_KM * 1000) / 2;
const OUT = new URL('../assets/dem/', import.meta.url);
const STEP = 10;
/** draft km (y north) -> grid metres (y south) */
export const M = (x, y) => [x * 1000 + OX, (H_KM - y) * 1000 + OY];
const K = (X, Y) => [(X - OX) / 1000, H_KM - (Y - OY) / 1000];

const rng = seed => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const R = rng(1811), n1 = createNoise2D(R), n2 = createNoise2D(R), n3 = createNoise2D(R), n4 = createNoise2D(R);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fbm = (nz, x, y, oct = 5) => { let s = 0, a = 1, w = 0; for (let o = 0; o < oct; o++) { s += nz(x, y) * a; w += a; a *= 0.5; x *= 2.03; y *= 2.03; } return s / w; };
const ridged = (x, y) => { let s = 0, a = 1, w = 0; for (let o = 0; o < 5; o++) { const v = 1 - Math.abs(n3(x, y)); s += v * v * a; w += a; a *= 0.5; x *= 2.1; y *= 2.1; } return s / w; };

// ---------------- terrain of draft 1 (km, y north) ----------------
const CX = 24, CY = 17;
function landK(x, y) { // > 0 land
  const dx = (x - CX) / 21.3, dy = (y - CY) / 15, a = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
  const edge = 1 + 0.07 * Math.sin(3 * a + 0.5) + 0.05 * Math.sin(7 * a + 1.3) + 0.12 * fbm(n1, x / 9, y / 9, 3);
  const main = clamp((edge - r) / 0.1, -1, 1);
  // Seal Isle: a small island 5 km off the south coast, reached over the Long Bridge (Freddy 18.11.: "ne paar Kilometer lange Brücke")
  const ir = Math.hypot((x - ISLE[0]) / ISLE[2], (y - ISLE[1]) / ISLE[3]), isle = clamp((1 + 0.06 * fbm(n2, x / 2, y / 2, 3) - ir) / 0.08, -1, 1);
  return Math.max(main, isle);
}
export const ISLE = [26.5, -5.0, 2.4, 1.5]; // centre x, y (km, y north), half axes
function ridgeK(x, y, [x0, y0], [x1, y1], h, w) {
  const vx = x1 - x0, vy = y1 - y0, t = clamp(((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy), 0, 1);
  return h * Math.exp(-((Math.hypot(x - (x0 + t * vx), y - (y0 + t * vy)) / w) ** 2));
}
const peakK = (x, y, [px, py], h, w) => h * Math.exp(-((x - px) ** 2 + (y - py) ** 2) / w ** 2);
const SADDLES = [[19.0, 22.6, 1012, 1.6], [11.5, 15.5, 705, 1.5], [35.0, 21.5, 548, 1.6], [24.0, 7.0, 385, 1.4]];
/** natural ground in metres at draft km (x, y north) */
export function groundK(x, y) {
  let z = Math.max(0,
    ridgeK(x, y, [12, 21.5], [33, 23.5], 1150, 3.2),   // main ridge (north)
    peakK(x, y, [24.5, 24.2], 1520, 2.6),              // Burgberg, the castle summit
    peakK(x, y, [8.5, 16.0], 1080, 3.4),               // west massif
    ridgeK(x, y, [5, 12], [12, 19], 820, 2.6),
    ridgeK(x, y, [19, 6.5], [31, 7.5], 480, 2.8),      // southern hills
    ridgeK(x, y, [34, 19], [40, 26], 640, 2.4),        // east hills
    peakK(x, y, [26.9, -5.4], 150, 1.1));              // Seal Isle hill
  z += z * 0.35 * (ridged(x / 3.2, y / 3.2) - 0.55);   // crags and gullies on the mountains, not on the plains
  z += 140 * fbm(n2, x / 4, y / 4) + 60 * fbm(n4, x / 1.5, y / 1.5, 4);
  const basin = Math.exp(-(((x - 25) / 6.5) ** 2 + ((y - 13.5) / 4) ** 2)); z = z * (1 - 0.75 * basin) + 250 * basin;
  const riv = ridgeK(x, y, [26, 14], [46, 13], 1, 1.3); z = z * (1 - 0.8 * riv) + (60 + 190 * clamp((46 - x) / 20, 0, 1)) * 0.8 * riv;
  for (const [px, py, pz, w] of SADDLES) { const s = Math.exp(-((x - px) ** 2 + (y - py) ** 2) / w ** 2); z = z * (1 - 0.85 * s) + pz * 0.85 * s; }
  const land = landK(x, y), cliff = clamp((8 - x) / 4, 0, 1) * (y > 8) + clamp((x - 40) / 3, 0, 1) * (y > 18);
  return land > 0 ? Math.max(z, 0) * Math.pow(clamp(land, 0, 1), 0.6 - 0.45 * clamp(cliff, 0, 1)) + 2 : -40 + 30 * land;
}
export const ground = (X, Y) => groundK(...K(X, Y));

// ---------------- the network of draft 1 ----------------
export const NODES = {
  H: { x: 44.0, y: 14.0, z: 6, name: 'Harbour Town', de: 'Hafenstadt', kind: 'harbour', note: 'start and finish, the story village' },
  L: { x: 41.5, y: 30.0, z: 45, name: 'Lighthouse Cape', de: 'Leuchtturm-Kap', kind: 'lighthouse' },
  N: { x: 24.0, y: 31.6, z: 8, name: 'North Bay', de: 'Fischerdorf Nordbucht', kind: 'fishing' },
  W: { x: 3.6, y: 21.0, z: 25, name: 'West Cape', de: 'Westkap', kind: 'cape' },
  SW: { x: 8.0, y: 5.0, z: 6, name: 'Southwest Harbour', de: 'Südwesthafen', kind: 'harbour' },
  S: { x: 26.0, y: 2.4, z: 4, name: 'South Beach', de: 'Südstrand', kind: 'beach' },
  B: { x: 26.0, y: 14.0, z: 262, name: 'Basin Village', de: 'Bergdorf im Becken', kind: 'village' },
  P1: { x: 19.0, y: 22.6, z: 1012, name: 'North Pass', de: 'Nordpass', kind: 'pass' },
  G: { x: 24.5, y: 24.2, z: 1480, name: 'Castle Summit', de: 'Burgberg', kind: 'castle', note: 'the siege' },
  P2: { x: 11.5, y: 15.5, z: 705, name: 'West Pass', de: 'Westpass', kind: 'pass' },
  P3: { x: 35.0, y: 21.5, z: 548, name: 'East Saddle', de: 'Ostsattel', kind: 'pass' },
  P4: { x: 24.0, y: 7.0, z: 385, name: 'South Saddle', de: 'Südsattel', kind: 'pass' },
  K: { x: 17.0, y: 11.0, z: 180, name: 'Monastery Plateau', de: 'Klosterplateau', kind: 'monastery' },
  T: { x: 26.5, y: -3.85, z: 8, name: 'Seal Isle', de: 'Robbeninsel', kind: 'harbour', note: 'end of the Long Bridge, time-trial loop' },
};
// [a, b, kind, winding (road length / straight line), via points km, name]. Coast edges follow the traced coast instead.
export const EDGES = [
  ['H', 'L', 'coast', 1.30, [[46.0, 20.0], [45.0, 26.0]], 'East Cliffs', 'Klippenküste Ost (Tunnel, Leuchtturm-Sprint)'],
  ['L', 'N', 'coast', 1.25, [[36.0, 32.6], [30.0, 33.0]], 'North Shore', 'Nordküste (Strände, Felsbögen)'],
  ['N', 'W', 'coast', 1.30, [[16.0, 32.0], [8.0, 28.0]], 'Fjord Coast', 'Nordwestküste (Fjord)'],
  ['W', 'SW', 'cliff', 1.30, [[2.2, 15.0], [3.5, 9.0]], 'West Cliffs', 'Steilküste West'],
  ['SW', 'S', 'coast', 1.20, [[14.0, 2.8], [20.0, 1.8]], 'Dune Coast', 'Südküste (Strände, Dünen)'],
  ['S', 'H', 'coast', 1.25, [[34.0, 3.0], [41.0, 7.0]], 'Vineyard Coast', 'Südostküste (Weinberge)'],
  ['H', 'B', 'valley', 1.25, [[39.0, 12.5], [33.0, 13.8]], 'River Valley', 'Flusstal (Mühlen, Ruderboote)'],
  ['B', 'P1', 'pass', 1.75, [[23.0, 17.0], [21.0, 20.5]], 'North Pass South Ramp', 'Nordpass Südrampe (Kehren)'],
  ['P1', 'N', 'pass', 1.70, [[20.0, 26.0], [22.5, 29.0]], 'North Pass North Ramp', 'Nordpass Nordrampe (Kehren, Wasserfälle)'],
  ['P1', 'G', 'summit', 1.45, [[21.5, 23.8]], 'Castle Road', 'Gipfelstraße zur Burg (Sackgasse)'],
  ['B', 'K', 'valley', 1.20, [[21.0, 12.0]], 'Monastery Valley', 'Hochtal zum Kloster'],
  ['K', 'P2', 'pass', 1.65, [[14.0, 13.5]], 'West Pass East Ramp', 'Westpass Ostrampe'],
  ['P2', 'W', 'pass', 1.60, [[8.0, 18.0], [5.5, 20.0]], 'West Pass West Ramp', 'Westpass Westrampe'],
  ['P2', 'SW', 'pass', 1.55, [[10.0, 10.0]], 'West Pass South Ramp', 'Westpass Südrampe'],
  ['B', 'P4', 'hills', 1.40, [[25.0, 10.5]], 'South Hills North Side', 'Südhügel Nordseite'],
  ['P4', 'S', 'hills', 1.45, [[25.0, 4.5]], 'South Hills Descent', 'Südhügel Abfahrt'],
  ['H', 'P3', 'hills', 1.50, [[40.0, 17.5]], 'East Saddle Climb', 'Ostsattel Auffahrt'],
  ['P3', 'L', 'hills', 1.45, [[38.0, 26.0]], 'East Saddle North Side', 'Ostsattel Nordseite'],
  ['S', 'T', 'bridge', 1.0, [[26.0, 1.2], [26.6, -1.0]], 'Long Bridge', 'Lange Brücke (5 km über das Meer)'],
  ['T', 'T', 'islet', 1.0, [], 'Seal Isle Loop', 'Robbeninsel-Runde (Zeitfahren)'],
].map(([a, b, kind, wind, via, name, de]) => ({ id: a + '-' + b, a, b, kind, wind, via, name, de }));
// what the existing world builder draws around each kind of road
const LAND = { coast: 'coast', cliff: 'cliff', valley: 'river', pass: 'serp', summit: 'serp', hills: 'valley', bridge: 'coast', islet: 'coast' };

// ---------------- coast ring: the traced coastline 600 m inland ----------------
const RING_N = 1440;
function traceRing() {
  const raw = [];
  for (let k = 0; k < RING_N; k++) {
    const t = 2 * Math.PI * k / RING_N, dx = Math.cos(t), dy = Math.sin(t); let rr = 0, last = 0;
    while (rr < 40) { if (landK(CX + dx * rr, CY + dy * rr) > 0) last = rr; else if (rr - last > 1.5) break; rr += 0.025; }
    raw.push(last);
  }
  const k = 20, sm = raw.map((_, i) => { let s = 0; for (let j = -k; j <= k; j++) s += raw[(i + j + RING_N) % RING_N]; return s / (2 * k + 1); });
  return sm.map((r, i) => { const t = 2 * Math.PI * i / RING_N, rr = Math.min(r, raw[i] + 0.2) - 0.6; return [CX + Math.cos(t) * rr, CY + Math.sin(t) * rr]; });
}
const RING = traceRing();
const ringIdx = n => Math.round(((Math.atan2(n.y - CY, n.x - CX) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * RING_N) % RING_N;
for (const k of ['H', 'L', 'N', 'W', 'SW', 'S']) { const n = NODES[k]; n.ring = ringIdx(n); [n.x, n.y] = RING[n.ring]; }
function ringPath(a, b) {
  const ka = NODES[a].ring, kb = NODES[b].ring, step = (kb - ka + RING_N) % RING_N < RING_N / 2 ? 1 : -1, P = [];
  for (let k = ka; k !== kb; k = (k + step + RING_N) % RING_N) P.push(RING[k]);
  P.push(RING[kb]); return P;
}

// ---------------- geometry helpers (metres) ----------------
function spline(P, every = 5) {
  const out = [], c = k => P[clamp(k, 0, P.length - 1)];
  for (let i = 0; i < P.length - 1; i++) {
    const [p0, p1, p2, p3] = [c(i - 1), c(i), c(i + 1), c(i + 2)], m = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / every));
    for (let k = 0; k < m; k++) { const t = k / m, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3))); }
  }
  out.push(P[P.length - 1]); return out;
}
const plen = P => { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return s; };
function resample(P) {
  const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = cum[cum.length - 1], n = Math.max(2, Math.round(L / STEP) + 1), out = [];
  for (let k = 0, i = 0; k < n; k++) { const d = k * L / (n - 1); while (i < P.length - 2 && cum[i + 1] < d) i++;
    const t = Math.min(1, (d - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i])); out.push([P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t]); }
  return out;
}
/** zigzag from A to B with n bends whose swing is solved so the spline is `len` metres long (switchbacks on a pass,
 *  lazy bends on hills and in valleys) */
function wind(A, B, len, n, seed = 1) {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (len <= L * 1.02 || n < 2) return [A, B];
  const u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], p = [-u[1], u[0]], r = rng(seed * 7919 + 13);
  // irregular, like a real pass (Freddy 18.11.: "zu gleichmäßig"): packs of 2-5 tight hairpins, then a long traverse;
  // every leg its own length and swing, the zigzag's axis drifts across the slope, now and then a bend on the same side
  const gaps = [], amp = [], side = []; let pack = 0, sd = 1;
  for (let k = 1; k < n; k++) {
    if (pack <= 0) { pack = 2 + Math.floor(r() * 4); gaps.push(1.6 + r() * 1.8); amp.push(1.0 + r() * 0.5); }
    else { gaps.push(0.45 + r() * 0.5); amp.push(0.45 + r() * 0.55); }
    pack--; if (r() > 0.1) sd = -sd; side.push(sd);
  }
  gaps.push(0.8 + r()); const tot = gaps.reduce((x, y) => x + y, 0); let acc = 0; const at = gaps.slice(0, -1).map(g => (acc += g) / tot);
  const ph = r() * 6.28, fr = 0.6 + r() * 0.9;
  const build = w => { const P = [A]; for (let k = 0; k < at.length; k++) { const s = at[k], fade = Math.min(1, s * 4, (1 - s) * 4);
      const o = (side[k] * w / 2 * amp[k] + w * 0.35 * Math.sin(s * Math.PI * fr * 2 + ph)) * fade;
      P.push([A[0] + u[0] * L * s + p[0] * o, A[1] + u[1] * L * s + p[1] * o]); } P.push(B); return spline(P); };
  let lo = 0, hi = len; for (let it = 0; it < 30; it++) { const w = (lo + hi) / 2; if (plen(build(w)) < len) lo = w; else hi = w; }
  return build(lo);
}

// ---------------- roads ----------------
function edgePath(e) {
  if (e.kind === 'islet') { const [cx, cy, rx, ry] = ISLE, P = []; for (let a = 0; a <= 360; a += 3) { const t = (90 - a) * Math.PI / 180; P.push(M(cx + Math.cos(t) * (rx - 0.45) * (1 + 0.05 * Math.sin(a / 19)), cy + 0.45 * 0 + Math.sin(t) * (ry - 0.45))); }
    return resample(spline(P, 10)); } // starts and ends at the north shore (the bridge head)
  if (e.kind === 'bridge') { const C = [NODES[e.a], ...e.via.map(([x, y]) => ({ x, y })), NODES[e.b]].map(n => M(n.x, n.y)); return resample(spline(C, 10)); }
  if (e.kind === 'coast' || e.kind === 'cliff') return resample(spline(ringPath(e.a, e.b).filter((_, i, a) => i % 4 === 0 || i === a.length - 1).map(p => M(...p)), 10));
  const C = [NODES[e.a], ...e.via.map(([x, y]) => ({ x, y })), NODES[e.b]].map(n => M(n.x, n.y));
  const straight = plen(C), target = straight * e.wind, P = [], Ls = [];
  for (let i = 0; i < C.length - 1; i++) Ls.push(Math.hypot(C[i + 1][0] - C[i][0], C[i + 1][1] - C[i][1]));
  // a pass: lazy bends on the lower half, the switchbacks packed into the steep upper half (how real passes look);
  // hills / valleys: lazy bends all the way
  const climb = e.kind === 'pass' || e.kind === 'summit', upEnd = NODES[e.b].z >= NODES[e.a].z;
  let acc = 0; const upper = Ls.map(L => { const mid = (acc + L / 2) / straight; acc += L; return climb && (upEnd ? mid > 0.45 : mid < 0.55); });
  const lowLen = Ls.reduce((s, L, i) => s + (upper[i] ? 0 : L), 0), upLen = straight - lowLen;
  const lowW = climb && upLen > 0 ? 1.15 : e.wind, upW = upLen > 0 ? Math.max(1.1, (target - lowLen * lowW) / upLen) : e.wind;
  for (let i = 0; i < C.length - 1; i++) {
    const len = Ls[i] * (upper[i] ? upW : lowW);
    const every = upper[i] ? 430 : { summit: 900, pass: 1400, hills: 1500, valley: 1800 }[e.kind] || 1800, n = Math.max(2, Math.round(len / every));
    const part = wind(C[i], C[i + 1], len, n, EDGES.indexOf(e) * 31 + i); P.push(...(i ? part.slice(1) : part));
  }
  void target; return resample(P);
}
// heights: draft 1's blend of a straight ramp between the junction heights and the smoothed ground (mix by kind),
// then grades above maxG shaved off with both ends held
function profile(e, P) {
  if (e.kind === 'bridge') { // the deck: ground on land, over the sea a long gentle arch, 30 m high in the middle for the ships
    const n = P.length, a = NODES[e.a], b = NODES[e.b], wet = P.map(p => ground(...p) <= 0.5); const i0 = wet.indexOf(true), i1 = wet.lastIndexOf(true);
    return P.map((p, i) => { const base = lerp(a.z, b.z, i / (n - 1)); if (i0 < 0) return base; const t = clamp((i - i0 + 25) / (i1 - i0 + 50), 0, 1);
      return Math.max(base, 6 + 24 * Math.pow(Math.sin(Math.PI * t), 0.6)); }).map((v, i, z) => i && i < n - 1 ? (z[i - 1] + v + z[i + 1]) / 3 : v);
  }
  const n = P.length, a = NODES[e.a], b = NODES[e.b];
  const raw = P.map(p => ground(...p)), sig = 30, rad = sig * 3;
  const tz = raw.map((_, i) => { let s = 0, ws = 0; for (let k = -rad; k <= rad; k++) { const j = clamp(i + k, 0, n - 1), w = Math.exp(-(k * k) / (2 * sig * sig)); s += raw[j] * w; ws += w; } return s / ws; });
  const mix = { islet: 0.9, coast: 0.9, cliff: 0.9, valley: 0.7, pass: 0.6, summit: 0.5, hills: 0.75 }[e.kind];
  let z = tz.map((t, i) => { const lin = lerp(a.z, b.z, i / (n - 1)), f = Math.sin(Math.PI * i / (n - 1)); return lin * (1 - mix * f) + t * mix * f; });
  z = z.map(v => Math.max(3, v));
  if (Math.abs(b.z - a.z) > 200) { // a real climb: never a dip on the way up (the trainer would go easy mid-pass)
    const up = b.z > a.z; for (let i = 1; i < n; i++) z[i] = up ? Math.max(z[i], z[i - 1]) : Math.min(z[i], z[i - 1]);
    const lo = z[0], hi = z[n - 1]; z = z.map((v, i) => lerp(a.z, b.z, (v - lo) / ((hi - lo) || 1)) * 0.85 + lerp(a.z, b.z, i / (n - 1)) * 0.15); }
  const maxG = ({ pass: 0.09, summit: 0.095, hills: 0.09 }[e.kind] || 0.08) * STEP;
  for (let it = 0; it < 6; it++) {
    for (let i = 1; i < n; i++) z[i] = clamp(z[i], z[i - 1] - maxG, z[i - 1] + maxG); z[n - 1] = b.z;
    for (let i = n - 2; i >= 0; i--) z[i] = clamp(z[i], z[i + 1] - maxG, z[i + 1] + maxG); z[0] = a.z;
  }
  return z;
}
export function buildNetwork() {
  return EDGES.map(e => {
    const P = edgePath(e), ele = profile(e, P);
    let gain = 0, loss = 0, maxG = 0, cut = 0; for (let i = 1; i < ele.length; i++) { const d = ele[i] - ele[i - 1]; if (d > 0) gain += d; else loss -= d; }
    for (let i = 0; i + 10 < ele.length; i++) maxG = Math.max(maxG, Math.abs(ele[i + 10] - ele[i]) / (10 * STEP) * 100);
    for (let i = 0; i < P.length; i += 5) { const d = ground(...P[i]) - ele[i]; if (Math.abs(d) > Math.abs(cut)) cut = d; }
    return { ...e, P, ele, len: (P.length - 1) * STEP, gain, loss, maxG, cut };
  });
}

// ---------------- roads first, terrain after: the ground is lifted / lowered towards the roads ----------------
// A smooth correction field (every 50 m of road pulls the ground within ~1.5 km towards its height), so a pass road
// runs on a real mountain flank instead of in a 300 m trench or on a 300 m dam. The 70 m corridor then cuts the bench.
function corrLevel(edges, base, CN, SIG) {
  const CS = SIZE / CN, num = new Float32Array(CN * CN), den = new Float32Array(CN * CN), rc = Math.ceil(SIG * 2.6 / CS);
  for (const e of edges) for (let i = 0; i < e.P.length; i += 3) {
    if (e.kind === 'bridge' && ground(...e.P[i]) <= 0.5) continue; // the sea stays under the bridge
    const [x, y] = e.P[i], d = e.ele[i] - ground(x, y) - base(x, y), c0 = Math.floor(x / CS), r0 = Math.floor(y / CS);
    for (let r = r0 - rc; r <= r0 + rc; r++) for (let c = c0 - rc; c <= c0 + rc; c++) { if (r < 0 || c < 0 || r >= CN || c >= CN) continue;
      const q = ((c + 0.5) * CS - x) ** 2 + ((r + 0.5) * CS - y) ** 2, w = Math.exp(-q / (SIG * SIG)); num[r * CN + c] += w * d; den[r * CN + c] += w; }
  }
  const C = new Float32Array(CN * CN); for (let j = 0; j < CN * CN; j++) C[j] = num[j] / (den[j] + 0.4);
  return (X, Y) => { const px = clamp(X / CS - 0.5, 0, CN - 1.001), py = clamp(Y / CS - 0.5, 0, CN - 1.001), i = Math.floor(px), j = Math.floor(py), u = px - i, v = py - j, k = j * CN + i;
    return base(X, Y) + (C[k] * (1 - u) + C[k + 1] * u) * (1 - v) + (C[k + CN] * (1 - u) + C[k + CN + 1] * u) * v; };
}
/** two scales: the mountain is moved under the road (650 m), then the slopes right beside it (170 m) */
export function correction(edges) { const c1 = corrLevel(edges, () => 0, 1024, 650); return corrLevel(edges, c1, 2048, 170); }

// ---------------- height grid with the roads cut in ----------------
export function buildGrid(edges, corr = correction(edges)) {
  const H = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const X = (c + 0.5) * PX, Y = (r + 0.5) * PX, g = ground(X, Y);
    H[r * N + c] = g <= 0 ? g : Math.max(0.5, g + corr(X, Y)); } // the coastline stays where it is
  // corridor: nearest road sample per pixel within RAD; road bench, then the cut/fill slope blends into the ground
  // the slope beside the bench is as wide as the height step needs (no 100 m walls next to the road)
  const RAD = 220, best = new Float32Array(N * N).fill(1e9), be = new Float32Array(N * N), k = Math.ceil(RAD / PX);
  for (const e of edges) for (let i = 0; i < e.P.length; i++) {
    if (e.kind === 'bridge' && ground(...e.P[i]) <= 0.5) continue;
    const [x, y] = e.P[i], c0 = Math.floor(x / PX), r0 = Math.floor(y / PX);
    for (let r = r0 - k; r <= r0 + k; r++) for (let c = c0 - k; c <= c0 + k; c++) { if (r < 0 || c < 0 || r >= N || c >= N) continue;
      const d = Math.hypot((c + 0.5) * PX - x, (r + 0.5) * PX - y), j = r * N + c; if (d < best[j]) { best[j] = d; be[j] = e.ele[i]; } }
  }
  for (let j = 0; j < N * N; j++) if (best[j] < RAD) { const w = Math.min(RAD, 45 + Math.abs(H[j] - be[j]) * 1.4); if (best[j] < w) H[j] = lerp(Math.max(be[j] - 0.3, 0.6), H[j], smooth(6, w, best[j])); }
  // castle summit: a flat top for the keep, just above the road's end
  const [cx, cy] = M(NODES.G.x, NODES.G.y), top = NODES.G.z + 4;
  for (let r = Math.floor((cy - 300) / PX); r < (cy + 300) / PX; r++) for (let c = Math.floor((cx - 300) / PX); c < (cx + 300) / PX; c++) {
    const d = Math.hypot((c + 0.5) * PX - cx, (r + 0.5) * PX - cy); if (d < 280) { const j = r * N + c; H[j] = lerp(top, H[j], smooth(80, 280, d)); } }
  const out = new Uint16Array(N * N); for (let j = 0; j < N * N; j++) out[j] = clamp(Math.round(H[j] * 10), 0, 65535);
  return out;
}

// ---------------- fixed tours (until junction choice is in the game), written like kueste60.json ----------------
// the example rounds of draft 1, as node sequences
export const TOURS = {
  insel_feierabend: { name: 'Island: East Saddle', via: ['H', 'P3', 'L', 'H'], what: 'one climb over the East Saddle, back along the cliffs' },
  insel_suedsattel: { name: 'Island: South Saddle', via: ['H', 'B', 'P4', 'S', 'H'], what: 'river valley, basin village, South Saddle, beach, coast' },
  insel_westpass: { name: 'Island: West Pass', via: ['H', 'B', 'K', 'P2', 'SW', 'S', 'H'], what: 'monastery and the long West Pass' },
  insel_bruecke: { name: 'Island: Long Bridge', via: ['H', 'S', 'T', 'T', 'S', 'H'], what: 'along the vineyards, 5 km over the sea to Seal Isle, round the isle and back' },
  insel_runde: { name: 'Island: Coast Loop', via: ['H', 'L', 'N', 'W', 'SW', 'S', 'H'], what: 'the whole coast ring' },
  insel_koenig: { name: 'Island: Queen Stage', via: ['H', 'B', 'P1', 'G', 'P1', 'N', 'L', 'H'], what: 'North Pass, the castle on the summit, North Bay, lighthouse' },
};
/** stretches of a tour over open water (the existing renderer builds deck, parapets and piers there): [[from_m, to_m]] */
function wetRuns(P) { const out = []; let a = -1; P.forEach((p, i) => { const w = ground(...p) <= 0.5; if (w && a < 0) a = i; if ((!w || i === P.length - 1) && a >= 0) { if (i - a > 3) out.push([Math.max(0, a - 3) * STEP, (i + 2) * STEP]); a = -1; } }); return out; }
function tourJSON(T, edges) {
  let P = [], ele = [], at = 0; const places = [], nodes = [], kinds = [];
  for (let s = 0; s < T.via.length - 1; s++) {
    const a = T.via[s], b = T.via[s + 1], e = edges.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    if (!e) throw new Error(`no road ${a}-${b}`);
    const fw = e.a === a, p = fw ? e.P : [...e.P].reverse(), el = fw ? e.ele : [...e.ele].reverse(), k0 = P.length ? 1 : 0;
    P = P.concat(p.slice(k0)); ele = ele.concat(el.slice(k0));
    kinds.push({ from_m: at, to_m: at + e.len, kind: e.kind, land: LAND[e.kind], name: e.name, edge: e.id, dir: fw ? 1 : -1 });
    at += e.len; const nd = NODES[b];
    if (['village', 'harbour', 'fishing', 'monastery'].includes(nd.kind)) places.push({ name: nd.name, from_m: Math.max(0, at - 300), to_m: at + 300 });
    nodes.push({ id: b, name: nd.name, at_m: at });
  }
  const s0 = P[0], sea_side = P.map(([x, y], i) => { // sea within 700 m on the left (-1) or right (1) of travel
    const j = Math.min(P.length - 1, i + 1), k = Math.max(0, i - 1), tx = P[j][0] - P[k][0], ty = P[j][1] - P[k][1], l = Math.hypot(tx, ty) || 1;
    const rx = -ty / l, ry = tx / l; return ground(x - rx * 700, y - ry * 700) <= 0 ? -1 : ground(x + rx * 700, y + ry * 700) <= 0 ? 1 : 0; });
  return { name: T.name, file: 'insel.bin', n: N, pixel_m: PX, size_m: SIZE, sat: 'insel_sat.jpg', island: true, what: T.what,
    format: 'Uint16 little-endian, decimetres, sea = 0, row 0 = north, column 0 = west (tools/island.mjs)',
    start_px: [s0[0] / PX, s0[1] / PX], route_step_m: STEP,
    route: P.map(([x, y]) => [+(x - s0[0]).toFixed(1), +(y - s0[1]).toFixed(1)]), ele: ele.map(v => +v.toFixed(1)),
    places, sea_side, nodes, roads: kinds, tunnels: [], bridges: wetRuns(P) };
}

// ---------------- main ----------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now(), edges = buildNetwork(), corr = correction(edges); let total = 0, ring = 0;
  for (const e of edges) { e.cut = 0; for (let i = 0; i < e.P.length; i += 5) { const d = ground(...e.P[i]) + corr(...e.P[i]) - e.ele[i]; if (Math.abs(d) > Math.abs(e.cut)) e.cut = d; } }
  for (const e of edges) { total += e.len; if (e.kind === 'coast' || e.kind === 'cliff') ring += e.len;
    console.log(`${e.id.padEnd(6)} ${e.name.padEnd(24)} ${(e.len / 1000).toFixed(1).padStart(5)} km  +${String(Math.round(e.gain)).padStart(4)} / -${String(Math.round(e.loss)).padStart(4)} m  max ${e.maxG.toFixed(1).padStart(4)} %  cut ${Math.round(e.cut)} m`); }
  console.log(`network ${(total / 1000).toFixed(1)} km, coast ring ${(ring / 1000).toFixed(1)} km`);
  if (!process.argv.includes('--stats')) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(new URL('insel.bin', OUT), Buffer.from(buildGrid(edges, corr).buffer));
    const r = v => +v.toFixed(1);
    fs.writeFileSync(new URL('insel_net.json', OUT), JSON.stringify({ name: 'Island', n: N, pixel_m: PX, size_m: SIZE, step_m: STEP,
      nodes: Object.fromEntries(Object.entries(NODES).map(([k, v]) => [k, { name: v.name, de: v.de, kind: v.kind, z: v.z, p: M(v.x, v.y).map(r) }])),
      edges: edges.map(e => ({ id: e.id, a: e.a, b: e.b, kind: e.kind, land: LAND[e.kind], name: e.name, de: e.de, len: e.len, gain: Math.round(e.gain), loss: Math.round(e.loss), maxGrade: r(e.maxG), P: e.P.map(p => p.map(r)), ele: e.ele.map(r) })) }));
    for (const [id, T] of Object.entries(TOURS)) { const j = tourJSON(T, edges); fs.writeFileSync(new URL(id + '.json', OUT), JSON.stringify(j));
      let g = 0; for (let i = 1; i < j.ele.length; i++) g += Math.max(0, j.ele[i] - j.ele[i - 1]); console.log(`${id}: ${(j.route.length * STEP / 1000).toFixed(1)} km, +${Math.round(g)} m`); }
    console.log(`written in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}
