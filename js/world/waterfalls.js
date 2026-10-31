// Waterfalls along the route, found from the terrain: 2-3 big cascades draped down mountain faces (read from far as
// white streaks), small falls over rock steps beside the road, and one right at the road with a water mill.
// Blender models (waterfall/wasserfall_muehle, wasserfall_klein) replace the near procedural ones when present.
// All procedural water is one shader (scrolling streak noise, foam on steep parts, fresnel, sun sparkle) animated
// only through uniforms, so the meshes stay frozen; spray of every fall is one instanced billboard mesh.
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import { ROAD_W, DS, smooth, lerp, rng } from './field.js';
import { TIME } from './terrainmat.js';
import { planks, stone } from './tex.js';

const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const G = 9.81;

/** Finds the spots, builds everything, returns { list, update(time, dt, cam) } for the world's _life. */
export function placeWaterfalls(world, A, taken = []) {
  const t0 = performance.now(), f = world.field, L = world.track.length, segs = world.track.segments || [], r = rng(5150);
  const scene = world.scene, falls = [], mist = [], scroll = new Map(); // model water texture -> scroll speed
  const frame = d => { const p = f.at(d), l = Math.hypot(p.tx, p.tz) || 1; return { x: p.x, z: p.z, e: p.e, tx: p.tx / l, tz: p.tz / l }; };
  const spot = (d, off) => { const p = frame(d); return { x: p.x - p.tz * off, z: p.z + p.tx * off }; };
  const H = (x, z) => f.height(x, z);
  const free = (x, z, rad) => taken.every(c => Math.hypot(c[0] - x, c[1] - z) > c[2] + rad);
  const landSide = d => -((segs.find(s => d >= s.from && d < s.to) || {}).seaSide || -1);
  const straight = (d, w) => { const a = frame(d - w), b = frame(d + w); return a.tx * b.tx + a.tz * b.tz; };
  const onRoad = (x, z, d, min) => { const q = f.road(x, z); return !q || q.d < min || Math.abs(q.i * DS - d) > 80 && q.d < min + 25; };

  // ---------------- spots ----------------
  const big = findBig(f, L, frame, spot, H);
  const near = [];
  for (let d = 500; d < L - 400; d += 100) for (const s of [landSide(d), -landSide(d)]) for (const o of [11, 20, 30]) {
    if (straight(d, 30) < 0.96) continue;
    const q = spot(d, s * o), h0 = H(q.x, q.z); if (h0 < 1.5) continue;
    const b = spot(d, s * (o + 30)), h1 = H(b.x, b.z); if (h1 < h0 - 0.5) continue;
    if (onRoad(q.x, q.z, d, o - 2) || onRoad(b.x, b.z, d, o + 20)) continue;
    near.push({ d, s, o, x: q.x, z: q.z, rise: h1 - h0, land: s === landSide(d) });
  }
  const used = [...big.map(b => b.d)];
  const far = (d, gap, sm) => used.every((u, i) => Math.abs(u - d) > (sm && i < big.length ? 800 : gap));
  const fits = (n, e) => { if (!e) return true; // model footprint clear of every other road bit
    const p = frame(n.d), nx = -p.tz * n.s, nz = p.tx * n.s;
    for (const x of [-0.5, 0, 0.5]) for (const z of [0.08, 0.5, 1]) { const b = 4 + z * e.size[2], q = f.road(p.x + p.tx * x * e.size[0] + nx * b, p.z + p.tz * x * e.size[0] + nz * b);
      if (!q || q.d < Math.min(b, ROAD_W + 1.5) - 0.5 || Math.abs(q.i * DS - n.d) > 60 && q.d < b + 8) return false; }
    return true; };
  const pickNear = (o, gap, rad, need = 0, e = null, sm = false) => {
    const c = near.filter(n => n.o === o && n.rise >= need && far(n.d, gap, sm) && free(n.x, n.z, rad) && fits(n, e)).sort((a, b) => b.rise + b.land * 4 - a.rise - a.land * 4)[0];
    if (c) used.push(c.d); return c;
  };
  const gMill = A?.find('wasserfall_muehle'), gSmall = A?.find('wasserfall_klein');
  const millSite = pickNear(11, 1500, gMill ? 28 : 14, 0, gMill);
  const smalls = []; for (let k = 0; k < 4; k++) { const c = pickNear(k % 2 ? 30 : 20, 3500, 14, 3, null, true); if (c) smalls.push(c); }

  // ---------------- shared materials ----------------
  const U = waterUniforms(world);
  const wMat = waterMaterial(U);
  const rockMat = world.terrainMat;
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a42, roughness: 0.9, map: planks() });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.9, map: wood.map });
  const sod = new THREE.MeshStandardMaterial({ color: 0x6f7d45, roughness: 1 });
  const stoneM = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.95, map: stone() });

  const add = (o, mirror) => { if (!mirror) o.traverse(c => c.layers.set(1)); scene.add(o); freeze(o); return o; };
  const fall = (kind, d, side, x, z, range, info) => { const F = { kind, d, side, x, z, range, objs: [], loud: kind === 'big' ? 1 : kind === 'mill' ? 0.8 : 0.5, ...info }; falls.push(F); return F; };

  // ---------------- big cascades on the mountain faces ----------------
  for (const b of big) {
    const F = fall('big', b.d, b.side, b.mid[0], b.mid[2], 2200, { size: Math.round(b.drop), y: b.mid[1] });
    const parts = [drapeStrip(b.path, b.w * 2.4, 0.45, H, r() * 10, 2), drapeStrip(b.path, b.w, 0.7, H, r() * 10)]; // wet dark rock under the white water
    const off = b.path.map((p, i) => i > b.path.length * 0.25 ? [p[0] + b.px * b.w * 0.9, p[1], p[2] + b.pz * b.w * 0.9] : null).filter(Boolean);
    if (off.length > 6) parts.push(drapeStrip(off, b.w * 0.45, 0.7, H, r() * 10 + 3));
    const m = new THREE.Mesh(mergeGeometries(parts), wMat); m.renderOrder = 2; add(m, true); F.objs.push(m);
    const e = b.path[b.path.length - 1];
    for (let k = 0; k < 9; k++) mist.push([e[0] + (r() - .5) * b.w * 2.5, H(e[0], e[2]) + 1 + r() * 4, e[2] + (r() - .5) * b.w * 2.5, 9 + r() * 9, 0.32, r(), 2200]);
  }

  // ---------------- the mill fall right beside the road ----------------
  if (millSite) {
    const s = millSite;
    if (gMill) glbFall(gMill, s, 'mill');
    else {
      const F = fall('mill', s.d, s.s, s.x, s.z, 900, { size: 9 });
      buildStep(F, s, { R: 3.2, Hl: 8.5, wf: 2.4, mill: true });
    }
  }
  for (const s of smalls) {
    if (gSmall && smalls.indexOf(s) % 2 === 0) { glbFall(gSmall, { ...s, o: Math.max(5, s.o - 12) }, 'small'); continue; }
    const F = fall('small', s.d, s.s, s.x, s.z, 700, { size: 0 });
    const Hl = 5 + r() * 5; F.size = Math.round(Hl);
    buildStep(F, s, { R: 2.4 + r() * 1.2, Hl, wf: 1.3 + r() * 1.6 });
  }

  // ---------------- spray: one instanced billboard mesh for all falls ----------------
  const mistMesh = mistMeshOf(mist, U, A);
  if (mistMesh) { mistMesh.traverse(c => c.layers.set(1)); scene.add(mistMesh); freeze(mistMesh); }

  for (const F of falls) console.info(`RIDEFRAME Wasserfall ${F.kind} d=${Math.round(F.d)} ${F.side > 0 ? 'rechts' : 'links'} ${F.size} m${F.glb ? ' (Modell)' : ''} · Foto bei at=${Math.round(F.shot ?? F.d - 70)}`);
  console.info(`RIDEFRAME Wasserfälle ${falls.length} in ${Math.round(performance.now() - t0)} ms`);

  // ---------------- per frame ----------------
  let cullT = -1, sfxT = 0;
  const WFCAM = QS.has('wfcam') ? +QS.get('wfcam') : -1; // test view: from the road onto fall #i
  const update = (time, dt, cam) => {
    if (falls[WFCAM]) { const F = falls[WFCAM], back = F.kind === 'big' ? 380 : +(QS.get('wfback') || 24), q = frame(F.d - back), c = world.camera;
      c.position.set(q.x - q.tz * F.side * 1.5, q.e + 1.6, q.z + q.tx * F.side * 1.5); c.lookAt(F.x, F.y ?? H(F.x, F.z) + 4, F.z); c.updateMatrixWorld(); }
    U.uSunCol.value.copy(world.light.color).multiplyScalar(world.light.intensity);
    U.uAmb.value.copy(world.hemi.color).multiplyScalar(world.hemi.intensity);
    for (const [tx, v] of scroll) { tx.offset.y += v * Math.min(dt, 0.1); if (tx.offset.y > 1) tx.offset.y -= 1; }
    if (cullT < 0 || time - cullT > 0.5 || world.instant) {
      cullT = time;
      for (const F of falls) {
        F.dist = Math.hypot(F.x - cam.x, F.z - cam.z); const v = F.dist < F.range;
        for (const o of F.objs) o.visible = v;
        if (F.glbObj) F.glbObj.matrixWorldAutoUpdate = v && F.dist < 220;
      }
    }
    for (const F of falls) if (F.dist < 260) {
      if (F.wheel) spinWheel(F.wheel, time);
      if (F.glbWheel) F.glbWheel.rotation.x = -0.576 * time;
    }
    if (time - sfxT > 0.25 && world.events?.sfx) { // nearest fall: volume by distance, pan by side of the view
      sfxT = time; let best = null, bv = 0;
      for (const F of falls) { const v = F.loud * Math.pow(Math.max(0, 1 - F.dist / (F.kind === 'big' ? 600 : 160)), 2); if (v > bv) { bv = v; best = F; } }
      if (best) { const e = world.camera.matrixWorld.elements, dx = best.x - cam.x, dz = best.z - cam.z;
        world.events.sfx('waterfall', bv, Math.max(-1, Math.min(1, (dx * e[0] + dz * e[2]) / (best.dist || 1)))); }
    }
  };
  return { list: falls, update };

  // ---------------- builders (closures over the world) ----------------
  /** Rock step behind a pool, water sheet over its lip, foam pool, outflow along the road; mill: flume, wheel, house. */
  function buildStep(F, s, o) {
    const p = frame(s.d), tx = p.tx, tz = p.tz, nx = -tz * s.s, nz = tx * s.s; // t along the road, n away from it
    const W = (a, b) => [s.x + tx * a + nx * b, s.z + tz * a + nz * b];
    const R = o.R, bL = R + 0.5, rw = 2.6, aw = R + 1.0; // wheel radius and position (mill)
    let poolY = -1e9; for (let k = 0; k < 9; k++) { const an = k / 8 * 6.283, rr = k === 8 ? 0 : R; const [x, z] = W(Math.cos(an) * rr, Math.sin(an) * rr); poolY = Math.max(poolY, H(x, z)); }
    poolY += 0.12;
    const Hl = o.mill ? Math.max(o.Hl, 2 * rw + 1.2) : o.Hl, lipY = poolY + Hl;
    const half = o.mill ? aw + 2.2 : Math.max(o.wf / 2 + 2.5, 4 + r() * 3); // flat part of the step
    const outA = o.mill ? -1 : 1; // outflow along the road, away from the mill house
    // rock step + pool rim as one terrain-material height field (rows: in front, the face, on top)
    const rows = [];
    for (const b of [-R - 3, -R - 2, -R - 1.2, -R - 0.5, -R + 0.3, -R * 0.5, 0, R * 0.5, R - 0.3, R + 0.3, bL - 0.5]) rows.push([b, 0]);
    for (let k = 1; k < 8; k++) rows.push([bL - 0.25 + k / 8 * 0.6, k / 8]);
    for (const b of [0.95, 1.6, 2.6, 4, 6, 8.5, 11.5, 15]) rows.push([bL + b, 1]);
    const as = []; for (let a = -half - 6; a <= half + 6.01; a += 0.8) as.push(a);
    const pos = [], col = [], spl = [], idx = [];
    for (const [b0, fr] of rows) for (const a of as) {
      const jit = fr > 0 && fr < 1 ? Math.abs(f.n3(a / 1.7 + s.d, fr * 3)) * 0.45 + Math.abs(f.n2(a / 0.6, fr * 9 + s.d)) * 0.15 : 0;
      const b = b0 + jit;
      const [x, z] = W(a, b), g = H(x, z);
      const env = smooth(half + 5 + f.n2(a / 3, s.d) * 1.5, half - 0.5, Math.abs(a)), back = smooth(bL + 16, bL + 8, b);
      const top = Math.max(g, lipY + (b - bL) * 0.06 + (fr > 0 && fr < 1 ? 0 : f.n3(a / 2.3, b / 2.3) * 0.25 * smooth(0.5, 2, b - bL)));
      let y = lerp(g, top, fr * env * back), bump = y - g;
      const dr = Math.hypot(a, b), ang = Math.atan2(b, a * outA), gap = smooth(0.35, 0.9, Math.abs(ang + 0.15)); // rim open where the outflow leaves
      const rim = smooth(R + 1.7, R + 0.2, dr) * smooth(R - 0.7, R, dr) * gap * (fr ? 0 : 1);
      if (rim > 0) { const ry = poolY + 0.28 + f.n3(a * 1.3, b * 1.3) * 0.18; if (ry > y) { bump += (ry - y) * rim; y = lerp(y, ry, rim); } }
      if (dr < R - 0.4 && !fr) { y = Math.min(y, poolY - 0.5 - 0.6 * (1 - dr / R)); bump = 1; }
      y -= 0.35 * (1 - smooth(0.05, 0.4, bump)); // where nothing rises, sink under the terrain (no z-fighting)
      pos.push(x, y, z); col.push(0.86, 0.86, 0.83);
      const rk = Math.min(1, fr * env * 1.3 + rim);
      spl.push(1 - rk, rk, 0, 0);
    }
    const NA = as.length;
    for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < NA - 1; i++) { const a = j * NA + i, b = a + NA; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('splat', new THREE.Float32BufferAttribute(spl, 4)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    // grass on the flat top, rock on the face: re-weight by the final normal
    { const N = g.attributes.normal, S = g.attributes.splat; for (let i = 0; i < N.count; i++) { const rk = Math.max(S.getY(i), smooth(0.8, 0.55, N.getY(i))); S.setXY(i, 1 - rk, rk); } }
    const rock = new THREE.Mesh(g, rockMat); rock.castShadow = true; rock.receiveShadow = true; add(rock); F.objs.push(rock);
    taken.push([s.x, s.z, half + 6]);

    // water: stream on the step, sheet over the lip, pool, outflow
    const parts = [], v0 = 1.5, T = Math.sqrt(2 * Hl / G);
    const sheet = (a0, wf, b0, y0, y1, seed, spill = false) => { // free-falling sheet from (a0, b0, y0) down to y1
      const rowsW = [], tt = Math.sqrt(2 * Math.max(0.3, y0 - y1) / G);
      if (!spill) for (const b of [5, 3.2, 1.8, 0.8, 0.2]) { const [x, z] = W(a0, b0 + b); rowsW.push({ x, z, y: Math.max(H(x, z), lipY + b * 0.06) + 0.1, w: wf * 0.8, st: 0.12 + (5 - b) * 0.06, fade: b > 4 ? 0 : 1 }); }
      for (let k = 0; k <= 12; k++) { const u = k / 12, tk = u * tt, [x, z] = W(a0, b0 - (spill ? 0.6 : v0) * tk);
        rowsW.push({ x, z, y: y0 - 0.5 * G * tk * tk, w: wf * (1 + u * 0.4), st: 1, fade: 1 }); }
      parts.push(ribbon(rowsW, seed));
    };
    sheet(0, o.wf, bL - 0.05, lipY + 0.12, poolY + 0.02, r() * 10);
    const impB = bL - v0 * T;
    parts.push(pool(W, 0, 0, R, 0, impB, poolY, [tx, tz], [nx, nz]));
    { const rowsW = []; for (let k = 0; k <= 9; k++) { const a = outA * (R - 0.3 + k * 1.6), [x, z] = W(a, -0.4 - k * 0.15); rowsW.push({ x, z, y: H(x, z) + 0.12, w: lerp(1.3, 0.5, k / 9), st: 0.08, fade: k === 9 ? 0 : 1 }); }
      rowsW[0].y = poolY - 0.02; parts.push(ribbon(rowsW, r() * 10)); }
    for (let k = 0; k < 8; k++) { const [x, z] = W((r() - .5) * o.wf * 1.6, impB + (r() - .5) * 1.6); mist.push([x, poolY + 0.4 + r() * 1.2, z, 2 + r() * 2.5, 0.32, r(), 700]); }

    if (o.mill) {
      // flume from the step top to the wheel crown, posts, wheel against the house, the house itself
      const bw = bL - rw - 0.45, wy = poolY - 0.25 + rw, crown = wy + rw;
      const woodG = [];
      const beam = (p0, p1, w, h) => { const b = new THREE.BoxGeometry(w, h, Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]));
        const o3 = new THREE.Object3D(); o3.position.set((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2); o3.lookAt(p1[0], p1[1], p1[2]); o3.updateMatrix(); woodG.push(b.applyMatrix4(o3.matrix)); };
      const P3 = (a, b, y) => { const [x, z] = W(a, b); return [x, y, z]; };
      const fy0 = lipY - 0.15, fy1 = crown + 0.35, fb0 = bL + 3.5, fb1 = bw - 0.5;
      beam(P3(aw, fb0, fy0), P3(aw, fb1, fy1), 0.8, 0.08);
      for (const sd of [-0.38, 0.38]) beam(P3(aw + sd, fb0, fy0 + 0.2), P3(aw + sd, fb1, fy1 + 0.2), 0.06, 0.4);
      for (const b of [bL - 0.2]) { const y = lerp(fy1, fy0, (b - fb1) / (fb0 - fb1)); beam(P3(aw, b, poolY - 0.4), P3(aw, b, y - 0.05), 0.2, 0.2); }
      { const rowsW = []; for (let k = 0; k <= 6; k++) { const u = k / 6, b = lerp(fb0, fb1, u); const [x, z] = W(aw, b); rowsW.push({ x, z, y: lerp(fy0, fy1, u) + 0.1, w: 0.62, st: 0.35, fade: k ? 1 : 0 }); } parts.push(ribbon(rowsW, 4.2)); }
      { const rowsW = []; for (let k = 0; k <= 8; k++) { const u = k / 8, tk = u * 0.6, [x, z] = W(aw, fb1 - 0.2 - 0.9 * tk); rowsW.push({ x, z, y: fy1 + 0.05 - 0.5 * G * tk * tk, w: 0.7, st: 1, fade: k === 8 ? 0 : 1 }); } parts.push(ribbon(rowsW, 7.7)); }
      for (let k = 0; k < 3; k++) { const [x, z] = W(aw + (r() - .5) * 0.6, bw - rw * 0.6); mist.push([x, wy + (r() - .5) * 1.5, z, 1.2 + r(), 0.25, r(), 400]); }
      // wheel: axis along the road; top moves towards the road with the water
      const [wx, wz] = W(aw, bw), up = new THREE.Vector3(0, 1, 0), ax = new THREE.Vector3(tx, 0, tz);
      const base = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, up, ax.clone().cross(up)));
      const zw = ax.clone().cross(up), sign = (zw.x * -nx + zw.z * -nz) > 0 ? 1 : -1;
      const wheel = new THREE.Mesh(wheelGeo(rw), dark); wheel.position.set(wx, wy, wz); wheel.castShadow = true; wheel.receiveShadow = true;
      wheel.layers.set(1); scene.add(wheel); wheel.matrixAutoUpdate = false; wheel.matrixWorldAutoUpdate = false;
      F.wheel = { m: wheel, base, sign, q: new THREE.Quaternion(), qx: new THREE.Quaternion(), ax: new THREE.Vector3(1, 0, 0) }; spinWheel(F.wheel, 0); F.objs.push(wheel);
      // the house: stone base, tarred plank walls, turf roof; wall towards the wheel at a = aw + 0.75
      const hw = 6.2, hd = 5.2, ha = aw + 0.75 + hw / 2, hb = bw + 0.2;
      let gy = 1e9, gyM = -1e9; for (const [da, db] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const [x, z] = W(ha + da * hw / 2, hb + db * hd / 2); const h = H(x, z); gy = Math.min(gy, h); gyM = Math.max(gyM, h); }
      const fl = Math.max(gyM + 0.3, poolY + 0.5), hy = 3.1;
      const ang = Math.atan2(tx, tz), boxAt = (list, w, h, dd, a, b, y, roty = 0) => { const bx = new THREE.BoxGeometry(w, h, dd); bx.rotateY(ang + roty); const [x, z] = W(a, b); bx.translate(x, y, z); list.push(bx); };
      // box axes: local x = across the road (n), local z = along the road (t)
      const stoneG = [], roofG = [], darkG = [];
      boxAt(stoneG, hd + 0.3, fl - gy + 0.6, hw + 0.3, ha, hb, (fl + gy - 0.6) / 2);
      boxAt(woodG, hd, hy, hw, ha, hb, fl + hy / 2);
      boxAt(darkG, 0.12, 1.9, 1.0, ha - 0.6, hb - hd / 2 - 0.02, fl + 0.95); // door and windows
      for (const da of [-1.9, 1.6]) boxAt(darkG, 0.1, 0.8, 0.8, ha + da, hb - hd / 2 - 0.02, fl + 1.9);
      { const sh = new THREE.Shape(); sh.moveTo(-hd / 2 - 0.5, 0); sh.lineTo(0, 2.1); sh.lineTo(hd / 2 + 0.5, 0); sh.lineTo(-hd / 2 - 0.5, 0);
        const rg = new THREE.ExtrudeGeometry(sh, { depth: hw + 0.9, bevelEnabled: false }); rg.translate(0, 0, -(hw + 0.9) / 2);
        rg.rotateY(ang); const [x, z] = W(ha, hb); rg.translate(x, fl + hy - 0.05, z); roofG.push(rg); }
      for (const [list, m] of [[woodG, wood], [stoneG, stoneM], [roofG, sod], [darkG, dark]]) {
        const geo = mergeGeometries(list.map(x => x.index ? x.toNonIndexed() : x)); const ms = new THREE.Mesh(geo, m);
        ms.castShadow = true; ms.receiveShadow = true; add(ms); F.objs.push(ms); }
      taken.push([...W(ha, hb), 6]);
      F.shot = s.d - 55;
    }
    const wm = new THREE.Mesh(mergeGeometries(parts), wMat); wm.renderOrder = 2; add(wm); F.objs.push(wm);
  }

  /** Blender waterfall: origin at the bottom of the road-side edge, front +Z towards the road. */
  function glbFall(e, s, kind) {
    const p = frame(s.d), nx = -p.tz * s.s, nz = p.tx * s.s, o0 = kind === 'mill' ? 4 : s.o;
    const ox = p.x + nx * o0, oz = p.z + nz * o0, ang = Math.atan2(-nx, -nz);
    const F = fall(kind, s.d, s.s, ox + nx * e.size[2] * 0.4, oz + nz * e.size[2] * 0.4, kind === 'mill' ? 1100 : 800, { size: Math.round(e.size[1]), glb: true });
    const { obj } = A.make(e, null, r);
    let y = 1e9; for (const a of [-0.4, 0, 0.4]) y = Math.min(y, H(ox + p.tx * a * e.size[0], oz + p.tz * a * e.size[0]));
    obj.position.set(ox, y, oz); obj.rotation.y = ang; obj.updateMatrixWorld(true);
    obj.traverse(c => {
      c.layers.set(1);
      const wet = /^(wasserfall_wasser|gerinne_wasser|wasserfall_gischt|bach_wasser)/.exec(c.name);
      if (wet || c.material?.name === 'Water') { // fall and flume run fast (2.0/s), spray and brook slowly (0.5/s)
        c.castShadow = false; if (c.material) { c.material.depthWrite = false; c.material.transparent = true;
          if (c.material.map) scroll.set(c.material.map, /^(wasserfall_wasser|gerinne_wasser)/.test(wet?.[1] || '') ? 2.0 : 0.5); } }
      if (c.userData.millWheel) F.glbWheel = c;
      const src = /^gischt_quelle_(unten|mitte|rad)/.exec(c.name);
      if (src) { const w = c.getWorldPosition(new THREE.Vector3()), rad = c.userData.radius_m ?? { unten: 3.5, mitte: 2.5, rad: 1.2 }[src[1]];
        for (let k = 0; k < 8; k++) { const an = r() * 6.28, rr = Math.sqrt(r()) * rad; mist.push([w.x + Math.cos(an) * rr, w.y + r() * rad * 0.4, w.z + Math.sin(an) * rr, 3 + r() * 3, 0.3 + r() * 0.2, r(), 700]); } }
    });
    scene.add(obj); F.objs.push(obj); F.glbObj = obj;
    if (F.glbWheel) { obj.traverse(c => { c.matrixAutoUpdate = c === F.glbWheel; }); } else freeze(obj);
    taken.push([F.x, F.z, Math.max(e.size[0], e.size[2]) * 0.55]);
    // the stream leaves the front edge at x ~ +15 (mill) / +5.7 (small): stone bridge parapets where it meets the road
    const ex = obj.localToWorld(new THREE.Vector3(kind === 'mill' ? 15 : 5.7, 0, 0)), at = f.road(ex.x, ex.z);
    if (at && at.d < 30) {
      const db = at.i * DS, list = [], q = frame(db);
      for (const sd of [-1, 1]) { const off = sd * (ROAD_W + 0.35), x = q.x - q.tz * off, z = q.z + q.tx * off;
        const bx = new THREE.BoxGeometry(0.45, 0.7, 5.5); bx.rotateY(Math.atan2(q.tx, q.tz)); bx.translate(x, q.e + 0.3, z); list.push(bx);
        const cap = new THREE.BoxGeometry(0.6, 0.12, 5.7); cap.rotateY(Math.atan2(q.tx, q.tz)); cap.translate(x, q.e + 0.7, z); list.push(cap); }
      const m = new THREE.Mesh(mergeGeometries(list), stoneM); m.castShadow = true; m.receiveShadow = true; add(m); F.objs.push(m);
      // stream on the far side, running away from the road
      const rowsW = []; for (let k = 0; k <= 10; k++) { const off = -s.s * (ROAD_W + 0.8 + k * 1.8), x = q.x - q.tz * off, z = q.z + q.tx * off; rowsW.push({ x, z, y: Math.min(q.e - 0.15, H(x, z)) + 0.1, w: lerp(1.6, 0.8, k / 10), st: 0.1, fade: k === 10 ? 0 : 1 }); }
      const wm = new THREE.Mesh(ribbon(rowsW, 2.5), wMat); wm.renderOrder = 2; add(wm); F.objs.push(wm);
    }
    F.shot = s.d - 60;
    return F;
  }
}

