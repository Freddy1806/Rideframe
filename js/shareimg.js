// Share image after a ride (1080×1350, Instagram/Strava size): you on the bike at the best spot of the ride on top,
// the route from above with the ridden stretch underneath, plus the numbers. Save or share (phone share sheet).
import { MiniMap } from './minimap.js';
import { fmtTime, fmtKm, fmtNum } from './util.js';

const W = 1080, H = 1350, PH = 810, INK = '#0b0b0b', PAPER = '#f4f4ef', MUTED = '#9a9a92';
const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5a1f';
const font = (w, px, stretch = '') => `${stretch} ${w} ${px}px Archivo, system-ui, sans-serif`.trim();
const img = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });

/** route from above, zoomed to the ridden stretch */
function drawMap(g, x0, y0, w, h, track, pose, from, to, acc) {
  const mm = new MiniMap(document.createElement('canvas'), track, pose);
  if (!mm.ok) return false;
  const n = 120, rid = []; for (let i = 0; i <= n; i++) rid.push(mm._at(from + (to - from) * i / n));
  let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity;
  for (const [x, y] of rid) { ax = Math.min(ax, x); bx = Math.max(bx, x); ay = Math.min(ay, y); by = Math.max(by, y); }
  // a square around the ridden part (a straight stretch would be a hair line otherwise), 25 % air
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, r = Math.max(bx - ax, by - ay, mm.box.w * 0.02, mm.box.h * 0.02) * 0.62 || 1e-6;
  const pad = 46, s = Math.min(w - 2 * pad, h - 2 * pad) / (2 * r);
  const P = ([x, y]) => [x0 + w / 2 + (x - cx) * s, y0 + h / 2 + (y - cy) * s];
  g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip(); g.lineCap = g.lineJoin = 'round';
  const line = (pts) => { g.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); };
  line(mm.pts); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 16; g.stroke(); g.strokeStyle = 'rgba(244,244,239,.28)'; g.lineWidth = 7; g.stroke();
  line(rid); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 20; g.stroke(); g.strokeStyle = acc; g.lineWidth = 10; g.stroke();
  const [sx, sy] = P(rid[0]), [ex, ey] = P(rid[rid.length - 1]);
  g.beginPath(); g.arc(sx, sy, 11, 0, 7); g.fillStyle = PAPER; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.arc(ex, ey, 15, 0, 7); g.fillStyle = acc; g.fill(); g.lineWidth = 5; g.strokeStyle = PAPER; g.stroke();
  g.restore(); return true;
}

