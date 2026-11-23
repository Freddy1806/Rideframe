// RIDEFRAME main menu on the phone (handy.html, start of the installed app and the Android app).
// Freddy 16.11.: one clear menu, every mode its own big card with colour and icon (ride outside, run, indoor trainer,
// routes & 3D world, strength); the week at a glance; settings for light/dark and colours.
import { db } from './db.js';
import { esc, twoWeeks, weekStat, markHome } from './util.js';
markHome('handy');
import { sportOf, isBike } from './fitness.js';
import { MODES, ACCENTS, icon, applyTheme } from './theme.js';
import { loadActs, rowHtml, wireRows } from './feed.js';
import { nav } from './nav.js';

const el = document.getElementById('handy'), $ = (s, r = document) => r.querySelector(s);
let myW = [], S = {}, acc = null, rides = [], kraft = [], installEvt = null, D = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; render(); });

async function load() {
  S = (await db.kvGet('settings').catch(() => null)) || {};
  applyTheme(S, null);
  D = await loadActs(); rides = D.acts.filter(a => !a.kraft); kraft = D.acts.filter(a => a.kraft); // one loader for all sports (feed.js)
  try { acc = (await import('./account.js')).account(); } catch {}
  try { const W = await import('./workouts.js'); W.setMyWorkouts(S.myWorkouts); await (await import('./myworkouts-store.js')).loadPersonal(); // your own workouts on the start page (owner 19.11.: "easy und leicht finden")
    myW = W.allWorkouts().filter(w => w.mine || w.personal).map(w => ({ id: w.id, name: w.name, min: Math.round(W.workoutDuration(w) / 60) })); } catch { myW = []; }
  if (acc && !load.prefs) { load.prefs = true; import('./live.js').then(l => l.getPrefs()).then(p => { S.liveShow = p.show; S.liveAuto = p.auto; }).catch(() => {}); } // the account's switches, so a later save keeps them
}

function render() {
  const R2 = twoWeeks(rides), K2 = twoWeeks(kraft), nb = l => l.filter(isBike).length, nr = l => l.filter(r => sportOf(r) === 'run').length, km = l => Math.round(l.reduce((a, r) => a + r.distance, 0) / 1000);
  const mcs = m => S.oneColor !== true ? `--mc:${MODES[m].color};--mcl:${MODES[m].light}` : '--mc:var(--accent);--mcl:var(--accent)';
  const card = m => `<a class="hmode" href="${MODES[m].href}" style="${mcs(m)}">${icon(m, 'hico')}<b>${MODES[m].name}</b><i>›</i></a>`;
  el.innerHTML = `<header class="ptop"><div class="pbrand" style="font-size:22px">RIDE<span>FRAME</span></div>
      <button class="ppill ${acc ? 'on' : ''}" id="hAcc"><i></i><span class="pname">${acc ? esc(acc.name) : 'Sign in'}</span></button>
      <button class="pgear" id="hSet" title="Settings" aria-label="Settings">${icon('gear', 'gico')}</button></header>
    <div id="hLive" class="live"></div>
    ${stv?.configured && (stv.connected ? !stv.canImport : !stvHide()) ? `<button class="hstrava" id="hStrava">${stv.connected ? '' : '<i id="hStravaX" role="button" aria-label="Hide">✕</i>'}<b>${stv.connected ? 'Strava import is off' : 'Strava is not connected'}</b><small>${stv.connected ? 'Tap to reconnect and allow reading your activities, then everything you upload to Strava shows up here.' : 'Tap to connect, then everything you upload to Strava shows up here.'}</small></button>` : stvMsg ? `<p class="hint" role="status">${esc(stvMsg)}</p>` : ''}
    ${installEvt && !window.__rfNative ? `<button class="btn ghost" id="hInstall">Install as app</button>` : ''}
    <section class="hweek"><div class="hwhead"><span class="label">This week</span><span class="wdl">▲▼ vs last week</span></div><div class="kstats">
      ${weekStat(nb(R2.cur), nb(R2.prev), 'Rides')}${weekStat(nr(R2.cur), nr(R2.prev), 'Runs')}${weekStat(km(R2.cur), km(R2.prev), 'km')}${weekStat(K2.cur.length, K2.prev.length, 'Strength')}</div></section>
    <nav class="hmodes">${['ride', 'run', 'trainer', 'world', 'kraft'].map(card).join('')}</nav>
    <section class="hmyw"><h3 class="ksec">My workouts</h3>${myW.slice(0, 4).map(w => `<a class="hrow hlink" href="pure.html?workout=${encodeURIComponent(w.id)}" style="${mcs('trainer')}"><div><b>${esc(w.name)}</b><small>${w.min} min · indoor trainer</small></div><i>›</i></a>`).join('')}
      <a class="hall" href="pure.html?workout=">${myW.length > 4 ? `All ${myW.length} and the standard workouts ›` : myW.length ? 'All workouts · build a new one ›' : 'Build your own workout or pick a standard one ›'}</a></section>
    <a class="hrow hlink hremote" href="remote.html?auto" id="hRemote"><div><b>Remote</b><small>Control RIDEFRAME on your laptop with this phone</small></div><i>›</i></a>
    ${D.acts.length ? `<section class="hrecent"><h3 class="ksec">Recent</h3>${D.acts.slice(0, 3).map(a => rowHtml(a, D.P)).join('')}<a class="hall" href="aktivitaeten.html">All activities ›</a></section>` : ''}`;
  wireRows(el, D, async () => { await load(); render(); });
  $('#hAcc').onclick = async () => { const a = await import('./account.js'); await a.accountModal({ settings: S }, async () => { await load(); render(); }); };
  $('#hSet').onclick = settings;
  liveStrip();
  const ib = $('#hInstall'); if (ib) ib.onclick = async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; render(); };
}
/* "Riding now" (17.11.) and the friends with a green dot: read-only here (the 3D ride is on the laptop): invites and riding friends
   with "Join on your laptop" + Copy link, a row of faces with dots that opens the list of every friend */
