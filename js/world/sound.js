// World sound without asset files: every effect is synthesised with Web Audio, voices use the
// browser's speech synthesis (British voices on the Mac). Recorded files from assets/audio/manifest.json
// ("sfx": { name: [files] }, "voices": { text: file }) replace the synthesised version when present.
//   one-shots: fireball, explosion, rumble, crash      loops (call every frame / tick): waterfall, battle, fire
// Distance: every positional sound runs through a lowpass that closes as it gets quieter, so far away sounds
// muffled and dull and up close bright and clear. Moving sources (a villager you ride past, a gull overhead)
// are re-aimed every frame. Ambience loops (wind, surf, birds, rain, market) only play from recordings,
// except wind, which has a synthesised fallback.

const LOOPS = new Set(['waterfall', 'battle', 'fire']);
const SYNTH = new Set(['fireball', 'explosion', 'rumble', 'crash']);
const LEVEL = { waterfall: 0.55, fire: 0.6, battle: 0.7 };
const ALIAS = { waterfall: 'wasserfall' }; // German names of the recorded files
const rnd = (a, b) => a + Math.random() * (b - a);
const clampPan = p => Math.max(-0.9, Math.min(0.9, p || 0));
/** loudness 0..1 -> lowpass cutoff: 18 kHz close, ~1 kHz at the edge of hearing */
export const muffle = v => 1000 * Math.pow(18, Math.max(0, Math.min(1, v)));

export class Sound {
  constructor(manifest = {}) {
    this.m = manifest; this.loops = new Map(); this.last = {}; this.on = true; this.voicesOn = true;
    this.buf = {}; this.files = {}; this.moving = [];
  }
  setManifest(m) { this.m = m || {}; }

