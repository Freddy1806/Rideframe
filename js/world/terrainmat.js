// Photo-textured terrain: grass / rock / sand / snow blended per vertex ("splat" attribute).
// Rock is not one texture but four kinds of Lofoten stone, chosen per large zone (macro noise, slope, height):
//   granitface = light granite walls, gneis = dark banded gneiss, mossrock = flatter rock with moss + lichen,
//   geroell = scree on talus slopes at the foot of walls.
// Each is projected tri-planar, sampled at a near and a rotated far scale (no visible repeat from afar),
// and normalised to a target tone, so any photo (or the fallback) ends up as grey Lofoten stone.
// Textures come from assets/tex/<name>_col.jpg / _nrm.jpg (Poly Haven CC0 / 2K on the Mac).
// A missing stone texture falls back to rock_col/_nrm and the shader adds the look procedurally.
import * as THREE from 'three';
import { DEM_ROT, DEM_P0, DEM_SIZE } from './field.js';

const loader = new THREE.TextureLoader();
const cache = {}, pending = [];
/** Shared clock for animated terrain details (surf at the shoreline). */
export const TIME = { value: 0 };
/** Resolves when every texture requested so far has loaded (or failed). */
export const texReady = () => Promise.all(pending);
const url = key => new URL(`../../assets/tex/${key}.jpg`, import.meta.url).href;
/** Texture assets/tex/<name>_<kind>.jpg. Missing: the image of <alt>_<kind> if given, else a flat fallback colour.
 *  onOk runs when the file itself loaded. */
