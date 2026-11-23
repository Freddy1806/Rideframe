// 23.11.8: Monkey C's Graphics.Dc for the browser preview and the layout check (tools/watch-layout.mjs). garmin/source/Draw.mc draws
// with the device's system fonts (FONT_XTINY ... FONT_NUMBER_THAI_HOT), whose real sizes differ per watch and with the fenix 8's font size
// setting (0.8 to 1.45). This Dc measures with the real numbers of each device (js/watchfontdata.js: box height, ascent, descent from the
// simulator, widths from the glyph advances), so js/watchscreens.js (Draw.mc line by line) takes the same fallback fonts, cuts the same
// texts and puts every text at the same pixel as the watch. On a canvas the text is drawn with a free look-alike font, stretched to the
// device width and set on the device baseline; the layout check (no canvas) gets every text box and shape instead.
import { DEV, MET } from './watchfontdata.js';

/** Toybox.Graphics constants the drawing uses (the same numbers as the SDK) */
export const G = {
  FONT_XTINY: 'XTINY', FONT_TINY: 'TINY', FONT_SMALL: 'SMALL', FONT_MEDIUM: 'MEDIUM', FONT_LARGE: 'LARGE',
  FONT_NUMBER_MILD: 'NUMBER_MILD', FONT_NUMBER_MEDIUM: 'NUMBER_MEDIUM', FONT_NUMBER_HOT: 'NUMBER_HOT', FONT_NUMBER_THAI_HOT: 'NUMBER_THAI_HOT',
  TEXT_JUSTIFY_RIGHT: 0, TEXT_JUSTIFY_CENTER: 1, TEXT_JUSTIFY_LEFT: 2, TEXT_JUSTIFY_VCENTER: 4,
  ARC_COUNTER_CLOCKWISE: 0, ARC_CLOCKWISE: 1, COLOR_TRANSPARENT: -1, COLOR_BLACK: 0x000000, COLOR_WHITE: 0xFFFFFF,
};
export const FONT_IDS = ['XTINY', 'TINY', 'SMALL', 'MEDIUM', 'LARGE', 'NUMBER_MILD', 'NUMBER_MEDIUM', 'NUMBER_HOT', 'NUMBER_THAI_HOT'];
export const DEVICES = Object.keys(DEV);
const IDX = {}; for (const k in MET) { IDX[k] = {}; [...MET[k].chars].forEach((c, i) => { IDX[k][c] = i; }); }
/** the look-alike web fonts of the preview per family (the layout tool loads the real ones under the first name) */
export const FAMILY = {
  rcb: ['700', '"RFW RCB", "Roboto Condensed", Archivo, system-ui, sans-serif'],
  bionic: ['600', '"RFW Bionic", Archivo, system-ui, sans-serif'],
  roboto: ['400', '"RFW Roboto", Roboto, Archivo, system-ui, sans-serif'],
};
/** font id on device dev at the font scale k: { fam, px, h (box), asc, desc } */
export function fontOf(dev, id, k = 1) {
  const d = DEV[dev], f = d.fonts[id] || d.fonts.XTINY, s = d.scale ? k : 1;
  return { id, fam: f[0], px: f[1] * s, h: Math.round(f[2] * s), asc: Math.round(f[3] * s), desc: Math.round(f[2] * s) - Math.round(f[3] * s) };
}
const glyph = (fam, c) => { const i = IDX[fam][c] ?? IDX[fam]['n']; return [MET[fam].adv[i], MET[fam].ink[i]]; };
/** dc.getTextWidthInPixels: the advances rounded per glyph (matches the simulator within a few px) */
export const textW = (f, t) => { let w = 0; for (const c of String(t)) w += Math.round(glyph(f.fam, c)[0] * f.px / 1000); return w; };
/** the ink of t above / below the baseline in px (0 / 0 for blanks) */
export const inkOf = (f, t) => { let a = 0, b = 0; for (const c of String(t)) { if (c === ' ') continue; const k = glyph(f.fam, c)[1]; a = Math.max(a, k[0]); b = Math.max(b, k[1]); } return [a * f.px / 1000, b * f.px / 1000]; };
const hex = c => '#' + (c >>> 0 & 0xFFFFFF).toString(16).padStart(6, '0');

