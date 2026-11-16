// RIDEFRAME main menu on the phone (handy.html, start of the installed app and the Android app).
// Freddy 16.11.: one clear menu, every mode its own big card with colour and icon (ride outside, run, indoor trainer,
// routes & 3D world, strength); the week at a glance; settings for light/dark and colours.
import { db } from './db.js';
import { fmtTime, fmtNum, esc, twoWeeks, weekStat } from './util.js';
import { MODES, ACCENTS, icon, applyTheme } from './theme.js';

const el = document.getElementById('handy'), $ = (s, r = document) => r.querySelector(s);
let S = {}, acc = null, rides = [], kraft = [], installEvt = null, pic = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; render(); });

async function load() {
  S = (await db.kvGet('settings').catch(() => null)) || {};
  applyTheme(S, null);
  rides = (await db.all('rides').catch(() => [])).filter(r => r.routeId !== 'demo').sort((a, b) => b.date - a.date);
  kraft = (await db.kvGet('kraft').catch(() => null)) || [];
  pic = await db.kvGet('profilePic').catch(() => null);
  try { acc = (await import('./account.js')).account(); } catch {}
}
const modeOf = r => r.routeId === 'run' || r.sport === 'run' ? 'run' : r.routeId === 'outdoor' ? 'ride' : r.routeId === 'pure' ? 'trainer' : 'world';
const day = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const pace = (d, s) => d > 0 ? (x => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')} /km`)(s / d * 1000) : '';
const kmTxt = r => `${fmtNum(r.distance / 1000, 1)} km`;

function render() {
  const R2 = twoWeeks(rides), K2 = twoWeeks(kraft, k => k.start || k.date), nb = l => l.filter(r => modeOf(r) !== 'run').length, nr = l => l.filter(r => modeOf(r) === 'run').length, km = l => Math.round(l.reduce((a, r) => a + r.distance, 0) / 1000);
  const card = m => `<a class="hmode" href="${MODES[m].href}" style="--mc:${MODES[m].color};--mcl:${MODES[m].light}">${icon(m, 'hico')}<b>${MODES[m].name}</b><i>›</i></a>`;
  el.innerHTML = `<header class="ptop"><div class="pbrand" style="font-size:22px">RIDE<span>FRAME</span></div>
      <button class="ppill ${acc ? 'on' : ''}" id="hAcc"><i></i><span class="pname">${acc ? esc(acc.name) : 'Sign in'}</span></button>
      <button class="pgear" id="hSet" title="Settings" aria-label="Settings">${icon('gear', 'gico')}</button></header>
    ${installEvt && !window.__rfNative ? `<button class="btn ghost" id="hInstall">Install as app</button>` : ''}
    <section class="hweek"><div class="hwhead"><span class="label">This week</span><span class="wdl">▲▼ vs last week</span></div><div class="kstats">
      ${weekStat(nb(R2.cur), nb(R2.prev), 'Rides')}${weekStat(nr(R2.cur), nr(R2.prev), 'Runs')}${weekStat(km(R2.cur), km(R2.prev), 'km')}${weekStat(K2.cur.length, K2.prev.length, 'Strength')}</div></section>
    <a class="hprof" href="profil.html">${pic ? `<img src="${pic}" alt="">` : icon('user', 'hpi')}<span><b>My profile</b><small>Fitness, bests, stats</small></span><i>›</i></a>
    <nav class="hmodes">${['ride', 'run', 'trainer', 'world', 'kraft'].map(card).join('')}</nav>
    ${rides.length || kraft.length ? `<h3 class="ksec">Recent</h3>${recent().join('')}` : ''}`;
  $('#hAcc').onclick = async () => { const a = await import('./account.js'); await a.accountModal({ settings: S }, async () => { await load(); render(); }); };
  $('#hSet').onclick = settings;
  const ib = $('#hInstall'); if (ib) ib.onclick = async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; render(); };
}
/** the last activities of all modes, newest first */
function recent() {
  const all = [...rides.map(r => ({ t: r.date, m: modeOf(r), name: r.workout && r.routeId !== 'demo' && ['outdoor', 'run', 'pure'].includes(r.routeId) ? r.workout : r.routeName || MODES[modeOf(r)].short,
    val: (modeOf(r) === 'run' ? [kmTxt(r), pace(r.distance, r.duration), fmtTime(r.duration)] : [kmTxt(r), fmtTime(r.duration), r.avgPower > 0 && `${r.avgPower} W avg`]).filter(Boolean).join(' · ') })),
    ...kraft.map(k => { const n = (k.ex || []).reduce((a, x) => a + x.sets.filter(y => y.done).length, 0); return { t: k.start || k.date, m: 'kraft', name: k.name, val: `${fmtTime(k.dur || 0)} · ${n} ${n === 1 ? 'set' : 'sets'}` }; })].sort((a, b) => b.t - a.t).slice(0, 6);
  return all.map(x => `<a class="hrow" href="${x.m === 'world' ? './?desktop' : MODES[x.m].href + (x.m === 'kraft' || x.m === 'trainer' ? '' : (MODES[x.m].href.includes('?') ? '&' : '?') + 'list')}" style="--mc:${MODES[x.m].color};--mcl:${MODES[x.m].light}">${icon(x.m, 'rico')}<div><b>${esc(x.name)}</b><small>${x.val}</small></div><span>${day(x.t)}</span></a>`);
}
async function save() { const st = (await db.kvGet('settings').catch(() => null)) || {}; Object.assign(st, { theme: S.theme, modeColors: S.modeColors, accent: S.accent, autoStrava: S.autoStrava, kraftRest: S.kraftRest }); await db.kvSet('settings', st).catch(() => {}); }
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
      <h3 class="ksec">Strength: rest between sets</h3><div class="pseg" id="tRest">${[60, 90, 120, 180].map(n => `<button data-rest="${n}" class="${(+S.kraftRest || 90) === n ? 'on' : ''}">${n < 120 ? n + ' s' : n / 60 + ' min'}</button>`).join('')}</div>
      <h3 class="ksec">More</h3>
      <a class="hrow hlink" href="profil.html"><div><b>My data</b><small>Weight, FTP, heart rate, export</small></div><i>›</i></a>
      <a class="hrow hlink" href="datenschutz.html"><div><b>Privacy</b></div><i>›</i></a>
      <div class="pfoot"><button class="btn" id="tOk">Done</button></div></div>`;
    $('#tSt', s).onchange = e => { S.autoStrava = e.target.checked; save(); };
    // the tap opens Strava's login directly (no await before it, otherwise the iPhone blocks the window)
    import('./stravaup.js').then(async m => { const b = $('#tConn', s); if (!b) return; const show = st => { if (!st.configured) $('#tStrava', s).hidden = true; else if (st.connected) { b.textContent = 'Connected ✓'; b.disabled = true; } };
      b.onclick = async () => { b.textContent = 'Waiting …'; const ok = await m.stravaConnect(); b.textContent = 'Connect'; if (ok) show(await m.stravaStatus()); };
      show(await m.stravaStatus()); });
    s.querySelectorAll('[data-rest]').forEach(b => b.onclick = () => { S.kraftRest = +b.dataset.rest; save(); draw(); });
    s.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { S.theme = b.dataset.th; applyTheme(S, null); save(); draw(); });
    $('#tMc', s).onchange = e => { S.modeColors = e.target.checked; save(); draw(); render(); };
    s.querySelectorAll('[data-ac]').forEach(b => b.onclick = () => { S.accent = b.dataset.ac; applyTheme(S, null); save(); draw(); render(); });
    $('#tOk', s).onclick = () => s.remove();
  };
  s.onclick = e => { if (e.target === s) s.remove(); }; draw();
}
await load(); render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
