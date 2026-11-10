// Other riders in the 3D world: friends riding live (group ride), the ghost of a shared or own ride,
// and in the chase view yourself. Everyone is a Mii-style rider from avatar.js with their own look
// (sent over the network in a group ride) and a name tag above. Lanes are spread so riders side by side don't overlap.
import * as THREE from 'three';
import { makeRider, loadRiderKit } from './avatar.js';

const COLORS = [0x2f7fd8, 0xe0452b, 0x2fb36b, 0xf2b630, 0x9b59d0, 0x18b5c4, 0xff7a1a, 0xe84393];

function tag(name, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,12,16,0.72)'; g.beginPath(); g.roundRect(4, 8, 248, 48, 24); g.fill();
  g.fillStyle = '#' + color.toString(16).padStart(6, '0'); g.beginPath(); g.arc(32, 32, 10, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.font = '600 28px Inter, system-ui, sans-serif'; g.textBaseline = 'middle';
  g.fillText(name.slice(0, 14), 52, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1); s.position.y = 2.3; s.renderOrder = 10;
  return s;
}

function dispose(o) {
  o.traverse(x => { x.geometry?.dispose(); for (const m of [x.material].flat()) if (m) { m.map?.dispose(); m.dispose(); } });
}

export class Riders {
  constructor(scene, field) {
    this.scene = scene; this.field = field; this.list = new Map(); this.n = 0;
    loadRiderKit().then(ok => { if (ok) for (const e of this.list.values()) e.key = 'stale'; }); // detailed bike/hands arrived: rebuild on the next update
  }

  /** riders: [{ id, name, d, v, look, ghost, self, color }] — d in metres along the route, v m/s (wheel and leg speed) */
  set(riders) {
    const seen = new Set();
    for (const r of riders) {
      seen.add(r.id);
      let e = this.list.get(r.id);
      const key = JSON.stringify([r.look || null, !!r.ghost, r.name || '']);
      if (e && e.key !== key) { this.scene.remove(e.obj); dispose(e.obj); e.obj = null; }
      if (!e) {
        e = { d: r.d, shown: r.d, v: 0, crank: Math.random() * 6, color: r.color ?? COLORS[this.n % COLORS.length], lane: r.self ? 0 : [-0.9, 0.9, 0, -1.8, 1.8][this.n % 5] };
        if (!r.self) this.n++;
        this.list.set(r.id, e);
      }
      if (!e.obj) {
        e.obj = makeRider(r.look, { ghost: r.ghost });
        if (!r.self) e.obj.add(tag(r.name || 'Fahrer', e.color));
        this.scene.add(e.obj); e.key = key;
      }
      e.d = r.d; e.v = r.v || 0; e.self = !!r.self;
    }
    for (const [id, e] of this.list) if (!seen.has(id)) { this.scene.remove(e.obj); dispose(e.obj); this.list.delete(id); }
  }

  /** called each frame; ownD = own position, so riders right next to you stay beside you and never in the camera */
  update(dt, ownD) {
    for (const e of this.list.values()) {
      if (e.self) e.shown = ownD;
      else {
        e.shown += (e.d - e.shown) * Math.min(1, dt * 4) + e.v * dt * 0.5; // smooth between 2 updates per second
        if (Math.abs(e.shown - e.d) > 60) e.shown = e.d;
      }
      const near = !e.self && Math.abs(e.shown - ownD) < 3; // alongside: one lane further out so nobody rides through the camera
      const p = this.field.pose(Math.max(0, e.shown), 1.2 + e.lane + (near ? 1.4 : 0), 0);
      const o = e.obj; o.visible = Math.abs(e.shown - ownD) < 900;
      if (!o.visible) continue;
      o.position.set(p.x, p.y, p.z);
      o.lookAt(p.lx, p.y, p.lz);
      // ~90 rpm at 36 km/h, legs stop when freewheeling
      e.crank += Math.min(10, e.v * 0.95) * dt;
      for (const w of o.userData.wheels) w.rotation.x += e.v / 0.34 * dt; // +X is the rider's left: positive turn = rolling forward
      o.userData.pedal(e.crank);
    }
  }

  destroy() { for (const e of this.list.values()) { this.scene.remove(e.obj); dispose(e.obj); } this.list.clear(); }
}