export function tex(name, kind, fallback, alt, onOk) {
  const key = name + '_' + kind;
  if (cache[key]) return cache[key];
  let done; pending.push(new Promise(r => done = r));
  const flat = () => {
    const c = document.createElement('canvas'); c.width = c.height = 4; const g = c.getContext('2d');
    g.fillStyle = `rgb(${fallback.join(',')})`; g.fillRect(0, 0, 4, 4); t.image = c; t.needsUpdate = true; done();
  };
  const t = loader.load(url(key), () => { onOk?.(); done(); }, undefined, () => {
    if (!alt) return flat();
    loader.load(url(alt + '_' + kind), a => { t.image = a.image; t.needsUpdate = true; done(); }, undefined, flat);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  t.colorSpace = kind === 'col' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return cache[key] = t;
}

// real colours from above: Sentinel-2 satellite image covering exactly the DEM area (assets/dem/lofoten_s2.jpg, optional)
const SAT = { tex: null, file: 'lofoten_s2.jpg', on: { value: 0 } };
function satTex() {
  if (SAT.tex) return SAT.tex;
  let done; pending.push(new Promise(r => done = r));
  SAT.tex = loader.load(new URL('../../assets/dem/' + SAT.file, import.meta.url).href, () => { SAT.on.value = 1; done(); }, undefined, () => done());
  SAT.tex.colorSpace = THREE.SRGBColorSpace; SAT.tex.flipY = false; // image row 0 = north, like the DEM rows
  SAT.tex.wrapS = SAT.tex.wrapT = THREE.MirroredRepeatWrapping; SAT.tex.anisotropy = 8;
  return SAT.tex;
}
const satRot = new THREE.Vector4(Math.cos(DEM_ROT) / DEM_SIZE, Math.sin(DEM_ROT) / DEM_SIZE, DEM_P0[0], DEM_P0[1]);
/** Satellite image + placement for the world about to be built (same frame as its DEM). */
export function useSatellite(dem, file = 'lofoten_s2.jpg') {
  if (dem) satRot.set(Math.cos(dem.rot) / dem.size, Math.sin(dem.rot) / dem.size, dem.p0[0], dem.p0[1]);
  if (file !== SAT.file) { SAT.tex?.dispose(); SAT.tex = null; SAT.file = file; SAT.on.value = 0; }
}

// the four stone kinds; HAS.x..w = 1 once the real photo texture (colour map) is there
const STONES = ['granitface', 'gneis', 'mossrock', 'geroell'];
const HAS = { value: new THREE.Vector4() };
function stoneUniforms() {
  const U = {};
  STONES.forEach((s, i) => {
    U['tR' + i] = { value: tex(s, 'col', [120, 120, 118], 'rock', () => HAS.value.setComponent(i, 1)) };
    U['tR' + i + 'N'] = { value: tex(s, 'nrm', [128, 128, 255], 'rock') };
  });
  return U;
}

// GLSL: helpers (go after #include <common>)
const HELPERS = `
varying vec4 vSplat; varying vec3 vWP; varying vec3 vWN;
uniform sampler2D tGrass, tGrassN, tSand; uniform vec2 uCam; uniform float uTime; uniform float uHole; uniform sampler2D tSat; uniform float uSatOn; uniform vec4 uSatRot;
uniform sampler2D tR0, tR0N, tR1, tR1N, tR2, tR2N, tR3, tR3N; uniform vec4 uRockHas;
vec3 nrmXZ(sampler2D t, vec2 uv) { vec3 n = texture2D(t, uv).xyz * 2. - 1.; return vec3(n.x, n.z, n.y); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
// two scales + a slow noise blend: hides the repeat of every photo texture
vec4 twoScale(sampler2D t, vec2 uv, float a, float b) { float k = vnoise(uv * .07); return mix(texture2D(t, uv / a), texture2D(t, uv / b + .37), .35 + .4 * k); }
// noise stretched along a wall: h.x / h.y = horizontal coordinate for walls facing z / x, blended by t
float wallN(vec2 h, float y, vec2 k, float t) {
  float a = t < .999 ? vnoise(vec2(h.x / k.x, y / k.y)) : 0.;
  float b = t > .001 ? vnoise(vec2(h.y / k.x + 7.7, y / k.y)) : 0.;
  return mix(a, b, t);
}
// cells for scree: x = distance to the cell edge, y = random id of the stone
vec2 stoneCell(vec2 p) {
  vec2 i = floor(p), f = fract(p); float d1 = 9., d2 = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)), c = i + o;
    vec2 r = o + vec2(hash12(c), hash12(c + 17.3)) * .8 + .1 - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash12(c + 5.1); } else if (d < d2) d2 = d;
  }
  return vec2(sqrt(d2) - sqrt(d1), id);
}
// tri-planar sample with explicit gradients (safe inside branches); uv rotated by R, scaled by 1/s, shifted by o
vec3 triCol(sampler2D t, vec3 p, vec3 dx, vec3 dy, vec3 bw, float s, mat2 R, vec2 o) {
  vec3 c = vec3(0.); float k = 1. / s;
  if (bw.x > 0.) c += textureGrad(t, R * p.zy * k + o, R * dx.zy * k, R * dy.zy * k).rgb * bw.x;
  if (bw.y > 0.) c += textureGrad(t, R * p.xz * k + o, R * dx.xz * k, R * dy.xz * k).rgb * bw.y;
  if (bw.z > 0.) c += textureGrad(t, R * p.xy * k + o, R * dx.xy * k, R * dy.xy * k).rgb * bw.z;
  return c;
}
// tri-planar normal map -> tangent offsets in world space (same convention as before)
vec3 triNrm(sampler2D t, vec3 p, vec3 dx, vec3 dy, vec3 bw, float s) {
  vec3 n = vec3(0.); float k = 1. / s;
  if (bw.x > 0.) { vec2 r = textureGrad(t, p.zy * k, dx.zy * k, dy.zy * k).xy * 2. - 1.; n += vec3(0., r.y, r.x) * bw.x; }
  if (bw.y > 0.) { vec2 r = textureGrad(t, p.xz * k, dx.xz * k, dy.xz * k).xy * 2. - 1.; n += vec3(r.x, 0., r.y) * bw.y; }
  if (bw.z > 0.) { vec2 r = textureGrad(t, p.xy * k, dx.xy * k, dy.xy * k).xy * 2. - 1.; n += vec3(r.x, r.y, 0.) * bw.z; }
  return n;
}
// one stone kind: near + rotated far scale, normalised to the texture's own mean (lowest mip) -> pure detail ratio
// returns the detail colour ratio (around 1); adds its normal offset (near only) to nOff
const mat2 ROT1 = mat2(.799, .602, -.602, .799);
const mat2 ROT0 = mat2(1., 0., 0., 1.);
vec3 stoneDetail(sampler2D tc, sampler2D tn, float w, float s, vec3 p, vec3 dx, vec3 dy, vec3 bw, float kFar, float dist, inout vec3 nOff) {
  vec3 mean = max(textureLod(tc, vec2(.5), 12.).rgb, vec3(.02));
  vec3 c = triCol(tc, p, dx, dy, bw, s * 5.7, ROT1, vec2(.31, .73));
  if (kFar < .99) c = mix(triCol(tc, p, dx, dy, bw, s, ROT0, vec2(0.)), c, kFar);
  if (dist < 260.) nOff += triNrm(tn, p, dx, dy, bw, s) * w;
  return 1. + (min(c / mean, vec3(2.2)) - 1.) * .6 * mix(1., .55, smoothstep(120., 600., dist));
}
`;

// GLSL: albedo (replaces #include <map_fragment>)
const ALBEDO = `
  vec3 N0 = normalize(vWN);
  vec3 P = vWP, dPx = dFdx(vWP), dPy = dFdy(vWP);
  float tDist = length(vWP - cameraPosition);
  vec3 bw = pow(abs(N0), vec3(4.)); bw /= (bw.x + bw.y + bw.z); bw = max(bw - .04, 0.); bw /= (bw.x + bw.y + bw.z);
  vec4 sp = max(vSplat, 0.); sp /= max(1e-3, sp.x + sp.y + sp.z + sp.w);
  float up = N0.y;
  // macro fields: whole mountain sides, single slopes, patches
  float mA = vnoise(P.xz / 520.), mB = vnoise(P.xz / 170. + 11.7), mC = vnoise(P.xz / 47. + 3.3);
  float mBright = .82 + .36 * mA * .6 + .36 * mC * .4;
  // horizontal coordinate along a wall (for vertical streaks), wavy so the noise grid never shows
  float bwXZ = smoothstep(-.35, .35, (abs(N0.x) - abs(N0.z)) / (abs(N0.x) + abs(N0.z) + .06));
  float hzW = (vnoise(vec2(P.y / 23., P.x / 31. + P.z / 37.)) - .5) * 9.;
  vec2 hzP = vec2(P.x, P.z) + hzW;
  // ragged rock / grass border: grass tongues into the rock, bare patches into the meadow
  {
    float rn = vnoise(P.xz / 7.) * .6 + mix(vnoise(P.xz / 1.9 + 5.), .5, smoothstep(50., 160., tDist)) * .4;
    float e = clamp(sp.y * (sp.x + .02) * 4., 0., 1.);
    float dy = clamp((rn - .5) * 1.4 * e, -sp.y, sp.x);
    sp.y += dy; sp.x -= dy;
  }
  // snow left in gullies high up
  if (vWP.y > 330.) {
    float gs = smoothstep(.66, .8, wallN(hzP, P.y, vec2(9., 28.), bwXZ) * .65 + vnoise(P.xz / 23.) * .35);
    float hs = smoothstep(380., 620., P.y + (mB - .5) * 160.) * smoothstep(.2, .45, up);
    float s = min(gs * hs, sp.y);
    sp.y -= s; sp.w += s;
  }
  vec3 tint = mix(vec3(1.), vColor, 1. - .8 * (sp.y + sp.w));

  // ---- grass: photo + dry / lush patches + steep-slope olive ----
  vec3 cG = twoScale(tGrass, P.xz, 3.2, 17.).rgb;
  cG = mix(cG, texture2D(tGrass, ROT1 * P.xz / 71. + .5).rgb, .25 * smoothstep(40., 400., tDist));
  float gDry = smoothstep(.5, .85, mB * .55 + mC * .45 + (.85 - up) * .9 + (vnoise(P.xz * .21) - .5) * .25);
  float gLush = 1. - smoothstep(.25, .55, mA * .7 + mC * .3);
  cG *= mix(vec3(1.), vec3(1.16, 1.04, .62), gDry * .8);
  cG *= mix(vec3(1.), vec3(.78, .9, .8), gLush * .6);
  cG = mix(vec3(dot(cG, vec3(.299, .587, .114))), cG, 1.2) * vec3(.94, 1.04, .8) * (.88 + .2 * vnoise(P.xz * .55)) * mix(1., .8 + .4 * mC, smoothstep(60., 500., tDist));

  // ---- sand ----
  vec3 cS = twoScale(tSand, P.xz, 2.6, 13.).rgb;

  // ---- rock: four stone kinds by zone ----
  vec3 cR = vec3(0.), nR = vec3(0.); float rWet = 0.;
  if (sp.y > .002) {
    float flatR = smoothstep(.6, .8, up + (mC - .5) * .14);
    float moist = smoothstep(.4, .68, mB * .6 + mC * .4 + (1. - smoothstep(20., 300., P.y)) * .22);
    float talus = 1. - smoothstep(.86, .95, up + (mC - .5) * .06);
    float zGr = smoothstep(.3, .7, mB * .65 + mA * .35 + (P.y - 300.) / 1500.);
    float w3 = flatR * talus * (1. - moist);
    float w2 = flatR - w3;
    float w0 = (1. - flatR) * zGr, w1 = (1. - flatR) * (1. - zGr);
    float kFar = clamp(.28 + .55 * smoothstep(25., 320., tDist) + (mC - .5) * .3, 0., 1.);
    if (tDist > 700.) kFar = 1.;
    vec3 hasF = vec3(1.);
    // granite: light, cool grey, low contrast
    if (w0 > .01) {
      vec3 d = stoneDetail(tR0, tR0N, w0, 8., P, dPx, dPy, bw, kFar, tDist, nR);
      d = mix(vec3(dot(d, vec3(.333))), d, .35 * uRockHas.x);
      cR += vec3(.52, .53, .54) * mix(vec3(1.), d, mix(.7, .9, uRockHas.x)) * w0;
    }
    // gneiss: dark grey with light and dark bands, tilted and wavy (fine bands fade before they alias)
    if (w1 > .01) {
      vec3 d = stoneDetail(tR1, tR1N, w1, 6., P, dPx, dPy, bw, kFar, tDist, nR);
      d = mix(vec3(dot(d, vec3(.333))), d, .35 * uRockHas.y);
      float ph = P.y + dot(P.xz, vec2(.23, -.17)) + (vnoise(P.xz / 31.) - .5) * 18. + (vnoise(P.xz / 7.) - .5) * 2.5;
      float fw = fwidth(ph);
      float bThick = smoothstep(.4, .95, vnoise(vec2(ph / 13., 3.7))) - .3 * smoothstep(.5, .9, vnoise(vec2(ph / 5., 1.3)));
      float bFine = (vnoise(vec2(ph * 1.3, 8.1)) - .5) * (1. - smoothstep(.15, .7, fw * 1.3));
      float band = 1. + bThick * mix(.55, .3, uRockHas.y) + bFine * mix(.3, .15, uRockHas.y);
      cR += vec3(.25, .255, .265) * band * mix(vec3(1.), d, mix(.85, .95, uRockHas.y)) * w1;
    }
    // moss rock: grey stone, pale lichen rosettes and dark green moss cushions in hollows
    if (w2 > .01) {
      vec3 d = stoneDetail(tR2, tR2N, w2, 5., P, dPx, dPy, bw, kFar, tDist, nR);
      vec3 base = vec3(.32, .325, .32) * mix(vec3(dot(d, vec3(.333))), d, .6 * uRockHas.z);
      float lich = smoothstep(.55, .75, vnoise(P.xz * .9 + 4.) * .6 + mix(vnoise(P.xz * 3.1), .5, smoothstep(25., 70., tDist)) * .4);
      float moss = smoothstep(.45, .7, vnoise(P.xz * .23 + 9.) * .7 + mC * .3) * (1. - smoothstep(1.1, 1.6, dot(d, vec3(.333))));
      float proc = mix(1., .45, uRockHas.z);
      base = mix(base, vec3(.33, .345, .27) * (.8 + .4 * d.g), lich * .7 * proc);
      base = mix(base, vec3(.075, .11, .04) * (.7 + .5 * d.g), moss * .85 * proc);
      cR += base * w2;
    }
    // scree: single stones with dark gaps (close up), plain photo further out
    if (w3 > .01) {
      vec3 d = stoneDetail(tR3, tR3N, w3, 3.5, P, dPx, dPy, bw, kFar, tDist, nR);
      vec3 base = vec3(.38, .382, .385) * mix(vec3(1.), mix(vec3(dot(d, vec3(.333))), d, .4 * uRockHas.w), .85);
      if (tDist < 140.) {
        float k = (1. - smoothstep(60., 140., tDist)) * mix(1., .35, uRockHas.w);
        vec2 sc = stoneCell(P.xz / .9), sc2 = stoneCell(P.xz / 2.6 + 3.);
        float st = mix(.72, 1.25, sc.y) * mix(.45, 1., smoothstep(.0, .14, sc.x)) * mix(.8, 1.1, sc2.y) * mix(.6, 1., smoothstep(.0, .1, sc2.x));
        base *= mix(1., st, k);
      }
      cR += base * w3;
    }
    // large-scale: lighter weathered tops, darker lower walls; lichen veil on steep faces
    cR *= mBright * (.9 + .2 * smoothstep(80., 600., P.y));
    float lv = smoothstep(.5, .8, vnoise(P.xz / 13. + P.y / 20.)) * (1. - flatR) * smoothstep(.2, .55, up);
    cR = mix(cR, cR * vec3(1.15, 1.2, 1.05) + vec3(.03, .035, .02), lv * .5);
    // run-off streaks down steep walls: dark, wet, vertical
    float strk = smoothstep(.6, .85, wallN(hzP, P.y, vec2(7., 60.), bwXZ) * .7 + mix(wallN(hzP, P.y, vec2(1.6, 14.), bwXZ), .5, smoothstep(40., 160., tDist)) * .3) * (1. - flatR) * (1. - smoothstep(.3, .6, up));
    cR *= 1. - .45 * strk;
    rWet = strk;
    // macro crags: ridged noise along the wall at two scales -> lit ledges and dark clefts that still read from afar
    // (photo detail fades out with distance, so big walls were smooth before); breaks up the texture repeat too
    {
      float c1 = 1. - abs(wallN(hzP, P.y, vec2(26., 34.), bwXZ) * 2. - 1.);
      float c2 = 1. - abs(wallN(hzP + 13.1, P.y + 7.7, vec2(9., 12.), bwXZ) * 2. - 1.);
      float crag = c1 * .65 + c2 * .35;
      float kC = (1. - flatR) * mix(.55, 1., smoothstep(40., 300., tDist));
      cR *= mix(1., .62 + .62 * smoothstep(.35, .95, crag), kC);
      cR *= mix(1., .85 + .3 * vnoise(P.xz / 90. + P.y / 140.), .6); // large light/dark patches across a mountain side
    }
    // gullies: vertical ribs in the shading of big walls (seen from afar, where the tiles are coarse)
    if (tDist > 60.) {
      float g0 = wallN(hzP, P.y, vec2(11., 90.), bwXZ), g1 = wallN(hzP + 1.5, P.y, vec2(11., 90.), bwXZ);
      vec3 Th = normalize(vec3(-N0.z, 0., N0.x) + 1e-4);
      nR += Th * (g1 - g0) * 2.6 * (1. - flatR) * smoothstep(60., 220., tDist);
    }
  }
  vec3 cW = vec3(.93, .95, .98) * (.9 + .1 * vnoise(P.xz * .3));
  vec3 alb = (cG * sp.x + cS * sp.z) * tint + cR * sp.y * .45 + cW * sp.w;
  alb *= .94 + .12 * mA;
  // satellite colours: decide the large-scale look (green slopes, scree, sand, snow); photo textures keep the close-up structure
  if (uSatOn > .5 && vWP.y > 1.) {
    vec2 suv = vec2(uSatRot.x * vWP.x - uSatRot.y * vWP.z + uSatRot.z, uSatRot.y * vWP.x + uSatRot.x * vWP.z + uSatRot.w);
    vec3 sat = texture2D(tSat, suv).rgb * 1.5;
    float dl = dot(alb, vec3(.299, .587, .114));
    vec3 sd = sat * clamp(.55 + dl * 1.6, .6, 1.5);
    float sl = dot(sd, vec3(.299, .587, .114)); sd = max(mix(vec3(sl), sd, 1.35) * mix(vec3(1.), vec3(.95, 1.05, .82), sp.x), 0.); // summer meadows: richer green than the hazy satellite pixel
    alb = mix(alb, sd, mix(.45, .85, smoothstep(60., 900., tDist)) * smoothstep(1., 4., vWP.y) * (1. - .4 * sp.y)); // rock keeps more of its own crag structure
  }
  // wet dark band + rolling surf where land meets the sea (water plane at y = 0)
  float wl = vWP.y - .12 * sin(uTime * .8 + vWP.x * .05 + vWP.z * .04);
  alb *= mix(1., .62, (1. - smoothstep(.2, 1.4, wl)) * smoothstep(-.6, .1, wl));
  float foam = (1. - smoothstep(.0, .35, abs(wl - .05))) * smoothstep(.35, .7, vnoise(vWP.xz * .9 + uTime * .3) * .6 + vnoise(vWP.xz * .23 - uTime * .1) * .6);
  alb = mix(alb, vec3(.92, .95, .96), foam * .85 * (1. - sp.y * .6));
  diffuseColor.rgb *= alb * 1.25;`;

/** Material for terrain tiles and the far backdrop. opts.far = discard inside the detailed area. */
export function terrainMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const U = {
    tGrass: { value: tex('grass', 'col', [92, 120, 60]) }, tGrassN: { value: tex('grass', 'nrm', [128, 128, 255]) },
    tSand: { value: tex('sand', 'col', [200, 185, 150]) },
    ...stoneUniforms(), uRockHas: HAS,
    uCam: opts.cam || { value: new THREE.Vector2() }, uTime: TIME, uHole: opts.hole || { value: 1780 }, tSat: { value: satTex() }, uSatOn: SAT.on, uSatRot: { value: satRot },
  };
  m.userData.U = U;
  m.customProgramCacheKey = () => 'terrain2-' + (opts.far ? 'far' : 'near');
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = splat;\nvec4 tw = vec4(transformed, 1.); vec3 tn = objectNormal;\n#ifdef USE_INSTANCING\ntw = instanceMatrix * tw; tn = mat3(instanceMatrix) * tn;\n#endif\nvWP = (modelMatrix * tw).xyz;\nvWN = normalize(mat3(modelMatrix) * tn);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + HELPERS)
      .replace('void main() {', `void main() {
${opts.far ? '  if (distance(vWP.xz, uCam) < uHole) discard;' : ''}`)
      .replace('#include <map_fragment>', ALBEDO)
      // vertex colour = meadow tint, applied above only to grass and sand (grey stone must stay grey)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * (sp.x * 1. + sp.y * mix(.88, .5, rWet) + sp.z * .95 + sp.w * .6);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec3 nG = nrmXZ(tGrassN, vWP.xz / 3.2);
    vec3 off = vec3(nG.x, 0., nG.z) * sp.x * .6 + nR * sp.y * 1.2;
    vec3 nW = normalize(N0 + off * (1. - .6 * smoothstep(80., 400., tDist)));
    normal = normalize((viewMatrix * vec4(nW, 0.)).xyz);
  }`);
  };
  return m;
}
