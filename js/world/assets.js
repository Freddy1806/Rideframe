// Blender assets (assets/world/manifest.json + GLBs from the Mac). Everything optional:
// a model that is missing simply is not offered, the world then falls back to its simple built-in shapes.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../../vendor/jsm/libs/meshopt_decoder.module.js';
import { clone as skClone } from '../../vendor/jsm/utils/SkeletonUtils.js';

const base = new URL('../../assets/world/', import.meta.url);

let MODE = null; // the graphics level the models were loaded for (see loadKeep)
const QSM = () => (typeof location !== 'undefined' && new URLSearchParams(location.search).get('mode')) || globalThis.__rfMode || 'voll';
// a model the chosen graphics level does not need is never downloaded (Freddy 13.11.: less memory on weak laptops; hiding alone
// left the heap at 1.0-1.2 GB in every mode, Mac mini). It stays in the list as an empty stand-in so that placement draws the
// same dice as in the full world; upgradeAssets() fills the stand-ins when a later ride on this page asks for more.
const stub = e => ({ ...e, scene: new THREE.Group(), farScene: null, stub: true,
  clips: Array.from({ length: e.nclips ?? (isPerson(e) || isAnimal(e) ? 1 : 0) }, () => ({ name: '', duration: 1 })) });
let loadOne = null;
/** a later ride with a higher level: download what is still missing (in place, every list keeps its objects) */
export async function upgradeAssets(A, mode = QSM()) {
  if (!loadOne || !MODE || LEVEL[mode] <= LEVEL[MODE]) return;
  const keep = loadKeep(mode), todo = A.list.filter(e => e.stub && keep(e)); MODE = mode;
  const prog = globalThis.__rfLoad = { done: 0, total: todo.length };
  let i = 0; await Promise.all(Array.from({ length: 6 }, async () => { while (i < todo.length) { const e = todo[i++], got = await loadOne(e); prog.done++; if (got) Object.assign(e, got, { stub: false }); } }));
}

export async function loadAssets(mode = QSM()) {
  let list = [];
  try { list = await (await fetch(new URL('manifest.json', base))).json(); } catch { return new Assets([]); }
  if (typeof window === 'undefined') return new Assets([]);
  if (new URLSearchParams(location.search).has('fakeassets')) { const w = loadKeep(LEVEL[mode] ? mode : 'voll'); return new Assets(list.map(e => w(e) ? fake(e) : stub(e))); } // layout test without the GLBs
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); /* the Mac mini packs GLBs with meshopt + WebP (several times smaller over the home upload line) */
  list = list.filter(e => e.category !== 'rider'); // bike/hands for the riders: loaded by avatar.js
  // variants from the Mac mini (thicker, thinner, other colours: "variant_of": base name) would triple the download:
  // each ride loads only a few of them at random (?variants=N per base, default 1), so every ride looks a little different
  const nv = +(new URLSearchParams(location.search).get('variants') ?? 1), groups = {};
  for (const e of list) if (e.variant_of) (groups[e.variant_of] ||= []).push(e);
  // the variants of the day: the same for every load on one day (world modes compare 1:1, friends in a group ride see the same
  // world), another mix tomorrow ("every ride looks a little different")
  let h = 2166136261; for (const c of new Date().toDateString()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const shuffle = g => { g = [...g].sort((x, y) => (x.file < y.file ? -1 : 1)); for (let i = g.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [g[i], g[j]] = [g[j], g[i]]; } return g; };
  const keep = new Set(Object.keys(groups).sort().flatMap(k => shuffle(groups[k]).slice(0, nv)));
  list = list.filter(e => !e.variant_of || keep.has(e));
  // at most 6 downloads at once: hundreds in parallel made the public (Tailscale Funnel) path drop connections, and those models went missing
  const pool = (items, n, fn) => { const out = new Array(items.length); let i = 0; return Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })).then(() => out); };
  MODE = LEVEL[mode] ? mode : 'voll'; const wanted = loadKeep(MODE), skipped = list.filter(e => !wanted(e)); list = list.filter(wanted);
  const prog = globalThis.__rfLoad = { done: 0, total: list.length }; // the loading card in the ride shows "Welt wird geladen … 120 / 709"
  const ok = await pool(list, location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 16 : 6, async e => {
    try { return await one(e); } finally { prog.done++; } });
  async function one(e) {
    try {
      const g = await loader.loadAsync(new URL(e.file, base).href);
      const cast = !/^(festival|laundry)/.test(e.category || '') && Math.max(...(e.size || [9])) >= 1.2; /* bunting, stalls' cloth, washing and small bits threw ~950 shadow casters at the Stadtfest (shadow pass 1300 draw calls) */
      g.scene.traverse(o => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = true; floatify(o.geometry); } });
      let farScene = null; // optional low-poly LOD for trees ("far": file), drawn beyond ~260 m
      if (e.far) try { farScene = (await loader.loadAsync(new URL(e.far, base).href)).scene; farScene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; floatify(o.geometry); } }); } catch {}
      return { ...e, scene: g.scene, farScene, clips: g.animations || [] };
    } catch { try { const g = await loader.loadAsync(new URL(e.file, base).href + '?r=1'); return { ...e, scene: g.scene, farScene: null, clips: g.animations || [] }; } catch { return null; } } /* one retry: a dropped connection should not cost the model */
  }
  loadOne = one;
  return new Assets([...ok.filter(Boolean), ...skipped.map(stub)]);
}

