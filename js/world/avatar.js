// Your rider, Mii style: body, size, build, face, hair, outfit, helmet and shoes, all built from simple shapes
// (no asset files, so it works for every friend). The look is a small object that goes over the network
// to the others in a group ride. Legs pedal with a little two-bone IK so the feet stay on the pedals.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../../vendor/jsm/libs/meshopt_decoder.module.js';
import { floatify } from './assets.js';

// Optional detailed parts from the Mac (assets/world/rider/bike.glb, hands.glb). Missing files: the simple built-in bike and hands stay.
const KIT = { bike: null, hands: null };
let kitLoad = null;
export function loadRiderKit() {
  if (kitLoad) return kitLoad;
  const base = new URL('../../assets/world/rider/', import.meta.url), loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // only files the manifest lists (category "rider"), so a missing kit causes no 404s in the console
  const listed = fetch(new URL('../manifest.json', base)).then(r => (r.ok ? r.json() : [])).catch(() => []).then(l => new Set((Array.isArray(l) ? l : []).filter(e => e?.category === 'rider').map(e => e.file)));
  const one = async f => { if (!(await listed).has('rider/' + f)) return null; try { const sc = (await loader.loadAsync(new URL(f, base).href)).scene; sc.traverse(o => { if (o.isMesh) { o.userData.kit = true; floatify(o.geometry); for (const m of [o.material].flat()) { m.userData.kit = true; for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].userData.kit = true; } } }); return sc; } catch { return null; } };
  kitLoad = Promise.all([one('bike.glb'), one('hands.glb')]).then(([b, h]) => { KIT.bike = b; KIT.hands = h; return !!(b || h); });
  return kitLoad;
}
// Per rider only the tinted materials (frame, skin, glove) are cloned; spokes, chain, tape etc. share one material.
// Only the frame casts a shadow (Riders switches it off beyond 25 m): spokes and chain in the shadow pass were the big cost with 5 riders.
function kitClone(scene, ghost, recolor) {
  const c = scene.clone(true); c.userData.shadow = [];
  c.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = /^frame/i.test(o.name) || /^frame/i.test(o.parent?.name || ''); if (o.castShadow) c.userData.shadow.push(o);
    o.material = (Array.isArray(o.material) ? o.material : [o.material]).map(m => {
      if (!ghost && !/frame|skin|glove/i.test(m.name)) return m;
      const n = m.clone(); n.userData.kit = false; recolor?.(n);
      if (ghost) { n.transparent = true; n.opacity = 0.45; n.depthWrite = false; }
      return n;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
  return c;
}

import { SKINS, HAIRCOL, COLORS, OPTIONS, DEFAULT_LOOK, cleanLook, randomLook } from '../look.js';
export { SKINS, HAIRCOL, COLORS, OPTIONS, DEFAULT_LOOK, cleanLook, randomLook };

// ---------- materials ----------
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
function patternTex(kind, a, b) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 128, 128);
  if (kind === 'team') { g.fillStyle = b; g.fillRect(0, 52, 128, 24); g.fillStyle = '#fff'; g.fillRect(0, 50, 128, 3); g.fillRect(0, 76, 128, 3); }
  else if (kind === 'neon80') { const cols = ['#ff2fd0', '#2ff4ff', '#fff23a', b]; for (let i = 0; i < 9; i++) { g.strokeStyle = cols[i % 4]; g.lineWidth = 7; g.beginPath(); for (let x = -10; x <= 140; x += 16) g.lineTo(x, 8 + i * 15 + ((x / 16) % 2 ? 8 : 0)); g.stroke(); } }
  else if (kind === 'retro') { g.fillStyle = b; g.fillRect(0, 40, 128, 14); g.fillRect(0, 62, 128, 14); g.fillStyle = '#fff'; g.font = 'bold 22px serif'; g.fillText('VELO', 34, 30); }
  else if (kind === 'hawaii') { for (let i = 0; i < 26; i++) { const x = Math.random() * 128, y = Math.random() * 128, col = ['#ff3b6b', '#ffd23f', '#fff', b][i % 4]; g.fillStyle = col; for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(x + Math.cos(k * 1.26) * 6, y + Math.sin(k * 1.26) * 6, 5, 3, k * 1.26, 0, 7); g.fill(); } g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); } g.fillStyle = '#2fb36b'; for (let i = 0; i < 12; i++) { g.beginPath(); g.ellipse(Math.random() * 128, Math.random() * 128, 10, 4, Math.random() * 3, 0, 7); g.fill(); } }
  else if (kind === 'anzug') { g.fillStyle = '#f4f4ef'; g.beginPath(); g.moveTo(50, 0); g.lineTo(64, 70); g.lineTo(78, 0); g.fill(); g.fillStyle = b; g.beginPath(); g.moveTo(60, 8); g.lineTo(68, 8); g.lineTo(70, 60); g.lineTo(64, 70); g.lineTo(58, 60); g.fill(); }
  else if (kind === 'superheld') { g.fillStyle = b; g.beginPath(); g.moveTo(64, 30); g.lineTo(90, 55); g.lineTo(64, 95); g.lineTo(38, 55); g.closePath(); g.fill(); g.fillStyle = a; g.font = 'bold 40px sans-serif'; g.fillText('S', 52, 76); }
  else if (kind === 'dino') { g.fillStyle = 'rgba(0,0,0,.18)'; for (let i = 0; i < 30; i++) { g.beginPath(); g.arc(Math.random() * 128, Math.random() * 128, 4 + Math.random() * 6, 0, 7); g.fill(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// ---------- shop items (js/shop.js): all from shapes and canvas textures, so they work without any asset file ----------
const seeded = (s = 7) => () => (s = (s * 16807) % 2147483647) / 2147483647;
function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function starPath(g, x, y, r, n = 5, inner = 0.45, rot = -Math.PI / 2) {
  g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, rr = i % 2 ? r * inner : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath();
}
function moon(g, x, y, r, col) { // a crescent: a disc with a second disc cut out of it
  const c = document.createElement('canvas'); c.width = c.height = Math.ceil(r * 2 + 4); const m = c.getContext('2d');
  m.fillStyle = col; m.beginPath(); m.arc(r + 2, r + 2, r, 0, 7); m.fill(); m.globalCompositeOperation = 'destination-out'; m.beginPath(); m.arc(r + 2 + r * 0.55, r + 2 - r * 0.3, r * 0.85, 0, 7); m.fill();
  g.drawImage(c, x - r - 2, y - r - 2);
}
/** night sky: deep blue, dust of small stars, gold five-point stars (density 0..1), optional moon at (mx, my) in 0..1 */
function skyTex({ top = '#1d2a78', bottom = '#0d1240', n = 26, big = 8, w = 256, h = 256, moonAt = null, seed = 3 } = {}) {
  return canvasTex(w, h, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const r = seeded(seed);
    for (let i = 0; i < n * 6; i++) { g.fillStyle = `rgba(255,255,240,${0.25 + r() * 0.6})`; g.beginPath(); g.arc(r() * w, r() * h, 0.6 + r() * 1.1, 0, 7); g.fill(); }
    for (let i = 0; i < big; i++) { const x = r() * w, y = r() * h, s = w / 40 + r() * w / 40; g.fillStyle = r() < 0.75 ? '#f6c84c' : '#fff3c4'; starPath(g, x, y, s, 5, 0.45, r() * 6); g.fill(); }
    if (moonAt) moon(g, moonAt[0] * w, moonAt[1] * h, w * 0.11, '#f6c84c');
  }, true);
}
function woodTex() {
  return canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#a8692f'; g.fillRect(0, 0, w, h); const r = seeded(11);
    for (let i = 0; i < 26; i++) { const x = r() * w, a = 0.08 + r() * 0.18; g.strokeStyle = r() < 0.5 ? `rgba(70,35,10,${a})` : `rgba(230,170,100,${a})`; g.lineWidth = 1 + r() * 3;
      g.beginPath(); for (let y = 0; y <= h; y += 8) g.lineTo(x + Math.sin(y / 30 + i) * 3, y); g.stroke(); }
  }, true);
}
function scaleTex() { // dragon scales: overlapping rounded scales, light edge, dark gap
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#123f1c'; g.fillRect(0, 0, w, h); const s = 16;
    for (let row = -1, y = 0; y < h + s; row++, y += s * 0.62) for (let x = (row % 2) * s / 2 - s; x < w + s; x += s) {
      const gr = g.createRadialGradient(x, y - s * 0.2, 1, x, y, s * 0.62); gr.addColorStop(0, '#5fbf4a'); gr.addColorStop(0.7, '#2e8a34'); gr.addColorStop(1, '#0f3517');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, s * 0.55, 0, Math.PI); g.lineTo(x - s * 0.55, y - s * 0.3); g.arc(x, y - s * 0.3, s * 0.55, Math.PI, 0, true); g.closePath(); g.fill(); }
  }, true);
}
function eagleTex() { // brown feathers, white shoulders (canvas top = shoulders), a gold band at the waist
  return canvasTex(256, 192, (g, w, h) => {
    g.fillStyle = '#4a2c14'; g.fillRect(0, 0, w, h); const r = seeded(5), fw = 22, fh = 30;
    for (let y = h + fh; y > -fh; y -= fh * 0.5) for (let x = ((y / (fh * 0.5)) % 2) * fw / 2 - fw; x < w + fw; x += fw) {
      const white = y < h * 0.34 + Math.sin(x / 19) * 8, base = white ? [242, 238, 228] : [110 + r() * 30 | 0, 70 + r() * 20 | 0, 36 + r() * 14 | 0];
      g.fillStyle = `rgb(${base})`; g.strokeStyle = white ? 'rgba(120,110,95,.55)' : 'rgba(30,16,6,.7)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x - fw * 0.5, y - fh * 0.4); g.quadraticCurveTo(x - fw * 0.55, y + fh * 0.35, x, y + fh * 0.5); g.quadraticCurveTo(x + fw * 0.55, y + fh * 0.35, x + fw * 0.5, y - fh * 0.4); g.fill(); g.stroke();
      g.strokeStyle = white ? 'rgba(150,140,120,.5)' : 'rgba(40,22,8,.5)'; g.beginPath(); g.moveTo(x, y - fh * 0.3); g.lineTo(x, y + fh * 0.42); g.stroke(); }
  });
}
function knightTex(tabard = true) { // steel plates around, a red tabard with a gold cross on chest (u = 0) and back (u = 0.5)
  return canvasTex(256, 192, (g, w, h) => {
    const st = g.createLinearGradient(0, 0, 0, h); st.addColorStop(0, '#c9d0d8'); st.addColorStop(1, '#7d868f'); g.fillStyle = st; g.fillRect(0, 0, w, h);
    for (let y = 18; y < h; y += 26) { g.fillStyle = 'rgba(30,34,40,.55)'; g.fillRect(0, y, w, 3); g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(0, y + 3, w, 2);
      g.fillStyle = '#4b5158'; for (let x = 6; x < w; x += 22) { g.beginPath(); g.arc(x, y + 9, 2, 0, 7); g.fill(); } }
    const panel = (cx) => { const pw = w * 0.26; for (const x0 of [cx - pw / 2, cx - pw / 2 + w, cx - pw / 2 - w]) {
      g.fillStyle = '#9e1b1b'; g.fillRect(x0, 0, pw, h); g.fillStyle = '#e8b53a'; g.fillRect(x0, 0, 4, h); g.fillRect(x0 + pw - 4, 0, 4, h); g.fillRect(x0, h - 6, pw, 6);
      const mx = x0 + pw / 2, my = h * 0.45; g.fillRect(mx - 6, my - 38, 12, 76); g.fillRect(mx - 26, my - 14, 52, 12); } };
    if (tabard) { panel(0); panel(w / 2); }
  });
}
function featherTex() {
  return canvasTex(64, 256, (g, w, h) => {
    g.save(); g.beginPath(); g.moveTo(w / 2, 2); g.bezierCurveTo(w * 0.98, h * 0.25, w * 0.92, h * 0.75, w / 2 + 3, h - 30); g.lineTo(w / 2 - 3, h - 30); g.bezierCurveTo(w * 0.08, h * 0.75, w * 0.02, h * 0.25, w / 2, 2); g.closePath(); g.clip();
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2a180c'); gr.addColorStop(0.18, '#5b3618'); gr.addColorStop(0.55, '#8a5a2c'); gr.addColorStop(0.72, '#efe8d8'); gr.addColorStop(1, '#ffffff');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(20,10,4,.35)'; g.lineWidth = 1; for (let y = 6; y < h; y += 5) { g.beginPath(); g.moveTo(w / 2, y); g.lineTo(2, y + 12); g.moveTo(w / 2, y); g.lineTo(w - 2, y + 12); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(4, h * 0.16, w - 8, 6); g.restore();
    g.strokeStyle = '#f1ead8'; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, 4); g.lineTo(w / 2, h); g.stroke();
  });
}
const goldM = (o = {}) => mat('#e9b43a', { metalness: 0.8, roughness: 0.28, emissive: '#3d2700', emissiveIntensity: 0.5, ...o });
/** a flat star with a little depth (shop items) */
function starMesh(r, m) {
  const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  const g = new THREE.ExtrudeGeometry(s, { depth: r * 0.15, bevelEnabled: true, bevelThickness: r * 0.08, bevelSize: r * 0.06, bevelSegments: 1 }); g.translate(0, 0, -r * 0.075); return new THREE.Mesh(g, m);
}
/** the wizard hat: brim, a tall cone bent backwards, a band with a buckle, stars; replaces the helmet (head coordinates) */
function wizardHat() {
  const hat = new THREE.Group(), cloth = mat('#ffffff', { map: skyTex({ top: '#2a2f8a', bottom: '#151a52', n: 14, big: 0, seed: 9 }), roughness: 0.85, side: THREE.DoubleSide });
  const brim = new THREE.Mesh(new THREE.LatheGeometry([V(0.12, 0.012, 0), V(0.2, 0.004, 0), V(0.272, -0.026, 0), V(0.278, -0.036, 0), V(0.2, -0.008, 0), V(0.12, -0.004, 0)].map(p => new THREE.Vector2(p.x, p.y)), 40), cloth); hat.add(brim);
  const H = 0.5, R0 = 0.152, bend = (x, y, z) => { const t = Math.max(0, y / H); return [x, y - 0.05 * t ** 3, z - 0.2 * t ** 2.4]; };
  const prof = []; for (let i = 0; i <= 18; i++) { const t = i / 18; prof.push(new THREE.Vector2(Math.max(0.002, R0 * (1 - t) ** 1.25), t * H)); }
  const cg = new THREE.LatheGeometry(prof, 32), pa = cg.attributes.position;
  for (let i = 0; i < pa.count; i++) { const [x, y, z] = bend(pa.getX(i), pa.getY(i), pa.getZ(i)); pa.setXYZ(i, x, y, z); } cg.computeVertexNormals();
  hat.add(new THREE.Mesh(cg, cloth));
  const gold = goldM(), band = new THREE.Mesh(new THREE.CylinderGeometry(R0 * 0.93, R0 * 1.01, 0.05, 32, 1, true), mat('#e0a530', { metalness: 0.45, roughness: 0.4, side: THREE.DoubleSide })); band.position.y = 0.03; hat.add(band);
  const buckle = new THREE.Group(); for (const [w, h, x, y] of [[0.06, 0.009, 0, 0.022], [0.06, 0.009, 0, -0.022], [0.009, 0.053, 0.026, 0], [0.009, 0.053, -0.026, 0]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.008), mat('#2a2140', { metalness: 0.3, roughness: 0.4 })); b.position.set(x, y, 0); buckle.add(b); }
  buckle.position.set(0, 0.03, R0 * 1.0); hat.add(buckle);
  const at = (t, phi, s) => { const r = R0 * (1 - t) ** 1.25 + 0.004, [x, y, z] = bend(Math.sin(phi) * r, t * H, Math.cos(phi) * r), st = starMesh(s, gold); st.position.set(x, y, z);
    st.lookAt(x + Math.sin(phi), y + 0.3, z + Math.cos(phi) - 0.15 * t); hat.add(st); };
  at(0.3, 0.35, 0.03); at(0.48, -0.9, 0.024); at(0.58, 1.6, 0.02); at(0.22, -2.3, 0.026); at(0.4, 2.7, 0.022); at(0.7, 0.2, 0.016);
  const tip = starMesh(0.028, gold), [tx, ty, tz] = bend(0, H, 0); tip.position.set(tx, ty + 0.01, tz - 0.012); tip.rotation.y = Math.PI / 2; hat.add(tip);
  hat.position.y = 0.06; hat.rotation.x = -0.1; return hat;
}
/** the crown: gold band with points and pearls, jewels, red velvet, an ermine rim (head coordinates) */
function crown() {
  const c = new THREE.Group(), gold = goldM({ side: THREE.DoubleSide }), R = 0.15;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.04, R, 0.07, 40, 1, true), gold); band.position.y = 0.105; c.add(band);
  const velvet = new THREE.Mesh(new THREE.SphereGeometry(R * 0.97, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat('#8e1022', { roughness: 0.95 })); velvet.position.y = 0.11; velvet.scale.y = 0.75; c.add(velvet);
  const ermine = new THREE.Mesh(new THREE.TorusGeometry(R * 1.01, 0.017, 10, 40), mat('#f4f1ea', { roughness: 1 })); ermine.rotation.x = Math.PI / 2; ermine.position.y = 0.072; c.add(ermine);
  for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, d = ball(0.006, mat('#141414'), V(Math.sin(a) * R * 1.12, 0.074, Math.cos(a) * R * 1.12)); c.add(d); }
  const jw = ['#d0142b', '#16a34a', '#1d5fd8'];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, x = Math.sin(a), z = Math.cos(a);
    const pt = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.085, 4), gold); pt.position.set(x * R * 1.03, 0.18, z * R * 1.03); pt.rotation.y = a + Math.PI / 4; c.add(pt);
    c.add(ball(0.013, mat('#fbf6e9', { roughness: 0.25, metalness: 0.1 }), V(x * R * 1.03, 0.228, z * R * 1.03)));
    const b = a + Math.PI / 8, col = jw[i % 3], j = ball(i === 7 ? 0.02 : 0.015, mat(col, { roughness: 0.15, metalness: 0.2, emissive: col, emissiveIntensity: 0.35 }), V(Math.sin(b) * R * 1.06, 0.108, Math.cos(b) * R * 1.06)); j.scale.z = 0.6; j.lookAt(0, 0.108, 0); c.add(j);
  }
  const front = ball(0.022, mat('#d0142b', { roughness: 0.12, emissive: '#d0142b', emissiveIntensity: 0.4 }), V(0, 0.11, R * 1.07)); front.scale.z = 0.6; c.add(front);
  const cross = goldM(); for (const [w, h] of [[0.012, 0.05], [0.034, 0.012]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), cross); b.position.set(0, 0.235, 0); c.add(b); }
  c.position.y = 0.0; c.rotation.x = -0.08; return c;
}
/** an eagle feather tucked into the headwear on the left side, leaning back (head coordinates) */
function feather(y = 0.1, x = -0.16) {
  const g = new THREE.PlaneGeometry(0.075, 0.32, 1, 8), pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) { const t = (pa.getY(i) + 0.16) / 0.32; pa.setZ(i, 0.05 * t * t); } g.computeVertexNormals(); g.translate(0, 0.14, 0);
  const f = new THREE.Mesh(g, mat('#ffffff', { map: featherTex(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 }));
  f.rotation.y = -Math.PI / 2; // the flat side faces out to the left
  const o = new THREE.Group(); o.add(f); o.position.set(x, y, -0.03); o.rotation.set(-0.7, 0, 0.42); return o;
}
/** the wizard cloak: long, curved over the back and flowing behind the saddle; dark blue with a gold hem outside, starry lining inside */
function cloakTex() {
  return canvasTex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#26307a'); gr.addColorStop(1, '#161c55'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) { const x = (i + 0.5) / 7 * w, f = g.createLinearGradient(x - 18, 0, x + 18, 0); f.addColorStop(0, 'rgba(0,0,0,0)'); f.addColorStop(0.5, 'rgba(0,0,0,.18)'); f.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = f; g.fillRect(x - 18, 0, 36, h); }
    g.fillStyle = '#e2b13c'; g.fillRect(0, 0, 7, h); g.fillRect(w - 7, 0, 7, h); g.fillRect(0, h - 12, w, 12); g.fillStyle = '#9c7420'; g.fillRect(0, h - 15, w, 3);
    for (let x = 14; x < w; x += 28) { g.fillStyle = '#e2b13c'; starPath(g, x, h - 26, 5); g.fill(); }
  });
}
function wizardCloak(sh, tR) {
  const curve = new THREE.CatmullRomCurve3([V(0, sh.y + tR * 0.62, sh.z - tR * 0.7), V(0, 1.16, -0.28), V(0, 0.96, -0.56), V(0, 0.83, -0.8), V(0, 0.75, -0.98)]);
  const NU = 14, NV = 20, pos = [], uv = [], idx = [], base = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const u = i / NU * 2 - 1, v = j / NV * (1 - 0.07 * u * u), c = curve.getPointAt(v), t = curve.getTangentAt(v), n = V(0, -t.z, t.y).normalize(); if (n.y < 0) n.negate();
    const w = 0.17 + tR * 0.55 + v * 0.2, k = 0.17 * (1 - v) ** 1.5 + 0.03, fold = 0.028 * v * Math.sin(u * Math.PI * 2.5 + 0.6);
    const p = c.clone().add(V(u * w, 0, 0)).addScaledVector(n, -u * u * k + 0.012 + fold); pos.push(p.x, p.y, p.z); uv.push(i / NU, 1 - j / NV); base.push({ v, u, n });
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + NU + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat('#ffffff', { map: cloakTex(), roughness: 0.72, side: THREE.FrontSide })));
  const lin = skyTex({ top: '#3446b8', bottom: '#2a3794', n: 22, big: 14, seed: 21 }); lin.repeat.set(2, 2);
  g.add(new THREE.Mesh(geo, mat('#ffffff', { map: lin, roughness: 0.6, side: THREE.BackSide })));
  for (const s of [-1, 1]) { const clasp = starMesh(0.03, goldM()); clasp.position.set(s * (0.17 + tR * 0.25), sh.y + 0.06, sh.z + 0.04); clasp.rotation.x = -0.5; g.add(clasp); }
  const p0 = Float32Array.from(pos);
  g.userData.flap = a => { // a little wave along the lower part while pedalling
    const pa = geo.attributes.position;
    for (let q = 0; q < base.length; q++) { const { v, u, n } = base[q], d = Math.sin(a * 1.3 + v * 5 + u * 1.5) * 0.03 * v * v; pa.setXYZ(q, p0[q * 3] + n.x * d, p0[q * 3 + 1] + n.y * d, p0[q * 3 + 2] + n.z * d - 0.02 * v * v * (1 + Math.sin(a * 0.9))); }
    pa.needsUpdate = true; geo.computeVertexNormals();
  };
  return g;
}
/** wizard gloves: dark blue with gold stars (rider, kit hands and the first-person bars) */
export function gloveMaterial(look) {
  if (cleanLook(look).gloves !== 'zauber') return null;
  const t = skyTex({ top: '#1f2a78', bottom: '#162060', n: 6, big: 7, w: 128, h: 128, seed: 4 }); t.repeat.set(1.5, 1.5);
  return mat('#ffffff', { map: t, roughness: 0.7 });
}
/** the first-person bars when the cockpit model is missing (cloud, ?fakeassets) and you wear shop gloves: bar, hoods,
 *  gloved hands and forearms, laid out like assets cockpit.glb (eye at the origin, bar centre 0.45 m below, 0.55 m ahead) */