export async function makeShareImage({ rec, route, track, photo, pose, pb, who }) {
  try { await document.fonts.load(font(900, 40, 'expanded')); } catch {}
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), acc = accent();
  g.fillStyle = INK; g.fillRect(0, 0, W, H);
  // photo (or a plain dark sky with the route name when there is none, e.g. a video route)
  if (photo) g.drawImage(await img(photo), 0, 0, W, PH);
  else { const gr = g.createLinearGradient(0, 0, 0, PH); gr.addColorStop(0, '#2b3440'); gr.addColorStop(1, '#141414'); g.fillStyle = gr; g.fillRect(0, 0, W, PH); }
  const fade = g.createLinearGradient(0, PH - 300, 0, PH); fade.addColorStop(0, 'rgba(11,11,11,0)'); fade.addColorStop(1, 'rgba(11,11,11,.92)');
  g.fillStyle = fade; g.fillRect(0, PH - 300, W, 300);
  const top = g.createLinearGradient(0, 0, 0, 160); top.addColorStop(0, 'rgba(11,11,11,.55)'); top.addColorStop(1, 'rgba(11,11,11,0)'); g.fillStyle = top; g.fillRect(0, 0, W, 160);
  // wordmark
  g.fillStyle = acc; g.beginPath(); g.roundRect(48, 44, 46, 46, 9); g.fill();
  g.fillStyle = INK; g.beginPath(); g.moveTo(57, 81); g.lineTo(71, 60); g.lineTo(80, 70); g.lineTo(87, 56); g.lineTo(94 - 8, 81); g.closePath(); g.fill();
  g.fillStyle = PAPER; g.font = font(900, 34, 'expanded'); g.textBaseline = 'middle'; g.fillText('RIDEFRAME', 110, 68);
  if (pb) { g.font = font(900, 24, 'expanded'); const t = 'NEUE BESTZEIT', tw = g.measureText(t).width; g.fillStyle = acc; g.beginPath(); g.roundRect(W - 48 - tw - 36, 46, tw + 36, 44, 22); g.fill(); g.fillStyle = INK; g.fillText(t, W - 48 - tw - 18, 69); }
  // route name over the bottom of the photo
  g.textBaseline = 'alphabetic'; g.fillStyle = MUTED; g.font = font(800, 24, 'expanded');
  g.fillText([new Date(rec.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }), who].filter(Boolean).join(' · ').toUpperCase(), 48, PH - 92);
  g.fillStyle = PAPER; let fs = 64; g.font = font(900, fs, 'expanded'); const name = route.name || 'Fahrt';
  while (g.measureText(name).width > W - 96 && fs > 30) g.font = font(900, fs -= 4, 'expanded');
  g.fillText(name, 48, PH - 30);
  // map left, numbers right
  const mx = 32, my = PH + 24, mw = 500, mh = H - PH - 56;
  g.fillStyle = '#161616'; g.beginPath(); g.roundRect(mx, my, mw, mh, 14); g.fill();
  const from = rec.startD || 0, to = Math.min(track.length, from + rec.distance);
  if (!drawMap(g, mx, my, mw, mh, track, pose, from, to, acc)) { g.fillStyle = MUTED; g.font = font(700, 22); g.fillText('Keine Karte', mx + 40, my + mh / 2); }
  const stats = [['Distanz', fmtKm(rec.distance), 'km'], ['Zeit', fmtTime(rec.duration), ''], ['Ø Leistung', fmtNum(rec.avgPower), 'W'],
    ['Höhenmeter', fmtNum(rec.gain), 'hm'], ['Ø Tempo', fmtNum(rec.distance / Math.max(1, rec.duration) * 3.6, 1), 'km/h'], ['Arbeit', fmtNum(rec.avgPower * rec.duration / 1000), 'kJ']];
  const sx = mx + mw + 44, colW = (W - sx - 32) / 2, rowH = mh / 3;
  stats.forEach(([l, v, u], i) => {
    const x = sx + (i % 2) * colW, y = my + Math.floor(i / 2) * rowH + 50;
    g.fillStyle = MUTED; g.font = font(800, 20, 'expanded'); g.fillText(l.toUpperCase(), x, y);
    let fs = 58, vw, uw; const fit = () => { g.font = font(800, 24, 'expanded'); uw = u ? g.measureText(u).width + 8 : 0; g.font = font(900, fs, 'expanded'); vw = g.measureText(v).width; };
    for (fit(); vw + uw > colW - 18 && fs > 30; fit()) fs -= 2;
    g.fillStyle = PAPER; g.fillText(v, x, y + 66);
    if (u) { g.fillStyle = MUTED; g.font = font(800, 24, 'expanded'); g.fillText(u, x + vw + 8, y + 66); }
  });
  if (rec.workout) { g.fillStyle = acc; g.font = font(800, 20, 'expanded'); g.fillText(('Workout: ' + rec.workout).toUpperCase().slice(0, 40), sx, H - 44); }
  return c;
}

/** preview with Save / Share */
export async function shareModal(opts) {
  const { account } = await import('./account.js');
  const c = await makeShareImage({ ...opts, who: account()?.name || '' });
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  const file = new File([blob], `RIDEFRAME_${(opts.route.name || 'Fahrt').replace(/[^\w-]+/g, '_')}.jpg`, { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  const m = document.createElement('div'); m.className = 'modal sharebox';
  const canShare = !!navigator.canShare?.({ files: [file] });
  m.innerHTML = `<div class="box"><img src="${url}" alt="Bild zum Teilen">
    <div class="actions">${canShare ? '<button class="btn ghost" id="sShare">Teilen</button>' : ''}<button class="btn ghost" id="sSave">Speichern</button><button class="btn" id="sOk">Fertig</button></div>
    <p class="hint">Tipp: Auf Strava kannst du das Bild in der Fahrt unter „Bearbeiten“ als Foto hinzufügen.</p></div>`;
  document.body.append(m);
  const close = () => { m.remove(); URL.revokeObjectURL(url); };
  m.querySelector('#sOk').onclick = close;
  m.onclick = e => { if (e.target === m) close(); };
  m.querySelector('#sSave').onclick = () => { const a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); };
  m.querySelector('#sShare')?.addEventListener('click', () => navigator.share({ files: [file], title: 'RIDEFRAME' }).catch(() => {}));
}
