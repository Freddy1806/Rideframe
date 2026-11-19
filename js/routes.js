// Built-in designed routes (no footage): profile built from timed segments so that
// climbs take a planned number of minutes at threshold power.
import { STEP, finishTrack } from './track.js';
import { defaultParams, powerFor } from './physics.js';

function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** Steady speed (m/s) for power P on grade g. */
export function speedFor(P, g, p) {
  let lo = 0.5, hi = 30;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (powerFor(m, g, p) > P) hi = m; else lo = m; }
  return Math.min(lo, g < -2 ? 15 : 30); // riders brake a bit on long descents
}

// Designed for FTP 259 W, 87 + 8.5 kg (Freddy, Strava Oct 2026). Records stay comparable
// because the route itself never changes; lighter/stronger riders just climb faster.
export const COAST_DESIGN = { ftp: 259, riderKg: 87, bikeKg: 8.5 };

// land: what the world looks like around the road
//  harbour/village = houses, coast = sea on the left at road level, cliff = sea far below on the left,
//  serp = switchbacks up a mountain flank, valley = between two slopes
export const COAST_SEGMENTS = [
  { kind: 'flat', min: 10, watt: 0.72, wobble: 1.2, name: 'Warm-up at the fishing harbour', land: 'coast', village: [0.03, 0.28] },
  { kind: 'climb', min: 8, grade: 6.0, name: 'Church tower ramp', land: 'serp', top: 'church' },
  { kind: 'recover', min: 5, name: 'Descent to the bay', land: 'coast' },
  { kind: 'climb', min: 10, grade: 5.0, name: 'Mill pass', land: 'valley', top: 'mill' },
  { kind: 'recover', min: 5, name: 'Descent through the village', land: 'coast', village: [0.15, 0.9] },
  { kind: 'climb', min: 12, grade: 4.5, name: 'Cliff road', land: 'cliff', top: 'lookout' },
  { kind: 'recover', min: 5, name: 'Descent to the beach', land: 'coast', beach: true },
  { kind: 'climb', min: 10, grade: 7.0, name: 'Castle hill', land: 'serp', top: 'castle' },
  { kind: 'recover', min: 4, name: 'Descent to the finish', land: 'coast' },
  { kind: 'flat', min: 8, watt: 0.6, wobble: 0.8, name: 'Cool-down on the coast', land: 'coast', village: [0.7, 1.0] },
];

// heading change per 10 m sample for a switchback climb: turn east, legs east/west with hairpins, back north
function serpPlan(seg, r, HP = 7) {
  const n = Math.round((seg.to - seg.from) / STEP) + 1, rate = new Float32Array(n);
  const turn = (at, len, total) => { for (let k = 0; k < len && at + k < n; k++) rate[at + k] += total / len; };
  const E = 14; // samples for entry/exit turns; HP for the hairpins (7: ~70 m, radius ~22 m, legs ~44 m apart)
  turn(0, E, Math.PI / 2);
  let i = E, sign = -1, hairpins = 0;
  while (true) {
    const leg = 26 + Math.floor(r() * 14);
    if (i + leg + HP + E + 20 >= n) break;
    i += leg; turn(i, HP, sign * Math.PI); i += HP; sign = -sign; hairpins++;
  }
  // heading now east (+π/2) after even hairpins, west (−π/2) after odd -> turn back north
  turn(n - E, E, hairpins % 2 ? Math.PI / 2 : -Math.PI / 2);
  for (let k = E; k < n - E; k++) rate[k] += 0.01 * Math.sin(k / 5);
  return rate;
}

export function makeCoastTrack() { return makeDesignedTrack(COAST_SEGMENTS, { seed: 29 }); }

