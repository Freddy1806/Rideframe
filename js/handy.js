// RIDEFRAME main menu on the phone (handy.html, start of the installed app and the Android app).
// Freddy 16.11.: one clear menu, every mode its own big card with colour and icon (ride outside, run, indoor trainer,
// routes & 3D world, strength); the week at a glance; settings for light/dark and colours.
import { db } from './db.js';
import { esc, twoWeeks, weekStat } from './util.js';
import { sportOf, isBike } from './fitness.js';
import { MODES, ACCENTS, icon, applyTheme } from './theme.js';
import { loadActs, rowHtml, wireRows } from './feed.js';
import { nav } from './nav.js';

const el = document.getElementById('handy'), $ = (s, r = document) => r.querySelector(s);
let S = {}, acc = null, rides = [], kraft = [], installEvt = null, D = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; render(); });

async function load() {
  S = (await db.kvGet('settings').catch(() => null)) || {};
  applyTheme(S, null);
  D = await loadActs(); rides = D.acts.filter(a => !a.kraft); kraft = D.acts.filter(a => a.kraft); // one loader for all sports (feed.js)
  try { acc = (await import('./account.js')).account(); } catch {}
}

function render() {
  const R2 = twoWeeks(rides), K2 = twoWeeks(kraft), nb = l => l.filter(isBike).length, nr = l => l.filter(r => sportOf(r) === 'run').length, km = l => Math.round(l.reduce((a, r) => a + r.distance, 0) / 1000);
  const card = m => `<a class="hmode" href="${MODES[m].href}" style="--mc:${MODES[m].color};--mcl:${MODES[m].light}">${icon(m, 'hico')}<b>${MODES[m].name}</b><i>›</i></a>`;
  el.innerHTML = `<header class="ptop"><div class="pbrand" style="font-size:22px">RIDE<span>FRAME</span></div>
      <button class="ppill ${acc ? 'on' : ''}" id="hAcc"><i></i><span class="pname">${acc ? esc(acc.name) : 'Sign in'}</span></button>
      <button class="pgear" id="hSet" title="Settings" aria-label="Settings">${icon('gear', 'gico')}</button></header>
    ${installEvt && !window.__rfNative ? `<button class="btn ghost" id="hInstall">Install as app</button>` : ''}
    <section class="hweek"><div class="hwhead"><span class="label">This week</span><span class="wdl">▲▼ vs last week</span></div><div class="kstats">
      ${weekStat(nb(R2.cur), nb(R2.prev), 'Rides')}${weekStat(nr(R2.cur), nr(R2.prev), 'Runs')}${weekStat(km(R2.cur), km(R2.prev), 'km')}${weekStat(K2.cur.length, K2.prev.length, 'Strength')}</div></section>
    <nav class="hmodes">${['ride', 'run', 'trainer', 'world', 'kraft'].map(card).join('')}</nav>
    ${D.acts.length ? `<section class="hrecent"><h3 class="ksec">Recent</h3>${D.acts.slice(0, 3).map(a => rowHtml(a, D.P)).join('')}<a class="hall" href="aktivitaeten.html">All activities ›</a></section>` : ''}`;
  wireRows(el, D, async () => { await load(); render(); });
  $('#hAcc').onclick = async () => { const a = await import('./account.js'); await a.accountModal({ settings: S }, async () => { await load(); render(); }); };
  $('#hSet').onclick = settings;
  const ib = $('#hInstall'); if (ib) ib.onclick = async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; render(); };
}
async function save() { const st = (await db.kvGet('settings').catch(() => null)) || {}; Object.assign(st, { theme: S.theme, modeColors: S.modeColors, accent: S.accent, autoStrava: S.autoStrava, stravaImport: S.stravaImport, kraftRest: S.kraftRest }); await db.kvSet('settings', st).catch(() => {}); }
function settings() {
  const s = document.createElement('div'); s.className = 'psheet'; document.body.append(s);
  const draw = () => {
    s.innerHTML = `<div class="psheetin"><div class="label">Settings</div>
      <h3 class="ksec">Appearance</h3><div class="pseg" id="tSeg">${[['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']].map(([k, l]) => `<button data-th="${k}" class="${(S.theme || 'dark') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <h3 class="ksec">Colours</h3>
      <label class="prow">Own colour per mode<input id="tMc" type="checkbox" class="toggle" ${S.modeColors !== false ? 'checked' : ''}></label>
      <div class="hsw" ${S.modeColors !== false ? 'hidden' : ''}>${Object.entries(ACCENTS).map(([k, c]) => `<button data-ac="${k}" class="${(S.accent || 'orange') === k ? 'on' : ''}" style="background:${c[0]}" aria-label="${k}"></button>`).join('')}</div>
      <h3 class="ksec">Strava</h3>
      <label class="prow">Upload automatically after saving<input id="tSt" type="checkbox" class="toggle" ${S.autoStrava ? 'checked' : ''}></label>
      <div class="prow" id="tStrava"><span>Strava account</span><button class="btn ghost ksmall" id="tConn">Connect</button></div>
      <label class="prow" id="tImpRow" hidden>Import my Strava activities automatically<input id="tImp" type="checkbox" class="toggle" ${S.stravaImport !== false ? 'checked' : ''}></label>
      <p class="hint" id="tImpHint" hidden>Reconnect Strava to import your activities.</p>
      <h3 class="ksec">Strength: rest between sets</h3><div class="pseg" id="tRest">${[60, 90, 120, 180].map(n => `<button data-rest="${n}" class="${(+S.kraftRest || 90) === n ? 'on' : ''}">${n < 120 ? n + ' s' : n / 60 + ' min'}</button>`).join('')}</div>
      <h3 class="ksec">Devices</h3>
      <p class="phint">For indoor rides, the smart trainer, heart rate strap and Zwift Click connect on the Indoor page (Indoor trainer → Sensors). Bluetooth does not carry over from page to page, so connect them there.</p>
      <a class="hrow hlink" href="pure.html#sensors" id="tDev"><div><b>Indoor trainer: Sensors</b><small>Trainer, heart rate, Zwift Click</small></div><i>›</i></a>
      <p class="phint">Click v2: open it in the Zwift app once a day, or it drops after a minute.</p>
      <h3 class="ksec">More</h3>
      <a class="hrow hlink" href="profil.html"><div><b>My data</b><small>Weight, FTP, heart rate, export</small></div><i>›</i></a>
      <a class="hrow hlink" href="datenschutz.html"><div><b>Privacy</b></div><i>›</i></a>
      <div class="pfoot"><button class="btn" id="tOk">Done</button></div></div>`;
    $('#tSt', s).onchange = e => { S.autoStrava = e.target.checked; save(); };
    // the tap opens Strava's login directly (no await before it, otherwise the iPhone blocks the window)
    $('#tImp', s).onchange = e => { S.stravaImport = e.target.checked; save(); };
    // connected before 17.11. = no permission to read activities: "Reconnect" asks Strava again
    import('./stravaup.js').then(async m => { const b = $('#tConn', s); if (!b) return; let st = {};
      const show = x => { st = x; if (!x.configured) { $('#tStrava', s).hidden = true; return; } $('#tImpRow', s).hidden = !x.connected; $('#tImpHint', s).hidden = !x.connected || x.canImport;
        if (x.connected && x.canImport) { b.textContent = 'Connected ✓'; b.disabled = true; } else if (x.connected) b.textContent = 'Reconnect'; };
      b.onclick = async () => { const re = !!st.connected; b.textContent = 'Waiting …'; const ok = await m.stravaConnect(re); b.textContent = re ? 'Reconnect' : 'Connect'; if (ok) show(await m.stravaStatus()); };
      show(await m.stravaStatus()); });
    s.querySelectorAll('[data-rest]').forEach(b => b.onclick = () => { S.kraftRest = +b.dataset.rest; save(); draw(); });
    s.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { S.theme = b.dataset.th; applyTheme(S, null); save(); draw(); });
    $('#tMc', s).onchange = e => { S.modeColors = e.target.checked; save(); draw(); render(); };
    s.querySelectorAll('[data-ac]').forEach(b => b.onclick = () => { S.accent = b.dataset.ac; applyTheme(S, null); save(); draw(); render(); });
    $('#tOk', s).onclick = () => s.remove();
  };
  s.onclick = e => { if (e.target === s) s.remove(); }; draw();
}
await load(); render(); nav('home');
import('./actimport.js').then(m => m.autoImport(S)).then(async r => { if (r?.added) { await load(); render(); } }).catch(() => {}); // new Strava activities, at most every 30 min
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
