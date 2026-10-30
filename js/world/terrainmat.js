// Photo-textured terrain: grass / rock / sand / snow blended per vertex ("splat" attribute),
// rock projected tri-planar on steep faces, every layer sampled at two scales against tiling.
// Textures come from assets/tex/<name>_col.jpg / _nrm.jpg (Poly Haven CC0 on the Mac). Missing files fall back to flat.
import * as THREE from 'three';
import { DEM_ROT, DEM_P0, DEM_SIZE } from './field.js';

const loader = new THREE.TextureLoader();
const cache = {}, pending = [];
/** Shared clock for animated terrain details (surf at the shoreline). */
export const TIME = { value: 0 };
/** Resolves when every texture requested so far has loaded (or failed). */
export const texReady = () => Promise.all(pending);
export function tex(name, kind, fallback) {
  const key = name + '_' + kind;
  if (cache[key]) return cache[key];
  let done; pending.push(new Promise(r => done = r));
  const t = loader.load(new URL(`../../assets/tex/${key}.jpg`, import.meta.url).href, () => done(), undefined, () => {
    const c = document.createElement('canvas'); c.width = c.height = 4; const g = c.getContext('2d');
    g.fillStyle = `rgb(${fallback.join(',')})`; g.fillRect(0, 0, 4, 4); t.image = c; t.needsUpdate = true; done(); // missing file: neutral colour
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  t.colorSpace = kind === 'col' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return cache[key] = t;
}

// real colours from above: Sentinel-2 satellite image covering exactly the DEM area (assets/dem/lofoten_s2.jpg, optional)
const SAT = { tex: null, on: { value: 0 } };
function satTex() {
  if (SAT.tex) return SAT.tex;
  let done; pending.push(new Promise(r => done = r));
  SAT.tex = loader.load(new URL('../../assets/dem/lofoten_s2.jpg', import.meta.url).href, () => { SAT.on.value = 1; done(); }, undefined, () => done());
  SAT.tex.colorSpace = THREE.SRGBColorSpace; SAT.tex.flipY = false; // image row 0 = north, like the DEM rows
  SAT.tex.wrapS = SAT.tex.wrapT = THREE.MirroredRepeatWrapping; SAT.tex.anisotropy = 8;
  return SAT.tex;
}
const satRot = new THREE.Vector4(Math.cos(DEM_ROT) / DEM_SIZE, Math.sin(DEM_ROT) / DEM_SIZE, DEM_P0[0], DEM_P0[1]);

/** Material for terrain tiles and the far backdrop. opts.far = discard inside the detailed area. */
export function terrainMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const U = {
    tGrass: { value: tex('grass', 'col', [92, 120, 60]) }, tGrassN: { value: tex('grass', 'nrm', [128, 128, 255]) },
    tRock: { value: tex('rock', 'col', [120, 118, 112]) }, tRockN: { value: tex('rock', 'nrm', [128, 128, 255]) },
    tSand: { value: tex('sand', 'col', [200, 185, 150]) }, tSandN: { value: tex('sand', 'nrm', [128, 128, 255]) },
    uCam: opts.cam || { value: new THREE.Vector2() }, uTime: TIME, uHole: opts.hole || { value: 1780 }, tSat: { value: satTex() }, uSatOn: SAT.on, uSatRot: { value: satRot },
  };
  m.userData.U = U;
  m.customProgramCacheKey = () => 'terrain-' + (opts.far ? 'far' : 'near'); // same onBeforeCompile source, different shader
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = splat;\nvec4 tw = vec4(transformed, 1.); vec3 tn = objectNormal;\n#ifdef USE_INSTANCING\ntw = instanceMatrix * tw; tn = mat3(instanceMatrix) * tn;\n#endif\nvWP = (modelMatrix * tw).xyz;\nvWN = normalize(mat3(modelMatrix) * tn);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vSplat; varying vec3 vWP; varying vec3 vWN;
uniform sampler2D tGrass, tGrassN, tRock, tRockN, tSand, tSandN; uniform vec2 uCam; uniform float uTime; uniform float uHole; uniform sampler2D tSat; uniform float uSatOn; uniform vec4 uSatRot;
vec3 nrmXZ(sampler2D t, vec2 uv) { vec3 n = texture2D(t, uv).xyz * 2. - 1.; return vec3(n.x, n.z, n.y); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
// two scales + a slow noise blend: hides the repeat of every photo texture
vec4 twoScale(sampler2D t, vec2 uv, float a, float b) { float k = vnoise(uv * .07); return mix(texture2D(t, uv / a), texture2D(t, uv / b + .37), .35 + .4 * k); }
`)
      .replace('void main() {', `void main() {
${opts.far ? '  if (distance(vWP.xz, uCam) < uHole) discard;' : ''}`)
      .replace('#include <map_fragment>', `
  vec3 N0 = normalize(vWN);
  vec3 bw = pow(abs(N0), vec3(4.)); bw /= (bw.x + bw.y + bw.z);
  vec4 sp = max(vSplat, 0.); sp /= max(1e-3, sp.x + sp.y + sp.z + sp.w);
  vec3 cG = twoScale(tGrass, vWP.xz, 3.2, 17.).rgb;
  vec3 cS = twoScale(tSand, vWP.xz, 2.6, 13.).rgb;
  vec3 cR = (texture2D(tRock, vWP.zy / 7.).rgb * bw.x + texture2D(tRock, vWP.xz / 7.).rgb * bw.y + texture2D(tRock, vWP.xy / 7.).rgb * bw.z);
  cR = mix(cR, cR * (texture2D(tRock, vWP.xz / 61.).rgb * 1.6), .5);
  cR = mix(vec3(dot(cR, vec3(.299, .587, .114))), cR, .35) * vec3(.93, .98, 1.14); // Lofoten granite is grey: drop the photo's warmth and the meadow tint
  vec3 cW = vec3(.93, .95, .98) * (.9 + .1 * vnoise(vWP.xz * .3));
  vec3 alb = cG * sp.x + cR * sp.y + cS * sp.z + cW * sp.w;
  // satellite colours: decide the large-scale look (green slopes, scree, sand, snow); photo textures keep the close-up structure
  if (uSatOn > .5 && vWP.y > 1.) {
    vec2 suv = vec2(uSatRot.x * vWP.x - uSatRot.y * vWP.z + uSatRot.z, uSatRot.y * vWP.x + uSatRot.x * vWP.z + uSatRot.w);
    vec3 sat = texture2D(tSat, suv).rgb * 1.5;
    float dl = dot(alb, vec3(.299, .587, .114)), dist = length(vWP - cameraPosition);
    vec3 sd = sat * clamp(.55 + dl * 1.6, .6, 1.5); // satellite colour, shaded by the photo texture's detail
    alb = mix(alb, sd, mix(.45, .85, smoothstep(60., 900., dist)) * smoothstep(1., 4., vWP.y));
  }
  // wet dark band + rolling surf where land meets the sea (water plane at y = 0)
  float wl = vWP.y - .12 * sin(uTime * .8 + vWP.x * .05 + vWP.z * .04);
  alb *= mix(1., .62, (1. - smoothstep(.2, 1.4, wl)) * smoothstep(-.6, .1, wl));
  float foam = (1. - smoothstep(.0, .35, abs(wl - .05))) * smoothstep(.35, .7, vnoise(vWP.xz * .9 + uTime * .3) * .6 + vnoise(vWP.xz * .23 - uTime * .1) * .6);
  alb = mix(alb, vec3(.92, .95, .96), foam * .85 * (1. - sp.y * .6));
  diffuseColor.rgb *= alb * 1.25;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * (sp.x * 1. + sp.y * .85 + sp.z * .95 + sp.w * .6);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec3 nG = nrmXZ(tGrassN, vWP.xz / 3.2), nS = nrmXZ(tSandN, vWP.xz / 2.6);
    vec3 rx = texture2D(tRockN, vWP.zy / 7.).xyz * 2. - 1., ry = texture2D(tRockN, vWP.xz / 7.).xyz * 2. - 1., rz = texture2D(tRockN, vWP.xy / 7.).xyz * 2. - 1.;
    vec3 nR = vec3(0., rx.y, rx.x) * bw.x + vec3(ry.x, 0., ry.y) * bw.y + vec3(rz.x, rz.y, 0.) * bw.z; // tangent offsets in world space
    vec3 off = vec3(nG.x, 0., nG.z) * sp.x * .6 + nR * sp.y * 1.2 + vec3(nS.x, 0., nS.z) * sp.z * .5;
    vec3 nW = normalize(N0 + off * (1. - .6 * smoothstep(80., 400., length(vWP - cameraPosition))));
    normal = normalize((viewMatrix * vec4(nW, 0.)).xyz);
  }`);
  };
  return m;
}
