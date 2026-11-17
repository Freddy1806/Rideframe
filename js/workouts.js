// Training programs: power targets over time, in % of FTP. Ridden on any route, also the flat coast:
// in ERG mode the trainer holds the target power itself (the road grade then only sets the speed you see),
// without ERG the trainer keeps simulating the road and the HUD shows the target to hit.
const W = (min, pct, label = '') => ({ dur: Math.round(min * 60), pct, label });
// a ramp: the target moves evenly from pct to pct2 over the step (ERG follows it second by second)
const R = (min, from, to, label = '') => ({ dur: Math.round(min * 60), pct: from, pct2: to, label });
// How the sessions are built (reviewed 17.11. against the structured workouts of Zwift and TrainerRoad and the interval literature):
// · every session starts with a ramp from very easy to 75 % FTP instead of flat blocks, so heart rate and legs come up gradually
// · before work at threshold and above: a short block at 85 %, then three 30 s openers rising 100 / 110 / 120 % with easy spinning
//   between (primes the oxygen uptake, costs no freshness), two easy minutes, then the first interval. 15.5 min in all
// · before sweet spot and tempo: the ramp and one minute at the working intensity, two easy minutes. 11 min
// · rests are active (50–55 %), long enough to repeat the quality: threshold about 1:3, VO2max 1:1 down to 4:1 on the long 8s
// · every session ends with a ramp down to 35 %
const warm = [R(8, 40, 75, 'Warm-up'), W(1, 90, 'Warm-up'), W(2, 50, 'Spin')];
const warmHard = [R(8, 40, 75, 'Warm-up'), W(2, 85, 'Warm-up'), W(0.5, 100, 'Opener 1/3'), W(1, 50, 'Spin'), W(0.5, 110, 'Opener 2/3'), W(1, 50, 'Spin'), W(0.5, 120, 'Opener 3/3'), W(2, 50, 'Spin')];
const cool = [R(6, 55, 35, 'Cool-down')];
const reps = (n, on, off) => Array.from({ length: n }, (_, i) => [{ ...on, label: `${on.label} ${i + 1}/${n}` }, ...(i < n - 1 && off ? [off] : [])]).flat();

