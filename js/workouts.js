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
/** a ramp step for own workouts (builder row with toPct): the same as R, exported */
export const Ramp = R;
const reps = (n, on, off) => Array.from({ length: n }, (_, i) => [{ ...on, label: `${on.label} ${i + 1}/${n}` }, ...(i < n - 1 && off ? [off] : [])]).flat();

// Steps in absolute watts (coach workouts, Freddy 20.11.: "30 s at 340 W"): pct is worked out from the rider's FTP when it is
// read, so everything that runs on % FTP (ERG, charts, the ride setup) works unchanged. setFtp() is called by the pages; workoutState /
// workoutAt / workoutSVG also pass their FTP on.
let FTP_NOW = 250;
export const setFtp = f => { if (+f > 0) FTP_NOW = +f; };
const pctOf = w => Math.round(w / FTP_NOW * 1000) / 10;
export const A = (sec, watts, label = '') => ({ dur: Math.round(sec), watts, label, get pct() { return pctOf(this.watts); } });
const set3015 = k => Array.from({ length: 13 }, (_, i) => [A(30, 370, `30 / 15 · set ${k} · ${i + 1}/13`), ...(i < 12 ? [A(15, 125, 'Float')] : [])]).flat();

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
  { id: 'c_30_15_3x13', name: '30 / 15 · 3 × 13', coach: true, rampIn: 3, rampOut: 2,
    what: '18 min warm-up with three short sprints, then 3 sets of 13 × 30 s at 370 W with 15 s easy at 125 W, 3 min easy between the sets, 10 min cool-down. The first reps feel too easy, from the middle of the set it gets hard. 370 W is the 360 W ridden on 20.11. plus 10 (owner 27.11.); take the watts down with − if the third set does not hold.',
    steps: [R(10, 40, 72, 'Warm-up'), W(3, 72, 'Warm-up'), A(10, 420, 'Sprint 1/3'), A(50, 130, 'Spin'), A(10, 420, 'Sprint 2/3'), A(50, 130, 'Spin'), A(10, 420, 'Sprint 3/3'), A(170, 130, 'Spin'),
      ...set3015(1), A(180, 130, 'Rest'), ...set3015(2), A(180, 130, 'Rest'), ...set3015(3), R(10, 50, 35, 'Cool-down')] },
];

// ---- own workouts (Pro-Modus): built in the Training tab, stored in settings.myWorkouts as plain rows ----
// def = { id, name, warm, cool, rows: [{ t: 'b', min, pct, label } | { t: 'i', n, onMin, onPct, offMin, offPct, label }] }
export const MY = [];
const num = (v, d, lo, hi) => { const x = +v; return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
export function buildMy(def) {
  const rows = (def.rows || []).flatMap(r => r.t === 'i'
    ? reps(num(r.n, 3, 1, 30), W(num(r.onMin, 1, 0.25, 120), num(r.onPct, 105, 30, 200), r.label || 'Interval'), W(num(r.offMin, 1, 0, 120), num(r.offPct, 55, 30, 200), 'Rest')).filter(x => x.dur > 0)
    : [{ ...W(num(r.min, 5, 0.25, 240), num(r.pct, 70, 30, 200), r.label || 'Block'), ...(r.toPct != null && r.toPct !== '' ? { pct2: num(r.toPct, 70, 30, 200) } : {}) }]); // toPct: a ramp
  const steps = [...(def.warm !== false ? (rows.some(r => r.pct >= 95) ? warmHard : warm) : []), ...rows, ...(def.cool !== false ? cool : [])];
  const what = (def.rows || []).map(r => r.t === 'i' ? `${r.n} × ${r.onMin} min ${r.onPct} % / ${r.offMin} min ${r.offPct} %` : `${r.min} min ${r.pct}${r.toPct != null && r.toPct !== '' ? `–${r.toPct}` : ''} %`).join(', ');
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
    rows.push({ t: 'b', min: min(s), pct: s.pct, ...(s.pct2 != null ? { toPct: s.pct2 } : {}), label: (s.label || 'Block').replace(/ \d+\/\d+$/, '') });
  }
  return { id: 'my_' + Date.now().toString(36), name: w.name + ' (adjusted)', warm: hadWarm, cool: hadCool, rows };
}
export function setMyWorkouts(defs = []) { MY.length = 0; for (const d of defs || []) if (d && d.id) MY.push(buildMy(d)); }
export const PERSONAL = []; // personal workouts of the account (js/myworkouts-store.js), in the same shape as the built-ins
// coach workouts (js/coachworkouts.js): read at start from coach/workouts.json on the host, no app version needed; one with the id
// of a built-in replaces it (so the file can correct e.g. c_30_15_3x13)
export const COACH = [];
/** the catalogue: coach workouts, then the built-ins they do not replace */
export const catalog = () => COACH.length ? [...COACH, ...WORKOUTS.filter(w => !COACH.some(c => c.id === w.id))] : WORKOUTS.slice();
export const allWorkouts = () => [...MY, ...PERSONAL, ...catalog()];
export const workoutById = id => MY.find(w => w.id === id) || PERSONAL.find(w => w.id === id) || COACH.find(w => w.id === id) || WORKOUTS.find(w => w.id === id) || null;
export const workoutDuration = w => w.steps.reduce((s, x) => s + x.dur, 0);
export const ftpNow = () => FTP_NOW;

