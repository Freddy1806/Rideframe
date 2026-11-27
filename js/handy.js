// RIDEFRAME Today on the phone (handy.html, start of the installed app and the Android app).
// Freddy 16.11.: one clear menu, every mode its own big card with colour and icon (ride outside, run, indoor trainer,
// routes & 3D world, strength); the week at a glance; settings for light/dark and colours.
// 25.11. (owner: "komplett neu denken, so wie das Garmin auch macht … eher so dein Trainingscoach"): the start page is Today:
// readiness, today's planned session with Start and the week, what changed (js/today.js), then the arrangeable cards
// (js/cards.js). Recording stays one tap away in the compact Record row.
import { db } from './db.js';
import { esc, markHome } from './util.js';
markHome('handy');
import { MODES, ACCENTS, icon, applyTheme } from './theme.js';
import { loadActs, detail } from './feed.js';
import { nav } from './nav.js';

const el = document.getElementById('handy'), $ = (s, r = document) => r.querySelector(s);
let WK = null, runs = [], S = {}, acc = null, rides = [], kraft = [], installEvt = null, D = null;
// 23.11. (owner: "I don't know why it is not in"): with a paired watch, the watch setup is on the start page too. The last answer is kept
// on this phone, so the card is there at once on the next start; the account's watch list (js/watchpair.js) checks it after each render.
const WKEY = 'rf-watch-paired';
let watches = (() => { try { const v = JSON.parse(localStorage.getItem(WKEY) || 'null'); return v && Array.isArray(v.l) ? v : null; } catch { return null; } })(); // { u: account name, l: [{ label }] }
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; render(); });

async function load() {
  S = (await db.kvGet('settings').catch(() => null)) || {};
  applyTheme(S, null);
  D = await loadActs(); rides = D.acts.filter(a => !a.kraft); kraft = D.acts.filter(a => a.kraft); // one loader for all sports (feed.js)
  try { acc = (await import('./account.js')).account(); } catch {}
  try { const W = await import('./workouts.js'); W.setMyWorkouts(S.myWorkouts); await (await import('./myworkouts-store.js')).loadPersonal(); WK = W; } catch { WK = null; } // the shape of a planned workout (27.11.: Today's training)
  if (!load.coach) { load.coach = import('./coachworkouts.js').then(m => m.loadCoach({ timeout: 2500 })).catch(() => {}); }
  try { const R = await import('./runworkouts.js'); runs = (await R.loadRuns()).map(w => ({ id: w.id, min: R.runMinutes(w), svg: R.runSVG(w, 40) })); } catch { runs = []; }
  if (acc && !load.prefs) { load.prefs = true; import('./live.js').then(l => l.getPrefs()).then(p => { S.liveShow = p.show; S.liveAuto = p.auto; }).catch(() => {}); } // the account's switches, so a later save keeps them
}

