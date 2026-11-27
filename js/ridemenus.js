// The ride's pause menu and its sheets (owner 27.11.: "Options and Settings: as a user I would not understand the difference …
// redo it completely"). One clear list, every thing with ONE home:
//   Resume · Workout & mode (js/ridesetup.js) · Devices · Display & sound · Ride together · Settings (the main Settings page,
//   js/app.js openRideSettings, without the device and shifting rows) · End ride.
// Every sheet has the look of Workout & mode (css/ridesetup.css): a left-aligned title, labelled sections, option cards, one
// orange button. They live in the pause overlay (#pauseOverlay .box), so the ride's own pad code (js/ride.js _pollPad, D-pad /
// A / B) and the keyboard (Tab / Enter / Esc) reach every button; a click on the dark area beside the window rides on; B / Esc
// go one level back (r._backs, a small stack of "reopen what was before"); the entry that opened a sheet gets the focus again.
import { esc, fmtKm, fmtTime } from './util.js';
import { devLine, sheetTop, sheetBox, wireTop, PAD_HINT } from './ridesetup.js';
import { remoteLabel, remoteCode, remoteInfo } from './remotepad.js';
import { click } from './zwiftclick.js';
import { activePad, openControllerTest } from './controller.js';
import { hudPrefs, HUD_ORDER, HUD_PRESETS } from './hudprefs.js';
import { fovOf, FOV_DEFAULT } from './fov.js';

const VIEWS = ['Rider view', 'Chase', 'Look back'];
const WB = [['big', 'Big'], ['compact', 'Compact'], ['focus', 'Focus']];
const padIndex = (box, el) => Math.max(0, [...box.querySelectorAll('.padmenu button')].indexOf(el));
const opt = (on, attrs, name, sub = '') => `<button type="button" class="rsopt${on ? ' on' : ''}" aria-pressed="${on}" ${attrs}><b>${name}</b>${sub ? `<small>${sub}</small>` : ''}</button>`;
/** an on / off item: a switch, the label never changes (owner 27.11.: "every control shows its current value clearly") */
const tog = (id, on, name, sub = '', off = false) => `<button type="button" class="rsopt rmtog${on ? ' on' : ''}" role="switch" aria-checked="${on}" id="${id}"${off ? ' disabled' : ''}><span><b>${name}</b>${sub ? `<small>${sub}</small>` : ''}</span><i class="rmsw" aria-hidden="true"></i></button>`;
const sec = (label, body, cur = '') => `<div class="rsg"><div class="rsl">${label}${cur ? ` <span class="rscur">${cur}</span>` : ''}</div>${body}</div>`;

/* ---------------- the pause list ---------------- */
export function pauseEntries(r) {
  const g = r.group, n = g ? g.others().length : 0;
  return [
    ['pResume', 'Resume', 'Back on the road', 'rmgo'],
    ['pSetup', 'Workout &amp; mode', 'Workout, ERG or gradient, shifting, laps'],
    ['pDev', 'Devices', esc(devLine(r.state.trainer, r.state.hr))],
    ['pOpts', 'Display &amp; sound', 'Camera, field of view, display, music'],
    ...(r.autopilot ? [] : [['pGroup', 'Ride together', g ? `Group ${esc(g.code)} · ${n ? `${n} other rider${n > 1 ? 's' : ''}` : 'waiting for friends'}` : 'Open a group, invite friends']]),
    ['pSet', 'Settings', 'Rider, bike, account'],
    ['pEnd', 'End ride', 'Save or discard'],
  ];
}
export function pauseHTML(r) {
  return `<div class="label">${fmtKm(r.lapOff + r.d)} km · ${fmtTime(r.elapsed)}${r.group ? ` · Group ${esc(r.group.code)}` : ''}</div><h2 class="display">Pause</h2>
    <div class="padmenu pmlist">${pauseEntries(r).map(([id, name, hint, cls]) => `<button type="button" class="pmi${cls ? ' ' + cls : ''}" id="${id}"><span><b>${name}</b><small>${hint}</small></span><i aria-hidden="true">›</i></button>`).join('')}</div>
    <div class="hint pad-hint">🎮 D-pad ↑ ↓ · A ok · B resume &nbsp;·&nbsp; ⌨ Tab · Enter · Esc</div>`;
}

