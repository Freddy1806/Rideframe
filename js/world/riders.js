// Other riders in the 3D world: friends riding live (group ride) and the ghost of a shared or own ride.
// Each rider is a small procedural cyclist (wheels, frame, body, pedalling legs) with a name tag above,
// standing on the road at its distance d. Lanes are spread so riders side by side don't overlap.
import * as THREE from 'three';

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
  s.scale.set(1.6, 0.4, 1); s.position.y = 2.25; s.renderOrder = 10;
  return s;
}

function cyclist(color) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6, metalness: 0.3 });
  const jersey = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a27e, roughness: 0.7 });
  const wheelGeo = new THREE.TorusGeometry(0.34, 0.025, 6, 28);
  const wheels = [];
  for (const z of [-0.52, 0.52]) { const w = new THREE.Mesh(wheelGeo, dark); w.rotation.y = Math.PI / 2; w.position.set(0, 0.35, z); g.add(w); wheels.push(w); }
  const bar = (a, b, r = 0.022, m = jersey) => { // tube between two points
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 6), m);
    t.position.copy(A).add(B).multiplyScalar(0.5); t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    g.add(t); return t;
  };
  bar([0, 0.35, -0.52], [0, 0.42, -0.05]); bar([0, 0.42, -0.05], [0, 0.82, -0.12]); bar([0, 0.82, -0.12], [0, 0.8, 0.42]);
  bar([0, 0.42, -0.05], [0, 0.78, 0.4]); bar([0, 0.8, 0.42], [0, 0.35, 0.52], 0.02, dark); bar([0, 0.35, -0.52], [0, 0.82, -0.12], 0.016, dark);
  // rider: torso leaning forward, arms to the bar, head with helmet
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 8), jersey);
  torso.position.set(0, 1.18, 0.05); torso.rotation.x = 1.05; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), skin); head.position.set(0, 1.42, 0.36); g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), jersey); helmet.position.copy(head.position).y += 0.02; g.add(helmet);
  for (const x of [-0.17, 0.17]) bar([x, 1.32, 0.22], [x * 0.9, 0.86, 0.44], 0.04, skin);
  const legs = [];
  for (const side of [-1, 1]) { // thigh + shin as one pivoting group at the hip
    const leg = new THREE.Group(); leg.position.set(side * 0.11, 0.95, -0.12);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.32, 3, 6), dark); thigh.position.y = -0.2; leg.add(thigh);
    g.add(leg); legs.push(leg);
  }
  g.userData = { wheels, legs };
  return g;
}

export class Riders {
  constructor(scene, field) { this.scene = scene; this.field = field; this.list = new Map(); this.phase = 0; }

  /** riders: [{ id, name, d, v }] — d in metres along the route, v m/s (for wheel and leg speed) */
  set(riders) {
    const seen = new Set();
    riders.forEach((r, i) => {
      seen.add(r.id);
      let e = this.list.get(r.id);
      if (!e) {
        const color = r.color ?? COLORS[this.list.size % COLORS.length];
        const obj = cyclist(color); obj.add(tag(r.name || 'Fahrer', color));
        this.scene.add(obj); e = { obj, d: r.d, shown: r.d, v: r.v || 0, lane: [-0.9, 0.9, 0, -1.8, 1.8][this.list.size % 5] };
        this.list.set(r.id, e);
      }
      e.d = r.d; e.v = r.v || 0;
    });
    for (const [id, e] of this.list) if (!seen.has(id)) { this.scene.remove(e.obj); this.list.delete(id); }
  }

  /** called each frame; d = own position, so riders right next to you stay beside you and never in the camera */
  update(dt, ownD) {
    this.phase += dt;
    for (const e of this.list.values()) {
      e.shown += (e.d - e.shown) * Math.min(1, dt * 4) + e.v * dt * 0.5; // smooth between 2 updates per second
      if (Math.abs(e.shown - e.d) > 60) e.shown = e.d;
      const near = Math.abs(e.shown - ownD) < 3; // alongside: move one lane further out so nobody rides through the camera
      const p = this.field.pose(Math.max(0, e.shown), 1.2 + e.lane + (near ? 1.4 : 0), 0);
      const o = e.obj; o.visible = Math.abs(e.shown - ownD) < 900;
      if (!o.visible) continue;
      o.position.set(p.x, p.y, p.z);
      o.lookAt(p.lx, p.y, p.lz);
      const turn = e.v / 0.34 * dt, crank = this.phase * e.v * 1.1;
      for (const w of o.userData.wheels) w.rotation.x -= turn;
      o.userData.legs.forEach((l, k) => { l.rotation.x = 0.55 + Math.sin(crank + k * Math.PI) * 0.45; });
    }
  }

  destroy() { for (const e of this.list.values()) this.scene.remove(e.obj); this.list.clear(); }
}