export function makeCockpit(look) {
  const L = cleanLook(look), g = new THREE.Group(), tape = mat('#1b1d22', { roughness: 0.8 }), skinM = mat(SKINS[L.skin], { roughness: 0.75 }), glove = gloveMaterial(L) || mat('#1b1d22');
  const bar = limb(0.013, tape); place(bar, V(-0.235, -0.45, -0.55), V(0.235, -0.45, -0.55)); bar.name = 'lenker'; g.add(bar);
  const stem = limb(0.018, mat('#2a2d33', { metalness: 0.5, roughness: 0.4 })); place(stem, V(0, -0.45, -0.55), V(0, -0.5, -0.66)); g.add(stem);
  for (const s of [-1, 1]) {
    const hx = s * 0.205, hood = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.06, 4, 8), tape); hood.position.set(hx, -0.44, -0.6); hood.rotation.x = Math.PI / 2 - 0.35; g.add(hood);
    const lever = limb(0.006, mat('#9aa0a6', { metalness: 0.6, roughness: 0.3 })); place(lever, V(hx, -0.44, -0.635), V(hx, -0.53, -0.64)); g.add(lever);
    const drop = limb(0.012, tape); place(drop, V(s * 0.235, -0.45, -0.55), V(s * 0.215, -0.47, -0.62)); g.add(drop);
    const hand = ball(0.042, glove, V(hx, -0.418, -0.58)); hand.scale.set(1, 0.8, 1.35); g.add(hand);
    const thumb = ball(0.016, glove, V(hx - s * 0.03, -0.43, -0.6)); thumb.scale.set(1, 1, 1.8); g.add(thumb);
    const cuff = limb(0.034, L.gloves === 'zauber' ? goldM() : tape); place(cuff, V(hx + s * 0.004, -0.42, -0.535), V(hx + s * 0.008, -0.425, -0.52)); g.add(cuff);
    const arm = limb(0.032, skinM); place(arm, V(hx + s * 0.008, -0.425, -0.525), V(s * 0.3, -0.62, -0.18)); g.add(arm);
  }
  g.traverse(o => { o.castShadow = false; o.frustumCulled = false; o.layers.set(1); });
  return g;
}
/** cockpit.glb's gloves in the shop gloves (materials named glove / handschuh) */
export function gloveCockpit(obj, look) {
  const gm = gloveMaterial(look); if (!gm) return 0; let n = 0;
  obj.traverse(o => { if (!o.isMesh) return; const ms = [o.material].flat(); if (ms.some(m => /glove|handschuh/i.test(m?.name || ''))) { o.material = Array.isArray(o.material) ? ms.map(m => /glove|handschuh/i.test(m?.name || '') ? gm : m) : gm; n++; } });
  return n;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
function limb(r, m) { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, 1, 10), m); o.userData.r = r; return o; }
function place(o, a, b) { o.position.copy(a).add(b).multiplyScalar(0.5); o.scale.set(1, a.distanceTo(b), 1); o.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize()); }
function ball(r, m, p) { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m); if (p) o.position.copy(p); return o; }

