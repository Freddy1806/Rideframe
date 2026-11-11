// Life along the road: villagers call out to the rider, birds sweep past the camera, carriages come the other way.
// Everything is planned from the track and the placed props, then triggered when the rider gets close,
// always ahead of the camera so it is not missed. Sounds come from assets/audio/manifest.json when present;
// without them the calls still show as speech bubbles.
import * as THREE from 'three';
import { ROAD_W } from './field.js';
import { Surprises } from './surprises.js';
import { Sound, muffle } from './sound.js';

const LINES = [
  'Godspeed, rider!', 'Faster! The King awaits!', 'Make way for the rider!', 'Huzzah!', 'Ride on, brave soul!',
  'Mind the sheep, good sir!', 'Fair winds to thee!', 'Thy legs are made of iron!', 'The tavern is open tonight!',
  'Fresh fish! Fresh fish!', 'Hark! A rider from the south!', 'May the saints guard thy wheels!',
  'Is that a horse without legs?', 'Slow down, thou madman!', 'Onward, onward!', 'Glory to the swift!',
  'The castle is under siege, beware!', 'Hail, traveller!', 'Bread! Warm bread for the weary!', 'Push, push, the hill is nigh!',
  'By my beard, what speed!', 'Well ridden, friend!', 'The feast is in the town square!', 'Watch out for the wolves!',
];

