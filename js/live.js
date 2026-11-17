// "Riding now" in the browser (server: tools/live-api.mjs). Owner 17.11.: "see when someone is online and join him with one tap".
// - Presence: while a signed-in rider is in a 3D ride, a heartbeat every 20 s (never signed out, never with "Show me when I ride" off);
//   the heartbeat answer carries join requests, the ride (js/ride.js) opens a group for them and the code goes back with the next beat.
// - The list (library and route page in js/app.js, phone home in js/handy.js) and the joiner's side: ask, wait up to 45 s, join with the code.
// Plain module: no imports from app.js or the 3D world, so the phone shell can use it too (sw.js SHELL).
import { account } from './account.js';
import { esc, fmtNum } from './util.js';

export const EVERY = 20e3, REFRESH = 15e3, ASK_WAIT = 45e3, ASK_POLL = 2e3;

async function call(path, opt = {}) {
  const a = account(); if (!a?.token) throw Object.assign(new Error('Sign in first.'), { status: 401 });
  const r = await fetch('/api/live' + path, { cache: 'no-store', ...opt, headers: { 'Content-Type': 'application/json', 'X-RF-Token': a.token } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'The server is not answering.'), { status: r.status, state: j.state });
  return j;
}

/** everyone riding now except me (null when signed out or the host has no accounts) */
export async function ridingNow() {
  if (!account()) return null;
  try { return ((await call('')).riders || []).filter(r => !r.me); } catch { return null; }
}
export const getPrefs = () => call('/prefs');
export const putPrefs = p => call('/prefs', { method: 'PUT', body: JSON.stringify(p) });

/** ask a rider to let me in and wait for the answer (every 2 s, at most 45 s).
 *  Resolves { state: ready | declined | gone | expired | timeout | cancelled | error, code, name, error } */
