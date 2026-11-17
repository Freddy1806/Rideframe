// Training programs: power targets over time, in % of FTP. Ridden on any route, also the flat coast:
// in ERG mode the trainer holds the target power itself (the road grade then only sets the speed you see),
// without ERG the trainer keeps simulating the road and the HUD shows the target to hit.
const W = (min, pct, label = '') => ({ dur: Math.round(min * 60), pct, label });
/** a ramp step (opt-in, e.g. a warm-up from 45 to 75 %): the target moves linearly from pct to `to` over the step */
export const Ramp = (min, from, to, label = '') => ({ ...W(min, from, label), to });
const warm = [W(4, 50, 'Warm-up'), W(3, 65, 'Warm-up'), W(3, 75, 'Warm-up')];
const cool = [W(5, 50, 'Cool-down')];
const reps = (n, on, off) => Array.from({ length: n }, (_, i) => [{ ...on, label: `${on.label} ${i + 1}/${n}` }, ...(i < n - 1 && off ? [off] : [])]).flat();

export const WORKOUTS = [
  { id: 'ss3x10', name: 'Sweet Spot 3 × 10', what: '3 × 10 min at 90 % FTP, 5 min rest. The classic for more endurance power.',
    steps: [...warm, ...reps(3, W(10, 90, 'Sweet Spot'), W(5, 55, 'Rest')), ...cool] },
  { id: 'thr2x20', name: 'Threshold 2 × 20', what: '2 × 20 min at 97 % FTP. Hard, but it raises your FTP.',
    steps: [...warm, ...reps(2, W(20, 97, 'Threshold'), W(8, 55, 'Rest')), ...cool] },
  { id: 'over_under', name: 'Over-Unders 3 × 9', what: '9 min each: alternating 2 min at 95 % and 1 min at 108 %. Teaches you to ride above threshold and recover.',
    steps: [...warm, ...[0, 1, 2].flatMap(i => [
      ...[0, 1, 2].flatMap(() => [W(2, 95, `Under ${i + 1}/3`), W(1, 108, `Over ${i + 1}/3`)]), ...(i < 2 ? [W(5, 55, 'Rest')] : [])]), ...cool] },
  { id: 'vo2_5x3', name: 'VO2max 5 × 3', what: '5 × 3 min at 118 % FTP, 3 min easy. For climbing sprints and attacks.',
    steps: [...warm, ...reps(5, W(3, 118, 'VO2max'), W(3, 50, 'Rest')), ...cool] },
  { id: 'pyramid', name: 'Pyramid', what: '1-2-3-4-3-2-1 min, rising from 100 to 115 % and back down.',
    steps: [...warm, ...[[1, 100], [2, 105], [3, 110], [4, 115], [3, 110], [2, 105], [1, 100]].flatMap(([m, p], i, a) => [W(m, p, 'Pyramid'), ...(i < a.length - 1 ? [W(2, 55, 'Rest')] : [])]), ...cool] },
  { id: 'sprints', name: 'Sprints 8 × 30 s', what: '8 × 30 s all out (150 % in ERG), 4:30 easy.',
    steps: [...warm, ...reps(8, W(0.5, 150, 'Sprint'), W(4.5, 50, 'Rest')), ...cool] },
  { id: 'z2_60', name: 'Endurance 60 min', what: '60 min steady at 65 % FTP. Burn fat, clear your head.',
    steps: [W(5, 55, 'Warm-up'), W(50, 65, 'Endurance'), W(5, 50, 'Cool-down')] },
  { id: 'rec30', name: 'Recovery 30 min', what: '30 min very easy at 50–55 % FTP. Loosens the legs after hard days.',
    steps: [W(5, 45, 'Easy spin'), W(20, 55, 'Easy'), W(5, 45, 'Easy spin down')] },
  { id: 'tempo2x15', name: 'Tempo 2 × 15', what: '2 × 15 min at 82 % FTP. Brisk but very doable, builds endurance.',
    steps: [...warm, ...reps(2, W(15, 82, 'Tempo'), W(5, 55, 'Rest')), ...cool] },
  { id: 'ss2x12', name: 'Sweet Spot short 2 × 12', what: '2 × 12 min at 90 % FTP. Little time, still a good FTP stimulus.',
    steps: [...warm, ...reps(2, W(12, 90, 'Sweet Spot'), W(4, 55, 'Rest')), ...cool] },
  { id: 'vo2_4x4', name: 'VO2max 4 × 4', what: '4 × 4 min at 115 % FTP, 4 min easy. Raises oxygen uptake, helps on climbs.',
    steps: [...warm, ...reps(4, W(4, 115, 'VO2max'), W(4, 50, 'Rest')), ...cool] },
  { id: 'vo2_5x5', name: 'VO2max 5 × 5', what: '5 × 5 min at 110 % FTP, 5 min easy. Long VO2max intervals, hard but steady.',
    steps: [...warm, ...reps(5, W(5, 110, 'VO2max'), W(5, 50, 'Rest')), ...cool] },
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
    : [{ ...W(num(r.min, 5, 0.25, 240), num(r.pct, 70, 30, 200), r.label || 'Block'), ...(r.toPct != null && r.toPct !== '' ? { to: num(r.toPct, 70, 30, 200) } : {}) }]); // toPct: a ramp
  const steps = [...(def.warm !== false ? warm : []), ...rows, ...(def.cool !== false ? cool : [])];
  const what = (def.rows || []).map(r => r.t === 'i' ? `${r.n} × ${r.onMin} min ${r.onPct} % / ${r.offMin} min ${r.offPct} %` : `${r.min} min ${r.pct}${r.toPct != null && r.toPct !== '' ? `–${r.toPct}` : ''} %`).join(', ');
  return { id: def.id, name: def.name || 'My workout', what: `Own workout: ${what || 'empty'}.`, steps: steps.length ? steps : [W(5, 50, 'Easy')], mine: true };
}
/** a standard workout as an editable definition (Freddy 16.11.: "2× Schwelle 20 min anpassen: Watt, Länge, mehr Runden"):
 *  warm-up and cool-down become the switches, "Name 1/n" + pause runs become interval rows, everything else single blocks */