export class Events {
  constructor(world, assets) {
    this.w = world; this.A = assets; this.f = world.field; this.track = world.track;
    this.active = []; this.nextShout = 6; this.nextBird = 25 + Math.random() * 30; this.said = new Set();
    this.overlay = document.createElement('div'); this.overlay.className = 'rf-bubbles';
    Object.assign(this.overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: 5 });
    world.c.parentElement?.append(this.overlay);
    this.people = world.props.filter(o => o.userData.person);
    this.carts = this._planCarts();
    this.bands = this._groups(world.props.filter(o => o.userData.musician), 25).map(g => ({ members: g, x: avg(g, 'x'), z: avg(g, 'z') }));
    this.herds = this._groups(world.props.filter(o => o.userData.sheep), 40).filter(g => g.length >= 3).map(g => ({ members: g, x: avg(g, 'x'), z: avg(g, 'z'), done: false }));
    this.nextOrca = 0; this.lastEvent = 0;
    this.sound = new Sound(); this.sounds = null; this._loadSounds();
    this.surprises = new Surprises(world, assets, this); this.time = 0;
  }
  /** speech bubble over any object (surprises use it too) */
  say(o, text, dur = 3, style = 'call') {
    if (this.f.tunnelNear?.(this.w.d)) return; // a call with no one to see, right at a tunnel mouth, looks broken
    const b = document.createElement('div'); b.className = 'rf-bubble'; b.textContent = text; b._o = o; b._until = this.time + dur; this.overlay.append(b);
    this._voice(o, text, style);
  }
  /** the line is also spoken from where the speaker stands: far = quiet and muffled, close = loud and clear */
  _voice(o, text, style) {
    const where = this._where(o, style === 'shout' ? 220 : 110);
    this.sound.speak(text, where().vol, style, (o.id ?? 0) + text.length, where);
  }
  /** live position -> { vol, pan } for a source (an object or a fixed {x, z}) audible up to R metres */
  _where(o, R, gain = 1) {
    return () => {
      const p = o.position || o, c = this.w.camera.position, f = this._fwd || this.w.camera.getWorldDirection(new THREE.Vector3());
      const dx = p.x - c.x, dz = p.z - c.z, dist = Math.hypot(dx, dz), fl = Math.hypot(f.x, f.z) || 1;
      const side = (dx * -f.z + dz * f.x) / fl; // + = to the right
      return { vol: gain * Math.max(0, 1 - dist / R) ** 1.5, pan: side / Math.max(6, dist) * 0.9 };
    };
  }
  /** world sound effects (siege, waterfalls): synthesised unless a recording is in the manifest */
  sfx(name, vol, pan) { if (!this.w.instant) this.sound.sfx(name, vol, pan); }

  async _loadSounds() {
    try {
      const m = await (await fetch('assets/audio/manifest.json')).json();
      this.sounds = m; this.lines = (m.shouts || []).map(s => s.text); this.sound.setManifest(m);
    } catch { this.sounds = {}; }
  }

  /** one oncoming horse-drawn cart per village stretch */
  _planCarts() {
    const out = [], segs = this.track.segments || [];
    for (const s of segs) if (s.village) { const L = s.to - s.from; out.push({ at: s.from + L * (0.3 + Math.random() * 0.4), done: false }); }
    if (!out.length) for (let d = 3000; d < this.track.length - 2000; d += 7000) out.push({ at: d, done: false });
    return out;
  }

  /** props close together = one band / one herd */
  _groups(list, R) {
    const out = [];
    for (const o of list) { const g = out.find(g => Math.hypot(g[0].position.x - o.position.x, g[0].position.z - o.position.z) < R); g ? g.push(o) : out.push([o]); }
    return out;
  }
  _ahead(x, z, cam, minDot = 0.6) {
    const fwd = this.w.camera.getWorldDirection(new THREE.Vector3()), dx = x - cam.x, dz = z - cam.z, dist = Math.hypot(dx, dz) || 1;
    return { dist, inView: (dx * fwd.x + dz * fwd.z) / (dist * (Math.hypot(fwd.x, fwd.z) || 1)) > minDot };
  }

  update(time, dt, cam, d) {
    if (this.w.instant) return;
    this.time = time;
    this._fwd = this.w.camera.getWorldDirection(this._fwd || new THREE.Vector3());
    this.sound.tick();
    this._ambience(time, dt, cam, d);
    this.surprises.update(time, dt, cam, d);
    this._bands(cam);
    this._wolf(time, dt, cam);
    this._orcas(time, dt, cam, d);
    this._shouts(time, cam);
    this._birds(time, dt, cam);
    this._carts(dt, d);
    for (const e of this.active) { e.mixer?.update(Math.min(dt, 0.1)); e.mixer2?.update(Math.min(dt, 0.1)); }
  }

  // ---- calls from villagers ----
  _shouts(time, cam) {
    for (const b of this.overlay.children) { // keep bubbles over their speaker, fade them out
      const o = b._o; const v = new THREE.Vector3(o.position.x, o.position.y + (o.userData.h || 1.9) + 0.4, o.position.z).project(this.w.camera);
      const W = this.overlay.clientWidth, H = this.overlay.clientHeight;
      if (v.z > 1 || time > b._until) { b.remove(); continue; }
      const bw = b.offsetWidth || 200, bh = b.offsetHeight || 40; // keep the whole bubble on screen
      const px = Math.max(bw / 2 + 8, Math.min(W - bw / 2 - 8, (v.x * .5 + .5) * W)), py = Math.max(bh + 8, Math.min(H - 8, (-v.y * .5 + .5) * H));
      b.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`;
      b.style.visibility = o.visible === false || Math.abs(v.x) > 1.15 || v.y > 1.35 || v.y < -1.1 ? 'hidden' : ''; // speaker out of view: no orphan bubble
    }
    if (time < this.nextShout) return;
    const fwd = this.w.camera.getWorldDirection(new THREE.Vector3());
    let best = null, bd = 1e9;
    for (const o of this.people) {
      if (!o.visible || this.said.has(o)) continue;
      const dx = o.position.x - cam.x, dz = o.position.z - cam.z, dist = Math.hypot(dx, dz);
      if (dist < 12 || dist > 45 || (dx * fwd.x + dz * fwd.z) / dist < 0.75) continue; // ahead, in view, close enough to hear
      if (dist < bd) { bd = dist; best = o; }
    }
    if (!best) return;
    this.said.add(best); this.nextShout = time + 7 + Math.random() * 7;
    const pool = this.sounds?.shouts?.length ? this.sounds.shouts : LINES.map(text => ({ text }));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const b = document.createElement('div'); b.className = 'rf-bubble'; b.textContent = pick.text; b._o = best; b._until = time + 3.2;
    this.overlay.append(b);
    if (pick.file) this.sound.voiceFile(pick.file, this._where(best, 110, 0.95)); else this._voice(best, pick.text, 'call');
  }

  // ---- a bird sweeping close past the camera ----
  _birds(time, dt, cam) {
    if (time > this.nextBird) {
      this.nextBird = time + 60 + Math.random() * 60;
      const e = this.A.list.find(x => x.category === 'bird' && /adler|moewe/.test(x.file));
      if (e) {
        const { obj, mixer } = this.A.make(e, 'Gleiten');
        const fwd = this.w.camera.getWorldDirection(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x), side = Math.random() < .5 ? -1 : 1;
        const start = cam.clone().addScaledVector(fwd, 70).addScaledVector(right, side * 18); start.y = cam.y + 5 + Math.random() * 3;
        const end = cam.clone().addScaledVector(fwd, -30).addScaledVector(right, -side * 4); end.y = cam.y + 2.5;
        obj.position.copy(start); obj.lookAt(end); obj.layers.enableAll?.();
        this.w.scene.add(obj);
        this.active.push({ obj, mixer, start, end, t: 0, dur: 6.5, kind: 'bird' });
        const call = /adler/.test(e.file) ? 'adler' : Math.random() < 0.5 ? 'moewe' : 'moewe2', w = this._where(obj, 120, 0.8);
        this.sound.play3d(call, w); setTimeout(() => this.sound.play3d(call, w, 0.7), 2600 + Math.random() * 1500);
      }
    }
    for (const e of this.active) if (e.kind === 'bird') {
      e.t += dt; const k = Math.min(1, e.t / e.dur);
      e.obj.position.lerpVectors(e.start, e.end, k); e.obj.position.y += Math.sin(k * Math.PI) * 1.5;
      if (k >= 1) e.dead = true;
    }
    this._sweep();
  }

  // ---- horse and cart coming the other way ----
  _carts(dt, d) {
    const cartE = this.A.find('personenkutsche') || this.A.list.find(x => x.file.includes('kutsche')), horseE = this.A.list.find(x => x.file.includes('pferd'));
    for (const c of this.carts) {
      if (c.done || !cartE || d < c.at - 260 || d > c.at) continue;
      c.done = true;
      const cm = this.A.make(cartE, 'Schaukeln'), cart = cm.obj, horse = horseE ? this.A.make(horseE, 'Gehen') : null;
      const grp = new THREE.Group(); grp.add(cart); if (horse) { horse.obj.position.z = cartE.size[2] / 2 + horseE.size[2] / 2 + 0.3; grp.add(horse.obj); }
      this.w.scene.add(grp);
      this.active.push({ obj: grp, mixer: horse?.mixer, mixer2: cm.mixer, kind: 'cart', d: c.at + 120, v: -3.2, w: Math.min(cartE.size[0], cartE.size[2]) }); // starts ahead, rolls towards the rider
    }
    for (const e of this.active) if (e.kind === 'cart') {
      e.d += e.v * Math.min(dt, 0.1); if (e.d < d - 80) { e.dead = true; continue; }
      { const r = this._where(e.obj, 140)(); this.sound._loop('hufe', r.vol * 0.8, r.pan, r.vol); // hooves and creaking wheels
        if (!e.neigh && r.vol > 0.35) { e.neigh = true; this.sound.play3d('pferd', this._where(e.obj, 140, 0.9)); } }
      const p = this.f.at(e.d), l = Math.hypot(p.tx, p.tz) || 1, off = -Math.min(2.5, ROAD_W - (e.w || 2) / 2 - 0.15); // keep inside the oncoming lane, clear of the rider
      const x = p.x - p.tz / l * off, z = p.z + p.tx / l * off;
      e.obj.position.set(x, this.f.ground(x, z), z); e.obj.rotation.y = Math.atan2(-p.tx, -p.tz);
      if (!e.wheels) { e.wheels = []; e.obj.traverse(o => { if (/^rad_(vorne|hinten)/.test(o.name)) e.wheels.push([o, o.name.includes('vorne') ? 0.72 : 0.58]); }); }
      for (const [w, rad] of e.wheels) w.rotation.x += -e.v / rad * Math.min(dt, 0.1); // wheels roll with the coach
    }
    this._sweep();
  }

  // ---- bands: their music fades in as you ride up, panned to their side ----
  _bands(cam) {
    const tracks = this.sounds?.music; if (!tracks?.length) return;
    let loud = 0;
    this.bands.forEach((b, i) => {
      const { dist } = this._ahead(b.x, b.z, cam), vol = Math.max(0, 1 - dist / 140);
      if (vol > 0 && !b.audio) {
        try {
          const ctx = this.ctx ||= new AudioContext(); const a = new Audio('assets/audio/' + tracks[(b.song ?? i) % tracks.length].file); a.loop = true;
          const src = ctx.createMediaElementSource(a); b.pan = ctx.createStereoPanner(); b.gain = ctx.createGain(); b.gain.gain.value = 0;
          b.lp = ctx.createBiquadFilter(); b.lp.type = 'lowpass'; b.lp.Q.value = 0.5;
          src.connect(b.lp).connect(b.pan).connect(b.gain).connect(ctx.destination); a.play().catch(() => {}); b.audio = a;
        } catch { b.audio = {}; }
      }
      if (b.gain) {
        b.gain.gain.value = vol * vol * 0.8; loud = Math.max(loud, vol); b.lp && (b.lp.frequency.value = muffle(vol * vol));
        const fwd = this.w.camera.getWorldDirection(new THREE.Vector3()), side = (b.x - cam.x) * -fwd.z + (b.z - cam.z) * fwd.x;
        b.pan.pan.value = Math.max(-0.8, Math.min(0.8, side / 40));
        if (vol === 0 && b.audio.pause) { b.audio.pause(); b.audio = null; b.gain = null; }
      }
    });
    const k = Math.round(loud * 20) / 20; // the game music gives way to the band
    if (k !== this._bandK) { this._bandK = k; window.dispatchEvent(new CustomEvent('rf-band', { detail: k })); }
  }

  // ---- a wolf breaks out of the rocks and the herd scatters ----
  _wolf(time, dt, cam) {
    const wolfE = this.A.list.find(x => x.file.includes('wolf'));
    for (const h of this.herds) {
      if (h.done) continue;
      const { dist, inView } = this._ahead(h.x, h.z, cam, 0.5);
      if (!h.baa && dist < 90) { h.baa = true; this.sound.play3d('schaf', this._where(h.members[0].position, 120, 0.7)); }
      if (!wolfE) continue;
      if (dist > 170 || dist < 50 || !inView) continue;
      h.done = true;
      const { obj, mixer } = this.A.make(wolfE, 'Rennen'); obj.userData.walk = null;
      const away = new THREE.Vector3(h.x - cam.x, 0, h.z - cam.z).normalize(), side = new THREE.Vector3(-away.z, 0, away.x);
      const start = new THREE.Vector3(h.x, 0, h.z).addScaledVector(side, 70), end = new THREE.Vector3(h.x, 0, h.z).addScaledVector(side, -90);
      obj.position.copy(start); this.w.scene.add(obj);
      this.active.push({ obj, mixer, kind: 'wolf', start, end, t: 0, dur: 9 });
      h.members.slice(0, 3).forEach((sh, i) => setTimeout(() => this.sound.play3d('schaf', this._where(sh, 160, 0.9)), 400 + i * 450));
      for (const sh of h.members) { // each sheep bolts away from the wolf's line
        const dir = new THREE.Vector3(sh.position.x - start.x, 0, sh.position.z - start.z).normalize().addScaledVector(away, 0.4).normalize();
        sh.userData.flee = { dir, t: 0 };
      }
    }
    for (const e of this.active) if (e.kind === 'wolf') {
      e.t += dt; const k = Math.min(1, e.t / e.dur), p = new THREE.Vector3().lerpVectors(e.start, e.end, k);
      e.obj.position.set(p.x, this.f.ground(p.x, p.z), p.z); e.obj.lookAt(e.end.x, e.obj.position.y, e.end.z);
      if (k >= 1) e.dead = true;
    }
    for (const h of this.herds) if (h.done) for (const sh of h.members) {
      const fl = sh.userData.flee; if (!fl || fl.t > 7) continue;
      fl.t += dt; const v = 6 * Math.max(0, 1 - fl.t / 7);
      sh.position.x += fl.dir.x * v * dt; sh.position.z += fl.dir.z * v * dt; sh.position.y = this.f.ground(sh.position.x, sh.position.z);
      sh.rotation.y = Math.atan2(fl.dir.x, fl.dir.z);
    }
  }

  // ---- orcas: a pod surfaces right in front of you where the road runs along the sea ----
  _orcas(time, dt, cam, d) {
    const orcaE = this.A.list.find(x => x.file.includes('orca'));
    if (orcaE && time > this.nextOrca) {
      this.nextOrca = time + 8; // look again in a few seconds
      const p = this.f.at(d + 160), l = Math.hypot(p.tx, p.tz) || 1;
      for (const off of [-70, -110, 70, 110]) { // sea on either side, close to the shore
        const x = p.x - p.tz / l * off, z = p.z + p.tx / l * off;
        if (this.f.height(x, z) > -4 || !this._ahead(x, z, cam, 0.55).inView) continue;
        const clip = this.A.clip(orcaE, 'Sprung');
        for (let k = 0; k < 3; k++) {
          const { obj, mixer } = this.A.make(orcaE, 'Schwimmen'); obj.traverse(c => { c.frustumCulled = false; });
          obj.position.set(x + (k - 1) * 9, 0, z + k * 6); obj.rotation.y = Math.atan2(p.tx, p.tz) + (Math.random() - .5) * .4;
          if (clip && mixer) { mixer.stopAllAction(); const a = mixer.clipAction(clip); a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.startAt(mixer.time + k * 0.7).play(); }
          this.w.scene.add(obj); this.active.push({ obj, mixer, kind: 'orca', t: 0, dur: (clip?.duration || 5) + 2.5 });
        }
        const spot = { x, z };
        for (let k = 0; k < 3; k++) setTimeout(() => this.sound.play3d('orca', this._where(spot, 260)), 900 + k * 700);
        setTimeout(() => this.sound.play3d('wal', this._where(spot, 260, 0.8)), 1900);
        this.nextOrca = time + 150 + Math.random() * 120; break;
      }
    }
    for (const e of this.active) if (e.kind === 'orca') { e.t += dt; if (e.t > e.dur) e.dead = true; }
  }

  // ---- the bed under everything: wind with your speed, surf along the sea, birds over the meadows,
  // the murmur of a market in the villages, rain when the weather turns; bells as you ride into a village ----
  _ambience(time, dt, cam, d) {
    const S = this.sound;
    if (!this.amb || time - this.amb.t > 0.5) { // the slow facts, twice a second
      const segs = this.track.segments || [], seg = segs.find(s => d >= s.from && d < s.to) || {};
      const p = this.f.at(d), l = Math.hypot(p.tx, p.tz) || 1;
      let sea = 0; for (const off of [-40, -90, 40, 90]) if (this.f.height(p.x - p.tz / l * off, p.z + p.tx / l * off) < -2) sea = Math.max(sea, Math.abs(off) < 50 ? 1 : 0.55);
      const inVillage = !!seg.village;
      if (inVillage && this.amb && !this.amb.village && time > (this.nextBell || 0)) { // just rode in: the church bell
        this.nextBell = time + 240; const a = this.f.at(d + 220); S.play3d('glocke', this._where({ x: a.x, z: a.z }, 600, 0.55));
      }
      this.amb = { t: time, sea, village: inVillage, valley: seg.land === 'valley', tunnel: this.f.tunnelNear?.(d) ? 1 : 0 };
    }
    const A = this.amb, wx = this.w.weather || {}, rain = wx.rain ?? 0, open = 1 - 0.85 * A.tunnel;
    const v = this.w.speed || 0;
    S.ambient('wind', open * (0.12 + 0.6 * Math.min(1, v / 14) ** 1.5 + 0.15 * (wx.cover || 0)));
    S.ambient('brandung', open * A.sea * 0.55);
    S.ambient('voegel', open * (A.sea ? 0.12 : 0.32) * (1 - rain) * (1 - 0.5 * (wx.cover || 0)));
    S.ambient('markt', open * (A.village ? 0.35 : 0));
    S.ambient('regen', open * Math.min(1, rain * 2) * 0.6);
    S.ambient('regen_stark', open * Math.max(0, rain - 0.5) * 2 * 0.7);
    if (rain > 0.6 && time > (this.nextThunder ??= time + 20)) { this.nextThunder = time + 40 + Math.random() * 60; S.sfx('donner', 0.5 + Math.random() * 0.4, Math.random() * 1.4 - 0.7); }
    if (A.valley && !A.village && time > (this.nextMoo ??= time + 30)) { // a cow or a goat somewhere on the pasture
      this.nextMoo = time + 60 + Math.random() * 70; const side = Math.random() < 0.5 ? -1 : 1, a = this.f.at(d + 60), l = Math.hypot(a.tx, a.tz) || 1;
      S.play3d(Math.random() < 0.6 ? 'kuh' : 'ziege', this._where({ x: a.x - a.tz / l * side * 45, z: a.z + a.tx / l * side * 45 }, 160));
    }
  }

  _sweep() {
    for (const e of this.active) if (e.dead) { this.w.scene.remove(e.obj); e.mixer?.stopAllAction(); }
    this.active = this.active.filter(e => !e.dead);
  }
}

const avg = (g, k) => g.reduce((a, o) => a + o.position[k], 0) / g.length;
