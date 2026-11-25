// Claude connector (23.11., Freddy: "mach nen MCP, dass man über die App auch Workouts erstellen kann und das dann mit der Uhr gesynced ist"):
// a remote MCP server (Streamable HTTP, stateless, JSON answers, no SSE) at /mcp/<token>, hand-written without an SDK.
// Claude (claude.ai → Settings → Connectors → Add custom connector) lists the exercises, reads the strength history and creates,
// changes and deletes the account's watch workouts. They live in the same place as the phone editor's (users/<id>/watch.json,
// tools/watch-api.mjs editWorkouts) and pass the same check (js/watchfields.js validate), so the phone, the Strength page and the
// watch (GET /api/watch/strength/setup and /api/watch/config) show them after their next sync.
// 25.11. (Freddy: "Claude is my coach who sees all of it"): plus read-only tools over the rest of the account: get_profile,
// list_activities, get_activity, get_fitness, get_weight, get_health (tools/coachdata.mjs, tools/health-api.mjs). Writes are still
// only the watch workouts. Nothing of another account, no e-mail, no tokens.
// Auth: the secret link itself. Up to 3 links per account, made and removed in Settings → Devices → Claude connector (js/mcplink.js)
// through /api/account/mcp; only a SHA-256 hash of the token is stored (<data>/mcp.json), with label, created and last-used time.
// Protocol: dual era. Legacy clients (2025-03-26 … 2025-11-25) open with initialize; modern ones (2026-07-28) send the version in
// every request's _meta and in the MCP-Protocol-Version / Mcp-Method / Mcp-Name headers (checked against the body).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { accountOf, userByKey, shared } from './accounts-api.mjs';
import { exerciseData, editWorkouts, configOf, shortName } from './watch-api.mjs';
import { athlete, listActivities, getActivity, fitness, weight, parseDay, when } from './coachdata.mjs';
import { healthOf, latestOf, HEALTH } from './health-api.mjs';

const { DATA, readJSON, writeJSON, send, body, limited, clientIp, sha } = shared;
const MF = join(DATA, 'mcp.json');
export const MAX_LINKS = 3, CALLS_PER_MIN = 60, MAX_BODY = 16e3;
const USED_EVERY = 60e3;
export const MODERN = ['2026-07-28'], LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26'];
const ALL = [...MODERN, ...LEGACY];
const SERVER = { name: 'rideframe-workouts', title: 'RIDEFRAME coach: training data and watch workouts', version: '1.1.0' }; // the name stays: existing links know it
const INSTRUCTIONS = 'RIDEFRAME is where the user\'s training data comes together: rides, runs and other sports (recorded in the app, on the Garmin watch or imported from Strava), '
  + 'strength sessions with every set, body weight from the scale, and the recovery values of the Garmin watch. You act as the user\'s coach. '
  + 'Read first, then advise: get_profile (FTP, heart rate, weight, goal), get_fitness (fitness, fatigue, form, weekly totals, VO2max estimate), list_activities / get_activity, '
  + 'get_strength_history, get_weight and get_health (sleep score, body battery, resting heart rate, recovery time). Base advice on these numbers and say when data is missing. '
  + 'Everything is read-only except the watch strength workouts: call list_exercises first and use its ids; create_workout / update_workout / delete_workout change the workouts '
  + 'that the watch loads at its next sync and the RIDEFRAME app shows. Units are metric; weights in kg; for timed exercises (type "time", e.g. plank) reps are seconds. '
  + 'Times are the user\'s local time.';

let lock = Promise.resolve(); // serialise writes to mcp.json
function withM(fn) { const run = lock.then(async () => fn(await readJSON(MF, { links: {} }))); lock = run.catch(() => {}); return run; }
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, n);
const view = l => ({ id: l.id, label: l.label, created: l.created, used: l.used || 0 });
/** 25.11.: links made before the read-only coach tools have no scope 2: the settings show a one-time notice until the user saw it */
export const SCOPE = 2;

/* ---- the link behind /mcp/<token>: every stored hash is compared in constant time ---- */
async function linkOf(token) {
  const h = Buffer.from(sha(token), 'hex'), M = await readJSON(MF, { links: {} }); let hit = null;
  for (const [k, l] of Object.entries(M.links)) { const b = Buffer.from(k, 'hex'); if (b.length === h.length && timingSafeEqual(b, h) && !hit) hit = [k, l]; }
  if (!hit) return null;
  const [k, l] = hit, u = await userByKey(l.key); if (!u || u.id !== l.uid) return null; // a deleted account (or a new one with the same name) never inherits a link
  if (Date.now() - (l.used || 0) > USED_EVERY) withM(async M => { if (M.links[k]) { M.links[k].used = Date.now(); await writeJSON(MF, M); } }).catch(() => {});
  return { u, l, h: k };
}