// ---------------- more designed routes (Freddy, plan package 7) ----------------
// short round: two short climbs, three villages, ~30 km
export const SHORT_SEGMENTS = [
  { kind: 'flat', min: 14, watt: 0.7, wobble: 1.0, name: 'Harbour Loop', land: 'coast', village: [0.05, 0.4] },
  { kind: 'climb', min: 6, grade: 5.0, name: 'Chapel ramp', land: 'serp', top: 'church' },
  { kind: 'recover', min: 5, name: 'Descent to the fjord', land: 'coast' },
  { kind: 'flat', min: 12, watt: 0.72, wobble: 1.4, name: 'Village street', land: 'valley', village: [0.2, 0.8] },
  { kind: 'climb', min: 5, grade: 6.5, name: 'Mill hump', land: 'valley', top: 'mill' },
  { kind: 'recover', min: 4, name: 'Descent to the beach', land: 'coast', beach: true },
  { kind: 'flat', min: 10, watt: 0.62, wobble: 0.8, name: 'Cool-down in the harbour', land: 'coast', village: [0.55, 1.0] },
];
// river valley: wide river on the left with rowing boats and anglers, ~40 km
export const RIVER_SEGMENTS = [
  { kind: 'flat', min: 13, watt: 0.7, wobble: 0.8, name: 'Along the river', land: 'river', village: [0.1, 0.35] },
  { kind: 'flat', min: 15, watt: 0.75, wobble: 1.6, name: "Anglers' bank", land: 'river' },
  { kind: 'climb', min: 7, grade: 5.5, name: 'Vineyard ramp', land: 'valley', top: 'lookout' },
  { kind: 'recover', min: 5, name: 'Back to the bank', land: 'river' },
  { kind: 'flat', min: 14, watt: 0.78, wobble: 1.2, name: 'River villages', land: 'river', village: [0.3, 0.75] },
  { kind: 'climb', min: 6, grade: 6.0, name: 'Bridge hill', land: 'serp', top: 'church' },
  { kind: 'recover', min: 5, name: 'Descent to the estuary', land: 'river' },
  { kind: 'flat', min: 8, watt: 0.6, wobble: 0.6, name: 'Cool-down at the estuary', land: 'coast', village: [0.6, 1.0] },
];
// the big mountain day: ~1800 m of switchbacks, short plateaus in between, summit finish on the pass
export const PASS_SEGMENTS = [
  { kind: 'flat', min: 8, watt: 0.65, wobble: 0.8, name: 'Warm-up in the valley', land: 'valley', village: [0.3, 0.9] },
  { kind: 'climb', gain: 450, grade: 6.5, watt: 0.8, name: 'First hairpins', land: 'serp' },
  { kind: 'plateau', min: 4, name: 'Alpine meadow', land: 'valley' },
  { kind: 'climb', gain: 450, grade: 7.0, watt: 0.8, name: 'Forest hairpins', land: 'serp' },
  { kind: 'plateau', min: 5, name: 'Mountain village', land: 'valley', village: [0.15, 0.85] },
  { kind: 'climb', gain: 450, grade: 7.5, watt: 0.8, name: 'Rock hairpins', land: 'serp' },
  { kind: 'plateau', min: 3, name: 'High pasture', land: 'valley' },
  { kind: 'climb', gain: 450, grade: 8.0, watt: 0.85, name: 'Sky Ladder', land: 'serp', top: 'pass' },
  { kind: 'plateau', min: 3, name: 'Summit of the pass', land: 'valley' },
];
// misty monastery mountain in an (original) East Asian style: bamboo, pagodas, lanterns, monks training, ~35 km
export const TEMPLE_SEGMENTS = [
  { kind: 'flat', min: 10, watt: 0.68, wobble: 1.0, name: 'Bamboo valley', land: 'river', style: 'asia', temple: [0.4, 0.8] },
  { kind: 'climb', min: 9, grade: 6.0, name: 'Lantern path', land: 'serp', style: 'asia', top: 'pagode' },
  { kind: 'plateau', min: 4, name: 'Monastery yard', land: 'valley', style: 'asia', temple: [0.1, 0.9] },
  { kind: 'climb', min: 10, grade: 7.0, name: 'Thousand steps', land: 'serp', style: 'asia', top: 'pagode' },
  { kind: 'recover', min: 6, name: 'Descent through the misty forest', land: 'river', style: 'asia' },
  { kind: 'climb', min: 7, grade: 5.0, name: "Dragon's back", land: 'valley', style: 'asia', top: 'lookout' },
  { kind: 'recover', min: 5, name: 'Descent to the river', land: 'river', style: 'asia' },
  { kind: 'flat', min: 7, watt: 0.6, wobble: 0.8, name: 'Cool-down at the teahouse', land: 'river', style: 'asia', temple: [0.5, 1.0] },
];

