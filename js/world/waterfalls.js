// Waterfalls along the route, found from the terrain: 2-3 big cascades draped down mountain faces (read from far as
// white streaks), small falls over rock steps beside the road, and one right at the road with a water mill.
// Blender models (waterfall/wasserfall_muehle, wasserfall_klein) replace the near procedural ones when present.
// All procedural water is one shader (scrolling streak noise, foam on steep parts, fresnel, sun sparkle) animated
// only through uniforms, so the meshes stay frozen; spray of every fall is one instanced billboard mesh.
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import { ROAD_W, DS, smooth, lerp, rng } from './field.js';
import { TIME } from './terrainmat.js';
import { planks, stone, grassGround } from './tex.js';

const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const G = 9.81;

/** Finds the spots, builds everything, returns { list, update(time, dt, cam) } for the world's _life. */
export function placeWaterfalls(world, A, taken = []) {
  const t0 = performance.now(), f = world.field, L = world.track.length, segs = world.track.segments || [], r = rng(5150);
  const scene = world.scene, falls = [], mist = [], scroll = new Map(); // model water texture -> scroll speed
  const frame = d => { const p = f.at(d), l = Math.hypot(p.tx, p.tz) || 1; return { x: p.x, z: p.z, e: p.e, tx: p.tx / l, tz: p.tz / l }; };
  const spot = (d, off) => { const p = frame(d); return { x: p.x - p.tz * off, z: p.z + p.tx * off }; };
  // ground levelled under the waterfall models: every later height query (tiles, grass, props) sees the pads
  const pads = [], base = f.height;
  if (!f.pads) f.height = function (x, z) {
    let h = base.call(this, x, z);
    for (const q of this.pads) { const dx = x - q.x, dz = z - q.z, d2 = dx * dx + dz * dz; if (d2 >= q.ro * q.ro) continue;
      let w = smooth(q.ro, q.ri, Math.sqrt(d2)); const rd = this.road(x, z); if (rd) w *= smooth(ROAD_W + 1.5, ROAD_W + 5, rd.d); // never lifts the road edge
      h = lerp(h, q.y, w); }
    return h;
  };
  f.pads = pads;
  const H = (x, z) => f.height(x, z);
  const inT = d => !!f.tunnel?.[Math.max(0, Math.round(d / DS))]; // nothing to see from inside a tunnel
  const free = (x, z, rad) => taken.every(c => Math.hypot(c[0] - x, c[1] - z) > c[2] + rad);
  const landSide = d => -((segs.find(s => d >= s.from && d < s.to) || {}).seaSide || -1);
  const straight = (d, w) => { const a = frame(d - w), b = frame(d + w); return a.tx * b.tx + a.tz * b.tz; };
  const onRoad = (x, z, d, min) => { const q = f.road(x, z); return !q || q.d < min || Math.abs(q.i * DS - d) > 80 && q.d < min + 25; };

  // ---------------- spots ----------------
  const big = findBig(f, L, frame, spot, H);
  const near = [];
  for (let d = 500; d < L - 400; d += 100) for (const s of [landSide(d), -landSide(d)]) for (const o of [11, 20, 30]) {
    if (straight(d, 30) < 0.96 || inT(d)) continue;
    const q = spot(d, s * o), h0 = H(q.x, q.z); if (h0 < 1.5) continue;
    const b = spot(d, s * (o + 30)), h1 = H(b.x, b.z); if (h1 < h0 - 0.5) continue;
    if (onRoad(q.x, q.z, d, o - 2) || onRoad(b.x, b.z, d, o + 20)) continue;
    near.push({ d, s, o, x: q.x, z: q.z, rise: h1 - h0, land: s === landSide(d) });
  }
  const used = [...big.map(b => b.d)];
  const far = (d, gap, sm) => used.every((u, i) => Math.abs(u - d) > (sm && i < big.length ? 800 : gap));
  const fits = (n, e) => { if (!e) return true; // model footprint clear of every other road bit
    const p = frame(n.d), nx = -p.tz * n.s, nz = p.tx * n.s, o0 = e === gMill ? 11 : 10;
    for (const x of [-0.5, 0, 0.5]) for (const z of [0.08, 0.5, 1]) { const b = o0 + z * e.size[2], q = f.road(p.x + p.tx * x * e.size[0] + nx * b, p.z + p.tz * x * e.size[0] + nz * b);
      if (!q || q.d < Math.min(b, ROAD_W + 1.5) - 0.5 || Math.abs(q.i * DS - n.d) > 60 && q.d < b + 8) return false; }
    return true; };
  const pickNear = (o, gap, rad, need = 0, e = null, sm = false) => {
    const c = near.filter(n => n.o === o && n.rise >= need && far(n.d, gap, sm) && free(n.x, n.z, rad) && fits(n, e)).sort((a, b) => b.rise + b.land * 4 - a.rise - a.land * 4)[0];
    if (c) used.push(c.d); return c;
  };
  const gMill = A?.find('wasserfall_muehle'), gSmall = A?.find('wasserfall_klein');
  const millSite = pickNear(11, 1500, gMill ? 28 : 14, 0, gMill);
  const cliff = findCliff();
  if (cliff) used.push(cliff.d);
  // small cascades 10-15 m from the road, one every 3-5 km
  const smalls = [];
  for (let d0 = 1200; d0 < L - 800;) {
    const c = near.filter(n => n.o === 11 && n.d >= d0 && n.d < d0 + 1600 && far(n.d, 900, false) && free(n.x, n.z, 12) && fits(n, gSmall))
      .sort((a, b) => b.rise + b.land * 4 - a.rise - a.land * 4)[0];
    if (c) { smalls.push(c); used.push(c.d); d0 = c.d + 3000 + r() * 2000; } else d0 += 1600;
  }

  // ---------------- shared materials ----------------
  const U = waterUniforms(world);
  const wMat = waterMaterial(U);
  const rockMat = world.terrainMat;
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a36, roughness: 0.9, map: planks() }); // flume, posts
  const tar = new THREE.MeshStandardMaterial({ color: 0x5a3c2c, roughness: 0.85, map: wood.map }); // tarred mill walls
  const dark = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.9, map: wood.map });
  const trim = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.8 });
  const sodMap = grassGround(); sodMap.repeat.set(0.35, 0.35);
  const sod = new THREE.MeshStandardMaterial({ color: 0xa8c87a, roughness: 1, map: sodMap });
  const stoneM = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.95, map: stone() });

  const add = (o, mirror) => { if (!mirror) o.traverse(c => c.layers.set(1)); scene.add(o); freeze(o); return o; };
  const fall = (kind, d, side, x, z, range, info) => { const F = { kind, d, side, x, z, range, objs: [], loud: kind === 'big' ? 1 : kind === 'mill' ? 0.8 : 0.5, ...info }; falls.push(F); return F; };

  // ---------------- big cascades on the mountain faces ----------------
  // 4-5 strands that split apart and rejoin over ledges, a soft wet halo, a mist plume, pool and river at the foot
  for (const b of big) {
    const F = fall('big', b.d, b.side, b.mid[0], b.mid[2], 2200, { size: Math.round(b.drop), y: b.mid[1], ahead: b.ahead, shot: b.ahead >= 10 ? b.aheadAt + 60 : b.d - 600 });
    const P = b.path, n = P.length, Wt = (30 + Math.min(28, b.drop / 4.5)) * 1.3, K = b.drop > 90 ? 6 : 5, parts = [];
    const perp = P.map((p, i) => { const A = P[Math.max(0, i - 1)], B = P[Math.min(n - 1, i + 1)], l = Math.hypot(B[0] - A[0], B[2] - A[2]) || 1; return [-(B[2] - A[2]) / l, (B[0] - A[0]) / l]; });
    const along = (off, i) => [P[i][0] + perp[i][0] * off, P[i][1], P[i][2] + perp[i][1] * off];
    parts.push(drapeStrip(P, i => Wt * (0.9 + 0.9 * i / n), 0.35, H, 0, 2)); // wet halo
    const ledges = 2 + Math.floor(r() * 2);
    for (let k = 0; k < K; k++) {
      const base = (k / (K - 1) - 0.5) * (Wt - Wt / K), ph = r() * 6.28, wk = Wt / K * (0.75 + r() * 0.5);
      // spread 0.3 = the strands meet (over a ledge), 1 = fully apart
      const spread = i => { const u = i / (n - 1); return 0.3 + 0.25 * smooth(0.55, 1, u); }; // strands stay together, fan out a little only near the foot (from far, splitting strands read as loops)
      const Pk = P.map((p, i) => along(base * spread(i), i));
      const top = k === 0 || k === K - 1 ? Math.floor(n * (0.1 + r() * 0.2)) : 0; // the outer strands start lower
      parts.push(drapeStrip(Pk.slice(top), i => wk * (1.35 - 0.55 * spread(i + top)) * (0.8 + 0.4 * (i + top) / n), 0.6 + k * 0.03, H, r() * 10, 3));
    }
    // foot: pool if the ground allows, then a river down the valley (never to the road)
    const e = P[n - 1], ey = H(e[0], e[2]);
    let hi = -1e9, lo = 1e9; for (let k = 0; k < 8; k++) { const h = H(e[0] + Math.cos(k * 0.785) * 9, e[2] + Math.sin(k * 0.785) * 9); hi = Math.max(hi, h); lo = Math.min(lo, h); }
    if (hi - lo < 4) parts.push(pool((a, c) => [e[0] + a, e[2] + c], 0, 0, 10, 0, 0, hi + 0.2));
    { const riv = [[e[0], ey, e[2]]]; let x = e[0], z = e[2];
      for (let k = 0; k < 40; k++) { const h0 = H(x, z), gx = (H(x + 4, z) - h0) / 4, gz = (H(x, z + 4) - h0) / 4, sl = Math.hypot(gx, gz) || 1e-3;
        x -= gx / sl * 6; z -= gz / sl * 6; const q = f.road(x, z); if (!q || q.d < 45 || h0 < 0.5) break; riv.push([x, H(x, z), z]); }
      if (riv.length > 4) parts.push(drapeStrip(riv, i => Math.max(3, 7 - i * 0.08), 0.3, H, r() * 10, 0)); }
    const m = new THREE.Mesh(mergeGeometries(parts), wMat); m.renderOrder = 2; add(m, true); F.objs.push(m);
    // mist: a plume at the foot (30-60 m sprites), spray off the ledges further up
    for (let k = 0; k < 14; k++) mist.push([e[0] + (r() - .5) * Wt, ey + 2 + r() * 10, e[2] + (r() - .5) * Wt, 26 + r() * 32, 0.55 + r() * 0.2, r(), 2400]);
    for (let k = 0; k < 8; k++) { const i = Math.floor(n * (0.3 + r() * 0.6)), p = P[i]; mist.push([p[0] + (r() - .5) * Wt * 0.6, H(p[0], p[2]) + 3, p[2] + (r() - .5) * Wt * 0.6, 10 + r() * 12, 0.3, r(), 2000]); }
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
  if (cliff) { // a tall fall off a rock cliff on the outside of a curve: the rider rides straight at it
    const F = fall('cliff', cliff.d, cliff.s, cliff.x, cliff.z, 1600, { size: Math.round(cliff.Hl), ahead: cliff.ahead, shot: cliff.view, off: cliff.off });
    buildStep(F, cliff, { R: 5.5, Hl: cliff.Hl, wf: 3 + r() * 3, cliff: true });
  }
  for (const s of smalls) {
    if (gSmall) { glbFall(gSmall, s, 'small'); continue; }
    const F = fall('small', s.d, s.s, s.x, s.z, 700, { size: 0 });
    const Hl = 5 + r() * 5; F.size = Math.round(Hl);
    buildStep(F, s, { R: 2.4 + r() * 1.2, Hl, wf: 1.3 + r() * 1.6 });
  }

  // ---------------- spray: one instanced billboard mesh for all falls ----------------
  const mistMesh = mistMeshOf(mist, U, A);
  if (mistMesh) { mistMesh.traverse(c => c.layers.set(1)); scene.add(mistMesh); freeze(mistMesh); }

  for (const F of falls) console.info(`RIDEFRAME Wasserfall ${F.kind} d=${Math.round(F.d)} ${F.side > 0 ? 'rechts' : 'links'}${F.off ? ` ${F.off} m neben der Straße` : ''} ${F.size} m${F.glb ? ' (Modell)' : ''}${F.ahead ? ` · ${F.ahead} s geradeaus sichtbar` : ''} · Foto bei at=${Math.round(F.shot ?? F.d - 70)}`);
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
    const p = frame(s.d), nx = s.nx ?? -p.tz * s.s, nz = s.nz ?? p.tx * s.s, tx = nz * s.s, tz = -nx * s.s; // n away from the viewer, t across
    const W = (a, b) => [s.x + tx * a + nx * b, s.z + tz * a + nz * b];
    const R = o.R, bL = R + 0.5, rw = 2.6, aw = R + 1.0; // wheel radius and position (mill)
    let poolY = -1e9; for (let k = 0; k < 9; k++) { const an = k / 8 * 6.283, rr = k === 8 ? 0 : R; const [x, z] = W(Math.cos(an) * rr, Math.sin(an) * rr); poolY = Math.max(poolY, H(x, z)); }
    poolY += 0.12;
    const Hl = o.mill ? Math.max(o.Hl, 2 * rw + 1.2) : o.Hl, lipY = poolY + Hl;
    const half = o.mill ? aw + 2.2 : o.cliff ? 9 + r() * 4 : Math.max(o.wf / 2 + 2.5, 4 + r() * 3); // flat part of the step
    const bk = o.cliff ? 2.2 : 1; // block scale
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
      const env = smooth(half + 4 + f.n2(a / 3, s.d) * 1.5, half - 0.5, Math.abs(a)), back = smooth(bL + 11, bL + 5, b);
      const top = Math.max(g, lipY - 0.5 + (b - bL) * 0.06 + (fr > 0 && fr < 1 ? 0 : f.n3(a / 2.3, b / 2.3) * 0.25 * smooth(0.5, 2, b - bL)));
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
    // angular blocks build the actual step: a front row (notched where the water runs), a row behind, lower ones at
    // the sides stepping down into the slope, boulders at the rim and in the pool
    const blocks = [], chan = a => Math.abs(a) < o.wf / 2 + 0.6 || o.mill && Math.abs(a - aw) < 0.9; // water runs here
    const block = (a, b, y0, y1, w, d, turn = 0) => { const [x, z] = W(a, b); blocks.push(blockGeo(r, w, (y1 - y0) / 1.05, d, x, y0, z, Math.atan2(nx, nz) + turn)); }; // faces bulge 5 %
    for (const row of [0, 1]) for (let a = -half - 1.5; a < half + 1.5;) {
      const w = (2 + r() * 2.2) * bk, ac = a + w / 2, b0 = bL + (row ? 3.6 * bk : 0.2) + r() * 0.3, dd = (3.4 + r() * 2) * bk;
      let top = chan(ac) || chan(a + 0.3) || chan(a + w - 0.3) ? lipY - 0.25 + row * 0.15 : lipY + (r() - 0.35) * 1.3 + row * 0.6;
      top = lerp(top, poolY + 1.2, smooth(half - 1, half + 3, Math.abs(ac)));
      block(ac, b0 + dd / 2, poolY - 1.2, top, w * 1.05, dd, (r() - .5) * 0.25); a += w;
    }
    for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) { const ac = sd * (half + 2 + k * 2.4 + r()), h = (Hl - 1.5) * (1 - k * 0.3) * (0.6 + r() * 0.4);
      block(ac, bL + 1 + r() * 3, poolY - 1, poolY + Math.max(0.8, h), (2 + r() * 1.6) * bk, (2.6 + r() * 2) * bk, r() * 3); }
    const impB0 = bL - 1.5 * Math.sqrt(2 * Hl / G);
    for (let k = 0, tries = 0; k < 3 && tries < 20; tries++) { const an = r() * 6.28, rr = R * (0.35 + r() * 0.4), a = Math.cos(an) * rr, b = Math.sin(an) * rr;
      if (Math.hypot(a, b - impB0) < 1.4 || chan(a) && b > 0) continue; const sz = 0.8 + r() * 0.9;
      block(a, b, poolY - 0.6, poolY + sz * 0.45, sz, sz * (0.8 + r() * 0.4), r() * 3); k++; }
    for (let k = 0; k < 4; k++) { const an = -Math.PI / 2 + (r() - .5) * 2.2, a = Math.cos(an) * (R + 0.5), b = Math.sin(an) * (R + 0.5), sz = 0.6 + r() * 0.7;
      block(a, b, poolY - 0.5, poolY + sz * 0.5, sz, sz, r() * 3); }
    { const bm = new THREE.Mesh(mergeGeometries(blocks), rockMat); bm.castShadow = true; bm.receiveShadow = true; add(bm); F.objs.push(bm); }

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
    for (let k = 0; k < 8; k++) { const [x, z] = W((r() - .5) * o.wf * 1.6, impB + (r() - .5) * 1.6); mist.push([x, poolY + 0.4 + r() * 1.2, z, 2 + r() * 2.5, 0.32, r(), F.range]); }
    if (o.cliff) for (let k = 0; k < 12; k++) { const [x, z] = W((r() - .5) * 10, impB + (r() - .5) * 6); mist.push([x, poolY + 1 + r() * 6, z, 8 + r() * 10, 0.4 + r() * 0.2, r(), F.range]); }

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
      const hw = 7, hd = 5.6, ha = aw + 0.75 + hw / 2, hb = bw + 0.2;
      let gy = 1e9, gyM = -1e9; for (const [da, db] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const [x, z] = W(ha + da * hw / 2, hb + db * hd / 2); const h = H(x, z); gy = Math.min(gy, h); gyM = Math.max(gyM, h); }
      const fl = Math.max(gyM + 0.3, poolY + 0.5), hy = 3.2;
      const ang = Math.atan2(tx, tz), boxAt = (list, w, h, dd, a, b, y, roty = 0) => { const bx = new THREE.BoxGeometry(w, h, dd); bx.rotateY(ang + roty); const [x, z] = W(a, b); bx.translate(x, y, z); list.push(bx); };
      // box axes: local x = across the road (n), local z = along the road (t)
      const stoneG = [], roofG = [], darkG = [], tarG = [], trimG = [], fw = hb - hd / 2; // fw: wall facing the road
      boxAt(stoneG, hd + 0.3, fl - gy + 0.6, hw + 0.3, ha, hb, (fl + gy - 0.6) / 2);
      boxAt(tarG, hd, hy, hw, ha, hb, fl + hy / 2);
      { const sh = new THREE.Shape(); sh.moveTo(-hd / 2, 0); sh.lineTo(0, 1.7); sh.lineTo(hd / 2, 0); sh.lineTo(-hd / 2, 0); // gable walls
        const gg = new THREE.ExtrudeGeometry(sh, { depth: hw, bevelEnabled: false }); gg.translate(0, 0, -hw / 2); gg.rotateY(ang); const [x, z] = W(ha, hb); gg.translate(x, fl + hy, z); tarG.push(gg); }
      for (const da of [-1, 1]) for (const db of [-1, 1]) boxAt(trimG, 0.2, hy, 0.2, ha + da * hw / 2, hb + db * hd / 2, fl + hy / 2); // white corner boards
      boxAt(darkG, 0.14, 2.0, 1.1, ha - 0.9, fw - 0.03, fl + 1.0); boxAt(trimG, 0.1, 2.2, 1.35, ha - 0.9, fw - 0.01, fl + 1.1); // door in a white frame
      for (const da of [-2.5, 1.2, 2.6]) { boxAt(trimG, 0.1, 1.05, 0.95, ha + da, fw - 0.01, fl + 1.95); boxAt(darkG, 0.14, 0.85, 0.75, ha + da, fw - 0.03, fl + 1.95); }
      { const sh = new THREE.Shape(), ov = 0.7, rh = 1.7 * (hd / 2 + ov) / (hd / 2); // turf roof: low pitch, wide eaves, 0.35 m thick sod
        sh.moveTo(-hd / 2 - ov, -0.1); sh.lineTo(0, rh - 0.1); sh.lineTo(hd / 2 + ov, -0.1); sh.lineTo(hd / 2 + ov, 0.25); sh.lineTo(0, rh + 0.25); sh.lineTo(-hd / 2 - ov, 0.25); sh.lineTo(-hd / 2 - ov, -0.1);
        const rg = new THREE.ExtrudeGeometry(sh, { depth: hw + 1.0, bevelEnabled: false }); rg.translate(0, 0, -(hw + 1.0) / 2);
        rg.rotateY(ang); const [x, z] = W(ha, hb); rg.translate(x, fl + hy - 0.1 * 1.7 / (hd / 2) * ov, z); roofG.push(rg);
        for (const dz of [-1, 1]) for (const sd of [-1, 1]) { // barge boards along both gables, crossed at the ridge
          const bb = new THREE.BoxGeometry(Math.hypot(hd / 2 + ov, rh) + 0.6, 0.32, 0.06);
          bb.rotateZ(-sd * Math.atan2(rh, hd / 2 + ov)); bb.translate(sd * (hd / 2 + ov) / 2, rh / 2 + 0.12, dz * (hw / 2 + 0.53));
          bb.rotateY(ang); bb.translate(x, fl + hy, z); darkG.push(bb); } }
      for (const [list, m] of [[woodG, wood], [tarG, tar], [stoneG, stoneM], [roofG, sod], [darkG, dark], [trimG, trim]]) {
        const geo = mergeGeometries(list.map(x => x.index ? x.toNonIndexed() : x)); const ms = new THREE.Mesh(geo, m);
        ms.castShadow = true; ms.receiveShadow = true; add(ms); F.objs.push(ms); }
      taken.push([...W(ha, hb), 6]);
      F.shot = s.d - 55;
    }
    const wm = new THREE.Mesh(mergeGeometries(parts), wMat); wm.renderOrder = 2; add(wm); F.objs.push(wm);
  }

  /** A spot 40-70 m off the road where the road bends: riding into the bend the rider looks straight at it. */
  function findCliff() {
    let best = null;
    for (let d = 800; d < L - 500; d += 50) {
      const a = frame(d), b = frame(d + 250); if (a.tx * b.tx + a.tz * b.tz > 0.93) continue; // needs a bend ahead
      for (const D of [150, 200, 260]) {
        const X = a.x + a.tx * D, Z = a.z + a.tz * D, rr = f.road(X, Z);
        if (!rr || rr.d < 40 || rr.d > 70 || rr.i * DS < d || rr.i * DS > d + D + 150 || H(X, Z) < 2) continue;
        if (!far(rr.i * DS, 1500, true) || !free(X, Z, 26)) continue;
        const nx = a.tx, nz = a.tz, tx = nz, tz = -nx; let ok = true;
        for (const u of [-24, 0, 24]) for (const v of [-9, 0, 12, 24]) { const x = X + tx * u + nx * v, z = Z + tz * u + nz * v, q = f.road(x, z);
          if (!q || q.d < 9 || H(x, z) < 0.8) ok = false; }
        if (!ok) continue;
        let run = 0, longest = 0; // metres of road from which it is straight ahead
        for (let e = d - 250; e < d + D - 50; e += 20) { const q = frame(Math.max(0, e)), dx = X - q.x, dz = Z - q.z, dl = Math.hypot(dx, dz);
          run = dl > 40 && !inT(e) && (dx * q.tx + dz * q.tz) / dl > 0.96 ? run + 20 : 0; longest = Math.max(longest, run); }
        const sc = longest + rr.d * 0.5;
        if (longest >= 60 && (!best || sc > best.sc)) best = { sc, d: rr.i * DS, s: Math.sign(rr.side) || 1, x: X, z: Z, nx, nz, ahead: Math.round(longest / 9), view: d - 120, off: Math.round(rr.d) };
      }
    }
    if (best) { best.Hl = 26 + r() * 14; taken.push([best.x, best.z, 26]); }
    return best;
  }

  /** Blender waterfall: origin at the bottom of the road-side edge, front +Z towards the road. */
  function glbFall(e, s, kind) {
    const p = frame(s.d), nx = -p.tz * s.s, nz = p.tx * s.s, o0 = kind === 'mill' ? 11 : 10; // front edge this far from the road centre
    const { obj } = A.make(e, null, r);
    // which way the model faces: from its middle towards its water and wheel (should be +Z; snapped to an axis)
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj), mc = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const wc = new THREE.Vector3(), tv = new THREE.Vector3(); let nw = 0;
    obj.traverse(c => { if (c.userData.millWheel || /wasserfall_wasser/.test(c.name)) { wc.add(c.getWorldPosition(tv)); nw++; } });
    let fx = 0, fz = 1;
    if (nw) { wc.divideScalar(nw); const dx = wc.x - mc.x, dz = wc.z - mc.z; if (Math.hypot(dx, dz) > 0.08 * Math.max(sz.x, sz.z)) { if (Math.abs(dx) > Math.abs(dz)) { fx = Math.sign(dx); fz = 0; } else fz = Math.sign(dz); } }
    const tl = Math.hypot(p.tx, p.tz) || 1, yaw = 0.62; // turned ~35 deg towards the oncoming rider: the fall is seen from the front while riding up, not only sideways
    const ang = Math.atan2(-nx * Math.cos(yaw) - p.tx / tl * Math.sin(yaw), -nz * Math.cos(yaw) - p.tz / tl * Math.sin(yaw)) - Math.atan2(fx, fz), ca = Math.cos(ang), sa = Math.sin(ang);
    const hf = (Math.abs(fx) * sz.x + Math.abs(fz) * sz.z) / 2, fex = mc.x + fx * hf, fez = mc.z + fz * hf; // front edge middle, model space
    const tx0 = p.x + nx * o0, tz0 = p.z + nz * o0, ox = tx0 - (fex * ca + fez * sa), oz = tz0 - (-fex * sa + fez * ca);
    const cx = ox + mc.x * ca + mc.z * sa, cz = oz - mc.x * sa + mc.z * ca;
    const F = fall(kind, s.d, s.s, cx, cz, kind === 'mill' ? 1100 : 800, { size: Math.round(sz.y), glb: true, off: o0 });
    const y = H(tx0, tz0); // ground at the foot; the footprint is levelled to it
    pads.push({ x: cx, z: cz, y, ri: Math.max(sz.x, sz.z) * 0.6, ro: Math.max(sz.x, sz.z) * 0.6 + 10 });
    obj.position.set(ox, y, oz); obj.rotation.y = ang; obj.updateMatrixWorld(true);
    let nWet = 0;
    obj.traverse(c => {
      c.layers.set(1);
      let wet = null; for (let o = c; o && o !== obj.parent && !wet; o = o.parent) wet = /(wasserfall_wasser|gerinne_wasser|wasserfall_gischt|bach_wasser)/.exec(o.name); // the mesh is often a child of the named node
      if (c.isMesh && (wet || /water|wasser/i.test(c.material?.name || ''))) { // the model's own water material rendered nothing on the Mac: unlit, see-through, its texture kept and scrolled
        c.castShadow = false; c.receiveShadow = false; nWet++;
        const fast = /(wasserfall_wasser|gerinne_wasser)/.test(wet?.[1] || c.material?.name || '');
        c.material = [].concat(c.material || []).map(m0 => { const map = m0?.map || null; if (map) { map.colorSpace = THREE.SRGBColorSpace; map.wrapT = map.wrapS = THREE.RepeatWrapping; scroll.set(map, fast ? 2.0 : 0.5); }
          return new THREE.MeshBasicMaterial({ map, color: map ? 0xffffff : 0xe8f0f2, transparent: true, opacity: fast ? 0.9 : 0.75, depthWrite: false, side: THREE.DoubleSide, fog: true }); });
        if (c.material.length === 1) c.material = c.material[0]; }
      if (c.userData.millWheel) F.glbWheel = c;
      const src = /^gischt_quelle_(unten|mitte|rad)/.exec(c.name);
      if (src) { const w = c.getWorldPosition(new THREE.Vector3()), rad = c.userData.radius_m ?? { unten: 3.5, mitte: 2.5, rad: 1.2 }[src[1]];
        for (let k = 0; k < 8; k++) { const an = r() * 6.28, rr = Math.sqrt(r()) * rad; mist.push([w.x + Math.cos(an) * rr, w.y + r() * rad * 0.4, w.z + Math.sin(an) * rr, 3 + r() * 3, 0.3 + r() * 0.2, r(), 700]); } }
    });
    console.info(`RIDEFRAME Wasserfall-Modell ${kind}: ${nWet} Wasser-Meshes`);
    scene.add(obj); F.objs.push(obj); F.glbObj = obj;
    if (F.glbWheel) { obj.traverse(c => { c.matrixAutoUpdate = c === F.glbWheel; }); } else freeze(obj);
    taken.push([F.x, F.z, Math.max(e.size[0], e.size[2]) * 0.55]);
    // the stream leaves the front edge at x ~ +15 (mill) / +5.7 (small): brook to the road, stone bridge parapets there
    const sx = kind === 'mill' ? 15 : 5.7, ex = obj.localToWorld(new THREE.Vector3(fz ? fex + sx * fz : fex, 0, fz ? fez : fez - sx * fx)), at = f.road(ex.x, ex.z);
    if (at && at.d < 30) {
      const db = at.i * DS, list = [], q = frame(db);
      { const rowsW = [], rx = q.x - q.tz * s.s * (ROAD_W + 0.6), rz = q.z + q.tx * s.s * (ROAD_W + 0.6), n = Math.max(2, Math.ceil(Math.hypot(ex.x - rx, ex.z - rz) / 1.5));
        for (let k = 0; k <= n; k++) { const x = lerp(ex.x, rx, k / n), z = lerp(ex.z, rz, k / n); rowsW.push({ x, z, y: H(x, z) + 0.12, w: 1.5, st: 0.12, fade: 1 }); }
        const wm = new THREE.Mesh(ribbon(rowsW, 1.3), wMat); wm.renderOrder = 2; add(wm); F.objs.push(wm); }
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
// Faces beside the road and faces the road runs straight at; scored by drop, how long the rider sees it ahead, nearness.
function findBig(f, L, frame, spot, H) {
  const grad = (x, z, e) => { const h = H(x, z); return [(H(x + e, z) - h) / e, (H(x, z + e) - h) / e, h]; };
  const side = [], ahead = [];
  const face = (list, d, x, z, px, pz) => {
    const [gx, gz, h] = grad(x, z, 6), sl = Math.hypot(gx, gz);
    if (h < 25 || sl < 0.9) return;
    const tox = px - x, toz = pz - z; if ((-gx * tox - gz * toz) / (sl * Math.hypot(tox, toz)) < 0.3) return; // has to look at the rider
    list.push({ d, x, z, sl });
  };
  for (let d = 400; d < L - 300; d += 200) { const p = frame(d);
    for (const s of [-1, 1]) for (let o = 220; o <= 760; o += 90) { const q = spot(d, s * o); face(side, d, q.x, q.z, p.x, p.z); }
    for (const R of [500, 750, 1000]) for (const an of [-0.18, 0, 0.18]) { // straight ahead
      const c = Math.cos(an), sn = Math.sin(an); face(ahead, d, p.x + (p.tx * c - p.tz * sn) * R, p.z + (p.tz * c + p.tx * sn) * R, p.x, p.z); }
  }
  side.sort((a, b) => b.sl - a.sl); ahead.sort((a, b) => b.sl - a.sl);
  const LOS = (q, m, steps) => { for (let k = 1; k < steps; k++) { const u = k / steps; if (H(lerp(q.x, m[0], u), lerp(q.z, m[2], u)) > lerp(q.e + 1.6, m[1] + 2, u) + 1) return false; } return true; };
  const res = [];
  for (const c of [...ahead.slice(0, 30), ...side.slice(0, 40)]) {
    let x = c.x, z = c.z;
    for (let k = 0; k < 40; k++) { const [gx, gz] = grad(x, z, 4), sl = Math.hypot(gx, gz); if (sl < 0.6) break; x += gx / sl * 4; z += gz / sl * 4; } // up to the lip
    const pts = [[x, H(x, z), z]]; let low = 0, above = -1e9;
    if (res.some(o => Math.hypot(o.pts[0][0] - x, o.pts[0][2] - z) < 60)) continue; // same lip as another candidate
    for (let k = 0; k < 8; k++) above = Math.max(above, H(x + Math.cos(k * 0.785) * 160, z + Math.sin(k * 0.785) * 160));
    if (above < pts[0][1] + 35) continue; // the water needs ground above it: no falls off a summit ridge
    for (let k = 0; k < 150; k++) { // down the fall line (gullies collect it)
      const [gx, gz] = grad(x, z, 4), sl = Math.hypot(gx, gz); if (sl < 1e-3) break;
      x -= gx / sl * 3; z -= gz / sl * 3; const h = H(x, z); pts.push([x, h, z]);
      low = sl < 0.45 ? low + 1 : 0; if (low >= 4 || h < 3 || pts[0][1] - h > 150) break;
    }
    pts.length = Math.max(2, pts.length - Math.max(0, low - 1));
    const drop = pts[0][1] - pts[pts.length - 1][1]; if (drop < 50 || pts.length < 12) continue;
    if (f.real) { let hl = 0; for (let k = 1; k < pts.length; k++) hl += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2]); // real DEM: only true walls, never a low rounded hill
      if (drop < 110 || drop / (hl || 1) < 0.7) continue;
      const t = pts[0], rq = f.road(t[0], t[2]); if (!rq) continue; const q0 = frame(rq.i * DS), bx = t[0] - q0.x, bz = t[2] - q0.z, bl = Math.hypot(bx, bz) || 1;
      let back = -1e9; for (let m = 300; m <= 1500; m += 150) back = Math.max(back, H(t[0] + bx / bl * m, t[2] + bz / bl * m));
      if (back < t[1] + 40) continue; } // seen from the road a mountain must stand behind it, or it hangs against the sky
    const mid = pts[Math.floor(pts.length * 0.4)], rr = f.road(mid[0], mid[2]); if (!rr || rr.d < 150 || rr.d > 1100) continue;
    if (pts.some(p => { const q = f.road(p[0], p[2]); return !q || q.d < 120; })) continue;
    const dn = rr.i * DS, pa = pts[Math.floor(pts.length * 0.2)], e = pts[Math.floor(pts.length * 0.7)], fl = Math.hypot(e[0] - pa[0], e[2] - pa[2]) || 1, fx = (e[0] - pa[0]) / fl, fz = (e[2] - pa[2]) / fl;
    const faces = q => { const dx = q.x - mid[0], dz = q.z - mid[2]; return (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1) > 0.5; }; // not seen edge-on
    let vis = 0, n = 0, aheadM = 0, run = 0, aheadAt = 0;
    for (let dd = -1000; dd <= 0; dd += 125) { n++; const q = frame(Math.max(0, dn + dd)); vis += !f.tunnel?.[Math.round(Math.max(0, dn + dd) / DS)] && faces(q) && LOS(q, mid, 16); } // seen while riding towards it
    // straight ahead: within +-26 deg of the riding direction, not too high in the view, line of sight free
    for (let d = Math.max(0, dn - 1800); d < dn; d += 60) {
      const q = frame(d), dx = mid[0] - q.x, dz = mid[2] - q.z, dl = Math.hypot(dx, dz);
      const ok = !f.tunnel?.[Math.round(d / DS)] && dl < 1300 && (dx * q.tx + dz * q.tz) / dl > 0.9 && (mid[1] - q.e) / dl < 0.4 && faces(q) && LOS(q, mid, 14);
      run = ok ? run + 60 : 0; if (run > aheadM) { aheadM = run; aheadAt = d - run + 60; }
    }
    if (vis / n < 0.35 && aheadM < 180) continue;
    res.push({ d: dn, side: Math.sign(rr.side) || 1, pts, drop, mid, ahead: Math.round(aheadM / 9), aheadAt,
      score: drop * (vis / n + aheadM / 300) * Math.min(2, c.sl) * 600 / (rr.d + 300) });
  }
  // the hero: the longest view straight ahead; then the best of the rest, 5 km apart
  const hero = res.filter(b => b.ahead >= 20).sort((a, b) => b.ahead * b.drop - a.ahead * a.drop)[0];
  const out = hero ? [hero] : [];
  for (const b of res.sort((a, b) => b.score - a.score)) if (out.length < 3 && !out.some(o => Math.abs(o.d - b.d) < 5000)) out.push(b);
  return out.map(b => {
    // smooth the path (descent zigzags in gullies), then the strands follow the surface
    let P = b.pts; for (let it = 0; it < 10; it++) P = P.map((p, i) => i === 0 || i === P.length - 1 ? p : [(P[i - 1][0] + p[0] * 2 + P[i + 1][0]) / 4, 0, (P[i - 1][2] + p[2] * 2 + P[i + 1][2]) / 4]);
    return { ...b, path: P.map(p => [p[0], H(p[0], p[2]), p[2]]) };
  }).sort((a, b) => a.d - b.d);
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
    const wi = typeof w === 'function' ? w(i) : w * (0.55 + 0.6 * u) * (0.85 + 0.3 * Math.sin(i * 0.7 + seed));
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
/** Angular rock block (jittered, chamfered box, flat facets) for the terrain material: bottom at y0, w x h x d, turned by ang. */
function blockGeo(r, w, h, d, x, y0, z, ang) {
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2).toNonIndexed(), p = g.attributes.position, J = new Map();
  for (let i = 0; i < p.count; i++) {
    const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i), k = `${X},${Y},${Z}`;
    if (!J.has(k)) { const c = 1 - 0.2 * (Math.abs(X) + Math.abs(Y) + Math.abs(Z) - 1); J.set(k, [X * c + (r() - .5) * 0.16, Y * c + (r() - .5) * 0.12, Z * c + (r() - .5) * 0.16]); }
    const v = J.get(k); p.setXYZ(i, v[0], v[1], v[2]);
  }
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g.scale(w, h, d); g.rotateY(ang); g.translate(x, y0 + h / 2, z); g.computeVertexNormals();
  const n = p.count, sp = new Float32Array(n * 4), co = new Float32Array(n * 3).fill(0.8 + r() * 0.12);
  for (let i = 0; i < n; i++) sp[i * 4 + 1] = 1;
  g.setAttribute('splat', new THREE.BufferAttribute(sp, 4)); g.setAttribute('color', new THREE.BufferAttribute(co, 3));
  return g;
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
  w.xyz += toC / dc * min(0.25 + dc * 0.008, 12.); // depth bias along the view ray: never sinks into coarse terrain LODs
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
  float big = step(2.5, vM); // strands of the big falls: whiter, brighter, cutting through the haze
  if (vM < .5 || big > .5) { // falling / running water
    foam = clamp(steep * 1.25 - .25 + (n - .5) * 1.6, 0., 1.);
    foam = max(foam, big * clamp(.55 + .45 * steep + (n - .5) * .8, 0., 1.));
    foam = max(foam, smoothstep(.6, .78, n) * .55);
    foam = mix(foam, max(foam, steep), smoothstep(250., 900., dist)); // far: a clean bright streak
    edge = 1. - abs(vF.y);
    a = smoothstep(0., .22 + (1. - n) * .45 * (1. - smoothstep(300., 900., dist)), edge) * vF.z;
    a *= mix(.62, .97, max(foam, steep * .7));
  } else if (vM > 1.5) { // soft wet halo on the rock around a big fall: a little contrast for the white
    foam = 0.; a = exp(-vF.y * vF.y * 3.) * smoothstep(0., 1., vF.z) * .2;
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
  vec3 foamLit = vec3(.95, .97, 1.) * (uAmb * 1.6 + sun * (.6 + .6 * dl)) / 3.14159 * (1. + big * .7);
  vec3 streak = vec3(.62, .72, .76) * (uAmb * 1.1 + sun * (.3 + .5 * dl)) / 3.14159;
  float fres = .04 + .96 * pow(1. - max(dot(N, V), 0.), 5.);
  vec3 deep = (vM < .5 ? vec3(.06, .14, .15) : vec3(.035, .1, .1)) * (uAmb + sun * dl) / 3.14159;
  vec3 water = mix(deep, uAmb * .16 + sun * .02, fres * .8);
  vec3 H = normalize(L + V); float spec = pow(max(dot(N, H), 0.), 90.) * (1. - foam);
  water += sun * spec * .5;
  vec3 col = mix(water, mix(streak, foamLit, smoothstep(.3, .8, foam + n * .3)), foam);
  col *= 1. - big * (.35 * (1. - n) + .25 * abs(vF.y)); // body: brighter crests, shaded edges, never one flat white
  // sun sparkle: tiny glints on the moving surface
  float h = fract(sin(dot(floor(vW * 5. + vec3(0., uTime * 6., 0.)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  col += sun * step(.993, h) * pow(max(dot(N, H), 0.), 6.) * .8 * (1. - smoothstep(60., 160., dist));
  if (vM > 1.5 && vM < 2.5) col = vec3(.1, .105, .1) * (uAmb + sun * dl) / 3.14159;
  gl_FragColor = vec4(col, clamp(a, 0., 1.));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 clear = gl_FragColor.rgb;
  #include <fog_fragment>
  gl_FragColor.rgb = mix(gl_FragColor.rgb, clear, big * .45 * foam); // white water shows through the haze
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
