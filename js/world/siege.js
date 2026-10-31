// The castle under siege: catapults hurl fireballs at the walls while knights storm up the hill. As the rider comes
// past, a wall and then a tower blow up, topple and break apart in a dust cloud; the ruins keep burning.
// Everything is keyed to the rider's distance to the castle, so it lines up at any speed. All particles are pooled
// (no allocation per frame), ~10 draw calls while it runs, nothing at all outside ~900 m.
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';

const G = 9.81, QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const NEAR = 900, AFTER = 700, WAR = 600; // active window and start of the bombardment (m before the castle)
const FIRE_N = 360, SMOKE_N = 420, EMBER_N = 400, STONE_N = 240, BLOCK_N = 80, BALL_N = 14, KNIGHT_N = 22, PARTS = 5;
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4(), _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _s = new THREE.Vector3(), _ray = new THREE.Ray(), _box = new THREE.Box3(), _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0), _px = new THREE.Vector2();
const rnd = (a, b) => a + Math.random() * (b - a);
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const layer1 = o => o.traverse(c => c.layers.set(1)); // not in the sea mirror

// ---------------- camera-facing puffs (fire: additive, smoke/dust: alpha), one draw call each ----------------
const PUFF_VS = `attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
uniform float uDen; varying vec2 vUv; varying vec4 vB; varying vec2 vC; varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(iA.xyz, 1.);
  float c = cos(iC.x), s = sin(iC.x);
  mv.xy += mat2(c, s, -s, c) * position.xy * iA.w;
  gl_Position = projectionMatrix * mv;
  vUv = uv * .5 + vec2(mod(iC.y, 2.), floor(iC.y * .5)) * .5;
  vB = iB; vC = iC.zw;
  float fd = -mv.z * uDen; vFog = 1. - exp(-fd * fd);
}`;
const FIRE_FS = `uniform sampler2D map; varying vec2 vUv; varying vec4 vB; varying vec2 vC; varying float vFog;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vB.a; if (a < .003) discard;
  float h = clamp(vC.x * (.35 + .9 * t.r), 0., 1.4);
  vec3 col = mix(vec3(.3, .03, .0), vec3(2.4, .62, .1), smoothstep(.0, .45, h));
  col = mix(col, vec3(5., 3.2, 1.4), smoothstep(.75, 1.25, h));
  gl_FragColor = vec4(col, a * (1. - .85 * vFog));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const SMOKE_FS = `uniform sampler2D map; uniform vec3 uFog; varying vec2 vUv; varying vec4 vB; varying vec2 vC; varying float vFog;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vB.a; if (a < .003) discard;
  vec3 col = vB.rgb * (.5 + .8 * t.g) + vec3(2.6, .8, .16) * vC.x * t.r * t.r;
  gl_FragColor = vec4(mix(col, uFog, vFog), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function puffTexture() { // 2x2 atlas of lumpy puffs: a = density, r = core, g = top-lit shading
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S * 2;
  const g = cv.getContext('2d'), img = g.createImageData(S * 2, S * 2), D = new Float32Array(S * S);
  const hash = (x, y, s) => { const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };
  const vn = (x, y, s) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, U = u * u * (3 - 2 * u), V = v * v * (3 - 2 * v);
    const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s); return a + (b - a) * U + (c - a) * V + (a - b - c + d) * U * V; };
  for (let k = 0; k < 4; k++) {
    const blobs = []; for (let b = 0; b < 8; b++) { const an = Math.random() * 6.28, r = Math.random() * .17; blobs.push([.5 + Math.cos(an) * r, .5 + Math.sin(an) * r, .1 + Math.random() * .09]); }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S; let d = 0;
      for (const [bx, by, br] of blobs) { const dx = u - bx, dy = v - by; d += Math.exp(-(dx * dx + dy * dy) / (br * br)); }
      let n = 0, a = .5, f = 5; for (let o = 0; o < 4; o++) { n += a * vn(u * f, v * f, k * 13 + o); a *= .5; f *= 2.1; }
      D[y * S + x] = Math.max(0, d * (.15 + 1.5 * n) - .12) * sstep(.5, .3, Math.hypot(u - .5, v - .5));
    }
    const ox = (k % 2) * S, oy = (1 - (k >> 1)) * S; // canvas rows run top-down, the texture is flipped
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = D[y * S + x], lit = (D[Math.min(S - 1, y + 4) * S + x] - D[Math.max(0, y - 4) * S + x]) * 2.5;
      const i = ((oy + y) * S * 2 + ox + x) * 4;
      img.data[i] = Math.min(255, d * 150); img.data[i + 1] = Math.max(0, Math.min(255, (.5 + lit) * 255)); img.data[i + 2] = 0;
      img.data[i + 3] = Math.min(255, Math.pow(Math.min(1, d * 1.15), 1.2) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.premultiplyAlpha = false; return t;
}

class Puffs {
  constructor(max, additive, map) {
    this.max = max; this.n = 0; this.additive = additive;
    const F = k => new Float32Array(max * k);
    Object.assign(this, { p: F(3), v: F(3), age: F(1), life: F(1), s0: F(1), s1: F(1), rot: F(1), vr: F(1), col: F(3), a0: F(1), h0: F(1), lift: F(1), drag: F(1), vari: F(1), depth: F(1) });
    this.order = new Uint16Array(max);
    const pl = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = pl.index; g.setAttribute('position', pl.attributes.position); g.setAttribute('uv', pl.attributes.uv);
    for (const k of ['iA', 'iB', 'iC']) { const a = new THREE.InstancedBufferAttribute(F(4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); this[k] = a; }
    g.instanceCount = 0; this.g = g;
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: map }, uFog: { value: new THREE.Color() }, uDen: { value: 0 } },
      vertexShader: PUFF_VS, fragmentShader: additive ? FIRE_FS : SMOKE_FS, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 12 : 11;
  }
  /** h = heat (fire) or under-glow (smoke); r,g,b only for smoke */
  spawn(x, y, z, vx, vy, vz, life, s0, s1, a0, h, r = 0, g = 0, b = 0, lift = 0, drag = 1) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z; this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0; this.h0[i] = h; this.lift[i] = lift; this.drag[i] = drag;
    this.rot[i] = Math.random() * 6.28; this.vr[i] = (Math.random() - .5) * (this.additive ? 2.5 : .6); this.vari[i] = Math.floor(Math.random() * 4);
  }
  _move(i, j) { // j -> i (compaction)
    for (const k of ['p', 'v', 'col']) { const a = this[k]; a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2]; }
    for (const k of ['age', 'life', 's0', 's1', 'rot', 'vr', 'a0', 'h0', 'lift', 'drag', 'vari']) this[k][i] = this[k][j];
  }
  step(dt, wx, wz) {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this._move(i, --this.n); i--; continue; }
      const i3 = i * 3, dr = Math.exp(-this.drag[i] * dt), k = this.age[i] / this.life[i];
      this.v[i3] = this.v[i3] * dr + wx * k * dt; this.v[i3 + 1] = this.v[i3 + 1] * dr + this.lift[i] * dt; this.v[i3 + 2] = this.v[i3 + 2] * dr + wz * k * dt;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      this.rot[i] += this.vr[i] * dt;
    }
  }
  write(cam, fog, den) {
    const n = this.n, o = this.order, cp = cam.position, fw = cam.getWorldDirection(_v3);
    for (let i = 0; i < n; i++) { o[i] = i; this.depth[i] = (this.p[i * 3] - cp.x) * fw.x + (this.p[i * 3 + 1] - cp.y) * fw.y + (this.p[i * 3 + 2] - cp.z) * fw.z; }
    if (!this.additive) for (let i = 1; i < n; i++) { const x = o[i], dx = this.depth[x]; let j = i - 1; while (j >= 0 && this.depth[o[j]] < dx) { o[j + 1] = o[j]; j--; } o[j + 1] = x; } // far first
    const A = this.iA.array, B = this.iB.array, C = this.iC.array;
    for (let s = 0; s < n; s++) {
      const i = o[s], k = this.age[i] / this.life[i], e = 1 - Math.pow(1 - k, 2.4), q = s * 4, i3 = i * 3;
      A[q] = this.p[i3]; A[q + 1] = this.p[i3 + 1]; A[q + 2] = this.p[i3 + 2]; A[q + 3] = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      const fin = Math.min(1, k / (this.additive ? .06 : .12));
      B[q] = this.col[i3]; B[q + 1] = this.col[i3 + 1]; B[q + 2] = this.col[i3 + 2];
      B[q + 3] = this.a0[i] * fin * (this.additive ? Math.pow(1 - k, .9) : Math.pow(1 - k, 1.6));
      C[q] = this.rot[i]; C[q + 1] = this.vari[i]; C[q + 2] = this.h0[i] * (this.additive ? Math.pow(1 - k, 1.3) : Math.pow(1 - k, 5)); C[q + 3] = 0;
    }
    this.g.instanceCount = n;
    if (n) { this.iA.needsUpdate = this.iB.needsUpdate = this.iC.needsUpdate = true; this.iA.addUpdateRange(0, n * 4); this.iB.addUpdateRange(0, n * 4); this.iC.addUpdateRange(0, n * 4); }
    this.mat.uniforms.uFog.value.copy(fog); this.mat.uniforms.uDen.value = den;
  }
  clear() { this.n = 0; this.g.instanceCount = 0; }
}

// ---------------- embers: glowing points that rise and flicker out ----------------
class Embers {
  constructor(max) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.age = new Float32Array(max); this.life = new Float32Array(max); this.h = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage); this.ha = new THREE.BufferAttribute(this.h, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('aH', this.ha); g.setDrawRange(0, 0); this.g = g;
    this.mat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 600 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aH; uniform float uScale; varying float vH;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uScale * (.07 + .07 * aH) / -mv.z, 1.5, 10.); vH = aH; }`,
      fragmentShader: `varying float vH;