/* ---------------- Devices: everything Bluetooth in one place ---------------- */
function trCard(r) {
  const t = r.state.trainer, pm = !!t.pmOnly, what = pm ? 'power meter' : 'trainer';
  if (t.connected) {
    const kind = t.mode === 'pm' ? 'power meter only' : t.mode === 'ftms' ? 'FTMS' : t.mode === 'wahoo' ? 'Wahoo' : 'watts only';
    return { cls: 'on', name: t.device?.name || (pm ? 'Power meter' : 'Trainer'), sub: `Connected · ${kind} · <span id="dvTrW">${Math.round(r.power || 0)} W</span>`,
      btns: `<button type="button" class="btn ghost small" id="dvTrOff">Disconnect</button>` };
  }
  if (t.device) return { cls: 'lost', name: t.device.name || (pm ? 'Power meter' : 'Trainer'), sub: t.rejoining ? 'Connection lost · reconnecting …' : 'Not connected',
    btns: `<button type="button" class="btn ghost small" id="dvTrRe">Reconnect</button><button type="button" class="btn ghost small" id="dvTr">Choose another</button>` };
  return { cls: 'off', name: 'Not connected', sub: `Bluetooth smart ${what} (Chrome or Edge)`, btns: `<button type="button" class="btn ghost small" id="dvTr">Connect ${what}</button>` };
}
function hrCard(r) {
  const h = r.state.hr, bat = h?.battery != null ? ` · battery ${h.battery} %` : '';
  if (h?.connected) return { cls: 'on', name: h.device?.name || 'Heart rate strap', sub: `Connected · <span id="dvHrV">${h.hr ? h.hr + ' bpm' : 'waiting for heart rate'}</span>${bat}`,
    btns: '<button type="button" class="btn ghost small" id="dvHrOff">Disconnect</button>' };
  if (h?.device && !h.closing) return { cls: 'lost', name: h.device.name || 'Heart rate strap', sub: h.rejoining ? 'Connection lost · reconnecting …' : 'Not connected',
    btns: '<button type="button" class="btn ghost small" id="dvHrRe">Reconnect</button><button type="button" class="btn ghost small" id="dvHr">Choose another</button>' };
  return { cls: 'off', name: 'Not connected', sub: 'Optional · a chest strap or a watch that sends heart rate',
    btns: '<button type="button" class="btn ghost small" id="dvHr">Connect heart rate</button><button type="button" class="btn ghost small" id="dvHrAll" title="If the strap is missing in the normal search">All devices</button>' };
}
const card = (c, id) => `<div class="dvcard ${c.cls}" id="${id}"><div class="dvinfo"><i class="dvdot"></i><div><b>${esc(c.name)}</b><small>${c.sub}</small></div></div><div class="dvbtns">${c.btns}</div></div>`;
function zcCard() {
  const s = click.status, on = s === 'on';
  const sub = on ? `Connected${click.battery != null ? ` · battery ${click.battery} %` : ''}${click.locked ? ' · locked, open the Zwift app' : ''}` : { connecting: 'Connecting …', reconnecting: 'Connection lost · reconnecting …', lost: 'Connection lost · wake it up and connect again' }[s] || 'Its + / − shift the virtual gears';
  return { cls: on ? 'on' : s === 'reconnecting' || s === 'lost' ? 'lost' : 'off', name: on ? click.name || 'Zwift Click' : 'Zwift Click', sub, btns: `<button type="button" class="btn ghost small" id="dvZc">${click.device ? 'Disconnect' : 'Connect'}</button>` };
}
const devKey = r => { const t = r.state.trainer, h = r.state.hr; return [t.connected, !!t.device, t.rejoining, t.pmOnly, h?.connected, !!h?.device, h?.rejoining, click.status, !!activePad()].join(); };