/* ---- exercises: names → ids, the same list the watch's setup is built from ---- */
const TYPE = { w: 'weight', bw: 'bodyweight', time: 'time' };
const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
async function exercisesOf(u) {
  const D = await exerciseData(u), top = new Map(D.W.TOP.map(e => [e.id, e.n])), out = [];
  for (const [k, e] of D.info) {
    const t = ['bw', 'time'].includes(e.t) ? e.t : 'w', m = D.use.get(k), x = { id: k, name: e.n || k, short: shortName(k, top.get(k) || e.n || k), type: TYPE[t], group: e.own ? 'Custom' : e.g || 'Other' };
    if (top.has(k) && top.get(k) !== x.name) x.also = top.get(k);
    if (m) { x.last = { date: new Date(m.last).toISOString().slice(0, 10), sets: m.sets.slice(0, 8).map(([kg, r, s]) => t === 'time' ? { seconds: s || r } : t === 'bw' ? (kg ? { reps: r, extra_kg: kg } : { reps: r }) : { kg, reps: r }) };
      x.best = t === 'time' ? { seconds: m.best } : t === 'bw' ? { reps: m.best } : { e1rm_kg: Math.round(m.best * 10) / 10 }; }
    out.push(x);
  }
  return { list: out, D };
}
const lev = (a, b) => { const d = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i;
  for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return d[b.length]; };
/** an id or an exact name (case-insensitive; full, short or the watch's name) → the exercise, or { error } with the closest matches. Never a guess. */
function resolve(list, q) {
  const s = norm(q); if (!s) return { error: 'exercise: an id or a name from list_exercises.' };
  const byId = list.find(x => x.id.toLowerCase() === String(q).trim().toLowerCase()); if (byId) return { ex: byId };
  const names = x => [x.name, x.short, x.also, x.name.replace(/\s*\(.*?\)\s*/g, ' ')].filter(Boolean).map(norm);
  const hits = list.filter(x => names(x).includes(s));
  if (hits.length === 1) return { ex: hits[0] };
  if (hits.length > 1) return { error: `"${clean(q, 60)}" fits several exercises: ${hits.map(x => `${x.id} (${x.name})`).join(', ')}. Use the id.` };
  const score = x => Math.min(...[x.id, ...names(x)].map(n => n.includes(s) || s.includes(n) ? Math.abs(n.length - s.length) / 10 : lev(s, n) / Math.max(1, Math.max(n.length, s.length)) + 1));
  const near = list.map(x => [score(x), x]).sort((a, b) => a[0] - b[0]).slice(0, 5).map(([, x]) => `${x.id} (${x.name})`);
  return { error: `Unknown exercise "${clean(q, 60)}". Closest matches: ${near.join(', ')}. Use an id from list_exercises.` };
}

/* ---- tools ---- */
const workoutOut = (w, list) => ({ id: w.id, name: w.name, items: w.items.map(i => { const x = list.find(e => e.id === i.ex), t = x?.type || 'weight';
  return { exercise: i.ex, name: x?.name || i.ex, type: t, sets: i.sets, reps: i.reps, ...(t === 'time' ? { hold_seconds: i.reps } : {}), kg: i.kg, rest_seconds: i.rest }; }) });
const ITEM = { type: 'object', additionalProperties: false, required: ['exercise', 'sets', 'reps'], properties: {
  exercise: { type: 'string', description: 'Exercise id from list_exercises (preferred) or its exact name, case-insensitive. Unknown names are refused with the closest matches.' },
  sets: { type: 'integer', minimum: 1, maximum: 10, description: 'Number of sets, 1 to 10.' },
  reps: { type: 'integer', minimum: 1, maximum: 100, description: 'Reps per set, 1 to 100. For exercises of type "time" this is the hold time in seconds.' },
  kg: { type: 'number', minimum: 0, maximum: 500, multipleOf: 0.25, description: 'Weight in kg, 0 to 500 in 0.25 steps. Bodyweight exercises: extra weight (0 = body weight only). Default 0.' },
  rest_seconds: { type: 'integer', minimum: 0, maximum: 600, multipleOf: 5, description: 'Rest after each set in seconds, 0 to 600 in 5 s steps. Default: the user\'s rest setting (usually 90).' } } };
