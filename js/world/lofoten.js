// Real-time 3D world along a designed route (Lofoten coast + medieval villages).
// Same interface as DemoScene/ChapterPlayer: currentTime, playbackRate, play(), pause(), destroy().
import * as THREE from 'three';
import { Sky } from '../../vendor/Sky.js';
import { createNoise2D } from '../../vendor/simplex-noise.js';
import { STEP, distAtTime } from '../track.js';
import { Field, rng, smooth, lerp, ROAD_W, DS, loadDEM } from './field.js';
const DEMS = new Map(); let DEM = null;
/** Load the ground (DEM + satellite image) of a track before new WorldScene(); cached per DEM file. */
export async function prepareWorld(track) {
  const key = track?.dem?.file || 'lofoten';
  if (!DEMS.has(key)) DEMS.set(key, await loadDEM(track?.dem || null));
  DEM = DEMS.get(key); useSatellite(DEM, track?.dem?.sat || 'lofoten_s2.jpg');
  console.info('RIDEFRAME Gelände', key, DEM ? `${DEM.n}² ${(DEM.size / 1000).toFixed(1)} km${DEM.real ? ' echt' : ''}` : 'fehlt');
}
import { asphalt, grassTuft, planks, stone } from './tex.js';
import { terrainMaterial, tex, texReady, TIME, HELL, useSatellite } from './terrainmat.js';
import { Water } from '../../vendor/jsm/objects/Water.js';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import { loadAssets } from './assets.js';
import { Riders } from './riders.js';
import { ROAD_LINES_GLSL } from './roadlines.js';
import { Events } from './events.js';
import { placeWaterfalls } from './waterfalls.js';
import { Siege } from './siege.js';
import { EffectComposer } from '../../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from '../../vendor/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from '../../vendor/jsm/postprocessing/OutputPass.js';
import { clumpGeometry, grassMaterial, grassColor, hellCollapse } from './grass.js';
const ASSETS = await loadAssets();
// group templates from the Mac mini (herds, a band with its audience): [{ name, kind, radius_m, members: [{ file, x, z, rot, anim, phase }] }]
const GROUPS = typeof fetch === 'undefined' ? [] : await fetch(new URL('../../assets/world/gruppen.json', import.meta.url)).then(r => r.ok ? r.json() : []).catch(() => []);

const TILE = 192;             // terrain tile size (m)
const VIEW = 2000;            // tiles kept within this radius
const SUB = STEP / DS;

// ---------------- atmosphere: height fog with sun inscattering (aerial perspective) ----------------
// Replaces three's FogExp2 for every material: haze is thick near the sea and thins out with height (scale height
// FOG_H), so peaks stand out against a hazy shore, and it glows warm towards the sun (like UE's exponential height
// fog with directional inscattering / iq's fog article). Sun direction and glow colour are shared plain objects:
// three copies Vector3/Color uniforms per material, plain {x,y,z} objects stay shared and update every material.
const FOG_SUN = { x: 0, y: 0.05, z: -1 }, FOG_SUNCOL = { x: 0, y: 0, z: 0 }, FOG_H = 420;
let fogInstalled = false;
function installFog() {
  if (fogInstalled) return; fogInstalled = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n  varying float vFogDepth;\n  varying vec3 vFogRay;\n#endif';
  // camera-relative world vector: the view matrix's rotation transposed (camera has no scale)
  C.fog_vertex = '#ifdef USE_FOG\n  vFogDepth = - mvPosition.z;\n  vFogRay = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;\n#endif';
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogSunDir;
  uniform vec3 fogSunCol;
  varying float vFogDepth;
  varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogLen = length( vFogRay );
    vec3 fogRd = vFogRay / max( fogLen, 1e-3 );
    float fogY0 = cameraPosition.y;
    // sea mirror pass: the camera sits below the water, mirror the ray so reflections get the same haze
    if ( fogY0 < 0.0 ) { fogY0 = - fogY0; fogRd.y = - fogRd.y; }
    float fogK = fogRd.y * fogLen / ${FOG_H.toFixed(1)};
    float fogH = exp( - fogY0 / ${FOG_H.toFixed(1)} ) * ( abs( fogK ) > 1e-4 ? ( 1.0 - exp( - fogK ) ) / fogK : 1.0 );
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogLen * fogLen * min( fogH, 1.6 ) );
    float fogS = max( dot( fogRd, fogSunDir ), 0.0 );
    // far islands never wash out to a white cut-out (they read as icebergs): looking into the low sun they stay darker backlit silhouettes
    fogFactor = min( fogFactor * ( 1.0 - 0.25 * pow( fogS, 4.0 ) ), 0.88 - 0.16 * pow( fogS, 2.0 ) ); // a trace of the land's own darker tone always stays
    vec3 fogC = fogColor * ( 1.0 - 0.18 * pow( fogS, 3.0 ) ) + fogSunCol * ( 0.7 * pow( fogS, 5.0 ) + 0.5 * pow( fogS, 40.0 ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogC, fogFactor );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #endif
#endif`;
  const add = u => { if (u && u.fogColor && !u.fogSunDir) { u.fogSunDir = { value: FOG_SUN }; u.fogSunCol = { value: FOG_SUNCOL }; } };
  add(THREE.UniformsLib.fog);
  for (const k in THREE.ShaderLib) add(THREE.ShaderLib[k].uniforms);
}

// ---------------- terrain painting ----------------
// splat = weights for (grass, rock, sand, snow); colour = gentle tint so meadows are not one flat green
const _v = new THREE.Vector3();
// measuring switches for the GPU budget: &noshadow &noreflect &refl=512 &grass=0.5 &whaletest
// walking speed of each model's 'Gehen' clip in m/s (measured on the Mac mini from the foot bones); unknown models 0.86
const STRIDE = { alte_frau: 0.42, maedchen: 0.67, junge: 0.69, kind: 0.68, ritter: 1.0, moench: 0.85 };
const _lbQ = new THREE.Quaternion(), _lbY = new THREE.Vector3(0, 1, 0), _lbZ = new THREE.Vector3(0, 0, 1);
const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams(), GRASS_K = +(QS.get('grass') ?? 1);
const TINT_A = new THREE.Color(1.0, 1.0, 0.95), TINT_B = new THREE.Color(1.12, 1.05, 0.78), TINT_C = new THREE.Color(0.82, 0.9, 0.86), _c = new THREE.Color();
const WET = new THREE.Color(0.55, 0.52, 0.5), SHALLOW = new THREE.Color(0.75, 1.0, 0.95), DEEP = new THREE.Color(0.15, 0.3, 0.33);
function paint(f, x, z, h, ny, col, spl, i) {
  const n = f.n2(x / 60, z / 60), n2 = f.n3(x / 14, z / 14), n3 = f.n1(x / 230, z / 230);
  let rock = Math.max(smooth(0.86, 0.68, ny + n2 * 0.04), smooth(300, 480, h + n * 50) * 0.8);
  rock = Math.max(rock, smooth(0.25, 0.65, n3 * 0.5 + n2 * 0.5) * 0.35 * smooth(40, 120, h)); // rock outcrops in the meadows
  // scree tongues on the talus slopes below the walls (the shader turns rock on 30-45 deg slopes into scree)
  rock = Math.max(rock, smooth(0.93, 0.84, ny + n2 * 0.05) * smooth(0.1, 0.6, n * 0.6 + n2 * 0.4) * 0.75 * smooth(25, 90, h));
  let snow = h > 520 ? smooth(520, 660, h + n * 60) * smooth(0.6, 0.8, ny) : 0;
  let sand = h < 2.4 ? smooth(2.4, 0.9, h + n2 * 0.4) : 0;
  if (h < -0.5) { sand = 1; rock *= 0.3; }
  const grass = Math.max(0, 1 - rock - sand - snow);
  spl[i * 4] = grass; spl[i * 4 + 1] = rock; spl[i * 4 + 2] = sand; spl[i * 4 + 3] = snow;
  _c.copy(TINT_A).lerp(TINT_B, smooth(-0.2, 0.7, n) * 0.7).lerp(TINT_C, smooth(0.1, 0.8, -n3) * 0.5);
  if (h < 0.4) _c.lerp(WET, smooth(0.4, -0.4, h) * 0.8);
  if (h < -1) _c.copy(SHALLOW).lerp(DEEP, smooth(-2, -16, h));
  col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
}

// ---------------- textures ----------------
function detailTex() { // neutral grain multiplied over vertex colours
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
  const img = g.createImageData(s, s), n = createNoise2D(rng(5));
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const a = x / s * Math.PI * 2, b = y / s * Math.PI * 2;
    const v = n(Math.cos(a) * 3, Math.sin(a) * 3 + Math.cos(b) * 3) * .3 + n(Math.cos(a) * 14 + Math.sin(b) * 9, Math.sin(b) * 14) * .25 + (Math.random() - .5) * .25;
    const L = 200 + v * 55, i = (y * s + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, L)); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function waveNormals() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
  const img = g.createImageData(s, s), n = createNoise2D(rng(9));
  const H = (x, y) => { const a = x / s * Math.PI * 2, b = y / s * Math.PI * 2; return n(Math.cos(a) * 2 + Math.sin(b), Math.sin(a) * 2 + Math.cos(b) * 2) + .5 * n(Math.cos(a) * 6, Math.sin(b) * 6 + Math.cos(a)); };
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1);
    const i = (y * s + x) * 4; img.data[i] = 128 + dx * 90; img.data[i + 1] = 128 + dy * 90; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// ---------------- props (simple, replaced by Blender assets later) ----------------
function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, n = createNoise2D(rng(seed)), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.35 * n(v.x * 1.3 + seed, v.z * 1.3) + 0.15 * n(v.y * 3, v.x * 3);
    v.multiplyScalar(k); v.y = v.y > 0 ? v.y * (0.8 + 0.6 * ((seed % 3) / 2)) : v.y * 0.5;
    // facet: snap to planes for a split-granite look
    v.x = Math.round(v.x * 3) / 3 * .4 + v.x * .6;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); return g;
}

function house(kind) {
  // returns a Group in local metres, origin at ground centre
  const g = new THREE.Group();
  const M = (c, r = .85, map) => new THREE.MeshStandardMaterial(map ? { color: c, roughness: r, map } : { color: c, roughness: r });
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  const roof = (w, d, h, y, m) => {
    const s = new THREE.Shape(); s.moveTo(-w / 2 - .4, 0); s.lineTo(0, h); s.lineTo(w / 2 + .4, 0); s.lineTo(-w / 2 - .4, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: d + .8, bevelEnabled: false }); geo.translate(0, y, -(d + .8) / 2);
    const o = new THREE.Mesh(geo, m); o.castShadow = o.receiveShadow = true; g.add(o); return o;
  };
  const wood = planks();
  if (kind === 'rorbu' || kind === 'rorbu2') {
    const red = kind === 'rorbu' ? 0x8e2418 : 0xb8862e;
    for (const [x, z] of [[-2.6, -1.8], [2.6, -1.8], [-2.6, 1.8], [2.6, 1.8], [0, -1.8], [0, 1.8]]) box(.25, 3.2, .25, M(0x2d241d), x, 0.6, z);
    box(6, .2, 4.6, M(0x5b4636, .9, wood), 0, 2.25, 0);
    box(5.6, 3, 4, M(red, .8, wood), 0, 3.85, 0);
    box(1, 1, .08, M(0xf2efe6), -1.2, 4, 2.02); box(1, 1, .08, M(0xf2efe6), 1.2, 4, 2.02); box(.9, 1.9, .08, M(0x3a2a20), 0, 3.3, 2.02);
    roof(5.6, 4, 1.9, 5.35, M(0x4b6b2e, 1)); // turf roof
  } else if (kind === 'stone') {
    box(7, 4.2, 5.5, M(0xa79b86, .95, stone()), 0, 2.1, 0);
    roof(7, 5.5, 3.2, 4.2, M(0x6b4a2c, .9)); // thatch
    box(1, 1, .1, M(0x2a2420), -1.6, 2.6, 2.8); box(1.1, 2.1, .1, M(0x4a3020), 1.2, 1.05, 2.8);
  } else if (kind === 'timber') {
    box(6, 2.6, 5, M(0xb3a58c, .95, stone()), 0, 1.3, 0);
    box(6.4, 2.8, 5.4, M(0xeee3cc, .9), 0, 4, 0);
    for (let x = -3; x <= 3; x += 1.5) box(.18, 2.8, .1, M(0x3b2618), x, 4, 2.72);
    box(6.4, .18, .1, M(0x3b2618), 0, 3.3, 2.72); box(6.4, .18, .1, M(0x3b2618), 0, 5.3, 2.72);
    roof(6.4, 5.4, 3.4, 5.4, M(0x7c3b25, .8));
  } else if (kind === 'church') {
    box(8, 7, 15, M(0xbfb39b, .95, stone()), 0, 3.5, 0);
    roof(8, 15, 4, 7, M(0x3d4048, .7));
    box(4.5, 17, 4.5, M(0xb8ad96, .95, stone()), 0, 8.5, -8.5);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(3.4, 9, 4), M(0x3d4048, .7)); spire.position.set(0, 21.5, -8.5); spire.rotation.y = Math.PI / 4; spire.castShadow = true; g.add(spire);
  } else if (kind === 'castle') {
    const st = M(0x9d9484, .95, stone());
    box(26, 9, 1.8, st, 0, 4.5, -12); box(26, 9, 1.8, st, 0, 4.5, 12); box(1.8, 9, 24, st, -13, 4.5, 0); box(1.8, 9, 24, st, 13, 4.5, 0);
    for (const [x, z] of [[-13, -12], [13, -12], [-13, 12], [13, 12]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 15, 14), st); t.position.set(x, 7.5, z); t.castShadow = true; g.add(t);
      const c = new THREE.Mesh(new THREE.ConeGeometry(3.8, 5, 14), M(0x46342a, .8)); c.position.set(x, 17.5, z); c.castShadow = true; g.add(c);
    }
    box(9, 20, 9, st, 2, 10, 0);
    const flag = box(2.6, 1.6, .05, M(0xff5a1f, .6), 3.6, 23, 0); flag.userData.flag = true;
    box(.12, 4, .12, M(0x222222), 2.2, 22, 0); g.userData.castle = true;
  } else if (kind === 'mill') {
    const st = M(0xb1a690, .95, stone());
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 10, 16), st); tw.position.y = 5; tw.castShadow = true; g.add(tw);
    const c = new THREE.Mesh(new THREE.ConeGeometry(3.2, 3.5, 16), M(0x5a3b28, .9)); c.position.y = 11.7; g.add(c);
    const hub = new THREE.Group(); hub.position.set(0, 9.6, 3.4); g.add(hub); hub.userData.spin = true;
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 8, .08), M(0xe9dfc8, .9, wood)); b.position.y = 4.2; const arm = new THREE.Group(); arm.rotation.z = k * Math.PI / 2; arm.add(b); hub.add(arm); b.castShadow = true; }
  } else if (kind === 'lookout') {
    box(8, 1, 8, M(0x9a9282, .95, stone()), 0, .5, 0);
    for (let k = -3.5; k <= 3.5; k += 1) box(.12, 1, .12, M(0x3a2a20), k, 1.5, 3.9);
    box(8, .1, .12, M(0x3a2a20), 0, 2, 3.9);
    box(.12, 7, .12, M(0x222222), 3, 3.5, -3); const flag = box(2.2, 1.4, .05, M(0xc8102e, .6), 4.1, 6.3, -3); flag.userData.flag = true;
  } else if (kind === 'hjell') { // stockfish rack
    const wd = M(0x6b5848, .95, wood), fish = M(0xb9a37f, .9);
    for (let x = -6; x <= 6; x += 3) { box(.2, 4.2, .2, wd, x, 2.1, -.9); box(.2, 4.2, .2, wd, x, 2.1, .9); }
    box(12.4, .15, .15, wd, 0, 3.9, -.9); box(12.4, .15, .15, wd, 0, 3.9, .9); box(12.4, .15, .15, wd, 0, 3.2, 0);
    const f = new THREE.InstancedMesh(new THREE.BoxGeometry(.16, .9, .05), fish, 64); let k = 0; const m4 = new THREE.Matrix4();
    for (let x = -5.9; x <= 5.9 && k < 64; x += .38) for (const z of [-.9, .9]) if (k < 64) f.setMatrixAt(k++, m4.makeTranslation(x, 3.4, z));
    f.castShadow = true; g.add(f);
  } else if (kind === 'boat') {
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M(0x3e2c20, .8, wood));
    hull.scale.set(1.2, .9, 4.2); hull.position.y = .5; g.add(hull);
    box(.1, 6, .1, M(0x2a2a2a), 0, 3.5, 0); const sail = box(2.6, 3.2, .04, M(0xe8dcc4, .9), 0, 4.2, .1); sail.userData.flag = true;
    g.userData.bob = true;
  }
  return g;
}

