// Coach workouts (owner 20.11.: "I give you a workout in chat and it is in the app, without a new app version"): the app reads
// coach/workouts.json from the web server at start. The file lives only on the host (not in the repo, see coach/README.md and
// coach/workouts.example.json), so the assistant edits it there and the next start of the page has the workout.
// parseCoach is pure (tested in tools/coachworkouts-test.mjs, checked on the command line with tools/coach-workout.mjs);
// loadCoach fetches, parses and fills COACH in js/workouts.js. A missing or broken file is silent: the built-ins stay.
import { A, COACH } from './workouts.js';

export const CLIM = { workouts: 50, steps: 400, totalSec: 6 * 3600, name: 40, what: 400, label: 24, minSec: 5, maxSec: 120 * 60,
  minW: 50, maxW: 2000, minPct: 30, maxPct: 200, minRep: 2, maxRep: 50, ramp: 10 };
const ID = /^c_[A-Za-z0-9_-]{2,38}$/;
const strip = s => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ');
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const fail = m => { throw new Error(m); };
const text = (v, max, what, need = false) => {
  if (v != null && typeof v !== 'string') fail(`${what}: must be text.`);
  const s = strip(v); if (need && !s) fail(`${what}: missing.`); if (s.length > max) fail(`${what}: at most ${max} characters.`); return s;
};
const num = (v, lo, hi, what) => { const x = typeof v === 'number' ? v : NaN; if (!Number.isFinite(x) || x < lo || x > hi) fail(`${what}: ${lo}–${hi}.`); return x; };

/** one plain step -> a step in the built-in shape ({ dur, pct, pct2?, label, free? } or A(sec, watts) with its pct getter) */
function step(s, where) {
  if (!isObj(s)) fail(`${where}: must be an object.`);
  if ('repeat' in s) fail(`${where}: no repeat inside a repeat.`);
  if (('sec' in s) === ('min' in s)) fail(`${where}: give exactly one of "sec" or "min".`);
  const sec = 'sec' in s ? num(s.sec, CLIM.minSec, CLIM.maxSec, `${where} sec`) : num(s.min, CLIM.minSec / 60, CLIM.maxSec / 60, `${where} min`) * 60;
  const dur = Math.round(sec); if (dur < CLIM.minSec) fail(`${where}: at least ${CLIM.minSec} s.`);
  if (('watts' in s) === ('pct' in s)) fail(`${where}: give exactly one of "watts" or "pct".`);
  const label = text(s.label, CLIM.label, `${where} label`);
  if (s.free != null && typeof s.free !== 'boolean') fail(`${where}: "free" is true or false.`);
  let st;
  if ('watts' in s) {
    if (s.pct2 != null) fail(`${where}: "pct2" (a ramp) only with "pct".`);
    st = A(dur, Math.round(num(s.watts, CLIM.minW, CLIM.maxW, `${where} watts`)), label);
  } else {
    st = { dur, pct: num(s.pct, CLIM.minPct, CLIM.maxPct, `${where} pct`), label };
    if (s.pct2 != null) st.pct2 = num(s.pct2, CLIM.minPct, CLIM.maxPct, `${where} pct2`);
  }
  if (s.free === true) st.free = true;
  return st;
}
const clone = st => { const c = 'watts' in st ? A(st.dur, st.watts, st.label) : { ...st }; if (st.free) c.free = true; return c; };

