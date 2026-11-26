// Body data (25.11., owner: "every morning on the scale, the values flow into RIDEFRAME"): the pure rules shared by the
// page (js/body.js), the start-page card (js/bodycard.js) and the server (tools/body-api.mjs). No DOM, no fetch.
//
// One measurement: { id, t (ms), kg, src: 'scale'|'manual'|'import', scaleId?, fatPct?, musclePct?, waterPct?, boneKg?, bmi?,
//   impedance?, x?, hr?, note? }. kg is kept at the resolution the scale reports (eufy: hundredths, steps of 0.05), never rounded further.
//   impedance (Ω, one decimal) comes from the scale itself (C20 end frame, P2 notification); the body-composition ESTIMATE is computed
//   from it on the fly (js/bodycomp.js), never stored, so a better formula later re-evaluates all old weigh-ins. x = the C20's unknown
//   bytes [19..21] as hex, kept only for a later analysis (scale entries only).
//
// Trend: the exponentially smoothed moving average of John Walker's "The Hacker's Diet" (chapter "Signal and Noise", 10 % smoothing:
// trend = trend + 0.1 × (weight − trend) per day, https://www.fourmilab.ch/hackdiet/e4/signalnoise.html). A day without a weigh-in
// moves nothing; after a gap of g days the step is 1 − 0.9^g (the same weight per elapsed day, so a break does not drag the old trend
// along for weeks). The day's value is the FIRST stable weigh-in of that local day (same time every morning, see TIPS); later ones
// are kept and listed but do not feed the trend. Outlier guard (trend only, storage keeps everything): a day value more than
// OUTLIER kg away from the trend is left out, unless the next day confirms the jump in the same direction.

export const FIELDS = { // optional body-composition values, only ever what the scale / its app reports (or an import of them)
  fatPct: { n: 'Body fat', u: '%', lo: 2, hi: 75, d: 1 }, musclePct: { n: 'Muscle', u: '%', lo: 10, hi: 90, d: 1 },
  waterPct: { n: 'Water', u: '%', lo: 20, hi: 85, d: 1 }, boneKg: { n: 'Bone mass', u: 'kg', lo: 0.5, hi: 10, d: 1 },
  bmi: { n: 'BMI', u: '', lo: 8, hi: 80, d: 1 }, impedance: { n: 'Impedance', u: 'Ω', lo: 100, hi: 1500, d: 0 }, hr: { n: 'Heart rate', u: 'bpm', lo: 30, hi: 230, d: 0 },
};
export const SRC = ['scale', 'manual', 'import'];
export const LIM = { count: 20000, note: 200, kgLo: 20, kgHi: 300 };
export const ALPHA = 0.1, OUTLIER = 3, SAME_MS = 3 * 60e3, SAME_KG = 0.2;
export const TIPS = ['Weigh yourself at the same time every morning.', 'After the toilet, before eating or drinking.', 'Scale on a hard floor, always the same spot.',
  'Stand still until the scale shows the final value.', 'Barefoot (body composition needs skin contact).'];
export const RULE = 'The trend uses the first weigh-in of each day; later ones that day are kept in the list. It is a 10 % smoothed average (The Hacker’s Diet), so one heavy evening does not move it much.';

const num = v => typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? +v.replace(',', '.') : NaN;
/** kg as the scale gave it, without float noise (82.45000001 -> 82.45); never coarser than hundredths */
export const kgOf = v => Math.round(num(v) * 100) / 100;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, n);

/** checks one measurement from a client, the bridge or an import; returns { m } or { error }. now = for the "not in the future" check */
export function validate(b, now = Date.now()) {
  if (!b || typeof b !== 'object') return { error: 'Body must be JSON.' };
  const kg = kgOf(b.kg); if (!(kg >= LIM.kgLo && kg <= LIM.kgHi)) return { error: `kg: ${LIM.kgLo} to ${LIM.kgHi}.` };
  let t = Math.round(num(b.t)); if (!(t > 0)) return { error: 't missing.' };
  if (t < 1e11) t *= 1000; // seconds are taken too
  if (t > now + 10 * 60e3) return { error: 't is in the future.' };
  if (t < Date.UTC(1990, 0, 1)) return { error: 't is too old.' };
  const src = SRC.includes(b.src) ? b.src : 'manual', m = { t, kg, src };
  for (const [k, f] of Object.entries(FIELDS)) { if (b[k] == null || b[k] === '') continue; const v = num(b[k]);
    if (!(v >= f.lo && v <= f.hi)) return { error: `${k}: ${f.lo} to ${f.hi}.` }; m[k] = Math.round(v * 10 ** Math.max(1, f.d)) / 10 ** Math.max(1, f.d); }
  const note = clean(b.note, LIM.note); if (note) m.note = note;
  if (b.scaleId != null && /^[\w:-]{1,60}$/.test(String(b.scaleId))) m.scaleId = String(b.scaleId);
  if (src === 'scale' && m.impedance && /^[0-9a-f]{2,32}$/.test(String(b.x ?? ''))) m.x = String(b.x);
  return { m };
}