/** a complete rider on a bike; returns a Group with .userData.pedal(angle) */
export function makeRider(look, opts = {}) {
  const L = cleanLook(look), g = new THREE.Group(), ghost = opts.ghost;
  const f = L.body === 'f', b = L.build, c1 = COLORS[L.c1], c2 = COLORS[L.c2];
  const skin = mat(SKINS[L.skin], { roughness: 0.75 }), hairM = mat(HAIRCOL[L.hairColor], { roughness: 0.9 });
  const dark = mat(0x1b1d22, { metalness: 0.4, roughness: 0.45 });
  const frameM = { holz: () => mat('#ffffff', { map: woodTex(), roughness: 0.45, metalness: 0.05 }), drache: () => mat('#ffffff', { map: scaleTex(), roughness: 0.42, metalness: 0.15 }), gold: () => goldM() }[L.bike]?.()
    || mat(c2 === c1 ? '#1b1d22' : c2, { metalness: 0.5, roughness: 0.35 });
  const shopBike = L.bike !== 'standard' || L.wheels !== 'standard', glowCol = ['#1b1d22', '#f4f4ef'].includes(c1) ? '#2ff4ff' : c1;
  const tyreM = L.bike === 'holz' ? mat('#eadcb8', { roughness: 0.85 }) : dark;
  const rimM = L.wheels === 'glow' ? mat(glowCol, { emissive: glowCol, emissiveIntensity: 2.4, roughness: 0.3 }) : L.bike === 'gold' ? goldM() : L.bike === 'drache' ? mat('#3a2a14', { metalness: 0.6, roughness: 0.35 }) : mat('#c9ccd1', { metalness: 0.7, roughness: 0.3 });
  const outfitCol = { banane: '#ffd93b', superheld: '#2f5fd8', wikinger: '#6b4a2c', tutu: '#ff9ccf', dino: '#3fae4a', anzug: '#23262d' }[L.outfit] || c1;
  const shopJersey = { sterne: () => skyTex({ w: 320, h: 200, n: 30, big: 12, moonAt: [0.5, 0.42], seed: 17 }), adler: eagleTex, ritter: knightTex }[L.outfit];
  const jersey = shopJersey ? mat('#ffffff', { map: shopJersey(), roughness: L.outfit === 'ritter' ? 0.35 : 0.65, metalness: L.outfit === 'ritter' ? 0.45 : 0 })
    : new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.6, map: patternTex(L.outfit, outfitCol, L.outfit === 'superheld' ? '#e0452b' : L.outfit === 'anzug' ? c1 : c2) });
  const shortsM = mat({ superheld: '#e0452b', banane: '#ffd93b', tutu: '#ff9ccf', dino: '#3fae4a', anzug: '#23262d', hawaii: '#2f7fd8', neon80: '#ff2fd0', sterne: '#121848', adler: '#2e1b0c', ritter: '#5d646d' }[L.outfit] || '#1b1d22',
    L.outfit === 'ritter' ? { metalness: 0.5, roughness: 0.4 } : {});
  const shoeM = mat(L.shoes === 'clogs' ? '#f2b630' : COLORS[L.shoeColor], { roughness: 0.5 }), sockM = mat('#f4f4ef');
  if (ghost) for (const m of [skin, hairM, dark, frameM, jersey, shortsM, shoeM, sockM]) { m.transparent = true; m.opacity = 0.45; m.depthWrite = false; }
  // bike
  const nBike = g.children.length;
  const wheelGeo = new THREE.TorusGeometry(0.34, 0.022, 8, 32), wheels = [];
  for (const z of [-0.52, 0.52]) {
    if (!shopBike) { const w = new THREE.Mesh(wheelGeo, dark); w.rotation.y = Math.PI / 2; w.position.set(0, 0.35, z); g.add(w); wheels.push(w); }
    else { // shop bikes: tyre, rim, spokes in one spinning group
      const w = new THREE.Group(); w.position.set(0, 0.35, z); g.add(w); wheels.push(w);
      const ty = new THREE.Mesh(wheelGeo, tyreM); ty.rotation.y = Math.PI / 2; w.add(ty);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.318, 0.012, 8, 40), rimM); rim.rotation.y = Math.PI / 2; w.add(rim);
      const spokeM = L.wheels === 'glow' ? mat(glowCol, { emissive: glowCol, emissiveIntensity: 1.2 }) : L.bike === 'gold' ? rimM : mat('#b8bcc2', { metalness: 0.7, roughness: 0.3 });
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, sp = limb(0.0035, spokeM); place(sp, V((i % 2 ? 1 : -1) * 0.03, 0, 0), V(0, Math.sin(a) * 0.31, Math.cos(a) * 0.31)); w.add(sp); }
      if (L.wheels === 'glow') { const halo = new THREE.Mesh(new THREE.TorusGeometry(0.316, 0.024, 8, 40), new THREE.MeshBasicMaterial({ color: glowCol, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })); halo.rotation.y = Math.PI / 2; w.add(halo); }
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), dark); hub.rotation.z = Math.PI / 2; hub.position.set(0, 0.35, z); g.add(hub); }
  const tube = (a, b, r = 0.02, m = frameM) => { const t = limb(r, m); place(t, V(...a), V(...b)); g.add(t); return t; };
  const fr = L.bike === 'holz' ? 1.3 : L.bike === 'drache' ? 1.15 : 1; // wood and dragon frames are a bit stouter
  tube([0, 0.35, -0.52], [0, 0.30, 0], 0.02 * fr); tube([0, 0.30, 0], [0, 0.86, -0.16], 0.02 * fr); tube([0, 0.86, -0.16], [0, 0.84, 0.40], 0.02 * fr); tube([0, 0.30, 0], [0, 0.82, 0.40], 0.024 * fr);
  tube([0, 0.35, -0.52], [0, 0.86, -0.16], 0.014 * fr); tube([0, 0.84, 0.40], [0, 0.35, 0.52], 0.018, L.bike === 'gold' || L.bike === 'holz' ? frameM : dark);
  tube([0, 0.84, 0.40], [0, 0.98, 0.42], 0.016, dark); tube([-0.21, 0.98, 0.44], [0.21, 0.98, 0.44], 0.014, dark);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.26), L.bike === 'holz' ? mat('#6b3d1c', { roughness: 0.6 }) : dark); saddle.position.set(0, 0.92, -0.2); g.add(saddle); tube([0, 0.86, -0.16], [0, 0.92, -0.2], 0.014, dark);
  if (L.bike === 'drache') { // spines along the top tube, a little tail on the stays
    const horn = mat('#e7dcb4', { roughness: 0.5 });
    for (let i = 0; i < 8; i++) { const t = (i + 0.5) / 8, sp = new THREE.Mesh(new THREE.ConeGeometry(0.016 - Math.abs(t - 0.5) * 0.01, 0.07 - Math.abs(t - 0.5) * 0.04, 6), horn); sp.position.set(0, 0.86 - 0.02 * t + 0.035 * fr, -0.16 + 0.56 * t); sp.rotation.x = -0.35; g.add(sp); }
    const hd = new THREE.Group(), scl = frameM; hd.position.set(0, 0.875, 0.45); g.add(hd); // a small dragon head on the head tube
    const skull = ball(0.045, scl); skull.scale.set(0.9, 0.8, 1.1); hd.add(skull);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.11, 8), scl); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.01, 0.07); snout.scale.set(1, 1, 0.7); hd.add(snout);
    for (const s of [-1, 1]) { const hn = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.07, 6), horn); hn.position.set(s * 0.025, 0.04, -0.03); hn.rotation.set(-0.9, 0, -s * 0.3); hd.add(hn);
      hd.add(ball(0.009, mat('#ffd23f', { emissive: '#ffb000', emissiveIntensity: 1.5 }), V(s * 0.028, 0.012, 0.03))); }
    for (let i = 0; i < 3; i++) { const t = 0.2 + i * 0.25, p = V(0, 0.35, -0.52).lerp(V(0, 0.86, -0.16), t), sp = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.045, 6), horn); sp.position.copy(p).add(V(0, 0.02, -0.02)); sp.rotation.x = -0.9; g.add(sp); }
  }
  let kitBike = null;
  if (KIT.bike && !shopBike) { // shop frames and wheels stay the built-in bike: the scales, spines and glow live there // detailed bike from the Mac replaces the tube bike
    for (const o of g.children.slice(nBike)) g.remove(o);
    kitBike = kitClone(KIT.bike, ghost, m => { if (/frame/i.test(m.name)) m.color.set(frameM.color); });
    g.add(kitBike); g.userData.shadow = kitBike.userData.shadow; wheels.length = 0;
    for (const n of ['wheel_r', 'wheel_f']) { const w = kitBike.getObjectByName(n); if (w) wheels.push(w); }
    const crank = kitBike.getObjectByName('crank'), pr = kitBike.getObjectByName('pedal_r');
    if (crank) kitBike.userData = { crank, pl: kitBike.getObjectByName('pedal_l'), pr, psi0: pr ? Math.atan2(-pr.position.y, pr.position.z) : 0 };
  }
  // body
  const hip = V(0, 0.97, -0.17), sh = V(0, 1.36, 0.2), head = V(0, 1.58, 0.33);
  const tR = (f ? 0.135 : 0.15) + b * 0.045;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(tR, 0.3, 6, 12), jersey);
  if (shopJersey) { const pa = torso.geometry.attributes.position, uv = torso.geometry.attributes.uv, h = 0.3 / 2 + tR; for (let i = 0; i < pa.count; i++) uv.setY(i, (pa.getY(i) + h) / (2 * h)); } /* even v: the pattern is not stretched over the middle */
  place(torso, hip.clone().add(V(0, 0.05, 0.03)), sh); torso.scale.y = 1; torso.scale.x = f ? 0.95 : 1.08 + b * 0.15; g.add(torso);
  if (f) { const hp = ball(0.15, shortsM, hip.clone().add(V(0, 0.02, 0))); hp.scale.set(1.2, 0.8, 1); g.add(hp); }
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.075 + b * 0.03, f ? 0.22 : 0.28 + b * 0.06, 4, 8), jersey); shoulders.position.copy(sh); shoulders.rotation.z = Math.PI / 2; g.add(shoulders);
  const neck = limb(0.05, skin); place(neck, sh, head.clone().add(V(0, -0.12, -0.02))); g.add(neck);
  // head: Mii proportions (a bit large)
  const H = new THREE.Group(); H.position.copy(head); H.rotation.x = -0.25; g.add(H);
  const skull = ball(0.135, skin); skull.scale.set(0.92, 1, 1); H.add(skull);
  for (const s of [-1, 1]) {
    const eye = ball(0.022, mat('#fff')); eye.position.set(s * 0.045, 0.02, 0.115); H.add(eye);
    const pup = ball(0.012, mat('#1b1d22')); pup.position.set(s * 0.045, 0.02, 0.133); H.add(pup);
    const ear = ball(0.03, skin); ear.position.set(s * 0.125, 0, 0); ear.scale.set(0.5, 1, 0.8); H.add(ear);
    if (f) { const lash = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.006, 0.01), mat('#1b1d22')); lash.position.set(s * 0.045, 0.047, 0.125); H.add(lash); }
  }
  const nose = ball(0.022, skin); nose.position.set(0, -0.015, 0.135); H.add(nose);
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 4, 12, Math.PI), mat('#8a2a2a')); mouth.position.set(0, -0.06, 0.118); mouth.rotation.z = Math.PI; H.add(mouth);
  if (f) { const lip = mouth.clone(); lip.material = mat('#c2405a'); H.add(lip); }
  // beard
  const beardM = hairM;
  if (L.beard === 'bart' || L.outfit === 'wikinger') { const bd = ball(0.11, beardM); bd.position.set(0, -0.07, 0.06); bd.scale.set(1, 0.85, 0.75); H.add(bd); if (L.outfit === 'wikinger') { bd.scale.y = 1.25; bd.position.y = -0.1; } }
  else if (L.beard === 'schnauzer') { const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.06, 2, 6), beardM); m.rotation.z = Math.PI / 2; m.position.set(0, -0.042, 0.132); H.add(m); }
  else if (L.beard === 'stoppeln') { const st = ball(0.128, mat(HAIRCOL[L.hairColor], { transparent: true, opacity: 0.35 })); st.position.set(0, -0.025, 0.012); st.scale.set(0.93, 0.85, 1); H.add(st); }
  // glasses
  if (L.glasses !== 'none' || L.outfit === 'neon80') {
    const gl = L.outfit === 'neon80' && L.glasses === 'none' ? 'sonne' : L.glasses;
    if (gl === 'sport') { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.045, 20, 1, true, -0.9, 1.8), mat('#111', { metalness: 0.8, roughness: 0.1, side: THREE.DoubleSide })); s.position.set(0, 0.02, 0); H.add(s); }
    else for (const s of [-1, 1]) {
      const lens = gl === 'retro' ? new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, 6, 16), mat('#7a5a2a')) : new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.01), mat(L.outfit === 'neon80' ? '#ff2fd0' : '#111', { metalness: 0.5, roughness: 0.2 }));
      lens.position.set(s * 0.045, 0.02, 0.138); H.add(lens);
    }
  }
  // hair
  const hairOut = ['keiner', 'stirnband', 'cap', 'zauberhut', 'krone'].includes(L.helmet), bigHair = L.helmet === 'keiner' || L.helmet === 'stirnband' || L.helmet === 'cap';
  if (L.hair !== 'glatze' && L.outfit !== 'banane') {
    if (hairOut || L.hair !== 'kurz') { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.142, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM); cap.position.set(0, 0.012, -0.006); cap.rotation.x = -0.18; H.add(cap); }
    if (L.hair === 'lang') { const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.16, 4, 8), hairM); back.position.set(0, -0.08, -0.08); back.scale.set(1.15, 1, 0.6); H.add(back); }
    if (L.hair === 'zopf') { const z = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.18, 4, 8), hairM); z.position.set(0, -0.06, -0.17); z.rotation.x = 0.7; H.add(z); }
    if (L.hair === 'dutt') { const d = ball(0.06, hairM); d.position.set(0, 0.1, -0.12); H.add(d); }
    if (L.hair === 'vokuhila') { const v = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.12, 4, 8), hairM); v.position.set(0, -0.12, -0.08); v.scale.set(1.05, 1, 0.55); H.add(v); }
    if (L.hair === 'afro' && bigHair) { const a = ball(0.21, hairM); a.position.set(0, 0.07, -0.03); H.add(a); }
    if (L.hair === 'irokese' && bigHair) for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 6), hairM); const a = -0.9 + i * 0.36; sp.position.set(0, 0.13 * Math.cos(a) + 0.02, 0.13 * Math.sin(a)); sp.rotation.x = a; H.add(sp); }
  }
  // helmet / headwear
  if (L.outfit === 'wikinger') { const hm = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('#9aa0a6', { metalness: 0.7, roughness: 0.3 })); hm.position.y = 0.02; H.add(hm);
    for (const s of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 8), mat('#f1e3b0')); horn.position.set(s * 0.15, 0.1, 0); horn.rotation.z = -s * 0.9; H.add(horn); } }
  else if (L.outfit === 'banane') { const peel = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.32, 14), mat('#ffd93b')); peel.position.y = 0.17; H.add(peel); const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.05, 8), mat('#5a3a1a')); tip.position.y = 0.35; H.add(tip); }
  else if (L.helmet === 'aero' || L.helmet === 'klassisch') {
    const hm = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(c2, { roughness: 0.35 })); hm.position.y = 0.015; H.add(hm);
    if (L.helmet === 'aero') { hm.scale.set(1, 0.9, 1.3); hm.position.z = -0.03; } else for (let i = -2; i <= 2; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.22), mat('#1b1d22')); v.position.set(i * 0.05, 0.135 - Math.abs(i) * 0.02, 0); H.add(v); }
  } else if (L.helmet === 'cap') { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), mat(c1)); cap.position.y = 0.02; H.add(cap); const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.01, 16, 1, false, -1.2, 2.4), mat(c2)); brim.position.set(0, 0.06, 0.1); brim.rotation.x = -0.6; H.add(brim); }
  else if (L.helmet === 'stirnband') { const sb = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.022, 8, 24), mat(L.outfit === 'neon80' ? '#2ff4ff' : c2)); sb.rotation.x = Math.PI / 2 - 0.2; sb.position.y = 0.06; H.add(sb); }
  else if (L.helmet === 'zauberhut') H.add(wizardHat());
  else if (L.helmet === 'krone') H.add(crown());
  if (L.feather === 'adler') H.add(feather(...({ zauberhut: [0.085, -0.165], krone: [0.1, -0.16], keiner: [0.05, -0.13], stirnband: [0.06, -0.15], cap: [0.07, -0.145], aero: [0.1, -0.15], klassisch: [0.1, -0.155] }[L.helmet] || [0.1, -0.15])));
  // outfit extras
  if (L.cape === 'zauber') { const cl = wizardCloak(sh, tR); g.add(cl); g.userData.cloak = cl; }
  else if (L.outfit === 'superheld') { const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.7, 4, 6), mat('#e0452b', { side: THREE.DoubleSide })); cape.position.set(0, 1.12, -0.12); cape.rotation.x = -1.15; g.add(cape); g.userData.cape = cape; }
  if (L.outfit === 'tutu') { const tutu = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 0.12, 20, 1, true), mat('#ff9ccf', { side: THREE.DoubleSide, transparent: true, opacity: 0.9 })); tutu.position.copy(hip).add(V(0, 0.02, 0.05)); tutu.rotation.x = 0.5; g.add(tutu); }
  if (L.outfit === 'dino') { for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 6), mat('#ffd23f')); const t = i / 5, p = hip.clone().lerp(sh, t); sp.position.copy(p).add(V(0, tR + 0.03, -0.05)); sp.rotation.x = -0.6; g.add(sp); }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.45, 8), mat('#3fae4a')); tail.position.set(0, 0.9, -0.48); tail.rotation.x = -1.9; g.add(tail); }
  if (L.outfit === 'ritter') { const steel = mat('#b9c1ca', { metalness: 0.6, roughness: 0.3 }); // pauldrons, a gorget and a belt
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.1 + b * 0.02, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel); p.position.copy(sh).add(V(s * (0.17 + b * 0.04), 0.01, 0)); p.rotation.z = -s * 0.5; p.scale.set(1, 0.75, 1.1); g.add(p);
      const lame = new THREE.Mesh(new THREE.SphereGeometry(0.085 + b * 0.02, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel); lame.position.copy(p.position).add(V(s * 0.03, -0.045, 0)); lame.rotation.z = -s * 0.75; lame.scale.set(1, 0.6, 1.05); g.add(lame); }
    const b0 = hip.clone().add(V(0, 0.05, 0.03)), belt = new THREE.Mesh(new THREE.TorusGeometry(tR * 1.03, 0.02, 8, 28), mat('#3a2412', { roughness: 0.7 })); belt.position.copy(b0.clone().lerp(sh, 0.3)); belt.quaternion.setFromUnitVectors(V(0, 0, 1), sh.clone().sub(b0).normalize()); belt.scale.x = torso.scale.x; g.add(belt); }
  if (L.outfit === 'wikinger') { const fur = new THREE.Mesh(new THREE.CapsuleGeometry(tR + 0.03, 0.12, 4, 10), mat('#8a6a4a', { roughness: 1 })); fur.position.copy(sh).add(V(0, -0.04, -0.04)); fur.rotation.x = 1.1; fur.scale.x = 1.3; g.add(fur); }
  // arms (fixed: hands on the hoods)
  const armR = 0.042 + b * 0.028, sleeve = ['anzug', 'superheld', 'banane', 'dino', 'tutu', 'ritter'].includes(L.outfit) || L.outfit === 'retro';
  const gloveM = gloveMaterial(L), sleeveM = L.outfit === 'ritter' ? mat('#ffffff', { map: knightTex(false), roughness: 0.35, metalness: 0.45 }) : jersey;
  for (const s of [-1, 1]) {
    const S = sh.clone().add(V(s * (0.17 + b * 0.04), 0, 0)), hand = V(s * 0.2, 0.99, 0.44), E = S.clone().lerp(hand, 0.5).add(V(s * 0.05, -0.08, -0.04));
    const up = limb(armR, sleeveM); place(up, S, E); g.add(up);
    if (b > 0.55) { const bi = ball(armR * 1.45, sleeve ? sleeveM : skin, S.clone().lerp(E, 0.55)); g.add(bi); }
    const lo = limb(armR * 0.85, sleeve ? sleeveM : skin); place(lo, E, hand); g.add(lo);
    g.add(ball(armR * 1.05, f || !sleeve ? skin : sleeveM, E));
    if (!KIT.hands && gloveM) { const gl = ball(0.047, gloveM, hand); gl.scale.set(1, 0.9, 1.2); g.add(gl); const cuff = limb(0.034, goldM()); place(cuff, hand.clone().lerp(E, 0.1), hand.clone().lerp(E, 0.16)); g.add(cuff); }
    else if (!KIT.hands) g.add(ball(0.04, mat(L.outfit === 'anzug' ? '#f4f4ef' : L.outfit === 'ritter' ? '#6e767f' : '#1b1d22', L.outfit === 'ritter' ? { metalness: 0.6, roughness: 0.35 } : {}), hand));
  }
  if (KIT.hands) g.add(kitClone(KIT.hands, ghost, m => { if (/skin/i.test(m.name)) m.color.set(skin.color); else if (/glove/i.test(m.name) && gloveM) { m.color.set('#ffffff'); m.map = gloveM.map; } else if (/glove/i.test(m.name) && L.outfit === 'anzug') m.color.set('#f4f4ef'); }));
  // legs: built once, posed every frame
  const legR = 0.06 + b * 0.03, shinBare = !['anzug', 'banane', 'dino', 'superheld', 'ritter'].includes(L.outfit);
  const legs = [-1, 1].map(s => {
    const thigh = limb(legR, shortsM), knee = ball(legR * 0.95, shinBare ? skin : shortsM), shin = limb(legR * 0.8, shinBare ? skin : shortsM), sock = limb(legR * 0.72, sockM);
    const shoe = new THREE.Mesh(L.shoes === 'clogs' ? new THREE.BoxGeometry(0.1, 0.07, 0.24) : new THREE.CapsuleGeometry(0.045, 0.16, 4, 8), L.shoes === 'socken' ? sockM : shoeM);
    if (L.shoes !== 'clogs') shoe.rotation.x = Math.PI / 2;
    const crankArm = limb(0.012, dark), pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.015, 0.06), dark);
    for (const o of [thigh, knee, shin, sock, shoe, ...(kitBike?.userData.crank ? [] : [crankArm, pedal])]) g.add(o);
    return { s, thigh, knee, shin, sock, shoe, crankArm, pedal };
  });
  const L1 = 0.46, L2 = 0.47, BB = V(0, 0.3, 0), CR = 0.17;
  g.userData = { shadow: g.userData.shadow, wheels, legs, look: L, cloak: g.userData.cloak, cape: g.userData.cape,
    pedal(a) { // crank angle in radians
      for (const l of legs) {
        const ang = a + (l.s > 0 ? Math.PI : 0), x = l.s * 0.11;
        const P = V(x, BB.y - Math.sin(ang) * CR, BB.z + Math.cos(ang) * CR) /* a=0 front, then down: forward pedalling */, Hp = V(x, hip.y, hip.z);
        const d = Math.min(L1 + L2 - 0.001, P.distanceTo(Hp)), dir = P.clone().sub(Hp).normalize();
        const k = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - k * k));
        const fwd = V(0, -dir.z, dir.y); if (fwd.z < 0) fwd.negate(); // knee points forward
        const K = Hp.clone().add(dir.clone().multiplyScalar(k)).add(fwd.multiplyScalar(h));
        place(l.thigh, Hp, K); l.knee.position.copy(K); place(l.shin, K, P.clone().lerp(K, 0.22)); place(l.sock, P.clone().lerp(K, 0.22), P.clone().add(V(0, 0.03, 0)));
        l.shoe.position.copy(P).add(V(0, 0.035, 0.03)); place(l.crankArm, V(x * 0.6, BB.y, BB.z), P); l.pedal.position.copy(P);
      }
      const kc = kitBike?.userData; // detailed bike: turn its crank so the right pedal sits where the right foot is
      if (kc?.crank) { const th = a - kc.psi0; kc.crank.rotation.x = th; if (kc.pl) kc.pl.rotation.x = -th; if (kc.pr) kc.pr.rotation.x = -th; }
      const cape = g.userData.cape; if (cape) cape.rotation.x = -1.15 + Math.sin(a * 1.7) * 0.08;
      g.userData.cloak?.userData.flap(a);
    } };
  g.userData.pedal(0);
  if (ghost) g.traverse(o => { for (const m of [o.material].flat()) if (m && !m.transparent && !m.userData.kit) { m.transparent = true; m.opacity = 0.45; m.depthWrite = false; } }); // shop items too
  g.scale.setScalar(L.height);
  return g;
}