export const WORKOUTS = [
  { id: 'ss3x10', name: 'Sweet Spot 3 × 10', what: '3 × 10 min at 90 % FTP, 4 min easy between. The classic for more endurance power.',
    steps: [...warm, ...reps(3, W(10, 90, 'Sweet Spot'), W(4, 55, 'Rest')), ...cool] },
  { id: 'thr2x20', name: 'Threshold 2 × 20', what: '2 × 20 min at 97 % FTP, 7 min easy between. Hard, but it raises your FTP.',
    steps: [...warmHard, ...reps(2, W(20, 97, 'Threshold'), W(7, 50, 'Rest')), ...cool] },
  { id: 'over_under', name: 'Over-Unders 3 × 9', what: '9 min each: alternating 2 min at 95 % and 1 min at 105 %, 5 min easy between. Teaches you to ride above threshold and recover just under it.',
    steps: [...warmHard, ...[0, 1, 2].flatMap(i => [
      ...[0, 1, 2].flatMap(() => [W(2, 95, `Under ${i + 1}/3`), W(1, 105, `Over ${i + 1}/3`)]), ...(i < 2 ? [W(5, 50, 'Rest')] : [])]), ...cool] },
  { id: 'vo2_5x3', name: 'VO2max 5 × 3', what: '5 × 3 min at 120 % FTP, 3 min easy. Short and sharp, for attacks and steep ramps.',
    steps: [...warmHard, ...reps(5, W(3, 120, 'VO2max'), W(3, 50, 'Rest')), ...cool] },
  { id: 'vo2_4x4', name: 'VO2max 4 × 4', what: '4 × 4 min at 115 % FTP, 3 min easy. The classic 4 × 4, raises oxygen uptake.',
    steps: [...warmHard, ...reps(4, W(4, 115, 'VO2max'), W(3, 50, 'Rest')), ...cool] },
  { id: 'vo2_5x5', name: 'VO2max 5 × 5', what: '5 × 5 min at 110 % FTP, 4 min easy. Long VO2max intervals, hard but steady.',
    steps: [...warmHard, ...reps(5, W(5, 110, 'VO2max'), W(4, 50, 'Rest')), ...cool] },
  { id: 'vo2_4x8', name: 'VO2max 4 × 8', what: '4 × 8 min at 105 % FTP, only 2 min easy. The most time near your maximum of all sessions here: pace the first one.',
    steps: [...warmHard, ...reps(4, W(8, 105, 'VO2max'), W(2, 50, 'Rest')), ...cool] },
  { id: 'vo2_30_30', name: 'VO2max 30 / 30', what: '2 sets of 10 × 30 s at 125 % FTP with 30 s easy, 5 min between the sets. Lots of time at high oxygen uptake, easier on the head.',
    steps: [...warmHard, ...[0, 1].flatMap(k => [...Array.from({ length: 10 }, (_, i) => [W(0.5, 125, `30 / 30 · set ${k + 1} · ${i + 1}/10`), ...(i < 9 ? [W(0.5, 50, 'Float')] : [])]).flat(), ...(k < 1 ? [W(5, 50, 'Rest')] : [])]), ...cool] },
  { id: 'pyramid', name: 'Pyramid', what: '1-2-3-4-3-2-1 min, rising from 105 to 120 % and back, rests as long as the effort before.',
    steps: [...warmHard, ...[[1, 120], [2, 115], [3, 110], [4, 105], [3, 110], [2, 115], [1, 120]].flatMap(([m, p], i, a) => [W(m, p, 'Pyramid'), ...(i < a.length - 1 ? [W(Math.max(1.5, m), 50, 'Rest')] : [])]), ...cool] },
  { id: 'sprints', name: 'Sprints 8 × 30 s', what: '8 × 30 s all out (150 % in ERG), 4:30 easy so every sprint is a full one.',
    steps: [...warmHard, ...reps(8, W(0.5, 150, 'Sprint'), W(4.5, 50, 'Rest')), ...cool] },
  { id: 'tempo2x15', name: 'Tempo 2 × 15', what: '2 × 15 min at 82 % FTP, 4 min easy between. Brisk but very doable, builds endurance.',
    steps: [...warm, ...reps(2, W(15, 82, 'Tempo'), W(4, 55, 'Rest')), ...cool] },
  { id: 'ss2x12', name: 'Sweet Spot short 2 × 12', what: '2 × 12 min at 90 % FTP. Little time, still a good FTP stimulus.',
    steps: [...warm, ...reps(2, W(12, 90, 'Sweet Spot'), W(4, 55, 'Rest')), ...cool] },
  { id: 'z2_60', name: 'Endurance 60 min', what: '60 min steady at 65 % FTP. Burn fat, clear your head.',
    steps: [R(6, 40, 65, 'Warm-up'), W(49, 65, 'Endurance'), R(5, 60, 35, 'Cool-down')] },
  { id: 'z2_90', name: 'Endurance 90 min', what: '90 min steady at 65–70 % FTP with three short tempo blocks. The long ride.',
    steps: [R(8, 40, 66, 'Warm-up'), W(20, 66, 'Endurance'), W(5, 80, 'Tempo'), W(20, 66, 'Endurance'), W(5, 80, 'Tempo'), W(16, 66, 'Endurance'), W(5, 80, 'Tempo'), W(5, 66, 'Endurance'), R(6, 60, 35, 'Cool-down')] },
  { id: 'rec30', name: 'Recovery 30 min', what: '30 min very easy, never above 55 % FTP. Loosens the legs after hard days.',
    steps: [R(5, 40, 52, 'Easy spin'), W(20, 52, 'Easy'), R(5, 50, 35, 'Easy spin down')] },
  { id: 'ramp', name: 'Ramp test (FTP)', what: 'Every minute +6 % FTP until you cannot go on. New FTP ≈ 75 % of the best minute. Press space to finish.',
    steps: [R(5, 40, 55, 'Warm-up'), ...Array.from({ length: 25 }, (_, i) => W(1, 60 + i * 6, `Step ${i + 1}`)), ...cool] },
  // classic 20-min test (Freddy 12.11. "fitnesstest"): the 20 minutes are ridden freely (no ERG), new FTP = 95 % of their average
  { id: 'ftp20', name: '20-min test (FTP)', what: 'Warm-up, 5 min opener, then 20 min as hard as you can hold evenly. No ERG, you set the pace. New FTP = 95 % of it.',
    steps: [R(10, 40, 75, 'Warm-up'), W(0.5, 110, 'Opener 1/3'), W(1, 50, 'Spin'), W(0.5, 110, 'Opener 2/3'), W(1, 50, 'Spin'), W(0.5, 110, 'Opener 3/3'), W(2.5, 50, 'Spin'), W(5, 105, 'Opener 5 min'), W(10, 50, 'Easy'), { ...W(20, 100, 'Test 20 min'), free: true }, R(10, 55, 35, 'Cool-down')] },
];

