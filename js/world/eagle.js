// The Eagle of Destiny (owner 18.11.): an eagle cry, then a whole eagle flies in from behind on the right and flies alongside
// the rider, a little ahead and to the right, wings spread. It looks ahead first, then slowly turns its head to the left
// until it looks you in the eyes, holds a beat and says "I'm the Eagle of Destiny. Ride faster, you little bitch." with a
// moving beak (no text, no bubble); a smug beat, the head turns forward again, a few strong flaps, and it shoots off ahead,
// swerves left and right and is gone. When and whether: js/eaglegate.js. Lives in camera space (a child of the camera, like
// the handlebars), so the framing is the same in every view, FOV and aspect ratio.
//
// ---- model contract for the Blender side ----
// assets/world/bird/adler_nah.glb, manifest name "adler_nah", category "bird" (loaded on every graphics level above "leer").
// · a whole, detailed eagle in metres at real size (white-tailed eagle, ~2.3 m wingspan), +Y up, beak +Z, body level, wings
//   spread in the rest pose (any armature transform and bone rest rotations: everything is measured from the skinned mesh)
// · bones: root, neck, head, jaw (lower beak, its vertices weighted 100 % to jaw; opened in code about the measured hinge),
//   wing1.L wing2.L wing1.R wing2.R, tail; eyelid.L / eyelid.R optional (local X, 0 = open, ~1.0 rad = closed)
// · animations "Fliegen" (flapping) and "Gleiten" (gliding, wings spread): Gleiten while it flies alongside, Fliegen for the
//   flaps on arrival and departure. No perched pose and no folding: the wings stay spread the whole time.
// · the head's look ahead / at the camera is done in code (neck + head), the clips should leave neck / head / jaw at rest or nearly
// · the head is framed by the vertices weighted to head / jaw / eyelids, the bird by all vertices, so the origin can be anywhere
// Fallbacks: no adler_nah -> seeadler (no jaw: the head nods with the voice); no model (?fakeassets, cloud) -> a procedural
// stand-in eagle with a hinged lower beak (same node names, so one code path). ?eaglerig=real: a stand-in rigged like adler_nah.
// Audio (gitignored, delivered separately): assets/audio/eagle_cry.mp3 (~1.5 s) and assets/audio/eagle_line.mp3. Missing
// files: the cry falls back to the recorded "adler" call (sfx) or silence, the beak to a fixed syllable timing.
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import { EAGLE, pickEagleModel, synthMouth, follow, eagleFrame } from '../eaglegate.js';

const JAW_OPEN = 0.45, D = 0.9; // D: the head's distance from the camera (m) when it looks at you; the scale follows from the framing
// the clock (s from the cry): flies in, alongside looking ahead, turns its head to you, holds, speaks from T.line for the
// line's own length, a smug beat, then off (head forward, flaps, away)
const T = { in0: 1.0, in1: 3.0, turn0: 3.1, turn1: 4.4, line: EAGLE.pre, smug: 0.7, away: EAGLE.post - 0.7 }; // owner 19.11.: it arrives and turns its head at once
const sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0);
const norm = n => (n || '').toLowerCase().replace(/[^a-z0-9]/g, ''); // GLTFLoader drops '.', Blender may use '_' or 'L' / '.L'
const byName = (o, n) => { const k = norm(n); let hit = null; o.traverse(x => { if (!hit && (x.isBone || !x.isMesh) && norm(x.name) === k) hit = x; }); return hit; };
const yawQ = (a, roll = 0, pitch = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, a, roll, 'YXZ'));
/** turn bone b by the world rotation rw about its own pivot */
const turn = (b, rw) => { b.parent.getWorldQuaternion(_q2); b.quaternion.copy(_q2.clone().invert().multiply(rw).multiply(_q2).multiply(b.quaternion)); b.updateMatrixWorld(true); };