export function openDevices(r, focus = 0) {
  const box = sheetBox(r, 'devices'); if (!box) return;
  const t = r.state.trainer, pad = activePad(), rm = remoteInfo();
  if (!rm.phones && !rm.code) remoteCode(); // the code is there when the rider looks (refreshes #oRemote by itself)
  r._repaint = () => openDevices(r, padIndex(box, document.activeElement));
  box.innerHTML = `<div class="label">Pause · Bluetooth</div><h2 class="display">Devices</h2>
    <div class="padmenu rs">
      ${sheetTop(r)}
      ${sec(t.pmOnly ? 'Power meter' : 'Trainer', card(trCard(r), 'dvTrC') + `<div class="rsnote">Power source: ${t.pmOnly ? 'power meter only' : 'trainer control'} · change it under Workout &amp; mode</div>`)}
      ${sec('Heart rate', card(hrCard(r), 'dvHrC'))}
      ${sec('Controller', card({ cls: pad ? 'on' : 'off', name: pad ? String(pad.id || 'Gamepad').replace(/\s*\(.*$/, '').slice(0, 40) || 'Gamepad' : 'No gamepad', sub: pad ? 'Ready · Start = pause menu' : 'Pair it in the computer’s Bluetooth settings, then press a button', btns: '<button type="button" class="btn ghost small" id="dvCt">Test controller</button>' }, 'dvPadC') + card(zcCard(), 'dvZcC'))}
      ${sec('Phone remote', `<div class="dvcard info"><div class="dvinfo"><i class="dvdot"></i><div><b id="oRemote">${esc(remoteLabel())}</b><small>On the phone open ${esc(location.host)}/remote.html and enter the code</small></div></div><div class="dvbtns"><button type="button" class="btn ghost small" id="dvRmCopy">Copy code</button></div></div>`)}
    </div>
    <div class="hint pad-hint">${PAD_HINT}</div>`;
  wireTop(r, box);
  const on = (id, fn) => { const b = box.querySelector('#' + id); if (b) b.onclick = () => fn(b); };
  // the chooser opens inside the tap (a user gesture), so each of these calls the browser right away
  on('dvTr', b => r._connTrainer(b)); on('dvTrRe', () => r._reconnect('tr'));
  on('dvHr', b => r._connHr(b)); on('dvHrAll', b => r._connHr(b, true)); on('dvHrRe', () => r._reconnect('hr'));
  const twice = (b, fn) => { if (b.dataset.sure) return fn(); b.dataset.sure = '1'; b.textContent = 'Tap again to disconnect'; b.classList.add('rmwarn'); };
  on('dvTrOff', b => twice(b, () => { t.disconnect(true); r._flash('Trainer disconnected'); r._repaint(); }));
  on('dvHrOff', b => twice(b, () => { r.state.hr?.disconnect(true); r.state.hr?.dispatchEvent?.(new Event('change')); r._flash('Heart rate disconnected'); r._repaint(); }));
  on('dvZc', async b => { if (click.device) { click.disconnect(); return r._repaint(); }
    b.disabled = true; b.textContent = 'Connecting …';
    try { await click.connect(); r._flash(`${click.name || 'Zwift Click'} connected · + / − shift the virtual gears`, 3000); } catch (e) { if (e?.name !== 'NotFoundError') r._flash('Zwift Click: ' + (e?.message || e), 5000); }
    if (box.isConnected && r._menu === 'devices') r._repaint(); });
  on('dvCt', () => { openControllerTest(); const m = [...document.querySelectorAll('.modal')].at(-1); m?.classList.add('rideset', 'ctride'); }); // .rideset: the pad and the keys belong to that window (js/padnav.js) until it closes
  on('dvRmCopy', b => { const c = remoteInfo().code; if (!c) return; navigator.clipboard?.writeText(c).then(() => { b.textContent = 'Copied ✓'; }, () => {}); });
  r._padFocus(focus);
  // live: watts and bpm every second; a new state (connected, lost, back) draws the sheet again
  clearInterval(r._dvT); const k0 = devKey(r);
  r._dvT = setInterval(() => {
    if (!box.isConnected || r._menu !== 'devices') return clearInterval(r._dvT);
    if (devKey(r) !== k0 && !box.querySelector('[data-sure], button:disabled')) return r._repaint();
    const w = box.querySelector('#dvTrW'), v = box.querySelector('#dvHrV'), h = r.state.hr;
    if (w) w.textContent = `${Math.round(r.power || 0)} W`; if (v && h?.hr) v.textContent = h.hr + ' bpm';
  }, 1000);
}

