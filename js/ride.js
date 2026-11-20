// Ride mode: physics, video speed sync, trainer control, HUD, ghost and saving.
import { db, uid } from './db.js';
import { loadLedger, StoryRide, storyHTML, wireStory, WHO, leaderOf } from './story.js';
import { STEP, eleAt, gradeAt, timeAt, videoSpeedAt } from './track.js';
import { defaultParams, step as physStep } from './physics.js';
import { DemoScene } from './demo.js';
import { drawHudProfile } from './profile.js';
import { fmtTime, fmtKm, fmtNum, esc, bestAvg } from './util.js';
import { bestClimb, distAtTime } from './climbghost.js';
import { stravaButton } from './stravaup.js';
import { padButtons, activePad } from './controller.js';
import { pickInDir } from './padnav.js';
import { remoteLabel, remoteCode } from './remotepad.js';
import { click } from './zwiftclick.js';
import { routeFns } from './tcx.js';
import { gearsFrom, gearName, parseGear, estimateGear, virtualGrade } from './gears.js';
import { UEBridge } from './uebridge.js';
import { MiniMap } from './minimap.js';
import { fovOf, FOV_MIN, FOV_MAX, FOV_DEFAULT } from './fov.js';
import { workoutState, workoutSVG, timelineSVG, isHard, tunedTarget, tuneAdj, fmtAdj } from './workouts.js';
import { Challenges } from './challenges.js';
import { findSegments, segmentBests, segmentLast, SEG_KIND } from './segments.js';
import { testResult } from './stats.js';
import { Wizard, WIZ } from './wizard.js';
import { intervalRecords } from './ivhistory.js';
import { hrpForRide } from './hrpower.js';
import { hardWindow, wizardGate, challengeGate, summonGap, wzOf, friendCalls, friendsLine } from './ivgate.js';
import { planEagleAny, eagleGate, moveEagle, othersBusy } from './eaglegate.js';
import { Music, Coach } from './music.js';
import { MIC_SVG, SPK_SVG, voiceStatus } from './voice.js';
import { hudPrefs, applyHud, hudControlsHTML, wireHudControls, HUD_ORDER, HUD_PRESETS } from './hudprefs.js';

const MIN_RATE = 0.0625, MAX_RATE = 4;

// ---------- video player spanning GoPro chapters ----------
class ChapterPlayer {
  constructor(video, parts) { this.v = video; this.parts = parts; this.idx = -1; this.rate = 1; this.wantPlay = false; }
  get currentTime() { return this.idx < 0 ? 0 : this.parts[this.idx].offset + this.v.currentTime; }
  get duration() { const p = this.parts[this.parts.length - 1]; return p.offset + p.duration; }
  partFor(t) { let i = 0; while (i < this.parts.length - 1 && t >= this.parts[i + 1].offset) i++; return i; }
  async seek(t) {
    const i = this.partFor(t), local = Math.max(0, t - this.parts[i].offset);
    if (i !== this.idx) {
      this.idx = i; this.v.src = this.parts[i].url;
      await new Promise(r => { this.v.onloadedmetadata = r; this.v.onerror = r; });
      this.v.playbackRate = this.rate;
    }
    this.v.currentTime = local;
    if (this.wantPlay) this.v.play().catch(() => {});
  }
  set playbackRate(r) { this.rate = r; if (Math.abs(this.v.playbackRate - r) > 0.004) this.v.playbackRate = r; }
  get playbackRate() { return this.rate; }
  play() { this.wantPlay = true; if (this.v.paused) this.v.play().catch(() => {}); }
  pause() { this.wantPlay = false; this.v.pause(); }
  get seeking() { return this.v.seeking; }
  get paused() { return this.v.paused; }
  onEnded() { // jump into next chapter seamlessly
    if (this.idx < this.parts.length - 1) this.seek(this.parts[this.idx + 1].offset);
  }
  destroy() { this.v.pause(); this.v.removeAttribute('src'); this.v.load(); this.parts.forEach(p => URL.revokeObjectURL(p.url)); }
}

/** the same dice for everyone in a group: a small seeded generator (mulberry32 over a string hash) */
function seeded(str) { let h = 1779033703; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 3432918353) >>> 0;
  return () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// ---------- climbs ----------
function findClimbs(track) {
  const out = []; let start = null;
  const g = track.grade;
  for (let i = 0; i <= g.length; i++) {
    const up = i < g.length && g[i] > 2.5;
    if (up && start === null) start = i;
    if (!up && start !== null) {
      // allow short flatter bits inside a climb
      let j = i; while (j < g.length && j < i + 15 && g[j] <= 2.5) j++;
      if (j < g.length && j < i + 15 && g[j] > 2.5) { i = j; continue; }
      const len = (i - start) * STEP, gain = track.ele[Math.min(i, g.length - 1)] - track.ele[start];
      if (len >= 300 && gain >= 20) out.push({ from: start * STEP, to: i * STEP, len, gain, avg: gain / len * 100 });
      start = null;
    }
  }
  return out;
}

/** Simulate a steady ride (used to seed demo history). */
export function simulateRide(track, power, settings) {
  const p = defaultParams(settings); let v = 0, d = 0, t = 0; const samples = [];
  while (d < track.length && t < 6 * 3600) {
    v = physStep(v, power, gradeAt(track, d), 1, p); d += v; t++;
    samples.push([t, Math.round(d), power, Math.round(v * 36) / 10, 88, 0]);
  }
  return { samples, duration: t };
}

const WB_VIEWS = ['big', 'compact', 'focus'], WB_NAMES = { big: 'big', compact: 'compact', focus: 'focus' };
/** the live numbers in the interval window (owner 20.11.: "the same numbers as in normal riding, plus the time and the target
 *  watts"): [key, label, unit, the normal HUD element it mirrors (null: avg power, kept by _updateHUD), the Display item (js/hudprefs.js)
 *  that switches it]. Heart rate and cadence are always there in a workout, whatever the Display mode. */
const WB_LIVE = [['hr', 'Heart rate', 'bpm', '#hBpm', 'hr'], ['cad', 'Cadence', 'rpm', '#hCad', 'cad'], ['speed', 'Speed', 'km/h', '#hSpd', 'speed'],
  ['dist', 'Distance', 'km', '#hDist', 'dist'], ['time', 'Ride time', '', '#hTime', 'time'], ['avg', 'Avg power', 'W', null, 'power'],
  ['wkg', 'W/kg', '', '#hWkg', 'wkg'], ['grade', 'Grade', '%', '#hGrade2', 'grade']];
const WB_ALWAYS = ['hr', 'cad'];
export class RideSession {
  constructor({ route, ghost, state, onExit, autopilot = false, at = 0, group = null, ghostName = '', workout = null, catchUp = false, elapsed0 = 0 }) {
    Object.assign(this, { route, ghost, state, onExit, autopilot, group, ghostName, workout }); this._wId = workout?.id;
    this.erg = state.settings.erg !== false && !state.trainer.pmOnly; this.ftp = state.settings.ftp || 200;
    this.wAdj = 0; this.wAdjE = 0; this._adjAcc = 0; this._adjT = 0; this._stepAdj = []; // live watt offset on the hard intervals (_wTune): per rider, never sent to the group
    this.track = route.track;
    this.params = defaultParams(state.settings);
    this.d = Math.min(at, this.track.length - 1); this.v = 0; this.elapsed = 0;
    if (elapsed0 > 0) this.elapsed = elapsed0; // rejoin: the ride clock goes on where it stopped
    // late joiner: while his world loaded the others rode on; once it stands he jumps to just behind the leader (Mac mini 12.11.: ~400 m behind)
    this._catchUpNow = catchUp && group ? () => { const os = group.others().filter(r => r.riding && !r.done), lead = os.reduce((m, r) => Math.max(m, r.d), 0), lv = os.find(r => r.d === lead)?.v || 0;
      if (lead - 20 > this.d + 30 && lead < this.track.length - 50) { this.d = lead - 20; this.startD = this._lapBase = this.d; this.lastEle = eleAt(this.track, this.d); if (lv > 0 && lv < 30) this.v = lv; /* roll in at the leader's speed (Mac mini: else 85 m gap at once) */ } this._catchUpNow = null; } : null;
    this.startD = this.d; // a ride started mid-route counts its own distance and never sets a best time
    // laps (Freddy 12.11.): at the finish the route starts over until all laps are done; never in a group ride (all ride the same d)
    if (/[?&]laptest/.test(location.search)) window.__ride = this; // test handle
    this.laps = group || autopilot || route.leg ? 1 : Math.max(1, Math.min(20, +state.settings.laps || 1)); this.lap = 1; this.lapOff = 0; this._lapBase = this.d; this._lapT0 = 0; this.lapList = [];
    this.manualPower = autopilot ? 240 : 0; this.power = 0; this.cadence = 0; this.hr = 0;
    this.powerHist = []; this.samples = []; this.lastSample = 0; this.gainAcc = 0; this.lastEle = eleAt(this.track, this.d);
    this.running = false; this.paused = false; this.finished = false;
    this.climbs = this.track.intervals || findClimbs(this.track);
    this.segs = findSegments(this.track); this.segDone = []; this.segBest = {}; // Strava-like segments: climbs, descents, flats, sprints
    db.ridesFor(this.route.id).then(rs => { this.segBest = segmentBests(rs); this.segLast = segmentLast(rs); }).catch(() => {});
    import('./account.js').then(a => a.loadSegBoard(this.route.id)).then(b => { this.segBoard = b; }).catch(() => {}); // the others' times on this route
    this._wDef = workout; // kept when the workout is ended early: its intervals still go to Strava
    this._wT0 = 0; this.flatRide = false; // workout chosen mid-ride (js/ridesetup.js): it runs from that second; "just ride": the trainer gets no gradient
    this.lapMarks = []; // climbs count as laps in the Strava file (start and top of each climb)
    const st = state.settings;
    this.gears = gearsFrom(st); this.virtual = st.shiftMode === 'virtual'; this.auto = this.virtual && !!st.autoShift; this.berg = !this.virtual && !!st.bergWatt; this.realGear = parseGear(st.realGear);
    this.wheel = (st.wheel || 2105) / 1000;
    this.gi = this.gears.reduce((b, g, i) => Math.abs(Math.log(g.ratio / this.realGear.ratio)) < Math.abs(Math.log(this.gears[b].ratio / this.realGear.ratio)) ? i : b, 0);
    this.gear = this.virtual ? this.gears[this.gi] : null;
    if (at && ghost?.samples?.length) this.elapsed = Math.max(0, (this.ghostTimeAt(this.d) || 0) - 14); // screenshots / resume
    this._tick = this._tick.bind(this); this._key = this._key.bind(this); this._remote = this._remote.bind(this);
    if (st.ueBridge || new URLSearchParams(location.search).has('ue')) { this.ue = new UEBridge(route.id, { ...this.track, step: STEP }); this.ue.weather = st.ueWeather || 'auto'; } // Unreal view (beta)
  }

  async start() {
    const el = this.el = document.createElement('div'); el.className = 'ride';
    document.addEventListener('keydown', this._key); document.addEventListener('rf-remote', this._remote); // early: watts set with ↑↓ while the world loads are kept
    if (this.state.settings.poseCam) import('./posecam.js').then(async m => { if (this._closed) return; // posture by webcam
      this._poseMod = m; this.pose = new m.PoseCam(this.state.settings.poseCalib || null);
      try { await this.pose.start(); if (this._closed) this.pose.stop(); else this._flash?.('Camera: detecting your position'); }
      catch { this._flash?.('Position camera not available'); this.pose = null; } });
    el.innerHTML = this._hudHTML(); if (this.workout) el.classList.add('wk'); // the workout bar (design C) at the bottom
    applyHud(el, hudPrefs(this.state.settings));
    el.querySelector('#hHudBtn')?.addEventListener('click', () => this._hudPanel());
    document.body.append(el);
    if (this.route.parts?.length) {
      const video = document.createElement('video');
      video.muted = this.state.settings.muteVideo; video.playsInline = true; video.preload = 'auto'; video.preservesPitch = true;
      el.prepend(video);
      const parts = [];
      for (const p of this.route.parts) { const rec = await db.get('videos', p.videoId); parts.push({ ...p, url: URL.createObjectURL(rec.blob) }); }
      this.player = new ChapterPlayer(video, parts);
      video.addEventListener('ended', () => this.player.onEnded());
      await this.player.seek(timeAt(this.track, this.d));
    } else {
      const c = document.createElement('canvas'); c.className = 'scene'; el.prepend(c);
      if (this.track.world) {
        /* the card shows right away: the first ride after an update downloads all models (minutes over a friend's line), never a silent black screen */
        const ld0 = document.createElement('div'); ld0.className = 'countdown loading'; ld0.textContent = 'Loading world …'; el.append(ld0);
        const tk = setInterval(() => { const p = globalThis.__rfLoad; if (p?.total) ld0.textContent = `Loading world … ${Math.round(p.done / p.total * 100)} %`; }, 300);
        const mode = new URLSearchParams(location.search).get('mode') || this.state.settings.worldMode || 'voll'; globalThis.__rfMode = mode; /* graphics level (route page): decides which models are downloaded at all */
        try { const { WorldScene, prepareWorld, upgradeWorld } = await import('./world/lofoten.js'); await upgradeWorld(mode); clearInterval(tk); ld0.remove(); await prepareWorld(this.track);
          { const L = await loadLedger().catch(() => null), q = new URLSearchParams(location.search).get('village'); // your village grows with your lifetime km
            if (L || q != null) this.track.__village = { km: q != null ? +q : L.life.km, hm: L?.life.hm || 0, leader: L ? (leaderOf(L.pts) || L.colour) : null, colour: new URLSearchParams(location.search).get('week') || L?.colour || null }; }
          { const q = new URLSearchParams(location.search).get('sunset'); this.track.__sunset = q != null ? q === '1' : this.state.settings.light !== 'fest'; } /* the sun sets over the ride (route page: Licht) */
          this.track.__mode = mode; /* Voll / Ohne Menschen / ... (route page) */
          this.track.__look = this.state.settings.look || null; /* shop gloves on the first-person bars */
          this.player = new WorldScene(c, this.track); window.__world = this.player; }
        catch (e) { console.warn('3D world failed, using 2D scene', e); }
        clearInterval(tk); ld0.remove();
      }
      if (!this.player) this.player = new DemoScene(c, this.track);
      this.player.currentTime = timeAt(this.track, this.d);
      this.player.setFov ? this.player.setFov(fovOf(this.state.settings)) : this.player.setLens?.(this.state.settings.lensMm || 0); this.player.setView?.(this.state.settings.view3d || 0); this.player.setCockpit?.(this.state.settings.cockpit !== false);
      el.classList.toggle('world3d', !!this.player.setLens); // compact HUD over the 3D world
      this.player._placeCockpit?.();
      if (this.player.ready) { // 3D world: show a loading card instead of a black screen until the ground around the start stands
        const ld = document.createElement('div'); ld.className = 'countdown loading'; ld.textContent = 'Loading world …'; el.append(ld);
        await Promise.race([this.player.ready, new Promise(r => setTimeout(r, 90000))]); ld.remove(); this.player._rideOn = true; this._catchUpNow?.(); /* slow laptops: rather a longer loading card than a stuttering start */
      }
    }
    this.profile = el.querySelector('#hudProfile');
    { const mc = el.querySelector('#hMap'); this.minimap = new MiniMap(mc, this.track, this.player?.field?.pose ? d => this.player.field.pose(d) : null); if (!this.minimap.ok) mc.parentElement.remove(); }
    this.q = s => el.querySelector(s);
    if (this.route.leg && this.player?.field) { const { OpenWorld, islandMap } = await import('./openworld.js'); this.ow = new OpenWorld(this, await islandMap(), this.route.leg); const ds = el.querySelector('#hDistSub'); if (ds) ds.textContent = this._distSub(); } // open world on the island
    this._wireWorkoutStop();
    el.querySelector('#hGearChip')?.addEventListener('click', () => this.toggleShift());
    if (!this._closed) this._clickOff = click.on('shift', d => { if (this.paused || this.finished) return; if (this.ow?.open) return this.ow.choose(d > 0 ? 1 : -1); /* open world: while the junction strip shows, Click picks the road */ if (this.workout && !this.wDone && this.source === 'trainer') this._wTune(d); else if (this.berg) this._holdTune(d * 5); else this._padShift(d); }); // Zwift Click (connected in Settings): + / − like the pad's L/R: target ±1 W in a workout, gears otherwise
    el.querySelector('#hPause')?.addEventListener('click', () => this.paused ? this._resume() : this._pause());
    el.querySelector('#hSetup')?.addEventListener('click', e => { e.currentTarget.blur(); this._setup(); });
    el.querySelector('#hCam')?.addEventListener('click', () => this._cycleView());
    el.querySelector('#hBar')?.addEventListener('click', () => this._toggleBar());
    el.querySelector('#hWide')?.addEventListener('click', () => this._lens(-1, true));
    let hideT; el.addEventListener('mousemove', () => { el.classList.add('cursor'); clearTimeout(hideT); hideT = setTimeout(() => el.classList.remove('cursor'), 2000); });
    try { await document.documentElement.requestFullscreen?.(); } catch {}
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch {}
    if (this.state.trainer.connected) this.state.trainer.setGrade(this._trainerGrade(), true);
    const st = this.state.settings;
    this.music = new Music(this.group ? 'race' : this.workout ? 'workout' : 'world', st.musicVol ?? 0.45);
    this.coach = new Coach(st.coachVol ?? 0.9);
    this.el.querySelector('#hMusic')?.addEventListener('click', () => this._toggleMusic());
    if (this.group) { this._wireVoice(); this._wireGroupChip(); }
    this._initChallenges();
    this._initWizard();
    this._initEagle();
    this._initStory();
    if (!this.group) this.player?.events?.surprises?.startArch?.(this.d + 14); // ride off under the START arch
    this.running = true; this.last = performance.now();
    this._startPresence();
    this._updateHUD(true);
    if (!this.autopilot) await this._countdown();
    this.last = performance.now();
    requestAnimationFrame(this._tick);
  }

