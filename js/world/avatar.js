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
  const dark = mat(0x1b1d22, { metalness: 0.4, roughness: 0.45 }), frameM = mat(c2 === c1 ? '#1b1d22' : c2, { metalness: 0.5, roughness: 0.35 });
  const outfitCol = { banane: '#ffd93b', superheld: '#2f5fd8', wikinger: '#6b4a2c', tutu: '#ff9ccf', dino: '#3fae4a', anzug: '#23262d' }[L.outfit] || c1;
  const jersey = new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.6, map: patternTex(L.outfit, outfitCol, L.outfit === 'superheld' ? '#e0452b' : L.outfit === 'anzug' ? c1 : c2) });
  const shortsM = mat({ superheld: '#e0452b', banane: '#ffd93b', tutu: '#ff9ccf', dino: '#3fae4a', anzug: '#23262d', hawaii: '#2f7fd8', neon80: '#ff2fd0' }[L.outfit] || '#1b1d22');
  const shoeM = mat(L.shoes === 'clogs' ? '#f2b630' : COLORS[L.shoeColor], { roughness: 0.5 }), sockM = mat('#f4f4ef');
  if (ghost) for (const m of [skin, hairM, dark, frameM, jersey, shortsM, shoeM, sockM]) { m.transparent = true; m.opacity = 0.45; m.depthWrite = false; }
  // bike
  const nBike = g.children.length;
  const wheelGeo = new THREE.TorusGeometry(0.34, 0.022, 8, 32), wheels = [];
  for (const z of [-0.52, 0.52]) { const w = new THREE.Mesh(wheelGeo, dark); w.rotation.y = Math.PI / 2; w.position.set(0, 0.35, z); g.add(w); wheels.push(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), dark); hub.rotation.z = Math.PI / 2; hub.position.copy(w.position); g.add(hub); }
  const tube = (a, b, r = 0.02, m = frameM) => { const t = limb(r, m); place(t, V(...a), V(...b)); g.add(t); return t; };
  tube([0, 0.35, -0.52], [0, 0.30, 0]); tube([0, 0.30, 0], [0, 0.86, -0.16]); tube([0, 0.86, -0.16], [0, 0.84, 0.40]); tube([0, 0.30, 0], [0, 0.82, 0.40], 0.024);
  tube([0, 0.35, -0.52], [0, 0.86, -0.16], 0.014); tube([0, 0.84, 0.40], [0, 0.35, 0.52], 0.018, dark);
  tube([0, 0.84, 0.40], [0, 0.98, 0.42], 0.016, dark); tube([-0.21, 0.98, 0.44], [0.21, 0.98, 0.44], 0.014, dark);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.26), dark); saddle.position.set(0, 0.92, -0.2); g.add(saddle); tube([0, 0.86, -0.16], [0, 0.92, -0.2], 0.014, dark);
  let kitBike = null;
  if (KIT.bike) { // detailed bike from the Mac replaces the tube bike
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
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(tR, 0.3, 6, 12), jersey); place(torso, hip.clone().add(V(0, 0.05, 0.03)), sh); torso.scale.y = 1; torso.scale.x = f ? 0.95 : 1.08 + b * 0.15; g.add(torso);
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
  const hairOut = L.helmet === 'keiner' || L.helmet === 'stirnband' || L.helmet === 'cap';
  if (L.hair !== 'glatze' && L.outfit !== 'banane') {
    if (hairOut || L.hair !== 'kurz') { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.142, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM); cap.position.set(0, 0.012, -0.006); cap.rotation.x = -0.18; H.add(cap); }
    if (L.hair === 'lang') { const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.16, 4, 8), hairM); back.position.set(0, -0.08, -0.08); back.scale.set(1.15, 1, 0.6); H.add(back); }
    if (L.hair === 'zopf') { const z = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.18, 4, 8), hairM); z.position.set(0, -0.06, -0.17); z.rotation.x = 0.7; H.add(z); }
    if (L.hair === 'dutt') { const d = ball(0.06, hairM); d.position.set(0, 0.1, -0.12); H.add(d); }
    if (L.hair === 'vokuhila') { const v = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.12, 4, 8), hairM); v.position.set(0, -0.12, -0.08); v.scale.set(1.05, 1, 0.55); H.add(v); }
    if (L.hair === 'afro' && hairOut) { const a = ball(0.21, hairM); a.position.set(0, 0.07, -0.03); H.add(a); }
    if (L.hair === 'irokese' && hairOut) for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 6), hairM); const a = -0.9 + i * 0.36; sp.position.set(0, 0.13 * Math.cos(a) + 0.02, 0.13 * Math.sin(a)); sp.rotation.x = a; H.add(sp); }
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
  // outfit extras
  if (L.outfit === 'superheld') { const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.7, 4, 6), mat('#e0452b', { side: THREE.DoubleSide })); cape.position.set(0, 1.12, -0.12); cape.rotation.x = -1.15; g.add(cape); g.userData.cape = cape; }
  if (L.outfit === 'tutu') { const tutu = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 0.12, 20, 1, true), mat('#ff9ccf', { side: THREE.DoubleSide, transparent: true, opacity: 0.9 })); tutu.position.copy(hip).add(V(0, 0.02, 0.05)); tutu.rotation.x = 0.5; g.add(tutu); }
  if (L.outfit === 'dino') { for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 6), mat('#ffd23f')); const t = i / 5, p = hip.clone().lerp(sh, t); sp.position.copy(p).add(V(0, tR + 0.03, -0.05)); sp.rotation.x = -0.6; g.add(sp); }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.45, 8), mat('#3fae4a')); tail.position.set(0, 0.9, -0.48); tail.rotation.x = -1.9; g.add(tail); }
  if (L.outfit === 'wikinger') { const fur = new THREE.Mesh(new THREE.CapsuleGeometry(tR + 0.03, 0.12, 4, 10), mat('#8a6a4a', { roughness: 1 })); fur.position.copy(sh).add(V(0, -0.04, -0.04)); fur.rotation.x = 1.1; fur.scale.x = 1.3; g.add(fur); }
  // arms (fixed: hands on the hoods)
  const armR = 0.042 + b * 0.028, sleeve = ['anzug', 'superheld', 'banane', 'dino', 'tutu'].includes(L.outfit) || L.outfit === 'retro';
  for (const s of [-1, 1]) {
    const S = sh.clone().add(V(s * (0.17 + b * 0.04), 0, 0)), hand = V(s * 0.2, 0.99, 0.44), E = S.clone().lerp(hand, 0.5).add(V(s * 0.05, -0.08, -0.04));
    const up = limb(armR, jersey); place(up, S, E); g.add(up);
    if (b > 0.55) { const bi = ball(armR * 1.45, sleeve ? jersey : skin, S.clone().lerp(E, 0.55)); g.add(bi); }
    const lo = limb(armR * 0.85, sleeve ? jersey : skin); place(lo, E, hand); g.add(lo);
    g.add(ball(armR * 1.05, f || !sleeve ? skin : jersey, E)); if (!KIT.hands) g.add(ball(0.04, mat(L.outfit === 'anzug' ? '#f4f4ef' : '#1b1d22'), hand));
  }
  if (KIT.hands) g.add(kitClone(KIT.hands, ghost, m => { if (/skin/i.test(m.name)) m.color.set(skin.color); else if (/glove/i.test(m.name) && L.outfit === 'anzug') m.color.set('#f4f4ef'); }));
  // legs: built once, posed every frame
  const legR = 0.06 + b * 0.03, shinBare = !['anzug', 'banane', 'dino', 'superheld'].includes(L.outfit);
  const legs = [-1, 1].map(s => {
    const thigh = limb(legR, shortsM), knee = ball(legR * 0.95, shinBare ? skin : shortsM), shin = limb(legR * 0.8, shinBare ? skin : shortsM), sock = limb(legR * 0.72, sockM);
    const shoe = new THREE.Mesh(L.shoes === 'clogs' ? new THREE.BoxGeometry(0.1, 0.07, 0.24) : new THREE.CapsuleGeometry(0.045, 0.16, 4, 8), L.shoes === 'socken' ? sockM : shoeM);
    if (L.shoes !== 'clogs') shoe.rotation.x = Math.PI / 2;
    const crankArm = limb(0.012, dark), pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.015, 0.06), dark);
    for (const o of [thigh, knee, shin, sock, shoe, ...(kitBike?.userData.crank ? [] : [crankArm, pedal])]) g.add(o);
    return { s, thigh, knee, shin, sock, shoe, crankArm, pedal };
  });
  const L1 = 0.46, L2 = 0.47, BB = V(0, 0.3, 0), CR = 0.17;
  g.userData = { shadow: g.userData.shadow, wheels, legs, look: L,
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
    } };
  g.userData.pedal(0);
  g.scale.setScalar(L.height);
  return g;
}

/** turntable preview for the editor */
export class AvatarPreview {
  constructor(canvas) {
    this.c = canvas; this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); this.r.setPixelRatio(Math.min(2, devicePixelRatio)); this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50); this.cam.position.set(3.4, 1.6, 3.1); this.cam.lookAt(0, 0.82, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, 5, 4); this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.3, 48), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
    loadRiderKit().then(ok => { if (ok && this.obj && !this.dead) this.set(this.obj.userData.look); });
    this.t = 0; this.spin = 0.6; this._loop = this._loop.bind(this); requestAnimationFrame(this._loop);
  }
  set(look) { if (this.obj) this.scene.remove(this.obj); this.obj = makeRider(look); this.scene.add(this.obj); }
  _loop(now) {
    if (this.dead) return;
    const W = this.c.clientWidth, Hh = this.c.clientHeight; if (W && (this.c.width !== W * this.r.getPixelRatio() | 0)) { this.r.setSize(W, Hh, false); this.cam.aspect = W / Hh; this.cam.updateProjectionMatrix(); }
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
