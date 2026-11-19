// The Eagle of Destiny (owner 18.11.): gating rules and the model fallback chain (js/eaglegate.js).
// · only inside a hard interval (never warm-up, opener, spin, rest, cool-down), only with enough time left for the scene
// · once per workout, random interval, random moment; ?eagle = 3 s into the first hard interval
// · never with the wizard or a dare: waits while they are on, moves on when the wizard was called in its interval
// · model: adler_nah (jaw) -> seeadler (nod) -> stand-in; the beak's fallback timing; the framing on any aspect
// Usage: node --test tools/eagle-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { EAGLE, sceneLen, eagleSlots, planEagle, eagleGate, moveEagle, othersBusy, pickEagleModel, synthMouth, follow, eagleFrame } from '../js/eaglegate.js';
import { workoutById, workoutState } from '../js/workouts.js';
import { hardWindow } from '../js/ivgate.js';
import { Wizard } from '../js/wizard.js';

const FTP = 250, W = workoutById('vo2_5x5'), SS = workoutById('ss3x10'), SPR = workoutById('vo2_30_30');
const startOf = (w, i) => w.steps.slice(0, i).reduce((a, x) => a + x.dur, 0);
const seq = (...xs) => { let k = 0; return () => xs[k++ % xs.length]; };
/** run the gate over the whole workout second by second; returns the times it said 'go' */
function ride(w, e, { busyAt = () => false, wizIvAt = () => -1, step = 1, rng = Math.random } = {}) {
  const total = w.steps.reduce((a, x) => a + x.dur, 0), gos = [];
  for (let t = 0; t <= total; t += step) {
    const st = workoutState(w, t, FTP), stepI = st.done ? Infinity : st.i, win = st.done ? null : hardWindow(w, t, FTP);
    const g = eagleGate(e, { win, stepI, busy: busyAt(t), wizIv: wizIvAt(t) });
    if (g === 'go') { gos.push({ t, i: st.i, label: st.step.label, left: win?.left }); e.state = 'play'; }
    if (g === 'move') e = moveEagle(w, e, { stepI, rng });
    if (e.state === 'play' && t > gos[0].t + sceneLen()) e.state = 'done';
  }
  return { gos, e };
}

test('slots: only the hard intervals (no warm-up, openers, spin, rests, cool-down), long enough for the scene', () => {
  const s = eagleSlots(W, FTP);
  assert.equal(s.length, 5); for (const x of s) assert.match(W.steps[x.i].label, /^VO2max/);
  assert.equal(eagleSlots(SS, FTP).length, 3, 'sweet spot: the 90 % warm-up minute never counts');
  assert.equal(eagleSlots(SPR, FTP).length, 0, '30/30: too short for him, no eagle');
  assert.equal(planEagle(SPR), null); assert.equal(planEagle(null), null);
  assert.ok(sceneLen() <= EAGLE.need && sceneLen() >= 16 && sceneLen() <= 18, 'the scene takes about 17 s (fly in, look ahead, the slow turn, the line, off), the gate asks for 19');
  assert.ok(EAGLE.minIv > 30 && EAGLE.minIv >= EAGLE.need + EAGLE.lead, 'a 30 s interval never gets him, whatever the gate');
});

test('random interval and random moment, inside the interval with time left', () => {
  const seen = new Set();
  for (let k = 0; k < 400; k++) {
    const e = planEagle(W, { ftp: FTP }); seen.add(e.iv);
    const st = W.steps[e.iv]; assert.match(st.label, /^VO2max/);
    assert.ok(e.leftAt >= EAGLE.need && e.leftAt <= st.dur - EAGLE.lead, `leftAt ${e.leftAt}`);
  }
  assert.equal(seen.size, 5, 'every interval can get him');
});

test('once per workout, only inside a hard interval, never in a rest, enough time left', () => {
  for (let k = 0; k < 60; k++) {
    const { gos } = ride(W, planEagle(W, { ftp: FTP }));
    assert.equal(gos.length, 1, 'exactly once');
    assert.match(gos[0].label, /^VO2max/); assert.ok(gos[0].left >= EAGLE.need, 'time left for the whole scene');
  }
});

