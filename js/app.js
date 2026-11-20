import { trainingView } from './training.js';
import { markHome } from './util.js';
markHome('desktop'); // the phone pages' back arrow returns here (js/util.js appHome)
import { account, accountsAvailable, syncAccount, settingsChanged, accountModal } from './account.js';
import { db, uid } from './db.js';
import { readGoProGPS } from './gpmf.js';
import { buildTrack, improveElevation, parseGPX, STEP, eleAt } from './track.js';
import { Trainer, HeartRate } from './trainer.js';
import { makeDemoTrack, demoThumb } from './demo.js';
import { makeCoastTrack, loadRealTrack, makeBuiltinTrack, DESIGNED } from './routes.js';
import { gearsFrom, CASSETTES, parseRings } from './gears.js';
import { profileSVG, drawDetailProfile } from './profile.js';
import { RideSession, simulateRide } from './ride.js';
import { findSegments, segmentBests, SEG_KIND } from './segments.js';
import { dashboardHTML, wireDashboard } from './dashboard.js';
import { gameVersion } from './uebridge.js';
import { fovOf, FOV_MIN, FOV_MAX } from './fov.js';
import { fmtTime, fmtKm, fmtNum, esc, bestAvg } from './util.js';
import { openControllerTest } from './controller.js';
import { initRemote, openRemote, miniRemote } from './remotepad.js';
import { click } from './zwiftclick.js';
import { stravaButton } from './stravaup.js';
import { routeFns } from './tcx.js';
import { hudPrefs, hudControlsHTML, wireHudControls } from './hudprefs.js';
import { allWorkouts, setMyWorkouts, workoutById, workoutDuration, workoutSVG } from './workouts.js';
import { loadShared, sharedFor, shareRide, importShared, groupModal } from './share.js';
import { workoutOptions, wireRoutePick } from './myworkouts-ui.js';
import { loadPersonal } from './myworkouts-store.js';

const $ = s => document.querySelector(s);
const main = $('#main');

export const state = {
  settings: { riderKg: 75, bikeKg: 8.5, ftp: 250, cadence: 90, shiftMode: 'real', chainrings: '50,34', cassette: '11-34', wheel: 2105, realGear: '50x17', profileDone: false, difficulty: 100, downhill: 50, accent: 'orange', muteVideo: true, improveEle: true, ghost: 'best' },
  routes: [],
  rides: [],
  trainer: new Trainer(),
  hr: null,
  view: 'library',
};

const ACCENTS = { orange: '#ff5a1f', volt: '#d9ff3f', violet: '#8b6cff' };

// ---------------- built-in routes (no video) ----------------
const builtins = {};
const BUILTIN = {
  coast: () => { const track = makeCoastTrack(); return { id: 'coast', name: 'Rocky Coast', place: 'Threshold intervals · 4 climbs of 8–12 min · medieval villages by the sea', source: 'demo', parts: [], track, createdAt: 1, thumb: demoThumb(track, 1200) }; },
  demo: () => { const track = makeDemoTrack(); return { id: 'demo', name: 'Passo Demo', place: 'Built-in demo route · no video', source: 'demo', parts: [], track, createdAt: 0, thumb: demoThumb(track) }; },
};
Object.entries(DESIGNED).forEach(([id, D], k) => { BUILTIN[id] = () => { const track = makeBuiltinTrack(id);
  return { id, name: D.name, place: `${D.place} · ${(track.length / 1000).toFixed(0)} km · ${track.gain} m climb`, source: 'demo', parts: [], track, createdAt: 1.1 + k * 0.1, thumb: demoThumb(track, 1200) }; }; });
function getBuiltin(id) { return builtins[id] ||= BUILTIN[id](); }
function getDemoRoute() { return getBuiltin('demo'); }

// ---------------- boot ----------------
async function boot() {
  const saved = await db.kvGet('settings').catch(() => null);
  if (saved) Object.assign(state.settings, saved);
  state.trainer.pmOnly = state.settings.powerSource === 'pm'; // power meter only (js/ridesetup.js): RIDEFRAME never controls the trainer
  setMyWorkouts(state.settings.myWorkouts);
  const hasAcc = await accountsAvailable();
  if (hasAcc && account()) await syncAccount(state).catch(e => console.warn('Konto-Abgleich:', e.message));
  setMyWorkouts(state.settings.myWorkouts); // the account may have brought own workouts from another device
  await loadPersonal(); // personal workouts (js/myworkouts-store.js): the account's, or this browser's when signed out
  const params = new URLSearchParams(location.search);
  if (params.get('accent')) state.settings.accent = params.get('accent');
  applyAccent();
  // real Lofoten roads on their real terrain, present once the Mac has built them (assets/dem/<id>.json + .bin)
  const REAL = { kueste60: 'real coast road · almost flat, gently rolling', reine_aa: 'Lofoten classic · fishing villages, bridges, tunnels' };
  // the open-world island (tools/island.mjs, Freddy 18.11., live 19.11.): fixed tours until the junction choice is in; ?noinsel hides them
  if (!params.has('noinsel')) Object.assign(REAL, { insel_koenig: 'island · North Pass, castle summit, lighthouse', insel_feierabend: 'island · East Saddle and the cliffs',
    insel_suedsattel: 'island · river valley, South Saddle, beach', insel_westpass: 'island · monastery and the West Pass', insel_bruecke: 'island · 5 km bridge over the sea to Seal Isle', insel_runde: 'island · the whole coast ring' });
  await Promise.all(Object.entries(REAL).map(async ([id, what], k) => { const real = await loadRealTrack(id); if (!real) return;
    BUILTIN[id] = () => ({ id, name: ({ kueste60: 'Coast Road' })[id] || real.name || id, place: `${(real.length / 1000).toFixed(0)} km ${what} · ${real.gain} m climb`, source: 'demo', parts: [], track: real, createdAt: 2 + k, thumb: demoThumb(real, 1200) }); }));
  await reload();
  await loadShared();
  if (params.has('seed')) await seedDemoRides();
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.view)));
  $('#trainerPill').addEventListener('click', connectTrainer);
  $('#hrPill').addEventListener('click', connectHR);
  state.trainer.addEventListener('status', updateTrainerPill);
  $('#fileInput').addEventListener('change', e => { importFiles([...e.target.files]); e.target.value = ''; });
  document.addEventListener('dragover', e => { e.preventDefault(); document.querySelector('.add-card')?.classList.add('drag'); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.querySelector('.add-card')?.classList.remove('drag'); });
  document.addEventListener('drop', e => { e.preventDefault(); document.querySelector('.add-card')?.classList.remove('drag'); if (e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]); });
  updateTrainerPill();
  const v = params.get('view');
  if (v === 'detail') go('detail', params.get('id') || 'demo');
  else if (v === 'ride') startRide(params.get('id') || 'demo', { autopilot: params.has('auto'), at: +params.get('at') || 0 });
  else go(v || 'library');
  if (hasAcc) startOnline();
  if (hasAcc) { $('#accPill').hidden = false; $('#accPill').addEventListener('click', () => accountModal(state, accountChanged)); updateAccPill(); }
  (async () => {
    if (hasAcc && !account() && !state.settings.accountAsked && !params.has('noprofile') && v !== 'ride') {
      state.settings.accountAsked = true; saveSettings(); await accountModal(state, accountChanged, { first: true });
    }
    if (!state.settings.profileDone && !params.has('noprofile') && v !== 'ride') profileModal();
    else if (params.get('join')) groupModal({ code: params.get('join'), startRide });
    else if (/^[0-9a-f]{12}$/.test(params.get('live') || '')) liveJoinById(params.get('live')); /* "Copy link" on the phone's "Riding now" */
  })();
  db.persist();
  showVersion();
  initRemote(state); // phone remote (js/remotepad.js): keeps its session over a reload, findable by the account
}

/** version next to the logo; checks every 10 min whether the host has a newer one (then: click to reload) */
async function showVersion() {
  const tag = $('#verTag'); if (!tag) return;
  const read = () => fetch('version.json', { cache: 'no-store' }).then(r => r.json()).then(j => j.version).catch(() => null);
  const mine = await read(); if (!mine) return;
  tag.textContent = 'v' + mine; tag.title = 'RIDEFRAME Version ' + mine;
  tag.onclick = () => toast('RIDEFRAME Version ' + mine, 3000);
  setInterval(async () => {
    const now = await read();
    if (now && now !== mine && !document.querySelector('.ride')) {
      tag.textContent = 'Update ' + now + ' · reload'; tag.classList.add('new'); tag.title = 'New version on the server, click to load';
      tag.onclick = () => location.reload();
    }
  }, 10 * 60e3);
}

async function reload() {
  state.routes = (await db.all('routes')).sort((a, b) => b.createdAt - a.createdAt);
  state.rides = (await db.all('rides')).filter(r => !r.source).sort((a, b) => b.date - a.date); // activities from Strava, files or by hand live in the phone feed (aktivitaeten.html), not in the ride history
}

/** rides were deleted or changed elsewhere (profile, end screen): reload and redraw the history tab */
export async function ridesChanged() { await reload(); if (state.view === 'history') history(); }

export async function saveSettings() { await db.kvSet('settings', state.settings); settingsChanged(state.settings); }
function updateAccPill() { const a = account(), p = $('#accPill'); p.classList.toggle('on', !!a); p.querySelector('.t').textContent = a ? a.name : 'Sign in'; }
async function accountChanged() { updateAccPill(); applyAccent(); await reload(); await loadPersonal(); go(state.view); startOnline(); }
/** green dot for my friends while RIDEFRAME is open here (js/live.js); an invite in the answer redraws the friends strip at once */
function startOnline() { if (!account()) return; import('./live.js').then(l => l.startOnline({ show: () => state.settings.liveShow !== false, onBeat: j => { if (j.invites?.length && $('#live')?.isConnected) liveDraw?.(); } })).catch(() => {}); }
function applyAccent() {
  document.documentElement.style.setProperty('--accent', ACCENTS[state.settings.accent] || ACCENTS.orange);
}

