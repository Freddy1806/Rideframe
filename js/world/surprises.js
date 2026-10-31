// The ride as a roller coaster: never more than about a minute without something happening.
// A director fires one surprise every 45–75 s, whichever fits the spot (sea beside the road, a village, open land),
// plus fireworks over the festival and at the finish. Every surprise starts ahead of the camera and uses the
// Mac's models when present; without a model that surprise is simply skipped.
import * as THREE from 'three';
import { ROAD_W } from './field.js';

const _v = new THREE.Vector3(), _f = new THREE.Vector3();
const layer1 = o => o.traverse(c => c.layers.set(1)); // not in the water reflection: small and fast

export class Surprises {
  constructor(world, assets, events) {
    this.w = world; this.A = assets; this.ev = events; this.f = world.field; this.track = world.track;
    this.next = 35; this.active = []; this.used = new Map();
    const villages = (this.track.segments || []).filter(s => s.village);
    const fest = villages.sort((p, q) => (q.to - q.from) * (q.village[1] - q.village[0]) - (p.to - p.from) * (p.village[1] - p.village[0]))[0];
    this.festD = fest ? fest.from + (fest.to - fest.from) * (fest.village[0] + fest.village[1]) / 2 : -1;
    this.villages = villages;
    this.list = [
      { id: 'knight', need: ['reiter_ritter', 'pferd'], go: () => this._knight() },
      { id: 'kids', need: ['junge', 'maedchen'], village: true, go: () => this._kids() },
      { id: 'sheep', need: ['schaf'], go: () => this._crossing('schaf', 4, 'Baaa!') },
      { id: 'pig', need: ['schwein'], go: () => this._pig() },
      { id: 'ship', need: ['langschiff'], sea: true, go: () => this._ship() },
      { id: 'juggler', need: ['gaukler'], go: () => this._juggler() },
      { id: 'goats', need: ['ziege'], go: () => this._crossing('ziege', 3, 'Meeeh!') },
      { id: 'dog', need: ['hund'], go: () => this._dog() },
    ];
    this.fw = new Fireworks(world.scene);
    this.festFired = false;
  }

  update(_, dt, cam, d) {
    const time = this.clock = (this.clock || 0) + Math.min(dt, 0.1); // own clock: the preview's world time jumps when scrubbing
    const v = Math.max(2, this.w.speed || 6);
    if (time > this.next) {
      const free = this.list.filter(s => s.need.some(n => this.A.find(n)) && (!s.sea || this._seaSide(d + 120)) && (!s.village || this._inVillage(d + 60)))
        .sort((a, b) => (this.used.get(a.id) || 0) - (this.used.get(b.id) || 0) || Math.random() - .5);
      const s = free[0];
      if (s && s.go() !== false) { this.used.set(s.id, time); this.next = time + 45 + Math.random() * 30; }
      else this.next = time + 6; // nothing fits here: look again soon
    }
    for (const e of this.active) e.step(dt, v, cam), e.mixer?.update(Math.min(dt, 0.1));
    for (const e of this.active) if (e.dead) this.w.scene.remove(e.obj);
    this.active = this.active.filter(e => !e.dead);
    // fireworks: over the festival town and for the last few hundred metres
    if (this.festD > 0 && !this.festFired && d > this.festD - 260 && d < this.festD) { this.festFired = true; this._salvo(this.festD + 40, 7); }
    if (this.track.length - d < 450 && time > (this.fwNext || 0)) { this.fwNext = time + 0.7 + Math.random() * 0.8; this._salvo(Math.min(this.track.length - 5, d + 160), 1); }
    this.fw.update(dt);
  }

