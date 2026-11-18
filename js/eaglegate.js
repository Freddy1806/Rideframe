// The Eagle of Destiny (owner 18.11.): once per interval workout, at a random moment inside ONE hard interval, an eagle
// lands beside the camera, says its line and flies off. Pure rules here (tested in tools/eagle-test.mjs); the scene itself
// (three.js, audio, lip sync) is js/world/eagle.js.
// · only inside a hard interval as ivgate.js hardWindow() sees it (pct >= 88, >= 1 min, never warm-up / opener / spin /
//   cool-down, never a rest), and only when at least EAGLE.need seconds of it are left for the whole scene
// · once per workout; random which interval, random moment inside it
// · never together with the wizard or a dare: while one is on, the eagle waits; if the wizard was called in the eagle's
//   interval, or the interval runs out first, the eagle moves on to a later hard interval (none left: no eagle this time)
// · group rides: every rider rolls his own eagle (Math.random), nothing is synced
import { hardWindow } from './ivgate.js';

/** scene length (s) without the line, the line's fallback length, what an interval must still have left to start it */
export const EAGLE = { pre: 4.3, post: 5.6, line: 3.9, need: 16, lead: 5 };
export const sceneLen = (lineS = EAGLE.line) => EAGLE.pre + lineS + EAGLE.post;

/** the hard intervals the eagle may use: [{ i, start, dur }] (the same test as the wizard's, so rests / openers never count) */
export function eagleSlots(workout, ftp = 200) {
  const out = []; let s = 0;
  for (const [i, st] of (workout?.steps || []).entries()) {
    const w = hardWindow(workout, s + 0.01, ftp);
    if (w && w.i === i && st.dur >= EAGLE.need + EAGLE.lead) out.push({ i, start: s, dur: st.dur });
    s += st.dur;
  }
  return out;
}

/** the plan for one workout, or null when it has no interval for him. force (?eagle): the first hard interval, 3 s in.
 *  after: only intervals with a higher index (moving on). The eagle starts when win.left <= leftAt. */
export function planEagle(workout, { rng = Math.random, force = false, after = -1, ftp = 200 } = {}) {
  const slots = eagleSlots(workout, ftp).filter(x => x.i > after);
  if (!slots.length) return null;
  if (force) { const x = slots[0]; return { state: 'wait', iv: x.i, leftAt: x.dur - 3, force: true }; }
  const x = slots[Math.floor(rng() * slots.length) % slots.length];
  const lo = EAGLE.need, hi = x.dur - EAGLE.lead; // a random moment, never in the first seconds and always with time left
  return { state: 'wait', iv: x.i, leftAt: Math.round(lo + rng() * (hi - lo)) };
}

/** is the wizard (or a dare) on now? z: the Wizard (js/wizard.js; in a workout a finite `at` while waiting = called), ch: Challenges */
export const othersBusy = (z, ch) => !!(ch?.active || (z && (z.busy || z.state === 'ann' || (z.wk && z.state === 'wait' && Number.isFinite(z.at)))));

/** the eagle's next step: 'go' (start the scene now), 'move' (pick a later interval) or null (wait).
 *  e: planEagle(); win: hardWindow() now (or null); stepI: the workout step running now; busy: othersBusy(); wizIv: the
 *  interval in which the wizard was called (or -1) */
export function eagleGate(e, { win, stepI, busy = false, wizIv = -1 }) {
  if (!e || e.state !== 'wait') return null;
  if (e.now) return busy ? null : 'go';
  if (stepI > e.iv) return 'move'; // his interval is over (paused through it, the wizard took it, ...)
  if (!win || win.i !== e.iv) return null;
  if (wizIv === e.iv) return 'move';
  if (win.left < EAGLE.need) return 'move';
  return win.left <= e.leftAt && !busy ? 'go' : null;
}

/** after 'move': the plan for a later interval, or { state: 'done' } when there is none */
export const moveEagle = (workout, e, o = {}) => planEagle(workout, { ...o, after: Math.max(e.iv, o.stepI ?? -1) }) || { state: 'done', iv: -1 };

/** which model plays the eagle: 'nah' (adler_nah, jaw bone), 'seeadler' (no jaw: the head nods with the voice) or 'standin'
 *  (procedural head with a hinged beak: ?fakeassets, the cloud checkout, a graphics level without birds). A: Assets */
export function pickEagleModel(A) {
  const ok = e => e && !e.stub && e.scene;
  const nah = A?.find?.('adler_nah'); if (ok(nah)) return { kind: 'nah', e: nah };
  const sea = A?.find?.('seeadler'); if (ok(sea) && sea.clips?.length) return { kind: 'seeadler', e: sea }; // a fake box (no bones) is no eagle
  return { kind: 'standin', e: null };
}

// "I'm the Eagle of Destiny. Ride faster, you little bitch." without the recording: syllables [start s, length s, loudness]
const SYL = [[0.00, .22, .9], [0.24, .10, .5], [0.36, .17, 1], [0.55, .14, .7], [0.71, .10, .5], [0.83, .16, .9], [1.01, .12, .7], [1.15, .22, .8],
  [1.75, .22, 1], [1.99, .18, .9], [2.19, .16, .7], [2.40, .12, .6], [2.55, .16, .8], [2.73, .12, .6], [2.95, .42, 1]];
/** the beak's opening 0..1 at time t (s) into the line, when there is no audio to listen to */
export function synthMouth(t) {
  let v = 0;
  for (const [a, l, k] of SYL) { const u = (t - a) / l; if (u > 0 && u < 1) v = Math.max(v, k * Math.sin(Math.PI * Math.min(1, u * 1.6)) ** 0.7 * (u > 0.62 ? 1 - (u - 0.62) / 0.38 : 1)); }
  return v;
}

/** an envelope follower: fast attack (~15 ms), release ~80 ms; level from the analyser's RMS (auto gain on the loudest bit) */
export function follow(env, rms, dt, peak) {
  const target = Math.max(0, Math.min(1, (rms - 0.012) / Math.max(0.05, peak * 0.7)));
  const tau = target > env ? 0.015 : 0.08;
  return env + (target - env) * (1 - Math.exp(-dt / tau));
}

/** where the head sits on screen, as fractions of the viewport (aspect = width / height): the visible part of the head covers
 *  `vis` of the width at the right edge (a quarter to a third), its box centre `cy` from the top (upper two thirds), and the
 *  whole head is `width` wide (or less when it would be more than `maxH` of the height), so the rest is cut off by the edge. Narrower on ultrawide screens, so it never reaches the bar. */
export function eagleFrame(aspect) {
  const k = Math.max(0, Math.min(1, (aspect - 1.8) / 0.6));
  const vis = 0.315 - 0.045 * k;
  return { left: 1 - vis, width: vis * 1.12, cy: 0.34 + 0.03 * k, maxH: 0.56 + 0.1 * k }; // maxH: a tall head (looking at you) is made smaller, never longer
}
