// The ride's pause menu and its sheets (owner 27.11.: "Options and Settings: as a user I would not understand the difference …
// redo it completely"; 27.11. evening: "so many unnecessary things … far too much text"). One clear list, every thing with
// ONE home: Workout & mode (js/ridesetup.js) · Devices · Display & sound · Ride together (one row, no sheet) · Settings (the
// main Settings page, js/app.js openRideSettings) and in the foot End ride (left) and Resume (right).
// Every sheet has the same frame (js/ridesetup.js sheetHead / sheetFoot): "‹ Back" top left, the title once, the primary
// action bottom right, secondary ones bottom left; no pad hints (the button layout lives in Settings → Controller).
// They live in the pause overlay (#pauseOverlay .box), so the ride's own pad code (js/ride.js _pollPad, D-pad / A / B) and
// the keyboard (Tab / Enter / Esc) reach every button; a click on the dark area beside the window rides on; B / Esc go one
// level back (r._backs, a small stack of "reopen what was before"); the entry that opened a sheet gets the focus again.
import { esc, fmtKm, fmtTime } from './util.js';
import { devLine, sheetHead, sheetFoot, sheetBox, wireTop, padIndex, goIndex, info, infoText, modeOf } from './ridesetup.js';
import { remoteLabel, remoteCode, remoteInfo } from './remotepad.js';
import { click } from './zwiftclick.js';
import { activePad } from './controller.js';
import { hudPrefs, HUD_ORDER, HUD_PRESETS } from './hudprefs.js';
import { fovOf, FOV_DEFAULT } from './fov.js';

const VIEWS = ['Rider view', 'Chase', 'Look back'];
const WB = [['big', 'Big'], ['compact', 'Compact'], ['focus', 'Focus']];
const opt = (on, attrs, name, sub = '') => `<button type="button" class="rsopt${on ? ' on' : ''}" aria-pressed="${on}" ${attrs}><b>${name}</b>${sub ? `<small>${sub}</small>` : ''}</button>`;
/** an on / off item: a switch, the label never changes (owner 27.11.: "every control shows its current value clearly") */
const tog = (id, on, name, sub = '', off = false) => `<button type="button" class="rsopt rmtog${on ? ' on' : ''}" role="switch" aria-checked="${on}" id="${id}"${off ? ' disabled' : ''}><span><b>${name}</b>${sub ? `<small>${sub}</small>` : ''}</span><i class="rmsw" aria-hidden="true"></i></button>`;
const sec = (label, body, cur = '') => `<div class="rsg"><div class="rsl">${label}${cur ? ` <span class="rscur">${cur}</span>` : ''}</div>${body}</div>`;

/* ---------------- the pause list ---------------- */
const MODE_WORD = { erg: 'ERG', sim: 'gradient', flat: 'no gradient', pm: 'power meter only' };
/** the status under "Workout & mode": the workout (or none) and the mode */
export const setupLine = r => `${r.workout ? esc(r.workout.name) + (r.wDone ? ' · done' : '') : 'No workout'} · ${MODE_WORD[modeOf(r)] || ''}${!r.workout && r.berg && r._holdW ? ' ' + r._holdW + ' W' : ''}`;
export function pauseEntries(r) {
  return [['pSetup', 'Workout &amp; mode', setupLine(r)], ['pDev', 'Devices', esc(devLine(r.state.trainer, r.state.hr))], ['pOpts', 'Display &amp; sound', ''], ['pSet', 'Settings', '']];
}
/** friends with an account see this ride under "Riding now" and join without a code (js/live.js, Settings → Friends) */
const friendsCanJoin = r => !!r.presence?.on && r.state.settings.liveShow !== false && r.state.settings.liveAuto !== false;
/** Ride together as ONE row (owner 27.11. evening: no sheet, no riders list, no invite list, no explanation): the code and
 *  "Copy invite link" once the group is open, else one button that opens it */
