// The shop page (owner 19.11.): your balance on top, the items by slot as cards (Buy / Not enough points / Wear / Take off),
// a live 3D preview of your rider wearing the highlighted item, so you can try before you buy. A modal like the rider
// editor: game controller via js/padnav.js (D-pad, A select, B = Close), phone portrait in one column. Rules: js/shop.js.
import { state, saveSettings, toast } from './app.js';
import { CATALOG, SLOTS, itemById, itemState, buy, equip, unequip, ownedLook } from './shop.js';
import { loadLedger, saveLedger } from './story.js';
import { balanceOf, fmtWp } from './wizpoints.js';
import { cleanLook, DEFAULT_LOOK } from './look.js';
import { currentGroup } from './share.js';
import { esc } from './util.js';

const ICON = { 'wizard-hat': '🧙', 'eagle-feather': '🪶', crown: '👑', 'star-jersey': '🌙', 'wizard-cloak': '✨', 'eagle-jersey': '🦅', 'knight-armour': '🛡️', 'wooden-bike': '🪵', 'glow-wheels': '💫', 'dragon-frame': '🐉', 'golden-bike': '🏆', 'wizard-gloves': '🧤' };

/** opens the shop; onClose() after it is closed (the result screen refreshes its balance) */
export async function shopModal({ onClose, focus } = {}) {
  const L = await loadLedger(), W = L.wp;
  let look = ownedLook(cleanLook(state.settings.look || DEFAULT_LOOK), W), tryId = focus || null, prev = null;
  const m = document.createElement('div'); m.className = 'modal shop-modal'; m.id = 'shopModal';
  m.innerHTML = `<div class="box shopbox">
    <div class="shophead"><div><div class="label">Spend your Wizard points</div><h2 class="display">Shop</h2></div>
      <div class="shopbal"><span class="label">Balance</span><b id="shBal"></b></div><button class="btn ghost small" id="shClose">Close</button></div>
    <div class="shopmain"><div class="shopprev"><canvas class="avcanvas" id="shCanvas"></canvas><div class="shopcap" id="shCap"></div></div>
      <div class="shoplist" id="shList"></div></div></div>`;
  document.body.append(m);
  const q = s => m.querySelector(s);
  import('./world/avatar.js').then(a => { if (!m.isConnected) return; prev = new a.AvatarPreview(q('#shCanvas')); prev.spin = 0.35; prev.fitFov = 32; prev.cam.position.set(2.7, 1.5, 2.5); prev.cam.lookAt(0, 0.92, 0); show(); }).catch(() => {});

  const trying = () => { const it = tryId && itemById(tryId); return it ? { ...look, [it.key]: it.value } : look; };
  const show = () => { prev?.set(trying()); const it = tryId && itemById(tryId);
    q('#shCap').innerHTML = it ? `${look[it.key] === it.value ? 'Wearing' : 'Trying on'} <b>${esc(it.name)}</b>` : 'Your rider'; };
  const btn = (it, st) => ({ buy: `<button class="btn small" data-buy="${it.id}">Buy · 🧙 ${fmtWp(it.price)}</button>`,
    short: `<button class="btn small" disabled data-short="${it.id}">Not enough points · ${fmtWp(st.missing)} missing</button>`,
    owned: `<button class="btn ghost small" data-wear="${it.id}">Wear</button>`,
    wearing: `<button class="btn ghost small on" data-off="${it.id}">Wearing · Take off</button>` })[st.state];
  const card = it => { const st = itemState(it, W, look);
    return `<div class="shopcard ${st.state} ${tryId === it.id ? 'try' : ''}" data-item="${it.id}" ${st.state === 'short' ? 'tabindex="0" role="button"' : ''}>
      <div class="shoptop"><span class="shopico" aria-hidden="true">${ICON[it.id] || '✦'}</span><div><b>${esc(it.name)}</b><span class="shopprice">${st.state === 'owned' || st.state === 'wearing' ? 'Owned' : `🧙 ${fmtWp(it.price)}`}</span></div></div>
      <p>${esc(it.desc)}</p>${btn(it, st)}</div>`; };
  const render = () => {
    q('#shBal').textContent = `🧙 ${fmtWp(balanceOf(W))}`;
    q('#shList').innerHTML = SLOTS.map(([s, n]) => `<section class="shopslot"><div class="label">${n}</div><div class="shopgrid">${CATALOG.filter(i => i.slot === s).map(card).join('')}</div></section>`).join('');
  };
  const persist = async () => { // the look (only owned items) to the settings and the group, the wallet to the ledger
    look = ownedLook(look, W); state.settings.look = look; await saveSettings(); saveLedger(L);
    const g = currentGroup(); if (g) g.setLook(look);
  };
  const pick = id => { if (id && id !== tryId) { tryId = id; m.querySelectorAll('.shopcard').forEach(c => c.classList.toggle('try', c.dataset.item === id)); show(); } };
  m.addEventListener('focusin', e => pick(e.target.closest?.('.shopcard')?.dataset.item));
  m.addEventListener('pointerover', e => { if (e.pointerType === 'mouse') pick(e.target.closest?.('.shopcard')?.dataset.item); });
  m.addEventListener('click', async e => {
    if (e.target === m) return close();
    const b = e.target.closest('button'), c = e.target.closest('.shopcard');
    if (c && !b) return pick(c.dataset.item);
    if (!b) return;
    if (b.dataset.buy) { const it = itemById(b.dataset.buy); pick(it.id);
      if (!(await confirmBuy(it))) return b.isConnected && b.focus();
      const r = buy(W, it.id); if (!r.ok) { toast(r.error === 'short' ? `Not enough points: ${fmtWp(r.missing)} missing` : 'Already yours', 3000); render(); return; }
      look = equip(look, W, it.id); await persist(); render(); show(); toast(`${it.name} is yours. You are wearing it.`, 3200);
      m.querySelector(`[data-off="${it.id}"]`)?.focus(); }
    else if (b.dataset.wear) { const it = itemById(b.dataset.wear); look = equip(look, W, it.id); tryId = it.id; await persist(); render(); show(); m.querySelector(`[data-off="${it.id}"]`)?.focus(); }
    else if (b.dataset.off) { const it = itemById(b.dataset.off); look = unequip(look, it.id); tryId = it.id; await persist(); render(); show(); m.querySelector(`[data-wear="${it.id}"]`)?.focus(); }
  });
  const close = () => { prev?.destroy(); m.remove(); onClose?.(); };
  q('#shClose').onclick = close;
  render(); show();
  if (focus) m.querySelector(`[data-item="${focus}"]`)?.scrollIntoView({ block: 'center' });
}

