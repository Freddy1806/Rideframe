// Ride mode: physics, video speed sync, trainer control, HUD, ghost and saving.
import { db, uid } from './db.js';
import { STEP, eleAt, gradeAt, timeAt, videoSpeedAt } from './track.js';
import { defaultParams, step as physStep } from './physics.js';
import { DemoScene } from './demo.js';
import { drawHudProfile } from './profile.js';
import { fmtTime, fmtKm, fmtNum, esc, bestAvg } from './util.js';
import { stravaExport } from './tcx.js';
import { gearsFrom, gearName, parseGear, estimateGear, virtualGrade } from './gears.js';
import { UEBridge } from './uebridge.js';
import { MiniMap } from './minimap.js';
import { fovOf, FOV_MIN, FOV_MAX, FOV_DEFAULT } from './fov.js';
import { workoutAt, workoutSVG } from './workouts.js';
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

export class RideSession {
  constructor({ route, ghost, state, onExit, autopilot = false, at = 0, group = null, ghostName = '', workout = null }) {
    Object.assign(this, { route, ghost, state, onExit, autopilot, group, ghostName, workout });
    this.erg = state.settings.erg !== false; this.ftp = state.settings.ftp || 200;
    this.track = route.track;
    this.params = defaultParams(state.settings);
    this.d = Math.min(at, this.track.length - 1); this.v = 0; this.elapsed = 0;
    this.startD = this.d; // a ride started mid-route counts its own distance and never sets a best time
    this.manualPower = autopilot ? 240 : 0; this.power = 0; this.cadence = 0; this.hr = 0;
    this.powerHist = []; this.samples = []; this.lastSample = 0; this.gainAcc = 0; this.lastEle = eleAt(this.track, this.d);
    this.running = false; this.paused = false; this.finished = false;
    this.climbs = this.track.intervals || findClimbs(this.track);
    const st = state.settings;
    this.gears = gearsFrom(st); this.virtual = st.shiftMode === 'virtual'; this.realGear = parseGear(st.realGear);
    this.wheel = (st.wheel || 2105) / 1000;
    this.gi = this.gears.reduce((b, g, i) => Math.abs(Math.log(g.ratio / this.realGear.ratio)) < Math.abs(Math.log(this.gears[b].ratio / this.realGear.ratio)) ? i : b, 0);
    this.gear = this.virtual ? this.gears[this.gi] : null;
    if (at && ghost?.samples?.length) this.elapsed = Math.max(0, (this.ghostTimeAt(this.d) || 0) - 14); // screenshots / resume
    this._tick = this._tick.bind(this); this._key = this._key.bind(this);
    if (st.ueBridge || new URLSearchParams(location.search).has('ue')) { this.ue = new UEBridge(route.id, { ...this.track, step: STEP }); this.ue.weather = st.ueWeather || 'auto'; } // Unreal view (beta)
  }

