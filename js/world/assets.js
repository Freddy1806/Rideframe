// Blender assets (assets/world/manifest.json + GLBs from the Mac). Everything optional:
// a model that is missing simply is not offered, the world then falls back to its simple built-in shapes.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../../vendor/jsm/libs/meshopt_decoder.module.js';
import { clone as skClone } from '../../vendor/jsm/utils/SkeletonUtils.js';

const base = new URL('../../assets/world/', import.meta.url);

export async function loadAssets() {
  let list = [];
  try { list = await (await fetch(new URL('manifest.json', base))).json(); } catch { return new Assets([]); }
  if (typeof window === 'undefined') return new Assets([]);
  if (new URLSearchParams(location.search).has('fakeassets')) return new Assets(list.map(fake)); // layout test without the GLBs
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); /* the Mac mini packs GLBs with meshopt + WebP (several times smaller over the home upload line) */
  list = list.filter(e => e.category !== 'rider'); // bike/hands for the riders: loaded by avatar.js
  // variants from the Mac mini (thicker, thinner, other colours: "variant_of": base name) would triple the download:
  // each ride loads only a few of them at random (?variants=N per base, default 1), so every ride looks a little different
  const nv = +(new URLSearchParams(location.search).get('variants') ?? 1), groups = {};
  for (const e of list) if (e.variant_of) (groups[e.variant_of] ||= []).push(e);
  const keep = new Set(Object.values(groups).flatMap(g => g.sort(() => Math.random() - 0.5).slice(0, nv)));
  list = list.filter(e => !e.variant_of || keep.has(e));
  // at most 6 downloads at once: hundreds in parallel made the public (Tailscale Funnel) path drop connections, and those models went missing
  const pool = (items, n, fn) => { const out = new Array(items.length); let i = 0; return Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })).then(() => out); };
  const ok = await pool(list, location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 16 : 6, async e => {
    try {
      const g = await loader.loadAsync(new URL(e.file, base).href);
      const cast = !/^(festival|laundry)/.test(e.category || '') && Math.max(...(e.size || [9])) >= 1.2; /* bunting, stalls' cloth, washing and small bits threw ~950 shadow casters at the Stadtfest (shadow pass 1300 draw calls) */
      g.scene.traverse(o => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = true; } });
      let farScene = null; // optional low-poly LOD for trees ("far": file), drawn beyond ~260 m
      if (e.far) try { farScene = (await loader.loadAsync(new URL(e.far, base).href)).scene; farScene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); } catch {}
      return { ...e, scene: g.scene, farScene, clips: g.animations || [] };
    } catch { try { const g = await loader.loadAsync(new URL(e.file, base).href + '?r=1'); return { ...e, scene: g.scene, farScene: null, clips: g.animations || [] }; } catch { return null; } } /* one retry: a dropped connection should not cost the model */
  });
  return new Assets(ok.filter(Boolean));
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
    this.list = list; this.by = {}; this.used = new Set(); // which models a ride really places (?assetstats logs it: basis for loading only those)
    for (const e of list) (this.by[e.category] ||= []).push(e);
    this.rocks = list.filter(e => e.name.startsWith('Fels:'));
  }
  get count() { return this.list.length; }
  has(cat) { return !!this.by[cat]?.length; }
  find(part) { // exact name first ('ritter' is not 'reiter_ritter'); a base name may hand out one of its loaded variants
    const base = this.list.find(e => e.file.split('/').pop().replace(/\.glb$/, '') === part && !e.variant_of);
    if (base) { const v = this.list.filter(e => e.variant_of === part); return v.length && Math.random() < v.length / (v.length + 1) ? v[Math.floor(Math.random() * v.length)] : base; }
    return this.list.find(e => e.file.split('/').pop().replace(/\.glb$/, '') === part) || this.list.find(e => e.file.includes(part) && !e.variant_of) || this.list.find(e => e.file.includes(part)); }
  pick(cat, r) { const l = this.by[cat]; return l?.length ? l[Math.floor(r() * l.length) % l.length] : null; }
  /** A placed copy. Returns { obj, mixer|null }; animations start at a random phase. */
  make(e, anim, r = Math.random) {
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