/** a small studio environment (light from above, two soft boxes): metals need something to reflect */
function studioEnv(renderer) {
  const sc = new THREE.Scene(), sky = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
  const pa = sky.geometry.attributes.position, col = []; for (let i = 0; i < pa.count; i++) { const t = (pa.getY(i) / 10 + 1) / 2, c = new THREE.Color('#202329').lerp(new THREE.Color('#c9d2de'), t * t); col.push(c.r, c.g, c.b); }
  sky.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); sc.add(sky);
  for (const [x, y, z] of [[5, 4, 3], [-4, 3, -4]]) { const box = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })); box.position.set(x, y, z); box.lookAt(0, 0, 0); sc.add(box); }
  const pm = new THREE.PMREMGenerator(renderer), t = pm.fromScene(sc, 0.04).texture; pm.dispose(); return t;
}
/** turntable preview for the editor */
export class AvatarPreview {
  constructor(canvas) {
    this.c = canvas; this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); this.r.setPixelRatio(Math.min(2, devicePixelRatio)); this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50); this.cam.position.set(3.4, 1.6, 3.1); this.cam.lookAt(0, 0.82, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, 5, 4); this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.3, 48), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
    this.scene.environment = studioEnv(this.r); this.scene.environmentIntensity = 0.45; // soft studio light, so gold and steel (shop items) read as metal
    loadRiderKit().then(ok => { if (ok && this.obj && !this.dead) this.set(this.obj.userData.look); });
    this.t = 0; this.spin = 0.6; this._loop = this._loop.bind(this); requestAnimationFrame(this._loop);
  }
  set(look) { if (this.obj) this.scene.remove(this.obj); this.obj = makeRider(look); this.scene.add(this.obj); }
  _loop(now) {
    if (this.dead) return;
    const W = this.c.clientWidth, Hh = this.c.clientHeight; const pr = this.r.getPixelRatio(); if (W && Hh && (this.c.width !== (W * pr | 0) || this.c.height !== (Hh * pr | 0))) { // a flex canvas can change height alone
      this.r.setSize(W, Hh, false); this.cam.aspect = W / Hh;
      if (this.fitFov) this.cam.fov = Math.max(this.fitFov, 2 * Math.atan(Math.tan(this.fitFov * Math.PI / 360) / this.cam.aspect) * 180 / Math.PI); // a tall canvas keeps the horizontal angle
      this.cam.updateProjectionMatrix(); }
    this.t += 1 / 60; if (this.obj) { this.obj.rotation.y = this.t * this.spin; this.obj.userData.pedal(this.t * 5); for (const w of this.obj.userData.wheels) w.rotation.x += 0.12; }
    this.r.render(this.scene, this.cam); requestAnimationFrame(this._loop);
  }
  destroy() { this.dead = true; this.r.dispose(); }
}

