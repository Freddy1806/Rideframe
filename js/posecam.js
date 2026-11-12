// Riding posture by webcam (Freddy, plan package 8: "Haltungs-Erkennung per Kamera, aufrecht oder Aero"). The camera
// in front of the bike (laptop / tablet on the bars) sees the rider head-on: in the aero tuck the head drops towards
// the shoulder line, out of the saddle it rises. MediaPipe's pose model runs locally in the browser, ~8 times a
// second; no picture ever leaves the computer. Off by default (setting "Haltung per Kamera").
// Model + wasm: vendor/mediapipe/ when the host has them (Mac mini), else the public CDNs.
const LOCAL = new URL('../vendor/mediapipe/', import.meta.url).href;
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const exists = async u => { try { return (await fetch(u, { method: 'HEAD' })).ok; } catch { return false; } };

/** drag factor per posture (CdA): tuck ~16 % less, standing ~12 % more */
export const POSTURE_K = { aero: 0.84, upright: 1, standing: 1.12, unknown: 1 };
export const POSTURE_NAME = { aero: 'Aero-Haltung', upright: 'Aufrecht', standing: 'Wiegetritt', unknown: '' };

export function poseCamSupported() { return !!navigator.mediaDevices?.getUserMedia; }

export class PoseCam {
  constructor(calib = null) { this.calib = calib; this.state = 'off'; this.posture = 'unknown'; this.head = null; this._t = 0; this.miss = 0; }
  async start() {
    if (this.state !== 'off') return;
    this.state = 'loading';
    try {
      const vision = await import('../vendor/mediapipe/vision_bundle.js');
      const wasm = await exists(LOCAL + 'wasm/vision_wasm_internal.wasm') ? LOCAL + 'wasm' : WASM_CDN;
      const model = await exists(LOCAL + 'pose_landmarker_lite.task') ? LOCAL + 'pose_landmarker_lite.task' : MODEL_CDN;
      const fs = await vision.FilesetResolver.forVisionTasks(wasm);
      const make = delegate => vision.PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO', numPoses: 1 });
      this.lm = await make('GPU').catch(() => make('CPU')); // GPU where WebGL2 allows, else the CPU (still ~8 Hz with the lite model)
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
      const v = this.video = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = this.stream; await v.play();
      this.state = 'on';
    } catch (e) { this.stop(); this.state = 'error'; this.error = e?.message || String(e); throw e; }
  }
  /** call every frame; samples ~8x per second. Returns 'aero' | 'upright' | 'standing' | 'unknown'. */
  tick(now = performance.now()) {
    if (this.state !== 'on' || now - this._t < 125 || this.video.readyState < 2) return this.posture;
    this._t = now;
    let p; try { p = this.lm.detectForVideo(this.video, now).landmarks?.[0]; } catch { p = null; }
    if (!p) { if (++this.miss > 16) this.posture = 'unknown'; return this.posture; }
    this.miss = 0;
    const nose = p[0], ls = p[11], rs = p[12], sw = Math.hypot(ls.x - rs.x, ls.y - rs.y) || 0.2;
    const rel = ((ls.y + rs.y) / 2 - nose.y) / sw; // head height above the shoulders, in shoulder widths (size-independent)
    this.head = this.head == null ? nose.y : this.head + (nose.y - this.head) * 0.35; // nose height in the picture, smoothed
    this.rel = this.rel == null ? rel : this.rel + (rel - this.rel) * 0.35;
    const c = this.calib;
    if (c?.up != null && c?.aero != null && Math.abs(c.aero - c.up) > 0.03) { // calibrated: between the two recorded head heights
      const mid = (c.up + c.aero) / 2;
      const sg = Math.sign(c.aero - c.up); // aero = nose lower in the picture (normally aero > up; a mirrored set-up still works)
      this.posture = (this.head - mid) * sg > 0 ? 'aero' : (this.head - (c.up - (c.aero - c.up) * 0.7)) * sg < 0 ? 'standing' : 'upright';
    } else this.posture = this.rel < 0.38 ? 'aero' : 'upright'; // uncalibrated: head down near the shoulder line
    return this.posture;
  }
  /** record the head height of one posture for ms milliseconds ('up' or 'aero'); returns the calibration */
  async calibrate(which, ms = 2500) {
    if (this.state !== 'on') await this.start();
    const vals = [], t0 = performance.now();
    await new Promise(res => { const step = () => { this.tick(); if (this.head != null && this.miss === 0) vals.push(this.head);
      performance.now() - t0 < ms ? requestAnimationFrame(step) : res(); }; step(); });
    if (vals.length < 4) throw new Error('Kein Körper im Bild');
    vals.sort((a, b) => a - b);
    this.calib = { ...(this.calib || {}), [which]: vals[Math.floor(vals.length / 2)] };
    return this.calib;
  }
  stop() {
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    try { this.lm?.close(); } catch { /* closed */ } this.lm = null; this.video = null;
    if (this.state !== 'error') this.state = 'off';
  }
}
