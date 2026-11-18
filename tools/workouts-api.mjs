// Personal workouts of an account (js/myworkouts.js), served by serve.mjs under /api/account/workouts:
//   GET    /api/account/workouts        -> { workouts: [...], at }
//   GET    /api/account/workouts/<id>   -> { workout }
//   PUT    /api/account/workouts/<id>   -> { ok, workout }   create or replace (body = the workout)
//   DELETE /api/account/workouts/<id>   -> { ok }
// Signed in with the phone / browser login (X-RF-Token, like the watch config). Private: kept in users/<id>/workouts.json
// (folder 0700, file 0600, tools/accounts-api.mjs writeJSON) and only ever served to the account that owns it.
import { join } from 'node:path';
import { accountOf, shared } from './accounts-api.mjs';

const { readJSON, writeJSON, send, body, limited, userDir } = shared;
const MW = () => import('../js/myworkouts.js'); // the pure browser module, the same checks as in the editor
const file = uid => join(userDir(uid), 'workouts.json');
const locks = new Map(); // uid -> promise: one write at a time per account
function withUser(uid, fn) {
  const run = (locks.get(uid) || Promise.resolve()).then(fn); const tail = run.catch(() => {}); locks.set(uid, tail);
  tail.then(() => { if (locks.get(uid) === tail) locks.delete(uid); }); return run;
}
async function listOf(uid) { const M = await MW(), f = await readJSON(file(uid), null); return { list: M.validateList(f?.list), at: +f?.at || 0 }; }

/** returns true when the request was a /api/account/workouts call (answered here) */
export async function workoutsApi(req, res, path) {
  const m = path.match(/^\/api\/account\/workouts(?:\/([^/]*))?$/); if (!m) return false;
  const M = req.method, id = m[1] === undefined ? null : decodeURIComponent(m[1]);
  try {
    const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' });
    const uid = me.u.id;
    if (id === null) {
      if (M !== 'GET') return send(res, 405, { error: 'not allowed' });
      const { list, at } = await listOf(uid); return send(res, 200, { workouts: list, at });
    }
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return send(res, 400, { error: 'Bad workout id.' });
    if (M === 'GET') { const w = (await listOf(uid)).list.find(x => x.id === id); return w ? send(res, 200, { workout: w }) : send(res, 404, { error: 'Workout not found.' }); }
    if (M !== 'PUT' && M !== 'DELETE') return send(res, 405, { error: 'not allowed' });
    if (limited('wk:' + me.key, 300, 10 * 60e3)) return send(res, 429, { error: 'Too many saves. Please wait a few minutes.' });
    if (M === 'DELETE') return await withUser(uid, async () => {
      const { list } = await listOf(uid), rest = list.filter(x => x.id !== id);
      if (rest.length === list.length) return send(res, 404, { error: 'Workout not found.' });
      await writeJSON(file(uid), { list: rest, at: Date.now() }); return send(res, 200, { ok: true });
    });
    let b; try { b = await body(req, 16e3); } catch (e) { return send(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'Workout too large.' : 'Body must be JSON.' }); }
    const lib = await MW(), v = lib.validateWorkout({ ...(b && typeof b === 'object' ? b : {}), id });
    if (v.error) return send(res, 400, { error: v.error });
    return await withUser(uid, async () => {
      const { list } = await listOf(uid), at = list.findIndex(x => x.id === id), w = { ...v.w, updated: Date.now() };
      if (at < 0 && list.length >= lib.LIM.count) return send(res, 409, { error: `At most ${lib.LIM.count} workouts per account. Delete one first.` });
      const next = at < 0 ? [w, ...list] : list.map(x => x.id === id ? w : x);
      if (JSON.stringify(next).length > lib.LIM.total) return send(res, 413, { error: 'Storage for workouts is full.' });
      await writeJSON(file(uid), { list: next, at: w.updated }); return send(res, 200, { ok: true, workout: w });
    });
  } catch (e) { return send(res, 500, { error: 'Server error.' }); }
}
