// Settings → Devices → Claude connector (23.11.): a secret link that lets Claude (claude.ai → Settings → Connectors → Add custom
// connector) build watch workouts in this account. Server: tools/mcp-api.mjs (/api/account/mcp, the MCP endpoint /mcp/<token>).
// The full link is shown once, right after it is made; afterwards only its label and dates. Up to 3 links, each can be removed.
// 25.11.: the link also READS the account (activities, strength sessions, fitness, weight, the watch's recovery values, the profile
// numbers) so Claude can coach; the row says so plainly, and links made before that get a one-time notice (POST /api/account/mcp/seen).
import { account } from './account.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let fresh = null, list = null, max = 3, msg = '', notice = false;
export const READS = 'Claude can read your activities (all sports), strength sessions, fitness and form, weight and the recovery values from your watch, and your FTP and heart-rate settings. It can change only your watch workouts. Never your e-mail or password.'; // kept here, so a redraw of the settings sheet keeps the new link on screen

async function api(path, opt = {}) { // own fetch: a 401 here must not sign the phone out (account.js does that)
  const r = await fetch('/api/account/' + path, { cache: 'no-store', ...opt, headers: { 'Content-Type': 'application/json', 'X-RF-Token': account()?.token || '' } });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server is not answering.'), { status: r.status }); return j;
}
const day = t => { const d = Math.floor((Date.now() - t) / 864e5); return d < 1 ? 'today' : d < 2 ? 'yesterday' : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const local = () => !/^https:/.test(location.origin) || /^https?:\/\/(localhost|127\.|\[::1\])/.test(location.origin);

/** fills box (inside the settings sheet); signed out it stays empty (the Garmin watch row above asks to sign in) */
export function mcpRow(box) {
  if (!box) return;
  if (!account()) { box.innerHTML = ''; return; }
  const draw = () => {
    if (!box.isConnected) return;
    const n = (list || []).length, full = n >= max;
    box.innerHTML = `<div class="hrow wrow mrow"><div><b>Claude connector</b><small>Plan watch workouts in Claude</small></div><button class="btn ghost ksmall" id="mNew" ${full || list === null ? 'disabled' : ''}>Create link</button></div>
      ${notice && !fresh ? `<div class="wpair mnote" role="status" id="mNote"><p class="mlead">This link can now also read activities, weight and recovery.</p><p class="phint">${READS}</p><button class="btn ghost ksmall" id="mSeen">Got it</button></div>` : ''}
      ${fresh ? `<div class="wpair mnew" role="status"><p class="mlead">Your connector link. It is shown only now:</p>
        <div class="murl"><input id="mUrl" readonly value="${esc(fresh)}" aria-label="Connector link" spellcheck="false"><button class="btn ksmall" id="mCopy">Copy</button></div>
        <ol class="wsteps"><li>In Claude: Settings → Connectors → Add custom connector.</li><li>Paste the link, give it a name (e.g. RIDEFRAME) and add it.</li><li>Ask Claude: “Look at my last two weeks and make me a push workout with 4 exercises.” The watch gets it at its next sync.</li></ol>
        <p class="phint mreads">${READS}</p>
        <p class="phint mwarn">Keep the link secret: anyone who has it can read this data and change your watch workouts. Remove it here to switch it off.</p>
        ${local() ? '<p class="phint perr">This page is not opened via its public https address, so Claude cannot reach this link. Open RIDEFRAME through its public link and create the link there.</p>' : ''}
        <button class="btn ghost ksmall" id="mHide">Done</button></div>` : ''}
      ${msg ? `<p class="phint${/✓/.test(msg) ? '' : ' perr'}" id="mMsg">${esc(msg)}</p>` : ''}
      ${full && !fresh ? `<p class="phint mfull">Up to ${max} links. Remove one to create a new one.</p>` : ''}
      ${(list || []).length && !fresh && !notice ? `<p class="phint mreads">${READS}</p>` : ''}
      ${(list || []).map(l => `<div class="hrow wdev mdev"><div><b>${esc(l.label)} link</b><small>Created ${day(l.created)} · ${l.used ? 'used ' + day(l.used) : 'not used yet'}</small></div><button class="btn ghost ksmall" data-mdel="${esc(l.id)}">Remove</button></div>`).join('')}`;
    box.querySelector('#mNew').onclick = create;
    const c = box.querySelector('#mCopy'); if (c) c.onclick = copy;
    const h = box.querySelector('#mHide'); if (h) h.onclick = () => { fresh = null; msg = ''; draw(); };
    const sn = box.querySelector('#mSeen'); if (sn) sn.onclick = async () => { notice = false; draw(); api('mcp/seen', { method: 'POST', body: '{}' }).catch(() => {}); };
    box.querySelectorAll('[data-mdel]').forEach(b => b.onclick = async () => {
      if (!confirm('Remove this link? Claude can no longer read your data or change your workouts with it.')) return;
      b.disabled = true; try { await api('mcp/' + b.dataset.mdel, { method: 'DELETE' }); msg = ''; fresh = null; } catch (e) { msg = e.message; } await load(); });
  };
  const load = async () => { try { const j = await api('mcp'); list = j.links; max = j.max || 3; notice = !!j.notice; } catch (e) { list = []; msg = e.status === 401 ? 'Sign in again to manage Claude links.' : e.message; } draw(); };
  const create = async () => {
    msg = ''; try { const j = await api('mcp', { method: 'POST', body: '{}' }); fresh = location.origin + j.path; } catch (e) { msg = e.message; } await load(); };
  const copy = async () => {
    const i = box.querySelector('#mUrl'); let ok = false;
    try { await navigator.clipboard.writeText(fresh); ok = true; } catch { try { i.select(); ok = document.execCommand('copy'); } catch {} }
    msg = ok ? 'Copied ✓' : 'Copy did not work: select the link and copy it by hand.'; draw();
  };
  draw(); load();
}
