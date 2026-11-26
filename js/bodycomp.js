// Body composition ESTIMATED from the scale's impedance (26.11., Freddy: "store the impedance and compute it ourselves with the best
// published formula, not eufy's"). Pure, no DOM: the Body page (js/body.js), the Weight card (js/bodycard.js), "What changed"
// (js/insights.js) and the coach connector (tools/coachdata.mjs) all use these functions, so every place shows the same number.
// Nothing here is stored: a weigh-in keeps only its impedance (js/bodylib.js), so a better formula later re-evaluates every old one.
//
// The formula (fat-free mass, FFM) — Sun SS, Chumlea WC, Heymsfield SB et al. "Development of bioelectrical impedance analysis
// prediction equations for body composition with the use of a multicomponent model for use in epidemiologic surveys."
// Am J Clin Nutr 2003;77:331–340 (NHANES III, n = 1829, age 12–94, reference: multicomponent model):
//   men   FFM = −10.68 + 0.65·H²/R + 0.26·W + 0.02·R      (R² 0.90, RMSE 3.9 kg)
//   women FFM =  −9.53 + 0.69·H²/R + 0.17·W + 0.02·R      (R² 0.83, RMSE 2.9 kg)          H cm, R Ω (50 kHz), W kg
// Why this one for a FOOT-TO-FOOT scale although Sun measured hand-to-foot (literature check 26.11.):
//  - Leg-to-leg equations exist, but none fits better here: Nuñez et al. 1997 (Med Sci Sports Exerc 29:524) needs the waist/hip
//    ratio; Jebb et al. 2000 (Br J Nutr 83:115, Tanita vs 4-compartment model, n = 205) uses log terms whose coefficients are not in
//    the abstract and could not be checked, so they are not typed in from memory; Lee et al. 2015 (Nutr J 14:58, DXA, n = 554) is
//    derived and validated in Taiwanese adults only (its authors call it population specific); the Tanita / eufy equations are
//    unpublished. Xie et al. 1999 (Int J Obes 23:1079) found the stock leg-to-leg equation poor for individuals (limits of agreement
//    −12 … +45 % of fat) and asked for validated equations: none has appeared that a European adult man could use with only H, W, R.
//  - Nuñez 1997 measured foot-pad leg-to-leg R only ~15 Ω (3 %) above gel-electrode values and at the same level as whole-body R
//    (526 vs 511 Ω), so a hand-to-foot equation gets R in the range it was fitted on; Sun's sample is large, multi-ethnic, uses a
//    multicomponent reference (no device-specific bias baked in) and is the equation most often recommended for adults.
//  - The cost: leg-to-leg current does not pass the arms and upper trunk. Someone with much upper-body muscle (or fat) relative to
//    the legs is estimated too lean or too fat by a fixed amount. That offset stays the same from week to week, so the TREND is far
//    more trustworthy than the number.
// What to expect: Sun's own error is ±3–4 kg FFM (1 SD), i.e. about ±4–5 percentage points of body fat for one person, plus the
// unknown leg-to-leg offset; two published equations on the same reading can differ by 5 points (Lee 2015 says 29 % where Sun says
// 24 % for 83.4 kg / 518.5 Ω / 183 cm / man / 33 y). Day to day the impedance moves with hydration (drink, sweat, meal): ±1–2 points.
// Derived values: fat mass = W − FFM; lean mass = FFM (fat-free: it includes ~4–5 % bone mineral; we do not subtract a guess);
// total body water = 0.73·FFM (Pace N, Rathbun EN. J Biol Chem 1945;158:685–691: fat-free mass is 73 % water, 73.2 in their data).
// Left out on purpose: bone mass, "muscle mass", visceral fat, metabolic age — no published basis from a single leg-to-leg reading.

export const MODEL = { id: 'sun2003', name: 'Sun et al. 2003', cite: 'Sun SS et al., Am J Clin Nutr 2003;77:331–340 (fat-free mass); body water 0.73 × FFM (Pace & Rathbun 1945)' };
export const EXPLAIN = 'Estimated from the scale’s impedance with a published formula; the trend is more reliable than the single number.';
export const HYDRATION = 0.73;
export const LIM = { imp: [200, 1500], fat: [3, 60], age: [18, 94] }; // age: adults inside Sun's sample (12–94); teenagers are still growing
const r1 = v => Math.round(v * 10) / 10;

/** height, sex and birth year are all there (without them nothing is estimated) */
export const ready = p => !!p && p.heightCm >= 100 && p.heightCm <= 250 && (p.sex === 'm' || p.sex === 'f') && p.birthYear >= 1900;
/** age in whole years at time t from the birth year only (±1 year: the formula does not use age, it only bounds where it is valid) */
export const ageAt = (birthYear, t = Date.now()) => new Date(t).getFullYear() - birthYear;

/** fat-free mass in kg (Sun et al. 2003), or null outside the formula's inputs */
export function ffmOf({ kg, imp, cm, sex }) {
  if (!(kg >= 20 && kg <= 300) || !(imp >= LIM.imp[0] && imp <= LIM.imp[1]) || !(cm >= 100 && cm <= 250) || (sex !== 'm' && sex !== 'f')) return null;
  const hr = cm * cm / imp;
  return sex === 'm' ? -10.68 + 0.65 * hr + 0.26 * kg + 0.02 * imp : -9.53 + 0.69 * hr + 0.17 * kg + 0.02 * imp;
}

/** one weigh-in m ({ t, kg, impedance }) + prefs ({ heightCm, sex, birthYear }) -> the estimate, or null (no impedance, profile
 *  missing, age outside, or a result outside 3–60 % body fat, which means a bad reading: socks, wet feet, someone else) */
export function compOf(m, p) {
  if (!m || !m.impedance || !ready(p)) return null;
  const age = ageAt(p.birthYear, m.t); if (!(age >= LIM.age[0] && age <= LIM.age[1])) return null;
  const ffm = ffmOf({ kg: m.kg, imp: m.impedance, cm: p.heightCm, sex: p.sex }); if (ffm == null) return null;
  const fat = m.kg - ffm, pct = fat / m.kg * 100; if (!(pct >= LIM.fat[0] && pct <= LIM.fat[1])) return null;
  const tbw = HYDRATION * ffm;
  return { fatPct: r1(pct), fatKg: r1(fat), leanKg: r1(ffm), waterKg: r1(tbw), waterPct: r1(tbw / m.kg * 100), bmi: r1(m.kg / (p.heightCm / 100) ** 2) };
}

/** the weigh-ins with an estimate, oldest first: [{ id, t, kg, ...compOf }] */
export function compSeries(list, p) {
  if (!ready(p)) return [];
  const out = []; for (const m of [...(list || [])].sort((a, b) => a.t - b.t)) { const c = compOf(m, p); if (c) out.push({ id: m.id, t: m.t, kg: m.kg, ...c }); }
  return out;
}
/** a series as bodylib's { t, kg } shape for one field, so trend() / changes() smooth and compare it like the weight */
export const asKg = (series, k) => series.map(s => ({ id: s.id, t: s.t, kg: s[k] }));
/** enough for a trend sentence: at least n estimates spanning at least `days` days */
export function enough(series, n = 4, days = 14) { return series.length >= n && series[series.length - 1].t - series[0].t >= days * 864e5; }
