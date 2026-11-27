// "How am I today" (25.11., owner: "so wie das Garmin auch macht … eher so dein Trainingscoach"): one readiness value 0-100 with a
// word and one plain sentence why, made only from what this account really has. Transparent on purpose: every input gives its own
// part (0-100) and a weight, the value is their weighted mean, and the page shows the parts as chips. Fewer than two inputs: no value
// ("Not enough data yet") and what would add one. Never a number made up from nothing. Pure, no page code (tools/today-test.mjs).
//
// Inputs (each optional):
//   bb    body battery 0-100 (the watch, GET /api/account/health)          part = bb                         weight 3
//   sleep sleep score 0-100 (no source yet: the watch app cannot read it) part = score                      weight 3
//   rhr   { v, avg } resting HR today and its 7-day average (the watch)  part = 75 - 8 × (v - avg)         weight 2
//   form  fitness minus fatigue (js/fitness.js), with recent training    part = 60 + 2 × form              weight 2 (see below)
//   load  { y: yesterday's load points, ctl: fitness, min?: minutes trained yesterday, if?: intensity factor 0-1.5 }
//   hist  days of training history the fitness numbers are built on (cardlib fitnessSummary .hist); optional
//
// 27.11. (owner: "Rest and recover … yesterday was hard" after 1 h in zone 2, "das muss durchdacht sein"). What went wrong:
// "hard" was y ≥ 1.5 × max(ctl, 20), so with a low fitness value (a short or power-less history: ctl 14 after three weeks of
// 50-point days) every hour of 45-50 points was "a hard day" and gave the load part 15; and form after three weeks of data is
// about -22 only because fatigue (7 d) fills up six times faster than fitness (42 d): a start artefact, not tiredness, and
// 60 + 2 × form made it 16. Together 15.7: "Rest and recover". The rules now:
//  · Yesterday. Hardness E = y / max(110, 1.6 × max(ctl, 50)): a day is only hard when it is big in absolute terms (110 points
//    = more than an hour at threshold) AND big for this athlete. E < 0.65 easy (part 90 → 80), < 1 normal (80 → 55), < 1.8 hard,
//    above very hard (55 - 25 × (E - 1), at least 10). An easy hour (40-65 points) is "an easy day" whatever ctl is. With the
//    intensity known (if, or y per hour from min: 100 points per hour = IF 1.0): IF < 0.8 in at most 2.5 h is never more than
//    easy, IF ≥ 0.9 for 40+ min at least hard-ish (E ≥ 1).
//  · Form only counts fully on an established history. Cold start (hist < 28 d or ctl < 15): weight 1 and its part never below
//    50 (it cannot hold the value back, it can still say fresh). Young (hist < 42 d, ctl < 30, or fatigue > 1.6 × fitness at
//    ctl < 40, the shape of a start): weight 1, part at least 40. Each such case is said in `notes`.
//  · Training only (no body battery, sleep or resting HR): the value stays between 35 and 80, so never "Rest and recover" from
//    the training numbers alone, unless they are really extreme: form ≤ -30 on an established history, or yesterday E ≥ 2.
export const WEIGHTS = { bb: 3, sleep: 3, rhr: 2, form: 2, load: 1 };
export const LABELS = { bb: 'Body battery', sleep: 'Sleep', rhr: 'Resting HR', form: 'Form', load: 'Yesterday' };
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const num = v => typeof v === 'number' && Number.isFinite(v);
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(Math.round(v));
/** the word for a value; the order is the one the page colours by */
export const wordOf = v => v >= 75 ? 'Ready' : v >= 55 ? 'Good to train' : v >= 35 ? 'Take it easy' : 'Rest and recover';

/** how hard yesterday was: { E, kind: 'rest' | 'easy' | 'normal' | 'hard' | 'very hard', ifac (or null) } from { y, ctl, min?, if? } */
export function hardness(l = {}) {
  const y = num(l.y) && l.y > 0 ? l.y : 0, ctl = num(l.ctl) ? l.ctl : 0;
  if (y < 1) return { E: 0, kind: 'rest', ifac: null };
  let E = y / Math.max(110, 1.6 * Math.max(ctl, 50));
  const min = num(l.min) && l.min > 0 ? l.min : 0, ifac = num(l.if) && l.if > 0 ? l.if : min >= 10 ? Math.sqrt(y / (min / 60) / 100) : null;
  if (ifac != null && ifac < 0.8 && (!min || min <= 150)) E = Math.min(E, 0.6);
  if (ifac != null && ifac >= 0.9 && min >= 40) E = Math.max(E, 1);
  return { E, kind: E < 0.65 ? 'easy' : E < 1 ? 'normal' : E < 1.8 ? 'hard' : 'very hard', ifac };
}
const loadPart = E => E <= 0 ? 90 : E < 0.65 ? 90 - 10 * E / 0.65 : E < 1 ? 80 - 25 * (E - 0.65) / 0.35 : clamp(55 - 25 * (E - 1), 10, 55);

