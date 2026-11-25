// RIDEFRAME Remote (remote.html): the phone as a remote control for the desktop app (owner 21.11.). Pair with the 6-digit
// code from the computer (Settings → Trainer → Phone remote, or the QR code), or, signed in on both, one tap on the computer.
// The phone is a gamepad for the desktop (js/remotepad.js turns the events into a virtual pad): D-pad, A, B, L / R in the
// menus and the pause menu, in a ride big target-watt keys, pause, music, next song, view, display, interval display.
// The computer's status (menu / ride / paused, step, target, watts) comes back on its own stream (tools/remote-api.mjs).
// Keeps the screen on while connected, reconnects by itself after the phone was locked, haptic ticks where the phone can.
import { listen, post } from './remotelink.js';

const $ = s => document.querySelector(s), root = $('#rm');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TK = 'rf-remote-tok';
const acc = (() => { try { return JSON.parse(localStorage.getItem('rf_account') || 'null'); } catch { return null; } })();
let tok = null, label = '', link = null, st = null, stAt = 0, wake = null;
try { const v = JSON.parse(localStorage.getItem(TK) || 'null'); if (v?.tok) { tok = v.tok; label = v.label || ''; } } catch {}
const buzz = (ms = 10) => { try { navigator.vibrate?.(ms); } catch {} };

