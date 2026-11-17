// Settings → Devices → Garmin watch (17.11.): pair a watch with a 6-digit code, list paired watches, remove one.
// Server: tools/watch-api.mjs. The code lives 10 minutes and works once; the watch keeps its own token.
import { account } from './account.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let code = null, list = null, msg = '', timer = 0, poll = 0; // kept here, so a redraw of the settings sheet keeps the code on screen

async function api(path, opt = {}) { // own fetch: a 401 here must not sign the phone out (account.js does that)
  const r = await fetch('/api/watch/' + path, { cache: 'no-store', ...opt, headers: { 'Content-Type': 'application/json', 'X-RF-Token': account()?.token || '' } });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server is not answering.'), { status: r.status }); return j;
}
const day = t => { const d = Math.floor((Date.now() - t) / 864e5); return d < 1 ? 'today' : d < 2 ? 'yesterday' : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const left = () => Math.max(0, Math.ceil((code.exp - Date.now()) / 1000));
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** fills box (inside the settings sheet); signIn() opens the account dialog */
export function watchRow(box, signIn) {
  if (!box) return;
  clearInterval(timer); clearInterval(poll);
  if (!account()) {
    box.innerHTML = `<div class="hrow wrow"><div><b>Garmin watch</b><small>Sign in to pair a watch</small></div><button class="btn ghost ksmall" id="wIn">Sign in</button></div>`;
    box.querySelector('#wIn').onclick = signIn; return;
  }
  const draw = () => {
    if (!box.isConnected) { clearInterval(timer); clearInterval(poll); return; }
    const live = code && left() > 0;
    box.innerHTML = `<div class="hrow wrow"><div><b>Garmin watch</b><small>Log sets on the watch</small></div><button class="btn ghost ksmall" id="wPair">${code ? 'New code' : 'Pair a watch'}</button></div>
      ${code ? `<div class="wpair" role="status">${live ? `<div class="wcode" aria-label="Pairing code ${code.code.split('').join(' ')}">${code.code.slice(0, 3)} ${code.code.slice(3)}</div><div class="wleft">Valid for <b id="wLeft">${mmss(left())}</b></div>
        <ol class="wsteps"><li>Open RIDEFRAME on the watch.</li><li>Enter the code with UP, DOWN and START.</li><li>Done. Sets from the watch land here.</li></ol>`
        : '<p class="phint">The code has expired. Tap New code.</p>'}</div>` : ''}
      ${msg ? `<p class="phint${/✓/.test(msg) ? '' : ' perr'}">${esc(msg)}</p>` : ''}
      ${(list || []).map(w => `<div class="hrow wdev"><div><b>${esc(w.label)}</b><small>Paired ${day(w.created)} · used ${day(w.used || w.created)}</small></div><button class="btn ghost ksmall" data-wdel="${esc(w.id)}">Remove</button></div>`).join('')}`;
    box.querySelector('#wPair').onclick = newCode;
    box.querySelectorAll('[data-wdel]').forEach(b => b.onclick = async () => {
      if (!confirm('Remove this watch? It can no longer send sets until you pair it again.')) return;
      b.disabled = true; try { await api('devices/' + b.dataset.wdel, { method: 'DELETE' }); msg = ''; } catch (e) { msg = e.message; } await load(); });
  };
  const load = async () => { try { list = (await api('devices')).watches; } catch (e) { list = []; msg = e.status === 401 ? 'Sign in again to pair a watch.' : e.message; } draw(); };
  const newCode = async () => {
    msg = ''; try { code = await api('code', { method: 'POST' }); } catch (e) { code = null; msg = e.message; } draw(); watch(); };
  const watch = () => { // the countdown, and a look every 3 s whether the watch has paired
    clearInterval(timer); clearInterval(poll); if (!code) return; const n = (list || []).length;
    timer = setInterval(() => { const l = box.querySelector('#wLeft'); if (!code) return; if (left() <= 0) { clearInterval(timer); clearInterval(poll); draw(); } else if (l) l.textContent = mmss(left()); }, 1000);
    poll = setInterval(async () => { if (!box.isConnected) { clearInterval(timer); clearInterval(poll); return; }
      try { const w = (await api('devices')).watches; if (w.length > n || (w[0] && w[0].created > Date.now() - 15e3)) { list = w; code = null; msg = 'Watch paired ✓'; clearInterval(timer); clearInterval(poll); draw(); } } catch {} }, 3000);
  };
  draw(); load(); if (code) watch();
}
