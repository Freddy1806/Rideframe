// Where personal workouts live (js/myworkouts.js): signed in = on the server, private to the account (/api/account/workouts,
// tools/workouts-api.mjs), with a copy in this browser for offline starts; signed out = only in this browser (localStorage).
// Workouts made while signed out are offered for upload after signing in (uploadLocal). Every load also fills
// js/workouts.js PERSONAL, so the route page, the 3D ride and the indoor page find them by id like the built-ins.
import { account } from './account.js';
import { PERSONAL } from './workouts.js';
import { validateWorkout, validateList, toRide, LIM } from './myworkouts.js';

const LOCAL = 'rf_myworkouts', CACHE = 'rf_myworkouts_acc';
const get = k => { try { return validateList(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return []; } };
const put = (k, l) => { try { localStorage.setItem(k, JSON.stringify(l)); } catch {} };
let list = [], mode = 'local'; // 'account' | 'local'

const signedIn = () => !!account()?.token;
async function api(method, path = '', body) {
  const r = await fetch('/api/account/workouts' + path, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-RF-Token': account()?.token || '' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server is not answering.'), { status: r.status }); return j;
}
function publish() { PERSONAL.length = 0; PERSONAL.push(...list.map(toRide)); }

/** loads the list (server when signed in, else this browser) and makes it rideable; never throws */
export async function loadPersonal() {
  if (signedIn()) {
    try { const j = await api('GET'); list = validateList(j.workouts); mode = 'account'; put(CACHE, list); }
    catch (e) { if (e.status === 401) { mode = 'local'; list = get(LOCAL); } else { mode = 'account'; list = get(CACHE); } } // offline: the last copy
  } else { mode = 'local'; list = get(LOCAL); }
  publish(); return list;
}
export const personalList = () => list.slice();
export const personalById = id => list.find(w => w.id === id) || null;
export const storeMode = () => mode;
/** signed in, but workouts from before the sign-in still only in this browser */
export const localOnly = () => mode === 'account' ? get(LOCAL) : [];

/** create or replace; returns the saved workout (throws with a readable message) */
export async function savePersonal(w) {
  const v = validateWorkout({ ...w, updated: Date.now() }); if (v.error) throw new Error(v.error);
  if (mode === 'account') { const j = await api('PUT', '/' + encodeURIComponent(v.w.id), v.w); list = [j.workout, ...list.filter(x => x.id !== v.w.id)]; put(CACHE, list); }
  else {
    if (!list.some(x => x.id === v.w.id) && list.length >= LIM.count) throw new Error(`At most ${LIM.count} workouts. Delete one first.`);
    list = [v.w, ...list.filter(x => x.id !== v.w.id)]; put(LOCAL, list);
  }
  publish(); return list.find(x => x.id === v.w.id);
}
export async function deletePersonal(id) {
  if (mode === 'account') { await api('DELETE', '/' + encodeURIComponent(id)).catch(e => { if (e.status !== 404) throw e; }); list = list.filter(x => x.id !== id); put(CACHE, list); }
  else { list = list.filter(x => x.id !== id); put(LOCAL, list); }
  publish();
}
/** after signing in: the workouts of this browser to the account; returns how many went up */
export async function uploadLocal() {
  if (mode !== 'account') return 0; let n = 0; const left = [];
  for (const w of get(LOCAL)) { try { const j = await api('PUT', '/' + encodeURIComponent(w.id), w); list = [j.workout, ...list.filter(x => x.id !== w.id)]; n++; } catch { left.push(w); } }
  put(LOCAL, left); put(CACHE, list); publish(); return n;
}
