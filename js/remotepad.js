// The phone remote on the desktop (owner 21.11.: "a remote control for our browser app, as an alternative to the gamepad").
// A phone (remote.html, js/remote.js) joins a session on our own server (tools/remote-api.mjs) and sends button down / up
// events; here they drive a VIRTUAL GAMEPAD that js/controller.js activePad() hands to the ride (js/ride.js _pollPad) and the
// menus (js/padnav.js) exactly like a real pad, so every pad action works from the phone. A few direct commands (music,
// next song, view, display, interval display) go to the ride's own keys; pause is the Start button.
// The desktop posts a small status (menu / ride / paused, step, target, watts) so the phone shows what is going on.
// Settings → Trainer → Phone remote shows the code (and a QR code); signed in on both devices with the same account the phone
// finds this computer without a code. A small phone pill in the top bar while a phone is connected.
import { listen, post } from './remotelink.js';
import { qrSvg } from './qr.js';
import { account, accountsAvailable } from './account.js';

// ---------------- the virtual pad ----------------
const N = 17, buttons = Array.from({ length: N }, () => ({ pressed: false, touched: false, value: 0 }));
const pad = { id: 'RIDEFRAME phone remote (STANDARD GAMEPAD)', index: 3, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons };
const queue = []; // [button, down, at] in the order they came
let frame = 0, chF = -9, chT = 0, raf = 0, phonesN = 0;
const downAt = new Array(N).fill(0), seenAt = new Array(N).fill(0);
const STALE = 1500, HOLD = 2500; // a press that waited longer (tab in the background) is dropped; a hold without refresh ends
/** the phone remote as a standard gamepad while a phone is connected (or a button still held), else null */
export function virtualPad() { return phonesN > 0 || buttons.some(b => b.pressed) ? pad : null; }
function feed(i, down) { if (queue.length > 80 && down) return; queue.push([i, down, performance.now()]); kick(); }
const tap = i => { feed(i, true); feed(i, false); };
function kick() { if (!raf) raf = requestAnimationFrame(step); }
/** one change every second frame at most, a press stays down 50 ms at least: every rAF reader (ride, menus) sees each press,
 *  even two taps of the same button right after another */
function step(now) {
  raf = 0; frame++;
  while (queue.length) {
    const [i, d, at] = queue[0], b = buttons[i];
    if (b.pressed === d) { queue.shift(); if (d) seenAt[i] = now; continue; } // a refresh of a held button, or an up for nothing
    if (d && now - at > STALE) { queue.shift(); continue; }
    if (frame - chF < 2 || now - chT < 25 || (!d && now - downAt[i] < 50)) break;
    queue.shift(); b.pressed = d; b.value = d ? 1 : 0; chF = frame; chT = now; pad.timestamp = now; if (d) seenAt[i] = downAt[i] = now;
    break;
  }
  buttons.forEach((b, i) => { if (b.pressed && now - seenAt[i] > HOLD && !queue.some(q => q[0] === i)) { b.pressed = false; b.value = 0; } }); // the phone went away mid-hold
  if (queue.length || buttons.some(b => b.pressed)) kick();
}
function releaseAll() { queue.length = 0; buttons.forEach(b => { b.pressed = false; b.value = 0; }); }

// ---------------- commands ----------------
const KEYS = { music: 'm', next: 'n', view: 'v', hud: 'i', wbview: 'l' }; // the ride's own keys (js/ride.js _key)
function rideOn() { const r = document.querySelector('.ride'); return !!r && !r.querySelector('.finish'); }
function command(name) {
  if (!rideOn()) return;
  if (name === 'pause') return tap(9); // Start: pause menu, again: resume
  const key = KEYS[name]; if (key) document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  else if (/^(mode:(erg|real|virtual)|photo|lap|turn:(left|right))$/.test(name)) document.dispatchEvent(new CustomEvent('rf-remote', { detail: { name } })); // the ride's own switch (js/ride.js _remote): ERG / bike / virtual gears, a photo
}

