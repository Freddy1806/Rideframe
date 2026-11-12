// Segments like on Strava (Freddy 12.11.): every climb, every descent, longer flat stretches and short fun sprints get
// their own time. While riding a card on the left shows the running time against your best; the summary and the
// route page list them. Found from the route profile only, so every route has them, and the same each time.
import { STEP } from './track.js';

const UP = 2.5, DOWN = -2.5;
const SPRINT_NAMES = ['Möwen-Sprint', 'Ortsschild-Sprint', 'Hafenmauer-Sprint', 'Fischmarkt-Sprint', 'Ritter-Sprint', 'Zauberer-Sprint', 'Schafherden-Sprint', 'Glockenturm-Sprint', 'Wikinger-Sprint', 'Rückenwind-Sprint', 'Dorfplatz-Sprint', 'Drachen-Sprint'];
export const SEG_KIND = { climb: { icon: '▲', label: 'Anstieg' }, descent: { icon: '▼', label: 'Abfahrt' }, flat: { icon: '▬', label: 'Flachstück' }, sprint: { icon: '⚡', label: 'Sprint' } };

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
  const out = []; let nc = 0, nd = 0, nf = 0;
  for (const r of runs) {
    const from = r.a * STEP, to = Math.min(track.length, r.b * STEP), len = to - from, dh = ele(r.b) - ele(r.a);
    if (r.k === 'climb' && len >= 400 && dh >= 15) out.push({ kind: 'climb', from, to, len, avg: dh / len * 100, name: nameAt((from + to) / 2, `Anstieg ${++nc}`) });
    else if (r.k === 'descent' && len >= 400 && dh <= -15) out.push({ kind: 'descent', from, to, len, avg: dh / len * 100, name: `Abfahrt ${++nd}` });
    else if (r.k === 'flat' && len >= 1200) { // long flats in pieces of at most ~5 km
      const parts = Math.ceil(len / 5000), pl = len / parts;
      for (let p = 0; p < parts; p++) { const a = from + p * pl, b = a + pl; out.push({ kind: 'flat', from: a, to: b, len: pl, avg: (track.ele[Math.min(n - 1, Math.round(b / STEP))] - track.ele[Math.round(a / STEP)]) / pl * 100, name: nameAt((a + b) / 2, `Flachstück ${++nf}`) + (parts > 1 ? ` ${p + 1}/${parts}` : '') }); }
    }
  }
  // sprints: 300 m on the flat or slightly downhill, every ~6 km, away from the start, finish and other segment starts
  const flat = out.filter(s => s.kind === 'flat');
  let k = 0, next = 2500;
  for (const s of flat) for (let a = Math.max(s.from + 300, next); a + 300 < s.to - 200; a += 6000) {
    if (a < 1500 || a > track.length - 1500) continue;
    out.push({ kind: 'sprint', from: a, to: a + 300, len: 300, avg: (ele(Math.round((a + 300) / STEP)) - ele(Math.round(a / STEP))) / 3, name: SPRINT_NAMES[(k++ + Math.round(track.length)) % SPRINT_NAMES.length] }); next = a + 6000;
  }
  out.sort((a, b) => a.from - b.from);
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