/** inserts m into list (sorted by t): a weigh-in within 3 min and 0.2 kg of one from the same source is the same one (the last wins, keeps its id) */
export function merge(list, m) {
  const i = list.findIndex(x => x.src === m.src && Math.abs(x.t - m.t) <= SAME_MS && Math.abs(x.kg - m.kg) <= SAME_KG + 1e-9);
  if (i >= 0) { const keep = list[i], next = list.slice(); next[i] = { ...keep, ...m, id: keep.id, t: Math.max(keep.t, m.t) }; return { list: sort(next), id: keep.id, merged: true }; }
  return { list: sort([...list, m]), id: m.id, merged: false };
}
const sort = l => l.sort((a, b) => a.t - b.t);

/** local calendar day key 'YYYY-MM-DD' */
export const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const days = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 864e5); // calendar days, DST-safe enough for whole days

/** the day values: first measurement of each local day, oldest first: [{ day, t, kg, id }] */
export function dayValues(list) {
  const out = [], seen = new Set();
  for (const m of [...list].sort((a, b) => a.t - b.t)) { const k = dayKey(m.t); if (seen.has(k)) continue; seen.add(k); out.push({ day: k, t: m.t, kg: m.kg, id: m.id }); }
  return out;
}

/** the trend per day value: [{ day, t, kg, trend, out }] (out = left out by the outlier guard) */
export function trend(list, { alpha = ALPHA, outlier = OUTLIER } = {}) {
  const dv = dayValues(list), res = []; let tr = null, lastT = null, jump = 0;
  for (let i = 0; i < dv.length; i++) {
    const d = dv[i];
    if (tr == null) { tr = d.kg; lastT = d.t; res.push({ ...d, trend: tr, out: false }); continue; }
    const dev = d.kg - tr, next = dv[i + 1];
    // a jump the next day confirms (same side, also beyond the guard) is real: a holiday, a new scale, a long break
    const confirmed = next && Math.sign(next.kg - tr) === Math.sign(dev) && Math.abs(next.kg - tr) > outlier && days(d.t, next.t) <= 3;
    const prevOut = res[res.length - 1]?.out && Math.sign(res[res.length - 1].kg - tr) === Math.sign(dev);
    if (Math.abs(dev) > outlier && !confirmed && !prevOut && jump !== Math.sign(dev)) { res.push({ ...d, trend: tr, out: true }); continue; }
    jump = Math.abs(dev) > outlier ? Math.sign(dev) : 0; // inside an accepted jump the following days are not outliers either
    const g = Math.max(1, days(lastT, d.t)), step = 1 - (1 - alpha) ** g;
    tr = tr + step * dev; lastT = d.t; res.push({ ...d, trend: Math.round(tr * 1000) / 1000, out: false });
  }
  return res;
}
/** the trend value at time t (the last trend point at or before t), or null */
export function trendAt(tr, t) { let v = null; for (const p of tr) { if (p.t <= t + 1) v = p.trend; else break; } return v; }

/** change of the trend over the last n days (null when the data does not reach that far back); since start when n = null */
export function changes(list, now = Date.now()) {
  const tr = trend(list); if (!tr.length) return { now: null, d7: null, d30: null, start: null, tr };
  const cur = tr[tr.length - 1].trend, first = tr[0];
  const back = n => { const t = now - n * 864e5; if (first.t > t + 864e5 / 2) return null; const v = trendAt(tr, t); return v == null ? null : cur - v; };
  return { now: cur, d7: back(7), d30: back(30), start: tr.length > 1 ? cur - first.trend : null, since: first.t, tr };
}
/** plain, neutral words for a change of the trend: "down 0.8 kg", "up 1.2 kg", "about the same" */
export function changeWords(d) {
  if (d == null) return { arrow: '', text: 'not enough data yet', cls: '' };
  const a = Math.abs(d); if (a < 0.15) return { arrow: '→', text: 'about the same', cls: 'flat' };
  return { arrow: d < 0 ? '↓' : '↑', text: `${d < 0 ? 'down' : 'up'} ${a.toFixed(1)} kg`, cls: d < 0 ? 'down' : 'up' };
}
/** kg as text: the scale's own resolution (82.45 stays 82.45, 82.4 stays 82.4), at least `min` decimals */
export function fmtKg(v, min = 1) {
  if (v == null || !isFinite(v)) return '–'; const r = Math.round(v * 100) / 100, d = Math.abs(r * 10 - Math.round(r * 10)) > 1e-6 ? 2 : min;
  return r.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, min) });
}
/** BMI = kg / m² (WHO), only with a height the user entered */
export const bmiOf = (kg, cm) => cm >= 100 && cm <= 250 && kg > 0 ? Math.round(kg / (cm / 100) ** 2 * 10) / 10 : null;