export class Eagle {
  /** world: the WorldScene (camera, canvas, events.sound, events.A) */
  constructor(world) {
    this.w = world; this.cam = world.camera; this.S = world.events?.sound || null;
    this.state = 'idle'; this.jaw = 0; this.t = 0; this.env = 0; this.peak = 0.1;
    this.pick = pickEagleModel(world.events?.A);
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('eaglerig') === 'real') this.pick = { kind: 'rig', e: null }; // test: a stand-in rigged like adler_nah
    this.audio = this._loadAudio();
  }
  get busy() { return this.state === 'play'; }
  get kind() { return this.pick.kind; }
  /** alongside you (arrived until it leaves): the ride fades the right-side HUD meanwhile */
  get perched() { return this.state === 'play' && !!this.rig && this.t >= T.in1 - 0.3 && this.t < this.tOff; }

  // ---------------- audio ----------------
  async _loadAudio() {
    const S = this.S, ctx = S?._ctx?.(); if (!ctx) return;
    const get = f => fetch('assets/audio/' + f).then(r => r.ok ? r.arrayBuffer() : null).then(b => b ? ctx.decodeAudioData(b) : null).catch(() => null);
    const [cry, line] = await Promise.all([get('eagle_cry.mp3'), get('eagle_line.mp3')]);
    this.cryBuf = cry || (S._has?.('adler') ? await S._file('adler').catch(() => null) : null); this.lineBuf = line;
  }
  _out(gain, pan) { // through the world's master (compressor), so pause / mute / destroy work as for every other sound
    const S = this.S, c = S?.ctx; if (!c || !S.master) return null;
    const g = c.createGain(), p = c.createStereoPanner(); g.gain.value = gain; p.pan.value = pan; g.connect(p).connect(S.master); return { g, p };
  }
  _play(buf, gain, pan, analyse = false) {
    const S = this.S; if (!buf || !S?.on || S.paused || !S._ctx()) return null;
    const c = S.ctx, src = c.createBufferSource(); src.buffer = buf;
    const o = this._out(gain, pan); if (!o) return null; src.connect(o.g);
    if (analyse) { const an = c.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0; src.connect(an); this.an = an; this.anBuf = new Float32Array(an.fftSize); }
    src.start(); (this.srcs ||= []).push(src); return src;
  }
  _cry(vol = 0.9, pan = 0.7) { this._play(this.cryBuf, vol, pan); }
  /** a soft rush of air as it arrives and as it leaves (owner 19.11.: "den Whoosh leiser"): filtered noise, 1.6 s swell */
  _whoosh(vol = 0.09, pan = 0.5) {
    const S = this.S; if (!S?.on || S.paused || !S._ctx() || !S.buf?.brown) return;
    const c = S.ctx, o = this._out(0, pan); if (!o) return;
    const src = c.createBufferSource(); src.buffer = S.buf.brown; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.7; const now = c.currentTime;
    o.g.gain.setValueAtTime(0, now); o.g.gain.linearRampToValueAtTime(vol, now + 0.7); o.g.gain.linearRampToValueAtTime(0, now + 1.6);
    src.connect(f).connect(o.g); src.start(); src.stop(now + 1.7); (this.srcs ||= []).push(src);
  }
  _line() {
    const S = this.S, live = !!(this.lineBuf && S?.on && S.voicesOn !== false && !S.paused && S.ctx?.state === 'running');
    this.L = this.lineBuf ? this.lineBuf.duration : EAGLE.line; this.an = null;
    if (live) this._play(this.lineBuf, 1.5, 0.45, true);
    this.synth = !this.an; // no recording, muted voices or a suspended context: the fixed syllable timing moves the beak
    window.dispatchEvent(new Event('rf-voice')); // the music ducks
  }
  _mouth(dt, lt) {
    if (this.synth) return synthMouth(lt);
    const a = this.an, b = this.anBuf; a.getFloatTimeDomainData(b);
    let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i];
    const rms = Math.sqrt(s / b.length); this.peak = Math.max(rms, this.peak * Math.exp(-dt / 1.5));
    return (this.env = follow(this.env, rms, dt, this.peak));
  }

  // ---------------- the figure ----------------
  _build() {
    const k = this.pick.kind; let obj, mixer = null, clips = [];
    if (k === 'standin') obj = standIn(); else if (k === 'rig') obj = rigStandIn();
    else { const A = this.w.events.A, m = A.make(this.pick.e, 'Gleiten'); obj = m.obj; mixer = m.mixer; clips = this.pick.e.clips || []; }
    const root = new THREE.Group(); root.name = 'eagleOfDestiny'; root.add(obj);
    obj.traverse(o => { o.layers.set(1); if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
    const R = this.rig = { root, obj, mixer, standin: k === 'standin',
      neck: byName(obj, 'neck'), necks: ['neck', 'neck2', 'neck3', 'neck4'].map(n => byName(obj, n)).filter(Boolean), head: byName(obj, 'head'), jaw: k === 'seeadler' ? null : byName(obj, 'jaw'), tail: byName(obj, 'tail'),
      lids: ['eyelid.L', 'eyelid.R'].map(n => byName(obj, n)).filter(Boolean),
      w1: ['wing1.L', 'wing1.R'].map(n => byName(obj, n)), w2: ['wing2.L', 'wing2.R'].map(n => byName(obj, n)) };
    R.bones = [...R.necks, R.head, R.jaw, R.tail, ...R.lids, ...R.w1, ...R.w2].filter(Boolean);
    R.q0 = new Map(R.bones.map(b => [b, b.quaternion.clone()])); R.s0 = new Map(R.bones.map(b => [b, b.scale.clone()])); R.p0 = new Map(R.bones.map(b => [b, b.position.clone()]));
    if (mixer) { mixer.stopAllAction(); const act = n => { const c = clips.find(x => x.name === n); return c ? mixer.clipAction(c) : null; };
      R.fly = act('Fliegen'); R.glide = act('Gleiten');
      for (const a of [R.fly, R.glide]) if (a) { a.play(); a.setEffectiveWeight(0); } (R.fly || R.glide)?.setEffectiveWeight(1); }
    this.cam.add(root); if (!this.cam.parent) this.w.scene.add(this.cam); // the camera is in the scene when the bars hang on it
    root.updateMatrixWorld(true); for (const m of skinned(obj)) m.skeleton.update();
    R.pts = headPoints(R); R.all = birdPoints(R);
    // the beak's direction in the model's own frame, measured from the rest geometry (lower beak ahead of the head's centre),
    // never from bone axes: rigs come with any rest rotation and armature transform
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert(), hc = new THREE.Vector3(), jc = new THREE.Vector3(), all = []; let nh = 0, nj = 0;
    for (const p of R.pts) { const v = p.get(new THREE.Vector3()).applyMatrix4(inv); all.push(v); if (p.jaw) { jc.add(v); nj++; } else { hc.add(v); nh++; } }
    if (nh) hc.divideScalar(nh); if (nj) jc.divideScalar(nj);
    const f = new THREE.Vector3();
    if (nj && nh) f.subVectors(jc, hc); else if (all.length) { const c = all.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(all.length); let far = 0; for (const v of all) { const d = Math.hypot(v.x - c.x, v.z - c.z); if (d > far) { far = d; f.subVectors(v, c); } } }
    f.y = 0; R.fwdYaw = f.lengthSq() > 1e-8 ? Math.atan2(f.x, f.z) : 0; // 0 = beak along +Z, as the contract says
    const oq = obj.getWorldQuaternion(new THREE.Quaternion()), fl = new THREE.Vector3(Math.sin(R.fwdYaw), 0, Math.cos(R.fwdYaw));
    if (R.head && nj) { // the jaw's hinge: the back end of the lower beak (head frame), the axis: sideways to the beak
      const jl = [];
      for (const p of R.pts) if (p.jaw) { const w = p.get(new THREE.Vector3()); jl.push([w.clone().applyMatrix4(inv).dot(fl), w]); }
      jl.sort((a, b) => a[0] - b[0]); const back = jl.slice(0, Math.max(1, Math.ceil(jl.length * 0.15))), hw = back.reduce((a, x) => a.add(x[1]), new THREE.Vector3()).divideScalar(back.length);
      R.hinge = R.head.worldToLocal(hw.clone()); const hqi = R.head.getWorldQuaternion(new THREE.Quaternion()).invert();
      R.hingeAxis = new THREE.Vector3().crossVectors(fl, _Y).normalize().applyQuaternion(oq).applyQuaternion(hqi); }
    if (R.head && nh) R.hcLocal = R.head.worldToLocal(hc.clone().applyMatrix4(obj.matrixWorld));
    if (R.head) R.fwdHead = fl.clone().applyQuaternion(oq).applyQuaternion(R.head.getWorldQuaternion(new THREE.Quaternion()).invert()); // the beak in the head bone's frame
    // the wings beat about the body's long axis at the shoulder; the sign so that + lifts the tip, whatever the bone axes
    R.fwdObj = fl; const fw = fl.clone().applyQuaternion(oq), up = _Y.clone().applyQuaternion(oq), r0 = obj.getWorldPosition(new THREE.Vector3());
    R.flapSign = R.w1.map((w, i) => { if (!w) return 0; const a = w.getWorldPosition(new THREE.Vector3()), b = R.w2[i] ? R.w2[i].getWorldPosition(new THREE.Vector3()) : a.clone().multiplyScalar(2).sub(r0);
      const d = b.sub(a); if (d.lengthSq() < 1e-8) return 0; return Math.sign(new THREE.Vector3().crossVectors(fw, d).dot(up)) || 0; });
    return R;
  }

  /** the head's points (or all of the bird's: all = true) in camera space */
  _cam(all = false, out = []) {
    const R = this.rig; this.cam.updateMatrixWorld(); R.root.updateMatrixWorld(true);
    _m.copy(this.cam.matrixWorld).invert(); let n = 0;
    for (const p of all ? R.all : R.pts) { p.get(_v); _v.applyMatrix4(_m); (out[n++] ||= new THREE.Vector3()).copy(_v); }
    out.length = n; return out;
  }
  _headCam(out) { return this._cam(false, out); }
  _view() { const c = this.w.c, a = (c?.clientWidth && c?.clientHeight) ? c.clientWidth / c.clientHeight : this.cam.aspect; const tv = Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)); return { a, tv, th: tv * a }; }
  /** the head's box on screen in viewport fractions (x from the left, y from the top; not clamped: x1 > 1 = cut by the edge) */
  box() { return this._box(false); }
  /** the whole bird's box on screen (points behind the camera left out; clamped to -1..2) */
  birdBox() { return this._box(true); }
  _box(all) {
    if (!this.rig || !this.rig.root.visible) return null;
    const { tv, th } = this._view(); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; const cl = v => Math.max(-1, Math.min(2, v));
    for (const p of this._cam(all, all ? (this._ac ||= []) : (this._hc ||= []))) { if (p.z > -0.02) continue; const x = cl((p.x / (-p.z * th) + 1) / 2), y = cl((1 - p.y / (-p.z * tv)) / 2);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return x0 <= x1 ? { x0, x1, y0, y1 } : null;
  }
  /** level flight in the ride direction (camera -Z), beak first; roll / pitch / yaw: small accents (rad) */
  _flyQ(roll = 0, pitch = 0, yaw = 0) { return yawQ(Math.PI + yaw, roll + (this.bank || 0), pitch).multiply(yawQ(-(this.rig.fwdYaw || 0))); }

  /** where it flies: position and scale so the head, looking at you, covers the eagleFrame() spot for this FOV and aspect */
  _solve() {
    const R = this.rig, { a, tv, th } = this._view(), f = eagleFrame(a); this.bank = f.bank || 0;
    const key = `${a.toFixed(3)}|${this.cam.fov}`; if (this._solved === key) return; this._solved = key;
    const keep = { p: R.root.position.clone(), q: R.root.quaternion.clone(), s: R.root.scale.x, vis: R.root.visible };
    R.root.quaternion.copy(this._flyQ()); R.root.scale.setScalar(this.s || 1); R.root.position.copy(this.fly || _w.set(0.5, 0, -2 * D));
    const tx = 2 * f.cx - 1, ty = 1 - 2 * f.cy, tw = 2 * f.width; // NDC
    // the box the head takes while it speaks, looking at you: beak wide open, the cocked head, the proud chin and the smug nod
    const POSES = [[0, 0, 1], [-0.07, 0, 1], [0, 0.22, 1], [0.15, 0, 0]];
    const measure = () => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, c = null;
      for (const [nod, tilt, mouth] of POSES) { this._pose(1, nod, tilt, mouth);
        const P = this._headCam().filter(p => p.z < -0.05); if (P.length < 3) return null; const cc = new THREE.Vector3();
        const first = !c; // width and centre from the plain look, the height from all of them (it must never reach the bar)
        for (const p of P) { const x = p.x / (-p.z * th), y = p.y / (-p.z * tv); if (first) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); } y0 = Math.min(y0, y); y1 = Math.max(y1, y); cc.add(p); }
        c ||= cc.divideScalar(P.length); }
      return { x0, x1, y0, y1, c }; };
    for (let i = 0; i < 40; i++) { // move, then scale about the head's centre (the model's origin may be far from its head)
      let m = measure(); if (!m) { R.root.position.z -= 0.4; continue; } // head behind the camera: start further out
      R.root.position.z += (-D - m.c.z) * 0.8; m = measure(); if (!m) continue; // damped: the head turns with every move
      const z = -m.c.z; R.root.position.x += (tx - (m.x0 + m.x1) / 2) * th * z * 0.8; R.root.position.y += (ty - (m.y0 + m.y1) / 2) * tv * z * 0.8;
      m = measure(); if (!m) continue;
      const k = Math.max(0.75, Math.min(1.33, Math.pow(Math.min(tw / Math.max(1e-4, m.x1 - m.x0), 2 * f.maxH / Math.max(1e-4, m.y1 - m.y0)), 0.7)));
      R.root.position.sub(m.c).multiplyScalar(k).add(m.c); R.root.scale.setScalar(R.root.scale.x * k);
    }
    this.fly = R.root.position.clone(); this.s = R.root.scale.x;
    R.root.position.copy(keep.p); R.root.quaternion.copy(keep.q); R.root.scale.setScalar(this.s); R.root.visible = keep.vis;
  }

  /** look: 0 (ahead, the rest pose) .. 1 (at the camera); nod / tilt (rad) on the head; mouth 0..1; flap: wing beat (rad, + = up) */
  _pose(look, nod, tilt, mouth, blink = 0, flap = 0.1, dt = 0) {
    const R = this.rig;
    for (const b of R.bones) { b.quaternion.copy(R.q0.get(b)); b.scale.copy(R.s0.get(b)); b.position.copy(R.p0.get(b)); }
    if (R.mixer && dt >= 0) R.mixer.update(dt);
    R.root.updateMatrixWorld(true);
    if (!R.mixer || !(R.fly || R.glide)) { // no clips to beat the wings: about the body's long axis, the outer part a little more
      const ax = R.fwdObj.clone().applyQuaternion(R.obj.getWorldQuaternion(new THREE.Quaternion())).normalize();
      R.w1.forEach((w, i) => { const sg = R.flapSign[i]; if (!w || !sg) return; turn(w, new THREE.Quaternion().setFromAxisAngle(ax, sg * flap)); if (R.w2[i]) turn(R.w2[i], new THREE.Quaternion().setFromAxisAngle(ax, sg * flap * 0.45)); });
    }
    if (R.head && R.fwdHead && (look > 0 || nod || tilt || (!R.jaw && mouth))) { // the beak turns from where it points (measured, any rest pose) to the camera: the neck first, then the head
      const hq = R.head.getWorldQuaternion(new THREE.Quaternion()), cur = R.fwdHead.clone().applyQuaternion(hq);
      const up = _Y.clone().applyQuaternion(this.cam.getWorldQuaternion(new THREE.Quaternion()));
      const toCam = this.cam.getWorldPosition(new THREE.Vector3()).sub(this._headC()).normalize(); // from the head's measured centre, not the bone pivot
      const qLook = new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(cur, toCam), look);
      // a neck of several bones (adler_nah v4: neck, neck2, neck3, neck4) shares the turn evenly, so no joint twists hard: with
      // four bones each takes a fifth and the head the rest; one neck bone takes 60 % as before
      const nk = R.necks.filter(b => b !== R.head), share = nk.length > 1 ? 1 / (nk.length + 1) : 0.6;
      for (const b of nk) turn(b, new THREE.Quaternion().slerp(qLook, share));
      let want = cur;
      for (let i = 0; i < 3; i++) { // the head's centre moves as neck and head turn: aim again from where it is now (eye contact while it speaks)
        const to = this.cam.getWorldPosition(new THREE.Vector3()).sub(this._headC()).normalize();
        want = cur.clone().applyQuaternion(new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(cur, to), look));
        const now = R.fwdHead.clone().applyQuaternion(R.head.getWorldQuaternion(new THREE.Quaternion()));
        turn(R.head, new THREE.Quaternion().setFromUnitVectors(now, want));
      }
      const right = new THREE.Vector3().crossVectors(want, up).normalize();
      const extra = new THREE.Quaternion().setFromAxisAngle(right, -(nod + (R.jaw ? 0 : -mouth * 0.12))).multiply(new THREE.Quaternion().setFromAxisAngle(want, tilt));
      if (R.hcLocal) { // nod and tilt about the head's own centre, not the bone's pivot (which may sit anywhere in the skull)
        const c = R.head.localToWorld(R.hcLocal.clone()), p = R.head.getWorldPosition(new THREE.Vector3());
        turn(R.head, extra); p.sub(c).applyQuaternion(extra).add(c); R.head.position.copy(R.head.parent.worldToLocal(p)); R.head.updateMatrixWorld(true);
      } else turn(R.head, extra);
    }
    if (R.jaw && R.hinge) { // the lower beak opens about its measured hinge and the head's sideways axis, wherever the bone's pivot and axes are
      const hq = R.head.getWorldQuaternion(new THREE.Quaternion()), ax = R.hingeAxis.clone().applyQuaternion(hq).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(ax, -mouth * JAW_OPEN), c = R.head.localToWorld(R.hinge.clone()), p = R.jaw.getWorldPosition(new THREE.Vector3());
      R.jaw.parent.getWorldQuaternion(_q2); R.jaw.quaternion.copy(_q2.clone().invert().multiply(q).multiply(_q2).multiply(R.jaw.quaternion));
      p.sub(c).applyQuaternion(q).add(c); R.jaw.position.copy(R.jaw.parent.worldToLocal(p)); R.jaw.updateMatrixWorld(true);
    } else if (R.jaw) R.jaw.quaternion.multiply(_q.setFromAxisAngle(_X, mouth * JAW_OPEN));
    for (const l of R.lids) l.quaternion.multiply(_q.setFromAxisAngle(_X, (R.standin ? 0.35 + blink * 1.15 : blink * 1.0)));
    R.root.updateMatrixWorld(true);
  }
  _headC() { const R = this.rig; return R.hcLocal ? R.head.localToWorld(R.hcLocal.clone()) : R.head.getWorldPosition(new THREE.Vector3()); }
  _beak() { const R = this.rig; return R.fwdHead.clone().applyQuaternion(R.head.getWorldQuaternion(new THREE.Quaternion())).normalize(); }
  /** degrees between the measured beak direction and the direction to the camera (eye contact: near 0 while it speaks) */
  lookOff() { const R = this.rig; if (!R?.head || !R.fwdHead) return null;
    return THREE.MathUtils.radToDeg(this._beak().angleTo(this.cam.getWorldPosition(new THREE.Vector3()).sub(this._headC()).normalize())); }
  /** degrees between the beak and the ride direction (the camera's forward): near 0 while it looks ahead */
  aheadOff() { const R = this.rig; if (!R?.head || !R.fwdHead) return null;
    return THREE.MathUtils.radToDeg(this._beak().angleTo(new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.getWorldQuaternion(new THREE.Quaternion())))); }
  _clipWeights(fly) { const R = this.rig; if (!R.mixer) return; if (R.fly && R.glide) { R.fly.setEffectiveWeight(fly); R.glide.setEffectiveWeight(1 - fly); } }

  // ---------------- the scene ----------------
  start() {
    if (this.state === 'play') return;
    this._build(); this.state = 'play'; this.t = 0; this.L = EAGLE.line; this.lineOn = false; this.synth = true; this._prev = null; this._far = false; this._inW = false;
    this._logged = false; this._off = null; this._offLogged = false; this._solved = null; this.fly = null; this.s = 1;
    this._solve(); this.rig.root.visible = false;
    this._cry(0.9, 0.75); // first only the cry, from behind on the right
    console.info('[eagle] start', this.kind);
  }
  stop() {
    for (const s of this.srcs || []) try { s.stop(); } catch { /* done */ } this.srcs = [];
    const R = this.rig; if (R) { R.root.parent?.remove(R.root); if (R.standin) R.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
    this.rig = null; if (this.state === 'play') this.state = 'done';
  }
  get tOff() { return T.line + (this.L || EAGLE.line) + T.smug; }
  /** call every frame while riding (not in the pause); returns 'end' once it is gone */
  tick(dt) {
    if (this.state !== 'play' || !this.rig) return null;
    const R = this.rig; this.t += dt; const t = this.t;
    this._solve(); // FOV or window changed: flies at the same spot again
    const P = this.fly, s = this.s, tOff = this.tOff; R.root.scale.setScalar(s);
    if (!this.lineOn && t >= T.line) { this.lineOn = true; this.lineT = t; this._line(); }
    let look = 0, nod = 0, tilt = 0, mouth = 0, blink = 0;
    if (t < T.in0) { R.root.visible = false; return null; }
    if (!this._inW) { this._inW = true; this._whoosh(0.09, 0.7); }
    R.root.visible = true;
    const bob = Math.sin(t * 1.5) * 0.008 * s, roll = Math.sin(t * 0.9 + 0.6) * 0.045, pitch = Math.sin(t * 1.5 + 1.2) * 0.015; // gliding: a gentle bob and roll
    const glide = 0.08 + 0.05 * Math.sin(t * 1.5), beat = k => Math.sin(t * Math.PI * 2 * 2.4) * 0.8 * k + 0.12 * k;
    let flap = glide;
    if (t < T.in1) { // flies in from behind on the right with a few beats, settles alongside, gliding
      const u = (t - T.in0) / (T.in1 - T.in0), e = 1 - Math.pow(1 - u, 3);
      R.root.position.copy(P).add(_w.set(0.9 * s, 0.25 * s, 2.6 * s).multiplyScalar(1 - e)); R.root.position.y += bob;
      R.root.quaternion.copy(this._flyQ(roll - 0.3 * (1 - e), pitch, 0.25 * (1 - e))); // banked into the curve in
      const k = 1 - sm(0.55, 1, u); flap = glide + beat(k); this._clipWeights(k);
    } else if (t < tOff) { // alongside: looks ahead, turns its head to you, speaks
      const lt = this.lineOn ? t - this.lineT : -1, L = this.L || EAGLE.line;
      look = sm(T.turn0, T.turn1, t); // slow, eased: neck first, then the head
      blink = Math.max(bump(t, T.turn1 + 0.2, 0.15), bump(t, T.line + L * 0.55, 0.14));
      if (lt >= 0 && lt < L + 0.15) mouth = this._mouth(dt, lt); else this.env = 0;
      const proud = bump(lt, L * 0.32, L * 0.25) * 0.07, lean = sm(L * 0.55, L * 0.75, lt) * (1 - sm(L, L + 0.5, lt));
      nod = -proud + (lt > L ? Math.sin(Math.min(1, (lt - L) / 0.55) * Math.PI) * 0.15 : 0); // chin up for "Destiny", a smug nod after
      tilt = lean * 0.22; // cocks its head for "you little bitch"
      R.root.position.copy(P); R.root.position.y += bob; R.root.quaternion.copy(this._flyQ(roll, pitch)); this._clipWeights(0);
    } else { // off: head forward, a few strong beats, ahead of you, swerves left and right twice, and away
      const v = t - tOff, w = Math.max(0, v - 0.45);
      look = 1 - sm(0, 0.6, v);
      const z = P.z - (5 * w + 6.5 * w * w), env = sm(0.9, 1.4, v) * (1 - sm(3.8, 4.8, v));
      const x = P.x * (1 - sm(0.45, 1.6, v)) + 0.3 * Math.abs(z) * Math.sin(2 * Math.PI * (v - 0.9) / 1.4) * env, y = P.y + bob + 0.35 * w + 0.2 * w * w;
      const prev = this._prev || R.root.position, vel = _w.set(x - prev.x, y - prev.y, z - prev.z);
      const lat = env * Math.cos(2 * Math.PI * (v - 0.9) / 1.4); // banks into the turns
      R.root.scale.setScalar(s + (Math.min(s, 1.2) - s) * sm(0.45, 2, v)); // from close-up size to a big bird's size as it leaves
      R.root.position.set(x, y, z);
      R.root.quaternion.copy(this._flyQ(roll, pitch)).slerp(vel.lengthSq() > 1e-10 ? yawQ(Math.atan2(vel.x, vel.z) - (R.fwdYaw || 0), -lat * 0.7, -Math.atan2(vel.y, Math.hypot(vel.x, vel.z)) * 0.5) : this._flyQ(), sm(0.45, 0.9, v));
      this._prev = R.root.position.clone();
      const k = sm(0.25, 0.55, v) * (1 - sm(3.0, 3.8, v)); flap = glide + beat(k); this._clipWeights(k);
      if (!this._far && v > 0.5) { this._far = true; this._cry(0.75, 0.45); this._whoosh(0.09, 0.3); } // it cries once more as it flies off (owner 19.11.)
      if (v >= T.away || z < -220) { this.stop(); this.state = 'done'; console.info('[eagle] gone'); return 'end'; }
    }
    this._pose(look, nod, tilt, mouth, blink, flap, dt);
    this.jaw = R.jaw ? mouth * JAW_OPEN : 0; this.mouth = mouth;
    if (!this._logged && t >= T.turn1 + 0.15) { this._logged = true; const b = this.box(), bb = this.birdBox(), p = v => Math.round(v * 100); // for the Mac: where the real model sits at eye contact
      if (b) console.info(`[eagle] head box x${p(b.x0)}..${p(b.x1)} y${p(b.y0)}..${p(b.y1)} % (${this.kind}, scale ${this.s.toFixed(2)}, ${R.pts.length} head points)`);
      if (bb) console.info(`[eagle] bird box x${p(bb.x0)}..${p(bb.x1)} y${p(bb.y0)}..${p(bb.y1)} % (${R.all.length} points)`); }
    if (this.lineOn && t < tOff) { const lt = t - this.lineT, L = this.L || EAGLE.line; // eye contact while it speaks, worst frame of the line
      if (lt >= 0 && lt <= L) { const o = this.lookOff(); this.look = o; if (o != null) this._off = Math.max(this._off || 0, o); }
      else if (lt > L && !this._offLogged && this._off != null) { this._offLogged = true; console.info(`[eagle] look off ${Math.round(this._off)}°`); } }
    return null;
  }
}
const bump = (x, c, w) => (x < c - w || x > c + w ? 0 : Math.cos((x - c) / w * Math.PI / 2));