  _hudHTML() {
    const ghostChip = (this.group ? `<div class="chip glass groupchip" id="hGroup"><div class="label">Group <button class="gcode" id="hGCode" title="Code for friends: click to copy the invite link">${esc(this.group.code)}</button></div><div class="glist">waiting …</div></div>` : '') + (this.ghost ? `<div class="chip gap glass"><div class="label">vs. ${this.ghostName ? esc(this.ghostName) : this.state.settings.ghost === 'last' ? 'last ride' : 'best time'}</div><div class="v num" id="hGap">0:00</div></div>` : '');
    return `<div class="hud">
      <div class="hud-top">
        <div class="hud-route glass"><div class="wordmark"><svg class="mark" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="var(--accent)"/><path d="M6 24 L14 12 L19 18 L23 10 L27 24 Z" fill="#0b0b0b"/></svg>RIDEFRAME</div><span class="sep"></span><span class="name">${esc(this.route.name)}</span></div>
        <div class="hud-right">
          <div class="padlegend glass" id="hPadLegend" hidden></div>
          ${ghostChip}
          <div class="chip glass gearchip" data-hud="gear" id="hGearChip" title="Click (or G): on the bike → virtual → auto → ERG" style="cursor:pointer"><div class="label" id="hGearL">${this.berg ? 'ERG' : this.auto ? 'Auto' : this.virtual ? 'Virtual gear' : 'Gear'}</div><div class="v num" id="hGear">–</div><div class="gearbar" id="hGearBar">${this.virtual ? this.gears.map(() => '<i></i>').join('') : ''}</div></div>
          <div class="chip glass" data-hud="time"><div class="label">Time</div><div class="v num" id="hTime">0:00</div></div>
          <button class="chip glass camchip" data-hud="buttons" id="hSetup" title="Workout, mode and shifting (O)"><div class="label">Workout</div><div class="v">☰</div></button>
          <button class="chip glass camchip" id="hPause" title="Pause / finish (space)"><div class="label">Pause</div><div class="v">❚❚</div></button>
        </div>
      </div>
      ${this.workout ? this._workoutBarHTML() : ''}
      <div class="minimap glass" data-hud="map"><canvas id="hMap"></canvas></div>
      <div class="grade-tag" data-hud="gradeTag" id="hGradeTag"><div class="g num"><span class="arrow"></span><span id="hGrade">0.0</span><small>%</small></div><div class="next glass" id="hNext"></div></div>
      <div class="hud-bottom glass">
        <div class="metrics">
          <div class="metric power" data-hud="power"><div class="label">Power</div><div class="v num"><span id="hPow">0</span><small>W</small></div><div class="sub" id="hPowSub">avg 0 W</div><div class="sens" id="hPowS" hidden></div></div>
          <div class="metric" data-hud="wkg"><div class="label">W/kg</div><div class="v num"><span id="hWkg">0.0</span></div><div class="sub" id="hWkgSub">Weight ${fmtNum(this.state.settings.riderKg || 75, 0)} kg</div></div>
          <div class="metric" data-hud="speed"><div class="label">Speed</div><div class="v num"><span id="hSpd">0.0</span><small>km/h</small></div><div class="sub" id="hSpdSub">–</div></div>
          <div class="metric" data-hud="cad"><div class="label">Cadence</div><div class="v num"><span id="hCad">0</span><small>rpm</small></div><div class="sub" id="hHr">–</div><div class="sens" id="hCadS" hidden></div></div>
          <div class="metric" data-hud="dist"><div class="label">Distance</div><div class="v num"><span id="hDist">0.0</span><small>km</small></div><div class="sub" id="hDistSub">${this._distSub()}</div></div>
          <div class="metric" data-hud="hr"><div class="label">Heart rate</div><div class="v num"><span id="hBpm">–</span><small>bpm</small></div><div class="sub" id="hGain">0 m · +0 m climb</div><div class="sens" id="hHrS" hidden></div></div>
          <div class="metric" data-hud="grade"><div class="label">Grade</div><div class="v num"><span id="hGrade2">0.0</span><small>%</small></div><div class="sub" id="hTrainer">${this.state.trainer.connected ? 'Trainer active' : 'No trainer · ↑ ↓ watts'}</div></div>
        </div>
        <div class="hud-profile" data-hud="profile"><canvas id="hudProfile"></canvas></div>
      </div>
    </div>`;
  }

  async _countdown() {
    const c = document.createElement('div'); c.className = 'countdown'; this.el.append(c);
    for (const n of ['3', '2', '1', 'GO']) { c.textContent = n; await new Promise(r => setTimeout(r, 750)); }
    c.remove();
  }

  _roadGrade() {
    const g = gradeAt(this.track, this.d), s = this.state.settings;
    return g >= 0 ? g * s.difficulty / 100 : g * s.downhill / 100;
  }
  _trainerGrade() {
    let g = this.flatRide ? 0 : this._roadGrade();
    if (this.wiz?.state === 'hell') return this._wizGrade(g); // the wizard's hell: the road feels steeper
    const dk = 1 - (this._dragK ?? 1); if (Math.abs(dk) > 0.005) g -= 0.5 * this.params.rho * this.params.cda * dk * this.v * this.v / (this.params.mass * 9.81) * 100; // the trainer eases off in the slipstream / aero tuck (and gets harder standing)
    if (!this.virtual) return g;
    const t = this.state.trainer, k = this.gears[this.gi].ratio / this.realGear.ratio;
    const ws = t.data?.speed > 0.5 ? t.data.speed : Math.max(1, this.v / k);
    return virtualGrade(g, k, ws, this.params.mass);
  }
  /** cycle the shifting mid-ride (click on the gear chip or G): real bike -> virtual (Q/E) -> automatic -> Berg-Watt -> real */
  toggleShift() {
    if (this.state.trainer.pmOnly) return this._flash('Power meter only: shift on the bike (virtual gears need trainer control)', 2500);
    const mode = this.berg ? 'berg' : this.auto ? 'auto' : this.virtual ? 'virtual' : 'real';
    const next = { real: 'virtual', virtual: 'auto', auto: 'berg', berg: 'real' }[mode];
    if (next === 'berg') this.holdWatts(); else this._setShift(next); // ERG in a free ride: holds a wattage you set (owner 18.11.: no separate climb-watts mode, call it ERG)
  }
  /** one shifting mode: 'real' | 'virtual' | 'auto' | 'berg' (the G cycle above, the ride setup in js/ridesetup.js) */
  _setShift(next) {
    const st = this.state.settings, t = this.state.trainer;
    if (this.berg && next !== 'berg') { t.setPower(null); this._holdW = 0; } // back to the grade; a held wattage ends with the mode
    this.virtual = next === 'virtual' || next === 'auto'; this.auto = next === 'auto'; this.berg = next === 'berg';
    st.shiftMode = this.virtual ? 'virtual' : 'real'; st.autoShift = this.auto; st.bergWatt = this.berg;
    this.gear = this.virtual ? this.gears[this.gi] : null;
    const q = this.q; q('#hGearL').textContent = this.berg ? 'ERG' : this.auto ? 'Auto' : this.virtual ? 'Virtual gear' : 'Gear';
    q('#hGearBar').innerHTML = this.virtual ? this.gears.map(() => '<i></i>').join('') : '';
    if (t.connected && !this.berg) t.setGrade(this._trainerGrade(), true);
    this._flash({ real: 'Shift on the real bike', virtual: 'Virtual shifting · Q/E', auto: `Auto · shifts for ${st.cadence || 90} rpm`,
      berg: this.workout && this.erg && !this.wDone ? 'ERG · the workout sets the watts' : 'ERG · the trainer holds your watts, cadence is free' }[next]);
    import('./app.js').then(m => m.saveSettings());
  }
  /** the ERG target the trainer is being told right now, the same decision as _tick / _workout make (owner 20.11.: the chip
   *  said "ERG · target 165 W" in an ERG workout while the trainer held the workout's 122 W, a hill target left over from the
   *  ERG mode saved in the settings): { w, by: 'workout' | 'hold' } or null when no ERG target is sent (grade, free block,
   *  workout done, power meter only) */
  _ergNow() {
    if (this.state.trainer.pmOnly) return null;
    if (this.workout && this.erg) { const w = this.wNow; return w && !w.done && w.step && !w.step.free && w.target != null ? { w: w.target, by: 'workout' } : null; }
    return this.berg ? { w: this._bergW || this._bergTarget(), by: 'hold' } : null;
  }
  /** Berg-Watt: target power from the grade (relative to FTP); the trainer holds it in ERG, cadence is up to you */
  _bergTarget() {
    if (this._holdW) return this._bergW = this._holdW; // the rider set a wattage (_holdTune): hold exactly that, whatever the road does
    const now = performance.now(); if (this._bergW && now - (this._bergAt || 0) < 1000) return this._bergW; // once per second is plenty for BLE
    this._bergAt = now; const g = this._roadGrade() + (this.wiz?.state === 'hell' ? 2 : 0), ftp = this.ftp || 200;
    const k = g >= 0 ? 0.62 + 0.055 * g : 0.62 + 0.09 * g; // flat ~62 % FTP, 6 % ~95 %, downhill easing off
    const w = Math.round(ftp * Math.max(0.3, Math.min(1.25, k)) / 5) * 5;
    this._bergW = this._bergW ? this._bergW + Math.sign(w - this._bergW) * Math.min(Math.abs(w - this._bergW), 10) : w; // max 10 W per second, no jumps
    return this._bergW;
  }
  /** hold watts in a free ride (owner 18.11.: "wo er die Watt hält … über Controller erhöhen und niedrigen"): in climb watts the
   *  pad, Zwift Click and keys set the wattage; from the first press the trainer holds that number until the mode changes */
  _holdTune(d) {
    if (!this.berg || (this.workout && this.erg)) return false;
    this._holdW = Math.max(30, Math.min(900, Math.round((this._holdW || this._bergW || this._bergTarget()) + d)));
    this._bergW = this._holdW; this.state.trainer.setPower(this._holdW);
    const q = this.q; if (q && q('#hGear')) { q('#hGear').textContent = this._holdW + ' W'; q('#hGearL').textContent = 'ERG · target'; }
    this._flash(`ERG ${this._holdW} W`, 1200); return true;
  }
  /** hold watts from the ride setup's ERG button without a workout: start at what you ride now (or 60 % FTP) */
  holdWatts() {
    if (this.state.trainer.pmOnly) return false;
    if (!this.berg) this._setShift('berg');
    const now = this.power > 40 ? this.power : (this.ftp || 200) * 0.6;
    this._holdW = Math.max(30, Math.round(now / 5) * 5); return this._holdTune(0);
  }
  /** automatic virtual shifting: keeps you near your favourite cadence; Q/E override it for 15 s */
  _autoShift(dt) {
    if (!this.auto || !this.virtual || this.paused || this.v < 1.5 || this.power <= 0 || this._ergOn) { this._asT = 0; return; } // ERG: the trainer holds the watts, no gear changes
    if (performance.now() - (this._manualShiftAt || 0) < 15000) return;
    const t = this.state.trainer, target = this.state.settings.cadence || 90;
    const cad = t.connected && t.data?.cadence > 20 ? t.data.cadence : this.v / (this.gear.ratio * this.wheel) * 60;
    const dir = cad < target - 9 ? -1 : cad > target + 9 ? 1 : 0;
    if (!dir || dir !== this._asDir) { this._asDir = dir; this._asT = 0; return; }
    this._asT = (this._asT || 0) + dt;
    if (this._asT > 1.4) { this._asT = 0; this.shift(dir, true); }
  }
  shift(dir, auto = false) {
    if (!auto) this._manualShiftAt = performance.now();
    if (!this.virtual) { // real shifting: the gear is changed on the bike itself
      if (!this._shiftHint) { this._shiftHint = true; this.q && (this.q('#hGearL').textContent = 'Shift on the bike · G = virtual/auto'); }
      return;
    }
    const gi = Math.max(0, Math.min(this.gears.length - 1, this.gi + dir));
    if (gi === this.gi) return;
    this.gi = gi; this.gear = this.gears[gi]; this.shiftFlash = performance.now();
    if (this.state.trainer.connected) this.state.trainer.setGrade(this._trainerGrade(), true);
  }

  _readInputs() {
    const t = this.state.trainer;
    const fresh = t.connected && t.lastData && performance.now() - t.lastData < 3000;
    if (fresh) { this.power = Math.max(0, t.data.power); this.cadence = t.data.cadence; this.hr = t.data.hr || this.state.hr?.hr || 0; this.source = 'trainer'; }
    else {
      if (this.autopilot) { const g = gradeAt(this.track, this.d); this.manualPower = Math.round(230 + g * 6 + 12 * Math.sin(this.elapsed / 7)); }
      this.power = this.manualPower; this.hr = this.state.hr?.hr || 0; this.source = 'manual';
      if (this.virtual) this.cadence = this.power > 0 && this.v > 0.5 ? Math.min(160, Math.round(this.v / (this.gear.ratio * this.wheel) * 60)) : 0;
      else this.cadence = this.power > 0 ? Math.round(86 + 4 * Math.sin(this.elapsed / 5)) : 0;
    }
  }

  /** Unreal view connected: stop drawing the browser 3D world, show only the HUD */
  _ueLive() {
    const on = this.ue.unreal;
    if (on === !!this._ueOn) return;
    this._ueOn = on; if (this.player) this.player.sleep = on;
    this.el?.classList.toggle('ue-live', on);
    this._flash?.(on ? (this.ue.mismatch ? `Warning: RIDEFRAME ${this.ue.version} and Unreal ${this.ue.ueVersion} do not match` : 'Picture now runs in Unreal') : 'Unreal disconnected, picture back here');
  }
  _tick(now) {
    if (!this.running) return;
    const dt = Math.min(0.25, (now - this.last) / 1000); this.last = now;
    this._pollPad();
    this._eagleHud();
    if (!this.paused && !this.finished) {
      this._readInputs(); this._autoShift(dt);
      const g = gradeAt(this.track, this.d);
      // drafting (group ride, Freddy: Windschatten zu zweit): right behind a friend you need up to a third less power
      const dk = this._draftTo || 0; this._draftK = (this._draftK || 0) + (dk - (this._draftK || 0)) * Math.min(1, dt * 0.8); // eases in and out, no sudden jolt
      this._togK = (this._togK || 0) + ((this._togetherTo || 0) - (this._togK || 0)) * Math.min(1, dt * 0.5);
      const pk = this._postureK(); this._dragK = pk * (1 - this._draftK) * (1 - this._togK); // posture by webcam (aero / standing) and the slipstream
      this.v = physStep(this.v, this.power, g, dt, Math.abs(this._dragK - 1) > 0.005 ? { ...this.params, cda: this.params.cda * this._dragK } : this.params);
      const d0 = this.d, g0 = this.gainAcc;
      this.d = Math.min(this.track.length, this.d + this.v * dt);
      this.elapsed += dt;
      const e = eleAt(this.track, this.d); if (e > this.lastEle) this.gainAcc += e - this.lastEle; this.lastEle = e;
      this.story?.tick(dt, { dd: this.d - d0, dh: this.gainAcc - g0, power: this.power, cadence: this.source === 'trainer' && (this._cadSeen ||= this.cadence > 0) ? this.cadence : null, moving: this.wiz?.state !== 'fly' });
      this._workout(dt);
      this._chTick(dt);
      this._segTick(d0, dt);
      this._cgTick();
      this._wizTick(dt);
      this._eagleTick(dt);
      this._mlJ = (this._mlJ || 0) + (this.power || 0) * dt; // work so far, for the manual laps' average watts
      if ((this._moodT = (this._moodT || 0) + dt) > 1) { this._moodT = 0; this._mood(); }
      if (this.berg && !(this.workout && this.erg)) this.state.trainer.setPower(this._bergTarget());
      else this.state.trainer.setGrade(this._trainerGrade());
      this._syncVideo();
      if (this.elapsed - this.lastSample >= 1) {
        this.lastSample = Math.floor(this.elapsed);
        this.samples.push([this.lastSample, Math.round(this._ridden()), Math.round(this.power), Math.round(this.v * 36) / 10, Math.round(this.cadence), this.hr]);
        this.powerHist.push(this.power);
      }
      if (!this.ow) this._keepPlace(); else this.ow.tick();
      if (this.d >= this.track.length && this.ow) { if (!this.ow.busy) this._swapLeg(); else this.lapOff += this.v * dt; } // open world: the next road (time and km go on while it loads)
      else if (this.d >= this.track.length) { if (this.lap < this.laps) this._nextLap(); else if (this.autopilot) this._finish(); else this._goalAsk(); }
    }
    if (now - (this.lastHud || 0) > 100) { this.lastHud = now; this._updateHUD(); }
    if (this.ue) this._ueLive();
    this.ue?.update(now, { d: Math.round(this.d * 100) / 100, v: Math.round(this.v * 100) / 100, grade: Math.round(gradeAt(this.track, this.d) * 10) / 10, fov: fovOf(this.state.settings), riders: this._ueRiders || [], watt: Math.round(this.power), hr: this.hr, cad: Math.round(this.cadence), paused: this.paused || this.finished, t: Math.round(this.elapsed * 10) / 10 });
    requestAnimationFrame(this._tick);
  }