const ITEMS = { type: 'array', minItems: 1, maxItems: 20, items: ITEM, description: 'The exercises in order, 1 to 20.' };
const WREF = { type: 'string', description: 'The workout\'s id (from list_workouts) or its exact name, case-insensitive.' };
export const TOOLS = [
  { name: 'list_exercises', title: 'List exercises', annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Lists the exercises the user can put in a watch workout: id, name, short name, type (weight, bodyweight or time), muscle group, and, when the user has done it, the sets of the last session and the best (estimated 1RM in kg, max reps or longest hold). Optional query filters by id, name or muscle group.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', description: 'Optional filter, e.g. "press", "legs" or "chest".' } } } },
  { name: 'list_workouts', title: 'List watch workouts', annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Lists the user\'s watch workouts with their exercises, sets, reps, kg and rest, and how many more fit (up to 30).',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'create_workout', title: 'Create a watch workout', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Creates a strength workout for the user\'s Garmin watch. It appears in the RIDEFRAME app (Strength page, Settings → Devices → Watch screens & workouts) and on the watch at its next sync. Returns the stored workout.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['name', 'items'], properties: { name: { type: 'string', minLength: 1, maxLength: 40, description: 'Workout name, 1 to 40 characters, unique among the user\'s workouts.' }, items: ITEMS } } },
  { name: 'update_workout', title: 'Change a watch workout', annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Renames a watch workout and/or replaces all of its exercises (items replaces the whole list; send the full list). Returns the stored workout.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workout'], properties: { workout: WREF, name: { type: 'string', minLength: 1, maxLength: 40, description: 'New name (optional).' }, items: { ...ITEMS, description: 'New exercise list (optional), replaces the old one, 1 to 20.' } } } },
  { name: 'delete_workout', title: 'Delete a watch workout', annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    description: 'Deletes a watch workout. It disappears from the app and from the watch at its next sync.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workout'], properties: { workout: WREF } } },
  { name: 'get_strength_history', title: 'Strength history', annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'The user\'s recent strength sessions, newest first: date, name, and per exercise the done sets (kg × reps, reps, or seconds). Warm-up sets are left out. Optional exercise (id or exact name) keeps only that exercise.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { exercise: { type: 'string', description: 'Optional exercise id or exact name.' }, limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Number of sessions, 1 to 50 (default 10).' } } } },
  // 25.11.: the coach's view of everything else, read-only (tools/coachdata.mjs, tools/health-api.mjs)
  { name: 'get_profile', title: 'Athlete profile', annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'The athlete\'s numbers: FTP (setting and estimate), W/kg, max and resting heart rate, heart-rate zones, current weight and trend, goal weight, height, BMI, units. Read this first.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'list_activities', title: 'List activities', annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'All sessions of every sport, newest first, as short rows: id, type (ride, run, strength, other), indoor / outdoor, sport, name, start (local time), minutes, distance_km, climb_m, avg / max power, NP, avg / max heart rate, kcal, load points (100 = one hour at threshold) and where it came from (RIDEFRAME, Garmin watch, Strava import, by hand). Filter by type and a date range. get_activity gives one session in detail.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      type: { type: 'string', enum: ['ride', 'run', 'strength', 'other'], description: 'Optional: only this kind.' },
      from: { type: 'string', description: 'Optional first day, YYYY-MM-DD (local).' }, to: { type: 'string', description: 'Optional last day, YYYY-MM-DD (local), included.' },
      days: { type: 'integer', minimum: 1, maximum: 365, description: 'Optional: the last n days (instead of from).' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Number of rows, 1 to 100 (default 20).' } } } },
  { name: 'get_activity', title: 'One activity', annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'One session by its id from list_activities: the summary plus laps, intervals (target and actual watts, heart rate), km splits, best efforts and a small series (at most 60 points of power, heart rate, speed, cadence) where stored. Strength sessions: every set.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', description: 'The id from list_activities.' } } } },
  { name: 'get_fitness', title: 'Fitness, fatigue, form', annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'The app\'s training numbers over all sports: fitness (42-day load), fatigue (7-day), form, the last 14 days, VO2max estimates (bike, run), FTP setting and estimate, threshold pace, and totals per week (sessions, hours, km, climb, load, per sport).',
    inputSchema: { type: 'object', additionalProperties: false, properties: { weeks: { type: 'integer', minimum: 1, maximum: 26, description: 'Weeks of totals, 1 to 26 (default 8), this week first.' } } } },
  { name: 'get_weight', title: 'Body weight', annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Weigh-ins from the scale (and by hand): the latest with body fat etc. where measured, the smoothed trend, its change over 7 and 30 days, the goal weight and the distance to it, and the measurements of a range, newest first.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', minimum: 1, maximum: 3650, description: 'Range in days (default 90).' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Most measurements listed, 1 to 200 (default 60).' } } } },
  { name: 'get_health', title: 'Recovery values', annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'The Garmin watch\'s own recovery values, one row per day as the RIDEFRAME watch app read them: sleep score, body battery, recovery time (minutes), stress, resting heart rate, VO2max run / bike, training status, respiration, pulse ox, steps; plus the latest of each. Empty when the watch app was not opened.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', minimum: 1, maximum: 90, description: 'Days, 1 to 90 (default 14).' } } } },
];
const READ = new Set(['get_profile', 'list_activities', 'get_activity', 'get_fitness', 'get_weight', 'get_health']);