export function defFrom(w) {
  let st = w.steps.slice(); const isWarm = s => s.to == null && /^(Warm-up|Easy spin|Ein(fahren|rollen))$/.test(s.label), isCool = s => s.to == null && /^(Cool-down|Easy spin down|Aus(fahren|rollen))$/.test(s.label); // a ramp stays a row
  const hadWarm = st.length && isWarm(st[0]); while (st.length && isWarm(st[0])) st.shift();
  const hadCool = st.length && isCool(st[st.length - 1]); while (st.length && isCool(st[st.length - 1])) st.pop();
  const rows = [], min = s => +(s.dur / 60).toFixed(2);
  for (let i = 0; i < st.length; i++) {
    const s = st[i], m = /^(.*) 1\/(\d+)$/.exec(s.label || '');
    if (m) { const n = +m[2], off = st[i + 1] && st[i + 1].label === 'Rest' ? st[i + 1] : null, len = off ? 2 * n - 1 : n;
      const same = st.slice(i, i + len).every((x, j) => off && j % 2 ? x.label === 'Rest' && x.dur === off.dur && x.pct === off.pct : x.dur === s.dur && x.pct === s.pct);
      if (same) { rows.push({ t: 'i', n, onMin: min(s), onPct: s.pct, offMin: off ? min(off) : 0, offPct: off ? off.pct : 55, label: m[1] }); i += len - 1; continue; } }
    rows.push({ t: 'b', min: min(s), pct: s.pct, ...(s.to != null ? { toPct: s.to } : {}), label: (s.label || 'Block').replace(/ \d+\/\d+$/, '') });
  }
  return { id: 'my_' + Date.now().toString(36), name: w.name + ' (adjusted)', warm: hadWarm, cool: hadCool, rows };
}
export function setMyWorkouts(defs = []) { MY.length = 0; for (const d of defs || []) if (d && d.id) MY.push(buildMy(d)); }
export const allWorkouts = () => [...MY, ...WORKOUTS];
export const workoutById = id => MY.find(w => w.id === id) || WORKOUTS.find(w => w.id === id) || null;
export const workoutDuration = w => w.steps.reduce((s, x) => s + x.dur, 0);

