// The household scale in the settings (25.11.): set up a household, add the scale the bridge on the Mac mini hears, invite a flatmate
// with a 6-digit code (10 minutes, once), join with a code, bridge status (last heard, last weigh-in, battery). Server: tools/body-api.mjs.
// Members only ever see their own weigh-ins; a weigh-in that is not clearly one person's is asked to everyone ("Was that you?").
import { account } from './account.js';
import { api } from './bodycard.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = t => { if (!t) return 'never'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
let code = null, timer = 0;
const left = () => Math.max(0, Math.ceil((code.exp - Date.now()) / 1000)), mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** fills box with the scale section; signIn() opens the account dialog */
export function scaleSection(box, { signIn } = {}) {
  if (!box) return; clearInterval(timer);
  if (!account()) { box.innerHTML = `<div class="hrow"><div><b>Bathroom scale</b><small>Sign in to connect a scale</small></div>${signIn ? '<button class="btn ghost ksmall" id="scIn">Sign in</button>' : ''}</div>`; box.querySelector('#scIn')?.addEventListener('click', signIn); return; }
  let v = null, msg = '', joining = false;
  const draw = () => {
    if (!box.isConnected) { clearInterval(timer); return; }
    const h = v?.household, br = v?.bridge;
    const bridge = br ? `<p class="phint scbr"><i class="${br.online ? 'on' : ''}"></i>${br.online ? `Bridge on the Mac mini online · heard ${ago(br.lastSeen)}` : br.lastSeen ? `Bridge offline · last heard ${ago(br.lastSeen)}` : 'Bridge not running yet: it runs next to the server (tools/scale-bridge).'}</p>` : '';
    const found = (v?.found || []).map(f => `<div class="hrow scrow"><div><b>${esc(f.name)}</b><small>eufy ${esc(f.model)} · heard ${ago(f.lastSeen)}${f.rssi ? ` · signal ${f.rssi} dBm` : ''}</small></div>${h?.owner ? `<button class="btn ksmall" data-add="${esc(f.key)}">Add</button>` : ''}</div>`).join('');
    let html;
    if (!v) html = '<p class="phint">Loading …</p>';
    else if (!h) html = `<p class="phint">A scale belongs to a household: you add it here, flatmates join with a code. Everyone only sees their own weigh-ins.</p>
      <div class="scbtns"><button class="btn" id="scNew">Set up the scale</button><button class="btn ghost" id="scJoin">Join with a code</button></div>
      ${joining ? `<div class="scjoin"><label for="scCode">6-digit code</label><div class="murl"><input id="scCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456"><button class="btn ksmall" id="scGo">Join</button></div></div>` : ''}`;
    else html = `<div class="hrow"><div><b>${esc(h.name)}</b><small>${h.members} ${h.members === 1 ? 'person' : 'people'} · ${h.owner ? 'you set it up' : 'you joined'}</small></div>${h.owner ? `<button class="btn ghost ksmall" id="scCodeBtn">${code ? 'New code' : 'Invite'}</button>` : ''}</div>
      ${code && h.owner ? `<div class="wpair" role="status">${left() > 0 ? `<div class="wcode" aria-label="Code ${code.code.split('').join(' ')}">${code.code.slice(0, 3)} ${code.code.slice(3)}</div><div class="wleft">Valid for <b id="scLeft">${mmss(left())}</b></div>
        <ol class="wsteps"><li>Your flatmate opens RIDEFRAME, signed in with their own account.</li><li>Settings → Bathroom scale → Join with a code.</li><li>Done. Each of you only sees your own weigh-ins.</li></ol>` : '<p class="phint">The code has expired. Tap New code.</p>'}</div>` : ''}
      ${h.scales.map(s => `<div class="scscale"><div class="hrow"><div><b>${esc(s.name)}</b><small>eufy ${esc(s.model)} · heard ${ago(s.lastSeen)} · last weigh-in ${ago(s.lastAt)}${s.battery != null ? ` · battery ${s.battery} %` : ''}</small></div>${h.owner ? `<button class="btn ghost ksmall" data-del="${esc(s.id)}">Remove</button>` : ''}</div>
        ${s.biaOk && h.owner ? `<label class="prow scbia"><span><b>Impedance too</b><small>Connects to the scale after each weigh-in (needs bare feet). The eufy app on a phone may then not get that weigh-in.</small></span><input type="checkbox" class="toggle" data-bia="${esc(s.id)}" ${s.bia ? 'checked' : ''}></label>` : ''}</div>`).join('')}
      ${!h.scales.length ? `<p class="phint">${h.owner ? 'No scale yet. Step on it once (it wakes up and sends), then add it here.' : 'The person who set it up has not added a scale yet.'}</p>` : ''}
      ${found && h.owner ? `<h4 class="schead">Scales the bridge hears now</h4>${found}` : ''}`;
    box.innerHTML = `${html}${!h && found ? `<h4 class="schead">Scales the bridge hears now</h4>${found}<p class="phint">Set up the scale first, then add it.</p>` : ''}${bridge}${h ? '<button class="btn ghost ksmall scleave" id="scLeave">Leave household</button>' : ''}${msg ? `<p class="phint${/✓/.test(msg) ? '' : ' perr'}" role="status">${esc(msg)}</p>` : ''}`;
    const q = s => box.querySelector(s), act = async (fn, ok = '') => { msg = ''; try { const r = await fn(); if (r?.household !== undefined) v = r; msg = ok; } catch (e) { msg = e.message; } draw(); };
    q('#scNew')?.addEventListener('click', () => act(() => api('/api/scale/household', { method: 'POST', body: '{}' }), 'Household ready ✓ Step on the scale, then add it below.'));
    q('#scJoin')?.addEventListener('click', () => { joining = true; draw(); q('#scCode')?.focus(); });
    q('#scGo')?.addEventListener('click', () => act(async () => { const r = await api('/api/scale/join', { method: 'POST', body: JSON.stringify({ code: q('#scCode').value }) }); joining = false; return r; }, 'Joined ✓ Your weigh-ins land in your account.'));
    q('#scCodeBtn')?.addEventListener('click', async () => { msg = ''; try { code = await api('/api/scale/code', { method: 'POST', body: '{}' }); } catch (e) { code = null; msg = e.message; } draw(); tick(); });
    q('#scLeave')?.addEventListener('click', () => { if (confirm(h.owner && h.members > 1 ? 'Leave the household? The others keep the scale; your weigh-ins stay yours.' : 'Leave the household? Your weigh-ins stay in your account.')) act(() => api('/api/scale/leave', { method: 'POST', body: '{}' })); });
    box.querySelectorAll('[data-add]').forEach(b => b.onclick = () => act(() => api('/api/scale/add', { method: 'POST', body: JSON.stringify({ key: b.dataset.add }) }), 'Scale added ✓'));
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (confirm('Remove this scale? Its weigh-ins stay, new ones are no longer saved.')) act(() => api('/api/scale/scales/' + b.dataset.del, { method: 'DELETE' })); });
    box.querySelectorAll('[data-bia]').forEach(t => t.onchange = () => act(() => api('/api/scale/scales/' + t.dataset.bia, { method: 'PUT', body: JSON.stringify({ bia: t.checked }) })));
  };
  const tick = () => { clearInterval(timer); if (!code) return; timer = setInterval(() => { const l = box.querySelector('#scLeft'); if (!box.isConnected) return clearInterval(timer); if (left() <= 0) { clearInterval(timer); draw(); } else if (l) l.textContent = mmss(left()); }, 1000); };
  const load = async () => { try { v = await api('/api/scale'); } catch (e) { v = { household: null, found: [], bridge: null }; msg = e.message; } draw(); };
  draw(); load(); tick();
}