class ToolError extends Error {}
const fail = m => { throw new ToolError(m); };
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
function argsOk(a, schema) { // the argument shape (types, required, no extra keys); the ranges are js/watchfields.js validate's job
  if (!isObj(a)) fail('arguments: an object.');
  for (const k of Object.keys(a)) if (!Object.hasOwn(schema.properties, k)) fail(`Unknown argument "${clean(k, 30)}". Allowed: ${Object.keys(schema.properties).join(', ') || 'none'}.`);
  for (const k of schema.required || []) if (a[k] === undefined) fail(`${k} is required.`);
  for (const [k, p] of Object.entries(schema.properties)) if (a[k] !== undefined) {
    if (p.type === 'string' && typeof a[k] !== 'string') fail(`${k}: text.`);
    if (p.type === 'integer' && !Number.isInteger(a[k])) fail(`${k}: a whole number.`);
    if (p.type === 'array' && !Array.isArray(a[k])) fail(`${k}: a list.`);
    if (p.enum && !p.enum.includes(a[k])) fail(`${k}: one of ${p.enum.join(', ')}.`);
    if (p.type === 'integer' && (a[k] < p.minimum || a[k] > p.maximum)) fail(`${k}: ${p.minimum} to ${p.maximum}.`);
  }
}
/** MCP items → the watch config's items ({ ex, sets, reps, kg, rest }); names resolved, defaults filled in, nothing range-checked here */
function toItems(items, list, rest) {
  if (!items.length) fail('items: at least one exercise.');
  return items.map((it, j) => { const w = `items[${j}]`; if (!isObj(it)) fail(`${w}: an object { exercise, sets, reps, kg?, rest_seconds? }.`);
    for (const k of Object.keys(it)) if (!Object.hasOwn(ITEM.properties, k)) fail(`${w}: unknown key "${clean(k, 30)}". Allowed: exercise, sets, reps, kg, rest_seconds.`);
    for (const k of ITEM.required) if (it[k] === undefined) fail(`${w}.${k} is required.`);
    if (typeof it.exercise !== 'string') fail(`${w}.exercise: text.`);
    for (const k of ['sets', 'reps', 'kg', 'rest_seconds']) if (it[k] !== undefined && (typeof it[k] !== 'number' || !Number.isFinite(it[k]))) fail(`${w}.${k}: a number.`);
    const r = resolve(list, it.exercise); if (r.error) fail(`${w}: ${r.error}`);
    return { ex: r.ex.id, sets: it.sets, reps: it.reps, kg: it.kg ?? 0, rest: it.rest_seconds ?? rest }; });
}
/** js/watchfields.js validate's message ("workouts[3].items[1].kg: 0 to 500.") in the words of the tool's arguments */
function why(msg, k, items, list) {
  const STEP = { kg: ' (in 0.25 kg steps)', rest: ' (in 5 s steps)', sets: ' (whole number)', reps: ' (whole number)' }, NAME = { rest: 'rest_seconds' };
  const m = String(msg).match(/^workouts\[(\d+)\]\.(?:items\[(\d+)\]\.)?(\w+)(.*)$/);
  if (!m || +m[1] !== k) return msg;
  if (m[2] === undefined) return `${m[3]}${m[4]}`;
  const it = items[+m[2]], x = it && list.find(e => e.id === it.ex);
  return `items[${m[2]}]${x ? ` (${x.name})` : ''}.${NAME[m[3]] || m[3]}${m[4].replace(/\.$/, '')}${STEP[m[3]] || ''}.`;
}
const findW = (ws, q) => { const s = String(q).trim(), i = ws.findIndex(w => w.id === s), n = norm(s); if (i >= 0) return i;
  const hits = ws.map((w, j) => [w, j]).filter(([w]) => norm(w.name) === n); return hits.length === 1 ? hits[0][1] : hits.length > 1 ? -2 : -1; };