  _pollPad() { // any Bluetooth gamepad (e.g. 8BitDo Micro on the bars) drives the whole ride; mapping in PAD_MAP (controller.js shows it)
    const pad = activePad(); if (!pad) return; // a real pad or the phone remote (js/remotepad.js)
    if (document.querySelector('.rideset')) { this.padPrev = padButtons(pad); return; } // the settings sheet over the ride: js/padnav.js drives it
    const b = padButtons(pad), was = this.padPrev || [];
    this.padPrev = b;
    if (!this.padSeen) { this.padSeen = true; this._flash('🎮 Controller ready · Start = pause'); }
    const hit = i => b[i] && !was[i];
    if (this._ask && (hit(0) || hit(1))) { this._ask.answer(hit(0)); return; } // "Freddy wants to join you": A = accept, B = not now
    if ((hit(9) || hit(16)) && !this.finished) { this.paused ? this._resume() : this._pause(); return; } // Start or Home: pause menu
    if (this.paused && !this.finished) { // menu navigation like on a console (finished from the pause menu: paused stays true, the end screen is not a menu here)
      for (const [i, dir] of [[12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']]) if (hit(i)) this._padMove(dir);
      if (hit(0)) this.q('#pauseOverlay')?.querySelectorAll('.padmenu button')[this._padI || 0]?.click();
      if (hit(1)) this.q('#oBack, #invBack') ? this.q('#oBack, #invBack').click() : this._resume();
      return;
    }
    if (this.finished) return;
    if (this.ow?.open && (hit(14) || hit(15))) { this.ow.choose(hit(14) ? -1 : 1); return; } // open world: D-pad left / right picks the road
    // one job per button and per mode (owner 18.11.): ERG (workout or free ride) L / R ±5 W, L2 / R2 ±1 W · gears: L / R shift.
    // The D-pad's ↑ ↓ do the same as R / L; nothing else sits on it. A accepts, B display, X photo, Y camera, Select shifting mode.
    const up = hit(5) || hit(12), dn = hit(4) || hit(13), fine = hit(7) ? 1 : hit(6) ? -1 : 0;
    const m = this._padMode();
    if (m === 'work') { const d = up ? 5 : dn ? -5 : fine; if (d) this._wTune(d); }
    else if (m === 'erg') { const d = up ? 5 : dn ? -5 : fine; if (d) this._holdTune(d); }
    else if (up || dn) this._padShift(up ? 1 : -1);
    if (hit(0)) { this._chKey = true; if (this.ch?.active?.state === 'offer') this._flash('Accepted!'); }
    if (hit(1)) this._cycleHud();
    if (hit(2) && this.player?.snapshot && !this._shooting) this._takePhoto().then(url => this._shotPop(url));
    if (hit(3)) this._cycleView();
    if (hit(8)) this.toggleShift();
  }
  /** what the pad's L / R do right now: 'work' (workout target), 'erg' (free-ride ERG watts) or 'gear' */
  _padMode() { return this.workout && !this.wDone ? 'work' : this.berg ? 'erg' : 'gear'; }
  /** the controller legend in the top bar: which button does what in this mode; only once a pad was used */
  _padLegend() {
    const el = this.q('#hPadLegend'); if (!el || !this.padSeen) return;
    const m = this._padMode(), key = m + (this.virtual ? 'v' : 'r');
    if (el.dataset.k === key) return; el.dataset.k = key; el.hidden = false;
    const rows = [...(m === 'gear' ? [['L R', this.virtual ? 'Gear − / +' : 'Virtual gears']] : [['L R', '−5 / +5 W'], ['L2 R2', '−1 / +1 W']]),
      ['Y', 'Camera'], ['X', 'Photo'], ['B', 'Display'], ['Start', 'Pause']];
    el.innerHTML = rows.map(([k, t]) => `<span><kbd>${k}</kbd>${t}</span>`).join('');
  }
  /** the photo just taken, shown small at the left edge for a moment (owner 18.11.) */
  _shotPop(url) {
    if (!url || !this.el) return this._flash('No photo');
    let p = this.q('#hShot'); if (!p) { p = document.createElement('div'); p.id = 'hShot'; p.className = 'shotpop glass'; p.innerHTML = '<img alt=""><small>Photo saved</small>'; this.el.append(p); }
    p.querySelector('img').src = url; p.classList.add('on'); clearTimeout(this._shotT); this._shotT = setTimeout(() => p.classList.remove('on'), 3000);
  }
  /** a lap by hand (owner 19.11.: the lap key on the phone remote, "die dann auch mit ausgewertet wird"): time, distance and
   *  average watts since the last one; a lap mark in the Strava file and a row on the result screen */
  _manRow() { const m = this._ml || { t: 0, d: 0, j: 0 }, t = this.elapsed - m.t; return { t: Math.round(t), d: Math.round(this._ridden() - m.d), w: t > 0 ? Math.round(((this._mlJ || 0) - m.j) / t) : 0 }; }
  _manLap() {
    const r = this._manRow(); if (r.t < 5) return this._flash('Lap too short');
    (this.manLaps ||= []).push(r); this._ml = { t: this.elapsed, d: this._ridden(), j: this._mlJ || 0 }; this.lapMarks.push(Math.round(this.elapsed));
    this._flash(`Lap ${this.manLaps.length}: ${fmtTime(r.t)} · ${fmtKm(r.d)} km · ${r.w} W`, 3000);
  }
  /** the phone remote's quick setup (owner 19.11.): ERG / shift on the bike / virtual gears with one tap, and a photo */
  _remote(e) {
    const n = e.detail?.name; if (!this.running || this.paused || this.finished) return;
    if (n === 'lap') return this._manLap();
    if (n === 'turn:left' || n === 'turn:right') { if (!this.ow?.choose(n === 'turn:left' ? -1 : 1)) this._flash(this.ow ? 'The next junction is not in sight yet' : 'Turning works in the open world on the island'); return; }
    if (n === 'photo') { if (this.player?.snapshot && !this._shooting) this._takePhoto().then(url => this._shotPop(url)); return; }
    if (this.workout && !this.wDone) return this._flash('In a workout the plan sets the mode');
    if (this.state.trainer.pmOnly) return this._flash('Power meter only: shift on the bike (virtual gears need trainer control)', 2500);
    if (n === 'mode:erg') { if (!this.berg) this.holdWatts(); } else if (n === 'mode:real' || n === 'mode:virtual') { const m = n.slice(5); if ((this.berg ? 'berg' : this.virtual ? 'virtual' : 'real') !== m) this._setShift(m); }
  }
  _padShift(d) { if (!this.virtual && !this.berg) this.toggleShift(); this.shift(d); }

  _syncVideo() {
    const p = this.player;
    if (this.v < 0.3) { if (!p.paused || p.wantPlay) p.pause(); return; }
    const target = timeAt(this.track, this.d);
    const cur = p.currentTime;
    const diff = target - cur;
    if (Math.abs(diff) > 2.5 && !p.seeking) { p.seek ? p.seek(target) : (p.currentTime = target); return; }
    const base = this.v / Math.max(0.5, videoSpeedAt(this.track, this.d));
    const rate = Math.max(MIN_RATE, Math.min(MAX_RATE, base * (1 + Math.max(-0.5, Math.min(0.5, diff * 0.6)))));
    p.playbackRate = Math.round(rate * 100) / 100;
    this.rate = rate;
    if (p.paused || (p.wantPlay === false)) p.play();
  }

  ghostTimeAt(d) { // seconds the ghost needed to reach distance d
    const s = this.ghost.samples; if (!s?.length) return null;
    let lo = 0, hi = s.length - 1;
    if (d <= s[0][1]) return s[0][0] * d / Math.max(1, s[0][1]);
    if (d >= s[hi][1]) return null;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m][1] <= d) lo = m; else hi = m; }
    const f = (d - s[lo][1]) / Math.max(1, s[hi][1] - s[lo][1]);
    return s[lo][0] + f * (s[hi][0] - s[lo][0]);
  }
  ghostDistAt(t) {
    const s = this.ghost?.samples; if (!s?.length) return null;
    const i = Math.min(s.length - 1, Math.max(0, Math.floor(t) - 1));
    return s[i][1];
  }

  /** what the sensors deliver (owner 17.11.: never "0 W" / "0 bpm" from a sensor that is not there): 'ok', 'none' (never
   *  connected) or 'lost' (was connected, dropped during the ride). Keyboard / demo watts count as a power source. */
  _sensors() {
    const t = this.state.trainer, h = this.state.hr, tr = this.source === 'trainer';
    if (tr) this._hadTr = true;
    const test = !tr && (this.keyPower || this.autopilot || this.manualPower > 0);
    const pw = tr || test ? 'ok' : this._hadTr || t.device ? 'lost' : 'none';
    const hrOn = !!h?.connected || (tr && t.data?.hr > 0); if (hrOn) this._hadHr = true;
    return { pw, cad: pw, hr: hrOn ? 'ok' : this._hadHr || h?.device ? 'lost' : 'none' };
  }
  /** the small "No connection" / "Connection lost · Reconnect" lines under the values, only rebuilt when a state changes */
  _sensUI(sn) {
    const k = sn.pw + sn.cad + sn.hr; if (k === this._sensK) return; this._sensK = k;
    const line = (st, none, rc) => st === 'ok' ? '' : `<i class="dot"></i>${st === 'lost' ? 'Connection lost' : none}${st === 'lost' && rc ? ` <button class="sens-rc" data-rc="${rc}">Reconnect</button>` : ''}`;
    const set = (id, html) => { const e = this.q(id); if (!e) return; e.innerHTML = html; e.hidden = !html; e.previousElementSibling?.classList.toggle('sens-hide', !!html); };
    set('#hPowS', line(sn.pw, 'No connection', 'tr')); set('#hCadS', line(sn.cad, 'No sensor', '')); set('#hHrS', line(sn.hr, 'No sensor', 'hr'));
    this.el.querySelectorAll('.sens-rc').forEach(b => b.onclick = e => { e.currentTarget.blur(); this._reconnect(b.dataset.rc); });
  }
  _reconnect(which) {
    const d = which === 'hr' ? this.state.hr : this.state.trainer; if (!d?.device) return;
    this._flash(which === 'hr' ? 'Reconnecting the heart rate strap…' : 'Reconnecting the trainer…');
    (which === 'hr' ? d._open() : d._reconnect()).catch?.(() => this._flash('Reconnect failed: wake the device and try again'));
  }

  _updateHUD(force) {
    const q = this.q; if (!q) return;
    const g = gradeAt(this.track, this.d);
    const avgP = this._avgP = this.powerHist.length ? Math.round(this.powerHist.reduce((a, b) => a + b, 0) / this.powerHist.length) : 0;
    const p3 = this.powerHist.slice(-3); const pShow = p3.length ? Math.round((p3.reduce((a, b) => a + b, 0) + this.power) / (p3.length + 1)) : this.power;
    const sn = this._sensors(); this._sensUI(sn);
    q('#hPow').textContent = sn.pw === 'ok' ? pShow : '–'; const wk = q('#hWkg'); if (wk) wk.textContent = sn.pw === 'ok' ? fmtNum(pShow / (this.state.settings.riderKg || 75), 1) : '–';
    q('#hPowSub').textContent = `avg ${avgP} W · ${fmtNum(pShow / this.state.settings.riderKg, 1)} W/kg`;
    q('#hSpd').textContent = fmtNum(this.v * 3.6, 1);
    q('#hSpdSub').textContent = this.ow ? `${fmtNum(Math.max(0, this.track.length - this.d) / 1000, 1)} km to the junction` : this.track.world ? `${fmtNum(Math.max(0, this.track.length * (this.laps - this.lap + 1) - this.d) / 1000, 1)} km to go` : this.v < 0.3 ? 'Video paused' : `Video ×${fmtNum(this.rate || 1, 2)}`;
    q('#hCad').textContent = sn.cad === 'ok' ? this.cadence : '–';
    const tc = this.state.settings.cadence, cadOff = tc && this.cadence > 20 && sn.cad === 'ok' ? this.cadence - tc : 0;
    // ERG (owner 17.11.): the trainer sets the resistance, gears mean nothing: no shifting advice, at most "spin faster"
    const hint = this._ergOn ? (sn.cad === 'ok' && this.cadence > 0 && this.cadence < 60 && this.wNow?.target && this.power < this.wNow.target * 0.9 ? '▲ spin faster' : '')
      : cadOff < -8 ? '▼ shift easier' : cadOff > 8 ? '▲ shift harder' : '';
    q('#hHr').textContent = hint || (tc ? `target ${tc} rpm` : '–');
    q('#hHr').classList.toggle('hint-on', !!hint);
    this._padLegend();
    const t = this.state.trainer, erg = this._ergNow();
    q('#hGearBar').hidden = !!erg; // ERG: the trainer holds the watts in any gear
    // the trainer does not take the target (another app holds the control, or the browser got no control point): say so
    // instead of showing a wattage the trainer never got (Freddy 20.11.)
    const noCtl = erg && t.connected && (t.ctlRefused ? 'refused' : !t.cp ? 'none' : '');
    if (noCtl && !this._noCtlTold) { this._noCtlTold = true; this._flash(noCtl === 'refused' ? 'The trainer refuses the ERG target: close other apps that control it (Wahoo, Zwift, watch)' : 'No trainer control: this connection only reads the watts. Reconnect the trainer', 6000); }
    if (!noCtl) this._noCtlTold = false;
    q('#hGearL').classList.toggle('warn', !!noCtl);
    if (erg) { q('#hGear').textContent = erg.w + ' W'; q('#hGearL').textContent = noCtl ? 'ERG · trainer not following' : erg.by === 'workout' ? 'ERG · workout' : 'ERG · target'; }
    else if (this.virtual) {
      q('#hGear').textContent = gearName(this.gear);
      q('#hGearL').textContent = `${this.auto ? 'Auto' : 'Virtual gear'} ${this.gi + 1}/${this.gears.length}`;
      q('#hGearBar').querySelectorAll('i').forEach((el, i) => el.className = i <= this.gi ? 'on' : '');
      q('.gearchip').classList.toggle('shifted', performance.now() - (this.shiftFlash || 0) < 350);
    } else {
      if (/^ERG/.test(q('#hGearL').textContent)) q('#hGearL').textContent = 'Gear'; // no ERG target now (a free block, ERG just switched off, the workout done)
      const g = estimateGear(this.gears, t.data?.speed, this.cadence, this.wheel * 1000); q('#hGear').textContent = g ? gearName(g) : '–';
    }
    q('#hDist').textContent = fmtNum((this.lapOff + this.d) / 1000, 2);
    q('#hBpm').textContent = sn.hr === 'ok' ? this.hr : '–'; // a connected strap that says 0 shows 0
    q('#hGain').textContent = `${fmtNum(eleAt(this.track, this.d))} m · +${fmtNum(this.gainAcc)} m climb`;
    q('#hGrade').textContent = fmtNum(Math.abs(g), 1);
    q('#hGrade2').textContent = fmtNum(g, 1);
    q('#hTime').textContent = fmtTime(this.elapsed);
    const tag = q('#hGradeTag'); tag.className = 'grade-tag ' + (g > 0.5 ? 'up' : g < -0.5 ? 'down' : 'flat');
    if (this.source) q('#hTrainer').textContent = this.source === 'trainer' ? (this.state.trainer.pmOnly ? 'Power meter · trainer free' : `Trainer ${fmtNum(this._trainerGrade(), 1)} %`) : 'No trainer · ↑ ↓ watts';
    // climb info
    const cur = this.climbs.find(c => this.d >= c.from && this.d < c.to);
    const next = this.climbs.find(c => c.from > this.d);
    const nx = q('#hNext');
    const ftp = this.state.settings.ftp, cw = cur?.watt ?? 1, zLo = Math.round(ftp * cw * .95), zHi = Math.round(ftp * cw * 1.05); // climbs may be designed below threshold (Himmelsleiter: 80-85 %)
    const pw = q('.metric.power'); pw.classList.remove('z-lo', 'z-ok', 'z-hi');
    if (cur?.interval) {
      const n = this.climbs.indexOf(cur) + 1, left = cur.to - this.d;
      const eta = left / Math.max(1.5, this.v);
      const cg = this._cg?.c === cur && this._cgD != null ? ` · 👻 ${this._cgD >= this.d ? '−' : '+'}${Math.round(Math.abs(this._cgD - this.d))} m` : '';
      nx.innerHTML = `<b>Interval ${n}/${this.climbs.length}</b> · ${esc(cur.name)} · ${fmtTime(eta)} left${ftp ? ` · target ${zLo}–${zHi} W` : ''}${cg}`; nx.hidden = false;
      if (ftp) pw.classList.add(pShow < zLo ? 'z-lo' : pShow > zHi ? 'z-hi' : 'z-ok');
    } else if (next?.interval) {
      nx.innerHTML = `Next interval in ${fmtKm(next.from - this.d)} km · ${esc(next.name)} · ${next.minutes} min avg ${fmtNum(next.grade, 1)} %`; nx.hidden = false;
    } else if (cur) { const left = cur.to - this.d; const gl = eleAt(this.track, cur.to) - eleAt(this.track, this.d); nx.innerHTML = `${fmtKm(left)} km to go · avg ${fmtNum(gl / left * 100, 1)} %`; nx.hidden = false; }
    else if (next) { nx.innerHTML = `Climb in ${fmtKm(next.from - this.d)} km · ${fmtKm(next.len)} km avg ${fmtNum(next.avg, 1)} %`; nx.hidden = false; }
    else nx.hidden = true;
    // ghost
    let ghostD = null;
    if (this.ghost && this.lap === 1) { // the ghost rode one lap
      ghostD = this.ghostDistAt(this.elapsed);
      const gt = this.ghostTimeAt(this.d);
      const el = q('#hGap');
      if (gt != null && this.d > 20) {
        const gap = this.elapsed - gt;
        el.textContent = (gap <= 0 ? '−' : '+') + fmtTime(Math.abs(gap));
        el.className = 'v num ' + (gap <= 0 ? 'ahead' : 'behind');
      }
    }
    this._workoutHUD(pShow);
    this._photoTick();
    this._others(ghostD);
    drawHudProfile(this.profile, this.track, this.d, ghostD);
    if (this.minimap?.ok && (!this._mapT || performance.now() - this._mapT > 150)) { // ~7 per second is plenty for a map
      this._mapT = performance.now();
      { const top = this.q('.hud-top'), mm = this.q('.minimap'); if (top && mm) { const y = Math.round(top.offsetTop + top.offsetHeight + 12) + 'px'; if (mm.style.top !== y) mm.style.top = y; } } // never under the chips (owner 18.11.)
      const hex = n => typeof n === 'number' ? '#' + n.toString(16).padStart(6, '0') : null;
      this.minimap.draw(this.d, (this._mapRiders || []).map(r => ({ d: r.d, color: hex(r.color ?? this.player?.riders?.list?.get(r.id)?.color) || (r.ghost ? '#9aa3ad' : '#2f7fd8') })));
    }
  }

  /** live in a workout (owner 17.11.): what the workout asks for right now a few watts up or down (D-pad / L / R / arrows 1 W,
   *  L2 / R2 / W / S 5 W). Two offsets, both kept for the whole workout: one for the hard intervals (wAdj), one for everything
   *  easier (wAdjE: warm-up, rests, cool-down); free blocks have none. */
  _wTune(d) {
    if (!this.workout || this.wDone) return;
    const w = workoutState(this.workout, this._wClock(), this.ftp); if (w.done || !w.step || w.step.free) return this._flash('Free block: ride as you like');
    const k = isHard(w.step) ? 'wAdj' : 'wAdjE'; this[k] = tuneAdj(this[k], d);
    this._wT = 0; this._workout(0); this._workoutHUD(this.power); // HUD, chart and ERG follow right away
    this._flash(`Target ${this.wNow.plateau} W (${fmtAdj(this[k])} ${k === 'wAdj' ? 'on the intervals' : 'on the easy parts'})`);
  }
  /** training program: target power for now; in ERG mode the trainer holds it */
  _workout(dt = 0.016) {
    if (!this.workout) return this._ergSpan(false);
    // targets with the rider's offsets (_wTune: hard intervals, easy parts) and, in ERG, ramps instead of a wall into / out of hard intervals
    const w = this.wNow = workoutState(this.workout, this._wClock(), this.ftp, { hardAdj: this.wAdj, easyAdj: this.wAdjE, ramp: this.erg });
    if (!w.done && isHard(w.step) && dt > 0) { this._adjAcc += this.wAdj * dt; this._adjT += dt; const sa = this._stepAdj[w.i] ||= [0, 0]; sa[0] += this.wAdj * dt; sa[1] += dt; } // time-weighted, for the saved ride
    if (this.erg) this.state.trainer.setPower(w.done || w.step?.free ? null : w.target); // a test block is ridden freely
    if (dt > 0) this._ergSpan(this.erg && !w.done && !w.step?.free);
        if (w.done && !this.wDone) { this.wDone = true; this._flash?.('Workout done!'); } // no coach voice in workouts (owner 17.11.): the bar shows it all
  }

  /** the hard interval running now (pct >= 88, 1 min or longer) with the rider's tuned target, or null (ivgate.js) */
  _hardWin() { return hardWindow(this.workout, this._wClock(), this.ftp, { hard: this.wAdj, easy: this.wAdjE }); }
  /** ERG control on / off over the ride (seconds): only a marker (owner 17.11.: the climb, best times, segments and the export
   *  stay as on any ride, speed comes from the power on the route's grade); in ERG no shifting advice and no auto shifting */
  /** seconds into the workout: from the ride start, or from the second it was chosen in the ride (js/ridesetup.js) */
  _wClock() { return this.elapsed - (this._wT0 || 0); }
  _ergSpan(on) {
    if (on === !!this._ergOn) return;
    const sp = this._ergSpans ||= [], t = Math.round(this.elapsed);
    if (on) sp.push([t, null]); else if (sp.length) sp[sp.length - 1][1] = t;
    this._ergOn = on;
  }
  _ergRec() { const sp = (this._ergSpans || []).map(([a, b]) => [a, b ?? Math.round(this.elapsed)]).filter(([a, b]) => b > a); return sp.length ? { erg: true, mode: 'Workout (ERG)' } : {}; } // a structured ERG workout: a marker, nothing else