  _ctx() {
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { this.on = false; return null; }
      const c = this.ctx;
      // master: a gentle compressor keeps a big explosion from clipping over the music
      this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4;
      this.master = c.createGain(); this.master.gain.value = 0.85; this.master.connect(this.comp).connect(c.destination);
      this.buf.white = this._noise(2, 'white'); this.buf.brown = this._noise(4, 'brown');
      this.buf.crackle = this._crackle(3); this.buf.drums = this._drums(); this.buf.crowd = this._crowd(6);
    }
    if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // ---------------- offline buffers ----------------
  _noise(sec, kind) {
    const c = this.ctx, n = Math.round(c.sampleRate * sec), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let y = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (kind === 'brown') { y = (y + 0.02 * w) / 1.02; d[i] = y * 3.5; } else d[i] = w; }
    return b;
  }
  /** sparse pops with short decays: burning wood */
  _crackle(sec) {
    const c = this.ctx, sr = c.sampleRate, n = Math.round(sr * sec), b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < n; i++) { lp += 0.05 * ((Math.random() * 2 - 1) - lp); d[i] = lp * 0.25; } // soft hiss of the flames
    for (let k = 0; k < sec * 38; k++) {
      const at = Math.floor(Math.random() * (n - sr * 0.02)), a = rnd(0.2, 1) ** 2, len = Math.floor(sr * rnd(0.002, 0.012));
      for (let j = 0; j < len; j++) d[at + j] += (Math.random() * 2 - 1) * a * Math.exp(-j / (len * 0.3));
    }
    return b;
  }
  /** war drums, 4 bars at ~96 bpm: low toms with a skin slap */
  _drums() {
    const c = this.ctx, sr = c.sampleRate, beat = 60 / 96, n = Math.round(sr * beat * 16), b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
    const hits = [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 13, 14, 15];
    for (const h of hits) {
      const at = Math.round(h * beat * sr), big = h % 4 === 0, f0 = big ? 62 : 84, a = big ? 1 : 0.6;
      for (let j = 0; j < sr * 0.7 && at + j < n; j++) {
        const t = j / sr, f = f0 * (1 + 0.6 * Math.exp(-t * 18));
        d[at + j] += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t * (big ? 5 : 8)) + (j < sr * 0.02 ? (Math.random() * 2 - 1) * 0.25 * a * (1 - j / (sr * 0.02)) : 0);
      }
    }
    return b;
  }
  /** a distant army: band-limited noise with slow swells, ends match so it loops */
  _crowd(sec) {
    const c = this.ctx, sr = c.sampleRate, n = Math.round(sr * sec), b = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let l1 = 0, l2 = 0, h = 0;
      const sw = [rnd(0, 6), rnd(0, 6), rnd(0, 6)];
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1; l1 += 0.09 * (w - l1); l2 += 0.09 * (l1 - l2); h = l2; // ~250-700 Hz band
        const t = i / n * 2 * Math.PI, env = 0.55 + 0.2 * Math.sin(3 * t + sw[0]) + 0.15 * Math.sin(7 * t + sw[1]) + 0.1 * Math.sin(13 * t + sw[2]);
        d[i] = h * env * 2.2;
      }
    }
    return b;
  }

  // ---------------- plumbing ----------------
  _out(vol, pan, near = vol) {
    const c = this.ctx, g = c.createGain(), lp = this._filter('lowpass', muffle(near), 0.5), p = c.createStereoPanner();
    g.gain.value = vol; p.pan.value = clampPan(pan); g.connect(lp).connect(p).connect(this.master);
    g.lp = lp; g.p = p; return g;
  }
  _src(buf, loop = false, rate = 1) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; s.playbackRate.value = rate; return s; }
  _filter(type, f, Q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; }
  _env(g, t0, a, peak, dec) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec); }

  _has(name) { return !!(this.m?.sfx?.[name]?.length || this.m?.sfx?.[ALIAS[name]]?.length); }
  async _file(name) { // recorded replacement, decoded once
    const list = this.m?.sfx?.[name]?.length ? this.m.sfx[name] : this.m?.sfx?.[ALIAS[name]]; if (!list?.length) return null;
    const f = list[Math.floor(Math.random() * list.length)];
    if (!(f in this.files)) { this.files[f] = null; try { this.files[f] = await this.ctx.decodeAudioData(await (await fetch('assets/audio/' + f)).arrayBuffer()); } catch { /* fall back to synthesis */ } }
    return this.files[f];
  }

  // ---------------- public ----------------
  /** one-shot or loop level; vol 0..1 (already scaled by distance), pan -1..1 */
  sfx(name, vol = 1, pan = 0) {
    if (!this.on || this.paused || !(vol > 0.003)) { if (LOOPS.has(name)) this._loop(name, 0, pan); return; }
    if (!this._ctx()) return;
    if (LOOPS.has(name)) return this._loop(name, vol, pan);
    const now = this.ctx.currentTime, gap = { explosion: 0.07, fireball: 0.12, rumble: 1.5, crash: 0.5 }[name] ?? 0.1;
    if (now - (this.last[name] || -9) < gap) return; this.last[name] = now;
    if (this._has(name)) { this._file(name).then(b => b ? this._playBuf(b, vol, pan) : SYNTH.has(name) && this._synth(name, vol, pan)); return; }
    if (SYNTH.has(name)) this._synth(name, vol, pan);
  }
  /** a positional one-shot whose source may move: where() -> { vol, pan } is asked again every frame */
  play3d(name, where, gain = 1) {
    if (!this.on || this.paused || !this._has(name)) return;
    const r = where(); if (!(r.vol * gain > 0.01) || !this._ctx()) return;
    this._file(name).then(b => { if (b && !this.paused) this._playBuf(b, r.vol * gain, r.pan, where, gain); });
  }
  _playBuf(b, vol, pan, where, gain = 1) {
    const s = this._src(b), out = this._out(vol, pan); s.connect(out); s.start();
    if (where) this.moving.push({ out, where, gain, until: this.ctx.currentTime + b.duration + 0.3 });
  }

  _synth(name, vol, pan) {
    const c = this.ctx, t = c.currentTime + 0.01, out = this._out(1, pan, vol);
    const far = 1 - Math.min(1, vol * 1.4); // quiet = far away = duller
    if (name === 'fireball') { // whoosh of a burning ball leaving the trebuchet
      const s = this._src(this.buf.white, true, rnd(0.9, 1.1)), bp = this._filter('bandpass', 400, 1.6), g = c.createGain();
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(1400 - far * 700, t + 0.5); bp.frequency.exponentialRampToValueAtTime(350, t + 1.6);
      this._env(g, t, 0.35, vol * 0.7, 1.3);
      const r = this._src(this.buf.brown, true), lp = this._filter('lowpass', 260), g2 = c.createGain(); this._env(g2, t, 0.25, vol * 0.6, 1.4);
      s.connect(bp).connect(g).connect(out); r.connect(lp).connect(g2).connect(out);
      s.start(t, rnd(0, 1)); s.stop(t + 1.8); r.start(t, rnd(0, 3)); r.stop(t + 1.8);
    } else if (name === 'explosion' || name === 'crash') {
      const big = name === 'crash' ? 1.6 : 1, dur = rnd(1.3, 1.9) * big;
      const s = this._src(this.buf.white, true, rnd(0.8, 1.05)), lp = this._filter('lowpass', 3000 - far * 2200, 0.5), g = c.createGain();
      lp.frequency.exponentialRampToValueAtTime(140, t + dur); this._env(g, t, 0.006, vol * 0.95, dur);
      s.connect(lp).connect(g).connect(out); s.start(t, rnd(0, 1)); s.stop(t + dur + 0.1);
      const o = c.createOscillator(), og = c.createGain(); o.frequency.setValueAtTime(rnd(70, 85) / Math.sqrt(big), t); o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
      this._env(og, t, 0.008, vol * (1.1 - far * 0.3), 0.7 * big); o.connect(og).connect(out); o.start(t); o.stop(t + big);
      const db = this._src(this.buf.crackle, false, rnd(1, 1.4)), hp = this._filter('highpass', 1200), dg = c.createGain(); // falling stones
      dg.gain.setValueAtTime(0.0001, t); dg.gain.linearRampToValueAtTime(vol * (0.9 - far * 0.6), t + 0.15); dg.gain.linearRampToValueAtTime(0.0001, t + 1.4 * big);
      db.connect(hp).connect(dg).connect(out); db.start(t + 0.08, rnd(0, 1.5)); db.stop(t + 1.5 * big);
    } else if (name === 'rumble') { // the keep comes down: long low roar with tumbling masonry
      const dur = 5.5, s = this._src(this.buf.brown, true), lp = this._filter('lowpass', 220, 0.9), g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * 1.3, t + 0.25); g.gain.setTargetAtTime(vol * 0.7, t + 0.6, 1); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 7; lg.gain.value = vol * 0.35; lfo.connect(lg).connect(g.gain);
      s.connect(lp).connect(g).connect(out); s.start(t, rnd(0, 3)); s.stop(t + dur); lfo.start(t); lfo.stop(t + dur);
      for (let k = 0; k < 7; k++) { const dt = rnd(0.1, 3.5); this._hit(t + dt, vol * rnd(0.4, 0.8) * (1 - dt / 5), out); }
    }
  }
  _hit(t, v, out) { // one heavy block landing
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(rnd(55, 90), t); o.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    this._env(g, t, 0.005, v, 0.45); o.connect(g).connect(out); o.start(t); o.stop(t + 0.5);
    const s = this._src(this.buf.white, true), bp = this._filter('bandpass', rnd(500, 1200), 1), g2 = c.createGain(); this._env(g2, t, 0.004, v * 0.5, 0.25);
    s.connect(bp).connect(g2).connect(out); s.start(t, rnd(0, 1.5)); s.stop(t + 0.3);
  }

  _loop(name, vol, pan, near = vol) {
    let L = this.loops.get(name);
    if (!L) {
      if (!(vol > 0.003) || !(LOOPS.has(name) || name === 'wind' || this._has(name)) || !this._ctx()) return;
      const c = this.ctx; L = { g: c.createGain(), lp: this._filter('lowpass', muffle(near), 0.5), p: c.createStereoPanner(), srcs: [] };
      L.g.gain.value = 0; L.g.connect(L.lp).connect(L.p).connect(this.master);
      const add = (buf, ...fx) => { const s = this._src(buf, true); let n = s; for (const f of fx) n = n.connect(f); n.connect(L.g); s.start(0, Math.random() * buf.duration); L.srcs.push(s); };
      if (name === 'waterfall') { add(this.buf.brown, this._filter('lowpass', 900)); const hg = c.createGain(); hg.gain.value = 0.18; add(this.buf.white, this._filter('bandpass', 2400, 0.6), hg); }
      else if (name === 'fire') { add(this.buf.crackle); const rg = c.createGain(); rg.gain.value = 0.5; add(this.buf.brown, this._filter('lowpass', 300), rg); }
      else if (name === 'wind' && !this._has('wind')) { const wg = c.createGain(); wg.gain.value = 0.5; add(this.buf.brown, this._filter('lowpass', 480), wg); const hg = c.createGain(); hg.gain.value = 0.05; add(this.buf.white, this._filter('bandpass', 900, 0.4), hg); }
      else if (name === 'battle') { const dg = c.createGain(); dg.gain.value = 0.8; add(this.buf.drums, this._filter('lowpass', 900), dg); const cg = c.createGain(); cg.gain.value = 0.55; add(this.buf.crowd, cg); }
      this.loops.set(name, L);
      if (this._has(name)) this._file(name).then(b => { if (!b || L.dead) return; for (const s of L.srcs) s.stop(); L.srcs = []; const s = this._src(b, true); s.connect(L.g); s.start(); L.srcs.push(s); });
    }
    const now = this.ctx.currentTime, level = (LEVEL[name] ?? 1) * Math.min(1, vol);
    L.g.gain.setTargetAtTime(level, now, 0.35); L.p.pan.setTargetAtTime(clampPan(pan), now, 0.3);
    L.lp.frequency.setTargetAtTime(muffle(near), now, 0.3);
    L.seen = now;
  }
  /** background bed (wind, surf, birds, rain, market): not positional, level 0..1, set every frame */
  ambient(name, level) {
    if (!this.on || this.paused) return;
    if (level > 0.003 || this.loops.has(name)) this._loop(name, level, 0, 1);
  }
  /** call once per frame: moving sources are re-aimed, loops nobody asked for lately fade out and are freed */
  tick() {
    if (!this.ctx) return; const now = this.ctx.currentTime;
    this.moving = this.moving.filter(m => {
      if (now > m.until) return false;
      const r = m.where(); m.out.gain.setTargetAtTime(Math.max(0, r.vol) * m.gain, now, 0.08);
      m.out.lp.frequency.setTargetAtTime(muffle(r.vol), now, 0.1); m.out.p.pan.setTargetAtTime(clampPan(r.pan), now, 0.1);
      return true;
    });
    for (const [k, L] of this.loops) {
      if (now - L.seen > 0.7) L.g.gain.setTargetAtTime(0, now, 0.4);
      if (now - L.seen > 4) { L.dead = true; for (const s of L.srcs) try { s.stop(); } catch { /* already stopped */ } L.g.disconnect(); this.loops.delete(k); }
    }
  }

  /** a spoken line; style: 'shout' (battle cry) or 'call' (villager) */
  speak(text, vol = 1, style = 'call', seed = 0, where = null) {
    if (!this.on || !this.voicesOn || this.paused || !text || !(vol > 0.05)) return;
    const file = this.m?.voices?.[text];
    if (file) this.voiceFile(file, where || (() => ({ vol, pan: 0 }))); // ElevenLabs recordings only: no computer voice, ever
  }
  /** a recorded line from a speaker in the world: where() -> { vol, pan } follows them as you ride past */
  voiceFile(file, where0) {
    if (!this.on || !this.voicesOn || this.paused || !file || !this._ctx()) return;
    const where = () => { const r = where0(); return { vol: r.vol > 0 ? Math.min(1.8, Math.pow(r.vol, 0.6) * 2.4) : 0, pan: r.pan }; }; // voices clearly louder than the world
    const r = where(); if (!(r.vol > 0.03)) return;
    window.dispatchEvent(new Event('rf-voice')); // music ducks
    const f = 'assets/audio/' + file;
    (this.files[f] ? Promise.resolve(this.files[f]) : fetch(f).then(x => x.arrayBuffer()).then(a => this.ctx.decodeAudioData(a)).then(b => (this.files[f] = b)))
      .then(b => { if (!this.paused) this._playBuf(b, r.vol, r.pan, where); }).catch(() => {});
  }

  pause() { this.paused = true; this.ctx?.suspend().catch(() => {}); }
  resume() { this.paused = false; this.ctx?.resume().catch(() => {}); }
  destroy() { this.pause(); this.moving = []; for (const L of this.loops.values()) L.dead = true; this.loops.clear(); this.ctx?.close().catch(() => {}); this.ctx = null; }
}
