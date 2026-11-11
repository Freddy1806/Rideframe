// Voice chat in the group ride: everyone hears everyone (full mesh, up to 5 riders).
// Audio goes directly between the browsers as PeerJS media calls, on the same peers the group ride already uses.
// Each rider shares its peer id (pid) and whether voice is on (vo) in the group state; for every pair the smaller
// pid calls the larger one, so there is exactly one call per pair. Someone who turns voice on later is called
// (or calls) on the next sync, a dropped call is set up again the same way.
// The microphone is asked for only when the rider clicks "Sprachchat an". No mic or not allowed: listen only.
// Echo cancellation, noise suppression and auto gain keep fans and the trainer out. Music ducks while someone speaks.

const MAX_PEERS = 4; // plus yourself = 5
const TALK = 0.02; // RMS above this counts as speaking (fake mic beep ~0.1, room noise after suppression < 0.005)
const HOLD = 350; // ms the speaking flag stays on after the level drops (no flicker between words)

export const MIC_SVG = '<svg class="ico" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
export const SPK_SVG = '<svg class="ico" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>';

const rms = (an, buf) => { an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; return Math.sqrt(s / buf.length); };

export class Voice {
  /** group: Group from group.js; opts: { ptt, volume (0..1), onChange(voice), onMessage(text) } */
  constructor(group, opts = {}) {
    this.group = group; this.ptt = !!opts.ptt; this.volume = opts.volume ?? 1;
    this.onChange = opts.onChange; this.onMessage = opts.onMessage;
    this.on = false; this.muted = false; this.talking = false; this.hasMic = false;
    this.peers = new Map(); // pid -> { call, audio, an, src, stream, level, speakT }
    this.speaking = false; this.level = 0;
    this._onCall = c => this._incoming(c);
    this._kd = e => this._keyDown(e); this._ku = e => this._keyUp(e);
  }