let liveF = null, liveStop = null;
const FR_FACES = 5;
function liveStrip() {
  const el = $('#hLive'); if (!el || !acc) return;
  import('./live.js').then(live => {
    const html = F => {
      const rs = F.friends.filter(f => f.state === 'riding' && f.ride).map(live.asRider), faces = F.friends.slice(0, FR_FACES), more = F.friends.length - faces.length;
      return F.friends.length || F.invites.length ? `${F.invites.map(v => live.inviteCard(v, true)).join('')}${live.headHTML(F.friends)}${live.ridersGrid(rs, { phone: true })}
        ${F.friends.length ? `<button type="button" class="frbar" id="hFriends"><span class="frbt"><b>Friends</b><small>${live.onlineCount(F.friends)} online · see all</small></span>
          <span class="frstack">${faces.map(f => live.friendFace(f)).join('')}${more > 0 ? `<span class="frplus">+${more}</span>` : ''}</span></button>` : ''}` : '';
    };
    const copy = async (b, link) => { try { await navigator.clipboard.writeText(link); b.textContent = 'Copied ✓'; } catch { b.textContent = 'Copy failed'; prompt('Open this link on your laptop:', link); }
      setTimeout(() => { if (b.isConnected) b.textContent = 'Copy link'; }, 2500); };
    const wire = F => {
      el.querySelectorAll('.lvcopy').forEach(b => b.onclick = () => { const f = F.friends.find(x => x.ride?.id === b.closest('[data-sid]')?.dataset.sid); if (f) copy(b, live.joinLink(live.asRider(f))); });
      el.querySelectorAll('[data-inv]').forEach(c => { const v = F.invites.find(x => x.id === c.dataset.inv); if (!v) return;
        c.querySelector('.lvicopy').onclick = e => copy(e.currentTarget, `${location.origin}/?join=${v.code}`);
        c.querySelector('.lvix').onclick = () => { live.dismissInvite(v.id); c.remove(); }; });
      const fb = $('#hFriends', el); if (fb) fb.onclick = () => friendsSheet(live, F, copy);
    };
    const draw = async () => { const F = await live.friendsNow(); if (!F || !el.isConnected) return; liveF = F; live.reveal(el, html(F)); wire(F); };
    if (liveF) { live.reveal(el, html(liveF)); el.classList.add('on'); wire(liveF); } // a re-render keeps the strip without a jump
    liveStop?.(); liveStop = live.every15(el, draw);
    live.startOnline({ show: () => S.liveShow !== false, onBeat: j => { if (j.invites?.length) draw(); } });
  }).catch(() => {});
}
function friendsSheet(live, F, copy) {
  const s = document.createElement('div'); s.className = 'psheet'; s.id = 'frSheet'; document.body.append(s);
  s.innerHTML = `<div class="psheetin"><div class="label">Friends · ${live.onlineCount(F.friends)} online</div>
    <div class="frlist">${F.friends.map(f => live.friendRow(f, null, f.state === 'riding' && f.ride ? `<button class="btn ghost ksmall frcopy" type="button" data-sid="${esc(f.ride.id)}">Copy link</button>` : '')).join('')}</div>
    <p class="phint">Riding friends: join on your laptop, the link opens it there.</p><div class="pfoot"><button class="btn" id="frOk">Done</button></div></div>`;
  s.querySelectorAll('.frcopy').forEach(b => b.onclick = () => { const f = F.friends.find(x => x.ride?.id === b.dataset.sid); if (f) copy(b, live.joinLink(live.asRider(f))); });
  $('#frOk', s).onclick = () => s.remove(); s.onclick = e => { if (e.target === s) s.remove(); };
}
async function save() { const st = (await db.kvGet('settings').catch(() => null)) || {}; Object.assign(st, { theme: S.theme, oneColor: S.oneColor, accent: S.accent, autoStrava: S.autoStrava, stravaImport: S.stravaImport, kraftRest: S.kraftRest, liveShow: S.liveShow, liveAuto: S.liveAuto }); await db.kvSet('settings', st).catch(() => {});
  import('./account.js').then(a => a.settingsChanged?.(st)).catch(() => {}); } // to the account too: the watch reads the rest time from there
