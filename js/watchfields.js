// What the watch shows and does, set up on the phone (18.11., step 1 of the watch concept): the data fields per sport with
// label, unit and a demo value, the default pages, the 20 standard exercises, the "more" sports, the config's strict check
// and the compact form the watch caches. Pure, no DOM: used by the server (tools/watch-api.mjs), the phone editor
// (js/watchcfg.js), the preview (js/watchsim.js, js/watchflow.js) and the Node tests. garmin/ will carry the same tables.
import { STRAVA, labelOf } from './sports.js';

/** field id -> [label, unit, demo value]; short labels, they sit above a number on a 280 px round screen */
const F = {
  pace: ['Pace', '/km', '5:12'], lapPace: ['Lap pace', '/km', '5:08'], avgPace: ['Avg pace', '/km', '5:15'], dist: ['Distance', 'km', '8.42'], lapDist: ['Lap dist', 'km', '0.62'],
  time: ['Time', '', '43:51'], lapTime: ['Lap time', '', '3:12'], hr: ['Heart rate', 'bpm', '148'], hrZone: ['HR zone', '', 'Z3'], cadence: ['Cadence', 'spm', '172'],
  kcal: ['Calories', 'kcal', '612'], clock: ['Clock', '', '18:42'], climb: ['Climb', 'm', '214'],
  power3s: ['Power 3s', 'W', '248'], power: ['Power', 'W', '252'], avgPower: ['Avg power', 'W', '221'], speed: ['Speed', 'km/h', '32.4'], avgSpeed: ['Avg speed', 'km/h', '29.8'], np: ['NP', 'W', '236'],
};
const pick = (ids, over = {}) => Object.fromEntries(ids.map(k => { const [l, u, demo] = { ...F, ...over }[k]; return [k, { l, u, demo }]; }));
/** the fields each sport can show, in the order of the phone's picker */
export const FIELDS = {
  run: pick(['pace', 'lapPace', 'avgPace', 'dist', 'lapDist', 'time', 'lapTime', 'hr', 'hrZone', 'cadence', 'kcal', 'clock', 'climb']),
  ride: pick(['power3s', 'power', 'avgPower', 'speed', 'avgSpeed', 'dist', 'time', 'hr', 'hrZone', 'cadence', 'climb', 'kcal', 'clock', 'np'], { cadence: ['Cadence', 'rpm', '88'], dist: ['Distance', 'km', '42.7'], time: ['Time', '', '1:24:10'], kcal: ['Calories', 'kcal', '1,048'] }),
  other: pick(['hr', 'hrZone', 'time', 'clock', 'kcal', 'dist'], { time: ['Time', '', '52:30'], kcal: ['Calories', 'kcal', '486'], dist: ['Distance', 'km', '3.10'] }),
};
export const SPORTS = ['run', 'ride', 'other'];
export const MAX_PAGES = 4, MAX_FIELDS = 4, MAX_WORKOUTS = 30, MAX_ITEMS = 20, MAX_MORE = 40, MAX_BYTES = 48e3;
export const LIM = { sets: [1, 10], reps: [1, 100], kg: [0, 500], rest: [0, 600] };

/** sports for "More" on the watch: every Strava type outside the four with their own screens (ride, run, strength, swim) */
export const MORE = Object.keys(STRAVA).filter(k => !['ride', 'trainer', 'run', 'kraft', 'swim'].includes(STRAVA[k][0]));
export { labelOf };

/** the standard exercises of the watch's free mode (20, front squat added 23.11.): [id in js/kraftlib.js, short name, w | bw | time] */
export const TOP = [['bench', 'Bench press', 'w'], ['incline', 'Incline bench press', 'w'], ['ohp', 'Overhead press', 'w'], ['dip', 'Dips', 'bw'], ['push', 'Push-ups', 'bw'],
  ['pull', 'Pull-ups', 'bw'], ['lat', 'Lat pulldown', 'w'], ['row', 'Barbell row', 'w'], ['cable', 'Cable row', 'w'], ['squat', 'Squat', 'w'], ['frontsquat', 'Front squat', 'w'], ['legpress', 'Leg press', 'w'],
  ['dead', 'Deadlift', 'w'], ['rdl', 'Romanian deadlift', 'w'], ['lunge', 'Lunges', 'w'], ['legcurl', 'Leg curl', 'w'], ['calf', 'Calf raise', 'w'], ['curl', 'Biceps curl', 'w'],
  ['tri', 'Triceps pushdown', 'w'], ['lateral', 'Lateral raise', 'w'], ['plank', 'Plank', 'time']].map(([id, n, t]) => ({ id, n, t }));