  // ---------- challenges (in a workout only inside a hard interval, at its target: ivgate.js; in a group ride (Freddy 12.11.) the same challengers wait at the same spots for
  // everyone, dice seeded with the group code; each races against his own FTP, the results are shared with the group) ----------
  _initChallenges() {
    const n = this.state.settings.challenges ?? 4, sp = this.player?.events?.surprises;
    if (this.autopilot || !n || this.track.__mode === 'leer') return; // graphics level 1: landscape only, nothing happens
    const grp = this.group ? seeded(this.group.code + this.route.id + 'ch' + (this.lap || 1)) : null;
    this.ch = new Challenges({ length: this.track.length, startD: grp ? 0 : this.d, n, ftp: this.ftp, params: this.params, gradeAt: d => gradeAt(this.track, d),
      has: models => !sp || models.some(m => sp.A.find(m)), rng: grp || Math.random });
    if (!this.ch.list.length) { this.ch = null; return; }
    if (new URLSearchParams(location.search).has('challenge')) { this.ch.list[0].at = this.d + 600; window.__ride = this; } // test: the first dare comes after 600 m
    const c = document.createElement('div'); c.className = 'chcard glass'; c.id = 'hCh'; c.hidden = true; this.el.querySelector('.hud').append(c);
  }
  _chTick(dt) {
    const ch = this.ch; if (!ch) return;
    if ((this.wiz?.busy || this.eagle?.busy) && !ch.active) return; // the wizard's trial or flight or hell, the eagle: no dares meanwhile
    const gate = this.workout ? challengeGate(this.wDone ? null : this._hardWin()) : null; // workout: only inside a hard interval, at its target
    const sp = this.player?.events?.surprises, evs = ch.tick(dt, this.d, this.power, this._chKey, this.v, gate); this._chKey = false;
    for (const { type, ch: x } of evs) {
      if (type === 'offer') { x.h = sp?.challenger(x.c, x.spot); x.h?.say(x.c.ask, 3.2); if (sp) sp.hold = true; this.coach?.say('challenge', 0); }
      else if (type === 'accept') this.story?.challenge(x.c.id, 'accept');
      else if (type === 'go') { if (x.h) { x.h.d = x.opp; x.h.go(); } x.flags = sp?.finishFlags(x.finish); }
      else if (type === 'expire') this._chEnd(x, sp, 600);
      else if (type === 'win' || type === 'lose') {
        if (type === 'win') this.story?.challenge(x.c.id, 'win');
        x.h?.say(type === 'win' ? x.c.win : x.c.lose, 3); this._chEnd(x, sp, 4000);
        if (this.group) { (this._cr ||= []).push([x.c.name.slice(0, 30), type === 'win' ? 1 : 0, Math.round(x.avg || 0)]); this.group.update({ cr: this._cr.slice(-4) }); }
        this._chRes = { until: performance.now() + 6000, card: { kind: 'result', name: x.c.name, won: type === 'win', avg: Math.round(x.avg || 0), gap: Math.round(Math.abs(this.d - x.opp)) } }; // the result stays up a moment
      }
    }
    if (this._chFlags) this._chFlags = this._chFlags.filter(o => this.d > o.at + 30 ? (o.f.remove(), false) : true);
    const x = ch.active;
    if (x?.h && x.state === 'race') {
      x.h.d = x.opp;
      if (x.opp < this.d - 6 && x.opp > this.d - 45 && performance.now() > (this._lbNext || 0)) { this._lbNext = performance.now() + 14000; this.player?.lookBack?.(x.h.side > 0 ? -1 : 1); }
    }
    const el = this.q('#hCh'); if (el) this._chPanel(el, (this._chRes && performance.now() < this._chRes.until ? this._chRes.card : null) || ch.card(this.d));
  }

  // ---------- the story "The Bet" (js/story.js): Wizard points for the ride, short English lines ----------
  _initStory() {
    const qs = new URLSearchParams(location.search);
    if ((this.autopilot && !qs.has('story')) || qs.has('nostory')) return; // the autopilot (demo, tests) books nothing unless ?story
    loadLedger().then(L => { if (this._closed) return;
      this.story = new StoryRide({ L, ftp: this.ftp, training: !!this.workout || !!this.group, routeId: this.route.id, say: (who, text) => this._storySay(who, text) }); }).catch(() => {});
  }
  _storySay(who, text) {
    const w = WHO[who]; if (!w) return;
    console.log('[story]', who, text);
    this.player?.events?.sound?.speak?.(text, 1, 'call'); // ElevenLabs recording only: no text in the middle of the picture (Freddy)
  }
  _storyEnd() { if (!this.story || this._storySum) return this._storySum; this._storySum = this.story.finish(this.elapsed / 60); return this._storySum; }

  // ---------- the wizard (rare): a 60 s trial; pass = 30 s flight, fail = 5 min hell. In a workout only inside a hard
  // interval, at its target (ivgate.js); in a group ride for everyone at once, each against his own target ----------
  _initWizard() {
    if (this.autopilot || this.state.settings.wizard === false || this.track.__mode === 'leer') return; // level 1: no wizard without his figure
    const qs = new URLSearchParams(location.search), spots = this.ch?.list.map(x => x.at) || [];
    if (this.workout) { // no spot on the road: called inside a hard interval from 30–75 % of the workout on
      this.wiz = new Wizard({ length: this.track.length, startD: this.d, ftp: this.ftp, force: qs.has('wizard'), chance: qs.has('nowizard') ? 0 : 0.35, workout: this.workout.steps.reduce((t, x) => t + x.dur, 0) });
      if (this.wiz.state === 'off') { this.wiz = null; return; }
    } else {
      // group ride (Freddy 12.11.): the wizard always comes, at the same spot for everyone (dice seeded with the group code);
      // each rider takes the trial with his own watts, so one may fly while the other rides through hell
      const grp = this.group ? seeded(this.group.code + this.route.id + this.lap) : null;
      if (!grp && !qs.has('wizard')) { // alone: every ride, once, by the clock: called between minute 8 and 23, so his trial is done by minute 30 (owner 19.11.)
        if (this._wizMet || qs.has('nowizard')) return;
        this._wizArm ??= qs.has('wizardat') ? +qs.get('wizardat') : 480 + Math.random() * 900;
        this.wiz = new Wizard({ length: this.track.length, startD: this.d, ftp: this.ftp, timed: this._wizArm });
      } else
      this.wiz = new Wizard({ length: this.track.length, startD: grp ? 0 : this.d, ftp: this.ftp, force: qs.has('wizard'), chance: qs.has('nowizard') ? 0 : grp ? 1 : 0.35, rng: grp || Math.random,
        avoid: d => spots.some(a => d > a - 1400 && d < a + 2900) }); // never on top of a dare and its race
      if (this.wiz.state === 'off' || (grp && this.d > this.wiz.at - 600)) { this.wiz = null; return; } // a late joiner already past his spot
      if (qs.has('wizard')) for (const x of this.ch?.list || []) if (x.at > this.wiz.at - 1400 && x.at < this.wiz.at + 2900) x.state = 'skipped';
    }
    const c = document.createElement('div'); c.className = 'chcard glass wizcard'; c.id = 'hWiz'; c.hidden = true; this.el.querySelector('.hud').append(c);
    const hud = this.el.querySelector('.hud');
    for (const id of ['hHell', 'hWizFx']) { const f = document.createElement('div'); f.className = 'wizfx'; f.id = id; hud ? hud.before(f) : this.el.append(f); } // under the HUD: power and cards stay readable
  }
  _wizTick(dt) {
    const sp0 = this.player?.events?.surprises;
    // the wizard always waits at the finish line of a free ride and has the last word (Freddy)
    if (sp0?.wizard && this.state.settings.wizard !== false && !this.workout && !this.autopilot && this.lap >= this.laps && this.track.length - this.d < 400 && !this._goalWiz) this._goalWiz = sp0.wizard(this.track.length + 6);
    if (this._goalWiz && !this._goalSaid && this.track.length - this.d < 70) { this._goalSaid = true; this.story?._line('wizard', 'goal'); }
    const z = this.wiz; if (!z) return;
    if (z.exitH && this.d > z.exitH.d - 12) { sp0?.poof?.(z.exitH); z.exitH = null; } // he sends you on (up) and is gone in a puff
    if (z.state === 'hell' && !z.exitH && !z.exitDone && z.t >= WIZ.hell - 25) { z.exitDone = true; z.exitH = sp0?.wizard?.(this.d + Math.max(90, this.v * 25 + 15)); } // he waits where hell ends
    if (this.ch?.active && (z.state === 'wait' || z.state === 'ann')) return; // a race is on: the wizard waits his turn
    if (z.timed && z.state === 'wait' && !Number.isFinite(z.at) && this.elapsed >= z.armAt && this.track.length - this.d > 2500 && !this.eagle?.busy) { z.summon(this.d, summonGap(this.v)); this._wizMet = true; } // his minute has come and the lap has room for the trial
    const sp = this.player?.events?.surprises, P = this.player, fx = this.q('#hWizFx');
    const win = z.wk ? (this.wDone ? null : this._hardWin()) : null, g = z.wk ? wizardGate(z, win, { elapsed: this.elapsed, v: this.v, hold: WIZ.hold }) : null;
    if (g === 'summon' && !this.eagle?.busy) { z.summon(this.d, summonGap(this.v)); this._wizIv = win.i; } // workout: inside a hard interval with time for his trial (never while the eagle speaks)
    else if (g === 'dismiss') { sp?.poof?.(z.dismiss()); if (sp) sp.hold = false; } // the interval ends first: he waits for the next one
    const os = this.group ? this.group.others() : null;
    if (os && !this.eagle?.busy && friendCalls(z, os, this.lap)) z.summon(this.d, summonGap(this.v)); // group: a friend met him, he comes for you now too
    const flashFx = k => { if (!fx) return; fx.className = 'wizfx'; void fx.offsetWidth; fx.classList.add(k); };
    for (const e of z.tick(dt, this.d, this.power, win?.target || 0)) {
      if (e === 'ann') this.coach?.say('wizard', 0); // the card says it: no extra text in the middle
      else if (e === 'near') { z.h = sp?.wizard?.(z.at); if (sp) sp.hold = true; }
      else if (e === 'cast') { sp?.poof?.(z.h); flashFx('cast'); }
      else if (e === 'pass') { this.story?.trialPass(); flashFx('rise'); P?.fly?.(WIZ.fly); }
      else if (e === 'fail') {
        this.story?._line('wizard', 'fail'); this.story?.hellIn(); this.player?.events?.sfx?.('quake', 1, 0); P?.hell?.(true); if (sp) sp.hell = true; if (P) P.shakeImpulse = Math.max(P.shakeImpulse || 0, 1.6);
        this.q('#hHell')?.classList.add('hell'); flashFx('quake');
      } else if (e === 'end') {
        z.exitDone = false; if (z.was !== 'fly') { this.story?._line('wizard', 'hellExit'); this.story?.hellOut(); } else { z.exitH = sp?.wizard?.(this.d + 70); this.story?._line('wizard', 'land'); }
        P?.hell?.(false); P?.land?.(); if (sp) { sp.hell = false; sp.hold = false; }
        this.q('#hHell')?.classList.remove('hell'); flashFx('land');
      }
    }
    if (this.group) { const wz = wzOf(z, this.lap), k = JSON.stringify(wz); if (k !== this._wzK) { this._wzK = k; this.group.update({ wz }); } } // only when it changes
    const card = z.card(this.d), foot = os && card ? friendsLine(os, this.lap) : '';
    const el = this.q('#hWiz'); if (el) { el.classList.toggle('hellcard', z.state === 'hell'); this._card(el, card && foot ? { ...card, foot } : card, '_wizHtml'); }
  }
  // ---------- the Eagle of Destiny (owner 18.11.): once per interval workout, inside one hard interval, never with the wizard or a
  // dare (eaglegate.js); the scene in camera space with lip sync: world/eagle.js. ?eagle = 3 s into the workout, ?eagle=now ----------
  _initEagle() {
    const q = new URLSearchParams(location.search).get('eagle'), now = q === 'now';
    if (this.autopilot || this.state.settings.eagle === false || !this.player?.camera || this.player.instant || this.eg) return;
    // a free ride alone (owner 19.11.: the wizard in the first 30 minutes, "der Adler kann dann danach kommen, in den nächsten 30 Minuten"):
    // once, by the clock, between minute 30 and 55; ?eagleat=seconds for tests
    const qa = new URLSearchParams(location.search).get('eagleat');
    this.eg = now ? { state: 'wait', now: true, iv: -1 } : this.workout ? planEagleAny(this.workout, { force: q != null }) // a workout: at any moment of it (owner 19.11.), by the workout clock
      : this.group ? null : { state: 'wait', free: true, iv: -1, at: qa != null ? +qa : q != null ? 3 : 1800 + Math.random() * 1500 }; if (!this.eg) return;
    import('./world/eagle.js').then(m => { if (!this._closed && this.player?.camera) this.eagle = new m.Eagle(this.player); }).catch(e => console.warn('eagle', e));
  }
  _eagleTick(dt) {
    const e = this.eg; if (!e || !this.eagle || this.state.settings.eagle === false) return;
    const ev = this.player?.events; if (ev) ev.hush = e.state === 'play'; // nobody calls out while the eagle speaks
    if (e.state === 'play') { if (this.eagle.tick(dt) === 'end') { e.state = 'done'; if (ev) ev.hush = false; } return; }
    if (e.free) { if (e.state === 'wait' && (e.wk ? this.workout && !this.wDone && this._wClock() : this.elapsed) >= e.at && !othersBusy(this.wiz, this.ch)) { e.state = 'play'; this.eagle.start(); } return; }
    const stepI = this.wDone ? Infinity : this.wNow?.i ?? -1, win = this.workout && !this.wDone ? this._hardWin() : null;
    const g = eagleGate(e, { win, stepI, busy: othersBusy(this.wiz, this.ch), wizIv: this._wizIv ?? -1 });
    if (g === 'go') { e.state = 'play'; this.eagle.start(); } else if (g === 'move') this.eg = moveEagle(this.workout, e, { stepI, ftp: this.ftp });
  }
  /** while the eagle flies alongside on the right: minimap, big grade and the next-interval pill fade out (css .hud.eagle-on); back on pause, end, abort */
  _eagleHud() { const on = !!this.eagle?.perched && !this.paused && !this.finished; if (on !== !!this._egHud) { this._egHud = on; this.el?.querySelector('.hud')?.classList.toggle('eagle-on', on); } }
  _toggleEagle() {
    const s = this.state.settings; s.eagle = s.eagle === false;
    if (!s.eagle && this.eagle?.busy) { this.eagle.stop(); this.eg.state = 'done'; } else if (s.eagle && !this.eg) this._initEagle();
    import('./app.js').then(m => m.saveSettings());
  }
  /** music follows the ride: minor in a shower, motivation only in the hard parts of a workout, the wizard's flight and hell */
  _mood() {
    const m = this.music; if (!m?.setMood || this.group) return;
    const z = this.wiz?.state, rain = this.player?.weather?.rain || 0;
    const vt = !this.workout && this.player?.villageTheme?.(this.d), VM = { stadtfest: 'fest', hochzeit: 'hochzeit', kirchenfest: 'kirchenfest', beerdigung: 'beerdigung' };
    const mood = this.workout ? (this.wNow?.step?.pct >= 88 ? 'hard' : 'workout') : z === 'fly' ? 'fly' : z === 'hell' ? 'hell'
      : vt && VM[vt] ? VM[vt] // each themed village has its own music (falls back when there is none)
      : rain > 0.35 || (m.mood === 'rain' && rain > 0.1) ? 'rain' : 'world';
    if (mood !== this._moodLog) { this._moodLog = mood; console.info('[music]', mood, Math.round(this.d)); } // QA on a muted Mac: the mood changes show in the console
    m.setMood(mood);
  }
  /** in hell the trainer adds 2 % on top of the road (virtual shifting included) */
  _wizGrade(g) {
    const w = this.wiz; this.wiz = null; let r; try { r = this._trainerGrade(); } finally { this.wiz = w; } // the normal grade, then harder
    return r + 2 * Math.min(1, (w.t || 0) / 8) * Math.min(1, (WIZ.hell - (w.t || 0)) / 8);
  }
  _card(el, card, key) { // the big centred card (challenges, wizard)
    el.hidden = !card; if (!card) return;
    el.classList.toggle('lead', !!card.lead); el.classList.toggle('trail', card.lead === false);
    const html = `<div class="label">${esc(card.title)}</div><div class="chbig num">${esc(card.big)}</div><div class="chsub">${esc(card.sub)}</div>${card.bar != null ? `<div class="chbar"><i style="width:${Math.round(card.bar * 100)}%"></i>${card.hold ? `<b style="width:${Math.round(card.hold * 100)}%"></b>` : ''}</div>` : ''}${card.foot ? `<div class="chfoot">${esc(card.foot)}</div>` : ''}`;
    if (html !== this[key]) { this[key] = html; el.innerHTML = html; }
  }
  _chPanel(el, c) { // the challenge panel at the left edge (all challenge info, nowhere else)
    el.hidden = !c; if (!c) return;
    const D = m => m >= 1000 ? fmtNum(m / 1000, m >= 10000 ? 0 : 1) + '<small>km</small>' : Math.round(m) + '<small>m</small>';
    let h;
    if (c.kind === 'next') h = `<div class="label">Next challenge</div><div class="chleft num">${D(Math.max(0, c.left))}</div><div class="chsub">${esc(c.name)}</div>`;
    else if (c.kind === 'offer') h = `<div class="label">${esc(c.name)} challenges you</div><div class="chw num">${c.W}<small>W</small></div><div class="chsub">${D(c.D)}</div>
      <div class="chsub strong">Attack = accept</div><div class="chbar"><i style="width:${Math.round(c.t * 100)}%"></i><b style="width:${Math.round(c.hold * 100)}%"></b></div>`;
    else if (c.kind === 'count') h = `<div class="label">vs. ${esc(c.name)}</div><div class="chw num">${c.W}<small>W</small></div>`
      + (c.n ? `<div class="chcount num">${c.n}</div>` : `<div class="chleft num">${D(c.left)}</div><div class="label">to the start</div>`);
    else if (c.kind === 'race') { const p = this.power || 0, r = p / c.W, fill = Math.max(0, Math.min(1, r - 0.5)), ok = r >= 0.98;
      const bar = el.classList.contains('race') && el.querySelector('.chvbar'); // racing: move the bar in place so its height animates
      if (bar && this._chRaceKey === c.name + c.W) { bar.className = 'chvbar ' + (ok ? 'ok' : 'low'); bar.firstElementChild.style.height = (fill * 100).toFixed(0) + '%';
        bar.querySelector('span').textContent = Math.round(p); el.querySelector('.chleft').innerHTML = D(c.left); return; }
      this._chRaceKey = c.name + c.W;
      h = `<div class="label">vs. ${esc(c.name)}</div><div class="chw num">${c.W}<small>W</small></div>
        <div class="chvbar ${ok ? 'ok' : 'low'}"><i style="height:${(fill * 100).toFixed(0)}%"></i><b></b><span class="num">${Math.round(p)}</span></div>
        <div class="chleft num">${D(c.left)}</div><div class="label">to the finish</div>`; }
    else h = `<div class="label">vs. ${esc(c.name)}</div><div class="chres ${c.won ? 'won' : 'lost'}">${c.won ? 'Won' : 'Lost'}</div><div class="chsub">avg ${c.avg} W · ${c.gap} m ${c.won ? 'ahead' : 'behind'}</div>`;
    el.className = 'chcard glass side ' + c.kind;
    if (h !== this._chHtml) { this._chHtml = h; el.innerHTML = h; }
  }
  _chEnd(x, sp, ms) { // the challenger stays until out of sight, the flags until you have passed them
    if (sp) sp.hold = false;
    setTimeout(() => { if (x.h) x.h.done = true; }, ms);
    if (x.flags) (this._chFlags ||= []).push({ f: x.flags, at: x.finish });
  }