function settings() {
  const s = document.createElement('div'); s.className = 'psheet'; document.body.append(s);
  const draw = () => {
    s.innerHTML = `<div class="psheetin"><div class="label">Settings</div>
      <h3 class="ksec">Appearance</h3><div class="pseg" id="tSeg">${[['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']].map(([k, l]) => `<button data-th="${k}" class="${(S.theme || 'dark') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <h3 class="ksec">Colours</h3>
      <label class="prow">Own colour per mode<input id="tMc" type="checkbox" class="toggle" ${S.oneColor !== true ? 'checked' : ''}></label>
      <div class="hsw" ${S.oneColor !== true ? 'hidden' : ''}>${Object.entries(ACCENTS).map(([k, c]) => `<button data-ac="${k}" class="${(S.accent || 'orange') === k ? 'on' : ''}" style="background:${c[0]}" aria-label="${k}"></button>`).join('')}</div>
      <h3 class="ksec">Strava</h3>
      <label class="prow">Upload automatically after saving<input id="tSt" type="checkbox" class="toggle" ${S.autoStrava ? 'checked' : ''}></label>
      <div class="prow" id="tStrava"><span>Strava account</span><button class="btn ghost ksmall" id="tConn">Connect</button></div>
      <label class="prow" id="tImpRow" hidden>Import my Strava activities automatically<input id="tImp" type="checkbox" class="toggle" ${S.stravaImport !== false ? 'checked' : ''}></label>
      <p class="hint" id="tImpHint" hidden>Reconnect Strava to import your activities.</p>
      <h3 class="ksec">Strength: rest between sets</h3><div class="pseg" id="tRest">${[60, 90, 120, 180].map(n => `<button data-rest="${n}" class="${(+S.kraftRest || 90) === n ? 'on' : ''}">${n < 120 ? n + ' s' : n / 60 + ' min'}</button>`).join('')}</div>
      <h3 class="ksec">Friends &amp; riding now</h3>
      ${acc ? `<label class="prow">Show me as online<input id="tLive" type="checkbox" class="toggle" ${S.liveShow !== false ? 'checked' : ''}></label>
      <label class="prow">Friends can join me without asking<input id="tLiveAuto" type="checkbox" class="toggle" ${S.liveAuto !== false ? 'checked' : ''}></label>
      <p class="phint" id="tLiveHint">Friends see a green dot while RIDEFRAME is open, and your route and kilometre while you ride in the 3D world. Off for joining = a short question in the ride first. Applies on every device.</p>`
      : '<p class="phint">Sign in to see which friends are riding right now and to show up for them.</p>'}
      <h3 class="ksec">Devices</h3>
      <p class="phint">For indoor rides, the smart trainer, heart rate strap and Zwift Click connect on the Indoor page (Indoor trainer → Sensors). Bluetooth does not carry over from page to page, so connect them there.</p>
      <a class="hrow hlink" href="pure.html#sensors" id="tDev"><div><b>Indoor trainer: Sensors</b><small>Trainer, heart rate, Zwift Click</small></div><i>›</i></a>
      <p class="phint">Click v2: open it in the Zwift app once a day, or it drops after a minute.</p>
      <div id="tWatch"></div><div id="tWcfg"></div>
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
    const liveSet = async (k, v) => { S[k === 'show' ? 'liveShow' : 'liveAuto'] = v; // only here and on the server (the account's settings file), never the whole phone settings over the laptop's
      db.kvGet('settings').then(st => db.kvSet('settings', { ...(st || {}), liveShow: S.liveShow, liveAuto: S.liveAuto })).catch(() => {});
      try { const l = await import('./live.js'), p = await l.putPrefs({ [k]: v }); S.liveShow = p.show; S.liveAuto = p.auto; l.startOnline({ show: () => S.liveShow !== false }); } catch { const h = $('#tLiveHint', s); if (h) h.textContent = 'Not saved on the server. Check your connection.'; } };
    $('#tLive', s)?.addEventListener('change', e => liveSet('show', e.target.checked));
    $('#tLiveAuto', s)?.addEventListener('change', e => liveSet('auto', e.target.checked));
    if (acc && !draw.synced) { draw.synced = true; import('./live.js').then(l => l.getPrefs()).then(p => { const same = (S.liveShow !== false) === p.show && (S.liveAuto !== false) === p.auto; S.liveShow = p.show; S.liveAuto = p.auto; if (!same && s.isConnected) draw(); }).catch(() => {}); }
    s.querySelectorAll('[data-rest]').forEach(b => b.onclick = () => { S.kraftRest = +b.dataset.rest; save(); draw(); });
    s.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { S.theme = b.dataset.th; applyTheme(S, null); save(); draw(); });
    $('#tMc', s).onchange = e => { S.oneColor = !e.target.checked; save(); draw(); render(); };
    s.querySelectorAll('[data-ac]').forEach(b => b.onclick = () => { S.accent = b.dataset.ac; applyTheme(S, null); save(); draw(); render(); });
    import('./watchpair.js').then(m => m.watchRow($('#tWatch', s), async () => { s.remove(); const a = await import('./account.js'); await a.accountModal({ settings: S }, async () => { await load(); render(); }); })).catch(() => {});
    import('./watchcfg.js').then(m => m.cfgRow($('#tWcfg', s))).catch(() => {}); // Watch screens & workouts (signed in only)
    $('#tOk', s).onclick = () => s.remove();
  };
  s.onclick = e => { if (e.target === s) s.remove(); }; draw();
}
let stv = null, stvMsg = ''; const stvHide = () => { try { return localStorage.getItem('rf-strava-hint') === 'off'; } catch { return false; } };
await load(); render(); nav('home');
const pull = () => acc && import('./account.js').then(async a => { const n = kraft.length, m = await a.pullRides().catch(() => 0); await a.syncKraft(); await load(); if (m || kraft.length !== n) render(); }).catch(() => {}); // strength from the watch or another device, activities the host imported from Strava (tools/strava-auto.mjs)
pull();
const stravaIn = async force => { const m = await import('./actimport.js'), r = force ? await m.importStrava() : await m.autoImport(S); if (r?.added) { stvMsg = r.text.replace('.', ' from Strava.'); await load(); render(); } else if (force && r?.text) { stvMsg = r.text; render(); } };
import('./stravaup.js').then(async su => { stv = await su.stravaStatus(); if (stv.configured && (!stv.connected || !stv.canImport)) render(); else stravaIn(false); }).catch(() => {}); // new Strava activities, at most every 5 min
document.addEventListener('click', async e => { if (e.target.closest?.('#hStravaX')) { try { localStorage.setItem('rf-strava-hint', 'off'); } catch {} return render(); } if (!e.target.closest?.('#hStrava')) return; const su = await import('./stravaup.js'), ok = await su.stravaConnect(!!stv?.connected); stv = await su.stravaStatus(); render(); if (ok && stv.canImport) stravaIn(true); });
const again = () => { if (document.hidden) return; pull(); if (stv?.canImport) stravaIn(false).catch(() => {}); }; // back from the Strava app or back online: look again (at most every 5 min)
document.addEventListener('visibilitychange', again); addEventListener('online', again);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