/** Monday 00:00 local of t (same week as js/util.js weekStart) */
export const weekOf = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
/** measurements newest first, grouped by week: [{ week, list, avg }] */
export function byWeek(list) {
  const g = new Map(); for (const m of [...list].sort((a, b) => b.t - a.t)) { const w = weekOf(m.t); (g.get(w) || g.set(w, []).get(w)).push(m); }
  return [...g].map(([week, l]) => ({ week, list: l, avg: l.reduce((a, m) => a + m.kg, 0) / l.length }));
}

/* ---- CSV import: "date, kg" in any common shape, and the EufyLife export (Me → Data → Export All Data, columns like
 *      "Time, WEIGHT (kg), BMI, BODY FAT %, …"). Header names decide the columns; without a header: first column date, second kg. ---- */
const COLS = [['t', /^(time|date|datum|zeit|timestamp|measured|measurement time)/i], ['kg', /^(weight|gewicht|kg\b|mass)/i], ['bmi', /^bmi/i],
  ['fatPct', /body ?fat|fett|^fat/i], ['musclePct', /^(muscle|muskel)(?!.*mass)|muscle ?(rate|%)/i], ['waterPct', /water|wasser|hydration/i], ['boneKg', /bone|knochen/i], ['note', /^(note|comment|notiz)/i]];
function splitRow(line, sep) { // quotes allowed: "12,5" or "a, b"
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === sep) { out.push(cur.trim()); cur = ''; } else cur += c; }
  out.push(cur.trim()); return out;
}
/** a date text -> ms (local time), or NaN. ISO, "2026-11-25 07:12", "25.11.2026 7:12", "25/11/2026", "11/25/2026" (dmy = day first when ambiguous) */
export function parseDate(s, dmy = true) {
  s = String(s || '').trim(); if (!s) return NaN;
  if (/^\d{10,13}$/.test(s)) { const n = +s; return n < 1e11 ? n * 1000 : n; }
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  let y, mo, d;
  if (m) { [y, mo, d] = [+m[1], +m[2], +m[3]]; }
  else { m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i); if (!m) { const t = Date.parse(s); return isNaN(t) ? NaN : t; }
    let a = +m[1], b = +m[2]; y = +m[3]; if (y < 100) y += 2000;
    if (a > 12) [d, mo] = [a, b]; else if (b > 12) [mo, d] = [a, b]; else [d, mo] = dmy || s.includes('.') ? [a, b] : [b, a]; }
  let h = +(m[4] || 0); const mi = +(m[5] || 0), se = +(m[6] || 0), ap = (m[7] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h < 24 && mi < 60)) return NaN;
  const t = new Date(y, mo - 1, d, h, mi, se).getTime(); return t;
}
/** CSV text -> { rows: [{ t, kg, … }], skipped, lb } (rows not yet validated against "now"; the server does that) */
export function parseCsv(text, { dmy = true } = {}) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim()); if (!lines.length) return { rows: [], skipped: 0, lb: false };
  const sep = [';', '\t', ','].map(c => [c, (lines[0].match(new RegExp(c === '\t' ? '\t' : '\\' + c, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitRow(lines[0], sep), isHead = head.some(h => /[a-z]{3}/i.test(h) && isNaN(parseDate(h)) && isNaN(num(h)));
  const map = {}; let lb = false;
  if (isHead) head.forEach((h, i) => { for (const [k, re] of COLS) if (!(k in map) && re.test(h)) { map[k] = i; if (k === 'kg' && /\b(lb|lbs|pound)/i.test(h)) lb = true; break; } });
  if (!('t' in map)) map.t = 0; if (!('kg' in map)) map.kg = 1;
  const rows = []; let skipped = 0;
  for (const line of isHead ? lines.slice(1) : lines) {
    const c = splitRow(line, sep), t = parseDate(c[map.t], dmy); let kg = num((c[map.kg] || '').replace(/[^\d.,-]/g, ''));
    if (lb || /lb/i.test(c[map.kg] || '')) kg *= 0.45359237; // international avoirdupois pound
    if (!(t > 0) || !(kg > 0)) { skipped++; continue; }
    const r = { t, kg: kgOf(kg), src: 'import' };
    for (const k of ['bmi', 'fatPct', 'musclePct', 'waterPct', 'boneKg']) if (k in map) { const v = num((c[map[k]] || '').replace(/[^\d.,-]/g, '')); if (v > 0) r[k] = v; }
    if ('note' in map && c[map.note]) r.note = c[map.note];
    rows.push(r);
  }
  return { rows, skipped, lb };
}