  // ---- helpers ----
  _pt(d, off) { const p = this.f.at(Math.max(0, Math.min(this.track.length - 1, d))), l = Math.hypot(p.tx, p.tz) || 1;
    const x = p.x - p.tz / l * off, z = p.z + p.tx / l * off; return { x, z, y: this.f.height(x, z), head: Math.atan2(p.tx, p.tz), e: p.e }; }
  _seaSide(d) { for (const s of [-1, 1]) for (const o of [60, 120, 200]) if (this.f.height(this._pt(d, s * o).x, this._pt(d, s * o).z) < -3) return s * o; return 0; }
  _inVillage(d) { return this.villages.some(s => d > s.from + (s.to - s.from) * s.village[0] && d < s.from + (s.to - s.from) * s.village[1]); }
  _landSide(d) { // the side where the ground next to the road is fairly flat
    let best = 0, bs = 1e9;
    for (const s of [-1, 1]) { let rough = 0; for (const o of [5, 9, 14]) rough += Math.abs(this._pt(d, s * o).y - this._pt(d, 0).e); if (rough < bs) { bs = rough; best = s; } }
    return bs < 12 ? best : 0; }
  _spawn(name, anim, scale = 1) {
    const e = this.A.find(name); if (!e) return null;
    const { obj, mixer } = this.A.make(e, anim); obj.scale.setScalar(scale); layer1(obj); this.w.scene.add(obj); return { obj, mixer, e };
  }
  _say(obj, text, t = 2.6) { this.ev?.say?.(obj, text, t); }
  _run(name, anim, path, opts = {}) { // generic mover: path(t, v) -> {d, off} along the road, or null when finished
    const s = this._spawn(name, anim, opts.scale); if (!s) return null;
    const e = { ...s, t: 0, step: (dt, v) => {
      e.t += dt; const q = path(e.t, v, Math.min(dt, 0.1)); if (!q) { e.dead = true; return; }
      const p = this._pt(q.d, q.off), p2 = this._pt(q.d + (q.back ? -1 : 1), q.off + (q.doff || 0));
      e.obj.position.set(p.x, Math.max(q.water ? 0 : -50, q.water ? 0 : p.y), p.z);
      e.obj.rotation.y = Math.atan2(p2.x - p.x, p2.z - p.z);
    } };
    this.active.push(e); return e;
  }

  // ---- the surprises ----
  _knight() { // a knight gallops up beside you, races you, then pulls away and turns off
    const side = this._landSide(this.w.d + 30); if (!side) return false;
    const name = this.A.find('reiter_ritter') ? 'reiter_ritter' : 'pferd', d0 = this.w.d + 14;
    let dd = 0;
    const e = this._run(name, 'Rennen', (t, v, dt) => {
      if (t > 26) return null;
      dd += (t < 16 ? v + 0.6 : v + 2 + (t - 16) * 1.6) * dt;
      return { d: d0 + dd, off: side * (ROAD_W + 3.5 + Math.max(0, t - 19) * 4), doff: t > 19 ? side * 2 : 0 };
    });
    if (!e) return false;
    setTimeout(() => this._say(e.obj, 'Race thee to the castle, cyclist!', 3), 1500);
  }
  _kids() { // children run beside you for a few seconds, cheering
    const side = this._landSide(this.w.d + 20); if (!side) return false;
    const d0 = this.w.d + 10;
    ['junge', 'maedchen'].forEach((n, k) => {
      let dd = 0;
      const e = this._run(n, 'Rennen', (t, v, dt) => { if (t > 9) return null; dd += Math.min(v, 5.5) * dt; return { d: d0 + k * 2.5 + dd, off: side * (ROAD_W + 2.2 + k * 1.4) }; });
      if (e) { if (!k) setTimeout(() => this._say(e.obj, 'Faster! Faster!', 2.4), 700); }
    });
  }
  _crossing(name, n, call) { // a little herd crosses the road ahead of you
    const d0 = this.w.d + 75, side = Math.random() < .5 ? -1 : 1;
    for (let k = 0; k < n; k++) {
      const e = this._run(name, 'Gehen', t => { const u = (t - k * 0.9) / 11; if (u > 1) return null;
        return { d: d0 + k * 2.2 + Math.sin(k) * 1.5, off: side * (16 - 32 * Math.max(0, u)), doff: -side * 3 }; });
      if (e && k === 0) setTimeout(() => this._say(e.obj, call, 2), 1800);
    }
  }
  _pig() { // a runaway pig dashes along your lane, then bolts into the field
    const d0 = this.w.d + 45, side = Math.random() < .5 ? -1 : 1; let dd = 0;
    const e = this._run('schwein', 'Rennen', (t, v, dt) => { if (t > 12) return null; dd += 4.2 * dt;
      return { d: d0 + dd, off: side * (1.2 + Math.max(0, t - 6) * 3), doff: t > 6 ? side * 2 : 0 }; });
    if (!e) return false;
    setTimeout(() => this._say(e.obj, 'Oink!', 1.6), 600);
    const farmer = this._run('bauer', 'Rennen', t => { if (t > 12) return null; return { d: d0 - 6 + t * 3.6, off: side * (ROAD_W + 1.5) }; });
    if (farmer) setTimeout(() => this._say(farmer.obj, 'Stop that swine!', 2.6), 2400);
  }
  _ship() { // a viking longship rows along the coast with you, a little faster
    const off = this._seaSide(this.w.d + 120); if (!off) return false;
    const d0 = this.w.d + 60; let dd = 0;
    const e = this._run('langschiff', 'Rudern', (t, v, dt) => { if (t > 50) return null; dd += (v * 1.08) * dt;
      return { d: d0 + dd, off: off * 1.1, water: true }; });
    if (!e) return false;
    e.obj.traverse(c => c.layers.set(0)); // big: let the sea mirror it
    setTimeout(() => this._say(e.obj, 'Row, ye dogs! Beat the rider!', 3), 2500);
  }
  _juggler() { // a juggler performs at the roadside
    const side = this._landSide(this.w.d + 60); if (!side) return false;
    const d0 = this.w.d + 60;
    const e = this._run('gaukler', 'Jonglieren', t => t > 25 || this.w.d > d0 + 15 ? null : { d: d0, off: side * (ROAD_W + 2.6), doff: -side * 3 });
    if (e) setTimeout(() => this._say(e.obj, 'Behold, the great Bartholomew!', 3), 1500);
  }
  _dog() { // a dog chases you for a while, barking
    const side = this._landSide(this.w.d + 15); if (!side) return false;
    const d0 = this.w.d + 8; let dd = 0;
    const e = this._run('hund', 'Rennen', (t, v, dt) => { if (t > 11) return null; dd += Math.min(v + 0.5, 9) * dt; return { d: d0 + dd, off: side * (ROAD_W + 0.8) }; });
    if (!e) return false;
    setTimeout(() => this._say(e.obj, 'Woof! Woof!', 1.8), 500);
  }
  _salvo(d, n) { // fireworks above the road ahead
    for (let k = 0; k < n; k++) setTimeout(() => {
      const p = this._pt(d + (Math.random() - .5) * 60, (Math.random() - .5) * 80);
      this.fw.launch(p.x, Math.max(p.y, 0), p.z, 55 + Math.random() * 30);
    }, k * 380);
  }
}