function groupRow(r) {
  const g = r.group?.open ? r.group : null, n = g ? g.others().length : 0;
  return `<div class="pmrow" id="pGroupRow"><b>Ride together</b>${g
    ? `<span class="pmcode" title="Group code">${esc(g.code)}</span>${n ? `<small>${n} with you</small>` : ''}<button type="button" class="btn ghost small" id="pGroupLink">Copy invite link</button>`
    : `${friendsCanJoin(r) ? '<small>Friends can join</small>' : ''}<button type="button" class="btn ghost small" id="pGroupOpen">${friendsCanJoin(r) ? 'Get invite link' : 'Open for friends'}</button>`}</div>`;
}
export function pauseHTML(r) {
  const row = ([id, name, hint]) => `<button type="button" class="pmi" id="${id}"><span><b>${name}</b>${hint ? `<small>${hint}</small>` : ''}</span><i aria-hidden="true">›</i></button>`, E = pauseEntries(r);
  return `${sheetHead('Paused', `<span class="rmstat">${fmtKm(r.lapOff + r.d)} km · ${fmtTime(r.elapsed)}</span>`, false)}
    <div class="padmenu pmlist">${E.slice(0, 3).map(row).join('')}${r.autopilot ? '' : groupRow(r)}${row(E[3])}</div>
    ${sheetFoot('<button type="button" class="btn ghost" id="pEnd">End ride</button>', '<button type="button" class="btn rsgo" id="pResume">Resume ▸</button>')}`;
}
/** the Ride together row: open the group (then the code and the copy button stand in its place), copy the join link */
export function wireGroupRow(r, box) {
  const op = box.querySelector('#pGroupOpen');
  if (op) op.onclick = async () => {
    op.disabled = true; op.textContent = 'Opening …';
    try { await r._hostGroup(); } catch (e) { r._flash('Group failed: ' + (e?.message || e), 4000); }
    if (r.paused && r._menu === 'pause' && box.isConnected) r._pause(r.group?.open ? 'pGroupLink' : 'pGroupOpen');
  };
  const ln = box.querySelector('#pGroupLink');
  if (ln) ln.onclick = () => { const g = r.group; if (!g) return;
    const done = t => { ln.textContent = t; clearTimeout(ln._t); ln._t = setTimeout(() => { if (ln.isConnected) ln.textContent = 'Copy invite link'; }, 1800); };
    (navigator.clipboard?.writeText(g.link) || Promise.reject()).then(() => done('Copied ✓'), () => { done('Copy invite link'); r._flash('Invite link: ' + g.link, 8000); }); };
}

/* ---------------- Devices: everything Bluetooth in one place ---------------- */
function trCard(r) {
  const t = r.state.trainer, pm = !!t.pmOnly, what = pm ? 'power meter' : 'trainer';
  if (t.connected) {
    const kind = t.mode === 'pm' ? 'power meter only' : t.mode === 'ftms' ? 'FTMS' : t.mode === 'wahoo' ? 'Wahoo' : 'watts only';
    return { cls: 'on', name: t.device?.name || (pm ? 'Power meter' : 'Trainer'), sub: `${kind} · <span id="dvTrW">${Math.round(r.power || 0)} W</span>`,
      btns: `<button type="button" class="btn ghost small" id="dvTrOff">Disconnect</button>` };
  }
  if (t.device) return { cls: 'lost', name: t.device.name || (pm ? 'Power meter' : 'Trainer'), sub: t.rejoining ? 'Connection lost · reconnecting …' : 'Not connected',
    btns: `<button type="button" class="btn ghost small" id="dvTrRe">Reconnect</button><button type="button" class="btn ghost small" id="dvTr">Choose another</button>` };
  return { cls: 'off', name: 'Not connected', sub: '', btns: `<button type="button" class="btn ghost small" id="dvTr">Connect ${what}</button>` };
}
function hrCard(r) {
  const h = r.state.hr, bat = h?.battery != null ? ` · battery ${h.battery} %` : '';
  if (h?.connected) return { cls: 'on', name: h.device?.name || 'Heart rate strap', sub: `<span id="dvHrV">${h.hr ? h.hr + ' bpm' : 'waiting for heart rate'}</span>${bat}`,
    btns: '<button type="button" class="btn ghost small" id="dvHrOff">Disconnect</button>' };
  if (h?.device && !h.closing) return { cls: 'lost', name: h.device.name || 'Heart rate strap', sub: h.rejoining ? 'Connection lost · reconnecting …' : 'Not connected',
    btns: '<button type="button" class="btn ghost small" id="dvHrRe">Reconnect</button><button type="button" class="btn ghost small" id="dvHr">Choose another</button>' };
  return { cls: 'off', name: 'Not connected', sub: 'Optional',
    btns: '<button type="button" class="btn ghost small" id="dvHr">Connect heart rate</button><button type="button" class="btn ghost small" id="dvHrAll" title="If the strap is missing in the normal search">All devices</button>' };
}
const card = (c, id) => `<div class="dvcard ${c.cls}" id="${id}"><div class="dvinfo"><i class="dvdot"></i><div><b>${esc(c.name)}</b>${c.sub ? `<small>${c.sub}</small>` : ''}</div></div><div class="dvbtns">${c.btns}</div></div>`;
function zcCard() {
  const s = click.status, on = s === 'on';
  const sub = on ? `Connected${click.battery != null ? ` · battery ${click.battery} %` : ''}${click.locked ? ' · locked, open the Zwift app' : ''}` : { connecting: 'Connecting …', reconnecting: 'Connection lost · reconnecting …', lost: 'Connection lost · wake it up and connect again' }[s] || '';
  return { cls: on ? 'on' : s === 'reconnecting' || s === 'lost' ? 'lost' : 'off', name: on ? click.name || 'Zwift Click' : 'Zwift Click', sub, btns: `<button type="button" class="btn ghost small" id="dvZc">${click.device ? 'Disconnect' : 'Connect'}</button>` };
}
const devKey = r => { const t = r.state.trainer, h = r.state.hr; return [t.connected, !!t.device, t.rejoining, t.pmOnly, h?.connected, !!h?.device, h?.rejoining, click.status, !!activePad()].join(); };

