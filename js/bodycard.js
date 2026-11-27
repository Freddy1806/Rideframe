// Body data on the client (25.11.): the API calls (tools/body-api.mjs), the profile weight following the scale on this device, and the
// self-contained weight card renderWeightCard(el, data) for the start page (and later the arrangeable overview: it needs nothing
// but its element and the data, and draws its own sparkline).
import { trend, changes, changeWords, fmtKg } from './bodylib.js';
import { compOf } from './bodycomp.js';
import { account } from './account.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** own fetch: a 401 here must not sign the phone out (account.js does that) */
export async function api(path, opt = {}) {
  const r = await fetch(path, { cache: 'no-store', ...opt, headers: { 'Content-Type': 'application/json', 'X-RF-Token': account()?.token || '', ...(opt.headers || {}) } });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server is not answering.'), { status: r.status }); return j;
}
export const loadBody = (from = 0) => api('/api/body' + (from ? '?from=' + Math.floor(from) : ''));

/** the profile weight on this device follows the newest weigh-in (the server already changed the account's settings) */
export async function syncWeight(list, prefs) {
  if (!prefs?.follow || !list?.length) return false;
  const last = list.reduce((a, m) => !a || m.t > a.t ? m : a, null);
  try { const { db } = await import('./db.js'), st = (await db.kvGet('settings').catch(() => null)) || {};
    if (st.riderKg === last.kg && st.riderKgAt === last.t) return false; // (the newest one deleted: back to the one before)
    st.riderKg = last.kg; st.riderKgAt = last.t; await db.kvSet('settings', st); return true; } catch { return false; }
}
/** all of the account's body data for the export in the profile (null signed out) */
export async function exportBody() { if (!account()) return null; const j = await loadBody(); return { list: j.list, prefs: j.prefs }; }

export const when = t => { const d = new Date(t), now = new Date(), days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 864e5);
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return days === 0 ? `Today ${hm}` : days === 1 ? `Yesterday ${hm}` : days < 7 ? `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}` : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: now.getFullYear() === d.getFullYear() ? undefined : 'numeric' }); };

/** a small line of the trend with the weigh-ins as dots; w × h in CSS pixels (scales with the card) */
export function sparkline(list, { days = 30, w = 120, h = 40, now = Date.now() } = {}) {
  const from = now - days * 864e5, tr = trend(list).filter(p => p.t >= from), pts = list.filter(m => m.t >= from);
  if (tr.length < 2 && pts.length < 2) return '';
  const vals = [...tr.map(p => p.trend), ...pts.map(m => m.kg)], lo = Math.min(...vals) - .2, hi = Math.max(...vals) + .2;
  const x = t => 2 + (t - from) / (now - from) * (w - 4), y = v => 3 + (hi - v) / (hi - lo) * (h - 6);
  const line = tr.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.trend).toFixed(1)}`).join('');
  return `<svg class="bspark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${pts.map(m => `<circle cx="${x(m.t).toFixed(1)}" cy="${y(m.kg).toFixed(1)}" r="1.6"/>`).join('')}<path d="${line}" vector-effect="non-scaling-stroke"/></svg>`;
}

/** the weight card: data = { list, prompts? } or null (signed out: nothing). Self-contained: link, numbers and sparkline in el */
export function renderWeightCard(el, data, { href = 'body.html' } = {}) {
  if (!el) return; if (!data) { el.innerHTML = ''; return; }
  const list = data.list || [], ask = (data.prompts || []).length;
  const badge = ask ? `<span class="bcask">${ask} weigh-in${ask > 1 ? 's' : ''} to confirm</span>` : '';
  if (!list.length) { el.innerHTML = `<a class="bcard bempty" href="${href}"><span class="bcico" aria-hidden="true">${SCALE}</span><div><b>Weight</b><small>Add a weigh-in or connect your scale</small>${badge}</div><i>›</i></a>`; return; }
  const last = list.reduce((a, m) => !a || m.t > a.t ? m : a, null), c = changes(list), w = changeWords(c.d7);
  // 26.11.: body fat (estimated from the newest weigh-in's impedance, js/bodycomp.js) as a quiet second value; only the newest one,
  // an older estimate next to today's weight would read as today's
  const bf = compOf(last, data.prefs);
  el.innerHTML = `<a class="bcard" href="${href}" aria-label="Weight ${fmtKg(last.kg)} kg, ${esc(when(last.t))}.${bf ? ` Body fat about ${bf.fatPct.toFixed(1)} percent, estimated.` : ''} 7 days: ${esc(w.text)}.">
    <span class="bcico" aria-hidden="true">${SCALE}</span>
    <div class="bcmain"><span class="label">Weight</span><b>${fmtKg(last.kg)}<small> kg</small></b>${bf ? `<span class="bcfat" aria-hidden="true">${bf.fatPct.toFixed(1)} % fat <small>est.</small></span>` : ''}<small>${esc(when(last.t))}</small>${badge}</div>
    <div class="bcside">${sparkline(list)}${c.d7 == null ? '' : `<span class="bchg ${w.cls}">${w.arrow ? `<em aria-hidden="true">${w.arrow}</em> ` : ''}${esc(w.text)}<small> · 7 days</small></span>`}</div><i>›</i></a>`;
}
/** the start page: loads the account's last 90 days, draws the card, lets this device's profile weight follow */
export async function mountWeightCard(el) {
  if (!el) return; if (!account()) { renderWeightCard(el, null); return; }
  try { const j = await loadBody(Date.now() - 90 * 864e5); renderWeightCard(el, j); syncWeight(j.list, j.prefs); } catch { el.innerHTML = ''; }
}
export const SCALE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8.5 9.5a5 5 0 0 1 7 0M12 9.5l1.2-1.6"/></svg>';