// ---------------- spot search for the big ones ----------------
function findBig(f, L, frame, spot, H) {
  const grad = (x, z, e) => { const h = H(x, z); return [(H(x + e, z) - h) / e, (H(x, z + e) - h) / e, h]; };
  const cands = [];
  for (let d = 400; d < L - 300; d += 200) for (const s of [-1, 1]) for (let o = 220; o <= 760; o += 90) {
    const q = spot(d, s * o), [gx, gz, h] = grad(q.x, q.z, 6), sl = Math.hypot(gx, gz);
    if (h < 25 || sl < 0.9) continue;
    const p = frame(d), tox = p.x - q.x, toz = p.z - q.z, tl = Math.hypot(tox, toz);
    if ((-gx * tox - gz * toz) / (sl * tl) < 0.3) continue; // the face has to look towards the road
    cands.push({ d, s, x: q.x, z: q.z, sl });
  }
  cands.sort((a, b) => b.sl - a.sl);
  const res = [];
  for (const c of cands.slice(0, 60)) {
    let x = c.x, z = c.z;
    for (let k = 0; k < 40; k++) { const [gx, gz] = grad(x, z, 4), sl = Math.hypot(gx, gz); if (sl < 0.6) break; x += gx / sl * 4; z += gz / sl * 4; } // up to the lip
    const pts = [[x, H(x, z), z]]; let low = 0, above = -1e9;
    for (let k = 0; k < 8; k++) above = Math.max(above, H(x + Math.cos(k * 0.785) * 160, z + Math.sin(k * 0.785) * 160));
    if (above < pts[0][1] + 35) continue; // the water needs ground above it: no falls off a summit ridge
    for (let k = 0; k < 150; k++) { // down the fall line (gullies collect it)
      const [gx, gz] = grad(x, z, 4), sl = Math.hypot(gx, gz); if (sl < 1e-3) break;
      x -= gx / sl * 3; z -= gz / sl * 3; const h = H(x, z); pts.push([x, h, z]);
      low = sl < 0.45 ? low + 1 : 0; if (low >= 4 || h < 3 || pts[0][1] - h > 140) break;
    }
    pts.length = Math.max(2, pts.length - Math.max(0, low - 1));
    const drop = pts[0][1] - pts[pts.length - 1][1]; if (drop < 45 || pts.length < 12) continue;
    const mid = pts[Math.floor(pts.length * 0.4)], rr = f.road(mid[0], mid[2]); if (!rr || rr.d < 150 || rr.d > 950) continue;
    if (pts.some(p => { const q = f.road(p[0], p[2]); return !q || q.d < 120; })) continue;
    // seen from the road while riding towards it
    const dn = rr.i * DS; let vis = 0, n = 0;
    for (let dd = -1000; dd <= 0; dd += 125) { const q = frame(Math.max(0, dn + dd)); n++;
      let ok = true; for (let k = 1; k < 20 && ok; k++) { const u = k / 20, X = lerp(q.x, mid[0], u), Z = lerp(q.z, mid[2], u), Y = lerp(q.e + 1.6, mid[1] + 2, u); if (H(X, Z) > Y + 1) ok = false; }
      vis += ok; }
    if (vis / n < 0.35) continue;
    res.push({ d: dn, side: Math.sign(rr.side) || c.s, pts, drop, mid, score: drop * (vis / n) * Math.min(2, c.sl) * 600 / (rr.d + 300) });
  }
  res.sort((a, b) => b.score - a.score);
  const out = [];
  for (const b of res) {
    if (out.length >= 3 || out.some(o => Math.abs(o.d - b.d) < 5000)) continue;
    // smooth the path (descent zigzags in gullies), then the strip follows the surface
    let P = b.pts; for (let it = 0; it < 3; it++) P = P.map((p, i) => i === 0 || i === P.length - 1 ? p : [(P[i - 1][0] + p[0] * 2 + P[i + 1][0]) / 4, 0, (P[i - 1][2] + p[2] * 2 + P[i + 1][2]) / 4]);
    P = P.map(p => [p[0], H(p[0], p[2]), p[2]]);
    const a = P[0], e = P[P.length - 1], l = Math.hypot(e[0] - a[0], e[2] - a[2]) || 1;
    out.push({ ...b, path: P, w: 6 + Math.min(7, b.drop / 20), px: -(e[2] - a[2]) / l, pz: (e[0] - a[0]) / l });
  }
  return out.sort((a, b) => a.d - b.d);
}