/* ---------------- Display & sound ---------------- */
export function openDisplay(r, focus = 0) {
  const box = sheetBox(r, 'display'); if (!box) return;
  const s = r.state.settings, P = r.player || {}, m = r.music, hp = hudPrefs(s).preset, fov = fovOf(s), mOn = !!m?.on && m.available !== false;
  r._repaint = () => openDisplay(r, padIndex(box, document.activeElement));
  const view = P.setView ? `<div class="rsrow rsrow3">${VIEWS.map((n, i) => opt((s.view3d || 0) === i, `data-view="${i}"`, n)).join('')}</div>` : '';
  const lens = P.setFov ? `<div class="rmstep"><span class="rmstepl">Field of view</span><button type="button" class="rmsq" id="oNarrow" aria-label="Narrower view">−</button><span class="rmval"><b>${fov}°</b><small>${fov === FOV_DEFAULT ? 'normal' : fov > FOV_DEFAULT ? 'wider' : 'closer'}</small></span><button type="button" class="rmsq" id="oWide" aria-label="Wider view">+</button></div>` : '';
  box.innerHTML = `<div class="label">Pause · what you see and hear</div><h2 class="display">Display &amp; sound</h2>
    <div class="padmenu rs">
      ${sheetTop(r)}
      ${P.setView || P.setFov ? sec('Camera', view + lens, P.setView ? VIEWS[s.view3d || 0] : '') : ''}
      ${sec('Display', `<div class="rsrow rshud">${HUD_ORDER.map(k => opt(hp === k, `data-hud="${k}"`, HUD_PRESETS[k].name)).join('')}</div>${hp === 'eigen' ? '<div class="rsnote">Now: your own choice (Settings → Display while riding)</div>' : ''}`, `${hp === 'eigen' ? 'Custom' : HUD_PRESETS[hp]?.name || ''} · key I`)}
      ${r.workout ? sec('Interval display', `<div class="rsrow rsrow3">${WB.map(([k, n]) => opt(r._wbView() === k, `data-wb="${k}"`, n)).join('')}</div>`, 'key L') : ''}
      ${P.setCockpit ? sec('View', tog('oBar', s.cockpit !== false, 'Handlebars', 'Bars and forearms in the rider view · key H')) : ''}
      ${sec('Music', `<div class="rsrow rsrow2">${tog('oMusic', mOn, 'Music', m?.available === false ? 'No music found (assets/audio)' : mOn ? '♫ ' + esc(m.title?.() || '') : 'key M', !m || m.available === false)}${mOn ? opt(false, 'id="oNext"', 'Next song', 'key N') : ''}</div>`)}
      ${sec('Extras', tog('oEagle', s.eagle !== false, 'Eagle of Destiny', 'Once per interval workout, an eagle with rude words'))}
    </div>
    <div class="hint pad-hint">${PAD_HINT}</div>`;
  wireTop(r, box);
  const again = el => setTimeout(() => { if (box.isConnected && r._menu === 'display') openDisplay(r, padIndex(box, el)); }, 60);
  const on = (sel, fn) => box.querySelectorAll(sel).forEach(b => b.onclick = () => { fn(b); again(b); });
  on('[data-view]', b => { const v = +b.dataset.view; if ((s.view3d || 0) !== v) { s.view3d = (v + 2) % 3; r._cycleView(); } });
  on('#oNarrow', () => r._lens(1)); on('#oWide', () => r._lens(-1));
  on('[data-hud]', b => { r._setHud({ ...(s.hud || {}), preset: b.dataset.hud }); r._flash('Display: ' + HUD_PRESETS[b.dataset.hud].name); });
  on('[data-wb]', b => { if (r._wbView() === b.dataset.wb) return; s.wbView = WB[(WB.findIndex(x => x[0] === b.dataset.wb) + 2) % 3][0]; r._cycleWbView(); });
  on('#oBar', () => r._toggleBar()); on('#oMusic', () => r._toggleMusic()); on('#oEagle', () => r._toggleEagle());
  on('#oNext', () => { r.music?.skip(); setTimeout(() => r._flash('♫ ' + (r.music?.title() || '')), 300); });
  r._padFocus(focus);
}

