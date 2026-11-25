// "How am I today" (25.11., owner: "so wie das Garmin auch macht … eher so dein Trainingscoach"): one readiness value 0-100 with a
// word and one plain sentence why, made only from what this account really has. Transparent on purpose: every input gives its own
// part (0-100) and a weight, the value is their weighted mean, and the page shows the parts as chips. Fewer than two inputs: no value
// ("Not enough data yet") and what would add one. Never a number made up from nothing. Pure, no page code (tools/today-test.mjs).
//
// Inputs (each optional):
//   bb    body battery 0-100 (the watch, GET /api/account/health)          part = bb                         weight 3
//   sleep sleep score 0-100 (no source yet: the watch app cannot read it) part = score                      weight 3
//   rhr   { v, avg } resting HR today and its 7-day average (the watch)  part = 75 - 8 × (v - avg)         weight 2
//   form  fitness minus fatigue (js/fitness.js), with recent training    part = 60 + 2 × form              weight 2
//   load  { y: yesterday's load points, ctl: fitness } with recent data part = 90 - 30 × y / max(ctl, 20) weight 1
export const WEIGHTS = { bb: 3, sleep: 3, rhr: 2, form: 2, load: 1 };
export const LABELS = { bb: 'Body battery', sleep: 'Sleep', rhr: 'Resting HR', form: 'Form', load: 'Yesterday' };
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const num = v => typeof v === 'number' && Number.isFinite(v);
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(Math.round(v));
/** the word for a value; the order is the one the page colours by */
export const wordOf = v => v >= 75 ? 'Ready' : v >= 55 ? 'Good to train' : v >= 35 ? 'Take it easy' : 'Rest and recover';

/** one input -> { k, label, part (0-100), value (shown on the chip), phrase (for the sentence) } or null when it is not there */
export function parts(x = {}) {
  const out = [];
  if (num(x.bb) && x.bb >= 0 && x.bb <= 100) out.push({ k: 'bb', part: x.bb, value: String(Math.round(x.bb)), phrase: x.bb >= 60 ? `body battery is at ${Math.round(x.bb)}` : `body battery is only at ${Math.round(x.bb)}` });
  if (num(x.sleep) && x.sleep >= 0 && x.sleep <= 100) out.push({ k: 'sleep', part: x.sleep, value: String(Math.round(x.sleep)), phrase: x.sleep >= 70 ? `you slept well (score ${Math.round(x.sleep)})` : `sleep was short or restless (score ${Math.round(x.sleep)})` });
  if (x.rhr && num(x.rhr.v) && num(x.rhr.avg)) { const d = x.rhr.v - x.rhr.avg, dr = Math.round(d);
    out.push({ k: 'rhr', part: clamp(75 - 8 * d), value: `${Math.round(x.rhr.v)} (${dr === 0 ? '= 7 d' : sgn(dr) + ' vs 7 d'})`, phrase: dr <= -1 ? `resting heart rate is ${-dr} below its 7-day average` : dr >= 2 ? `resting heart rate is ${dr} above its 7-day average` : 'resting heart rate is at its usual level' }); }
  if (num(x.form)) out.push({ k: 'form', part: clamp(60 + 2 * x.form), value: sgn(x.form), phrase: x.form > 5 ? 'you are fresh' : x.form > -10 ? 'your training load is balanced' : x.form > -25 ? 'you carry fatigue from recent training' : 'you carry a lot of fatigue' });
  if (x.load && num(x.load.y) && x.load.y >= 0) { const r = x.load.y / Math.max(num(x.load.ctl) ? x.load.ctl : 0, 20);
    out.push({ k: 'load', part: clamp(90 - 30 * r, 10, 90), value: x.load.y < 1 ? 'rest' : `${Math.round(x.load.y)} pts`, phrase: x.load.y < 1 ? 'yesterday was a rest day' : r >= 1.5 ? 'yesterday was a hard day' : r >= 0.7 ? 'yesterday was a normal training day' : 'yesterday was an easy day' }); }
  return out.map(p => ({ ...p, label: LABELS[p.k], w: WEIGHTS[p.k], part: Math.round(p.part) }));
}

/** { score: 0-100 or null, word, why, parts, missing: [k] }; null score below two inputs */
export function readiness(x = {}) {
  const P = parts(x), missing = Object.keys(WEIGHTS).filter(k => !P.some(p => p.k === k));
  if (P.length < 2) return { score: null, word: 'Not enough data yet', why: P.length ? `Only ${P[0].label.toLowerCase()} so far. One more source makes a readiness value.` : 'Readiness needs at least two of: body battery, resting heart rate, sleep, your form and yesterday\'s training.', parts: P, missing };
  const score = Math.round(P.reduce((s, p) => s + p.part * p.w, 0) / P.reduce((s, p) => s + p.w, 0));
  // the two parts that move the value most (furthest from the middle), the one holding it back first when the value is low
  const by = P.slice().sort((a, b) => Math.abs(b.part - 50) * b.w - Math.abs(a.part - 50) * a.w), low = score < 55;
  const pick = (low ? by.filter(p => p.part < 50) : by.filter(p => p.part >= 50)).slice(0, 2), use = pick.length ? pick : by.slice(0, 1);
  const s = use.map(p => p.phrase).join(' and ');
  return { score, word: wordOf(score), why: s.charAt(0).toUpperCase() + s.slice(1) + '.', parts: P, missing };
}

/** a quiet suggestion for a day with nothing planned, from readiness and form: { kind, title, minutes, why } */
export function suggestion(r, form = null) {
  const v = r?.score;
  if (v == null) return { kind: 'other', title: 'Easy session of your choice', minutes: 45, why: 'Without readiness data: keep it comfortable and listen to your body.' };
  if (v < 35) return { kind: 'rest', title: 'Rest day', minutes: 0, why: 'Your body is asking for recovery. A walk or some mobility is plenty.' };
  if (v < 55) return { kind: 'ride', title: 'Easy endurance, zone 2', minutes: 45, why: 'Keep it light today so tomorrow can be better.' };
  if (v >= 75 && (form == null || form > -10)) return { kind: 'ride', title: 'Intervals or a hard session', minutes: 60, why: 'You are fresh: a good day for quality work.' };
  return { kind: 'ride', title: 'Steady endurance', minutes: 60, why: 'A normal training day: steady, not all out.' };
}