/* ---- steps that end by something other than the clock (personal workouts, js/myworkouts.js v2, owner 24.11.: the step
 *  model of a bike-computer workout builder). Such a step carries end = { kind: 'lap' | 'distance' (m) | 'calories' (kcal) |
 *  'hr' (op 'gt' | 'lt', bpm) | 'power' (op, w) }; its dur is then only an estimate for charts and the route fit. While riding,
 *  a run (runInit) keeps where the rider is: the step, when it started (workout clock, ridden metres, kJ) and how long each
 *  finished step really took. runView() turns the workout into the one actually ridden (finished steps at their real length,
 *  an open step growing with the time in it), so workoutState / workoutAt / the timeline / the Strava intervals run unchanged. ---- */
export const KCAL_PER_KJ = 1; // ≈ 24 % gross efficiency: 1 kJ at the pedals ≈ 1 kcal burnt, the usual rule of bike computers
export const HOLD_S = 2; // an end by heart rate or power: the value must stay across the limit this long (no end on one spike)
// heart-rate zones in % of max HR (the common 5-zone model of bike computers); the power zones are ZONE_PCT in js/myworkouts.js
export const HR_ZONES = [[50, 60], [60, 70], [70, 80], [80, 90], [90, 100]];
export const isOpen = st => !!st && !!st.end && st.end.kind !== 'time';
export const runInit = () => ({ i: 0, t0: 0, d0: 0, k0: 0, durs: [], holdT: null, same: true });
const advance = (run, len, s, nominal) => { run.durs[run.i] = len; if (len !== nominal) run.same = false; run.t0 += len; run.i++; run.d0 = s.d ?? 0; run.k0 = s.kj ?? 0; run.holdT = null; };
/** moves the run on to time t (workout clock, s) with the ride's numbers s = { d (m ridden), kj, hr, power }; returns true when a step ended */
export function runTick(w, run, t, s = {}) {
  let moved = false;
  for (let g = 0; g < 1000 && run.i < w.steps.length; g++) {
    const st = w.steps[run.i], into = t - run.t0; let done = false;
    if (!isOpen(st)) done = into >= st.dur;
    else { const e = st.end;
      if (e.kind === 'distance') done = (s.d ?? 0) - run.d0 >= e.m;
      else if (e.kind === 'calories') done = ((s.kj ?? 0) - run.k0) * KCAL_PER_KJ >= e.kcal;
      else if (e.kind === 'hr' || e.kind === 'power') {
        const v = e.kind === 'hr' ? s.hr : s.power, lim = e.kind === 'hr' ? e.bpm : e.w, across = v > 0 && (e.op === 'lt' ? v < lim : v > lim);
        if (!across) run.holdT = null; else if (run.holdT == null) run.holdT = t;
        done = run.holdT != null && t - run.holdT >= HOLD_S;
      } }
    if (!done) break;
    advance(run, isOpen(st) ? Math.max(1, into) : st.dur, s, st.dur); moved = true; // a timed step ends exactly on its length, so the clock never drifts
  }
  return moved;
}
/** the lap button / "Next step": ends the step running now (any kind, a timed one early too); false when the workout is over */
export function runNext(w, run, t, s = {}) {
  if (run.i >= w.steps.length) return false;
  const st = w.steps[run.i]; advance(run, Math.max(0, t - run.t0), s, isOpen(st) ? -1 : st.dur); return true; // its real length, even 0 s: the clock and the run stay together when Next is pressed twice in a second
}
/** the workout as ridden so far: finished steps at their real length, an open step as long as it ran (at least its estimate) */
export function runView(w, run, t) {
  if (!run) return w; const cur = w.steps[run.i];
  if (run.same && !isOpen(cur)) return w; // nothing ended early and nothing open: the workout itself (built-ins, timed workouts)
  return { ...w, steps: w.steps.map((st, k) => k < run.i ? { ...st, dur: run.durs[k] } : k === run.i && isOpen(st) ? { ...st, dur: Math.max(st.dur, Math.ceil(t - run.t0) + 1) } : st) };
}
/** what ends the running step, for the HUD: { kind, text (big), sub (small), frac (0..1 done, null when unknown) } or null (time) */
export function endInfo(st, run, s = {}) {
  const e = st?.end; if (!e || e.kind === 'time' || !run) return null;
  if (e.kind === 'lap') return { kind: 'lap', text: 'Lap', sub: 'press Next', frac: null };
  if (e.kind === 'distance') { const left = Math.max(0, e.m - ((s.d ?? 0) - run.d0)); return { kind: 'distance', text: left >= 1000 ? (left / 1000).toFixed(2) : String(Math.ceil(left)), sub: left >= 1000 ? 'km to go' : 'm to go', frac: 1 - left / e.m }; }
  if (e.kind === 'calories') { const left = Math.max(0, e.kcal - ((s.kj ?? 0) - run.k0) * KCAL_PER_KJ); return { kind: 'calories', text: String(Math.ceil(left)), sub: 'kcal to go', frac: 1 - left / e.kcal }; }
  const hr = e.kind === 'hr'; return { kind: e.kind, text: `${e.op === 'lt' ? '<' : '>'}${hr ? e.bpm : e.w}`, sub: hr ? 'bpm ends it' : 'W ends it', frac: null };
}
/** a target that is shown but never sent to the trainer (heart rate, cadence, speed): the band and where the rider is.
 *  t = { kind: 'hrZone', zone } | { kind: 'hr' | 'cadence' | 'speed', lo, hi }; s = { hr, cad, kmh }; o.hrMax for the zones.
 *  Returns { kind, name, lo, hi, unit, val, state: 'lo' | 'ok' | 'hi' | null, text } */
