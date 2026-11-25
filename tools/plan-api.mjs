// The account's training plan (25.11., js/planlib.js): users/<id>/plan.json { entries: [...] }, one write at a time per account.
//   GET    /api/account/plan?from=YYYY-MM-DD&to=YYYY-MM-DD   -> { entries } (to included, at most 92 days; default this week and next);
//          entries of past days and today without done get the matching finished activity (same day and kind) on the way
//   POST   /api/account/plan                 { day, kind, title?, ref?, minutes?, note? } -> { entry }
//   PUT    /api/account/plan/<id>            any of those fields                          -> { entry }
//   DELETE /api/account/plan/<id>                                                          -> { ok }
//   POST   /api/account/plan/<id>/done       { activity: id } or { activity: null } (undo) -> { entry }
// The Claude connector (tools/mcp-api.mjs) uses the same functions, so both sides check and store alike.
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { accountOf, shared } from './accounts-api.mjs';
import { activities } from './coachdata.mjs';
import { sportOf } from '../js/fitness.js';
import { famOf } from '../js/sports.js';
import { validateEntry, tidy, autoMatch, kindOfAct, dayKey, dayMs, addDays, monday, MAX_ENTRIES, KEEP_DAYS, MAX_RANGE } from '../js/planlib.js';

const { readJSON, writeJSON, send, body, limited, userDir } = shared;
const file = uid => join(userDir(uid), 'plan.json');
const locks = new Map();
function withUser(uid, fn) { const run = (locks.get(uid) || Promise.resolve()).then(fn); const tail = run.catch(() => {}); locks.set(uid, tail);
  tail.then(() => { if (locks.get(uid) === tail) locks.delete(uid); }); return run; }
const entriesOf = async uid => { const f = await readJSON(file(uid), null); return Array.isArray(f?.entries) ? f.entries.filter(e => e && typeof e.id === 'string' && Number.isFinite(dayMs(e.day))) : []; };
const newId = () => 'p' + Date.now().toString(36) + randomBytes(3).toString('hex');
export class PlanError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