test('?eagle: 3 s after the first hard interval starts', () => {
  const e = planEagle(W, { force: true, ftp: FTP }), first = eagleSlots(W, FTP)[0];
  const { gos } = ride(W, e);
  assert.equal(gos.length, 1); assert.equal(gos[0].i, first.i); assert.equal(gos[0].t, startOf(W, first.i) + 3);
  assert.equal(eagleGate({ state: 'wait', now: true }, { win: null, stepI: 0 }), 'go', '?eagle=now: right away, any ride');
  assert.equal(eagleGate({ state: 'wait', now: true }, { win: null, stepI: 0, busy: true }), null, '... but not on top of the wizard');
});

test('rest, warm-up, opener: no; too little left: he moves on', () => {
  const e = { state: 'wait', iv: eagleSlots(W, FTP)[1].i, leftAt: 200 }, a = startOf(W, e.iv);
  assert.equal(eagleGate(e, { win: hardWindow(W, a - 10, FTP), stepI: e.iv - 1 }), null, 'rest before it');
  assert.equal(hardWindow(W, 30, FTP), null, 'warm-up is no window');
  assert.equal(eagleGate(e, { win: hardWindow(W, a + 50, FTP), stepI: e.iv }), null, 'too early in it');
  assert.equal(eagleGate(e, { win: hardWindow(W, a + 101, FTP), stepI: e.iv }), 'go');
  assert.equal(eagleGate(e, { win: hardWindow(W, a + 300 - 10, FTP), stepI: e.iv }), 'move', '10 s left: not enough');
  assert.equal(eagleGate(e, { win: null, stepI: e.iv + 1 }), 'move', 'his interval is over');
  const m = moveEagle(W, e, { stepI: e.iv + 1 }); assert.ok(m.iv > e.iv && /^VO2max/.test(W.steps[m.iv].label));
  const last = eagleSlots(W, FTP).at(-1); assert.equal(moveEagle(W, { iv: last.i }, { stepI: last.i }).state, 'done', 'no interval left: no eagle');
  assert.equal(eagleGate({ state: 'done' }, { win: hardWindow(W, a + 101, FTP), stepI: e.iv }), null, 'once: done stays done');
  assert.equal(eagleGate({ state: 'play', iv: e.iv, leftAt: 200 }, { win: hardWindow(W, a + 101, FTP), stepI: e.iv }), null);
});

test('never with the wizard or a dare', () => {
  const z = new Wizard({ length: 30000, startD: 0, ftp: FTP, force: true, workout: 3600 });
  assert.equal(othersBusy(z, null), false, 'the wizard waits for his interval (not called yet)');
  z.summon(100, 120); assert.equal(othersBusy(z, null), true, 'called: on his way');
  z.state = 'cast'; assert.equal(othersBusy(z, null), true); z.state = 'hell'; assert.equal(othersBusy(z, null), true);
  z.state = 'done'; assert.equal(othersBusy(z, null), false);
  assert.equal(othersBusy(null, { active: {} }), true, 'a dare');
  const free = new Wizard({ length: 30000, startD: 0, ftp: FTP, force: true }); assert.ok(Number.isFinite(free.at));
  assert.equal(othersBusy(free, null), false, 'free ride (?eagle=now): the wizard waiting at his spot down the road is not on');
  // busy: waits, then goes when it is over (same interval, time left)
  const e = { state: 'wait', iv: eagleSlots(W, FTP)[0].i, leftAt: 280 }, a = startOf(W, e.iv);
  const r = ride(W, e, { busyAt: t => t >= a && t < a + 60 });
  assert.equal(r.gos.length, 1); assert.equal(r.gos[0].i, e.iv); assert.ok(r.gos[0].t >= a + 60, 'after the wizard / dare');
  // the wizard was called in his interval: the eagle takes a later one
  const e2 = { state: 'wait', iv: eagleSlots(W, FTP)[0].i, leftAt: 100 };
  const r2 = ride(W, e2, { wizIvAt: t => t >= a ? e2.iv : -1, rng: seq(0.5) });
  assert.equal(r2.gos.length, 1); assert.ok(r2.gos[0].i > e2.iv, 'another interval'); assert.match(r2.gos[0].label, /^VO2max/);
  // busy through the whole interval: moves on, still only once
  const e3 = { state: 'wait', iv: eagleSlots(W, FTP)[0].i, leftAt: 200 };
  const r3 = ride(W, e3, { busyAt: t => t >= a && t < a + 300 });
  assert.equal(r3.gos.length, 1); assert.ok(r3.gos[0].i > e3.iv);
  // busy for the rest of the workout: no eagle at all
  assert.equal(ride(W, planEagle(W), { busyAt: () => true }).gos.length, 0);
});