  /** "Beenden" in the workout panel: stop the workout and ride on freely, or end and save the ride */
  _wireWorkoutStop() {
    const q = this.q, ask = q('#hWAsk'); if (!ask) return;
    q('#hWAdj')?.querySelectorAll('[data-wa]').forEach(b => b.onclick = e => { e.currentTarget.blur(); this._wTune(+b.dataset.wa); });
    q('#hWStop').onclick = () => { ask.hidden = false; };
    q('#hWView').onclick = e => { e.currentTarget.blur(); this._cycleWbView(); };
    q('#hWNo').onclick = () => { ask.hidden = true; };
    q('#hWSave').onclick = () => this._end(true);
    q('#hWFree').onclick = () => {
      this._wName = this.workout.name + ' (ended early)'; this.workout = null; this.wNow = null;
      if (this.erg) this.state.trainer.setPower(null);
      q('#hWork')?.remove(); this.el.classList.remove('wk'); q('.metric.power')?.classList.remove('z-lo', 'z-ok', 'z-hi');
      this._flash('Workout ended · ride on freely');
    };
  }

  /** the workout bar, design C (owner 17.11.: "like in the other apps: at the bottom, really big, all the watts"): a ring with
   *  the time left in the step, step name, the target (tuned, "+10 W") big next to your power with the zone band, the next
   *  step, and the whole workout as a timeline below (past dimmed, hard steps orange). Keeps the old panel's ids. */
  _workoutBarHTML() {
    const C = 2 * Math.PI * 58;
    return `<div class="wbar glass v-${this._wbView()}" id="hWork"><div class="wcd glass" id="hWCue" hidden><div class="num k" id="hWCueN">3</div><div class="w" id="hWCueW"></div></div>
      <div class="wb-row">
        <div class="wring"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="58" class="tr"/><circle cx="66" cy="66" r="58" class="fg" id="hWArc" stroke-dasharray="${C} ${C}" transform="rotate(-90 66 66)"/></svg><b class="num" id="hWLeft">–</b><span>Left</span></div>
        <div class="wb-big">
          <div class="wb-name"><span class="wb-now">Now</span><span id="hWStep">–</span><span class="wb-of" id="hWOf"></span><b class="wadjv" id="hWAdjV">±0 W</b><b class="num wb-time" id="hWTime">–</b></div>
          <div class="wb-nums"><span class="num wb-t"><span id="hWT">–</span><small>W</small></span><span class="num wb-p" id="hWPow"><span id="hWP">0</span><small>W · <em id="hWState">–</em></small><button class="sens-rc" id="hWRc" data-rc="tr" hidden>Reconnect</button></span>
            <span class="wadj" id="hWAdj"><button class="wab" data-wa="-5" title="Target −5 W (S · L2 · D-pad ↓ / L: 1 W)" aria-label="Target −5 W">−</button><button class="wab" data-wa="5" title="Target +5 W (W · R2 · D-pad ↑ / R: 1 W)" aria-label="Target +5 W">+</button></span></div>
          <div class="wzone" id="hWZone"><i class="band"></i><i class="mk" id="hWMk"></i></div>
          <span class="wb-live" id="hWLive">${WB_LIVE.map(([k, l, u]) => `<span class="wl" data-wl="${k}"><i>${l}</i><b class="num"><span id="hWL-${k}">–</span>${u ? `<small>${u}</small>` : ''}</b></span>`).join('')}</span>
        </div>
        <div class="wb-next"><div class="lbl">Next</div><div class="n" id="hWNextN">–</div><div class="d" id="hWNext">–</div>
          <div class="wb-end"><span class="lbl" id="hWName">${esc(this.workout.name)}${this.erg ? ' · ERG' : ''}</span><button class="wstop" id="hWView" title="Interval display: big / compact / focus (L, or pause menu Options)">View</button><button class="wstop" id="hWStop" title="End workout early">End</button></div></div>
      </div>
      <div class="wask" id="hWAsk" hidden><div class="label">End workout?</div><button class="btn small" id="hWFree">Keep riding freely</button><button class="btn ghost small" id="hWSave">Save ride &amp; finish</button><button class="btn ghost small" id="hWNo">Back</button></div>
      <div class="wb-chart" id="hWChart"></div></div>`;
  }

  /** three looks of the interval display (owner 17.11.), kept in the settings: big (design C, the default), compact (one
   *  slim full-width bar, design A) and focus (a card in the middle with the zone gauge, design B) */
  _wbView() { const v = this.state.settings.wbView; return WB_VIEWS.includes(v) ? v : 'big'; }
  /** the Display mode (key I, pad B, js/hudprefs.js) also decides the interval window's live numbers: the same items as the normal
   *  HUD, heart rate and cadence always; "Landscape only" also drops the timeline. Compact and focus show heart rate and cadence (css). */
  _wbLive() {
    const bar = this.q?.('#hWork'); if (!bar) return;
    const p = hudPrefs(this.state.settings); bar.dataset.preset = p.preset;
    for (const [k, , , , item] of WB_LIVE) { const c = bar.querySelector(`[data-wl="${k}"]`); if (c) c.hidden = !WB_ALWAYS.includes(k) && !p.show[item]; }
    bar.dataset.clean = Object.values(p.show).some(Boolean) ? '' : '1'; // (a data attribute: _workoutHUD rewrites the class list)
  }
  /** the live numbers: copied from the normal HUD that _updateHUD just filled (one place computes them), "–" stays "–" */
  _wbLiveFill(sn) {
    const q = this.q;
    for (const [k, , , sel] of WB_LIVE) {
      const el = q('#hWL-' + k); if (!el || el.parentElement.parentElement.hidden) continue;
      const v = sel ? q(sel)?.textContent ?? '–' : sn.pw === 'ok' || this._avgP ? String(this._avgP || 0) : '–';
      if (el.textContent !== v) el.textContent = v;
      el.parentElement.parentElement.classList.toggle('off', (k === 'hr' && sn.hr !== 'ok') || (k === 'cad' && sn.cad !== 'ok'));
    }
  }
  _cycleWbView() {
    const v = WB_VIEWS[(WB_VIEWS.indexOf(this._wbView()) + 1) % WB_VIEWS.length]; this.state.settings.wbView = v;
    const bar = this.q('#hWork'); if (bar) { WB_VIEWS.forEach(x => bar.classList.toggle('v-' + x, x === v)); this._wT = 0; this._wbh = 0; this._workoutHUD(this.power); }
    this._flash(`Interval display: ${WB_NAMES[v]}`); import('./app.js').then(m => m.saveSettings());
  }

  _workoutHUD(pShow) {
    const w = this.wNow, q = this.q, bar = q('#hWork'); if (!this.workout || !w || !bar) return;
    if (!bar.dataset.preset) this._wbLive(); // a new bar (ride start, a workout picked mid-ride)
    this._wbLiveFill(this._sensors());
    const ca = !w.done && w.step && !w.step.free ? (w.hard ? this.wAdj : this.wAdjE) : 0; // the offset on what runs now (intervals or easy parts)
    q('#hWAdjV').textContent = fmtAdj(ca); q('#hWAdj').classList.toggle('adj', !!ca); bar.classList.toggle('adj', !!ca);
    const pw = q('.metric.power'), wp = q('#hWPow'); pw?.classList.remove('z-lo', 'z-ok', 'z-hi'); wp.classList.remove('z-lo', 'z-hi');
    const cue = q('#hWCue'), arc = q('#hWArc'), C = 2 * Math.PI * 58;
    if (w.done) { q('#hWStep').textContent = 'Done – ride on freely'; q('#hWOf').textContent = ''; q('#hWT').textContent = '✓'; q('#hWLeft').textContent = '0:00'; q('#hWNextN').textContent = 'Workout done'; q('#hWNext').textContent = ''; q('#hWState').textContent = 'done'; cue.hidden = true; arc.setAttribute('stroke-dasharray', `0 ${C}`); bar.className = `wbar glass done v-${this._wbView()}`; }
    else {
      const free = !!w.step.free, hard = w.hard, rest = !hard && !free && !w.ramp && /rest|easy|recover/i.test(w.step.label || '');
      const sp = this._sensors().pw; // no power source: "–", no verdict
      const zRaw = free || w.ramp || sp !== 'ok' ? '' : pShow < w.lo ? 'lo' : pShow > w.hi ? 'hi' : 'ok';
      // ERG: the trainer holds the watts, so being off is never the rider's mistake. No red verdict; only after 12 s off a calm note
      const now = performance.now(); if (!this._ergOn || !zRaw || zRaw === 'ok') this._ergOffAt = 0; else if (!this._ergOffAt) this._ergOffAt = now;
      const ergOff = this._ergOn && this._ergOffAt && now - this._ergOffAt > 12000;
      const z = this._ergOn && zRaw ? 'ok' : zRaw;
      q('#hWStep').textContent = w.step.label || 'Block';
      q('#hWOf').textContent = hard ? `${/^opener/i.test(w.series) ? 'opener' : 'interval'} ${w.hardNo} of ${w.hardCount}` : w.ramp === 'in' ? 'ramp up' : w.ramp === 'out' ? 'ramp down' : w.ramp === 'step' ? `ramp to ${w.rampTo} W` : '';
      q('#hWT').textContent = w.target;
      q('#hWP').textContent = sp === 'ok' ? pShow : '–'; q('#hWRc').hidden = sp !== 'lost';
      q('#hWLeft').textContent = q('#hWTime').textContent = fmtTime(Math.ceil(w.left));
      arc.setAttribute('stroke-dasharray', `${(C * Math.max(0, Math.min(1, w.left / w.step.dur))).toFixed(1)} ${C.toFixed(1)}`);
      q('#hWState').textContent = sp !== 'ok' ? (sp === 'lost' ? 'connection lost' : 'no connection') : free ? 'free' : w.ramp === 'in' ? 'ramp up' : w.ramp === 'out' ? 'ramp down' : w.ramp === 'step' ? 'ramp' : rest || !z ? 'easy' : ergOff ? `trainer ${Math.abs(pShow - w.target)} W off` : z === 'ok' ? (this._ergOn && zRaw !== 'ok' ? 'trainer settling' : 'in zone') : z === 'lo' ? `${w.target - pShow} W too low` : `${pShow - w.target} W too high`;
      wp.classList.toggle('off', sp !== 'ok');
      if (hard && z && z !== 'ok') { wp.classList.add('z-' + z); pw?.classList.add('z-' + z); } else if (hard) pw?.classList.add('z-ok');
      // the zone band: ±5 % around the target in the middle of a track from 80 to 120 %; the marker is your power
      const mk = q('#hWMk'), k = Math.max(0, Math.min(1, (pShow - w.target * 0.8) / (w.target * 0.4)));
      mk.style.left = `calc(${(k * 100).toFixed(1)}% - 3px)`; q('#hWZone').className = 'wzone' + (hard && z && z !== 'ok' ? ' z-' + z : '');
      q('#hWNextN').textContent = w.next ? w.nextName : 'Last block';
      q('#hWNext').textContent = `${w.next ? `${w.nextRampTo != null ? `${w.nextTarget} → ${w.nextRampTo}` : w.nextTarget} W · ${fmtTime(w.nextDur)} · ` : ''}${fmtTime(Math.ceil(w.totalLeft))} left`;
      bar.className = `wbar glass v-${this._wbView()}${hard ? ' hard' : rest ? ' rest' : ''}${w.ramp ? ' ramp' : ''}${ca ? ' adj' : ''}`;
      // countdown into the next hard interval: big number above the bar (the ramp is already running), at the change a flash
      const soon = w.countdown && isHard(w.next); cue.hidden = !soon;
      if (soon) { q('#hWCueN').textContent = w.countdown; q('#hWCueW').textContent = `${w.nextName} · ${w.nextTarget} W`; }
    }
    if (w.i !== this._barI) { if (this._barI !== undefined && !w.done) this._flash(`${w.step.label || 'Block'} · ${w.target} W`); this._barI = w.i; }
    if (!this._wT || this.elapsed - this._wT > 1) { this._wT = this.elapsed; q('#hWChart').innerHTML = timelineSVG(w, this._wClock(), this.workout); }
    const h = bar.offsetHeight; if (h !== this._wbh) { this._wbh = h; this.el.style.setProperty('--wbh', h + 'px'); } // the other HUD parts sit above it
  }

