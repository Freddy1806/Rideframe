// Training programs: power targets over time, in % of FTP. Ridden on any route, also the flat coast:
// in ERG mode the trainer holds the target power itself (the road grade then only sets the speed you see),
// without ERG the trainer keeps simulating the road and the HUD shows the target to hit.
const W = (min, pct, label = '') => ({ dur: Math.round(min * 60), pct, label });
const warm = [W(4, 50, 'Warm-up'), W(3, 65, 'Warm-up'), W(3, 75, 'Warm-up')];
// before hard work (threshold and above): rise in steps, then three short openers that prime the oxygen uptake without tiring
// (the usual priming warm-up; a long hard warm-up costs power in the first interval), a short easy spin, then the first interval
const warmHard = [W(3, 50, 'Warm-up'), W(3, 62, 'Warm-up'), W(2, 72, 'Warm-up'), W(2, 82, 'Warm-up'),
  W(0.5, 110, 'Opener 1/3'), W(1, 50, 'Easy'), W(0.5, 115, 'Opener 2/3'), W(1, 50, 'Easy'), W(0.5, 120, 'Opener 3/3'), W(1.5, 50, 'Easy')];
const cool = [W(3, 55, 'Cool-down'), W(3, 45, 'Cool-down')];
const reps = (n, on, off) => Array.from({ length: n }, (_, i) => [{ ...on, label: `${on.label} ${i + 1}/${n}` }, ...(i < n - 1 && off ? [off] : [])]).flat();

export const WORKOUTS = [
  { id: 'ss3x10', name: 'Sweet Spot 3 × 10', what: '3 × 10 min at 90 % FTP, 5 min rest. The classic for more endurance power.',
    steps: [...warm, ...reps(3, W(10, 90, 'Sweet Spot'), W(5, 55, 'Rest')), ...cool] },
  { id: 'thr2x20', name: 'Threshold 2 × 20', what: '2 × 20 min at 97 % FTP. Hard, but it raises your FTP.',
    steps: [...warmHard, ...reps(2, W(20, 97, 'Threshold'), W(8, 55, 'Rest')), ...cool] },
  { id: 'over_under', name: 'Over-Unders 3 × 9', what: '9 min each: alternating 2 min at 95 % and 1 min at 108 %. Teaches you to ride above threshold and recover.',
    steps: [...warmHard, ...[0, 1, 2].flatMap(i => [
      ...[0, 1, 2].flatMap(() => [W(2, 95, `Under ${i + 1}/3`), W(1, 108, `Over ${i + 1}/3`)]), ...(i < 2 ? [W(5, 55, 'Rest')] : [])]), ...cool] },
  { id: 'vo2_5x3', name: 'VO2max 5 × 3', what: '5 × 3 min at 118 % FTP, 3 min easy. For climbing sprints and attacks.',
    steps: [...warmHard, ...reps(5, W(3, 118, 'VO2max'), W(3, 50, 'Rest')), ...cool] },
  { id: 'pyramid', name: 'Pyramid', what: '1-2-3-4-3-2-1 min, rising from 100 to 115 % and back down.',
    steps: [...warmHard, ...[[1, 100], [2, 105], [3, 110], [4, 115], [3, 110], [2, 105], [1, 100]].flatMap(([m, p], i, a) => [W(m, p, 'Pyramid'), ...(i < a.length - 1 ? [W(2, 55, 'Rest')] : [])]), ...cool] },
  { id: 'sprints', name: 'Sprints 8 × 30 s', what: '8 × 30 s all out (150 % in ERG), 4:30 easy.',
    steps: [...warmHard, ...reps(8, W(0.5, 150, 'Sprint'), W(4.5, 50, 'Rest')), ...cool] },
  { id: 'z2_60', name: 'Endurance 60 min', what: '60 min steady at 65 % FTP. Burn fat, clear your head.',
    steps: [W(5, 55, 'Warm-up'), W(50, 65, 'Endurance'), W(5, 50, 'Cool-down')] },
  { id: 'rec30', name: 'Recovery 30 min', what: '30 min very easy at 50–55 % FTP. Loosens the legs after hard days.',
    steps: [W(5, 45, 'Easy spin'), W(20, 55, 'Easy'), W(5, 45, 'Easy spin down')] },
  { id: 'tempo2x15', name: 'Tempo 2 × 15', what: '2 × 15 min at 82 % FTP. Brisk but very doable, builds endurance.',
    steps: [...warm, ...reps(2, W(15, 82, 'Tempo'), W(5, 55, 'Rest')), ...cool] },
  { id: 'ss2x12', name: 'Sweet Spot short 2 × 12', what: '2 × 12 min at 90 % FTP. Little time, still a good FTP stimulus.',
    steps: [...warm, ...reps(2, W(12, 90, 'Sweet Spot'), W(4, 55, 'Rest')), ...cool] },
  { id: 'vo2_4x4', name: 'VO2max 4 × 4', what: '4 × 4 min at 115 % FTP, 4 min easy. Raises oxygen uptake, helps on climbs.',
    steps: [...warmHard, ...reps(4, W(4, 115, 'VO2max'), W(4, 50, 'Rest')), ...cool] },
  { id: 'vo2_5x5', name: 'VO2max 5 × 5', what: '5 × 5 min at 110 % FTP, 5 min easy. Long VO2max intervals, hard but steady.',
    steps: [...warmHard, ...reps(5, W(5, 110, 'VO2max'), W(5, 50, 'Rest')), ...cool] },
  { id: 'z2_90', name: 'Endurance 90 min', what: '90 min steady at 65–70 % FTP with three short tempo blocks. The long ride.',
    steps: [W(10, 55, 'Warm-up'), W(20, 66, 'Endurance'), W(5, 80, 'Tempo'), W(20, 66, 'Endurance'), W(5, 80, 'Tempo'), W(15, 66, 'Endurance'), W(5, 80, 'Tempo'), W(10, 50, 'Cool-down')] },
  { id: 'ramp', name: 'Ramp test (FTP)', what: 'Every minute +6 % FTP until you cannot go on. New FTP ≈ 75 % of the best minute. Press space to finish.',
    steps: [W(5, 50, 'Warm-up'), ...Array.from({ length: 25 }, (_, i) => W(1, 60 + i * 6, `Step ${i + 1}`)), ...cool] },
  // classic 20-min test (Freddy 12.11. "fitnesstest"): the 20 minutes are ridden freely (no ERG), new FTP = 95 % of their average
  { id: 'ftp20', name: '20-min test (FTP)', what: 'Warm-up, 5 min opener, then 20 min as hard as you can hold evenly. No ERG, you set the pace. New FTP = 95 % of it.',
    steps: [W(10, 55, 'Warm-up'), W(5, 75, 'Warm-up'), W(5, 105, 'Opener'), W(10, 55, 'Easy'), { ...W(20, 100, 'Test 20 min'), free: true }, W(10, 50, 'Cool-down')] },
];

