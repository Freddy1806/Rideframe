// The messenger's village (story stage 2, plan: docs/dorfplan.md). It sits on the last ~450 m of every ride and grows from the
// inn outwards with the rider's lifetime kilometres; lifetime climbing adds the church spire. Every model is optional: a GLB that
// the MacBook has not delivered yet falls back to a similar existing one, or the slot stays landscape. Nothing is half built:
// a stage either stands complete or not at all, plus at most one building site as a preview of the next stage.
import * as THREE from 'three';
import { ROAD_W } from './field.js';

export const STAGES = [ // lifetime km → name (plan 3.2)
  { km: 0, name: 'The Inn' }, { km: 10, name: 'Home Gate' }, { km: 40, name: 'The Green' }, { km: 100, name: 'Wheelwright' },
  { km: 200, name: 'The Church' }, { km: 350, name: 'The Farms' }, { km: 550, name: 'Market Square' }, { km: 800, name: 'The Mill' },
  { km: 1200, name: 'The Town Gate' },
];
export const stageOf = km => STAGES.reduce((s, x, i) => km >= x.km ? i : s, 0);
export const nextStage = km => STAGES.find(x => x.km > km) || null;

const WHO_COL = [0x6fb6ff, 0xf2c14e, 0xff5a3c]; // wizard, king, devil (js/story.js)

/** a plain wooden gate with two posts, a beam and a pennant: the Home Gate until the MacBook's `dorftor` exists */
function gateMesh() {
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.9 });
  const post = new THREE.BoxGeometry(0.35, 4.2, 0.35);
  for (const x of [-4.6, 4.6]) { const p = new THREE.Mesh(post, wood); p.position.set(x, 2.1, 0); p.castShadow = true; g.add(p); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.4, 0.4), wood); beam.position.y = 4.0; beam.castShadow = true; g.add(beam);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshStandardMaterial({ color: 0x9b3a2a, side: THREE.DoubleSide }));
  flag.position.set(4.6 + 0.55, 3.5, 0); flag.userData.flutter = true; g.add(flag);
  return g;
}

/** three warm lanterns in the inn's window colours; the week's leader burns brightest */
function lanterns(leader) {
  const g = new THREE.Group();
  ['wizard', 'king', 'devil'].forEach((who, i) => {
    const on = leader === who, m = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.05, 0.75),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(WHO_COL[i]).multiplyScalar(on ? 1.6 : 0.85) }));
    m.position.set((i - 1) * 1.7, 0, 0); m.userData.lantern = { base: on ? 1.6 : 0.85, ph: i * 2.1 }; g.add(m);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex(), color: WHO_COL[i], transparent: true, opacity: on ? 0.55 : 0.28, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(on ? 4 : 2.6); halo.position.copy(m.position); g.add(halo);
  });
  return g;
}

// chimney smoke: a few soft sprites per house that rise, drift with the wind and fade; one shared texture and material set
let SMOKE_TEX = null;
function smokeTex() {
  if (SMOKE_TEX) return SMOKE_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(235,230,222,0.55)'); gr.addColorStop(0.5, 'rgba(210,205,198,0.22)'); gr.addColorStop(1, 'rgba(200,195,190,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); SMOKE_TEX = new THREE.CanvasTexture(c); return SMOKE_TEX;
}
function smoke(strong) {
  const g = new THREE.Group(), n = strong ? 10 : 6;
  for (let i = 0; i < n; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex(), transparent: true, depthWrite: false, opacity: 0, fog: true }));
    sp.userData.smoke = { ph: i / n, k: strong ? 1.6 : 1, rise: strong ? 9 : 6 }; g.add(sp);
  }
  return g;
}

/**
 * Build the village into the world. ctx: { place, byName, make, mirror, spot, f, scene, props, anim, len }; v: { km, hm, leader }.
 * Positions are metres before the finish (end = track length). Returns a summary for the HUD/result screen.
 */