  /** share photos of you on the bike: after 800 m, then every 4 km; the highest spot (best view) is used later */
  _photoTick() {
    if (!this.player?.snapshot || this.paused || this.finished) return;
    const rd = this._ridden(); this._nextShot ??= 800;
    if (!this._shotArm && rd >= this._nextShot) { this._nextShot += 4000; this._shotArm = performance.now(); }
    if (this._shotArm && !this._shooting && performance.now() - this._shotArm > 1200) this._takePhoto();
  }
  /** arms your rider, waits for it to be drawn, takes the picture; resolves when stored */
  async _takePhoto() {
    this._shooting = true; this._shotArm ||= performance.now(); if (this.finished) this._others(null);
    while (performance.now() - this._shotArm < 1200) await new Promise(r => setTimeout(r, 100));
    try {
      const d = this.d, cv = await Promise.race([this.player.snapshot(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 3000))]);
      const url = cv.toDataURL('image/jpeg', 0.88);
      (this.photos ||= []).push({ d, y: this.player.field?.pose(d).y || 0, url });
      if (this.photos.length > 6) this.photos.splice(this.photos.reduce((m, p, i, a) => p.y < a[m].y ? i : m, 0), 1);
      return url;
    } catch {} finally { this._shotArm = 0; this._shooting = false; this.player._shot = null; }
  }
  /** the ride's best photo stays on this device, so the share image can be made later from Fahrten & Rekorde (Freddy 12.11.) */
  _keepPhoto(rec) { this.bestPhoto().then(u => u && db.kvSet('photo:' + rec.id, u)).catch(() => {}); }
  /** best photo for the share image (highest spot); takes one now when the ride had none */
  async bestPhoto() {
    if (!this.photos?.length && this.player?.snapshot) await this._takePhoto();
    return this.photos?.length ? this.photos.reduce((a, b) => b.y >= a.y ? b : a).url : null;
  }

  /** group ride and ghost: riders in the 3D world, gaps in the group chip */
  _others(ghostD) {
    const list = [];
    const look = this.state.settings.look || null;
    if ((this.state.settings.view3d || 0) === 1 || this._shotArm) list.push({ id: 'me', self: true, d: this.d, v: this.paused ? 0 : this.v, look });
    if (this._cgD != null) list.push({ id: 'cghost', ghost: true, look: this.state.settings.look || null, name: 'Your best', d: this._cgD, v: this.v, color: 0x9aa3ad });
    if (this.ghost && ghostD != null) list.push({ id: 'ghost', ghost: true, look: this.ghost.look || look, name: this.ghostName || (this.state.settings.ghost === 'last' ? 'Last ride' : 'Best time'), d: ghostD + (this.ghost.startD || 0), v: this.v, color: 0x9aa3ad });
    if (this.group) {
      this.group.update({ look, d: this.d, v: this.v, w: this.power, hr: this.hr, riding: !this.paused, done: this.finished, el: Math.round(this.elapsed) });
      const os = this.group.others();
      const vc = this.group.voice?.on ? this.group.voice : null;
      for (const r of os) list.push({ id: r.id, name: r.name, d: r.d, v: r.riding ? r.v : 0, look: r.look, speaking: !!vc?.isSpeaking(r.pid) });
      { let k = 0, who = null; // the slipstream (Freddy 12.11.: not glued, stronger or weaker): up to 30 % less drag 1-3 m behind, fading smoothly to 0 at 15 m.
        // It stays while you are alongside (until 1.5 m ahead), so with the same watts you roll past and then give HIM the slipstream (like a real paceline) instead of getting stuck at his wheel.
        for (const r of os) { const gap = r.d - this.d; if (!r.riding || r.done || gap < -1.5 || gap > 15) continue;
          const near = gap < 1 ? Math.max(0, (gap + 1.5) / 2.5) : gap <= 3 ? 1 : 1 - (gap - 3) / 12;
          const kk = 0.3 * near * near * Math.min(1, Math.max(0, (this.v - 2) / 4)); if (kk > k) { k = kk; who = r.name; } }
        this._draftTo = k;
        // stay together (Freddy: "zu zweit sich immer sehen", setting on by default): whoever drops back gets an
        // invisible tailwind that grows with the gap, so friends of different strength stay within sight
        const lead = os.filter(r => r.riding && !r.done).reduce((m, r) => Math.max(m, r.d - this.d), 0);
        this._togetherTo = this.state.settings.together === false ? 0 : Math.min(0.6, Math.max(0, (lead - 30) / 300));
        if (k > 0.15 && !this._drafting && (this.elapsed - (this._draftMsgT ?? -99)) > 90) { this._draftMsgT = this.elapsed; this._flash?.(`Drafting ${who || 'your buddy'} · the closer, the easier`); }
        // the others' challenge results (group): a short note when a friend beat or lost to a challenger
        for (const r of os) (r.cr || []).forEach((c, i) => { const key = r.id + ':' + i + ':' + c[0]; if ((this._crSeen ||= new Set()).has(key)) return; this._crSeen.add(key);
          if (this.elapsed > 5) this._flash?.(`⚔ ${r.name} vs ${c[0]}: ${c[1] ? 'won' : 'lost'}${c[2] ? ` · avg ${c[2]} W` : ''}`); });
        this._drafting = k > 0.03; const hg = this.q?.('#hGroup'); hg?.classList.toggle('drafting', this._drafting); if (hg) hg.style.setProperty('--draft', Math.round(this._draftK / 0.3 * 100) + '%'); }
      const gl = this.q?.('#hGroup .glist');
      if (gl) gl.innerHTML = os.length ? os.sort((a, b) => b.d - a.d).slice(0, 5).map(r => {
        const gap = r.d - this.d, txt = r.done ? 'finished' : (gap >= 0 ? '+' : '−') + (Math.abs(gap) >= 1000 ? fmtKm(Math.abs(gap)) + ' km' : Math.round(Math.abs(gap)) + ' m');
        return `<div class="grow ${gap >= 0 ? 'behind' : 'ahead'}${vc?.isSpeaking(r.pid) ? ' speaking' : ''}" data-rid="${esc(r.id)}" title="Click: jump to ${esc(r.name)} (does not count as distance)"><span>${vc?.isSpeaking(r.pid) ? `<i class="spk">${SPK_SVG}</i>` : ''}${esc(r.name)}</span><b class="num">${txt}</b><i class="num">${r.w} W · <span class="ghr">${r.hr > 0 ? r.hr : '–'}</span> bpm</i></div>`; // heart rate next to the watts, – without a strap
      }).join('') : '<div class="grow"><span>Nobody here yet</span></div>';
    }
    if (list.length || this._hadRiders) { this.player?.setRiders?.(list); this._hadRiders = list.length > 0; }
    this._mapRiders = list.filter(r => !r.self);
    // the Unreal view draws the same friends and ghost (lanes: same order as js/world/riders.js SLOTS (lane + row 2.5 m back), by first appearance)
    this._ueRiders = list.filter(r => !r.self).map(r => ({ id: r.id, name: r.name || '', d: Math.round(r.d * 10) / 10, v: Math.round((r.v || 0) * 10) / 10, ghost: !!r.ghost }));
  }

  /** voice chat chip: off -> click turns it on (the browser asks once for the mic); on -> click mutes
   *  (open mic) or hold to talk (push-to-talk), same as key T. Off again: pause menu or group window. */
  _wireVoice() {
    const vb = this.q('#hVoice');
    const v = () => (this.group.voice?.on ? this.group.voice : null);
    /** voice on, then mute / unmute: the pause menu's Options (the chip left the top bar, owner 18.11.) */
    this._voiceTap = async () => {
      const x = v();
      if (!x) { const n = await import('./share.js').then(m => m.voiceToggle(this.group)); if (n) this._flash(n.hasMic ? (n.ptt ? 'Voice chat on · hold T to talk' : 'Voice chat on · T = mute') : 'Voice chat on · listening only'); }
      else if (!x.ptt && x.hasMic) { x.toggleMute(); this._flash(x.muted ? 'Mic muted' : 'Mic on'); }
    };
    if (!vb) return;
    vb.addEventListener('click', this._voiceTap);
    const hold = on => e => { const x = v(); if (x?.ptt) { e.preventDefault(); x.talk(on); } };
    vb.addEventListener('pointerdown', hold(true)); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) vb.addEventListener(ev, hold(false));
    this._voiceUI = () => {
      const x = v();
      vb.classList.toggle('on', !!x); vb.classList.toggle('muted', !!x && !x.live && !x.ptt); vb.classList.toggle('speaking', !!x?.speaking);
      vb.querySelector('.label').textContent = !x ? 'Voice' : !x.hasMic ? 'Listening' : x.ptt ? (x.talking ? 'Talking' : 'Hold T') : x.muted ? 'Muted (T)' : 'Mic on';
      vb.title = x ? voiceStatus(x) : 'Voice chat on: you hear each other';
    };
    window.addEventListener('rf-voicechange', this._voiceUI); this._voiceUI();
  }

  /** ghost challenge on the climbs: your own best effort on this climb rides with you (never in group rides or with a full-ride ghost) */
  _cgTick() {
    if (this.group || this.ghost || this.workout || this.state.settings.climbGhost === false) return;
    const c = this.climbs.find(c => this.d >= c.from && this.d < c.to);
    if (this._cg && (c !== this._cg.c || this.d >= this._cg.c.to)) { // over the top (or off the climb): the verdict
      const x = this._cg; this._cg = null; this._cgD = null;
      if (this.d >= x.c.to - 5) { const dur = this.elapsed - x.t, diff = dur - x.best.dur;
        console.info("[ghost] verdict", x.c.name, dur.toFixed(1), diff.toFixed(1));
        this._flash(diff < 0 ? `👻 New best on ${x.c.name}! ${fmtTime(dur)} (−${fmtTime(-diff)})` : `👻 ${x.c.name}: ${fmtTime(dur)} · ${fmtTime(diff)} behind your best`); }
    }
    if (!c || this._cg || this._cgDone?.has(c) || this.d > c.from + 40) { if (this._cg) { const x = this._cg; this._cgD = x.best.off + distAtTime(x.best.samples, x.best.t0 + (this.elapsed - x.t)); } return; }
    (this._cgDone ||= new Set()).add(c);
    this._cgRides ||= (this.state.rides || []).filter(r => r.routeId === this.route.id && r.samples?.length);
    const best = bestClimb(this._cgRides, c); if (!best) return;
    this._cg = { c, best, t: this.elapsed - Math.max(0, (this.d - c.from) / Math.max(1, this.v)) }; this._cgD = c.from;
    console.info("[ghost] start", c.name, best.dur.toFixed(1));
    this._flash(`👻 Your best on ${c.name}: ${fmtTime(best.dur)} · beat yourself!`);
  }
  _postureK() { // aero tuck: less drag; standing: more. Shown once per change.
    if (!this.pose) return 1;
    const p = this.pose.tick(), m = this._poseMod;
    if (p !== this._posture) { this._posture = p; this._postureSince = this.elapsed; }
    else if (p !== this._postureShown && this.elapsed - this._postureSince > 1.2) { this._postureShown = p; // held for a moment: no flicker
      if (p === 'aero') this._flash?.('Aero position · 16 % less drag'); else if (p === 'standing') this._flash?.('Out of the saddle'); }
    this._pk = (this._pk ?? 1) + ((m?.POSTURE_K[this._postureShown || 'unknown'] ?? 1) - (this._pk ?? 1)) * 0.05;
    return this._pk;
  }
  _key(e) {
    if (document.querySelector('.rideset')) return; // the settings sheet over the ride takes the keys
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && this.ow?.open && !this.paused) { e.preventDefault(); this.ow.choose(e.key === 'ArrowLeft' ? -1 : 1); return; } // open world: pick the road at the junction
    if (e.key.startsWith('Arrow') && this._trainerLive()) return this._arrowWithTrainer(e);
    if (!this.running && !e.key.startsWith('Arrow')) return; // still loading / counting down: only the power keys
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') this.keyPower = true; /* watts from the keyboard: fine for trying things out, never a saved ride (Freddy 12.11.) */
    if (e.key === 'ArrowUp') { this.manualPower = Math.min(1500, this.manualPower + (e.shiftKey ? 50 : 10)); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { this.manualPower = Math.max(0, this.manualPower - (e.shiftKey ? 50 : 10)); e.preventDefault(); }
    else if ((e.key === 'w' || e.key === 'W' || e.key === 's' || e.key === 'S') && this.berg && !(this.workout && !this.wDone)) this._holdTune((e.key.toLowerCase() === 'w' ? 1 : -1) * (e.shiftKey ? 1 : 5)); /* hold watts: W / S like in a workout */
    else if (e.key === 'w' || e.key === 'W') this._wTune(e.shiftKey ? 1 : 5); /* workout target up / down: 5 W, with Shift 1 W */
    else if (e.key === 's' || e.key === 'S') this._wTune(e.shiftKey ? -1 : -5);
    else if (e.key === 'g' || e.key === 'G') this.toggleShift();
    else if (e.key === 'q' || e.key === ',' || e.key === '-' || e.key === 'PageDown') { e.preventDefault?.(); this.shift(-1); } /* PageUp/PageDown: Bluetooth presenters and many media remotes */
    else if (e.key === 'e' || e.key === '.' || e.key === '+' || e.key === 'PageUp') { e.preventDefault?.(); this.shift(1); }
    else if (e.key === ' ') { e.preventDefault(); this.paused ? this._resume() : this._pause(); }
    else if (e.key === 'Escape') { if (!this.paused && !this.finished) this._pause(); }
    else if (e.key === 'f') document.documentElement.requestFullscreen?.();
    else if (e.key === 'v' || e.key === 'c') this._cycleView();
    else if (e.key === '[' || e.key === ']') this._lens(e.key === ']' ? 1 : -1);
    else if (e.key === 'k' || e.key === 'K') this._chKey = true; // accept a challenge
    else if (e.key === 'h') this._toggleBar();
    else if (e.key === 'm') this._toggleMusic();
    else if (e.key === 'i') this._cycleHud();
    else if ((e.key === 'o' || e.key === 'O') && !this.finished) this._setup(); // workout, mode and shifting (js/ridesetup.js)
    else if ((e.key === 'l' || e.key === 'L') && this.workout) this._cycleWbView();
    else if (e.key === 'n') { this.music?.skip(); setTimeout(() => this._flash('♫ ' + (this.music?.title() || '')), 300); }
  }
  _trainerLive() { const t = this.state.trainer; return !!(t.connected && t.lastData && performance.now() - t.lastData < 3000); }
  /** Freddy 17.11.: his 8BitDo in keyboard mode sent the D-pad as arrow keys, ↑ / ↓ switched to keyboard test watts and wrecked
   *  the ERG workout. With a trainer delivering power the arrows never set watts: in a workout ↑ / ↓ move the target 1 W (Shift
   *  5 W, owner 17.11.), otherwise nothing; when they keep coming, a one-time hint to switch the pad. */
  _arrowWithTrainer(e) {
    e.preventDefault?.();
    const k = e.key, f = e.shiftKey ? 5 : 1;
    if (this.workout && !this.wDone && (k === 'ArrowUp' || k === 'ArrowDown')) this._wTune(k === 'ArrowUp' ? f : -f);
    const now = performance.now(); this._arrowT = (this._arrowT || []).filter(x => now - x < 10000); this._arrowT.push(now);
    if (this._arrowT.length >= 3 && !this._arrowHint) { this._arrowHint = true; this._flash('Controller is in keyboard mode: switch it to D for all buttons'); }
  }
  _toggleBar() { // handlebar and forearms in the rider's view on/off
    if (!this.player.setCockpit) return;
    const s = this.state.settings; s.cockpit = s.cockpit === false; this.player.setCockpit(s.cockpit);
    this._flash(s.cockpit ? 'Handlebars shown' : 'Clear view, no handlebars'); import('./app.js').then(m => m.saveSettings());
  }

  _cycleView() {
    if (!this.player.setView) return;
    const s = this.state.settings; s.view3d = ((s.view3d || 0) + 1) % 3; this.player.setView(s.view3d);
    this._flash(['Rider view', 'Chase', 'Look back'][s.view3d]); import('./app.js').then(m => m.saveSettings());
  }
  _lens(dir, wrap = false) { // [ wider, ] narrower (5° steps); the HUD button steps wider and wraps back to normal
    if (!this.player.setFov) return;
    const s = this.state.settings, cur = fovOf(s), STEPS = [45, 62, FOV_DEFAULT, 95, 110, 120, FOV_MAX];
    const f = wrap ? (STEPS.find(x => x > cur + 1) ?? STEPS[0]) : cur - dir * 5; // button: 45 → 62 → 80 → 95 → 110 → 120 → 130 → 45
    s.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, f)); s.lensMm = 0; this.player.setFov(s.fov);
    this._flash(`Field of view ${s.fov}°`); import('./app.js').then(m => m.saveSettings());
  }
  _setHud(h) {
    this.state.settings.hud = h; applyHud(this.el, hudPrefs(this.state.settings)); this._wbLive();
    import('./app.js').then(m => m.saveSettings());
    const box = this.el.querySelector('.hudpanel'); if (box) box.querySelector('.hudbody').innerHTML = hudControlsHTML(hudPrefs(this.state.settings));
  }
  _cycleHud() {
    const cur = hudPrefs(this.state.settings).preset, i = HUD_ORDER.indexOf(cur), next = HUD_ORDER[(i + 1) % HUD_ORDER.length];
    this._setHud({ ...(this.state.settings.hud || {}), preset: next }); this._flash('Display: ' + HUD_PRESETS[next].name + ' (key I)');
  }
  _hudPanel() {
    let box = this.el.querySelector('.hudpanel'); if (box) { box.remove(); return; }
    box = document.createElement('div'); box.className = 'hudpanel glass';
    box.innerHTML = `<div class="label">What do you want to see?</div><div class="hudbody">${hudControlsHTML(hudPrefs(this.state.settings))}</div><button class="btn ghost small hudclose">Done</button>`;
    this.el.append(box);
    box.querySelector('.hudclose').onclick = () => box.remove();
    wireHudControls(box, () => this.state.settings, h => this._setHud(h));
  }
  _toggleMusic() {
    const s = this.state.settings, m = this.music; if (!m) return;
    if (!m.available) return this._flash('No music found (assets/audio)');
    s.musicVol = m.on ? 0 : (s.musicVolOn || 0.45); if (m.on) s.musicVolOn = m.vol;
    m.setVolume(s.musicVol); this._flash(m.on ? '♫ ' + m.title() : 'Music off'); import('./app.js').then(x => x.saveSettings());
  }
  _flash(text, ms = 1600) {
    let f = this.q('#hFlash'); if (!f) { f = document.createElement('div'); f.id = 'hFlash'; f.className = 'flash glass'; this.el.append(f); }
    f.textContent = text; f.classList.add('on'); clearTimeout(this._flashT); this._flashT = setTimeout(() => f.classList.remove('on'), ms);
  }

  _pause() {
    if (this.finished) return;
    this.paused = true; this.player.pause(); this.music?.pause();
    this.q('#pauseOverlay')?.remove();
    const o = document.createElement('div'); o.className = 'paused'; o.id = 'pauseOverlay';
    o.innerHTML = `<div class="box"><div class="label">${fmtKm(this.d)} km · ${fmtTime(this.elapsed)}</div><h2 class="display">Pause</h2>
      <div class="row-actions padmenu"><button class="btn" id="pResume">Resume</button><button class="btn ghost" id="pOpts">Options</button><button class="btn ghost" id="pSetup">Workout &amp; mode</button><button class="btn ghost" id="pSet">Settings</button>${this.state.trainer.connected ? '' : '<button class="btn ghost" id="pConn">Connect trainer</button>'}<button class="btn ghost" id="pSave">Finish &amp; save</button><button class="btn ghost" id="pDiscard">Discard</button>${this.group?.voice?.on ? '<button class="btn ghost" id="pVoice">Voice chat off</button>' : ''}${this.group ? this.group.others().filter(r => r.riding || r.d > 0).slice(0, 4).map((r, i) => `<button class="btn ghost" data-jump="${i}">⇢ Jump to ${esc(r.name)}</button>`).join('') : this.autopilot ? '' : '<button class="btn ghost" id="pGroup">Open group</button>'}${this.presence?.on ? '<button class="btn ghost" id="pInvite">Invite friends</button>' : ''}</div>
      <div class="hint pad-hint" style="margin-top:12px;opacity:.7">🎮 D-pad to choose · A ok · B back</div></div>`;
    this.el.append(o);
    o.querySelector('#pResume').onclick = () => this._resume();
    o.querySelector('#pOpts').onclick = () => this._options();
    o.querySelector('#pSetup').onclick = () => this._setup();
    o.querySelector('#pSet').onclick = () => this._settings();
    o.querySelector('#pConn')?.addEventListener('click', () => this._connTrainer());
    o.querySelector('#pSave').onclick = () => this._end(true);
    o.querySelector('#pDiscard').onclick = () => this._end(false);
    o.querySelector('#pVoice')?.addEventListener('click', e => { this.group.voice?.stop(); this.group.voice = null; e.target.remove(); this._flash('Voice chat off'); });
    const os = this.group ? this.group.others().filter(r => r.riding || r.d > 0).slice(0, 4) : [];
    o.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => { const r = os[+b.dataset.jump]; if (r) { this._resume(); this._jump(r); } });
    o.querySelector('#pGroup')?.addEventListener('click', () => this._openGroup());
    o.querySelector('#pInvite')?.addEventListener('click', () => this._inviteMenu());
    this._padFocus(0);
  }
  /** Freddy 20.11.: everything the main menu can do also in the ride: the whole Settings page over the paused ride */
  _settings() {
    import('./app.js').then(m => m.openRideSettings(() => this._settingsBack())).catch(e => this._flash('Settings did not open: ' + (e?.message || e)));
  }
  /** back from the settings sheet: the ride takes what changed (camera, field of view, bars, display, trainer, pause menu) */
  _settingsBack() {
    if (this._closed) return;
    const s = this.state.settings, P = this.player;
    P?.setFov?.(fovOf(s)); P?.setView?.(s.view3d || 0); P?.setCockpit?.(s.cockpit !== false);
    applyHud(this.el, hudPrefs(s));
    if (s.ftp && s.ftp !== this.ftp) { this.ftp = s.ftp; if (this.workout) { this._wT = 0; this._workout(0); } } // a new FTP: the workout's watts follow at once
    this._trainerUp();
    const pad = activePad(); this.padPrev = pad ? padButtons(pad) : null; // the B that closed the sheet must not also resume the ride
    if (this.paused && !this.finished) this._pause();
  }
  /** a trainer connected in the ride (pause menu, settings, workout & mode): its physics, and ERG gets its target at once */
  _trainerUp() {
    const t = this.state.trainer; if (!t.connected) return;
    t.setSim?.({ riderKg: this.state.settings.riderKg, bikeKg: this.state.settings.bikeKg, crr: 0.004, cw: 0.51 })?.catch?.(() => {});
    if (this.workout && this.erg) this._workout(0); else if (this.berg) t.setPower?.(this._bergTarget());
  }
  async _connTrainer() {
    const b = this.q('#pConn'); if (b) { b.disabled = true; b.textContent = 'Connecting …'; }
    try { const m = await import('./app.js'); await m.connectTrainer(); } catch (e) { this._flash('Connection failed: ' + (e?.message || e), 4000); }
    if (this.state.trainer.connected) { this._trainerUp(); this._flash('✓ ' + (this.state.trainer.device?.name || 'Trainer') + ' connected'); }
    if (this.paused && !this.finished) this._pause();
  }
  /** laps also in the ride (like on the route page): 1 → 2 → 3 → 4 → 5 → 10 → 1, never below the lap you are on */
  _cycleLaps() {
    const L = [1, 2, 3, 4, 5, 10], ok = L.filter(n => n >= this.lap), i = ok.indexOf(this.laps);
    this.laps = ok[(i + 1) % ok.length] ?? ok[0]; this.state.settings.laps = this.laps; import('./app.js').then(m => m.saveSettings());
    const q = this.q('#hDistSub'); if (q) q.textContent = this._distSub();
    this._flash(this.laps === 1 ? 'One lap' : `${this.laps} laps · ${fmtKm(this.track.length * this.laps)} km`);
  }
  /** in-ride options (game-style, all reachable with the controller): each button shows its current state and toggles it */
  _options() {
    const o = this.q('#pauseOverlay'); if (!o) return;
    const s = this.state.settings, mode = this.berg ? 'ERG' : this.auto ? 'auto' : this.virtual ? 'virtual' : 'on the bike';
    const items = [
      ['oShift', `Shifting: ${mode}`, () => this.toggleShift()],
      ['oView', `View: ${['Rider view', 'Chase', 'Look back'][s.view3d || 0]}`, () => this._cycleView()],
      ['oHud', 'Switch display', () => this._cycleHud()],
      ...(this.workout ? [['oWView', `Interval display: ${WB_NAMES[this._wbView()]}`, () => this._cycleWbView()]] : []),
      ['oBar', `Bars: ${s.cockpit === false ? 'off' : 'on'}`, () => this._toggleBar()],
      ...(!this.group && !this.ow && !this.autopilot ? [['oLaps', `Laps: ${this.laps}${this.laps > 1 ? ` (now lap ${this.lap})` : ''}`, () => this._cycleLaps()]] : []),
      ['oMusic', `Music: ${this.music?.on ? 'on' : 'off'}`, () => this._toggleMusic()],
      ['oEagle', `Eagle of Destiny: ${s.eagle === false ? 'off' : 'on'}`, () => this._toggleEagle()],
      ...(this.group && this._voiceTap ? [['oVoice', `Voice chat: ${!this.group.voice?.on ? 'off' : this.group.voice.muted ? 'muted' : 'on'}`, () => this._voiceTap()]] : []),
      ['oNext', 'Next song', () => this.music?.skip()],
      ['oWide', 'Wider view', () => this._lens(-1)], ['oNarrow', 'Narrower view', () => this._lens(1)],
      ['oRemote', remoteLabel(), () => remoteCode()], // phone remote: the code to enter on the phone (js/remotepad.js)
      ...(this.workout && !this.wDone && this.wNow?.step && !this.wNow.step.free ? [['oAdjUp', `Target +5 W (${this.wNow.hard ? 'intervals' : 'easy parts'} now ${fmtAdj(this.wNow.hard ? this.wAdj : this.wAdjE)})`, () => this._wTune(5)], ['oAdjDn', 'Target −5 W', () => this._wTune(-5)]] : []),
    ];
    o.querySelector('.box').innerHTML = `<div class="label">Pause</div><h2 class="display">Options</h2>
      <div class="row-actions padmenu" style="flex-wrap:wrap">${items.map(([id, t]) => `<button class="btn ghost" id="${id}">${t}</button>`).join('')}<button class="btn" id="oBack">Back</button></div>
      <div class="hint pad-hint" style="margin-top:12px;opacity:.7">🎮 D-pad to choose · A change · B back${this.workout && !this.wDone ? '<br>While riding the workout: 🎮 L / R or D-pad up / down: target ±5 W · L2 / R2: ±1 W · keys W / S ±5 W (Shift 1 W), arrows ±1 W with a trainer · − / + on the bar<br>Hard intervals and easy parts keep their own offset' : ''}</div>`;
    items.forEach(([id, , fn], i) => o.querySelector('#' + id).onclick = () => { fn(); setTimeout(() => { this._options(); this._padFocus(i); }, 60); });
    o.querySelector('#oBack').onclick = () => this._pause();
    this._padFocus(0);
  }
  /** D-pad in the pause menus goes where it points (the finder of the app menus, js/padnav.js); nothing in that direction:
   *  ← ↑ step back, → ↓ step on, so every button stays reachable in a single row or column */
  _padMove(dir) {
    const bs = [...(this.q('#pauseOverlay')?.querySelectorAll('.padmenu button') || [])]; if (!bs.length) return;
    const rc = bs.map(b => { const r = b.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
    const i = this._padI || 0, n = pickInDir(rc[i], rc, dir);
    this._padFocus(n >= 0 ? n : i + (dir === 'up' || dir === 'left' ? -1 : 1));
  }
  _padFocus(i) { // highlight one menu button for controller navigation
    const bs = [...(this.q('#pauseOverlay')?.querySelectorAll('.padmenu button') || [])]; if (!bs.length) return;
    this._padI = (i + bs.length) % bs.length;
    bs.forEach((b, k) => { b.style.outline = k === this._padI ? '3px solid var(--accent, #ff5a1f)' : ''; b.style.outlineOffset = '3px'; });
    bs[this._padI].focus?.({ preventScroll: true }); bs[this._padI].scrollIntoView?.({ block: 'nearest' }); // long menus (ride setup) scroll along
  }
  /** workout, mode (ERG / gradient / just ride) and shifting, chosen in the ride: js/ridesetup.js, in the pause overlay */
  _setup() {
    if (this.finished || this._atGoal) return; if (!this.paused) this._pause();
    import('./ridesetup.js').then(m => { if (this.paused && !this.finished) m.openSetup(this); }).catch(e => this._flash('Setup failed: ' + (e.message || e)));
  }
  _resume() { if (this._atGoal) return this._again(); this.music?.resume(); this.paused = false; this.q('#pauseOverlay')?.remove(); this.last = performance.now(); }

  /** pause menu "Gruppe öffnen" (Freddy 15.11.): this solo ride becomes a group ride, friends join with the code and start next to you */
  async _openGroup() {
    const box = this.q('#pauseOverlay .box'); if (box) box.innerHTML = '<div class="label">Group</div><h2 class="display">Opening …</h2>';
    let g; try { g = await this._hostGroup(); }
    catch (e) { this._flash('Group failed: ' + (e.message || e)); return this._pause(); }
    if (box) { box.innerHTML = `<div class="label">Group open</div><h2 class="display" style="letter-spacing:.12em">${esc(g.code)}</h2>
      <p style="margin:6px 0 14px;opacity:.85">Friends tap “Ride together” in RIDEFRAME and enter the code, or open the link. They start right next to you.</p>
      <div class="row-actions padmenu"><button class="btn" id="pgOn">Ride on</button><button class="btn ghost" id="pgLink">Copy link</button></div>`;
      box.querySelector('#pgOn').onclick = () => this._resume();
      box.querySelector('#pgLink').onclick = e => navigator.clipboard?.writeText(g.link).then(() => { e.target.textContent = 'Link copied ✓'; }, () => { e.target.textContent = g.link; });
      this._padFocus(0); }
  }
  /** the solo ride becomes a group ride (hostFromRide), the ride itself goes on: from the pause menu and, without pausing,
   *  in the background when a friend taps Join in "Riding now" (js/live.js). Two requests at once open one group. */
  _hostGroup() {
    if (this.group?.open) return Promise.resolve(this.group);
    return this._hosting ||= (async () => {
      const g = await (await import('./share.js')).hostFromRide(this.route.id);
      if (this._closed) return g;
      this.group = g; this.laps = Math.max(this.laps, this.lap); // from now on a group ride: everyone rides the same d (no more planned extra laps)
      const right = this.q('.hud-right'), gear = this.q('#hGearChip');
      if (right && !this.q('#hGroup')) { gear.insertAdjacentHTML('beforebegin', `<div class="chip glass groupchip" id="hGroup"><div class="label">Group <button class="gcode" id="hGCode" title="Code for friends: click to copy the invite link">${esc(g.code)}</button></div><div class="glist">waiting …</div></div>`);
        this._wireVoice(); this._wireGroupChip(); }
      this.presence?.beat(); // the code goes to "Riding now" right away
      return g;
    })().finally(() => { this._hosting = null; });
  }
  /** "Riding now" (js/live.js): signed-in riders show up for their friends while they ride; never in the autopilot / screenshot ride */
  _startPresence() {
    if (this.autopilot || this.presence) return;
    import('./live.js').then(m => { if (this._closed || this.finished) return;
      this.presence = new m.Presence({ info: () => ({ routeId: this.ow ? `insel_frei:${this.ow.leg.a}-${this.ow.leg.b}` : this.route.id, routeName: this.ow ? `Island: open world · ${this.route.place || ''}` : this.route.name, d: this.d, len: this.track.length, code: this.group?.open ? this.group.code : null }),
        alive: () => !this._closed && !this.finished && this.state.settings.liveShow !== false, onRequest: r => this._joinRequest(r) });
      if (!this.presence.start()) this.presence = null; }).catch(() => {});
  }
  /** a friend tapped Join: with "Friends can join me without asking" (default) the group opens in the background, else a small
   *  question in the HUD (Accept / Not now, pad A / B). One question at a time; the friend waits at most 45 s. */
  _joinRequest(r) {
    this._askQ = (this._askQ || Promise.resolve()).then(async () => {
      const p = this.presence; if (!p) return;
      if (this.finished || this._closed) return p.answer(r.id, false);
      if (!r.auto && !(await this._askJoin(r.from))) return p.answer(r.id, false);
      try { await this._hostGroup(); } catch (e) { this._flash('Group failed: ' + (e.message || e), 3000); return p.answer(r.id, false); }
      p.answer(r.id, true); this._flash(`${r.from} is joining you`, 3500);
    }).catch(() => {});
  }
  _askJoin(name) {
    return new Promise(done => {
      const c = document.createElement('div'); c.className = 'joinask glass'; c.id = 'hJoinAsk';
      c.innerHTML = `<div class="label">Riding now</div><div class="jqt"><b>${esc(name)}</b> wants to join you</div>
        <div class="jqbtns"><button class="btn small" id="jqYes">Accept</button><button class="btn ghost small" id="jqNo">Not now</button></div><div class="jqpad">🎮 A accept · B not now</div>`;
      this.el.append(c);
      const answer = ok => { if (!this._ask) return; this._ask = null; clearTimeout(t); c.classList.add('out'); setTimeout(() => c.remove(), 250); done(ok); };
      const t = setTimeout(() => answer(false), 40e3); // the friend gives up after 45 s anyway
      this._ask = { answer };
      c.querySelector('#jqYes').onclick = () => answer(true); c.querySelector('#jqNo').onclick = () => answer(false);
    });
  }
  /** pause menu "Invite friends" (owner 17.11. (2)): the friends online right now (green dot), one button each (pad: D-pad + A);
   *  the group opens by itself if this is still a solo ride, the friend sees "Max invites you to ride · Join" */
  async _inviteMenu() {
    const box = this.q('#pauseOverlay .box'); if (!box) return;
    box.innerHTML = '<div class="label">Invite friends</div><h2 class="display">Online now</h2><p class="dim">Loading …</p>';
    const live = await import('./live.js'), F = await live.friendsNow(); if (!box.isConnected) return;
    const inGroup = new Set((this.group?.others() || []).map(r => r.name)), fs = (F?.friends || []).filter(f => f.state !== 'offline' && !inGroup.has(f.name));
    box.innerHTML = `<div class="label">Invite friends</div><h2 class="display">Online now</h2>
      ${fs.length ? '<p style="margin:6px 0 4px;opacity:.85">They see your invite on their library or phone and start right next to you.</p>' : '<p style="margin:6px 0 4px;opacity:.85">Nobody else is online right now. Friends with a green dot show up here.</p>'}
      <div class="row-actions padmenu invlist">${fs.map((f, i) => `<button class="btn ghost" data-fi="${i}"><i class="frdot ${f.state}"></i>Invite ${esc(f.name)}${f.state === 'riding' ? ' · riding' : ''}</button>`).join('')}<button class="btn" id="invBack">Back</button></div>
      <div class="hint pad-hint" style="margin-top:12px;opacity:.7">🎮 D-pad to choose · A invite · B back</div>`;
    box.querySelector('#invBack').onclick = () => this._pause();
    box.querySelectorAll('[data-fi]').forEach(b => b.onclick = async () => {
      const f = fs[+b.dataset.fi]; if (!f || b.disabled) return; b.disabled = true; b.textContent = `Inviting ${f.name} …`;
      try { await this._hostGroup(); await this.presence?.beat();
        try { await live.inviteFriend(f.key); } catch (e) { if (e.status !== 409) throw e; await new Promise(r => setTimeout(r, 700)); await this.presence?.beat(); await live.inviteFriend(f.key); }
        b.textContent = `${f.name} invited ✓`; }
      catch (e) { b.disabled = false; b.textContent = `Invite ${f.name} · ${e.message || 'failed'}`; }
    });
    this._padFocus(0);
  }
  /** the group chip: the code copies the link, a click on a rider jumps to him */
  _wireGroupChip() {
    this.q('#hGCode')?.addEventListener('click', e => { e.stopPropagation(); navigator.clipboard?.writeText(this.group.link).then(() => this._flash('Invite link copied · code ' + this.group.code), () => this._flash('Code for friends: ' + this.group.code)); });
    this.q('#hGroup .glist')?.addEventListener('click', e => { const row = e.target.closest('[data-rid]'); const r = row && this.group.others().find(x => x.id === row.dataset.rid); if (r) this._jump(r); });
  }
  /** jump to a friend (Freddy 15.11.): the skipped metres never count, not as km, not for segments, records, the story or Strava */
  _jump(r) {
    if (!r || this.finished || this._atGoal) return;
    const L = this.track.length, to = Math.max(0, Math.min(L - 40, r.d - 8)), skip = to - this.d;
    if (Math.abs(skip) < 15) return this._flash(`You are already with ${r.name}`);
    this.lapOff -= skip; (this._jumps ||= []).push([Math.floor(this.elapsed), Math.round(skip)]); // _ridden() stays where it was
    this.d = to; this.lastEle = eleAt(this.track, to); if (r.v > 0 && r.v < 30) this.v = r.v;
    this._segs = []; this._segShow = null; this._segCard(null); this._cg = null; this._cgD = null; // no segment or climb time across a jump
    const f = document.createElement('div'); f.className = 'lapfade'; f.innerHTML = `<div>⇢ ${esc(r.name)}<small>The jump does not count as distance</small></div>`; this.el.append(f);
    setTimeout(() => f.classList.add('out'), 1100); setTimeout(() => f.remove(), 2000);
  }
  /** finish line on the last lap (Freddy 15.11.): fireworks, then ride on (the route from the start) or end the ride */
  _goalAsk() {
    if (this._atGoal || this.finished) return;
    this._atGoal = true; this.paused = true; this.player.pause?.(); this.d = this.track.length - 0.01;
    const sp = this.player?.events?.surprises; sp?._salvo?.(this.track.length + 40, 12);
    this.q('#pauseOverlay')?.remove();
    const o = document.createElement('div'); o.className = 'paused goalask'; o.id = 'pauseOverlay';
    o.innerHTML = `<div class="box"><div class="label">${fmtKm(this._ridden())} km · ${fmtTime(this.elapsed)}${this.laps > 1 ? ` · ${this.lap} laps` : ''}</div><h2 class="display">Finished!</h2>
      <div class="row-actions padmenu"><button class="btn" id="gOn">Keep riding · route from the start</button><button class="btn ghost" id="gEnd">Finish &amp; save</button></div>
      <div class="hint pad-hint" style="margin-top:12px;opacity:.7">🎮 D-pad to choose · A ok</div></div>`;
    this.el.append(o);
    o.querySelector('#gOn').onclick = () => this._again();
    o.querySelector('#gEnd').onclick = () => { this._atGoal = false; this.q('#pauseOverlay')?.remove(); this.paused = false; this._finish(); };
    this._padFocus(0);
  }
  _again() {
    this._atGoal = false; this.q('#pauseOverlay')?.remove(); this.laps = this.lap + 1;
    this.music?.resume(); this.paused = false; this.last = performance.now(); this._nextLap();
  }

  _rideRecord(complete) {
    const pw = this.samples.map(s => s[2]);
    return this._hrpRec({
      id: uid(), routeId: this.route.id, date: Date.now(), complete,
      duration: Math.round(this.elapsed), distance: Math.round(this._ridden()), laps: this.laps > 1 ? this._lapRows() : undefined, manLaps: this.manLaps?.length ? [...this.manLaps, this._manRow()] : undefined, segs: this.segDone.length ? this.segDone.map(({ id, t, w }) => ({ id, t, w })) : undefined, lapMarks: this._marks(), ivs: this._intervals(), gain: Math.round(this.gainAcc), startD: Math.round(this.startD), workout: this.workout?.name || this._wName || undefined, workoutId: this._wId || undefined, ...this._adjRec(), ...this._ergRec(),
      avgPower: pw.length ? Math.round(pw.reduce((a, b) => a + b, 0) / pw.length) : 0,
      maxPower: Math.max(0, ...pw), best5: bestAvg(pw, 300), best20: bestAvg(pw, 1200),
      samples: this.samples, jumps: this._jumps?.length ? this._jumps : undefined, challenges: this.ch?.stats.offered ? { ...this.ch.stats } : undefined, wizard: this.wiz?.was || (this.wiz?.state === 'hell' ? 'hell' : this.wiz?.state === 'fly' ? 'fly' : undefined),
    });
  }
  /** heart rate vs power of a workout ride (js/hrpower.js): worked out once from the samples, only the results are added */
  _hrpRec(rec) {
    if (this._wDef && rec.samples?.length) try { const h = hrpForRide(rec, this._wDef, { t0: this._wT0 || 0, ftp: this.ftp }); if (h) rec.hrp = h; } catch (e) { console.warn('hrp', e); }
    return rec;
  }

  _adjRec() { // the watt offsets: intervals final and time-weighted over the hard intervals, easy parts final; kept only when not 0
    const avg = this._adjT > 0 ? Math.round(this._adjAcc / this._adjT) : this.wAdj;
    return this._wDef ? { ...(this.wAdj || avg ? { wAdj: this.wAdj, wAdjAvg: avg } : {}), ...(this.wAdjE ? { wAdjE: this.wAdjE } : {}) } : {};
  }

  /** open world (Freddy 19.11.): where you are on an island route is kept every 20 s, so closing the app mid-ride lets you go on
   *  from there next time (app.js startRide asks). Solo rides only; reaching the finish clears it. */
  _keepPlace(clear = false) {
    if (this.group || this.autopilot || this.ow || !/^insel/.test(this.route.id)) return;
    if (!clear && this.elapsed - (this._placeT || 0) < 20) return; this._placeT = this.elapsed;
    const s = this.state.settings, all = s.resume ||= {};
    if (clear || this.d > this.track.length - 400) delete all[this.route.id]; else all[this.route.id] = { d: Math.round(this.d), t: Math.round(this.elapsed), at: Date.now() };
    import('./app.js').then(m => m.saveSettings()).catch(() => {});
  }
  async _finish() {
    this.finished = true; this.player.pause(); if (this.d > this.track.length - 400) this._keepPlace(true);
    const full = this.startD < 50 && this.laps === 1 && !this._jumps; // jumped to a friend: no time on this route // only a ride from the start line is a time on this route (one lap)
    const rec = this._rideRecord(full);
    if (this.keyPower) { rec.unsaved = true; return this._summary(rec, null, 'Ridden with the arrow keys: not saved'); }
    const prev = (await db.ridesFor(this.route.id)).filter(r => r.complete).sort((a, b) => a.duration - b.duration);
    await db.put('rides', rec); import('./account.js').then(a => a.pushRide(rec)); this._keepPhoto(rec);
    this._summary(rec, full ? prev : null, full ? '' : this._jumps && this.laps === 1 ? 'Jumped to other riders, does not count as best time' : this.laps > 1 ? `${this.laps} laps: ` + rec.laps.map((l, i) => `${i + 1}. ${fmtTime(l.t)}`).join(' · ') : 'Started at km ' + fmtKm(this.startD) + ', does not count as best time');
  }

  /** End screen; prev = completed rides to rank against (null: not ranked, note says why). */
  /** segments: start when the line is crossed (never mid-segment), a card on the left with the running time against your best */
  _segTick(d0, dt) {
    const act = this._segs ||= []; // several at once: a sprint runs inside its flat stretch
    for (const s of [...act]) {
      s.t += dt; s.e += this.power * dt;
      if (this.d < s.seg.to) continue;
      const over = this.v > 0.1 ? Math.min(dt, (this.d - s.seg.to) / this.v) : 0, t = Math.max(1, s.t - over), w = Math.round(s.e / s.t), id = s.seg.id; // time to the exact line
      const best = this.segBest[id], last = this.segLast?.[id], pr = !best || t < best.t, k = SEG_KIND[s.seg.kind];
      // the others: best times on this host (server) and friends in this group ride who already passed it
      const others = new Map(); for (const x of this.segBoard?.segs?.[id] || []) if (x.name !== this.segBoard.me) others.set(x.name, x.t);
      for (const r of this.group?.others() || []) { const g = r.sg?.find(x => x[0] === id); if (g && (!others.has(r.name) || g[1] < others.get(r.name))) others.set(r.name, g[1]); }
      const field = [...others.entries()].map(([name, ot]) => ({ name, t: ot })).sort((a, b) => a.t - b.t), rank = field.filter(x => x.t < t).length + 1;
      this.segDone.push({ id, name: s.seg.name, kind: s.seg.kind, t, w, len: s.seg.len, pr, prev: best?.t, last: last?.t, rank: field.length ? rank : 0, of: field.length + 1, top: field[0] });
      if (pr) this.segBest[id] = { t, w, date: Date.now() };
      (this._sg ||= []).push([id, Math.round(t * 10) / 10]); this.group?.update({ sg: this._sg.slice(-6) });
      if (s.seg.kind === 'climb') this.lapMarks.push(Math.round(this.elapsed - over));
      act.splice(act.indexOf(s), 1); this._segShow = { seg: s.seg, done: true, t, w, pr, prev: best?.t, last: last?.t, field, rank, until: performance.now() + 9000 };
      const vsLast = last ? ` · ${t <= last.t ? fmtTime(last.t - t) + ' faster' : fmtTime(t - last.t) + ' slower'} than last time` : '';
      this._flash(`${k.icon} ${s.seg.name}: ${fmtTime(t)}${pr && best ? ' · new best time!' : !best ? ' · first time' : ''}${vsLast}${field.length ? ` · rank ${rank} of ${field.length + 1}` : ''}`);
    }
    for (const seg of this.segs) if (d0 <= seg.from && this.d > seg.from && !act.some(s => s.seg === seg)) { // crossed a start line (never joined mid-segment)
      act.push({ seg, t: Math.max(0, (this.d - seg.from) / Math.max(0.1, this.v)), e: 0 });
      if (seg.kind === 'sprint') this._flash(`⚡ ${seg.name}: 300 m flat out!`);
      if (seg.kind === 'climb') { this.lapMarks.push(Math.round(this.elapsed)); const b = this.segBest[seg.id]; // the climb starts: big and clear, and a new lap
        this._segBanner(seg, b); } }
    // the card: a result for a few seconds, else the shortest running segment (the sprint over its flat)
    const run = act.reduce((m, s) => !m || s.seg.len < m.seg.len ? s : m, null);
    if (this._segShow && performance.now() < this._segShow.until && !(run && run.seg.kind === 'sprint' && this._segShow.seg !== run.seg)) this._segCard(this._segShow);
    else this._segCard(run ? { seg: run.seg, t: run.t } : null);
  }
  _segCard(st) {
    let el = this.q?.('#hSeg');
    if (!st) { if (el) el.hidden = true; return; }
    if (!el) { const hud = this.el.querySelector('.hud'); if (!hud) return; el = document.createElement('div'); el.id = 'hSeg'; el.className = 'segcard glass'; hud.append(el); }
    const { seg } = st, k = SEG_KIND[seg.kind], best = this.segBest[seg.id], left = Math.max(0, seg.to - this.d);
    // pace against your best: where your best effort would be after this time (even pace), ahead in green, behind in red
    let pace = '';
    if (!st.done && best) { const dBest = seg.len * Math.min(1, st.t / best.t), dMe = Math.max(0, this.d - seg.from), gap = (dMe - dBest) / Math.max(1, this.v || seg.len / best.t);
      pace = `<div class="segpace ${gap >= 0 ? 'ahead' : 'behind'}">${gap >= 0 ? '−' : '+'}${fmtTime(Math.abs(gap))}</div>`; }
    el.className = `segcard glass ${seg.kind}${st.done ? ' done' : ''}${st.done && st.pr ? ' pr' : ''}`; el.hidden = false;
    el.innerHTML = `<div class="label">${k.icon} ${k.label}</div><div class="segname">${esc(seg.name)}</div>
      <div class="segtime num">${fmtTime(st.t)}</div>${pace}
      ${st.done ? this._segCompare(st) : ''}<div class="segsub">${st.done ? (st.pr ? (st.prev ? 'New best time!' : 'First time') : `Best time ${fmtTime(best.t)}`) + ` · ${st.w} W` : `${left >= 1000 ? fmtKm(left) + ' km' : Math.round(left) + ' m'} to go${best ? ` · best time ${fmtTime(best.t)}` : ''}`}</div>
      ${st.done ? '' : `<div class="chbar"><b style="width:${Math.min(100, (this.d - seg.from) / seg.len * 100).toFixed(1)}%"></b></div>`}`;
  }
  _segCompare(st) { // at the top: against last time and the other players
    const rows = [];
    if (st.last) rows.push(`<div><span>Last time</span><b class="${st.t <= st.last ? 'ahead' : 'behind'}">${st.t <= st.last ? '−' : '+'}${fmtTime(Math.abs(st.t - st.last))}</b></div>`);
    for (const x of (st.field || []).slice(0, 3)) rows.push(`<div><span>${esc(x.name)}</span><b class="${st.t <= x.t ? 'ahead' : 'behind'}">${fmtTime(x.t)}</b></div>`);
    if (st.field?.length) rows.push(`<div class="rank">Rank ${st.rank} of ${st.field.length + 1}</div>`);
    return rows.length ? `<div class="segcmp">${rows.join('')}</div>` : '';
  }
  _segBanner(seg, best) { // a short big banner in the middle when a climb starts
    const b = document.createElement('div'); b.className = 'segbanner'; b.innerHTML = `<div class="label">▲ Climb · new lap</div><div class="n">${esc(seg.name)}</div><div class="s">${fmtKm(seg.len)} km · avg ${fmtNum(seg.avg, 1)} %${best ? ` · your best time ${fmtTime(best.t)}` : ''}</div>`;
    this.el.querySelector('.hud')?.append(b); setTimeout(() => b.classList.add('out'), 2600); setTimeout(() => b.remove(), 3400);
  }
  _segSummary() {
    if (!this.segDone.length) return '';
    return `<div class="segsum"><div class="label">Segments</div>${this.segDone.map(s => `<div class="${s.pr ? 'pr' : ''}"><span>${SEG_KIND[s.kind].icon} ${esc(s.name)}</span><span class="num">${fmtTime(s.t)}</span><span class="num">${s.w} W</span><b>${s.pr ? (s.prev ? 'Best time' : 'first time') : '+' + fmtTime(s.t - s.prev)}${s.rank ? ` · ${s.rank}/${s.of}` : ''}</b></div>`).join('')}</div>`;
  }
  /** the hard parts with time and average watts (Freddy 12.11.: into the Strava description): workout intervals, else the climbs */
  _intervals() {
    const out = this._wDef ? intervalRecords({ workout: this._wDef, t0: this._wT0 || 0, samples: this.samples, elapsed: this.elapsed, ftp: this.ftp, stepAdj: this._stepAdj, kg: this.state.settings.riderKg })
      : this.segDone.filter(s => s.kind === 'climb').map(s => ({ name: s.name, t: Math.round(s.t), w: s.w })); // ivhistory.js: ridden avg / max W, HR, cadence; the plan only as context
    return out.length ? out : undefined;
  }
  /** lap marks for the Strava file: climbs and route laps, plus start and end of every hard workout interval */
  _marks() {
    const m = [...(this.lapMarks || [])], w = this._wDef;
    if (w) { let s = this._wT0 || 0; for (const st of w.steps) { if (st.pct >= 88 && s < this.elapsed) m.push(Math.round(s), Math.round(Math.min(s + st.dur, this.elapsed))); s += st.dur; } }
    return m.length ? m : undefined;
  }
  /** open world: at the junction the next leg loads behind a short fade; km and time go on (Freddy 20.11.) */
  async _swapLeg() {
    const ow = this.ow, l = ow.next(); ow.busy = true;
    const fade = document.createElement('div'); fade.className = 'owfade'; fade.innerHTML = `<div><div class="label">Open world</div><h2 class="display">${esc(ow.map.nodes[l.b]?.name || '')}</h2><p>${esc(l.edge.name)} · ${fmtNum(l.edge.len / 1000, 0)} km</p></div>`;
    this.el.append(fade); requestAnimationFrame(() => fade.classList.add('in'));
    try {
      const { legRoute } = await import('./openworld.js'), r = await legRoute(l, ow.map); if (!r) throw new Error('leg ' + l.a + '-' + l.b);
      const old = this.track, t = r.track; for (const k of ['__village', '__sunset', '__mode', '__look']) t[k] = old[k];
      t.__dOff = (old.__dOff || 0) + old.length; // the sun goes on over the whole ride
      const { WorldScene, prepareWorld } = await import('./world/lofoten.js'); await prepareWorld(t);
      const c0 = this.el.querySelector('canvas.scene'), c = document.createElement('canvas'); c.className = 'scene'; c0.after(c);
      const P = new WorldScene(c, t);
      P.currentTime = 0; P.setFov ? P.setFov(fovOf(this.state.settings)) : null; P.setView?.(this.state.settings.view3d || 0); P.setCockpit?.(this.state.settings.cockpit !== false); P._placeCockpit?.();
      if (P.ready) await Promise.race([P.ready, new Promise(res => setTimeout(res, 60000))]);
      const was = this.player; this.player = P; window.__world = P; P._rideOn = true; was.destroy?.(); c0.remove();
      this.lapOff = this._ridden(); // everything so far, with the metres ridden while it loaded
      this.track = t; this.route = { ...this.route, track: t, leg: l, place: r.place };
      this.d = 0; this._lapBase = 0; this.lastEle = eleAt(t, 0);
      const mc = this.el.querySelector('#hMap'); if (mc && this.minimap) this.minimap = new MiniMap(mc, t, P.field?.pose ? d => P.field.pose(d) : null);
      if (this.eagle && this.eg?.state === 'wait') import('./world/eagle.js').then(m => { if (!this._closed) this.eagle = new m.Eagle(this.player); }).catch(() => {});
      ow.done(l);
    } catch (e) { console.warn('open world', e); this._flash?.('The next road did not load. You ride on here.'); ow.done(ow.leg); this.d = 0; }
    ow.busy = false; fade.classList.remove('in'); setTimeout(() => fade.remove(), 900);
  }
  _ridden() { return this.lapOff + this.d - this._lapBase; } // metres ridden in this session, over all laps
  _distSub() { if (this.ow) return 'open world'; return this.laps > 1 ? `Lap ${this.lap}/${this.laps} · of ${fmtKm(this.track.length * this.laps - this.startD)} km` : `of ${fmtKm(this.track.length)} km`; }
  _lapRows() { return [...this.lapList, { t: Math.round(this.elapsed - this._lapT0), d: Math.round(this.d - this._lapBase) }]; }
  /** finish line reached with laps to go: a short fade, then back to the start line (the routes are point to point) */
  _nextLap() {
    const L = this.track.length;
    this.lapList.push({ t: Math.round(this.elapsed - this._lapT0), d: Math.round(L - this._lapBase) });
    this.lapOff += L - this._lapBase; this._lapBase = 0; this._lapT0 = this.elapsed; this.lap++; this.lapMarks.push(Math.round(this.elapsed));
    this.d = 0; this.lastEle = eleAt(this.track, 0); this._segs = []; this._segShow = null; this._segCard(null);
    const sp = this.player?.events?.surprises; // dares and the wizard start over with the lap
    if (this.ch?.active) this._chEnd(this.ch.active, sp, 0);
    if (this._goalWiz) { sp?.poof?.(this._goalWiz); this._goalWiz = null; this._goalSaid = false; }
    for (const id of ['#hCh', '#hWiz', '#hHell', '#hWizFx']) this.q?.(id)?.remove();
    this.ch = null; this.wiz = null; this._initChallenges(); this._initWizard();
    sp?.startArch?.(14);
    const q = this.q?.('#hDistSub'); if (q) q.textContent = this._distSub();
    const last = this.lapList[this.lapList.length - 1];
    this._flash(`Lap ${this.lap - 1} done: ${fmtTime(last.t)} · now lap ${this.lap} of ${this.laps}`);
    const f = document.createElement('div'); f.className = 'lapfade'; f.innerHTML = `<div>Lap ${this.lap}<small>of ${this.laps}</small></div>`; this.el.append(f);
    setTimeout(() => f.classList.add('out'), 1300); setTimeout(() => f.remove(), 2200);
  }
  /** after a fitness test: the result and a button to take it as the new FTP */
  _testHTML(rec) {
    if (rec.workoutId !== 'ramp' && rec.workoutId !== 'ftp20') return '';
    const w = testResult(rec.workoutId, rec.samples), old = this.state.settings.ftp || 0;
    if (!w) return `<div class="chsum">Fitness test: too short for a result${rec.workoutId === 'ftp20' ? ' (it needs 20 minutes in one go)' : ''}</div>`;
    return `<div class="ftptest"><div><div class="label">Fitness test · ${rec.workoutId === 'ramp' ? '75 % of your best minute' : '95 % of your best 20 minutes'}</div>
      <div class="v">${w}<small>W</small></div><div class="dim">before ${old || '–'} W${old ? ` · ${w >= old ? '+' : '−'}${Math.abs(w - old)} W` : ''}</div></div>
      ${rec.unsaved ? '' : `<button class="btn" id="fFtp" data-w="${w}">Apply as new FTP</button>`}</div>`;
  }

  _summary(rec, prev, note) {
    this.presence?.stop(); this._ask?.answer(false); // the ride is over: off the "Riding now" list
    const pb = prev && (!prev.length || rec.duration < prev[0].duration);
    const rank = prev ? prev.filter(r => r.duration < rec.duration).length + 1 : 0;
    const delta = prev?.length ? rec.duration - prev[0].duration : 0;
    const o = document.createElement('div'); o.className = 'finish';
    o.innerHTML = `<div class="box">
      ${!prev ? `<div class="label">${fmtKm(rec.distance)} km ridden</div>` : pb ? '<div class="pbflag">New best time</div>' : `<div class="label">Rank ${rank} of ${prev.length + 1}</div>`}
      <h2 class="display">${fmtTime(rec.duration)}</h2>
      <div class="label" style="margin-top:14px">${esc(this.route.name)} · ${!prev ? esc(note) : prev.length ? (delta <= 0 ? `${fmtTime(-delta)} faster than your old best time` : `${fmtTime(delta)} behind your best time`) : 'First ride on this route'}</div>
      <div class="bigstats" style="grid-template-columns:repeat(5,1fr)">
        <div><div class="label">Avg power</div><div class="v">${rec.avgPower}<small>W</small></div></div>
        <div><div class="label">Max</div><div class="v">${rec.maxPower}<small>W</small></div></div>
        <div><div class="label">Avg speed</div><div class="v">${fmtNum(rec.distance / Math.max(1, rec.duration) * 3.6, 1)}<small>km/h</small></div></div>
        <div><div class="label">Climb</div><div class="v">${fmtNum(rec.gain)}<small>m</small></div></div>
        <div><div class="label">Work</div><div class="v">${fmtNum(rec.avgPower * rec.duration / 1000)}<small>kJ</small></div></div>
      </div>
      ${this._segSummary()}
      <div id="fIvs"></div>
      <div id="fHrp"></div>
      ${rec.manLaps ? `<div class="chsum manlaps" style="text-align:left"><div class="label" style="margin-bottom:6px">Your laps</div>${rec.manLaps.map((l, i) => `<div style="display:grid;grid-template-columns:28px 1fr 1fr 1fr;gap:8px;font-variant-numeric:tabular-nums"><span>${i + 1}</span><span>${fmtTime(l.t)}</span><span>${fmtKm(l.d)} km</span><b>${l.w} W</b></div>`).join('')}</div>` : ''}
      ${rec.erg ? '<div class="chsum">Workout (ERG) · the trainer held the target watts</div>' : ''}
      ${rec.wAdj || rec.wAdjAvg ? `<div class="chsum">Intervals ${fmtAdj(rec.wAdj)}${rec.wAdjAvg !== rec.wAdj ? ` · average ${fmtAdj(rec.wAdjAvg)}` : ''} ${rec.wAdjE ? ` · easy parts ${fmtAdj(rec.wAdjE)}` : ''} · targets tuned live</div>` : rec.wAdjE ? `<div class="chsum">Easy parts ${fmtAdj(rec.wAdjE)} · targets tuned live</div>` : ''}
      ${this._testHTML(rec)}
      ${rec.challenges ? `<div class="chsum">⚔ ${rec.challenges.offered} challenges · ${rec.challenges.accepted} accepted · ${rec.challenges.won} won</div>` : ''}
      ${storyHTML(this._storyEnd())}
      ${rec.wizard ? `<div class="chsum">🧙 ${rec.wizard === 'fly' ? 'Passed the Wizard’s test · flew over the island' : 'Failed the Wizard’s test · rode through hell'}</div>` : ''}
      <div class="row-actions"><button class="btn ghost" id="fShare">Image to share</button><button class="btn ghost" id="fStrava">Upload to Strava</button><button class="btn" id="fDone">Done</button></div></div>`;
    this.el.append(o);
    if (rec.ivs?.length) import('./ivview.js').then(async m => { const box = o.querySelector('#fIvs'); if (!box) return; // the ridden intervals, then "Last time …" per set
      box.innerHTML = m.ivSummaryHTML(rec); const rides = await db.all('rides').catch(() => []);
      box.innerHTML = m.ivSummaryHTML(rec, m.ivCompare(rec, rides, this.state.settings.riderKg)); }).catch(() => {});
    if (rec.hrp) import('./hrpview.js').then(async m => m.mountHrpRide(o.querySelector('#fHrp'), rec, await db.all('rides').catch(() => []))).catch(() => {}); // heart rate vs power, recovery index, "last time"
    o.querySelector('#fDone').onclick = () => this._close(true);
    wireStory(o, this._storySum); // Wizard points: "?", the shop, the strength set for extra points (Freddy 13.11.)
    o.querySelector('#fFtp')?.addEventListener('click', async e => { // fitness test: take the new FTP, the ride remembers it as a test
      const b = e.currentTarget, w = +b.dataset.w; b.disabled = true;
      this.state.settings.ftp = w; rec.ftpTest = w;
      const app = await import('./app.js'); await app.saveSettings();
      if (!rec.unsaved) { await db.put('rides', rec); import('./account.js').then(a => a.pushRide(rec)); }
      b.textContent = `FTP now ${w} W ✓`; app.ridesChanged?.();
    });
    const shareOpts = async () => ({ rec, route: this.route, track: this.track, photo: await this.bestPhoto(), pose: this.player?.field?.pose ? d => this.player.field.pose(d) : null, pb: !!(prev && (!prev.length || rec.duration < prev[0].duration)) });
    o.querySelector('#fShare').onclick = async e => {
      const b = e.currentTarget, t = b.textContent; b.disabled = true; b.textContent = 'Making image …';
      try { const { shareModal } = await import('./shareimg.js'); await shareModal(await shareOpts()); }
      catch (err) { import('./app.js').then(m => m.toast('Image failed: ' + (err.message || err), 5000)); }
      b.disabled = false; b.textContent = t;
    };
    if (rec.unsaved) o.querySelector('#fStrava')?.remove(); /* nothing to upload: the watts were typed, not ridden */
    else o.querySelector('#fStrava').onclick = e => stravaButton(e.currentTarget, rec, this.route.name, routeFns(this.track) || (d => eleAt(this.track, d)), async () => {
      const [{ makeShareImage }, { account }] = await Promise.all([import('./shareimg.js'), import('./account.js')]);
      return makeShareImage({ ...(await shareOpts()), who: account()?.name || '' });
    });
    if (!rec.unsaved && this.state.settings?.autoStrava) setTimeout(() => o.querySelector('#fStrava')?.click(), 400); // settings: upload on its own, as in the phone modes
  }

  async _end(save) {
    if (!save) return this._close(false);
    if (this.elapsed <= 30) { import('./app.js').then(m => m.toast('Under 30 seconds, not saved', 3500)); return this._close(false); }
    if (this.keyPower) { import('./app.js').then(m => m.toast('Ridden with the arrow keys, not saved', 3500)); return this._close(false); }
    const rec = this._rideRecord(false); await db.put('rides', rec); import('./account.js').then(a => a.pushRide(rec)); this._keepPhoto(rec);
    this.finished = true; this.q('#pauseOverlay')?.remove();
    this._summary(rec, null, 'Ended early, saved');
  }

  _close(saved) {
    this._closed = true; this.pose?.stop(); this._clickOff?.(); this.presence?.stop(); this._ask?.answer(false);
    this.running = false; this.ue?.close(); this.state.trainer.setPower?.(null); this.music?.destroy();
    if (this.group?.voice) { this.group.voice.stop(); this.group.voice = null; } // ride over: microphone off, indicator off
    if (this._voiceUI) window.removeEventListener('rf-voicechange', this._voiceUI);
    document.removeEventListener('keydown', this._key); document.removeEventListener('rf-remote', this._remote);
    this.player.destroy?.();
    this.wake?.release?.();
    if (document.fullscreenElement) document.exitFullscreen?.();
    this.el.remove();
    this.onExit?.(saved);
  }
}
