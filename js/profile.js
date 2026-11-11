// Elevation profile drawings (card SVG, detail canvas, live HUD canvas).
import { STEP } from './track.js';

const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function sample(track, count) {
  const out = []; const n = track.ele.length;
  for (let i = 0; i < count; i++) { const k = Math.round(i / (count - 1) * (n - 1)); out.push(track.ele[k]); }
  return out;
}

export function profileSVG(track, { w = 400, h = 90, pad = 6 } = {}) {
  const pts = sample(track, 120);
  const lo = Math.min(...pts), hi = Math.max(...pts), span = Math.max(30, hi - lo);
  const xy = pts.map((e, i) => [i / (pts.length - 1) * w, h - pad - (e - lo) / span * (h - pad * 2 - 10)]);
  const line = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${line} L ${w} ${h} L 0 ${h} Z" fill="rgba(244,244,239,.14)"/><path d="${line}" fill="none" stroke="var(--paper)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function setup(canvas) {
  const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W: r.width, H: r.height };
}

/** Detail chart: grade-shaded profile with axes. */
export function drawDetailProfile(canvas, track) {
  const { ctx, W, H } = setup(canvas);
  ctx.clearRect(0, 0, W, H);
  const left = 44, bottom = 24, top = 10;
  const lo = Math.floor(track.minEle / 50) * 50, hi = Math.ceil(track.maxEle / 50) * 50 + 20;
  const X = d => left + d / track.length * (W - left);
  const Y = e => top + (1 - (e - lo) / Math.max(1, hi - lo)) * (H - top - bottom);
  ctx.font = '600 11px Archivo'; ctx.fillStyle = css('--muted'); ctx.strokeStyle = 'rgba(244,244,239,.08)'; ctx.lineWidth = 1;
  const stepE = (hi - lo) > 600 ? 200 : (hi - lo) > 250 ? 100 : 50;
  for (let e = lo; e <= hi; e += stepE) { ctx.beginPath(); ctx.moveTo(left, Y(e)); ctx.lineTo(W, Y(e)); ctx.stroke(); ctx.fillText(e + ' m', 0, Y(e) + 4); }
  const km = track.length / 1000, stepK = km > 60 ? 10 : km > 25 ? 5 : km > 8 ? 2 : 1;
  for (let k = 0; k <= km; k += stepK) ctx.fillText(k + ' km', Math.min(W - 34, X(k * 1000) + 2), H - 6);
  // bars coloured by grade: steeper = brighter, >= 8 % = accent
  const acc = css('--accent');
  const bars = Math.min(track.ele.length - 1, Math.floor(W - left) / 3);
  for (let b = 0; b < bars; b++) {
    const d0 = b / bars * track.length, d1 = (b + 1) / bars * track.length;
    const i0 = Math.floor(d0 / STEP), i1 = Math.max(i0 + 1, Math.floor(d1 / STEP));
    const g = (track.ele[Math.min(i1, track.ele.length - 1)] - track.ele[i0]) / ((i1 - i0) * STEP) * 100;
    const e = Math.max(track.ele[i0], track.ele[Math.min(i1, track.ele.length - 1)]);
    ctx.fillStyle = g >= 8 ? acc : `rgba(244,244,239,${g > 4 ? .5 : g > 1 ? .3 : .16})`;
    ctx.fillRect(X(d0), Y(e), Math.max(1, X(d1) - X(d0) + 0.5), H - bottom - Y(e));
  }
  ctx.beginPath(); track.ele.forEach((e, i) => { const x = X(i * STEP), y = Y(e); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = css('--paper'); ctx.lineWidth = 2; ctx.stroke();
}

/** Live HUD profile: ridden part in accent, rider + ghost markers. */
export function drawHudProfile(canvas, track, d, ghostD) {
  const { ctx, W, H } = setup(canvas);
  ctx.clearRect(0, 0, W, H);
  const lo = track.minEle - 5, hi = track.maxEle + 5, top = Math.min(24, H * 0.34), bottom = 16; // the rider pin needs ~16 px on top, the km labels 16 below
  const X = dd => dd / track.length * W;
  const Y = e => top + (1 - (e - lo) / Math.max(20, hi - lo)) * (H - top - bottom);
  const path = (to) => {
    ctx.beginPath(); ctx.moveTo(0, H - bottom);
    const n = track.ele.length; const last = Math.min(n - 1, Math.ceil(to / STEP));
    const every = Math.max(1, Math.floor(n / 600));
    for (let i = 0; i <= last; i += every) ctx.lineTo(X(Math.min(to, i * STEP)), Y(track.ele[i]));
    ctx.lineTo(X(to), Y(track.ele[last])); ctx.lineTo(X(to), H - bottom); ctx.closePath();
  };
  const acc = css('--accent');
  path(track.length); ctx.fillStyle = 'rgba(244,244,239,.3)'; ctx.fill();
  path(d); ctx.fillStyle = acc; ctx.fill();
  // km ticks
  ctx.fillStyle = 'rgba(244,244,239,.55)'; ctx.font = '700 10px Archivo';
  const km = track.length / 1000, stepK = km > 60 ? 10 : km > 25 ? 5 : km > 8 ? 2 : 1;
  for (let k = stepK; k < km; k += stepK) { ctx.fillRect(X(k * 1000), H - bottom, 1, 4); ctx.fillText(k, X(k * 1000) - 3, H - 2); }
  // ghost
  if (ghostD != null) {
    const gx = X(ghostD), gy = Y(track.ele[Math.min(track.ele.length - 1, Math.round(ghostD / STEP))]);
    ctx.strokeStyle = 'rgba(244,244,239,.9)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(gx, gy - 14); ctx.lineTo(gx, H - bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#0b0b0b'; ctx.strokeStyle = '#f4f4ef'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(gx, gy - 14, 5, 0, 7); ctx.fill(); ctx.stroke();
  }
  // rider
  const rx = X(d), ry = Y(track.ele[Math.min(track.ele.length - 1, Math.round(d / STEP))]);
  ctx.fillStyle = '#f4f4ef'; ctx.fillRect(rx - 1, ry - 16, 2, H - bottom - ry + 16);
  ctx.beginPath(); ctx.arc(rx, ry - 16, 7, 0, 7); ctx.fill();
  ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(rx, ry - 16, 3.5, 0, 7); ctx.fill();
}