// ---------------- the session ----------------
const SS = 'rf-remote-sess';
let S = null, link = null, appState = null, tickT = 0, lastJson = '', lastPost = 0, inflight = false, opening = null, err = '', wantOpen = false;
const kind = () => { const u = navigator.userAgent; return /Macintosh|Mac OS/.test(u) ? 'Mac' : /Windows/.test(u) ? 'PC' : /CrOS/.test(u) ? 'Chromebook' : 'computer'; };
const labelOf = () => { const a = account(); return a?.name ? `${a.name}’s ${kind()}` : `RIDEFRAME on a ${kind()}`; };
const fmtCode = c => c ? c.slice(0, 3) + ' ' + c.slice(3) : '··· ···';
const save = () => { try { S ? sessionStorage.setItem(SS, JSON.stringify({ id: S.id, key: S.key })) : sessionStorage.removeItem(SS); } catch {} };

/** called once by js/app.js: keeps a session from before a reload, or opens one by itself when signed in (account discovery) */
export async function initRemote(state) {
  appState = state; pill();
  let old = null; try { old = JSON.parse(sessionStorage.getItem(SS) || 'null'); } catch {}
  if (old?.id && old?.key) { S = { id: old.id, key: old.key, code: null, exp: 0 }; start(); return; }
  if (autoOn() && await accountsAvailable().catch(() => false)) ensure().catch(() => {});
}
const autoOn = () => !!account() && appState?.settings?.remoteAuto !== false;
function ensure() {
  if (S) return Promise.resolve(S);
  return opening ||= post('open', { label: labelOf(), $token: account()?.token }).then(j => { S = { id: j.id, key: j.key, code: j.code, exp: j.exp }; err = ''; save(); start(); return S; })
    .catch(e => { err = e.status === 404 || e.status === 405 || !e.status ? 'The phone remote needs the RIDEFRAME server (where the app is hosted). It is not reachable from here.' : e.message; throw e; })
    .finally(() => { opening = null; ui(); });
}
async function newCode() {
  await ensure(); const j = await post('code', { id: S.id, key: S.key }); S.code = j.code; S.exp = j.exp; ui(); return S.code;
}
function start() {
  link?.close(); link = listen(`id=${encodeURIComponent(S.id)}&key=${encodeURIComponent(S.key)}`, (t, d) => {
    if (t === 'hello') phones(d.phones || 0);
    else if (t === 'ev') { if (d.t === 'btn') feed(d.i, d.down); else if (d.t === 'cmd') command(d.name); else if (d.t === 'phones') phones(d.c); }
  }, st => { if (st === 'gone') gone(); ui(); });
  clearInterval(tickT); tickT = setInterval(tick, 250); tick();
}
function gone() { // the server dropped the session (restart, 60 s without a sign of life): a new one when it was wanted
  link?.close(); link = null; clearInterval(tickT); S = null; save(); phones(0); lastJson = '';
  if (wantOpen || autoOn()) setTimeout(() => { if (!S) ensure().catch(() => {}); }, 1500);
}
/** ends the session: every phone is disconnected (a new code / session afterwards) */
export async function disconnectRemote() { const s = S; if (!s) return; link?.close(); link = null; clearInterval(tickT); S = null; save(); phones(0); await post('close', { id: s.id, key: s.key }).catch(() => {}); }
function phones(n) {
  const was = phonesN; phonesN = +n || 0; if (!phonesN) releaseAll();
  if (phonesN > was && S) { S.code = null; if (document.querySelector('#rmBox')) setTimeout(() => newCode().catch(() => {}), 400); } // the code was used: a fresh one for another phone
  pill(); ui();
}
function tick() {
  if (!S || inflight) return;
  const s = snapshot(), j = JSON.stringify(s), now = Date.now();
  if (j === lastJson && now - lastPost < 1500) return;
  inflight = true; lastJson = j; lastPost = now;
  post('status', { id: S.id, key: S.key, s }).then(r => { if (typeof r.phones === 'number' && r.phones !== phonesN) phones(r.phones); })
    .catch(e => { if (e.status === 404) gone(); }).finally(() => { inflight = false; });
}