export function tgtInfo(t, s = {}, o = {}) {
  if (!t || t.kind === 'none') return null;
  const K = { hrZone: ['Heart rate', 'bpm', 'hr'], hr: ['Heart rate', 'bpm', 'hr'], cadence: ['Cadence', 'rpm', 'cad'], speed: ['Speed', 'km/h', 'kmh'] }[t.kind]; if (!K) return null;
  let lo = t.lo, hi = t.hi;
  if (t.kind === 'hrZone') { const z = HR_ZONES[(t.zone || 1) - 1] || HR_ZONES[0]; lo = o.hrMax > 0 ? Math.round(z[0] / 100 * o.hrMax) : null; hi = o.hrMax > 0 ? Math.round(z[1] / 100 * o.hrMax) : null; }
  const val = +s[K[2]] > 0 ? Math.round(+s[K[2]] * (t.kind === 'speed' ? 10 : 1)) / (t.kind === 'speed' ? 10 : 1) : null;
  const state = val == null || lo == null ? null : val < lo ? 'lo' : val > hi ? 'hi' : 'ok';
  const band = lo == null ? `zone ${t.zone} (set your max HR)` : `${lo}–${hi} ${K[1]}`;
  return { kind: t.kind, name: K[0], lo, hi, unit: K[1], val, state, text: `${t.kind === 'hrZone' ? `${K[0]} zone ${t.zone} · ` : `${K[0]} `}${band}` };
}

/** live watt tuning in a workout (Freddy 17.11.: "turn the watts up when I can push more"): an offset in W on the hard
 *  intervals only (pct >= 88, not a free test block), ±150 W, never below 50 W; rest and warm-up stay as they are */