/** 27.11. (owner: the weight card big, about the height of Fitness and Strength together): the newest weight, its change over 7 and
 *  30 days, 90 days of trend (the smoothed line and the weigh-ins as dots) and body fat / muscle underneath when there are any.
 *  Drawn to the card's real width, so the dots stay round and the text text-sized. A tap opens the Body page. */
export function renderWeightBig(el, data, { href = 'body.html', now = Date.now() } = {}) {
  if (!el) return; if (!data) { el.innerHTML = ''; return; }
  const list = data.list || [], ask = (data.prompts || []).length;
  const badge = ask ? `<span class="bcask">${ask} weigh-in${ask > 1 ? 's' : ''} to confirm</span>` : '';
  if (!list.length) { el.innerHTML = `<a class="bcard bempty" href="${href}"><span class="bcico" aria-hidden="true">${SCALE}</span><div><b>Weight</b><small>Add a weigh-in or connect your scale</small>${badge}</div><i>›</i></a>`; return; }
  const last = list.reduce((a, m) => !a || m.t > a.t ? m : a, null), c = changes(list);
  const chg = (d, l) => { const w = changeWords(d), flat = d != null && Math.abs(d) < 0.15;
    return `<span class="wgc ${d == null ? '' : w.cls}"><b>${d == null ? '–' : flat ? '±0' : `${w.arrow ? `<em aria-hidden="true">${w.arrow}</em>` : ''}${Math.abs(d).toFixed(1)}`}<small>${d == null || flat ? '' : ' kg'}</small></b><small>${l}</small></span>`; };
  const lastOf = k => [...list].reverse().find(m => m[k] != null);
  const fat = lastOf('fatPct'), est = !fat && compOf(last, data.prefs), mus = lastOf('musclePct');
  const subs = [fat ? ['Body fat', `${fat.fatPct.toFixed(1)} %`] : est ? ['Body fat', `${est.fatPct.toFixed(1)} % <small>est.</small>`] : null, mus ? ['Muscle', `${mus.musclePct.toFixed(1)} %`] : null].filter(Boolean);
  el.innerHTML = `<a class="bcard wgbig" href="${href}" aria-label="Weight ${fmtKg(last.kg)} kg, ${esc(when(last.t))}. 7 days: ${esc(changeWords(c.d7).text)}. 30 days: ${esc(changeWords(c.d30).text)}.">
    <div class="wgh"><span class="cdt"><span class="bcico" aria-hidden="true">${SCALE}</span><span>Weight</span></span><small>${esc(when(last.t))}</small><i class="cdgo" aria-hidden="true">›</i></div>
    <div class="wgtop"><b class="wgnum">${fmtKg(last.kg)}<small> kg</small></b><div class="wgcs">${chg(c.d7, '7 days')}${chg(c.d30, '30 days')}</div></div>${badge}
    <div class="wgchart"></div>
    ${subs.length ? `<div class="wgsub">${subs.map(([l, v]) => `<span><small>${l}</small><b>${v}</b></span>`).join('')}</div>` : ''}</a>`;
  const box = el.querySelector('.wgchart'), W = Math.max(240, Math.round(box.clientWidth || el.clientWidth - 28 || 320)), H = 112, from = now - 90 * 864e5;
  const tr = trend(list).filter(p => p.t >= from), pts = list.filter(m => m.t >= from);
  if (tr.length < 2 && pts.length < 2) return;
  const vals = [...tr.map(p => p.trend), ...pts.map(m => m.kg)], lo = Math.min(...vals) - .3, hi = Math.max(...vals) + .3, R = 34;
  const x = t => 3 + (t - from) / (now - from) * (W - R - 6), y = v => 6 + (hi - v) / (hi - lo) * (H - 22);
  const line = tr.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.trend).toFixed(1)}`).join('');
  const mo = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  box.innerHTML = `<svg class="wgsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    ${[hi - .3, lo + .3].map(v => `<line class="wgl" x1="0" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${W}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`).join('')}
    ${pts.map(m => `<circle cx="${x(m.t).toFixed(1)}" cy="${y(m.kg).toFixed(1)}" r="1.7"/>`).join('')}<path d="${line}"/>
    <text x="0" y="${H - 2}">${mo(from)}</text><text x="${W - R}" y="${H - 2}" text-anchor="end">today</text></svg>`;
}