// the long one (Freddy 12.11.: "100 km, 300-400 Hm, relativ geradeaus, an der Küste lang"): coast, beaches, fjord, villages,
// five short waves (no interval targets, it is an endurance ride), ~100 km / ~400 Hm
const KF = (min, name, extra = {}) => ({ kind: 'flat', min, watt: 0.7, wobble: 0.5, name, land: 'coast', ...extra });
const KW = (gain, name, top) => [{ kind: 'climb', gain, grade: 3.5, watt: 0.8, interval: false, name, land: 'cliff', top }, { kind: 'recover', min: 3, name: 'Descent from ' + name, land: 'coast' }];
export const LONG_SEGMENTS = [
  KF(16, 'Warm-up at the fishing harbour', { village: [0.05, 0.35] }), ...KW(25, 'Lighthouse rise', 'lookout'),
  KF(18, 'Beach road', { beach: true }), KF(14, 'Fjord shore', { land: 'river', village: [0.3, 0.7] }), ...KW(35, 'Church hill', 'church'),
  KF(20, 'Cliff view', { land: 'cliff' }), KF(14, 'Mill village', { village: [0.2, 0.8] }), ...KW(30, 'Mill rise', 'mill'),
  KF(18, 'Dune path', { beach: true, wobble: 0.7 }), KF(16, 'Harbour town', { village: [0.1, 0.9] }), ...KW(40, 'Castle rise', 'castle'),
  KF(24, 'Long coast straight', { wobble: 0.4 }), ...KW(25, 'Last rise', 'lookout'), KF(14, 'Cool-down at the harbour', { village: [0.5, 1.0], watt: 0.62 }),
];

/** The built-in designed routes beside the Felsenküste (id -> name, subtitle, segments, seed). */
export const DESIGNED = {
  kurz: { name: 'Harbour Loop', place: 'Short loop · 2 short climbs · harbour and villages', segs: SHORT_SEGMENTS, seed: 31 },
  fluss: { name: 'River Valley', place: 'Along the river · rowing boats and anglers · 2 climbs', segs: RIVER_SEGMENTS, seed: 37 },
  pass: { name: 'Sky Ladder', place: 'Queen stage · 4 switchback climbs · summit finish on the pass', segs: PASS_SEGMENTS, seed: 41 },
  lang: { name: 'Coast Classic', place: 'Long coast loop · almost flat, five short rises · beaches, fjord, villages', segs: LONG_SEGMENTS, seed: 47 },
  kloster: { name: 'Misty Monastery', place: 'Bamboo, pagodas, lanterns · monks training by the road', segs: TEMPLE_SEGMENTS, seed: 43 },
};
export function makeBuiltinTrack(id) { const D = DESIGNED[id]; if (!D) return null; return { ...makeDesignedTrack(D.segs, { seed: D.seed, hairpin: 10 }), name: D.name }; } // wider hairpins: the legs stay ~64 m apart, no terrain between them pokes through

/** A designed route from timed segments (flat / climb / recover / plateau). Climbs last `min` minutes at `watt`×FTP
 *  (default threshold) or climb `gain` metres. A recover drops back to the water, a plateau keeps the height. */