function render() {
  const mcs = m => S.oneColor !== true ? `--mc:${MODES[m].color};--mcl:${MODES[m].light}` : '--mc:var(--accent);--mcl:var(--accent)';
  const card = m => `<a class="hmode" href="${MODES[m].href}" style="${mcs(m)}" aria-label="${MODES[m].name}">${icon(m, 'hico')}<b>${MODES[m].short}</b></a>`;
  el.innerHTML = `<header class="ptop"><div class="pbrand" style="font-size:22px">RIDE<span>FRAME</span></div>
      <button class="ppill ${acc ? 'on' : ''}" id="hAcc"><i></i><span class="pname">${acc ? esc(String(acc.name).trim().split(/[\s._@-]+/)[0] || acc.name) : 'Sign in'}</span></button>
      <button class="pgear hbtn hbell" id="hBell" title="Updates" aria-label="Updates">${BELL}<i class="hdot" id="hDot" hidden></i></button>
      <button class="pgear" id="hSet" title="Settings" aria-label="Settings">${icon('gear', 'gico')}</button></header>
    ${stv?.configured && (stv.connected ? !stv.canImport : !stvHide()) ? `<button class="hstrava" id="hStrava">${stv.connected ? '' : '<i id="hStravaX" role="button" aria-label="Hide">✕</i>'}<b>${stv.connected ? 'Strava import is off' : 'Strava is not connected'}</b><small>${stv.connected ? 'Tap to reconnect and allow reading your activities, then everything you upload to Strava shows up here.' : 'Tap to connect, then everything you upload to Strava shows up here.'}</small></button>` : stvMsg ? `<p class="hint" role="status">${esc(stvMsg)}</p>` : ''}
    ${installEvt && !window.__rfNative ? `<button class="btn ghost" id="hInstall">Install as app</button>` : ''}
    <div class="tdhello" id="hHello"></div><div id="hHero"></div><div id="hPlan"></div>
    <nav class="hmodes hstart" aria-labelledby="hRecH"><h2 class="label" id="hRecH">Record</h2><div>${['ride', 'run', 'trainer', 'world', 'kraft'].map(card).join('')}</div></nav>
    <div id="hOv"></div>`;
  const again = async () => { await load(); render(); };
  const ctx = { acts: D.acts, P: D.P, S, acc, openAct: a => detail(a, D.P, again), signIn: () => $('#hAcc').click(),
    hosts: { friends: box => { box.innerHTML = '<div id="hLive" class="live"></div>'; liveStrip(box.firstElementChild); }, watch: box => { box.innerHTML = `<div id="hWatch">${watchCard()}</div>`; wireWatch(box); } } }; // the cards (not in the page yet, so the boxes are handed over): js/cards.js "Friends" and "Watch" are these two
  ctx.shape = e => { if (e.kind === 'ride' && e.ref && WK) { const w = WK.workoutById(e.ref); return w ? { svg: WK.workoutSVG(w, null, 40), min: Math.round(WK.workoutDuration(w) / 60) } : null; }
    if (e.kind === 'run' && e.ref) return runs.find(r => r.id === e.ref) || null; return null; };
  ctx.onInsights = lines => updatesIn(lines);
  todayP = import('./today.js').then(m => m.mountToday({ hello: $('#hHello'), hero: $('#hHero'), plan: $('#hPlan') }, ctx)).catch(e => console.warn('Today:', e));
  $('#hBell').onclick = async () => { const U = await import('./updates.js'); U.openUpdates(upd, () => dot()); };
  dot();
  import('./cards.js').then(m => m.mountOverview($('#hOv'), ctx)).catch(e => console.warn('Cards:', e));
  $('#hAcc').onclick = async () => { const a = await import('./account.js'); await a.accountModal({ settings: S }, async () => { await load(); render(); }); };
  $('#hSet').onclick = settings;
  checkWatch();
  const ib = $('#hInstall'); if (ib) ib.onclick = async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; render(); };
}
/* "Updates" (27.11.): the insight lines as a history behind the bell, a dot while something is new (js/updates.js) */
const BELL = '<svg class="gico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
let upd = null, todayP = null;
async function updatesIn(lines) {
  const U = await import('./updates.js'); upd = U.merge(upd || await U.loadStore(), lines, acc?.name || ''); await U.saveStore(upd); dot();
}
function dot() { const d = $('#hDot'); if (!d) return; import('./updates.js').then(U => { const n = U.unseen(upd); d.hidden = !n; $('#hBell')?.setAttribute('aria-label', n ? `Updates, ${n} new` : 'Updates'); }); }
/* the watch card on the start page: only signed in with a paired watch; opens the same editor as Settings → Watch */
function watchCard() {
  const l = acc && watches?.u === acc.name ? watches.l : []; if (!l.length) return '';
  const w = l[0], more = l.length > 1 ? ` +${l.length - 1}` : '';
  return `<button type="button" class="hrow hlink hwatch" id="hWcfg">${icon('watch', 'rico')}<div><b>Watch · Screens &amp; workouts</b><small>${esc(w.label || 'Garmin watch')}${more} · data fields per sport, workouts</small></div><i>›</i></button>`;
}
function wireWatch(root = document) { const b = $('#hWcfg', root); if (b) b.onclick = () => import('./watchcfg.js').then(m => m.openEditor()); }
let watchAsk = 0;
function checkWatch() {
  if (!acc) { if (watches) { watches = null; try { localStorage.removeItem(WKEY); } catch {} } return; }
  if (Date.now() - watchAsk < 30e3) return; watchAsk = Date.now(); // a re-render does not ask the server again right away
  import('./watchpair.js').then(m => m.pairedWatches()).then(l => {
    if (!l) return; // offline / server error: keep what this phone knew
    const v = { u: acc?.name, l: l.map(w => ({ label: w.label })) }, same = JSON.stringify(v) === JSON.stringify(watches);
    watches = v; try { localStorage.setItem(WKEY, JSON.stringify(v)); } catch {}
    const box = $('#hWatch'); if (!same && box) { box.innerHTML = watchCard(); wireWatch(); }
  }).catch(() => {});
}
/* "Riding now" (17.11.) and the friends with a green dot: read-only here (the 3D ride is on the laptop): invites and riding friends
   with "Join on your laptop" + Copy link, a row of faces with dots that opens the list of every friend */