/** the entries from..to (days, both included), sorted by day; finished activities matched to open entries first */
export async function listPlan(uid, from, to, now = Date.now()) {
  if (!Number.isFinite(dayMs(from)) || !Number.isFinite(dayMs(to))) throw new PlanError('from / to: dates as YYYY-MM-DD.');
  if (to < from) throw new PlanError('to must not be before from.');
  if ((dayMs(to) - dayMs(from)) / 864e5 > MAX_RANGE) throw new PlanError(`At most ${MAX_RANGE} days at once.`);
  const today = dayKey(now); let list = await entriesOf(uid);
  if (list.some(e => !e.done && e.kind !== 'rest' && e.day <= today && e.day >= from)) { // only then the activities are read
    const acts = (await activities(uid)).filter(a => dayKey(a.date) >= from && dayKey(a.date) <= today).map(a => ({ id: a.id, date: a.date, kind: kindOfAct(a, { sportOf, famOf }) }));
    const m = autoMatch(list.filter(e => e.day >= from && e.day <= to), acts, today);
    if (m.length) list = await withUser(uid, async () => { const l = await entriesOf(uid); for (const [id, act] of m) { const e = l.find(x => x.id === id); if (e && !e.done) { e.done = act; e.auto = true; } } await writeJSON(file(uid), { entries: l }); return l; });
  }
  return list.filter(e => e.day >= from && e.day <= to).sort((a, b) => a.day.localeCompare(b.day) || a.at - b.at).map(tidy);
}
/** a new entry (by = 'coach' when Claude planned it) */
export function addPlan(uid, b, by = null, now = Date.now()) {
  const r = validateEntry(b, { now }); if (r.error) throw new PlanError(r.error);
  return withUser(uid, async () => {
    const old = dayKey(now - KEEP_DAYS * 864e5), l = (await entriesOf(uid)).filter(e => e.day >= old);
    if (l.length >= MAX_ENTRIES) throw new PlanError(`The plan holds up to ${MAX_ENTRIES} entries. Delete some old ones first.`, 409);
    const e = tidy({ id: newId(), ...r.v, at: now, ...(by ? { by } : {}) }); l.push(e); await writeJSON(file(uid), { entries: l }); return e;
  });
}
export function editPlan(uid, id, b, now = Date.now()) {
  const r = validateEntry(b, { partial: true, now }); if (r.error) throw new PlanError(r.error);
  if (!Object.keys(r.v).length) throw new PlanError('Nothing to change: give day, kind, title, ref, minutes or note.');
  return withUser(uid, async () => {
    const l = await entriesOf(uid), i = l.findIndex(e => e.id === id); if (i < 0) throw new PlanError(`No plan entry "${String(id).slice(0, 40)}".`, 404);
    const e = tidy({ ...l[i], ...r.v, at: l[i].at, edited: now }); if (r.v.day && r.v.day !== l[i].day || r.v.kind && r.v.kind !== l[i].kind) { delete e.done; delete e.auto; } // moved: not done any more
    l[i] = e; await writeJSON(file(uid), { entries: l }); return e;
  });
}
export function deletePlan(uid, id) {
  return withUser(uid, async () => { const l = await entriesOf(uid), i = l.findIndex(e => e.id === id); if (i < 0) throw new PlanError(`No plan entry "${String(id).slice(0, 40)}".`, 404);
    const [e] = l.splice(i, 1); await writeJSON(file(uid), { entries: l }); return e; });
}
export function markDone(uid, id, act) {
  if (act !== null && (typeof act !== 'string' || !/^[\w.:-]{1,80}$/.test(act))) throw new PlanError('activity: an activity id, or null to undo.');
  return withUser(uid, async () => { const l = await entriesOf(uid), e = l.find(x => x.id === id); if (!e) throw new PlanError(`No plan entry "${String(id).slice(0, 40)}".`, 404);
    if (act) { e.done = act; delete e.auto; } else { delete e.done; delete e.auto; e.undone = Date.now(); } await writeJSON(file(uid), { entries: l }); return tidy(e); });
}

export async function planApi(req, res, path) {
  if (path !== '/api/account/plan' && !path.startsWith('/api/account/plan/')) return false;
  try {
    const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' });
    const uid = me.u.id, rest = path.slice('/api/account/plan'.length), m = req.method;
    if (m !== 'GET' && limited('plan:' + me.key, 120, 60e3)) return send(res, 429, { error: 'Too many requests.' });
    if (rest === '' && m === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams, t = dayKey(Date.now()), from = q.get('from') || monday(t), to = q.get('to') || addDays(monday(t), 13);
      return send(res, 200, { entries: await listPlan(uid, from, to) });
    }
    if (rest === '' && m === 'POST') return send(res, 200, { entry: await addPlan(uid, await body(req, 4e3)) });
    const pm = rest.match(/^\/(p[0-9a-z]{6,30})(\/done)?$/); if (!pm) return send(res, 404, { error: 'unknown' });
    if (pm[2]) { if (m !== 'POST') return send(res, 405, { error: 'not allowed' }); const b = await body(req, 1e3); return send(res, 200, { entry: await markDone(uid, pm[1], b?.activity ?? null) }); }
    if (m === 'PUT') return send(res, 200, { entry: await editPlan(uid, pm[1], await body(req, 4e3)) });
    if (m === 'DELETE') { await deletePlan(uid, pm[1]); return send(res, 200, { ok: true }); }
    return send(res, 405, { error: 'not allowed' });
  } catch (e) {
    if (e instanceof PlanError) return send(res, e.status, { error: e.message });
    const bad = e instanceof SyntaxError || /too large/.test(e?.message || ''); return send(res, bad ? 400 : 500, { error: bad ? 'Bad request.' : 'Server error.' });
  }
}