export const WADJ_MAX = 150;
export const SHORT_HARD = 60; // s
export const isHard = s => !!s && !s.free && s.pct >= 88;
export const tuneAdj = (adj, d) => Math.max(-WADJ_MAX, Math.min(WADJ_MAX, Math.round((+adj || 0) + (+d || 0))));
export const tunedTarget = (step, target, adj) => target == null || !adj || !isHard(step) ? target : Math.max(50, target + adj);
export const fmtAdj = a => `${a > 0 ? '+' : a < 0 ? '−' : '±'}${Math.abs(a || 0)} W`;

/** % FTP of a step after `into` seconds: flat, or on the way from pct to pct2 on a ramp */
export const pctAt = (st, into = 0) => st.pct2 == null ? st.pct : st.pct + (st.pct2 - st.pct) * Math.min(1, Math.max(0, into / (st.dur || 1)));

/** everything a workout display needs at time t, with the rider's offsets and the ERG ramps (pure, tested):
 *  o.hardAdj  W on every hard interval (pct >= 88, not free), kept for the whole workout
 *  o.easyAdj  W on every easier step (warm-up, rests, cool-down; not free blocks), kept for the whole workout (owner 17.11.)
 *  o.ramp     true (ERG): no wall into a hard interval (flat steps only; a ramp step pct -> pct2 already is one): the last o.rampIn s (10) before it the target rises linearly from
 *             this step's to the interval's, and over the first o.rampOut s (5) after it falls back
 *  Returns { done, i, step, next, prev, left, inStep, target (W, ramped and adjusted: what the trainer gets and compliance
 *  uses), plateau (the step's own adjusted target), lo / hi (±5 % zone), ramp ('in' | 'out' | 'step' | null), hard,
 *  hardNo / hardCount / nextHardNo, name, nextTarget / nextName / nextDur, totalLeft, countdown (whole s, last 3 s before a
 *  change, else 0), rampTo / nextRampTo (W at the end of a ramp step), steps: [{ dur, pct (height incl. offset), pct2, hard, label }] } */