// ---------------- the screen ----------------
const B = { A: 0, B: 1, X: 2, Y: 3, L: 4, R: 5, L2: 6, R2: 7, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const ICON = {
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5v14l12-7z"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path d="M9 17V6l10-2v11" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="6.5" cy="17.5" r="2.8"/><circle cx="16.5" cy="15.5" r="2.8"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 5v14l10-7z"/><rect x="16" y="5" width="3" height="14" rx="1"/></svg>',
  view: '<svg viewBox="0 0 24 24"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3"/></svg>',
  hud: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="6" y="13" width="3" height="4"/><rect x="10.5" y="10" width="3" height="7"/><rect x="15" y="7" width="3" height="10"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><path d="M4 7h3.5l1.5-2h6l1.5 2H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="3.6"/></svg>',
  lap: '<svg viewBox="0 0 24 24"><path d="M6 3v18" stroke="currentColor" stroke-width="2.2" fill="none"/><path d="M7 4h11l-3 4 3 4H7z"/></svg>',
  bars: '<svg viewBox="0 0 24 24"><rect x="3" y="14" width="4" height="6"/><rect x="8" y="9" width="4" height="11"/><rect x="13" y="12" width="4" height="8"/><rect x="18" y="6" width="3" height="14"/></svg>',
};
const arrow = r => `<svg viewBox="0 0 24 24" style="transform:rotate(${r}deg)"><path d="M12 6l7 9H5z"/></svg>`;
function shell() {
  root.innerHTML = `
  <header class="rtop"><a class="rback" href="handy.html" aria-label="Back to the app">‹</a><div class="rbrand">RIDE<span>FRAME</span><small>Remote</small></div>
    <span class="rpill" id="rConn"><i></i><b>Offline</b></span><button class="rx" id="rLeave" hidden aria-label="Disconnect">✕</button></header>
  <section class="rjoin" id="rJoin">
    <h1 class="display">Phone<br><span>remote</span></h1>
    <p class="rlead">Control RIDEFRAME on your computer from here: menus, the ride, watts, music.</p>
    <div id="rMine"></div>
    <form class="rcode glass" id="rForm" autocomplete="off">
      <label class="label" for="rCode">Code from the computer</label>
      <input id="rCode" inputmode="numeric" pattern="[0-9 ]*" maxlength="7" placeholder="000 000" autocomplete="one-time-code" aria-label="6-digit code">
      <button class="btn rgo" id="rGo" type="submit">Connect</button>
      <p class="rerr" id="rErr" role="alert"></p>
    </form>
    <p class="rhow">On the computer: <b>Settings → Trainer → Phone remote</b> shows the code and a QR code. In a ride: pause → Options → Phone remote.</p>
  </section>
  <section class="rpad" id="rPad" hidden>
    <div class="rstat glass" id="rStat">
      <div class="rsrc label" id="rSrc"></div>
      <div id="rCtx"></div>
    </div>
    <div class="rride" id="rRide" hidden>
      <div class="rmode" id="rMode" role="group" aria-label="Mode">
        <button class="rm" data-cmd="mode:erg" data-m="erg">ERG</button><button class="rm" data-cmd="mode:real" data-m="real">Shift on bike</button><button class="rm" data-cmd="mode:virtual" data-m="virtual">Virtual gears</button></div>
      <div class="rwatts" id="rWatts">
        <button class="rk" data-hold="${B.L}" aria-label="Target minus 5 watts">−5</button><button class="rk" data-hold="${B.L2}" aria-label="Target minus 1 watt">−1</button>
        <button class="rk" data-hold="${B.R2}" aria-label="Target plus 1 watt">+1</button><button class="rk" data-hold="${B.R}" aria-label="Target plus 5 watts">+5</button></div>
      <div class="rgears" id="rGears"><button class="rk" data-hold="${B.L}">Gear easier</button><button class="rk" data-hold="${B.R}">Gear harder</button></div>
      <div class="rgears rturn" id="rTurn"><button class="rk" data-cmd="turn:left">◀ Turn left</button><button class="rk" data-cmd="turn:right">Turn right ▶</button></div>
      <p class="rbike" id="rBike">You shift on your bike. The trainer follows the road.</p>
      <div class="rcmds">
        <button class="rc" data-cmd="pause">${ICON.pause}<span>Pause</span></button>
        <button class="rc" data-cmd="lap">${ICON.lap}<span>Lap</span></button>
        <button class="rc" data-cmd="photo">${ICON.photo}<span>Photo</span></button>
        <button class="rc" data-cmd="view">${ICON.view}<span>View</span></button>
        <button class="rc" data-cmd="hud">${ICON.hud}<span>Display</span></button>
        <button class="rc" data-cmd="music" id="rMusic">${ICON.music}<span>Music</span></button>
        <button class="rc" data-cmd="next">${ICON.next}<span>Next song</span></button>
        <button class="rc" data-cmd="wbview" id="rWb">${ICON.bars}<span>Intervals</span></button>
        <button class="rc rwnext" data-cmd="wnext" id="rWNext">${ICON.next}<span>Next step</span></button>
      </div>
    </div>
    <div class="rnav" id="rNav">
      <div class="rbump"><button class="rb" data-hold="${B.L}" aria-label="L, previous tab">L</button><span class="rhint" id="rHint">D-pad · A select · B back</span><button class="rb" data-hold="${B.R}" aria-label="R, next tab">R</button></div>
      <div class="rpadrow">
        <div class="rdpad" role="group" aria-label="D-pad">
          <button class="rd up" data-hold="${B.UP}" data-rep="1" aria-label="Up">${arrow(0)}</button>
          <button class="rd left" data-hold="${B.LEFT}" data-rep="1" aria-label="Left">${arrow(-90)}</button>
          <i class="rdc"></i>
          <button class="rd right" data-hold="${B.RIGHT}" data-rep="1" aria-label="Right">${arrow(90)}</button>
          <button class="rd down" data-hold="${B.DOWN}" data-rep="1" aria-label="Down">${arrow(180)}</button>
        </div>
        <div class="rab"><button class="rbtn b" data-hold="${B.B}" aria-label="B, back">B</button><button class="rbtn a" data-hold="${B.A}" aria-label="A, select">A</button></div>
      </div>
      <button class="btn rresume" id="rResume" data-tap="${B.START}" hidden>${ICON.play}<span>Resume</span></button>
    </div>
  </section>`;
  $('#rForm').onsubmit = e => { e.preventDefault(); joinCode($('#rCode').value); };
  $('#rCode').oninput = e => { const d = e.target.value.replace(/\D/g, '').slice(0, 6); e.target.value = d.length > 3 ? d.slice(0, 3) + ' ' + d.slice(3) : d; $('#rErr').textContent = ''; if (d.length === 6) joinCode(d); };
  $('#rLeave').onclick = () => leave(true);
  wire();
}

// ---------------- sending: in order, a few at a time ----------------
const out = []; let sending = false;
function send(ev) { if (!tok) return; if (out.length > 40) out.splice(0, out.length - 40); out.push(ev); pump(); }
async function pump() {
  if (sending) return; sending = true;
  while (out.length && tok) {
    const evs = out.splice(0, 8), t0 = performance.now();
    try { await post('send', { tok, evs }); window.__rmLast = performance.now() - t0; }
    catch (e) { if (e.status === 404) { gone('The computer ended the remote. Enter a new code.'); break; } if (e.status === 429) await new Promise(r => setTimeout(r, 300)); else { conn('retry'); await new Promise(r => setTimeout(r, 600)); out.unshift(...evs.filter(x => x.t === 'btn' && !x.down)); } } // never leave a button held
  }
  sending = false;
}
const down = i => send({ t: 'btn', i, down: true }), up = i => send({ t: 'btn', i, down: false });
const tap = i => { down(i); up(i); };
const cmd = name => send({ t: 'cmd', name });

/** buttons: press = down, release = up; the D-pad and the watt keys repeat while held (as real down / up), a long hold
 *  is refreshed every second so the computer knows it is still held */
function wire() {
  root.querySelectorAll('[data-hold]').forEach(el => {
    const i = +el.dataset.hold, rep = el.dataset.rep || el.classList.contains('rk'); let t1 = 0, t2 = 0, on = false;
    const start = e => { e.preventDefault(); if (on) return; on = true; try { el.setPointerCapture?.(e.pointerId); } catch {} el.classList.add('on'); buzz(12); down(i);
      if (rep) t1 = setTimeout(() => { t2 = setInterval(() => { up(i); down(i); buzz(6); }, 140); }, 420);
      else t2 = setInterval(() => down(i), 1000); };
    const end = () => { if (!on) return; on = false; clearTimeout(t1); clearInterval(t2); el.classList.remove('on'); up(i); };
    el.addEventListener('pointerdown', start); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); buzz(); tap(i); } });
  });
  root.querySelectorAll('[data-cmd]').forEach(el => el.onclick = () => { buzz(14); cmd(el.dataset.cmd); el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 160); });
  root.querySelectorAll('[data-tap]').forEach(el => el.onclick = () => { buzz(14); tap(+el.dataset.tap); });
}

