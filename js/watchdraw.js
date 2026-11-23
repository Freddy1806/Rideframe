// Drawing for the Garmin watch, shared by the preview (watch.html, js/watchsim.js) and the phone editor (js/watchcfg.js),
// so a data page looks the same in both. Canvas calls that map one to one to Monkey C's dc (fillCircle, drawText, drawArc):
// sizes are fractions of the round screen S, colours come from the face (AMOLED: full colour; MIP: the 64-colour palette).
import { MODES, ICONS } from './theme.js';
import { FIELDS } from './watchfields.js';

/** the faces: Forerunner 265 (416 px AMOLED) and fenix 7X Pro (280 px MIP, every colour one of 00 / 55 / AA / FF per channel).
 *  lbl = field labels: grey on AMOLED, white on MIP (no thin grey text on the fenix), line = separators; touch: all three have a touchscreen (23.11.) */
export const FACES = [
  { id: 'fr265', name: 'Forerunner 265', sub: '416 × 416 AMOLED', S: 416, mip: false, touch: true, C: { bg: '#000000', fg: '#f4f4ef', dim: '#8b8b85', faint: '#2c2c2a', lbl: '#a3a39c', line: '#3a3a37', acc: '#ff5a1f', ink: '#0b0b0b', hr: '#ff5a5a', good: '#3ddc84', bad: '#ff5a5a',
    sp: { run: '#ff5a1f', ride: '#ff5a1f', kraft: '#ff5a1f', other: '#ff5a1f' } } },
  { id: 'fenix7xpro', name: 'fenix 7X Pro', sub: '280 × 280 MIP · 64 colours', S: 280, mip: true, touch: true, C: { bg: '#000000', fg: '#ffffff', dim: '#aaaaaa', faint: '#555555', lbl: '#ffffff', line: '#555555', acc: '#ff5500', ink: '#000000', hr: '#ff5555', good: '#55ff55', bad: '#ff5555',
    sp: { run: '#ff5500', ride: '#ff5500', kraft: '#ff5500', other: '#ff5500' } } },
  // the owner's watch (20.11.): fenix 8 Solar 47 mm, 260 px MIP, 5 buttons and touch; same palette as the 7X Pro
  { id: 'fenix8solar47mm', name: 'fenix 8 Solar', sub: '47 mm · 260 × 260 MIP · 64 colours', S: 260, mip: true, touch: true, C: { bg: '#000000', fg: '#ffffff', dim: '#aaaaaa', faint: '#555555', lbl: '#ffffff', line: '#555555', acc: '#ff5500', ink: '#000000', hr: '#ff5555', good: '#55ff55', bad: '#ff5555',
    sp: { run: '#ff5500', ride: '#ff5500', kraft: '#ff5500', other: '#ff5500' } } },
];
/** the face's colours with the sport's accent */
export const tint = (C, sp) => ({ ...C, acc: C.sp[sp] || C.acc });

export const DEG = Math.PI / 180;
const FONT = (w, p) => `${w} ${p}px Archivo, system-ui, sans-serif`;
export function fit(g, t, max, px, w = 800) { let p = px; g.font = FONT(w, p); while (g.measureText(t).width > max && p > px * .62) { p -= 1; g.font = FONT(w, p); }
  if (g.measureText(t).width <= max) return t; let s = t; while (s.length > 1 && g.measureText(s + '.').width > max) s = s.slice(0, -1); return s.trim() + '.'; }
/** the texts drawn while TXT.on (the preview turns it on for one face, so the UI test can read the screen) */
export const TXT = Object.assign([], { on: false });
export function txt(g, t, x, y, px, col, o = {}) { const w = o.w || 800; t = String(t); if (TXT.on && y > -50) TXT.push(t); if (o.max) t = fit(g, t, o.max, px, w); else g.font = FONT(w, px);
  g.fillStyle = col; g.textAlign = o.al || 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y); return g.measureText(t).width; }
