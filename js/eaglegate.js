// The Eagle of Destiny (owner 18.11.): once per interval workout, at a random moment inside ONE hard interval, an eagle
// flies alongside the rider, turns its head to him, says its line and flies off. Pure rules here (tested in tools/eagle-test.mjs); the scene itself
// (three.js, audio, lip sync) is js/world/eagle.js.
// · only inside a hard interval as ivgate.js hardWindow() sees it (pct >= 88, >= 1 min, never warm-up / opener / spin /
//   cool-down, never a rest), and only when at least EAGLE.need seconds of it are left for the whole scene
// · once per workout; random which interval, random moment inside it
// · never together with the wizard or a dare: while one is on, the eagle waits; if the wizard was called in the eagle's
//   interval, or the interval runs out first, the eagle moves on to a later hard interval (none left: no eagle this time)
// · group rides: every rider rolls his own eagle (Math.random), nothing is synced
import { hardWindow } from './ivgate.js';

/** scene length (s) before / after the line, the line's fallback length, what an interval must still have left to start it,
 *  the lead (never in its first seconds) and the shortest interval he comes in (30 s efforts never get him) */
export const EAGLE = { pre: 5.0, post: 6.2, line: 3.9, need: 19, lead: 5, minIv: 45 }; // pre: cry, fly in, look ahead, the slow head turn, a beat
export const sceneLen = (lineS = EAGLE.line) => EAGLE.pre + lineS + EAGLE.post;

/** the hard intervals the eagle may use: [{ i, start, dur }] (the same test as the wizard's, so rests / openers never count) */
export function eagleSlots(workout, ftp = 200) {
  const out = []; let s = 0;
  for (const [i, st] of (workout?.steps || []).entries()) {
    const w = hardWindow(workout, s + 0.01, ftp);
    if (w && w.i === i && st.dur >= Math.max(EAGLE.minIv, EAGLE.need + EAGLE.lead)) out.push({ i, start: s, dur: st.dur });
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

/** owner 19.11. ("der kann nicht nur beim Intervall kommen sondern immer eigentlich"): in a workout he now comes once at
 *  any moment by the workout clock (warm-up, rests, cool-down too), between 15 % and 85 % of it and with the scene's time
 *  left; null when the workout is too short. force (?eagle): 3 s in. The interval rules above stay for reference/tests. */
export function planEagleAny(workout, { rng = Math.random, force = false } = {}) {
  const T = (workout?.steps || []).reduce((a, st) => a + (st.dur || 0), 0);
  if (T < 4 * sceneLen()) return null;
  if (force) return { state: 'wait', free: true, wk: true, iv: -1, at: 3, force: true };
  const lo = 0.15 * T, hi = Math.min(0.85 * T, T - sceneLen() - 5);
  return { state: 'wait', free: true, wk: true, iv: -1, at: Math.round(lo + rng() * (hi - lo)) };
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

/** where the head sits on screen when it looks at you, as fractions of the viewport (aspect = width / height): its box
 *  centre (cx from the left, cy from the top: the right part, a little above the horizon), `width` of the viewport wide (the
 *  same angle on every aspect), at most `maxH` of the height. The eagle flies alongside, ahead and to the right, so the rest
 *  of the bird sits behind and beside its head: neck, back and body towards the right edge, the near wing spread over the
 *  sky. A head of ~9-10 % keeps it a whole bird; at 15-20 % the body would be at the camera and the near wing across the
 *  whole screen (measured with both stand-ins, 18.11.). bank: its roll away from you (rad), so the near wing rises over the
 *  sky instead of lying across the road. */
export function eagleFrame(aspect) {
  const k = Math.max(0, Math.min(1, (aspect - 1.8) / 0.6));
  return { cx: 0.82 + 0.03 * k, cy: 0.47, width: 0.25 * (16 / 9) / aspect, maxH: 0.5, bank: 0.35 }; // head a quarter of the screen width at the right edge (owner 17.11.), clear of the wing and the bottom panel
}