void main() { float r = length(gl_PointCoord - .5); float a = smoothstep(.5, .1, r) * vH; if (a < .01) discard;
  gl_FragColor = vec4(mix(vec3(1.6, .25, .03), vec3(5., 2.8, 1.), vH * vH), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}` });
    this.mesh = new THREE.Points(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 13;
  }
  spawn(x, y, z, vx, vy, vz, life) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3; this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z; this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz; this.age[i] = 0; this.life[i] = life;
  }
  step(dt, time, wx, wz) {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { const j = --this.n; for (let c = 0; c < 3; c++) { this.p[i * 3 + c] = this.p[j * 3 + c]; this.v[i * 3 + c] = this.v[j * 3 + c]; } this.age[i] = this.age[j]; this.life[i] = this.life[j]; i--; continue; }
      const i3 = i * 3, dr = Math.exp(-1.6 * dt), k = this.age[i] / this.life[i];
      this.v[i3] = this.v[i3] * dr + wx * dt * .8 + Math.sin(time * 7 + i) * dt * 2; this.v[i3 + 1] = this.v[i3 + 1] * dr + 1.8 * dt; this.v[i3 + 2] = this.v[i3 + 2] * dr + wz * dt * .8 + Math.cos(time * 6 + i * 1.7) * dt * 2;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      this.h[i] = (1 - k) * (.6 + .4 * Math.sin(time * 23 + i * 3.1));
    }
    this.g.setDrawRange(0, this.n);
    if (this.n) { this.pa.needsUpdate = this.ha.needsUpdate = true; this.pa.addUpdateRange(0, this.n * 3); this.ha.addUpdateRange(0, this.n); }
  }
  clear() { this.n = 0; this.g.setDrawRange(0, 0); }
}

// ---------------- rigid chunks on one InstancedMesh: fly, bounce, settle, sink into the ground ----------------
// st: 0 flying, 1 resting (then sinking to its burial depth; keep = 0 sinks away completely), 2 growing rubble heap
class Bodies {
  constructor(max, geo, mat, ground) {
    this.max = max; this.n = 0; this.ground = ground; this.onLand = null;
    const F = k => new Float32Array(max * k);
    Object.assign(this, { p: F(3), v: F(3), q: F(4), w: F(3), s: F(3), c: F(3), r: F(1), st: F(1), t: F(1), keep: F(1), bury: F(1), sunk: F(1) });
    this.mesh = new THREE.InstancedMesh(geo, mat, max); this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, _c.setRGB(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  add(x, y, z, q, sx, sy, sz, vx, vy, vz, w, col, keep, st = 0) {
    if (this.n >= this.max) return -1;
    const i = this.n++, i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z; this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.q[i * 4] = q.x; this.q[i * 4 + 1] = q.y; this.q[i * 4 + 2] = q.z; this.q[i * 4 + 3] = q.w;
    this.w[i3] = (Math.random() - .5) * w; this.w[i3 + 1] = (Math.random() - .5) * w; this.w[i3 + 2] = (Math.random() - .5) * w;
    this.s[i3] = sx; this.s[i3 + 1] = sy; this.s[i3 + 2] = sz; this.c[i3] = col.r; this.c[i3 + 1] = col.g; this.c[i3 + 2] = col.b;
    this.r[i] = Math.min(sx, sy, sz) * .5; this.st[i] = st; this.t[i] = 0; this.keep[i] = keep; this.sunk[i] = 0;
    this.bury[i] = keep ? this.r[i] * rnd(.9, 1.4) : this.r[i] * 2.4;
    return i;
  }
  _move(i, j) {
    for (const k of ['p', 'v', 'w', 's', 'c']) { const a = this[k]; a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2]; }
    for (let c = 0; c < 4; c++) this.q[i * 4 + c] = this.q[j * 4 + c];
    for (const k of ['r', 'st', 't', 'keep', 'bury', 'sunk']) this[k][i] = this[k][j];
  }
  step(dt) {
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3, st = this.st[i]; this.t[i] += dt;
      if (st === 2) continue;
      if (st === 1) { // settled: sink slowly (into the dust), loose debris disappears completely
        if (this.sunk[i] < this.bury[i] && this.t[i] > (this.keep[i] ? .8 : 3.5)) { const d = Math.min(this.bury[i] - this.sunk[i], dt * (this.keep[i] ? .3 : .12 + this.r[i] * .4)); this.sunk[i] += d; this.p[i3 + 1] -= d; }
        else if (!this.keep[i] && this.sunk[i] >= this.bury[i]) { this._move(i, --this.n); i--; }
        continue;
      }
      this.v[i3 + 1] -= G * dt;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      _v.set(this.w[i3], this.w[i3 + 1], this.w[i3 + 2]); const a = _v.length() * dt;
      if (a > 1e-5) { _q2.setFromAxisAngle(_v.normalize(), a); _q.fromArray(this.q, i * 4).premultiply(_q2).toArray(this.q, i * 4); }
      const gy = this.ground(this.p[i3], this.p[i3 + 2]) + this.r[i];
      if (this.p[i3 + 1] < gy) {
        const vy = -this.v[i3 + 1]; this.p[i3 + 1] = gy;
        if (vy > 2.5) { this.v[i3 + 1] = vy * .22; this.v[i3] *= .5; this.v[i3 + 2] *= .5; for (let c = 0; c < 3; c++) this.w[i3 + c] *= .5; this.onLand?.(i, vy); }
        else { this.st[i] = 1; this.t[i] = 0; this.v[i3] = this.v[i3 + 1] = this.v[i3 + 2] = 0; this.onRest?.(i); }
      }
    }
  }
  write() {
    const M = this.mesh.instanceMatrix.array, C = this.mesh.instanceColor.array;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3; let sy = this.s[i3 + 1];
      if (this.st[i] === 2) sy *= sstep(0, 2.2, this.t[i]) * .999 + .001;
      _q.fromArray(this.q, i * 4); _v.fromArray(this.p, i3); _s.set(this.s[i3], sy, this.s[i3 + 2]);
      _m.compose(_v, _q, _s).toArray(M, i * 16); C[i3] = this.c[i3]; C[i3 + 1] = this.c[i3 + 1]; C[i3 + 2] = this.c[i3 + 2];
    }
    this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.n = 0; this.mesh.count = 0; }
}

// ---------------- simple siege engines and knights (used when there are no Blender models) ----------------
function catapultGeos() {
  const B = (w, h, d, x, y, z, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); return g; };
  const W = (x, z) => { const g = new THREE.CylinderGeometry(.55, .55, .25, 10); g.rotateZ(Math.PI / 2); g.translate(x, .55, z); return g; };
  const frame = mergeGeometries([B(.3, .3, 5, -1.1, .75, 0), B(.3, .3, 5, 1.1, .75, 0), B(2.5, .3, .3, 0, .75, -2.2), B(2.5, .3, .3, 0, .75, 2.2),
    B(.28, 2.4, .28, -1.1, 1.95, .4), B(.28, 2.4, .28, 1.1, 1.95, .4), B(.24, 2.9, .24, -1.1, 1.75, 1.4, -.6), B(.24, 2.9, .24, 1.1, 1.75, 1.4, -.6),
    B(2.6, .24, .24, 0, 3.1, .4), B(2.4, .35, .35, 0, 2.6, 1.55), W(-1.38, -1.7), W(1.38, -1.7), W(-1.38, 1.7), W(1.38, 1.7)]);
  const arm = mergeGeometries([B(.24, 5.6, .24, 0, 1.6, 0), B(.8, .28, .8, 0, 4.3, 0), B(1.1, 1, 1, 0, -1.3, 0)]);
  return { frame, arm };
}

// ---------------- flipbook quads (fx/*.png from the Mac): explosion, sparks, dust, fireball glow ----------------
const FLIP_VS = `attribute vec4 iA; attribute vec4 iB; uniform vec2 uAnchor; uniform float uGrid, uDen;
varying vec2 vUv; varying float vA; varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(iA.xyz, 1.);
  mv.xy += (position.xy + .5 - uAnchor) * iA.w;
  gl_Position = projectionMatrix * mv;
  float c = mod(iB.x, uGrid), r = floor(iB.x / uGrid);
  vUv = vec2((c + uv.x) / uGrid, 1. - (r + 1. - uv.y) / uGrid); vA = iB.y;
  float fd = -mv.z * uDen; vFog = 1. - exp(-fd * fd);
}`;
const FLIP_FS = `uniform sampler2D map; uniform vec3 uFog; varying vec2 vUv; varying float vA; varying float vFog;
void main() {
  vec4 t = texture2D(map, vUv); float a = t.a * vA; if (a < .004) discard;
  #ifdef ADD
    gl_FragColor = vec4(t.rgb, a * (1. - .85 * vFog));
  #else
    gl_FragColor = vec4(mix(t.rgb, uFog, vFog * .8), a);
  #endif
  #include <colorspace_fragment>
}`;
class Flip {
  /** grid x grid frames row by row from the top left; anchor = (u, v from the bottom) of the quad that sits on the spawn point */
  constructor(max, map, grid, frames, fps, anchor, additive) {
    Object.assign(this, { max, n: 0, grid, frames, fps });
    const F = k => new Float32Array(max * k);
    Object.assign(this, { p: F(3), size: F(1), age: F(1), f0: F(1), rate: F(1), fade: F(1), a0: F(1) });
    map.colorSpace = THREE.SRGBColorSpace;
    const pl = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = pl.index; g.setAttribute('position', pl.attributes.position); g.setAttribute('uv', pl.attributes.uv);
    for (const k of ['iA', 'iB']) { const a = new THREE.InstancedBufferAttribute(F(4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); this[k] = a; }
    g.instanceCount = 0; this.g = g;
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: map }, uAnchor: { value: new THREE.Vector2(...anchor) }, uGrid: { value: grid }, uFog: { value: new THREE.Color() }, uDen: { value: 0 } },
      vertexShader: FLIP_VS, fragmentShader: FLIP_FS, defines: additive ? { ADD: 1 } : {}, transparent: true, depthWrite: false, toneMapped: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 14 : 13; this.mesh.layers.set(1);
  }
  /** fade: frame from which it fades out; rate 0 = one fixed frame f0 for this frame only */
  put(x, y, z, size, f0 = 0, rate = this.fps, fade = this.frames, a0 = 1) {
    if (this.n >= this.max) return;
    const i = this.n++; this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.size[i] = size; this.age[i] = 0; this.f0[i] = f0; this.rate[i] = rate; this.fade[i] = fade; this.a0[i] = a0;
  }
  step(dt) {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.f0[i] + this.age[i] * this.rate[i] >= this.frames) { const j = --this.n; for (const k of ['size', 'age', 'f0', 'rate', 'fade', 'a0']) this[k][i] = this[k][j]; for (let c = 0; c < 3; c++) this.p[i * 3 + c] = this.p[j * 3 + c]; i--; }
    }
  }
  write(fog, den) {
    const A = this.iA.array, B = this.iB.array;
    for (let i = 0; i < this.n; i++) {
      const raw = Math.floor(this.f0[i] + this.age[i] * this.rate[i]), f = Math.max(0, Math.min(this.frames - 1, raw)), q = i * 4; // raw < 0: still waiting
      A[q] = this.p[i * 3]; A[q + 1] = this.p[i * 3 + 1]; A[q + 2] = this.p[i * 3 + 2]; A[q + 3] = this.size[i];
      B[q] = f; B[q + 1] = raw < 0 ? 0 : this.a0[i] * (f < this.fade[i] ? 1 : 1 - (f - this.fade[i]) / Math.max(1, this.frames - this.fade[i]));
    }
    this.g.instanceCount = this.n; if (this.n) { this.iA.needsUpdate = this.iB.needsUpdate = true; }
    this.mat.uniforms.uFog.value.copy(fog); this.mat.uniforms.uDen.value = den;
  }
}

// ---------------- flames: solid 'flamme'/'feuer' meshes from the Blender assets turned into flickering fire ----------------
// Shared by every flame (one program); tick flameTime.value once per frame (Siege does while it runs).
export const flameTime = { value: 0 };
let flameMat = null;
export function flameMaterial() {
  return flameMat ||= new THREE.ShaderMaterial({ uniforms: { uTime: flameTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `uniform float uTime; varying vec3 vP; varying float vF;