export function allRoutes() { return [...state.routes, ...Object.keys(BUILTIN).filter(id => id !== 'demo' || new URLSearchParams(location.search).has('demo')).map(getBuiltin)]; } /* Passo Demo hidden from the list (Freddy 12.11.); it stays as an internal fallback (routeById, ?view=ride default, ?demo shows it) */
const routeName = id => id === 'pure' ? 'Pure (phone)' : id === 'outdoor' ? 'Outdoors' : routeById(id)?.name;
export function routeById(id) { return BUILTIN[id] ? getBuiltin(id) : state.routes.find(r => r.id === id); }
export function ridesFor(id) { return state.rides.filter(r => r.routeId === id); }
export function bestRide(id) { return ridesFor(id).filter(r => r.complete).sort((a, b) => a.duration - b.duration)[0]; }

export function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// ---------------- router ----------------
export function go(view, arg) {
  state.view = view;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view || (view === 'detail' && t.dataset.view === 'library')));
  main.scrollTop = 0;
  ({ library, detail, history, settings, training: () => trainingView(main, { state, saveSettings, startRide, routeById }) })[view](arg);
}

// ---------------- library ----------------
/** own workouts in the routes feed (Freddy 16.11.): start right here, build and edit in the Training tab */
function myWorkoutsRow() {
  const my = allWorkouts().filter(w => w.mine);
  return `<div class="mywk"><div class="mywkhead"><h2 class="section">My workouts</h2><button class="btn ghost small" data-wtab="1">${my.length ? 'Edit' : '+ Build workout'}</button></div>
    ${my.length ? `<div class="wgrid">${my.map(w => `<div class="panel wcard"><div class="label">${Math.round(workoutDuration(w) / 60)} min</div><h3>${esc(w.name)}</h3>${workoutSVG(w)}<button class="btn small" data-wgo="${w.id}">Start ▸</button></div>`).join('')}</div>`
      : '<p class="hint">Build your own blocks in the Training tab or adjust a standard workout. They will then show up here.</p>'}</div>`;
}
function library() {
  const routes = allRoutes();
  main.innerHTML = `
  <section class="view">
    <div id="live" class="live" aria-live="polite"></div>
    <div id="islandHero"></div>
    <div class="view-head">
      <div>
        <div class="label">Library</div>
        <h1 class="display" style="margin-top:14px">Your<br>routes</h1>
        <div class="meta">${routes.length} ${routes.length === 1 ? 'route' : 'routes'} · ${fmtKm(routes.reduce((s, r) => s + r.track.length, 0))} km · ${fmtNum(routes.reduce((s, r) => s + r.track.gain, 0))} m climbing</div>
      </div>
      <div class="libside"><div id="rmMiniBox"></div>
      <div class="libacts"><button class="btn ghost" id="wishBtnLib" hidden>Wish list</button><button class="btn ghost" id="lookBtnLib">My rider</button><button class="btn ghost" id="groupBtnLib">Ride together</button><button class="btn" id="uploadBtn">＋ Upload route</button><button class="btn ghost" id="shopBtnLib" title="Spend your Wizard points on looks for your rider">Shop <span class="shopbtnbal" id="shopBalLib">🧙</span></button></div></div>
    </div>
    <div id="board" hidden></div>
    ${myWorkoutsRow()}
    <div class="grid">
      ${routes.map(card).join('')}
      <button class="add-card" id="addCard">
        <div class="plus">+</div>
        <div><h3 class="display">Drop a GoPro<br>video here</h3>
        <p>MP4 straight from the GoPro with GPS. Select several chapters (GX01…, GX02…) together. Optionally with a GPX file.</p></div>
      </button>
    </div>
  </section>`;
  $('#uploadBtn').onclick = $('#addCard').onclick = () => $('#fileInput').click();
  miniRemote($('#rmMiniBox')); // phone remote: the QR code is simply there (js/remotepad.js)
  $('#groupBtnLib').onclick = () => groupModal({ startRide });
  $('#lookBtnLib').onclick = () => import('./avatar-ui.js').then(x => x.avatarModal());
  const shopBal = () => import('./shop-ui.js').then(x => x.shopLabel()).then(t => { const e = $('#shopBalLib'); if (e) e.textContent = t; }).catch(() => {});
  $('#shopBtnLib').onclick = () => import('./shop-ui.js').then(x => x.shopModal({ onClose: shopBal })); shopBal(); // Wizard points shop (owner 19.11.)
  accountsAvailable().then(ok => { const b = $('#wishBtnLib'); if (!ok || !b) return; b.hidden = false; b.onclick = () => import('./wishes.js').then(x => x.wishModal(state, accountChanged)); }); /* wish list: only where RIDEFRAME is hosted with accounts */
  main.querySelectorAll('.card').forEach(c => c.addEventListener('click', () => go('detail', c.dataset.id)));
  main.querySelectorAll('[data-wgo]').forEach(b => b.onclick = () => { state.settings.workout = b.dataset.wgo; saveSettings(); startRide(routeById('kueste60') ? 'kueste60' : 'demo'); });
  main.querySelectorAll('[data-wtab]').forEach(b => b.onclick = () => go('training'));
  showBoard();
  showLive();
  showIsland();
}

/* the open-world island big on the start page (Freddy 20.11.): who is where, click to join, click a place to start there */
async function showIsland() {
  const el = $('#islandHero'); if (!el || new URLSearchParams(location.search).has('noinsel') || !routeById('insel_runde')) return;
  const [{ islandHero }, live, prof] = await Promise.all([import('./islandhero.js'), import('./live.js'), import('./profiles.js').catch(() => null)]);
  islandHero(el, { routeById, startRide, liveJoin, signedIn: () => !!account(),
    friendsNow: async () => { const F = await live.friendsNow(); return F?.friends ? F.friends.filter(f => f.state === 'riding' && f.ride).map(live.asRider) : null; },
    face: r => live.avatar(r, prof?.faceImg), fillFaces: el => prof?.fillFaces(el) });
}

/* "Riding now" (owner 17.11.: "he is online, I can just join") and the friends with a green dot ("like on the PlayStation"):
   every account of this host, riding ones as cards with Join, the others as slim chips, invites on top (js/live.js, tools/live-api.mjs) */
let liveRiders = [], liveFriends = [], liveDraw = null;
const FR_CHIPS = 8;
async function showLive() {
  if (!account()) return;
  const el = $('#live'), hint = $('#liveHint'), host = el || hint; if (!host) return;
  const [live, prof] = await Promise.all([import('./live.js'), el ? import('./profiles.js').catch(() => null) : null]);
  const face = prof?.faceImg;
  const draw = liveDraw = async () => {
    const F = await live.friendsNow(); if (!F) return;
    liveFriends = F.friends; const rs = liveRiders = F.friends.filter(f => f.state === 'riding' && f.ride).map(live.asRider);
    if (el?.isConnected) {
      const rest = F.friends.filter(f => f.state !== 'riding'), chips = rest.slice(0, FR_CHIPS), more = rest.length - chips.length;
      live.reveal(el, F.friends.length || F.invites.length ? `${F.invites.map(v => live.inviteCard(v, false)).join('')}${live.headHTML(F.friends, '<button type="button" class="frall" id="frAll">All friends</button>')}
        ${live.ridersGrid(rs, { face, have: r => !!routeById(r.routeId) })}
        ${chips.length ? `<div class="frline">${chips.map(f => live.friendChip(f, face)).join('')}${more > 0 ? `<button type="button" class="frchip frmore" id="frMore">+${more} more</button>` : ''}</div>` : ''}` : '');
      if (prof) prof.fillFaces(el); wireLive(el, F, live, face, prof);
    }
    if (hint?.isConnected) { const here = rs.filter(r => r.routeId === hint.dataset.route);
      hint.innerHTML = here.slice(0, 3).map(r => `<div class="livehint" data-sid="${esc(r.id)}"><i class="lvdot" aria-hidden="true"></i><span><b>${esc(r.name)}</b> is riding this now · ${live.progress(r)}</span><button class="btn small lvjoin" type="button">Join</button></div>`).join('');
      hint.hidden = !here.length; wireLive(hint, F, live); }
  };
  live.every15(host, draw);
}
function wireLive(root, F, live, face, prof) {
  root.querySelectorAll('.lvjoin').forEach(b => b.onclick = e => { e.stopPropagation(); const r = liveRiders.find(x => x.id === b.closest('[data-sid]')?.dataset.sid); if (r) liveJoin(r); });
  root.querySelectorAll('[data-inv]').forEach(c => { const v = F?.invites.find(x => x.id === c.dataset.inv); if (!v) return;
    c.querySelector('.lvijoin').onclick = () => { live.dismissInvite(v.id); c.remove(); groupModal({ code: v.code, startRide }); };
    c.querySelector('.lvix').onclick = () => { live.dismissInvite(v.id); c.remove(); }; });
  const all = () => friendsModal(live, face, prof);
  root.querySelector('#frAll')?.addEventListener('click', all); root.querySelector('#frMore')?.addEventListener('click', all);
  root.querySelectorAll('.frchip[data-key]').forEach(b => b.onclick = all);
}
/** every friend on this host: riding (Join), online, offline with "last seen" */
function friendsModal(live, face, prof) {
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'frModal';
  const draw = () => { m.innerHTML = `<div class="box frbox"><div class="label">${live.onlineCount(liveFriends)} online</div><h2 class="display">Friends</h2>
    <div class="frlist">${liveFriends.map(f => live.friendRow(f, face, f.state === 'riding' && f.ride ? `<span data-sid="${esc(f.ride.id)}"><button class="btn small lvjoin" type="button">Join</button></span>` : '')).join('') || '<p class="hint">No other accounts on this RIDEFRAME yet.</p>'}</div>
    <div class="actions"><button class="btn" id="frOk">Close</button></div></div>`;
    prof?.fillFaces(m); m.querySelector('#frOk').onclick = () => m.remove();
    m.querySelectorAll('.lvjoin').forEach(b => b.onclick = () => { const r = liveRiders.find(x => x.id === b.closest('[data-sid]')?.dataset.sid); m.remove(); if (r) liveJoin(r); }); };
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  document.body.append(m); draw();
}
/** Join: a group is open (and he lets friends in) = straight into the group with its code, else ask him and wait (max. 45 s) */
async function liveJoin(r) {
  if (r.code) return groupModal({ code: r.code, startRide });
  const live = await import('./live.js'), ac = new AbortController();
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'liveAsk';
  m.innerHTML = `<div class="box lvask"><div class="label"><i class="lvdot" aria-hidden="true"></i>Riding now · ${esc(r.routeName)}</div><h2 class="display">Asking ${esc(r.name)}<br>to let you in …</h2>
    <p>${r.ask ? `${esc(r.name)} gets a short question in the ride and taps Accept.` : `${esc(r.name)}'s ride opens a group for you. You start right next to ${esc(r.name)}.`} This takes a few seconds.</p>
    <div class="lvwait"><i></i></div><div class="actions"><button class="btn ghost" id="laCancel">Cancel</button></div></div>`;
  document.body.append(m);
  m.querySelector('#laCancel').onclick = () => { ac.abort(); m.remove(); };
  const res = await live.askToJoin(r, { signal: ac.signal });
  if (!m.isConnected || res.state === 'cancelled') return;
  if (res.state === 'ready' && res.code) { m.remove(); return groupModal({ code: res.code, startRide }); }
  const [h, p] = live.askResult(res);
  m.querySelector('.box').innerHTML = `<div class="label">Riding now</div><h2 class="display" id="laMsg">${h}</h2><p>${p}</p><div class="actions"><button class="btn" id="laOk">OK</button></div>`;
  m.querySelector('#laOk').onclick = () => m.remove();
}
async function liveJoinById(id) {
  if (!account()) return toast('Sign in to join your friend.', 4000);
  const live = await import('./live.js'), F = await live.friendsNow(), r = F?.friends.filter(f => f.ride?.id === id).map(live.asRider)[0];
  if (r) liveJoin(r); else toast('Your friend is not riding any more.', 4000);
}

/* friends leaderboard: every account on this host, this week (Monday to Sunday) */
const BOARD_SORT = { km: ['km', 'km'], hm: ['Climb', 'Climbing'], pts: ['Points', 'Wizard points'] };
async function showBoard() {
  if (!account()) return;
  const { loadBoard } = await import('./account.js'), { faceImg, fillFaces, profileModal } = await import('./profiles.js'), b = await loadBoard(), el = $('#board');
  if (!b?.rows?.length || !el || !el.isConnected) return;
  const tot = r => +r.wp || 0; // this week's Wizard points (one number per rider)
  const draw = () => {
    const k = state.settings.boardSort || 'km', val = r => k === 'km' ? r.km : k === 'hm' ? r.hm : tot(r);
    const rows = [...b.rows].sort((x, y) => val(y) - val(x) || y.km - x.km);
    el.innerHTML = `<div class="board">
      <div class="board-head"><div class="label">Leaderboard this week <button class="betinfo" id="betInfoBtn" title="How do Wizard points work?">?</button></div>
        <div class="board-tabs">${Object.entries(BOARD_SORT).map(([id, [t]]) => `<button class="${id === k ? 'on' : ''}" data-k="${id}">${t}</button>`).join('')}</div></div>
      <table><tbody>${rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}" data-key="${esc(r.key || '')}" title="View profile" tabindex="0"><td class="rank">${i + 1}</td><td class="nm"><span class="who">${faceImg(r.look)}${esc(r.name)}</span></td>
        <td>${fmtNum(r.km, 1)} km</td><td>${fmtNum(r.hm)} m</td><td class="dim">${r.days} ${r.days === 1 ? 'day' : 'days'}</td>
        <td class="pts">${r.wp != null ? `<span class="wpn" title="Wizard points this week">🧙 ${fmtNum(r.wp)}</span>` : '<span class="dim">–</span>'}</td></tr>`).join('')}</tbody></table></div>`;
    el.querySelector('#betInfoBtn')?.addEventListener('click', () => import('./story.js').then(m => m.betInfo()));
    el.querySelectorAll('.board-tabs button').forEach(x => x.onclick = () => { state.settings.boardSort = x.dataset.k; saveSettings(); draw(); });
    el.querySelectorAll('tr[data-key]').forEach(tr => tr.onclick = () => tr.dataset.key && profileModal(tr.dataset.key, routeName));
    fillFaces(el);
  };
  el.hidden = false; draw();
}