export function workoutState(w, t, ftp, o = {}) {
  setFtp(ftp); const hardAdj = o.hardAdj || 0, easyAdj = o.easyAdj || 0, rampIn = o.rampIn ?? w.rampIn ?? 10, rampOut = o.rampOut ?? w.rampOut ?? 5, steps = w.steps; // short on / off sets bring their own short ramps
  const W0 = (st, into) => { const b = Math.round(pctAt(st, into) / 100 * ftp); return isHard(st) ? tunedTarget(st, b, hardAdj) : easyAdj && !st.free ? Math.max(50, b + easyAdj) : b; };
  // intervals are counted within their series ("VO2max 2/5" is 2 of 5; the openers before it are their own series of 3)
  // (a builder workout's repeat blocks are series of their own: three sets "Bike 1/13 … 13/13" are 3 × 13, not 1 of 39 with the sprints before)
  const stem = x => (x?.label || '').replace(/\s*\d+\/\d+$/, '') + (x?.rep?.at != null ? '#' + x.rep.at : ''), series = x => steps.filter(y => isHard(y) && stem(y) === stem(x));
  const total = workoutDuration(w), main = steps.filter(isHard).map(stem).sort((a, b) => series({ label: b }).length - series({ label: a }).length)[0];
  const hardCount = steps.filter(x => isHard(x) && stem(x) === main).length;
  const ea = (p, st) => ftp && easyAdj && !st.free ? Math.max(50, p / 100 * ftp + easyAdj) / ftp * 100 : p; // the easy parts' offset (charts)
  const list = steps.map(st => ({ dur: st.dur, open: isOpen(st), type: st.type || null, pct: ftp && hardAdj && isHard(st) ? tunedTarget(st, st.pct / 100 * ftp, hardAdj) / ftp * 100 : isHard(st) ? st.pct : ea(st.pct, st), pct2: st.pct2 != null ? (isHard(st) ? (ftp && hardAdj ? tunedTarget(st, st.pct2 / 100 * ftp, hardAdj) / ftp * 100 : st.pct2) : ea(st.pct2, st)) : null, hard: isHard(st), label: st.label || '' }));
  let s = 0, i = 0; for (; i < steps.length && t >= s + steps[i].dur; i++) s += steps[i].dur;
  if (i >= steps.length) return { done: true, i: steps.length, step: null, next: null, prev: steps[steps.length - 1] || null, left: 0, inStep: 0, target: null, plateau: null, lo: null, hi: null, ramp: null, hard: false,
    hardNo: 0, hardCount, nextHardNo: 0, name: '', nextTarget: null, nextName: '', nextDur: 0, totalLeft: 0, countdown: 0, steps: list };
  const st = steps[i], next = steps[i + 1] || null, prev = steps[i - 1] || null, inStep = t - s, left = st.dur - inStep;
  const plateau = W0(st, inStep); let target = plateau, ramp = st.pct2 != null ? 'step' : null;
  // short efforts (sprints, 30 / 15: up to SHORT_HARD s) get no ramp at all: the trainer needs every second of them, the target jumps at the start and at the end
  const shortHard = x => !!x && isHard(x) && x.dur <= SHORT_HARD;
  if (o.ramp && !isHard(st) && !st.free && st.pct2 == null) { // a real ramp step needs no extra smoothing
    if (next && isHard(next) && !shortHard(next) && left < rampIn && rampIn > 0) { const k = 1 - left / rampIn, a = W0(st, st.dur), b = W0(next, 0); target = Math.round(a + (b - a) * k); ramp = 'in'; }
    else if (prev && isHard(prev) && !shortHard(prev) && inStep < rampOut && rampOut > 0) { const k = inStep / rampOut, a = W0(prev, prev.dur), b = W0(st, 0); target = Math.round(a + (b - a) * k); ramp = 'out'; }
  }
  const ser = isHard(st) ? series(st) : steps.filter(x => isHard(x) && stem(x) === main), cnt = ser.length, before = steps.slice(0, i).filter(x => ser.includes(x)).length;
  // a power range (personal workouts: power zone, custom power lo–hi) is the band itself, shifted with the rider's offset; else ±5 %
  const off = target - Math.round(pctAt(st, inStep) / 100 * ftp), lo = st.rlo != null && !st.free ? Math.round(st.rlo / 100 * ftp) + off : Math.round(target * .95), hi = st.rhi != null && !st.free ? Math.round(st.rhi / 100 * ftp) + off : Math.round(target * 1.05);
  const open = isOpen(st); // ends by lap button, distance, calories, heart rate or power: no time left to count down
  return { done: false, i, step: st, next, prev, left, inStep, target, plateau, lo, hi, range: st.rlo != null && !st.free, open, end: open ? st.end : null, ramp, hard: isHard(st),
    hardNo: isHard(st) ? before + 1 : 0, hardCount: cnt, nextHardNo: before + (isHard(st) ? 2 : 1) <= cnt ? before + (isHard(st) ? 2 : 1) : 0, series: isHard(st) ? stem(st) : main,
    name: st.label || 'Block', nextTarget: next ? W0(next, 0) : null, nextName: next ? next.label || 'Block' : '', nextDur: next ? next.dur : 0,
    rampTo: st.pct2 != null ? W0(st, st.dur) : null, nextRampTo: next?.pct2 != null ? W0(next, next.dur) : null, totalLeft: Math.max(0, total - t), countdown: next && !open && left <= 3 ? Math.max(1, Math.ceil(left)) : 0, steps: list };
}

/** where in the program we are at time t (seconds since start) */
export function workoutAt(w, t, ftp) {
  setFtp(ftp); let s = 0;
  for (let i = 0; i < w.steps.length; i++) {
    const st = w.steps[i];
    if (t < s + st.dur) return { i, step: st, next: w.steps[i + 1] || null, left: s + st.dur - t, target: Math.round(pctAt(st, t - s) / 100 * ftp), nextTarget: w.steps[i + 1] ? Math.round(w.steps[i + 1].pct / 100 * ftp) : null, done: false };
    s += st.dur;
  }
  return { i: w.steps.length, step: null, next: null, left: 0, target: null, done: true };
}

/** neon zone scale for the timeline (owner 17.11.): cool blue easy, green endurance, yellow tempo, orange threshold, hot
 *  red-orange VO2max, red above; by % FTP */
