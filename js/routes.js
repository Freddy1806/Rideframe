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
  { kind: 'flat', min: 10, watt: 0.72, wobble: 1.2, name: 'Einrollen am Fischerhafen', land: 'coast', village: [0.03, 0.28] },
  { kind: 'climb', min: 8, grade: 6.0, name: 'Kirchturm-Rampe', land: 'serp', top: 'church' },
  { kind: 'recover', min: 5, name: 'Abfahrt zur Bucht', land: 'coast' },
  { kind: 'climb', min: 10, grade: 5.0, name: 'Mühlenpass', land: 'valley', top: 'mill' },
  { kind: 'recover', min: 5, name: 'Abfahrt durchs Dorf', land: 'coast', village: [0.15, 0.9] },
  { kind: 'climb', min: 12, grade: 4.5, name: 'Klippenstraße', land: 'cliff', top: 'lookout' },
  { kind: 'recover', min: 5, name: 'Abfahrt zum Strand', land: 'coast', beach: true },
  { kind: 'climb', min: 10, grade: 7.0, name: 'Burgberg', land: 'serp', top: 'castle' },
  { kind: 'recover', min: 4, name: 'Abfahrt zum Ziel', land: 'coast' },
  { kind: 'flat', min: 8, watt: 0.6, wobble: 0.8, name: 'Ausrollen an der Küste', land: 'coast', village: [0.7, 1.0] },
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
  { kind: 'flat', min: 14, watt: 0.7, wobble: 1.0, name: 'Hafenrunde', land: 'coast', village: [0.05, 0.4] },
  { kind: 'climb', min: 6, grade: 5.0, name: 'Kapellenstich', land: 'serp', top: 'church' },
  { kind: 'recover', min: 5, name: 'Abfahrt zum Fjord', land: 'coast' },
  { kind: 'flat', min: 12, watt: 0.72, wobble: 1.4, name: 'Dorfstraße', land: 'valley', village: [0.2, 0.8] },
  { kind: 'climb', min: 5, grade: 6.5, name: 'Mühlenbuckel', land: 'valley', top: 'mill' },
  { kind: 'recover', min: 4, name: 'Abfahrt zum Strand', land: 'coast', beach: true },
  { kind: 'flat', min: 10, watt: 0.62, wobble: 0.8, name: 'Ausrollen im Hafen', land: 'coast', village: [0.55, 1.0] },
];
// river valley: wide river on the left with rowing boats and anglers, ~40 km
export const RIVER_SEGMENTS = [
  { kind: 'flat', min: 13, watt: 0.7, wobble: 0.8, name: 'Am Fluss entlang', land: 'river', village: [0.1, 0.35] },
  { kind: 'flat', min: 15, watt: 0.75, wobble: 1.6, name: 'Anglerufer', land: 'river' },
  { kind: 'climb', min: 7, grade: 5.5, name: 'Weinbergrampe', land: 'valley', top: 'lookout' },
  { kind: 'recover', min: 5, name: 'Zurück ans Ufer', land: 'river' },
  { kind: 'flat', min: 14, watt: 0.78, wobble: 1.2, name: 'Flussdörfer', land: 'river', village: [0.3, 0.75] },
  { kind: 'climb', min: 6, grade: 6.0, name: 'Brückenberg', land: 'serp', top: 'church' },
  { kind: 'recover', min: 5, name: 'Abfahrt zur Mündung', land: 'river' },
  { kind: 'flat', min: 8, watt: 0.6, wobble: 0.6, name: 'Ausrollen an der Mündung', land: 'coast', village: [0.6, 1.0] },
];
// the big mountain day: ~1800 m of switchbacks, short plateaus in between, summit finish on the pass
export const PASS_SEGMENTS = [
  { kind: 'flat', min: 8, watt: 0.65, wobble: 0.8, name: 'Einrollen im Tal', land: 'valley', village: [0.3, 0.9] },
  { kind: 'climb', gain: 450, grade: 6.5, watt: 0.8, name: 'Erste Kehren', land: 'serp' },
  { kind: 'plateau', min: 4, name: 'Almboden', land: 'valley' },
  { kind: 'climb', gain: 450, grade: 7.0, watt: 0.8, name: 'Waldkehren', land: 'serp' },
  { kind: 'plateau', min: 5, name: 'Bergdorf', land: 'valley', village: [0.15, 0.85] },
  { kind: 'climb', gain: 450, grade: 7.5, watt: 0.8, name: 'Felsenkehren', land: 'serp' },
  { kind: 'plateau', min: 3, name: 'Hochalm', land: 'valley' },
  { kind: 'climb', gain: 450, grade: 8.0, watt: 0.85, name: 'Himmelsleiter', land: 'serp', top: 'pass' },
  { kind: 'plateau', min: 3, name: 'Passhöhe', land: 'valley' },
];
// misty monastery mountain in an (original) East Asian style: bamboo, pagodas, lanterns, monks training, ~35 km
export const TEMPLE_SEGMENTS = [
  { kind: 'flat', min: 10, watt: 0.68, wobble: 1.0, name: 'Bambustal', land: 'river', style: 'asia', temple: [0.4, 0.8] },
  { kind: 'climb', min: 9, grade: 6.0, name: 'Laternenweg', land: 'serp', style: 'asia', top: 'pagode' },
  { kind: 'plateau', min: 4, name: 'Klosterhof', land: 'valley', style: 'asia', temple: [0.1, 0.9] },
  { kind: 'climb', min: 10, grade: 7.0, name: 'Tausend Stufen', land: 'serp', style: 'asia', top: 'pagode' },
  { kind: 'recover', min: 6, name: 'Abfahrt durch den Nebelwald', land: 'river', style: 'asia' },
  { kind: 'climb', min: 7, grade: 5.0, name: 'Drachenrücken', land: 'valley', style: 'asia', top: 'lookout' },
  { kind: 'recover', min: 5, name: 'Abfahrt zum Fluss', land: 'river', style: 'asia' },
  { kind: 'flat', min: 7, watt: 0.6, wobble: 0.8, name: 'Ausrollen am Teehaus', land: 'river', style: 'asia', temple: [0.5, 1.0] },
];