const skinned = o => { const l = []; o.traverse(m => { if (m.isSkinnedMesh) l.push(m); }); return l; };
/** points of the model for framing, skinned as the GPU does (SkinnedMesh.getVertexPosition applies the bone matrices: never
 *  apply them twice), or the corners of plain meshes (stand-in). keep(bone or node) picks which; each point: get(v) -> world
 *  position, jaw: on the lower beak. max: at most about this many from each skinned mesh. */
function modelPoints(R, keep, max) {
  const out = [], jawSet = new Set(); R.jaw?.traverse(o => jawSet.add(o));
  R.obj.updateMatrixWorld(true);
  R.obj.traverse(m => {
    if (m.isSkinnedMesh) {
      const bones = m.skeleton.bones, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, idx = [];
      if (!si || !sw) return;
      for (let i = 0; i < si.count; i++) { let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } } if (keep(bones[best])) idx.push([i, jawSet.has(bones[best])]); }
      const step = Math.max(1, Math.floor(idx.length / max));
      for (let j = 0; j < idx.length; j += step) { const [i, jaw] = idx[j]; out.push({ jaw, get: v => m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld) }); }
    } else if (m.isMesh && keep(m)) {
      let jaw = false; for (let o = m; o && o !== R.obj; o = o.parent) if (o === R.jaw) jaw = true;
      m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox;
      for (let k = 0; k < 8; k++) { const c = new THREE.Vector3(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z); out.push({ jaw, get: v => v.copy(c).applyMatrix4(m.matrixWorld) }); }
    }
  });
  return out;
}
/** the head's points: the vertices weighted mostly to head / jaw / eyelids. None: a 0.2 m box around the head bone */
function headPoints(R) {
  const head = R.head; if (!head) return [];
  const under = new Set(); head.traverse(o => under.add(o));
  const out = modelPoints(R, o => under.has(o), 600);
  if (!out.length) { // no weights to go by: a box around the head bone (in the model's scale)
    const t = new THREE.Vector3();
    for (let k = 0; k < 8; k++) { const o = new THREE.Vector3(k & 1 ? 0.1 : -0.1, k & 2 ? 0.1 : -0.1, k & 4 ? 0.1 : -0.1);
      out.push({ jaw: false, get: v => head.getWorldPosition(v).add(t.copy(o).multiplyScalar(R.root.scale.x)) }); }
  }
  return out;
}
/** the whole bird's points (all vertices, thinned out) */
const birdPoints = R => modelPoints(R, () => true, 1500);