/** a { repeat: n, label, steps, skipLastRest } group -> its steps n times; the first step of each repetition is "<label> · i/n" */
function repeat(g, where) {
  const n = g.repeat; if (!Number.isInteger(n) || n < CLIM.minRep || n > CLIM.maxRep) fail(`${where}: repeat ${CLIM.minRep}–${CLIM.maxRep} (a whole number).`);
  const label = text(g.label, CLIM.label, `${where} label`);
  if (!Array.isArray(g.steps) || !g.steps.length) fail(`${where}: "steps" must be a list with at least one step.`);
  if (g.skipLastRest != null && typeof g.skipLastRest !== 'boolean') fail(`${where}: "skipLastRest" is true or false.`);
  if (g.skipLastRest && g.steps.length < 2) fail(`${where}: "skipLastRest" needs at least two steps in the group.`);
  const one = g.steps.map((s, j) => step(s, `${where} step ${j + 1}`)), out = [];
  for (let i = 0; i < n; i++) one.forEach((st, j) => {
    if (g.skipLastRest && i === n - 1 && j === one.length - 1) return;
    const c = clone(st); if (j === 0 && label) c.label = `${label} · ${i + 1}/${n}`; out.push(c);
  });
  return out;
}

function workout(w, k, seen) {
  if (!isObj(w)) fail('must be an object.');
  if (typeof w.id !== 'string' || !ID.test(w.id)) fail('id: 4–40 characters A–Z a–z 0–9 _ -, starting with "c_".');
  if (seen.has(w.id)) fail(`id "${w.id}" is used twice.`);
  const name = text(w.name, CLIM.name, 'name', true), what = text(w.what, CLIM.what, 'what');
  const o = { id: w.id, name, what, coach: true };
  for (const r of ['rampIn', 'rampOut']) if (w[r] != null) o[r] = num(w[r], 0, CLIM.ramp, r);
  if (!Array.isArray(w.steps) || !w.steps.length) fail('"steps" must be a list with at least one step.');
  const steps = [];
  w.steps.forEach((s, i) => { const where = `step ${i + 1}`; if (isObj(s) && 'repeat' in s) steps.push(...repeat(s, where)); else steps.push(step(s, where));
    if (steps.length > CLIM.steps) fail(`more than ${CLIM.steps} steps.`); });
  const total = steps.reduce((a, s) => a + s.dur, 0); if (total > CLIM.totalSec) fail(`longer than ${CLIM.totalSec / 3600} hours.`);
  o.steps = steps; return o;
}

/** the coach file (a JSON text or the parsed object) -> { workouts: rideable workouts with coach: true, errors: [text] };
 *  an invalid workout is left out with an error, the others still load; never throws */
export function parseCoach(json) {
  const errors = [], workouts = [];
  let root = json;
  if (typeof json === 'string') { try { root = JSON.parse(json); } catch (e) { return { workouts, errors: [`File: not valid JSON (${e.message}).`] }; } }
  const list = Array.isArray(root) ? root : isObj(root) ? root.workouts : null;
  if (!Array.isArray(list)) return { workouts, errors: ['File: expected { "workouts": [ ... ] }.'] };
  const seen = new Set();
  list.forEach((w, k) => {
    const tag = `Workout ${k + 1}${isObj(w) && typeof w.id === 'string' ? ` (${strip(w.id).slice(0, 40)})` : ''}`;
    if (workouts.length >= CLIM.workouts) { errors.push(`${tag}: skipped, at most ${CLIM.workouts} workouts.`); return; }
    try { const o = workout(w, k, seen); seen.add(o.id); workouts.push(o); } catch (e) { errors.push(`${tag}: ${e.message}`); }
  });
  return { workouts, errors };
}

export const COACH_URL = 'coach/workouts.json';
/** browser: fetch coach/workouts.json (never cached: no-store plus a query the service worker and proxies have not seen),
 *  parse it and fill COACH; returns how many loaded. Never throws; a missing file (404) or broken JSON loads none. */
export async function loadCoach({ timeout = 4000 } = {}) {
  let res = [];
  try {
    const ac = typeof AbortController === 'function' ? new AbortController() : null, tm = ac && setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(`${COACH_URL}?t=${Date.now()}`, { cache: 'no-store', signal: ac?.signal });
      if (r.ok) { const p = parseCoach(await r.text()); res = p.workouts; if (p.errors.length) console.warn('Coach workouts:', p.errors.join(' | ')); }
    } finally { if (tm) clearTimeout(tm); }
  } catch { res = []; }
  COACH.length = 0; COACH.push(...res); return res.length;
}
