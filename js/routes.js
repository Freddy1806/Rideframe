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
  { kind: 'recover', min: 5, name: 'Abfahrt durchs Dorf', land: 'coast', village: [0.55, 0.95] },
  { kind: 'climb', min: 12, grade: 4.5, name: 'Klippenstraße', land: 'cliff', top: 'lookout' },
  { kind: 'recover', min: 5, name: 'Abfahrt zum Strand', land: 'coast', beach: true },
  { kind: 'climb', min: 10, grade: 7.0, name: 'Burgberg', land: 'serp', top: 'castle' },
  { kind: 'recover', min: 4, name: 'Abfahrt zum Ziel', land: 'coast' },
  { kind: 'flat', min: 8, watt: 0.6, wobble: 0.8, name: 'Ausrollen an der Küste', land: 'coast', village: [0.7, 1.0] },
];

// heading change per 10 m sample for a switchback climb: turn east, legs east/west with hairpins, back north
function serpPlan(seg, r) {
  const n = Math.round((seg.to - seg.from) / STEP) + 1, rate = new Float32Array(n);
  const turn = (at, len, total) => { for (let k = 0; k < len && at + k < n; k++) rate[at + k] += total / len; };
  const E = 14, HP = 7; // samples for entry/exit turns and hairpins (~70 m, radius ~20 m)
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

export function makeCoastTrack() {
  const d0 = COAST_DESIGN, p = defaultParams(d0);
  const alt = [], segs = [];
  let e = 4; // metres above sea
  const push = (grade) => { e += grade / 100 * STEP; alt.push(Math.max(2, e)); };
  const r = rng(29);
  alt.push(e);
  for (const s of COAST_SEGMENTS) {
    const from = (alt.length - 1) * STEP;
    if (s.kind === 'flat') {
      const v = speedFor(d0.ftp * s.watt, 0, p), n = Math.round(v * s.min * 60 / STEP);
      const ph = r() * 6;
      for (let i = 0; i < n; i++) push(s.wobble * Math.sin(i / 23 + ph) + 0.6 * Math.sin(i / 7.3 + ph * 2));
    } else if (s.kind === 'climb') {
      // ~0.6 km lead-in at 2-3 %, then the steady interval grade with mild ±0.6 % texture
      const from = (alt.length - 1) * STEP;
      for (let i = 0; i < 40; i++) push(1 + i / 40 * (s.grade - 1));
      const v = speedFor(d0.ftp, s.grade, p), n = Math.round(v * s.min * 60 / STEP);
      const st = (alt.length - 1) * STEP;
      for (let i = 0; i < n; i++) push(s.grade + 0.6 * Math.sin(i / 11) + 0.3 * Math.sin(i / 4.1));
      segs.push({ name: s.name, from: st, to: (alt.length - 1) * STEP, minutes: s.min, grade: s.grade, interval: true, land: s.land, top: s.top, leadIn: st - from });
      for (let i = 0; i < 12; i++) push(1.5 - i / 8); // short false-flat at the top
      continue;
    } else if (s.kind === 'recover') {
      // drop back to the coast: descent at ~-5 %, rest of the time flat coast road at easy power
      const drop = Math.max(0, e - 6), dg = -5.2;
      const nDesc = Math.round(drop / (-dg / 100 * STEP));
      for (let i = 0; i < nDesc; i++) push(dg + 0.8 * Math.sin(i / 9));
      const tDesc = nDesc * STEP / speedFor(60, dg, p);
      const left = Math.max(60, s.min * 60 - tDesc);
      const v = speedFor(d0.ftp * 0.55, 0, p), n = Math.round(v * left / STEP);
      for (let i = 0; i < n; i++) push(0.4 * Math.sin(i / 13));
    }
    segs.push({ name: s.name, from, to: (alt.length - 1) * STEP, land: s.land, village: s.village, beach: s.beach });
  }
  const n = alt.length;
  // layout: heading 0 = north, sea to the west (left). Switchbacks climb a west-facing flank.
  const head = new Float32Array(n);
  let h = 0;
  const segAt = d => segs.find(s => d >= s.from && d < s.to) || segs[segs.length - 1];
  for (let i = 0; i < n; i++) {
    const d = i * STEP, seg = segAt(d);
    if (seg.land === 'serp' && !seg._plan) seg._plan = serpPlan(seg, r);
    let dh;
    if (seg.land === 'serp') dh = seg._plan[Math.min(seg._plan.length - 1, Math.round((d - seg.from) / STEP))];
    else {
      const wig = seg.land === 'valley' ? 0.035 : seg.land === 'cliff' ? 0.028 : 0.02;
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
  // "footage" speed: a rider at the planned powers (threshold on climbs)
  let t = 0;
  for (let i = 0; i < n; i++) {
    time.push(t);
    const d = i * STEP, g = tmp.grade[i];
    const onInterval = segs.some(s => s.interval && d >= s.from && d < s.to);
    const P = onInterval ? d0.ftp : g < -1.5 ? 60 : d0.ftp * 0.62;
    t += STEP / speedFor(P, g, p);
  }
  const track = finishTrack({ length: (n - 1) * STEP, time, lat, lon, altRaw: alt, eleSource: 'dem' });
  segs.forEach(s => delete s._plan);
  return { ...track, curve, theme: 'coast', world: 'lofoten', segments: segs, intervals: segs.filter(s => s.interval) };
}
