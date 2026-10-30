// Built-in demo route: a synthetic alpine climb rendered live (no footage needed).
// Lets you try the app and test the trainer without uploading a video.
import { STEP, finishTrack, eleAt, distAtTime } from './track.js';
import { defaultParams, powerFor } from './physics.js';

function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

export function makeDemoTrack() {
  const length = 12400;
  const n = Math.floor(length / STEP) + 1;
  const alt = [], lat = [], lon = [], time = [], heading = [];
  // elevation: valley run-in, long climb with steep ramps, short descent, final kick
  const prof = d => {
    const k = d / 1000;
    let e = 820;
    e += k < 1.5 ? k * 15 : 22 + (Math.min(k, 9.2) - 1.5) * 68;          // ~6.8 % average climb
    e += 18 * Math.sin(k * 1.9) + 9 * Math.sin(k * 4.3 + 1);                 // ramps
    if (k > 9.2) e -= (Math.min(k, 10.8) - 9.2) * 45;                        // descent
    if (k > 10.8) e += (k - 10.8) * 85;                                      // last kick
    return e;
  };
  const r = rng(7);
  let h = 0.3, la = 46.53, lo = 10.45;
  let curve = 0, segLeft = 0;
  for (let i = 0; i < n; i++) {
    if (segLeft <= 0) { segLeft = 6 + Math.floor(r() * 18); const hair = r() < 0.18 && i > 150; curve = hair ? (r() < .5 ? -1 : 1) * (0.12 + r() * 0.08) : (r() - .5) * 0.05; if (hair) segLeft = 8; }
    segLeft--; h += curve;
    heading.push(curve);
    lat.push(la); lon.push(lo);
    la += Math.cos(h) * STEP / 111320; lo += Math.sin(h) * STEP / (111320 * Math.cos(la * Math.PI / 180));
    alt.push(prof(i * STEP));
  }
  const tmp = finishTrack({ length: (n - 1) * STEP, time: alt.map((_, i) => i), lat, lon, altRaw: alt, eleSource: 'dem' });
  // "recorded" by a rider holding ~250 W -> realistic footage speed
  const p = defaultParams({ riderKg: 72, bikeKg: 8 });
  let t = 0;
  for (let i = 0; i < n; i++) {
    time.push(t);
    const g = tmp.grade[i];
    let v = 3; // solve powerFor(v) = 250
    for (let k = 0; k < 30; k++) v = Math.max(1.5, v + (250 - powerFor(v, g, p)) / 400);
    if (g < -3) v = Math.min(17, v);
    t += STEP / v;
  }
  return { ...finishTrack({ length: (n - 1) * STEP, time, lat, lon, altRaw: alt, eleSource: 'dem' }), curve: heading };
}