// ---------------- scene ----------------
export class WorldScene {
  constructor(canvas, track) {
    this.c = canvas; this.track = track;
    this.currentTime = 0; this.playbackRate = 1; this.paused = true; this.duration = track.time[track.time.length - 1];
    this.field = new Field(track, DEM);
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!track.__shot });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25)); // Retina at 2x costs 4x the pixels; 1.25 is still sharp at riding distance
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 9000); this.camera.layers.enable(1);
    this.streaks = windStreaks(); scene.add(this.streaks);

    // midnight sun low in the north-west, over the sea; it sinks slowly over the ride (see _weather)
    installFog();
    const sky = this.sky = new Sky(); sky.scale.setScalar(8000); scene.add(sky);
    const sun = this.sunDir = sunAt(0);
    const su = sky.material.uniforms;
    // clearer air than before (turbidity 10 made the whole sky milky white): blue overhead, warm only towards the sun
    su.turbidity.value = 4; su.rayleigh.value = 2.6; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.86;
    su.sunPosition.value.copy(sun);
    su.uTime = { value: 0 }; su.uCover = { value: 0.4 }; su.uVeil = { value: 0 }; su.uLow = { value: 0 };
    su.uHell = HELL; // hell: a smoke-red sky
    sky.material.fragmentShader = skyGrade(sky.material.fragmentShader).replace('void main() {', 'uniform float uHell;\nvoid main() {')
      .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( mix( retColor, vec3( .32, .07, .03 ) * ( .55 + .45 * dot( retColor, vec3( .3, .5, .2 ) ) ) + retColor * vec3( .25, .06, .02 ), uHell ), 1.0 );');
    this.sky2 = sky.clone(); this.envScene = new THREE.Scene(); this.envScene.add(this.sky2);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    scene.environmentIntensity = ENV_I;
    scene.fog = new THREE.FogExp2(0xbfc6cd, 0.00042); // a bit more aerial perspective: far ridges step back in layers
    this.clouds = cloudLayer(sun); scene.add(this.clouds);
    this.rain = rainLayer(); scene.add(this.rain); this.rainPlan = planRain(track.length || 40000, QS.has('rain'));
    this.cumulus = cumulusLayer(sun); scene.add(this.cumulus); // thick cumulus heaps (impostors) under the thin fbm deck
    this.sunGlow = sunGlow(); scene.add(this.sunGlow); // fake bloom: soft halo around the low sun, cut by the terrain in front

    const light = this.light = new THREE.DirectionalLight(0xffd8bc, 3.0);
    light.castShadow = !QS.has('noshadow'); light.shadow.mapSize.set(2048, 2048);
    const sc = light.shadow.camera; sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 900;
    light.shadow.camera.layers.enable(1); // layer 1 = seen and shadowed, but not mirrored by the sea
    // smaller normal offset: shadows start at the foot of walls, rocks and posts instead of floating a metre away
    light.shadow.bias = -0.0003; light.shadow.normalBias = 0.3;
    scene.add(light, light.target);
    // strong cool sky fill from above, dim green-grey bounce from below: shadow sides read blue-green, never black;
    // sunlit faces warm (golden-hour contrast)
    this.hemi = new THREE.HemisphereLight(0xb6c4d6, 0x5f6e3a, 1.2); scene.add(this.hemi);

    // materials
    const dt = detailTex(); dt.repeat.set(1, 1);
    this.terrainMat = terrainMaterial();
    this.skirtMat = terrainMaterial(); this.skirtMat.side = THREE.DoubleSide;
    // sea: reflective water with real normal map; slightly see-through so shallow sand turns it turquoise
    const wn = tex('water', 'nrm', [128, 128, 255]);
    this.water = new Water(new THREE.PlaneGeometry(9000, 9000), {
      textureWidth: +(QS.get('refl') || 1024), textureHeight: +(QS.get('refl') || 1024), waterNormals: wn, sunDirection: sun.clone(), sunColor: 0xffb27a,
      waterColor: 0x0b3448, distortionScale: 3.4, fog: true, alpha: 0.86, size: 3.2,
    });
    // real water reflects ~4 % straight down (not 30 %): the sea is no longer a white mirror, the teal body and the
    // turquoise sand under the shallows show through; grazing angles still mirror the mountains
    this.water.material.fragmentShader = this.water.material.fragmentShader
      .replace('vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );', 'vec2 rUv = mirrorCoord.xy / mirrorCoord.w + distortion; vec3 reflectionSample = texture2D( mirrorSampler, clamp( rUv, 0.002, 0.998 ) ).rgb; float rOut = max( max( -rUv.x, rUv.x - 1.0 ), max( -rUv.y, rUv.y - 1.0 ) ); reflectionSample = mix( reflectionSample, vec3( 0.32, 0.38, 0.44 ), smoothstep( -0.04, 0.02, rOut ) ); reflectionSample = mix( reflectionSample, vec3( 0.13, 0.22, 0.3 ), uHigh );') // outside the mirror image: a neutral sky tone, no stretched edge
      .replace('float rf0 = 0.3;', 'float rf0 = 0.04;')
      // sharper, brighter sun glitter: a glittering path on the sea towards the low sun
      .replace('sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5, diffuseLight, specularLight );', 'sunLight( surfaceNormal, eyeDirection, 260.0, 5.0, 0.5, diffuseLight, specularLight );')
      .replace('vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;', 'vec3 scatter = ( 0.35 + 0.65 * max( 0.0, dot( surfaceNormal, eyeDirection ) ) ) * waterColor * 1.15;')
      // deeper sea: the mirrored sky is a touch darker and bluer (rough open water never mirrors the full horizon glare)
      .replace('vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(), ( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight ), reflectance);', 'vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * mix( getShadowMask(), 1.0, uHigh ), ( vec3( 0.03, 0.06, 0.08 ) + reflectionSample * vec3( 0.72, 0.8, 0.86 ) + reflectionSample * specularLight ), reflectance * ( 1.0 - 0.7 * uHigh ));')
      .replace('uniform float alpha;', 'uniform float alpha; uniform float uHigh; uniform float uHell;')
      // hell (Freddy): the sea turns to stone. Black, glassy basalt with glowing cracks that breathe; no blue, no waves
      .replace('gl_FragColor = vec4( outgoingLight, alpha );', `vec3 oc = outgoingLight;
        if ( uHell > 0.002 ) {
          vec2 q = worldPosition.xz * 0.035;
          float c1 = abs( sin( q.x * 1.7 + sin( q.y * 1.3 ) * 2.1 ) * sin( q.y * 1.9 + sin( q.x * 0.9 ) * 2.3 ) );
          float c2 = abs( sin( q.x * 4.3 - q.y * 2.9 + sin( q.y * 3.1 ) ) );
          float crack = smoothstep( 0.07, 0.0, c1 ) + 0.55 * smoothstep( 0.04, 0.0, c2 ) * smoothstep( 0.3, 0.7, c1 );
          float tone = 0.75 + 0.25 * sin( q.x * 7.0 + q.y * 5.0 );
          vec3 rock = vec3( 0.055, 0.04, 0.036 ) * tone + reflectionSample * 0.07;
          vec3 ember = vec3( 1.0, 0.32, 0.06 ) * min( crack, 1.0 ) * ( 0.55 + 0.45 * sin( time * 1.6 + q.x * 3.0 + q.y * 2.0 ) );
          oc = mix( oc, rock + ember * 1.6, uHell );
        }
        gl_FragColor = vec4( oc, alpha );`); // from high up no shadow-map box and no mirror frustum edge on the sea (the bright trapezoid in the flight)
    this.water.material.uniforms.uHigh = { value: 0 }; this.water.material.uniforms.uHell = HELL;
    this.water.material.transparent = true;
    this.water.rotation.x = -Math.PI / 2; this.water.position.y = 0; scene.add(this.water);
    { const wr0 = this.water.onBeforeRender; this.water.onBeforeRender = (...x) => { if (this.water.material.uniforms.uHigh.value < 0.999) wr0.apply(this.water, x); }; } // high in the flight the planar mirror no longer fits the perspective (a sharp bright wedge with an upside-down ridge): no mirror at all up there, and one render pass saved
    if (QS.has('noreflect')) { const wr = this.water.onBeforeRender; let k = 0; this.water.onBeforeRender = (...x) => { if (k++ < 30) wr.apply(this.water, x); }; } // mirror frozen after the first frames


    const at = asphalt(256, 1024, 9, true, false); at.anisotropy = 16; at.repeat.set(1, 1);
    this.roadMat = new THREE.MeshStandardMaterial({ map: at, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    // photo asphalt (assets/tex/asphalt_*) under the painted lines of the procedural texture
    const aC = tex('asphalt', 'col', [128, 128, 130]), aN = tex('asphalt', 'nrm', [128, 128, 255]);
    this.roadBlur = { value: 0 }; // speed blur on the asphalt, strongest right in front of the wheel
    this.roadMat.onBeforeCompile = sh => {
      sh.uniforms.tAsph = { value: aC }; sh.uniforms.tAsphN = { value: aN }; sh.uniforms.uBlur = this.roadBlur; sh.uniforms.uHell = HELL;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tAsph, tAsphN; uniform float uBlur, uHell;' + ROAD_LINES_GLSL)
        .replace('#include <map_fragment>', `
  float bl = uBlur * clamp(6. / max(length(vViewPosition), .5), 0., 1.) * .012;
  vec4 painted = vec4(0.); vec3 asph = vec3(0.);
  for (int i = 0; i < 5; i++) {
    vec2 uvo = vMapUv + vec2(0., (float(i) - 2.) * bl);
    painted += texture2D(map, uvo) * .2;
    vec2 auv = vec2(uvo.x * 6.6, uvo.y * 40.) / 2.5;
    asph += mix(texture2D(tAsph, auv).rgb, texture2D(tAsph, auv * 0.23 + .5).rgb, .35) * .2;
  }
  float line = roadPaint(vMapUv, bl * 160.); // edge lines + centre dashes (roadlines.js), speed blur stretches the dashes
  float aL = max(dot(asph, vec3(.333)), 1e-3); asph = vec3(.14) * (.6 + .4 * clamp(aL / .06, 0., 2.5)) * mix(vec3(1.), asph / aL, .3) * vec3(1.04, 1., .95); // linear space: photo mean ~.06 -> ~.14 (sRGB ~.41), grain kept // light, grippy grey asphalt (albedo ~0.35), not the sun-glared black
  float edge = smoothstep(.0, .06, vMapUv.x) * (1. - smoothstep(.94, 1., vMapUv.x));
  diffuseColor.rgb *= mix(mix(painted.rgb, asph * .95, edge), vec3(.74, .74, .70), line);
  diffuseColor.rgb *= mix(vec3(1.), vec3(.62, .42, .36), uHell); // hell: sooty, warm-dark asphalt instead of the cool grey`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { vec3 an = texture2D(tAsphN, vec2(vMapUv.x * 6.6, vMapUv.y * 40.) / 2.5).xyz * 2. - 1.; normal = normalize(normal + (viewMatrix * vec4(an.x, 0., an.y, 0.)).xyz * .35); }`);
    };
    this.rockGeos = [1, 2, 3, 4].map(rockGeo);
    this.rockMat = terrainMaterial();
    for (const g of this.rockGeos) { const n = g.attributes.position.count; g.setAttribute('splat', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => i % 4 === 1 ? 1 : 0), 4)); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(0.85), 3)); }
    // Blender rocks (photo-scanned look) replace the procedural ones when present; parts keep their local transform
    const rk = ASSETS.rocks.filter(e => !/felswand|schaere|felsnadel/.test(e.file));
    this.rockKinds = rk.length ? rk.map(e => { const parts = []; e.scene.updateMatrixWorld(true);
      e.scene.traverse(o => { if (o.isMesh) parts.push({ geo: o.geometry, mat: o.material, m: o.matrixWorld.clone() }); });
      const k = 1 / Math.max(...e.size); return { parts: parts.map(pt => ({ ...pt, m: new THREE.Matrix4().makeScale(k * 2, k * 2, k * 2).multiply(pt.m) })), h: e.size[1] * k * 2 }; }) : null;
    const tuft = grassTuft(256, 11, false), tuftF = grassTuft(256, 12, true);
    const card = () => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0, .5, 0); const g2 = g.clone().rotateY(Math.PI / 2); return mergeGeos([g, g2]); };
    this.tuftGeo = card();
    this.grassTime = { value: 0 }; this.clumpGeo = clumpGeometry(7, 3); this.clumpMat = grassMaterial(this.grassTime);
    this.tuftMats = [tuft, tuftF].map(t => hellCollapse(new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 })));
    this.shrubGeo = shrubGeometry(); this.shrubMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: leafTex(), alphaTest: 0.3, side: THREE.DoubleSide });
    charred(this.shrubMat, true);

    this.farCam = { value: new THREE.Vector2() };
    this.farHole = { value: 0 }; // far backdrop is cut out only where detailed tiles already stand (none at the start)
    this.farMat = terrainMaterial({ far: true, cam: this.farCam, hole: this.farHole });
    Object.assign(this.farMat, { polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 });
    this.tiles = new Map(); this.queue = []; this.roadChunks = new Map(); this.animated = [];
    this._placeLandmarks();
    { const c = this.scene.children.find(o => o.userData.castle); if (c) this.siege = new Siege(this, c, this.field.road(c.position.x, c.position.z).i * DS); } // the siege at the castle (siege.js)
    this.d = 0; this.camPos = null;
    this.instant = new URLSearchParams(location.search).has('shot');
    // quality steps, lowered automatically while the frame rate stays under 50 fps (a trainer ride needs smooth video):
    // 3 = full, 2 = no ambient occlusion, 1 = render scale 1.0, 0 = sea reflection every 2nd frame + smaller shadow map
    const qp = new URLSearchParams(location.search).get('q');
    // level 3 (ambient occlusion) only on request: it halves the frame rate on an M3 Pro
    this.quality = qp !== null ? +qp : 2; this.autoQ = qp === null; this.fpsT = 0; this.fpsN = 0; this.fpsSince = 0;
    this.useAO = this.quality >= 3 && !new URLSearchParams(location.search).has('noao'); // headless screenshots: build everything, render once
    // sea mirror every 2nd frame (every 3rd on level 0): the ripples hide the one-frame lag
    this.reflEvery = this.quality >= 3 ? 1 : this.quality >= 1 ? 2 : 3;
    { const wr = this.water.onBeforeRender; let k = 0; this.water.onBeforeRender = (...a) => { if (this.instant || k++ % this.reflEvery === 0) wr.apply(this.water, a); }; }
    // loading: tiles build with a bigger per-frame budget until the ground around the start is complete
    this.loading = true; this.ready = new Promise(res => { this._readyRes = res; });
    this.last = performance.now();
    this._loop = this._loop.bind(this); requestAnimationFrame(this._loop);
  }

  play() { this.paused = false; this.events?.sound.resume(); return Promise.resolve(); }
  pause() { this.paused = true; this.events?.sound.pause(); }
  destroy() {
    this._blurEl?.remove();
    this.dead = true; this.events?.sound.destroy();
    this.scene.traverse(o => { o.geometry?.dispose?.(); });
    this.renderer.dispose();
  }

  // ---- road geometry in 500 m chunks ----
  _roadChunk(k) {
    const f = this.field, n = f.n, i0 = k * 200, i1 = Math.min(n - 1, i0 + 200);
    if (i0 >= n - 1) return null;
    const pos = [], uv = [], idx = [];
    for (let i = i0; i <= i1; i++) {
      const rx = -f.tz[i], rz = f.tx[i];
      const y = f.e[i] + 0.04, v = i * DS / 40;
      pos.push(f.x[i] - rx * ROAD_W, y, f.z[i] - rz * ROAD_W, f.x[i] + rx * ROAD_W, y, f.z[i] + rz * ROAD_W);
      uv.push(0, v, 1, v);
      if (i < i1) { const a = (i - i0) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.roadMat); m.receiveShadow = true;
    // guard rail on the sea side of cliffs and on the outside of hairpins
    const posts = [];
    for (let i = i0; i < i1; i += SUB) {
      const cl = f.cliff[i] > 0.5, turn = i >= SUB && i < n - SUB ? Math.atan2(f.tx[i - SUB] * f.tz[i + SUB] - f.tz[i - SUB] * f.tx[i + SUB], f.tx[i - SUB] * f.tx[i + SUB] + f.tz[i - SUB] * f.tz[i + SUB]) / 2 : 0;
      if (cl || Math.abs(turn) > 0.12) {
        const side = cl ? -1 : -Math.sign(turn), rx = -f.tz[i], rz = f.tx[i];
        posts.push([f.x[i] + rx * (ROAD_W + 0.6) * side, f.e[i], f.z[i] + rz * (ROAD_W + 0.6) * side, Math.atan2(f.tx[i], f.tz[i]), i, side]);
      }
    }
    // a lone post or two is not a rail: keep only runs of 3+ consecutive posts on the same side
    const run = posts.filter((pp, k) => { const nb = o => posts[k + o] && Math.abs(posts[k + o][4] - pp[4]) === SUB * Math.abs(o) && posts[k + o][5] === pp[5];
      return (nb(-1) && nb(1)) || (nb(1) && nb(2)) || (nb(-1) && nb(-2)); });
    posts.length = 0; posts.push(...run);
    const grp = new THREE.Group(); grp.add(m);
    if (posts.length) {
      const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(.16, .9, .16), new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: .9 }), posts.length * 2);
      const railGeo = new THREE.BoxGeometry(.06, .22, 1); railGeo.translate(0, 0, .5);
      const rail = new THREE.InstancedMesh(railGeo, new THREE.MeshStandardMaterial({ color: 0x8d9196, roughness: .7, metalness: .3, envMapIntensity: .6 }) /* galvanised, matt: shinier rails turned single segments white in the sky reflection */, posts.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      let nr = 0;
      posts.forEach(([x, y, z, a, i, side], k) => {
        q.setFromAxisAngle(up, a);
        const g = Math.min(y, f.height(x, z)), len = y + .9 - g + .3; // post from below the ground up to rail height
        pm.setMatrixAt(k * 2, m4.compose(p.set(x, g - .3 + len / 2, z), q, s.set(1, len / .9, 1)));
        pm.setMatrixAt(k * 2 + 1, m4.compose(p.set(x, g - .3 + len / 2, z), q, s));
        const nx = posts[k + 1];
        if (nx && nx[4] - i === SUB && nx[5] === side) { // rail to the next post, along the road and its slope
          const v = new THREE.Vector3(nx[0] - x, nx[1] - y, nx[2] - z), L = v.length();
          q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.normalize());
          rail.setMatrixAt(nr++, m4.compose(p.set(x, y + .75, z), q, s.set(1, 1, L)));
        }
      });
      rail.count = nr;
      rail.castShadow = true; grp.add(pm, rail); // posts cast no shadow: at midnight-sun angles they striped the whole road
    }
    return grp;
  }

  // ---- terrain tiles ----
  _tile(tx, tz, res) {
    const f = this.field, N = res, S = TILE / N;
    const g = new THREE.PlaneGeometry(TILE, TILE, N, N); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    const ox = tx * TILE + TILE / 2, oz = tz * TILE + TILE / 2;
    const H = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) + ox, z = p.getZ(i) + oz; H[i] = f.vertexHeight(x, z, S); p.setY(i, H[i]); }
    if (f.tunnelHole) { // drop triangles touching the cut-open slot behind tunnel mouths
      const hole = new Uint8Array(p.count); let any = false;
      for (let i = 0; i < p.count; i++) if (f.holeAt(p.getX(i) + ox, p.getZ(i) + oz)) hole[i] = any = 1;
      if (any) { const ix = g.index.array, keep = []; for (let t = 0; t < ix.length; t += 3) if (!hole[ix[t]] && !hole[ix[t + 1]] && !hole[ix[t + 2]]) keep.push(ix[t], ix[t + 1], ix[t + 2]); g.setIndex(keep); }
    }
    g.computeVertexNormals();
    const nrm = g.attributes.normal, spl = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) paint(f, p.getX(i) + ox, p.getZ(i) + oz, H[i], nrm.getY(i), col, spl, i);
    g.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, this.terrainMat); m.position.set(ox, 0, oz); m.receiveShadow = true; m.castShadow = res >= 96; // only the nearest ring throws terrain shadows
    const skg = skirt(g, N, 1 + S * 0.6); // hides cracks between detail levels
    const grp = new THREE.Group();
    if (res <= 24) { // distant tiles: ground + skirt in one draw call (the far rings are most of the ~340 tiles)
      const one = new THREE.Mesh(mergeGeos([g, skg]), this.skirtMat); one.position.copy(m.position); one.receiveShadow = true; grp.add(one);
    } else { const sk = new THREE.Mesh(skg, this.skirtMat); sk.position.copy(m.position); sk.receiveShadow = true; grp.add(m, sk); }
    if (res >= 48) { const before = grp.children.length; this._scatter(grp, tx, tz, H, N, res >= 96, spl); grp.children.slice(before).forEach(noMirror); }
    return grp;
  }

  _scatter(grp, tx, tz, H, N, near, spl) {
    const f = this.field, r = rng(1000 + tx * 7919 + tz * 104729 & 0x7fffffff || 7);
    const ox = tx * TILE, oz = tz * TILE;
    const hAt = (x, z) => { const u = Math.max(0, Math.min(N, Math.round((x - ox) / TILE * N))), v = Math.max(0, Math.min(N, Math.round((z - oz) / TILE * N))); return H[v * (N + 1) + u]; };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    // rocks: in clusters where the ground turns rocky (slope breaks, outcrops) and along the shore; sunk ~30 % into the ground
    const kinds = this.rockKinds, nk = kinds ? kinds.length : this.rockGeos.length, lists = Array.from({ length: nk }, () => []);
    const vix = (x, z) => Math.max(0, Math.min(N, Math.round((z - oz) / TILE * N))) * (N + 1) + Math.max(0, Math.min(N, Math.round((x - ox) / TILE * N)));
    for (let c = 0; c < 26; c++) {
      const cx = ox + r() * TILE, cz = oz + r() * TILE, ch = hAt(cx, cz), rock = spl[vix(cx, cz) * 4 + 1];
      const shore = ch < 2.5 && ch > -3;
      if (ch < -3 || !(shore || r() < 0.3 + rock * 0.7)) continue;
      const n = 2 + Math.floor(r() * (shore ? 6 : 4)), kind0 = Math.floor(r() * nk);
      for (let k = 0; k < n; k++) {
        const a = r() * 6.28, rad = 1 + r() * (shore ? 9 : 6), x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
        const rd = f.road(x, z); if (!rd) continue;
        const sz = (k === 0 ? 1.4 : 0.5 + r() * r() * 1.3) * (shore ? 1.3 : 1);
        if (rd.d < ROAD_W + 2 + sz * 2.2) continue;
        const kind = (kind0 + (r() < 0.7 ? 0 : 1 + Math.floor(r() * (nk - 1)))) % nk;
        lists[kind].push([x, f.height(x, z) - sz * 0.3 * (kinds ? kinds[kind].h : 1), z, sz, r() * 6.28, (r() - .5) * .3]);
      }
    }
    lists.forEach((list, kind) => { if (!list.length) return;
      const parts = kinds ? kinds[kind].parts : [{ geo: this.rockGeos[kind], mat: this.rockMat, m: new THREE.Matrix4() }];
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach(([x, y, z, sz, a, tilt], k) => { q.setFromEuler(new THREE.Euler(tilt, a, tilt * .7)); m4.compose(p.set(x, y, z), q, s.set(sz * (0.85 + (k % 3) * .15), sz * (0.8 + (k % 2) * .3), sz)); im.setMatrixAt(k, m4.multiply(part.m)); });
        im.castShadow = im.receiveShadow = true; grp.add(im);
      }
    });
    if (!near) return;
    // grass tufts + flowers on gentle green ground near the road
    const vi = (x, z) => Math.max(0, Math.min(N, Math.round((z - oz) / TILE * N))) * (N + 1) + Math.max(0, Math.min(N, Math.round((x - ox) / TILE * N)));
    // dense grass carpet along the road: spawned from the road samples inside this tile (≈3 clumps/m² up to 16 m, thinner to 70 m)
    const gl = [], col = new THREE.Color(), inT = (x, z) => x >= ox && x < ox + TILE && z >= oz && z < oz + TILE;
    const bands = [[ROAD_W + 0.5, 16, 4.0 * GRASS_K], [16, 35, 1.0 * GRASS_K], [35, 70, 0.25 * GRASS_K]];
    for (const j of f._query(f.fine, ox + TILE / 2, oz + TILE / 2, TILE)) {
      if (!inT(f.x[j], f.z[j])) continue;
      const tx = f.tx[j], tz = f.tz[j];
      for (const [d0, d1, dens] of bands) {
        const n = Math.round(10 * (d1 - d0) * 2 * dens);
        for (let k = 0; k < n; k++) {
          const side = r() < 0.5 ? -1 : 1, off = d0 + r() * (d1 - d0), al = (r() - 0.5) * 10;
          const x = f.x[j] + tx * al - tz * off * side, z = f.z[j] + tz * al + tx * off * side;
          if (inT(x, z) && spl[vi(x, z) * 4] < 0.5 + r() * 0.3) continue;
          const rd = f.road(x, z); if (!rd || rd.d < ROAD_W + 0.5) continue;
          const h = f.height(x, z); if (h < 2.2 || h > 500 + f.n2(x / 60, z / 60) * 60) continue; // no green tufts in the snow (Himmelsleiter)
          const patch = f.n2(x / 23, z / 23) * 0.5 + 0.5; // meadows are patchy: dense clumps, thin spots
          if (rd.d > ROAD_W + 2 && r() > 0.2 + 1.1 * patch) continue;
          const verge = rd.d < ROAD_W + 1.8; // mown strip next to the asphalt
          gl.push([x, h - 0.03, z, verge ? 0.12 + r() * 0.1 : 0.2 + r() * 0.3 + 0.25 * patch * patch, r() * 6.28, patch]);
        }
      }
    }
    if (gl.length) {
      const im = new THREE.InstancedMesh(this.clumpGeo, this.clumpMat, gl.length);
      const dry = new THREE.Color(0.6, 0.56, 0.25);
      gl.forEach(([x, y, z, sz, a, patch], k) => { im.setMatrixAt(k, m4.compose(p.set(x, y, z), q.setFromAxisAngle(up, a), s.set(sz * (0.8 + 0.4 * r()), sz, sz))); im.setColorAt(k, grassColor(r, col).lerp(dry, Math.max(0, 0.45 - patch) * 0.8)); });
      im.receiveShadow = true; im.layers.set(1); grp.add(im); // layer 1: skipped by the sea reflection
    }
    // a few flower tufts for colour
    const fl = [];
    for (let k = 0; k < 260; k++) {
      const x = ox + r() * TILE, z = oz + r() * TILE, i = vi(x, z);
      if (spl[i * 4] < 0.7 || H[i] < 2.4) continue;
      const rd = f.road(x, z); if (!rd || rd.d < ROAD_W + 1.6 || rd.d > 50) continue;
      fl.push([x, H[i] - .05, z, .3 + r() * .3, r() * 6.28]);
    }
    if (fl.length) {
      const im = new THREE.InstancedMesh(this.tuftGeo, this.tuftMats[1], fl.length);
      fl.forEach(([x, y, z, sz, a], k) => im.setMatrixAt(k, m4.compose(p.set(x, y, z), q.setFromAxisAngle(up, a), s.set(sz * 1.4, sz, sz * 1.4))));
      grp.add(im);
    }
    // low shrubs (willow, juniper, crowberry heaps) in loose groups along the verge: one instanced draw per tile,
    // never on the asphalt or the mown strip, only on green ground above the shore
    const sb = [];
    for (let k = 0; k < 420; k++) {
      const x = ox + r() * TILE, z = oz + r() * TILE, i = vi(x, z);
      if (spl[i * 4] < 0.6 || H[i] < 2.6) continue;
      const rd = f.road(x, z); if (!rd || rd.d < ROAD_W + 3 || rd.d > 60) continue;
      if (f.n2(x / 31, z / 31) * 0.5 + 0.5 < 0.45 + r() * 0.3) continue; // in patches, open meadow between them
      const sz = 0.55 + r() * r() * 1.3, h0 = f.height(x, z);
      if (Math.hypot(f.height(x + 2, z) - h0, f.height(x, z + 2) - h0) / 2 > 0.45) continue; // not on steep rock faces
      if (rd.d < ROAD_W + 3 + sz * 1.3) continue;
      sb.push([x, f.height(x, z) - 0.1 * sz, z, sz, r() * 6.28]);
    }
    if (sb.length) {
      const im = new THREE.InstancedMesh(this.shrubGeo, this.shrubMat, sb.length), c0 = new THREE.Color();
      sb.forEach(([x, y, z, sz, a], k) => {
        im.setMatrixAt(k, m4.compose(p.set(x, y, z), q.setFromAxisAngle(up, a), s.set(sz * (0.9 + 0.4 * r()), sz * (0.95 + 0.5 * r()), sz)));
        const t = r(); im.setColorAt(k, c0.setRGB(0.8 + 0.5 * t, 0.9 + 0.25 * t, 0.6 + 0.2 * r())); // some fresh green willow, some yellowish
      });
      im.receiveShadow = true; im.layers.set(1); grp.add(im);
    }
  }

  // ---- villages, harbour, landmarks at the climb tops ----
  _placeLandmarks() {
    this.props = []; this.mixers = []; this.birds = []; this.whales = []; this.wheels = [];
    this._bridges(); this._tunnels();
    if (ASSETS.count) return this._placeAssets();
    const f = this.field, t = this.track, r = rng(4242), segs = t.segments || [];
    const put = (kind, i, side, off, rot = 0, yOff = 0) => {
      i = Math.max(0, Math.min(f.n - 1, Math.round(i * SUB)));
      const rx = -f.tz[i], rz = f.tx[i];
      const wet = kind === 'rorbu' || kind === 'rorbu2' || kind === 'boat';
      if (wet) { // walk out from the road until we reach the waterline (h < 1)
        let o = off; while (o < 120 && f.height(f.x[i] + rx * side * o, f.z[i] + rz * side * o) > (kind === 'boat' ? -1.5 : 0.8)) o += 3;
        if (o >= 120) return null; off = o + (kind === 'boat' ? 6 : 1);
      }
      const x = f.x[i] + rx * side * off, z = f.z[i] + rz * side * off;
      const RAD = { rorbu: 3.8, rorbu2: 3.8, stone: 4.6, timber: 4.4, church: 9.5, castle: 18, mill: 4.2, lookout: 5.8, hjell: 6.6, boat: 4.6 }[kind] || 5;
      const rr = f.road(x, z); if (!rr || rr.d - RAD < ROAD_W + 1.5) return null; // never on or over any part of the road
      const y = wet || kind === 'hjell' ? Math.max(0, f.height(x, z)) : f.height(x, z);
      const o = house(kind); o.position.set(x, y + yOff - (kind.startsWith('rorbu') ? 0.6 : 0.15), z);
      o.rotation.y = Math.atan2(f.tx[i], f.tz[i]) + (side < 0 ? Math.PI : 0) + rot;
      this.scene.add(o); o.traverse(c => { if (c.userData.spin || c.userData.flag || c.userData.bob) this.animated.push(c); });
      if (o.userData.bob) this.animated.push(o);
      return o;
    };
    for (const s of segs) {
      const i0 = Math.round(s.from / STEP), i1 = Math.round(s.to / STEP), len = i1 - i0;
      if (s.village) {
        const a = i0 + Math.round(len * s.village[0]), b = i0 + Math.round(len * s.village[1]);
        for (let i = a; i < b; i += 4 + Math.floor(r() * 4)) {
          if (r() < 0.7) put(r() < 0.75 ? 'rorbu' : 'rorbu2', i, -1, 12, (r() - .5) * .2);
          if (r() < 0.3) put('boat', i + 2, -1, 14, r() * 3);
          if (r() < 0.55) put(r() < 0.5 ? 'stone' : 'timber', i, 1, 12 + r() * 8, (r() - .5) * .3);
        }
        put('hjell', a + 3, 1, 14, 0.2);
        if (s === segs[0]) put('church', b - 6, 1, 22, 0.1);
      }
      if (s.land === 'coast' && !s.village) for (let i = i0; i < i1; i += 30 + Math.floor(r() * 40)) {
        if (r() < 0.5) put('rorbu', i, -1, 12, (r() - .5) * .3);
        if (r() < 0.25) put('hjell', i + 5, 1, 12 + r() * 6, r());
      }
      if (s.top) {
        const i = i1 + 4;
        if (s.top === 'church') put('church', i, 1, 24, 0.2);
        if (s.top === 'mill') put('mill', i, 1, 18, 0.5);
        if (s.top === 'castle') put('castle', i + 3, 1, 34, 0.1);
        if (s.top === 'lookout') put('lookout', i, -1, 12, 0);
      }
    }
    this.falls = placeWaterfalls(this, null, []);
  }

  // ---- Blender assets along the route: villages with market, harbour life, animals, birds, whales, rock walls ----
  _placeAssets() {
    const f = this.field, t = this.track, r = rng(9001), segs = t.segments || [], A = ASSETS;
    const taken = []; // footprint circles, so nothing overlaps
    const free = (x, z, rad) => taken.every(c => Math.hypot(c[0] - x, c[1] - z) > c[2] + rad);
    // world position at track distance d, lateral offset off (+ right, - left / sea side)
    const spot = (d, off) => { const p = f.at(d), l = Math.hypot(p.tx, p.tz) || 1; return { x: p.x - p.tz / l * off, z: p.z + p.tx / l * off, tx: p.tx / l, tz: p.tz / l }; };
    const waterline = (d, side, start, level = 0.6) => { // first offset beyond `start` where the ground is below `level`
      for (let o = start; o < 160; o += 2) { const q = spot(d, side * o); if (f.height(q.x, q.z) < level) return o; } return null; };
    /** place asset e at distance d / offset off; face: 'road' (front towards the road), 'away', 'along' or an angle */
    const place = (e, d, off, o = {}) => {
      if (!e) return null;
      if (segAt(d).seaSide === 1) off = -off; // real roads with the sea on the right: the whole layout mirrors
      const q = spot(d, off), rad = Math.max(e.size[0], e.size[2]) / 2 * (o.radK ?? 0.85);
      const rd = f.road(q.x, q.z);
      if (!rd || rd.d - rad < ROAD_W + (o.gap ?? 1.2)) return null; // never on the road
      if (!o.overlap && !free(q.x, q.z, rad)) return null;
      if (o.water && /boot/.test(e.file)) { // boats: deep water under the whole hull (never into a rock or a shore) and never under a bridge
        const R = Math.max(e.size[0], e.size[2]) / 2 + 1.5;
        for (let k = 0; k < 8; k++) if (f.height(q.x + Math.cos(k * 0.785) * R, q.z + Math.sin(k * 0.785) * R) > -0.8) return null;
        if (f.height(q.x, q.z) > -0.8 || (t.dem?.bridges || []).some(([a, b]) => d > a - 60 && d < b + 60)) return null;
      }
      const side = Math.sign(off) || 1;
      let ang = o.face === 'away' ? Math.atan2(side * -q.tz, side * q.tx) : o.face === 'along' ? Math.atan2(q.tx, q.tz)
        : typeof o.face === 'number' ? o.face : Math.atan2(-side * -q.tz, -side * q.tx);
      ang += o.rotT != null ? -side * o.rotT : (o.rot || 0); // rotT: a turn in a group template's frame (x along, +z towards the road), mirrored by side
      let y;
      if (o.water) y = o.y ?? 0;
      else { // lowest ground under the footprint, so nothing floats
        const y0 = f.height(q.x, q.z), k = Math.max(rad * 0.6, 0.8); let lo = y0, hi = y0;
        for (const [a, b] of [[k, 0], [-k, 0], [0, k], [0, -k]]) { const h = f.height(q.x + a, q.z + b); lo = Math.min(lo, h); hi = Math.max(hi, h); }
        // farm animals, hay and yard things need level ground (Mac mini QA: cows "stacked" on a cliff, a haystack hanging over a snow slope)
        if ((o.flat ?? (/^animal_land/.test(e.category || '') || /heuhaufen|schubkarre|holzstapel|viehtraenke|waescheleine|katze|dorfbrunnen/.test(e.file))) && hi - lo > Math.max(1.2, k * 0.9)) return null;
        y = rad < 1.5 ? Math.max(lo, y0 - 0.4) : lo; // lowest ground under the footprint, so nothing floats; small figures never sink into a steep bank (anglers were buried 5-10 m)
        y += o.dy || 0;
      }
      const { obj, mixer } = A.make(e, o.anim, r);
      obj.position.set(q.x, y, q.z); obj.rotation.y = ang; obj.userData.small = Math.max(...e.size) < 3; obj.userData.mid = Math.max(...e.size) < 9; if (e.category.startsWith('figure')) { obj.userData.person = true; obj.userData.h = e.size[1]; } if (e.category === 'figure_music') obj.userData.musician = true; if (e.file.includes('schaf')) obj.userData.sheep = true; if (Array.isArray(o.scale)) obj.scale.set(...o.scale); else if (o.scale) obj.scale.setScalar(o.scale);
      this.scene.add(obj); taken.push([q.x, q.z, rad]);
      this.props.push(obj); if (mixer) { mixer.obj = obj; this.mixers.push(mixer); }
      obj.traverse(c => { if (c.userData.millWheel) this.wheels.push(c); });
      return obj;
    };
    const pick = (cat) => A.pick(cat, r), byName = part => A.find(part);
    /** a group template at d, centre offset off (local x along the road, local +z towards the road); members whose variant
     *  is not loaded this ride fall back to their base model. Returns how many members stood. */
    const placeGroup = (g, d, off) => {
      if (!g) return 0; let n = 0; const side = Math.sign(off) || 1, R = g.radius_m || 6;
      const c = spot(d, segAt(d).seaSide === 1 ? -off : off); if (!free(c.x, c.z, R)) return 0; // the whole group needs free ground (no house, stall, fence)
      for (const m of g.members || []) {
        const stem = m.file.split('/').pop().replace(/\.glb$/, '');
        const e = A.list.find(x => x.file.endsWith(m.file)) || A.find(stem.replace(/_v\d+$/, '')); if (!e) continue;
        if (place(e, d + m.x, off - side * m.z, { rotT: m.rot, anim: m.anim, overlap: true, radK: Math.max(...e.size) > 2 ? 0.85 : 0.3, gap: 1 })) n++;
      }
      if (n) taken.push([c.x, c.z, R]); return n;
    };
    const groupOf = kind => { const l = GROUPS.filter(g => g.kind === kind); return l.length ? l[Math.floor(r() * l.length)] : null; };
    let bandDone = false, villageNo = 0; this.villageThemes = [];
    const festSeg = segs.filter(s => s.village).sort((p, q) => (q.to - q.from) * (q.village[1] - q.village[0]) - (p.to - p.from) * (p.village[1] - p.village[0]))[0];
    const segAt = d => segs.find(s => d >= s.from && d < s.to) || segs[segs.length - 1];

    for (const s of segs) {
      const L = s.to - s.from;
      // ---- villages: houses, harbour, market square, musicians, people ----
      if (s.village) {
        const a = s.from + L * s.village[0], b = s.from + L * s.village[1], mid = (a + b) / 2;
        // market square in the middle of the village (land side)
        const stalls = (A.by.stall || []).filter(e => !/verpflegungsstand/.test(e.file)); // the feed station belongs on the tops, not in the market
        for (let k = 0; k < Math.min(5, stalls.length); k++) {
          const d = mid - 18 + k * 8;
          if (place(stalls[(k + Math.floor(r() * 9)) % stalls.length], d, ROAD_W + 4.2, { gap: 0.6 })) {
            place(k % 2 ? byName('haendler') : byName('fischerin'), d + 1.2, ROAD_W + 2.4, { gap: 0.4, radK: 0.5, anim: k % 2 ? 'Rufen' : 'Stehen' });
          }
        }
        const well = A.list.find(e => /marktbrunnen/.test(e.file)) || byName('brunnen');
        if (place(well, mid + 26, ROAD_W + 6, { face: 'road', anim: 'Fliessen' })) place(byName('magd_eimer'), mid + 22.5, ROAD_W + 3.4, { gap: 0.4, radK: 0.4, anim: 'Stehen', face: 'road' }); // at the well a maid with her bucket
        if (s === festSeg || r() < 0.4) place(byName(r() < 0.5 ? 'koenigsstandbild' : 'reiterstandbild') || byName('reiterstandbild'), mid + 46, ROAD_W + 7.5, { face: 'road' }); // the market square's statue: the king or the knight
        place(byName('faesser_kisten'), mid - 25, ROAD_W + 4, { face: 'road' });
        place(byName('marktstand_obst'), mid - 34, ROAD_W + 4.2, { face: 'road', gap: 0.6 }); // the MacBook's fruit stall
        { const dw = byName('dorfbrunnen'); if (dw) for (let k = 0; k < 8 && !place(dw, a + 30 + k * 23, (k % 2 ? -1 : 1) * (ROAD_W + 4.5), { face: 'road', gap: 0.8, radK: 0.5 }); k++); } // a small pump well near the village edge: first free spot
        for (let k = 0, cat = byName('katze'); cat && k < 2; k++) place(cat, a + (b - a) * (0.25 + 0.5 * r()), ROAD_W + 1.1, { face: r() * 6.28, anim: 'Schlafen', gap: 0.3, radK: 0.3 }); // cats asleep right at the kerb (further back they vanished in the grass)
        place(byName('kutsche'), mid + 34, ROAD_W + 7.5, { face: 'along' }); // a little back from the asphalt: it filled the picture
        place(byName('pferd'), mid + 41, ROAD_W + 7.5, { face: 'along', anim: 'Stehen' });
        // musicians in a half circle behind the market
        const mus = A.by.figure_music || [];
        mus.forEach((e, k) => place(e, mid - 8 + k * 2.3, ROAD_W + 9 + (k % 2) * 0.8, { radK: 0.45, anim: 'Spielen', gap: 3 }));
        place(byName('fahne_dorf'), mid - 30, ROAD_W + 3, { gap: 0.5 });
        place(byName('fahne_wimpel'), mid + 30, ROAD_W + 3, { gap: 0.5 });
        // shops around the square (the MacBook's bakery, smithy, inn, butcher; signs swing), the smith hammering outside
        ['baeckerei', 'schmiede', 'gasthaus', 'metzgerei'].map(byName).forEach((e, k) => { if (!e) return;
          const dd = mid + (k % 2 ? 1 : -1) * (58 + Math.floor(k / 2) * 24), h = place(e, dd, ROAD_W + 6 + Math.max(...e.size) / 2, { face: 'road', anim: 'Schwingen', gap: 3 });
          if (h && /schmiede/.test(e.file)) place(byName('schmied'), dd + 3, ROAD_W + 3.2, { face: 'road', anim: 'Haemmern', radK: 0.4, gap: 0.8 }); });
        // the village's theme (Freddy: town fair, wedding, a dark church fest, a funeral, a plain market), its music changes there
        const theme = s === festSeg ? 'stadtfest' : ['hochzeit', 'kirchenfest', 'beerdigung', 'markt'][villageNo++ % 4];
        this.villageThemes.push({ a, b, theme });
        if (theme === 'stadtfest') {
          place(byName('karussell'), mid + 70, ROAD_W + 12, { face: 'road', anim: 'Drehen', gap: 3 });
          for (let k = 0; k < 3; k++) place(byName('festzelt_bierbank'), mid - 60 - k * 9, ROAD_W + 6, { face: 'road', gap: 1.5 });
        } else if (theme === 'hochzeit') {
          const arch = byName('blumenbogen'); place(arch, mid - 34, ROAD_W + 6, { face: 'road', anim: 'Wehen', gap: 1 });
          place(byName('hochzeit_paar'), mid - 34, ROAD_W + 3.6, { face: 'road', anim: 'Tanzen', radK: 0.4, gap: 0.6, overlap: true });
          for (let k = 0; k < 6; k++) place(byName(k % 2 ? 'zuschauer_jubelnd' : 'magd'), mid - 42 + k * 3.2, ROAD_W + 2.2 + (k % 2) * 0.7, { face: 'road', anim: 'Jubeln', radK: 0.35, gap: 0.5 });
          for (let k = 0; k < 2; k++) place(byName('festzelt_bierbank'), mid - 52 - k * 9, ROAD_W + 7, { face: 'road', gap: 1.5 });
        } else if (theme === 'kirchenfest') { // dark: a gothic church with its graveyard, a stage with amps, fans headbanging
          const ch = byName('kirche_gotisch'); if (ch) place(ch, mid - 70, ROAD_W + 8 + Math.max(...ch.size) / 2, { face: 'road', gap: 4 });
          place(byName('buehne_verstaerker'), mid + 62, ROAD_W + 12, { face: 'road', gap: 3 });
          for (let k = 0; k < 8; k++) place(byName(k % 2 ? 'metal_fan_2' : 'metal_fan'), mid + 56 + (k % 4) * 3.2, ROAD_W + 4 + Math.floor(k / 4) * 2, { face: 'away', anim: k % 3 ? 'Headbangen' : 'Jubeln', radK: 0.35, gap: 0.5 });
        } else if (theme === 'beerdigung') { // a slow procession along the roadside: the coffin, then the mourners
          const proc = [byName('sarg_traeger'), ...[0, 1, 2, 3, 4].map(k => byName(k % 2 ? 'trauernde_2' : 'trauernde'))];
          proc.forEach((e, k) => { if (!e) return; const dd = mid - 30 - k * 2.6, off = ROAD_W + 2 + (k ? (k % 2) * 0.8 : 0.4);
            const o = place(e, dd, off, { anim: 'Gehen', overlap: true, gap: 0.5, radK: 0.3 }); if (o) o.userData.walk = { d: dd, off, v: 0.55, a, b }; });
        }
        // houses on the land side, facing the road
        for (let d = a; d < b; d += 18 + r() * 22) {
          if (Math.abs(d - mid) < 22 || r() < 0.2) continue;
          const back = r() < 0.3 ? 14 + r() * 14 : 0; // some houses stand back in a second row
          const hr = r(); // Lofoten look: red and ochre rorbuer, some stone houses; timber framing only in the festival town
          const he = s === festSeg && hr > 0.8 ? (hr < 0.92 ? byName('fachwerkhaus_a') : byName('fachwerkhaus_b'))
            : hr < 0.45 ? byName('rorbu_rot') : hr < 0.8 ? byName('rorbu_ocker') : byName('steinhaus');
          if (he) place(he, d, ROAD_W + 7 + Math.max(...he.size) / 2 + r() * 4 + back, { rot: (r() - .5) * .3, gap: 4, dy: /rorbu/.test(he.file) ? -1.1 : 0 }); // front 5-9 m behind the asphalt; rorbuer on land: stilts sunk into the ground
          if (r() < 0.3) place(byName('waescheleine'), d + 9, ROAD_W + 10 + r() * 3, { face: 'along', gap: 2 });
          if (r() < 0.25) place(r() < .5 ? byName('fass') : byName('schubkarre'), d + 5, ROAD_W + 6, { gap: 0.5, rot: r() * 3 }); // not right at the asphalt
        }
        // harbour on the sea side: rorbuer on stilts at the water, piers, boats, a fisherman
        let fishers = 0;
        for (let d = a; d < b; d += 22 + r() * 14) {
          const w = waterline(d, -1, 8); if (w === null) continue;
          place(r() < 0.6 ? byName('rorbu_rot') : byName('rorbu_ocker'), d, -(w + 2), { face: 'road', dy: -0.3 });
          if (place(byName('brygge'), d + 9, -(w + 3), { face: 'road', water: true, y: 0.2 }) && fishers++ < 2 && r() < 0.6)
            place(byName('fischer_netz'), d + 9, -(w + 1.2), { radK: 0.4, anim: 'Flicken', overlap: true, water: true, y: 1.6 });
          if (r() < 0.7) place(r() < 0.6 ? byName('nordlandboot') : byName('fischerboot'), d + 4, -(w + 14 + r() * 10), { water: true, y: 0.12, face: 'along', rot: r() * 0.6 });
        }
        // villagers walking along the roadside (only models with a walk cycle 'Gehen'; others would glide)
        const walkers = (A.by.figure_walk || []).concat(A.by.figure_idle || []).filter(e => e.clips.some(c => c.name === 'Gehen'));
        if (walkers.length) for (let k = 0; k < 14; k++) {
          const side = k % 2 ? 1 : -1, dd = a + r() * (b - a), off = side * (ROAD_W + 1.4 + r() * 0.8);
          const o = place(walkers[k % walkers.length], dd, off, { anim: 'Gehen', overlap: true, gap: 0.6, radK: 0.3 });
          if (o) { const f = o.userData.asset || '', st = Object.entries(STRIDE).find(([n]) => f.includes(n))?.[1] ?? 0.86; // walk exactly as fast as the clip's steps: no sliding feet
            o.userData.walk = { d: dd, off, v: st * o.scale.y * (0.96 + r() * 0.1) * (r() < 0.5 ? 1 : -1), a, b }; }
        }
        // children and onlookers at the roadside who wave and call out as you pass
        // a mixed crowd, not always the farmer: hunter with bow, women with bread, fishers, traders, children; right at the asphalt
        const watchers = ['zuschauer_jubelnd', 'junge', 'maedchen', 'kind', 'alte_frau', 'moench', 'bogenschuetze', 'jaeger', 'baeckerin', 'frau_brot', 'magd', 'fischerin', 'haendler'].map(byName).filter(Boolean)
          .sort(() => r() - 0.5);
        if (r() < 0.25 && byName('bauer_sense')) watchers.push(byName('bauer_sense'));
        for (let k = 0; watchers.length && k < 8; k++) place(watchers[k % watchers.length], a + (k + 0.5) * (b - a) / 8, (k % 2 ? 1 : -1) * (ROAD_W + 1.5 + r() * 0.6), { face: 'road', anim: r() < 0.6 ? 'Winken' : 'Stehen', gap: 0.5, radK: 0.35 });
        // the biggest village holds a street festival: garlands over the road, tents, jugglers, a second band, crowd
        if (s === festSeg) {
          const gar = byName('girlande'), tents = ['zelt', 'buehne', 'maibaum', 'tisch', 'fackel'].map(byName).filter(Boolean);
          const crowd = ['gaukler', 'junge', 'maedchen', 'haendler', 'fischerin', 'moench'].map(byName).filter(Boolean);
          for (let d = a + 15; gar && d < b - 15; d += 22) place(gar, d, 0.01, { face: 'along', overlap: true, gap: -99, radK: 0.01 });
          for (let k = 0; tents.length && k < 8; k++) place(tents[k % tents.length], mid - 60 + k * 15, (k % 2 ? 1 : -1) * (ROAD_W + 8 + r() * 4), { face: 'road', gap: 2 });
          for (let k = 0; crowd.length && k < 18; k++) place(crowd[k % crowd.length], a + r() * (b - a), (r() < .5 ? 1 : -1) * (ROAD_W + 2 + r() * 5), { face: 'road', anim: ['Jonglieren', 'Winken', 'Jubeln', 'Stehen'][k % 4], gap: 0.6, radK: 0.35 });
          mus.forEach((e, k) => place(e, mid + 40 + k * 2.3, -(ROAD_W + 6 + (k % 2) * 0.8), { radK: 0.45, anim: 'Spielen', gap: 2 }));
        }
        place(byName('hjell'), a + 25, ROAD_W + 12, { face: 'along' });
        if (s === segs[0]) place(byName('dorfkirche'), b - 40, ROAD_W + 16, { face: Math.PI / 2 });
      }
      // ---- open coast: a lone rorbu with pier, drying racks, sheep, puffins ----
      if (s.land === 'coast' && !s.village) {
        for (let d = s.from + 200; d < s.to - 100; d += 380 + r() * 300) {
          const w = waterline(d, -1, 8);
          if (w !== null) { place(byName('rorbu_rot'), d, -(w + 2), { dy: -0.3 }); place(byName('brygge'), d + 9, -(w + 3), { water: true, y: 0.2 }); place(byName('nordlandboot'), d + 2, -(w + 16), { water: true, y: 0.12, face: 'along' }); }
          if (r() < 0.5) place(byName('hjell'), d + 60, ROAD_W + 10 + r() * 6, { face: 'along' });
        }
      }
      // ---- long open stretches (real routes: kilometres between hamlets): a lone farm every ~1 km, fishers at the shore,
      // now and then a whale offshore and a sea eagle, so the coast road never runs empty ----
      if (!s.village && s.to - s.from > 1200) {
        for (let d = s.from + 450; d < s.to - 300; d += 800 + r() * 600) {
          const kind = r();
          if (kind < 0.55) { // farm on the land side: house, fence, washing line, hay, someone at work
            const hs = [byName('steinhaus'), byName('rorbu_ocker'), byName('rorbu_rot')].filter(Boolean), he = hs[Math.floor(r() * hs.length)];
            if (!he) continue;
            const back = ROAD_W + 14 + r() * 18, h = place(he, d, back + Math.max(...he.size) / 2, { rot: (r() - .5) * .4, gap: 4 });
            if (!h) continue;
            place(byName('waescheleine'), d + 12, back + 2, { face: 'along', gap: 2, radK: 0.4 });
            if (r() < 0.7) place(byName('heuhaufen'), d - 16, back + 6, { gap: 2 });
            if (r() < 0.5) place(byName('schubkarre'), d + 5, back - 1, { face: r() * 6.28, gap: 1.5, radK: 0.4 });
            if (r() < 0.6) place(byName('holzstapel'), d + 10, back + 4, { face: 'along', gap: 1.5, radK: 0.5 }); // new MacBook models (placed once they exist)
            if (r() < 0.5) place(byName('viehtraenke'), d - 26, back + 10, { face: r() * 6.28, gap: 2, radK: 0.5 });
            const fl = byName('flechtzaun'); if (fl) { const len = Math.max(fl.size[0], fl.size[2]) * 0.97, turn = fl.size[0] > fl.size[2] ? Math.PI / 2 : 0;
              for (let k = 0; k * len < 30; k++) place(fl, d - 15 + k * len, ROAD_W + 6, { face: 'along', rot: turn, gap: 1, radK: 0.3, overlap: true }); }
            const idle = A.by.figure_idle || []; if (idle.length && r() < 0.8) place(idle[Math.floor(r() * idle.length)], d + 8, back - 3, { face: 'road', gap: 1, radK: 0.5, anim: 'Stehen' });
            const herd = groupOf('herd'); // a whole flock or paddock from the templates, else three animals
            if (!herd || !placeGroup(herd, d - 22, back + 14 + (herd.radius_m || 6)))
              for (let k = 0, an = r() < 0.4 ? byName('pferd') : r() < 0.3 && byName('pony') || byName('schaf'); k < 3; k++) place(an, d - 30 + r() * 20, back + 12 + r() * 14, { face: r() * 6.28, anim: 'Grasen', radK: 0.6, gap: 3 });
          } else if (s.land === 'coast') { // at the shore: a moored boat, a fisher mending nets, a stack of barrels
            const w = waterline(d, -1, 8); if (w === null) continue;
            place(byName('fischerboot') || byName('nordlandboot'), d, -(w + 7), { water: true, y: 0.12, face: 'along' });
            place(byName('fischer_netz'), d + 6, -(w - 1.5), { radK: 0.4, anim: 'Flicken', gap: 1 });
            place(byName('faesser_kisten'), d - 6, -(w - 2.5), { gap: 1, radK: 0.5 });
          } else place(byName('hjell'), d, ROAD_W + 10 + r() * 8, { face: 'along' });
        }
        if (!bandDone && s.to - s.from > 2500) { const band = groupOf('band'); // once per ride a band plays at the roadside, its audience in front
          if (band && placeGroup(band, (s.from + s.to) / 2, ROAD_W + 2 + (band.radius_m || 6))) bandDone = true; }
        if (s.land === 'coast') for (let d = s.from + 1500; d < s.to - 500; d += 3500 + r() * 2500) { // whale offshore (shown when it surfaces)
          const off = 150 + r() * 110, q = spot(d, -off); if (f.height(q.x, q.z) >= -6) continue;
          const w = place(byName('buckelwal'), d, -off, { water: true, y: 0, face: 'along', overlap: true });
          if (w) { w.traverse(c => { c.frustumCulled = false; }); w.userData.whale = true; w.userData.hidden = true; w.visible = false; this.whales.push({ obj: w, mixer: this.mixers[this.mixers.length - 1], next: 0 }); }
        }
        const e = s.to - s.from > 4000 && byName('seeadler'); if (e) { const { obj, mixer } = A.make(e, 'Gleiten', r); const q = spot((s.from + s.to) / 2, -50); obj.userData.circle = { x: q.x, z: q.z, y: 0, R: 40 + r() * 40, w: 0.18 + r() * .1, ph: r() * 6 }; this.scene.add(obj); this.birds.push(obj); this.props.push(obj); if (mixer) { mixer.obj = obj; this.mixers.push(mixer); } }
      }
      // ---- meadows: sheep flocks, horses, reindeer higher up, stone walls, hay ----
      if (s.land !== 'cliff') {
        for (let d = s.from + 150; d < s.to - 50; d += 260 + r() * 260) {
          const side = s.land === 'coast' || s.land === 'river' ? 1 : (r() < 0.5 ? -1 : 1), base = 16 + r() * 30, n = 4 + Math.floor(r() * 5);
          const animal = s.land === 'serp' || (s.land === 'valley' && r() < 0.4) ? byName('rentier') : r() < 0.15 ? byName('pferd') : byName('schaf');
          for (let k = 0; k < n; k++) place(animal, d + (r() - .5) * 26, side * (base + r() * 14), { face: r() * 6.28, anim: r() < 0.7 ? 'Grasen' : 'Stehen', radK: 0.6, gap: 3 });
          if (s.land === 'valley' && r() < 0.6) for (let k = 0; k < 6; k++) place(byName('garbenhocke'), d + 40 + k * 3.5, side * -(10 + (k % 2) * 3), { gap: 2 });
          if (r() < 0.35) place(byName('heuhaufen'), d + 70, side * (12 + r() * 10), { gap: 2 });
        }
        // dry-stone walls along the land side
        for (let d = s.from + 100; d < s.to - 100; d += 500 + r() * 400) {
          const wall = s.land === 'valley' ? byName('flechtzaun') : byName('trockenmauer'), off = ROAD_W + 5 + r() * 2, side = s.land === 'coast' || s.land === 'river' ? 1 : -1;
          if (wall) { // segments end to end, long side along the road whichever axis the model was built on
            const len = Math.max(wall.size[0], wall.size[2]) * 0.97, turn = wall.size[0] > wall.size[2] ? Math.PI / 2 : 0;
            for (let k = 0; k * len < 64; k++) place(wall, d + k * len, side * off, { face: 'along', rot: turn, gap: 1, radK: 0.3, overlap: true });
          }
        }
      }
      // ---- river banks: anglers on the shore, rowing boats on the water (Freddy: Flussabschnitt mit Booten und Anglern) ----
      if (s.land === 'river') for (let d = s.from + 120; d < s.to - 80; d += 220 + r() * 260) {
        const w = waterline(d, -1, 4, 0.2); if (w === null) continue;
        if (r() < 0.6) place(byName('angler'), d, -(w - 1.2), { face: 'away', anim: 'Angeln', radK: 0.4, gap: 0.8 });
        if (r() < 0.55) place(byName('ruderboot') || byName('nordlandboot'), d + 20 + r() * 30, -(w + 12 + r() * 30), { water: true, y: 0.1, face: 'along', rot: (r() - .5) * 0.8, anim: 'Rudern' });
        if (r() < 0.2) place(byName('brygge'), d - 15, -(w + 3), { water: true, y: 0.2 });
      }
      // ---- mountain pass: stone walls at the hairpins, the pass sign on top ----
      if (s.land === 'serp') {
        const cv = t.curve || []; let kehreNo = 0;
        place(byName('wegkreuz'), s.from + 40, ROAD_W + 4, { face: 'road', gap: 1, radK: 0.4 }); // a wayside cross at the foot of every climb
        const sp = byName('schneestangen'); if (sp) for (let d = s.from; d < s.to; d += 45) if (f.at(d).e > 1300) for (const sd of [-1, 1]) place(sp, d + (sd > 0 ? 0 : 22), sd * (ROAD_W + 1.6), { face: 'road', gap: 0.4, radK: 0.2, overlap: true }); // snow poles up high
        for (let i = Math.round(s.from / STEP) + 4; i < Math.round(s.to / STEP) - 4; i++) {
          let sum = 0; for (let k = -3; k <= 3; k++) sum += cv[i + k] || 0;
          if (Math.abs(sum) < 0.95) continue; // curve is clamped to ±0.15 per sample: only hairpins (π in ~70 m) get here
          const out = sum > 0 ? -1 : 1, d = i * STEP; // outside of the bend
          const e = s.style === 'asia' ? byName('steintreppe') : byName('steinmauer_kehre');
          place(e, d, out * (ROAD_W + 9 + (e ? Math.max(...e.size) / 2 : 0)), { face: 'road', gap: 2 });
          const ks = byName('kehre_schild'); if (ks && ++kehreNo <= 10) { const o = place(ks, d - 45, -out * (ROAD_W + 2.5), { face: 'road', gap: 0.8, radK: 0.3 }); // hairpin numbers like on the classic passes
            if (o) { const nr = kehreNo; o.traverse(c => { const m = /^nr_(\d+)$/.exec(c.name); if (m) c.visible = +m[1] === nr; }); } }
          i += 12;
        }
      }
      if (s.top === 'pass') { const pr = +(QS.get('passrot') ?? -0.7); // turned towards the oncoming rider so the board reads head-on (Mac mini QA: side-on it was unreadable)
        place(byName('passschild'), s.to + 25, ROAD_W + 3.6, { face: 'road', gap: 1, radK: 0.4, scale: 1.5, rotT: pr }); place(byName('passschild'), s.to + 40, -(ROAD_W + 3.6), { face: 'road', gap: 1, radK: 0.4, scale: 1.5, rotT: pr }); }
      // ---- East Asian style (original): bamboo groves, lantern chains, monks training, pagodas on the tops ----
      if (s.style === 'asia') {
        const land = s.land === 'river' ? 1 : 0;
        for (let d = s.from + 60; d < s.to - 40; d += 90 + r() * 140) {
          const side = land || (r() < 0.5 ? -1 : 1);
          place(byName('bambus_gruppe'), d, side * (ROAD_W + 6 + r() * 16), { face: r() * 6.28, gap: 2, radK: 0.6 });
        }
        if (s.temple) {
          const a = s.from + L * s.temple[0], b = s.from + L * s.temple[1], mid = (a + b) / 2;
          const lk = byName('laternen_kette');
          if (lk) for (let d = a; d < b; d += 28) { // the chain spans the road, its posts stand beside it (Mac mini QA: a post stood in the lane)
            const p = f.at(d), l = Math.hypot(p.tx, p.tz) || 1, { obj, mixer } = A.make(lk, null, r);
            const wide = Math.max(lk.size[0], lk.size[2]); if (wide < ROAD_W * 2 + 1) { obj.scale.setScalar((ROAD_W * 2 + 2) / wide); }
            obj.position.set(p.x, p.e, p.z); obj.rotation.y = Math.atan2(p.tx / l, p.tz / l) + (lk.size[0] >= lk.size[2] ? 0 : Math.PI / 2);
            obj.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(obj); obj.position.x += p.x - (bb.min.x + bb.max.x) / 2; obj.position.z += p.z - (bb.min.z + bb.max.z) / 2; // centred over the road whatever the model's origin
            this.scene.add(obj); this.props.push(obj); if (mixer) { mixer.obj = obj; this.mixers.push(mixer); } }
          place(byName('pagode'), mid, ROAD_W + 26, { face: 'road', gap: 6 });
          const monk = byName('kampfmoench');
          if (monk) for (let k = 0; k < 7; k++) place(monk, mid - 18 + (k % 4) * 3.2, ROAD_W + 8 + Math.floor(k / 4) * 3.2, { face: 'road', anim: ['Kaempfen', 'Trainieren', 'Stehen'][k % 3], gap: 1, radK: 0.4 });
          place(byName('steintreppe'), mid + 30, ROAD_W + 14, { face: 'road', gap: 2 });
          place(byName('teehaus'), mid - 45, ROAD_W + 12 + 3, { face: 'road', gap: 3 }); // tea house on stilts with stone lanterns
          for (let d = a + 40; d < b; d += 70 + r() * 50) place(byName('gebetsfahnen'), d, (r() < 0.5 ? -1 : 1) * (ROAD_W + 4), { face: 'road', anim: 'Wehen', gap: 1, radK: 0.4 });
          place(byName('glockenpavillon'), mid + 70, ROAD_W + 12, { face: 'road', anim: 'Schwingen', gap: 3 });
          const kw = byName('klostermauer'); if (kw) { const len = Math.max(kw.size[0], kw.size[2]) * 0.98, turn = kw.size[0] > kw.size[2] ? Math.PI / 2 : 0; // same as the wattle fence
            for (let d = mid - 60; d < mid + 60; d += len) place(kw, d, ROAD_W + 32, { face: 'along', rot: turn, gap: 2, radK: 0.3, overlap: true }); } // the monastery wall behind pagoda and monks
        }
        if (s.top === 'pagode') {
          place(byName('pagode'), s.to + 55, ROAD_W + 22, { face: 'road', gap: 6 });
          const monk = byName('kampfmoench'); if (monk) for (let k = 0; k < 3; k++) place(monk, s.to + 30 + k * 3, ROAD_W + 6, { face: 'road', anim: 'Kaempfen', gap: 1, radK: 0.4 });
        }
      }
      // ---- landmarks on the climb tops ----
      if (s.top === 'church') place(byName('dorfkirche'), s.to + 60, ROAD_W + 18, { face: Math.PI / 2 });
      if (s.top === 'mill') place(byName('wassermuehle'), s.to + 50, ROAD_W + 12, {});
      // ---- cliffs: eagles above, puffins on the rocks, whales offshore ----
      if (s.land === 'cliff' || s.beach) {
        for (let d = s.from + 300; d < s.to; d += 900) {
          const off = 140 + r() * 120, q = spot(d, -off); // close enough to read as a whale at 62° FOV
          if (f.height(q.x, q.z) < -6) { const w = place(byName('buckelwal'), d, -off, { water: true, y: 0, face: 'along', overlap: true }); if (w) { w.traverse(c => { c.frustumCulled = false; }); w.userData.whale = true; w.userData.hidden = true; w.visible = false; console.info(`RIDEFRAME Wal d=${Math.round(d)} off=-${Math.round(off)} (links)`); } if (w) this.whales.push({ obj: w, mixer: this.mixers[this.mixers.length - 1], next: 0 }); }
        }
        for (let k = 0; k < 2; k++) { const e = byName('seeadler'); if (e) { const { obj, mixer } = A.make(e, 'Gleiten', r); const q = spot(s.from + L * (0.3 + k * 0.4), -60); obj.userData.circle = { x: q.x, z: q.z, y: 0, R: 40 + r() * 40, w: 0.18 + r() * .1, ph: r() * 6 }; this.scene.add(obj); this.birds.push(obj); this.props.push(obj); if (mixer) { mixer.obj = obj; this.mixers.push(mixer); } } }
      }
    }
    // gulls over every harbour / coast
    for (const s of segs.filter(s => s.land === 'coast')) for (let d = s.from + 100; d < s.to; d += 700) {
      const e = byName('moewe'); if (!e) break;
      const { obj, mixer } = A.make(e, 'Gleiten', r); const q = spot(d, -40 - r() * 40);
      obj.userData.circle = { x: q.x, z: q.z, y: 0, R: 15 + r() * 25, w: 0.4 + r() * .3, ph: r() * 6 };
      this.scene.add(obj); this.birds.push(obj); this.props.push(obj); if (mixer) { mixer.obj = obj; this.mixers.push(mixer); }
    }
    for (const b of this.birds) { const c = b.userData.circle; c.y = Math.max(0, f.height(c.x, c.z)) + 25 + Math.random() * 30; }
    // trees by altitude: birch down by the water, pine on the slopes, crooked mountain birch at the tree line, juniper above.
    // Each species carries its altitude band (zone_m) from the Mac; groves, not an even sprinkle.
    const trees = (A.by.tree || []).filter(e => !/bambus/.test(e.file)); // bamboo only in the East Asian sections (placed there)
    // no two trees alike: own height/width ratio, a slight lean, and a per-tree foliage tint (greener, darker, sun-bleached,
    // now and then an autumn-gold birch) as vertex colour, so static batching still merges them into one mesh per material
    const tintMat = new Map(), leafy = m => /leaf|leaves|blatt|laub|nadel|krone|foliage|canopy|needle/i.test((m.name || '') + (m.material?.name || ''))
      || (m.material?.color && m.material.color.g > m.material.color.r * 1.08 && m.material.color.g > m.material.color.b);
    const vary = (o, lo, birchy) => {
      const k = o.scale.x, tall = 0.82 + r() * 0.5, wide = 0.88 + r() * 0.3;
      const gold = birchy && r() < 0.13, dark = 0.78 + r() * 0.34;
      const tint = gold ? [1.25 + r() * 0.2, 1.0 + r() * 0.12, 0.35] : [dark * (0.92 + r() * 0.16), dark * (0.97 + r() * 0.1), dark * (0.85 + r() * 0.2)];
      const lean = [(r() - 0.5) * 0.08, (r() - 0.5) * 0.08];
      for (const t of [o, lo]) if (t) {
        t.scale.set(k * wide, k * tall, k * wide * (0.92 + r() * 0.16)); t.rotation.x = lean[0]; t.rotation.z = lean[1];
        t.traverse(m => {
          if (!m.isMesh || Array.isArray(m.material) || !m.material) return;
          const leaf = leafy(m), c = leaf ? tint : [0.9 + dark * 0.1, 0.9 + dark * 0.1, 0.9 + dark * 0.1];
          const g = m.geometry.clone(), n = g.attributes.position.count, old = g.attributes.color, a = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) a[i * 3 + j] = (old ? old.getComponent(i, j) : 1) * c[j];
          g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3)); m.geometry = g;
          let mt = tintMat.get(m.material.uuid); if (!mt) { mt = m.material.clone(); mt.vertexColors = true; charred(mt, leaf); tintMat.set(m.material.uuid, mt); }
          m.material = mt;
        });
      }
    };
    if (trees.length) {
      // land all round (14 m): no tree on a thin spit or skerry, where the coarse far terrain shows only sea
      const dry = (x, z) => [[14, 0], [-14, 0], [0, 14], [0, -14], [10, 10], [-10, -10]].every(([a, c]) => f.height(x + a, z + c) > 1.2);
      let n = 0;
      for (let d = 80; d < t.length - 60 && n < 1400; d += 9 + r() * 10) {
        const grove = f.n2(d / 400, 7.3) * 0.5 + 0.5; // stretches with woods and open stretches between them
        if (r() > 0.25 + grove * 0.9) continue;
        const side = r() < 0.5 ? -1 : 1, off = side * (ROAD_W + 9 + Math.pow(r(), 1.6) * 210), q = spot(d, off), h = f.height(q.x, q.z);
        if (h < 2.5 || !dry(q.x, q.z)) continue;
        const slope = Math.hypot(f.height(q.x + 3, q.z) - h, f.height(q.x, q.z + 3) - h) / 3; if (slope > 0.75) continue; // no trees on cliffs
        const fit = trees.filter(e => !e.zone_m || (h >= e.zone_m[0] && h <= e.zone_m[1]));
        if (!fit.length) continue;
        const e = fit[Math.floor(r() * fit.length)], k = 0.8 + r() * 0.45;
        const o = place(e, d, off, { face: r() * 6.28, scale: k, radK: 0.35, gap: 4 }); if (!o) continue;
        n++; o.userData.near = !!e.farScene;
        const lo = e.farScene ? e.farScene.clone(true) : null;
        if (lo) { lo.position.copy(o.position); lo.rotation.copy(o.rotation); lo.userData.far = true; this.scene.add(lo); this.props.push(lo); }
        if (!QS.has('treeplain')) vary(o, lo, /birke/.test(e.file || e.name || '')); else if (lo) lo.scale.copy(o.scale);
      }
      // groves on sheltered ground: valley floors and hollows (ground lower than its surroundings), gentle slopes,
      // mostly birch; 5-12 trees per grove, never on the road (place) and not on steep bare rock (slope)
      const birch = trees.filter(e => /birke/.test(e.file || e.name || '')), pool = birch.length ? birch : trees;
      let groves = 0, n0 = n, tried = 0;
      for (let d = 120; d < t.length - 120 && n < 2400; d += 35 + r() * 40) {
        if (r() > 0.6 + 0.4 * (f.n2(d / 650, 2.1) * 0.5 + 0.5)) continue;
        const side = r() < 0.5 ? -1 : 1, off = side * (ROAD_W + 14 + Math.pow(r(), 1.6) * 230), q = spot(d, off), h = f.height(q.x, q.z);
        if (h < 3 || h > 260) continue;
        let ring = 0; for (let k = 0; k < 8; k++) { const a = k * 0.785; ring += f.height(q.x + Math.cos(a) * 70, q.z + Math.sin(a) * 70); } ring /= 8;
        const slope = Math.hypot(f.height(q.x + 4, q.z) - h, f.height(q.x, q.z + 4) - h) / 4;
        if (slope > 0.45 || ring - h < (h < 80 ? -4 : 2)) continue; // a hollow, or flat low valley floor
        const cnt = 5 + Math.floor(r() * 8); groves++;
        for (let k = 0; k < cnt; k++) {
          const dd = d + (r() - 0.5) * 50, oo = off + (r() - 0.5) * 45, qq = spot(dd, oo), hh = f.height(qq.x, qq.z);
          if (hh < 2.5 || !dry(qq.x, qq.z) || Math.hypot(f.height(qq.x + 3, qq.z) - hh, f.height(qq.x, qq.z + 3) - hh) / 3 > 0.5) continue;
          const fit = pool.filter(e => !e.zone_m || (hh >= e.zone_m[0] - 40 && hh <= e.zone_m[1] + 40)), e = (fit.length ? fit : pool)[Math.floor(r() * (fit.length || pool.length))];
          tried++; const o = place(e, dd, oo, { face: r() * 6.28, scale: 0.75 + r() * 0.5, radK: 0.35, gap: 5 }); if (!o) continue;
          n++; o.userData.near = !!e.farScene;
          const lo = e.farScene ? e.farScene.clone(true) : null;
        if (lo) { lo.position.copy(o.position); lo.rotation.copy(o.rotation); lo.userData.far = true; this.scene.add(lo); this.props.push(lo); }
        if (!QS.has('treeplain')) vary(o, lo, /birke/.test(e.file || e.name || '')); else if (lo) lo.scale.copy(o.scale);
        }
      }
      console.info('RIDEFRAME Bäume', n, 'Haine', groves, 'Hain-Bäume', n - n0, 'von', tried);
    }
    this.falls = placeWaterfalls(this, A, taken); // before the rock walls, which then keep clear of them
    // big rock walls where the ground rises steeply beside the road (serpentines, cliffs)
    const cliffs = A.by.cliff || [];
    if (cliffs.length) for (let d = 300; d < t.length - 100; d += 140 + r() * 120) {
      for (const side of [1, -1]) {
        // only into slopes that keep rising behind (a real mountainside), never as a free-standing slab
        const ms = segAt(d).seaSide === 1 ? -side : side, p = f.at(d), q1 = spot(d, ms * 34), q2 = spot(d, ms * 70); // mirrored like place()
        if (f.height(q1.x, q1.z) - p.e < 18 || f.height(q2.x, q2.z) - p.e < 40) continue;
        const k = 0.75 + r() * 0.3; // narrower and much deeper than modelled, so the back disappears in the hill
        const o = place(cliffs[Math.floor(r() * cliffs.length)], d, side * (36 + r() * 10), { face: 'road', dy: -7, radK: 0.45, gap: 20, scale: [k * 0.75, k, k * 2.4] });
        if (o && !QS.has('cliffglb')) o.traverse(m => { // same granite/gneiss shader as the mountains instead of the baked texture
          if (!m.isMesh) return; const g = m.geometry, n = g.attributes.position.count;
          if (!g.attributes.splat) { g.setAttribute('splat', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => i % 4 === 1 ? 1 : 0), 4)); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(0.85), 3)); }
          m.material = this.rockMat; });
      }
    }
    // now and then the road is cut into the rock (Freddy: "ab und zu Klippen direkt an der Straße"): a wall close beside
    // the asphalt on the land side, only where the ground rises anyway, never in a village
    if (cliffs.length && !QS.has('nocut')) for (let d = 900 + r() * 800; d < t.length - 300; d += 1800 + r() * 1600) {
      const sg = segAt(d); if (sg.village || sg.temple) continue;
      const side = sg.land === 'coast' || sg.land === 'river' || sg.land === 'cliff' ? 1 : (r() < 0.5 ? -1 : 1), p = f.at(d), q = spot(d, (sg.seaSide === 1 ? -side : side) * 22); // place() mirrors on sea-right roads: test the side it will really use
      if (f.height(q.x, q.z) - p.e < 5) continue;
      const e = cliffs[Math.floor(r() * cliffs.length)], k = 0.42 + r() * 0.18, R = Math.max(...e.size) / 2 * k;
      const o = place(e, d, side * (ROAD_W + 3.5 + R), { face: 'road', rot: (r() - 0.5) * 0.9, dy: -3, radK: k, gap: 2.5, scale: [k, k * (0.8 + r() * 0.5), k] }); // smaller and turned: a broken rock face, not a smooth wall
      if (o && !QS.has('cliffglb')) o.traverse(m => { if (!m.isMesh) return; const g = m.geometry, n = g.attributes.position.count;
        if (!g.attributes.splat) { g.setAttribute('splat', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => i % 4 === 1 ? 1 : 0), 4)); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(0.85), 3)); }
        m.material = this.rockMat; });
      if (o) console.info(`RIDEFRAME Felsen an der Straße d=${Math.round(d)} ${side > 0 ? 'rechts' : 'links'}`);
    }
    // the castle is under siege: knights storm up from the road, a catapult and camp below, banners of both sides
    for (const s of segs) if (s.top === 'castle') {
      const d0 = s.to + 70, attackers = ['ritter', 'wache', 'bogenschuetze', 'soldat'].map(byName).filter(Boolean);
      const q = spot(d0, 34), face = (d, off) => { const p = spot(d, off); return Math.atan2(q.x - p.x, q.z - p.z); };
      for (let k = 0; attackers.length && k < 16; k++) { const d = d0 - 40 + r() * 80, off = 10 + r() * 14;
        place(attackers[k % attackers.length], d, off, { face: face(d, off), anim: r() < 0.6 ? 'Kaempfen' : 'Rennen', gap: 0.8, radK: 0.35 }); }
      const kn = byName('reiter_ritter'); if (kn) place(kn, d0 - 25, 9, { face: face(d0 - 25, 9), anim: 'Stehen', gap: 1 });
      for (const [n, dd, off] of [['katapult', -55, 16], ['tribok', 50, 18], ['leiter', 5, 26], ['rammbock', -12, 24], ['zelt', -70, -12], ['palisade', -80, -10], ['banner', -40, 8], ['banner', 40, 8]]) {
        const e = byName(n); if (e) place(e, d0 + dd, off, { face: face(d0 + dd, off), gap: 1 }); }
    }
    { const bn = byName('rideframe_banner'), c = f.at(0), flip = QS.has('bannerflip') ? Math.PI : 0; if (bn) for (const sd of [1, -1]) { const o = place(bn, sd > 0 ? 26 : 22, sd * (ROAD_W + 1.5), { face: 'road', anim: 'Wehen', gap: 0.3, radK: 0.2, overlap: true });
      if (o) { o.rotation.y = Math.atan2(c.x - o.position.x, c.z - o.position.z) + flip;
        o.traverse(m => { if (!m.isMesh || !m.material || Array.isArray(m.material) || /mast/.test(m.name + m.material.name)) return; m.material = m.material.clone(); m.material.side = THREE.DoubleSide; // logo and cloth lit from within: against the low sun the flag was pitch black at every angle (Mac mini QA)
          if (m.material.emissive) { m.material.emissive.copy(m.material.color); m.material.emissiveMap = m.material.map || null; m.material.emissiveIntensity = 0.5; } }); } } } // RIDEFRAME beach flags past the start arch, the print side (+Z) turned straight at the start position
    { // the MacBook's ride furniture (each only once its model exists): feed stations on the tops, a grandstand at the finish, hot-air balloons over the land, signposts at the turn-offs
      const L = t.length, vs = byName('verpflegungsstand'), tb = byName('zuschauer_tribuene'), hb = byName('heissluftballon'), ws = byName('wegweiser');
      for (const s of segs) {
        if ((s.interval || s.top) && vs && place(vs, s.to + 110, -(ROAD_W + 2.5 + Math.min(vs.size[0], vs.size[2]) / 2), { face: 'road', gap: 1 })) { // opposite the church/mill on the top, close to the asphalt so you see it
          const idle = A.by.figure_idle || []; if (idle.length) place(idle[Math.floor(r() * idle.length)], s.to + 106, -(ROAD_W + 1.6), { face: 'road', anim: 'Stehen', gap: 0.4, radK: 0.4 }); // a helper handing out bottles
          place(byName('fahne_wimpel'), s.to + 98, -(ROAD_W + 1.5), { gap: 0.4, radK: 0.3 }); } // and a flag, so you spot it from afar
        if ((s.interval || s.top) && tb && r() < 0.5) place(tb, s.to - 120, -(ROAD_W + 5 + Math.min(tb.size[0], tb.size[2]) / 2), { face: 'road', gap: 2 });
        if (ws && s.from > 50) { const o = place(ws, s.from + 15, ROAD_W + 2.2, { face: 'road', gap: 0.5, radK: 0.3 });
          if (o) { const keep = 1 + Math.floor(r() * 3); o.traverse(c => { const m = /^pfeil_(\d)$/.exec(c.name); if (m) c.visible = +m[1] === keep || r() < 0.4; }); } }
      }
      if (tb) for (const sd of [1, -1]) place(tb, L - 70, sd * (ROAD_W + 5 + Math.min(tb.size[0], tb.size[2]) / 2), { face: 'road', gap: 2 }); // the crowd at the finish
      if (hb) for (let d = 3000 + r() * 4000; d < L - 2000; d += 9000 + r() * 6000) place(hb, d, (r() < 0.5 ? -1 : 1) * (180 + r() * 220), { face: r() * 6.28, anim: 'Schweben', dy: 140 + r() * 160, overlap: true, gap: 20 });
    }
    this._placeLegacyTops(segs);
    // everything that never moves: matrices once, then skipped by three's per-frame scene-graph update (was ~30 % CPU)
    const moving = new Set([...this.mixers.map(m => m.obj), ...this.birds, ...this.whales.map(w => w.obj), ...this.animated]);
    for (const o of this.props) if (!moving.has(o) && !o.userData.walk && !o.userData.circle) { let wheel = false; o.traverse(c => { if (c.userData.millWheel) wheel = true; }); if (!wheel) { freeze(o); o.userData.still = true; } }
    this.scene.updateMatrixWorld(true); // every prop's matrix once: far ones skip the per-frame update and would otherwise sit at the world origin = the start (the mill in the Hafenrunde start view, Mac mini QA)
    const ck = A.by.cockpit?.[0]; // handlebar, hoods and forearms in the rider's view, hung on the camera
    if (ck) { const { obj, mixer } = A.make(ck, 'Treten'); obj.traverse(c => { c.castShadow = false; c.layers.set(1); c.frustumCulled = false; });
      this.camera.add(obj); this.scene.add(this.camera); this.cockpit = obj; this.cockpitMixer = mixer; this._placeCockpit(); }
    this.events = new Events(this, A); // villagers calling out, birds, carts: before batching, which drops the props list
    if (!/[?&]nobatch/.test(location.search)) this._batch();
    // the sea mirror renders the scene a second time (was the biggest GPU cost): only terrain, road and big buildings go in
    for (const o of this.props) if (o.userData.small || o.userData.mid || o.userData.walk || o.userData.circle || o.userData.whale || moving.has(o)) noMirror(o);
  }
  // static batching: every still prop is baked into one mesh per 500 m cell, size class and material (~1500 draw calls -> a few hundred)
  _batch() {
    const CELL = 500, buckets = new Map(), keep = [];
    for (const o of this.props) {
      if (!o.userData.still) { keep.push(o); continue; }
      const cls = o.userData.near ? 'near' : o.userData.far ? 'far' : o.userData.small ? 'small' : o.userData.mid ? 'mid' : 'big';
      const C = cls === 'small' || cls === 'near' || cls === 'far' ? CELL / 2 : CELL, cx = Math.floor(o.position.x / C), cz = Math.floor(o.position.z / C);
      o.traverse(m => {
        if (!m.isMesh || m.isSkinnedMesh || Array.isArray(m.material)) return;
        const g = m.geometry, sig = Object.keys(g.attributes).sort().join(',') + (g.index ? ':i' : ':n');
        const key = `${cx},${cz},${cls},${m.material.uuid},${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0},${sig}`;
        let b = buckets.get(key); if (!b) buckets.set(key, b = { cls, mat: m.material, cast: m.castShadow, recv: m.receiveShadow, list: [], x: 0, z: 0 });
        b.list.push(g.clone().applyMatrix4(m.matrixWorld)); b.x += o.position.x; b.z += o.position.z;
      });
      this.scene.remove(o);
    }
    for (const b of buckets.values()) {
      const cx = b.x / b.list.length, cz = b.z / b.list.length;
      const g = mergeGeometries(b.list, false); b.list.forEach(x => x.dispose()); if (!g) continue;
      g.translate(-cx, 0, -cz); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, b.mat); mesh.position.set(cx, 0, cz); mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
      mesh.userData.small = b.cls === 'small'; mesh.userData.mid = b.cls !== 'big'; mesh.userData.rad = g.boundingSphere.radius;
      mesh.userData.near = b.cls === 'near'; mesh.userData.far = b.cls === 'far';
      if (b.cls !== 'big') noMirror(mesh);
      this.scene.add(mesh); freeze(mesh); keep.push(mesh);
    }
    this.props = keep;
  }
  // real routes: concrete bridges (deck slab, parapets, piers into the water) where the road crosses a sound
  _bridges() {
    const f = this.field, list = this.track.dem?.bridges || []; if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a8781, roughness: 0.9 }), box = new THREE.BoxGeometry(1, 1, 1);
    const parts = { slab: [], wall: [], pier: [], rail: [] }, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), P = new THREE.Vector3(), S = new THREE.Vector3();
    for (const [a, b] of list) {
      for (let d = a - 10; d < b + 10; d += 5) {
        const p = f.at(d), l = Math.hypot(p.tx, p.tz) || 1, ang = Math.atan2(p.tx, p.tz), rx = -p.tz / l, rz = p.tx / l;
        const p2 = f.at(d + 5), grade = Math.atan2(p2.e - p.e, 5); q.setFromEuler(new THREE.Euler(-grade, ang, 0, 'YXZ'));
        parts.slab.push(m4.compose(P.set(p.x, p.e - 0.55, p.z), q, S.set(ROAD_W * 2 + 1.6, 1.0, 5.2)).clone());
        for (const s of [-1, 1]) { // low concrete parapet with a steel rail on top (~1.05 m)
          parts.wall.push(m4.compose(P.set(p.x + rx * s * (ROAD_W + 0.6), p.e + 0.2, p.z + rz * s * (ROAD_W + 0.6)), q, S.set(0.32, 0.6, 5.2)).clone());
          parts.rail.push(m4.compose(P.set(p.x + rx * s * (ROAD_W + 0.6), p.e + 1.0, p.z + rz * s * (ROAD_W + 0.6)), q, S.set(0.08, 0.08, 5.2)).clone()); }
        if (Math.round((d - a) / 5) % 7 === 3 && d > a + 5 && d < b - 5) { const g = Math.min(-2, f.height(p.x + rx * 9, p.z + rz * 9)); // pier pair down to the bottom
          for (const s of [-1, 1]) parts.pier.push(m4.compose(P.set(p.x + rx * s * 2.2, (p.e - 1 + g) / 2, p.z + rz * s * 2.2), q.setFromAxisAngle(up, ang), S.set(1.6, p.e - 1 - g, 2.2)).clone()); }
      }
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.4, metalness: 0.6 });
    for (const k in parts) { const im = new THREE.InstancedMesh(box, k === 'rail' ? steel : mat, parts[k].length); parts[k].forEach((x, i) => im.setMatrixAt(i, x));
      im.castShadow = k !== 'slab'; im.receiveShadow = true; im.computeBoundingSphere(); this.scene.add(im); }
    console.info('RIDEFRAME Brücken', list.length);
  }
  // real routes: rock tunnels (closed tube with lamps, concrete portals) and avalanche galleries (roof + hill wall, open pillars on the sea side)
  _tunnels() {
    const f = this.field, list = this.track.dem?.tunnels || [], kinds = this.track.dem?.tunnelKinds || []; if (!list.length) return;
    const wall = new THREE.MeshStandardMaterial({ color: 0xd2cec6, roughness: 0.9, side: THREE.DoubleSide, map: concreteTex(false), emissive: 0x1c160e, emissiveIntensity: 0.4 }); // light shotcrete, a warm sodium glow
    const conc = new THREE.MeshStandardMaterial({ color: 0xb4b0a8, roughness: 0.95, map: concreteTex(true) });
    const concD = new THREE.MeshStandardMaterial({ color: 0xb4b0a8, roughness: 0.95, side: THREE.DoubleSide, map: concreteTex(true) }); let collar = null;
    const lampM = new THREE.MeshBasicMaterial({ color: 0xffc27a }), box = new THREE.BoxGeometry(1, 1, 1);
    const lamps = [], cols = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();
    const W = ROAD_W + 1.4, H = 6.2, K = 14; // half width, height, arch segments
    list.forEach(([a, b], k) => {
      const gallery = kinds[k] === 'avalanche_protector', pos = [], idx = [];
      const p0 = f.at(a + 5), l0 = Math.hypot(p0.tx, p0.tz) || 1;
      const hill = gallery ? (f.height(p0.x - p0.tz / l0 * 14, p0.z + p0.tx / l0 * 14) > f.height(p0.x + p0.tz / l0 * 14, p0.z - p0.tx / l0 * 14) ? 1 : -1) : 0;
      const n = Math.max(2, Math.ceil((b - a) / 4)), ring = [];
      for (let i = 0; i <= K; i++) { const t = i / K; // cross-section: walls up, then an arch (galleries: only the hill side and a flat roof)
        if (gallery) ring.push(t < 0.4 ? [hill * W, (t / 0.4) * H] : [hill * W * (1 - (t - 0.4) / 0.6 * 2), H]);
        else { const ang = Math.PI * t; ring.push([Math.cos(ang) * W, t < 0.08 || t > 0.92 ? H * 0.55 * (t < .5 ? t / 0.08 : (1 - t) / 0.08) : H * 0.55 + Math.sin(ang) * H * 0.45]); } }
      // close the floor between the asphalt edge and the walls, so nothing outside shows through below
      if (gallery) ring.unshift([hill * (ROAD_W - 0.1), -0.02]); else { ring.unshift([ROAD_W - 0.1, -0.02]); ring.push([-(ROAD_W - 0.1), -0.02]); }
      const R = ring.length - 1;
      if (!gallery && !collar) { const sh = new THREE.Shape(); sh.moveTo(-W - 0.2, -0.3); sh.lineTo(W + 0.2, -0.3); sh.lineTo(W + 0.2, H + 0.8); sh.lineTo(-W - 0.2, H + 0.8); sh.closePath();
        const arch = ring.slice(1, -1).map(([u, v]) => new THREE.Vector2(u * 0.98, v * 0.98)); arch.push(new THREE.Vector2(arch[arch.length - 1].x, -0.3), new THREE.Vector2(arch[0].x, -0.3));
        sh.holes.push(new THREE.Path(arch)); collar = new THREE.ShapeGeometry(sh); const uv = collar.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 8, uv.getY(i) / 8); }
      for (let j = 0; j <= n; j++) {
        const d = a + (b - a) * j / n, p = f.at(d), l = Math.hypot(p.tx, p.tz) || 1, rx = -p.tz / l, rz = p.tx / l;
        for (const [u, v] of ring) pos.push(p.x + rx * u, p.e - 0.3 + v, p.z + rz * u);
        if (j < n) for (let i = 0; i < R; i++) { const A = j * (R + 1) + i, B = A + R + 1; idx.push(A, B, A + 1, A + 1, B, B + 1); }
        if (j % 4 === 2) lamps.push(m4.compose(P.set(p.x, p.e - 0.3 + H - 0.25, p.z), q.setFromAxisAngle(_v.set(0, 1, 0), Math.atan2(p.tx, p.tz)), S.set(0.5, 0.12, 2.2)).clone());
        if (gallery && j % 2 === 0) cols.push(m4.compose(P.set(p.x - rx * hill * W, p.e - 0.3 + H / 2, p.z - rz * hill * W), q.setFromAxisAngle(_v.set(0, 1, 0), Math.atan2(p.tx, p.tz)), S.set(0.6, H, 0.8)).clone());
      }
      const uvs = []; for (let j = 0; j <= n; j++) for (let i = 0; i <= R; i++) uvs.push((b - a) * j / n / 6, i / R * 3);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals();
      const tube = new THREE.Mesh(g, wall); tube.castShadow = true; tube.receiveShadow = true; this.scene.add(tube); (this.tunnelMeshes ||= []).push(tube); // __world.tunnelMeshes: perf checks on the Mac
      if (!gallery) for (const [dd, dir] of [[a, 1], [b, -1]]) { // concrete portal frame at both mouths
        const p = f.at(dd + dir * 2), ang = Math.atan2(p.tx, p.tz); E.set(0, ang, 0); q.setFromEuler(E);
        const fr = new THREE.Group(); fr.position.set(p.x, p.e - 0.3, p.z); fr.quaternion.copy(q);
        for (const [x, y, w, h] of [[-W - 2, H * 0.6, 4, H * 1.2], [W + 2, H * 0.6, 4, H * 1.2], [0, H + 2.6, W * 2 + 8, 4]]) { // tall headwall: also hides the cut-open slot above the mouth
          const m = new THREE.Mesh(box, conc); m.position.set(x, y, 0); m.scale.set(w, h, 1.6); m.castShadow = true; fr.add(m); }
        fr.add(new THREE.Mesh(collar, concD)); // closes the corners between the arch and the rectangular frame
        this.scene.add(fr);
      }
    });
    if (lamps.length) { const im = new THREE.InstancedMesh(box, lampM, lamps.length); lamps.forEach((x, i) => im.setMatrixAt(i, x)); im.computeBoundingSphere(); this.scene.add(im); }
    if (cols.length) { const im = new THREE.InstancedMesh(box, conc, cols.length); cols.forEach((x, i) => im.setMatrixAt(i, x)); im.castShadow = true; im.computeBoundingSphere(); this.scene.add(im); }
    console.info('RIDEFRAME Tunnel', list.length);
  }
  _placeLegacyTops(segs) { // castle + lookout have no Blender model yet: keep the built-in ones
    const f = this.field;
    for (const s of segs) {
      if (s.top !== 'castle' && s.top !== 'lookout') continue;
      const d = s.top === 'castle' ? s.to + 70 : s.to + 40, side = s.top === 'castle' ? 1 : -1, off = s.top === 'castle' ? 34 : 12;
      const p = f.at(d), l = Math.hypot(p.tx, p.tz), x = p.x - p.tz / l * off * side, z = p.z + p.tx / l * off * side;
      const rr = f.road(x, z); if (!rr || rr.d < (s.top === 'castle' ? 22 : 9)) continue;
      const o = house(s.top); o.position.set(x, f.height(x, z) - 0.15, z); o.rotation.y = Math.atan2(p.tx, p.tz);
      this.scene.add(o); o.traverse(c => { if (c.userData.flag) this.animated.push(c); });
    }
  }

  _ensure(cx, cz) {
    // road chunks within 2 km
    const f = this.field, k0 = Math.floor((this._fly?.d ?? this.d) / 500); // in flight the road is built under the camera
    for (let k = k0 - 2; k <= k0 + 4; k++) if (k >= 0 && !this.roadChunks.has(k)) { const c = this._roadChunk(k); if (c) { this.scene.add(c); freeze(c); this.roadChunks.set(k, c); } }
    for (const [k, c] of this.roadChunks) if (k < k0 - 3 || k > k0 + 6) { this.scene.remove(c); c.traverse(o => o.geometry?.dispose?.()); this.roadChunks.delete(k); }
    // tiles: resolution by distance
    const want = new Map(), R = Math.ceil(VIEW / TILE), tx0 = Math.floor(cx / TILE), tz0 = Math.floor(cz / TILE);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      const tx = tx0 + a, tz = tz0 + b, dist = Math.hypot((tx + .5) * TILE - cx, (tz + .5) * TILE - cz);
      if (dist > VIEW) continue;
      want.set(tx + ',' + tz, { tx, tz, dist, res: dist < 260 ? 96 : dist < 600 ? 48 : dist < 1200 ? 24 : 12 });
    }
    for (const [key, t] of this.tiles) {
      const w = want.get(key);
      if (!w) { this.scene.remove(t.obj); t.obj.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); this.tiles.delete(key); }
    }
    const todo = [...want.entries()].filter(([key, w]) => { const t = this.tiles.get(key); return !t || t.res !== w.res; }).sort((a, b) => a[1].dist - b[1].dist);
    this.pending = todo.length;
    const budget = this.instant ? 999 : 1, t0 = performance.now();
    for (const [key, w] of todo) {
      if (!this.instant && performance.now() - t0 > (this.loading ? 45 : 12)) break;
      const old = this.tiles.get(key);
      const obj = this._tile(w.tx, w.tz, w.res); this.scene.add(obj); freeze(obj); this.built = true;
      if (old) { this.scene.remove(old.obj); old.obj.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
      this.tiles.set(key, { obj, res: w.res });
      if (!this.instant && budget <= 1 && performance.now() - t0 > 6) break;
    }
    let hole = 1780; // radius around the camera fully covered by detailed tiles
    for (const [key, w] of want) if (!this.tiles.has(key)) hole = Math.min(hole, Math.max(0, w.dist - TILE * 0.75));
    this.farHole.value = hole;
    // fast preview: a road chunk shows only once the ground under it stands, never as a band in the sky
    const has = d => { const q = f.at(Math.min(d, this.track.length)); return this.tiles.has(Math.floor(q.x / TILE) + ',' + Math.floor(q.z / TILE)); };
    for (const [k, c] of this.roadChunks) c.visible = k <= k0 + 1 || has(k * 500) && has(k * 500 + 250); // the road under and just ahead of the rider always shows
    if (this.loading && hole >= 500) { this.loading = false; // compile every shader of the start area first: no stutter in the first seconds
      const warm = new THREE.Group(); // plus the flight and hell visitors (their first frame stalled 0.4 s), compiled while the loading screen still shows
      if (ASSETS.count) for (const n of ['vogelschwarm_hoch', 'fledermaeuse', 'drache', 'gluehende_kohle_haufen', 'feuerdaemon', 'lava_fels', 'feuersaeule']) { const e = ASSETS.find(n); if (e) { const o = ASSETS.make(e, null).obj; o.position.copy(this.camera.position); o.position.y -= 400; warm.add(o); } }
      this.scene.add(warm); const done = () => { this.scene.remove(warm); this._readyRes(); };
      (this.renderer.compileAsync ? this.renderer.compileAsync(this.scene, this.camera) : Promise.resolve()).then(done, done); }
  }

  _far(cx, cz) { // 16 km backdrop (60 m grid) for peaks and islands; rebuilt every 2 km, a few rows per frame
    const key = Math.round(cx / 2000) + ',' + Math.round(cz / 2000);
    if (this.farKey !== key && !this.farJob) {
      this.farKey = key;
      const S = 16000, N = 266, ox = Math.round(cx / 2000) * 2000, oz = Math.round(cz / 2000) * 2000;
      const g = new THREE.PlaneGeometry(S, S, N, N); g.rotateX(-Math.PI / 2);
      this.farJob = { g, ox, oz, i: 0, n: g.attributes.position.count };
    }
    const J = this.farJob; if (!J) return;
    const p = J.g.attributes.position, t0 = performance.now();
    while (J.i < J.n && (this.instant || !this.farMesh || performance.now() - t0 < 4)) {
      const e = Math.min(J.n, J.i + 300);
      for (let i = J.i; i < e; i++) p.setY(i, this.field.height(p.getX(i) + J.ox, p.getZ(i) + J.oz) - 1.5);
      J.i = e;
    }
    if (J.i < J.n) return;
    const g = J.g; g.computeVertexNormals();
    const col = new Float32Array(p.count * 3), nrm = g.attributes.normal, spl = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) paint(this.field, p.getX(i) + J.ox, p.getZ(i) + J.oz, p.getY(i), nrm.getY(i), col, spl, i);
    g.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (this.farMesh) { this.scene.remove(this.farMesh); this.farMesh.geometry.dispose(); }
    this.farMesh = new THREE.Mesh(g, this.farMat); this.farMesh.position.set(J.ox, 0, J.oz); this.farMesh.receiveShadow = true; this.scene.add(this.farMesh); freeze(this.farMesh);
    this.farJob = null;
  }

  /** Lens as a full-frame focal length (14 mm = very wide). null keeps the default 62° vertical view. */
  setLens(mm) { this.lensMm = mm || null; this.fovDeg = null; this._applyLens(); this.camera.updateProjectionMatrix(); this._placeCockpit(); }
  /** flight: an empty shadow map (depth cleared to far = lit everywhere) and no re-render; same look as shadows off, but no shader recompile */
  _blankShadow() { const r = this.renderer, t = this.light.shadow.map; if (!t) return; const prev = r.getRenderTarget(), c = r.getClearColor(new THREE.Color()), a = r.getClearAlpha();
    r.setRenderTarget(t); r.setClearColor(0xffffff, 1); r.clear(true, true, false); r.setRenderTarget(prev); r.setClearColor(c, a); }
  /** field of view like in Minecraft: vertical angle in degrees (30 zoomed in … 62 normal … 110 very wide) */
  setFov(deg) { this.fovDeg = deg || null; this.lensMm = null; this._applyLens(); this.camera.updateProjectionMatrix(); this._placeCockpit(); }
  _placeCockpit() { // aim the hoods at fixed screen spots for every lens (reference photo: hood tops at ~67 % height, hoods at 19 % / 81 % width)
    const ck = this.cockpit; if (!ck) return;
    if (!this.ckGeo) { // hood width and height from the bar itself (model: bar centre 0.45 m below / 0.55 m ahead of the eye)
      const bar = ck.getObjectByName('lenker'), b = new THREE.Box3();
      if (bar) { ck.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(ck.matrixWorld).invert(); b.setFromObject(bar).applyMatrix4(inv); }
      this.ckGeo = bar && !b.isEmpty() ? { hx: Math.max(0.12, (b.max.x - b.min.x) / 2 * 0.874), top: b.max.y + 0.45 } : { hx: 0.208, top: 0.065 };
    }
    const { hx, top } = this.ckGeo, tv = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), th = tv * this.camera.aspect;
    const D = 0.42, X = this.cockpitX ?? 0.62, Y = this.cockpitY ?? -0.34; // top bar just below the HUD strip, only hoods and forearms show // target NDC
    const s = X * D * th / hx, yTop = Y * D * tv;
    ck.scale.setScalar(s); ck.position.set(0, yTop - top * s + 0.45 * s, -D + 0.55 * s);
  }

  _applyLens() {
    if (this.fovDeg) { this.camera.fov = this.fovDeg; return; }
    if (!this.lensMm) { this.camera.fov = FOV_NORMAL; return; }
    const h = 2 * Math.atan(36 / (2 * this.lensMm)); // horizontal angle of a 36 mm wide sensor
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / this.camera.aspect));
  }
  /** 0 = rider's eyes, 1 = chase view from behind and above, 2 = looking back */
  setView(v) { this.view = v; this.lookPos = null; }
  /** speed blur: the screen edges and the ground close by smear when you go fast (CSS backdrop blur with a radial mask, cheap) */
  _speedBlur(k) {
    if (this.instant || this._shot) k = 0;
    if (!this._blurEl) {
      if (!k || !this.c.parentElement) return;
      const el = this._blurEl = document.createElement('div');
      Object.assign(el.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: 0, opacity: 0, backdropFilter: 'blur(6px)', webkitBackdropFilter: 'blur(6px)',
        maskImage: 'radial-gradient(ellipse 62% 52% at 50% 42%, transparent 55%, rgba(0,0,0,.55) 78%, #000 100%)',
        webkitMaskImage: 'radial-gradient(ellipse 62% 52% at 50% 42%, transparent 55%, rgba(0,0,0,.55) 78%, #000 100%)' });
      this.c.after(el); // right above the 3D view, below the HUD
    }
    const o = Math.round(k * 20) / 20; if (o !== this._blurO) { this._blurO = o; this._blurEl.style.opacity = o; this._blurEl.style.display = o ? '' : 'none'; }
  }
  /** one picture of you on the bike for the share image (next frame); resolves with a 1080×810 canvas */
  snapshot() { return new Promise(res => { this._shot = res; }); }
  /** turn the head and look back for a moment (side +1 over the left shoulder, -1 over the right) */
  lookBack(side = 1) { if (!this._lb && !this.view && !this._shot) this._lb = { t: 0, side }; }
  setCockpit(on) { this.showCockpit = on; }
  /** the theme of the village at d (stadtfest, hochzeit, kirchenfest, beerdigung, markt) or null */
  villageTheme(d) { return this.villageThemes?.find(v => d > v.a - 120 && d < v.b + 60)?.theme || null; }
  /** the wizard's gift: for dur seconds the camera lifts off and flies ahead over the island */
  fly(dur = 30) { if (!this.instant) this._fly = { t: 0, dur, fd: 0, sp: 0, h: null }; }
  /** the ride ends the flight (its clock rules, also when you stop pedalling and the world pauses) */
  land() { if (this._fly) { this._fly = null; this.lookPos = null; } }
  /** the wizard's curse: the world sinks into red haze, lava water and ember light (eased in and out) */
  hell(on) { this._hellTo = on ? 1 : 0; }
  /** other riders (group ride, ghost): [{ id, name, d, v }] */
  setRiders(list) { (this.riders ||= new Riders(this.scene, this.field)).set(list); }

  _camera(d, dt = 1 / 60) {
    // exact rider pose on the spline; only the view direction is damped (time based, frame-rate independent)
    const p = this.field.pose(d), cam = new THREE.Vector3(p.x, p.y, p.z), look = new THREE.Vector3(p.lx, p.ly, p.lz);
    // speed along the road (also huge jumps while scrubbing the preview)
    const dd = this._prevD !== undefined ? d - this._prevD : 0, v = dt > 0 ? Math.max(0, dd / dt) : 0; this._prevD = d;
    // the damped view must keep up with fast scrubbing, otherwise the camera overtakes its own look point and stares backwards
    const ahead = this.lookPos && (this.lookPos.x - cam.x) * (look.x - cam.x) + (this.lookPos.z - cam.z) * (look.z - cam.z) <= 0;
    if (!this.lookPos || this.instant || ahead || Math.abs(dd) > 12 || cam.distanceTo(this.camera.position) > 40) this.lookPos = look.clone();
    else this.lookPos.lerp(look, 1 - Math.exp(-dt * 7 * Math.max(1, (this.playbackRate || 1) / 3, Math.abs(dd) / dt / 15))); // fast preview: the view keeps up
    this.camera.position.copy(cam); this.camera.lookAt(this.lookPos);
    // speed: wind streaks and a light shake when it gets fast (downhill)
    this.speed = (this.speed || 0) + (Math.min(v, 30) - (this.speed || 0)) * Math.min(1, dt * 2);
    const fast = Math.max(0, Math.min(1, (this.speed * 3.6 - 32) / 28)); this.fast = fast; // 0 at 32 km/h, 1 at 60 km/h
    if (this.view === 1) { // chase: 7 m behind, 3 m up, never inside the hillside
      const bx = cam.x - this.lookPos.x, bz = cam.z - this.lookPos.z, bl = Math.hypot(bx, bz) || 1;
      const x = cam.x + bx / bl * 7, z = cam.z + bz / bl * 7, y = Math.max(cam.y + 2.4, this.field.height(x, z) + 1.8);
      this.camera.position.set(x, y, z); this.camera.lookAt(this.lookPos.x, this.lookPos.y + 0.6, this.lookPos.z);
    } else if (this.view === 2) this.camera.lookAt(2 * cam.x - this.lookPos.x, this.lookPos.y, 2 * cam.z - this.lookPos.z);
    if (!this.instant && this.view !== 2 && !QS.has('nolean')) { // lean into curves like a bike: half the real lean from speed and radius, at most ~7°
      const qa = this.field.at(d + 2), qb = this.field.at(d + 14);
      let dh = Math.atan2(qb.tx, qb.tz) - Math.atan2(qa.tx, qa.tz); dh = Math.atan2(Math.sin(dh), Math.cos(dh)); // > 0: left bend
      const lean = Math.max(-0.12, Math.min(0.12, Math.atan(this.speed * this.speed * dh / 12 / 9.81) * 0.5));
      this._lean = (this._lean || 0) + (lean - (this._lean || 0)) * Math.min(1, dt * 2.5);
      if (Math.abs(this._lean) > 1e-4) this.camera.quaternion.multiply(_lbQ.setFromAxisAngle(_lbZ, this._lean));
    }
    if (fast > 0 && !this.instant) { const t = performance.now() / 1000, a = fast * 0.0015;
      this.camera.rotation.z += Math.sin(t * 23) * a + Math.sin(t * 37) * a * 0.6; this.camera.rotation.x += Math.sin(t * 29) * a * 0.7; }
    if (this.shakeImpulse > 0.01 && !this.instant) { const t = performance.now() / 1000, a = this.shakeImpulse * 0.014; // explosions (siege.js)
      this.camera.rotation.x += Math.sin(t * 41) * a + Math.sin(t * 17) * a * 0.5; this.camera.rotation.y += Math.sin(t * 33) * a * 0.6; this.camera.rotation.z += Math.sin(t * 27) * a * 0.7;
      this.shakeImpulse *= Math.exp(-dt * 2.8); }
    if (this._fly) { // flight: up to ~220 m above the route, speeding ahead along it, looking ahead and down; snaps back at the end
      const f = this._fly, ft = this.paused ? 0 : dt; f.t += ft; const u = f.t / f.dur;
      if (f.t >= f.dur * 3) this.land(); // fallback only: normally the ride lands you
      else {
        f.sp = Math.min(62, f.sp + ft * (f.t < 3 ? 4 : 9)); f.fd += f.sp * ft; // gentle lift-off, then real speed
        const L = this.track.length - 1, a = this.field.pose(Math.min(L, d + f.fd)), b = this.field.pose(Math.min(L, d + f.fd + 30 + 390 * smooth(0, 0.15, u)));
        const lift = 220 * smooth(0, 0.28, u), ground = Math.max(a.y, this.field.height(a.x, a.z), 0); if (f.h == null) f.h = cam.y;
        f.h = Math.max(f.h + (ground + 3 + lift - f.h) * Math.min(1, dt * 1.6), this.field.height(a.x, a.z) + 25 * smooth(0, 0.06, u)); // never through a ridge
        f.y = f.y == null ? cam.y : f.y + (f.h - f.y) * Math.min(1, dt * 2.5);
        let top = this.field.height(a.x, a.z); for (const k of [60, 140]) { const q = this.field.at(Math.min(L, d + f.fd + k)); top = Math.max(top, this.field.height(q.x, q.z)); }
        f.y = Math.max(f.y, top + 4 + 21 * smooth(0, 0.06, u)); // never inside a ridge or a tunnel mountain, even while easing
        f.d = d + f.fd;
        this.camera.position.set(a.x, f.y, a.z);
        const lb = Math.max(b.y, this.field.height(b.x, b.z), 0); this.camera.lookAt(b.x, lb + (f.y - lb) * 0.35, b.z);
        this.camera.rotation.z += Math.sin(f.t * 0.45) * 0.07 * smooth(0, 0.2, u); // a slow bank like a gliding bird
        cam.set(a.x, a.y, a.z); // tiles, shadows and props follow the flight
      }
    }
    if (this._lb) { // a quick look over the shoulder at the challenger behind you (challenges)
      this._lb.t += dt; const u = this._lb.t / 1.7;
      if (u >= 1) this._lb = null; else { _lbQ.setFromAxisAngle(_lbY, Math.sin(u * Math.PI) ** 0.7 * 2.5 * this._lb.side); this.camera.quaternion.premultiply(_lbQ); }
    }
    if (this._shot) { // share photo: you from the front-left, a few metres ahead, the landscape behind you
      const t = this.field.pose(d, 1.2, 1.0), c = this.field.pose(d + 7.5, -0.4, 1.8), y = Math.max(c.y, this.field.height(c.x, c.z) + 1.2);
      this.camera.position.set(c.x, y, c.z); this.camera.rotation.set(0, 0, 0); this.camera.lookAt(t.x, t.y + 0.15, t.z);
      this.camera.fov = 52; this.camera.updateProjectionMatrix();
    }
    if (this.debugTop) { this.camera.position.set(cam.x, cam.y + this.debugTop, cam.z + 0.01); this.camera.lookAt(cam.x, cam.y, cam.z); } // test view from above
    return cam;
  }

  _loop(now) {
    if (this.dead) return;
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (!this.paused) this.currentTime = Math.min(this.duration, this.currentTime + dt * this.playbackRate);
    if (this.instant && !this.texOk) { if (!this.texWait) this.texWait = texReady().then(() => this.texOk = true); requestAnimationFrame(this._loop); return; }
    if (this.instant) { this.shotWait = (this.shotWait || 0) + 1; if (this.shotDone || (this.currentTime <= 0 && this.shotWait < 20)) { if (!this.shotDone) requestAnimationFrame(this._loop); return; } this.render(10); this.shotDone = true; window.__shot = true; return; }
    if (!this.sleep) this.render(now / 1000, dt); // sleep: the Unreal view draws the world, keep the GPU for it
    requestAnimationFrame(this._loop);
  }

  // ---- weather: the evening develops along the ride ----
  // The midnight sun sinks from 6.5° to 2° and swings towards north, the light reddens a little (direct light stays
  // moderate so granite stays grey), cloud cover drifts along the route and a stratus band can veil the sun.
  // Everything is a smooth function of the distance (plus a slow drift in time), so it never jumps.
  _weather(d, time) {
    const L = this.track.length || 40000, u = Math.max(0, Math.min(1, d / L));
    const rain = this.rainPlan.reduce((m, s) => Math.max(m, smooth(s.a - 700, s.a, d) * smooth(s.b + 500, s.b, d)), 0) * (1 - (this.hellK || 0)) * (1 - (this._flyK = (this._flyK || 0) + ((this._fly ? 1 : 0) - (this._flyK || 0)) * 0.02)); // showers: at least one per ride, never the same
    const cover0 = Math.max(0.1, Math.min(0.8, 0.32 + 0.2 * Math.sin(d / 5200 + 1.3) + 0.1 * Math.sin(d / 1700 + 4) + 0.06 * Math.sin(time * 0.003)));
    // the shower announces itself: from ~3 km before, the sky ahead closes up and darkens, so you see it coming
    const pre = this.rainPlan.reduce((m, s) => Math.max(m, smooth(s.a - 3000, s.a - 700, d) * smooth(s.b + 500, s.b, d)), 0);
    const cover = lerp(cover0, 0.95, Math.max(rain, pre * 0.85)), veil = Math.max(smooth(0.3, 0.95, 0.5 + 0.5 * Math.sin(d / 6100 + 2.6)) * (0.4 + 0.6 * cover0), rain * 0.95, pre * 0.55);
    const s = sunAt(u, this.sunDir); this.sunY = s.y; const low = 1 - Math.max(0, Math.min(1, (s.y - 0.035) / (0.113 - 0.035)));
    const su = this.sky.material.uniforms;
    su.sunPosition.value.copy(s); su.uCover.value = cover; su.uVeil.value = veil; su.uLow.value = low;
    // direct light: warm, a bit warmer as the sun sinks, dimmer behind the veil; never orange enough to rust the rock
    this.light.color.lerpColors(W_HIGH, W_LOW, low);
    this.light.intensity = 3.7 * (1 - 0.38 * veil) * (1 - 0.12 * cover) * (1 - 0.12 * low) * (1 - 0.8 * (this.tunnelK || 0));
    this.hemi.intensity = (1.2 + 0.12 * cover + 0.05 * veil) * (1 - 0.5 * (this.tunnelK || 0)); // shadow slopes ~40 % of the sunlit side, not black; dim inside rock tunnels
    this.hemi.color.lerpColors(H_CLEAR, H_GREY, cover * 0.7);
    // haze: cool lavender away from the sun, glowing red-orange towards it (weaker behind the veil)
    this.scene.fog.color.lerpColors(F_CLEAR, F_GREY, cover * 0.6);
    FOG_SUN.x = s.x; FOG_SUN.y = s.y; FOG_SUN.z = s.z;
    const g = (1 - 0.45 * veil) * (0.85 + 0.3 * low);
    FOG_SUNCOL.x = 0.55 * g; FOG_SUNCOL.y = (0.3 - 0.07 * low) * g; FOG_SUNCOL.z = (0.1 - 0.04 * low) * g; // golden glow towards the sun
    const wu = this.water.material.uniforms;
    wu.sunDirection.value.copy(s); wu.sunColor.value.lerpColors(WS_HIGH, WS_LOW, low).multiplyScalar(1 - 0.5 * veil);
    // deep North-Sea blue-green under a clear sky, dull slate grey-blue under cloud, veil and rain (Freddy: never a glowing cyan)
    wu.waterColor.value.lerpColors(WC_CLEAR, WC_GREY, Math.min(1, cover * 0.7 + veil * 0.5 + (this.weather?.rain || 0)));
    this.clouds.material.uniforms.uSun.value.copy(s); this.clouds.material.uniforms.uCover.value = cover;
    this.clouds.material.uniforms.uLow.value = low;
    { const cu = this.cumulus.material.uniforms; cu.uSun.value.copy(s); cu.uCover.value = cover; cu.uLow.value = low; cu.uVeil.value = veil; }
    // image-based light from the sky, re-baked only when the sun has moved noticeably (~0.2°)
    const hb = (this.hellK || 0) > 0.5; if (hb !== !!this._envHell) { this._envHell = hb; this.envSun = null; } // hell in, hell out: re-bake the sky light
    if (hb !== !!this._herdHell) { this._herdHell = hb; // no grazing cows in hell (Mac mini QA): farm animals leave while the screen burns red, and come back after
      const herd = this.props.filter(o => /kuh|schaf|pferd|rentier|ziege|schwein|huhn|gans|pony/.test(o.userData.asset || ''));
      if (hb) { this._herdBack = null; for (const o of herd) { o.userData.hellHidden = true; o.visible = false; } }
      else { const c = this.camera.position; this._herdBack = herd.sort((p, q) => p.position.distanceToSquared(c) - q.position.distanceToSquared(c)); } }
    if (this._herdBack?.length) for (let k = 0; k < 2 && this._herdBack.length; k++) this._herdBack.shift().userData.hellHidden = false; // back two per frame: all ~15 skinned animals in one frame stalled it 0.7 s (Mac mini QA)
    if (!this.envSun || this.envSun.distanceToSquared(s) > 1.2e-5) {
      (this.envSun ||= new THREE.Vector3()).copy(s);
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 9000);
      this.envRT?.dispose(); this.envRT = rt; this.scene.environment = rt.texture;
    }
    this.scene.fog.density = 0.00042 * (1 + 2.2 * rain);
    this.rain.visible = rain > 0.02 && !(this.tunnelK > 0.5); this.rain.material.uniforms.uRain.value = rain;
    this.light.intensity *= 1 - 0.35 * rain; this.hemi.color.lerp(H_GREY, rain * 0.5);
    const hk = this.hellK || 0; HELL.value = hk;
    if (hk > 0.002) { // the wizard's hell: red-brown haze closing in, ember light, lava instead of sea, clouds like smoke
      this.scene.fog.color.lerp(F_HELL, hk); this.scene.fog.density *= 1 + 2.4 * hk;
      this.light.color.lerp(L_HELL, hk * 0.85); this.light.intensity *= 1 - 0.4 * hk;
      this.hemi.color.lerp(H_HELL, hk * 0.8); this.hemi.intensity *= 1 - 0.25 * hk;
      FOG_SUNCOL.x = lerp(FOG_SUNCOL.x, 0.9, hk); FOG_SUNCOL.y = lerp(FOG_SUNCOL.y, 0.12, hk); FOG_SUNCOL.z = lerp(FOG_SUNCOL.z, 0.02, hk);
      wu.distortionScale.value = 3.4 * (1 - hk); // the sea turns to stone: no waves (the shader paints basalt with glowing cracks)
      su.uCover.value = lerp(su.uCover.value, 1, hk * 0.9); su.uVeil.value = lerp(su.uVeil.value, 1, hk * 0.9);
      this.clouds.material.uniforms.uCover.value = lerp(cover, 1, hk); this.cumulus.material.uniforms.uCover.value = lerp(cover, 1, hk);
    }
    this._lightning(hk, time);
    this.weather = { cover, veil, rain, pre, hell: hk, sunEl: THREE.MathUtils.radToDeg(Math.asin(s.y)) };
  }

  /** hell's thunderstorm (Freddy): a jagged bolt somewhere ahead every few seconds, the whole scene flashes, thunder follows */
  _lightning(hk, time) {
    const B = this._bolts ||= { next: 0, flash: 0, mesh: null };
    if (hk < 0.5) { if (B.mesh) B.mesh.visible = false; B.next = time + 2; return; }
    if (time >= B.next) {
      B.next = time + 1.8 + Math.random() * 4.2; B.flash = 1;
      const p = this.field.at(this.d + 250 + Math.random() * 650), l = Math.hypot(p.tx, p.tz) || 1, side = (Math.random() - 0.5) * 900;
      const x = p.x - p.tz / l * side, z = p.z + p.tx / l * side, g = Math.max(0, this.field.height(x, z));
      B.mesh ||= (() => { const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xf4e6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
        m.frustumCulled = false; m.renderOrder = 5; this.scene.add(m); return m; })();
      // a ribbon facing the camera, zig-zagging down from the clouds, with one or two side branches
      const cam = this.camera.position, dx = x - cam.x, dz = z - cam.z, dl = Math.hypot(dx, dz) || 1, rx = -dz / dl, rz = dx / dl;
      const pos = [], strip = (pts, w) => { for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]];
        pos.push(a[0] - rx * w, a[1], a[2] - rz * w, a[0] + rx * w, a[1], a[2] + rz * w, b[0] + rx * w, b[1], b[2] + rz * w,
          a[0] - rx * w, a[1], a[2] - rz * w, b[0] + rx * w, b[1], b[2] + rz * w, b[0] - rx * w, b[1], b[2] - rz * w); } };
      const zig = (x0, y0, z0, y1, n, jit) => { const pts = []; for (let i = 0; i <= n; i++) { const f = i / n; pts.push([x0 + (Math.random() - 0.5) * jit * (i ? 1 : 0) + rx * (Math.random() - 0.5) * jit, y0 + (y1 - y0) * f, z0 + rz * (Math.random() - 0.5) * jit]); } return pts; };
      const main = zig(x, g + 700, z, g, 14, 60); strip(main, 3.2);
      for (let k = 0; k < 2; k++) { const s0 = main[3 + Math.floor(Math.random() * 6)]; strip(zig(s0[0], s0[1], s0[2], s0[1] - 160 - Math.random() * 160, 6, 50), 1.6); }
      B.mesh.geometry.dispose(); B.mesh.geometry = new THREE.BufferGeometry(); B.mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const far = Math.hypot(x - cam.x, z - cam.z), pan = Math.max(-0.9, Math.min(0.9, (side / 900) * 1.6));
      setTimeout(() => this.events?.sfx('thunder', Math.max(0.35, 1 - far / 1600), pan), Math.min(3500, far / 343 * 1000 * 0.6));
    }
    B.flash = Math.max(0, B.flash - 0.07); const f = B.flash > 0.6 || (B.flash > 0.3 && B.flash < 0.45) ? 1 : B.flash * 0.4; // a double flicker, then it fades
    if (B.mesh) { B.mesh.visible = B.flash > 0.25; B.mesh.material.opacity = Math.min(1, B.flash * 1.4); }
    if (f > 0.01) { this.light.intensity *= 1 + 2.6 * f; this.hemi.intensity *= 1 + 3.5 * f; this.hemi.color.lerp(H_BOLT, f * 0.8); this.scene.fog.color.lerp(H_BOLT, f * 0.35); }
  }

  _setQuality(q) {
    this.quality = q; const r = this.renderer;
    if (q < 3) this.useAO = false;
    if (q < 2) { r.setPixelRatio(1); this._w = 0; }
    if (q < 1) {
      this.light.shadow.mapSize.set(1024, 1024); this.light.shadow.map?.dispose(); this.light.shadow.map = null;
      this.reflEvery = 3;
    }
    console.info('RIDEFRAME Grafikstufe', q);
  }
  _measure() { // real frame time, independent of the scene clock; skip the first seconds while tiles stream in
    const now = performance.now(), ft = this._lastNow ? now - this._lastNow : 0; this._lastNow = now;
    if (!this.autoQ || this.instant || !ft || ft > 500) return;
    if (!this.fpsSince) this.fpsSince = now;
    // judge rendering only: skip the first 8 s and every frame in which terrain tiles were still being built
    if (now - this.fpsSince < 8000) return;
    this.fpsT += ft; this.fpsN++;
    if (this.fpsT > 3000) { const fps = 1000 * this.fpsN / this.fpsT; this.fpsT = this.fpsN = 0; this.fps = fps;
      console.info(`RIDEFRAME ${fps.toFixed(1)} fps · Stufe ${this.quality} · ${this._calls} Draw-Calls · ${(this._tris / 1e6).toFixed(2)} Mio. Dreiecke · ${this.props?.filter(o => o.visible).length} Objekte sichtbar · Kacheln ${this.tiles.size}`);
      this.slow = fps < 45 ? (this.slow || 0) + 1 : 0;
      if (this.slow >= 2 && this.quality > 0) { this.slow = 0; this._setQuality(this.quality - 1); } } // two slow windows in a row
  }
  render(time = 0, dt = 1 / 60) {
    this._measure();
    const c = this.c, W = c.clientWidth || c.width, H = c.clientHeight || c.height;
    const r = this.renderer;
    if (this._w !== W || this._h !== H) {
      r.setSize(W, H, false); this.camera.aspect = W / H; this._applyLens(); this.camera.updateProjectionMatrix(); this._placeCockpit(); this._w = W; this._h = H;
      if (this.useAO && !this.composer) { // ambient occlusion: grounds houses, rocks and grass
        this.composer = new EffectComposer(r); this.composer.addPass(new RenderPass(this.scene, this.camera));
        const ao = this.aoPass = new GTAOPass(this.scene, this.camera, W, H); ao.blendIntensity = 0.85;
        ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.1, samples: 12 });
        this.composer.addPass(ao); this.composer.addPass(new OutputPass());
      }
      if (this.composer) this.composer.setSize(W, H);
    }
    this.d = distAtTime(this.track, this.currentTime);
    this.hellK = (this.hellK || 0) + ((this._hellTo || 0) - (this.hellK || 0)) * Math.min(1, dt * 0.7);
    this._weather(this.d, time);
    const cam = this._camera(this.d, dt);
    const above = this._fly ? this.camera.position.y - this.field.at(this.d).e : 0; // height over the road (the pass route runs at 1800 m: absolute height says nothing)
    if (!QS.has('noshadow')) { const sk = 1 - smooth(25, 60, above); this.light.shadow.intensity = sk; const on = sk > 0.001; if (this.renderer.shadowMap.autoUpdate !== on) { this.renderer.shadowMap.autoUpdate = on; if (!on) this._blankShadow(); } } // in flight: fade shadows out via intensity (no shader recompile: toggling castShadow/shadowMap.enabled froze ~0.9 s on the Mac mini), and stop re-rendering the shadow map
    { const wu = this.water.material.uniforms, hk = smooth(20, 60, above); // from high up (wizard flight) the sea is opaque and its sun glare calmer
      if (wu.alpha) wu.alpha.value = Math.max(lerp(0.86, 1, this.hellK || 0), lerp(0.86, 1, hk)); wu.uHigh.value = hk; if (hk > 0) wu.sunColor.value.multiplyScalar(1 - 0.6 * hk); }
    this._far(cam.x, cam.z); this.farCam.value.set(cam.x, cam.z);
    this._ensure(cam.x, cam.z);
    // shadows follow the rider
    this.light.position.set(cam.x + this.sunDir.x * 400, cam.y + this.sunDir.y * 400 + 40, cam.z + this.sunDir.z * 400);
    this.light.target.position.set(cam.x - this.sunDir.x * 40, cam.y, cam.z - this.sunDir.z * 40);
    this.sky.position.copy(this.camera.position);
    this.roadBlur.value = Math.max(0, Math.min(1, ((this.speed || 0) * 3.6 - 12) / 50));
    this._speedBlur(Math.max(0, Math.min(1, ((this.speed || 0) * 3.6 - 24) / 30)));
    this.streaks.position.copy(this.camera.position); this.streaks.quaternion.copy(this.camera.quaternion); this.streaks.userData.tick(dt, this.speed || 0, this.view === 2 || this._shot ? 0 : this.fast || 0);
    this.water.position.x = Math.round(cam.x / 100) * 100; this.water.position.z = Math.round(cam.z / 100) * 100;
    this.water.material.uniforms.time.value = time * 0.6; this.grassTime.value = time; TIME.value = time;
    { const sd = this.sky.material.uniforms.sunPosition.value, g = this.sunGlow, veil = this.weather?.veil || 0;
      g.position.copy(this.camera.position).addScaledVector(sd, 8200); g.material.opacity = 0.5 * (1 - 0.65 * veil) * (1 - (this.tunnelK || 0)); }
    this.cumulus.material.uniforms.uTime.value = time;
    if (this.rain.visible) { const ru = this.rain.material.uniforms; ru.uTime.value = time; ru.uCam.value.copy(this.camera.position); }
    this.clouds.position.copy(this.camera.position); this.clouds.material.uniforms.uTime.value = time; this.sky.material.uniforms.uTime.value = time;
    for (const o of this.animated) {
      if (o.userData.spin) o.rotation.z = time * 0.6;
      else if (o.userData.flag) o.rotation.y = Math.sin(time * 2.3 + o.id) * 0.25;
      else if (o.userData.bob) { o.position.y = Math.sin(time * 0.9 + o.id) * 0.15 - 0.4; o.rotation.z = Math.sin(time * 0.7 + o.id) * 0.04; }
    }
    this._life(time, dt, cam);
    // scene graph once per frame: otherwise the water mirror pass walks every matrix a second time
    this.scene.matrixWorldAutoUpdate = true; this.scene.updateMatrixWorld(); this.scene.matrixWorldAutoUpdate = false;
    if (this.composer && this.useAO) this.composer.render(); else r.render(this.scene, this.camera);
    if (this._shot) { // grab right after drawing (same task, so the buffer is still there without preserveDrawingBuffer)
      const done = this._shot; this._shot = null; const k = this.c.width, h = this.c.height, cw = Math.min(k, h * 4 / 3), ch = cw * 3 / 4;
      const out = document.createElement('canvas'); out.width = 1080; out.height = 810;
      out.getContext('2d').drawImage(this.c, (k - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, 1080, 810);
      this._applyLens(); this.camera.updateProjectionMatrix(); done(out);
    }
    this._calls = r.info.render.calls; this._tris = r.info.render.triangles;
  }

  _life(time, dt, cam) {
    if (this.field.tunnel) this.tunnelK = lerp(this.tunnelK || 0, this.field.tunnel[Math.max(0, Math.min(this.field.n - 1, Math.round(this.d / DS)))] ? 1 : 0, Math.min(1, dt * 1.5)); // eyes adjust to the tunnel
    if (this.field.tunnel) this.scene.environmentIntensity = ENV_I * (1 - 0.45 * this.tunnelK);
    this.riders?.update(Math.min(dt, 0.1), this.d || 0, !this.view && !this._shot);
    if (!this.props) return;
    this.falls?.update(time, dt, cam);
    this.events?.update(time, dt, cam, this.d);
    this.siege?.update(time, dt, cam, this.d);
    if (this.cockpit) { this.cockpit.visible = !this.view && !this._shot && !this._lb && !this._fly && this.showCockpit !== false && this.camera.fov >= 40; /* narrow lens: forearms would fill the frame */ if (this.cockpit.visible) this.cockpitMixer?.update(Math.min(dt, 0.1) * (0.4 + Math.min(this.speed || 0, 14) / 8)); /* legs capped at a real cadence: at preview speeds they strobe and seem to pedal backwards */ }
    // show only what is near (draw calls), animate only what is close
    if (!this._cullT || time - this._cullT > 0.5 || this.instant) {
      this._cullT = time;
      for (const o of this.props) {
        const dist = Math.hypot(o.position.x - cam.x, o.position.z - cam.z);
        const near = dist - (o.userData.rad || 0) * 0.7; // tree LODs: near and far batch share cell and centre, so exactly one of them shows
        o.visible = !o.userData.hidden && !o.userData.hellHidden && (o.userData.near ? dist < 330 : o.userData.far ? dist >= 330 && near < 1400
          : near < (o.userData.circle ? 900 : o.userData.small ? 450 : o.userData.mid ? 900 : 1600)); // people, animals, barrels: only near
        // moving things (skeletons!) update their matrices only while they can actually move: visible and animated (< 180 m)
        if (o.matrixAutoUpdate !== false) o.matrixWorldAutoUpdate = o.visible && (dist < 180 || !!o.userData.circle || !!o.userData.walk || !!o.userData.whale);
      }
    }
    for (const m of this.mixers) if (m.obj.visible && (m.obj.userData.whale || Math.hypot(m.obj.position.x - cam.x, m.obj.position.z - cam.z) < 180)) m.update(Math.min(dt, 0.1));
    for (const w of this.wheels) w.rotation.x = time * 0.35;
    for (const o of this.props) { const w = o.userData.walk; if (!w || !o.visible) continue; // walk along the road, turn round at the village ends
      w.d += w.v * Math.min(dt, 0.1); if (w.d < w.a || w.d > w.b) { w.v = -w.v; w.d = Math.max(w.a, Math.min(w.b, w.d)); }
      const p = this.field.at(w.d), l = Math.hypot(p.tx, p.tz) || 1, x = p.x - p.tz / l * w.off, z = p.z + p.tx / l * w.off;
      o.position.set(x, this.field.ground(x, z), z); o.rotation.y = Math.atan2(p.tx * Math.sign(w.v), p.tz * Math.sign(w.v)); }
    for (const b of this.birds) { const c = b.userData.circle, a = c.ph + time * c.w;
      b.position.set(c.x + Math.cos(a) * c.R, c.y + Math.sin(time * 0.3 + c.ph) * 4, c.z + Math.sin(a) * c.R); b.rotation.y = -a; }
    const fwd = this.camera.getWorldDirection(_v);
    for (const w of this.whales) { // breach as soon as it is in view ahead (< 380 m), then every ~25 s while near
      const dx = w.obj.position.x - cam.x, dz = w.obj.position.z - cam.z, dist = Math.hypot(dx, dz);
      if (w.until && time > w.until) { w.until = 0; w.obj.userData.hidden = true; w.obj.visible = false; } // the clip ends under water (root -8 m): hide until the next breach
      const inView = (dx * fwd.x + dz * fwd.z) / (dist * Math.hypot(fwd.x, fwd.z) || 1) > 0.6;
      if ((dist < 380 && inView || QS.has('whaletest')) && time > w.next && w.mixer) { console.info(`RIDEFRAME Wal springt, ${Math.round(dist)} m entfernt`); const c = ASSETS.clip(ASSETS.find('buckelwal'), 'Sprung');
        if (c) { const act = w.mixer.clipAction(c); act.reset(); act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; act.play(); w.obj.userData.hidden = false; w.obj.visible = true; w.until = time + c.duration; }
        w.next = time + 22 + Math.random() * 10; }
    }
  }
}

/** Vertical strip hanging down from the border of a (N+1)² grid, same attributes, so neighbouring tiles of a coarser level show no gaps. */
const _conc = {};
function concreteTex(streaks) { // grey concrete (portals: vertical rain streaks and a mossy foot; tube: plain shotcrete), made once each
  if (_conc[streaks]) return _conc[streaks];
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#9a978f'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { const v = 120 + Math.random() * 60 | 0; x.fillStyle = `rgba(${v},${v - 3},${v - 8},.35)`; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  if (streaks) for (let i = 0; i < 70; i++) { const px = Math.random() * 256, len = 40 + Math.random() * 200, g = x.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(40,38,34,.35)'); g.addColorStop(1, 'rgba(40,38,34,0)'); x.fillStyle = g; x.fillRect(px, 0, 1 + Math.random() * 3, len); }
  if (streaks) { const m = x.createLinearGradient(0, 200, 0, 256); m.addColorStop(0, 'rgba(70,90,40,0)'); m.addColorStop(1, 'rgba(70,90,40,.45)'); x.fillStyle = m; x.fillRect(0, 200, 256, 56); }
  const t = _conc[streaks] = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

function skirt(g, N, depth) {
  const P = g.attributes.position, C = g.attributes.color, Sp = g.attributes.splat, Nr = g.attributes.normal;
  const ring = [];
  for (let i = 0; i <= N; i++) ring.push(i);                       // top row
  for (let j = 1; j <= N; j++) ring.push(j * (N + 1) + N);         // right column
  for (let i = N - 1; i >= 0; i--) ring.push(N * (N + 1) + i);     // bottom row
  for (let j = N - 1; j >= 0; j--) ring.push(j * (N + 1));         // left column
  const pos = [], col = [], spl = [], nrm = [], idx = [];
  ring.forEach((v, k) => {
    for (const dy of [0, -depth]) {
      pos.push(P.getX(v), P.getY(v) + dy, P.getZ(v)); col.push(C.getX(v), C.getY(v), C.getZ(v));
      spl.push(Sp.getX(v), Sp.getY(v), Sp.getZ(v), Sp.getW(v)); nrm.push(Nr.getX(v), Nr.getY(v), Nr.getZ(v));
    }
    if (k < ring.length - 1) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const s = new THREE.BufferGeometry();
  s.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); s.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  s.setAttribute('splat', new THREE.Float32BufferAttribute(spl, 4)); s.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); s.setIndex(idx);
  return s;
}

function mergeGeos(list) { // keeps every attribute all parts share (terrain: color + splat, cards: uv)
  const names = Object.keys(list[0].attributes).filter(n => list.every(g => g.attributes[n]));
  const out = Object.fromEntries(names.map(n => [n, []])), idx = []; let off = 0;
  for (const g of list) {
    for (const n of names) for (const v of g.attributes[n].array) out[n].push(v);
    for (const i of g.index.array) idx.push(i + off); off += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  for (const n of names) g.setAttribute(n, new THREE.Float32BufferAttribute(out[n], list[0].attributes[n].itemSize));
  g.setIndex(idx);
  return g;
}

// sun path over the ride (u = 0..1): elevation 6.5° -> 2°, azimuth 36° -> 24° west of north (north = -z, west = -x)
function sunAt(u, out = new THREE.Vector3()) {
  const k = u * u * (3 - 2 * u), el = THREE.MathUtils.degToRad(6.5 - 4.5 * k), az = THREE.MathUtils.degToRad(36 - 12 * u);
  return out.set(-Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}
// light colours (linear) for a high (6.5°) and a low (2°) sun; sky fill clear / overcast; haze clear / overcast
const W_HIGH = new THREE.Color(0xffdcc2), W_LOW = new THREE.Color(0xffc9a4);
const H_CLEAR = new THREE.Color(0xb6c4d6), H_GREY = new THREE.Color(0xaab4c4);
export const FOV_NORMAL = 62;
const ENV_I = 0.55; // sky image light: less blue cast on meadows than before (0.95)
const F_CLEAR = new THREE.Color(0xbfc6cd), F_GREY = new THREE.Color(0xb4b9c2);
const WS_HIGH = new THREE.Color(0xffb27a), WS_LOW = new THREE.Color(0xff8a52);
const H_BOLT = new THREE.Color(0xd8ccff), F_HELL = new THREE.Color(0x5a1c10), L_HELL = new THREE.Color(0xff6a2a), H_HELL = new THREE.Color(0x8a2a14), WC_HELL = new THREE.Color(0xe04a08);
const WC_CLEAR = new THREE.Color(0x0b3448), WC_GREY = new THREE.Color(0x26323a); // sea body colour: clear vs. overcast

// sunset grade on top of three's Sky (Preetham): deep blue overhead, a pink belt of Venus opposite the sun,
// orange-to-red glow along the horizon towards the sun, a large dark-red sun disc instead of the white-hot one,
// and thin stratus streaks along the horizon lit red from below (they can veil the sun: uVeil)
function skyGrade(fs) {
  return fs
    .replace('uniform vec3 up;', `uniform vec3 up;
uniform float uTime, uCover, uVeil, uLow;
float sh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(sh(i), sh(i + vec2(1, 0)), f.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), f.x), f.y); }`)
    .replace('L0 += ( vSunE * 19000.0 * Fex ) * sundisk;', '')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', `
  float ey = max(direction.y, 0.);
  float cs = max(cosTheta, 0.);
  float hz = 1. - smoothstep(0., .38, ey);
  float low = 1. - smoothstep(0., .07, ey);
  float toSun = pow(cs, 5.);
  float nearSun = pow(cs, 60.);
  retColor *= 1. - .45 * pow(cs, 6.) * hz;
  retColor *= mix(vec3(1.), vec3(1.05, .66, .42), pow(cs, 16.) * (.2 + .8 * uLow));
  retColor = max(mix(vec3(dot(retColor, vec3(.3, .55, .15))), retColor, 1.45), 0.) * .62;
  retColor *= mix(vec3(.64, .85, 1.22), vec3(1.), hz * .65);
  vec3 warm = mix(vec3(1.3, 1.02, .74), vec3(1.55, .78, .42), low * (.4 + .6 * toSun));
  retColor = mix(retColor, retColor * warm, hz * (.35 + .65 * toSun));
  retColor += vec3(1., .62, .3) * toSun * hz * (.32 + .1 * uLow) + vec3(1., .34, .08) * nearSun * low * (.5 - .25 * uVeil);
  float anti = pow(max(-cosTheta, 0.), 1.5);
  float belt = smoothstep(.015, .09, ey) * (1. - smoothstep(.12, .3, ey));
  retColor = mix(retColor, retColor * vec3(1.22, .93, 1.02) + vec3(.035, .008, .02), belt * anti * .35);
  float r = acos(clamp(cosTheta, -1., 1.));
  float disc = 1. - smoothstep(.016, .019, r);
  vec3 discCol = mix(vec3(6., 3.4, 1.6), vec3(1.6, .11, .03), smoothstep(.15, .85, uLow)) * (1. - .3 * r / .019);
  retColor = mix(retColor, discCol, disc * (1. - .55 * uVeil));
  float az = atan(direction.x, direction.z);
  vec2 q = vec2(az * 7. + uTime * .0015, ey * 95.);
  float st = sn(q) * .55 + sn(q * vec2(2.7, 2.1) + 3.1) * .3 + sn(q * vec2(7.3, 4.2) + 1.7) * .15;
  float band = smoothstep(.006, .025, ey) * (1. - smoothstep(.07, .16, ey));
  float thick = smoothstep(.7 - .2 * uCover - .25 * uVeil * pow(cs, 30.), .82, st) * band;
  vec3 stCol = mix(vec3(.26, .22, .30), vec3(1.5, .5, .18), clamp(pow(cs, 10.) * 1.4 + .25 * pow(cs, 2.), 0., 1.));
  retColor = mix(retColor, stCol * (.7 + .5 * st), thick * .85);
  gl_FragColor = vec4( retColor, 1.0 );`);
}

// Cumulus heaps as impostors: ~70 camera-facing cards 1.2-2 km up, wrapped around the camera so the sky is never empty.
// Each card samples one of 4 baked cloud shapes (built once from overlapping spheres): alpha, a sphere normal and the
// thickness. The shader lights the normal with the real sun (sunlit tops and edges, slate-blue shaded undersides,
// silver lining when the sun stands behind a heap). Coverage follows the weather (uCover), the veil dims the sunlit side.
function cumulusTexture() {
  const W = 256, H = 128, V = 4, data = new Uint8Array(W * H * V * 4), rr = rng(911), nz = createNoise2D(rng(17));
  for (let v = 0; v < V; v++) {
    const puffs = [], base = H * 0.78;
    const nb = 5 + Math.floor(rr() * 3);
    for (let k = 0; k < nb; k++) { const x = W * (0.16 + 0.68 * (k + rr() * 0.6) / nb), r = H * (0.17 + rr() * 0.1); puffs.push([x, base - r * 0.55, r]); }
    for (let k = 0; k < 7 + v; k++) { const a = puffs[Math.floor(rr() * puffs.length)], r = a[2] * (0.6 + rr() * 0.45);
      const x = a[0] + (rr() - 0.5) * a[2] * 1.2, y = a[1] - a[2] * (0.45 + rr() * 0.45); if (y - r > 2 && x - r > 2 && x + r < W - 2) puffs.push([x, y, r]); }
    for (const [cx, cy, r] of puffs.slice()) for (let k = 0; k < 4; k++) { // cauliflower: small lumps on the upper rims
      const an = -Math.PI * (0.1 + 0.8 * rr()), rs = r * (0.25 + rr() * 0.18), x = cx + Math.cos(an) * r * 0.8, y = cy + Math.sin(an) * r * 0.8;
      if (y - rs > 1 && x - rs > 1 && x + rs < W - 1) puffs.push([x, y, rs]); }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let best = -1, nx = 0, ny = 0, nzz = 0, th = 0;
      for (const [cx, cy, r] of puffs) { const dx = (x - cx) / r, dy = (y - cy) / r, d2 = dx * dx + dy * dy; if (d2 >= 1) continue;
        const z = Math.sqrt(1 - d2), wgt = z * z * r; th += z * r; best = Math.max(best, z); nx += dx * wgt; ny -= dy * wgt; nzz += z * wgt; } // blended normals: one soft heap, not separate balls
      { const l = Math.hypot(nx, ny, nzz) || 1; nx /= l; ny /= l; nzz = best; }
      const i = ((v * H + y) * W + x) * 4;
      if (best < 0) { data[i] = 128; data[i + 1] = 128; data[i + 2] = 0; data[i + 3] = 0; continue; }
      const flat = Math.min(1, Math.max(0, (base + H * 0.06 - y) / (H * 0.1))); // flat, slightly soft base
      const edge = Math.min(1, nzz * 3.2) * (0.7 + 0.3 * (nz(x / 7 + v * 40, y / 7) * 0.35 + nz(x / 3 + v * 40, y / 3) * 0.15 + 0.5)); // dense body, soft frayed rims
      data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = Math.min(1, th / (H * 0.5)) * 255;
      data[i + 3] = Math.min(1, edge * 1.15) * flat * 255;
    }
  }
  const t = new THREE.DataTexture(data, W, H * V); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.flipY = false; t.needsUpdate = true; return t;
}
function cumulusLayer(sun) {
  const N = 90, rr = rng(4711), g = new THREE.InstancedBufferGeometry();
  g.index = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1);
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  const a = new Float32Array(N * 4), b = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    a.set([(rr() - 0.5) * 16000, 1900 + rr() * 1100, (rr() - 0.5) * 16000, 2400 + rr() * 3000], i * 4); // x, base height (high enough to sit behind the peaks, not on the meadows), z, width
    b.set([Math.floor(rr() * 4), rr(), rr() < 0.5 ? 1 : -1, 0.55 + rr() * 0.3], i * 4); // shape, threshold, mirror, height ratio
  }
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(a, 4)); g.setAttribute('iB', new THREE.InstancedBufferAttribute(b, 4));
  g.instanceCount = N;
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { tC: { value: cumulusTexture() }, uHell: HELL, uTime: { value: 0 }, uSun: { value: sun.clone() }, uCover: { value: 0.4 }, uLow: { value: 0 }, uVeil: { value: 0 } },
    vertexShader: `attribute vec4 iA, iB; uniform float uTime, uCover; varying vec2 vUv; varying float vFade, vShape, vToSun, vFar; varying vec3 vR, vU, vV; uniform vec3 uSun;
void main() {
  vec2 c = iA.xz + vec2(uTime * 4., uTime * 1.5); // drift with the wind
  c = mod(c - cameraPosition.xz + 8000., 16000.) - 8000.; // wrapped around the camera
  vec3 C = vec3(cameraPosition.x + c.x, iA.y, cameraPosition.z + c.y);
  vec3 V = normalize(cameraPosition - C); vec3 R = normalize(cross(vec3(0., 1., 0.), V)); vec3 U = cross(V, R);
  U = normalize(mix(vec3(0., 1., 0.), U, .35)); // stays upright, leans only a little towards a camera below
  float w = iA.w, h = w * .5 * iB.w;
  vec3 P = C + R * position.x * w * iB.z + U * (position.y * h - h * .12);
  float d = length(c);
  float on = smoothstep(iB.y, iB.y + .12, uCover * 1.25 + .05); // how many heaps exist follows the cloud cover
  vFade = on * (1. - smoothstep(6000., 7900., d)) * smoothstep(.01, .06, normalize(P - cameraPosition).y);
  vUv = vec2(position.x + .5, (iB.x + 1. - position.y) / 4.);
  vFar = smoothstep(2500., 7800., d);
  vR = R * iB.z; vU = U; vV = V; vShape = iB.x; vToSun = max(dot(-V, uSun), 0.);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.);
}`,
    fragmentShader: `uniform sampler2D tC; uniform vec3 uSun; uniform float uHell; uniform float uLow, uVeil, uCover; varying vec2 vUv; varying float vFade, vShape, vToSun, vFar; varying vec3 vR, vU, vV;