/* ---------------- Ride together: the group, its code, the friends online ---------------- */
export async function openGroup(r, focus = 0) {
  let box = sheetBox(r, 'group', 'rmmid'); if (!box) return;
  if (!r.group) { // a solo ride: the group opens now (friends start right next to you)
    box.innerHTML = '<div class="label">Ride together</div><h2 class="display">Opening …</h2>';
    try { await r._hostGroup(); } catch (e) { r._flash('Group failed: ' + (e.message || e), 4000); return r._menuBack(); }
    box = sheetBox(r, 'group', 'rmmid'); if (!box || !r.paused) return;
  }
  const g = r.group, os = g.others(), v = g.voice?.on ? g.voice : null;
  r._repaint = () => openGroup(r, padIndex(box, document.activeElement));
  box.innerHTML = `<div class="label">Pause · Ride together</div><h2 class="display">Ride together</h2>
    <div class="padmenu rs">
      ${sheetTop(r)}
      ${sec('Group code', `<div class="rmcode"><b>${esc(g.code)}</b><button type="button" class="btn ghost small" id="pgLink">Copy link</button></div><div class="rsnote">Friends tap “Ride together” in RIDEFRAME and enter the code, or open the link. They start right next to you.</div>`)}
      ${sec('Riders', os.length ? `<div class="rsrow">${os.map((x, i) => x.riding || x.d > 0 ? opt(false, `data-jump="${i}"`, `⇢ Jump to ${esc(x.name)}`, `${fmtKm(x.d || 0)} km`) : `<div class="rmrider"><b>${esc(x.name)}</b><small>getting ready</small></div>`).join('')}</div><div class="rsnote">A jump never counts as distance.</div>` : '<div class="rsnote">Nobody has joined yet.</div>', os.length ? String(os.length + 1) + ' in the group' : '')}
      ${r._voiceTap ? sec('Voice chat', `<div class="rsrow rsrow2">${tog('pVoice', !!v, 'Voice chat', v ? (v.hasMic ? (v.ptt ? 'Hold T to talk' : 'Key T mutes') : 'Listening only') : 'Talk while you ride')}${v && v.hasMic && !v.ptt ? tog('pMic', !v.muted, 'Microphone', v.muted ? 'Muted' : 'Your friends hear you') : ''}</div>`) : ''}
      ${sec('Invite', `<button type="button" class="rsopt" id="pInvite"><b>Invite friends who are online</b><small>${r.presence?.on ? 'They get your invite on their library or phone' : 'Needs an account: sign in under Settings'}</small></button>`)}
    </div>
    <div class="hint pad-hint">${PAD_HINT}</div>`;
  wireTop(r, box);
  box.querySelector('#pgLink').onclick = e => navigator.clipboard?.writeText(g.link).then(() => { e.target.textContent = 'Link copied ✓'; }, () => { e.target.textContent = g.link; });
  box.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => { const x = os[+b.dataset.jump]; if (x) { r._resume(); r._jump(x); } });
  const vb = box.querySelector('#pVoice'); if (vb) vb.onclick = async () => { if (g.voice?.on) { g.voice.stop(); g.voice = null; window.dispatchEvent(new Event('rf-voicechange')); r._flash('Voice chat off'); } else await r._voiceTap(); r._repaint(); };
  const mb = box.querySelector('#pMic'); if (mb) mb.onclick = async () => { await r._voiceTap(); r._repaint(); };
  box.querySelector('#pInvite').onclick = () => { if (!r.presence?.on) return r._flash('Sign in to invite friends (Settings → Account)', 3500); const i = padIndex(box, box.querySelector('#pInvite')); r._backs.push(() => openGroup(r, i)); openInvite(r); };
  r._padFocus(focus);
}
/** the friends online right now (green dot), one button each; the friend sees "Max invites you to ride · Join" */
export async function openInvite(r) {
  let box = sheetBox(r, 'invite', 'rmmid'); if (!box) return;
  box.innerHTML = '<div class="label">Ride together · invite</div><h2 class="display">Online now</h2><p class="dim">Loading …</p>';
  const live = await import('./live.js'), F = await live.friendsNow(); if (!box.isConnected || r._menu !== 'invite') return;
  const inGroup = new Set((r.group?.others() || []).map(x => x.name)), fs = (F?.friends || []).filter(f => f.state !== 'offline' && !inGroup.has(f.name));
  r._repaint = null;
  box.innerHTML = `<div class="label">Ride together · invite</div><h2 class="display">Online now</h2>
    <div class="padmenu rs">
      ${sheetTop(r)}
      ${sec('Friends', fs.length ? `<div class="invlist">${fs.map((f, i) => `<button type="button" class="rsopt" data-fi="${i}"><b><i class="frdot ${f.state}"></i> Invite ${esc(f.name)}</b><small>${f.state === 'riding' ? 'riding now' : 'online'}</small></button>`).join('')}</div>` : '<div class="rsnote">Nobody else is online right now. Friends with a green dot show up here.</div>')}
    </div>
    <div class="hint pad-hint">${PAD_HINT}</div>`;
  wireTop(r, box);
  box.querySelectorAll('[data-fi]').forEach(b => b.onclick = async () => {
    const f = fs[+b.dataset.fi]; if (!f || b.disabled) return; b.disabled = true; b.querySelector('b').textContent = `Inviting ${f.name} …`;
    try { await r._hostGroup(); await r.presence?.beat();
      try { await live.inviteFriend(f.key); } catch (e) { if (e.status !== 409) throw e; await new Promise(z => setTimeout(z, 700)); await r.presence?.beat(); await live.inviteFriend(f.key); }
      b.querySelector('b').textContent = `${f.name} invited ✓`; }
    catch (e) { b.disabled = false; b.querySelector('b').textContent = `Invite ${f.name} · ${e.message || 'failed'}`; }
  });
  r._padFocus(fs.length ? 2 - (r._backs?.length ? 0 : 1) : 0);
}