export const pill = (g, x, y, w, h, col, fill = true) => { g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, h / 2); if (fill) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.lineWidth = 2; g.stroke(); } };
export const arc = (g, cx, cy, r, a0, a1, col, lw) => { g.beginPath(); g.arc(cx, cy, r, a0, a1); g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'butt'; g.stroke(); };
export const line = (g, x0, y0, x1, y1, col, lw) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'butt'; g.stroke(); };
export const dot = (g, x, y, r, col) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); };
export function startHint(g, S, C) { arc(g, S / 2, S / 2, S / 2 - S * .02, -30 * DEG - 12 * DEG, -30 * DEG + 12 * DEG, C.acc, S * .03); } // points at the START button (2 o'clock)
export function tri(g, x, y, s, up, col) { g.beginPath(); g.moveTo(x - s, up ? y + s * .6 : y - s * .6); g.lineTo(x + s, up ? y + s * .6 : y - s * .6); g.lineTo(x, up ? y - s * .6 : y + s * .6); g.closePath(); g.fillStyle = col; g.fill(); }
export function heart(g, x, y, s, col) { g.fillStyle = col; g.beginPath(); g.moveTo(x, y + s * .45); g.bezierCurveTo(x - s * .9, y - s * .1, x - s * .45, y - s * .75, x, y - s * .3); g.bezierCurveTo(x + s * .45, y - s * .75, x + s * .9, y - s * .1, x, y + s * .45); g.fill(); }
/** a line icon of the app (js/theme.js, 24 × 24) at x, y with size s: on the watch these are bitmaps per screen size */
const PATHS = {};
export function icon(g, k, x, y, s, col, lw = 2.4) {
  const P = PATHS[k] ||= (ICONS[k] || '').match(/<(circle|path)[^>]*>/g)?.map(e => { const a = n => +(e.match(new RegExp(` ${n}="([^"]+)"`)) || [])[1];
    if (e.startsWith('<circle')) { const p = new Path2D(); p.arc(a('cx'), a('cy'), a('r'), 0, Math.PI * 2); return p; } return new Path2D(e.match(/ d="([^"]+)"/)[1]); }) || [];
  g.save(); g.translate(x - s / 2, y - s / 2); g.scale(s / 24, s / 24); g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round'; for (const p of P) g.stroke(p); g.restore();
}
export const SPORT_ICON = { run: 'run', ride: 'ride', trainer: 'trainer', kraft: 'kraft', more: 'other', other: 'other' };

/** a value with its unit after it, centred on x and kept inside max (the value shrinks, the unit goes first when there is no room) */
export function valUnit(g, x, y, v, u, px, max, col, ucol) {
  const up = Math.max(px * .3, 11); let p = px, vw, uw = 0;
  const m = () => { g.font = FONT(900, p); vw = g.measureText(v).width; g.font = FONT(800, up); uw = u ? g.measureText(u).width + up * .3 : 0; };
  m(); while (vw + uw > max && p > px * .66) { p -= 1; m(); }
  if (vw + uw > max) uw = 0;
  const x0 = x - (vw + uw) / 2; txt(g, v, x0, y, p, col, { al: 'left', w: 900, max: uw ? 0 : max });
  if (uw) txt(g, u, x0 + vw + up * .3, y + p * .5 - up * .62, up, ucol, { al: 'left', w: 800 });
}

/* ---- one data page: 1 field = full, 2 = split, 3 = big top + 2 below, 4 = big top + 2 + 1 (the classic round layout:
 *      the widest rows hold two numbers, the narrow bottom one) ---- */
const LAY = {
  1: { c: [[.5, .53, .32, .3, .84]], h: [] },
  2: { c: [[.5, .34, .2, .2, .74], [.5, .72, .58, .2, .7]], h: [.5], v: null },
  3: { c: [[.5, .33, .18, .2, .7], [.29, .7, .575, .14, .37], [.71, .7, .575, .14, .37]], h: [.48], v: [.48, .9] },
  4: { c: [[.5, .255, .13, .16, .6], [.29, .5, .405, .13, .37], [.71, .5, .405, .13, .37], [.5, .765, .67, .13, .5]], h: [.355, .615], v: [.355, .615] },
}; // [x, value y, label y, value size, max width]
/** draws the fields ids of sport sp; val(id) -> the text (the demo value when null) */
export function drawPage(g, S, C, sp, ids, val = null) {
  const L = LAY[Math.min(4, Math.max(1, ids.length))], F = FIELDS[sp] || FIELDS.other, lpx = S * (S < 320 ? .056 : .05);
  for (const y of L.h) { const hw = Math.sqrt(Math.max(0, .25 - (y - .5) ** 2)) * S - S * .05; line(g, S / 2 - hw, y * S, S / 2 + hw, y * S, C.line, Math.max(2, S * .006)); }
  if (L.v) line(g, S / 2, L.v[0] * S, S / 2, L.v[1] * S, C.line, Math.max(2, S * .006));
  ids.slice(0, 4).forEach((id, i) => { const [x, y, ly, px, mw] = L.c[i], f = F[id] || { l: id, u: '', demo: '--' }, small = px < .15;
    const hrt = id === 'hr' && !small, lw = txt(g, f.l.toUpperCase(), x * S + (hrt ? S * .022 : 0), ly * S, lpx, C.lbl, { w: 800, max: mw * S - (hrt ? S * .05 : 0) });
    if (hrt) heart(g, x * S + S * .022 - lw / 2 - S * .035, ly * S, S * .034, C.hr); // the heart before "HEART RATE"
    valUnit(g, x * S, y * S, val ? val(id) : f.demo, small && ids.length > 1 ? '' : f.u, px * S, mw * S, C.fg, C.lbl); });
}
/** page dots on the left edge: where the UP / DOWN buttons are */
export function pageDots(g, S, C, n, i) {
  if (n < 2) return; const r = S / 2 - S * .035, a0 = 180 + (n - 1) * 5; // the first page on top
  for (let k = 0; k < n; k++) { const a = (a0 - k * 10) * DEG, x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r; dot(g, x, y, S * (k === i ? .016 : .011), k === i ? C.acc : C.dim); }
}
/** the recording ring at the top in the sport's colour (dim while paused) */
export function recRing(g, S, C, on) { arc(g, S / 2, S / 2, S / 2 - S * .012, -120 * DEG, -60 * DEG, on ? C.acc : C.dim, S * .024); }

/** 64-colour MIP: every pixel snapped to the palette (channels 00 / 55 / AA / FF), no soft edges, no transparency */
export function snap64(g, S) { const im = g.getImageData(0, 0, S, S), d = im.data; for (let i = 0; i < d.length; i += 4) { d[i] = Math.round(d[i] / 85) * 85; d[i + 1] = Math.round(d[i + 1] / 85) * 85; d[i + 2] = Math.round(d[i + 2] / 85) * 85; d[i + 3] = 255; } g.putImageData(im, 0, 0); }
/** one whole screen into a canvas of size S: black, round clip, draw(g, S, C), MIP snapping */
export function paintFace(g, f, dpr, draw) {
  const S = f.S; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = f.C.bg; g.fillRect(0, 0, S, S);
  g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.clip(); draw(g, S, f.C); g.restore();
  if (f.mip) snap64(g, S);
}