  async start() {
    const el = this.el = document.createElement('div'); el.className = 'ride';
    document.addEventListener('keydown', this._key); // early: watts set with ↑↓ while the world loads are kept
    el.innerHTML = this._hudHTML();
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
        try { const { WorldScene, prepareWorld } = await import('./world/lofoten.js'); await prepareWorld(this.track); this.player = new WorldScene(c, this.track); window.__world = this.player; }
        catch (e) { console.warn('3D world failed, using 2D scene', e); }
      }
      if (!this.player) this.player = new DemoScene(c, this.track);
      this.player.currentTime = timeAt(this.track, this.d);
      this.player.setFov ? this.player.setFov(fovOf(this.state.settings)) : this.player.setLens?.(this.state.settings.lensMm || 0); this.player.setView?.(this.state.settings.view3d || 0); this.player.setCockpit?.(this.state.settings.cockpit !== false);
      el.classList.toggle('world3d', !!this.player.setLens); // compact HUD over the 3D world
      this.player._placeCockpit?.();
      if (this.player.ready) { // 3D world: show a loading card instead of a black screen until the ground around the start stands
        const ld = document.createElement('div'); ld.className = 'countdown loading'; ld.textContent = 'Welt wird geladen …'; el.append(ld);
        await Promise.race([this.player.ready, new Promise(r => setTimeout(r, 30000))]); ld.remove();
      }
    }
    this.profile = el.querySelector('#hudProfile');
    { const mc = el.querySelector('#hMap'); this.minimap = new MiniMap(mc, this.track, this.player?.field?.pose ? d => this.player.field.pose(d) : null); if (!this.minimap.ok) mc.parentElement.remove(); }
    this.q = s => el.querySelector(s);
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
    if (this.group) this._wireVoice();
    this.running = true; this.last = performance.now();
    this._updateHUD(true);
    if (!this.autopilot) await this._countdown();
    this.last = performance.now();
    requestAnimationFrame(this._tick);
  }

  _hudHTML() {
    const ghostChip = (this.group ? '<div class="chip glass groupchip" id="hGroup"><div class="label">Gruppe</div><div class="glist">wartet …</div></div>' : '') + (this.ghost ? `<div class="chip gap glass"><div class="label">vs. ${this.ghostName ? esc(this.ghostName) : this.state.settings.ghost === 'last' ? 'letzte Fahrt' : 'Bestzeit'}</div><div class="v num" id="hGap">0:00</div></div>` : '');
    return `<div class="hud">
      <div class="hud-top">
        <div class="hud-route glass"><div class="wordmark"><svg class="mark" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="var(--accent)"/><path d="M6 24 L14 12 L19 18 L23 10 L27 24 Z" fill="#0b0b0b"/></svg>RIDEFRAME</div><span class="sep"></span><span class="name">${esc(this.route.name)}</span></div>
        <div class="hud-right">
          ${ghostChip}
          <div class="chip glass gearchip" data-hud="gear"><div class="label" id="hGearL">${this.virtual ? 'Virtueller Gang' : 'Gang'}</div><div class="v num" id="hGear">–</div><div class="gearbar" id="hGearBar">${this.virtual ? this.gears.map(() => '<i></i>').join('') : ''}</div></div>
          <div class="chip glass" data-hud="time"><div class="label">Zeit</div><div class="v num" id="hTime">0:00</div></div>
          ${this.track.world ? '<button class="chip glass camchip" data-hud="buttons" id="hCam" title="Kamera wechseln (V)"><div class="label">Kamera</div><div class="v">⟲</div></button><button class="chip glass camchip" data-hud="buttons" id="hBar" title="Lenker ein/aus (H)"><div class="label">Lenker</div><div class="v">⊓</div></button><button class="chip glass camchip" id="hWide" title="Weitwinkel ([ und ])"><div class="label">Sicht</div><div class="v">↔</div></button>' : ''}
          ${this.group ? `<button class="chip glass camchip voicechip" id="hVoice" title="Sprachchat an: ihr hört euch gegenseitig"><div class="label">Sprachchat</div><div class="v">${MIC_SVG}</div></button>` : ''}
          <button class="chip glass camchip" data-hud="buttons" id="hMusic" title="Musik an/aus (M), nächster Titel (N)"><div class="label">Musik</div><div class="v">♫</div></button>
          <button class="chip glass camchip" id="hHudBtn" title="Anzeige wählen (I)"><div class="label">Anzeige</div><div class="v">◧</div></button>
        </div>
      </div>
      ${this.workout ? `<div class="wpanel glass" id="hWork"><div class="label" id="hWName">${esc(this.workout.name)}${this.erg ? ' · ERG' : ''}</div>
        <div class="wstep" id="hWStep">–</div><div class="wtarget num"><span id="hWT">–</span><small>W</small><span class="wleft num" id="hWLeft"></span></div>
        <div class="wnext" id="hWNext"></div><div id="hWChart">${workoutSVG(this.workout, 0)}</div></div>` : ''}
      <div class="minimap glass" data-hud="map"><canvas id="hMap"></canvas></div>
      <div class="grade-tag" data-hud="gradeTag" id="hGradeTag"><div class="g num"><span class="arrow"></span><span id="hGrade">0,0</span><small>%</small></div><div class="next glass" id="hNext"></div></div>
      <div class="hud-bottom glass">
        <div class="metrics">
          <div class="metric power" data-hud="power"><div class="label">Leistung</div><div class="v num"><span id="hPow">0</span><small>W</small></div><div class="sub" id="hPowSub">Ø 0 W</div></div>
          <div class="metric" data-hud="wkg"><div class="label">W/kg</div><div class="v num"><span id="hWkg">0,0</span></div><div class="sub" id="hWkgSub">Gewicht ${fmtNum(this.state.settings.riderKg || 75, 0)} kg</div></div>
          <div class="metric" data-hud="speed"><div class="label">Tempo</div><div class="v num"><span id="hSpd">0,0</span><small>km/h</small></div><div class="sub" id="hSpdSub">–</div></div>
          <div class="metric" data-hud="cad"><div class="label">Trittfrequenz</div><div class="v num"><span id="hCad">0</span><small>rpm</small></div><div class="sub" id="hHr">–</div></div>
          <div class="metric" data-hud="dist"><div class="label">Distanz</div><div class="v num"><span id="hDist">0,0</span><small>km</small></div><div class="sub" id="hDistSub">von ${fmtKm(this.track.length)} km</div></div>
          <div class="metric" data-hud="hr"><div class="label">Puls</div><div class="v num"><span id="hBpm">–</span><small>bpm</small></div><div class="sub" id="hGain">0 m · +0 hm</div></div>
          <div class="metric" data-hud="grade"><div class="label">Steigung</div><div class="v num"><span id="hGrade2">0,0</span><small>%</small></div><div class="sub" id="hTrainer">${this.state.trainer.connected ? 'Trainer aktiv' : 'Ohne Trainer · ↑ ↓ Watt'}</div></div>
        </div>
        <div class="hud-profile" data-hud="profile"><canvas id="hudProfile"></canvas></div>
      </div>
    </div>`;
  }

  async _countdown() {
    const c = document.createElement('div'); c.className = 'countdown'; this.el.append(c);
    for (const n of ['3', '2', '1', 'LOS']) { c.textContent = n; await new Promise(r => setTimeout(r, 750)); }
    c.remove();
  }

  _roadGrade() {
    const g = gradeAt(this.track, this.d), s = this.state.settings;
    return g >= 0 ? g * s.difficulty / 100 : g * s.downhill / 100;
  }
  _trainerGrade() {
    const g = this._roadGrade();
    if (!this.virtual) return g;
    const t = this.state.trainer, k = this.gears[this.gi].ratio / this.realGear.ratio;
    const ws = t.data?.speed > 0.5 ? t.data.speed : Math.max(1, this.v / k);
    return virtualGrade(g, k, ws, this.params.mass);
  }
  shift(dir) {
    if (!this.virtual) { // real shifting: the gear is changed on the bike itself
      if (!this._shiftHint) { this._shiftHint = true; this.q && (this.q('#hGearL').textContent = 'Schalten am Rad · virtuell: Einstellungen'); }
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
    this._flash?.(on ? (this.ue.mismatch ? `Achtung: RIDEFRAME ${this.ue.version} und Unreal ${this.ue.ueVersion} passen nicht zusammen` : 'Bild läuft jetzt in Unreal') : 'Unreal getrennt, Bild wieder hier');
  }
  _tick(now) {
    if (!this.running) return;
    const dt = Math.min(0.25, (now - this.last) / 1000); this.last = now;
    this._pollPad();
    if (!this.paused && !this.finished) {
      this._readInputs();
      const g = gradeAt(this.track, this.d);
      this.v = physStep(this.v, this.power, g, dt, this.params);
      this.d = Math.min(this.track.length, this.d + this.v * dt);
      this.elapsed += dt;
      const e = eleAt(this.track, this.d); if (e > this.lastEle) this.gainAcc += e - this.lastEle; this.lastEle = e;
      this._workout(dt);
      this.state.trainer.setGrade(this._trainerGrade());
      this._syncVideo();
      if (this.elapsed - this.lastSample >= 1) {
        this.lastSample = Math.floor(this.elapsed);
        this.samples.push([this.lastSample, Math.round(this.d - this.startD), Math.round(this.power), Math.round(this.v * 36) / 10, Math.round(this.cadence), this.hr]);
        this.powerHist.push(this.power);
      }
      if (this.d >= this.track.length) this._finish();
    }
    if (now - (this.lastHud || 0) > 100) { this.lastHud = now; this._updateHUD(); }
    if (this.ue) this._ueLive();
    this.ue?.update(now, { d: Math.round(this.d * 100) / 100, v: Math.round(this.v * 100) / 100, grade: Math.round(gradeAt(this.track, this.d) * 10) / 10, fov: fovOf(this.state.settings), riders: this._ueRiders || [], watt: Math.round(this.power), hr: this.hr, cad: Math.round(this.cadence), paused: this.paused || this.finished, t: Math.round(this.elapsed * 10) / 10 });
    requestAnimationFrame(this._tick);
  }

  _pollPad() { // gamepad / remote: LB/RB or D-pad down/up shift, A/Start pause
    const pad = navigator.getGamepads?.().find(Boolean); if (!pad) return;
    const b = pad.buttons.map(x => x.pressed), was = this.padPrev || [];
    const hit = i => b[i] && !was[i];
    if (hit(4) || hit(13)) this.shift(-1);
    if (hit(5) || hit(12)) this.shift(1);
    if (hit(9)) this.paused ? this._resume() : this._pause();
    this.padPrev = b;
  }

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

  _updateHUD(force) {
    const q = this.q; if (!q) return;
    const g = gradeAt(this.track, this.d);
    const avgP = this.powerHist.length ? Math.round(this.powerHist.reduce((a, b) => a + b, 0) / this.powerHist.length) : 0;
    const p3 = this.powerHist.slice(-3); const pShow = p3.length ? Math.round((p3.reduce((a, b) => a + b, 0) + this.power) / (p3.length + 1)) : this.power;
    q('#hPow').textContent = pShow; const wk = q('#hWkg'); if (wk) wk.textContent = fmtNum(pShow / (this.state.settings.riderKg || 75), 1);
    q('#hPowSub').textContent = `Ø ${avgP} W · ${fmtNum(pShow / this.state.settings.riderKg, 1)} W/kg`;
    q('#hSpd').textContent = fmtNum(this.v * 3.6, 1);
    q('#hSpdSub').textContent = this.track.world ? `noch ${fmtNum(Math.max(0, this.track.length - this.d) / 1000, 1)} km` : this.v < 0.3 ? 'Video steht' : `Video ×${fmtNum(this.rate || 1, 2)}`;
    q('#hCad').textContent = this.cadence;
    const tc = this.state.settings.cadence, cadOff = tc && this.cadence > 20 ? this.cadence - tc : 0;
    const hint = cadOff < -8 ? '▼ leichter schalten' : cadOff > 8 ? '▲ schwerer schalten' : '';
    q('#hHr').textContent = hint || (tc ? `Ziel ${tc} rpm` : '–');
    q('#hHr').classList.toggle('hint-on', !!hint);
    const t = this.state.trainer;
    if (this.virtual) {
      q('#hGear').textContent = gearName(this.gear);
      q('#hGearL').textContent = `Virtueller Gang ${this.gi + 1}/${this.gears.length}`;
      q('#hGearBar').querySelectorAll('i').forEach((el, i) => el.className = i <= this.gi ? 'on' : '');
      q('.gearchip').classList.toggle('flash', performance.now() - (this.shiftFlash || 0) < 350);
    } else {
      const g = estimateGear(this.gears, t.data?.speed, this.cadence, this.wheel * 1000);
      q('#hGear').textContent = g ? gearName(g) : '–';
    }
    q('#hDist').textContent = fmtNum(this.d / 1000, 2);
    q('#hBpm').textContent = this.hr || '–';
    q('#hGain').textContent = `${fmtNum(eleAt(this.track, this.d))} m · +${fmtNum(this.gainAcc)} hm`;
    q('#hGrade').textContent = fmtNum(Math.abs(g), 1);
    q('#hGrade2').textContent = fmtNum(g, 1);
    q('#hTime').textContent = fmtTime(this.elapsed);
    const tag = q('#hGradeTag'); tag.className = 'grade-tag ' + (g > 0.5 ? 'up' : g < -0.5 ? 'down' : 'flat');
    if (this.source) q('#hTrainer').textContent = this.source === 'trainer' ? `Trainer ${fmtNum(this._trainerGrade(), 1)} %` : 'Ohne Trainer · ↑ ↓ Watt';
    // climb info
    const cur = this.climbs.find(c => this.d >= c.from && this.d < c.to);
    const next = this.climbs.find(c => c.from > this.d);
    const nx = q('#hNext');
    const ftp = this.state.settings.ftp, zLo = Math.round(ftp * .95), zHi = Math.round(ftp * 1.05);
    const pw = q('.metric.power'); pw.classList.remove('z-lo', 'z-ok', 'z-hi');
    if (cur?.interval) {
      const n = this.climbs.indexOf(cur) + 1, left = cur.to - this.d;
      const eta = left / Math.max(1.5, this.v);
      nx.innerHTML = `<b>Intervall ${n}/${this.climbs.length}</b> · ${esc(cur.name)} · noch ${fmtTime(eta)}${ftp ? ` · Ziel ${zLo}–${zHi} W` : ''}`; nx.hidden = false;
      if (ftp) pw.classList.add(pShow < zLo ? 'z-lo' : pShow > zHi ? 'z-hi' : 'z-ok');
    } else if (next?.interval) {
      nx.innerHTML = `Nächstes Intervall in ${fmtKm(next.from - this.d)} km · ${esc(next.name)} · ${next.minutes} min Ø ${fmtNum(next.grade, 1)} %`; nx.hidden = false;
    } else if (cur) { const left = cur.to - this.d; const gl = eleAt(this.track, cur.to) - eleAt(this.track, this.d); nx.innerHTML = `Noch ${fmtKm(left)} km · Ø ${fmtNum(gl / left * 100, 1)} %`; nx.hidden = false; }
    else if (next) { nx.innerHTML = `Anstieg in ${fmtKm(next.from - this.d)} km · ${fmtKm(next.len)} km Ø ${fmtNum(next.avg, 1)} %`; nx.hidden = false; }
    else nx.hidden = true;
    // ghost
    let ghostD = null;
    if (this.ghost) {
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
    this._others(ghostD);
    drawHudProfile(this.profile, this.track, this.d, ghostD);
    if (this.minimap?.ok && (!this._mapT || performance.now() - this._mapT > 150)) { // ~7 per second is plenty for a map
      this._mapT = performance.now();
      const hex = n => typeof n === 'number' ? '#' + n.toString(16).padStart(6, '0') : null;
      this.minimap.draw(this.d, (this._mapRiders || []).map(r => ({ d: r.d, color: hex(r.color ?? this.player?.riders?.list?.get(r.id)?.color) || (r.ghost ? '#9aa3ad' : '#2f7fd8') })));
    }
  }

  /** training program: target power for now; in ERG mode the trainer holds it */
  _workout(dt = 0.016) {
    if (!this.workout) return;
    const w = this.wNow = workoutAt(this.workout, this.elapsed, this.ftp);
    if (this.erg) this.state.trainer.setPower(w.done ? null : w.target);
        if (w.done && !this.wDone) { this.wDone = true; this._flash?.('Training geschafft!'); this.coach?.say('done', 0); }
    this._coachTick(w, dt);
  }

  /** coach: announces blocks, counts down into hard ones, says when you are too soft */
  _coachTick(w, dt) {
    const c = this.coach; if (!c || w.done) return;
    const hard = s => s && s.pct >= 88, steps = this.workout.steps;
    if (w.i !== this._wi) {
      const first = this._wi === undefined; this._wi = w.i; this._lowT = 0;
      const lbl = w.step.label || '', m = lbl.match(/(\d+)\/(\d+)/);
      if (first) c.say('warm', 0);
      else if (/Sprint/i.test(lbl)) c.say('sprint', 0);
      else if (hard(w.step)) c.say(m && m[1] === m[2] ? 'last' : 'go', 0);
      else if (/Ausfahren/i.test(lbl)) c.say('cool', 0);
      else if (hard(steps[w.i - 1])) c.say('rest', 0);
      const total = steps.reduce((a, x) => a + x.dur, 0); this._half ||= total / 2;
    }
    if (hard(w.next) && !hard(w.step)) {
      if (w.left <= 10.5 && w.left > 9.5) c.say('ten', 3);
      else if (w.left <= 3.4 && w.left > 2.6) c.say('three', 2);
    }
    if (this._half && this.elapsed >= this._half && !this._halfSaid) { this._halfSaid = true; c.say('half', 0); }
    if (hard(w.step) && this.state.trainer.connected) { // with real watts only
      if (this.power < w.target * 0.9) { this._lowT = (this._lowT || 0) + dt; if (this._lowT > 8) { c.say('low', 25); this._lowT = -10; } }
      else if (Math.abs(this.power - w.target) < w.target * 0.05) { this._goodT = (this._goodT || 0) + dt; if (this._goodT > 60) { c.say('good', 90); this._goodT = 0; } }
    }
  }

  _workoutHUD(pShow) {
    const w = this.wNow, q = this.q; if (!this.workout || !w || !q('#hWork')) return;
    if (w.done) { q('#hWStep').textContent = 'Geschafft – frei weiterfahren'; q('#hWT').textContent = '✓'; q('#hWLeft').textContent = ''; q('#hWNext').textContent = ''; }
    else {
      q('#hWStep').textContent = w.step.label || 'Block';
      q('#hWT').textContent = w.target;
      q('#hWLeft').textContent = fmtTime(Math.ceil(w.left));
      q('#hWNext').textContent = w.next ? `Danach: ${w.next.label || 'Block'} · ${w.nextTarget} W` : 'Letzter Block';
      const pw = q('.metric.power'); pw.classList.remove('z-lo', 'z-ok', 'z-hi');
      pw.classList.add(pShow < w.target * 0.95 ? 'z-lo' : pShow > w.target * 1.05 ? 'z-hi' : 'z-ok');
    }
    if (!this._wT || this.elapsed - this._wT > 2) { this._wT = this.elapsed; q('#hWChart').innerHTML = workoutSVG(this.workout, this.elapsed); }
  }

  /** group ride and ghost: riders in the 3D world, gaps in the group chip */
  _others(ghostD) {
    const list = [];
    const look = this.state.settings.look || null;
    if ((this.state.settings.view3d || 0) === 1) list.push({ id: 'me', self: true, d: this.d, v: this.paused ? 0 : this.v, look });
    if (this.ghost && ghostD != null) list.push({ id: 'ghost', ghost: true, look: this.ghost.look || look, name: this.ghostName || (this.state.settings.ghost === 'last' ? 'Letzte Fahrt' : 'Bestzeit'), d: ghostD + (this.ghost.startD || 0), v: this.v, color: 0x9aa3ad });
    if (this.group) {
      this.group.update({ look, d: this.d, v: this.v, w: this.power, hr: this.hr, riding: !this.paused, done: this.finished });
      const os = this.group.others();
      const vc = this.group.voice?.on ? this.group.voice : null;
      for (const r of os) list.push({ id: r.id, name: r.name, d: r.d, v: r.riding ? r.v : 0, look: r.look, speaking: !!vc?.isSpeaking(r.pid) });
      const gl = this.q?.('#hGroup .glist');
      if (gl) gl.innerHTML = os.length ? os.sort((a, b) => b.d - a.d).slice(0, 5).map(r => {
        const gap = r.d - this.d, txt = r.done ? 'im Ziel' : (gap >= 0 ? '+' : '−') + (Math.abs(gap) >= 1000 ? fmtKm(Math.abs(gap)) + ' km' : Math.round(Math.abs(gap)) + ' m');
        return `<div class="grow ${gap >= 0 ? 'behind' : 'ahead'}${vc?.isSpeaking(r.pid) ? ' speaking' : ''}"><span>${vc?.isSpeaking(r.pid) ? `<i class="spk">${SPK_SVG}</i>` : ''}${esc(r.name)}</span><b class="num">${txt}</b><i class="num">${r.w} W</i></div>`;
      }).join('') : '<div class="grow"><span>Noch niemand da</span></div>';
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
    vb.addEventListener('click', async () => {
      const x = v();
      if (!x) { const n = await import('./share.js').then(m => m.voiceToggle(this.group)); if (n) this._flash(n.hasMic ? (n.ptt ? 'Sprachchat an · T halten zum Sprechen' : 'Sprachchat an · T = stumm') : 'Sprachchat an · nur zuhören'); }
      else if (!x.ptt && x.hasMic) { x.toggleMute(); this._flash(x.muted ? 'Mikro stumm' : 'Mikro an'); }
    });
    const hold = on => e => { const x = v(); if (x?.ptt) { e.preventDefault(); x.talk(on); } };
    vb.addEventListener('pointerdown', hold(true)); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) vb.addEventListener(ev, hold(false));
    this._voiceUI = () => {
      const x = v();
      vb.classList.toggle('on', !!x); vb.classList.toggle('muted', !!x && !x.live && !x.ptt); vb.classList.toggle('speaking', !!x?.speaking);
      vb.querySelector('.label').textContent = !x ? 'Sprachchat' : !x.hasMic ? 'Nur hören' : x.ptt ? (x.talking ? 'Du sprichst' : 'T halten') : x.muted ? 'Stumm (T)' : 'Mikro an';
      vb.title = x ? voiceStatus(x) : 'Sprachchat an: ihr hört euch gegenseitig';
    };
    window.addEventListener('rf-voicechange', this._voiceUI); this._voiceUI();
  }

  _key(e) {
    if (!this.running && !e.key.startsWith('Arrow')) return; // still loading / counting down: only the power keys
    if (e.key === 'ArrowUp') { this.manualPower = Math.min(1500, this.manualPower + (e.shiftKey ? 50 : 10)); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { this.manualPower = Math.max(0, this.manualPower - (e.shiftKey ? 50 : 10)); e.preventDefault(); }
    else if (e.key === 'q' || e.key === ',' || e.key === '-') this.shift(-1);
    else if (e.key === 'e' || e.key === '.' || e.key === '+') this.shift(1);
    else if (e.key === ' ') { e.preventDefault(); this.paused ? this._resume() : this._pause(); }
    else if (e.key === 'Escape') { if (!this.paused && !this.finished) this._pause(); }
    else if (e.key === 'f') document.documentElement.requestFullscreen?.();
    else if (e.key === 'v' || e.key === 'c') this._cycleView();
    else if (e.key === '[' || e.key === ']') this._lens(e.key === ']' ? 1 : -1);
    else if (e.key === 'h') this._toggleBar();
    else if (e.key === 'm') this._toggleMusic();
    else if (e.key === 'i') this._cycleHud();
    else if (e.key === 'n') { this.music?.skip(); setTimeout(() => this._flash('♫ ' + (this.music?.title() || '')), 300); }
  }
  _toggleBar() { // handlebar and forearms in the rider's view on/off
    if (!this.player.setCockpit) return;
    const s = this.state.settings; s.cockpit = s.cockpit === false; this.player.setCockpit(s.cockpit);
    this._flash(s.cockpit ? 'Lenker eingeblendet' : 'Nur Sicht, ohne Lenker'); import('./app.js').then(m => m.saveSettings());
  }

  _cycleView() {
    if (!this.player.setView) return;
    const s = this.state.settings; s.view3d = ((s.view3d || 0) + 1) % 3; this.player.setView(s.view3d);
    this._flash(['Fahrersicht', 'Verfolger', 'Rückblick'][s.view3d]); import('./app.js').then(m => m.saveSettings());
  }
  _lens(dir, wrap = false) { // [ wider, ] narrower (5° steps); the HUD button steps wider and wraps back to normal
    if (!this.player.setFov) return;
    const s = this.state.settings, cur = fovOf(s), STEPS = [45, FOV_DEFAULT, 80, 95, FOV_MAX];
    const f = wrap ? (STEPS.find(x => x > cur + 1) ?? STEPS[0]) : cur - dir * 5; // button: 45 → 62 → 80 → 95 → 110 → 45
    s.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, f)); s.lensMm = 0; this.player.setFov(s.fov);
    this._flash(`Sichtfeld ${s.fov}°`); import('./app.js').then(m => m.saveSettings());
  }
  _setHud(h) {
    this.state.settings.hud = h; applyHud(this.el, hudPrefs(this.state.settings));
    import('./app.js').then(m => m.saveSettings());
    const box = this.el.querySelector('.hudpanel'); if (box) box.querySelector('.hudbody').innerHTML = hudControlsHTML(hudPrefs(this.state.settings));
  }
  _cycleHud() {
    const cur = hudPrefs(this.state.settings).preset, i = HUD_ORDER.indexOf(cur), next = HUD_ORDER[(i + 1) % HUD_ORDER.length];
    this._setHud({ ...(this.state.settings.hud || {}), preset: next }); this._flash('Anzeige: ' + HUD_PRESETS[next].name + ' (Taste I)');
  }
  _hudPanel() {
    let box = this.el.querySelector('.hudpanel'); if (box) { box.remove(); return; }
    box = document.createElement('div'); box.className = 'hudpanel glass';
    box.innerHTML = `<div class="label">Was willst du sehen?</div><div class="hudbody">${hudControlsHTML(hudPrefs(this.state.settings))}</div><button class="btn ghost small hudclose">Fertig</button>`;
    this.el.append(box);
    box.querySelector('.hudclose').onclick = () => box.remove();
    wireHudControls(box, () => this.state.settings, h => this._setHud(h));
  }
  _toggleMusic() {
    const s = this.state.settings, m = this.music; if (!m) return;
    if (!m.available) return this._flash('Keine Musik gefunden (assets/audio)');
    s.musicVol = m.on ? 0 : (s.musicVolOn || 0.45); if (m.on) s.musicVolOn = m.vol;
    m.setVolume(s.musicVol); this._flash(m.on ? '♫ ' + m.title() : 'Musik aus'); import('./app.js').then(x => x.saveSettings());
  }
  _flash(text) {
    let f = this.q('#hFlash'); if (!f) { f = document.createElement('div'); f.id = 'hFlash'; f.className = 'flash glass'; this.el.append(f); }
    f.textContent = text; f.classList.add('on'); clearTimeout(this._flashT); this._flashT = setTimeout(() => f.classList.remove('on'), 1600);
  }

  _pause() {
    if (this.finished) return;
    this.paused = true; this.player.pause(); this.music?.pause();
    const o = document.createElement('div'); o.className = 'paused'; o.id = 'pauseOverlay';
    o.innerHTML = `<div class="box"><div class="label">${fmtKm(this.d)} km · ${fmtTime(this.elapsed)}</div><h2 class="display">Pause</h2>
      <div class="row-actions"><button class="btn" id="pResume">Weiterfahren</button><button class="btn ghost" id="pSave">Beenden &amp; speichern</button><button class="btn ghost" id="pDiscard">Verwerfen</button>${this.group?.voice?.on ? '<button class="btn ghost" id="pVoice">Sprachchat aus</button>' : ''}</div></div>`;
    this.el.append(o);
    o.querySelector('#pResume').onclick = () => this._resume();
    o.querySelector('#pSave').onclick = () => this._end(true);
    o.querySelector('#pDiscard').onclick = () => this._end(false);
    o.querySelector('#pVoice')?.addEventListener('click', e => { this.group.voice?.stop(); this.group.voice = null; e.target.remove(); this._flash('Sprachchat aus'); });
  }
  _resume() { this.music?.resume(); this.paused = false; this.q('#pauseOverlay')?.remove(); this.last = performance.now(); }

  _rideRecord(complete) {
    const pw = this.samples.map(s => s[2]);
    return {
      id: uid(), routeId: this.route.id, date: Date.now(), complete,
      duration: Math.round(this.elapsed), distance: Math.round(this.d - this.startD), gain: Math.round(this.gainAcc), startD: Math.round(this.startD), workout: this.workout?.name || undefined,
      avgPower: pw.length ? Math.round(pw.reduce((a, b) => a + b, 0) / pw.length) : 0,
      maxPower: Math.max(0, ...pw), best5: bestAvg(pw, 300), best20: bestAvg(pw, 1200),
      samples: this.samples,
    };
  }

  async _finish() {
    this.finished = true; this.player.pause();
    const full = this.startD < 50; // only a ride from the start line is a time on this route
    const rec = this._rideRecord(full);
    const prev = (await db.ridesFor(this.route.id)).filter(r => r.complete).sort((a, b) => a.duration - b.duration);
    await db.put('rides', rec);
    this._summary(rec, full ? prev : null, full ? '' : 'Ab km ' + fmtKm(this.startD) + ' gestartet, zählt nicht als Bestzeit');
  }

  /** End screen; prev = completed rides to rank against (null: not ranked, note says why). */
  _summary(rec, prev, note) {
    const pb = prev && (!prev.length || rec.duration < prev[0].duration);
    const rank = prev ? prev.filter(r => r.duration < rec.duration).length + 1 : 0;
    const delta = prev?.length ? rec.duration - prev[0].duration : 0;
    const o = document.createElement('div'); o.className = 'finish';
    o.innerHTML = `<div class="box">
      ${!prev ? `<div class="label">${fmtKm(rec.distance)} km gefahren</div>` : pb ? '<div class="pbflag">Neue Bestzeit</div>' : `<div class="label">Platz ${rank} von ${prev.length + 1}</div>`}
      <h2 class="display">${fmtTime(rec.duration)}</h2>
      <div class="label" style="margin-top:14px">${esc(this.route.name)} · ${!prev ? esc(note) : prev.length ? (delta <= 0 ? `${fmtTime(-delta)} schneller als deine alte Bestzeit` : `${fmtTime(delta)} hinter deiner Bestzeit`) : 'Erste Fahrt auf dieser Strecke'}</div>
      <div class="bigstats" style="grid-template-columns:repeat(5,1fr)">
        <div><div class="label">Ø Leistung</div><div class="v">${rec.avgPower}<small>W</small></div></div>
        <div><div class="label">Max</div><div class="v">${rec.maxPower}<small>W</small></div></div>
        <div><div class="label">Ø Tempo</div><div class="v">${fmtNum(rec.distance / Math.max(1, rec.duration) * 3.6, 1)}<small>km/h</small></div></div>
        <div><div class="label">Höhenmeter</div><div class="v">${fmtNum(rec.gain)}<small>hm</small></div></div>
        <div><div class="label">Arbeit</div><div class="v">${fmtNum(rec.avgPower * rec.duration / 1000)}<small>kJ</small></div></div>
      </div>
      <div class="row-actions"><button class="btn ghost" id="fStrava">Für Strava speichern</button><button class="btn" id="fDone">Fertig</button></div></div>`;
    this.el.append(o);
    o.querySelector('#fDone').onclick = () => this._close(true);
    o.querySelector('#fStrava').onclick = () => stravaExport(rec, this.route.name, d => eleAt(this.track, d));
  }

  async _end(save) {
    if (!save) return this._close(false);
    if (this.elapsed <= 30) { import('./app.js').then(m => m.toast('Unter 30 Sekunden, nicht gespeichert', 3500)); return this._close(false); }
    const rec = this._rideRecord(false); await db.put('rides', rec);
    this.finished = true; this.q('#pauseOverlay')?.remove();
    this._summary(rec, null, 'Vorzeitig beendet, gespeichert');
  }

  _close(saved) {
    this.running = false; this.ue?.close(); this.state.trainer.setPower?.(null); this.music?.destroy();
    if (this.group?.voice) { this.group.voice.stop(); this.group.voice = null; } // ride over: microphone off, indicator off
    if (this._voiceUI) window.removeEventListener('rf-voicechange', this._voiceUI);
    document.removeEventListener('keydown', this._key);
    this.player.destroy?.();
    this.wake?.release?.();
    if (document.fullscreenElement) document.exitFullscreen?.();
    this.el.remove();
    this.onExit?.(saved);
  }
}