// ---------------- what the phone shows: read from the screen, nothing in the ride has to tell it ----------------
const txt = (root, sel, n = 40) => (root?.querySelector(sel)?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, n);
function snapshot() {
  const ride = document.querySelector('.ride');
  if (!ride || ride.querySelector('.finish')) {
    const ms = [...document.querySelectorAll('.modal')].filter(m => m.getBoundingClientRect().width > 0), win = ms[ms.length - 1];
    const cur = globalThis.__padnav?.cur, foc = cur?.isConnected ? (cur.getAttribute('aria-label') || cur.title && !cur.textContent.trim() && cur.title || cur.querySelector?.('h3, .name, b')?.textContent || cur.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) : '';
    const tab = document.querySelector('.topbar .tab.active');
    return { scr: ride ? 'finished' : 'menu', tab: tab ? txt(tab, '.tl') || tab.textContent.trim().slice(0, 30) : '', win: win ? txt(win, 'h2, h3', 30) : '', foc };
  }
  const po = ride.querySelector('#pauseOverlay');
  const s = { scr: po ? 'paused' : 'ride', pow: txt(ride, '#hPow', 6), spd: txt(ride, '#hSpd', 6), music: (appState?.settings?.musicVol ?? 0.45) > 0 };
  { const gl = txt(ride, '#hGearL', 20), g = txt(ride, '#hGear', 10); // the gear chip tells the shifting mode (js/ride.js _setShift)
    s.mode = /^ERG/.test(gl) ? 'erg' : /^(Virtual|Auto)/.test(gl) ? 'virtual' : 'real'; if (s.mode === 'erg') s.tgt = g.replace(/\s*W$/, ''); else s.gear = g; }
  if (ride.querySelector('#hWork')) Object.assign(s, { wo: true, step: txt(ride, '#hWStep'), of: txt(ride, '#hWOf', 30), tgt: txt(ride, '#hWT', 6), left: txt(ride, '#hWLeft', 8), adj: txt(ride, '#hWAdjV', 8), next: txt(ride, '#hWNextN', 30) });
  if (po) {
    const bs = [...po.querySelectorAll('.padmenu button')];
    s.title = txt(po, 'h2', 20); s.menu = bs.slice(0, 16).map(b => b.textContent.trim().replace(/\s+/g, ' ').slice(0, 34)); s.sel = Math.max(0, bs.findIndex(b => /solid/.test(b.style.outline || '')));
  }
  return s;
}