// ---- own workouts (Pro-Modus): built in the Training tab, stored in settings.myWorkouts as plain rows ----
// def = { id, name, warm, cool, rows: [{ t: 'b', min, pct, label } | { t: 'i', n, onMin, onPct, offMin, offPct, label }] }
export const MY = [];
const num = (v, d, lo, hi) => { const x = +v; return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
export function buildMy(def) {
  const rows = (def.rows || []).flatMap(r => r.t === 'i'
    ? reps(num(r.n, 3, 1, 30), W(num(r.onMin, 1, 0.25, 120), num(r.onPct, 105, 30, 200), r.label || 'Interval'), W(num(r.offMin, 1, 0, 120), num(r.offPct, 55, 30, 200), 'Rest')).filter(x => x.dur > 0)
    : [W(num(r.min, 5, 0.25, 240), num(r.pct, 70, 30, 200), r.label || 'Block')]);
  const steps = [...(def.warm !== false ? warm : []), ...rows, ...(def.cool !== false ? cool : [])];
  const what = (def.rows || []).map(r => r.t === 'i' ? `${r.n} × ${r.onMin} min ${r.onPct} % / ${r.offMin} min ${r.offPct} %` : `${r.min} min ${r.pct} %`).join(', ');
  return { id: def.id, name: def.name || 'My workout', what: `Own workout: ${what || 'empty'}.`, steps: steps.length ? steps : [W(5, 50, 'Easy')], mine: true };
}
/** a standard workout as an editable definition (Freddy 16.11.: "2× Schwelle 20 min anpassen: Watt, Länge, mehr Runden"):
 *  warm-up and cool-down become the switches, "Name 1/n" + pause runs become interval rows, everything else single blocks */
export function defFrom(w) {
  let st = w.steps.slice(); const isWarm = s => /^(Warm-up|Easy spin|Ein(fahren|rollen))$/.test(s.label), isCool = s => /^(Cool-down|Easy spin down|Aus(fahren|rollen))$/.test(s.label);
  const hadWarm = st.length && isWarm(st[0]); while (st.length && isWarm(st[0])) st.shift();
  const hadCool = st.length && isCool(st[st.length - 1]); while (st.length && isCool(st[st.length - 1])) st.pop();
  const rows = [], min = s => +(s.dur / 60).toFixed(2);
  for (let i = 0; i < st.length; i++) {
    const s = st[i], m = /^(.*) 1\/(\d+)$/.exec(s.label || '');
    if (m) { const n = +m[2], off = st[i + 1] && st[i + 1].label === 'Rest' ? st[i + 1] : null, len = off ? 2 * n - 1 : n;
      const same = st.slice(i, i + len).every((x, j) => off && j % 2 ? x.label === 'Rest' && x.dur === off.dur && x.pct === off.pct : x.dur === s.dur && x.pct === s.pct);
      if (same) { rows.push({ t: 'i', n, onMin: min(s), onPct: s.pct, offMin: off ? min(off) : 0, offPct: off ? off.pct : 55, label: m[1] }); i += len - 1; continue; } }
    rows.push({ t: 'b', min: min(s), pct: s.pct, label: (s.label || 'Block').replace(/ \d+\/\d+$/, '') });
  }
  return { id: 'my_' + Date.now().toString(36), name: w.name + ' (adjusted)', warm: hadWarm, cool: hadCool, rows };
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