const wMissing = (ws, q) => `No workout "${clean(q, 60)}". ${ws.length ? 'The workouts: ' + ws.map(w => `${w.id} (${w.name})`).join(', ') + '.' : 'There are no workouts yet.'}`;
const newId = () => 'w' + Date.now().toString(36) + randomBytes(3).toString('hex').slice(0, 3);

const HK = { ss: 'sleep_score', bb: 'body_battery', rt: 'recovery_time_min', st: 'stress', rhr: 'resting_hr', v2r: 'vo2max_run', v2b: 'vo2max_bike', ts: 'training_status', rr: 'respiration_rate', spo2: 'pulse_ox_pct', steps: 'steps' };
const healthRow = r => { const o = { day: r.day, first_seen: when(r.first), last_seen: when(r.last) }; for (const k of Object.keys(HEALTH)) if (r[k] != null) o[HK[k]] = r[k]; return o; };
/** the read-only tools (25.11.) */
async function readTool(u, name, a) {
  if (name === 'get_profile') return athlete(u.id, u.name);
  if (name === 'list_activities') {
    const day = (k, v) => { const t = parseDay(v); if (!Number.isFinite(t)) fail(`${k}: a day as YYYY-MM-DD.`); return t; };
    if (a.from !== undefined && a.days !== undefined) fail('Give from or days, not both.');
    const from = a.from !== undefined ? day('from', a.from) : a.days !== undefined ? Date.now() - a.days * 864e5 : null, to = a.to !== undefined ? day('to', a.to) + 864e5 : null;
    if (from != null && to != null && to <= from) fail('to must not be before from.');
    const r = await listActivities(u.id, { from, to, type: a.type || null, limit: a.limit ?? 20 });
    return { count: r.rows.length, total: r.total, activities: r.rows, ...(r.empty ? { hint: 'No activities in this account yet.' } : !r.rows.length ? { hint: 'Nothing in this range / type.' } : r.total > r.rows.length ? { more: `${r.total - r.rows.length} more: narrow the range or raise limit (up to 100).` } : {}) };
  }
  if (name === 'get_activity') { const r = await getActivity(u.id, clean(a.id, 80)); if (!r) fail(`No activity "${clean(a.id, 80)}". Ids come from list_activities.`); return r; }
  if (name === 'get_fitness') { const r = await fitness(u.id, a.weeks ?? 8); return r.empty ? { ...r, hint: 'No activities yet: every number is 0.' } : r; }
  if (name === 'get_weight') { const r = await weight(u.id, { days: a.days ?? 90, limit: a.limit ?? 60 }); return r.empty ? { ...r, hint: 'No weigh-ins yet (scale or by hand on the Body page).' } : r; }
  if (name === 'get_health') {
    const days = await healthOf(u.id, a.days ?? 14), L = latestOf(days), latest = {};
    for (const [k, x] of Object.entries(L)) latest[HK[k]] = { value: x.v, day: x.day };
    return { count: days.length, latest, days: days.map(healthRow), units: { recovery_time_min: 'minutes until fully recovered', resting_hr: 'bpm', vo2max_run: 'ml/kg/min', vo2max_bike: 'ml/kg/min', body_battery: '0-100', sleep_score: '0-100', stress: '0-100' },
      ...(!days.length ? { hint: 'No recovery values yet: they come when the user opens the RIDEFRAME app on the Garmin watch (once a day is enough).' } : {}) };
  }
}

