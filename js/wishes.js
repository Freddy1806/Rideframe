// Wish list ("Wunschliste"): every player on the host writes wishes for RIDEFRAME, others +1 them,
// Freddy sets a status (neu / geplant / in Arbeit / umgesetzt / nicht geplant). Stored on the host (tools/accounts-api.mjs).
import { account, accountModal, wishApi } from './account.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const day = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric' });

export async function wishModal(state, onAccount) {
  if (!account()) { await accountModal(state, onAccount); if (!account()) return; }
  const m = document.createElement('div'); m.className = 'modal wishes';
  m.innerHTML = `<div class="box"><div class="label">For all riders</div><h2 class="display">Wish list</h2>
    <p>What else should RIDEFRAME be able to do? Write down your wish and give the others' wishes a +1. Then we decide together what gets built.</p>
    <div class="wish-new"><textarea id="wText" maxlength="500" rows="2" placeholder="My wish …"></textarea><button class="btn" id="wAdd">Add</button></div>
    <p id="wErr" style="color:var(--accent);min-height:18px;margin:6px 0 0"></p>
    <div id="wList" class="wish-list"><p class="dim">Loading …</p></div>
    <div class="actions"><button class="btn" id="wOk">Done</button></div></div>`;
  document.body.append(m);
  const $ = s => m.querySelector(s), err = t => { $('#wErr').textContent = t || ''; };
  const close = () => m.remove();
  $('#wOk').onclick = close; m.addEventListener('click', e => { if (e.target === m) close(); });
  const draw = j => {
    if (!j.list.length) { $('#wList').innerHTML = '<p class="dim">No wishes yet. Go first!</p>'; return; }
    $('#wList').innerHTML = j.list.map(w => `<div class="wish ${w.status === 'umgesetzt' ? 'done' : ''}" data-id="${w.id}">
      <button class="wvote ${w.voted ? 'on' : ''}" title="+1">▲<b>${w.votes}</b></button>
      <div class="wbody"><div class="wtext">${esc(w.text)}</div>
        <div class="wmeta">${esc(w.by)} · ${day(w.at)} · ${j.admin
          ? `<select class="wstat">${j.status.map(s => `<option ${s === w.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`
          : `<span class="wpill s-${w.status.replace(/\s/g, '')}">${esc(w.status)}</span>`}${w.mine || j.admin ? ' · <button class="wdel">delete</button>' : ''}</div>
        ${w.note ? `<div class="wnote">${esc(w.note)}</div>` : ''}</div></div>`).join('');
    m.querySelectorAll('.wish').forEach(el => { const id = el.dataset.id;
      el.querySelector('.wvote').onclick = () => run(() => wishApi.vote(id));
      const d = el.querySelector('.wdel'); if (d) d.onclick = () => confirm('Delete wish?') && run(() => wishApi.del(id));
      const s = el.querySelector('.wstat'); if (s) s.onchange = () => run(() => wishApi.set(id, s.value)); });
  };
  const run = async f => { try { err(); draw(await f()); } catch (e) { err(e.message); } };
  $('#wAdd').onclick = async () => { const t = $('#wText').value.trim(); if (t.length < 3) return err('Please enter a wish.');
    $('#wAdd').disabled = true; await run(() => wishApi.add(t)); $('#wAdd').disabled = false; if (!$('#wErr').textContent) $('#wText').value = ''; };
  $('#wText').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#wAdd').click(); } };
  run(() => wishApi.list());
}
