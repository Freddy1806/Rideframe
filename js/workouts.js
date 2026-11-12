// Training programs: power targets over time, in % of FTP. Ridden on any route, also the flat coast:
// in ERG mode the trainer holds the target power itself (the road grade then only sets the speed you see),
// without ERG the trainer keeps simulating the road and the HUD shows the target to hit.
const W = (min, pct, label = '') => ({ dur: Math.round(min * 60), pct, label });
const warm = [W(4, 50, 'Einfahren'), W(3, 65, 'Einfahren'), W(3, 75, 'Einfahren')];
const cool = [W(5, 50, 'Ausfahren')];
const reps = (n, on, off) => Array.from({ length: n }, (_, i) => [{ ...on, label: `${on.label} ${i + 1}/${n}` }, ...(i < n - 1 && off ? [off] : [])]).flat();

export const WORKOUTS = [
  { id: 'ss3x10', name: 'Sweet Spot 3 × 10', what: '3 × 10 min bei 90 % FTP, 5 min Pause. Der Klassiker für mehr Ausdauerleistung.',
    steps: [...warm, ...reps(3, W(10, 90, 'Sweet Spot'), W(5, 55, 'Pause')), ...cool] },
  { id: 'thr2x20', name: 'Schwelle 2 × 20', what: '2 × 20 min bei 97 % FTP. Hart, aber das hebt die FTP.',
    steps: [...warm, ...reps(2, W(20, 97, 'Schwelle'), W(8, 55, 'Pause')), ...cool] },
  { id: 'over_under', name: 'Over-Unders 3 × 9', what: 'Je 9 min: abwechselnd 2 min 95 % und 1 min 108 %. Lernt, über der Schwelle zu fahren und sich zu erholen.',
    steps: [...warm, ...[0, 1, 2].flatMap(i => [
      ...[0, 1, 2].flatMap(() => [W(2, 95, `Under ${i + 1}/3`), W(1, 108, `Over ${i + 1}/3`)]), ...(i < 2 ? [W(5, 55, 'Pause')] : [])]), ...cool] },
  { id: 'vo2_5x3', name: 'VO2max 5 × 3', what: '5 × 3 min bei 118 % FTP, 3 min locker. Für Bergsprints und Attacken.',
    steps: [...warm, ...reps(5, W(3, 118, 'VO2max'), W(3, 50, 'Pause')), ...cool] },
  { id: 'pyramid', name: 'Pyramide', what: '1-2-3-4-3-2-1 min aufsteigend von 100 bis 115 % und wieder runter.',
    steps: [...warm, ...[[1, 100], [2, 105], [3, 110], [4, 115], [3, 110], [2, 105], [1, 100]].flatMap(([m, p], i, a) => [W(m, p, 'Pyramide'), ...(i < a.length - 1 ? [W(2, 55, 'Pause')] : [])]), ...cool] },
  { id: 'sprints', name: 'Sprints 8 × 30 s', what: '8 × 30 s volle Pulle (150 % im ERG), 4:30 locker.',
    steps: [...warm, ...reps(8, W(0.5, 150, 'Sprint'), W(4.5, 50, 'Pause')), ...cool] },
  { id: 'z2_60', name: 'Grundlage 60 min', what: '60 min ruhig bei 65 % FTP. Fett verbrennen, Kopf frei.',
    steps: [W(5, 55, 'Einfahren'), W(50, 65, 'Grundlage'), W(5, 50, 'Ausfahren')] },
  { id: 'rec30', name: 'Erholung 30 min', what: '30 min ganz locker bei 50–55 % FTP. Beine lockern nach harten Tagen.',
    steps: [W(5, 45, 'Einrollen'), W(20, 55, 'Locker'), W(5, 45, 'Ausrollen')] },
  { id: 'tempo2x15', name: 'Tempo 2 × 15', what: '2 × 15 min bei 82 % FTP. Zügig, aber gut machbar, baut Ausdauer auf.',
    steps: [...warm, ...reps(2, W(15, 82, 'Tempo'), W(5, 55, 'Pause')), ...cool] },
  { id: 'ss2x12', name: 'Sweet Spot kurz 2 × 12', what: '2 × 12 min bei 90 % FTP. Wenig Zeit, trotzdem guter Reiz für die FTP.',
    steps: [...warm, ...reps(2, W(12, 90, 'Sweet Spot'), W(4, 55, 'Pause')), ...cool] },
  { id: 'vo2_4x4', name: 'VO2max 4 × 4', what: '4 × 4 min bei 115 % FTP, 4 min locker. Hebt die Sauerstoffaufnahme, hilft am Berg.',
    steps: [...warm, ...reps(4, W(4, 115, 'VO2max'), W(4, 50, 'Pause')), ...cool] },
  { id: 'z2_90', name: 'Grundlage 90 min', what: '90 min ruhig bei 65–70 % FTP mit drei kurzen Tempo-Blöcken. Die lange Ausfahrt.',
    steps: [W(10, 55, 'Einfahren'), W(20, 66, 'Grundlage'), W(5, 80, 'Tempo'), W(20, 66, 'Grundlage'), W(5, 80, 'Tempo'), W(15, 66, 'Grundlage'), W(5, 80, 'Tempo'), W(10, 50, 'Ausfahren')] },
  { id: 'ramp', name: 'Ramp-Test (FTP)', what: 'Jede Minute +6 % FTP bis nichts mehr geht. Neue FTP ≈ 75 % der besten Minute. Mit Leertaste beenden.',
    steps: [W(5, 50, 'Einfahren'), ...Array.from({ length: 25 }, (_, i) => W(1, 60 + i * 6, `Stufe ${i + 1}`)), ...cool] },
  // classic 20-min test (Freddy 12.11. "fitnesstest"): the 20 minutes are ridden freely (no ERG), new FTP = 95 % of their average
  { id: 'ftp20', name: '20-min-Test (FTP)', what: 'Einfahren, 5 min Vorbelastung, dann 20 min so hart du gleichmäßig kannst. Ohne ERG, du bestimmst das Tempo. Neue FTP = 95 % davon.',
    steps: [W(10, 55, 'Einfahren'), W(5, 75, 'Einfahren'), W(5, 105, 'Vorbelastung'), W(10, 55, 'Locker'), { ...W(20, 100, 'Test 20 min'), free: true }, W(10, 50, 'Ausfahren')] },
];