/** live watt tuning in a workout (Freddy 17.11.: "turn the watts up when I can push more"): an offset in W on the hard
 *  intervals only (pct >= 88, not a free test block), ±150 W, never below 50 W; rest and warm-up stay as they are */
export const WADJ_MAX = 150;
export const isHard = s => !!s && !s.free && s.pct >= 88;
export const tuneAdj = (adj, d) => Math.max(-WADJ_MAX, Math.min(WADJ_MAX, Math.round((+adj || 0) + (+d || 0))));
export const tunedTarget = (step, target, adj) => target == null || !adj || !isHard(step) ? target : Math.max(50, target + adj);
export const fmtAdj = a => `${a > 0 ? '+' : a < 0 ? '−' : '±'}${Math.abs(a || 0)} W`;

/** % FTP of a step at fraction f (0..1) of it: flat, or linear for a ramp step */
export const pctAt = (st, f = 0) => st.to == null ? st.pct : st.pct + (st.to - st.pct) * Math.max(0, Math.min(1, f));

/** everything a workout display needs at time t, with the rider's offsets and the ERG ramps (pure, tested):
 *  o.hardAdj  W on every hard interval (pct >= 88, not free), kept for the whole workout
 *  o.stepAdj  W on the current step when it is not hard (warm-up, rest, cool-down); the caller resets it at the next step
 *  o.ramp     true (ERG): no wall into a hard interval: the last o.rampIn s (10) before it the target rises linearly from
 *             this step's to the interval's, and over the first o.rampOut s (5) after it falls back
 *  Returns { done, i, step, next, prev, left, inStep, target (W, ramped and adjusted: what the trainer gets and compliance
 *  uses), plateau (the step's own adjusted target), lo / hi (±5 % zone), ramp ('in' | 'out' | 'step' | null), hard,
 *  hardNo / hardCount / nextHardNo, name, nextTarget / nextName / nextDur, totalLeft, countdown (whole s, last 3 s before a
 *  change, else 0), steps: [{ dur, pct (height incl. offset), to, hard, label }] } */