function card(r) {
  const best = bestRide(r.id);
  const t = r.track;
  return `<div class="card" data-id="${r.id}" tabindex="0" role="button">
    <div class="thumb" style="background-image:url('${r.thumb || ''}')">
      ${best ? `<span class="badge">PB ${fmtTime(best.duration)}</span>` : ''}
      <span class="go"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M7 4l12 8-12 8z" fill="currentColor"/></svg></span>
      ${profileSVG(t)}
    </div>
    <div class="body">
      <h3>${esc(r.name)}</h3>
      <div class="place">${esc(r.place || '')}</div>
      <div class="stats">
        <div class="stat"><div class="label">Distance</div><div class="v">${fmtKm(t.length)}<small>km</small></div></div>
        <div class="stat"><div class="label">Climb</div><div class="v">${fmtNum(t.gain)}<small>m</small></div></div>
        <div class="stat"><div class="label">Max</div><div class="v">${fmtNum(t.maxGrade, 1)}<small>%</small></div></div>
        <div class="stat"><div class="label">Rides</div><div class="v">${ridesFor(r.id).length}</div></div>
      </div>
    </div>
  </div>`;
}

// ---------------- detail ----------------
function detail(id) {
  const r = routeById(id); if (!r) return go('library');
  const t = r.track;
  const rides = ridesFor(id);
  const ranked = rides.filter(x => x.complete).sort((a, b) => a.duration - b.duration);
  const best = ranked[0];
  main.innerHTML = `
  <section class="view">
    <button class="back" id="back">← All routes</button>
    <div class="detail">
      <div>
        <div class="hero" style="background-image:url('${r.thumb || ''}')"></div>
        <div class="profile-wrap">
          <div class="label" style="margin-bottom:14px">Elevation profile · ${t.eleSource === 'dem' ? 'terrain model' : 'GPS altitude'}</div>
          <canvas id="detailProfile"></canvas>
        </div>
      </div>
      <div>
        <div class="label">${esc(r.place || 'Route')}</div>
        <h1 class="display" style="margin-top:14px">${esc(r.name)}</h1>
        <div class="bigstats">
          <div><div class="label">Distance</div><div class="v">${fmtKm(t.length)}<small>km</small></div></div>
          <div><div class="label">Climb</div><div class="v">${fmtNum(t.gain)}<small>m</small></div></div>
          <div><div class="label">Max grade</div><div class="v">${fmtNum(t.maxGrade, 1)}<small>%</small></div></div>
          <div><div class="label">Best time</div><div class="v ${best ? 'accent' : ''}">${best ? fmtTime(best.duration) : '–'}</div></div>
          <div><div class="label">${r.source === 'demo' ? 'Approx. time' : 'Video'}</div><div class="v">${fmtTime(t.duration)}</div></div>
          <div><div class="label">Rides</div><div class="v">${rides.length}</div></div>
        </div>
        <div id="liveHint" class="livehints" data-route="${esc(id)}" hidden></div>
        <div class="row-actions">
          <button class="btn" id="rideBtn">Ride ▸</button>
          <button class="btn ghost" id="groupBtn">Ride together</button>
          ${t.world ? '<a class="btn ghost" href="preview.html?route=' + id + '" style="text-decoration:none">Preview ▸</a>' : ''}
          <div class="field" style="border:0;padding:0;gap:10px">
            <span class="label">Opponent</span>
            <select id="ghostSel" style="width:auto">
              <option value="best">Best time</option><option value="last">Last ride</option><option value="none">None</option>
              ${sharedFor(id).map(x => `<option value="s:${x.id}">${esc(x.rider)} · ${fmtTime(x.duration)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="panel workout-pick" style="margin-top:22px">
          <div class="field" style="border:0;padding:0;gap:10px;flex-wrap:wrap;justify-content:flex-start">
            <span class="label" style="min-width:130px">Training</span>
            <span class="mwpick"><select id="workSel" style="width:auto">${workoutOptions(id)}</select><button type="button" class="btn ghost small" id="wCustom" title="Adjust the chosen workout for this route and save it under your name">Customise</button><button type="button" class="mwlink" id="wMine" title="All your personal workouts and your FTP, in the profile">My workouts</button></span>
            <label style="display:flex;gap:8px;align-items:center;margin-left:auto" title="The trainer holds the target watts itself, however steep the route is"><input type="checkbox" class="toggle" id="ergChk" ${state.settings.erg !== false ? 'checked' : ''}> ERG (trainer holds the watts)</label>
          </div>
          <div id="workInfo"></div><div class="mwfitinfo" id="mwFitInfo"></div>
          <div class="field" id="chRow" style="border:0;padding:10px 0 0;gap:10px;flex-wrap:wrap;justify-content:flex-start" title="Along the way a knight, a granny, a gull, a sea eagle or a kid challenges you to short races. To accept, just attack (or press K). Never during a workout.">
            <span class="label" style="min-width:130px">Challenges</span>
            <select id="chSel" style="width:auto">${[0, 2, 3, 4, 6, 8].map(n => `<option value="${n}">${n ? n + ' per ride' : 'off'}</option>`).join('')}</select>
          </div>
          <div class="field" style="border:0;padding:10px 0 0;gap:10px;flex-wrap:wrap;justify-content:flex-start" title="Lower levels load fewer models: less memory, faster start, smoother on weaker laptops. When riding together everyone picks their own level.">
            <span class="label" style="min-width:130px">Graphics</span>
            <select id="wmSel" style="width:auto">${[['voll', '4 · Full life'], ['ruhig', '3 · Fewer people and animals'], ['natur', '2 · Hardly any people or animals'], ['leer', '1 · Landscape only']].map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
          </div>
          <div class="field" style="border:0;padding:10px 0 0;gap:10px;flex-wrap:wrap;justify-content:flex-start" title="The sun sets during the ride: on the horizon at halfway, dusk at the end">
            <span class="label" style="min-width:130px">Light</span>
            <select id="lightSel" style="width:auto"><option value="sunset">Sunset during the ride</option><option value="fest">Evening sun (stays)</option></select>
          </div>
          <div class="field" style="border:0;padding:10px 0 0;gap:10px;flex-wrap:wrap;justify-content:flex-start" title="At the finish you start again from the start until all laps are done (not in group rides)">
            <span class="label" style="min-width:130px">Laps</span>
            <select id="lapSel" style="width:auto">${[1, 2, 3, 4, 5, 10].map(n => `<option value="${n}">${n === 1 ? '1 lap' : n + ' laps'} · ${fmtKm(t.length * n)} km</option>`).join('')}</select>
          </div>
        </div>
        ${t.intervals?.length ? intervalPlan(t) : ''}
        ${segmentTable(t, ridesFor(r.id))}
        <h2 class="section" style="margin-top:44px">Your times</h2>
        ${ranked.length ? `<table class="table">
          <tr><th class="label">#</th><th class="label">Date</th><th class="label">Time</th><th class="label">Avg W</th><th class="label">Avg km/h</th><th class="label"></th></tr>
          ${ranked.slice(0, 8).map((x, i) => `<tr class="${i === 0 ? 'pb' : ''}"><td class="rank">${i + 1}</td><td>${new Date(x.date).toLocaleDateString('en-GB')}</td><td>${fmtTime(x.duration)}</td><td>${x.avgPower} W</td><td>${fmtNum(x.distance / x.duration * 3.6, 1)}</td><td><button class="btn ghost small share" data-id="${x.id}" title="Send as a file to friends so they can race against you">Share</button></td></tr>`).join('')}
        </table>` : '<div class="empty">No complete ride yet. Your first time will be your best time.</div>'}
        <div class="row-actions" style="margin-top:32px">
          ${r.source !== 'demo' ? `<button class="btn ghost small" id="renameBtn">Rename</button>
          ${r.track.eleSource !== 'dem' ? '<button class="btn ghost small" id="eleBtn">Improve elevation data</button>' : ''}
          <button class="btn danger small" id="delBtn">Delete</button>` : ''}
        </div>
      </div>
    </div>
  </section>`;
  $('#back').onclick = () => go('library');
  $('#ghostSel').value = state.settings.ghost; if (!$('#ghostSel').value) $('#ghostSel').value = 'best';
  $('#groupBtn').onclick = () => groupModal({ routeId: id, startRide });
  const showWork = () => { const w = workoutById(state.settings.workout); $('#workInfo').innerHTML = w ? `<p style="margin:6px 0">${esc(w.what)} Target watts from your FTP (${state.settings.ftp || 200} W).</p>${workoutSVG(w)}` : ''; $('#rideBtn').textContent = w ? 'Start workout ▸' : 'Ride ▸'; $('#chRow').hidden = !!w; };
  $('#workSel').value = workoutById(state.settings.workout) ? state.settings.workout : ''; showWork();
  $('#workSel').onchange = e => { state.settings.workout = e.target.value; saveSettings(); showWork(); };
  wireRoutePick(main, { route: r, state, saveSettings, rerender: () => detail(id), routes: allRoutes, openRoute: rid => go('detail', rid) });
  $('#ergChk').onchange = e => { state.settings.erg = e.target.checked; saveSettings(); };
  $('#chSel').value = String(state.settings.challenges ?? 4);
  $('#lapSel').value = String(state.settings.laps || 1);
  $('#lapSel').onchange = e => { state.settings.laps = +e.target.value; saveSettings(); };
  $('#wmSel').value = state.settings.worldMode || 'voll';
  $('#wmSel').onchange = e => { state.settings.worldMode = e.target.value; saveSettings(); };
  $('#lightSel').value = state.settings.light === 'fest' ? 'fest' : 'sunset';
  $('#lightSel').onchange = e => { state.settings.light = e.target.value; saveSettings(); };
  $('#chSel').onchange = e => { state.settings.challenges = +e.target.value; saveSettings(); };
  wireDashboard(main, { state, saveSettings, toast, rerender: history,
    startTest: id => { state.settings.workout = id; saveSettings(); startRide(routeById('kueste60') ? 'kueste60' : 'demo'); },
    deleteRides: async list => { const { deleteRideRemote } = await import('./account.js'); let n = 0;
      for (const x of list) { try { await deleteRideRemote(x.id); await db.del('rides', x.id); db.kvDel('photo:' + x.id).catch(() => {}); n++; } catch (e) { toast('Server: ' + e.message); break; } }
      await reload(); toast(`${n} ${n === 1 ? 'ride' : 'rides'} deleted`); } });
  main.querySelectorAll('.share').forEach(b => b.onclick = () => shareRide(rides.find(r => r.id === b.dataset.id)));
  $('#ghostSel').onchange = e => { state.settings.ghost = e.target.value; saveSettings(); };
  $('#rideBtn').onclick = () => startRide(id);
  showLive();
  const prof = $('#detailProfile');
  requestAnimationFrame(() => drawDetailProfile(prof, t));
  if ($('#renameBtn')) $('#renameBtn').onclick = async () => {
    const name = prompt('Route name', r.name); if (!name) return;
    r.name = name; await db.put('routes', r); detail(id);
  };
  if ($('#delBtn')) $('#delBtn').onclick = async () => {
    if (!confirm(`Delete “${r.name}” with its video and all rides?`)) return;
    await db.deleteRoute(id); await reload(); go('library');
  };
  if ($('#eleBtn')) $('#eleBtn').onclick = async () => {
    try { r.track = await improveElevation(r.track); await db.put('routes', r); toast('Elevation taken from the terrain model'); detail(id); }
    catch (e) { toast('Did not work: ' + e.message); }
  };
}

// ---------------- history & records ----------------
function history() {
  const rides = state.rides;
  const totalKm = rides.reduce((s, r) => s + r.distance, 0);
  const best20 = Math.max(0, ...rides.map(r => r.best20 || 0));
  const best20Ride = best20 ? rides.find(r => r.best20 === best20) : null;
  const mostGain = rides.slice().sort((a, b) => b.gain - a.gain)[0];
  const longest = rides.slice().sort((a, b) => b.distance - a.distance)[0];
  main.innerHTML = `
  <section class="view">
    <div class="view-head"><div><div class="label">History</div><h1 class="display" style="margin-top:14px">Rides &amp;<br>records</h1></div></div>
    <h2 class="section">Training</h2>
    ${dashboardHTML(rides, state.settings)}
    <h2 class="section">Records</h2>
    <div class="records">
      <div class="record"><div class="label">Best 20 minutes</div><div class="v">${best20 || '–'}<small>W</small></div><div class="s">${best20Ride ? esc(routeName(best20Ride.routeId) || '') + ' · ' + new Date(best20Ride.date).toLocaleDateString('en-GB') : 'Ride at least 20 minutes'}</div></div>
      <div class="record"><div class="label">Total</div><div class="v">${fmtKm(totalKm)}<small>km</small></div><div class="s">${rides.length} ${rides.length === 1 ? 'ride' : 'rides'} · ${(t => t >= 3600 ? `${Math.floor(t / 3600)} h ${Math.round(t % 3600 / 60)} min` : `${Math.round(t / 60)} min`)(rides.reduce((s, r) => s + r.duration, 0))}</div></div>
      <div class="record"><div class="label">Most climbing</div><div class="v">${mostGain ? fmtNum(mostGain.gain) : '–'}<small>m</small></div><div class="s">${mostGain ? esc(routeName(mostGain.routeId) || '') : ''}</div></div>
      <div class="record"><div class="label">Longest ride</div><div class="v">${longest ? fmtKm(longest.distance) : '–'}<small>km</small></div><div class="s">${longest ? fmtTime(longest.duration) : ''}</div></div>
    </div>
    <h2 class="section">Intervals over time</h2>
    <div id="ivHist"></div>
    <h2 class="section">All rides</h2>
    ${rides.length ? `<table class="table">
      <tr><th class="label">Date</th><th class="label">Route</th><th class="label">Time</th><th class="label">Distance</th><th class="label">Climb</th><th class="label">Avg W</th><th class="label">Avg km/h</th><th class="label"></th><th class="label"></th></tr>
      ${rides.map(x => { const pb = x.routeId !== 'pure' && x.routeId !== 'outdoor' && bestRide(x.routeId)?.id === x.id; return `<tr class="${pb ? 'pb' : ''}"><td>${new Date(x.date).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc((routeName(x.routeId) || 'Deleted route') + ((x.routeId === 'pure' || x.routeId === 'outdoor') && x.workout ? ' · ' + x.workout : ''))}</td><td>${fmtTime(x.duration)}</td><td>${fmtKm(x.distance)} km</td><td>${fmtNum(x.gain)} m</td><td>${x.avgPower} W</td><td>${fmtNum(x.distance / x.duration * 3.6, 1)}</td><td>${pb ? 'BEST TIME' : x.complete ? '' : '<span style="color:var(--muted)">stopped</span>'}</td><td style="white-space:nowrap"><button class="btn ghost small strava" data-id="${x.id}">Strava</button> <button class="btn ghost small share" data-id="${x.id}">Share</button> <button class="btn ghost small rimg" data-id="${x.id}" title="Make a picture of the ride">Image</button> <button class="btn ghost small rdel" data-id="${x.id}" title="Delete ride">✕</button></td></tr>`; }).join('')}
    </table>` : '<div class="empty">No rides yet. Pick a route and start riding.</div>'}
  </section>`;
  import('./ivview.js').then(m => m.mountIvHistory(main.querySelector('#ivHist'), rides, { kg: state.settings.riderKg })).catch(() => {}); // ivview.js: the ridden watts per interval kind
  wireDashboard(main, { state, saveSettings, toast, rerender: history,
    startTest: id => { state.settings.workout = id; saveSettings(); startRide(routeById('kueste60') ? 'kueste60' : 'demo'); },
    deleteRides: async list => { const { deleteRideRemote } = await import('./account.js'); let n = 0;
      for (const x of list) { try { await deleteRideRemote(x.id); await db.del('rides', x.id); db.kvDel('photo:' + x.id).catch(() => {}); n++; } catch (e) { toast('Server: ' + e.message); break; } }
      await reload(); toast(`${n} ${n === 1 ? 'ride' : 'rides'} deleted`); } });
  main.querySelectorAll('.share').forEach(b => b.onclick = () => shareRide(rides.find(r => r.id === b.dataset.id)));
  main.querySelectorAll('.rdel').forEach(b => b.onclick = async () => { const x = rides.find(r => r.id === b.dataset.id); if (!x) return;
    if (!confirm(`Delete the ride from ${new Date(x.date).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })} (${fmtKm(x.distance)} km) for good?`)) return;
    try { const { deleteRideRemote } = await import('./account.js'); await deleteRideRemote(x.id); } catch (e) { toast('Server: ' + e.message); return; }
    await db.del('rides', x.id); db.kvDel('photo:' + x.id).catch(() => {}); await reload(); history(); toast('Ride deleted'); });
  main.querySelectorAll('.rimg').forEach(b => b.onclick = async () => { // share image later, also for older rides (then without photo: sky + route name)
    const x = rides.find(r => r.id === b.dataset.id), r = x && routeById(x.routeId); if (!r?.track) return toast('The route of this ride no longer exists.');
    const t = b.textContent; b.disabled = true; b.textContent = '…';
    try { const photo = await db.kvGet('photo:' + x.id).catch(() => null), { shareModal } = await import('./shareimg.js');
      await shareModal({ rec: x, route: r, track: r.track, photo: photo || null, pose: null, pb: x.routeId !== 'pure' && bestRide(x.routeId)?.id === x.id }); }
    catch (e) { toast('Image failed: ' + (e.message || e), 5000); }
    b.disabled = false; b.textContent = t; });
  main.querySelectorAll('.strava').forEach(b => b.onclick = () => { const x = rides.find(r => r.id === b.dataset.id); if (x?.samples?.length) { const r = routeById(x.routeId), t = r?.track; stravaButton(b, x, routeName(x.routeId) || 'Ride', routeFns(t)); } else toast('This ride has no recorded data.'); });
}

// ---- form controls: stepper (− value +) with optional "no answer", segmented switch ----
function stepper(id, value, { step = 1, min = 0, max = 9999, unit = '', optional = false } = {}) {
  const none = value == null || value === '';
  return `<div class="stepper-wrap"><div class="stepper ${none ? 'off' : ''}" data-step="${step}" data-min="${min}" data-max="${max}" id="${id}">
    <button type="button" class="sb" data-d="-1" aria-label="less">−</button>
    <span class="sv"><input type="text" inputmode="decimal" value="${none ? '' : String(value)}" placeholder="–">${unit ? `<small>${unit}</small>` : ''}</span>
    <button type="button" class="sb" data-d="1" aria-label="more">+</button></div>
    ${optional ? `<button type="button" class="nochip ${none ? 'on' : ''}" data-for="${id}">Not set</button>` : ''}</div>`;
}
function wireStepper(root, id, onChange, fallback) {
  const el = root.querySelector('#' + id), inp = el.querySelector('input'), chip = root.querySelector(`.nochip[data-for="${id}"]`);
  const st = +el.dataset.step, min = +el.dataset.min, max = +el.dataset.max;
  const read = () => { const v = parseFloat(inp.value.replace(',', '.')); return isFinite(v) ? Math.max(min, Math.min(max, v)) : null; };
  const set = v => { inp.value = v == null ? '' : String(Math.round(v * 10) / 10); el.classList.toggle('off', v == null); chip?.classList.toggle('on', v == null); onChange(v); };
  el.querySelectorAll('.sb').forEach(b => b.onclick = () => { const v = read() ?? fallback; set(Math.max(min, Math.min(max, Math.round((v + st * +b.dataset.d) * 10) / 10))); });
  inp.onchange = () => { const v = read(); if (v == null && !chip) return set(fallback); set(v); };
  if (chip) chip.onclick = () => set(chip.classList.contains('on') ? fallback : null);
}
function seg(id, value, opts) {
  return `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function wireSeg(root, id, onChange) {
  const el = root.querySelector('#' + id);
  el.querySelectorAll('button').forEach(b => b.onclick = () => { el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); onChange(b.dataset.v); });
}
const SHIFT_OPTS = [['real', 'On the bike'], ['virtual', 'Virtual']];
const UE_WEATHER_OPTS = [['auto', 'Auto'], ['clear', 'Clear'], ['fog', 'Fog'], ['rain', 'Rain'], ['storm', 'Thunderstorm'], ['clearing', 'Rainbow'], ['dramatic', 'Dramatic']];
const VIEW_OPTS = [['0', 'Rider'], ['1', 'Chase'], ['2', 'Look back']];

