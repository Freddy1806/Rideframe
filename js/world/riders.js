// Other riders in the 3D world: friends riding live (group ride), the ghost of a shared or own ride,
// and in the chase view yourself. Everyone is a Mii-style rider from avatar.js with their own look
// (sent over the network in a group ride) and a name tag above. Lanes are spread so riders side by side don't overlap.
import * as THREE from 'three';
import { makeRider, loadRiderKit } from './avatar.js';

const COLORS = [0x2f7fd8, 0xe0452b, 0x2fb36b, 0xf2b630, 0x9b59d0, 0x18b5c4, 0xff7a1a, 0xe84393];

// name tag; speaking (voice chat): green glow around the tag and a speaker icon instead of the colour dot
function drawTag(c, name, color, speaking) {
  const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  if (speaking) { g.save(); g.shadowColor = '#3dff8a'; g.shadowBlur = 18; g.strokeStyle = '#3dff8a'; g.lineWidth = 5; g.beginPath(); g.roundRect(14, 18, 228, 44, 22); g.stroke(); g.restore(); }
  g.fillStyle = speaking ? 'rgba(8,40,22,0.85)' : 'rgba(10,12,16,0.72)'; g.beginPath(); g.roundRect(14, 18, 228, 44, 22); g.fill();
  if (speaking) { // speaker with two sound waves
    g.fillStyle = '#3dff8a'; g.beginPath(); g.moveTo(28, 34); g.lineTo(34, 34); g.lineTo(42, 27); g.lineTo(42, 53); g.lineTo(34, 46); g.lineTo(28, 46); g.closePath(); g.fill();
    g.strokeStyle = '#3dff8a'; g.lineWidth = 3; g.lineCap = 'round';
    for (const r of [6, 11]) { g.beginPath(); g.arc(44, 40, r, -0.9, 0.9); g.stroke(); }
  } else { g.fillStyle = '#' + color.toString(16).padStart(6, '0'); g.beginPath(); g.arc(40, 40, 10, 0, 7); g.fill(); }
  g.fillStyle = '#fff'; g.font = '600 28px Inter, system-ui, sans-serif'; g.textBaseline = 'middle';
  g.fillText(name.slice(0, 13), 62, 41);
}

function tag(name, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 80;
  drawTag(c, name, color, false);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(1.6, 0.5, 1); s.position.y = 2.3; s.renderOrder = 10;
  s.userData.speak = on => { if (s.userData.on === on) return; s.userData.on = on; drawTag(c, name, color, on); t.needsUpdate = true; };
  return s;
}

function dispose(o) { // shared kit geometry/materials (bike.glb, hands.glb) stay alive for the next rider
  o.traverse(x => { if (!x.userData.kit) x.geometry?.dispose(); for (const m of [x.material].flat()) if (m && !m.userData.kit) { if (!m.map?.userData.kit) m.map?.dispose(); m.dispose(); } });
}

// lateral lanes for other riders next to your line (1.2 m right of centre, asphalt ±3.3 m): 1.1 m apart = shoulder to shoulder
// rows of two: one friend next to you (your line is 1.2 m right of the centre, the slot 0.1 m), everyone else
// in rows 2.5 m behind; nobody ever rides on the edge line (asphalt ends at 3.3 m, line at 2.8-2.92 m)
const SLOTS = [[-1.1, 0], [0, 1], [-1.1, 1], [0, 2], [-1.1, 2], [0, 3], [-1.1, 3]];
const ROW_GAP = 2.5;
const SIDE_LOCK = 0.8, SIDE_FREE = 2.5; // within 0.8 m: exactly alongside; from 2.5 m: true gap (12.11.: wider made the slipstream look glued)
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Riders {
  constructor(scene, field) {
    this.scene = scene; this.field = field; this.list = new Map(); this.n = 0;
    loadRiderKit().then(ok => { if (ok) for (const e of this.list.values()) e.key = 'stale'; }); // detailed bike/hands arrived: rebuild on the next update
  }

  /** riders: [{ id, name, d, v, look, ghost, self, color, speaking }] — d in metres along the route, v m/s (wheel and leg speed) */
  set(riders) {
    const seen = new Set();
    for (const r of riders) {
      seen.add(r.id);
      let e = this.list.get(r.id);
      const key = JSON.stringify([r.look || null, !!r.ghost, r.name || '']);
      if (e && e.key !== key) { this.scene.remove(e.obj); dispose(e.obj); e.obj = null; }
      if (!e) {
        e = { d: r.d, shown: r.d, v: 0, crank: Math.random() * 6, color: r.color ?? COLORS[this.n % COLORS.length], lane: r.self ? 0 : SLOTS[this.n % SLOTS.length][0], row: r.self ? 0 : SLOTS[this.n % SLOTS.length][1] };
        if (!r.self) this.n++;
        this.list.set(r.id, e);
      }
      if (!e.obj) {
        e.obj = makeRider(r.look, { ghost: r.ghost });
        if (!r.self) e.obj.add(e.tag = tag(r.name || 'Fahrer', e.color));
        this.scene.add(e.obj); e.key = key;
      }
      if (r.d !== e.d) e.at = performance.now() / 1000; // a fresh position from the network (friends send ~2 per second)
      e.tag?.userData.speak(!!r.speaking);
      e.d = r.d; e.v = r.v || 0; e.self = !!r.self; e.ghost = !!r.ghost;
    }
    for (const [id, e] of this.list) if (!seen.has(id)) { this.scene.remove(e.obj); dispose(e.obj); this.list.delete(id); }
  }

  /** called each frame; ownD = own position, so riders right next to you stay beside you and never in the camera */
  update(dt, ownD, hideSelf = false) { // hideSelf: first-person view, where your own rider only exists for the share photo
    for (const e of this.list.values()) {
      if (e.self) e.shown = ownD;
      else {
        // dead reckoning: ride on at the last known speed and steer gently towards where the friend should be by now.
        // The old pull towards the last packet made them surge and drop back twice a second.
        const age = Math.min(1.5, performance.now() / 1000 - (e.at || 0)), err = e.d + e.v * age - e.shown;
        const step = e.v * dt + err * Math.min(1, dt * 1.2);
        e.shown += e.v > 0.5 ? Math.max(step, e.v * dt * 0.4) : step; // while riding never roll backwards, only a bit slower
        if (Math.abs(err) > 60) e.shown = e.d + e.v * age;
      }
      // side by side: a friend within a bike length or two is drawn exactly level with you (wheel by wheel, no
      // jitter from network lag); further back or ahead the real gap shows again, blended in so nothing jumps
      const gap = e.shown - ownD, ag = Math.abs(gap);
      const k = smooth(SIDE_LOCK, SIDE_FREE, ag), at = e.self || e.ghost ? e.shown : ownD + gap * k - e.row * ROW_GAP * (1 - k);
      // own lane, eased: no rider ever shares your line, so nobody rides through the camera
      const lat = 1.2 + e.lane; e.lat = e.lat == null ? lat : e.lat + (lat - e.lat) * Math.min(1, dt * 2);
      const p = this.field.pose(Math.max(0, at), e.lat, 0);
      const o = e.obj; if (!o) continue;
      const dist = ag;
      o.visible = dist < 400 && !(e.self && hideSelf); // beyond 400 m a rider is a few pixels; never your own head in front of your own camera
      if (!o.visible) continue;
      const sh = dist < 25 || e.self; for (const m of o.userData.shadow || []) m.castShadow = sh;
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