export function workoutState(w, t, ftp, o = {}) {
  const hardAdj = o.hardAdj || 0, stepAdj = o.stepAdj || 0, rampIn = o.rampIn ?? 10, rampOut = o.rampOut ?? 5, steps = w.steps;
  const W0 = (st, f, own) => { const b = Math.round(pctAt(st, f) / 100 * ftp); return isHard(st) ? tunedTarget(st, b, hardAdj) : own && stepAdj ? Math.max(50, b + stepAdj) : b; };
  const hardCount = steps.filter(isHard).length, total = workoutDuration(w);
  const list = steps.map(st => ({ dur: st.dur, pct: ftp && hardAdj && isHard(st) ? tunedTarget(st, st.pct / 100 * ftp, hardAdj) / ftp * 100 : st.pct, to: st.to, hard: isHard(st), label: st.label || '' }));
  let s = 0, i = 0; for (; i < steps.length && t >= s + steps[i].dur; i++) s += steps[i].dur;
  if (i >= steps.length) return { done: true, i: steps.length, step: null, next: null, prev: steps[steps.length - 1] || null, left: 0, inStep: 0, target: null, plateau: null, lo: null, hi: null, ramp: null, hard: false,
    hardNo: 0, hardCount, nextHardNo: 0, name: '', nextTarget: null, nextName: '', nextDur: 0, totalLeft: 0, countdown: 0, steps: list };
  const st = steps[i], next = steps[i + 1] || null, prev = steps[i - 1] || null, inStep = t - s, left = st.dur - inStep, f = inStep / st.dur;
  const plateau = W0(st, f, true); let target = plateau, ramp = st.to != null ? 'step' : null;
  if (o.ramp && !isHard(st) && !st.free) {
    if (next && isHard(next) && left < rampIn && rampIn > 0) { const k = 1 - left / rampIn, a = W0(st, 1, true), b = W0(next, 0); target = Math.round(a + (b - a) * k); ramp = 'in'; }
    else if (prev && isHard(prev) && inStep < rampOut && rampOut > 0) { const k = inStep / rampOut, a = W0(prev, 1), b = W0(st, 0, true); target = Math.round(a + (b - a) * k); ramp = 'out'; }
  }
  const hardBefore = steps.slice(0, i).filter(isHard).length;
  return { done: false, i, step: st, next, prev, left, inStep, target, plateau, lo: Math.round(target * .95), hi: Math.round(target * 1.05), ramp, hard: isHard(st),
    hardNo: isHard(st) ? hardBefore + 1 : 0, hardCount, nextHardNo: hardBefore + (isHard(st) ? 2 : 1) <= hardCount ? hardBefore + (isHard(st) ? 2 : 1) : 0,
    name: st.label || 'Block', nextTarget: next ? W0(next, 0) : null, nextName: next ? next.label || 'Block' : '', nextDur: next ? next.dur : 0,
    totalLeft: Math.max(0, total - t), countdown: next && left <= 3 ? Math.max(1, Math.ceil(left)) : 0, steps: list };
}

/** where in the program we are at time t (seconds since start) */
export function workoutAt(w, t, ftp) {
  let s = 0;
  for (let i = 0; i < w.steps.length; i++) {
    const st = w.steps[i];
    if (t < s + st.dur) return { i, step: st, next: w.steps[i + 1] || null, left: s + st.dur - t, target: Math.round(pctAt(st, (t - s) / st.dur) / 100 * ftp), nextTarget: w.steps[i + 1] ? Math.round(w.steps[i + 1].pct / 100 * ftp) : null, done: false };
    s += st.dur;
  }
  return { i: w.steps.length, step: null, next: null, left: 0, target: null, done: true };
}

/** small block chart of the program (SVG), the current position marked with a line; adj / ftp: hard bars at the tuned target */
export function workoutSVG(w, t = null, h = 46, adj = 0, ftp = 0) {
  const total = workoutDuration(w), pc = s => adj && ftp ? tunedTarget(s, s.pct / 100 * ftp, adj) / ftp * 100 : s.pct, max = Math.max(...w.steps.map(pc), 120);
  let x = 0;
  const bars = w.steps.map(s => {
    const bw = s.dur / total * 1000, bh = pc(s) / max * h, col = s.pct >= 105 ? 'var(--accent)' : s.pct >= 88 ? '#f2b630' : s.pct >= 70 ? '#2fb36b' : '#6b7480';
    const r = s.to != null ? `<polygon points="${x.toFixed(1)},${h} ${x.toFixed(1)},${(h - bh).toFixed(1)} ${(x + Math.max(0.5, bw - 0.6)).toFixed(1)},${(h - s.to / max * h).toFixed(1)} ${(x + Math.max(0.5, bw - 0.6)).toFixed(1)},${h}" fill="${col}"/>` // a ramp step: a slope
      : `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(0.5, bw - 0.6).toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}"/>`;
    x += bw; return r;
  }).join('');
  const mark = t != null ? `<rect x="${Math.min(1000, t / total * 1000).toFixed(1)}" y="0" width="3" height="${h}" fill="#fff"/>` : '';
  return `<svg viewBox="0 0 1000 ${h}" preserveAspectRatio="none" class="wsvg">${bars}${mark}</svg>`;
}