// one pooled point cloud for every rocket and spark: a single draw call
class Fireworks {
  constructor(scene) {
    const N = this.N = 1600;
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.i = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.pts.frustumCulled = false; this.pts.visible = false; this.pts.layers.set(1); scene.add(this.pts);
    this.rockets = [];
  }
  _p(x, y, z, vx, vy, vz, r, g, b, life) { const i = this.i = (this.i + 1) % this.N, k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z; this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b; this.life[i] = life; }
  launch(x, y, z, h) { this.rockets.push({ x, y, z, vy: Math.sqrt(2 * 9.81 * h), t: 0 }); this.pts.visible = true; }
  update(dt) {
    if (!this.pts.visible) return;
    dt = Math.min(dt, 0.05);
    for (const r of this.rockets) { // rising rocket with a sparkling trail, bursts at the top
      r.vy -= 9.81 * dt; r.y += r.vy * dt; this._p(r.x, r.y, r.z, (Math.random() - .5), -2, (Math.random() - .5), 1, .7, .3, 0.6);
      if (r.vy <= 0) { r.dead = true;
        const hue = Math.random(), c = new THREE.Color().setHSL(hue, 1, .6), c2 = new THREE.Color().setHSL((hue + .1) % 1, 1, .7);
        for (let k = 0; k < 220; k++) { _v.randomDirection().multiplyScalar(14 + Math.random() * 6); const cc = k % 3 ? c : c2;
          this._p(r.x, r.y, r.z, _v.x, _v.y, _v.z, cc.r, cc.g, cc.b, 1.6 + Math.random() * 0.8); } }
    }
    this.rockets = this.rockets.filter(r => !r.dead);
    let alive = this.rockets.length;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3, l = this.life[i] -= dt; alive++;
      if (l <= 0) { this.pos[k + 1] = -1e4; continue; }
      this.vel[k] *= 1 - 1.6 * dt; this.vel[k + 1] = this.vel[k + 1] * (1 - 1.6 * dt) - 4 * dt; this.vel[k + 2] *= 1 - 1.6 * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const fade = Math.min(1, l * 1.5); this.col[k] *= fade > .98 ? 1 : 0.985; this.col[k + 1] *= fade > .98 ? 1 : 0.98; this.col[k + 2] *= fade > .98 ? 1 : 0.985;
    }
    this.pts.geometry.attributes.position.needsUpdate = true; this.pts.geometry.attributes.color.needsUpdate = true;
    if (!alive) this.pts.visible = false;
  }
}