  /** must be called from a click (Chrome needs a user gesture for the microphone and for playing audio) */
  async start() {
    if (this.on) return this;
    this.on = true;
    this.ctx = new AudioContext(); this.ctx.resume?.();
    this.sink = this.ctx.createGain(); this.sink.gain.value = 0; this.sink.connect(this.ctx.destination); // analysers must be pulled, but nothing is heard through WebAudio
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      this.hasMic = true;
      const s = this.ctx.createMediaStreamSource(this.mic); this.micAn = this.ctx.createAnalyser(); this.micAn.fftSize = 512; s.connect(this.micAn); this.micAn.connect(this.sink);
    } catch (e) {
      this.hasMic = false; this.mic = null;
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
      this.onMessage?.(denied
        ? 'Mikrofon nicht erlaubt. Du hörst die anderen trotzdem. Zum Sprechen: links neben der Adresse das Mikrofon erlauben und den Sprachchat neu einschalten.'
        : 'Kein Mikrofon gefunden. Du hörst die anderen trotzdem.');
    }
    if (!this.on) { this._stopTracks(); return this; } // stopped while the browser was asking
    // without a mic the call still needs an outgoing stream: a silent one
    this.out = this.mic || this.ctx.createMediaStreamDestination().stream;
    this._applyMute();
    this.group.peer?.on('call', this._onCall);
    document.addEventListener('keydown', this._kd); document.addEventListener('keyup', this._ku);
    this.group.setVoice(true);
    this._syncT = setInterval(() => this.sync(), 1000); this.sync();
    this._meterT = setInterval(() => this._meter(), 60);
    this.onChange?.(this);
    return this;
  }

  /** stop everything: mic tracks, calls, audio elements, indicator */
  stop() {
    if (!this.on) return;
    this.on = false;
    clearInterval(this._syncT); clearInterval(this._meterT);
    document.removeEventListener('keydown', this._kd); document.removeEventListener('keyup', this._ku);
    this.group.peer?.off?.('call', this._onCall);
    for (const pid of [...this.peers.keys()]) this._drop(pid);
    this._stopTracks();
    try { this.ctx?.close(); } catch {}
    this.ctx = null; this.micAn = null; this.speaking = false; this.level = 0;
    if (this.group.open) this.group.setVoice(false);
    this.onChange?.(this);
  }

  _stopTracks() { for (const t of this.mic?.getTracks() || []) t.stop(); for (const t of this.out?.getTracks() || []) t.stop(); this.mic = null; this.out = null; }

  // ---- mute and push-to-talk ----------------------------------------------------------------------------
  /** open mic: mute on/off. Push-to-talk: the mic is only open while T or the button is held */
  toggleMute() { if (this.ptt) return; this.muted = !this.muted; this._applyMute(); this.onChange?.(this); }
  setPtt(on) { this.ptt = !!on; this.talking = false; this._applyMute(); this.onChange?.(this); }
  talk(on) { if (!this.ptt) return; this.talking = !!on; this._applyMute(); this.onChange?.(this); }
  get live() { return this.hasMic && (this.ptt ? this.talking : !this.muted); }
  _applyMute() { for (const t of this.mic?.getAudioTracks() || []) t.enabled = this.live; }

  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); for (const p of this.peers.values()) if (p.audio) p.audio.volume = this.volume; }

  _typing(e) { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
  _keyDown(e) {
    if (e.key !== 't' && e.key !== 'T') return; if (this._typing(e) || e.repeat) return;
    if (this.ptt) this.talk(true); else this.toggleMute();
  }
  _keyUp(e) { if ((e.key === 't' || e.key === 'T') && this.ptt && !this._typing(e)) this.talk(false); }

  // ---- mesh ---------------------------------------------------------------------------------------------
  /** who should be connected: riders with voice on, in pid order, at most 4 others */
  _wanted() {
    const me = this.group.me.pid, list = [...this.group.riders.values()].filter(r => r.vo && r.pid && r.pid !== me);
    return new Map(list.sort((a, b) => (a.pid < b.pid ? -1 : 1)).slice(0, MAX_PEERS).map(r => [r.pid, r]));
  }

  sync() {
    if (!this.on || !this.group.peer || !this.group.me.pid) return;
    const want = this._wanted(), me = this.group.me.pid;
    for (const [pid, p] of this.peers) {
      const st = p.call?.peerConnection?.connectionState;
      if (!want.has(pid) || st === 'failed' || st === 'closed' || (!p.stream && performance.now() - p.t0 > 20000)) this._drop(pid);
    }
    for (const pid of want.keys()) {
      if (this.peers.has(pid) || me > pid) continue; // the smaller pid calls
      const call = this.group.peer.call(pid, this.out, { metadata: { rf: 'voice' } });
      if (call) this._wire(pid, call);
    }
  }

  _incoming(call) {
    if (!this.on || call.metadata?.rf !== 'voice') return;
    const pid = call.peer;
    if (this.peers.has(pid)) this._drop(pid); // a fresh call replaces an old one (reconnect)
    if (this.peers.size >= MAX_PEERS) { call.close(); return; }
    call.answer(this.out);
    this._wire(pid, call);
  }

  _wire(pid, call) {
    const p = { call, t0: performance.now(), level: 0, speakT: 0 };
    this.peers.set(pid, p);
    call.on('stream', stream => {
      if (this.peers.get(pid) !== p || p.stream) return;
      p.stream = stream;
      const a = p.audio = new Audio(); a.autoplay = true; a.srcObject = stream; a.volume = this.volume; a.dataset.rfVoice = pid;
      a.play().catch(() => {});
      if (this.ctx) { p.src = this.ctx.createMediaStreamSource(stream); p.an = this.ctx.createAnalyser(); p.an.fftSize = 512; p.src.connect(p.an); p.an.connect(this.sink); }
      this.onChange?.(this);
    });
    const gone = () => { if (this.peers.get(pid) === p) { this._drop(pid); this.onChange?.(this); } };
    call.on('close', gone); call.on('error', gone);
  }

  _drop(pid) {
    const p = this.peers.get(pid); if (!p) return;
    this.peers.delete(pid);
    try { p.call.close(); } catch {}
    if (p.audio) { p.audio.pause(); p.audio.srcObject = null; }
    try { p.src?.disconnect(); p.an?.disconnect(); } catch {}
  }

  // ---- level meter, speaking flags, music ducking -------------------------------------------------------
  _meter() {
    const buf = this._buf ||= new Float32Array(512), now = performance.now();
    let any = false;
    for (const p of this.peers.values()) {
      p.level = p.an ? rms(p.an, buf) : 0;
      if (p.level > TALK) p.speakT = now;
      p.speaking = now - p.speakT < HOLD; any ||= p.speaking;
    }
    this.level = this.micAn && this.live ? rms(this.micAn, buf) : 0;
    if (this.level > TALK) this._mySpeakT = now;
    const me = now - (this._mySpeakT || 0) < HOLD;
    if (any && now - (this._duckT || 0) > 1000) { this._duckT = now; window.dispatchEvent(new Event('rf-voice')); } // music ducks while friends speak
    const sig = [...this.peers.values()].map(p => p.speaking ? 1 : 0).join('') + (me ? 1 : 0);
    this.speaking = me;
    if (sig !== this._sig) { this._sig = sig; this.onChange?.(this); }
  }

  /** speaking flag per pid */
  isSpeaking(pid) { return !!this.peers.get(pid)?.speaking; }
  connected(pid) { return !!this.peers.get(pid)?.stream; }
  /** for tests: {pid: rms} */
  levels() { return Object.fromEntries([...this.peers].map(([k, p]) => [k, Math.round(p.level * 1e4) / 1e4])); }
}

/** German status line for the UI */
export function voiceStatus(v) {
  if (!v?.on) return 'Sprachchat aus';
  const n = [...v.peers.values()].filter(p => p.stream).length;
  const who = n ? `${n} ${n === 1 ? 'Person' : 'Personen'} verbunden` : 'wartet auf die anderen';
  if (!v.hasMic) return 'Nur zuhören · ' + who;
  return (v.ptt ? (v.talking ? 'Du sprichst' : 'T halten zum Sprechen') : v.muted ? 'Stumm (T)' : 'Mikro an (T = stumm)') + ' · ' + who;
}