void main() {
  vec4 t = texture2D(tC, vUv);
  float a = smoothstep(.05, .75, t.a) * vFade; if (a < .01) discard; // soft, frayed rims instead of a cut-out cotton-wool edge
  vec2 n2 = t.rg * 2. - 1.; vec3 n = normalize(vR * n2.x + vU * n2.y + vV * sqrt(max(0., 1. - dot(n2, n2))));
  float l = smoothstep(-.35, .9, dot(n, uSun));
  float hgt = 1. - fract(vUv.y * 4.); // 0 = base, 1 = top of the card
  vec3 shade = mix(vec3(.36, .33, .42), vec3(.4, .4, .46), uCover) * (.62 + .38 * smoothstep(.0, .7, hgt)) * (.85 + .25 * n.y * .5 + .1);
  vec3 lit = mix(vec3(1.02, .76, .56), vec3(1.12, .62, .4), uLow) * (1. - .45 * uVeil); // midnight-sun gold, never paper white
  vec3 col = mix(shade, lit, l * (.55 + .45 * hgt));
  col += vec3(1.3, .62, .3) * pow(vToSun, 6.) * (1. - t.b) * 1.2; // silver lining against the sun
  col = mix(col, vec3(1., .74, .62), vFar * .45); // far heaps sink into the warm horizon haze
  col = mix(col, col * vec3(.5, .2, .12) + vec3(.1, .025, .01), uHell); // hell: smoke-red, sooty heaps
  gl_FragColor = vec4(col, a * .82); // a little sky shows through: they sit in the haze, not on it
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}` });
  const o = new THREE.Mesh(g, m); o.frustumCulled = false; o.renderOrder = -1; o.layers.set(1); return o;
}

// cumulus deck 1.5 km up: fbm noise drifting with the wind; coverage follows the weather (uCover). Undersides
// slate-violet, edges facing the low sun glow red-orange, thin parts near the sun light up (silver lining)
function cloudLayer(sun) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.BackSide,
    uniforms: { uHell: HELL, uTime: { value: 0 }, uSun: { value: sun.clone() }, uCover: { value: 0.4 }, uLow: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW; uniform float uTime, uCover, uLow, uHell; uniform vec3 uSun;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0., a = .5; for (int k = 0; k < 5; k++) { v += a * n(p); p = p * 2.03 + 17.1; a *= .5; } return v; }
void main() {
  vec3 dir = normalize(vW - cameraPosition); // cloud deck 1.5 km up, seen through a dome: no far-plane edge at the horizon
  if (dir.y < .015) discard;
  vec2 p = (cameraPosition.xz + dir.xz / dir.y * 1500.) / 1700. + vec2(uTime * .004, uTime * .0015);
  float f = fbm(p);
  float c = smoothstep(.56 - .2 * uCover, .8 - .12 * uCover, f);
  vec2 sd = normalize(uSun.xz + 1e-4);
  float lit = clamp(.5 + (f - fbm(p - sd * .045)) * 5., 0., 1.);
  float toSun = pow(max(dot(dir, uSun), 0.), 4.);
  vec3 dark = mix(vec3(.30, .30, .40), vec3(.36, .34, .40), uCover);
  vec3 sunlit = mix(vec3(1.25, .78, .58), vec3(1.35, .58, .34), uLow);
  vec3 col = mix(dark, sunlit, lit * (.55 + .45 * toSun)) * (.8 + .3 * smoothstep(.5, .9, fbm(p * 1.7)));
  col += vec3(1.3, .5, .2) * toSun * (1. - c) * .9;
  float fade = smoothstep(.015, .2, dir.y);
  col = mix(col, col * vec3(.5, .2, .12) + vec3(.1, .025, .01), uHell); // hell: smoke-red, sooty heaps
  gl_FragColor = vec4(col, c * .85 * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}` });
  const g = new THREE.SphereGeometry(7000, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2); // upper half dome around the camera
  const o = new THREE.Mesh(g, m); o.renderOrder = -1; o.frustumCulled = false; return o;
}