void main() {
  vec3 p = position; float w = sin(p.y * 9. - uTime * 11. + p.x * 6.) * sin(p.z * 7. + uTime * 7.);
  p += normal * w * .035 * clamp(p.y + .3, 0., 2.);
  vec4 wp = vec4(p, 1.);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  vec4 mv = modelViewMatrix * wp; vec3 nv = normalize(normalMatrix * normal);
  vF = abs(dot(nv, normalize(-mv.xyz))); vP = position; gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform float uTime; varying vec3 vP; varying float vF;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
void main() {
  vec3 q = vP * 5. - vec3(0., uTime * 3.2, 0.);
  float n = n3(q) * .6 + n3(q * 2.3 + 4.) * .4;
  float h = clamp(pow(vF, 1.5) * (.45 + .9 * n), 0., 1.2);
  vec3 col = mix(vec3(1.4, .25, .02), vec3(2.6, 1.1, .2), smoothstep(.2, .6, h));
  col = mix(col, vec3(4., 3., 1.6), smoothstep(.75, 1.1, h));
  gl_FragColor = vec4(col, smoothstep(.12, .5, h));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}` });
}
/** swap every solid flame mesh (material 'flamme' / 'feuer', no 'Flackern' morph) in obj for the flickering flame shader */
export function applyFlames(obj) {
  obj.traverse(o => { if (o.isMesh && !o.isSkinnedMesh && !o.morphTargetDictionary?.Flackern && !Array.isArray(o.material) && /flamme|feuer/i.test(o.material?.name || '')) { o.material = flameMaterial(); o.castShadow = false; } });
  return obj;
}
/** flame cards with a 'Flackern' morph: collect them for flicker() */
function flickers(obj, out) { obj.traverse(o => { const i = o.morphTargetDictionary?.Flackern; if (i !== undefined) out.push({ o, i, ph: Math.random() * 9 }); }); return obj; }
// clip fallbacks per state: not every figure has every clip (wache: no Rennen, bogenschuetze: Schiessen, reiter_ritter: Trab)
const CLIPS = { run: ['Rennen', 'Trab', 'Gehen'], fight: ['Kaempfen', 'Schiessen', 'Stehen'], cheer: ['Jubeln', 'Winken', 'Stehen'], wait: ['Stehen'] };
/** seconds from a manifest timing value: frames when the entry says so (fps) or when larger than the clip */
const secs = (v, e, dur) => v == null ? null : e.fps ? v / e.fps : v > dur + .01 ? v / 24 : v;
/** first mesh of a Blender asset as plain geometry, centred and scaled to `size` metres */
function assetGeo(e, size) {
  let m = null; e.scene.traverse(o => { if (!m && o.isMesh && !o.isSkinnedMesh) m = o; }); if (!m) return null;
  e.scene.updateMatrixWorld(true); const g = m.geometry.clone().applyMatrix4(m.matrixWorld); g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3()), sz = g.boundingBox.getSize(new THREE.Vector3()), k = size / Math.max(sz.x, sz.y, sz.z, 1e-3);
  g.translate(-c.x, -c.y, -c.z); g.scale(k, k, k);
  for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
  return { g, mat: m.material };
}

/** Rigid animated pieces (nodes 'bruch_###') drawn as one BatchedMesh per material instead of one draw call each.
 *  The original nodes stay (hidden) for the animation; call syncPieces() after the mixer moved them. */
export function batchPieces(obj, test = /bruch/i) {
  obj.updateMatrixWorld(true);
  const groups = new Map(), out = [];
  obj.traverse(o => { if (o.isMesh && !o.isSkinnedMesh && !Array.isArray(o.material) && test.test(o.name + ' ' + (o.parent?.name || ''))) { let g = groups.get(o.material); if (!g) groups.set(o.material, g = []); g.push(o); } });
  for (const [mat, list] of groups) {
    const sig = m => Object.keys(m.geometry.attributes).sort().join() + (m.geometry.index ? ':i' : ''), ok = list.filter(m => sig(m) === sig(list[0]));
    if (ok.length < 4) continue;
    try {
      let nv = 0, ni = 0; for (const m of ok) { nv += m.geometry.attributes.position.count; ni += m.geometry.index?.count || 0; }
      const bm = new THREE.BatchedMesh(ok.length, nv, ni || nv, mat);
      bm.castShadow = bm.receiveShadow = true; bm.frustumCulled = false; bm.perObjectFrustumCulled = false; bm.sortObjects = false;
      const ids = ok.map(m => bm.addInstance(bm.addGeometry(m.geometry)));
      ok.forEach(m => { m.visible = false; }); out.push({ bm, list: ok, ids });
    } catch (e) { console.warn('RIDEFRAME Trümmer nicht gebündelt', e.message); }
  }
  syncPieces(out); return out;
}
export function syncPieces(batches) { for (const b of batches) for (let i = 0; i < b.ids.length; i++) b.bm.setMatrixAt(b.ids[i], b.list[i].matrixWorld); }

export class Siege {
  constructor(world, castle, d0) {
    this.w = world; this.castle = castle; this.d0 = d0; this.f = world.field;
    this.state = 'idle'; this.built = false; this.active = false; this.t = 0; this.ft = 0; this.flash = 0; this.lastD = null; this.silent = false;
    castle.updateMatrixWorld(true);
    const p = this.f.at(d0), tl = Math.hypot(p.tx, p.tz) || 1;
    this.c = castle.position.clone(); this.tan = new THREE.Vector3(p.tx / tl, 0, p.tz / tl);
    this.out = new THREE.Vector3(p.x - this.c.x, 0, p.z - this.c.z); this.roadDist = this.out.length(); this.out.normalize(); // castle -> road
    this.side = Math.sign((this.c.x - p.x) * -this.tan.z + (this.c.z - p.z) * this.tan.x) || 1; // castle right (+1) or left of the road
    // ground around the castle, sampled once: everything that lands or runs uses this grid
    const N = this.gN = 41, S = this.gS = 6; this.gx0 = this.c.x - (N - 1) / 2 * S; this.gz0 = this.c.z - (N - 1) / 2 * S; this.gh = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) this.gh[j * N + i] = this.f.height(this.gx0 + i * S, this.gz0 + j * S);
    this.ground = (x, z) => {
      const u = Math.max(0, Math.min(N - 1.001, (x - this.gx0) / S)), v = Math.max(0, Math.min(N - 1.001, (z - this.gz0) / S)), i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, h = this.gh;
      return (h[j * N + i] * (1 - a) + h[j * N + i + 1] * a) * (1 - b) + (h[(j + 1) * N + i] * (1 - a) + h[(j + 1) * N + i + 1] * a) * b;
    };
    // one light for every flash and the burning ruins: always in the scene (intensity 0) so no shader ever recompiles
    this.light = new THREE.PointLight(0xff7a30, 0, 90, 2); this.light.position.copy(this.c); world.scene.add(this.light);
    this.ballLight = new THREE.PointLight(0xff8a3a, 0, 60, 2); world.scene.add(this.ballLight); // follows the nearest fireball
    console.info(`RIDEFRAME Belagerung bei d=${Math.round(d0)}, ${Math.round(this.roadDist)} m neben der Straße`);
  }

  /** world point beside the road at distance d, `off` metres towards the castle side */
  spot(d, off, out = new THREE.Vector3()) { const p = this.f.at(d), l = Math.hypot(p.tx, p.tz) || 1; return out.set(p.x - p.tz / l * off * this.side, 0, p.z + p.tx / l * off * this.side); }

  _build() {
    this.built = true;
    const root = this.root = new THREE.Group(); root.visible = false; this.w.scene.add(root);
    const castle = this.castle, kids = castle.children.filter(o => o.isMesh), P = o => o.geometry.parameters || {}, A = this.A = this.w.events?.A || null, find = n => A?.find?.(n) || null;
    const walls = kids.filter(o => o.geometry.type === 'BoxGeometry' && Math.abs(P(o).height - 9) < .01);
    const towers = kids.filter(o => o.geometry.type === 'CylinderGeometry'), cones = kids.filter(o => o.geometry.type === 'ConeGeometry');
    this.keep = kids.find(o => o.geometry.type === 'BoxGeometry' && P(o).height >= 15) || null;
    const wp = o => o.getWorldPosition(new THREE.Vector3()), dotOut = o => { const q = wp(o).sub(this.c); q.y = 0; return q.normalize().dot(this.out); };
    const wall = walls.sort((a, b) => dotOut(b) - dotOut(a))[0];
    const tower = towers.filter(o => dotOut(o) > 0).sort((a, b) => wp(a).sub(this.c).dot(this.tan) - wp(b).sub(this.c).dot(this.tan))[0];
    const cone = tower && cones.sort((a, b) => wp(a).distanceTo(wp(tower)) - wp(b).distanceTo(wp(tower)))[0];
    this.targets = [...walls, ...towers, ...(this.keep ? [this.keep] : [])].map(o => { o.updateMatrixWorld(true); return { o, box: new THREE.Box3().setFromObject(o) }; });
    this.stoneMat = (wall || this.keep || kids[0])?.material?.clone() || new THREE.MeshStandardMaterial({ color: 0x9d9484, roughness: .95 });
    this.stoneMat.flatShading = true;
    // pieces: wall/tower blocks (box) and loose rocks + rubble heaps (dodecahedron)
    this.blocks = new Bodies(BLOCK_N, new THREE.BoxGeometry(1, 1, 1), this.stoneMat, this.ground); this.blocks.mesh.castShadow = true; this.blocks.mesh.receiveShadow = true;
    const tk = find('truemmer_klein') && assetGeo(find('truemmer_klein'), 1.2); // Blender rubble when there is some
    this.stones = new Bodies(STONE_N, tk?.g || new THREE.DodecahedronGeometry(.6, 0), tk ? tk.mat : this.stoneMat, this.ground); this.stones.mesh.receiveShadow = true;
    this.blocks.onLand = (i, vy) => this._landed(this.blocks, i, vy);
    const clear = B => i => { const r = this.f.road(B.p[i * 3], B.p[i * 3 + 2]); if (r && r.d < 9) { B.keep[i] = 0; B.bury[i] = B.r[i] * 2.4; B.t[i] = 3.5; } }; // nothing stays on or by the road
    this.blocks.onRest = clear(this.blocks); this.stones.onRest = clear(this.stones);
    const tex = puffTexture(); this.fire = new Puffs(FIRE_N, true, tex); this.smoke = new Puffs(SMOKE_N, false, tex); this.embers = new Embers(EMBER_N);
    // procedural fireballs (glowing spheres + trail + light); the Blender fireball was rejected and is being redone
    this.balls = new THREE.InstancedMesh(new THREE.SphereGeometry(.7, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.3, .6) }), BALL_N);
    this.balls.count = 0; this.balls.frustumCulled = false; this.balls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ball = Array.from({ length: BALL_N }, () => ({ on: false, p: new THREE.Vector3(), p0: new THREE.Vector3(), v: new THREE.Vector3(), tgt: new THREE.Vector3(), n: new THREE.Vector3(), t: 0, T: 1, trail: 0 }));
    root.add(this.blocks.mesh, this.stones.mesh, this.fire.mesh, this.smoke.mesh, this.embers.mesh, this.balls);
    this.timed = []; this.dustSrc = []; this.dustUntil = 0; this.flk = [];
    // flipbooks from the Mac when they exist (fall back to the puffs): [file, grid, frames, fps, anchor, additive, pool]
    this.fx = {}; const L = new THREE.TextureLoader();
    for (const [k, file, grid, frames, fps, anchor, add, n] of [['boom', 'explosion_flipbook', 8, 64, 24, [.56, .26], false, 12], ['spark', 'funken_flipbook', 8, 64, 24, [.5, .32], true, 12],
      ['dust', 'staub_flipbook', 8, 64, 24, [.5, .14], false, 10], ['ball', 'feuerkugel', 2, 4, 0, [.5, .5], true, BALL_N]])
      L.load(new URL(`../../assets/world/fx/${file}.png`, import.meta.url).href, t => { const f = this.fx[k] = new Flip(n, t, grid, frames, fps, anchor, add); this.root.add(f.mesh); }, undefined, () => {});
    this.saved = kids.map(o => ({ o, parent: o.parent, p: o.position.clone(), q: o.quaternion.clone(), vis: o.visible, mask: o.layers.mask }));
    this._planFall(wall, tower, cone);
    this._planGLB(find);
    this._planEngines();
    this._planKnights();
    layer1(root);
  }

  // ---- the collapse: a wall topples outwards above a 2.5 m stub, then the corner tower towards the rider ----
  _planFall(wall, tower, cone) {
    this.falls = [];
    const inv = this.castle.quaternion.clone().invert(), tanL = this.tan.clone().applyQuaternion(inv), outL = this.out.clone().applyQuaternion(inv);
    if (wall) {
      const P = wall.geometry.parameters, stubH = 2.5, base = wall.position.y - P.height / 2;
      const nL = new THREE.Vector3(wall.position.x, 0, wall.position.z).normalize(), thick = Math.abs(nL.x) > .7 ? P.width : P.depth;
      const top = new THREE.Mesh(new THREE.BoxGeometry(P.width, P.height - stubH, P.depth), wall.material), stub = new THREE.Mesh(new THREE.BoxGeometry(P.width, stubH, P.depth), wall.material);
      for (const m of [top, stub]) { m.castShadow = m.receiveShadow = true; m.visible = false; }
      stub.position.set(wall.position.x, base + stubH / 2, wall.position.z); this.castle.add(stub);
      const pivot = new THREE.Group(); pivot.position.set(wall.position.x, base + stubH, wall.position.z).addScaledVector(nL, thick / 2); this.castle.add(pivot);
      top.position.set(wall.position.x, base + stubH + (P.height - stubH) / 2, wall.position.z).sub(pivot.position); pivot.add(top);
      this.falls.push({ kind: 'wall', orig: [wall], show: [top, stub], pivot, parts: [top], axis: new THREE.Vector3().crossVectors(_up, nL), L: P.height - stubH, th: 0, om: 0, on: false, brk: .62, broken: false,
        dims: [P.width, P.height - stubH, P.depth], nL, base: wall.getWorldPosition(new THREE.Vector3()).setY(this.castle.position.y + base) });
    }
    if (tower) {
      const P = tower.geometry.parameters, h0 = 4, base = tower.position.y - P.height / 2, rAt = y => P.radiusBottom + (P.radiusTop - P.radiusBottom) * y / P.height;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(P.radiusTop, rAt(h0), P.height - h0, 14), tower.material), stub = new THREE.Mesh(new THREE.CylinderGeometry(rAt(h0), P.radiusBottom, h0, 14), tower.material);
      for (const m of [top, stub]) { m.castShadow = m.receiveShadow = true; m.visible = false; }
      stub.position.set(tower.position.x, base + h0 / 2, tower.position.z); this.castle.add(stub);
      const fd = outL.clone().multiplyScalar(.3).addScaledVector(tanL, -.95).normalize(); // back towards the rider, a little outwards
      const pivot = new THREE.Group(); pivot.position.set(tower.position.x, base + h0, tower.position.z).addScaledVector(fd, rAt(h0)); this.castle.add(pivot);
      top.position.set(tower.position.x, base + h0 + (P.height - h0) / 2, tower.position.z).sub(pivot.position); pivot.add(top);
      const parts = [top]; let coneOrig = null;
      if (cone) { coneOrig = { p: cone.position.clone() }; parts.push(cone); }
      this.falls.push({ kind: 'tower', orig: [tower], show: [top, stub], pivot, parts, cone, coneOrig, axis: new THREE.Vector3().crossVectors(_up, fd), L: P.height - h0 + 5, th: 0, om: 0, on: false, brk: .75, broken: false,
        dims: [rAt(h0), P.height - h0, P.radiusTop], nL: fd, base: tower.getWorldPosition(new THREE.Vector3()).setY(this.castle.position.y + base) });
    }
  }

  // ---- Blender pieces when present: pre-fractured tower / wall breach (baked 'Einsturz'), ladders on the wall, battering ram ----
  // turm_einsturz: axis >= 22 m from the road, +Z to the road, mirrored (scale.x -1) so it falls away from the castle;
  // impact .33 s at (3.6, 1.8, 2.5), tilts from .83 s, crown down at 2.3 s, rest 4.6 s, falls along (.82, 0, .57).
  // mauer_bresche: 20 x 2.2 x 10.5 m, impact .33 s bottom centre, crown breaks .67-1.25 s, rest 4.6 s, outer pieces stay.
  _planGLB(find) {
    const q = this.castle.quaternion;
    for (const [name, kind] of [['turm_einsturz', 'tower'], ['mauer_bresche', 'wall']]) {
      const e = find(name), f = this.falls.find(x => x.kind === kind); if (!e || !f) continue;
      const { obj, mixer } = this.A.make(e); flickers(obj, this.flk);
      const clip = this.A.clip(e, 'Einsturz') || e.clips[0], x = e.extras || e.timing || {}, dur = clip?.duration || 5;
      const pos = f.base.clone(), toRoad = this.out.clone();
      if (kind === 'tower') { const r = this.f.road(pos.x, pos.z); if (r && r.d < 22) pos.addScaledVector(toRoad, -(22 - r.d)); pos.y = this.ground(pos.x, pos.z); obj.scale.x = -1; obj.rotation.y = Math.atan2(toRoad.x, toRoad.z); }
      else { const n = f.nL.clone().applyQuaternion(q); obj.rotation.y = Math.atan2(n.x, n.z); }
      obj.position.copy(pos); this.root.add(obj); obj.updateMatrixWorld(true);
      let act = null;
      if (mixer) { mixer.stopAllAction(); for (const c of ['Intakt', 'Wehen']) { const k = this.A.clip(e, c); if (k) mixer.clipAction(k).play(); } if (clip) { act = mixer.clipAction(clip); act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; } mixer.update(0); }
      const batches = batchPieces(obj); for (const b of batches) this.root.add(b.bm); // ~100 pieces: one draw call per material
      const T = v => secs(v, e, dur), dir = (kind === 'tower' ? new THREE.Vector3(-.82, 0, .57) : new THREE.Vector3(0, 0, 1)).applyQuaternion(obj.quaternion).normalize(); // fall line (tower mirrored)
      const hit = obj.localToWorld(kind === 'tower' ? new THREE.Vector3(3.6, 1.8, 2.5) : new THREE.Vector3(0, 1, 1.1));
      const rd = this.f.road(pos.x, pos.z);
      f.glb = { e, obj, mixer, act, batches, intact: mixer && this.A.clip(e, 'Intakt') && mixer.clipAction(this.A.clip(e, 'Intakt')), t: -1, foot: pos.clone(), dir, hit, dT: rd ? rd.i * 2.5 : this.d0,
        impact: T(x.impact) ?? .33, fall: T(x.fall_start) ?? (kind === 'tower' ? .83 : .67), crown: T(x.crown) ?? (kind === 'tower' ? 2.3 : 1.25), rest: T(x.rest) ?? 4.6 };
      f.hide = [...f.orig, ...(f.cone ? [f.cone] : [])]; f.hide.forEach(o => { o.visible = false; });
    }
    this.props = [];
    const W = this.falls.find(f => f.kind === 'wall'); if (!W) return;
    const n = W.nL.clone().applyQuaternion(q), along = new THREE.Vector3().crossVectors(_up, n), face = W.base.clone().addScaledVector(n, Math.min(W.dims[0], W.dims[2]) / 2);
    const top = W.base.y + W.L + 2.5, lad = find('leiter'), ram = find('rammbock');
    if (lad) for (const a of [-6, 5]) { // hook (local y 9.13, z -2.97) on the wall crown
      const { obj } = this.A.make(lad); obj.rotation.y = Math.atan2(n.x, n.z);
      obj.position.copy(face).addScaledVector(along, a).setY(top).sub(_v.set(0, 9.13, -2.97).applyAxisAngle(_up, obj.rotation.y));
      this.root.add(obj); this.props.push({ obj, wall: true, p: obj.position.clone(), q: obj.quaternion.clone() });
    }
    if (ram) {
      const { obj } = this.A.make(ram); applyFlames(flickers(obj, this.flk)); obj.rotation.y = Math.atan2(n.z, -n.x); // head (+X) into the wall
      const p = face.clone().addScaledVector(along, 1.5).addScaledVector(n, (ram.size?.[0] || 6) / 2 + .2); p.y = this.ground(p.x, p.z); obj.position.copy(p); this.root.add(obj);
      let morph = null; obj.traverse(o => { const i = o.morphTargetDictionary?.Stoss; if (i !== undefined && !morph) morph = { o, i }; });
      this.props.push({ obj, ram: morph, p: p.clone(), q: obj.quaternion.clone() });
    }
  }
  _glbStart(f, synced = false) { // play the baked collapse: impact, dust at the foot, dust along the fall line when the crown lands
    const g = f.glb; if (!g || g.t >= 0) return; f.on = true; g.t = 0; g.intact?.stop(); g.act?.reset().play();
    const tower = f.kind === 'tower', n = g.dir, t0 = this.t, at = (s, fn) => this.timed.push({ at: t0 + s, fn });
    if (!synced) at(g.impact, () => this._boom(g.hit, n, 1.1));
    at(.5, () => { this._dust(g.foot, 20, 0); this.dustSrc.push(g.foot.clone().setY(g.foot.y + 1)); this.dustUntil = Math.max(this.dustUntil, this.t + g.rest + 2); });
    at(g.crown - .15, () => { for (const [k, o] of (tower ? [[7, 0], [11, .1], [16, .2]] : [[4, 0], [8, .12]])) {
      const p = g.foot.clone().addScaledVector(n, k); p.y = this.ground(p.x, p.z); this._dust(p, rnd(22, 25) * (tower ? 1 : .8), o); this.dustSrc.push(p); }
      const p = g.foot.clone().addScaledVector(n, tower ? 11 : 6); p.y = this.ground(p.x, p.z) + 1; this.landed = 5; this._landed({ p: [p.x, p.y, p.z] }, 0, 9); // shock + dust ring
      if (!tower) for (const p of this.props) if (p.wall) p.obj.visible = false; });
    at(g.rest, () => { const p = g.foot.clone().addScaledVector(n, tower ? 11 : 4); p.y = this.ground(p.x, p.z); this.ruinFires ||= []; this.ruinFires.push(p.clone().setY(p.y + .6), g.foot.clone().setY(g.foot.y + 2)); this.ruinLight ||= p.clone().setY(p.y + 4); });
  }
  /** a dust flipbook (or a few big puffs without one) */
  _dust(p, size, delay) {
    const D = this.fx.dust;
    if (D) D.put(p.x, p.y, p.z, size, -delay * 24, 24, 48);
    else for (let k = 0; k < 6; k++) { const g = rnd(.32, .42); this.smoke.spawn(p.x + rnd(-3, 3), p.y + rnd(0, 2), p.z + rnd(-3, 3), rnd(-2, 2), rnd(.5, 1.5), rnd(-2, 2), rnd(5, 7), size * .3, size * .8, .7, 0, g, g * .9, g * .78, .1, .6); }
  }

  // ---- catapults on the attackers' side (Blender models if placed, else simple wooden ones) and hidden ones across the road ----
  _planEngines() {
    const A = this.A, glb = !!(A?.find?.('katapult') || A?.find?.('tribok'));
    this.launchers = [];
    const aim = this.c.clone().addScaledVector(this.out, 12);
    // the catapult / trebuchet models placed by lofoten.js: turn them to the castle (throw is +X) and drive their 'Wurf'
    const placed = (this.w.props || []).filter(o => /katapult|tribok/.test(o.userData.asset || '') && Math.hypot(o.position.x - this.c.x, o.position.z - this.c.z) < 170);
    for (const o of placed) {
      const e = A.list.find(x => x.file === o.userData.asset), mixer = this.w.mixers.find(m => m.obj === o), clip = e && A.clip(e, 'Wurf');
      o.rotation.y = Math.atan2(-(aim.z - o.position.z), aim.x - o.position.x); mixer?.stopAllAction();
      this.launchers.push({ kind: 'glb', o, arm: o.getObjectByName('wurfarm'), mixer, clip, rel: clip ? clip.duration * .45 : .17, p: o.position.clone(), next: rnd(.5, 3), fired: -9, loaded: true, pend: false });
    }
    const spots = glb ? [[-55, 16], [50, 18]] : [[-48, 17], [-78, 15]];
    if (!placed.length) for (const [dd, off] of spots) {
      const p = this.spot(this.d0 + dd, off); p.y = this.ground(p.x, p.z) - .1;
      this.launchers.push({ kind: glb ? 'glb' : 'cat', p, yaw: Math.atan2(aim.x - p.x, aim.z - p.z), next: rnd(.5, 3), fired: -9, loaded: true, pend: false });
    }
    for (let k = 0; k < 3; k++) this.launchers.push({ kind: 'far', dd: -100 + k * 55, next: rnd(1, 4), loaded: false }); // beyond the road: arcs over the rider's head
    if (!glb) {
      const { frame, arm } = catapultGeos(), wood = new THREE.MeshStandardMaterial({ color: 0x5b4130, roughness: .9 });
      this.catFrame = new THREE.InstancedMesh(frame, wood, 2); this.catArm = new THREE.InstancedMesh(arm, wood, 2);
      for (const m of [this.catFrame, this.catArm]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.root.add(m); }
      this.launchers.filter(l => l.kind === 'cat').forEach((l, i) => { l.i = i; l.M = new THREE.Matrix4().compose(l.p, new THREE.Quaternion().setFromAxisAngle(_up, l.yaw), new THREE.Vector3(1, 1, 1)); this.catFrame.setMatrixAt(i, l.M); });
    }
  }
  _armAngle(l) { // cocked -1.25 -> swing to +.3 in .22 s -> hold -> wind back
    const t = this.t - l.fired;
    if (t < .22) return -1.25 + 1.55 * (t / .22) * (t / .22);
    if (t < .7) return .3;
    return .3 - 1.55 * sstep(.7, 2.8, t);
  }
  _glbTip(l, out) { // top of the throwing arm at release
    if (!l.arm) return out.copy(l.p).setY(l.p.y + 6);
    l.o.updateMatrixWorld(true); _box.setFromObject(l.arm); _box.getCenter(out); out.y = _box.max.y; return out;
  }
  _tip(l, a, out) { _m2.makeRotationX(a); _m2.setPosition(0, 3.1, .4); return out.set(0, 4.3, 0).applyMatrix4(_m2).applyMatrix4(l.M); }

  // ---- knights: wait in the camp, then storm towards the walls, keyed to the rider's distance ----
  _planKnights() {
    const A = this.A, names = ['ritter', 'wache', 'soldat', 'bogenschuetze', 'reiter_ritter'].map(n => A?.find?.(n)).filter(Boolean);
    this.kn = [];
    const fw = this.falls.find(f => f.kind === 'wall'), wallC = fw ? fw.base.clone().addScaledVector(fw.nL.clone().applyQuaternion(this.castle.quaternion), 2.2) : this.c.clone().addScaledVector(this.out, 15);
    const along = fw ? new THREE.Vector3().crossVectors(_up, fw.nL.clone().applyQuaternion(this.castle.quaternion)) : this.tan.clone();
    const n = names.length ? 6 : KNIGHT_N;
    for (let i = 0; i < n; i++) {
      const back = Math.random() < .72, s = new THREE.Vector3();
      for (let tries = 0; tries < 8; tries++) { // the camp: on the bank between road and castle, never on the asphalt
        s.copy(this.c).addScaledVector(this.out, Math.min(this.roadDist - 8, rnd(14, 26))).addScaledVector(this.tan, back ? -rnd(30, 70) : rnd(22, 45));
        const r = this.f.road(s.x, s.z); if (!r || r.d > 7.5) break;
      }
      const tgt = wallC.clone().addScaledVector(along, rnd(-9, 9));
      const k = { start: s.clone(), p: s.clone(), tgt, yaw: 0, st: 'wait', trig: this.d0 - WAR + 40 + (i / n) * (WAR - 80) + rnd(-15, 15), v: rnd(2.3, 3.4), ph: rnd(0, 6), lean: 0, vy: 0, vel: new THREE.Vector3(), spin: 0, t: 0,
        col: [0x8a1c1c, 0x23407a, 0x6b6f75, 0x7a5a1c][i % 4] };
      k.yaw = Math.atan2(tgt.x - s.x, tgt.z - s.z);
      if (names.length) { const { obj, mixer } = A.make(names[i % names.length], 'Rennen'); applyFlames(flickers(obj, this.flk)); k.obj = obj; k.mixer = mixer; k.e = names[i % names.length]; obj.rotation.order = 'YXZ'; this.root.add(obj); }
      this.kn.push(k);
    }
    if (!names.length) {
      const mat = new THREE.MeshStandardMaterial({ roughness: .55, metalness: .25 });
      const body = new THREE.CapsuleGeometry(.27, .72, 3, 8); body.translate(0, 1.42, 0);
      this.kBody = new THREE.InstancedMesh(body, mat, n); this.kPart = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, n * PARTS);
      for (const m of [this.kBody, this.kPart]) { m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.root.add(m); }
      this.kn.forEach((k, i) => {
        this.kBody.setColorAt(i, _c.setHex(k.col));
        [0x3a3430, 0x3a3430, 0xb9bec6, i % 2 ? 0xd8cfb8 : 0xc9a53a, 0x6b4a2c].forEach((c, j) => this.kPart.setColorAt(i * PARTS + j, _c.setHex(c)));
      });
    }
  }

  // ---- per frame ----
  update(time, dt, cam, d) {
    const inWin = d > this.d0 - NEAR && d < this.d0 + AFTER;
    if (!inWin) {
      if (this.active) { this.active = false; this.root.visible = false; this.light.intensity = 0; }
      if (this.built && d < this.d0 - NEAR - 50 && this.state !== 'idle') this._reset();
      this.lastD = d; return;
    }
    if (!this.built) this._build();
    if (!this.active) this._activate(d);
    const jump = this.lastD !== null && Math.abs(d - this.lastD) > 60; this.lastD = d;
    if (this.w.instant && !this.prewarmed) return this._prewarm(d);
    if (jump && d < this.d0 - NEAR + 100 && this.state !== 'idle') this._reset();
    this._decide(d, jump);
    this._step(Math.min(dt, .1), d);
  }
  _activate(d) {
    this.active = true;
    for (const k of this.kn) if (k.st === 'wait' && d >= k.trig) this._advanceKnight(k, (d - k.trig) / 5); // ride-in from elsewhere: put the ones already running on their way
    if (this.w.instant || this.compiled) { this.root.visible = true; return; }
    this.compiled = true; // compile shaders ahead (still ~900 m away), show once ready
    const show = () => { if (this.active) this.root.visible = true; };
    try { this.w.renderer.compileAsync(this.root, this.w.camera, this.w.scene).then(show, show); } catch { show(); }
    setTimeout(show, 2500);
  }
  _decide(d, jump) {
    if (this.state === 'idle' && d >= this.d0 - WAR) this.state = 'war';
    const rel = this.d0 - d, trig = Math.max(45, Math.min(80, (this.w.speed || 6) * 5.5));
    const T = this.falls.find(f => f.kind === 'tower' && f.glb), g = T?.glb;
    if (g && g.t < 0 && !g.armed && !jump) { // baked tower: clip starts 12 m + 2.3 s x v before it, a fireball from across the road hits at .33 s
      const v = Math.max(3, this.w.speed || 6), relT = g.dT - d, Tf = 2.2;
      if (relT <= 12 + v * (g.crown + Tf - g.impact) && relT > -20) {
        g.armed = true; const q = this.spot(g.dT + 25, -rnd(70, 85), new THREE.Vector3()); q.y = Math.max(0, this.f.height(q.x, q.z)) + 2;
        this._launch(q, g.hit, Tf); this.timed.push({ at: this.t + Tf - g.impact, fn: () => this._glbStart(T, true) });
      }
    }
    if ((this.state === 'war' || this.state === 'idle') && rel <= trig) {
      if (jump || rel < trig - 50) { this.silent = true; this._collapse(); if (g && g.t < 0) this._glbStart(T); for (let k = 0; k < 300; k++) this._step(1 / 30, d); this.silent = false; } // jumped past: show the ruins
      else this._collapse();
    }
  }
  _prewarm(d) { // headless screenshot (one frame): simulate the last seconds; &siege=<s> sets how many
    this.prewarmed = true; this.silent = true;
    const rel = this.d0 - d, pre = QS.has('siege') ? +QS.get('siege') : null;
    if (d >= this.d0 - WAR) this.state = 'war';
    const T = this.falls.find(f => f.kind === 'tower' && f.glb);
    if (rel <= 60) { this._collapse(); if (T) this.timed.push({ at: this.t + .6, fn: () => this._glbStart(T) }); this._run(pre ?? 12, d); }
    else if (this.state === 'war') this._run(pre ?? 7, d);
    this.silent = false; this._write();
  }
  _run(sec, d) { for (let k = 0, n = Math.round(sec * 30); k < n; k++) this._step(1 / 30, d, k < n - 1); }
  _reset() {
    for (const s of this.saved) { s.parent.add(s.o); s.o.position.copy(s.p); s.o.quaternion.copy(s.q); s.o.visible = s.vis; s.o.layers.mask = s.mask; }
    for (const f of this.falls) { f.th = f.om = 0; f.on = f.broken = false; f.pivot.quaternion.identity(); f.show.forEach(m => { m.visible = false; }); }
    for (const f of this.falls) { f.hide?.forEach(o => { o.visible = false; }); if (f.glb) { f.glb.t = -1; f.glb.armed = false; f.glb.act?.stop(); f.glb.intact?.play(); f.glb.mixer?.update(0); f.glb.obj.updateMatrixWorld(true); syncPieces(f.glb.batches); } }
    for (const k in this.fx) this.fx[k].n = 0;
    for (const p of this.props) { this.root.attach(p.obj); p.obj.position.copy(p.p); p.obj.quaternion.copy(p.q); p.obj.visible = true; }
    this.timed.length = 0; this.dustSrc.length = 0; this.dustUntil = 0; this.ruinFires = null; this.ruinLight = null;
    for (const k of this.kn) { k.p.copy(k.start); k.st = 'wait'; k.lean = 0; k.t = 0; if (k.obj) k.obj.visible = true; k.yaw = Math.atan2(k.tgt.x - k.p.x, k.tgt.z - k.p.z); }
    for (const b of this.ball) b.on = false;
    for (const l of this.launchers) { l.next = rnd(.5, 3); l.loaded = l.kind !== 'far'; l.pend = false; l.fired = -9; }
    this.blocks.clear(); this.stones.clear(); this.fire.clear(); this.smoke.clear(); this.embers.clear();
    this.state = 'idle'; this.ft = 0; this.ev = 0; this.flash = 0; this.dustT = 0; this.breach = null;
  }

  _step(dt, d, quiet = false) {
    this.t += dt; this._dt = dt;
    const wx = .9, wz = .4; // light breeze for smoke and embers
    if (this.state === 'war') this._war(dt, d);
    if (this.state === 'fall' || this.state === 'ruin') this._fall(dt);
    if (this.ruinFires && (this.state === 'ruin' || this.state !== 'fall')) this._ruinFires(dt);
    for (let i = 0; i < this.timed.length; i++) if (this.t >= this.timed[i].at) { const e = this.timed[i]; this.timed.splice(i--, 1); e.fn(); }
    for (const f of this.falls) if (f.glb) { const g = f.glb; g.mixer?.update(dt); // flag waves; pieces move only while it falls
      if (g.t >= 0) { g.t += dt; if (g.t < g.rest + 1 && g.batches.length) { g.obj.updateMatrixWorld(true); syncPieces(g.batches); } } }
    for (const p of this.props) if (p.ram) p.ram.o.morphTargetInfluences[p.ram.i] = this.state === 'war' ? Math.pow(Math.max(0, Math.sin(this.t * 1.4)), 3) : 0;
    flameTime.value = this.t;
    for (const f of this.flk) f.o.morphTargetInfluences[f.i] = .5 + .5 * Math.sin(this.t * 13 + f.ph) * Math.sin(this.t * 7.7 + f.ph * 2);
    if (this.t < this.dustUntil && this.dustSrc.length) { this.dustT += dt; while (this.dustT > .06) { this.dustT -= .06; const s = this.dustSrc[Math.floor(Math.random() * this.dustSrc.length)], g = rnd(.3, .42); // the dust cloud swallows the pieces
      this.smoke.spawn(s.x + rnd(-6, 6), s.y + rnd(0, 3), s.z + rnd(-6, 6), rnd(-1.5, 1.5), rnd(.6, 2), rnd(-1.5, 1.5), rnd(6, 9), rnd(5, 8), rnd(17, 28), .75, 0, g, g * .9, g * .78, .15, .5); } }
    this._knights(dt, d);
    this._balls(dt);
    this.blocks.step(dt); this.stones.step(dt);
    for (const k of ['boom', 'spark', 'dust']) this.fx[k]?.step(dt);
    this.fire.step(dt, wx, wz); this.smoke.step(dt, wx * 1.6, wz * 1.6); this.embers.step(dt, this.t, wx, wz);
    this.flash *= Math.exp(-dt * 6.5);
    let I = this.flash;
    if (this.ruinLight && (this.state !== 'fall' || this.ft > 2.5)) { // burning ruins: flicker
      const fl = .75 + .25 * Math.sin(this.t * 17) * Math.sin(this.t * 7.3 + 1) + .1 * Math.sin(this.t * 31);
      if (380 * fl > I) { I = 380 * fl; this.light.position.copy(this.ruinLight); }
    }
    this.light.intensity = I;
    if (!quiet) this._write();
  }
  _write() {
    const cam = this.w.camera, fog = this.w.scene.fog;
    this.fire.write(cam, fog.color, fog.density); this.smoke.write(cam, fog.color, fog.density);
    this.blocks.write(); this.stones.write();
    this.w.renderer.getDrawingBufferSize(_px); this.embers.mat.uniforms.uScale.value = _px.y / (2 * Math.tan(cam.fov * Math.PI / 360));
    for (const k of ['boom', 'spark', 'dust']) this.fx[k]?.write(fog.color, fog.density);
    // fireballs in flight (+ glow sprite, + the light on the nearest) and the ones lying burning in the catapult cups
    let n = 0, near = 1e9; _q.identity(); _s.set(1, 1, 1); const BS = this.fx.ball; if (BS) BS.n = 0; this.ballLight.intensity = 0;
    for (let i = 0; i < this.ball.length; i++) { const b = this.ball[i];
      if (!b.on) continue;
      _m.compose(b.p, _q, _s); this.balls.setMatrixAt(n++, _m);
      BS?.put(b.p.x, b.p.y, b.p.z, 2, Math.floor((this.t + i * .37) / .08) % 4, 0);
      const dc = b.p.distanceToSquared(cam.position); if (dc < near) { near = dc; this.ballLight.position.copy(b.p); this.ballLight.intensity = 400; } }
    BS?.write(fog.color, fog.density);
    for (const l of this.launchers) if (l.kind === 'cat') {
      const a = this._armAngle(l); _m2.makeRotationX(a); _m2.setPosition(0, 3.1, .4); _m3.multiplyMatrices(l.M, _m2); this.catArm.setMatrixAt(l.i, _m3);
      if (l.loaded && this.state === 'war' && n < BALL_N) { this._tip(l, a, _v2); _v2.y += .45; _m.compose(_v2, _q, _s.set(.8, .8, .8)); this.balls.setMatrixAt(n++, _m); _s.set(1, 1, 1); }
    }
    this.balls.count = n; this.balls.instanceMatrix.needsUpdate = true;
    if (this.catArm) this.catArm.instanceMatrix.needsUpdate = true;
    this._writeKnights();
  }

  // ---- bombardment ----
  _war(dt, d) {
    const close = Math.max(0, Math.min(1, (d - (this.d0 - WAR)) / (WAR - 80)));
    for (const l of this.launchers) {
      if (l.kind === 'cat' || l.kind === 'glb') {
        if (l.pend && this.t - l.fired >= (l.rel || .17)) { l.pend = false; this._launch(l.kind === 'cat' ? this._tip(l, 0, _v2) : this._glbTip(l, _v2)); }
        if (this.t >= l.next) { l.fired = this.t; l.pend = true; l.loaded = false; if (l.clip && l.mixer) { const a = l.mixer.clipAction(l.clip); a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.reset().play(); } l.next = this.t + rnd(4.2, 6.5) - 2.2 * close; }
        if (!l.loaded && this.t - l.fired > 2.9) l.loaded = true;
        if (l.loaded && l.kind === 'cat' && Math.random() < dt * 14) { this._tip(l, this._armAngle(l), _v2); this.fire.spawn(_v2.x, _v2.y + .6, _v2.z, rnd(-.3, .3), rnd(1, 2), rnd(-.3, .3), rnd(.3, .5), rnd(.6, 1), .2, .8, 1); }
      } else if (this.t >= l.next) { // across the road, out of sight
        l.next = this.t + rnd(3.5, 6) - 2 * close;
        const q = this.spot(this.d0 + l.dd + rnd(-15, 15), -rnd(70, 95), _v2); q.y = Math.max(0, this.f.height(q.x, q.z)) + 2; this._launch(q);
      }
    }
  }
  _launch(from, tgt = null, TT = 0) {
    const b = this.ball.find(x => !x.on); if (!b) return;
    _v.subVectors(from, tgt || this.c).setY(0).normalize(); // hit the face the fireball comes from
    if (tgt) b.tgt.copy(tgt);
    else {
      const tg = this.targets[Math.floor(Math.random() * this.targets.length)];
      _box.copy(tg.box); _box.getCenter(b.tgt); _box.getSize(_v3);
      b.tgt.x += rnd(-.4, .4) * _v3.x; b.tgt.y += rnd(-.2, .4) * _v3.y; b.tgt.z += rnd(-.4, .4) * _v3.z;
      _v.subVectors(from, b.tgt).setY(0).normalize();
      _ray.origin.copy(b.tgt).addScaledVector(_v, 60); _ray.direction.copy(_v).negate();
      if (_ray.intersectBox(_box, _v3)) b.tgt.copy(_v3);
    }
    b.n.copy(_v); b.p.copy(from); b.p0.copy(from);
    const T = b.T = TT || Math.max(2.2, Math.min(4, from.distanceTo(b.tgt) / 26)); b.t = 0; b.on = true; b.trail = 0;
    b.v.subVectors(b.tgt, from).divideScalar(T); b.v.y += .5 * G * T;
    this._sfx('fireball', from, .5);
  }
  _balls(dt) {
    for (const b of this.ball) if (b.on) {
      b.t += dt;
      if (b.t >= b.T) { b.on = false; this._boom(b.tgt, b.n, rnd(.35, .55)); continue; }
      const px = b.p.x, py = b.p.y, pz = b.p.z, t = b.t;
      b.p.copy(b.p0).addScaledVector(b.v, t); b.p.y -= .5 * G * t * t; // ballistic arc that lands exactly on the target
      b.trail += Math.hypot(b.p.x - px, b.p.y - py, b.p.z - pz);
      while (b.trail > .7) { b.trail -= .7; const k = b.trail / .7;
        const x = b.p.x + (px - b.p.x) * k, y = b.p.y + (py - b.p.y) * k, z = b.p.z + (pz - b.p.z) * k;
        this.fire.spawn(x, y, z, rnd(-.4, .4), rnd(-.2, .6), rnd(-.4, .4), rnd(.25, .45), rnd(1.4, 2), .3, .9, 1.05);
        if (Math.random() < .4) this.smoke.spawn(x, y, z, rnd(-.3, .3), rnd(0, .5), rnd(-.3, .3), rnd(1.4, 2.2), .8, rnd(2.5, 3.6), .4, .5, .06, .055, .05, .3, .8);
        if (Math.random() < .25) this.embers.spawn(x, y, z, rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), rnd(.5, 1));
      }
    }
  }

  // ---- explosions ----
  _boom(p, n, P, debris = true) {
    const { fire, smoke, embers } = this, E = this.fx.boom, S = this.fx.spark;
    if (E) { const c = this.w.camera.position; _v3.subVectors(c, p).normalize(); // explosion quad on the impact point, pulled 3 m towards the camera
      E.put(p.x + _v3.x * 3, p.y + _v3.y * 3, p.z + _v3.z * 3, rnd(12, 14) * Math.min(1, .45 + P * .55)); S?.put(p.x + _v3.x * 3.2, p.y + _v3.y * 3.2, p.z + _v3.z * 3.2, rnd(10, 12) * Math.min(1, .45 + P * .55)); }
    fire.spawn(p.x, p.y, p.z, 0, 1, 0, .25, 2.5 * P, 7 * P, .9, 1.1, 0, 0, 0, 0, 1); // white-hot core
    for (let k = 0, N = Math.round((E ? 3 : 7) + (E ? 5 : 12) * P); k < N; k++) {
      const a = rnd(0, 6.28), e = rnd(-.3, 1), sp = rnd(2, 7) * P;
      fire.spawn(p.x + rnd(-1, 1) * P, p.y + rnd(-.5, 1) * P, p.z + rnd(-1, 1) * P, Math.cos(a) * sp + n.x * 3 * P, e * sp + 2.5 * P, Math.sin(a) * sp + n.z * 3 * P,
        rnd(.55, 1.1) * (.7 + .5 * P), rnd(1.2, 2.4) * P * 1.6, rnd(5, 8) * P * 1.4, .85, rnd(.75, 1), 0, 0, 0, 2.2, 2.6);
    }
    for (let k = 0, N = Math.round(4 + 9 * P); k < N; k++) {
      const g = rnd(.03, .06); smoke.spawn(p.x + rnd(-1.5, 1.5) * P, p.y + rnd(0, 1.5) * P, p.z + rnd(-1.5, 1.5) * P, rnd(-1.5, 1.5) * P + n.x * 1.5, rnd(1.5, 3.5) * P, rnd(-1.5, 1.5) * P + n.z * 1.5,
        rnd(3.5, 6), rnd(2, 3.5) * P, rnd(9, 15) * P, .88, 1, g, g * .93, g * .86, .5, 1.1);
    }
    if (debris) for (let k = 0, N = Math.round(4 + 11 * P); k < N && this.stones.n < STONE_N - 30; k++) { // keep room for the rubble heaps
      const s = rnd(.25, .8) * (.6 + .6 * P), g = rnd(.65, .95); _q.setFromAxisAngle(_v3.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(), rnd(0, 6.28));
      this.stones.add(p.x, p.y, p.z, _q, s, s * rnd(.6, 1), s, n.x * rnd(1, 4) * P + rnd(-3, 3) * P, rnd(4, 10) * P, n.z * rnd(1, 4) * P + rnd(-3, 3) * P, 12, _c.setRGB(g, g * .96, g * .9), 0);
    }
    for (let k = 0, N = Math.round(10 + 34 * P); k < N; k++) embers.spawn(p.x, p.y, p.z, rnd(-7, 7) * P, rnd(2, 10) * P, rnd(-7, 7) * P, rnd(1, 2.6));
    this.flash = Math.max(this.flash, 900 + 2600 * P); this.light.position.set(p.x + n.x * 3, p.y + 2.5, p.z + n.z * 3);
    const dist = this.w.camera.position.distanceTo(p);
    if (!this.silent) this.w.shakeImpulse = Math.max(this.w.shakeImpulse || 0, P * 1.3 * Math.max(0, 1 - dist / 260));
    this._sfx('explosion', p, Math.min(1, .35 + P * .7));
  }
  _sfx(name, p, vol) {
    if (this.silent || this.w.instant) return;
    const cam = this.w.camera, dist = cam.position.distanceTo(p) || 1; _v3.set(1, 0, 0).applyQuaternion(cam.quaternion);
    this.w.events?.sfx?.(name, vol * Math.max(0, 1 - dist / 700), Math.max(-1, Math.min(1, ((p.x - cam.position.x) * _v3.x + (p.z - cam.position.z) * _v3.z) / dist)));
  }

  // ---- the collapse ----
  _collapse() {
    if (this.state === 'fall' || this.state === 'ruin') return;
    this.state = 'fall'; this.ft = 0; this.ev = 0; this.dustT = 0; this.landed = 0;
    for (const b of this.ball) if (b.on) { b.on = false; this._boom(b.tgt, b.n, .4); }
    const q = this.castle.quaternion, W = this.falls.find(f => f.kind === 'wall'), T = this.falls.find(f => f.kind === 'tower');
    const at = (f, k, h) => f ? f.base.clone().addScaledVector(f.nL.clone().applyQuaternion(q), k).setY(f.base.y + h) : this.c.clone().setY(this.c.y + h);
    const wn = W ? W.nL.clone().applyQuaternion(q) : this.out.clone(), tn = T ? T.nL.clone().applyQuaternion(q) : this.out.clone();
    const along = new THREE.Vector3().crossVectors(_up, wn);
    // [time, position, outward normal, power, action]
    this.sched = [
      [0, at(W, 1.4, 1.5), wn, 1.1, () => W?.glb ? this._glbStart(W) : this._startFall(W, .32)],
      [.42, at(W, 1, 6).addScaledVector(along, 7), wn, .7],
      [.75, at(W, 1, 3).addScaledVector(along, -8), wn, .6],
      ...(T?.on || T?.glb ? [] : [[1.15, at(T, 2, 2), tn, 1.15, () => T?.glb ? this._glbStart(T) : this._startFall(T, .22)], [1.9, at(T, 1, 9), tn, .8]]),
      [2.7, this.keep ? this.keep.getWorldPosition(new THREE.Vector3()).setY(this.c.y + 16) : this.c.clone().setY(this.c.y + 12), this.out, .65],
    ];
    // where the ruins burn afterwards
    this.ruinFires = [...(this.ruinFires || []), at(W, 3.5, .8).addScaledVector(along, 4), at(W, 3, .6).addScaledVector(along, -6), at(T, 9, .6), at(T, 0, 4.2)];
    if (this.keep) this.ruinFires.push(this.keep.getWorldPosition(new THREE.Vector3()).setY(this.c.y + 20.2));
    this.ruinLight = at(W, 5, 4); if (W) this.dustSrc.push(at(W, 2, 1)); this.dustUntil = this.t + 9;
    for (const k of this.kn) if (k.st === 'fight' || k.st === 'run') { // thrown by the blast, or cheering
      const dw = W ? _v.subVectors(k.p, at(W, 0, 0)).dot(wn) : 99;
      if (dw > -2 && dw < 9 && k.p.distanceTo(at(W, 0, 0)) < 16) { k.st = 'fly'; k.vel.copy(wn).multiplyScalar(rnd(1.5, 3.5)).addScaledVector(along, rnd(-4, 4)); k.vy = rnd(6, 10); k.spin = rnd(4, 9) * (Math.random() < .5 ? -1 : 1); }
      else { k.st = 'cheer'; k.t = 0; }
    }
  }
  _startFall(f, om) { if (!f || f.on) return; f.on = true; this.castle.updateMatrixWorld(true); if (f.cone) f.pivot.attach(f.cone); f.om = om; f.th = .02; f.orig.forEach(o => { o.visible = false; }); f.show.forEach(m => { m.visible = true; }); if (f.kind === 'wall') for (const p of this.props) if (p.wall) f.pivot.attach(p.obj); }
  _fall(dt) {
    this.ft += dt;
    while (this.ev < this.sched.length && this.ft >= this.sched[this.ev][0]) { const [, p, n, P, fn] = this.sched[this.ev++]; this._boom(p, n, P); fn?.(); }
    for (const f of this.falls) if (f.on && !f.broken && !f.glb) { // a toppling rod about its base: th'' = 3g / 2L sin th
      f.om += 1.5 * G / f.L * Math.sin(f.th) * dt; f.th += f.om * dt;
      f.pivot.quaternion.setFromAxisAngle(f.axis, f.th);
      if (f.th >= f.brk) this._shatter(f);
    }
    if (this.ft > 2.2 && this.state === 'fall') this._ruinFires(dt);
    if (this.state === 'fall' && this.ft > 9) this.state = 'ruin';
  }
  _shatter(f) {
    f.broken = true; f.pivot.updateMatrixWorld(true);
    const kW = _v2.copy(f.axis).applyQuaternion(this.castle.quaternion).multiplyScalar(f.om).clone(), pv = f.pivot.getWorldPosition(new THREE.Vector3());
    const top = f.parts[0], wq = top.getWorldQuaternion(new THREE.Quaternion()), local = new THREE.Vector3(), wpos = new THREE.Vector3(), vel = new THREE.Vector3();
    const piece = (lx, ly, lz, sx, sy, sz) => {
      wpos.set(lx, ly, lz).applyMatrix4(top.matrixWorld); vel.crossVectors(kW, local.subVectors(wpos, pv));
      const g = rnd(.82, 1.05); this.blocks.add(wpos.x, wpos.y, wpos.z, wq, sx * rnd(.86, .95), sy * rnd(.86, .95), sz * rnd(.86, .95),
        vel.x + rnd(-1.2, 1.2), vel.y + rnd(-.5, 1.5), vel.z + rnd(-1.2, 1.2), 2.2, _c.setRGB(g, g, g * .97), 1);
    };
    if (f.kind === 'wall') {
      const [w, h, d] = f.dims, longX = w > d, len = longX ? w : d, nx = Math.max(2, Math.round(len / 2.4)), ny = 3;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const a = -len / 2 + (i + .5) * len / nx, y = -h / 2 + (j + .5) * h / ny;
        longX ? piece(a, y, 0, len / nx, h / ny, d) : piece(0, y, a, w, h / ny, len / nx);
      }
      top.visible = false;
      for (const p of this.props) if (p.wall) p.obj.visible = false;
    } else {
      const [r0, h, r1] = f.dims, ny = 5, rr = (r0 + r1) / 2;
      for (let j = 0; j < ny; j++) for (let k = 0; k < 9; k++) if (k !== 4) piece((k % 3 - 1) * rr * .66, -h / 2 + (j + .5) * h / ny, (Math.floor(k / 3) - 1) * rr * .66, rr * .68, h / ny, rr * .68); // 8 stones per ring
      top.visible = false;
      if (f.cone) { // the roof breaks up as well
        f.cone.updateMatrixWorld(true);
        for (let k = 0; k < 7; k++) { const a = k / 7 * 6.28, y = rnd(-2, 1);
          wpos.set(Math.cos(a) * 1.8 * (1 - (y + 2.5) / 5), y, Math.sin(a) * 1.8 * (1 - (y + 2.5) / 5)).applyMatrix4(f.cone.matrixWorld); vel.crossVectors(kW, local.subVectors(wpos, pv)).multiplyScalar(.75);
          f.cone.getWorldQuaternion(_q); this.blocks.add(wpos.x, wpos.y, wpos.z, _q, rnd(1.4, 2.2), .45, rnd(1.2, 1.8), vel.x + rnd(-2, 2), vel.y + rnd(0, 2), vel.z + rnd(-2, 2), 4, _c.setRGB(.42, .3, .24), 1); }
        f.cone.visible = false;
      }
      this._boom(wpos.set(0, 0, 0).applyMatrix4(top.matrixWorld), f.nL.clone().applyQuaternion(this.castle.quaternion), .55, false);
    }
    // rubble heaps grow under the dust where it comes down
    const nW = f.nL.clone().applyQuaternion(this.castle.quaternion), yaw = Math.atan2(nW.x, nW.z), heaps = f.kind === 'wall' ? [[2.5, 0, 16, 2.6, 5], [2, 7, 7, 2.2, 5], [3.5, -7, 8, 2, 5]] : [[3, 0, 8, 3, 8], [11, 0, 6, 2.2, 6], [17, 0, 4, 1.6, 4]];
    const along = new THREE.Vector3().crossVectors(_up, nW);
    this.dustSrc ||= [];
    for (const [o, a, sx, sy, sz] of heaps) {
      const p = f.base.clone().addScaledVector(nW, o).addScaledVector(along, a); p.y = this.ground(p.x, p.z) - sy * .35;
      for (let k = 0; k < 3; k++) {
        _q.setFromEuler(new THREE.Euler(rnd(-.15, .15), yaw + rnd(-.6, .6), rnd(-.15, .15))); const g = rnd(.7, .85);
        const i = this.stones.add(p.x + rnd(-1.5, 1.5), p.y, p.z + rnd(-1.5, 1.5), _q, sx * rnd(.5, .8) / 1.2, sy / 1.2, sz * rnd(.6, .9) / 1.2, 0, 0, 0, 0, _c.setRGB(g, g * .95, g * .88), 1, 2);
        if (i >= 0) this.stones.t[i] = -k * .25 - .2;
      }
      this.dustSrc.push(p.clone().setY(p.y + sy * .4));
    }
  }
  _landed(B, i, vy) {
    if (vy < 5 || !this.state.startsWith('f')) return;
    this.landed++;
    const x = B.p[i * 3], y = B.p[i * 3 + 1], z = B.p[i * 3 + 2], g = rnd(.32, .42);
    for (let k = 0; k < 2; k++) this.smoke.spawn(x + rnd(-1, 1), y, z + rnd(-1, 1), rnd(-3, 3), rnd(.5, 2), rnd(-3, 3), rnd(4, 6), rnd(3, 5), rnd(10, 15), .6, 0, g, g * .9, g * .78, .1, 1);
    if (this.landed === 6 || this.landed === 30) { // shockwave: a ring of dust rolling out along the ground
      for (let k = 0; k < 18; k++) { const a = k / 18 * 6.28 + rnd(-.1, .1), sp = rnd(9, 14), qx = x + Math.cos(a) * 3, qz = z + Math.sin(a) * 3, gg = rnd(.36, .46);
        this.smoke.spawn(qx, this.ground(qx, qz) + 1.2, qz, Math.cos(a) * sp, rnd(.2, .8), Math.sin(a) * sp, rnd(3.5, 5), rnd(3, 4), rnd(9, 13), .55, 0, gg, gg * .9, gg * .8, .05, 1.1); }
      if (!this.silent) this.w.shakeImpulse = Math.max(this.w.shakeImpulse || 0, .8 * Math.max(0, 1 - this.w.camera.position.distanceTo(_v.set(x, y, z)) / 200));
      this._sfx('rumble', _v.set(x, y, z), 1);
    }
  }
  _ruinFires(dt) {
    for (let i = 0; i < this.ruinFires.length; i++) {
      const p = this.ruinFires[i];
      if (Math.random() < dt * 11) this.fire.spawn(p.x + rnd(-1.2, 1.2), p.y + rnd(0, .5), p.z + rnd(-1.2, 1.2), rnd(-.3, .3), rnd(1.5, 2.8), rnd(-.3, .3), rnd(.5, .9), rnd(.9, 1.6), rnd(.3, .6), .85, rnd(.75, 1), 0, 0, 0, 1.5, 1.2);
      if (i % 2 === 0 && Math.random() < dt * 2.6) { const g = rnd(.05, .09); this.smoke.spawn(p.x, p.y + 1.5, p.z, rnd(-.3, .3), rnd(2.5, 3.5), rnd(-.3, .3), rnd(8, 11), rnd(1.8, 2.6), rnd(10, 15), .7, .12, g, g * .95, g * .92, .25, .25); }
      if (Math.random() < dt * 4) this.embers.spawn(p.x + rnd(-1, 1), p.y + .5, p.z + rnd(-1, 1), rnd(-.6, .6), rnd(2, 4), rnd(-.6, .6), rnd(1.5, 3));
    }
  }

  // ---- knights ----
  _advanceKnight(k, sec) { k.st = 'run'; const L = k.start.distanceTo(k.tgt), s = Math.min(L, sec * k.v); k.p.lerpVectors(k.start, k.tgt, s / L); if (s >= L - .5) k.st = 'fight'; }
  _knights(dt, d) {
    for (const k of this.kn) {
      k.ph += dt * (k.st === 'run' ? k.v * 3 : 4); k.t += dt;
      if (k.st === 'wait') { if (d >= k.trig) k.st = 'run'; }
      else if (k.st === 'run') {
        _v.subVectors(k.tgt, k.p).setY(0); const L = _v.length();
        if (L < .6) { k.st = this.state === 'war' || this.state === 'idle' ? 'fight' : 'cheer'; k.t = 0; }
        else { _v.divideScalar(L); k.p.addScaledVector(_v, Math.min(L, k.v * dt)); k.yaw = Math.atan2(_v.x, _v.z); }
      } else if (k.st === 'cheer' && k.t > 2.5 && this.breach) { k.tgt.copy(this.breach).add(_v.set(rnd(-5, 5), 0, rnd(-5, 5))); k.st = 'run'; }
      else if (k.st === 'fly') {
        k.p.addScaledVector(k.vel, dt); k.vy -= G * dt; k.p.y += k.vy * dt; k.lean += k.spin * dt;
        if (k.p.y < this.ground(k.p.x, k.p.z) && k.vy < 0) { k.st = 'down'; k.t = (this.f.road(k.p.x, k.p.z)?.d ?? 99) < 9 ? 3 : 0; k.lean = Math.PI / 2 * Math.sign(k.spin); } // by the road: sink at once
        continue;
      } else if (k.st === 'down') { if (k.t > 3) k.p.y -= dt * .35; if (k.t > 8) k.st = 'gone'; continue; }
      if (k.st !== 'gone') k.p.y = this.ground(k.p.x, k.p.z);
    }
    if (!this.breach && this.state === 'fall') { const W = this.falls.find(f => f.kind === 'wall'); this.breach = W ? W.base.clone() : this.c.clone(); }
  }
  _writeKnights() {
    for (let i = 0; i < this.kn.length; i++) {
      const k = this.kn[i], st = k.st;
      const run = st === 'run', bob = run ? Math.abs(Math.sin(k.ph)) * .14 : st === 'cheer' ? Math.max(0, Math.sin(k.ph * 2.2)) * .5 : st === 'wait' ? Math.sin(k.ph * .4) * .02 : st === 'down' ? .25 : 0;
      const lean = st === 'fly' || st === 'down' ? k.lean : run ? .22 : st === 'fight' ? .1 + Math.max(0, Math.sin(k.ph * 1.6)) * .12 : 0;
      if (k.obj) {
        k.obj.visible = st !== 'gone'; k.obj.position.set(k.p.x, k.p.y + bob * .3, k.p.z); k.obj.rotation.set(lean, k.yaw, 0);
        if (k.mixer && k.anim !== st && CLIPS[st]) { k.anim = st; const n = CLIPS[st].find(n => this.A.clip(k.e, n)), c = n && this.A.clip(k.e, n); if (c) { k.mixer.stopAllAction(); const a = k.mixer.clipAction(c); a.timeScale = n === 'Trab' ? 1.7 : 1; a.play(); } }
        if (st !== 'gone' && st !== 'down') k.mixer?.update(Math.min(.1, this._dt || 1 / 60));
        continue;
      }
      if (st === 'gone') _m.makeScale(0, 0, 0);
      else { _q.setFromAxisAngle(_up, k.yaw); _q2.setFromAxisAngle(_v.set(1, 0, 0), lean); _q.multiply(_q2); _m.compose(_v2.set(k.p.x, k.p.y + bob, k.p.z), _q, _s.set(.88, .88, .88)); }
      this.kBody.setMatrixAt(i, _m);
      const sw = run ? Math.sin(k.ph) * .75 : st === 'cheer' ? .2 : 0, jab = st === 'fight' ? Math.max(0, Math.sin(k.ph * 1.6)) * .5 : 0, up = st === 'cheer' ? -.9 : 0;
      const part = (j, ox, oy, oz, rx, py, sx, sy, sz) => {
        _m2.makeRotationX(rx); _m2.setPosition(ox, oy, oz); _m3.makeTranslation(0, py, 0); _m2.multiply(_m3); _m3.makeScale(sx, sy, sz); _m2.multiply(_m3);
        _m4.multiplyMatrices(_m, _m2); this.kPart.setMatrixAt(i * PARTS + j, _m4);
      };
      part(0, -.13, .9, 0, sw, -.45, .18, .9, .2); part(1, .13, .9, 0, -sw, -.45, .18, .9, .2); // legs
      part(2, 0, 2.02, 0, 0, 0, .36, .4, .38); // helmet
      part(3, -.34, 1.45, .12, 0, 0, .08, .75, .6); // shield
      part(4, .34, 1.35, .2 + jab, .95 + up, .7, .07, 2.4, .07); // spear
    }
    if (this.kBody) { this.kBody.instanceMatrix.needsUpdate = true; this.kPart.instanceMatrix.needsUpdate = true; this.kBody.count = this.kn.length; }
  }
}