/** how far the form value can be trusted: { tier: 'full' | 'young' | 'cold', w, floor, note } */
export function formTrust(x = {}) {
  const hist = num(x.hist) ? x.hist : null, ctl = num(x.load?.ctl) ? x.load.ctl : num(x.ctl) ? x.ctl : null, f = num(x.form) ? x.form : 0;
  const wk = hist != null ? Math.max(0, Math.floor(hist / 7)) : null, hw = wk != null ? `${wk} week${wk === 1 ? '' : 's'}` : '';
  if ((hist != null && hist < 28) || (ctl != null && ctl < 15)) return { tier: 'cold', w: 1, floor: 50, note: hist != null && hist < 28 ? `Only ${hw} of training history: form counts less until there are 6 weeks.` : 'Your fitness value is still very low: form counts less until it has built up.' };
  if ((hist != null && hist < 42) || (ctl != null && ctl < 30) || (ctl != null && ctl < 40 && ctl - f > 1.6 * ctl)) return { tier: 'young', w: 1, floor: 40, note: hist != null && hist < 42 ? `${hw[0].toUpperCase() + hw.slice(1)} of training history: form counts less until there are 6 weeks.` : 'Your fitness value is still low: form counts less, fatigue rises faster than fitness at the start.' };
  return { tier: 'full', w: WEIGHTS.form, floor: 0, note: '' };
}

/** one input -> { k, label, part (0-100), w, value (shown on the chip), phrase (for the sentence), note? } or null when it is not there */
export function parts(x = {}) {
  const out = [];
  if (num(x.bb) && x.bb >= 0 && x.bb <= 100) out.push({ k: 'bb', part: x.bb, value: String(Math.round(x.bb)), phrase: x.bb >= 60 ? `body battery is at ${Math.round(x.bb)}` : `body battery is only at ${Math.round(x.bb)}` });
  if (num(x.sleep) && x.sleep >= 0 && x.sleep <= 100) out.push({ k: 'sleep', part: x.sleep, value: String(Math.round(x.sleep)), phrase: x.sleep >= 70 ? `you slept well (score ${Math.round(x.sleep)})` : `sleep was short or restless (score ${Math.round(x.sleep)})` });
  if (x.rhr && num(x.rhr.v) && num(x.rhr.avg)) { const d = x.rhr.v - x.rhr.avg, dr = Math.round(d);
    out.push({ k: 'rhr', part: clamp(75 - 8 * d), value: `${Math.round(x.rhr.v)} (${dr === 0 ? '= 7 d' : sgn(dr) + ' vs 7 d'})`, phrase: dr <= -1 ? `resting heart rate is ${-dr} below its 7-day average` : dr >= 2 ? `resting heart rate is ${dr} above its 7-day average` : 'resting heart rate is at its usual level' }); }
  if (num(x.form)) { const T = formTrust(x), raw = clamp(60 + 2 * x.form), part = Math.max(raw, T.floor), held = part > raw;
    out.push({ k: 'form', part, w: T.w, value: sgn(x.form), ...(T.note ? { note: T.note } : {}),
      phrase: held ? 'your form value is still settling (short training history)' : x.form > 5 ? 'you are fresh' : x.form > -10 ? 'your training load is balanced' : x.form > -25 ? 'you carry fatigue from recent training' : 'you carry a lot of fatigue' }); }
  if (x.load && num(x.load.y) && x.load.y >= 0) { const H = hardness(x.load);
    out.push({ k: 'load', part: loadPart(H.E), value: x.load.y < 1 ? 'rest' : `${Math.round(x.load.y)} pts`, hard: H.kind,
      phrase: H.kind === 'rest' ? 'yesterday was a rest day' : `yesterday was ${H.kind === 'easy' ? 'an easy day' : H.kind === 'normal' ? 'a normal training day' : H.kind === 'hard' ? 'a hard day' : 'a very hard day'}` }); }
  return out.map(p => ({ ...p, label: LABELS[p.k], w: p.w ?? WEIGHTS[p.k], part: Math.round(p.part) }));
}

/** { score: 0-100 or null, word, why, parts, missing: [k], notes: [{ k, text }], capped?: 'training-only' }; null score below two inputs */
export function readiness(x = {}) {
  const P = parts(x), missing = Object.keys(WEIGHTS).filter(k => !P.some(p => p.k === k)), notes = P.filter(p => p.note).map(p => ({ k: p.k, text: p.note }));
  if (P.length < 2) return { score: null, word: 'Not enough data yet', why: P.length ? `Only ${P[0].label.toLowerCase()} so far. One more source makes a readiness value.` : 'Readiness needs at least two of: body battery, resting heart rate, sleep, your form and yesterday\'s training.', parts: P, missing, notes };
  let score = Math.round(P.reduce((s, p) => s + p.part * p.w, 0) / P.reduce((s, p) => s + p.w, 0)), capped;
  // training numbers alone (no body signal): a modest value, "Rest and recover" only when they are really extreme
  if (!P.some(p => p.k === 'bb' || p.k === 'sleep' || p.k === 'rhr')) {
    const F = P.find(p => p.k === 'form'), extreme = (F && F.w === WEIGHTS.form && x.form <= -30) || (x.load && hardness(x.load).E >= 2);
    const c = clamp(score, extreme ? 0 : 35, 80); if (c !== score) { score = c; capped = 'training-only'; }
  }
  // the two parts that move the value most (furthest from the middle), the one holding it back first when the value is low
  const by = P.slice().sort((a, b) => Math.abs(b.part - 50) * b.w - Math.abs(a.part - 50) * a.w), low = score < 55;
  const pick = (low ? by.filter(p => p.part < 50) : by.filter(p => p.part >= 50)).slice(0, 2), use = pick.length ? pick : by.slice(0, 1);
  const s = use.map(p => p.phrase).join(' and ');
  return { score, word: wordOf(score), why: s.charAt(0).toUpperCase() + s.slice(1) + '.', parts: P, missing, notes, ...(capped ? { capped } : {}) };
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
