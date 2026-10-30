// Life along the road: villagers call out to the rider, birds sweep past the camera, carriages come the other way.
// Everything is planned from the track and the placed props, then triggered when the rider gets close,
// always ahead of the camera so it is not missed. Sounds come from assets/audio/manifest.json when present;
// without them the calls still show as speech bubbles.
import * as THREE from 'three';

const LINES = [
  'Godspeed, rider!', 'Faster! The King awaits!', 'Make way for the rider!', 'Huzzah!', 'Ride on, brave soul!',
  'Mind the sheep, good sir!', 'Fair winds to thee!', 'Thy legs are made of iron!', 'The tavern is open tonight!',
  'Fresh fish! Fresh fish!', 'Hark! A rider from the south!', 'May the saints guard thy wheels!',
  'Is that a horse without legs?', 'Slow down, thou madman!', 'Onward, onward!', 'Glory to the swift!',
  'The castle is under siege, beware!', 'Hail, traveller!', 'Bread! Warm bread for the weary!', 'Push, push, the hill is nigh!',
  'By my beard, what speed!', 'Well ridden, friend!', 'The feast is in the town square!', 'Watch out for the wolves!',
];

export class Events {
  constructor(world, assets) {
    this.w = world; this.A = assets; this.f = world.field; this.track = world.track;
    this.active = []; this.nextShout = 6; this.nextBird = 25 + Math.random() * 30; this.said = new Set();
    this.overlay = document.createElement('div'); this.overlay.className = 'rf-bubbles';
    Object.assign(this.overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: 5 });
    world.c.parentElement?.append(this.overlay);
    this.people = world.props.filter(o => o.userData.person);
    this.carts = this._planCarts();
    this.sounds = null; this._loadSounds();
  }

  async _loadSounds() {
    try {
      const m = await (await fetch('assets/audio/manifest.json')).json();
      this.sounds = m; this.lines = (m.shouts || []).map(s => s.text);
    } catch { this.sounds = {}; }
  }
  _play(file, pan = 0, vol = 1) {
    if (!file || this.w.instant) return;
    try {
      const ctx = this.ctx ||= new AudioContext();
      const a = new Audio(file); const src = ctx.createMediaElementSource(a), p = ctx.createStereoPanner(), g = ctx.createGain();
      p.pan.value = Math.max(-1, Math.min(1, pan)); g.gain.value = vol; src.connect(p).connect(g).connect(ctx.destination); a.play().catch(() => {});
    } catch { /* no audio: the bubble is enough */ }
  }

  /** one oncoming horse-drawn cart per village stretch */
  _planCarts() {
    const out = [], segs = this.track.segments || [];
    for (const s of segs) if (s.village) { const L = s.to - s.from; out.push({ at: s.from + L * (0.3 + Math.random() * 0.4), done: false }); }
    if (!out.length) for (let d = 3000; d < this.track.length - 2000; d += 7000) out.push({ at: d, done: false });
    return out;
  }

  update(time, dt, cam, d) {
    if (this.w.instant) return;
    this._shouts(time, cam);
    this._birds(time, dt, cam);
    this._carts(dt, d);
    for (const e of this.active) e.mixer?.update(Math.min(dt, 0.1));
  }

  // ---- calls from villagers ----
  _shouts(time, cam) {
    for (const b of this.overlay.children) { // keep bubbles over their speaker, fade them out
      const o = b._o; const v = new THREE.Vector3(o.position.x, o.position.y + (o.userData.h || 1.9) + 0.4, o.position.z).project(this.w.camera);
      const W = this.overlay.clientWidth, H = this.overlay.clientHeight;
      if (v.z > 1 || time > b._until) { b.remove(); continue; }
      b.style.transform = `translate(${(v.x * .5 + .5) * W}px, ${(-v.y * .5 + .5) * H}px) translate(-50%, -100%)`;
    }
    if (time < this.nextShout) return;
    const fwd = this.w.camera.getWorldDirection(new THREE.Vector3());
    let best = null, bd = 1e9;
    for (const o of this.people) {
      if (!o.visible || this.said.has(o)) continue;
      const dx = o.position.x - cam.x, dz = o.position.z - cam.z, dist = Math.hypot(dx, dz);
      if (dist < 12 || dist > 45 || (dx * fwd.x + dz * fwd.z) / dist < 0.75) continue; // ahead, in view, close enough to hear
      if (dist < bd) { bd = dist; best = o; }
    }
    if (!best) return;
    this.said.add(best); this.nextShout = time + 7 + Math.random() * 7;
    const pool = this.sounds?.shouts?.length ? this.sounds.shouts : LINES.map(text => ({ text }));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const b = document.createElement('div'); b.className = 'rf-bubble'; b.textContent = pick.text; b._o = best; b._until = time + 3.2;
    this.overlay.append(b);
    const side = new THREE.Vector3().subVectors(best.position, cam).cross(fwd).y; // which ear
    this._play(pick.file && 'assets/audio/' + pick.file, -Math.sign(side) * 0.6, 0.9);
  }

  // ---- a bird sweeping close past the camera ----
  _birds(time, dt, cam) {
    if (time > this.nextBird) {
      this.nextBird = time + 60 + Math.random() * 60;
      const e = this.A.list.find(x => x.category === 'bird' && /adler|moewe/.test(x.file));
      if (e) {
        const { obj, mixer } = this.A.make(e, 'Gleiten');
        const fwd = this.w.camera.getWorldDirection(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x), side = Math.random() < .5 ? -1 : 1;
        const start = cam.clone().addScaledVector(fwd, 70).addScaledVector(right, side * 18); start.y = cam.y + 5 + Math.random() * 3;
        const end = cam.clone().addScaledVector(fwd, -30).addScaledVector(right, -side * 4); end.y = cam.y + 2.5;
        obj.position.copy(start); obj.lookAt(end); obj.layers.enableAll?.();
        this.w.scene.add(obj);
        this.active.push({ obj, mixer, start, end, t: 0, dur: 6.5, kind: 'bird' });
      }
    }
    for (const e of this.active) if (e.kind === 'bird') {
      e.t += dt; const k = Math.min(1, e.t / e.dur);
      e.obj.position.lerpVectors(e.start, e.end, k); e.obj.position.y += Math.sin(k * Math.PI) * 1.5;
      if (k >= 1) e.dead = true;
    }
    this._sweep();
  }

  // ---- horse and cart coming the other way ----
  _carts(dt, d) {
    const cartE = this.A.list.find(x => x.file.includes('kutsche')), horseE = this.A.list.find(x => x.file.includes('pferd'));
    for (const c of this.carts) {
      if (c.done || !cartE || d < c.at - 260 || d > c.at) continue;
      c.done = true;
      const cart = this.A.make(cartE).obj, horse = horseE ? this.A.make(horseE, 'Gehen') : null;
      const grp = new THREE.Group(); grp.add(cart); if (horse) { horse.obj.position.z = cartE.size[2] / 2 + horseE.size[2] / 2 + 0.3; grp.add(horse.obj); }
      this.w.scene.add(grp);
      this.active.push({ obj: grp, mixer: horse?.mixer, kind: 'cart', d: c.at + 120, v: -3.2 }); // starts ahead, rolls towards the rider
    }
    for (const e of this.active) if (e.kind === 'cart') {
      e.d += e.v * Math.min(dt, 0.1); if (e.d < d - 80) { e.dead = true; continue; }
      const p = this.f.at(e.d), l = Math.hypot(p.tx, p.tz) || 1, off = -1.9; // left lane, oncoming
      const x = p.x - p.tz / l * off, z = p.z + p.tx / l * off;
      e.obj.position.set(x, this.f.height(x, z), z); e.obj.rotation.y = Math.atan2(-p.tx, -p.tz);
    }
    this._sweep();
  }

  _sweep() {
    for (const e of this.active) if (e.dead) { this.w.scene.remove(e.obj); e.mixer?.stopAllAction(); }
    this.active = this.active.filter(e => !e.dead);
  }
}