export function makeDesignedTrack(SEGS, { seed = 29, theme = 'coast', hairpin = 7 } = {}) {
  const d0 = COAST_DESIGN, p = defaultParams(d0);
  const alt = [], segs = [];
  let e = 4; // metres above sea
  const push = (grade) => { e += grade / 100 * STEP; alt.push(Math.max(2, e)); };
  const r = rng(seed);
  alt.push(e);
  for (const s of SEGS) {
    const from = (alt.length - 1) * STEP;
    const extra = { land: s.land, village: s.village, beach: s.beach, style: s.style, temple: s.temple };
    if (s.kind === 'flat') {
      const v = speedFor(d0.ftp * s.watt, 0, p), n = Math.round(v * s.min * 60 / STEP);
      const ph = r() * 6;
      for (let i = 0; i < n; i++) push(s.wobble * Math.sin(i / 23 + ph) + 0.6 * Math.sin(i / 7.3 + ph * 2));
    } else if (s.kind === 'climb') {
      // ~0.4 km lead-in at 1 % rising to the grade, then the steady interval grade with mild ±0.6 % texture
      for (let i = 0; i < 40; i++) push(1 + i / 40 * (s.grade - 1));
      const w = s.watt || 1, v = speedFor(d0.ftp * w, s.grade, p);
      const n = s.gain ? Math.round(s.gain / (s.grade / 100 * STEP)) : Math.round(v * s.min * 60 / STEP);
      const st = (alt.length - 1) * STEP;
      for (let i = 0; i < n; i++) push(s.grade + 0.6 * Math.sin(i / 11) + 0.3 * Math.sin(i / 4.1));
      const minutes = s.min || Math.round(n * STEP / v / 60);
      segs.push({ name: s.name, from: st, to: (alt.length - 1) * STEP, minutes, grade: s.grade, interval: s.interval !== false, watt: w, top: s.top, leadIn: st - from, ...extra });
      for (let i = 0; i < 12; i++) push(1.5 - i / 8); // short false-flat at the top
      continue;
    } else if (s.kind === 'recover') {
      // drop back to the water: descent at ~-5 %, rest of the time flat road at easy power
      const drop = Math.max(0, e - 6), dg = -5.2;
      const nDesc = Math.round(drop / (-dg / 100 * STEP));
      for (let i = 0; i < nDesc; i++) push(dg + 0.8 * Math.sin(i / 9));
      const tDesc = nDesc * STEP / speedFor(60, dg, p);
      const left = Math.max(60, s.min * 60 - tDesc);
      const v = speedFor(d0.ftp * 0.55, 0, p), n = Math.round(v * left / STEP);
      for (let i = 0; i < n; i++) push(0.4 * Math.sin(i / 13));
    } else if (s.kind === 'plateau') { // high up: easy rolling road, the height stays
      const v = speedFor(d0.ftp * 0.55, 0, p), n = Math.round(v * s.min * 60 / STEP), ph = r() * 6;
      for (let i = 0; i < n; i++) push(1.2 * Math.sin(i / 17 + ph) + 0.4 * Math.sin(i / 6.1));
    }
    segs.push({ name: s.name, from, to: (alt.length - 1) * STEP, ...extra });
  }
  const n = alt.length;
  // layout: heading 0 = north, sea to the west (left). Switchbacks climb a west-facing flank.
  const head = new Float32Array(n);
  let h = 0;
  const segAt = d => segs.find(s => d >= s.from && d < s.to) || segs[segs.length - 1];
  for (let i = 0; i < n; i++) {
    const d = i * STEP, seg = segAt(d);
    if (seg.land === 'serp' && !seg._plan) seg._plan = serpPlan(seg, r, hairpin);
    let dh;
    if (seg.land === 'serp') dh = seg._plan[Math.min(seg._plan.length - 1, Math.round((d - seg.from) / STEP))];
    else {
      const wig = seg.land === 'valley' ? 0.035 : seg.land === 'cliff' ? 0.028 : seg.land === 'river' ? 0.03 : 0.02;
      dh = wig * Math.sin(i / 31 + 1.3) + 0.6 * wig * Math.sin(i / 11.7) - (h - 0) * 0.02;
    }
    h += dh; head[i] = h;
  }
  const lat = [], lon = [], curve = [], time = [];
  let la = 68.08, lo = 13.2;
  for (let i = 0; i < n; i++) {
    curve.push(Math.max(-0.15, Math.min(0.15, i ? head[i] - head[i - 1] : 0)));
    lat.push(la); lon.push(lo);
    la += Math.cos(head[i]) * STEP / 111320; lo += Math.sin(head[i]) * STEP / (111320 * Math.cos(la * Math.PI / 180));
  }
  const tmp = finishTrack({ length: (n - 1) * STEP, time: alt.map((_, i) => i), lat, lon, altRaw: alt, eleSource: 'dem' });
  // "footage" speed: a rider at the planned powers (the interval power on climbs)
  let t = 0;
  for (let i = 0; i < n; i++) {
    time.push(t);
    const d = i * STEP, g = tmp.grade[i];
    const iv = segs.find(s => s.interval && d >= s.from && d < s.to);
    const P = iv ? d0.ftp * (iv.watt || 1) : g < -1.5 ? 60 : d0.ftp * 0.62;
    t += STEP / speedFor(P, g, p);
  }
  const track = finishTrack({ length: (n - 1) * STEP, time, lat, lon, altRaw: alt, eleSource: 'dem' });
  segs.forEach(s => { delete s._plan; for (const k in s) if (s[k] === undefined) delete s[k]; });
  return { ...track, curve, theme, world: 'lofoten', segments: segs, intervals: segs.filter(s => s.interval) };
}