// leaf clusters on transparent ground; the centre stays solid for the shrub core
function leafTex() {
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s; const g = cv.getContext('2d'), rr = rng(31);
  g.clearRect(0, 0, s, s); g.fillStyle = '#d8e0c8'; g.beginPath(); g.arc(64, 64, 26, 0, 6.283); g.fill(); // solid heart
  for (let k = 0; k < 340; k++) {
    const a = rr() * 6.283, d = Math.sqrt(rr()) * 50, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, l = 150 + rr() * 105;
    g.fillStyle = `rgb(${l * 0.92 | 0},${l | 0},${l * 0.8 | 0})`; // near white: the vertex colour carries the green
    g.beginPath(); g.ellipse(x, y, 5 + rr() * 4, 2.5 + rr() * 2, rr() * 3.14, 0, 6.283); g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// one shrub: a few lumpy, overlapping leaf heaps; normals point away from the bush centre (soft foliage shading),
// vertex colour dark inside/below, lighter yellow-green on top (~600 triangles)
function shrubGeometry() {
  const parts = [], rr = rng(77), c = new THREE.Color(), v = new THREE.Vector3();
  for (let b = 0; b < 5; b++) {
    const g = new THREE.IcosahedronGeometry(1, 1), P = g.attributes.position, cols = [];
    const R = b === 0 ? 0.8 : 0.45 + rr() * 0.3, cx = b === 0 ? 0 : (rr() - .5) * 1.1, cz = b === 0 ? 0 : (rr() - .5) * 1.1, cy = b === 0 ? 0.45 : 0.3 + rr() * 0.35;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      const bump = 1 + 0.22 * Math.sin(v.x * 5.3 + b) * Math.sin(v.y * 4.1 + 2 * b) * Math.sin(v.z * 4.7);
      v.multiplyScalar(R * bump); v.y *= 0.8; v.x += cx; v.z += cz; v.y += cy; if (v.y < 0) v.y *= 0.3;
      P.setXYZ(i, v.x, v.y, v.z);
      const t = Math.min(1, Math.max(0, v.y / 1.1));
      c.setRGB(0.05 + 0.1 * t, 0.1 + 0.13 * t, 0.03 + 0.03 * t); cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals(); const N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) { v.set(P.getX(i), P.getY(i) - 0.3, P.getZ(i)).normalize(); const n = new THREE.Vector3().fromBufferAttribute(N, i).lerp(v, 0.6).normalize(); N.setXYZ(i, n.x, n.y, n.z); }
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.5); // core: dense centre of the leaf texture
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  // leaf clusters: small cards on the surface, facing outwards, alpha-cut -> a broken, leafy silhouette instead of a ball
  const card = new THREE.PlaneGeometry(0.75, 0.75);
  for (let k = 0; k < 30; k++) {
    const g = card.clone(), th = rr() * 6.283, ph = Math.acos(1 - rr() * 1.15), rad = 0.75 + rr() * 0.35;
    const n = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph) * 0.8, Math.sin(ph) * Math.sin(th));
    g.lookAt(n); g.rotateZ(rr() * 6.283); g.translate(n.x * rad, 0.4 + n.y * rad, n.z * rad);
    const t = Math.min(1, Math.max(0, (0.4 + n.y * rad) / 1.2)), cols = [];
    for (let i = 0; i < 4; i++) { c.setRGB(0.07 + 0.17 * t, 0.12 + 0.2 * t, 0.03 + 0.06 * t); cols.push(c.r, c.g, c.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const N = g.attributes.normal; for (let i = 0; i < 4; i++) N.setXYZ(i, n.x, n.y, n.z);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  return mergeGeometries(parts);
}

// halo around the sun instead of a bloom pass (a full-screen bloom cost too much): one additive sprite far out on the
// sun direction; depth-tested, so hills and walls in front cut it off like real glare over a ridge
function sunGlow() {
  const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s; const g = cv.getContext('2d');
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,214,160,1)'); gr.addColorStop(0.08, 'rgba(255,190,120,.7)'); gr.addColorStop(0.3, 'rgba(255,150,80,.22)'); gr.addColorStop(1, 'rgba(255,120,60,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0.5, toneMapped: false });
  const o = new THREE.Sprite(m); o.scale.setScalar(5200); o.renderOrder = 2; o.frustumCulled = false; return o;
}