/** one screen's Dc: o = { dev, scale (fenix 8: 0.8 .. 1.45), g (a 2d canvas context, or null for the layout check) } */
export class Dc {
  constructor(o) {
    this.dev = o.dev; this.k = o.scale || 1; this.g = o.g || null; this.S = DEV[o.dev].S; this.bitmap = DEV[o.dev].bitmap;
    this.fg = 0xFFFFFF; this.pen = 1; this.texts = []; this.shapes = []; this.cut = new Set(); this.user = new Set(); this.vert = null;
  }
  getWidth() { return this.S; }
  getHeight() { return this.S; }
  font(id) { return fontOf(this.dev, id, this.k); }
  getTextWidthInPixels(t, id) { return textW(this.font(id), t); }
  getFontHeight(id) { return this.font(id).h; }
  getFontAscent(id) { return this.font(id).asc; }
  getFontDescent(id) { return this.font(id).desc; }
  setColor(fg) { this.fg = fg; }
  setPenWidth(w) { this.pen = Math.max(1, Math.trunc(w)); }
  clear() { if (this.g) { this.g.fillStyle = '#000'; this.g.fillRect(0, 0, this.S, this.S); } }
  /** dc.drawText: x by the horizontal justify, y = the box top, or (VCENTER) the box centre */
  drawText(x, y, id, t, just) {
    t = String(t); const f = this.font(id), w = textW(f, t), h = just & 1 ? 'c' : just & 2 ? 'l' : 'r';
    const x0 = h === 'c' ? x - w / 2 : h === 'l' ? x : x - w, top = just & 4 ? y - f.h / 2 : y, base = top + f.asc, [ia, ib] = inkOf(f, t);
    this.texts.push({ t, font: id, px: f.px, x0, x1: x0 + w, top, bot: top + f.h, base, iy0: base - ia, iy1: base + ib, cut: this.cut.has(t), user: this.user.has(t), col: this.fg,
      noglyph: this.bitmap && id.startsWith('NUMBER') && /[^0-9:.\- ]/.test(t) });
    const g = this.g; if (!g || !w) return;
    const [wt, fam] = FAMILY[f.fam]; g.font = `${wt} ${f.px}px ${fam}`; if ('fontStretch' in g) g.fontStretch = f.fam === 'rcb' ? 'condensed' : 'normal';
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = hex(this.fg);
    const mw = g.measureText(t).width || w; g.save(); g.translate(x0, base); g.scale(w / mw, 1); g.fillText(t, 0, 0); g.restore();
  }
  fillCircle(x, y, r) { this.shapes.push({ k: 'disc', x, y, r, col: this.fg }); const g = this.g; if (g) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = hex(this.fg); g.fill(); } }
  drawCircle(x, y, r) { this.shapes.push({ k: 'ring', x, y, r, w: this.pen, a0: 0, a1: 360, col: this.fg }); const g = this.g; if (g) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.strokeStyle = hex(this.fg); g.lineWidth = this.pen; g.stroke(); } }
  /** dc.drawArc: degrees counter-clockwise from 3 o'clock; ARC_CLOCKWISE from a0 down to a1 */
  drawArc(x, y, r, dir, a0, a1) {
    const cw = dir === G.ARC_CLOCKWISE, lo = cw ? a1 : a0, hi = cw ? a0 : a1; // the band covers lo .. hi counter-clockwise
    this.shapes.push({ k: 'ring', x, y, r, w: this.pen, a0: ((lo % 360) + 360) % 360, a1: ((lo % 360) + 360) % 360 + ((((hi - lo) % 360) + 360) % 360 || 360), col: this.fg });
    const g = this.g; if (!g) return; g.beginPath(); g.arc(x, y, r, -a0 * Math.PI / 180, -a1 * Math.PI / 180, !cw); g.strokeStyle = hex(this.fg); g.lineWidth = this.pen; g.lineCap = 'butt'; g.stroke();
  }
  drawLine(x0, y0, x1, y1) { this.shapes.push({ k: 'line', x0, y0, x1, y1, w: this.pen, col: this.fg }); const g = this.g; if (g) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = hex(this.fg); g.lineWidth = this.pen; g.lineCap = 'round'; g.stroke(); } }
  fillRectangle(x, y, w, h) { this.shapes.push({ k: 'rect', x0: x, y0: y, x1: x + w, y1: y + h, col: this.fg }); const g = this.g; if (g) { g.fillStyle = hex(this.fg); g.fillRect(x, y, w, h); } }
  fillRoundedRectangle(x, y, w, h, r) { this.shapes.push({ k: 'pill', x0: x, y0: y, x1: x + w, y1: y + h, col: this.fg }); const g = this.g; if (g) { g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = hex(this.fg); g.fill(); } }
  drawRoundedRectangle(x, y, w, h, r) { this.shapes.push({ k: 'frame', x0: x, y0: y, x1: x + w, y1: y + h, col: this.fg }); const g = this.g; if (g) { g.beginPath(); g.roundRect(x, y, w, h, r); g.strokeStyle = hex(this.fg); g.lineWidth = this.pen; g.stroke(); } }
  fillPolygon(p) { const xs = p.map(q => q[0]), ys = p.map(q => q[1]); this.shapes.push({ k: 'poly', x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), col: this.fg });
    const g = this.g; if (g) { g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (const q of p.slice(1)) g.lineTo(q[0], q[1]); g.closePath(); g.fillStyle = hex(this.fg); g.fill(); } }
}
