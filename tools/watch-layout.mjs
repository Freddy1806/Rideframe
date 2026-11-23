// 23.11.8: the watch's device-true layout check. Every screen and state (tools/watch-scenes.mjs, worst-case content) is drawn by
// js/watchscreens.js (garmin/source/Draw.mc line by line) on a js/watchdc.js Dc that measures like each of the five watches (fenix 8
// Solar 47 mm also at its font size setting 0.8 and 1.45), and every text box is checked: no two texts touch, nothing outside the
// round screen (0.03 S margin), no text under the bezel arcs, the bars, pills it is not inside of, dots or icons; no fixed text cut,
// no letters in a fenix 7 number font, nothing below 13 px.
// Usage: node tools/watch-layout.mjs [scene ...]   (prints the findings; exit code 1 when there are any)
import { Dc, DEVICES } from '../js/watchdc.js';
import { DEV } from '../js/watchfontdata.js';
import { screen, palette } from '../js/watchscreens.js';
import { SCENES, NOW } from './watch-scenes.mjs';

export const MARGIN = .03, GAP = 1, MIN_PX = 13;
/** the watches and font scales checked: [device, scale] */
export const RUNS = DEVICES.flatMap(d => DEV[d].scale ? [[d, 1], [d, DEV[d].scale[0]], [d, DEV[d].scale[1]]] : [[d, 1]]);

/** draws one scene on device dev at font scale k: the Dc with its texts and shapes */
export function render(scene, dev, k = 1) {
  const [, , make] = scene, o = make(), dc = new Dc({ dev, scale: k });
  screen(dc, o.F, palette(dev.startsWith('fr265')), o.now ?? NOW, o.sum ?? null, { hasTouch: true, ...(o.ui || {}) });
  return dc;
}
const inBand = (sh, x, y) => { const dx = x - sh.x, dy = sh.y - y, d = Math.hypot(dx, dy); if (Math.abs(d - sh.r) > sh.w / 2) return false;
  let a = Math.atan2(dy, dx) * 180 / Math.PI; a = (a + 360) % 360; if (a < sh.a0) a += 360; return a <= sh.a1; };
const boxHit = (b, x0, y0, x1, y1) => Math.min(b.x1, x1) - Math.max(b.x0, x0) > .5 && Math.min(b.iy1, y1) - Math.max(b.iy0, y0) > .5;
const inside = (b, x0, y0, x1, y1) => b.x0 >= x0 - .5 && b.x1 <= x1 + .5 && b.iy0 >= y0 - .5 && b.iy1 <= y1 + .5;
const segDist = (px, py, s) => { const vx = s.x1 - s.x0, vy = s.y1 - s.y0, l = vx * vx + vy * vy, t = l ? Math.max(0, Math.min(1, ((px - s.x0) * vx + (py - s.y0) * vy) / l)) : 0; return Math.hypot(px - s.x0 - t * vx, py - s.y0 - t * vy); };
function points(b, f) { for (let y = b.iy0; y <= b.iy1 + .01; y += Math.max(1, (b.iy1 - b.iy0) / 8)) for (let x = b.x0; x <= b.x1 + .01; x += Math.max(1, (b.x1 - b.x0) / 24)) if (f(x, y)) return true; return false; }
const short = t => JSON.stringify(t.length > 28 ? t.slice(0, 27) + '…' : t);

/** the findings of one drawn screen: [{ kind, msg }] */
export function check(dc) {
  const S = dc.S, c = S / 2, R = S / 2 - MARGIN * S, out = [], T = dc.texts.filter(t => t.x1 > t.x0 && t.iy1 > t.iy0);
  const add = (kind, msg) => out.push({ kind, msg });
  for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
    const a = T[i], b = T[j], ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.iy1, b.iy1) - Math.max(a.iy0, b.iy0);
    if (ox > .5 && oy > -GAP) add('overlap', `${short(a.t)} (${a.font}) and ${short(b.t)} (${b.font}) ${oy > 0 ? 'overlap by ' + oy.toFixed(1) + ' px' : 'touch'}`);
  }
  for (const t of T) {
    const far = Math.max(...[[t.x0, t.iy0], [t.x1, t.iy0], [t.x0, t.iy1], [t.x1, t.iy1]].map(([x, y]) => Math.hypot(x - c, y - c)));
    if (far > R + .5) add('offscreen', `${short(t.t)} (${t.font}) reaches ${(far - R).toFixed(1)} px past the 0.03 S margin`);
    if (t.cut) add('cut', `${short(t.t)} (${t.font}) is cut`);
    if (t.noglyph) add('glyph', `${short(t.t)}: letters in ${t.font} (digits only on this watch)`);
    if (t.px < MIN_PX) add('small', `${short(t.t)} (${t.font}) only ${t.px.toFixed(1)} px`);
    for (const s of dc.shapes) {
      if (s.col === t.col && (s.k === 'pill' || s.k === 'disc')) continue; // same colour: never the text's background (the text would not show), only a mark
      let hit = false, what = s.k;
      if (s.k === 'ring') { hit = points(t, (x, y) => inBand(s, x, y)); what = s.r > S * .4 ? 'the bezel arc' : 'a ring'; }
      else if (s.k === 'pill' || s.k === 'frame') hit = boxHit(t, s.x0, s.y0, s.x1, s.y1) && !inside(t, s.x0, s.y0, s.x1, s.y1);
      else if (s.k === 'disc') { const nx = Math.max(t.x0, Math.min(s.x, t.x1)), ny = Math.max(t.iy0, Math.min(s.y, t.iy1)); hit = Math.hypot(nx - s.x, ny - s.y) < s.r - .5 && points(t, (x, y) => Math.hypot(x - s.x, y - s.y) > s.r); what = s.r > S * .3 ? 'the flash' : 'a dot / icon'; }
      else if (s.k === 'rect' || s.k === 'poly') hit = boxHit(t, s.x0, s.y0, s.x1, s.y1);
      else if (s.k === 'line') hit = points(t, (x, y) => segDist(x, y, s) < s.w / 2 + .5);
      if (hit) add('shape', `${short(t.t)} (${t.font}) under ${what}`);
    }
  }
  return out;
}
/** every scene on every watch and font scale: [{ scene, dev, k, kind, msg }] */
export function checkAll(ids = null) {
  const res = [];
  for (const sc of SCENES) { if (ids && !ids.includes(sc[0])) continue;
    for (const [dev, k] of RUNS) for (const f of check(render(sc, dev, k))) res.push({ scene: sc[0], dev, k, ...f }); }
  return res;
}

if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv.slice(2), res = checkAll(ids.length ? ids : null), by = new Map();
  for (const r of res) { const k = r.scene; if (!by.has(k)) by.set(k, new Map()); const m = by.get(k), key = `${r.kind}: ${r.msg}`; if (!m.has(key)) m.set(key, []); m.get(key).push(`${r.dev}${r.k !== 1 ? '@' + r.k : ''}`); }
  for (const [s, m] of by) { console.log(`\n${s}`); for (const [msg, devs] of m) console.log(`  ${msg}  [${devs.join(' ')}]`); }
  console.log(`\n${res.length} findings in ${by.size} of ${SCENES.length} screens (${RUNS.length} watch / font scale combinations)`);
  process.exit(res.length ? 1 : 0);
}