let liveF = null, liveStop = null;
const FR_FACES = 5;
function liveStrip(el = $('#hLive')) {
  if (!el || !acc) return;
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
      <h3 class="ksec" id="tActs">Activities &amp; Strava</h3>
      <div class="tacts"><button type="button" class="hrow hlink" id="tAdd">${icon('plus', 'rico')}<div><b>Add activity</b><small>Any sport, entered by hand</small></div><i>›</i></button>
      <button type="button" class="hrow hlink" id="tImpS">${icon('list', 'rico')}<div><b>Import from Strava</b><small id="tImpMsg">Your rides, runs and workouts from Strava</small></div><i>›</i></button>
      <button type="button" class="hrow hlink" id="tFile">${icon('other', 'rico')}<div><b>Import file</b><small>.gpx, .tcx or .fit from any watch</small></div><i>›</i></button></div>
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
      <a class="hrow hlink" href="remote.html?auto" id="tRemote"><div><b>Remote</b><small>Control RIDEFRAME on your laptop with this phone</small></div><i>›</i></a>
      <h3 class="ksec" id="tWatchSec">Watch</h3>
      <div id="tWatch"></div><div id="tWcfg"></div><div id="tMcp"></div>
      <h3 class="ksec">Bathroom scale</h3><div id="tScale"></div>
      <h3 class="ksec">More</h3>
      <a class="hrow hlink" href="profil.html"><div><b>My data</b><small>Weight, FTP, heart rate, export</small></div><i>›</i></a>
      <a class="hrow hlink" href="body.html"><div><b>Body &amp; weight</b><small>Weigh-ins, trend, goal</small></div><i>›</i></a>
      <a class="hrow hlink" href="datenschutz.html"><div><b>Privacy</b></div><i>›</i></a>
      <div class="pfoot"><button class="btn" id="tOk">Done</button></div></div>`;
    $('#tSt', s).onchange = e => { S.autoStrava = e.target.checked; save(); };
    // 27.11.: adding and importing activities lives here (and behind the "+" of the Activities page), not on top of the feed
    let AA = null; import('./addact.js').then(m => { AA = m; }).catch(() => {}); // loaded up front: "Import file" opens the file picker inside the tap
    const added = async (rec, t) => { stvMsg = t; await load(); render(); };
    $('#tAdd', s).onclick = () => { if (!AA) return; s.remove(); AA.addSheet({ acts: D.acts, onSaved: added }); };
    $('#tFile', s).onclick = () => { if (!AA) return; s.remove(); AA.addSheet({ acts: D.acts, onSaved: added, file: true }); };
    $('#tImpS', s).onclick = async () => { const msg = $('#tImpMsg', s), su = await import('./stravaup.js'), x = await su.stravaStatus();
      if (!x.configured) { msg.textContent = 'Strava is not set up on this server.'; return; }
      if (!x.connected || !x.canImport) { msg.textContent = 'Waiting for Strava …'; if (!(await su.stravaConnect(!!x.connected))) { msg.textContent = 'Not connected to Strava.'; return; } }
      msg.textContent = 'Reading Strava …'; const r = await (await import('./actimport.js')).importStrava({ onState: t => { msg.textContent = t; } }); msg.textContent = r.text; if (r.added || r.linked) { await load(); render(); } };
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
    import('./watchpair.js').then(m => m.watchRow($('#tWatch', s), async () => { s.remove(); watchAsk = 0; const a = await import('./account.js'); await a.accountModal({ settings: S }, async () => { await load(); render(); }); })).catch(() => {});
    import('./watchcfg.js').then(m => m.cfgRow($('#tWcfg', s))).catch(() => {}); // Watch screens & workouts (signed in only)
    import('./mcplink.js').then(m => m.mcpRow($('#tMcp', s))).catch(() => {}); // Claude connector (signed in only, tools/mcp-api.mjs)
    import('./scaleset.js').then(m => m.scaleSection($('#tScale', s), { signIn: async () => { s.remove(); const a = await import('./account.js'); await a.accountModal({ settings: S }, async () => { await load(); render(); }); } })).catch(() => {}); // 25.11.: the household scale (js/scaleset.js)
    $('#tOk', s).onclick = () => { s.remove(); watchAsk = 0; checkWatch(); }; // a watch paired or removed in Settings shows on the start page right away
  };
  s.onclick = e => { if (e.target === s) { s.remove(); watchAsk = 0; checkWatch(); } }; draw();
}
let stv = null, stvMsg = ''; const stvHide = () => { try { return localStorage.getItem('rf-strava-hint') === 'off'; } catch { return false; } };
await load(); render(); nav('home');
// handy.html#settings, #settings-watch, #settings-coach: Settings opened (and scrolled there) from the cards and the Today page's first steps
const hashOpen = () => { const m = /^#settings(?:-(watch|coach))?$/.exec(location.hash); if (!m) return; history.replaceState(null, '', location.pathname + location.search); settings();
  const t = m[1] === 'watch' ? '#tWatchSec' : m[1] === 'coach' ? '#tMcp' : null; if (t) setTimeout(() => document.querySelector(t)?.scrollIntoView({ block: 'start' }), 300); };
addEventListener('hashchange', hashOpen); hashOpen();
{ const q = new URLSearchParams(location.search), d = q.get('plan'); // handy.html?plan=YYYY-MM-DD (old Training links): that day's planner
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) { history.replaceState(null, '', location.pathname); todayP?.then(t => t?.plan(q.get('add') ? 'day' : 'week', q.get('add') ? { day: d } : d)); } }
const pull = () => acc && import('./account.js').then(async a => { const n = kraft.length, m = await a.pullRides().catch(() => 0); await a.syncKraft(); await load(); if (m || kraft.length !== n) render(); }).catch(() => {}); // strength from the watch or another device, activities the host imported from Strava (tools/strava-auto.mjs)
pull();
const stravaIn = async force => { const m = await import('./actimport.js'), r = force ? await m.importStrava() : await m.autoImport(S); if (r?.added) { stvMsg = r.text.replace('.', ' from Strava.'); await load(); render(); } else if (force && r?.text) { stvMsg = r.text; render(); } };
import('./stravaup.js').then(async su => { stv = await su.stravaStatus(); if (stv.configured && (!stv.connected || !stv.canImport)) render(); else stravaIn(false); }).catch(() => {}); // new Strava activities, at most every 5 min
document.addEventListener('click', async e => { if (e.target.closest?.('#hStravaX')) { try { localStorage.setItem('rf-strava-hint', 'off'); } catch {} return render(); } if (!e.target.closest?.('#hStrava')) return; const su = await import('./stravaup.js'), ok = await su.stravaConnect(!!stv?.connected); stv = await su.stravaStatus(); render(); if (ok && stv.canImport) stravaIn(true); });
const again = () => { if (document.hidden) return; pull(); if (stv?.canImport) stravaIn(false).catch(() => {}); }; // back from the Strava app or back online: look again (at most every 5 min)
document.addEventListener('visibilitychange', again); addEventListener('online', again);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