/** Static object: world matrices computed now, never again (three skips it in updateMatrixWorld). */
// downhill wind: thin streaks rushing past the camera, more and longer the faster you go
function windStreaks(n = 90) {
  const pos = new Float32Array(n * 6), seg = [], g = new THREE.BufferGeometry();
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, rad = 1.2 + Math.random() * 3.5; seg.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.7, z: -2 - Math.random() * 45 }); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const o = new THREE.LineSegments(g, m); o.frustumCulled = false; o.layers.set(1); o.renderOrder = 10;
  o.userData.tick = (dt, v, fast) => {
    m.opacity = fast * 0.55; o.visible = fast > 0.02; if (!o.visible) return;
    const len = 0.6 + fast * 4.5;
    seg.forEach((s, i) => { s.z += v * 1.6 * dt; if (s.z > -1) { s.z -= 46; const a = Math.random() * 6.283, rad = 1.2 + Math.random() * 3.5; s.x = Math.cos(a) * rad; s.y = Math.sin(a) * rad * 0.7; }
      pos.set([s.x, s.y, s.z, s.x, s.y, s.z - len], i * 6); });
    g.attributes.position.needsUpdate = true;
  };
  return o;
}
function noMirror(o) { o.traverse(c => c.layers.set(1)); }
function freeze(o) { o.updateMatrixWorld(true); o.traverse(c => { c.matrixAutoUpdate = false; }); o.matrixWorldAutoUpdate = false; }