// ---------------- the window (Settings → Phone remote) and the top bar pill ----------------
let styled = false;
function style() {
  if (styled) return; styled = true;
  const st = document.createElement('style');
  st.textContent = `.rm-grid { display: grid; grid-template-columns: 220px 1fr; gap: 28px; align-items: center; margin: 22px 0 10px; }
    .rm-qr { width: 220px; height: 220px; border-radius: 10px; overflow: hidden; background: var(--ink-3); box-shadow: 0 0 0 1px var(--line-2), 0 0 40px rgba(255,90,31,.18); display: grid; place-items: center; color: var(--muted); font-size: 12px; text-align: center; padding: 0; }
    .rm-qr svg { width: 100%; height: 100%; display: block; }
    .rm-mini { display: flex; align-items: center; gap: 14px; margin: 0 0 14px auto; padding: 10px 16px 10px 10px; border-radius: 16px; border: 1px solid var(--line-2); background: var(--ink-2, rgba(255,255,255,.03)); color: var(--paper); font: inherit; text-align: left; cursor: pointer; transition: border-color .2s, box-shadow .2s; }
    .rm-mini:hover { border-color: #ff5a1f; box-shadow: 0 0 28px rgba(255,90,31,.22); outline: none; }
    .rm-mqr { width: 84px; height: 84px; flex: none; border-radius: 9px; overflow: hidden; background: #f4f4ef; display: grid; place-items: center; color: #0b0b0b; }
    .rm-mqr svg { width: 100%; height: 100%; display: block; }
    .rm-mini.on .rm-mqr { background: #ff5a1f; } .rm-mini.on .rm-mqr svg { width: 30px; height: 44px; }
    .rm-mtx b { display: block; font-size: 15px; font-weight: 800; letter-spacing: .01em; } .rm-mtx small { display: block; margin-top: 3px; font-size: 12.5px; color: var(--muted); }
    @media (max-width: 900px) { .rm-mini { display: none; } }
    .rm-code { font-weight: 900; font-stretch: 125%; font-size: 72px; line-height: .95; letter-spacing: .02em; color: #ff5a1f; text-shadow: 0 0 28px rgba(255,90,31,.45); margin: 6px 0 14px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .rm-url { font-weight: 800; color: var(--paper); word-break: break-all; }
    .rm-state { display: inline-flex; align-items: center; gap: 10px; margin-top: 14px; height: 40px; padding: 0 16px; border: 1px solid var(--line-2); border-radius: 99px; font-size: 12px; font-weight: 800; font-stretch: 112%; text-transform: uppercase; letter-spacing: .08em; }
    .rm-state i { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
    .rm-state.on { border-color: #ff5a1f; } .rm-state.on i { background: #ff5a1f; box-shadow: 0 0 0 4px rgba(255,90,31,.25), 0 0 14px #ff5a1f; }
    .rm-pill svg { width: 14px; height: 18px; } .rm-pill.on { border-color: #ff5a1f; } .rm-pill.on svg { color: #ff5a1f; filter: drop-shadow(0 0 6px rgba(255,90,31,.6)); }
    @media (max-width: 720px) { .rm-grid { grid-template-columns: 1fr; justify-items: center; text-align: center; } .rm-code { font-size: 56px; } }`;
  document.head.append(st);
}
const PHONE_SVG = '<svg viewBox="0 0 14 20" aria-hidden="true"><rect x="1" y="1" width="12" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="7" cy="15.5" r="1.3" fill="currentColor"/></svg>';
function pill() {
  style();
  let p = document.querySelector('#rmPill');
  if (!p) { const bar = document.querySelector('.topbar'); if (!bar) return;
    p = document.createElement('button'); p.className = 'pill rm-pill'; p.id = 'rmPill'; p.hidden = true; p.innerHTML = `${PHONE_SVG}<span class="t">Remote</span>`;
    p.onclick = () => openRemote(); bar.insertBefore(p, bar.querySelector('#accPill') || null); }
  p.hidden = !phonesN; p.classList.toggle('on', phonesN > 0); p.title = phonesN ? `Phone remote connected${phonesN > 1 ? ` (${phonesN} phones)` : ''}` : 'Phone remote';
}
const phoneUrl = () => `${location.origin}/remote.html`;
/** Settings → Trainer → "Phone remote" (and the top bar pill): the code big, a QR code, the state */
export async function openRemote() {
  style(); wantOpen = true;
  document.querySelector('#rmBox')?.remove();
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'rmBox';
  const signed = !!account();
  m.innerHTML = `<div class="box" style="width:min(780px,94vw)">
    <div class="label">Phone remote</div><h2 class="display" style="margin-top:10px">Your phone<br>as remote</h2>
    <div class="rm-grid"><div class="rm-qr" id="rmQr">…</div>
      <div><div class="label">Code</div><div class="rm-code" id="rmCode">··· ···</div>
        <p>On your phone open <span class="rm-url">${phoneUrl().replace(/^https?:\/\//, '')}</span> and enter the code, or scan the QR code with the camera.</p>
        ${signed ? `<p class="hint" style="margin-top:8px">Signed in as ${account().name.replace(/[<>&]/g, '')} on your phone too? Open the page and tap “${labelOf().replace(/[<>&]/g, '')}”, no code needed.</p>` : ''}
        <div class="rm-state" id="rmState"><i></i><span>Waiting for your phone…</span></div></div></div>
    <p class="hint">The phone works like a gamepad: D-pad, A select, B back, L / R tabs. In a ride: target watts, pause, music, view and display.</p>
    ${signed ? `<label class="field" style="margin-top:6px"><div>Findable from my phone<div class="hint">While you are signed in, your phone lists this computer without a code.</div></div><input type="checkbox" class="toggle" id="rmAuto" ${appState?.settings?.remoteAuto !== false ? 'checked' : ''}></label>` : ''}
    <div class="actions"><button class="btn ghost small" id="rmNew">New code</button><button class="btn ghost small" id="rmOff">Disconnect phones</button><button class="btn small" id="rmClose">Close</button></div></div>`;
  document.body.append(m);
  const close = () => { wantOpen = false; clearInterval(t); m.remove(); };
  m.addEventListener('click', e => { if (e.target === m) close(); });
  m.querySelector('#rmClose').onclick = close;
  m.querySelector('#rmNew').onclick = () => newCode().catch(() => ui());
  m.querySelector('#rmOff').onclick = async () => { await disconnectRemote(); ensure().catch(() => {}).finally(ui); };
  const au = m.querySelector('#rmAuto'); if (au) au.onchange = () => { appState.settings.remoteAuto = au.checked; import('./app.js').then(x => x.saveSettings()); };
  const t = setInterval(() => { if (!m.isConnected) return clearInterval(t); if (S && (!S.code || S.exp - Date.now() < 5000)) newCode().catch(() => {}); }, 1000);
  ui();
  try { await ensure(); if (!S.code || S.exp - Date.now() < 5000) await newCode(); } catch {}
  ui();
}
// ---------------- the library's corner (owner 18.11.: "a clean QR code that is simply always there, no trip to the settings") ----------------
let miniT = 0, miniFor = '';
/** fills el with a small QR card; the code renews itself while the card is on screen. A click opens the big window. */
export function miniRemote(el) {
  if (!el) return; style();
  el.innerHTML = `<div class="rm-mini" id="rmMini" title="Phone remote: scan with your phone's camera · click for the code"><span class="rm-mqr" id="rmMiniQr"></span><span class="rm-mtx"><b>Connect phone</b><small id="rmMiniSt">Scan to use it as remote</small></span></div>`; // a div on purpose: the gamepad focus (js/padnav.js) skips it, a pad needs no phone
  el.querySelector('#rmMini').onclick = () => openRemote();
  miniFor = ''; clearInterval(miniT);
  const tick = () => { if (!document.querySelector('#rmMini')) return clearInterval(miniT); if (!phonesN && !opening && (!S || !S.code || S.exp - Date.now() < 30000)) newCode().catch(() => mini()); };
  miniT = setInterval(tick, 5000); tick(); mini();
}
function mini() {
  const m = document.querySelector('#rmMini'); if (!m) return;
  const url = !phonesN && S?.code && S.exp - Date.now() > 0 ? `${phoneUrl()}#c=${S.code}` : '', q = m.querySelector('#rmMiniQr');
  m.classList.toggle('on', phonesN > 0);
  if (url !== miniFor) { miniFor = url; try { q.innerHTML = url ? qrSvg(url) : phonesN ? PHONE_SVG : ''; } catch { q.textContent = ''; } }
  m.querySelector('b').textContent = phonesN ? 'Phone connected' : 'Connect phone';
  m.querySelector('#rmMiniSt').textContent = phonesN ? (phonesN > 1 ? `${phonesN} phones as remote` : 'Your phone is the remote') : err && !S ? 'Needs the RIDEFRAME server' : 'Scan to use it as remote';
}
let qrFor = '';
function ui() {
  pill(); refreshLabel(); mini();
  const m = document.querySelector('#rmBox'); if (!m) return;
  const code = S?.code || '', st = m.querySelector('#rmState');
  m.querySelector('#rmCode').textContent = err && !S ? '–' : fmtCode(code);
  const url = code ? `${phoneUrl()}#c=${code}` : '';
  if (url !== qrFor) { qrFor = url; const q = m.querySelector('#rmQr'); try { q.innerHTML = url ? qrSvg(url) : '…'; } catch { q.textContent = phoneUrl(); } }
  st.classList.toggle('on', phonesN > 0);
  st.querySelector('span').textContent = err && !S ? err : phonesN ? `Phone connected${phonesN > 1 ? ` · ${phonesN} phones` : ''}` : link?.state === 'retry' ? 'Reconnecting…' : 'Waiting for your phone…';
}

// ---------------- the pause menu's Options (js/ride.js): one button that shows the code / the state ----------------
const live = () => !!S?.code && S.exp - Date.now() > 5000;
export const remoteLabel = () => phonesN ? 'Phone remote: connected' : live() ? `Phone remote: code ${fmtCode(S.code)}` : 'Phone remote: show code';
export function remoteCode() { wantOpen = true; (live() ? Promise.resolve() : newCode()).catch(() => {}).finally(refreshLabel); }
function refreshLabel() { const b = document.querySelector('#oRemote'); if (b) b.textContent = remoteLabel(); }

globalThis.__remote = { get session() { return S && { id: S.id, code: S.code }; }, get phones() { return phonesN; }, pad, snapshot }; // for tools/remote-ui.cjs