function shiftHint(m) {
  return m === 'virtual'
    ? 'The bike stays in one gear. You shift in the app and the KICKR changes the resistance.'
    : 'You shift on the bike as usual. The KICKR only sets the resistance of the gradient; you choose your own cadence.';
}

function profileModal() {
  const s = state.settings, tmp = { riderKg: s.riderKg, bikeKg: s.bikeKg, ftp: s.ftp, cadence: s.cadence, shiftMode: s.shiftMode };
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box"><div class="label">Welcome</div><h2 class="display">Your profile</h2>
    <p>So that climbing speed and interval targets are right. Leave anything you do not know empty. You can change everything later in Settings.</p>
    <div class="form">
      <div class="field"><div>Body weight</div>${stepper('pKg', s.riderKg, { step: 0.5, min: 30, max: 200, unit: 'kg' })}</div>
      <div class="field"><div>Bike weight</div>${stepper('pBike', s.bikeKg, { step: 0.1, min: 4, max: 30, unit: 'kg' })}</div>
      <div class="field"><div>FTP<div class="hint">Threshold power. Without it there are no watt targets.</div></div>${stepper('pFtp', s.ftp, { step: 5, min: 80, max: 600, unit: 'W', optional: true })}</div>
      <div class="field"><div>Preferred cadence<div class="hint">For shifting tips.</div></div>${stepper('pCad', s.cadence, { step: 1, min: 50, max: 130, unit: 'rpm', optional: true })}</div>
      <div class="field"><div>Shifting</div>${seg('pShift', s.shiftMode, SHIFT_OPTS)}</div>
    </div>
    <div class="actions"><button class="btn" id="pOk">Save</button></div></div>`;
  document.body.append(m);
  wireStepper(m, 'pKg', v => tmp.riderKg = v, 75); wireStepper(m, 'pBike', v => tmp.bikeKg = v, 8.5);
  wireStepper(m, 'pFtp', v => tmp.ftp = v, 250); wireStepper(m, 'pCad', v => tmp.cadence = v, 90);
  wireSeg(m, 'pShift', v => tmp.shiftMode = v);
  m.querySelector('#pOk').onclick = () => { m.querySelectorAll('input').forEach(i => i.onchange?.()); Object.assign(s, tmp, { profileDone: true }); saveSettings(); m.remove(); go(state.view); };
}

function intervalPlan(t) {
  const s = state.settings, w = Math.min(...t.intervals.map(c => c.watt ?? 1)), lo = Math.round(s.ftp * w * .95), hi = Math.round(s.ftp * Math.max(...t.intervals.map(c => c.watt ?? 1)) * 1.05);
  const thr = w >= 1, mins = t.intervals.map(c => c.minutes), span = Math.min(...mins) === Math.max(...mins) ? `${mins[0]}` : `${Math.min(...mins)}–${Math.max(...mins)}`;
  const goal = s.ftp ? `Target: ${lo}–${hi} W (${thr ? '95–105 %' : `${Math.round(w * 95)}–${Math.round(Math.max(...t.intervals.map(c => c.watt ?? 1)) * 105)} %`} of your FTP of ${s.ftp} W).` : 'Enter your FTP in Settings and the app will show you watt targets.';
  return `<h2 class="section" style="margin-top:44px">Interval plan</h2>
  <p class="hint" style="margin:6px 0 14px">Each climb is built to take ${span} minutes ${thr ? 'at threshold' : 'in the sweet spot'}. ${goal} In between, ${thr ? 'descents and flat road' : 'short flat sections'} to recover.</p>
  <table class="table"><tr><th class="label">#</th><th class="label">Climb</th><th class="label">From km</th><th class="label">Length</th><th class="label">Avg</th><th class="label">Approx. time</th></tr>
  ${t.intervals.map((c, i) => `<tr><td class="rank">${i + 1}</td><td>${esc(c.name)}</td><td>${fmtKm(c.from)}</td><td>${fmtKm(c.to - c.from)} km</td><td>${fmtNum(c.grade, 1)} %</td><td>${c.minutes} min</td></tr>`).join('')}
  </table>`;
}

// ---------------- settings ----------------
function settings() {
  const s = state.settings;
  main.innerHTML = `
  <section class="view">
    <div class="view-head"><div><div class="label">Setup</div><h1 class="display" style="margin-top:14px">Settings</h1></div></div>
    <div class="settings">
      <div class="panel"><h3>Rider</h3>
        <label class="field"><div>Body weight<div class="hint">Important for realistic climbing speed.</div></div>${stepper('riderKg', s.riderKg, { step: 0.5, min: 30, max: 200, unit: 'kg' })}</label>
        <label class="field"><div>Bike weight</div>${stepper('bikeKg', s.bikeKg, { step: 0.1, min: 4, max: 30, unit: 'kg' })}</label>
        <label class="field"><div>FTP<div class="hint">Threshold power in watts. The interval target ranges come from it.</div></div>${stepper('ftp', s.ftp, { step: 5, min: 80, max: 600, unit: 'W', optional: true })}</label>
        <label class="field"><div>Preferred cadence<div class="hint">The app tells you when to shift easier or harder.</div></div>${stepper('cadence', s.cadence, { step: 1, min: 50, max: 130, unit: 'rpm', optional: true })}</label>
      </div>
      <div class="panel"><h3>Shifting</h3>
        <label class="field"><div>Mode<div class="hint" id="shiftHint">${shiftHint(s.shiftMode)}</div></div>
          ${seg('shiftMode', s.shiftMode, SHIFT_OPTS)}</label>
        <label class="field"><div>Chainrings</div><input type="text" id="chainrings" value="${esc(s.chainrings)}" style="width:110px"></label>
        <label class="field"><div>Cassette</div><select id="cassette" style="width:auto">${Object.keys(CASSETTES).map(k => `<option ${k === s.cassette ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <label class="field" id="realGearRow" ${s.shiftMode === 'virtual' ? '' : 'hidden'}><div>Gear on the bike (stays fixed)<div class="hint">Put the bike in this gear and shift only virtually: keys Q/E, gamepad LB/RB, later Di2 buttons.</div></div><input type="text" id="realGear" value="${esc(s.realGear)}" style="width:110px"></label>
        <label class="field"><div>Wheel circumference<div class="hint">mm, 700×28c = 2136, 700×25c = 2105</div></div>${stepper('wheel', s.wheel, { step: 1, min: 1500, max: 2400, unit: 'mm' })}</label>
        <div class="field"><div>Gears<div class="hint">${gearsFrom(s).map(g => g.f + '×' + g.r).join(' · ')}</div></div></div>
      </div>
      <div class="panel"><h3>Trainer</h3>
        <label class="field"><div>Gradient realism <b id="diffV">${s.difficulty}%</b><div class="hint">100 % = real gradient. 50 % = climbs feel half as steep.</div></div><input type="range" id="difficulty" min="0" max="100" step="5" value="${s.difficulty}"></label>
        <label class="field"><div>Descents <b id="downV">${s.downhill}%</b><div class="hint">How much the trainer eases off downhill.</div></div><input type="range" id="downhill" min="0" max="100" step="5" value="${s.downhill}"></label>
        <div class="field"><div>Test controller<div class="hint">E.g. Di2 extra buttons (D-FLY), Zwift Click, gamepad. Shows what the buttons send. A gamepad also drives all menus: D-pad move · A select · B back · L / R tabs (keyboard: arrows, Enter, Escape).</div></div><button class="btn ghost small" id="ctBtn">Test</button></div>
        <div class="field"><div>Phone remote<div class="hint">Your phone as a remote for this app: open remote.html on the phone and enter the code. Works like a gamepad, in the menus and in the ride (watts, pause, music, view).</div></div><button class="btn ghost small" id="rmBtn">Connect phone</button></div>
        <div class="field"><div>Zwift Click<div class="hint">Its + / − buttons shift the virtual gears in the ride. Click v2: open it in the Zwift app once a day, or it drops after a minute.</div><div class="hint" id="zcState">${clickState()}</div></div><button class="btn ghost small" id="zcBtn">${click.device ? 'Disconnect' : 'Connect'}</button></div>
        <div class="field"><div>Heart rate strap<div class="hint">Optional, via Bluetooth.</div></div><div style="display:flex;gap:8px"><button class="btn ghost small" id="hrAll" title="If the strap is missing in the normal search">All devices</button><button class="btn ghost small" id="hrBtn">${state.hr?.connected ? 'Connected' : 'Connect'}</button></div></div>
      </div>
      <div class="panel"><h3>Video &amp; data</h3>
        <label class="field"><div>Mute video sound</div><input type="checkbox" class="toggle" id="muteVideo" ${s.muteVideo ? 'checked' : ''}></label>
        <label class="field"><div>Improve elevation data<div class="hint">On import, take elevation from a terrain model (Open-Meteo). GoPro altitude is inaccurate.</div></div><input type="checkbox" class="toggle" id="improveEle" ${s.improveEle ? 'checked' : ''}></label>
        <div class="field"><div>Storage<div class="hint" id="usage">…</div></div></div>
      </div>
      <div class="panel"><h3>Your own music</h3>
        <div class="field"><div>Music folder on this computer<div class="hint" id="ownMusicV">Your own songs instead of the game music. Subfolders decide when they play (folder names stay German): welt (world), regen (rain), intervall, training, flug (flight), hoelle (hell), fest (festival), hochzeit (wedding), kirchenfest (church fair), beerdigung (funeral). The songs stay on your computer.</div></div><div style="display:flex;gap:8px"><button class="btn ghost small" id="ownMusicBtn">Choose folder</button><button class="btn ghost small" id="ownMusicOff" hidden>Remove</button></div></div>
      </div>
      <div class="panel"><h3>Voice chat when riding together</h3>
        <label class="field"><div>Push-to-Talk<div class="hint">Off = open mic, key T mutes. On = you are only heard while you hold T (or the “Mic” button).</div></div><input type="checkbox" class="toggle" id="voicePtt" ${s.voicePtt ? 'checked' : ''}></label>
        <label class="field"><div>Volume of the others <b id="voiceVolV">${s.voiceVol ?? 100}%</b><div class="hint">How loud you hear your friends. The music gets quieter while someone speaks.</div></div><input type="range" id="voiceVol" min="0" max="100" step="5" value="${s.voiceVol ?? 100}"></label>
      </div>
      <div class="panel" id="livePanel"><h3>Friends &amp; riding now</h3>
        <label class="field"><div>Show me as online<div class="hint">Friends with an account on this RIDEFRAME see a green dot while RIDEFRAME is open here, and in “Riding now” your route and kilometre while you ride (never your watts). Off = you always look offline, without “last seen”.</div></div><input type="checkbox" class="toggle" id="liveShow" ${s.liveShow !== false ? 'checked' : ''}></label>
        <label class="field"><div>Friends can join me without asking<div class="hint">Their Join opens a group in your ride by itself and they start right next to you. Off = a short question in the ride first (Accept / Not now, controller A / B).</div></div><input type="checkbox" class="toggle" id="liveAuto" ${s.liveAuto !== false ? 'checked' : ''}></label>
        ${account() ? '' : '<div class="hint" style="padding-top:10px">Needs an account: sign in at the top right.</div>'}
      </div>
      <div class="panel"><h3>Your rider</h3>
        <div class="field"><div>Look<div class="hint">Type, height, build, face, hair, outfits (including 80s and really funny ones) and shoes. Your friends see it when riding together, you see it in the chase camera (key V).</div></div><button class="btn ghost small" id="lookBtn">Design rider</button></div>
      </div>
      <div class="panel"><h3>Display while riding</h3>
        <div class="hint" style="margin-bottom:6px">Pick a preset or choose what you see yourself. While riding: key I switches the preset, the “Display” button opens this choice.</div>
        <div id="hudBox">${hudControlsHTML(hudPrefs(s))}</div>
      </div>
      <div class="panel"><h3>3D world view</h3>
        <label class="field"><div>Field of view <b id="fovV">${fovOf(s)}°</b><div class="hint">Like in Minecraft: right is wider, left is closer. Normal 80°, 95–130° = very wide. While riding: keys [ and ] or the “View” button.</div></div><input type="range" id="fov" min="${FOV_MIN}" max="${FOV_MAX}" step="1" value="${fovOf(s)}"></label>
        <label class="field"><div>Ride in Unreal (beta)<div class="hint">The ride keeps running here (trainer, group, workout); the picture shows the Unreal app with the nicer graphics. Once it is connected, the browser stops drawing its own 3D world.</div></div><input type="checkbox" class="toggle" id="ueBridge" ${s.ueBridge ? 'checked' : ''}></label>
        <label class="field"><div>Weather in Unreal<div class="hint">Auto = the weather changes with the section of the route. Otherwise it stays the same for the whole ride.</div></div>${seg('ueWeather', s.ueWeather || 'auto', UE_WEATHER_OPTS)}</label>
        <label class="field"><div>Keep the group together<div class="hint">In a group ride, whoever falls behind gets an invisible tailwind so you do not lose each other. Off = everyone rides on their own power only.</div></div><input type="checkbox" class="toggle" id="together" ${s.together !== false ? 'checked' : ''}></label>
        <label class="field"><div>Position via camera<div class="hint" id="poseV">The camera in front of the bike detects whether you ride upright, in an aero position or out of the saddle: aero saves drag, standing costs a little. The image stays on your computer. Calibrate once for the best detection.</div></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn ghost small" id="poseUp" type="button">Calibrate upright</button><button class="btn ghost small" id="poseAero" type="button">Calibrate aero</button><input type="checkbox" class="toggle" id="poseCam" ${s.poseCam ? 'checked' : ''}></div></label>
        <label class="field"><div>Eagle of Destiny<div class="hint">Once per interval workout an eagle lands beside you in a hard interval and has a few rude words for you (one swear word). Off = no eagle.</div></div><input type="checkbox" class="toggle" id="eagle" ${s.eagle !== false ? 'checked' : ''}></label>
        <label class="field"><div>Handlebars in view<div class="hint">Drop bars with hoods and forearms in the rider view. Off = clear view only. While riding: key H or the “Bars” button.</div></div><input type="checkbox" class="toggle" id="cockpit" ${s.cockpit !== false ? 'checked' : ''}></label>
        <label class="field"><div>Camera<div class="hint">Switch while riding with key V or the camera button.</div></div>${seg('view3d', String(s.view3d || 0), VIEW_OPTS)}</label>
      </div>
      <div class="panel"><h3>Design</h3>
        <div class="field"><div>Accent colour</div><div class="swatches">${Object.entries(ACCENTS).map(([k, c]) => `<button class="swatch ${s.accent === k ? 'on' : ''}" data-acc="${k}" style="background:${c}"></button>`).join('')}</div></div>
      </div>
      <div class="panel"><h3>Sources</h3>
        <div class="field"><div>Lofoten terrain<div class="hint">Elevation model DTM 10 © Kartverket, CC BY 4.0. Distant terrain: Terrain Tiles (Mapzen / AWS Open Data).</div></div></div>
        <div class="field"><div>Coast road<div class="hint">Road course © OpenStreetMap contributors, ODbL 1.0. Terrain © Kartverket, CC BY 4.0. Satellite image Sentinel-2 cloudless © EOX, CC BY 4.0.</div></div></div>
        <div class="field"><div>Satellite colours<div class="hint">Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016), CC BY 4.0.</div></div></div>
        <div class="field"><div>3D graphics<div class="hint">three.js (MIT). Ground textures Poly Haven (CC0). Figures and buildings partly Quaternius (CC0), partly own Blender and AI models.</div></div></div>
      </div>
      <div class="panel"><h3>Version</h3>
        <div class="field"><div>RIDEFRAME <span class="num" id="gameVer">…</span><div class="hint">The browser and the Unreal view always have the same number. If they do not match, Unreal tells you.</div></div></div>
      </div>
    </div>
  </section>`;
  gameVersion().then(v => { const e = $('#gameVer'); if (e) e.textContent = v; });
  const num = (id, key) => $('#' + id).addEventListener('change', e => { s[key] = +e.target.value; saveSettings(); });
  const stp = (id, key, fb) => wireStepper(main, id, v => { s[key] = v; saveSettings(); }, fb);
  stp('riderKg', 'riderKg', 75); stp('bikeKg', 'bikeKg', 8.5); stp('ftp', 'ftp', 250); stp('cadence', 'cadence', 90); stp('wheel', 'wheel', 2105);
  wireHudControls($('#hudBox'), () => s, h => { s.hud = h; saveSettings(); $('#hudBox').innerHTML = hudControlsHTML(hudPrefs(s)); });
  $('#lookBtn').onclick = () => import('./avatar-ui.js').then(x => x.avatarModal());
  import('./ownmusic.js').then(async om => { // own music folder: pick, show what is in it, forget
    const v = $('#ownMusicV'), btn = $('#ownMusicBtn'), off = $('#ownMusicOff'); if (!v) return;
    const show = i => { off.hidden = !i; if (!i) return;
      v.textContent = i.locked ? `Folder “${i.name}” · click “Choose folder” to unlock it` : `Folder “${i.name}” · ${i.n} songs${i.moods.length ? ' · own music for: ' + i.moods.join(', ') : ''}`; };
    if (!om.ownMusicSupported()) { btn.disabled = true; v.textContent = 'Only works in Chrome or Edge.'; return; }
    show(await om.ownMusicInfo());
    btn.onclick = async () => { // a known but locked folder: just unlock it; otherwise pick a (new) one
      const before = await om.ownMusicInfo(); if (before?.locked) { const c = await om.ownMusicInfo(true); if (c && !c.locked) return show(c); }
      const p = await om.pickOwnMusic(); if (p) show(p); };
    off.onclick = async () => { await om.forgetOwnMusic(); off.hidden = true; v.textContent = 'No own folder, the game music plays.'; };
  });
  $('#cockpit').onchange = e => { s.cockpit = e.target.checked; saveSettings(); };
  $('#eagle').onchange = e => { s.eagle = e.target.checked; saveSettings(); };
  $('#liveShow').onchange = e => { s.liveShow = e.target.checked; saveSettings(); import('./live.js').then(l => l.putPrefs({ show: s.liveShow })).catch(() => {}).then(startOnline); };
  $('#liveAuto').onchange = e => { s.liveAuto = e.target.checked; saveSettings(); import('./live.js').then(l => l.putPrefs({ auto: s.liveAuto })).catch(() => {}); };
  $('#together').onchange = e => { s.together = e.target.checked; saveSettings(); };
  { const pv = $('#poseV'), cal = async which => { // 3-2-1, then 2.5 s of that posture in front of the camera
      const m = await import('./posecam.js'); const pc = new m.PoseCam(s.poseCalib || null);
      try { pv.textContent = 'Camera starting …'; await pc.start();
        for (const k of [3, 2, 1]) { pv.textContent = `Sit ${which === 'up' ? 'upright' : 'in aero'} … ${k}`; await new Promise(r => setTimeout(r, 1000)); }
        pv.textContent = 'Hold …'; s.poseCalib = await pc.calibrate(which); saveSettings();
        pv.textContent = s.poseCalib.up != null && s.poseCalib.aero != null ? 'Calibrated: upright and aero saved.' : `${which === 'up' ? 'Upright' : 'Aero'} saved, now do ${which === 'up' ? 'aero' : 'upright'}.`;
      } catch (e) { pv.textContent = 'Camera failed: ' + (e?.message || e); } finally { pc.stop(); } };
    $('#poseUp').onclick = e => { e.preventDefault(); cal('up'); }; $('#poseAero').onclick = e => { e.preventDefault(); cal('aero'); };
    $('#poseCam').onchange = e => { s.poseCam = e.target.checked; saveSettings(); }; }
  $('#ueBridge').onchange = e => { s.ueBridge = e.target.checked; saveSettings(); };
  $('#fov').oninput = e => { s.fov = +e.target.value; s.lensMm = 0; $('#fovV').textContent = s.fov + '°'; saveSettings(); };
  wireSeg(main, 'ueWeather', v => { s.ueWeather = v; saveSettings(); });
  wireSeg(main, 'view3d', v => { s.view3d = +v; saveSettings(); });
  wireSeg(main, 'shiftMode', v => { s.shiftMode = v; saveSettings(); settings(); });
  $('#cassette').onchange = e => { s.cassette = e.target.value; saveSettings(); settings(); };
  const valid = { chainrings: v => parseRings(v), realGear: v => { const m = String(v).match(/^\s*(\d+)\s*[x×/\- ]\s*(\d+)\s*$/); return !!m && +m[1] >= 20 && +m[1] <= 60 && +m[2] >= 9 && +m[2] <= 40; } };
  const txt = (id) => $('#' + id).addEventListener('change', e => {
    if (!valid[id](e.target.value)) { toast(id === 'chainrings' ? 'Chainrings as numbers please, e.g. 50,34' : 'Gear like this please: 50x17', 3500); e.target.value = s[id]; return; }
    s[id] = e.target.value; saveSettings(); settings(); });
  txt('chainrings'); txt('realGear');
  $('#difficulty').oninput = e => { s.difficulty = +e.target.value; $('#diffV').textContent = s.difficulty + '%'; saveSettings(); };
  $('#downhill').oninput = e => { s.downhill = +e.target.value; $('#downV').textContent = s.downhill + '%'; saveSettings(); };
  $('#voicePtt').onchange = e => { s.voicePtt = e.target.checked; saveSettings(); import('./share.js').then(m => m.currentGroup()?.voice?.setPtt(s.voicePtt)); };
  $('#voiceVol').oninput = e => { s.voiceVol = +e.target.value; $('#voiceVolV').textContent = s.voiceVol + '%'; saveSettings(); import('./share.js').then(m => m.currentGroup()?.voice?.setVolume(s.voiceVol / 100)); };
  $('#muteVideo').onchange = e => { s.muteVideo = e.target.checked; saveSettings(); };
  $('#improveEle').onchange = e => { s.improveEle = e.target.checked; saveSettings(); };
  main.querySelectorAll('.swatch').forEach(b => b.onclick = () => { s.accent = b.dataset.acc; applyAccent(); saveSettings(); settings(); });
  $('#hrBtn').onclick = () => connectHR(false); $('#hrAll').onclick = () => connectHR(true);
  $('#ctBtn').onclick = openControllerTest;
  $('#rmBtn').onclick = openRemote;
  $('#zcBtn').onclick = connectClick;
  db.usage().then(u => { if (u) $('#usage').textContent = `${fmtNum(u.usage / 1e9, 1)} GB used of ${fmtNum(u.quota / 1e9, 0)} GB available`; });
}

// ---------------- trainer ----------------
async function connectTrainer() {
  const t = state.trainer;
  if (!Trainer.supported()) return toast('Bluetooth only works in Chrome or Edge.', 4000);
  if (t.connected) { if (confirm('Disconnect trainer?')) t.disconnect(); return; }
  try { await t.connect(); await t.setSim({ riderKg: state.settings.riderKg, bikeKg: state.settings.bikeKg, crr: 0.004, cw: 0.51 }); }
  catch (e) { if (e.name !== 'NotFoundError') toast('Connection failed: ' + e.message, 4000); updateTrainerPill(); }
}
function updateTrainerPill() {
  const t = state.trainer, pill = $('#trainerPill');
  const on = t.connected;
  pill.classList.toggle('on', on);
  pill.querySelector('.t').innerHTML = on ? `✓ ${esc(t.device.name || 'Trainer')} connected <span class="sub">${t.mode === 'pm' ? 'power meter only' : t.mode === 'ftms' ? 'FTMS' : t.mode === 'wahoo' ? 'Wahoo' : 'watts only'}</span>` : t.pmOnly ? 'Connect power meter' : 'Connect KICKR';
  pill.title = on ? 'Connected. Click to disconnect.' : 'Connect trainer via Bluetooth';
}
function updateHrPill() { // heart rate strap: its own Bluetooth connection, runs alongside the KICKR
  const h = state.hr, on = !!h?.connected, pill = $('#hrPill');
  pill.classList.toggle('on', on);
  const bat = h?.battery != null ? ` · battery ${h.battery} %` : '';
  pill.querySelector('.t').textContent = on ? (h.hr ? `♥ ${h.hr}${bat}` : `♥ connected, waiting for HR${bat}`) : h?.device && !h.closing ? 'HR: connection lost …' : 'Connect HR';
  if (on && h.battery != null && h.battery <= 15 && !h._warned) { h._warned = true; toast(`HR strap battery only ${h.battery} %. Replace the battery soon (usually CR2032).`, 6000); }
}
async function connectHR(all) {
  if (all instanceof Event) all = false;
  if (!navigator.bluetooth) return toast('Bluetooth only works in Chrome or Edge (not Safari/Firefox).', 6000);
  if (state.hr?.connected) { if (confirm('Disconnect HR strap?')) { state.hr.disconnect(); updateHrPill(); } return; }
  state.hr?.disconnect?.();
  try { state.hr = new HeartRate(); state.hr.addEventListener('hr', updateHrPill); state.hr.addEventListener('change', updateHrPill); state.hr.addEventListener('reconnected', () => toast('HR strap reconnected'));
    await state.hr.connect(!!all); updateHrPill(); toast('HR strap connected' + (state.hr.battery != null ? ` · battery ${state.hr.battery} %` : '')); if (document.querySelector('#hrBtn')) settings(); }
  catch (e) {
    if (e.name === 'NotFoundError' && /adapter|Bluetooth/i.test(e.message) && !/User cancelled|chooser/i.test(e.message)) return toast('Bluetooth is off or Chrome is not allowed to use it (Mac: System Settings > Privacy > Bluetooth > allow Chrome).', 8000);
    if (e.name !== 'NotFoundError') return toast('HR strap: ' + e.message, 7000);
    // nothing picked: most often the strap is asleep (not worn) or still paired with a watch/phone/bike computer
    if (!all) toast('No strap chosen? Put the strap on, wet the electrodes (it only sends while worn) and briefly turn off Bluetooth on your watch/phone/bike computer. Settings also has “All devices”.', 7000);
  }
}

// ---------------- Zwift Click ----------------
function clickState() {
  const c = click, s = c.status;
  if (s === 'on') return `Connected: ${esc(c.name)}${c.battery != null ? ` · battery ${c.battery} %` : ''}${c.locked ? ' · locked, open the Zwift app' : ''}`;
  return { connecting: 'Connecting…', reconnecting: 'Connection lost, reconnecting…', lost: 'Connection lost. Wake it up and connect again.' }[s] || 'Not connected';
}
click.on('state', () => { const st = document.querySelector('#zcState'), b = document.querySelector('#zcBtn'); if (st) st.innerHTML = clickState(); if (b) b.textContent = click.device ? 'Disconnect' : 'Connect'; });
async function connectClick() {
  if (click.device) { if (confirm('Disconnect Zwift Click?')) click.disconnect(); return; }
  try { await click.connect(); toast(`${click.name} connected · + / − shift the virtual gears`); }
  catch (e) { if (e.name !== 'NotFoundError') toast('Zwift Click: ' + e.message, 7000); }
}

// ---------------- import ----------------
function gpChapterKey(name) {
  // GoPro: GX010123.MP4 -> chapter 01, file 0123 ; GOPR0123 / GP010123 for older models
  const m = name.match(/^G[XHOP][A-Z]?(\d{2})(\d{4})/i) || name.match(/^GOPR(\d{4})/i);
  if (!m) return name;
  return m.length === 3 ? `${m[2]}-${m[1]}` : `${m[1]}-00`;
}

async function importFiles(files) {
  files = await importShared(files); if (!files.length) return;
  const videos = files.filter(f => /\.(mp4|mov)$/i.test(f.name)).sort((a, b) => gpChapterKey(a.name).localeCompare(gpChapterKey(b.name)));
  const gpx = files.find(f => /\.gpx$/i.test(f.name));
  if (!videos.length) return toast('Please choose a video (MP4).');
  const modal = document.createElement('div'); modal.className = 'modal';
  modal.innerHTML = `<div class="box"><div class="label">Import</div><h2 class="display" style="margin-top:10px">Reading<br>the route</h2>
    <p id="impStep">Reading GPS data…</p><div class="bar"><div id="impBar"></div></div><p id="impInfo" class="num"></p></div>`;
  document.body.append(modal);
  const setP = (txt, p) => { modal.querySelector('#impStep').textContent = txt; modal.querySelector('#impBar').style.width = Math.round(p * 100) + '%'; };
  try {
    const parts = []; let offset = 0; let points = []; let fps = 0;
    for (let i = 0; i < videos.length; i++) {
      const f = videos[i];
      const info = await readGoProGPS(f, p => setP(`Reading GPS: ${f.name}`, (i + p) / videos.length * 0.5));
      const duration = info.duration || await probeDuration(f);
      fps = fps || info.fps;
      parts.push({ file: f, name: f.name, duration, offset });
      points.push(...info.points.map(p => ({ ...p, t: p.t + offset })));
      offset += duration;
    }
    if (gpx) points = parseGPX(await gpx.text());
    if (points.length < 5) throw new Error('This video has no GPS data. Turn on GPS on the GoPro or add a GPX file.');
    setP('Calculating route…', 0.55);
    let track = buildTrack(points);
    if (state.settings.improveEle) {
      try { track = await improveElevation(track, p => setP('Elevation from terrain model…', 0.55 + p * 0.15)); } catch { /* offline: keep GPS altitude */ }
    }
    setP('Preview image…', 0.72);
    const thumb = await makeThumb(parts[0].file, Math.min(parts[0].duration * 0.15, 30));
    const place = await guessPlace(track).catch(() => '');
    modal.querySelector('#impInfo').textContent = `${fmtKm(track.length)} km · ${fmtNum(track.gain)} m climb · ${fmtTime(track.duration)} video · ${Math.round(fps)} fps`;
    const name = await askName(modal, videos[0].name.replace(/\.[^.]+$/, ''), place);
    if (name === null) { modal.remove(); return; }
    setP('Saving video (can take a while for large files)…', 0.8);
    const route = { id: uid(), name, place, createdAt: Date.now(), source: 'gopro', fps, thumb, track, parts: [] };
    for (const p of parts) {
      const videoId = uid();
      await db.put('videos', { id: videoId, blob: p.file, name: p.name, type: p.file.type || 'video/mp4' });
      route.parts.push({ videoId, name: p.name, duration: p.duration, offset: p.offset });
    }
    await db.put('routes', route);
    setP('Done', 1);
    await reload(); modal.remove(); go('detail', route.id);
  } catch (e) {
    console.error(e);
    modal.querySelector('.box').innerHTML = `<div class="label">Import</div><h2 class="display" style="margin-top:10px">That did<br>not work</h2><p>${esc(e.message)}</p><div class="actions"><button class="btn small">OK</button></div>`;
    modal.querySelector('button').onclick = () => modal.remove();
  }
}

function askName(modal, def, place) {
  return new Promise(res => {
    const box = modal.querySelector('.box');
    const info = modal.querySelector('#impInfo').textContent;
    box.innerHTML = `<div class="label">Almost done</div><h2 class="display" style="margin-top:10px">What is the<br>route called?</h2><p class="num">${info}</p>
      <div class="field" style="border:0;margin-top:18px"><input type="text" id="nm" value="${esc(place ? place.split(',')[0] : def)}"></div>
      <div class="bar"><div id="impBar" style="width:75%"></div></div><p id="impStep"></p><p id="impInfo"></p>
      <div class="actions"><button class="btn ghost small" id="cancel">Cancel</button><button class="btn small" id="ok">Save</button></div>`;
    box.querySelector('#nm').select();
    box.querySelector('#ok').onclick = () => res(box.querySelector('#nm').value.trim() || def);
    box.querySelector('#cancel').onclick = () => res(null);
    box.querySelector('#nm').onkeydown = e => { if (e.key === 'Enter') box.querySelector('#ok').click(); };
  });
}

function probeDuration(file) {
  return new Promise(res => { const v = document.createElement('video'); v.preload = 'metadata'; v.src = URL.createObjectURL(file); v.onloadedmetadata = () => { res(v.duration); URL.revokeObjectURL(v.src); }; v.onerror = () => res(0); });
}
function makeThumb(file, at) {
  return new Promise(res => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = URL.createObjectURL(file);
    const done = d => { URL.revokeObjectURL(v.src); res(d); };
    v.onloadeddata = () => { v.currentTime = at; };
    v.onseeked = () => { const c = document.createElement('canvas'); c.width = 960; c.height = Math.round(960 * v.videoHeight / v.videoWidth) || 540; c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); done(c.toDataURL('image/jpeg', 0.82)); };
    v.onerror = () => done('');
    setTimeout(() => done(''), 15000);
  });
}
async function guessPlace(track) {
  const i = Math.floor(track.lat.length / 2);
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=12&accept-language=en&lat=${track.lat[i]}&lon=${track.lon[i]}`);
  const j = await r.json(); const a = j.address || {};
  return [a.village || a.town || a.city || a.municipality || a.county, a.state, a.country].filter(Boolean).join(', ');
}

// ---------------- ride ----------------
let session = null;
async function startRide(id, opts = {}) {
  const route = routeById(id); if (!route) return;
  const rides = ridesFor(id);
  let ghost = null;
  if (state.settings.ghost === 'best') ghost = bestRide(id);
  if (state.settings.ghost === 'last') ghost = rides.filter(r => r.complete)[0];
  let ghostName = '';
  if (state.settings.ghost?.startsWith('s:')) { ghost = (state.shared || []).find(r => 's:' + r.id === state.settings.ghost && r.routeId === id) || bestRide(id); ghostName = ghost?.rider || ''; }
  const workout = opts.group ? null : workoutById(state.settings.workout);
  const keep = state.settings.resume?.[id]; // island: go on where you stopped last time (ride.js _keepPlace)
  if (keep && !opts.group && !opts.at && !opts.autopilot && keep.d > 300 && keep.d < route.track.length - 400 && Date.now() - keep.at < 60 * 864e5) {
    const { ask } = await import('./myworkouts-ui.js');
    const go = await ask({ title: 'Continue where you stopped?', text: `Last time you got to km ${(keep.d / 1000).toFixed(1)} on ${route.name}.`,
      buttons: [{ label: `Continue at km ${(keep.d / 1000).toFixed(1)}`, value: 'go', cls: 'primary' }, { label: 'From the start', value: 'new' }] });
    if (go === null) return;
    if (go === 'go') opts = { ...opts, at: keep.d }; else { delete state.settings.resume[id]; saveSettings(); }
  }
  session = new RideSession({ route, ghost, ghostName, workout, state, ...opts, onExit: async saved => { session = null; await reload(); if (saved) go('detail', id); else go(state.view === 'detail' ? 'detail' : state.view, id); } });
  await session.start();
}

// ---------------- screenshot seed ----------------
async function seedDemoRides() {
  if (state.rides.some(r => r.routeId === 'demo')) return;
  const t = getDemoRoute().track;
  const mk = (daysAgo, pw) => { const sim = simulateRide(t, pw, state.settings); return { id: uid(), routeId: 'demo', date: Date.now() - daysAgo * 864e5, duration: sim.duration, distance: Math.round(t.length), gain: t.gain, avgPower: pw, maxPower: pw + 140, best5: pw + 22, best20: pw + 6, complete: true, samples: sim.samples }; };
  for (const r of [mk(2, 238), mk(9, 226), mk(16, 214), mk(23, 205)]) await db.put('rides', r);
  await reload();
}

boot();

/** route page: the segments of this route with your best time on each (Strava-like) */
function segmentTable(t, rides) {
  const segs = findSegments(t); if (!segs.length) return '';
  const best = segmentBests(rides);
  return `<h2 class="section" style="margin-top:44px">Segments</h2>
    <table class="table segtable"><tr><th class="label"></th><th class="label">Segment</th><th class="label">From km</th><th class="label">Length</th><th class="label">Avg</th><th class="label">Your best</th></tr>
    ${segs.map(s => { const b = best[s.id], k = SEG_KIND[s.kind];
      return `<tr><td class="segk ${s.kind}" title="${k.label}">${k.icon}</td><td>${esc(s.name)}</td><td>${fmtKm(s.from)}</td><td>${s.len >= 1000 ? fmtKm(s.len) + ' km' : Math.round(s.len) + ' m'}</td><td>${fmtNum(s.avg, 1)} %</td><td>${b ? `${fmtTime(b.t)} · ${b.w} W` : '–'}</td></tr>`; }).join('')}
    </table>`;
}