export function buildVillage(ctx, v = {}) {
  const { place, byName, spot, f, scene, props, len } = ctx;
  const km = v.km || 0, st = stageOf(km), end = len;
  const at = m => end - m; // m metres before the finish
  const exact = n => { const e = byName(n); return e && e.file.split('/').pop().replace(/\.glb$/, '').replace(/_v\d+$/, '') === n ? e : null; }; // no substring hits: 'wirtshaus' must not find the sign
  const any = (...names) => { for (const n of names) { const e = n && exact(n); if (e) return e; } return null; };
  const built = [], anim = ctx.anim || [];
  const missed = [];
  const put = (e, m, off, o = {}) => { if (!e) return null; const obj = place(e, at(m), off, o);
    if (obj) { built.push(e.file); obj.userData.village = { m, file: e.file }; } else missed.push(e.file.split('/').pop() + '@' + m); return obj; };
  const house = (e, m, off, o = {}, strong = false) => { // a lived-in building: smoke from the roof (thatched farmhouses had no chimney, it seeps out at the ridge)
    const obj = put(e, m, off, o); if (!obj) return obj;
    const sm = smoke(strong); sm.position.set(obj.position.x, obj.position.y + e.size[1] * (o.scale || 1) * 0.95, obj.position.z);
    scene.add(sm); props.push(sm); sm.children.forEach(c => anim.push(c)); return obj; };
  const loose = (obj, m, off, y = 0, face = 0) => { // a procedural piece, set straight onto the ground beside the road
    if (ctx.mirror?.(at(m))) off = -off; // sea on the right: the whole layout mirrors, like place()
    const q = spot(at(m), off); obj.position.set(q.x, f.height(q.x, q.z) + y, q.z); obj.rotation.y = Math.atan2(q.tx, q.tz) + face;
    obj.userData.village = { m, file: 'procedural' }; scene.add(obj); props.push(obj); obj.traverse(c => { if (c.userData.flutter) anim.push(c); }); return obj; };

  // ---- stage 0: the inn of the three bettors at the finish, the lime tree and well before it, a wayside cross on the way in ----
  const inn = any('wirtshaus') ? house(any('wirtshaus'), 14, ROAD_W + 9, { face: 'road', gap: 2 }, true)
    : house(any('fachwerkhaus_b', 'fachwerkhaus_a', 'steinhaus'), 14, ROAD_W + 8, { face: 'road', gap: 2, scale: 1.25 }, true);
  if (inn) { const sign = any('wirtshausschild'); if (sign) put(sign, 24, ROAD_W + 2.2, { face: 'road', overlap: true, radK: 0.3, gap: 0.4 });
    const lt = loose(lanterns(v.leader), 26, ROAD_W + 2.6, 3.4, Math.PI / 2); /* hung out towards the road before the inn, seen on the approach */ lt.traverse(c => { if (c.userData.lantern) anim.push(c); }); }
  put(any('pferd'), 30, ROAD_W + 4.5, { face: 'along', anim: 'Stehen', gap: 0.8 });
  put(any('viehtraenke', 'fass'), 36, ROAD_W + 3.5, { face: 'along', gap: 0.6, radK: 0.5 });
  put(any('faesser_kisten', 'fass'), 6, ROAD_W + 3.2, { gap: 0.5 });
  put(any('dorflinde'), 70, -(ROAD_W + 10), { face: 'road', gap: 3 });
  put(any('dorfbrunnen', 'brunnen'), 62, ROAD_W + 6, { face: 'road', anim: 'Fliessen', gap: 0.8 });
  put(any('wegkreuz'), 430, ROAD_W + 4, { face: 'road', gap: 0.8 });
  put(any('wegweiser'), 434, -(ROAD_W + 3.5), { face: 'road', gap: 0.6 });

  // ---- 1 Home Gate: the messenger's own farm and the gate in the village fence ----
  if (st >= 1) {
    const gate = any('dorftor'), gm = [0, 120, 225, 285, 315, 400, 400, 400, 400][st]; // spans the road, so it bypasses place() (which keeps things off the asphalt)
    const go = gate && ctx.make ? ctx.make(gate) : gateMesh(); if (gate && ctx.make) go.scale.setScalar(Math.max(1, 9.4 / Math.max(gate.size[0], 0.1))); // posts clear the 6.6 m asphalt
    loose(go, gm, 0, 0, 0); // local x across the road
    house(any('fachwerkhaus_a', 'steinhaus'), 95, -(ROAD_W + 9), { face: 'road', gap: 2 }); // the messenger's house, left before the inn
    put(any('holzstapel'), 88, -(ROAD_W + 4), { face: 'along', gap: 0.6 });
    put(any('misthaufen', 'heuhaufen'), 104, -(ROAD_W + 5), { gap: 0.8 });
    const fl = any('flechtzaun'); if (fl) { const l = Math.max(fl.size[0], fl.size[2]) * 0.97, t = fl.size[0] > fl.size[2] ? Math.PI / 2 : 0;
      for (let k = 0; k * l < 22; k++) put(fl, 84 + k * l, -(ROAD_W + 3), { face: 'along', rot: t, overlap: true, radK: 0.3, gap: 0.6 }); }
  }
  // ---- 2 The Green: four farms round the green, bake house, a maid at the well ----
  if (st >= 2) {
    [[140, 1], [160, -1], [185, 1], [210, -1]].forEach(([m, s], i) => {
      house(any(i % 2 ? 'fachwerkhaus_b' : 'fachwerkhaus_a', 'steinhaus'), m, s * (ROAD_W + 10), { face: 'road', gap: 2 });
      put(any(i % 2 ? 'holzstapel' : 'heuhaufen'), m - 7, s * (ROAD_W + 4.5), { gap: 0.6 });
    });
    put(any('backhaus'), 75, -(ROAD_W + 18), { face: 'road', gap: 2 });
    put(any('magd_eimer'), 58, ROAD_W + 3.6, { face: 'road', anim: 'Stehen', radK: 0.4, gap: 0.4 });
    put(any('waescheleine'), 150, -(ROAD_W + 20), { face: 'along', gap: 2 });
  }
  // ---- 3 Wheelwright: smithy and wheelwright share a yard on the right, a cart on the verge ----
  if (st >= 3) {
    const smith = house(any('schmiede'), 250, ROAD_W + 8, { face: 'road', gap: 1.5 }, true);
    if (smith) put(any('schmied'), 247, ROAD_W + 3.2, { face: 'road', anim: 'Haemmern', radK: 0.4, gap: 0.6 });
    put(any('stellmacherei', 'fachwerkhaus_a'), 268, ROAD_W + 9, { face: 'road', gap: 1.5 });
    const wheel = any('wagenrad'); if (wheel) for (let k = 0; k < 3; k++) put(wheel, 262 + k * 1.3, ROAD_W + 3.4, { face: 'road', overlap: true, radK: 0.3, gap: 0.4 });
    put(any('karren', 'leiterwagen', 'schubkarre'), 240, ROAD_W + 4.2, { face: 'along', gap: 0.8 });
  }
  // ---- 4 The Church: on the outside of the green, the tallest thing in the picture; climbing earns the spire (plan 3.2) ----
  if (st >= 4) put(any('dorfkirche', 'kirche_gotisch'), 300, -(ROAD_W + 26), { face: 'road', gap: 6, ground: 'centre' });
  // ---- 5 The Farms: the row of farmsteads between gate and smithy ----
  if (st >= 5) for (let k = 0; k < 6; k++) {
    const m = 320 + k * 13, s = k % 2 ? -1 : 1;
    house(any(k % 3 ? 'fachwerkhaus_a' : 'fachwerkhaus_b', 'steinhaus'), m, s * (ROAD_W + 9), { face: 'road', gap: 2 });
    put(any('scheune', 'heuhaufen'), m + 4, s * (ROAD_W + 22), { face: 'road', gap: 2 });
  }
  // ---- 6 Market Square: market cross, stalls and a trader between the green and the inn ----
  if (st >= 6) {
    put(any('marktkreuz', 'wegkreuz'), 45, -(ROAD_W + 5), { face: 'road', gap: 0.8 });
    for (let k = 0; k < 3; k++) put(any('marktstand_obst'), [33, 40, 54][k], -(ROAD_W + 4.4), { face: 'road', gap: 0.6 });
    put(any('haendler'), 42, -(ROAD_W + 2.6), { face: 'road', anim: 'Rufen', radK: 0.4, gap: 0.4 });
  }
  // ---- 7 The Mill (on the way out would be past the finish, so it stands by the brook on the way in) ----
  if (st >= 7) put(any('wassermuehle'), 470, -(ROAD_W + 30), { face: 'road', gap: 4, ground: 'centre' });
  // the next building as a bare timber frame: the preview of what the next kilometres will build
  const nx = nextStage(km);
  if (nx) { const site = any('baustelle'); const where = { 1: 95, 2: 160, 3: 260, 4: 300, 5: 340, 6: 45, 7: 470, 8: 400 }[STAGES.indexOf(nx)];
    const left = { 1: 1, 4: 1, 6: 1, 7: 1 }[STAGES.indexOf(nx)] ? -1 : 1;
    if (site && where) put(site, where, left * (ROAD_W + 12), { face: 'road', gap: 2 }); }
  console.log('[village]', `stage ${st} ${STAGES[st].name}`, `km ${Math.round(km)}`, `built ${built.length}`, missed.length ? `refused ${missed.join(', ')}` : '');
  return { stage: st, name: STAGES[st].name, next: nx, built: built.length, missed };
}

/** per frame, only the few animated village nodes (ctx.anim): lanterns flicker, pennants flutter */
export function tickVillage(anim, t) {
  for (const c of anim) {
    if (c.userData.lantern) c.scale.setScalar(1 + Math.sin(t * 7 + c.userData.lantern.ph) * 0.05 + Math.sin(t * 17 + c.userData.lantern.ph) * 0.03);
    else if (c.userData.flutter) c.rotation.y = Math.sin(t * 3 + c.id) * 0.35;
    else if (c.userData.smoke) { const S = c.userData.smoke, a = (t * 0.12 + S.ph) % 1; // one puff's life: rise, widen, drift downwind, fade
      c.position.set(a * a * 4 * S.k, a * S.rise, a * 1.5); c.scale.setScalar((1 + a * 4) * S.k); c.material.opacity = Math.sin(a * Math.PI) * 0.55; }
  }
}