/* ---------------- End ride: save, or discard after one question ---------------- */
export function openEnd(r, sure = false) {
  const box = sheetBox(r, 'end', 'rmsmall'); if (!box) return;
  const short = r.elapsed <= 30, keys = r.keyPower, info = `${fmtKm(r._ridden ? r._ridden() : r.d)} km · ${fmtTime(r.elapsed)}`;
  r._repaint = null;
  box.innerHTML = sure
    ? `<div class="label">End ride · ${info}</div><h2 class="display">Discard this ride?</h2>
      <p class="rmtext">The ride is deleted for good: nothing is saved, nothing goes to Strava.</p>
      <div class="padmenu rmend"><button type="button" class="btn ghost" id="mBack">Back</button><button type="button" class="btn danger" id="pDiscardYes">Discard</button></div>
      <div class="hint pad-hint">${PAD_HINT}</div>`
    : `<div class="label">${info}</div><h2 class="display">End ride</h2>
      ${short || keys ? `<p class="rmtext">${short ? 'Under 30 seconds: this ride cannot be saved.' : 'Ridden with the arrow keys: this ride is not saved.'}</p>` : ''}
      <div class="padmenu rmend"><button type="button" class="btn" id="pSave">${short || keys ? 'End ride' : 'Save ride'}</button><button type="button" class="btn ghost" id="pDiscard">Discard</button><button type="button" class="btn ghost" id="mBack">Back</button></div>
      <div class="hint pad-hint">${PAD_HINT}</div>`;
  box.querySelector('#mBack').onclick = () => r._menuBack();
  box.querySelector('#pSave')?.addEventListener('click', () => r._end(true));
  box.querySelector('#pDiscard')?.addEventListener('click', () => { r._backs.push(() => openEnd(r)); openEnd(r, true); });
  box.querySelector('#pDiscardYes')?.addEventListener('click', () => r._end(false));
  r._padFocus(0);
}