export function openDevices(r, focus) {
  const box = sheetBox(r, 'devices'); if (!box) return;
  const t = r.state.trainer, pad = activePad(), rm = remoteInfo();
  if (!rm.phones && !rm.code) remoteCode(); // the code is there when the rider looks (refreshes #oRemote by itself)
  r._repaint = () => openDevices(r, padIndex(box, document.activeElement));
  box.innerHTML = `${sheetHead('Devices')}
    <div class="padmenu rs">
      ${sec(t.pmOnly ? 'Power meter' : 'Trainer', card(trCard(r), 'dvTrC'))}
      ${sec('Heart rate', card(hrCard(r), 'dvHrC'))}
      ${sec('Controller', card({ cls: pad ? 'on' : 'off', name: pad ? String(pad.id || 'Gamepad').replace(/\s*\(.*$/, '').slice(0, 40) || 'Gamepad' : 'No gamepad', sub: pad ? 'Ready' : 'Pair it in Bluetooth, then press a button', btns: '<button type="button" class="btn ghost small" id="dvCt">Button layout</button>' }, 'dvPadC') + card(zcCard(), 'dvZcC') + `<div class="dvcard info"><div class="dvinfo"><i class="dvdot"></i><div><b id="oRemote">${esc(remoteLabel())}</b><small>${esc(location.host)}/remote.html on the phone</small></div></div><div class="dvbtns"><button type="button" class="btn ghost small" id="dvRmCopy">Copy code</button></div></div>`)}
    </div>
    ${sheetFoot()}`;
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
  // the button layout and the controller test have one home: Settings → Controller; closing it comes back here
  on('dvCt', b => { const i = padIndex(box, b); r._settings('ctrl', () => { r._pause('pDev'); r._backs = [() => r._pause('pDev')]; openDevices(r, i); }); });
  on('dvRmCopy', b => { const c = remoteInfo().code; if (!c) return; navigator.clipboard?.writeText(c).then(() => { b.textContent = 'Copied ✓'; }, () => {}); });
  r._padFocus(focus ?? goIndex(box));
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
export function openDisplay(r, focus) {
  const box = sheetBox(r, 'display'); if (!box) return;
  const s = r.state.settings, P = r.player || {}, m = r.music, hp = hudPrefs(s).preset, fov = fovOf(s), mOn = !!m?.on && m.available !== false;
  r._repaint = () => openDisplay(r, padIndex(box, document.activeElement));
  const view = P.setView ? `<div class="rsrow rsrow3">${VIEWS.map((n, i) => opt((s.view3d || 0) === i, `data-view="${i}"`, n)).join('')}</div>` : '';
  const lens = P.setFov ? `<div class="rmstep"><span class="rmstepl">Field of view</span><button type="button" class="rmsq" id="oNarrow" aria-label="Narrower view">−</button><span class="rmval"><b>${fov}°</b>${fov === FOV_DEFAULT ? '<small>normal</small>' : ''}</span><button type="button" class="rmsq" id="oWide" aria-label="Wider view">+</button></div>` : '';
  const eagle = 'Once per interval workout an eagle lands beside you with a few rude words.';
  box.innerHTML = `${sheetHead('Display &amp; sound')}
    <div class="padmenu rs">
      ${P.setView || P.setFov ? sec('Camera', view + lens) : ''}
      ${sec('Display', `<div class="rsrow rshud">${HUD_ORDER.map(k => opt(hp === k, `data-hud="${k}"`, HUD_PRESETS[k].name)).join('')}</div>`, hp === 'eigen' ? 'Custom' : '')}
      ${r.workout ? sec('Interval display', `<div class="rsrow rsrow3">${WB.map(([k, n]) => opt(r._wbView() === k, `data-wb="${k}"`, n)).join('')}</div>`) : ''}
      ${P.setCockpit ? sec('View', tog('oBar', s.cockpit !== false, 'Handlebars')) : ''}
      ${sec('Music', `<div class="rsrow rsrow2">${tog('oMusic', mOn, 'Music', m?.available === false ? 'No music found' : mOn ? '♫ ' + esc(m.title?.() || '') : '', !m || m.available === false)}${mOn ? opt(false, 'id="oNext"', 'Next song') : ''}</div>`)}
      ${sec(`Extras${info('oEagleI', eagle)}`, infoText('oEagleI', eagle) + tog('oEagle', s.eagle !== false, 'Eagle of Destiny'))}
    </div>
    ${sheetFoot()}`;
  wireTop(r, box);
  const again = el => setTimeout(() => { if (box.isConnected && r._menu === 'display') openDisplay(r, padIndex(box, el)); }, 60);
  const on = (sel, fn) => box.querySelectorAll(sel).forEach(b => b.onclick = () => { fn(b); again(b); });
  on('[data-view]', b => { const v = +b.dataset.view; if ((s.view3d || 0) !== v) { s.view3d = (v + 2) % 3; r._cycleView(); } });
  on('#oNarrow', () => r._lens(1)); on('#oWide', () => r._lens(-1));
  on('[data-hud]', b => { r._setHud({ ...(s.hud || {}), preset: b.dataset.hud }); r._flash('Display: ' + HUD_PRESETS[b.dataset.hud].name); });
  on('[data-wb]', b => { if (r._wbView() === b.dataset.wb) return; s.wbView = WB[(WB.findIndex(x => x[0] === b.dataset.wb) + 2) % 3][0]; r._cycleWbView(); });
  on('#oBar', () => r._toggleBar()); on('#oMusic', () => r._toggleMusic()); on('#oEagle', () => r._toggleEagle());
  on('#oNext', () => { r.music?.skip(); setTimeout(() => r._flash('♫ ' + (r.music?.title() || '')), 300); });
  r._padFocus(focus ?? goIndex(box));
}

/* ---------------- End ride: save, or discard after one question ---------------- */
export function openEnd(r, sure = false) {
  const box = sheetBox(r, 'end', 'rmsmall'); if (!box) return;
  const short = r.elapsed <= 30, keys = r.keyPower, stat = `${fmtKm(r._ridden ? r._ridden() : r.d)} km · ${fmtTime(r.elapsed)}`;
  r._repaint = null;
  box.innerHTML = sure
    ? `${sheetHead('Discard ride?')}
      <p class="rmtext">Nothing is saved, nothing goes to Strava.</p>
      ${sheetFoot('', '<button type="button" class="btn danger" id="pDiscardYes">Discard</button>')}`
    : `${sheetHead('End ride', `<span class="rmstat">${stat}</span>`)}
      ${short || keys ? `<p class="rmtext">${short ? 'Under 30 seconds: this ride cannot be saved.' : 'Ridden with the arrow keys: this ride is not saved.'}</p>` : ''}
      ${sheetFoot('<button type="button" class="btn ghost" id="pDiscard">Discard</button>', `<button type="button" class="btn" id="pSave">${short || keys ? 'End ride' : 'Save ride'}</button>`)}`;
  box.querySelector('#mBack').onclick = () => r._menuBack();
  box.querySelector('#pSave')?.addEventListener('click', () => r._end(true));
  box.querySelector('#pDiscard')?.addEventListener('click', () => { r._backs.push(() => openEnd(r)); openEnd(r, true); });
  box.querySelector('#pDiscardYes')?.addEventListener('click', () => r._end(false));
  r._padFocus(sure ? 0 : goIndex(box, '#pSave'));
}
