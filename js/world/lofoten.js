// Real-time 3D world along a designed route (Lofoten coast + medieval villages).
// Same interface as DemoScene/ChapterPlayer: currentTime, playbackRate, play(), pause(), destroy().
import * as THREE from 'three';
import { Sky } from '../../vendor/Sky.js';
import { createNoise2D } from '../../vendor/simplex-noise.js';
import { STEP, distAtTime } from '../track.js';
import { Field, rng, smooth, lerp, ROAD_W, DS, loadDEM } from './field.js';
const DEM = await loadDEM();
import { asphalt, grassTuft, planks, stone } from './tex.js';
import { terrainMaterial, tex, texReady, TIME } from './terrainmat.js';
import { Water } from '../../vendor/jsm/objects/Water.js';
import { loadAssets } from './assets.js';
import { EffectComposer } from '../../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from '../../vendor/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from '../../vendor/jsm/postprocessing/OutputPass.js';
import { clumpGeometry, grassMaterial, grassColor } from './grass.js';
const ASSETS = await loadAssets();

const TILE = 192;             // terrain tile size (m)
const VIEW = 2000;            // tiles kept within this radius
const SUB = STEP / DS;

// ---------------- terrain painting ----------------
// splat = weights for (grass, rock, sand, snow); colour = gentle tint so meadows are not one flat green
const TINT_A = new THREE.Color(1.0, 1.0, 0.95), TINT_B = new THREE.Color(1.12, 1.05, 0.78), TINT_C = new THREE.Color(0.82, 0.9, 0.86), _c = new THREE.Color();
const WET = new THREE.Color(0.55, 0.52, 0.5), SHALLOW = new THREE.Color(0.75, 1.0, 0.95), DEEP = new THREE.Color(0.15, 0.3, 0.33);
function paint(f, x, z, h, ny, col, spl, i) {
  const n = f.n2(x / 60, z / 60), n2 = f.n3(x / 14, z / 14), n3 = f.n1(x / 230, z / 230);
  let rock = Math.max(smooth(0.86, 0.68, ny + n2 * 0.04), smooth(300, 480, h + n * 50) * 0.8);
  rock = Math.max(rock, smooth(0.25, 0.65, n3 * 0.5 + n2 * 0.5) * 0.35 * smooth(40, 120, h)); // rock outcrops in the meadows
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
    box(.12, 4, .12, M(0x222222), 2.2, 22, 0);
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
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 9000);

    // midnight sun low in the north-west, over the sea
    const sky = this.sky = new Sky(); sky.scale.setScalar(8000); scene.add(sky);
    const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 3), THREE.MathUtils.degToRad(-35 + 180));
    sun.set(-Math.abs(sun.x), sun.y, -Math.abs(sun.z)).normalize(); // north-west
    Object.assign(sky.material.uniforms, {});
    sky.material.uniforms.turbidity.value = 10; sky.material.uniforms.rayleigh.value = 3.6;
    sky.material.uniforms.mieCoefficient.value = 0.012; sky.material.uniforms.mieDirectionalG.value = 0.9;
    sky.material.uniforms.sunPosition.value.copy(sun);
    // midnight-sun grade: deeper blue overhead, glowing orange band along the horizon, hottest towards the sun
    sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', `
      float hz = 1. - smoothstep(0., .35, max(direction.y, 0.)), toSun = pow(max(dot(direction, vSunDirection), 0.), 6.);
      retColor = mix(retColor * vec3(.78, .9, 1.12), retColor * vec3(1.35, .92, .62), hz * (.45 + .55 * toSun));
      retColor += vec3(1., .55, .2) * toSun * hz * .25;
      gl_FragColor = vec4( retColor, 1.0 );`);
    this.sunDir = sun;
    const pm = new THREE.PMREMGenerator(renderer); const envScene = new THREE.Scene(); const sky2 = sky.clone(); envScene.add(sky2);
    scene.environment = pm.fromScene(envScene, 0, 0.1, 9000).texture; scene.environmentIntensity = 0.6;
    scene.fog = new THREE.FogExp2(0xd6c9bb, 0.00022);
    this.clouds = cloudLayer(sun); scene.add(this.clouds);

    const light = this.light = new THREE.DirectionalLight(0xffa266, 3.2);
    light.castShadow = true; light.shadow.mapSize.set(2048, 2048);
    const sc = light.shadow.camera; sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 900;
    light.shadow.bias = -0.0004; light.shadow.normalBias = 0.6;
    scene.add(light, light.target);
    scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x4a3f33, 0.55));

    // materials
    const dt = detailTex(); dt.repeat.set(1, 1);
    this.terrainMat = terrainMaterial();
    this.skirtMat = terrainMaterial(); this.skirtMat.side = THREE.DoubleSide;
    // sea: reflective water with real normal map; slightly see-through so shallow sand turns it turquoise
    const wn = tex('water', 'nrm', [128, 128, 255]);
    this.water = new Water(new THREE.PlaneGeometry(9000, 9000), {
      textureWidth: 1024, textureHeight: 1024, waterNormals: wn, sunDirection: sun.clone(), sunColor: 0xffd2a8,
      waterColor: 0x0f6f78, distortionScale: 3.4, fog: true, alpha: 0.74, size: 3.2,
    });
    // real water reflects ~4 % straight down (not 30 %): the sea is no longer a white mirror, the teal body and the
    // turquoise sand under the shallows show through; grazing angles still mirror the mountains
    this.water.material.fragmentShader = this.water.material.fragmentShader
      .replace('float rf0 = 0.3;', 'float rf0 = 0.04;')
      .replace('vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;', 'vec3 scatter = ( 0.35 + 0.65 * max( 0.0, dot( surfaceNormal, eyeDirection ) ) ) * waterColor * 1.6;');
    this.water.material.transparent = true;
    this.water.rotation.x = -Math.PI / 2; this.water.position.y = 0; scene.add(this.water);


    const at = asphalt(256, 1024, 9, true); at.anisotropy = 16; at.repeat.set(1, 1);
    this.roadMat = new THREE.MeshStandardMaterial({ map: at, roughness: 0.82, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    // photo asphalt (assets/tex/asphalt_*) under the painted lines of the procedural texture
    const aC = tex('asphalt', 'col', [128, 128, 130]), aN = tex('asphalt', 'nrm', [128, 128, 255]);
    this.roadMat.onBeforeCompile = sh => {
      sh.uniforms.tAsph = { value: aC }; sh.uniforms.tAsphN = { value: aN };
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tAsph, tAsphN;')
        .replace('#include <map_fragment>', `
  vec4 painted = texture2D(map, vMapUv);
  vec2 auv = vec2(vMapUv.x * 6.6, vMapUv.y * 40.) / 2.5;
  vec3 asph = mix(texture2D(tAsph, auv).rgb, texture2D(tAsph, auv * 0.23 + .5).rgb, .35);
  float line = smoothstep(.45, .7, dot(painted.rgb, vec3(.333)));
  float edge = smoothstep(.0, .06, vMapUv.x) * (1. - smoothstep(.94, 1., vMapUv.x));
  diffuseColor.rgb *= mix(painted.rgb, mix(asph * .95, painted.rgb, line), edge);`)
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
    this.tuftMats = [tuft, tuftF].map(t => new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 }));

    this.farCam = { value: new THREE.Vector2() };
    this.farHole = { value: 0 }; // far backdrop is cut out only where detailed tiles already stand (none at the start)
    this.farMat = terrainMaterial({ far: true, cam: this.farCam, hole: this.farHole });
    Object.assign(this.farMat, { polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 });
    this.tiles = new Map(); this.queue = []; this.roadChunks = new Map(); this.animated = [];
    this._placeLandmarks();
    this.d = 0; this.camPos = null;
    this.instant = new URLSearchParams(location.search).has('shot');
    // quality steps, lowered automatically while the frame rate stays under 50 fps (a trainer ride needs smooth video):
    // 3 = full, 2 = no ambient occlusion, 1 = render scale 1.0, 0 = sea reflection every 2nd frame + smaller shadow map
    const qp = new URLSearchParams(location.search).get('q');
    this.quality = qp !== null ? +qp : 3; this.autoQ = qp === null; this.fpsT = 0; this.fpsN = 0; this.fpsSince = 0;
    this.useAO = this.quality >= 3 && !new URLSearchParams(location.search).has('noao'); // headless screenshots: build everything, render once
    this.last = performance.now();
    this._loop = this._loop.bind(this); requestAnimationFrame(this._loop);
  }

  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  destroy() {
    this.dead = true;
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
      const rail = new THREE.InstancedMesh(railGeo, new THREE.MeshStandardMaterial({ color: 0x8d9196, roughness: .45, metalness: .7 }), posts.length);
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
      pm.castShadow = rail.castShadow = true; grp.add(pm, rail);
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
    g.computeVertexNormals();
    const nrm = g.attributes.normal, spl = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) paint(f, p.getX(i) + ox, p.getZ(i) + oz, H[i], nrm.getY(i), col, spl, i);
    g.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, this.terrainMat); m.position.set(ox, 0, oz); m.receiveShadow = true; m.castShadow = res >= 48;
    const sk = new THREE.Mesh(skirt(g, N, 1 + S * 0.6), this.skirtMat); sk.position.copy(m.position); sk.receiveShadow = true; // hides cracks between detail levels
    const grp = new THREE.Group(); grp.add(m, sk);
    if (res >= 48) this._scatter(grp, tx, tz, H, N, res >= 96, spl);
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
    const bands = [[ROAD_W + 0.5, 16, 4.0], [16, 35, 1.0], [35, 70, 0.25]];
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
          const h = f.height(x, z); if (h < 2.2) continue;
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
      im.receiveShadow = true; grp.add(im);
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
  }

  // ---- villages, harbour, landmarks at the climb tops ----
  _placeLandmarks() {
    this.props = []; this.mixers = []; this.birds = []; this.whales = []; this.wheels = [];
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
      const q = spot(d, off), rad = Math.max(e.size[0], e.size[2]) / 2 * (o.radK ?? 0.85);
      const rd = f.road(q.x, q.z);
      if (!rd || rd.d - rad < ROAD_W + (o.gap ?? 1.2)) return null; // never on the road
      if (!o.overlap && !free(q.x, q.z, rad)) return null;
      const side = Math.sign(off) || 1;
      let ang = o.face === 'away' ? Math.atan2(side * -q.tz, side * q.tx) : o.face === 'along' ? Math.atan2(q.tx, q.tz)
        : typeof o.face === 'number' ? o.face : Math.atan2(-side * -q.tz, -side * q.tx);
      ang += o.rot || 0;
      let y;
      if (o.water) y = o.y ?? 0;
      else { // lowest ground under the footprint, so nothing floats
        y = f.height(q.x, q.z); const k = rad * 0.6;
        for (const [a, b] of [[k, 0], [-k, 0], [0, k], [0, -k]]) y = Math.min(y, f.height(q.x + a, q.z + b));
        y += o.dy || 0;
      }
      const { obj, mixer } = A.make(e, o.anim, r);
      obj.position.set(q.x, y, q.z); obj.rotation.y = ang; if (Array.isArray(o.scale)) obj.scale.set(...o.scale); else if (o.scale) obj.scale.setScalar(o.scale);
      this.scene.add(obj); taken.push([q.x, q.z, rad]);
      this.props.push(obj); if (mixer) { mixer.obj = obj; this.mixers.push(mixer); }
      obj.traverse(c => { if (c.userData.millWheel) this.wheels.push(c); });
      return obj;
    };
    const pick = (cat) => A.pick(cat, r), byName = part => A.find(part);
    const segAt = d => segs.find(s => d >= s.from && d < s.to) || segs[segs.length - 1];

    for (const s of segs) {
      const L = s.to - s.from;
      // ---- villages: houses, harbour, market square, musicians, people ----
      if (s.village) {
        const a = s.from + L * s.village[0], b = s.from + L * s.village[1], mid = (a + b) / 2;
        // market square in the middle of the village (land side)
        const stalls = A.by.stall || [];
        for (let k = 0; k < Math.min(5, stalls.length); k++) {
          const d = mid - 18 + k * 8;
          if (place(stalls[(k + Math.floor(r() * 9)) % stalls.length], d, ROAD_W + 4.2, { gap: 0.6 })) {
            place(k % 2 ? byName('haendler') : byName('fischerin'), d + 1.2, ROAD_W + 2.4, { gap: 0.4, radK: 0.5, anim: k % 2 ? 'Rufen' : 'Stehen' });
          }
        }
        place(byName('brunnen'), mid + 26, ROAD_W + 6, { face: 'road' });
        place(byName('faesser_kisten'), mid - 25, ROAD_W + 4, { face: 'road' });
        place(byName('kutsche'), mid + 34, ROAD_W + 5.5, { face: 'along' });
        place(byName('pferd'), mid + 40, ROAD_W + 5.5, { face: 'along', anim: 'Stehen' });
        // musicians in a half circle behind the market
        const mus = A.by.figure_music || [];
        mus.forEach((e, k) => place(e, mid - 8 + k * 2.3, ROAD_W + 9 + (k % 2) * 0.8, { radK: 0.45, anim: 'Spielen', gap: 3 }));
        place(byName('fahne_dorf'), mid - 30, ROAD_W + 3, { gap: 0.5 });
        place(byName('fahne_wimpel'), mid + 30, ROAD_W + 3, { gap: 0.5 });
        // houses on the land side, facing the road
        for (let d = a; d < b; d += 18 + r() * 22) {
          if (Math.abs(d - mid) < 22 || r() < 0.2) continue;
          const back = r() < 0.3 ? 14 + r() * 14 : 0; // some houses stand back in a second row
          const hr = r(); // Lofoten look: mostly red and ochre wooden houses, a few stone and timber-framed ones
          const he = hr < 0.38 ? byName('rorbu_rot') : hr < 0.62 ? byName('rorbu_ocker') : hr < 0.8 ? byName('steinhaus') : hr < 0.92 ? byName('fachwerkhaus_a') : pick('house_big');
          if (he) place(he, d, ROAD_W + 7 + Math.max(...he.size) / 2 + r() * 4 + back, { rot: (r() - .5) * .3, gap: 4 }); // front 5-9 m behind the asphalt
          if (r() < 0.3) place(byName('waescheleine'), d + 9, ROAD_W + 10 + r() * 3, { face: 'along', gap: 2 });
          if (r() < 0.25) place(r() < .5 ? byName('fass') : byName('schubkarre'), d + 5, ROAD_W + 3.5, { gap: 0.5, rot: r() * 3 });
        }
        // harbour on the sea side: rorbuer on stilts at the water, piers, boats, a fisherman
        let fishers = 0;
        for (let d = a; d < b; d += 22 + r() * 14) {
          const w = waterline(d, -1, 8); if (w === null) continue;
          place(r() < 0.6 ? byName('rorbu_rot') : byName('rorbu_ocker'), d, -(w + 2), { face: 'road', dy: -0.3 });
          if (place(byName('brygge'), d + 9, -(w + 3), { face: 'road', water: true, y: 0.2 }) && fishers++ < 2 && r() < 0.6)
            place(byName('fischer_netz'), d + 9, -(w + 1.2), { radK: 0.4, anim: 'Flicken', overlap: true, water: true, y: 1.6 });
          if (r() < 0.7) place(r() < 0.6 ? byName('nordlandboot') : byName('fischerboot'), d + 4, -(w + 14 + r() * 10), { water: true, y: -0.3, face: 'along', rot: r() * 0.6 });
        }
        place(byName('hjell'), a + 25, ROAD_W + 12, { face: 'along' });
        if (s === segs[0]) place(byName('dorfkirche'), b - 40, ROAD_W + 16, { face: Math.PI / 2 });
      }
      // ---- open coast: a lone rorbu with pier, drying racks, sheep, puffins ----
      if (s.land === 'coast' && !s.village) {
        for (let d = s.from + 200; d < s.to - 100; d += 380 + r() * 300) {
          const w = waterline(d, -1, 8);
          if (w !== null) { place(byName('rorbu_rot'), d, -(w + 2), { dy: -0.3 }); place(byName('brygge'), d + 9, -(w + 3), { water: true, y: 0.2 }); place(byName('nordlandboot'), d + 2, -(w + 16), { water: true, y: -0.3, face: 'along' }); }
          if (r() < 0.5) place(byName('hjell'), d + 60, ROAD_W + 10 + r() * 6, { face: 'along' });
        }
      }
      // ---- meadows: sheep flocks, horses, reindeer higher up, stone walls, hay ----
      if (s.land !== 'cliff') {
        for (let d = s.from + 150; d < s.to - 50; d += 260 + r() * 260) {
          const side = s.land === 'coast' ? 1 : (r() < 0.5 ? -1 : 1), base = 16 + r() * 30, n = 4 + Math.floor(r() * 5);
          const animal = s.land === 'serp' || (s.land === 'valley' && r() < 0.4) ? byName('rentier') : r() < 0.15 ? byName('pferd') : byName('schaf');
          for (let k = 0; k < n; k++) place(animal, d + (r() - .5) * 26, side * (base + r() * 14), { face: r() * 6.28, anim: r() < 0.7 ? 'Grasen' : 'Stehen', radK: 0.6, gap: 3 });
          if (s.land === 'valley' && r() < 0.6) for (let k = 0; k < 6; k++) place(byName('garbenhocke'), d + 40 + k * 3.5, side * -(10 + (k % 2) * 3), { gap: 2 });
          if (r() < 0.35) place(byName('heuhaufen'), d + 70, side * (12 + r() * 10), { gap: 2 });
        }
        // dry-stone walls along the land side
        for (let d = s.from + 100; d < s.to - 100; d += 500 + r() * 400) {
          const wall = s.land === 'valley' ? byName('flechtzaun') : byName('trockenmauer'), off = ROAD_W + 5 + r() * 2, side = s.land === 'coast' ? 1 : -1;
          for (let k = 0; k < 18; k++) place(wall, d + k * 3.6, side * off, { face: 'along', gap: 1, radK: 0.3, overlap: true });
        }
      }
      // ---- landmarks on the climb tops ----
      if (s.top === 'church') place(byName('dorfkirche'), s.to + 60, ROAD_W + 18, { face: Math.PI / 2 });
      if (s.top === 'mill') place(byName('wassermuehle'), s.to + 50, ROAD_W + 12, {});
      // ---- cliffs: eagles above, puffins on the rocks, whales offshore ----
      if (s.land === 'cliff' || s.beach) {
        for (let d = s.from + 300; d < s.to; d += 900) {
          const q = spot(d, -260 - r() * 200);
          if (f.height(q.x, q.z) < -6) { const w = place(byName('buckelwal'), d, -(260 + r() * 200), { water: true, y: -14, face: 'along', overlap: true }); if (w) this.whales.push({ obj: w, mixer: this.mixers[this.mixers.length - 1], next: 0 }); }
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
    // big rock walls where the ground rises steeply beside the road (serpentines, cliffs)
    const cliffs = A.by.cliff || [];
    if (cliffs.length) for (let d = 300; d < t.length - 100; d += 140 + r() * 120) {
      for (const side of [1, -1]) {
        // only into slopes that keep rising behind (a real mountainside), never as a free-standing slab
        const p = f.at(d), q1 = spot(d, side * 34), q2 = spot(d, side * 70);
        if (f.height(q1.x, q1.z) - p.e < 18 || f.height(q2.x, q2.z) - p.e < 40) continue;
        const k = 0.75 + r() * 0.3; // narrower and much deeper than modelled, so the back disappears in the hill
        place(cliffs[Math.floor(r() * cliffs.length)], d, side * (36 + r() * 10), { face: 'road', dy: -7, radK: 0.45, gap: 20, scale: [k * 0.75, k, k * 2.4] });
      }
    }
    this._placeLegacyTops(segs);
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
    const f = this.field, k0 = Math.floor(this.d / 500);
    for (let k = k0 - 2; k <= k0 + 4; k++) if (k >= 0 && !this.roadChunks.has(k)) { const c = this._roadChunk(k); if (c) { this.scene.add(c); this.roadChunks.set(k, c); } }
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
      if (!this.instant && performance.now() - t0 > 12) break;
      const old = this.tiles.get(key);
      const obj = this._tile(w.tx, w.tz, w.res); this.scene.add(obj);
      if (old) { this.scene.remove(old.obj); old.obj.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
      this.tiles.set(key, { obj, res: w.res });
      if (!this.instant && budget <= 1 && performance.now() - t0 > 6) break;
    }
    let hole = 1780; // radius around the camera fully covered by detailed tiles
    for (const [key, w] of want) if (!this.tiles.has(key)) hole = Math.min(hole, Math.max(0, w.dist - TILE * 0.75));
    this.farHole.value = hole;
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
    this.farMesh = new THREE.Mesh(g, this.farMat); this.farMesh.position.set(J.ox, 0, J.oz); this.farMesh.receiveShadow = true; this.scene.add(this.farMesh);
    this.farJob = null;
  }

  _camera(d, dt = 1 / 60) {
    // exact rider pose on the spline; only the view direction is damped (time based, frame-rate independent)
    const p = this.field.pose(d), cam = new THREE.Vector3(p.x, p.y, p.z), look = new THREE.Vector3(p.lx, p.ly, p.lz);
    if (!this.lookPos || this.instant || cam.distanceTo(this.camera.position) > 40) this.lookPos = look.clone();
    else this.lookPos.lerp(look, 1 - Math.exp(-dt * 7));
    this.camera.position.copy(cam); this.camera.lookAt(this.lookPos);
    if (this.debugTop) { this.camera.position.set(cam.x, cam.y + this.debugTop, cam.z + 0.01); this.camera.lookAt(cam.x, cam.y, cam.z); } // test view from above
    return cam;
  }

  _loop(now) {
    if (this.dead) return;
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (!this.paused) this.currentTime = Math.min(this.duration, this.currentTime + dt * this.playbackRate);
    if (this.instant && !this.texOk) { if (!this.texWait) this.texWait = texReady().then(() => this.texOk = true); requestAnimationFrame(this._loop); return; }
    if (this.instant) { if (this.shotDone || this.currentTime <= 0) { if (!this.shotDone) requestAnimationFrame(this._loop); return; } this.render(10); this.shotDone = true; window.__shot = true; return; }
    this.render(now / 1000, dt);
    requestAnimationFrame(this._loop);
  }

  _setQuality(q) {
    this.quality = q; const r = this.renderer;
    if (q < 3) this.useAO = false;
    if (q < 2) { r.setPixelRatio(1); this._w = 0; }
    if (q < 1) {
      this.light.shadow.mapSize.set(1024, 1024); this.light.shadow.map?.dispose(); this.light.shadow.map = null;
      const wr = this.water.onBeforeRender; let k = 0; this.water.onBeforeRender = (...a) => { if (k++ % 2 === 0) wr.apply(this.water, a); };
    }
    console.info('RIDEFRAME Grafikstufe', q);
  }
  _measure() { // real frame time, independent of the scene clock; skip the first seconds while tiles stream in
    const now = performance.now(), ft = this._lastNow ? now - this._lastNow : 0; this._lastNow = now;
    if (!this.autoQ || this.instant || !ft || ft > 500) return;
    if (!this.fpsSince) this.fpsSince = now;
    if (now - this.fpsSince < 4000) return;
    this.fpsT += ft; this.fpsN++;
    if (this.fpsT > 2500) { const fps = 1000 * this.fpsN / this.fpsT; this.fpsT = this.fpsN = 0; this.fps = fps;
      if (fps < 48 && this.quality > 0) this._setQuality(this.quality - 1); }
  }
  render(time = 0, dt = 1 / 60) {
    this._measure();
    const c = this.c, W = c.clientWidth || c.width, H = c.clientHeight || c.height;
    const r = this.renderer;
    if (this._w !== W || this._h !== H) {
      r.setSize(W, H, false); this.camera.aspect = W / H; this.camera.updateProjectionMatrix(); this._w = W; this._h = H;
      if (this.useAO && !this.composer) { // ambient occlusion: grounds houses, rocks and grass
        this.composer = new EffectComposer(r); this.composer.addPass(new RenderPass(this.scene, this.camera));
        const ao = this.aoPass = new GTAOPass(this.scene, this.camera, W, H); ao.blendIntensity = 0.85;
        ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.1, samples: 12 });
        this.composer.addPass(ao); this.composer.addPass(new OutputPass());
      }
      if (this.composer) this.composer.setSize(W, H);
    }
    this.d = distAtTime(this.track, this.currentTime);
    const cam = this._camera(this.d, dt);
    this._far(cam.x, cam.z); this.farCam.value.set(cam.x, cam.z);
    this._ensure(cam.x, cam.z);
    // shadows follow the rider
    this.light.position.set(cam.x + this.sunDir.x * 400, cam.y + this.sunDir.y * 400 + 40, cam.z + this.sunDir.z * 400);
    this.light.target.position.set(cam.x - this.sunDir.x * 40, cam.y, cam.z - this.sunDir.z * 40);
    this.sky.position.copy(this.camera.position);
    this.water.position.x = Math.round(cam.x / 100) * 100; this.water.position.z = Math.round(cam.z / 100) * 100;
    this.water.material.uniforms.time.value = time * 0.6; this.grassTime.value = time; TIME.value = time;
    this.clouds.position.set(cam.x, 1100, cam.z); this.clouds.material.uniforms.uTime.value = time;
    for (const o of this.animated) {
      if (o.userData.spin) o.rotation.z = time * 0.6;
      else if (o.userData.flag) o.rotation.y = Math.sin(time * 2.3 + o.id) * 0.25;
      else if (o.userData.bob) { o.position.y = Math.sin(time * 0.9 + o.id) * 0.15 - 0.4; o.rotation.z = Math.sin(time * 0.7 + o.id) * 0.04; }
    }
    this._life(time, dt, cam);
    if (this.composer && this.useAO) this.composer.render(); else r.render(this.scene, this.camera);
  }

  _life(time, dt, cam) {
    if (!this.props) return;
    // show only what is near (draw calls), animate only what is close
    if (!this._cullT || time - this._cullT > 0.5 || this.instant) {
      this._cullT = time;
      for (const o of this.props) o.visible = Math.hypot(o.position.x - cam.x, o.position.z - cam.z) < (o.userData.circle ? 900 : 1600);
    }
    for (const m of this.mixers) if (m.obj.visible && Math.hypot(m.obj.position.x - cam.x, m.obj.position.z - cam.z) < 260) m.update(Math.min(dt, 0.1));
    for (const w of this.wheels) w.rotation.x = time * 0.35;
    for (const b of this.birds) { const c = b.userData.circle, a = c.ph + time * c.w;
      b.position.set(c.x + Math.cos(a) * c.R, c.y + Math.sin(time * 0.3 + c.ph) * 4, c.z + Math.sin(a) * c.R); b.rotation.y = -a; }
    for (const w of this.whales) { // breach every ~25 s while the rider is within 900 m
      const near = Math.hypot(w.obj.position.x - cam.x, w.obj.position.z - cam.z) < 900;
      if (near && time > w.next && w.mixer) { const c = ASSETS.clip(ASSETS.find('buckelwal'), 'Sprung'); if (c) { const act = w.mixer.clipAction(c); act.reset(); act.setLoop(THREE.LoopOnce); act.play(); } w.next = time + 22 + Math.random() * 10; }
    }
  }
}

/** Vertical strip hanging down from the border of a (N+1)² grid, same attributes, so neighbouring tiles of a coarser level show no gaps. */
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

function mergeGeos(list) {
  const pos = [], nrm = [], uv = [], idx = []; let off = 0;
  for (const g of list) {
    pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
    for (const i of g.index.array) idx.push(i + off); off += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

// soft cumulus layer 1.4 km up: fbm noise drifting with the wind, lit warm from the low sun, fading out at the horizon
function cloudLayer(sun) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uSun: { value: sun.clone() } },
    vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW; uniform float uTime; uniform vec3 uSun;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0., a = .5; for (int k = 0; k < 5; k++) { v += a * n(p); p = p * 2.03 + 17.1; a *= .5; } return v; }
void main() {
  vec2 p = vW.xz / 2600. + vec2(uTime * .004, uTime * .0015);
  float c = smoothstep(.38, .68, fbm(p));
  float lit = fbm(p + uSun.xz * .03);
  vec3 col = mix(vec3(.42, .45, .52), vec3(1.05, .92, .80), clamp(.45 + (fbm(p) - lit) * 4., 0., 1.)) * (.75 + .35 * smoothstep(.5, .9, fbm(p * 1.7)));
  vec3 d = vW - cameraPosition; float fade = 1. - smoothstep(2500., 8800., length(d.xz));
  gl_FragColor = vec4(col, c * .85 * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}` });
  const g = new THREE.PlaneGeometry(32000, 32000); g.rotateX(Math.PI / 2);
  const o = new THREE.Mesh(g, m); o.renderOrder = -1; o.frustumCulled = false; return o;
}