/** the stand-in: a white-tailed eagle with a hinged lower beak, neck, body, two-part wings with splayed primaries and a tail fan;
 *  metres, beak +Z, wings spread */
function standIn() {
  const M = (c, r = 0.85, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...o });
  const brown = M(0x4a3222, 0.9), dark = M(0x2e1f15, 0.9), white = M(0xeee9dd, 0.8), pale = M(0xd8cfbf, 0.85), yellow = M(0xf0b52a, 0.45), iris = M(0xf2c200, 0.3), black = M(0x0c0c0c, 0.15), mouth = M(0x6a1a1a, 0.6);
  const mesh = (g, m, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], name = '') => { const o = new THREE.Mesh(g, m); o.position.set(...p); o.rotation.set(...r); o.scale.set(...s); if (name) o.name = name; return o; };
  const node = (name, p, parent) => { const g = new THREE.Group(); g.name = name; g.position.set(...p); parent.add(g); return g; };
  const ball = new THREE.SphereGeometry(1, 24, 16), root = new THREE.Group(); root.name = 'root';
  root.add(mesh(ball, brown, [0, 0, -0.04], [0, 0, 0], [0.15, 0.13, 0.36])); // body, level
  root.add(mesh(ball, dark, [0, -0.03, -0.1], [0, 0, 0], [0.13, 0.1, 0.3]));
  const tail = node('tail', [0, 0.0, -0.36], root); // a white wedge-shaped fan
  for (const a of [-0.28, 0, 0.28]) tail.add(mesh(new THREE.BoxGeometry(0.09, 0.015, 0.26), white, [Math.sin(a) * 0.1, 0, -0.12], [0, a, 0]));
  const neck = node('neck', [0, 0.03, 0.27], root);
  neck.add(mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.16, 16), pale, [0, 0, 0.02], [Math.PI / 2 - 0.15, 0, 0]));
  const head = node('head', [0, 0.04, 0.12], neck);
  head.add(mesh(ball, white, [0, 0, 0], [0, 0, 0], [0.066, 0.064, 0.085]));
  head.add(mesh(ball, white, [0, -0.028, -0.035], [0, 0, 0], [0.06, 0.052, 0.06]));
  for (const sg of [1, -1]) { // eyes under an angry brow, lids for the blink
    head.add(mesh(ball, pale, [sg * 0.05, 0.034, 0.036], [0.4, 0, sg * -0.25], [0.016, 0.009, 0.042]));
    head.add(mesh(new THREE.SphereGeometry(0.0175, 16, 12), iris, [sg * 0.05, 0.018, 0.04]));
    head.add(mesh(new THREE.SphereGeometry(0.0088, 12, 8), black, [sg * 0.0605, 0.018, 0.045]));
    const lid = node(sg > 0 ? 'eyelid.L' : 'eyelid.R', [sg * 0.05, 0.018, 0.04], head); lid.rotation.y = sg * Math.PI / 2;
    lid.add(mesh(new THREE.SphereGeometry(0.0195, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), white, [0, 0, 0], [-0.7, 0, 0]));
  }
  const beak = node('beak', [0, 0.004, 0.068], head); // upper beak: tall, narrow, hooked
  beak.add(mesh(ball, yellow, [0, 0.0, -0.005], [0, 0, 0], [0.026, 0.026, 0.028]));
  beak.add(mesh(new THREE.ConeGeometry(0.026, 0.1, 14), yellow, [0, 0.004, 0.045], [Math.PI / 2, 0, 0], [0.72, 1, 1.25]));
  beak.add(mesh(new THREE.ConeGeometry(0.008, 0.03, 10), yellow, [0, -0.008, 0.1], [Math.PI * 0.82, 0, 0], [0.8, 1, 1]));
  const jaw = node('jaw', [0, -0.018, 0.06], head); // lower beak, hinged at the corner of the mouth
  jaw.add(mesh(new THREE.ConeGeometry(0.02, 0.078, 12), yellow, [0, -0.003, 0.036], [Math.PI / 2, 0, 0], [0.7, 1, 0.55]));
  jaw.add(mesh(new THREE.BoxGeometry(0.024, 0.004, 0.05), mouth, [0, 0.004, 0.022]));
  for (const sg of [1, -1]) { // wings: arm and hand, spread; the hand ends in splayed primaries
    const w1 = node(sg > 0 ? 'wing1.L' : 'wing1.R', [sg * 0.12, 0.04, 0.02], root);
    w1.add(mesh(new THREE.BoxGeometry(0.5, 0.03, 0.32), brown, [sg * 0.25, 0, -0.08]));
    w1.add(mesh(new THREE.BoxGeometry(0.5, 0.012, 0.1), dark, [sg * 0.25, -0.012, -0.26]));
    const w2 = node(sg > 0 ? 'wing2.L' : 'wing2.R', [sg * 0.5, 0, 0], w1);
    w2.add(mesh(new THREE.BoxGeometry(0.3, 0.022, 0.3), dark, [sg * 0.15, 0, -0.09]));
    for (let i = 0; i < 5; i++) { const a = sg * (-0.15 + i * 0.12); w2.add(mesh(new THREE.BoxGeometry(0.3, 0.008, 0.055), dark, [sg * 0.4, 0, -0.02 - i * 0.055], [0, a, 0])); }
  }
  return root;
}