// ---------------- what the computer shows ----------------
const n0 = v => v && v !== '–' ? esc(v) : '–';
function render() {
  const s = st || {}, scr = s.scr || 'wait', ride = scr === 'ride', paused = scr === 'paused';
  root.dataset.scr = scr;
  $('#rSrc').textContent = label ? `Connected to ${label}` : 'Connected';
  $('#rRide').hidden = !ride; $('#rNav').hidden = ride;
  $('#rResume').hidden = !paused;
  const mode = s.wo ? 'work' : s.mode || 'real', watts = mode === 'work' || mode === 'erg'; // quick setup (owner 19.11.): the mode with one tap, the keys follow it
  $('#rMode').hidden = !!s.wo; $('#rMode').querySelectorAll('.rm').forEach(b => { const on = b.dataset.m === mode; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on); });
  $('#rWatts').hidden = !watts; $('#rGears').hidden = mode !== 'virtual'; $('#rBike').hidden = mode !== 'real'; $('#rWb').hidden = !s.wo; $('#rWNext').hidden = !s.wo; // a workout: the lap button of a bike computer, ends the step running now
  const mu = $('#rMusic'); mu.classList.toggle('off', s.music === false); mu.querySelector('span').textContent = s.music === false ? 'Music off' : 'Music';
  $('#rHint').textContent = paused ? 'D-pad · A ok · B back' : 'D-pad · A select · B back';
  const c = $('#rCtx'), age = Date.now() - stAt;
  if (!st || age > 9000) { c.innerHTML = `<div class="rtitle display">${st ? 'Computer<br>not answering' : 'Waiting for<br>the computer'}</div><p class="rsub">Keep RIDEFRAME open on the computer.</p>`; return; }
  if (ride && s.wo) {
    c.innerHTML = `<div class="rstep"><b>${esc(s.step || '–')}</b>${s.of ? `<span>${esc(s.of)}</span>` : ''}</div>
      <div class="rtgt"><b class="num" id="rTgt">${n0(s.tgt)}</b><small>W target</small>${s.adj && s.adj !== '±0 W' ? `<em>${esc(s.adj)}</em>` : ''}</div>
      <div class="rrow"><span><small>Now</small><b class="num">${n0(s.pow)}<i> W</i></b></span><span><small>Left</small><b class="num">${n0(s.left)}</b></span><span><small>Next</small><b>${esc(s.next || '–')}</b></span></div>`;
  } else if (ride) {
    const erg = s.mode === 'erg';
    c.innerHTML = `<div class="rstep"><b>Riding</b><span>${erg ? 'ERG' : s.mode === 'virtual' ? 'virtual gears' : 'free ride'}</span></div>
      <div class="rtgt"><b class="num" id="rTgt">${n0(erg ? s.tgt : s.pow)}</b><small>${erg ? 'W target' : 'W'}</small></div>
      <div class="rrow">${erg ? `<span><small>Now</small><b class="num">${n0(s.pow)}<i> W</i></b></span>` : ''}<span><small>Speed</small><b class="num">${n0(s.spd)}<i> km/h</i></b></span>${s.mode === 'virtual' ? `<span><small>Gear</small><b class="num">${n0(s.gear)}</b></span>` : ''}</div>`;
  } else if (paused) {
    const items = Array.isArray(s.menu) ? s.menu : [];
    c.innerHTML = `<div class="rtitle display">${esc(s.title || 'Pause')}</div>${s.wo ? `<p class="rsub">${esc(s.step)} · ${n0(s.tgt)} W</p>` : ''}
      <div class="rmenu">${items.map((t, k) => `<button class="rmi${k === s.sel ? ' on' : ''}" data-k="${k}">${esc(t)}</button>`).join('')}</div>`;
    c.querySelectorAll('.rmi').forEach(b => b.onclick = () => { // jump there with the D-pad, then A: the same path a pad takes
      const k = +b.dataset.k, d = k - (s.sel || 0); buzz(14);
      for (let j = 0; j < Math.abs(d); j++) tap(d > 0 ? B.DOWN : B.UP);
      tap(B.A); });
  } else {
    const fin = scr === 'finished';
    c.innerHTML = `<div class="rtitle display">${fin ? 'Ride<br>finished' : esc(s.win || s.tab || 'Menu')}</div>
      <p class="rsub">${s.foc ? `Focus: <b>${esc(s.foc)}</b>` : 'Press the D-pad to show the focus'}</p>
      <div class="rchips"><span>D-pad move</span><span>A select</span><span>B back</span>${fin ? '' : '<span>L / R tabs</span>'}</div>`;
  }
}