// ---------------- geometry ----------------
const ACROSS = [-1, -0.55, 0, 0.55, 1];
/** Strip through rows {x, y, z, w, st (steepness 0..1), fade}; across = horizontal normal of the row direction. */
function ribbon(rows, seed) {
  const pos = [], uv = [], fa = [], idx = []; let v = 0;
  rows.forEach((R, i) => {
    const A = rows[Math.max(0, i - 1)], B = rows[Math.min(rows.length - 1, i + 1)];
    let dx = B.x - A.x, dz = B.z - A.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (i) v += Math.hypot(R.x - rows[i - 1].x, R.y - rows[i - 1].y, R.z - rows[i - 1].z);
    for (const k of ACROSS) { pos.push(R.x - dz * k * R.w / 2, R.y, R.z + dx * k * R.w / 2); uv.push(k * R.w / 2, v); fa.push(R.st, k, R.fade, seed); }
  });
  return strip(pos, uv, fa, rows.length, 0);
}
/** Strip draped over the terrain along path [[x, y, z]...] (top first). */
function drapeStrip(P, w, lift, H, seed, mode = 0) {
  const pos = [], uv = [], fa = [], n = P.length; let v = 0;
  for (let i = 0; i < n; i++) {
    const A = P[Math.max(0, i - 1)], B = P[Math.min(n - 1, i + 1)];
    let dx = B[0] - A[0], dz = B[2] - A[2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const sl = Math.abs(B[1] - A[1]) / l, u = i / (n - 1);
    if (i) v += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]);
    const wi = w * (0.55 + 0.6 * u) * (0.85 + 0.3 * Math.sin(i * 0.7 + seed));
    for (const k of ACROSS) { const x = P[i][0] - dz * k * wi / 2, z = P[i][2] + dx * k * wi / 2;
      pos.push(x, Math.max(H(x, z), P[i][1] - 1) + lift, z); uv.push(k * wi / 2, v);
      fa.push(smooth(0.3, 1.1, sl), k, Math.min(1, i / 3, (n - 1 - i) / 4), seed); }
  }
  return strip(pos, uv, fa, n, mode);
}
function strip(pos, uv, fa, nRows, mode) {
  const C = ACROSS.length, idx = [];
  for (let j = 0; j < nRows - 1; j++) for (let i = 0; i < C - 1; i++) { const a = j * C + i, b = a + C; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  return geo(pos, uv, fa, new Array(pos.length / 3).fill(mode), idx);
}
/** Pool disc: flow runs outward from the impact point, foam around it and along the shore. */
function pool(W, a0, b0, R, ia, ib, y, t, n) {
  const pos = [], uv = [], fa = [], md = [], idx = [], RINGS = [0, 0.2, 0.42, 0.64, 0.82, 0.93, 1], SEG = 28;
  const C = Math.max(1, Math.round(2 * Math.PI * R / 2.5)) * 2.5;
  for (const rr of RINGS) for (let k = 0; k <= SEG; k++) {
    const an = k / SEG * Math.PI * 2, a = a0 + Math.cos(an) * R * rr, b = b0 + Math.sin(an) * R * rr, [x, z] = W(a, b);
    const di = Math.hypot(a - ia, b - ib);
    pos.push(x, y, z); uv.push(k / SEG * C, di); fa.push(Math.exp(-di * di / 2.2), rr, 1, 1.7); md.push(1);
  }
  for (let j = 0; j < RINGS.length - 1; j++) for (let k = 0; k < SEG; k++) { const a = j * (SEG + 1) + k, b = a + SEG + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  return geo(pos, uv, fa, md, idx);
}
function geo(pos, uv, fa, md, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aF', new THREE.Float32BufferAttribute(fa, 4)); g.setAttribute('aM', new THREE.Float32BufferAttribute(md, 1));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
function wheelGeo(R) { // overshot wheel, axis = local x
  const L = [], toX = g => g.rotateY(Math.PI / 2);
  for (const x of [-0.45, 0.45]) {
    L.push(toX(new THREE.TorusGeometry(R, 0.08, 6, 36)).translate(x, 0, 0), toX(new THREE.TorusGeometry(R * 0.62, 0.06, 5, 28)).translate(x, 0, 0));
    for (let k = 0; k < 4; k++) L.push(new THREE.BoxGeometry(0.1, R * 2, 0.12).rotateX(k * Math.PI / 4 + 0.2).translate(x, 0, 0));
  }
  L.push(new THREE.CylinderGeometry(0.26, 0.26, 1.3, 10).rotateZ(Math.PI / 2), new THREE.CylinderGeometry(0.1, 0.1, 2.2, 6).rotateZ(Math.PI / 2).translate(0.9, 0, 0));
  for (let k = 0; k < 20; k++) { const a = k / 20 * Math.PI * 2; L.push(new THREE.BoxGeometry(0.98, 0.07, 0.5).translate(0, R - 0.25, 0.08).rotateX(a)); }
  return mergeGeometries(L.map(g => g.toNonIndexed()));
}
function spinWheel(W, time) {
  W.qx.setFromAxisAngle(W.ax, W.sign * time * 0.576); W.q.copy(W.base).multiply(W.qx);
  W.m.matrix.compose(W.m.position, W.q, W.m.scale); W.m.matrixWorld.copy(W.m.matrix);
}
function freeze(o) { o.updateMatrixWorld(true); o.traverse(c => { c.matrixAutoUpdate = false; }); o.matrixWorldAutoUpdate = false; }

// ---------------- shaders ----------------
let NOISE = null;
function noiseTex() { // tileable value-noise fbm, two independent channels
  if (NOISE) return NOISE;
  const N = 128, D = new Uint8Array(N * N * 4), r = rng(4711);
  const lat = P => Float32Array.from({ length: P * P }, () => r());
  const oct = [[4, .45], [8, .27], [16, .17], [32, .11]].map(([P, w]) => [P, w, lat(P), lat(P)]);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let a = 0, b = 0;
    for (const [P, w, g1, g2] of oct) {
      const x = i / N * P, y = j / N * P, x0 = Math.floor(x), y0 = Math.floor(y), u = x - x0, v = y - y0, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
      const k = (X, Y) => (Y % P) * P + (X % P);
      const s = g => lerp(lerp(g[k(x0, y0)], g[k(x0 + 1, y0)], su), lerp(g[k(x0, y0 + 1)], g[k(x0 + 1, y0 + 1)], su), sv);
      a += s(g1) * w; b += s(g2) * w;
    }
    const o = (j * N + i) * 4; D[o] = a * 255; D[o + 1] = b * 255; D[o + 2] = 0; D[o + 3] = 255;
  }
  const t = new THREE.DataTexture(D, N, N); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return NOISE = t;
}
function waterUniforms(world) {
  return { uTime: TIME, tN: { value: noiseTex() }, uSun: { value: world.sunDir }, uSunCol: { value: new THREE.Color(3, 3, 3) },
    uAmb: { value: new THREE.Color(1, 1, 1) }, tFlip: { value: null }, uFlip: { value: 0 } };
}
const FOG_V = '#include <fog_pars_vertex>', FOG_F = '#include <fog_pars_fragment>';
function waterMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), U),
    fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `attribute vec4 aF; attribute float aM;
varying vec2 vUv; varying vec4 vF; varying float vM; varying vec3 vN; varying vec3 vW;
${FOG_V}
void main() {
  vUv = uv; vF = aF; vM = aM; vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.);
  vec3 toC = cameraPosition - w.xyz; float dc = length(toC);
  w.xyz += toC / dc * min(0.25 + dc * 0.012, 24.); // depth bias along the view ray: never sinks into coarse terrain LODs
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `uniform float uTime; uniform sampler2D tN; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uAmb;
varying vec2 vUv; varying vec4 vF; varying float vM; varying vec3 vN; varying vec3 vW;
${FOG_F}
#include <common>
void main() {
  vec3 V = normalize(cameraPosition - vW); vec3 N = normalize(vN); if (dot(N, V) < 0.) N = -N;
  float dist = length(cameraPosition - vW), steep = vF.x, seed = vF.w;
  float spd = mix(1.3, 8.5, steep);
  float n1 = texture2D(tN, vec2(vUv.x / 2.6 + seed, (vUv.y - uTime * spd) / 10.)).r;
  float n2 = texture2D(tN, vec2(vUv.x / 1.1 + seed * .7, (vUv.y - uTime * spd * 1.4) / 3.2)).g;
  float n3 = texture2D(tN, vec2(vUv.x / .45, (vUv.y - uTime * spd * 1.9) / 1.3) + seed).r;
  float n = n1 * .5 + n2 * .32 + n3 * .18;
  float foam, a, edge;
  if (vM < .5) { // falling / running water
    foam = clamp(steep * 1.25 - .25 + (n - .5) * 1.6, 0., 1.);
    foam = max(foam, smoothstep(.6, .78, n) * .55);
    foam = mix(foam, max(foam, steep), smoothstep(250., 900., dist)); // far: a clean bright streak
    edge = 1. - abs(vF.y);
    a = smoothstep(0., .22 + (1. - n) * .45 * (1. - smoothstep(300., 900., dist)), edge) * vF.z;
    a *= mix(.62, .97, max(foam, steep * .7));
  } else if (vM > 1.5) { // wet rock beside a big fall: darker band gives the white streak contrast from afar
    foam = 0.; a = pow(1. - abs(vF.y), 2.) * vF.z * .3;
  } else { // pool: flow outwards from the impact, foam there and at the shore
    float m = vF.x;
    foam = clamp(m * 1.5 + (n - .5) * 1.4, 0., 1.) + smoothstep(.82, .97, vF.y + (n - .5) * .25) * .65 * smoothstep(.45, .7, n);
    foam = clamp(foam, 0., 1.);
    a = smoothstep(1., .9, vF.y) * mix(.8, .95, foam);
  }
  if (vM > .5 && vM < 1.5) N = normalize(N + vec3(n1 - .5, 0., n2 - .5) * .5); // ripples on the pool
  vec3 L = normalize(uSun);
  float dl = max(dot(N, L), 0.);
  vec3 sun = uSunCol * max(L.y * 4., 0.) / max(L.y * 4., 1.); // fades as the sun sets
  vec3 foamLit = vec3(.95, .97, 1.) * (uAmb * 1.6 + sun * (.6 + .6 * dl)) / 3.14159;
  vec3 streak = vec3(.62, .72, .76) * (uAmb * 1.1 + sun * (.3 + .5 * dl)) / 3.14159;
  float fres = .04 + .96 * pow(1. - max(dot(N, V), 0.), 5.);
  vec3 deep = (vM < .5 ? vec3(.06, .14, .15) : vec3(.035, .1, .1)) * (uAmb + sun * dl) / 3.14159;
  vec3 water = mix(deep, uAmb * .16 + sun * .02, fres * .8);
  vec3 H = normalize(L + V); float spec = pow(max(dot(N, H), 0.), 90.) * (1. - foam);
  water += sun * spec * .5;
  vec3 col = mix(water, mix(streak, foamLit, smoothstep(.3, .8, foam + n * .3)), foam);
  // sun sparkle: tiny glints on the moving surface
  float h = fract(sin(dot(floor(vW * 5. + vec3(0., uTime * 6., 0.)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  col += sun * step(.993, h) * pow(max(dot(N, H), 0.), 6.) * .8 * (1. - smoothstep(60., 160., dist));
  if (vM > 1.5) col = vec3(.12, .125, .12) * (uAmb + sun * dl) / 3.14159 + uAmb * fres * .1;
  gl_FragColor = vec4(col, clamp(a, 0., 1.));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
}
function mistMeshOf(list, U, A) {
  if (!list.length) return null;
  if (A?.count && !QS.has('fakeassets')) new THREE.TextureLoader().load(new URL('../../assets/world/fx/gischt_flipbook.png', import.meta.url).href,
    t => { t.colorSpace = THREE.SRGBColorSpace; U.tFlip.value = t; U.uFlip.value = 1; }, undefined, () => {});
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('iP', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap(m => m.slice(0, 3))), 3));
  g.setAttribute('iS', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap(m => m.slice(3, 7))), 4));
  g.instanceCount = list.length;
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), U), fog: true, transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 iP; attribute vec4 iS; uniform float uTime;
varying vec2 vUv; varying float vA; varying float vSeed;
${FOG_V}
void main() {
  float life = fract(uTime * .16 * (.7 + iS.z) + iS.z * 7.13);
  vec3 c = iP + vec3(sin(iS.z * 40. + uTime * .4), life * .55, cos(iS.z * 31. + uTime * .35)) * iS.x * .3;
  float sz = iS.x * (.6 + .7 * life), an = iS.z * 6.28 + uTime * .15 * (iS.z - .5);
  vec2 q = mat2(cos(an), -sin(an), sin(an), cos(an)) * position.xy;
  vec3 rr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c + (rr * q.x + up * q.y) * sz;
  float dc = distance(cameraPosition, c);
  vA = iS.y * sin(3.14159 * life) * smoothstep(iS.w, iS.w * .7, dc) * smoothstep(1.5, 5., dc);
  vUv = position.xy + .5; vSeed = iS.z;
  vec4 mvPosition = viewMatrix * vec4(w, 1.); gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `uniform float uTime; uniform sampler2D tN; uniform sampler2D tFlip; uniform float uFlip; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uAmb;
varying vec2 vUv; varying float vA; varying float vSeed;
${FOG_F}
#include <common>
void main() {
  float a;
  if (uFlip > .5) { float fr = floor(mod(uTime * 12. + vSeed * 15., 15.)); vec2 cell = vec2(mod(fr, 4.), 3. - floor(fr / 4.)); a = texture2D(tFlip, (vUv + cell) / 4.).a; }
  else { float n = texture2D(tN, vUv * .6 + vSeed * 3.7 + vec2(0., -uTime * .05)).r; float d = length(vUv - .5) * 2.; a = smoothstep(1., .15, d + (n - .5) * .9) * (.55 + n * .6); }
  vec3 L = normalize(uSun); vec3 sun = uSunCol * max(L.y * 4., 0.) / max(L.y * 4., 1.);
  vec3 col = vec3(.9, .94, 1.) * (uAmb * 1.3 + sun * .55) / 3.14159;
  gl_FragColor = vec4(col, a * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 3;
  return mesh;
}
