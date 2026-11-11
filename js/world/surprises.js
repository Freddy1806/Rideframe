// The ride as a roller coaster: never more than about half a minute without something happening.
// A director fires one surprise every 11–19 s, close (15–40 m) and in view, whichever fits the spot (sea beside the road, a village, open land),
// plus fireworks over the festival and at the finish. Every surprise starts ahead of the camera and uses the
// Mac's models when present; without a model that surprise is simply skipped.
import * as THREE from 'three';
import { ROAD_W } from './field.js';

const _v = new THREE.Vector3(), _f = new THREE.Vector3();
const layer1 = o => o.traverse(c => c.layers.set(1)); // not in the water reflection: small and fast

export class Surprises {
  constructor(world, assets, events) {
    this.w = world; this.A = assets; this.ev = events; this.f = world.field; this.track = world.track;
    this.next = 12; this.active = []; this.used = new Map();
    const villages = (this.track.segments || []).filter(s => s.village);
    const fest = villages.sort((p, q) => (q.to - q.from) * (q.village[1] - q.village[0]) - (p.to - p.from) * (p.village[1] - p.village[0]))[0];
    this.festD = fest ? fest.from + (fest.to - fest.from) * (fest.village[0] + fest.village[1]) / 2 : -1;
    this.villages = villages;
    this.list = [
      { id: 'knight', need: ['reiter_ritter', 'pferd'], go: () => this._knight() },
      { id: 'kids', need: ['junge', 'maedchen'], village: true, go: () => this._kids() },
      { id: 'sheep', need: ['schaf'], go: () => this._crossing(this.A.find('schaf_weiss') ? 'schaf_weiss' : 'schaf', 7, 'Baaa!') },
      { id: 'pig', need: ['schwein'], w: 0.35, go: () => this._pig() }, // farmer and pig: a rare treat, not every few km
      { id: 'ship', need: ['langschiff'], sea: true, go: () => this._ship() },
      { id: 'juggler', need: ['gaukler'], go: () => this._juggler() },
      { id: 'goats', need: ['ziege'], go: () => this._crossing('ziege', 5, 'Meeeh!') },
      { id: 'dog', need: ['hund'], go: () => this._dog() },
      { id: 'eagle', need: ['seeadler'], go: () => this._flyby('seeadler', 1, 'Screeech!') },
      { id: 'gulls', need: ['moewe'], go: () => this._flyby('moewe', 6) },
      { id: 'spray', need: [], sea: true, go: () => this._spray() },
      { id: 'rainbow', need: [], go: () => this._rainbow() },
      { id: 'band', need: [], go: () => this._band() },
      { id: 'crowd', need: ['junge', 'maedchen', 'alte_frau', 'bauer_sense', 'wache'], go: () => this._crowd() },
    ];
    this.fw = new Fireworks(world.scene);
    // background life: smoke curling from some chimneys, so villages never look empty
    const b = new THREE.Box3(), r = (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
    const chim = world.props.filter(o => /rorbu|steinhaus|fachwerk/.test(o.userData.asset || '') && r() < 0.45)
      .map(o => { b.setFromObject(o); return { x: o.position.x + (r() - .5) * 2, y: b.max.y - 0.3, z: o.position.z + (r() - .5) * 2, acc: r() }; });
    this.smoke = new Smoke(world.scene, chim);
    this.festFired = false;
  }

  update(_, dt, cam, d) {
    const time = this.clock = (this.clock || 0) + Math.min(dt, 0.1); // own clock: the preview's world time jumps when scrubbing
    const v = Math.max(2, this.w.speed || 6);
    if (time > this.next && this.f.tunnelNear?.(d, 20, 220)) this.next = time + 3; // nothing starts right before or inside a tunnel
    if (time > this.next) {
      const free = this.list.filter(s => (!s.need.length || s.need.some(n => this.A.find(n))) && (!s.sea || this._seaSide(d + 120)) && (!s.village || this._inVillage(d + 60)))
        .sort((a, b) => (this.used.get(a.id) || 0) / (a.w || 1) - (this.used.get(b.id) || 0) / (b.w || 1) || Math.random() - .5);
      const s = free[0];
      if (s && s.go() !== false) { this.used.set(s.id, time); this.next = time + 11 + Math.random() * 8; }
      else this.next = time + 4; // nothing fits here: look again soon
    }
    for (const e of this.active) e.step(dt, v, cam), e.mixer?.update(Math.min(dt, 0.1));
    for (const e of this.active) if (e.dead) this.w.scene.remove(e.obj);
    this.active = this.active.filter(e => !e.dead);
    // fireworks: over the festival town and for the last few hundred metres
    if (this.festD > 0 && !this.festFired && d > this.festD - 260 && d < this.festD) { this.festFired = true; this._salvo(this.festD + 40, 7); }
    if (this.track.length - d < 450 && time > (this.fwNext || 0)) { this.fwNext = time + 0.7 + Math.random() * 0.8; this._salvo(Math.min(this.track.length - 5, d + 160), 1); }
    this.fw.update(dt); this.smoke.update(dt, cam); this.bow?.update(dt, cam, this.f.at(Math.min(this.track.length - 1, d + 30)));
  }

  // ---- helpers ----
  _pt(d, off) { const p = this.f.at(Math.max(0, Math.min(this.track.length - 1, d))), l = Math.hypot(p.tx, p.tz) || 1;
    const x = p.x - p.tz / l * off, z = p.z + p.tx / l * off; return { x, z, y: this.f.ground(x, z), head: Math.atan2(p.tx, p.tz), e: p.e }; }
  _seaSide(d) { for (const s of [-1, 1]) for (const o of [60, 120, 200]) if (this.f.height(this._pt(d, s * o).x, this._pt(d, s * o).z) < -3) return s * o; return 0; }
  _inVillage(d) { return this.villages.some(s => d > s.from + (s.to - s.from) * s.village[0] && d < s.from + (s.to - s.from) * s.village[1]); }
  _landSide(d) { // the side where the ground next to the road is fairly flat
    let best = 0, bs = 1e9;
    for (const s of [-1, 1]) { let rough = 0; for (const o of [5, 9, 14]) rough += Math.abs(this._pt(d, s * o).y - this._pt(d, 0).e); if (rough < bs) { bs = rough; best = s; } }
    return bs < 12 ? best : 0; }
  _spawn(name, anim, scale = 1) { // anim: one clip name or a list of [name, playback speed] in order of preference
    const e = this.A.find(name); if (!e) return null;
    const pref = (Array.isArray(anim) ? anim : [[anim, 1]]).map(a => Array.isArray(a) ? a : [a, 1]);
    const [clip, ts] = pref.find(([n]) => e.clips.some(c => c.name === n)) || pref[0];
    const { obj, mixer } = this.A.make(e, clip); if (mixer) mixer.timeScale = ts;
    obj.scale.setScalar(scale); layer1(obj); this.w.scene.add(obj); return { obj, mixer, e };
  }
  _idle(e, names) { // switch a finished mover to a standing clip
    const c = names.map(n => e.e?.clips && this.A.clip(e.e, n)).find(Boolean); if (!c) return;
    e.mixer.stopAllAction(); e.mixer.timeScale = 1; e.mixer.clipAction(c).play();
  }
  _say(obj, text, t = 2.6) { this.ev?.say?.(obj, text, t); }
  _run(name, anim, path, opts = {}) { // generic mover: path(t, v) -> {d, off} along the road, or null when finished
    const s = this._spawn(name, anim, opts.scale); if (!s) return null;
    const e = { ...s, t: 0, step: (dt, v, cam) => {
      e.t += dt;
      if (e.over) { // finished: stays where it is until it is out of sight, so nothing vanishes in front of you
        const dx = e.obj.position.x - cam.x, dz = e.obj.position.z - cam.z, dist = Math.hypot(dx, dz), f = this.w.camera.getWorldDirection(_f);
        if (dist > 170 || (dx * f.x + dz * f.z) / (dist || 1) < 0.15) e.dead = true; return; }
      const q = path(e.t, v, Math.min(dt, 0.1)); if (!q) { e.over = true; if (opts.idle && e.mixer) this._idle(e, opts.idle); return; }
      const p = this._pt(q.d, q.off), p2 = this._pt(q.d + (q.back ? -1 : 1), q.off + (q.doff || 0));
      e.obj.position.set(p.x, q.fly != null ? Math.max(p.y, p.e) + q.fly : Math.max(q.water ? 0 : -50, q.water ? 0 : p.y), p.z);
      if (!e.shown) { e.shown = true; e.obj.visible = true; }
      e.obj.rotation.y = Math.atan2(p2.x - p.x, p2.z - p.z);
    } };
    this.active.push(e); return e;
  }

  // ---- the surprises ----
  _knight() { // a knight gallops up beside you, races you, then pulls away and turns off
    const side = this._landSide(this.w.d + 30); if (!side) return false;
    const name = this.A.find('reiter_ritter') ? 'reiter_ritter' : 'pferd', d0 = this.w.d - 30; // comes up from behind you
    let dd = 0;
    const e = this._run(name, [['Rennen', 1], ['Trab', 1.7], ['Schritt', 2.6]], (t, v, dt) => {
      if (t > 30 || d0 + dd > this.w.d + 160) return null;
      dd += (t < 16 ? v + 2.2 : v + 3 + (t - 16) * 1.6) * dt;
      return { d: d0 + dd, off: side * (ROAD_W + 3.5 + Math.max(0, t - 19) * 4), doff: t > 19 ? side * 2 : 0 };
    });
    if (!e) return false;
    setTimeout(() => this._say(e.obj, 'Race thee to the castle, cyclist!', 3), 9000);
  }
  _kids() { // children run beside you for a few seconds, cheering
    const side = this._landSide(this.w.d + 20); if (!side) return false;
    const d0 = this.w.d + 110;
    ['junge', 'maedchen', 'junge'].forEach((n, k) => {
      let dd = 0, run = 0;
      const e = this._run(n, [['Rennen', 0.8], ['Gehen', 1.4]], (t, v, dt) => {
        const me = d0 + k * 2.5 + dd;
        if (!run && this.w.d > me - 22) run = t;                    // you are close: they start running along
        if (!run) return { d: me, off: side * (ROAD_W + 2.2 + k * 1.4), doff: -side * 3 };
        if (t - run > 7) return null;
        dd += 3.2 * dt; return { d: me, off: side * (ROAD_W + 2.2 + k * 1.4) }; // a child's run, ~11 km/h
      }, { idle: ['Jubeln', 'Winken', 'Stehen'] });
      if (e) { if (!k) setTimeout(() => this._say(e.obj, 'Faster! Faster!', 2.4), 9000); }
    });
  }
  _crossing(name, n, call) { // a little herd crosses the road ahead of you
    const d0 = this.w.d + 120, side = Math.random() < .5 ? -1 : 1;
    for (let k = 0; k < n; k++) {
      let off = side * (18 + k * 0.7), flee = 0; const dk = d0 + k * 2.2 + Math.sin(k) * 1.5;
      const e = this._run(name, [['Schritt', 1.4], ['Gehen', 1.4]], (t, v, dt) => {
        if (t < k * 0.9) return { d: dk, off, doff: -side * 3 };
        const gap = dk - this.w.d;
        if (!flee && gap < 16 && gap > -4 && Math.abs(off) < ROAD_W + 2) flee = Math.sign(off) || side; // you ride at them: they bolt to the nearer verge
        if (flee) { off += flee * 4.5 * dt; if (Math.abs(off) > 20) return null; return { d: dk + flee * 0.3, off, doff: flee * 3 }; }
        off -= side * 1.2 * dt; if (side * off < -20) return null;  // calm walk across (~4 km/h)
        return { d: dk, off, doff: -side * 3 };
      }, { idle: ['Grasen', 'Fressen', 'Stehen'] });
      if (e && k === 0) setTimeout(() => this._say(e.obj, call, 2), 4000);
    }
  }
  _pig() { // a runaway pig dashes along your lane with the farmer right behind it, then both bolt into the field
    const d0 = this.w.d + 100, side = Math.random() < .5 ? -1 : 1; let dd = 0, bolt = 0;
    const path = lag => (t, v, dt) => { if (!lag) dd += 4.6 * dt;
      if (!bolt && this.w.d > d0 + dd - 18) bolt = t;              // you catch up: pig and farmer bolt into the field
      const b = bolt ? t - bolt : 0; if (b > 6) return null;
      return { d: d0 + dd - lag, off: side * (1.4 + lag * 0.3 + b * 3.2), doff: bolt ? side * 2 : 0 }; };
    const e = this._run('schwein', 'Rennen', path(0));
    if (!e) return false;
    setTimeout(() => this._say(e.obj, 'Oink! Oink!', 1.6), 5000);
    const farmer = this._run('bauer_sense', [['Rennen', 1], ['Gehen', 2.2]], path(4.5));
    if (farmer) setTimeout(() => this._say(farmer.obj, 'Stop that swine!', 2.6), 7000);
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
    const side = this._landSide(this.w.d + 110); if (!side) return false;
    const d0 = this.w.d + 110;
    const e = this._run('gaukler', 'Jonglieren', t => t > 45 || this.w.d > d0 + 15 ? null : { d: d0, off: side * (ROAD_W + 2.6), doff: -side * 3 });
    if (e) setTimeout(() => this._say(e.obj, 'Behold, the great Bartholomew!', 3), 7000);
  }
  _dog() { // a dog chases you for a while, barking
    const side = this._landSide(this.w.d + 100); if (!side) return false;
    const d0 = this.w.d + 100; let dd = 0, go = 0;
    const e = this._run('hund', 'Rennen', (t, v, dt) => {
      if (!go && this.w.d > d0 - 20) go = t;                      // it waits by its gate, then chases you
      if (!go) return { d: d0, off: side * (ROAD_W + 3), doff: -side * 3 };
      const g = t - go; if (g > 11) return null;
      dd += Math.min(v + 0.5, 8) * Math.max(0.2, 1 - g / 11) * dt; // keeps up at first, then gives up
      return { d: d0 + dd, off: side * (ROAD_W + 0.8) }; }, { idle: ['Sitzen', 'Stehen'] });
    if (!e) return false;
    setTimeout(() => this._say(e.obj, 'Woof! Woof!', 1.8), 6000);
  }
  _crowd() { // villagers line both sides of the road and cheer you through, like a mountain stage
    const d0 = this.w.d + 110, who = ['junge', 'maedchen', 'alte_frau', 'wache', 'ritter', 'fischerin', 'haendler', 'bogenschuetze', 'jaeger', 'baeckerin', 'frau_brot', 'moench'].filter(n => this.A.find(n));
    if (!who.length) return false;
    const calls = ['Allez! Allez!', 'Huzzah!', 'Go, go, go!', 'For the King!', 'Glory!'];
    for (let k = 0; k < 10; k++) {
      const side = k % 2 ? 1 : -1, dk = d0 + Math.floor(k / 2) * 5 + Math.random() * 2, n = who[k % who.length];
      const e = this._run(n, [['Jubeln', 1], ['Winken', 1], ['Stehen', 1]], () => this.w.d > dk + 12 ? null : { d: dk, off: side * (ROAD_W + 1.6 + Math.random() * 0.2), doff: -side * 3 });
      if (e && k % 3 === 0) setTimeout(() => this._say(e.obj, calls[(k / 3) % calls.length], 2), 7000 + k * 250);
    }
  }
  _band() { // street musicians at the roadside: their song takes over from the game music while you ride past
    const mus = this.A.by?.figure_music || []; if (!mus.length || !this.ev?.sounds?.music?.length) return false;
    if ((this.clock || 0) < (this.bandNext || 0)) return false;
    const side = this._landSide(this.w.d + 150); if (!side) return false;
    const d0 = this.w.d + 150, members = [];
    mus.slice(0, 4).forEach((m, k) => {
      const name = m.file.replace(/^.*\//, '').replace(/\.glb$/, '');
      const e = this._run(name, m.clips?.[0]?.name || 'Spielen', () => this.w.d > d0 + 40 ? null : { d: d0 + k * 2.2, off: side * (ROAD_W + 3 + (k % 2) * 1.2), doff: -side * 3 });
      if (e) members.push(e.obj);
    });
    if (!members.length) return false;
    this.bandNext = (this.clock || 0) + 300 + Math.random() * 300; // a rare treat, not on every stretch
    const p = this._pt(d0 + 3, side * (ROAD_W + 3));
    this.ev.bands.push({ members, x: p.x, z: p.z, song: Math.floor(Math.random() * 99) });
  }
  _flyby(name, n, call) { // birds come in low from ahead and sweep right over your head
    const side = Math.random() < .5 ? -1 : 1, d0 = this.w.d + 90;
    for (let k = 0; k < n; k++) {
      const e = this._run(name, [['Fliegen', 1.3], ['Gleiten', 1]], (t, v) => { const u = t / 7; if (u > 1) return null;
        return { d: d0 + k * 3 - (14 + v) * t, off: side * (18 - 36 * u) + (k % 3 - 1) * 3, back: true, fly: 1.9 + 5 * Math.abs(u - 0.5) + k * 0.6, doff: -side * 4 }; });
      if (e && !k && call) setTimeout(() => this._say(e.obj, call, 1.6), 1500);
    }
  }
  _spray() { // a big wave hits the rocks right beside the road: a burst of white spray
    const side = Math.sign(this._seaSide(this.w.d + 50)); if (!side) return false;
    let q = null; for (let o = ROAD_W + 6; o < 70 && !q; o += 4) { const p = this._pt(this.w.d + 50, side * o); if (p.y < 0.3) q = p; }
    if (!q) return false;
    for (let w = 0; w < 3; w++) setTimeout(() => { for (let k = 0; k < 260; k++) { const a = Math.random() * 6.28, h = 7 + Math.random() * 12, r = Math.random() * 4;
      const c = 0.85 + Math.random() * 0.15; this.fw._p(q.x + Math.cos(a) * r * 2, 0.3, q.z + Math.sin(a) * r * 2, Math.cos(a) * r, h, Math.sin(a) * r, c * 0.9, c * 0.95, c, 1.6 + Math.random()); }
      this.fw.pts.visible = true; }, w * 650);
  }
  _rainbow() { // once in a while a rainbow rises over the road ahead and fades again (weather after a shower)
    if (this.bow && this.bow.busy()) return false;
    if ((this.clock || 0) < (this.bowNext || 0)) return false;
    this.bowNext = (this.clock || 0) + 360; (this.bow ||= new Rainbow(this.w.scene)).start();
  }
  _salvo(d, n) { // fireworks above the road ahead
    for (let k = 0; k < n; k++) setTimeout(() => {
      const p = this._pt(d + (Math.random() - .5) * 60, (Math.random() - .5) * 80);
      this.fw.launch(p.x, Math.max(p.y, 0), p.z, 55 + Math.random() * 30);
    }, k * 380);
  }
}

// a big soft rainbow arc far ahead, always facing the camera; fades in, holds, fades out
class Rainbow {
  constructor(scene) {
    this.mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: `varying vec2 vUv; uniform float uA;
        vec3 spec(float t) { return clamp(vec3(abs(t * 6. - 3.) - 1., 2. - abs(t * 6. - 2.), 2. - abs(t * 6. - 4.)), 0., 1.); }
        void main() { float r = length(vUv - .5) * 2.; float t = (r - .86) / .12; if (t < 0. || t > 1.) discard;
          float a = smoothstep(0., .15, t) * smoothstep(1., .8, t) * uA * smoothstep(-.02, .25, vUv.y - .5) * .38;
          gl_FragColor = vec4(spec(1. - t) * a, a); }` });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat); this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.layers.set(1); this.mesh.renderOrder = -1;
    scene.add(this.mesh); this.t = -1;
  }
  busy() { return this.t >= 0; }
  start() { this.t = 0; this.mesh.visible = true; }
  update(dt, cam, ahead) {
    if (this.t < 0) return;
    this.t += Math.min(dt, 0.1); const T = 38, a = Math.min(1, this.t / 5) * Math.min(1, (T - this.t) / 6);
    if (this.t > T) { this.t = -1; this.mesh.visible = false; return; }
    const l = Math.hypot(ahead.tx, ahead.tz) || 1, D = 900;
    this.mesh.position.set(cam.x + ahead.tx / l * D, cam.y - 60, cam.z + ahead.tz / l * D); this.mesh.scale.setScalar(D * 1.5);
    this.mesh.lookAt(cam.x, cam.y - 60, cam.z); this.mat.uniforms.uA.value = a;
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

// chimney smoke: soft puffs that rise, drift with the wind, grow and fade; one draw call, only near the camera
class Smoke {
  constructor(scene, emitters) {
    this.em = emitters; const N = this.N = 700;
    this.pos = new Float32Array(N * 3); this.age = new Float32Array(N).fill(99); this.life = new Float32Array(N).fill(1); this.i = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } },
      vertexShader: 'attribute float aT; varying float vT; uniform float uScale; void main() { vT = aT; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = (1.2 + aT * 7.) * uScale / -mv.z; }',
      fragmentShader: 'varying float vT; void main() { vec2 p = gl_PointCoord - .5; float a = smoothstep(.5, .1, length(p)) * smoothstep(1., .55, vT) * smoothstep(0., .08, vT) * .42; if (a < .01) discard; gl_FragColor = vec4(vec3(.78, .78, .8) - vT * .08, a); }' });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.layers.set(1); scene.add(this.pts);
    this.t = 0;
  }
  update(dt, cam) {
    if (!this.em.length) return;
    dt = Math.min(dt, 0.1); this.t += dt;
    for (const e of this.em) { // emit only near the camera
      if (Math.abs(e.x - cam.x) > 450 || Math.abs(e.z - cam.z) > 450) continue;
      e.acc += dt * 2.2; while (e.acc > 1) { e.acc -= 1; const i = this.i = (this.i + 1) % this.N, k = i * 3;
        this.pos[k] = e.x; this.pos[k + 1] = e.y; this.pos[k + 2] = e.z; this.age[i] = 0; this.life[i] = 7 + Math.random() * 4; }
    }
    const aT = this.pts.geometry.attributes.aT.array, wx = Math.cos(this.t * .05) * .9, wz = Math.sin(this.t * .05) * .5 + .6;
    for (let i = 0; i < this.N; i++) {
      if (this.age[i] > this.life[i]) { aT[i] = 1; continue; }
      const k = i * 3, a = this.age[i] += dt, u = a / this.life[i];
      this.pos[k] += wx * u * dt * 2; this.pos[k + 1] += (1.1 - u * 0.6) * dt; this.pos[k + 2] += wz * u * dt * 2; aT[i] = u;
    }
    this.mat.uniforms.uScale.value = innerHeight * 0.5;
    this.pts.geometry.attributes.position.needsUpdate = true; this.pts.geometry.attributes.aT.needsUpdate = true;
  }
}
