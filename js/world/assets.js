// Blender assets (assets/world/manifest.json + GLBs from the Mac). Everything optional:
// a model that is missing simply is not offered, the world then falls back to its simple built-in shapes.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { clone as skClone } from '../../vendor/jsm/utils/SkeletonUtils.js';

const base = new URL('../../assets/world/', import.meta.url);

export async function loadAssets() {
  let list = [];
  try { list = await (await fetch(new URL('manifest.json', base))).json(); } catch { return new Assets([]); }
  if (typeof window === 'undefined') return new Assets([]);
  if (new URLSearchParams(location.search).has('fakeassets')) return new Assets(list.map(fake)); // layout test without the GLBs
  const loader = new GLTFLoader();
  const ok = await Promise.all(list.map(async e => {
    try {
      const g = await loader.loadAsync(new URL(e.file, base).href);
      g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return { ...e, scene: g.scene, clips: g.animations || [] };
    } catch { return null; }
  }));
  return new Assets(ok.filter(Boolean));
}

function fake(e) { // box with the model's size, origin bottom centre, orange nose on the front (+Z)
  const g = new THREE.Group(), [w, h, d] = e.size;
  const col = { house: 0xb08060, house_big: 0xa07050, church: 0xcccccc, stall: 0xcc4444, cliff: 0x777777, boat: 0x6b4a2a, animal_land: 0xeeeeee, bird: 0x222222 }[e.category] ?? 0x4477aa;
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: col })); b.position.y = h / 2; b.castShadow = true; g.add(b);
  const n = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, h * 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xff5a1f })); n.position.set(0, h * 0.5, d / 2 + 0.15); g.add(n);
  return { ...e, scene: g, clips: [] };
}

export class Assets {
  constructor(list) {
    this.list = list; this.by = {};
    for (const e of list) (this.by[e.category] ||= []).push(e);
    this.rocks = list.filter(e => e.name.startsWith('Fels:'));
  }
  get count() { return this.list.length; }
  has(cat) { return !!this.by[cat]?.length; }
  find(part) { return this.list.find(e => e.file.split('/').pop().replace(/\.glb$/, '') === part) || this.list.find(e => e.file.includes(part)); } // exact name first: 'ritter' is not 'reiter_ritter'
  pick(cat, r) { const l = this.by[cat]; return l?.length ? l[Math.floor(r() * l.length) % l.length] : null; }
  /** A placed copy. Returns { obj, mixer|null }; animations start at a random phase. */
  make(e, anim, r = Math.random) {
    const skinned = e.clips.length > 0;
    const obj = skinned ? skClone(e.scene) : e.scene.clone(true);
    obj.userData.asset = e.file;
    let mixer = null;
    if (e.clips.length) {
      mixer = new THREE.AnimationMixer(obj);
      const play = e.category === 'laundry' ? e.clips : [e.clips.find(c => c.name === anim) || e.clips[0]];
      for (const c of play) { const a = mixer.clipAction(c); a.play(); a.time = r() * c.duration; }
      if (e.file.includes('buckelwal')) mixer.stopAllAction();
    }
    const wheel = obj.getObjectByName('muehlrad'); if (wheel) wheel.userData.millWheel = true;
    return { obj, mixer };
  }
  clip(e, name) { return e.clips.find(c => c.name === name) || null; }
}
