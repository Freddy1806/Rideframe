// Scrub-through preview of a built-in 3D route: mouse wheel / profile click moves along the road,
// play runs fast-forward. Opened from the route detail page (preview.html?route=coast).
import { makeCoastTrack } from '../routes.js';
import { timeAt } from '../track.js';
import { WorldScene } from './lofoten.js';
import { MeshBasicMaterial as THREE_Basic } from 'three';

const $ = s => document.getElementById(s);
const track = makeCoastTrack(), L = track.length;
$('rname').textContent = 'Felsenküste';
const world = new WorldScene($('gl'), track);
world.paused = true;

const Q = new URLSearchParams(location.search), AT = +(Q.get('at') || 150);
if (Q.has('top')) world.debugTop = +Q.get('top') || 120;
if (Q.has('shot')) document.querySelectorAll('.pv-top,.pv-info,.pv-bar').forEach(e => e.style.display = 'none');
world.currentTime = timeAt(track, AT);
let d = AT, target = AT, playing = false, speed = 30; // speed = multiple of riding speed (~9 m/s)
const clamp = v => Math.max(0, Math.min(L - 1, v));
function jump(v) { target = clamp(v); if (Math.abs(target - d) > 300) { d = target; world.lookPos = null; } }

addEventListener('wheel', e => { e.preventDefault(); playing = false; upd(); jump(target + (e.deltaY + e.deltaX) * 1.5); }, { passive: false });
addEventListener('keydown', e => {
  if (e.code === 'Space') { playing = !playing; upd(); e.preventDefault(); }
  if (e.key === 'ArrowRight') jump(target + 500);
  if (e.key === 'ArrowLeft') jump(target - 500);
});
$('play').onclick = () => { playing = !playing; upd(); };
document.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
  speed = +b.dataset.s; document.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', x === b));
});
function upd() { $('play').textContent = playing ? '❚❚ Pause' : '▶ Abspielen'; $('play').classList.toggle('on', playing); }

// elevation profile with segment bands
const pc = $('prof'), px = pc.getContext('2d');
const eMax = Math.max(...track.ele), eMin = Math.min(...track.ele);
function drawProf() {
  const W = pc.width = pc.clientWidth * devicePixelRatio, H = pc.height = pc.clientHeight * devicePixelRatio;
  px.clearRect(0, 0, W, H);
  for (const s of track.intervals) { px.fillStyle = 'rgba(255,90,31,.18)'; px.fillRect(s.from / L * W, 0, (s.to - s.from) / L * W, H); }
  px.beginPath(); px.moveTo(0, H);
  const n = track.ele.length;
  for (let x = 0; x <= W; x += 2) { const i = Math.min(n - 1, Math.round(x / W * (n - 1))); px.lineTo(x, H - 6 - (track.ele[i] - eMin) / (eMax - eMin + 1) * (H - 16)); }
  px.lineTo(W, H); px.closePath(); px.fillStyle = 'rgba(244,244,239,.28)'; px.fill();
  const x = d / L * W;
  px.fillStyle = 'rgba(244,244,239,.35)'; px.fillRect(0, H - 3, x, 3);
  px.fillStyle = '#ff5a1f'; px.fillRect(x - 2, 0, 4, H);
}
let drag = false;
const seekAt = e => { const r = pc.getBoundingClientRect(); jump((e.clientX - r.left) / r.width * L); };
pc.onpointerdown = e => { drag = true; playing = false; upd(); pc.setPointerCapture(e.pointerId); seekAt(e); };
pc.onpointermove = e => drag && seekAt(e);
pc.onpointerup = () => drag = false;

const segAt = x => track.segments.find(s => x >= s.from && x < s.to) || track.segments[track.segments.length - 1];
const eleAt = x => track.ele[Math.min(track.ele.length - 1, Math.round(x / L * (track.ele.length - 1)))];

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (playing) { target = clamp(target + 9 * speed * dt); if (target >= L - 1) { playing = false; upd(); } }
  d += (target - d) * Math.min(1, dt * 6);
  world.currentTime = timeAt(track, d);
  const s = segAt(d), g = track.grade[Math.min(track.grade.length - 1, Math.round(d / L * (track.grade.length - 1)))];
  $('seg').textContent = s.name;
  $('num').textContent = `${(d / 1000).toFixed(1)} / ${(L / 1000).toFixed(1)} km · ${Math.round(eleAt(d))} m · ${g.toFixed(1)} %`;
  drawProf();
  requestAnimationFrame(tick);
}
world.paused = true;
requestAnimationFrame(tick);

// test hooks for the self-test (tools/roadcheck): paint the asphalt magenta, optionally hide everything else
window.__world = world;
window.__roadTest = (only) => {
  const mag = new THREE_Basic({ color: 0xff00ff, side: 2, fog: false, toneMapped: false });
  for (const g of world.roadChunks.values()) g.children[0].material = mag;
  world.scene.traverse(o => { if (o.isMesh || o.isInstancedMesh || o.isPoints) o.visible = !only || [...world.roadChunks.values()].some(g => g.children[0] === o); });
  world.sky.visible = !only; world.instant = true; world.useAO = false; world.render(10);
};
