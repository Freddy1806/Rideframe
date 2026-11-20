// Guided strength workouts (Freddy 20.11.: "ein eigenes Workout für den einarmigen Klimmzug, das mich durchführt, und
// dasselbe für Liegestütze"). Plans as data, so more can be added later; pure functions, no page code (Node tests in
// tools/kraftguide-test.mjs). The player UI lives in kraftplayer.js.
//
// A plan is a list of blocks. Every block has an exercise kind:
//   reps  – normal sets, the user taps Done and can correct the reps (stored like any bodyweight set: r)
//   hold  – timed one-arm hold, counts up past the target until Done (stored as a 'time' set: s = seconds)
//   neg   – timed slow negative, same as hold
// One-arm blocks run left then right per round, each arm is its own exercise (own graph and records per arm).
// Before every effort there is a 5 s get-ready countdown; after every effort a rest (none after the very last one).

export const READY = 5;       // get-ready countdown before every effort, s
export const REP_SEC = { pull: 3, push: 2 }; // planned time per rep for the time estimate, s
export const NEG_SETUP = 3;   // pulling / pushing up with both arms before a negative, s (time estimate only)
export const LEVEL_UP_SEC = 8; // every hold and every negative ≥ 8 s in two sessions in a row → next level
export const MAX_TARGET = { hold: 10, neg: 10 }; // level 3: the targets rise to these

export const PLANS = [
  {
    id: 'oapull', name: 'One-arm pull-up', short: 'One-arm pull-up training',
    line: 'Lock-off holds and slow one-arm negatives, left and right.',
    need: ['Pull-up bar', 'A towel (level 2)'], icon: 'pull',
    real: 'Try a real one-arm pull-up fresh at the start of the next session.',
    levels: [
      { n: 1, name: 'Assisted', tag: 'Assisted', how: 'The free hand grips the wrist of the working arm.' },
      { n: 2, name: 'Two fingers', tag: 'Two fingers', how: 'The free hand helps with two fingers on the bar or on a towel.' },
      { n: 3, name: 'Free', tag: 'Free', how: 'Really one arm. The free hand stays off the bar.' },
    ],
    base: { hold: 6, neg: 5 },
    blocks: [
      { kind: 'reps', ex: 'pull', name: 'Warm-up pull-ups', sets: 2, reps: 5, rest: 75, rep: 'pull',
        what: 'Normal pull-ups, both arms', cue: 'Full hang at the bottom, chin over the bar, no swinging.' },
      { kind: 'hold', ex: 'oap_hold', name: 'Lock-off hold', rounds: 3, rest: 60,
        what: 'Hold at the top, chin over the bar', cue: 'Pull up with both arms, then let go with the free hand. Shoulder down, elbow tight.' },
      { kind: 'neg', ex: 'oap_neg', name: 'One-arm negative', rounds: 3, rest: 90,
        what: 'Pull up with both arms, lower on one', cue: 'Fight the drop all the way down. Keep the shoulder packed.' },
    ],
    ex: { pull: ['Pull-ups', 'Back'], oap_hold: ['One-arm lock-off hold', 'Back'], oap_neg: ['One-arm negative pull-up', 'Back'] },
  },
  {
    id: 'oapush', name: 'One-arm push-up', short: 'One-arm push-up training',
    line: 'One-arm holds half-way down and slow one-arm negatives.',
    need: ['Floor', 'Bench or chair (level 1)'], icon: 'push',
    real: 'Try a real one-arm push-up fresh at the start of the next session.',
    levels: [
      { n: 1, name: 'Raised', tag: 'Raised', how: 'Working hand on a bench or chair, body in an incline.' },
      { n: 2, name: 'Floor, feet wide', tag: 'Feet wide', how: 'On the floor, feet wider than the shoulders.' },
      { n: 3, name: 'Floor, feet shoulder-width', tag: 'Feet narrow', how: 'On the floor, feet only shoulder-width apart.' },
    ],
    base: { hold: 6, neg: 5 },
    blocks: [
      { kind: 'reps', ex: 'push', name: 'Warm-up push-ups', sets: 2, reps: 10, rest: 60, rep: 'push',
        what: 'Normal push-ups, both arms', cue: 'Body in one line, chest to a fist above the floor.' },
      { kind: 'hold', ex: 'oapu_hold', name: 'One-arm hold', rounds: 3, rest: 60,
        what: 'Hold the half-way position on one arm', cue: 'Feet wide, hips square to the floor, elbow close to the body.' },
      { kind: 'neg', ex: 'oapu_neg', name: 'One-arm negative', rounds: 4, rest: 75,
        what: 'Lower on one arm, push back up with both', cue: 'Hips stay square, do not twist. Free hand behind the back.' },
    ],
    ex: { push: ['Push-ups', 'Chest'], oapu_hold: ['One-arm push-up hold', 'Chest'], oapu_neg: ['One-arm negative push-up', 'Chest'] },
  },
];
export const planOf = id => PLANS.find(p => p.id === id) || null;