/** small face portrait of a look (for the leaderboard and profiles): one shared offscreen renderer, cached per look */
let PR = null; const PCACHE = new Map();
export async function portrait(look, size = 128) {
  const key = JSON.stringify(cleanLook(look || DEFAULT_LOOK)) + size; if (PCACHE.has(key)) return PCACHE.get(key);
  const job = (async () => {
    await loadRiderKit().catch(() => false);
    if (!PR) { const c = document.createElement('canvas'); c.width = c.height = size;
      const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true }); r.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.7)); const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 3, 4); scene.add(sun);
      PR = { c, r, scene, cam: new THREE.PerspectiveCamera(26, 1, 0.05, 20) }; }
    PR.r.setSize(size, size, false);
    const obj = makeRider(look); obj.userData.pedal?.(0); PR.scene.add(obj); obj.updateMatrixWorld(true);
    const head = new THREE.Vector3(0, 1.6, 0.33).applyMatrix4(obj.matrixWorld); // the head sits at (0, 1.58, 0.33), the rider looks along +Z
    PR.cam.position.copy(head).add(new THREE.Vector3(0.2, 0.05, 1.0)); PR.cam.lookAt(head.x, head.y - 0.02, head.z); PR.cam.updateProjectionMatrix();
    PR.r.render(PR.scene, PR.cam); const url = PR.c.toDataURL('image/png'); PR.scene.remove(obj);
    return url;
  })().catch(() => null);
  PCACHE.set(key, job); return job;
}