test('model fallback chain: adler_nah -> seeadler -> stand-in', () => {
  const ent = (n, o = {}) => ({ file: `bird/${n}.glb`, scene: {}, clips: [{ name: 'Fliegen' }], ...o });
  const A = list => ({ find: n => list.find(e => e.file === `bird/${n}.glb`) || null });
  assert.equal(pickEagleModel(A([ent('seeadler'), ent('adler_nah')])).kind, 'nah');
  assert.equal(pickEagleModel(A([ent('seeadler')])).kind, 'seeadler');
  assert.equal(pickEagleModel(A([ent('seeadler'), ent('adler_nah', { stub: true })])).kind, 'seeadler', 'adler_nah not loaded at this level');
  assert.equal(pickEagleModel(A([ent('seeadler', { clips: [] })])).kind, 'standin', '?fakeassets box: no bones, no eagle');
  assert.equal(pickEagleModel(A([])).kind, 'standin'); assert.equal(pickEagleModel(undefined).kind, 'standin');
});

test('the beak without audio: opens and closes on the syllables, shut in the pause and after', () => {
  const v = []; for (let t = 0; t < 4.2; t += 0.01) v.push(synthMouth(t));
  assert.ok(Math.max(...v) > 0.8 && Math.min(...v) === 0);
  let flips = 0; for (let i = 1; i < v.length; i++) if ((v[i] > 0.3) !== (v[i - 1] > 0.3)) flips++;
  assert.ok(flips >= 20, `opens and closes per syllable (${flips / 2} times)`);
  assert.equal(synthMouth(1.55), 0, 'the pause after "Destiny"'); assert.equal(synthMouth(EAGLE.line + 0.1), 0);
  // the follower: fast up, ~80 ms down
  let e = 0; for (let i = 0; i < 3; i++) e = follow(e, 0.3, 0.016, 0.3); assert.ok(e > 0.8, 'attack within ~50 ms');
  for (let i = 0; i < 5; i++) e = follow(e, 0, 0.016, 0.3); assert.ok(e > 0.25 && e < 0.5, `release ~80 ms (${e.toFixed(2)})`);
});

test('framing: the head looking at you in the right part, a little above the horizon, the same angle on 4:3 to 32:9', () => {
  for (const a of [4 / 3, 16 / 10, 16 / 9, 2560 / 1080, 32 / 9]) {
    const f = eagleFrame(a);
    assert.ok(f.cx - f.width / 2 >= 0.55 && f.cx + f.width / 2 < 1, `in the right 45 %, whole: ${f.cx.toFixed(2)} ± ${(f.width / 2).toFixed(3)} at ${a.toFixed(2)}`);
    assert.ok(f.cy > 0.3 && f.cy + f.maxH / 2 < 0.75, 'never down at the bottom bar');
    assert.ok(Math.abs(f.width * a - 0.25 * 16 / 9) < 1e-9, 'the same angular size on every aspect');
    assert.ok(f.bank > 0 && f.bank < 0.4, 'banked a little away from you: the near wing over the sky');
  }
});
