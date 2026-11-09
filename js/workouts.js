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
  { id: 'ramp', name: 'Ramp-Test (FTP)', what: 'Jede Minute +6 % FTP bis nichts mehr geht. Neue FTP ≈ 75 % der besten Minute. Mit Leertaste beenden.',
    steps: [W(5, 50, 'Einfahren'), ...Array.from({ length: 25 }, (_, i) => W(1, 60 + i * 6, `Stufe ${i + 1}`)), ...cool] },
];

export const workoutById = id => WORKOUTS.find(w => w.id === id) || null;
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