const sport = (pages, x = {}) => ({ pages: pages.map(fields => ({ fields })), map: true, segWarn: true, autoLap: true, autoPause: false, vibrate: true, ...x });
/** what the watch uses while nothing is stored */
export function defaults() {
  return { v: 1, sports: { run: sport([['pace', 'dist', 'time', 'hr'], ['lapPace', 'lapDist', 'avgPace', 'hrZone']]), ride: sport([['power3s', 'speed', 'hr', 'time'], ['dist', 'climb', 'avgPower', 'cadence']], { autoPause: true }),
    other: { pages: [{ fields: ['hr', 'time', 'clock', 'kcal'] }] } }, more: ['Walk', 'Hike', 'Yoga', 'Workout'], workouts: [] };
}

/* ---- the strict check: everything the phone may PUT, nothing else ---- */
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
const keysOk = (o, allowed, where) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new Error(`${where}: unknown key "${k}".`); };
const int = (v, [lo, hi], where, step = 1) => { const n = +v; if (typeof v !== 'number' || !Number.isFinite(n) || n < lo || n > hi || Math.round(n / step) * step !== n) throw new Error(`${where}: ${lo} to ${hi}.`); return n; };
const bool = (v, where) => { if (typeof v !== 'boolean') throw new Error(`${where}: true or false.`); return v; };
const text = (v, max, where) => { if (typeof v !== 'string') throw new Error(`${where}: text.`); const s = v.replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' '); if (!s || s.length > max) throw new Error(`${where}: 1 to ${max} characters.`); return s; };
function pages(v, sp, where) {
  if (!Array.isArray(v) || !v.length || v.length > MAX_PAGES) throw new Error(`${where}.pages: 1 to ${MAX_PAGES} pages.`);
  return v.map((p, i) => { const w = `${where}.pages[${i}]`; if (!isObj(p)) throw new Error(`${w}: an object.`); keysOk(p, ['fields'], w);
    if (!Array.isArray(p.fields) || !p.fields.length || p.fields.length > MAX_FIELDS) throw new Error(`${w}.fields: 1 to ${MAX_FIELDS} fields.`);
    for (const f of p.fields) if (typeof f !== 'string' || !Object.hasOwn(FIELDS[sp], f)) throw new Error(`${w}.fields: "${String(f).slice(0, 20)}" is not a ${sp} field.`);
    if (new Set(p.fields).size !== p.fields.length) throw new Error(`${w}.fields: a field twice.`);
    return { fields: p.fields.slice() }; });
}
/** checks a whole config from the phone; returns { cfg } (a clean copy) or { error } */
export function validate(c) {
  try {
    if (!isObj(c)) throw new Error('Config must be an object.');
    keysOk(c, ['v', 'sports', 'more', 'workouts'], 'config');
    if (c.v !== 1) throw new Error('v: 1.');
    if (!isObj(c.sports)) throw new Error('sports: an object.'); keysOk(c.sports, SPORTS, 'sports');
    const out = { v: 1, sports: {}, more: [], workouts: [] }, D = defaults();
    for (const sp of SPORTS) {
      const s = c.sports[sp]; if (s === undefined) { out.sports[sp] = D.sports[sp]; continue; }
      const w = 'sports.' + sp; if (!isObj(s)) throw new Error(`${w}: an object.`);
      const flags = sp === 'other' ? [] : ['map', 'segWarn', 'autoLap', 'autoPause', 'vibrate'];
      keysOk(s, ['pages', ...flags], w);
      const o = { pages: pages(s.pages, sp, w) };
      for (const f of flags) o[f] = s[f] === undefined ? D.sports[sp][f] : bool(s[f], `${w}.${f}`);
      out.sports[sp] = o;
    }
    if (c.more !== undefined) { if (!Array.isArray(c.more) || c.more.length > MAX_MORE) throw new Error(`more: up to ${MAX_MORE} sports.`);
      for (const t of c.more) if (typeof t !== 'string' || !MORE.includes(t)) throw new Error(`more: "${String(t).slice(0, 30)}" is not a sport for the watch.`);
      out.more = [...new Set(c.more)]; }
    if (c.workouts !== undefined) {
      if (!Array.isArray(c.workouts) || c.workouts.length > MAX_WORKOUTS) throw new Error(`workouts: up to ${MAX_WORKOUTS}.`);
      const ids = new Set();
      out.workouts = c.workouts.map((x, i) => { const w = `workouts[${i}]`; if (!isObj(x)) throw new Error(`${w}: an object.`); keysOk(x, ['id', 'name', 'items'], w);
        if (typeof x.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(x.id) || ids.has(x.id)) throw new Error(`${w}.id: 1 to 40 letters, digits, _ or -, unique.`); ids.add(x.id);
        if (!Array.isArray(x.items) || x.items.length > MAX_ITEMS) throw new Error(`${w}.items: up to ${MAX_ITEMS} exercises.`);
        return { id: x.id, name: text(x.name, 40, w + '.name'), items: x.items.map((it, j) => { const v = `${w}.items[${j}]`; if (!isObj(it)) throw new Error(`${v}: an object.`);
          keysOk(it, ['ex', 'sets', 'reps', 'kg', 'rest'], v);
          if (typeof it.ex !== 'string' || !/^[\w-]{1,64}$/.test(it.ex)) throw new Error(`${v}.ex: an exercise id.`);
          return { ex: it.ex, sets: int(it.sets, LIM.sets, v + '.sets'), reps: int(it.reps, LIM.reps, v + '.reps'), kg: int(it.kg, LIM.kg, v + '.kg', .25), rest: int(it.rest, LIM.rest, v + '.rest', 5) }; }) }; });
    }
    if (JSON.stringify(out).length > MAX_BYTES) throw new Error('Config too large.');
    return { cfg: out };
  } catch (e) { return { error: e.message }; }
}

