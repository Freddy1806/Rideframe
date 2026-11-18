// Segments like on Strava (Freddy 12.11.): the real climbs, the long flat stretches and a few short fun sprints get
// their own time. While riding a card on the left shows the running time against your best; the summary and the
// route page list them. Found from the route profile only, so every route has them, and the same each time.
import { STEP } from './track.js';

const UP = 2.5, DOWN = -2.5;
const SPRINT_NAMES = ['Seagull Sprint', 'Town Sign Sprint', 'Harbour Wall Sprint', 'Fish Market Sprint', 'Knight Sprint', 'Wizard Sprint', 'Sheep Flock Sprint', 'Bell Tower Sprint', 'Viking Sprint', 'Tailwind Sprint', 'Village Square Sprint', 'Dragon Sprint'];
export const SEG_KIND = { climb: { icon: '▲', label: 'Climb' }, descent: { icon: '▼', label: 'Descent' }, flat: { icon: '▬', label: 'Flat' }, sprint: { icon: '⚡', label: 'Sprint' } };

/** [{ id, kind, name, from, to, len, avg (%) }] sorted by start */
export function findSegments(track) {
  const g = track.grade, n = g?.length || 0; if (n < 10) return [];
  // grade over ~200 m so a single steep metre does not split a climb
  const w = Math.max(1, Math.round(100 / STEP)), sm = new Float32Array(n);
  { let s = 0; const pre = [0]; for (let i = 0; i < n; i++) pre.push(s += g[i]);
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - w), b = Math.min(n, i + w + 1); sm[i] = (pre[b] - pre[a]) / (b - a); } }
  const kindAt = i => sm[i] > UP ? 'climb' : sm[i] < DOWN ? 'descent' : 'flat';
  let runs = []; for (let i = 0; i < n;) { const k = kindAt(i); let j = i; while (j < n && kindAt(j) === k) j++; runs.push({ k, a: i, b: j }); i = j; }
  // short runs (< 300 m) go to the neighbour before them: a short flatter bit stays part of its climb
  for (let pass = 0; pass < 3; pass++) {
    const out = [];
    for (const r of runs) { const prev = out[out.length - 1];
      if (prev && ((r.b - r.a) * STEP < 300 || prev.k === r.k)) prev.b = r.b; else out.push({ ...r }); }
    runs = out;
  }
  const ele = i => track.ele[Math.min(i, n - 1)], names = track.segments || [];
  const nameAt = (d, fallback) => { const s = names.find(s => s.name && d >= s.from && d < s.to); return s?.name || fallback; };
  // Few, clear segments like the ones riders star on Strava (Freddy 17.11.: "viel zu viele, sie überschneiden sich"):
  // real climbs, the long flat stretches as time trials, a sprint here and there. No descents. Never two at once and
  // always a breather of GAP metres between two, and at most about one per 5 km of route.
  const GAP = 400, cand = []; let nc = 0, nf = 0;
  const avgOf = (a, b) => (track.ele[Math.min(n - 1, Math.round(b / STEP))] - track.ele[Math.min(n - 1, Math.round(a / STEP))]) / (b - a) * 100;
  for (const r of runs) {
    const from = r.a * STEP, to = Math.min(track.length, r.b * STEP), len = to - from, dh = ele(r.b) - ele(r.a);
    if (r.k === 'climb' && len >= 800 && dh >= 30) cand.push({ kind: 'climb', from, to, len, avg: dh / len * 100, pri: 1e6 + dh, name: nameAt((from + to) / 2, `Climb ${++nc}`) });
    else if (r.k === 'flat' && len >= 3000) { // long flats as time trials, in pieces of at most ~8 km
      const parts = Math.ceil(len / 8000), pl = len / parts;
      for (let p = 0; p < parts; p++) { const a = from + p * pl, b = a + pl; cand.push({ kind: 'flat', from: a, to: b, len: pl, avg: avgOf(a, b), pri: 1e3 + pl / 100, name: nameAt((a + b) / 2, `Flat ${++nf}`) + (parts > 1 ? ` ${p + 1}/${parts}` : '') }); }
    } else if (r.k === 'flat' && len >= 1100) { // a shorter flat bit: room for one 300 m sprint in its middle
      const a = Math.round((from + to) / 2 - 150); if (a >= 1500 && a + 300 <= track.length - 1500) cand.push({ kind: 'sprint', from: a, to: a + 300, len: 300, avg: avgOf(a, a + 300), pri: 1 });
    }
  }
  const max = Math.max(3, Math.ceil(track.length / 5000)), flatMax = Math.max(1, Math.round(track.length / 20000)), out = [];
  for (const c of cand.sort((x, y) => y.pri - x.pri)) {
    if (out.length >= max) break;
    if (c.kind === 'flat' && (out.filter(o => o.kind === 'flat').length >= flatMax || out.some(o => o.kind === 'flat' && c.from < o.to + 5000 && c.to > o.from - 5000))) continue; // one long time trial per ~20 km, well apart
    if (c.kind === 'sprint' && out.some(o => o.kind === 'sprint' && Math.abs(o.from - c.from) < 8000)) continue;
    let { from, to } = c; if (c.kind === 'flat') from = Math.max(from, 2000); // the first 2 km are for rolling in
    for (const o of out) { // keep clear of what is already chosen: a flat gives way at its ends, anything else is dropped
      if (to + GAP <= o.from || from - GAP >= o.to) continue;
      if (c.kind !== 'flat') { from = to = 0; break; }
      if (from < o.from) to = Math.min(to, o.from - GAP); else from = Math.max(from, o.to + GAP);
    }
    if (to - from < (c.kind === 'flat' ? 2500 : c.len)) continue;
    if (out.some(o => !(to + GAP <= o.from || from - GAP >= o.to))) continue;
    out.push({ kind: c.kind, from, to, len: to - from, avg: c.kind === 'flat' ? avgOf(from, to) : c.avg, name: c.name });
  }
  out.sort((a, b) => a.from - b.from);
  { let k = 0; for (const s of out) if (s.kind === 'sprint') s.name = SPRINT_NAMES[(k++ + Math.round(track.length)) % SPRINT_NAMES.length]; }
  for (const s of out) s.id = `${s.kind}:${Math.round(s.from / 50) * 50}`;
  return out;
}

/** your most recent time per segment id: { id: { t, w, date } } */
export function segmentLast(rides) {
  const last = {};
  for (const r of rides || []) for (const e of r.segs || []) if (!last[e.id] || r.date > last[e.id].date) last[e.id] = { t: e.t, w: e.w, date: r.date };
  return last;
}

/** best time per segment id from saved rides: { id: { t, w, date } } */
export function segmentBests(rides) {
  const best = {};
  for (const r of rides || []) for (const e of r.segs || []) if (!best[e.id] || e.t < best[e.id].t) best[e.id] = { t: e.t, w: e.w, date: r.date };
  return best;
}