const SIDE = { L: 'left', R: 'right' };
/** exercise key and name for a block and side: one exercise per arm ("One-arm lock-off hold (left)") */
export const exKey = (b, side) => side ? `${b.ex}_${side.toLowerCase()}` : b.ex;
export function exName(plan, b, side) { const n = plan.ex[b.ex][0]; return side ? `${n} (${SIDE[side]})` : n; }
/** every exercise the guided plans can write, for the exercise list (name, kind, muscle group) */
export const GUIDE_EX = PLANS.flatMap(p => p.blocks.flatMap(b => b.kind === 'reps' ? [] : ['L', 'R'].map(s => ({ k: exKey(b, s), n: exName(p, b, s), t: 'time', g: p.ex[b.ex][1] }))));

/** the steps of a plan at a level with targets {hold, neg}: ready / reps / hold / neg / rest, in order */
export function buildSteps(plan, lvl, tg = plan.base) {
  const steps = [], L = plan.levels[(lvl || 1) - 1] || plan.levels[0];
  let eff = 0;
  plan.blocks.forEach((b, bi) => {
    const units = b.kind === 'reps' ? [...Array(b.sets)].map((_, i) => ({ side: null, round: i + 1, of: b.sets }))
      : [...Array(b.rounds)].flatMap((_, i) => ['L', 'R'].map(side => ({ side, round: i + 1, of: b.rounds })));
    for (const u of units) {
      const e = { kind: b.kind, block: bi, ex: exKey(b, u.side), exName: exName(plan, b, u.side), side: u.side, round: u.round, of: u.of, n: eff++,
        title: u.side ? `${SIDE[u.side]} arm`.toUpperCase() : `SET ${u.round} OF ${u.of}`, label: b.name, what: b.what, cue: b.cue, how: b.kind === 'reps' ? '' : L.how };
      if (b.kind === 'reps') { e.reps = b.reps; e.plan = b.reps * (REP_SEC[b.rep] || 3); }
      else { e.target = b.kind === 'hold' ? tg.hold : tg.neg; e.plan = e.target + (b.kind === 'neg' ? NEG_SETUP : 0);
        if (b.kind === 'neg') e.what = `${b.what}. Lower as slowly as you can, aim for ${e.target} s`; }
      steps.push({ kind: 'ready', sec: READY, n: e.n }, e, { kind: 'rest', sec: b.rest, n: e.n });
    }
  });
  steps.pop(); // no rest after the very last effort
  return steps;
}
/** planned seconds of a step list: get-ready + efforts + rests */
export const stepSec = s => s.kind === 'ready' || s.kind === 'rest' ? s.sec : s.plan;
export const planSeconds = steps => steps.reduce((a, s) => a + stepSec(s), 0);
export const efforts = steps => steps.filter(s => s.kind !== 'ready' && s.kind !== 'rest');

// ---------------- history, targets and levels ----------------
/** the saved sessions of this plan, newest first (list = kv 'kraft', already newest first) */
export const sessionsOf = (list, id) => (list || []).filter(s => s.guide?.id === id).sort((a, b) => (b.start || b.date) - (a.start || a.date));
/** all seconds of one kind (hold / neg) in a saved session */
function secsOf(plan, s, kind) {
  const keys = new Set(plan.blocks.filter(b => b.kind === kind).flatMap(b => [exKey(b, 'L'), exKey(b, 'R')]));
  return (s.ex || []).filter(x => keys.has(x.k)).flatMap(x => x.sets.filter(y => y.done).map(y => +y.s || 0));
}
function plannedCount(plan, kind) { return plan.blocks.filter(b => b.kind === kind).reduce((a, b) => a + b.rounds * 2, 0); }
/** every planned hold and negative was done and reached at least the given seconds */
function allAtLeast(plan, s, hold, neg) {
  const h = secsOf(plan, s, 'hold'), n = secsOf(plan, s, 'neg');
  return h.length >= plannedCount(plan, 'hold') && n.length >= plannedCount(plan, 'neg') && h.every(v => v >= hold) && n.every(v => v >= neg);
}
/** targets at a level: levels 1 and 2 use the base targets; on level 3 they rise by 1 s after every session at level 3
 *  that reached all of them, up to MAX_TARGET */