// meshopt packing quantizes positions/normals/UVs to 8/16-bit integers. The static batching bakes the world matrix into a copy
// of every still mesh (applyMatrix4 + mergeGeometries): on integer attributes that clamps or refuses to merge.
// And on the Mac (Metal via ANGLE) 8/16-bit vertex formats cost ~4 fps at the Stadtfest even on figures.
// So every mesh goes back to plain floats once at load (GPU memory as before compression, the download stays small).
export function floatify(g) {
  for (const k in g.attributes) { const a = g.attributes[k]; if (k === 'skinIndex') continue; /* bone indices stay integers */
    if (!a.isInterleavedBufferAttribute && a.array instanceof Float32Array && !a.normalized) continue;
    const n = a.itemSize, f = new Float32Array(a.count * n), get = [a.getX, a.getY, a.getZ, a.getW];
    for (let i = 0; i < a.count; i++) for (let j = 0; j < n; j++) f[i * n + j] = get[j].call(a, i);
    g.setAttribute(k, new THREE.BufferAttribute(f, n)); }
}

function fake(e) { // box with the model's size, origin bottom centre, orange nose on the front (+Z)
  const g = new THREE.Group(), [w, h, d] = e.size;
  const col = { house: 0xb08060, house_big: 0xa07050, church: 0xcccccc, stall: 0xcc4444, cliff: 0x777777, boat: 0x6b4a2a, animal_land: 0xeeeeee, bird: 0x222222 }[e.category] ?? 0x4477aa;
  const z0 = e.category === 'waterfall' ? -d / 2 : 0; // waterfall models: origin on the road-side edge
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: col })); b.position.set(0, h / 2, z0); b.castShadow = true; g.add(b);
  const n = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, h * 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xff5a1f })); n.position.set(0, h * 0.5, z0 + d / 2 + 0.15); g.add(n);
  return { ...e, scene: g, farScene: e.far ? g.clone(true) : null, clips: [] };
}