/** test stand-in rigged like the real adler_nah (Mac 18.11.): ONE SkinnedMesh, armature node seeadlerRig turned 180° about Y,
 *  root bone −90° about X, neck / head along the bone chain, head with a non-identity rest rotation, jaw as a child with an
 *  offset, wings and a tail, a 2.3 m wingspan. Geometry in glTF world space, beak +Z. Used with ?eaglerig=real, so a rig
 *  whose bone axes say nothing about the model is tested in the cloud. */
export function rigStandIn() {
  const scene = new THREE.Group(); scene.name = 'Scene';
  const rig = new THREE.Object3D(); rig.name = 'seeadlerRig'; rig.quaternion.set(0, 1, 0, 1e-4).normalize(); scene.add(rig);
  const bone = (name, t, q, parent) => { const b = new THREE.Bone(); b.name = name; b.position.set(...t); if (q) b.quaternion.set(...q).normalize(); parent.add(b); return b; };
  const root = bone('root', [0, 0.515, 0.252], [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], rig);
  const neck = bone('neck', [0, 0.287, 0], null, root), head = bone('head', [0, 0.377, 0], [-5.7e-8, 0.2538, -0.9673, 1.9e-8], neck);
  scene.updateMatrixWorld(true);
  const jaw = bone('jaw', [-0.0097, -0.038, 0.131], head.getWorldQuaternion(new THREE.Quaternion()).invert().toArray(), head); // local X = the hinge (world X)
  const at = (name, w, parent) => { parent.updateMatrixWorld(true); const b = bone(name, [0, 0, 0], parent.getWorldQuaternion(new THREE.Quaternion()).invert().toArray(), parent); b.position.copy(parent.worldToLocal(new THREE.Vector3(...w))); return b; };
  const w1L = at('wing1L', [0.13, 0.52, -0.1], root), w2L = at('wing2L', [0.65, 0.52, -0.1], w1L), w1R = at('wing1R', [-0.13, 0.52, -0.1], root), w2R = at('wing2R', [-0.65, 0.52, -0.1], w1R);
  const tail = at('tail', [0, 0.5, -0.5], root);
  scene.updateMatrixWorld(true);
  const bones = [root, neck, head, jaw, w1L, w2L, w1R, w2R, tail], parts = [];
  const part = (g, bi, col, p = [0, 0, 0], r = [0, 0, 0], sc = [1, 1, 1]) => { g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...sc)));
    const n = g.attributes.position.count, c = new THREE.Color(col), cols = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { cols.set([c.r, c.g, c.b], i * 3); si[i * 4] = bi; sw[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); parts.push(g); };
  const S = () => new THREE.SphereGeometry(1, 20, 14), B = (x, y, z) => new THREE.BoxGeometry(x, y, z);
  part(S(), 0, 0x4a3222, [0, 0.5, -0.15], [0, 0, 0], [0.16, 0.13, 0.4]);
  for (const a of [-0.28, 0, 0.28]) part(B(0.1, 0.02, 0.28), 8, 0xeee9dd, [Math.sin(a) * 0.1, 0.5, -0.64], [0, a, 0]); // the tail fan
  part(new THREE.CylinderGeometry(0.06, 0.09, 0.22, 14), 1, 0xd8cfbf, [0, 0.49, 0.2], [Math.PI / 2 - 0.1, 0, 0]);
  part(S(), 2, 0xeee9dd, [0, 0.5, 0.36], [0, 0, 0], [0.07, 0.07, 0.085]);
  for (const sg of [1, -1]) part(new THREE.SphereGeometry(0.017, 12, 8), 2, 0xf2c200, [sg * 0.055, 0.52, 0.39]);
  part(new THREE.ConeGeometry(0.026, 0.1, 12), 2, 0xf0b52a, [0, 0.5, 0.45], [Math.PI / 2, 0, 0], [0.72, 1, 1.25]);
  part(new THREE.ConeGeometry(0.02, 0.075, 12), 3, 0xf0b52a, [0, 0.475, 0.44], [Math.PI / 2, 0, 0], [0.7, 1, 0.55]);
  for (const [sg, a, b] of [[1, 4, 5], [-1, 6, 7]]) { part(B(0.52, 0.03, 0.34), a, 0x4a3222, [sg * 0.39, 0.52, -0.12]); part(B(0.5, 0.02, 0.26), b, 0x2e1f15, [sg * 0.9, 0.52, -0.15]); }
  const geo = mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g)); geo.computeVertexNormals();
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })); mesh.name = 'adler_nah_mesh';
  scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones), mesh.matrixWorld);
  return scene;
}