async function callTool(u, name, a = {}) {
  const t = TOOLS.find(x => x.name === name); argsOk(a, t.inputSchema);
  if (READ.has(name)) return readTool(u, name, a);
  const { list, D } = await exercisesOf(u), rest = Math.min(600, Math.max(0, Math.round((+D.S.kraftRest || 90) / 5) * 5));
  if (name === 'list_exercises') {
    const q = norm(a.query); const l = q ? list.filter(x => [x.id, x.name, x.short, x.also, x.group].some(v => v && norm(v).includes(q))) : list;
    return { count: l.length, exercises: l, ...(q && !l.length ? { hint: 'Nothing matches; call list_exercises without query for all.' } : {}) };
  }
  if (name === 'list_workouts') { const ws = (await configOf(u.id)).cfg.workouts; return { count: ws.length, max: D.W.MAX_WORKOUTS, workouts: ws.map(w => workoutOut(w, list)) }; }
  if (name === 'get_strength_history') {
    const ex = a.exercise !== undefined ? resolve(list, a.exercise) : null; if (ex?.error) fail(ex.error);
    const lim = a.limit ?? 10; if (lim < 1 || lim > 50) fail('limit: 1 to 50.');
    const out = [];
    for (const s of D.list) { if (out.length >= lim) break;
      const xs = s.ex.filter(x => (!ex || x.k === ex.ex.id) && x.sets.length); if (!xs.length) continue;
      out.push({ date: when(s.start), name: s.name || 'Workout', ...(s.dur ? { minutes: Math.round(s.dur / 60) } : {}),
        exercises: xs.map(x => { const e = list.find(y => y.id === x.k), t = e?.type || TYPE[x.t] || 'weight';
          return { exercise: x.k, name: e?.name || x.n || x.k, type: t, sets: x.sets.map(([kg, r, sec]) => t === 'time' ? { seconds: sec || r } : t === 'bodyweight' ? (kg ? { reps: r, extra_kg: kg } : { reps: r }) : { kg, reps: r }) }; }) });
    }
    return { count: out.length, sessions: out, ...(!out.length ? { hint: ex ? 'No sessions with this exercise yet.' : 'No strength sessions yet.' } : {}) };
  }
  if (name === 'create_workout') {
    const items = toItems(a.items, list, rest), nm = clean(a.name, 200);
    const r = await editWorkouts(u.id, (ws, W) => {
      if (ws.length >= W.MAX_WORKOUTS) return { error: `The account already has ${W.MAX_WORKOUTS} workouts, the most the watch holds. Delete one first (delete_workout).` };
      if (nm && ws.some(w => norm(w.name) === norm(nm))) return { error: `There is already a workout named "${nm}". Pick another name or change it with update_workout.` };
      const id = newId(); ws.push({ id, name: a.name, items }); return { list: ws, id };
    });
    if (r.error) fail(why(r.error, (await configOf(u.id)).cfg.workouts.length, items, list)); // the new one would have been the last
    return { created: true, workout: workoutOut(r.cfg.workouts.find(w => w.id === r.id), list), note: 'The watch loads it at its next sync; the app shows it under Strength → Watch workouts.' };
  }
  if (name === 'update_workout') {
    if (a.name === undefined && a.items === undefined) fail('Nothing to change: give name and/or items.');
    const items = a.items !== undefined ? toItems(a.items, list, rest) : null; let k0 = -1;
    const r = await editWorkouts(u.id, ws => { const k = findW(ws, a.workout); k0 = k;
      if (k === -2) return { error: `Several workouts are named "${clean(a.workout, 60)}". Use the id: ${ws.filter(w => norm(w.name) === norm(a.workout)).map(w => w.id).join(', ')}.` };
      if (k < 0) return { error: wMissing(ws, a.workout) };
      if (a.name !== undefined && ws.some((w, j) => j !== k && norm(w.name) === norm(a.name))) return { error: `There is already a workout named "${clean(a.name, 60)}".` };
      ws[k] = { ...ws[k], ...(a.name !== undefined ? { name: a.name } : {}), ...(items ? { items } : {}) }; return { list: ws, id: ws[k].id };
    });
    if (r.error) fail(why(r.error, k0, items || [], list));
    return { updated: true, workout: workoutOut(r.cfg.workouts.find(w => w.id === r.id), list) };
  }
  if (name === 'delete_workout') {
    let gone = null;
    const r = await editWorkouts(u.id, ws => { const k = findW(ws, a.workout);
      if (k === -2) return { error: `Several workouts are named "${clean(a.workout, 60)}". Use the id.` };
      if (k < 0) return { error: wMissing(ws, a.workout) };
      gone = ws.splice(k, 1)[0]; return { list: ws };
    });
    if (r.error) fail(r.error);
    return { deleted: true, id: gone.id, name: gone.name, left: r.cfg.workouts.length };
  }
}

/* ---- JSON-RPC over Streamable HTTP ---- */
const rpcErr = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });
const out = (res, code, obj, head = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...head }); res.end(JSON.stringify(obj)); return true; };
const nothing = (res, code, head = {}) => { res.writeHead(code, { 'Cache-Control': 'no-store', ...head }); res.end(); return true; };
const b64 = v => { const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v); return m ? Buffer.from(m[1], 'base64').toString('utf8') : v; };
const hostOf = s => { try { return new URL(s).host.toLowerCase(); } catch { return null; } };