// ---------------- real roads on their real ground (assets/dem/<name>.json from the Mac) ----------------
// json: { name, file, n, size_m, sat, start_px, route: [[x east m, y south m], ...] (~10 m apart, relative to the start),
//         ele: [m per route point], places: [{name, from_m, to_m}], sea_side?: [-1|0|1 per point], tunnels? }
export async function loadRealTrack(id) {
  try { const r = await fetch(new URL(`../assets/dem/${id}.json`, import.meta.url)); return r.ok ? makeRealTrack(await r.json()) : null; }
  catch { return null; }
}
export function makeRealTrack(j) {
  // resample the polyline to exact STEP spacing
  const P = j.route, cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = cum[cum.length - 1], n = Math.floor(L / STEP) + 1, xs = [], ys = [], alt = [], side = [];
  for (let k = 0, i = 0; k < n; k++) {
    const d = k * STEP; while (i < P.length - 2 && cum[i + 1] < d) i++;
    const t = Math.min(1, (d - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]));
    xs.push(P[i][0] + (P[i + 1][0] - P[i][0]) * t); ys.push(P[i][1] + (P[i + 1][1] - P[i][1]) * t);
    alt.push(j.ele[i] + (j.ele[i + 1] - j.ele[i]) * t); side.push(j.sea_side?.[t < 0.5 ? i : i + 1] || 0);
  }
  // metres -> lat/lon with the same flat projection the 3D field uses (x east, z south)
  const R = 6371008.8, la0 = 68.2, lat = ys.map(y => la0 - y / R * 180 / Math.PI), lon = xs.map(x => 14.0 + x / (R * Math.cos(la0 * Math.PI / 180)) * 180 / Math.PI);
  // real GPS for Strava (Freddy 13.11.: the route on the Strava map): UTM 33N grid metres from the start -> WGS84. Kept apart from
  // lat/lon above, which only feed the 3D field's own flat projection and must not move.
  const gps = j.start_utm ? utmInv(xs, ys, j.start_utm[0], j.start_utm[1], 15) : null;
  // segments: villages from the places list, the stretches between them coast (sea beside the road) or valley
  const places = [...(j.places || [])].sort((a, b) => a.from_m - b.from_m), segs = [];
  const seaOn = (a, b) => { let s = 0, c = 0; for (let k = Math.floor(a / STEP); k < Math.min(n, b / STEP); k++) { s += side[k] !== 0; c++; } return c && s / c > 0.4; };
  const seaSide = (a, b) => { let s = 0; for (let k = Math.floor(a / STEP); k < Math.min(n, b / STEP); k++) s += side[k]; return s < 0 ? -1 : 1; };
  const open = (a, b) => { if (b - a > 50) segs.push({ name: 'Coast road', from: a, to: b, land: seaOn(a, b) ? 'coast' : 'valley', seaSide: seaSide(a, b) }); };
  let at = 0;
  if (j.roads?.length) { // the island (tools/island.mjs): each road of the tour keeps its own landscape (coast, cliff, valley, switchbacks)
    const cut = []; for (const rd of j.roads) { const [ea, eb] = rd.edge.split('-'), end = rd.dir === 1 ? eb : ea; // the junction this road leads to
      cut.push({ name: rd.name, from: rd.from_m, to: rd.to_m, land: rd.land, top: rd.edge === 'P1-G' && rd.dir === 1 ? 'castle' : /^P\d$/.test(end) ? 'pass' : undefined, hospiz: end === 'P1' || undefined, edge: rd.edge }); }
    for (const p of places) { // a village splits the road it lies on
      // a town at a junction spans the end of one road and the start of the next (it was cut to 300 m there and too short to build: empty, Mac 19.11.)
      let a = Math.max(0, p.from_m), b = Math.min(L, p.to_m); for (const [ba, bb] of j.bridges || []) if (ba < b && bb > a) { if ((ba + bb) / 2 < (a + b) / 2) a = Math.max(a, bb + 30); else b = Math.min(b, ba - 30); } // no houses on the bridge
      const k = cut.findIndex(c => c.from <= a + 1 && c.to > a); if (k < 0 || b - a < 330) continue;
      const mid = (a + b) / 2, cm = cut.find(c => c.from <= mid && c.to > mid) || cut[k], land = cm.land === 'serp' || cm.land === 'river' ? 'valley' : cm.land === 'cliff' ? 'coast' : cm.land;
      const out = []; for (const c of cut) { if (c.to <= a || c.from >= b) { out.push(c); continue; }
        if (c.from < a - 50) out.push({ ...c, to: a, top: undefined }); if (c.to > b + 50) out.push({ ...c, from: b }); }
      out.push({ name: p.name, from: a, to: b, land, village: [0.1, 0.9], edge: cm.edge }); out.sort((x, y) => x.from - y.from);
      cut.splice(0, cut.length, ...out);
    }
    for (const c of cut) { const sd = seaSide(c.from, c.to); segs.push({ ...c, seaSide: c.land === 'coast' || c.land === 'cliff' ? sd : seaOn(c.from, c.to) ? sd : 1 }); if (segs[segs.length - 1].top === undefined) delete segs[segs.length - 1].top; }
    at = L; places.length = 0;
  }
  for (const p of places) {
    const a = Math.max(at, p.from_m - 150), b = Math.min(L, p.to_m + 150); if (b <= a) continue;
    open(at, a); segs.push({ name: p.name, from: a, to: b, land: seaOn(a, b) ? 'coast' : 'valley', seaSide: seaSide(a, b), village: [0.1, 0.9] }); at = b;
  }
  if (at < L) open(at, L); if (segs.length) segs[segs.length - 1].to = (n - 1) * STEP;
  const tmp = finishTrack({ length: (n - 1) * STEP, time: alt.map((_, i) => i), lat, lon, altRaw: alt, eleSource: 'dem' });
  const d0 = COAST_DESIGN, p = defaultParams(d0), time = []; let t = 0;
  for (let i = 0; i < n; i++) { time.push(t); t += STEP / speedFor(d0.ftp * 0.7, tmp.grade[i], p); } // "footage" pace: steady endurance ride
  const track = finishTrack({ length: (n - 1) * STEP, time, lat, lon, altRaw: alt, eleSource: 'dem' });
  const head = xs.map((_, i) => { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); return Math.atan2(xs[b] - xs[a], ys[b] - ys[a]); });
  const curve = head.map((h, i) => { if (!i) return 0; let d = h - head[i - 1]; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.max(-0.15, Math.min(0.15, -d)); }); // heading change per sample: the hairpin walls and signs find the bends
  return { ...track, curve, theme: 'coast', world: 'lofoten', segments: segs, intervals: [], name: j.name, gpsLat: gps?.lat, gpsLon: gps?.lon,
    dem: { file: j.file, n: j.n, size_m: j.size_m, start_px: [j.start_px[0] - 0.5, j.start_px[1] - 0.5], sat: j.sat, bridges: (j.bridges || []).filter(([a, b]) => b - a >= 25), lakes: j.lakes || [], tunnels: j.tunnels || [], tunnelKinds: j.tunnel_kinds || [] } }; // start_px counts pixel edges, the grid samples sit at pixel centres
}

/** inverse UTM (WGS84): easting e0 + x, northing n0 - y (y = metres south) -> { lat[], lon[] } in degrees; lon0 = central meridian */
function utmInv(xs, ys, e0, n0, lon0) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const lat = new Array(xs.length), lon = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const x = e0 + xs[i] - 500000, M = (n0 - ys[i]) / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = x / (N1 * k0);
    lat[i] = (p1 - N1 * Math.tan(p1) / R1 * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720)) * 180 / Math.PI;
    lon[i] = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1) * 180 / Math.PI;
  }
  return { lat, lon };
}