export class Assets {
  constructor(list) {
    for (const e of list) if (/mensch_mit_hund|ziege_am_strick|pferdewagen|eselkarren/.test(e.file || '') && e.category === 'figure_walk') e.category = 'figure_lane'; // person + animal / horse + wagon in one model: only where the code sets them on purpose (lanes), never as a random roadside figure (Mac mini: a wagon stood sideways in a meadow)
    this.list = list; this.by = {}; this.used = new Set(); // which models a ride really places (?assetstats logs it: basis for loading only those)
    for (const e of list) (this.by[e.category] ||= []).push(e);
    this.rocks = list.filter(e => e.name.startsWith('Fels:'));
  }
  get count() { return this.list.length; }
  /** the same models minus what a world mode switches off (see worldView) */
  only(pred) { const v = new Assets(this.list.filter(pred)); v.used = this.used; return v; }
  /** the same models, but copies of the switched-off ones come out flagged `off` (no animation) and are dropped after placing:
   *  every random draw and footprint stays as in the full world, so a mode only takes things away (Mac mini 12.11.: the village moved) */
  hide(keep, thin = null) { const v = Object.create(this), make = this.make.bind(this);
    v.make = (e, anim, r = Math.random) => { if (keep(e) && !(thin && thin(e))) return make(e, anim, r); // thin: drops single copies without touching the placement dice
      if (e.clips.length) for (let i = 0, n = e.category === 'laundry' ? e.clips.length : 1; i < n; i++) r(); // the same draws as make()
      const obj = e.scene.clone(true); obj.userData.asset = e.file; obj.userData.off = true; return { obj, mixer: null }; };
    return v; }
  has(cat) { return !!this.by[cat]?.length; }
  find(part, r = Math.random) { // exact name first ('ritter' is not 'reiter_ritter'); a base name may hand out one of its loaded variants (r: the caller's dice)
    const base = this.list.find(e => e.file.split('/').pop().replace(/\.glb$/, '') === part && !e.variant_of);
    if (base) { const v = this.list.filter(e => e.variant_of === part); return v.length && r() < v.length / (v.length + 1) ? v[Math.floor(r() * v.length)] : base; }
    return this.list.find(e => e.file.split('/').pop().replace(/\.glb$/, '') === part) || this.list.find(e => e.file.includes(part) && !e.variant_of) || this.list.find(e => e.file.includes(part)); }
  pick(cat, r) { const l = this.by[cat]; return l?.length ? l[Math.floor(r() * l.length) % l.length] : null; }
  /** A placed copy. Returns { obj, mixer|null }; animations start at a random phase. */
  make(e, anim, r = Math.random) {
    if (e.stub) { if (e.clips.length) r(); const obj = new THREE.Group(); obj.userData.asset = e.file; obj.userData.off = true; return { obj, mixer: null }; } // not loaded at this graphics level
    const skinned = e.clips.length > 0;
    const obj = skinned ? skClone(e.scene) : e.scene.clone(true);
    obj.userData.asset = e.file; this.used.add(e.file);
    let mixer = null;
    if (e.clips.length) {
      mixer = new THREE.AnimationMixer(obj);
      const play = e.category === 'laundry' ? e.clips : [e.clips.find(c => c.name === anim) || e.clips[0]];
      for (const c of play) { const a = mixer.clipAction(c); a.play(); a.time = r() * c.duration; }
      if (e.file.includes('buckelwal')) mixer.stopAllAction();
    }
    const wheel = obj.getObjectByName('muehlrad'); if (wheel) wheel.userData.millWheel = true;
    if (!e.fxDone) { e.fxDone = true; // the MacBook's magic and lava materials (shared by all copies): sparks glow additively, lava pulses
      e.scene.traverse(o => { const ms = o.material ? [].concat(o.material) : []; for (const m of ms) {
        if (m.name === 'magie') { m.blending = THREE.AdditiveBlending; m.depthWrite = false; m.transparent = true; m.needsUpdate = true; }
        if ((m.name === 'lava' || m.name === 'augenglut') && m.emissive) { m.userData.glow0 = m.emissiveIntensity || 1; GLOW.add(m); } } }); }
    return { obj, mixer };
  }
  clip(e, name) { return e.clips.find(c => c.name === name) || null; }
  /** lava and glowing eyes breathe (call once per frame) */
  pulse(t) { for (const m of GLOW) m.emissiveIntensity = m.userData.glow0 * (0.75 + 0.35 * Math.sin(t * 2.6) + 0.12 * Math.sin(t * 7.3)); }
}
const GLOW = new Set();