async function rpc(req, msg, me) {
  const { id, method } = msg, params = isObj(msg.params) ? msg.params : {}, meta = isObj(params._meta) ? params._meta : {};
  const hv = req.headers['mcp-protocol-version'], mv = meta['io.modelcontextprotocol/protocolVersion'];
  const modern = method !== 'initialize' && (mv !== undefined || MODERN.includes(hv));
  const done = result => [200, { jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...result } : result }];
  if (method === 'initialize') { // legacy handshake: the same version back when known, else the newest legacy one we speak
    const want = params.protocolVersion, v = LEGACY.includes(want) ? want : LEGACY[0];
    return done({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS });
  }
  if (modern) {
    const mism = m => [400, rpcErr(id, -32020, 'Header mismatch: ' + m)];
    if (!hv) return mism('MCP-Protocol-Version header is missing.');
    if (mv === undefined) return mism('_meta["io.modelcontextprotocol/protocolVersion"] is missing.');
    if (hv !== mv) return mism(`MCP-Protocol-Version header "${clean(hv, 30)}" does not match body "${clean(mv, 30)}".`);
    if (!MODERN.includes(hv)) return [400, rpcErr(id, -32022, 'Unsupported protocol version', { supported: ALL, requested: clean(hv, 40) })];
    const mh = req.headers['mcp-method']; if (mh !== method) return mism(mh === undefined ? 'Mcp-Method header is missing.' : `Mcp-Method header "${clean(mh, 40)}" does not match body "${clean(method, 40)}".`);
    if (method === 'tools/call') { const nh = req.headers['mcp-name']; if (nh === undefined) return mism('Mcp-Name header is missing.'); if (b64(nh) !== params.name) return mism('Mcp-Name header does not match params.name.'); }
  } else {
    const v = hv === undefined ? '2025-03-26' : hv; // before 2025-06-18 there was no header
    if (!LEGACY.includes(v)) return [400, rpcErr(id, -32022, 'Unsupported protocol version', { supported: ALL, requested: clean(v, 40) })];
  }
  if (method === 'ping') return done({});
  if (method === 'server/discover' && modern) return done({ supportedVersions: ALL, capabilities: { tools: { listChanged: false } }, _meta: { 'io.modelcontextprotocol/serverInfo': SERVER }, instructions: INSTRUCTIONS });
  if (method === 'tools/list') return done({ tools: TOOLS });
  if (method === 'tools/call') {
    if (typeof params.name !== 'string' || !TOOLS.some(t => t.name === params.name)) return [200, rpcErr(id, -32602, `Unknown tool: ${clean(params.name, 60)}. Tools: ${TOOLS.map(t => t.name).join(', ')}.`)];
    if (params.arguments !== undefined && !isObj(params.arguments)) return [200, rpcErr(id, -32602, 'params.arguments must be an object.')];
    try { const r = await callTool(me.u, params.name, params.arguments || {}); return done({ content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r, isError: false }); }
    catch (e) { if (e instanceof ToolError) return done({ content: [{ type: 'text', text: e.message }], isError: true }); console.log('MCP-Fehler:', e?.message || e); return [200, rpcErr(id, -32603, 'Server error.')]; }
  }
  return [modern ? 404 : 200, rpcErr(id, -32601, `Method not found: ${clean(method, 60)}`)];
}

