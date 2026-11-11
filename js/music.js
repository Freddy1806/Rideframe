// Music and coach voice while riding. Files live on the Mac (assets/audio, not in the public repo):
// assets/audio/manifest.json  "music": { "world": [files], "workout": [files], "race": [files] },
//                             "coach": { "go": file, "rest": file, ... }
// Music plays as a playlist for the mood of the ride and ducks while someone speaks. Optional extra moods (same format):
// "rain" (minor, for showers), "hard" (motivation music, only in the hard parts of a workout), "fly" and "hell" (the wizard).
// setMood() crossfades to another mood; a mood without files keeps what is playing.
let manifest;
export async function audioManifest() {
  manifest ||= fetch('assets/audio/manifest.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  return manifest;
}

export class Music {
  constructor(mood = 'world', vol = 0.5) {
    this.mood = mood; this.vol = vol; this.on = vol > 0; this.duckK = 1;
    this.a = new Audio(); this.a.preload = 'auto';
    this.a.addEventListener('ended', () => this._next());
    this._duck = () => { this.duckK = 0.35; clearTimeout(this._dt); this._dt = setTimeout(() => { this.duckK = 1; this._apply(); }, 2600); this._apply(); };
    window.addEventListener('rf-voice', this._duck);
    this.bandK = 1; this._band = e => { this.bandK = 1 - 0.9 * Math.min(1, e.detail * 1.6); this._apply(); }; window.addEventListener('rf-band', this._band);
    this.base = mood; this.fadeK = 1;
    audioManifest().then(m => { const M = this.M = m.music || {}; this.list = [...(M[mood] || []), ...(M[mood]?.length ? [] : M.world || [])].sort(() => Math.random() - 0.5); this.i = -1; if (this.on && !this.paused) this._next(); });
  }
  get available() { return !!this.list?.length; }
  _apply() { this.a.volume = Math.max(0, Math.min(1, this.vol * this.duckK * (this.bandK ?? 1) * (this.fadeK ?? 1))); }
  /** switch the playlist to another mood with a 2 s crossfade (fade out, new track, fade in); unknown or empty moods fall back to the ride's own */
  setMood(mood) {
    if (!this.M) return; if (!this.M[mood]?.length) mood = this.base;
    if (mood === this.mood) return; this.mood = mood;
    const list = [...(this.M[mood]?.length ? this.M[mood] : this.M.world || [])].sort(() => Math.random() - 0.5);
    clearInterval(this._fi); let k = this.fadeK;
    this._fi = setInterval(() => { k -= 0.05; this.fadeK = Math.max(0, k); this._apply();
      if (k <= 0) { clearInterval(this._fi); this.list = list; this.i = -1; if (this.on && !this.paused) this._next();
        this._fi = setInterval(() => { this.fadeK = Math.min(1, this.fadeK + 0.05); this._apply(); if (this.fadeK >= 1) clearInterval(this._fi); }, 100); } }, 100);
  }
  _next() {
    if (!this.list?.length) return;
    this.i = (this.i + 1) % this.list.length;
    this.a.src = 'assets/audio/' + this.list[this.i]; this._apply();
    this.a.play().catch(() => {});
  }
  title() { return this.list?.length ? this.list[this.i]?.split('/').pop().replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : ''; }
  skip() { this._next(); }
  setVolume(v) { this.vol = v; this.on = v > 0; this._apply(); if (this.on && this.a.paused && !this.paused) (this.a.src ? this.a.play().catch(() => {}) : this._next()); if (!this.on) this.a.pause(); }
  pause() { this.paused = true; this.a.pause(); }
  resume() { this.paused = false; if (this.on) (this.a.src ? this.a.play().catch(() => {}) : this._next()); }
  destroy() { clearInterval(this._fi); window.removeEventListener('rf-voice', this._duck); window.removeEventListener('rf-band', this._band); this.a.pause(); this.a.src = ''; }
}

/** short German coach lines for training programs (only recorded files, no computer voice) */
export class Coach {
  constructor(vol = 0.9) { this.vol = vol; this.last = 0; audioManifest().then(m => { this.lines = m.coach || {}; }); }
  say(key, minGap = 4) {
    const f = this.lines?.[key]; if (!f || this.vol <= 0) return;
    const now = performance.now(); if (now - this.last < minGap * 1000) return; this.last = now;
    const a = new Audio('assets/audio/' + f); a.volume = this.vol; a.play().catch(() => {});
    window.dispatchEvent(new Event('rf-voice'));
  }
}