// ---- own workouts (Pro-Modus): built in the Training tab, stored in settings.myWorkouts as plain rows ----
// def = { id, name, warm, cool, rows: [{ t: 'b', min, pct, label } | { t: 'i', n, onMin, onPct, offMin, offPct, label }] }
export const MY = [];
const num = (v, d, lo, hi) => { const x = +v; return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
export function buildMy(def) {
  const rows = (def.rows || []).flatMap(r => r.t === 'i'
    ? reps(num(r.n, 3, 1, 30), W(num(r.onMin, 1, 0.25, 120), num(r.onPct, 105, 30, 200), r.label || 'Intervall'), W(num(r.offMin, 1, 0, 120), num(r.offPct, 55, 30, 200), 'Pause')).filter(x => x.dur > 0)
    : [W(num(r.min, 5, 0.25, 240), num(r.pct, 70, 30, 200), r.label || 'Block')]);
  const steps = [...(def.warm !== false ? warm : []), ...rows, ...(def.cool !== false ? cool : [])];
  const what = (def.rows || []).map(r => r.t === 'i' ? `${r.n} × ${r.onMin} min ${r.onPct} % / ${r.offMin} min ${r.offPct} %` : `${r.min} min ${r.pct} %`).join(', ');
  return { id: def.id, name: def.name || 'Mein Workout', what: `Eigenes Workout: ${what || 'leer'}.`, steps: steps.length ? steps : [W(5, 50, 'Locker')], mine: true };
}
export function setMyWorkouts(defs = []) { MY.length = 0; for (const d of defs || []) if (d && d.id) MY.push(buildMy(d)); }
export const allWorkouts = () => [...MY, ...WORKOUTS];
export const workoutById = id => MY.find(w => w.id === id) || WORKOUTS.find(w => w.id === id) || null;
export const workoutDuration = w => w.steps.reduce((s, x) => s + x.dur, 0);

/** where in the program we are at time t (seconds since start) */
export function workoutAt(w, t, ftp) {
  let s = 0;
  for (let i = 0; i < w.steps.length; i++) {
    const st = w.steps[i];
    if (t < s + st.dur) return { i, step: st, next: w.steps[i + 1] || null, left: s + st.dur - t, target: Math.round(st.pct / 100 * ftp), nextTarget: w.steps[i + 1] ? Math.round(w.steps[i + 1].pct / 100 * ftp) : null, done: false };
    s += st.dur;
  }
  return { i: w.steps.length, step: null, next: null, left: 0, target: null, done: true };
}

/** small block chart of the program (SVG), the current position marked with a line */
export function workoutSVG(w, t = null, h = 46) {
  const total = workoutDuration(w), max = Math.max(...w.steps.map(s => s.pct), 120);
  let x = 0;
  const bars = w.steps.map(s => {
    const bw = s.dur / total * 1000, bh = s.pct / max * h, col = s.pct >= 105 ? 'var(--accent)' : s.pct >= 88 ? '#f2b630' : s.pct >= 70 ? '#2fb36b' : '#6b7480';
    const r = `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(0.5, bw - 0.6).toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}"/>`;
    x += bw; return r;
  }).join('');
  const mark = t != null ? `<rect x="${Math.min(1000, t / total * 1000).toFixed(1)}" y="0" width="3" height="${h}" fill="#fff"/>` : '';
  return `<svg viewBox="0 0 1000 ${h}" preserveAspectRatio="none" class="wsvg">${bars}${mark}</svg>`;
}
