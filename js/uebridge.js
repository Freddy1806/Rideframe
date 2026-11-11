// Sends the live ride to the Unreal view (via tools/ue-relay.mjs on ws://localhost:8790), 10 times a second.
// Unreal builds its road from the same track file, so it only needs the distance: heights can never disagree.
//   {type:'hello', version, route, length, ascent, hash, profile:{step:10, ele:[m...]}}   once per connection;
//     profile = the height the trainer uses every 10 m, so Unreal can check its road and warn instead of showing wrong heights
//     version = version.json of this game; the Unreal view has the same file and warns when they differ
//   Unreal -> browser: {type:'ue_hello', version} when it connects, then {type:'ue_alive'} every ~2 s.
//     While Unreal is alive the browser stops drawing its own 3D world (both at once halve Unreal's fps).
//   {type:'weather', preset}   after each hello and on change; preset = auto|clear|fog|rain|storm|clearing|dramatic
//   ride also carries fov (vertical degrees) and riders:[{id, name, d, v, ghost}] = friends and ghost to draw alongside
//   {type:'ride', d, v, grade, watt, hr, cad, paused, t}   every 100 ms
export class UEBridge {
  constructor(route, track, url = 'ws://localhost:8790') {
    this.route = route; this.length = track.length; this.url = url; this.ascent = track.gain;
    const k = Math.max(1, Math.round(10 / (track.step || 1))); this.profile = { step: k * (track.step || 1), ele: (track.ele || []).filter((_, i) => i % k === 0) };
    let h = 2166136261; for (const v of this.profile.ele) { h ^= Math.round(v * 10); h = Math.imul(h, 16777619); } this.hash = (h >>> 0).toString(16); // FNV-1a over decimetres
    this.version = '?'; this.weather = 'auto'; this.last = 0; this.dead = false;
    // wait for the version so the hello never says '?' to Unreal
    gameVersion().then(v => { this.version = v; this._open(); });
  }
  _open() {
    if (this.dead) return;
    try { this.ws = new WebSocket(this.url); } catch { return this._retry(); }
    this.ws.onopen = () => this._hello();
    this.ws.onmessage = e => {
      let j; try { j = JSON.parse(e.data); } catch { return; }
      if (!String(j?.type).startsWith('ue_')) return;
      this.ueSeen = performance.now();
      if (j.type === 'ue_hello') { this.ueVersion = j.version || '?'; this._hello(); } // Unreal started after us: it missed the first hello
    };
    this.ws.onclose = () => this._retry(); this.ws.onerror = () => {};
  }
  _hello() { this._send({ type: 'hello', version: this.version, route: this.route, length: this.length, ascent: this.ascent, hash: this.hash, profile: this.profile }); this._send({ type: 'weather', preset: this.weather }); }
  setWeather(preset = 'auto') { this.weather = preset; this._send({ type: 'weather', preset }); }
  /** true while the Unreal view is connected and talking (last sign of life < 5 s ago) */
  get unreal() { return this.connected && performance.now() - (this.ueSeen || -1e9) < 5000; }
  get mismatch() { return this.unreal && this.ueVersion && this.ueVersion !== '?' && this.version !== '?' && this.ueVersion !== this.version; }
  _retry() { if (!this.dead) setTimeout(() => this._open(), 3000); }
  _send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
  get connected() { return this.ws?.readyState === 1; }
  update(now, s) { if (now - this.last < 100) return; this.last = now; this._send({ type: 'ride', ...s }); }
  close() { this.dead = true; try { this.ws?.close(); } catch { /* already closed */ } }
}


let _ver;
// version.json next to index.html; '?' when it cannot be read
export function gameVersion() {
  return _ver ||= fetch(new URL('../version.json', import.meta.url)).then(r => r.json()).then(j => j.version || '?').catch(() => '?');
}