// ---- own workouts (Pro-Modus): built in the Training tab, stored in settings.myWorkouts as plain rows ----
// def = { id, name, warm, cool, rows: [{ t: 'b', min, pct, label } | { t: 'i', n, onMin, onPct, offMin, offPct, label }] }
export const MY = [];
const num = (v, d, lo, hi) => { const x = +v; return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
export function buildMy(def) {
  const rows = (def.rows || []).flatMap(r => r.t === 'i'
    ? reps(num(r.n, 3, 1, 30), W(num(r.onMin, 1, 0.25, 120), num(r.onPct, 105, 30, 200), r.label || 'Interval'), W(num(r.offMin, 1, 0, 120), num(r.offPct, 55, 30, 200), 'Rest')).filter(x => x.dur > 0)
    : [W(num(r.min, 5, 0.25, 240), num(r.pct, 70, 30, 200), r.label || 'Block')]);
  const steps = [...(def.warm !== false ? (rows.some(r => r.pct >= 95) ? warmHard : warm) : []), ...rows, ...(def.cool !== false ? cool : [])];
  const what = (def.rows || []).map(r => r.t === 'i' ? `${r.n} × ${r.onMin} min ${r.onPct} % / ${r.offMin} min ${r.offPct} %` : `${r.min} min ${r.pct} %`).join(', ');
  return { id: def.id, name: def.name || 'My workout', what: `Own workout: ${what || 'empty'}.`, steps: steps.length ? steps : [W(5, 50, 'Easy')], mine: true };
}
/** a standard workout as an editable definition (Freddy 16.11.: "2× Schwelle 20 min anpassen: Watt, Länge, mehr Runden"):
 *  warm-up and cool-down become the switches, "Name 1/n" + pause runs become interval rows, everything else single blocks */
export function defFrom(w) {
  let st = w.steps.slice(); const isWarm = s => /^(Warm-up|Spin|Opener \d\/3|Easy spin|Ein(fahren|rollen))$/.test(s.label), isCool = s => /^(Cool-down|Easy spin down|Aus(fahren|rollen))$/.test(s.label);
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
export const PERSONAL = []; // personal workouts of the account (js/myworkouts-store.js), in the same shape as the built-ins
export const allWorkouts = () => [...MY, ...PERSONAL, ...WORKOUTS];
export const workoutById = id => MY.find(w => w.id === id) || PERSONAL.find(w => w.id === id) || WORKOUTS.find(w => w.id === id) || null;
export const workoutDuration = w => w.steps.reduce((s, x) => s + x.dur, 0);

/** % FTP of a step after `into` seconds: flat, or on the way from pct to pct2 on a ramp */
export const pctAt = (st, into = 0) => st.pct2 == null ? st.pct : st.pct + (st.pct2 - st.pct) * Math.min(1, Math.max(0, into / (st.dur || 1)));
/** where in the program we are at time t (seconds since start) */
export function workoutAt(w, t, ftp) {
  let s = 0;
  for (let i = 0; i < w.steps.length; i++) {
    const st = w.steps[i];
    if (t < s + st.dur) return { i, step: st, next: w.steps[i + 1] || null, left: s + st.dur - t, target: Math.round(pctAt(st, t - s) / 100 * ftp), nextTarget: w.steps[i + 1] ? Math.round(w.steps[i + 1].pct / 100 * ftp) : null, done: false };
    s += st.dur;
  }
  return { i: w.steps.length, step: null, next: null, left: 0, target: null, done: true };
}

/** small block chart of the program (SVG), the current position marked with a line */
export function workoutSVG(w, t = null, h = 46) {
  const total = workoutDuration(w), max = Math.max(...w.steps.map(s => Math.max(s.pct, s.pct2 ?? 0)), 120);
  let x = 0;
  const bars = w.steps.map(s => {
    const bw = s.dur / total * 1000, bh = s.pct / max * h, col = s.pct >= 105 ? 'var(--accent)' : s.pct >= 88 ? '#f2b630' : s.pct >= 70 ? '#2fb36b' : '#6b7480';
    const bh2 = (s.pct2 ?? s.pct) / max * h, x2 = x + Math.max(0.5, bw - 0.6);
    const r = s.pct2 == null ? `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(0.5, bw - 0.6).toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}"/>`
      : `<polygon points="${x.toFixed(1)},${h} ${x.toFixed(1)},${(h - bh).toFixed(1)} ${x2.toFixed(1)},${(h - bh2).toFixed(1)} ${x2.toFixed(1)},${h}" fill="${col}"/>`;
    x += bw; return r;
  }).join('');
  const mark = t != null ? `<rect x="${Math.min(1000, t / total * 1000).toFixed(1)}" y="0" width="3" height="${h}" fill="#fff"/>` : '';
  return `<svg viewBox="0 0 1000 ${h}" preserveAspectRatio="none" class="wsvg">${bars}${mark}</svg>`;
}
