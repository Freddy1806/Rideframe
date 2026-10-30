// Records a time-lapse preview video of the built-in 3D route (record.html).
// Clips fly along the road at drone speed; captions are drawn on top; result downloads as MP4/WebM.
import { makeCoastTrack } from '../routes.js';
import { timeAt } from '../track.js';
import { WorldScene } from './lofoten.js';

const CLIPS = [
  { from: 150, speed: 15, sec: 14, title: 'Fischerhafen', sub: 'Start · Rorbuer am Wasser' },
  { from: 3000, speed: 18, sec: 12, title: 'Küstenstraße', sub: 'Einrollen · 10 min' },
  { from: 6350, speed: 13, sec: 16, title: 'Kirchturm-Rampe', sub: 'Intervall 1 · 8 min · 6 % · Serpentinen' },
  { from: 12600, speed: 15, sec: 12, title: 'Mühlenpass', sub: 'Intervall 2 · 10 min · 5 %' },
  { from: 20600, speed: 16, sec: 14, title: 'Klippenstraße', sub: 'Intervall 3 · 12 min · hoch über dem Meer' },
  { from: 28700, speed: 13, sec: 16, title: 'Burgberg', sub: 'Intervall 4 · 10 min · 7 % · Burg am Gipfel' },
  { from: 35600, speed: 16, sec: 12, title: 'Ausrollen', sub: 'Ziel an der Küste' },
];
if (new URLSearchParams(location.search).has('test')) { CLIPS.splice(2); CLIPS.forEach(c => c.sec = 2); }
const FPS = 30, W = 1920, H = 1080, FADE = 0.6;

const q = new URLSearchParams(location.search);
const st = document.getElementById('st');
const gl = document.getElementById('gl'), out = document.getElementById('out'), ctx = out.getContext('2d');
const track = makeCoastTrack();
const world = new WorldScene(gl, track);
world.paused = true;
// take over the loop: we drive time ourselves
world.dead = true; // stops its own RAF loop
world._w = 0;
Object.defineProperty(gl, 'clientWidth', { value: W }); Object.defineProperty(gl, 'clientHeight', { value: H });

await document.fonts.load('900 64px Archivo').catch(() => {});

function caption(clip, a) {
  ctx.save(); ctx.globalAlpha = a;
  const g = ctx.createLinearGradient(0, H - 300, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = g; ctx.fillRect(0, H - 300, W, 300);
  ctx.fillStyle = '#ff5a1f'; ctx.fillRect(80, H - 190, 10, 104);
  ctx.fillStyle = '#f4f4ef'; ctx.font = '900 76px Archivo'; ctx.textBaseline = 'top';
  ctx.fillText(clip.title.toUpperCase(), 116, H - 196);
  ctx.font = '600 30px Archivo'; ctx.fillStyle = 'rgba(244,244,239,.85)'; ctx.fillText(clip.sub, 118, H - 112);
  ctx.restore();
  // wordmark
  ctx.save(); ctx.font = '900 28px Archivo'; const wm = 'RIDEFRAME · FELSENKÜSTE', tw = ctx.measureText(wm).width;
  ctx.fillStyle = 'rgba(11,11,11,.55)'; ctx.fillRect(60, 50, tw + 90, 66); // box sized to the text
  ctx.fillStyle = '#ff5a1f'; ctx.fillRect(78, 66, 34, 34);
  ctx.fillStyle = '#f4f4ef'; ctx.textBaseline = 'middle'; ctx.fillText(wm, 126, 84);
  ctx.font = '700 18px Archivo'; ctx.fillStyle = 'rgba(244,244,239,.7)'; ctx.fillText('ZEITRAFFER-VORSCHAU', W - 300, 84);
  ctx.restore();
}

function frame(clip, t) {
  const d = clip.from + clip.speed * t;
  world.currentTime = timeAt(track, d);
  world.render(performance.now() / 1000);
  ctx.drawImage(gl, 0, 0, W, H);
  const a = Math.min(1, t / FADE, (clip.sec - t) / FADE);
  if (a < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, a)})`; ctx.fillRect(0, 0, W, H); }
  caption(clip, Math.max(0, Math.min(1, (t - 0.4) / 0.6, (clip.sec - t - 0.3) / 0.6)));
}

const stream = out.captureStream(FPS);
const types = ['video/mp4;codecs=avc3.640028', 'video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
const mime = types.find(t => MediaRecorder.isTypeSupported(t));
const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10e6 });
const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
const done = new Promise(r => rec.onstop = r);

// prepare first clip fully before recording
async function prep(clip) {
  world.instant = true; world.lookPos = null;
  world.currentTime = timeAt(track, clip.from); world.render(0);
  world.instant = false; world.lookPos = null;
  // warm-up a few frames so detail tiles near the camera are built
  for (let k = 0; k < 20; k++) { world.currentTime = timeAt(track, clip.from + clip.speed * k / FPS); world.render(0); await new Promise(r => setTimeout(r, 0)); }
  world.lookPos = null;
}

ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
await prep(CLIPS[0]);
rec.start(1000);
for (let c = 0; c < CLIPS.length; c++) {
  const clip = CLIPS[c];
  st.textContent = `Aufnahme ${c + 1}/${CLIPS.length}: ${clip.title}`;
  if (c) { rec.pause(); await prep(clip); rec.resume(); }
  const t0 = performance.now();
  await new Promise(res => {
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= clip.sec) return res();
      frame(clip, t); requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
rec.stop(); await done;
const blob = new Blob(chunks, { type: mime.split(';')[0] });
const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = q.get('name') || `Felsenkueste_Vorschau.${ext}`;
document.body.append(a); a.click();
st.textContent = `Fertig: ${(blob.size / 1e6).toFixed(1)} MB · ${ext}`;
window.__recDone = { size: blob.size, ext };