// ---------------- connecting ----------------
function conn(state) {
  const p = $('#rConn'); if (!p) return;
  p.className = 'rpill ' + (state === 'live' ? 'on' : state === 'retry' ? 'retry' : '');
  p.querySelector('b').textContent = state === 'live' ? 'Live' : state === 'retry' ? 'Reconnecting' : 'Offline';
}
function show(connected) {
  $('#rJoin').hidden = connected; $('#rPad').hidden = !connected; $('#rLeave').hidden = !connected; root.classList.toggle('connected', connected);
  if (connected) { render(); keepAwake(); } else { conn(''); wake?.release?.().catch(() => {}); wake = null; mine(); }
}
function connect() {
  link?.close(); show(true);
  link = listen('tok=' + encodeURIComponent(tok), (t, d) => {
    if (t === 'hello' && d.label) { label = d.label; store(); }
    if (t === 'status') { st = d.s || null; stAt = Date.now(); render(); }
  }, s => { if (s === 'gone') gone('The computer ended the remote. Enter a new code.'); else conn(s); });
}
const store = () => { try { tok ? localStorage.setItem(TK, JSON.stringify({ tok, label })) : localStorage.removeItem(TK); } catch {} };
async function joined(j) { tok = j.tok; label = j.label || ''; st = j.status || null; stAt = st ? Date.now() : 0; store(); buzz(30); connect(); }
async function joinCode(v) {
  const code = String(v).replace(/\D/g, ''); const err = $('#rErr');
  if (code.length !== 6) { err.textContent = 'The code has 6 digits.'; return; }
  $('#rGo').disabled = true; err.textContent = '';
  try { await joined(await post('join', { code })); $('#rCode').value = ''; }
  catch (e) { err.textContent = e.message || 'Could not connect.'; buzz(60); }
  finally { $('#rGo').disabled = false; }
}
async function joinId(id) {
  try { await joined(await post('join', { id, $token: acc?.token })); }
  catch (e) { $('#rErr').textContent = e.message || 'Could not connect.'; mine(); }
}
/** signed in: this account's open computers, one tap each */
async function mine() {
  const box = $('#rMine'); if (!box) return; box.innerHTML = '';
  if (!acc?.token) return;
  try {
    const r = await fetch('/api/remote/mine', { cache: 'no-store', headers: { 'X-RF-Token': acc.token } }); if (!r.ok) return;
    const { desks = [] } = await r.json(); if (!desks.length || tok) return;
    // from the phone app's "Remote" row (remote.html?auto, owner 18.11.: "as simple as possible"): one open computer connects by itself, once
    if (desks.length === 1 && /[?&]auto\b/.test(location.search) && !mine.tried) { mine.tried = true; joinId(desks[0].id); return; }
    box.innerHTML = `<div class="label rminel">Your computers</div>${desks.map(d => `<button class="rdesk glass" data-id="${esc(d.id)}"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M1 19h22" stroke="currentColor" stroke-width="2"/></svg><span><b>${esc(d.label)}</b><small>RIDEFRAME is open · tap to connect</small></span></button>`).join('')}`;
    box.querySelectorAll('.rdesk').forEach(b => b.onclick = () => { buzz(14); joinId(b.dataset.id); });
  } catch {}
}
function gone(msg) { link?.close(); link = null; tok = null; st = null; store(); show(false); out.length = 0; if (msg) $('#rErr').textContent = msg; }
async function leave(user) { const t = tok; gone(''); if (t && user) post('leave', { tok: t }).catch(() => {}); }
async function keepAwake() { // the screen stays on while connected (where the browser can)
  if (!tok || document.visibilityState !== 'visible' || wake) return;
  try { wake = await navigator.wakeLock?.request('screen'); wake?.addEventListener?.('release', () => { wake = null; }); } catch { wake = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && tok) { link?.kick(); keepAwake(); mine(); } });
addEventListener('pageshow', e => { if (e.persisted && tok) link?.kick(); });
setInterval(() => { if (tok && st && Date.now() - stAt > 9000) render(); }, 3000); // "not answering" after a while without news

shell();
const hash = new URLSearchParams(location.hash.slice(1)).get('c');
if (hash && /^\d{6}$/.test(hash)) { history.replaceState(null, '', location.pathname); if (tok) await leave(true); joinCode(hash); } // the QR code: straight in
else if (tok) connect(); else show(false);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
globalThis.__rm = { get tok() { return tok; }, get st() { return st; }, send }; // for tools/remote-ui.cjs