// ---------- Pseudo-3D road renderer ----------
export class DemoScene {
  constructor(canvas, track) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.track = track;
    this.currentTime = 0; this.playbackRate = 1; this.paused = true; this.duration = track.time[track.time.length - 1];
    this.last = performance.now();
    this.trees = []; const r = rng(3);
    this.coast = track.theme === 'coast';
    if (this.coast) {
      for (let i = 0; i < track.ele.length; i++) {
        const low = track.ele[i] < 30, x = r();
        if (low && x < 0.05) this.trees.push({ i, side: -1, off: 5 + r() * 6, s: .9 + r() * .3, kind: 'rorbu', col: r() < .8 ? '#9e2a1e' : '#c9a24a' });
        else if (!low && x < 0.04) this.trees.push({ i, side: r() < .5 ? -1 : 1, off: 3 + r() * 6, s: .8 + r() * .4, kind: r() < .3 ? 'tower' : 'house' });
        else if (x < 0.22) this.trees.push({ i, side: r() < .5 ? -1 : 1, off: 1.6 + r() * 6, s: .5 + r() * .8, kind: 'crag' });
        else if (x < 0.30) this.trees.push({ i, side: 1, off: 1.2, s: 1, kind: 'wall' });
      }
    } else
    for (let i = 0; i < track.ele.length; i++) if (r() < 0.35) this.trees.push({ i, side: r() < .5 ? -1 : 1, off: 1.6 + r() * 3, s: .7 + r() * .8, kind: r() < .25 ? 'rock' : 'tree' });
    this.treeAt = new Map(); this.trees.forEach(t => { if (!this.treeAt.has(t.i)) this.treeAt.set(t.i, []); this.treeAt.get(t.i).push(t); });
    this._loop = this._loop.bind(this); requestAnimationFrame(this._loop);
  }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  destroy() { this.dead = true; }
  _loop(now) {
    if (this.dead) return;
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (!this.paused) this.currentTime = Math.min(this.duration, this.currentTime + dt * this.playbackRate);
    this.draw(); requestAnimationFrame(this._loop);
  }
  draw() {
    const { c, ctx, track } = this;
    const W = this.fixed ? c.width : c.clientWidth * devicePixelRatio, H = this.fixed ? c.height : c.clientHeight * devicePixelRatio;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const d = distAtTime(track, this.currentTime);
    const base = Math.floor(d / STEP), frac = d / STEP - base;
    const curve = track.curve;
    // heading for parallax
    let head = 0; for (let i = 0; i < base; i++) head += curve[i];
    const horizon = H * 0.46;
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    if (this.coast) { sky.addColorStop(0, '#2b3a63'); sky.addColorStop(.55, '#d9826a'); sky.addColorStop(.9, '#ffc58a'); sky.addColorStop(1, '#ffe2b0'); }
    else { sky.addColorStop(0, '#6f9fd6'); sky.addColorStop(.7, '#b9d3ea'); sky.addColorStop(1, '#e9eef0'); }
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, horizon + 4);
    if (this.coast) { // low midnight sun
      const sx = W * (.7 - ((head * .25) % 1 + 1) % 1 * .0), g = ctx.createRadialGradient(sx, horizon - H * .05, 0, sx, horizon - H * .05, H * .35);
      g.addColorStop(0, 'rgba(255,240,200,.95)'); g.addColorStop(.08, 'rgba(255,200,120,.6)'); g.addColorStop(1, 'rgba(255,160,90,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizon + 4);
    }
    // mountains (two parallax layers)
    const mtn = (seed, amp, yb, col, par, snow) => {
      const r = rng(seed); const pts = []; for (let i = 0; i < 24; i++) pts.push(.25 + r() * .75);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
      const shift = (head * par * W) % W;
      for (let x = -W; x <= 2 * W; x += W / 24) {
        const k = Math.floor(((x + shift) / (W / 24)) % 24 + 24) % 24;
        ctx.lineTo(x - shift % (W / 24) + W / 48 * 0, yb - pts[k] * amp);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      if (snow) { ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(0, 0, W, yb - amp * .72); ctx.restore(); }
    };
    if (this.coast) {
      ctx.fillStyle = '#3f7f8c'; ctx.fillRect(0, horizon - 2, W, H * .1); // open sea at the horizon
      mtn(41, H * .34, horizon + 2, '#4a4f66', 0.2, true);
      mtn(17, H * .22, horizon + 4, '#2d3346', 0.45, false);
    } else {
      mtn(11, H * .30, horizon + 6, '#7d8ea3', 0.25, true);
      mtn(5, H * .16, horizon + 8, '#5b7262', 0.5, false);
    }
    // road segments
    const camH = 1.5, roadW = 3.4, depth = 0.9 * W / 2, segLen = STEP, N = 160;
    const camEle = eleAt(track, d) + camH;
    let x = 0, dx = -curve[base] * frac * 18;
    let maxY = H;
    const proj = [];
    for (let n = 0; n < N; n++) {
      const i = Math.min(track.ele.length - 1, base + n);
      const z = Math.max(0.8, (n - frac) * segLen);
      const e = track.ele[i];
      proj.push({ i, z, x, e });
      x += dx; dx += (curve[i] || 0) * 18;
    }
    const P = (p, lateral) => { const s = depth / Math.max(0.5, p.z); return { X: W / 2 + (p.x + lateral) * s, Y: horizon - (p.e - camEle) * s * 1.6, s }; };
    const quads = [];
    for (let n = 0; n < N - 1; n++) {
      const a = proj[n], b = proj[n + 1];
      const pa = P(a, 0), pb = P(b, 0);
      if (pb.Y >= maxY) continue;
      quads.push({ a, b, pa, pb, clip: maxY });
      maxY = pb.Y;
    }
    for (let q = quads.length - 1; q >= 0; q--) {
      const { a, b, pa, pb } = quads[q];
      const stripe = Math.floor(a.i / 2) % 2;
      const fog = Math.min(1, a.z / (N * segLen)) ** 1.4;
      const mix = (c1, c2, f) => c1.map((v, k) => Math.round(v + (c2[k] - v) * f));
      const fogc = this.coast ? [232, 190, 160] : [214, 225, 228];
      const rgb = v => `rgb(${v.join(',')})`;
      ctx.fillStyle = rgb(mix(this.coast ? (stripe ? [86, 112, 70] : [94, 120, 76]) : (stripe ? [92, 128, 70] : [100, 138, 76]), fogc, fog));
      ctx.fillRect(0, pb.Y, W, pa.Y - pb.Y + 1);
      if (this.coast && track.ele[a.i] < 30) { // sea left of the road, sandy edge
        const ea = pa.X - (roadW + 4) * pa.s, eb = pb.X - (roadW + 4) * pb.s;
        ctx.fillStyle = rgb(mix([226, 214, 178], fogc, fog)); ctx.beginPath(); ctx.moveTo(0, pa.Y); ctx.lineTo(ea + 2 * pa.s, pa.Y); ctx.lineTo(eb + 2 * pb.s, pb.Y); ctx.lineTo(0, pb.Y); ctx.fill();
        ctx.fillStyle = rgb(mix(stripe ? [38, 150, 160] : [44, 160, 168], [120, 150, 160], fog)); ctx.beginPath(); ctx.moveTo(0, pa.Y); ctx.lineTo(ea, pa.Y); ctx.lineTo(eb, pb.Y); ctx.lineTo(0, pb.Y); ctx.fill();
      }
      const poly = (w1, w2, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pa.X + w1 * pa.s, pa.Y); ctx.lineTo(pa.X + w2 * pa.s, pa.Y); ctx.lineTo(pb.X + w2 * pb.s, pb.Y); ctx.lineTo(pb.X + w1 * pb.s, pb.Y); ctx.fill(); };
      poly(-roadW - .5, roadW + .5, rgb(mix([180, 176, 166], fogc, fog)));
      poly(-roadW, roadW, rgb(mix(stripe ? [70, 72, 76] : [76, 78, 82], fogc, fog)));
      poly(-roadW + .12, -roadW + .28, rgb(mix([236, 236, 232], fogc, fog)));
      poly(roadW - .28, roadW - .12, rgb(mix([236, 236, 232], fogc, fog)));
      if (a.i % 4 < 2) poly(-.07, .07, rgb(mix([236, 236, 232], fogc, fog)));
    }
    // roadside objects back-to-front
    for (let q = quads.length - 1; q >= 0; q--) {
      const { a, pa } = quads[q];
      const list = this.treeAt.get(a.i); if (!list) continue;
      const fog = Math.min(1, a.z / (N * segLen)) ** 1.4;
      for (const t of list) {
        if (a.z < 14) continue;
        const X = pa.X + t.side * (roadW + t.off) * pa.s, Y = pa.Y, s = pa.s * t.s;
        ctx.globalAlpha = 1 - fog * .8;
        if (t.kind === 'tree') {
          ctx.fillStyle = '#4a3a2c'; ctx.fillRect(X - .12 * s, Y - 1.2 * s, .24 * s, 1.2 * s);
          ctx.fillStyle = '#2f4a2e'; ctx.beginPath(); ctx.moveTo(X, Y - 6 * s); ctx.lineTo(X - 1.3 * s, Y - .8 * s); ctx.lineTo(X + 1.3 * s, Y - .8 * s); ctx.fill();
          ctx.fillStyle = '#3a5a37'; ctx.beginPath(); ctx.moveTo(X, Y - 6 * s); ctx.lineTo(X - .6 * s, Y - 1.5 * s); ctx.lineTo(X + 1.1 * s, Y - 1 * s); ctx.fill();
        } else if (t.kind === 'crag') { // jagged granite
          ctx.fillStyle = '#5d5f63'; ctx.beginPath(); ctx.moveTo(X - 1.1 * s, Y); ctx.lineTo(X - .7 * s, Y - 1.4 * s); ctx.lineTo(X - .2 * s, Y - 1.1 * s); ctx.lineTo(X + .2 * s, Y - 2.3 * s); ctx.lineTo(X + .8 * s, Y - .9 * s); ctx.lineTo(X + 1.2 * s, Y); ctx.fill();
          ctx.fillStyle = '#7b7d80'; ctx.beginPath(); ctx.moveTo(X - .7 * s, Y - 1.4 * s); ctx.lineTo(X + .2 * s, Y - 2.3 * s); ctx.lineTo(X, Y - .6 * s); ctx.fill();
        } else if (t.kind === 'wall') { // dry-stone wall
          ctx.fillStyle = '#77736a'; ctx.fillRect(X, Y - .7 * s, 2.5 * s, .7 * s);
        } else if (t.kind === 'rorbu') { // red fisher cabin on stilts
          ctx.fillStyle = '#3b2b22'; ctx.fillRect(X - 1.4 * s, Y - .8 * s, .15 * s, .8 * s); ctx.fillRect(X + 1.25 * s, Y - .8 * s, .15 * s, .8 * s);
          ctx.fillStyle = t.col; ctx.fillRect(X - 1.5 * s, Y - 2.6 * s, 3 * s, 1.8 * s);
          ctx.fillStyle = '#2a2a2a'; ctx.beginPath(); ctx.moveTo(X - 1.7 * s, Y - 2.6 * s); ctx.lineTo(X, Y - 3.7 * s); ctx.lineTo(X + 1.7 * s, Y - 2.6 * s); ctx.fill();
          ctx.fillStyle = '#f4e6c0'; ctx.fillRect(X - .4 * s, Y - 2.1 * s, .5 * s, .5 * s);
        } else if (t.kind === 'house' || t.kind === 'tower') { // medieval stone house / church tower
          const tw = t.kind === 'tower', w = tw ? 1.3 : 2.6, hh = tw ? 6 : 2.2;
          ctx.fillStyle = '#a89d88'; ctx.fillRect(X - w / 2 * s, Y - hh * s, w * s, hh * s);
          ctx.fillStyle = tw ? '#4b4e57' : '#7a4a32'; ctx.beginPath(); ctx.moveTo(X - (w / 2 + .2) * s, Y - hh * s); ctx.lineTo(X, Y - (hh + (tw ? 2.4 : 1.3)) * s); ctx.lineTo(X + (w / 2 + .2) * s, Y - hh * s); ctx.fill();
          ctx.fillStyle = '#3a3026'; ctx.fillRect(X - .2 * s, Y - .9 * s, .4 * s, .9 * s);
        } else {
          ctx.fillStyle = '#8c8a84'; ctx.beginPath(); ctx.ellipse(X, Y - .4 * s, .9 * s, .55 * s, 0, Math.PI, 0); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
  }
}

/** Still frame of the demo route for the library card. */
export function demoThumb(track, d = 3000) {
  const c = document.createElement('canvas'); c.width = 960; c.height = 540;
  const s = new DemoScene(c, track); s.fixed = true; s.destroy();
  s.currentTime = track.time[Math.round(d / STEP)]; s.draw();
  return c.toDataURL('image/jpeg', 0.85);
}