// ---- rain: one or two showers per ride at random spots, 4-9 km long (~10-20 min), heavier in the middle ----
function planRain(L, force) {
  const out = [], len = () => Math.min(L * 0.45, 4000 + Math.random() * 5000);
  if (force) return [{ a: 0, b: L }];
  const n = L > 30000 && Math.random() < 0.4 ? 2 : 1;
  for (let k = 0; k < n; k++) { const l = len(), a = (k / n + Math.random() * 0.6 / n) * (L - l) + 600; out.push({ a, b: a + l }); }
  console.info('RIDEFRAME Regen bei', out.map(s => `km ${(s.a / 1000).toFixed(1)}–${(s.b / 1000).toFixed(1)}`).join(', '));
  return out;
}
/** falling streaks in a box that travels with the camera; all motion in the vertex shader (one draw call) */
function rainLayer(N = 6000, B = 70, H = 36) {
  const pos = new Float32Array(N * 6), end = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { const x = Math.random() * B, y = Math.random() * H, z = Math.random() * B;
    pos.set([x, y, z, x, y, z], i * 6); end[i * 2 + 1] = 1; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uRain: { value: 0 } },
    vertexShader: `attribute float aEnd; uniform float uTime; uniform vec3 uCam; uniform float uRain; varying float vA;
      void main() { vec3 box = vec3(${B}., ${H}., ${B}.);
        vec3 p = position - vec3(uTime * 2.2, uTime * 13., uTime * 1.1);           // fall, a little wind
        p = mod(p - uCam + box * .5, box) + uCam - box * .5; p.y += 6.;
        p += vec3(.08, .75, .04) * aEnd;                                           // streak length ~0.75 m
        float far = length(p - uCam); vA = uRain * smoothstep(${B * 0.5}., 8., far) * step(fract(position.x * 7.13 + position.z * 3.7), .35 + .65 * uRain);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
    fragmentShader: 'varying float vA; void main() { gl_FragColor = vec4(.78, .82, .88, vA * .45); }' });
  const L = new THREE.LineSegments(g, m); L.frustumCulled = false; L.visible = false; L.layers.set(1); L.renderOrder = 5; return L;
}

// hell: trees and shrubs burn out to charred black wood with a faint ember glow in the crowns; HELL is a shared uniform, so no recompile when the wizard opens the gate
function charred(mt, leaf) {
  const prev = mt.onBeforeCompile, burnt = leaf ? 'vec3( 0.07, 0.035, 0.025 ) + diffuseColor.rgb * vec3( 0.05, 0.015, 0.0 )' : 'vec3( 0.06, 0.045, 0.04 )';
  mt.onBeforeCompile = (sh, r) => { prev?.call(mt, sh, r); sh.uniforms.uHell = HELL;
    sh.fragmentShader = 'uniform float uHell;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.rgb = mix( diffuseColor.rgb, ${burnt}, uHell );`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3( ${leaf ? '0.045, 0.008, 0.0' : '0.0, 0.0, 0.0'} ) * uHell;`); };
  mt.customProgramCacheKey = () => 'charred' + (leaf ? 1 : 0);
}