/** The built-in designed routes beside the Felsenküste (id -> name, subtitle, segments, seed). */
export const DESIGNED = {
  kurz: { name: 'Hafenrunde', place: 'Kurze Runde · 2 kurze Anstiege · Hafen und Dörfer', segs: SHORT_SEGMENTS, seed: 31 },
  fluss: { name: 'Flusstal', place: 'Am Fluss entlang · Ruderboote und Angler · 2 Anstiege', segs: RIVER_SEGMENTS, seed: 37 },
  pass: { name: 'Himmelsleiter', place: 'Königsetappe · 4 Serpentinen-Anstiege · Bergankunft am Pass', segs: PASS_SEGMENTS, seed: 41 },
  kloster: { name: 'Nebelkloster', place: 'Bambus, Pagoden, Laternen · Mönche trainieren am Weg', segs: TEMPLE_SEGMENTS, seed: 43 },
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
      segs.push({ name: s.name, from: st, to: (alt.length - 1) * STEP, minutes, grade: s.grade, interval: true, watt: w, top: s.top, leadIn: st - from, ...extra });
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
  // segments: villages from the places list, the stretches between them coast (sea beside the road) or valley
  const places = [...(j.places || [])].sort((a, b) => a.from_m - b.from_m), segs = [];
  const seaOn = (a, b) => { let s = 0, c = 0; for (let k = Math.floor(a / STEP); k < Math.min(n, b / STEP); k++) { s += side[k] !== 0; c++; } return c && s / c > 0.4; };
  const seaSide = (a, b) => { let s = 0; for (let k = Math.floor(a / STEP); k < Math.min(n, b / STEP); k++) s += side[k]; return s < 0 ? -1 : 1; };
  const open = (a, b) => { if (b - a > 50) segs.push({ name: 'Küstenstraße', from: a, to: b, land: seaOn(a, b) ? 'coast' : 'valley', seaSide: seaSide(a, b) }); };
  let at = 0;
  for (const p of places) {
    const a = Math.max(at, p.from_m - 150), b = Math.min(L, p.to_m + 150); if (b <= a) continue;
    open(at, a); segs.push({ name: p.name, from: a, to: b, land: seaOn(a, b) ? 'coast' : 'valley', seaSide: seaSide(a, b), village: [0.1, 0.9] }); at = b;
  }
  open(at, L); if (segs.length) segs[segs.length - 1].to = (n - 1) * STEP;
  const tmp = finishTrack({ length: (n - 1) * STEP, time: alt.map((_, i) => i), lat, lon, altRaw: alt, eleSource: 'dem' });
  const d0 = COAST_DESIGN, p = defaultParams(d0), time = []; let t = 0;
  for (let i = 0; i < n; i++) { time.push(t); t += STEP / speedFor(d0.ftp * 0.7, tmp.grade[i], p); } // "footage" pace: steady endurance ride
  const track = finishTrack({ length: (n - 1) * STEP, time, lat, lon, altRaw: alt, eleSource: 'dem' });
  return { ...track, curve: new Array(n).fill(0), theme: 'coast', world: 'lofoten', segments: segs, intervals: [], name: j.name,
    dem: { file: j.file, n: j.n, size_m: j.size_m, start_px: [j.start_px[0] - 0.5, j.start_px[1] - 0.5], sat: j.sat, bridges: (j.bridges || []).filter(([a, b]) => b - a >= 25), tunnels: j.tunnels || [], tunnelKinds: j.tunnel_kinds || [] } }; // start_px counts pixel edges, the grid samples sit at pixel centres
}