/** the form the watch caches (GET /api/watch/config): short keys, flags as 0 / 1, pages as plain id lists, sport labels resolved.
 *  names = exercise id -> short name, for the workouts (the watch also gets them with the strength setup) */
export function compact(cfg, names = null) {
  const c = validate(cfg).cfg || defaults(), b = v => v ? 1 : 0, sp = s => ({ p: s.pages.map(p => p.fields), map: b(s.map), seg: b(s.segWarn), lap: b(s.autoLap), pause: b(s.autoPause), vib: b(s.vibrate) });
  return { v: 1, run: sp(c.sports.run), ride: sp(c.sports.ride), other: { p: c.sports.other.pages.map(p => p.fields) }, more: c.more.map(t => [t, labelOf(t)]),
    w: c.workouts.filter(w => w.items.length).map(w => ({ id: w.id, n: w.name, it: w.items.map(i => names ? [i.ex, i.sets, i.reps, i.kg, i.rest, names(i.ex)] : [i.ex, i.sets, i.reps, i.kg, i.rest]) })) };
}

/* ---- what a field shows during a recording: R = the flow's recording state (js/watchflow.js), now = Unix seconds ---- */
const two = n => String(n).padStart(2, '0');
export const hms = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + two(m) : m) + ':' + two(s % 60); };
const pace = (sec, m) => !(m > 5) || !(sec > 0) || sec / m * 1000 > 3600 ? '--:--' : (x => Math.floor(x / 60) + ':' + two(x % 60))(Math.round(sec / m * 1000));
const km = m => (m / 1000).toFixed(m < 100000 ? 2 : 1);
export const ZONES = [.6, .7, .8, .9]; // of the max heart rate: below 60 % zone 1 … above 90 % zone 5
export const zoneOf = (hr, max = 190) => hr > 0 ? 1 + ZONES.filter(z => hr >= z * max).length : 0;
/** the text for field id (no unit; the unit comes from FIELDS) */
export function fieldText(id, R, now) {
  const lapT = R.t - R.lapT0, lapD = R.d - R.lapD0;
  switch (id) {
    case 'pace': return R.v > .5 ? pace(1000 / R.v, 1000) : '--:--';
    case 'lapPace': return pace(lapT, lapD);
    case 'avgPace': return pace(R.t, R.d);
    case 'dist': return km(R.d);
    case 'lapDist': return km(lapD);
    case 'time': return hms(R.t);
    case 'lapTime': return hms(lapT);
    case 'hr': return R.hr > 0 ? String(R.hr) : '--';
    case 'hrZone': return R.hr > 0 ? 'Z' + zoneOf(R.hr, R.hrMax) : '--';
    case 'cadence': return R.cad > 0 ? String(Math.round(R.cad)) : '--';
    case 'kcal': return String(Math.round(R.kcal)).replace(/\B(?=(\d{3})+$)/g, ',');
    case 'clock': { const d = new Date(now * 1000); return d.getHours() + ':' + two(d.getMinutes()); }
    case 'climb': return String(Math.round(R.gain));
    case 'power3s': return R.p3.length ? String(Math.round(R.p3.reduce((a, x) => a + x, 0) / R.p3.length)) : '--';
    case 'power': return String(Math.round(R.pw));
    case 'avgPower': return R.t > 0 ? String(Math.round(R.pwSum / R.t)) : '--';
    case 'speed': return (R.v * 3.6).toFixed(1);
    case 'avgSpeed': return R.t > 0 ? (R.d / R.t * 3.6).toFixed(1) : '0.0';
    case 'np': return R.npN ? String(Math.round(Math.pow(R.np4 / R.npN, .25))) : '--';
  }
  return '--';
}