/** "Buy Wizard hat for 500 points?" once; resolves true on Buy */
function confirmBuy(it) {
  return new Promise(done => {
    const c = document.createElement('div'); c.className = 'modal'; c.id = 'shopConfirm'; c.style.zIndex = 60;
    c.innerHTML = `<div class="box" style="max-width:440px"><div class="label">Shop</div><h2 class="display" style="font-size:28px;margin:8px 0 10px">${ICON[it.id] || ''} ${esc(it.name)}</h2>
      <p id="shConfText">Buy ${esc(it.name)} for ${fmtWp(it.price)} points?</p>
      <div class="actions"><button class="btn ghost" id="shConfCancel">Cancel</button><button class="btn" id="shConfBuy">Buy</button></div></div>`;
    document.body.append(c);
    const end = v => { c.remove(); done(v); };
    c.querySelector('#shConfCancel').onclick = () => end(false); c.querySelector('#shConfBuy').onclick = () => end(true);
    c.onclick = e => { if (e.target === c) end(false); };
    c.querySelector('#shConfBuy').focus();
  });
}

/** label for a "Shop" button: "🧙 1 240" (the balance, also under the ?wp test hook) */
export async function shopLabel() { const L = await loadLedger().catch(() => null); return `🧙 ${fmtWp(balanceOf(L?.wp))}`; }