export async function askToJoin(rider, { signal, onState } = {}) {
  let q;
  try { q = await call('/join', { method: 'POST', body: JSON.stringify({ to: rider.id }) }); }
  catch (e) { return { state: e.state === 'gone' ? 'gone' : 'error', error: e.message, name: rider.name }; }
  const t0 = Date.now(), done = s => ['ready', 'declined', 'gone', 'expired', 'cancelled'].includes(s);
  onState?.(q.state);
  while (!done(q.state)) {
    if (signal?.aborted) { call('/join/' + q.id, { method: 'DELETE' }).catch(() => {}); return { state: 'cancelled', name: rider.name }; }
    if (Date.now() - t0 >= ASK_WAIT) { call('/join/' + q.id, { method: 'DELETE' }).catch(() => {}); return { state: 'timeout', name: rider.name }; }
    await new Promise(r => { const t = setTimeout(r, ASK_POLL); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
    if (signal?.aborted) continue;
    try { q = { ...q, ...(await call('/join/' + q.id)) }; onState?.(q.state); } catch (e) { if (e.status === 404) return { state: 'gone', name: rider.name }; }
  }
  return { state: q.state, code: q.code || null, name: q.name || rider.name };
}
/** what the joiner reads when it did not work */
export function askResult(r) {
  const n = esc(r.name || 'The rider');
  return ({ declined: [`${n} declined`, 'Maybe later. You can still ride the route on your own or ask for the group code.'],
    gone: [`${n} stopped riding`, 'The ride just ended, so there is nothing to join right now.'],
    expired: [`${n} did not answer`, 'No answer within 45 seconds. Try again in a moment, or ask for the group code.'],
    timeout: [`${n} did not answer`, 'No answer within 45 seconds. Try again in a moment, or ask for the group code.'],
    error: ['That did not work', esc(r.error || 'The server is not answering.')] })[r.state] || ['That did not work', 'Please try again.'];
}

// ---------- the cards (library, route page, phone) ----------
const km = m => fmtNum(m / 1000, m < 100000 ? 1 : 0), kmLen = m => fmtNum(m / 1000, m < 10000 ? 1 : 0);
export const progress = r => `km ${km(r.d)} of ${kmLen(r.len)}`;
export function since(t, now = Date.now()) { const m = Math.max(0, Math.round((now - t) / 60e3)); return m < 1 ? 'just started' : m < 60 ? `for ${m} min` : `for ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; }
const initials = n => esc(String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => [...w][0] || '').join('').toUpperCase() || '?');
/** the rider's face: the leaderboard portrait on the laptop (faceImg from profiles.js, the default rider without a look), initials on the phone and while it renders */
export const avatar = (r, face) => `<span class="lvface"><span class="lvini">${initials(r.name)}</span>${face ? face(r.look || null, 'face lvimg') : ''}</span>`;
/** one card; phone = read-only with "Join on your laptop" + Copy link; haveRoute = false when this computer lacks the route */
export function riderCard(r, { phone = false, face = null, haveRoute = true } = {}) {
  return `<div class="lvcard" data-sid="${esc(r.id)}">${avatar(r, face)}
    <div class="lvtxt"><b class="lvname">${esc(r.name)}</b><span class="lvroute">${esc(r.routeName)}</span>
      <span class="lvkm"><i class="lvdot" aria-hidden="true"></i><span>${progress(r)} · ${since(r.since)}</span></span></div>
    ${phone ? `<div class="lvact"><span class="lvhint">Join on your laptop</span><button class="btn ghost small lvcopy" type="button">Copy link</button></div>`
      : haveRoute ? `<button class="btn small lvjoin" type="button" title="${r.ask ? `${esc(r.name)} gets a short question first` : `You start right next to ${esc(r.name)}`}">Join</button>`
      : '<span class="lvhint" title="Own video routes have to be imported on both computers">Route not on this computer</span>'}</div>`;
}
export function stripHTML(riders, opts) {
  return `<div class="live-in"><div class="live-head"><span class="label"><i class="lvdot" aria-hidden="true"></i>Riding now</span><span class="live-n">${riders.length === 1 ? '1 friend on the road' : riders.length + ' friends on the road'}</span></div>
    <div class="lvgrid">${riders.map(r => riderCard(r, { ...opts, haveRoute: opts?.have ? opts.have(r) : true })).join('')}</div></div>`;
}
/** the link a laptop opens to join: the group code when it is known, else a join request for this rider */
export const joinLink = r => `${location.origin}/${r.code ? '?join=' + r.code : '?live=' + r.id}`;

/** show or update a strip in el (no space taken while nobody rides, slides in when someone starts) */
export function showStrip(el, riders, opts) {
  if (!el) return;
  if (!riders?.length) { el.classList.remove('on'); el.dataset.n = '0'; clearTimeout(el._t); el._t = setTimeout(() => { if (el.dataset.n === '0') el.innerHTML = ''; }, 400); return; }
  el.dataset.n = String(riders.length); clearTimeout(el._t);
  el.innerHTML = stripHTML(riders, opts);
  if (!el.classList.contains('on')) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
}

/** refresh fn every 15 s while the page is visible and el is in the document; returns stop() */
export function every15(el, fn) {
  let t = 0; const tick = () => { if (!el.isConnected) return stop(); if (!document.hidden) fn(); };
  const vis = () => { if (!el.isConnected) return stop(); if (!document.hidden) fn(); };
  const stop = () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  t = setInterval(tick, REFRESH); document.addEventListener('visibilitychange', vis); fn();
  return stop;
}

// ---------- the rider's side: heartbeat while in a 3D ride ----------
/** src: { info() -> { routeId, routeName, d, len, code }, alive() -> bool, onRequest({ id, from, auto }) } */
export class Presence {
  constructor(src) { this.src = src; this.answers = []; this.seen = new Set(); this.startedAt = Date.now(); this.on = false; }
  start() {
    if (!account() || !this.src.alive()) return false;
    this.on = true; this.beat(); this.t = setInterval(() => this.beat(), EVERY);
    this._bye = () => this.stop(); addEventListener('pagehide', this._bye);
    return true;
  }
  async beat() {
    if (!this.on) return;
    if (!account() || !this.src.alive()) return this.stop();
    if (this._busy) { this._again = true; return; }
    this._busy = true; const answers = this.answers.splice(0);
    try {
      const i = this.src.info(), j = await call('', { method: 'POST', body: JSON.stringify({ routeId: i.routeId, routeName: String(i.routeName || '').slice(0, 80), d: Math.max(0, Math.round(i.d || 0)), len: Math.max(1, Math.round(i.len || 1)), code: i.code || null, startedAt: this.startedAt, answers }) });
      if (j.hidden) { this.stop(false); return; }
      for (const r of j.requests || []) if (!this.seen.has(r.id)) { this.seen.add(r.id); try { this.src.onRequest(r); } catch {} }
    } catch (e) { if (e.status !== 400) this.answers.unshift(...answers); if (e.status === 401) this.stop(false); }
    finally { this._busy = false; if (this._again && this.on) { this._again = false; this.beat(); } }
  }
  /** answer a request; goes out right away (not only with the next 20 s beat) */
  answer(id, ok) { this.answers.push({ id, ok: !!ok }); this.beat(); }
  stop(tell = true) {
    if (!this.on) return; this.on = false; clearInterval(this.t); removeEventListener('pagehide', this._bye);
    const a = account(); if (tell && a?.token) fetch('/api/live', { method: 'DELETE', keepalive: true, headers: { 'X-RF-Token': a.token } }).catch(() => {});
  }
}