export function targetsFor(plan, sessions, lvl) {
  if (lvl < 3) return { ...plan.base };
  const last = sessions.find(s => s.guide?.lvl === 3);
  if (!last) return { ...plan.base };
  const t = { hold: last.guide.hold || plan.base.hold, neg: last.guide.neg || plan.base.neg };
  const h = secsOf(plan, last, 'hold'), n = secsOf(plan, last, 'neg');
  const full = h.length >= plannedCount(plan, 'hold') && n.length >= plannedCount(plan, 'neg');
  if (full && h.every(v => v >= t.hold)) t.hold = Math.min(MAX_TARGET.hold, t.hold + 1);
  if (full && n.every(v => v >= t.neg)) t.neg = Math.min(MAX_TARGET.neg, t.neg + 1);
  return t;
}
/** where the user stands after the saved sessions (newest first): the level to preselect, its targets, whether a level-up
 *  was earned by the newest session (two in a row at the same level, every hold and negative ≥ 8 s), and on level 3
 *  whether the top targets were all reached (time for a real one-arm rep) */
export function standing(plan, sessions) {
  const [a, b] = sessions;
  if (!a) return { lvl: 1, tg: { ...plan.base }, up: false, real: false };
  const lvl = Math.min(3, Math.max(1, a.guide?.lvl || 1));
  if (lvl < 3) {
    const up = !!b && b.guide?.lvl === lvl && allAtLeast(plan, a, LEVEL_UP_SEC, LEVEL_UP_SEC) && allAtLeast(plan, b, LEVEL_UP_SEC, LEVEL_UP_SEC);
    const next = up ? lvl + 1 : lvl;
    return { lvl: next, tg: targetsFor(plan, sessions, next), up, real: false };
  }
  const real = (a.guide.hold || 0) >= MAX_TARGET.hold && (a.guide.neg || 0) >= MAX_TARGET.neg && allAtLeast(plan, a, MAX_TARGET.hold, MAX_TARGET.neg);
  return { lvl: 3, tg: targetsFor(plan, sessions, 3), up: false, real };
}
/** best seconds per arm and kind in a saved session: { hold: {L, R}, neg: {L, R} } */
export function bestsOf(plan, s) {
  const out = { hold: { L: 0, R: 0 }, neg: { L: 0, R: 0 } };
  if (!s) return out;
  for (const b of plan.blocks) if (b.kind !== 'reps') for (const side of ['L', 'R']) {
    const x = (s.ex || []).find(y => y.k === exKey(b, side));
    if (x) out[b.kind][side] = Math.max(out[b.kind][side], ...x.sets.filter(y => y.done).map(y => +y.s || 0));
  }
  return out;
}

/** the strength workout to save from a finished guided run: results = { [effort n]: reps or seconds } */
export function toWorkout(plan, G, steps, results, now = Date.now()) {
  const ex = [];
  for (const e of efforts(steps)) {
    const v = results[e.n]; if (v == null) continue;
    let x = ex.find(y => y.k === e.ex);
    if (!x) { x = { k: e.ex, n: e.exName, t: e.kind === 'reps' ? 'bw' : 'time', sets: [] }; ex.push(x); }
    x.sets.push(e.kind === 'reps' ? { kg: '', r: v, s: '', done: true } : { kg: '', r: '', s: v, done: true, lvl: G.lvl });
  }
  const L = plan.levels[G.lvl - 1];
  return { id: G.wid, name: plan.short, start: G.start, date: now, dur: Math.round(G.dur || 0), ex,
    guide: { id: plan.id, lvl: G.lvl, hold: G.tg.hold, neg: G.tg.neg }, note: `Guided · Level ${G.lvl} · ${L.name}` };
}