/** POST /mcp/<token>; true when the path was the MCP endpoint (answered here) */
async function endpoint(req, res, path) {
  const m = path.match(/^\/mcp\/([A-Za-z0-9_-]{43})$/), slow = () => nothing(res, 429, { 'Retry-After': '60' });
  if (!m) { if (limited('mcpbad:' + clientIp(req), 30, 60e3)) return slow(); return nothing(res, 404); }
  const me = await linkOf(m[1]);
  if (!me) { if (limited('mcpbad:' + clientIp(req), 30, 60e3)) return slow(); return nothing(res, 404); } // no detail: unknown, removed or malformed look the same
  const origin = req.headers.origin, own = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase(); // DNS rebinding / a web page posting here:
  if (origin !== undefined && ![own, 'claude.ai', 'claude.com'].includes(hostOf(origin))) return out(res, 403, rpcErr(null, -32600, 'Origin not allowed.')); // none (server to server), our own, or Claude's
  if (req.method !== 'POST') return nothing(res, 405, { Allow: 'POST' }); // stateless: no GET stream, no DELETE of a session
  if (limited('mcp:' + me.h, CALLS_PER_MIN, 60e3)) return out(res, 429, rpcErr(null, -32000, `Too many requests: up to ${CALLS_PER_MIN} per minute.`), { 'Retry-After': '60' });
  let msg; try { msg = await body(req, MAX_BODY); } catch (e) { return e.message === 'too large' ? out(res, 413, rpcErr(null, -32600, `Request too large (up to ${MAX_BODY / 1000} KB).`)) : out(res, 400, rpcErr(null, -32700, 'Parse error: the body must be JSON.')); }
  if (Array.isArray(msg)) return out(res, 400, rpcErr(null, -32600, 'Batches are not supported: one JSON-RPC message per POST.'));
  if (!isObj(msg) || msg.jsonrpc !== '2.0') return out(res, 400, rpcErr(msg?.id, -32600, 'Invalid request: a JSON-RPC 2.0 object.'));
  if (msg.method === undefined && (msg.result !== undefined || msg.error !== undefined)) return nothing(res, 202); // a client's response: nothing asked, nothing to do
  if (typeof msg.method !== 'string') return out(res, 400, rpcErr(msg.id, -32600, 'Invalid request: method missing.'));
  if (msg.id === undefined) return nothing(res, 202); // notifications (initialized, cancelled …): accepted, nothing to answer
  if (!(typeof msg.id === 'string' || Number.isInteger(msg.id))) return out(res, 400, rpcErr(null, -32600, 'Invalid request: id must be a string or an integer.'));
  const [code, obj] = await rpc(req, msg, me); return out(res, code, obj);
}

/* ---- Settings → Devices → Claude connector (js/mcplink.js), signed in with the phone login ---- */
async function settings(req, res, op) {
  const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' });
  const mine = M => Object.entries(M.links).filter(([, l]) => l.key === me.key && l.uid === me.u.id);
  if (op === 'mcp' && req.method === 'GET') { const M = await readJSON(MF, { links: {} }), l = mine(M);
    return send(res, 200, { links: l.map(([, x]) => view(x)).sort((a, b) => b.created - a.created), max: MAX_LINKS, notice: l.some(([, x]) => !(x.scope >= SCOPE)) }); }
  if (op === 'mcp/seen' && req.method === 'POST') return await withM(async M => { let n = 0; for (const [, l] of mine(M)) if (!(l.scope >= SCOPE)) { l.scope = SCOPE; n++; }
    if (n) await writeJSON(MF, M); return send(res, 200, { ok: true, notice: false }); });
  if (op === 'mcp' && req.method === 'POST') {
    if (limited('mcpnew:' + me.key, 10, 36e5)) return send(res, 429, { error: 'Too many new links. Please try again in an hour.' });
    const b = await body(req, 2e3).catch(() => ({}));
    return await withM(async M => {
      if (mine(M).length >= MAX_LINKS) return send(res, 409, { error: `Up to ${MAX_LINKS} links. Remove one first.` });
      const token = randomBytes(32).toString('base64url'), now = Date.now(), l = { id: randomBytes(6).toString('hex'), key: me.key, uid: me.u.id, label: clean(b?.label, 40) || 'Claude', created: now, used: 0, scope: SCOPE };
      M.links[sha(token)] = l; await writeJSON(MF, M);
      return send(res, 200, { token, path: '/mcp/' + token, link: view(l) }); // the only time the token is handed out
    });
  }
  const dm = op.match(/^mcp\/([0-9a-f]{12})$/);
  if (dm && req.method === 'DELETE') return await withM(async M => { const e = mine(M).find(([, l]) => l.id === dm[1]); if (!e) return send(res, 404, { error: 'Link not found.' });
    delete M.links[e[0]]; await writeJSON(MF, M); return send(res, 200, { ok: true }); });
  return send(res, 405, { error: 'not allowed' });
}

/** returns true when the request was for the MCP endpoint or its settings (answered here) */
export async function mcpApi(req, res, path) {
  try {
    if (path === '/mcp' || path.startsWith('/mcp/')) return await endpoint(req, res, path);
    if (path === '/api/account/mcp' || path.startsWith('/api/account/mcp/')) return await settings(req, res, path.slice(13));
    return false;
  } catch (e) { console.log('MCP-Fehler:', e?.message || e); if (!res.headersSent) { res.writeHead(500); res.end(); } return true; }
}