/* ---- graphics levels (Freddy 12.11. world modes, 13.11. "Grafik in 4 Stufen, damit der Arbeitsspeicher nicht so hoch sein muss") ----
   4 voll  = everything, the castle falls            3 ruhig = about half the people and animals, no siege
   2 natur = a few people and animals, lighter rendering   1 leer  = landscape only (trees, rock, water), nothing happens
   The ids are the old world modes, so saved settings keep working. */
// decided by category, not by words in the description: substrings hit "rOMAnisch", "wiKINGer", "dREHen", "ZIEGEl", "moosgrün", "TreBUCHEt" (Mac mini check of all 608 models)
const WITH_PEOPLE = /^(reiter_ritter|personenkutsche|ruderboot|heissluftballon|zuschauer_tribuene)$/; // models outside figure_* with people on board
// the story and the challenges need these on every level above "leer": wizard, hell, arches, challengers
const ALWAYS = /^(zauberer|magier|hexer|teufel|drache|fledermaeuse|vogelschwarm|lava_|feuer|hoellen|totenschaedel|obsidian|gluehende|start_torbogen|ziel_torbogen|reiter_ritter|ritter$|oma|kind|moewe|seeadler|adler)/;
export const WORLD_MODES = [['voll', '4 · Voll belebt'], ['ruhig', '3 · Weniger Menschen und Tiere'], ['natur', '2 · Kaum Menschen und Tiere'], ['leer', '1 · Nur Landschaft']];
const LEVEL = { voll: 4, ruhig: 3, natur: 2, leer: 1 }, SHARE = { ruhig: [0.7, 0.75], natur: [0.35, 0.45] }, COPIES = { ruhig: 0.6, natur: 0.5 }; // model families [people, animals] loaded; share of their copies placed (Mac mini 13.11.: families alone took only 7 % of the Stadtfest crowd)
const cat = e => e.category || '', bname = e => (e.file || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').toLowerCase();
const isPerson = e => /^figure/.test(cat(e)) || WITH_PEOPLE.test(bname(e)), isAnimal = e => /^(animal|bird)/.test(cat(e));
const share = e => { let h = 2166136261; for (const c of (e.variant_of || bname(e))) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h / 4294967296; }; // a model family stays or goes together
/** which models a level downloads and shows */
export function loadKeep(mode) {
  if (!LEVEL[mode] || mode === 'voll') return () => true;
  const keepCat = e => /^(cockpit|rider|fx)/.test(cat(e));
  if (mode === 'leer') return e => keepCat(e) || (!isPerson(e) && !isAnimal(e) && (/^(tree|cliff|waterfall)/.test(cat(e)) || /^Fels:/.test(e.name || '')));
  const [p, a] = SHARE[mode];
  return e => keepCat(e) || ALWAYS.test(bname(e)) || ALWAYS.test(e.variant_of || '') || (isPerson(e) ? share(e) < p : isAnimal(e) ? share(e) < a : true);
}
export function worldView(A, mode, stable = false) { // stable: placement (see hide)
  const k = loadKeep(mode), keep = e => !e.stub && k(e);
  if ((!mode || mode === 'voll') && !A.list.some(e => e.stub)) return A;
  let n = 0; const c = COPIES[mode], thin = c ? e => (isPerson(e) || isAnimal(e)) && !ALWAYS.test(bname(e)) && ((++n * 0.6180339887) % 1) >= c : null; // every copy counts on: an even thinning, the same on every load
  return stable ? A.hide(keep, thin) : A.only(keep);
}