export const ZONES = [[56, '#3aa8ff'], [76, '#2ee59d'], [91, '#ffd23f'], [106, '#ff5a1f'], [121, '#ff3d1f'], [Infinity, '#ff1f3d']];
export const zoneColor = pct => ZONES.find(([lim]) => pct < lim)[1];

/** the big workout timeline (design C) from a workoutState: every step a block by its % FTP (with the offsets) in its neon
 *  zone colour; the current step full with a glow, the past dimmed; a white marker at time t */
export function timelineSVG(st, t, w, h = 92) {
  const W0 = 1280, list = st.steps, total = list.reduce((a, x) => a + x.dur, 0) || 1, mx = Math.max(125, ...list.map(x => Math.max(x.pct, x.pct2 ?? 0)));
  let x = 0, o = ''; const at = Math.min(total, Math.max(0, t)) / total * W0;
  list.forEach((s, i) => { const bw = s.dur / total * W0, ph = s.pct / mx * h, cur = i === st.i, done = i < st.i, op = cur ? 1 : done ? .3 : .72,
      col = zoneColor(s.pct2 != null ? (s.pct + s.pct2) / 2 : s.pct), f = cur ? ' filter="url(#wglow)"' : '';
    const x0 = (x + Math.min(1.5, bw / 4)).toFixed(1), x1 = (x + bw - Math.min(1.5, bw / 4)).toFixed(1);
    o += s.pct2 != null ? `<polygon points="${x0},${h} ${x0},${(h - ph).toFixed(1)} ${x1},${(h - s.pct2 / mx * h).toFixed(1)} ${x1},${h}" fill="${col}" opacity="${op}"${f}/>`
      : `<rect x="${x0}" y="${(h - ph).toFixed(1)}" width="${Math.max(0.5, x1 - x0).toFixed(1)}" height="${ph.toFixed(1)}" rx="3" fill="${col}" opacity="${op}"${s.open ? ` fill-opacity=".45" stroke="${col}" stroke-width="2" stroke-dasharray="6 4"` : ''}${f}/>`; x += bw; }); // an open step (lap button, distance …): dashed, its width only an estimate until it ends
  return `<svg class="wtl" viewBox="0 0 ${W0} ${h + 8}" preserveAspectRatio="none"><defs><filter id="wglow" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`
    + `<g transform="translate(0,4)">${o}</g><rect x="${(at - 2).toFixed(1)}" y="0" width="4" height="${h + 8}" fill="#fff" style="filter:drop-shadow(0 0 4px #fff)"/></svg>`;
}

/** small block chart of the program (SVG), the current position marked with a line; adj / ftp: hard bars at the tuned target */
export function workoutSVG(w, t = null, h = 46, adj = 0, ftp = 0) {
  const total = workoutDuration(w), pc = s => adj && ftp ? tunedTarget(s, s.pct / 100 * ftp, adj) / ftp * 100 : s.pct, max = Math.max(...w.steps.map(s => Math.max(pc(s), s.pct2 ?? 0)), 120);
  let x = 0;
  const bars = w.steps.map(s => {
    const bw = s.dur / total * 1000, bh = pc(s) / max * h, col = s.pct >= 105 ? 'var(--accent)' : s.pct >= 88 ? '#f2b630' : s.pct >= 70 ? '#2fb36b' : '#6b7480';
    const r = s.pct2 != null ? `<polygon points="${x.toFixed(1)},${h} ${x.toFixed(1)},${(h - bh).toFixed(1)} ${(x + Math.max(0.5, bw - 0.6)).toFixed(1)},${(h - s.pct2 / max * h).toFixed(1)} ${(x + Math.max(0.5, bw - 0.6)).toFixed(1)},${h}" fill="${col}"/>` // a ramp step: a slope
      : `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(0.5, bw - 0.6).toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}"/>`;
    x += bw; return r;
  }).join('');
  const mark = t != null ? `<rect x="${Math.min(1000, t / total * 1000).toFixed(1)}" y="0" width="3" height="${h}" fill="#fff"/>` : '';
  return `<svg viewBox="0 0 1000 ${h}" preserveAspectRatio="none" class="wsvg">${bars}${mark}</svg>`;
}
