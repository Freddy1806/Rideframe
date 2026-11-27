// Recovery card (25.11.): Garmin's own recovery values as the RIDEFRAME watch app sends them (garmin/source/Health.mc, tools/health-api.mjs):
// sleep score, body battery, resting heart rate against its 7-day average, recovery time, VO2max. Self-contained for the start page and
// the later arrangeable overview: renderHealthCard(el, data) needs nothing but its element and GET /api/account/health's answer, and
// brings its own styles (area colour periwinkle, --hc; not used by any sport or area yet).
import { account } from './account.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CSS = `:root { --hc: #a5b4ff; } :root[data-theme="light"] { --hc: #4652c8; }
.hcard { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-radius: 14px; background: var(--ink-2); border: 1px solid color-mix(in srgb, var(--hc) 30%, var(--line)); min-width: 0; box-sizing: border-box; }
.hchead { display: flex; align-items: center; gap: 10px; min-width: 0; } .hchead > div { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.hchead small { font-size: 12px; color: var(--muted); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hcico { width: 40px; height: 40px; padding: 9px; flex: none; border-radius: 11px; color: var(--hc); background: color-mix(in srgb, var(--hc) 16%, transparent); display: grid; box-sizing: border-box; } .hcico svg { width: 100%; height: 100%; }
.hcgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; }
.hct { display: flex; flex-direction: column; gap: 1px; min-width: 0; padding: 8px 10px; border-radius: 11px; background: color-mix(in srgb, var(--hc) 7%, transparent); }
.hct > span { font-size: 11.5px; color: var(--muted); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hct > b { font-size: 22px; line-height: 1.1; font-weight: 900; font-variant-numeric: tabular-nums; white-space: nowrap; } .hct > b small { font-size: 12px; color: var(--muted); font-weight: 800; }
.hct > em { font-style: normal; font-size: 11.5px; font-weight: 800; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .hct > em.hcgood { color: var(--hc); }
.hcard.hcempty { flex-direction: row; align-items: center; } .hcempty b { font-size: 15px; } .hcempty small { font-size: 12px; color: var(--muted); white-space: normal; }`;
const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
function style() { if (typeof document === 'undefined' || document.getElementById('hcStyle')) return; const s = document.createElement('style'); s.id = 'hcStyle'; s.textContent = CSS; document.head.appendChild(s); }
const pad = n => String(n).padStart(2, '0');
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ago = (day, now) => { const [y, m, d] = day.split('-').map(Number), n = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(y, m - 1, d).getTime()) / 864e5);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 7 ? new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long' }) : new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const word = (v, l) => l.find(([x]) => v >= x)?.[1] || l[l.length - 1][1];
/** the words for a value (the overview's small cards say the same, js/cards.js) */
export const WORDS = { ss: [[90, 'excellent'], [80, 'good'], [60, 'fair'], [0, 'poor']], bb: [[75, 'charged'], [50, 'medium'], [25, 'low'], [0, 'drained']], st: [[76, 'high'], [51, 'medium'], [26, 'low'], [0, 'resting']] };
export { ago as dayAgo, ICON as MOON };
/** 27.11.7 (the owner could not tell how old the body battery was): a value of today older than this shows its time instead of its word */
export const STALE_MS = 3 * 3600e3;
/** the values that change during the day (the sleep score, resting heart rate and VO2max are one per day) */
export const AGED = ['bb', 'rt', 'st'];
/** the time ("18:05") for a value of today (latest[k]: { v, day, t }) older than STALE_MS, else '' */
export function staleTime(x, now, k) { return x && AGED.includes(k) && x.day === dayKey(now) && x.t > 0 && now - x.t > STALE_MS ? hm(x.t) : ''; }

/** the resting heart rate of the newest day against the average of the 7 days before it: { v, avg, d } or null */
export function rhrCompare(days) {
  const l = (days || []).filter(r => r.rhr > 0); if (!l.length) return null;
  const prev = l.slice(1).filter(r => r.day < l[0].day).slice(0, 7); if (!prev.length) return { v: l[0].rhr, avg: null, d: null, day: l[0].day };
  const avg = prev.reduce((s, r) => s + r.rhr, 0) / prev.length; return { v: l[0].rhr, avg: Math.round(avg * 10) / 10, d: Math.round(l[0].rhr - avg), day: l[0].day };
}

/** data = GET /api/account/health ({ days: newest first, latest }) or null (signed out: nothing) */
export function renderHealthCard(el, data, { now = Date.now() } = {}) {
  if (!el) return; if (!data) { el.innerHTML = ''; return; }
  style();
  const days = data.days || [], L = data.latest || {};
  if (!days.length) { el.innerHTML = `<div class="hcard hcempty"><span class="hcico" aria-hidden="true">${ICON}</span><div><b>Recovery</b><small>Open the RIDEFRAME app on your watch once a day to sync these: sleep score, body battery, resting heart rate, recovery time.</small></div></div>`; return; }
  const top = days[0], fresh = top.day === dayKey(now), tiles = [];
  const tile = (label, v, unit, sub = '', cls = '') => tiles.push(`<div class="hct"><span>${label}</span><b>${v}${unit ? `<small> ${unit}</small>` : ''}</b>${sub ? `<em class="${cls}">${sub}</em>` : ''}</div>`);
  const from = k => L[k] && L[k].day !== top.day ? ago(L[k].day, now) : staleTime(L[k], now, k);
  if (L.ss) tile('Sleep score', L.ss.v, '', from('ss') || word(L.ss.v, WORDS.ss));
  if (L.bb) tile('Body battery', L.bb.v, '', from('bb') || word(L.bb.v, WORDS.bb));
  const R = rhrCompare(days);
  if (R) tile('Resting HR', R.v, 'bpm', R.d == null ? 'first day' : R.d === 0 ? '= 7 days' : `${R.d > 0 ? '+' : '−'}${Math.abs(R.d)} vs 7 days`, R.d != null && R.d <= 0 ? 'hcgood' : '');
  if (L.rt) { const h = Math.round(L.rt.v / 60); tile('Recovery', L.rt.v ? (h >= 1 ? h : '<1') : '0', 'h', from('rt') || (L.rt.v ? 'to recover' : 'recovered'), L.rt.v ? '' : 'hcgood'); }
  if (L.v2r || L.v2b) tile('VO2max', L.v2r ? L.v2r.v : L.v2b.v, '', L.v2r && L.v2b ? `run · bike ${L.v2b.v}` : L.v2r ? 'running' : 'cycling');
  if (L.st && tiles.length < 6) tile('Stress', L.st.v, '', from('st') || word(L.st.v, WORDS.st));
  const when = fresh ? `today ${hm(top.last)}` : ago(top.day, now);
  el.innerHTML = `<section class="hcard" aria-label="Recovery values from your Garmin watch, ${esc(when)}"><div class="hchead"><span class="hcico" aria-hidden="true">${ICON}</span>
    <div><span class="label">Recovery</span><small>Garmin watch · ${esc(when)}${L.ts ? ' · ' + esc(L.ts.v) : ''}</small></div></div>
    ${tiles.length ? `<div class="hcgrid">${tiles.join('')}</div>` : '<small class="hint">The watch sent no recovery values yet.</small>'}</section>`;
}
/** the start page: the account's last 8 days (signed out: nothing) */
export async function mountHealthCard(el) {
  if (!el) return; const a = account(); if (!a) { renderHealthCard(el, null); return; }
  try { const r = await fetch('/api/account/health?days=8', { cache: 'no-store', headers: { 'X-RF-Token': a.token || '' } }); if (!r.ok) throw 0; renderHealthCard(el, await r.json()); } catch { el.innerHTML = ''; }
}
