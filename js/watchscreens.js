// 23.11.8: garmin/source/Draw.mc in JavaScript, line by line (same function names, same numbers, same Garmin font ids, same fallback
// lists), on js/watchflow.js's state. The preview (js/watchsim.js) draws every screen with it on a js/watchdc.js Dc that measures like the
// device, and tools/watch-layout.mjs checks every screen on all five watches with it. A change of the layout is made here AND in Draw.mc;
// tools/watch-layout-test.mjs compares the numbers of both files function by function.
import { G } from './watchdc.js';
import { SCR, HOME, curEx, setNo, restLeft, clock, homeItems, homeTop, listItems, workouts, planItem, pickRows, doneOf, prefillOf, lastSet, lastTxt, recPages, routeInfo,
  holdPart, pausedTime, stepOf, HOME_FIT, VERSION, loading, rides, hrOn, tPages, tsPages } from './watchflow.js';
import { FIELDS, fieldText, labelOf } from './watchfields.js';
import { shown, live as tLive, hasCad, nextTarget, wkLeft, wkTotLeft, wkShown, wkNextW, wkAdj, wkDur, wkRamp, wkPlat, REC_NONE } from './watchtrainer.js';
import { groupOf } from './sports.js';

const VC = G.TEXT_JUSTIFY_CENTER | G.TEXT_JUSTIFY_VCENTER, VL = G.TEXT_JUSTIFY_LEFT | G.TEXT_JUSTIFY_VCENTER;
const { FONT_XTINY: XT, FONT_TINY: TI, FONT_SMALL: SM, FONT_MEDIUM: ME, FONT_LARGE: LA, FONT_NUMBER_MILD: NMI, FONT_NUMBER_MEDIUM: NME, FONT_NUMBER_HOT: NHO, FONT_NUMBER_THAI_HOT: NTH } = G;
const T = v => Math.trunc(v); // Monkey C toNumber()
// Flow.mc HOME_Y0 / HOME_DY (js HOME_LAY)
const HOME_Y0 = .27, HOME_DY = .155;
const GROUP = { walk: 'Walk & hike', skate: 'Skating', ski: 'Snow sports', water: 'Water sports', fit: 'Workout & yoga', ball: 'Ball & racket' };
const GPS_OUT = ['Walk', 'Hike', 'Wheelchair', 'InlineSkate', 'Skateboard', 'NordicSki', 'AlpineSki', 'BackcountrySki', 'Snowboard', 'Snowshoe', 'RollerSki',
  'Rowing', 'Kayaking', 'Canoeing', 'StandUpPaddling', 'Surfing', 'Kitesurf', 'Windsurf', 'Sail', 'Soccer', 'Golf'];

/** Draw.mc Palette: AMOLED (fr265: the RIDEFRAME tones) or MIP (fenix: the 64-colour palette) */
export function palette(amoled) {
  const P = amoled ? { fg: 0xF4F4EF, dim: 0x8B8B85, faint: 0x2C2C2A, ink: 0x0B0B0B, hr: 0xFF5A5A, lbl: 0xA3A39C, line: 0x3A3A37, good: 0x3DDC84, bad: 0xFF5A5A, path: 0x6A6A66, o: 0xFF5A1F }
    : { fg: 0xFFFFFF, dim: 0xAAAAAA, faint: 0x555555, ink: 0x000000, hr: 0xFF5555, lbl: 0xFFFFFF, line: 0x555555, good: 0x55FF55, bad: 0xFF5555, path: 0xAAAAAA, o: 0xFF5500 };
  P.far = amoled ? P.faint : P.dim; P.cRun = P.cRide = P.cKraft = P.cOther = P.o; P.acc = P.o; P.mip = !amoled;
  // 28.11.: the workout builder's step colours (js/myworkouts.js STEP_TYPES: warm-up #f2b630, recover #2fb36b, cool-down #2f8fe0; work = the
  // accent); MIP: the nearest of the 64 colours (channels 00 / 55 / AA / FF)
  P.wWarm = amoled ? 0xF2B630 : 0xFFAA00; P.wRec = amoled ? 0x2FB36B : 0x00AA55; P.wCool = amoled ? 0x2F8FE0 : 0x00AAFF;
  return P;
}

// ---- the helpers (Draw.mc) ----
export function kgTxt(kg) { const r = T(kg * 10 + .5); return r % 10 === 0 ? String(T(r / 10)) : T(r / 10) + '.' + (r % 10); }
function volTxt(v) { return v >= 10000 ? kgTxt(v / 1000) + ' t' : String(T(v)); }
const kmTxt = m => (m / 1000).toFixed(m >= 10000 ? 1 : 2);
const pace = (sec, m) => fieldText('avgPace', { t: sec, d: m }, 0);
/** text cut to fit max px (with a dot); u = user content (a name), which may be cut; the layout check flags any other cut */
export function fit(dc, t, font, max, u = false) {
  t = String(t); if (dc.getTextWidthInPixels(t, font) <= max) return t;
  let s = t; while (s.length > 1 && dc.getTextWidthInPixels(s + '.', font) > max) s = s.slice(0, -1);
  while (s.length > 1 && (s[s.length - 1] === ' ' || s[s.length - 1] === ',')) s = s.slice(0, -1);
  (u ? dc.user : dc.cut).add(s + '.'); return s + '.';
}
/** the first font of the list that fits (big numbers shrink instead of being cut) */
export function fontFor(dc, t, fonts, max) { for (const f of fonts) if (dc.getTextWidthInPixels(t, f) <= max) return f; return fonts[fonts.length - 1]; }
const txt = (dc, x, y, font, t, col) => { dc.setColor(col); dc.drawText(x, y, font, String(t), VC); };
const txtL = (dc, x, y, font, t, col) => { dc.setColor(col); dc.drawText(x, y, font, String(t), VL); };
const pill = (dc, cx, cy, w, h, col) => { dc.setColor(col); dc.fillRoundedRectangle(cx - w / 2, cy - h / 2, w, h, h / 2); };
const pw = n => { const p = T(n); return p < 1 ? 1 : p; };
function startHint(dc, S, P) { dc.setColor(P.acc); dc.setPenWidth(pw(S * .03)); dc.drawArc(S / 2, S / 2, S / 2 - T(S * .02), G.ARC_CLOCKWISE, 42, 18); dc.setPenWidth(1); }
function tri(dc, x, y, s, up, col) { dc.setColor(col); const a = up ? y + s * .6 : y - s * .6, b = up ? y - s * .6 : y + s * .6; dc.fillPolygon([[x - s, a], [x + s, a], [x, b]]); }
function dumbbell(dc, x, y, s, col) {
  dc.setColor(col); dc.setPenWidth(pw(s * .13 + 1)); const k = s / 24;
  for (const l of [[3, 9, 3, 15], [6, 7, 6, 17], [18, 7, 18, 17], [21, 9, 21, 15], [6, 12, 18, 12]]) dc.drawLine(x + (l[0] - 12) * k, y + (l[1] - 12) * k, x + (l[2] - 12) * k, y + (l[3] - 12) * k);
  dc.setPenWidth(1);
}
function heart(dc, x, y, s, col) { dc.setColor(col); const r = s * .32; dc.fillCircle(x - r, y - r * .4, r); dc.fillCircle(x + r, y - r * .4, r); dc.fillPolygon([[x - 2 * r, y - r * .2], [x + 2 * r, y - r * .2], [x, y + s * .55]]); }
function icon(dc, k, x, y, s, col) {
  if (k === 'kraft') { dumbbell(dc, x, y, s, col); return; }
  dc.setColor(col); dc.setPenWidth(pw(s * .11 + 1));
  if (k === 'run') {
    dc.fillCircle(x + s * .12, y - s * .36, s * .1);
    dc.drawLine(x + s * .04, y - s * .2, x - s * .08, y + s * .1); dc.drawLine(x - s * .08, y + s * .1, x + s * .14, y + s * .42); dc.drawLine(x - s * .08, y + s * .1, x - s * .3, y + s * .38);
    dc.drawLine(x - s * .26, y - s * .08, x + s * .02, y - s * .16); dc.drawLine(x + s * .02, y - s * .16, x + s * .3, y - s * .02);
  } else if (k === 'ride') {
    const r = s * .2; dc.drawCircle(x - s * .27, y + s * .16, r); dc.drawCircle(x + s * .27, y + s * .16, r);
    dc.drawLine(x - s * .27, y + s * .16, x - s * .05, y - s * .16); dc.drawLine(x - s * .05, y - s * .16, x + s * .27, y + s * .16); dc.drawLine(x - s * .05, y - s * .16, x - s * .14, y - s * .3);
  } else if (k === 'trainer') {
    const q = s / 24; dc.drawCircle(x, y - q * 2, q * 7); dc.drawLine(x, y - q * 6, x, y - q * 2); dc.drawLine(x, y - q * 2, x + q * 3, y); dc.drawLine(x - q * 8, y + q * 8, x + q * 8, y + q * 8);
  } else { const r = s * .09; dc.fillCircle(x - s * .3, y, r); dc.fillCircle(x, y, r); dc.fillCircle(x + s * .3, y, r); }
  dc.setPenWidth(1);
}
export function isNum(t) { return t.length > 0 && [...t].every(c => '0123456789:.-'.includes(c)); }
function valFonts(px, num) {
  if (num) {
    if (px >= .28) return [NTH, NHO, NME, NMI];
    if (px >= .18) return [NHO, NME, NMI];
    if (px >= .15) return [NME, NMI, ME];
    return [NMI, ME, SM];
  }
  if (px >= .18) return [LA, ME, SM];
  return [ME, SM, TI];
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const exT = e => e && typeof e.t === 'string' ? e.t : 'w';
const sportName = F => F.sp === 'other' ? labelOf(F.type) : HOME[F.sp];

const ARC_CW = G.ARC_CLOCKWISE, ARC_COUNTER_CW = G.ARC_COUNTER_CLOCKWISE;

// ---- 23.11.8: the layout from the watch's own fonts. Every text gets its rows from the font's real box (dc.getFontHeight, the ascent):
// up = the ink above the y of a VCENTER text (caps), dn = below it (descenders, else the baseline); lines are stacked from those, a font
// falls back to the next smaller one when it does not fit its room (width, rows, the round screen), and a line that has no room left is
// left out (in the order given per screen), so the fenix 8's font size setting (up to 1.45) never makes texts overlap. ----
const R0 = .47;     // texts stay inside this circle (fraction of S: 0.5 - the 0.03 S margin)
export function gap(S) { return S * .008 > 2 ? S * .008 : 2; }
export function hasDesc(t) { for (let i = 0; i < t.length; i++) { if ('gjpqy,;()Q'.indexOf(t[i]) >= 0) return true; } return false; }
const asc = (dc, f) => dc.getFontAscent(f); // Monkey C: Graphics.getFontAscent(f)
export function up(dc, f) { return dc.getFontHeight(f) / 2 - .16 * asc(dc, f); }
export function dn(dc, f, t) { const h = dc.getFontHeight(f), a = asc(dc, f); return hasDesc(t) ? a - h / 2 + 1.1 * (h - a) : a - h / 2 + 1; }
/** the ink height of a line with descenders */
export function inkH(dc, f) { return up(dc, f) + dn(dc, f, 'g'); }
/** the first font whose ink is at most h px (else the last) */
export function byInk(dc, fonts, h) { for (let i = 0; i < fonts.length; i++) { if (inkH(dc, fonts[i]) <= h) return fonts[i]; } return fonts[fonts.length - 1]; }
/** the first font in which t is at most w wide and whose ink is at most h (else the last) */
export function fontIn(dc, t, fonts, w, h) { for (let i = 0; i < fonts.length; i++) { if (dc.getTextWidthInPixels(t, fonts[i]) <= w && up(dc, fonts[i]) + dn(dc, fonts[i], t) <= h) return fonts[i]; } return fonts[fonts.length - 1]; }
/** the first font whose t sits inside a pill of height ph centred on its y (else the last) */
export function inPill(dc, t, fonts, w, ph) { for (let i = 0; i < fonts.length; i++) { if (dc.getTextWidthInPixels(t, fonts[i]) <= w && up(dc, fonts[i]) <= ph / 2 - 1 && dn(dc, fonts[i], t) <= ph / 2 - 1) return fonts[i]; } return fonts[fonts.length - 1]; }
/** half the width inside the circle of radius r (fraction of S) on the rows y0 .. y1 */
export function half(S, y0, y1, r) { const c = S / 2, R = S * r, a = y0 - c < 0 ? c - y0 : y0 - c, b = y1 - c < 0 ? c - y1 : y1 - c, d = a > b ? a : b; return d >= R ? 0 : Math.sqrt(R * R - d * d); }
/** the width a text centred on x in font f may take inside that circle */
export function roomC(dc, x, y, f, t, r) { const S = dc.getWidth(), h = half(S, y - up(dc, f), y + dn(dc, f, t), r) - (x > S / 2 ? x - S / 2 : S / 2 - x); return h > 0 ? T(2 * h) : 0; }
/** the first of the variants "long|shorter|short" of t at most w wide in font f (else the last); a name (u) is never split */
export function pick(dc, t, f, w, u) {
  t = String(t); if (u) return t;
  let i = t.indexOf('|');
  while (i >= 0) { const a = t.slice(0, i); if (dc.getTextWidthInPixels(a, f) <= w) return a; t = t.slice(i + 1); i = t.indexOf('|'); }
  return t;
}
/** t centred on (x, y) in font f, the variant that fits w and the circle r, cut to it (u: a name the user gave, may be cut) */
function put(dc, x, y, f, t, w, col, u, r) { const m = roomC(dc, x, y, f, String(t).split('|')[0], r), mm = w < m ? w : m; txt(dc, x, y, f, fit(dc, pick(dc, t, f, mm, u), f, mm, u), col); }
/** t from x on, the variant that fits w and the circle r, cut to it */
function putL(dc, x, y, f, t, w, col, u, r) { const S = dc.getWidth(), m = T(S / 2 + half(S, y - up(dc, f), y + dn(dc, f, String(t)), r) - x), mm = w < m ? w : m; txtL(dc, x, y, f, fit(dc, pick(dc, t, f, mm, u), f, mm, u), col); }
/** the y (at least y0) from which a line t in font f, centred, fits inside the circle r on its upper half */
export function downTo(dc, f, t, y0, r) {
  const S = dc.getWidth(), R = S * r, hw = dc.getTextWidthInPixels(t, f) / 2; if (hw >= R) return S / 2;
  const y = S / 2 - Math.sqrt(R * R - hw * hw) + up(dc, f); return y > y0 ? y : y0;
}
/** the first font in which t, as the line below ink bottom yb (and not above y0), is at most w wide inside the circle and its ink at most h */
export function topFont(dc, t, fonts, w, h, yb, y0) {
  for (let i = 0; i < fonts.length; i++) { const f = fonts[i], y = below(dc, yb, f, y0), m = roomC(dc, dc.getWidth() / 2, y, f, t, R0);
    if (dc.getTextWidthInPixels(t, f) <= (w < m ? w : m) && up(dc, f) + dn(dc, f, t) <= h) return f; }
  return fonts[fonts.length - 1];
}
/** a pill's height: h, or more where XTINY with descenders would not fit (font size setting) */
export function pillH(dc, h) { const k = inkH(dc, XT) + 4; return k > h ? k : h; }
/** a, or b when a is wider than w in font f */
function alt(dc, a, b, f, w) { return dc.getTextWidthInPixels(a, f) <= w ? a : b; }
/** the y of a line in font f below ink bottom yb (and not above y0) */
function below(dc, yb, f, y0) { const y = yb + gap(dc.getWidth()) + up(dc, f); return y > y0 ? y : y0; }
/** the y of a line t in font f above ink top yt (and not below y0) */
function above(dc, yt, f, t, y0) { const y = yt - gap(dc.getWidth()) - dn(dc, f, t); return y < y0 ? y : y0; }
/** the rows of the list drawn last, [offset, y / S], the route line of the ready screen (y / S, 0 = none) and the trainer's target
 *  zone (t0 .. t1, y / S): FlowDelegate.onTap / dragModeAt (gRows, gRouteY, gT0, gT1) and js/watchsim.js tapAt take them as drawn */
export const LAY = { rows: [], route: 0, t0: 0, t1: 0 };

/** one screen: Draw.mc screen(dc, F, P, now, sum); ui = { touch (the menu's diagnostics line), wheel { c, scr, until }, hasTouch } */
export function screen(dc, F, P, now, sum, ui = {}) {
  const S = dc.getWidth(), s = F.scr; dc.clear();
  P.acc = P.cKraft; ui.now = now; LAY.rows = []; LAY.route = 0; LAY.t0 = 0; LAY.t1 = 0;
  const f = F.flash;
  if (f) { if (f.k === 'lap') lapFlash(dc, F, S, P, f); else prFlash(dc, S, P, f); return; }
  if (s === SCR.HOME) drawHome(dc, F, S, P, sum);
  else if (s === SCR.PICK) drawPick(dc, F, S, P);
  else if (s === SCR.SMODE) drawSmode(dc, F, S, P);
  else if (s === SCR.MORE) drawMore(dc, F, S, P);
  else if (s === SCR.MENU) list(dc, F, S, P, F.menu, 'MENU v' + VERSION, 'v' + VERSION, true, null, null, ui.touch != null ? [[ui.touch, P.lbl, true]] : []);
  else if (s === SCR.END) drawEnd(dc, F, S, P, now);
  else if (s === SCR.SAVEQ) drawSaveq(dc, F, S, P);
  else if (s === SCR.SET) drawSet(dc, F, S, P, now, ui);
  else if (s === SCR.REST) drawRest(dc, F, S, P, now);
  else if (s === SCR.SUM) drawSum(dc, F, S, P);
  else if (s === SCR.PAIR) drawPair(dc, F, S, P);
  else if (s === SCR.READY) drawReady(dc, F, S, P);
  else if (s === SCR.REC) drawRec(dc, F, S, P, now);
  else if (s === SCR.PAUSE) drawPause(dc, F, S, P, now, ui);
  else if (s === SCR.RSUM) drawRsum(dc, F, S, P);
  else if (s === SCR.RPICK) drawRpick(dc, F, S, P);
  else if (s === SCR.TSCAN) drawTScan(dc, F, S, P);
  else if (s === SCR.TREC) drawTRec(dc, F, S, P, now, ui);
  else if (s === SCR.TEND) drawTEnd(dc, F, S, P);
  else if (s === SCR.TSUM) drawTSum(dc, F, S, P);
  else if (s === SCR.TPICK) drawTPick(dc, F, S, P);
  else if (s === SCR.THR) drawTHr(dc, F, S, P, now);
  else if (s === SCR.GLANCE) drawGlance(dc, S, P, sum);
  else drawHome(dc, F, S, P, sum);
}
function logo(dc, S, y, col, P) {
  const c = S / 2, wR = dc.getTextWidthInPixels('RIDE', XT), wF = dc.getTextWidthInPixels('FRAME', XT), x0 = c - (wR + wF) / 2;
  y = downTo(dc, XT, 'RIDEFRAME', y, R0); txtL(dc, x0, y, XT, 'RIDE', P.fg); txtL(dc, x0 + wR, y, XT, 'FRAME', col);
}
/** the start menu's label: "Indoor trainer" is "Trainer" where it does not fit */
function homeLab(dc, k, f, w) { return k === 'trainer' ? alt(dc, HOME[k], 'Trainer', f, w) : HOME[k]; }
// the start menu: Run, Ride, Indoor trainer, Strength, More (the last used on top), the selected one as the orange pill (MEDIUM, else
// the next font that fits the pill), the week points below; rows at HOME_Y0 + r * HOME_DY (the tap table in FlowDelegate.onTap)
function drawHome(dc, F, S, P, sum) {
  const items = homeItems(F), n = items.length, c = S / 2, top = homeTop(F.sel, n), G = gap(S), ph = S * .14, w = T(S * .52);
  logo(dc, S, S * .12, P.cKraft, P);
  let yb = downTo(dc, XT, 'RIDEFRAME', S * .12, R0) + dn(dc, XT, 'R');
  for (let r = 0; r < HOME_FIT; r++) {
    const i = top + r; if (i >= n) break;
    const k = items[i], y = S * (HOME_Y0 + r * HOME_DY);
    if (i === F.sel) {
      pill(dc, c, y, S * .74, ph, P.acc); icon(dc, k, S * .25, y, S * .085, P.ink);
      const f = inPill(dc, 'Ag', [ME, SM, XT], S, ph), lab = homeLab(dc, k, f, w);
      putL(dc, S * .33, y, f, lab, w, P.ink, false, R0); yb = y + ph / 2;
    } else {
      icon(dc, k, S * .25, y, S * .075, P.acc);
      const f = byInk(dc, [SM, XT], S * HOME_DY - 2 * G - S * .01), lab = homeLab(dc, k, f, w);
      putL(dc, S * .33, y, f, lab, w, P.fg, false, R0); yb = y + dn(dc, f, lab);
    }
    LAY.rows.push([r, y / S]);
  }
  if (sum && sum.pts != null) points(dc, S, P, sum, yb);
  if (n > HOME_FIT) scrollArc(dc, S, P, F.sel, n);
  startHint(dc, S, P);
}
// "245 pts" and the change against last week below yb (SMALL, else XTINY; the change goes first when there is no room)
function points(g, S, P, sum, yb) {
  const t = Math.round(sum.pts) + ' pts', d = Math.round(sum.delta || 0), ad = d < 0 ? -d : d, fonts = [SM, XT];
  for (let i = 0; i < 2; i++) {
    const f = fonts[i], y = below(g, yb, f, S * .86), tw = g.getTextWidthInPixels(t, f), dw = d !== 0 ? S * .06 + g.getTextWidthInPixels(String(ad), XT) : 0;
    const m = roomC(g, S / 2, y, f, t, R0);
    if (y + dn(g, f, t) > S * (.5 + R0) || (i === 0 && tw + dw > m)) continue;
    const show = tw + dw <= m, x = S / 2 - (tw + (show ? dw : 0)) / 2;
    txtL(g, x, y, f, fit(g, t, f, m, false), P.fg);
    if (show && d !== 0) { tri(g, x + tw + S * .025, y, S * .018, d > 0, P.good); txtL(g, x + tw + S * .05, y, XT, String(ad), P.good); }
    return;
  }
}
// the scroll position on the left edge (150..210 degrees)
function scrollArc(dc, S, P, sel, n) {
  if (n < 2) return; const c = S / 2;
  dc.setPenWidth(pw(S * .012 + 1)); dc.setColor(P.faint); dc.drawArc(c, c, c - S * .03, ARC_COUNTER_CW, 150, 210);
  const p = sel / (n - 1), a = 150 + T(p * 51); dc.setColor(P.acc); dc.drawArc(c, c, c - S * .03, ARC_COUNTER_CW, a, a + 9); dc.setPenWidth(1);
}
/** setShort without spaces and units ("102.5x10", "+10x8", "12", "1:30") */
export function setMini(t, kg, r) {
  if (t === 'time') return clock(r);
  if (t === 'bw') return kg > 0 ? '+' + kgTxt(kg) + 'x' + r : String(r);
  return kgTxt(kg) + 'x' + r;
}
export function setShort(t, kg, r) {
  if (t === 'time') return clock(r);
  if (t === 'bw') return kg > 0 ? '+' + kgTxt(kg) + ' x ' + r : r + ' reps';
  return kgTxt(kg) + ' kg x ' + r;
}
// the exercise list's sub line of row k: a workout item's progress, else this session's sets, else all of last time's (as many whole sets as fit)
function pickSub(dc, F, S, k) {
  const rows = pickRows(F); if (k < 0 || k >= rows.length) return '';
  const e = F.setup.ex[rows[k][0]], j = rows[k][1]; if (!e) return '';
  const t = exT(e), mine = F.sets.filter(x => x.ex === e.id), n = mine.length;
  if (j >= 0) {
    const it = workouts(F)[F.plan.w].it[j], d = doneOf(F, j); if (!it) return '';
    if (d >= it[1]) return 'Done, ' + plural(d, 'set', 'sets') + '|Done';
    if (F.plan.skip.includes(j)) return 'Skipped';
    return d + '/' + it[1] + ' sets, ' + (t === 'time' ? clock(it[2]) : it[2] + ' reps') + '|' + d + '/' + it[1] + ' sets';
  }
  if (n > 0) return n + ' done, ' + setShort(t, mine[n - 1].kg, mine[n - 1].reps) + '|' + n + ' done, ' + setMini(t, mine[n - 1].kg, mine[n - 1].reps) + '|' + n + ' done';
  const s = Array.isArray(e.s) ? e.s : []; if (!s.length) return 'New';
  // last time: all sets (at most 4), then fewer: the list takes the first variant that fits
  let lt = ''; for (let k2 = s.length < 4 ? s.length : 4; k2 >= 1; k2--) lt = lt + lastTxtMc(t, s, k2) + '|';
  return lt + setMini(t, +s[0][0], +s[0][1]);
}
/** Draw.mc lastTxt (", " and "x" for js's " · " and "×": the system fonts) */
export function lastTxtMc(t, s, k) {
  let n = Math.min(k, s.length), r = 'Last ', pk = -1, bwOnly = true; if (n < 1) n = 1;
  for (let i = 0; i < n; i++) {
    const p = s[i]; if (!Array.isArray(p) || p.length < 2) continue;
    const kg = +p[0], x = +p[1]; let one = '';
    if (t === 'time') one = clock(x); else if (t === 'bw') { if (kg > 0) { one = '+' + kgTxt(kg) + 'x' + x; bwOnly = false; } else one = String(x); }
    else one = i > 0 && kg === pk ? String(x) : kgTxt(kg) + 'x' + x;
    pk = kg; r = r + (i > 0 ? ', ' : '') + one;
  }
  if (n < s.length) return r + ' ...';
  return t === 'bw' && bwOnly ? r + ' reps' : r;
}
function drawPick(dc, F, S, P) {
  const items = listItems(F), n = items.length, k = F.sets.length; let title = 'EXERCISES', tshort = 'EXERCISES';
  if (n === 0 && loading(F)) { // 24.11.: the setup is on its way
    const c = S / 2, f = byInk(dc, [SM, XT], S * .13), t = 'Loading exercises|Loading';
    put(dc, c, downTo(dc, XT, 'EXERCISES', S * .12, R0), XT, 'EXERCISES', S, P.dim, false, R0); put(dc, c, c, f, t, T(S * .8), P.fg, false, R0);
    put(dc, c, below(dc, c + dn(dc, f, t), XT, 0), XT, 'from the phone', T(S * .8), P.lbl, false, R0);
    return;
  }
  if (F.plan) { const w = workouts(F)[F.plan.w]; if (w) { title = String(w.n).toUpperCase(); tshort = null; } }
  const cnt = (F.sel + 1) + '/' + n + (k > 0 ? ', ' + plural(k, 'set', 'sets') + ' done' : '');
  list(dc, F, S, P, items, title, tshort, false, pickSub(dc, F, S, F.sel), cnt + '|' + (F.sel + 1) + '/' + n, []);
}
// Free or a workout (the phone's, those saved on the watch, then the standard ones)
function drawSmode(dc, F, S, P) {
  let sub = 'Choose exercises|Exercises'; const ws = workouts(F);
  if (F.sel > 0 && F.sel - 1 < ws.length) {
    const w = ws[F.sel - 1], it = w.it; let n = 0; for (let i = 0; i < it.length; i++) n += it[i][1] | 0;
    sub = plural(it.length, 'exercise', 'exercises') + ', ' + n + ' sets|' + plural(it.length, 'exercise', 'exercises') + '|' + n + ' sets';
    if (w.std) sub = 'Standard, ' + plural(it.length, 'exercise', 'exercises') + '|Standard';
  }
  list(dc, F, S, P, listItems(F), 'STRENGTH', 'STRENGTH', false, sub, null, []);
}
// BACK on the exercise list with sets logged
function drawEnd(dc, F, S, P, now) {
  list(dc, F, S, P, listItems(F), F.endConf ? 'DISCARD?' : 'END WORKOUT?', F.endConf ? 'DISCARD?' : 'END?', true, null, null, [[plural(F.sets.length, 'set', 'sets') + ', ' + clock(now - F.start - F.pauseT) + '|' + plural(F.sets.length, 'set', 'sets'), P.lbl, false]]);
}
// after the summary: save the session as a workout (its name and size under the rows)
function drawSaveq(dc, F, S, P) {
  const q = F.saveq; if (!q) return;
  const rows = q.rows, it = q.it, ex = [];
  if (F.sel < rows.length - 1) {
    let n = 0; for (let i = 0; i < it.length; i++) n += it[i][1] | 0;
    ex.push([q.w && F.sel === 0 ? q.w.n : q.n, P.fg, true]); ex.push([plural(it.length, 'exercise', 'exercises') + ', ' + n + ' sets|' + plural(it.length, 'exercise', 'exercises') + '|' + n + ' sets', P.lbl, false]);
  }
  list(dc, F, S, P, rows, 'SAVE AS WORKOUT?', 'SAVE?', true, null, null, ex);
}
function drawMore(dc, F, S, P) {
  const m = F.cfg.more; let sub = null;
  if (F.sel < m.length) sub = GROUP[groupOf(m[F.sel][0])] || 'Other sports';
  list(dc, F, S, P, listItems(F), 'MORE SPORTS', 'MORE', false, sub, null, m.length ? [] : [['Choose sports in the app:|Choose in the app:|In the app:', P.fg, false], ['Settings > Watch > More|Watch > More|Watch', P.fg, false]]);
}
// every list: the selected row big in the middle (a menu: in the pill), its sub line under it, the neighbours smaller (one more below);
// the rows are stacked from the fonts' real sizes around the selected one (23.11.: about 0.17 S apart = 44 px touch targets on the fenix 8),
// the counter under the title and the far row only where there is room; title: a fixed one with its short form tshort, or a name (tshort
// null); count: the counter ("long|short", null: n/N); extra = lines under the rows ([text ("long|short"), colour, a name])
function list(dc, F, S, P, items, title, tshort, isMenu, sub, count, extra) {
  const n = items.length, c = S / 2, sel = F.sel, G = gap(S);
  // the title: a fixed one moves down until its short form fits the circle, a name is cut
  const fixed = tshort != null, tv = fixed ? title + '|' + tshort : title, ty = fixed ? downTo(dc, XT, tshort, S * .12, R0) : S * .12;
  const tt = pick(dc, tv, XT, roomC(dc, c, ty, XT, 'A', R0) < T(S * .62) ? roomC(dc, c, ty, XT, 'A', R0) : T(S * .62), !fixed);
  put(dc, c, ty, XT, tt, T(S * .62), P.dim, !fixed, R0);
  const tb = ty + dn(dc, XT, tt);
  let yb = 0;
  if (n === 0) { const f = byInk(dc, [SM, XT], S * .12); put(dc, c, c, f, 'Nothing yet', T(S * .74), P.dim, false, R0); yb = c + dn(dc, f, 'Nothing yet'); }
  else {
    // the selected row
    const ys = S * .5, ph = S * .14; let st = 0, sb = 0;
    if (isMenu) {
      const f = inPill(dc, 'Ag', [ME, SM, XT], S, ph);
      pill(dc, c, ys, S * .78, ph, P.acc); put(dc, c, ys, f, items[sel], T(S * .7), P.ink, true, R0); st = ys - ph / 2; sb = ys + ph / 2;
    } else {
      const f = fontIn(dc, items[sel], [ME, SM], T(S * .74), S * .15);
      dc.setColor(P.acc); dc.fillRectangle(S * .1, ys - S * .055, S * .012 + 1, S * .11);
      put(dc, c, ys, f, items[sel], T(S * .74), P.fg, true, R0); st = ys - up(dc, f); sb = ys + dn(dc, f, items[sel]);
    }
    LAY.rows.push([0, .5]); yb = sb;
    if (!isMenu && typeof sub === 'string') { const y = below(dc, yb, XT, 0); put(dc, c, y, XT, sub, T(S * .7), P.acc, false, R0); yb = y + dn(dc, XT, sub); }
    const side = byInk(dc, [SM, XT], S * .11);
    // the row above, with the counter between it and the title where there is room
    if (sel > 0) {
      const t = items[sel - 1], y = above(dc, st, side, t, S * (isMenu ? .33 : .3));
      if (y - up(dc, side) >= tb + G) { put(dc, c, y, side, t, T(S * .74), P.dim, true, R0); LAY.rows.push([-1, y / S]); st = y - up(dc, side); }
    }
    if (!isMenu) {
      const ct = pick(dc, count != null ? count : (sel + 1) + '/' + n, XT, T(S * .62), false), y = below(dc, tb, XT, S * .19);
      if (y + dn(dc, XT, ct) <= st - G) put(dc, c, y, XT, ct, T(S * .62), P.dim, false, R0);
    }
    // the rows below: the next one, then the far one (non-menu)
    for (let o = 1; o <= (isMenu ? 1 : 2); o++) {
      const i = sel + o; if (i >= n) break;
      const f = o > 1 ? XT : side, t = items[i], y = below(dc, yb, f, S * (isMenu ? .67 : (o > 1 ? .845 : .72)));
      if (y + dn(dc, f, t) > S * (.5 + R0) || roomC(dc, c, y, f, t, R0) < S * .3) break;
      put(dc, c, y, f, t, T(S * (o > 1 ? .55 : .74)), o > 1 ? P.far : P.dim, true, R0); LAY.rows.push([o, y / S]); yb = y + dn(dc, f, t);
    }
  }
  for (let k = 0; k < extra.length; k++) {
    const e = extra[k], y = below(dc, yb, XT, 0), m = roomC(dc, c, y, XT, 'g', R0), t = pick(dc, e[0], XT, m < T(S * .7) ? m : T(S * .7), e[2]);
    if (y + dn(dc, XT, t) > S * (.5 + R0) || m < S * .3) break;
    put(dc, c, y, XT, t, T(S * .7), e[1], e[2], R0); yb = y + dn(dc, XT, t);
  }
  if (n > 0) scrollArc(dc, S, P, sel, n);
  startHint(dc, S, P);
}
// the heart rate (and the session clock) on one line, centred at y; the clock goes where there is no room for both
function hrClock(dc, F, S, P, y, now, f, withClock) {
  const c = S / 2, h = F.hr > 0 ? String(F.hr) : '--', ck = clock(now - F.start - F.pauseT), hs = S * .045, G = gap(S);
  const wh = dc.getTextWidthInPixels(h, f), wc = withClock ? dc.getTextWidthInPixels(ck, XT) + S * .06 : 0, m = roomC(dc, c, y, f, h, R0);
  const both = withClock && hs + G + wh + wc <= m, x0 = c - (hs + G + wh + (both ? wc : 0)) / 2;
  heart(dc, x0 + hs / 2, y, hs, P.hr); txtL(dc, x0 + hs + G, y, f, h, P.fg);
  if (both) txtL(dc, x0 + hs + G + wh + S * .06, y, XT, ck, P.dim);
}
// the set screen: heart rate and clock, the exercise, SET n OF m with last time's numbers left and right (pushed out, never touching it),
// kg x reps big (one font for both, the largest that fits the room between), the bar under the focused one and the units, DONE
function drawSet(dc, F, S, P, now, ui) {
  const e = curEx(F), c = S / 2, t = exT(e), it = planItem(F), G = gap(S), timed = t === 'time', bw = t === 'bw';
  startHint(dc, S, P);
  const hf = byInk(dc, [XT], S), hy = S * .12;
  hrClock(dc, F, S, P, hy, now, hf, true);
  let yb = hy + dn(dc, XT, '0');
  const nf = byInk(dc, [SM, XT], S * .11), ny = below(dc, yb, nf, S * .22);
  put(dc, c, ny, nf, e.n, T(S * .74), P.fg, true, R0); yb = ny + dn(dc, nf, e.n);
  // SET n OF m (short: SET n/m) with last time's numbers beside it; the numbers go where there is no room
  const sy = below(dc, yb, XT, S * .315), lp = lastSet(F, e), xs = [S * .285, S * .735];
  const ls = lp ? (timed ? ['', clock(lp[1])] : [bw && +lp[0] === 0 ? 'BW' : kgTxt(+lp[0]), String(lp[1] | 0)]) : ['', ''];
  const m = roomC(dc, c, sy, XT, 'SET', R0), lw = [dc.getTextWidthInPixels(ls[0], XT), dc.getTextWidthInPixels(ls[1], XT)];
  let no = 'SET ' + setNo(F) + (it ? ' OF ' + it[1] : ''), side = lw[0] > lw[1] ? lw[0] : lw[1];
  if (dc.getTextWidthInPixels(no, XT) + 2 * (side + S * .06) > m) no = 'SET ' + setNo(F) + (it ? '/' + it[1] : '');
  const nw = dc.getTextWidthInPixels(no, XT), lastOn = lp != null && nw + 2 * (side + S * .06) <= m;
  txt(dc, c, sy, XT, no, P.acc);
  if (lastOn) {
    for (let i = 0; i < 2; i++) {
      if (ls[i].length === 0) continue;
      let x = xs[i]; const w = lw[i] / 2, hw = nw / 2 + S * .04;
      if (i === 0 && x + w > c - hw) x = c - hw - w;
      if (i === 1 && x - w < c + hw) x = c + hw + w;
      if (i === 0 && x - w < c - m / 2) x = c - m / 2 + w;
      if (i === 1 && x + w > c + m / 2) x = c + m / 2 - w;
      txt(dc, x, sy, XT, ls[i], P.lbl);
    }
  }
  yb = sy + dn(dc, XT, no);
  // DONE at the bottom, the units (timed: hold / of 10:00) and the focus bar above it
  const py = S * .815, ph = S * .12, lab = timed && !(F.holdAt > 0) ? 'GO' : 'DONE', pf = inPill(dc, lab, [SM, XT], S * .36, ph);
  pill(dc, c, py, S * .4, ph, P.acc); put(dc, c, py, pf, lab, T(S * .36), P.ink, false, R0);
  const uy = above(dc, py - ph / 2, XT, 'reps', S * .665), bh = S * .016 + 1, by = uy - up(dc, XT) - G - bh;
  // the wheel (a finger on a number): the numbers make room for its neighbours above and below
  const wh = wheelOn(F, 0, ui) || wheelOn(F, 1, ui), nb = inkH(dc, XT) + G, nbot = py - ph / 2 - G - nb;
  const top = yb + G + (wh ? nb : 0), bot = wh ? (by - G < nbot ? by - G : nbot) : by - G;
  if (timed) {
    const held = F.holdAt > 0, v = held ? clock(now - F.holdAt) : clock(F.reps), bf = numIn(dc, [v], [NHO, NME, NMI, ME], [T(S * .6)], [c], top, bot, R0);
    const y = numY(dc, bf, top, bot);
    txt(dc, c, y, bf, v, P.acc);
    if (wheelOn(F, 1, ui)) wheelNb(dc, F, S, P, 1, c, y, bf, yb + G, py - ph / 2 - G, true, false);
    else { dc.setColor(P.acc); dc.fillRectangle(S * .36, by, S * .28, bh); put(dc, c, uy, XT, held ? 'of ' + clock(F.reps) : 'hold', T(S * .5), P.fg, false, R0); }
  } else {
    const val = [bw && F.kg === 0 ? 'BW' : kgTxt(F.kg), String(F.reps)], unit = [bw ? '+kg' : 'kg', 'reps'], mx = [T(S * .34), T(S * .28)];
    // one number font for both (BW: a text font, the number fonts have digits only)
    const nfn = numIn(dc, val[0] === 'BW' ? [val[1]] : val, [NHO, NME, NMI, LA, ME, SM], val[0] === 'BW' ? [mx[1]] : mx, val[0] === 'BW' ? [xs[1]] : xs, top, bot, R0);
    const bwf = fontIn(dc, 'BW', [LA, ME, SM], mx[0], bot - top), y = numY(dc, nfn, top, bot);
    txt(dc, S * .515, y, XT, 'x', P.dim);
    for (let i = 0; i < 2; i++) {
      const on = F.focus === i, f = val[i] === 'BW' ? bwf : nfn;
      txt(dc, xs[i], y, f, val[i], on ? P.acc : P.fg);
      if (wheelOn(F, i, ui)) { wheelNb(dc, F, S, P, i, xs[i], y, f, yb + G, py - ph / 2 - G, false, bw); continue; }
      if (on) { dc.setColor(P.acc); dc.fillRectangle(xs[i] - S * .12, by, S * .24, bh); }
      put(dc, xs[i], uy, XT, unit[i], T(S * .3), on ? P.fg : P.lbl, false, R0);
    }
  }
}
/** the first number font in which every v[i] (centred on x[i]) is at most w[i] wide (and inside the circle r) and whose digits fit the rows top..bot */
function numIn(dc, v, fonts, w, x, top, bot, r) {
  for (let i = 0; i < fonts.length; i++) {
    const f = fonts[i], y = numY(dc, f, top, bot); let ok = up(dc, f) + dn(dc, f, '0') <= bot - top;
    for (let k = 0; k < v.length && ok; k++) { const m = roomC(dc, x[k], y, f, '0', r), ww = w[k] < m ? w[k] : m; if (dc.getTextWidthInPixels(v[k], f) > ww) ok = false; }
    if (ok) return f;
  }
  return fonts[fonts.length - 1];
}
/** the y that centres the digits of font f in the rows top..bot */
function numY(dc, f, top, bot) { return (top + bot) / 2 + (up(dc, f) - dn(dc, f, '0')) / 2; }
function wheelOn(F, c, ui) { const w = ui.wheel; return !!w && w.c === c && w.scr === F.scr && (ui.now ?? 0) < w.until; }
// 23.11.7: the wheel's neighbours, one step below / above the number turned (at y in font f), small and dim above / below it (the next
// higher one below: it comes up with the finger); one without room between top and bot is left out
function wheelNb(dc, F, S, P, c, x, y, f, top, bot, timed, bw) {
  for (let d = -1; d <= 1; d += 2) {
    let t = '';
    if (c === 0) { const k = stepOf(F, 0, d, false); if (k === F.kg) continue; t = bw && k === 0 ? 'BW' : kgTxt(k); }
    else { const r = stepOf(F, 1, d, false); if (r === F.reps) continue; t = timed ? clock(r) : String(r); }
    const yy = d < 0 ? above(dc, y - up(dc, f), XT, t, S) : below(dc, y + dn(dc, f, '0'), XT, 0);
    if (yy - up(dc, XT) < top || yy + dn(dc, XT, t) > bot) continue;
    txt(dc, x, yy, XT, t, P.dim);
  }
}
// the rest: the ring, heart rate, the clock, the exercise, its last sets (as many as fit, at most 3), what comes next, SKIP; all inside the ring
function drawRest(dc, F, S, P, now) {
  const left = restLeft(F, now), c = S / 2, r = c - T(S * .04), e = curEx(F), t = exT(e), G = gap(S), ri = .5 - .04 - .025 - .015;
  const part = F.restLen > 0 ? left / F.restLen : 0;
  dc.setPenWidth(pw(S * .05)); dc.setColor(P.faint); dc.drawCircle(c, c, r);
  if (part > 0) { dc.setColor(P.acc); if (part >= .999) dc.drawCircle(c, c, r); else dc.drawArc(c, c, r, ARC_CW, 90, 90 - T(part * 360)); }
  dc.setPenWidth(1);
  // from the bottom: SKIP, the next set, NEXT
  const it = planItem(F); let nx = e;
  if (it) nx = F.setup.ex.find(x => x.id === it[0]) || { id: it[0], n: it[0], t: 'w' };
  const v = prefillOf(F, nx), vt = setShort(exT(nx), v[0], v[1]), no = String(setNo(F)); let lab = '', val = vt;
  if (nx.id === e.id) { lab = 'NEXT: SET ' + no + (it ? ' OF ' + it[1] : '') + '|NEXT: SET ' + no + (it ? '/' + it[1] : ''); val = vt + '|' + setMini(exT(nx), v[0], v[1]); }
  else { lab = 'NEXT: ' + nx.n.toUpperCase(); val = 'Set ' + no + (it ? '/' + it[1] : '') + ', ' + vt + '|' + vt + '|' + setMini(exT(nx), v[0], v[1]); }
  const ky = S * .85; put(dc, c, ky, XT, 'SKIP', S, P.acc, false, ri);
  const vy = above(dc, ky - up(dc, XT), XT, val, S * .758); put(dc, c, vy, XT, val, T(S * .7), P.fg, false, ri);
  const ly = above(dc, vy - up(dc, XT), XT, lab, S * .7); put(dc, c, ly, XT, lab, T(S * .7), P.lbl, nx.id !== e.id, ri);
  // from the top: heart rate, the clock (NUMBER_MEDIUM, smaller where it does not fit), the exercise
  const hf = byInk(dc, [SM, XT], S * .1), hy = S * .15 > up(dc, hf) + S * .1 ? S * .15 : up(dc, hf) + S * .1;
  hrClock(dc, F, S, P, hy, now, hf, false);
  const lt = ly - up(dc, XT) - G, ct = clock(left), nm = e.n.toUpperCase();
  const cf = fontIn(dc, ct, [NME, NMI, ME], T(S * .6), (lt - (hy + dn(dc, hf, '0')) - 2 * G) * .62), cy = below(dc, hy + dn(dc, hf, '0'), cf, S * .3);
  txt(dc, c, cy, cf, ct, left <= 5 ? P.acc : P.fg);
  const ny = below(dc, cy + dn(dc, cf, ct), XT, S * .425); put(dc, c, ny, XT, nm, T(S * .62), P.acc, true, ri);
  // the sets between: the last k that fit
  const mine = F.sets.filter(x => x.ex === e.id), dy = up(dc, XT) + dn(dc, XT, 'g') + G;
  let k = T((lt - (ny + dn(dc, XT, nm)) - G) / dy); if (k > 3) k = 3; if (k > mine.length) k = mine.length;
  for (let j = 0; j < k; j++) {
    const s = mine[mine.length - k + j], ln = (mine.length - k + j + 1) + '   ' + setShort(t, s.kg, s.reps) + '|' + (mine.length - k + j + 1) + '  ' + setMini(t, s.kg, s.reps);
    put(dc, c, ny + dn(dc, XT, nm) + G + up(dc, XT) + j * dy, XT, ln, T(S * .64), P.fg, false, ri);
  }
}
function prFlash(dc, S, P, f) {
  const c = S / 2, t = f.t, kg = f.kg, r = f.reps, v = t === 'bw' ? r + ' reps' : (t === 'time' ? clock(r) : kgTxt(kg) + ' x ' + r);
  dc.setColor(P.acc); dc.fillCircle(c, c, c);
  const a = byInk(dc, [SM, XT], S * .12), b = fontIn(dc, 'PR', [LA, ME, SM], S, S * .2), d = fontIn(dc, v, [ME, SM, XT], T(S * .74), S * .14);
  put(dc, c, S * .27, a, 'NEW RECORD', S, P.ink, false, R0); txt(dc, c, S * .5, b, 'PR', P.ink); put(dc, c, S * .72, d, v, T(S * .74), P.ink, false, R0);
}
function lapFlash(dc, F, S, P, f) {
  const c = S / 2, t = f.t, d = f.d; let l = '';
  dc.setColor(P.acc); dc.fillCircle(c, c, c);
  if (F.sp === 'ride') l = (t > 0 ? d / t * 3.6 : 0).toFixed(1) + ' km/h'; else if (F.sp === 'run') l = pace(t, d) + ' /km'; else l = kmTxt(d) + ' km';
  const a = byInk(dc, [ME, SM, XT], S * .13), ay = S * .26, ct = clock(t);
  put(dc, c, ay, a, 'LAP ' + f.n, S, P.ink, false, R0);
  const lf = fontIn(dc, l, [ME, SM, XT], T(S * .8), S * .13), ly = S * .69;
  const top = ay + dn(dc, a, 'LAP') + gap(S), bot = ly - up(dc, lf) - gap(S), nf = numIn(dc, [ct], [NHO, NME, NMI], [T(S * .84)], [c], top, bot, R0);
  txt(dc, c, numY(dc, nf, top, bot), nf, ct, P.ink); put(dc, c, ly, lf, l, T(S * .8), P.ink, false, R0);
}
// the summary: page 0 the totals, then one page per exercise with every set (as many as fit, then "+ n more")
function drawSum(dc, F, S, P) {
  const s = F.sum, c = S / 2, G = gap(S); if (!s) return;
  const exs = s.ex, pg = F.sel;
  pageDots(dc, S, P, exs.length + 1, pg);
  const dy0 = S * .87, bt = dy0 - up(dc, XT) - G;
  if (pg > 0 && pg <= exs.length) {
    put(dc, c, dy0, XT, 'DONE', S, P.lbl, false, R0);
    const ex1 = exs[pg - 1], t = ex1.t, ss = ex1.s; let vol = 0;
    for (let i = 0; i < ss.length; i++) vol += ss[i][0] * ss[i][1];
    const nf = byInk(dc, [SM, XT], S * .11), ny = S * .2 > up(dc, nf) + S * .12 ? S * .2 : up(dc, nf) + S * .12;
    put(dc, c, ny, nf, ex1.n, T(S * .7), P.acc, true, R0);
    const info = plural(ss.length, 'set', 'sets') + (t !== 'time' && vol > 0 ? ', ' + volTxt(vol) + ' kg|' + plural(ss.length, 'set', 'sets') : ''), iy = below(dc, ny + dn(dc, nf, ex1.n), XT, S * .285);
    put(dc, c, iy, XT, info, T(S * .7), P.lbl, false, R0);
    const dy = up(dc, XT) + dn(dc, XT, 'g') + G > S * .08 ? up(dc, XT) + dn(dc, XT, 'g') + G : S * .08, y0 = below(dc, iy + dn(dc, XT, info), XT, S * .38);
    let k = T((bt - (y0 - up(dc, XT))) / dy); if (k >= ss.length) k = ss.length; else k = k - 1;
    if (k < 0) k = 0;
    for (let i = 0; i < k; i++) {
      const y1 = ss[i], pr = y1[2] === 1, ln = (i + 1) + '   ' + setShort(t, y1[0], y1[1]) + (pr ? '  PR' : '') + '|' + (i + 1) + '  ' + setMini(t, y1[0], y1[1]) + (pr ? ' PR' : '');
      put(dc, c, y0 + i * dy, XT, ln, T(S * .7), pr ? P.acc : P.fg, false, R0);
    }
    if (k < ss.length) put(dc, c, y0 + k * dy, XT, '+ ' + (ss.length - k) + ' more', S, P.lbl, false, R0);
    return;
  }
  const st = s.st, sf = byInk(dc, [SM, XT], S * .1), sy = S * .15 > up(dc, sf) + S * .1 ? S * .15 : up(dc, sf) + S * .1;
  let stt = '', sc = P.acc;
  if (st === 'saved') stt = 'SAVED'; else if (st === 'sending') { stt = 'SENDING'; sc = P.dim; } else if (st === 'failed') stt = 'NOT SAVED';
  if (stt.length > 0) put(dc, c, sy, sf, stt, S, sc, false, R0);
  else { put(dc, c, sy, XT, 'Sends when the phone is near|Waiting for the phone|Not sent yet', S, P.fg, false, R0); }
  const yb = sy + dn(dc, stt.length > 0 ? sf : XT, 'S');
  // the time, TIME, the three numbers with labels, the heart rate, the records, DONE; TIME, the records, DONE and the heart rate go
  // (in this order) when there is no room
  const v = [String(s.sets), volTxt(s.vol), String(s.exs)], l = ['SETS', 'KG', 'LIFTS'], ht = s.hr ? s.hr.avg + ' avg, ' + s.hr.max + ' max|' + s.hr.avg + ' avg' : 'no heart rate|no HR';
  const tf = topFont(dc, clock(s.dur), [NMI, ME, SM], T(S * .8), S * .16, yb, S * .3);
  for (let lvl = 0; lvl < 5; lvl++) {
    const ty = below(dc, yb, tf, S * .3), tl = lvl < 1, py = lvl < 2 && s.prs > 0, dOn = lvl < 3, hOn = lvl < 4, b0 = dOn ? bt : S * (.5 + R0);
    const ly = below(dc, ty + dn(dc, tf, '0'), XT, S * .395), cb = cols(dc, S, P, v, l, tl ? ly + dn(dc, XT, 'T') : ty + dn(dc, tf, '0'), S * .52, b0, [ME, SM, XT], false);
    const hy = below(dc, cb, XT, S * .69), pry = below(dc, hOn ? hy + dn(dc, XT, 'g') : cb, XT, S * .77);
    if ((cb < 0 || (py ? pry + dn(dc, XT, 'P') : (hOn ? hy + dn(dc, XT, 'g') : cb)) > b0) && lvl < 4) continue;
    txt(dc, c, ty, tf, clock(s.dur), P.fg);
    if (tl) put(dc, c, ly, XT, 'TIME', S, P.lbl, false, R0);
    if (dOn) put(dc, c, dy0, XT, 'DONE', S, P.lbl, false, R0);
    cols(dc, S, P, v, l, tl ? ly + dn(dc, XT, 'T') : ty + dn(dc, tf, '0'), S * .52, b0, [ME, SM, XT], true);
    if (py) put(dc, c, pry, XT, s.prs + ' PR', S, P.acc, false, R0);
    if (!hOn) return;
    const hm = roomC(dc, c, hy, XT, 'g', R0) - S * .07 - 2, h2 = pick(dc, ht, XT, hm, false), hw = dc.getTextWidthInPixels(h2, XT), x0 = c - (hw + S * .07) / 2;
    heart(dc, x0 + S * .02, hy, S * .042, P.hr); putL(dc, x0 + S * .07, hy, XT, h2, S, P.fg, false, R0);
    return;
  }
}
// pairing: the six digits of the code from the phone (UP / DOWN, START or a tap on a digit)
function drawPair(dc, F, S, P) {
  const Q = F.pair, c = S / 2, bw = S * .1, bh = S * .14, gp = S * .018, x0 = c - (6 * bw + 5 * gp) / 2 + bw / 2, G = gap(S);
  const tf = byInk(dc, [SM, XT], S * .1), ty = S * .19; put(dc, c, ty, tf, 'PAIR', S, P.acc, false, R0);
  const hy = below(dc, ty + dn(dc, tf, 'P'), XT, S * .28), m = roomC(dc, c, hy, XT, 'p', R0);
  put(dc, c, hy, XT, alt(dc, 'Code from the phone', 'Phone code', XT, m), S, P.fg, false, R0);
  const df = inPill(dc, '0', [ME, SM, XT], bw - 2, bh);
  for (let i = 0; i < 6; i++) {
    const x = x0 + i * (bw + gp), on = i === Q.i;
    if (on) { dc.setColor(P.acc); dc.fillRoundedRectangle(x - bw / 2, S * .5 - bh / 2, bw, bh, S * .015); }
    else { dc.setColor(P.faint); dc.setPenWidth(2); dc.drawRoundedRectangle(x - bw / 2, S * .5 - bh / 2, bw, bh, S * .015); dc.setPenWidth(1); }
    txt(dc, x, S * .5, df, Q.d[i], on ? P.ink : (i < Q.i ? P.fg : P.dim));
    if (on) { tri(dc, x, S * .5 - bh / 2 - S * .03, S * .022, true, P.acc); tri(dc, x, S * .5 + bh / 2 + S * .03, S * .022, false, P.acc); }
  }
  const st = Q.st === 'sending' ? 'Pairing' : (Q.st === 'fail' ? 'Wrong code' : (Q.i === 5 ? 'START: pair' : 'START: next'));
  const sy = below(dc, S * .5 + bh / 2 + S * .045, XT, S * .72); put(dc, c, sy, XT, st, S, Q.st === 'fail' ? P.acc : P.dim, false, R0);
  const py = below(dc, sy + dn(dc, XT, st), XT, S * .82), pm = roomC(dc, c, py, XT, 'p', R0), pt = alt(dc, 'Phone: Settings > Devices', 'Settings > Devices', XT, pm);
  if (py + dn(dc, XT, pt) <= S * (.5 + R0) && dc.getTextWidthInPixels(pt, XT) <= pm) put(dc, c, py, XT, pt, S, P.dim, false, R0);
}
// the pause screen (every mode): PAUSED, the sport, the time, START resume, Hold BACK to finish, Discard (confirm step); while BACK is
// held an orange ring fills with 3-2-1. Discard and the touch pill stay at PAUSE_LAY (the tap table); the lines above them are stacked,
// the sport, then "Hold BACK to finish" (the touch pill says it too), then "START resume" left out where there is no room.
function drawPause(dc, F, S, P, now, ui) {
  const c = S / 2, h = holdPart(F, now), part = h ? h.p : -1, touch = ui.hasTouch !== false, Z = F.pz || { sel: 0, conf: false, hint: 0 }, G = gap(S);
  const ri = part >= 0 ? .5 - .035 - .025 - .015 : R0;
  if (part >= 0) {
    const r = c - T(S * .035);
    dc.setPenWidth(pw(S * .05)); dc.setColor(P.faint); dc.drawCircle(c, c, r);
    if (part > .01) { dc.setColor(P.acc); if (part >= .99) dc.drawCircle(c, c, r); else { let a = 90 - T(part * 360); if (a < 0) a += 360; dc.drawArc(c, c, r, ARC_CW, 90, a); } }
    dc.setPenWidth(1);
  }
  const tf = byInk(dc, [SM, XT], S * .1), ty = S * .17 > up(dc, tf) + S * .09 ? S * .17 : up(dc, tf) + S * .09;
  put(dc, c, ty, tf, 'PAUSED', S, P.acc, false, ri);
  const sp = F.rec ? sportName(F) : 'Strength';
  if (Z.conf) {
    const py = S * .68, ph = pillH(dc, S * .1), qy = S * .82, bt = py - ph / 2 - G;
    pill(dc, c, py, S * .46, ph, P.acc); put(dc, c, py, inPill(dc, 'Discard', [SM, XT], S * .42, ph), 'Discard', S, P.ink, false, ri);
    if (touch) { pill(dc, c, qy, S * .4, ph, P.faint); put(dc, c, qy, inPill(dc, 'Keep', [SM, XT], S * .36, ph), 'Keep', S, P.fg, false, ri); }
    const hy = above(dc, bt + G, XT, 'yes', S * .5), m = roomC(dc, c, hy, XT, 'y', ri), ht = alt(dc, 'START yes, BACK no', 'START: yes', XT, m);
    put(dc, c, hy, XT, ht, S, P.lbl, false, ri);
    const qt = hy - up(dc, XT) - G, qf = fontIn(dc, 'Discard?', [LA, ME, SM, XT], T(S * .8), qt - (ty + dn(dc, tf, 'P')) - 2 * G);
    txt(dc, c, (ty + dn(dc, tf, 'P') + qt) / 2 + (up(dc, qf) - dn(dc, qf, 'D')) / 2, qf, 'Discard?', P.fg);
    return;
  }
  const dy = S * .68, dh = pillH(dc, S * .1), dt = dy - dh / 2 - G;
  if (Z.sel !== 0) { const w = S * .46; dc.setColor(P.acc); dc.setPenWidth(2); dc.drawRoundedRectangle(c - w / 2, dy - dh / 2, w, dh, dh / 2); dc.setPenWidth(1); }
  put(dc, c, dy, inPill(dc, 'Discard', [SM, XT], S * .42, dh), 'Discard', S, Z.sel !== 0 ? P.fg : P.dim, false, ri);
  if (touch) { const on = part >= 0, qh = pillH(dc, S * .11); pill(dc, c, S * .82, S * .5, qh, on ? P.acc : P.faint); put(dc, c, S * .82, inPill(dc, 'Hold', [XT], S * .46, qh), 'Hold to finish|Hold to end|Hold', S * .46, on ? P.ink : P.fg, false, R0); }
  const tt = part >= 0 ? String(h.n) : clock(pausedTime(F)), hint = Z.hint > now || part >= 0 ? P.acc : P.lbl;
  const rf = byInk(dc, [SM, XT], S * .1);
  for (let lvl = 0; lvl < 4; lvl++) {
    const showSp = lvl < 1, showH2 = lvl < 2 || !touch, showH1 = lvl < 3;
    let yb = ty + dn(dc, tf, 'P'), sy = 0, h1 = 0, h2 = 0;
    if (showSp) { sy = below(dc, yb, XT, S * .235); yb = sy + dn(dc, XT, sp); }
    const room = dt - yb - G - (showH1 ? inkH(dc, rf) + G : 0) - (showH2 ? inkH(dc, XT) + G : 0);
    const nf = part >= 0 ? fontIn(dc, tt, [NHO, NME, NMI, ME], T(S * .5), room) : fontIn(dc, tt, [NME, NMI, ME], T(S * .7), room);
    if (up(dc, nf) + dn(dc, nf, '0') > room && lvl < 3) continue;
    const ny = numY(dc, nf, yb + G, yb + G + room); yb = ny + dn(dc, nf, '0');
    if (showH1) { h1 = below(dc, yb, rf, 0); yb = h1 + dn(dc, rf, 'p'); }
    if (showH2) { h2 = below(dc, yb, XT, 0); yb = h2 + dn(dc, XT, 'g'); }
    if (showSp) put(dc, c, sy, XT, sp, T(S * .5), P.lbl, true, ri);
    txt(dc, c, ny, nf, tt, part >= 0 ? P.acc : P.fg);
    if (showH1) put(dc, c, h1, rf, 'START resume', T(S * .7), P.fg, false, ri);
    if (showH2) { const m = roomC(dc, c, h2, XT, 'g', ri); put(dc, c, h2, XT, alt(dc, 'Hold BACK to finish', 'Hold BACK: finish', XT, m), S, hint, false, ri); }
    return;
  }
}
// run / ride / more: the sport, GPS (or the heart rate), the pages, the route line (UP / DOWN or a tap: RPICK), START
function drawReady(dc, F, S, P) {
  const c = S / 2, G = gap(S), other = F.sp === 'other';
  startHint(dc, S, P);
  dc.setColor(P.acc); dc.fillCircle(c, S * .25, S * .1);
  icon(dc, other ? 'more' : F.sp, c, S * .25, S * .12, P.ink);
  const py = S * .81, ph = S * .13; pill(dc, c, py, S * .42, ph, P.acc); put(dc, c, py, inPill(dc, 'START', [SM, XT], S * .38, ph), 'START', S, P.ink, false, R0);
  const bt = py - ph / 2 - G, nm = sportName(F), nf = fontIn(dc, nm, [LA, ME, SM, XT], T(S * .8), S * .13);
  const ny = below(dc, S * .35, nf, S * .445); put(dc, c, ny, nf, nm, T(S * .8), P.fg, true, R0);
  let yb = ny + dn(dc, nf, nm);
  const gf = byInk(dc, [SM, XT], S * .1), gy = below(dc, yb, gf, S * .565);
  if (other && !GPS_OUT.includes(F.type)) {
    const t = F.hr > 0 ? F.hr + ' bpm' : 'Heart rate', w = S * .07 + dc.getTextWidthInPixels(t, gf), x0 = c - w / 2;
    heart(dc, x0 + S * .025, gy, S * .045, P.hr); putL(dc, x0 + S * .07, gy, gf, t, S, P.fg, false, R0);
  } else {
    const q = F.gps ?? 2, col = q >= 2 ? P.good : (q === 1 ? P.acc : P.lbl), t = q >= 2 ? 'GPS ready' : (q === 1 ? 'GPS weak' : 'GPS search');
    const w = S * .055 + dc.getTextWidthInPixels(t, gf), x0 = c - w / 2;
    dc.setColor(col); dc.fillCircle(x0 + S * .02, gy, S * .02); putL(dc, x0 + S * .055, gy, gf, t, S, col, false, R0);
  }
  yb = gy + dn(dc, gf, 'p');
  const pg = recPages(F), n = pg.filter(p => p !== 'route').length, route = pg.includes('route');
  const np = n + (n === 1 ? ' page' : ' pages') + (route ? ' + route' : ''), lines = [];
  if (!other) {
    const r = F.routeId && F.routes ? F.routes.find(x => x.id === F.routeId) : null;
    const rt = r ? (F.route ? 'Route: ' + r.name : 'Loading route') : 'No route';
    // the route line first (it can be tapped), the pages line where there is room
    const ry = below(dc, yb, XT, S * .64);
    if (ry + dn(dc, XT, rt) <= bt) {
      const y2 = below(dc, ry + dn(dc, XT, rt), XT, S * .705), m = roomC(dc, c, y2, XT, 'p', R0);
      const pt = dc.getTextWidthInPixels(np + ', edit on phone', XT) <= m ? np + ', edit on phone' : (dc.getTextWidthInPixels(np + ', on phone', XT) <= m ? np + ', on phone' : np);
      const two = y2 + dn(dc, XT, pt) <= bt;
      const y1 = two ? ry : below(dc, yb, XT, S * .67);
      if (two) put(dc, c, y1, XT, pt, T(S * .62), P.lbl, false, R0);
      const yr = two ? y2 : y1; put(dc, c, yr, XT, rt, T(S * .6), r ? P.acc : P.fg, true, R0); LAY.route = yr / S;
    }
  } else {
    const y = below(dc, yb, XT, S * .655), t = n + (n === 1 ? ' data page' : ' data pages');
    if (y + dn(dc, XT, t) <= bt) put(dc, c, y, XT, t, T(S * .62), P.lbl, false, R0);
  }
}
function drawRpick(dc, F, S, P) {
  const l = F.routes; let sub = 'Data pages only';
  if (l && F.sel > 0 && F.sel - 1 < l.length) { const r = l[F.sel - 1], cl = Math.round(r.climb || 0); sub = kmTxt(r.dist || 0) + ' km' + (cl > 0 ? ', ' + cl + ' m up|' + kmTxt(r.dist || 0) + ' km' : ''); }
  list(dc, F, S, P, listItems(F), 'ROUTE', 'ROUTE', false, sub, null, l && !l.length ? [['Send routes from the phone|Send from the phone|From the phone', P.lbl, false]] : []);
}
function drawRec(dc, F, S, P, now) {
  const R = F.rec; if (!R) return;
  const g = F.seg; if (g && !g.hide) { segScreen(dc, F, S, P, g); return; }
  const pages = recPages(F), n = pages.length, i = R.pg % n;
  if (pages[i] === 'route') routePage(dc, F, S, P); else drawPage(dc, S, P, F.sp, pages[i], R, now);
  recRing(dc, S, P, !R.auto); pageDots(dc, S, P, n, i);
}
// a data page: [x, value y, label y, value size, max width] per field for 1 to 4 fields between the separators (h rows, v the middle
// line); in each cell the label on top, the value with its unit as big as the cell's room allows (auto pause: the first label says so)
export function drawPage(dc, S, P, sp, ids, R, now) {
  let k = ids.length; const c = S / 2, G = gap(S); if (k === 0) return; if (k > 4) k = 4;
  let L = [[.5, .53, .32, .3, .84]], h = [], v = [], cb = [1];
  if (k === 2) { L = [[.5, .34, .2, .2, .74], [.5, .72, .58, .2, .7]]; h = [.5]; cb = [.5, 1]; }
  else if (k === 3) { L = [[.5, .33, .18, .2, .7], [.29, .7, .575, .14, .37], [.71, .7, .575, .14, .37]]; h = [.48]; v = [.48, .9]; cb = [.48, 1, 1]; }
  else if (k === 4) { L = [[.5, .255, .13, .16, .6], [.29, .5, .405, .13, .37], [.71, .5, .405, .13, .37], [.5, .765, .67, .13, .5]]; h = [.355, .615]; v = [.355, .615]; cb = [.355, .615, .615, 1]; }
  dc.setColor(P.line); dc.setPenWidth(pw(S * .006 > 2 ? S * .006 : 2));
  for (let j = 0; j < h.length; j++) { const y = h[j], q = .25 - (y - .5) * (y - .5), hw = Math.sqrt(q > 0 ? q : 0) * S - S * .05; dc.drawLine(c - hw, y * S, c + hw, y * S); }
  if (v.length === 2) dc.drawLine(c, v[0] * S, c, v[1] * S);
  dc.setPenWidth(1);
  const FS = FIELDS[sp] || FIELDS.other;
  for (let i = 0; i < k; i++) {
    const row = L[i], id = ids[i], x = row[0] * S, px = row[3], mw = T(row[4] * S), small = px < .15, hrt = id === 'hr' && !small, fd = FS[id] || { l: id, u: '' };
    const ct = (i === 0 ? 0 : (k === 4 && i === 3 ? .615 : (k === 4 ? .355 : (k === 1 ? 0 : (k === 2 ? .5 : .48))))) * S, cbt = cb[i] * S;
    const auto = R && R.auto && i === 0, lt = auto ? 'AUTO PAUSE|PAUSED' : fd.l.toUpperCase() + '|' + shortLab(id);
    const ly = row[2] * S > ct + G + up(dc, XT) + (ct === 0 ? S * .06 : 0) ? row[2] * S : ct + G + up(dc, XT) + (ct === 0 ? S * .06 : 0);
    const lm = roomC(dc, x, ly, XT, 'A', R0) - (hrt ? T(S * .05) : 0), lw = mw - (hrt ? T(S * .05) : 0) < lm ? mw - (hrt ? T(S * .05) : 0) : lm, lab = fit(dc, pick(dc, lt, XT, lw, false), XT, lw, false), lx = x + (hrt ? S * .022 : 0);
    if (auto) { pill(dc, lx, ly, dc.getTextWidthInPixels(lab, XT) + S * .06, inkH(dc, XT) + 4, P.acc); txt(dc, lx, ly, XT, lab, P.ink); }
    else txt(dc, lx, ly, XT, lab, P.lbl);
    if (hrt) heart(dc, lx - dc.getTextWidthInPixels(lab, XT) / 2 - S * .035, ly, S * .034, P.hr);
    const top = ly + dn(dc, XT, lab) + G, bot = cbt - G - (cb[i] === 1 ? S * .06 : 0);
    valUnit(dc, x, row[1] * S, R ? fieldText(id, R, now) : FS[id] ? FS[id].demo : '--', small && k > 1 ? '' : fd.u, px, mw, top, bot, P);
  }
}
/** a data field's short label (where the long one does not fit) */
export function shortLab(id) {
  const k = ['lapPace', 'avgPace', 'dist', 'lapDist', 'lapTime', 'hr', 'hrZone', 'cadence', 'power3s', 'power', 'avgPower', 'speed', 'avgSpeed'],
    v = ['LAP', 'AVG', 'DIST', 'LAP', 'LAP', 'HR', 'ZONE', 'CAD', '3S', 'PWR', 'AVG', 'SPD', 'AVG'];
  const i = k.indexOf(id); return i >= 0 ? v[i] : (FIELDS.run[id] || FIELDS.ride[id] || FIELDS.other[id] || { l: id }).l.toUpperCase();
}
// a value with its unit after it, centred on x, its digits in the rows top..bot (near y), kept inside max and the circle: the value
// shrinks, the unit goes first; the unit on the value's baseline
function valUnit(dc, x, y, v, u, px, max, top, bot, P) {
  const fonts = valFonts(px, isNum(v)).concat([LA, ME, SM, XT]), uf = XT, S = dc.getWidth();
  let uw = u.length > 0 ? dc.getTextWidthInPixels(u, uf) + 4 : 0, f = fonts[fonts.length - 1], vw = 0, found = false, yy = y;
  for (let pass = 0; pass < 2 && !found; pass++) {
    if (pass === 1) uw = 0;
    for (let i = 0; i < fonts.length && !found; i++) {
      const g = fonts[i], vu = uw > 0 ? v + u : v, hi = up(dc, g) + dn(dc, g, vu); if (hi > bot - top) continue;
      let yi = y; if (yi - up(dc, g) < top) yi = top + up(dc, g); if (yi + dn(dc, g, vu) > bot) yi = bot - dn(dc, g, vu);
      const m = roomC(dc, x, yi, g, vu, R0); vw = dc.getTextWidthInPixels(v, g);
      if (vw + uw <= (max < m ? max : m)) { f = g; found = true; yy = yi; }
    }
  }
  if (!found) { uw = 0; f = fonts[fonts.length - 1]; vw = dc.getTextWidthInPixels(v, f); yy = (top + bot) / 2; }
  const x0 = x - (vw + uw) / 2;
  txtL(dc, x0, yy, f, fit(dc, v, f, T(vw), false), P.fg);
  if (uw > 0) { const base = yy - dc.getFontHeight(f) / 2 + asc(dc, f); txtL(dc, x0 + vw + 4, base - asc(dc, uf) + dc.getFontHeight(uf) / 2, uf, u, P.lbl); }
}
// page dots on the left edge, where the UP / DOWN buttons are, the first page on top
function pageDots(dc, S, P, n, i) {
  if (n < 2) return; const r = S / 2 - S * .035, a0 = 180 + (n - 1) * 5;
  for (let k = 0; k < n; k++) { const a = (a0 - k * 10) * Math.PI / 180, x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r; dc.setColor(k === i ? P.acc : P.dim); dc.fillCircle(x, y, S * (k === i ? .016 : .011)); }
}
function recRing(dc, S, P, on) { dc.setColor(on ? P.acc : P.dim); dc.setPenWidth(pw(S * .024)); dc.drawArc(S / 2, S / 2, S / 2 - T(S * .012), ARC_CW, 120, 60); dc.setPenWidth(1); }
/** three numbers with labels in a row below yb (not above y0): one font for the three (the largest whose row fits the circle and the
 *  room to bot), the labels under them; where no font fits, one line per number; returns the ink bottom, or -1 when it does not fit */
function cols(dc, S, P, v, l, yb, y0, bot, fonts, draw) {
  const G = gap(S), c = S / 2;
  for (let i = 0; i < fonts.length; i++) {
    const f = fonts[i], y = below(dc, yb, f, y0), ly = below(dc, y + dn(dc, f, '0'), XT, 0), b = ly + dn(dc, XT, 'G');
    if (b > bot) continue;
    const dx = colDx(dc, S, v, l, f, y, ly, S * .03); if (dx < 0) continue;
    if (draw) for (let j = 0; j < 3; j++) { const x = c + (j - 1) * dx; txt(dc, x, y, f, v[j], P.fg); txt(dc, x, ly, XT, l[j], P.lbl); }
    return b;
  }
  // the last resort (font size setting): one line per number, "1250 AVG W"
  let y = below(dc, yb, XT, y0), b = -1;
  for (let j = 0; j < 3; j++) {
    if (v[j].length === 0 && l[j].length === 0) continue; // 27.11.4: an empty column (two numbers) is no line
    const wv = dc.getTextWidthInPixels(v[j], XT), sp = S * .025, wl = dc.getTextWidthInPixels(l[j], XT), bb = y + dn(dc, XT, 'G');
    if (bb > bot || wv + sp + wl > roomC(dc, c, y, XT, 'G', R0)) return -1;
    if (draw) { const x0 = c - (wv + sp + wl) / 2; txtL(dc, x0, y, XT, v[j], P.fg); txtL(dc, x0 + wv + sp, y, XT, l[j], P.lbl); }
    b = bb; y = below(dc, bb, XT, 0);
  }
  return b;
}
/** the distance of three columns (0.23 S, more where wide texts need it) with the values v in font f at y and the labels l at ly: the outer ones inside the
 *  circle, none touching the next; -1 when they do not fit */
export function colDx(dc, S, v, l, f, y, ly, pad) {
  let w = 0;
  for (let j = 0; j < 3; j++) { const a = dc.getTextWidthInPixels(v[j], f), b = dc.getTextWidthInPixels(l[j], XT); if (a > w) w = a; if (b > w) w = b; }
  const h1 = half(S, y - up(dc, f), y + dn(dc, f, '0'), R0), h2 = half(S, ly - up(dc, XT), ly + dn(dc, XT, 'G'), R0), hw = h1 < h2 ? h1 : h2;
  const need = w + gap(S) + pad, want = S * .23 > need ? S * .23 : need; let dx = hw - w / 2; if (dx > want) dx = want;
  return dx < need ? -1 : dx;
}
function drawRsum(dc, F, S, P) {
  const s = F.rsum, c = S / 2, G = gap(S); if (!s) return;
  const sp = s.sp, t = s.t, d = s.d, kc = Math.round(s.kcal || 0);
  const v = [kmTxt(d), '', ''], l = ['KM', '', ''];
  if (sp === 'ride') { v[1] = (t > 0 ? d / t * 3.6 : 0).toFixed(1); l[1] = 'KM/H'; v[2] = String(Math.round(s.avgPw || 0)); l[2] = 'AVG W'; }
  else if (sp === 'run') { v[1] = pace(t, d); l[1] = '/KM'; v[2] = String(kc); l[2] = 'KCAL'; }
  else { v[1] = String(kc); l[1] = 'KCAL'; v[2] = String(s.laps | 0); l[2] = 'LAPS'; }
  const sf = byInk(dc, [SM, XT], S * .1), sy = S * .16 > up(dc, sf) + S * .1 ? S * .16 : up(dc, sf) + S * .1; put(dc, c, sy, sf, 'SAVED', S, P.acc, false, R0);
  const dy = S * .87, bt = dy - up(dc, XT) - gap(S), nm = sp === 'other' ? labelOf(s.type) : HOME[sp];
  // the time, TIME, three numbers with labels, the sport, DONE: TIME goes first, then DONE, then the time gets smaller, then the sport goes
  for (let lvl = 0; lvl < 4; lvl++) {
    const tl = lvl < 1, dn0 = lvl < 2, nmOn = lvl < 3, tf = topFont(dc, clock(t), lvl < 2 ? [NME, NMI, ME] : [NMI, ME, SM], T(S * .8), lvl < 2 ? S * .2 : S * .12, sy + dn(dc, sf, 'S'), S * .33);
    const ty = below(dc, sy + dn(dc, sf, 'S'), tf, S * .33), ly = below(dc, ty + dn(dc, tf, '0'), XT, S * .435), lim = dn0 ? bt : S * (.5 + R0);
    const cb = cols(dc, S, P, v, l, tl ? ly + dn(dc, XT, 'T') : ty + dn(dc, tf, '0'), S * .52, lim, [ME, SM, XT], false);
    const nf = byInk(dc, [SM, XT], S * .1), ny = below(dc, cb, nf, S * .76);
    if ((cb < 0 || (nmOn && ny + dn(dc, nf, nm) > lim)) && lvl < 3) continue;
    txt(dc, c, ty, tf, clock(t), P.fg);
    if (tl) put(dc, c, ly, XT, 'TIME', S, P.lbl, false, R0);
    cols(dc, S, P, v, l, tl ? ly + dn(dc, XT, 'T') : ty + dn(dc, tf, '0'), S * .52, lim, [ME, SM, XT], true);
    if (!nmOn) return;
    put(dc, c, ny, nf, nm, T(S * .6), P.acc, true, R0);
    if (dn0) put(dc, c, dy, XT, 'DONE', S, P.lbl, false, R0);
    return;
  }
}
/* ---- 23.11.: the indoor trainer ---- */
// the trainers nearby (FTMS first) while searching, else the state of the one chosen with START to ride
function drawTScan(dc, F, S, P) {
  const L = F.link, v = shown(L), c = S / 2, G = gap(S);
  if (v === 'scan' || v === 'off') {
    const n = L.list.length;
    if (n > 0) { const sub = F.sel < n && L.list[F.sel].ftms ? 'Smart trainer, ERG|Smart trainer' : 'Power only, no ERG|Power only'; list(dc, F, S, P, listItems(F), 'INDOOR TRAINER', 'TRAINER', false, sub, 'Searching, START connects|Searching', []); return; }
    const tt = alt(dc, 'INDOOR TRAINER', 'TRAINER', XT, roomC(dc, c, S * .12, XT, 'I', R0)); put(dc, c, S * .12, XT, tt, S, P.dim, false, R0);
    dc.setColor(P.acc); dc.fillCircle(c, S * .3, S * .07); icon(dc, 'trainer', c, S * .3, S * .085, P.ink);
    const f = byInk(dc, [ME, SM, XT], S * .12), y = below(dc, S * .37, f, S * .45); put(dc, c, y, f, 'Searching', S, P.fg, false, R0);
    const y1 = below(dc, y + dn(dc, f, 'g'), XT, S * .56); put(dc, c, y1, XT, 'Pedal a few turns', S, P.lbl, false, R0);
    const y2 = below(dc, y1 + dn(dc, XT, 'P'), XT, S * .62), m = roomC(dc, c, y2, XT, 'k', R0);
    put(dc, c, y2, XT, alt(dc, 'to wake the trainer', 'to wake it up', XT, m), S, P.lbl, false, R0);
    return;
  }
  dc.setColor(P.acc); dc.fillCircle(c, S * .24, S * .1); icon(dc, 'trainer', c, S * .24, S * .12, P.ink);
  let a = '', col = P.fg, b = '', d = '';
  if (v === 'conn') { a = 'Connecting'; b = 'Taking control'; }
  else if (v === 'ready') { a = 'Connected'; col = P.good; b = L.ctl ? 'ERG ready' : 'Power only, no ERG|Power only'; }
  const nm = F.tw >= 0 && (v === 'conn' || v === 'ready'); // 27.11.: the choice made while connecting (TPICK), START rides it
  if (nm) d = F.tw > 0 && F.tw <= rides(F).length ? rides(F)[F.tw - 1].n : 'Free ride (ERG)';
  else if (v === 'refused') { a = 'Refuses control'; col = P.bad; b = 'Another app controls it.|Another app has it.|App in use'; d = 'Close it, or ride without ERG|Or ride without ERG|Or ride, no ERG'; }
  else if (v === 'lost') { a = 'Lost, reconnecting|Lost'; col = P.bad; b = 'Keeps trying'; }
  const start = v === 'ready' || v === 'refused', py = S * .81, ph = S * .13;
  let bt = 0;
  if (start) { startHint(dc, S, P); pill(dc, c, py, S * .42, ph, P.acc); put(dc, c, py, inPill(dc, 'START', [SM, XT], S * .38, ph), 'START', S, P.ink, false, R0); bt = py - ph / 2 - G; }
  else { const by = S * .82; put(dc, c, by, XT, 'BACK: the list', S, P.lbl, false, R0); bt = by - up(dc, XT) - G; }
  const nf = byInk(dc, [SM, XT], S * .1), ny = below(dc, S * .34, nf, S * .4); put(dc, c, ny, nf, L.name, T(S * .74), P.fg, true, R0);
  const a0 = a.split('|')[0], af = topFont(dc, a0, [ME, SM, XT], T(S * .8), S * .13, ny + dn(dc, nf, L.name), S * .52), ay = below(dc, ny + dn(dc, nf, L.name), af, S * .52);
  put(dc, c, ay, af, a, T(S * .8), col, false, R0); let yb = ay + dn(dc, af, a0);
  const lines = [b, d];
  for (let i = 0; i < 2; i++) {
    if (lines[i].length === 0) continue;
    const y = below(dc, yb, XT, S * (i === 0 ? .61 : .675)), m = roomC(dc, c, y, XT, 'g', R0), t = pick(dc, lines[i], XT, m < T(S * .74) ? m : T(S * .74), false);
    if (y + dn(dc, XT, t) > bt) break;
    put(dc, c, y, XT, t, T(S * .74), i === 0 ? P.fg : (nm ? P.acc : P.lbl), i === 1 && nm, R0); yb = y + dn(dc, XT, t);
  }
}
// 27.11.2: the heart rate step: the heart, Searching (where a strap is paired) or Connected with the value, START / SKIP
function drawTHr(dc, F, S, P, now) {
  const c = S / 2, on = hrOn(F, now), w = T(S * .74);
  put(dc, c, S * .12, XT, 'HEART RATE|HR', S, P.dim, false, R0);
  dc.setColor(on ? P.hr : P.faint); dc.fillCircle(c, S * .3, S * .09); heart(dc, c, S * .3, S * .1, on ? P.ink : P.fg);
  const a = on ? 'Connected' : 'Searching', f = byInk(dc, [ME, SM, XT], S * .12), y = below(dc, S * .39, f, S * .47); put(dc, c, y, f, a, S, on ? P.good : P.fg, false, R0);
  const b = on ? F.hr + ' bpm' : 'Strap: watch menu, Sensors|Pair it in Sensors|In Sensors', y1 = below(dc, y + dn(dc, f, 'g'), XT, S * .58);
  put(dc, c, y1, XT, b, w, on ? P.fg : P.lbl, false, R0);
  if (!on) { const y2 = below(dc, y1 + dn(dc, XT, 'g'), XT, S * .65); put(dc, c, y2, XT, 'or ride without', w, P.lbl, false, R0); }
  const py = S * .81, ph = S * .13, t = on ? 'START' : 'SKIP';
  startHint(dc, S, P); pill(dc, c, py, S * .42, ph, P.acc); put(dc, c, py, inPill(dc, t, [SM, XT], S * .38, ph), t, S, P.ink, false, R0);
}
// 27.11.2: two small marks at the very top of the ride: the trainer (green connected, white without control, red lost) and the heart
// (red while a heart rate comes, grey without)
function linkMarks(dc, F, S, P, now) {
  const v = shown(F.link), y = S * .046;
  icon(dc, 'trainer', S / 2 - S * .04, y, S * .045, v === 'ready' ? P.good : (v === 'refused' ? P.fg : P.bad));
  heart(dc, S / 2 + S * .04, y, S * .036, hrOn(F, now) ? P.hr : P.dim);
}
const avgPw = R => R.t ? Math.round(R.pwSum / R.t) : 0;
// 28.11. (27.11.3): the ride's pages (tPages: the target page first, then the phone's choice of workout, body, stats), the edge ring, the dots
// and the trainer / heart marks on every page
function drawTRec(dc, F, S, P, now, ui) {
  const R = F.tr; if (!R) return;
  const pg = tPages(F), n = pg.length, id = pg[R.pg % n];
  trRing(dc, F, S, P, n, id === 'wk'); pageDots(dc, S, P, n, R.pg % n); linkMarks(dc, F, S, P, now);
  if (id === 'wk' && F.wk) trWork(dc, F, S, P, now);
  else if (id === 'body') trBody(dc, F, S, P, now);
  else if (id === 'stats') trStats(dc, S, P, R);
  else trTarget(dc, F, S, P, now, ui);
}
// 28.11.: the step kinds' colours, the workout builder's (js/myworkouts.js STEP_TYPES): work = the accent (orange), warm-up yellow,
// cool-down blue, recovery / rest green (MIP: the 64-colour palette's nearest)
function kindCol(P, k) { return k === 1 ? P.acc : (k === 2 ? P.wWarm : (k === 3 ? P.wCool : P.wRec)); }
// a band on the bezel from p0 to p1 degrees clockwise from 12 o'clock, in pieces of at most 180 degrees (none under 1: an arc from a
// degree to itself would be a whole circle), the page dots' gap (ga degrees each side of 9 o'clock) left out
function arcP(dc, S, col, p0, p1, ga) {
  const c = S / 2, r = S / 2 - T(S * .01);
  dc.setColor(col); dc.setPenWidth(pw(S * .02));
  const cuts = ga > 0 ? [[p0, p1 < 270 - ga ? p1 : 270 - ga], [p0 > 270 + ga ? p0 : 270 + ga, p1]] : [[p0, p1]];
  for (let j = 0; j < cuts.length; j++) {
    let a = cuts[j][0]; const b = cuts[j][1];
    while (b - a >= 1) {
      const e = b - a > 180 ? a + 180 : b, d0 = T(90 - a + 720) % 360, d1 = T(90 - e + 720) % 360;
      if (d0 !== d1) dc.drawArc(c, c, r, ARC_CW, d0, d1);
      a = e;
    }
  }
  dc.setPenWidth(1);
}
// 28.11. (the owner: "a progress bar along the edge that runs down like a timer"): in a workout the time left as a band that ends at 12
// o'clock and shrinks from its front, in the step kinds' colours (grey while paused) over a faint track: whole = the whole workout (its
// steps still to come), else the step now. A free ride has nothing to count down: the short recording arc at the top, as on a run.
function trRing(dc, F, S, P, n, whole) {
  const R = F.tr, W = F.wk;
  if (!W || W.i >= W.dur.length) { recRing(dc, S, P, R.st === 'run'); return; }
  const ga = n > 1 ? (n - 1) * 5 + 6 : 0, run = R.st === 'run';
  arcP(dc, S, P.faint, 0, 360, ga);
  if (!whole) { const d = W.dur[W.i], lf = wkLeft(W, R.t); arcP(dc, S, run ? kindCol(P, W.kd[W.i]) : P.dim, 360 - 360.0 * lf / d, 360, ga); return; }
  const k0 = 360.0 / W.tot; let s = W.s0, from = R.t * k0, col = -1;
  for (let k = W.i; k < W.dur.length; k++) {
    const ck = run ? kindCol(P, W.kd[k]) : P.dim;
    if (ck !== col) { if (col >= 0) arcP(dc, S, col, from, s * k0, ga); col = ck; from = s * k0 > from ? s * k0 : from; }
    s += W.dur[k];
  }
  if (col >= 0) arcP(dc, S, col, from, 360, ga);
}
// 28.11.: a small - / + button (the owner: "too big, write the step inside"): a faint pill w x h with the step in it ("-5", "+25") in the
// largest font that fits it; where none does (font size setting) the drawn sign (the fonts may have no minus sign, the hyphen they have)
function trBtn(dc, S, P, x, y, t, plus) {
  const w = S * .16, h = S * .11, tp = '+' + t.substring(1), f = inPill(dc, tp, [SM, XT], w - 6, h); // both buttons in the font the wider "+25" fits
  pill(dc, x, y, w, h, P.faint);
  if (dc.getTextWidthInPixels(tp, f) <= w - 6 && up(dc, f) <= h / 2 - 1 && dn(dc, f, tp) <= h / 2 - 1) { txt(dc, x, y, f, t, P.fg); return; }
  const k = S * .025; dc.setColor(P.fg); dc.setPenWidth(pw(S * .014)); dc.drawLine(x - k, y, x + k, y); if (plus) dc.drawLine(x, y - k, x, y + k); dc.setPenWidth(1);
}
// the target page, the overview (the owner: "one sheet with everything"): the time left in the step (a free ride: the ride's time) with the
// ring, the step's label (a ramp: "WARM-UP 100 TO 180 W"), the target big with small - / + buttons that carry the step, the offset under it
// (only when there is one), the trainer's power, cadence and heart rate, the next step (a free ride: the average). gT0 .. gT1: the target's
// zone (the taps on - / + / the target, the wheel)
function trTarget(dc, F, S, P, now, ui) {
  const R = F.tr, L = F.link, v = shown(L), paused = R.st !== 'run', c = S / 2, G = gap(S), W = F.wk;
  // 27.11.: in a workout the time left in the step (orange in a hard one), its label / counter, the offset, the next step and the time left
  const ct = clock(W ? wkLeft(W, R.t) : R.t), tf = fontIn(dc, ct, [NMI, ME, SM, XT], T(S * .5), S * .1), ty = S * .13 > up(dc, tf) + S * .075 ? S * .13 : up(dc, tf) + S * .075;
  put(dc, c, ty, tf, ct, S, W && W.hard[W.i] ? P.acc : P.fg, false, R0);
  const warn = v === 'lost' ? 'LOST, RECONNECTING|LOST' : (v === 'refused' ? 'NO CONTROL, OTHER APP|NO CONTROL' : (!L.ctl ? 'POWER ONLY, NO ERG|NO ERG' : (paused ? 'PAUSED' : '')));
  const done = !W && F.wkDone > now, lab = W ? wkShown(W) : (done ? 'WORKOUT DONE' : 'TARGET W');
  const wc = warn.length === 0 ? (done ? P.good : (W ? P.fg : P.lbl)) : (paused && L.ctl && v !== 'lost' && v !== 'refused' ? P.acc : P.bad);
  const wh = wheelOn(F, 0, ui), ly = below(dc, ty + dn(dc, tf, '0'), XT, S * .205), lp = (warn.length > 0 ? warn : lab).split('|'), lm = roomC(dc, c, ly, XT, 'W', R0);
  if (!wh) put(dc, c, ly, XT, lp.length > 1 ? alt(dc, lp[0], lp[1], XT, lm) : lp[0], S, wc, warn.length === 0 && W != null, R0);
  // the bottom: AVG / the resume pill (a workout: the time left, the next step above it), the three numbers with labels, the separator
  const by = S * .85; let bt = 0;
  if (paused) { const ph = S * .1; pill(dc, c, by, S * .44, ph, P.acc); put(dc, c, by, inPill(dc, 'START', [XT], S * .4, ph), 'START resume|Resume', S * .4, P.ink, false, R0); bt = by - ph / 2 - G; }
  else if (W) {
    const tl = clock(wkTotLeft(W, R.t)), nw = wkNextW(W), nx = nw < 0 ? 'LAST STEP' : 'NEXT ' + nw + ' W, ' + clock(W.dur[W.i + 1]) + '|' + nw + ' W, ' + clock(W.dur[W.i + 1]) + '|' + nw + ' W';
    // the time left goes where the font size setting leaves no room for two lines
    if (inkH(dc, XT) <= S * .08) { put(dc, c, by, XT, tl + ' LEFT|' + tl, S, P.lbl, false, R0); const ny = above(dc, by - up(dc, XT), XT, 'g', S); put(dc, c, ny, XT, nx, S, P.fg, false, R0); bt = ny - up(dc, XT) - G; }
    else { put(dc, c, by, XT, nx, S, P.fg, false, R0); bt = by - up(dc, XT) - G; }
  }
  else { const t = 'AVG ' + avgPw(R) + ' W, ' + Math.round(R.kj) + ' kJ'; put(dc, c, by, XT, t + '|AVG ' + avgPw(R) + ' W|AVG ' + avgPw(R), S, P.lbl, false, R0); bt = by - up(dc, XT) - G; }
  // the three numbers: the largest font whose row and labels fit 0.2 S and the circle (WATTS is W where it does not); 28.11.: no cadence
  // from the trainer = "--" (a 0 would say "not pedalling")
  const d = tLive(L, now), vals = [String(d.pw), hasCad(L, now) ? String(d.cad) : '--', F.hr > 0 ? String(F.hr) : '--'], vfs = [NMI, ME, SM, XT], vl = above(dc, bt, XT, 'G', S * .735);
  let labs = ['WATTS', 'RPM', 'BPM'], vf = XT, vy = 0, dx = -1, hOn = true;
  for (let pass = 0; pass < 3 && dx < 0; pass++) {
    if (pass === 1) labs = ['W', 'RPM', 'BPM'];
    if (pass === 2) hOn = false;
    for (let i = 0; i < vfs.length; i++) {
      vf = vfs[i]; vy = above(dc, vl - up(dc, XT), vf, '0', S * .655); dx = inkH(dc, vf) + G + inkH(dc, XT) <= S * .2 || i === vfs.length - 1 ? colDx(dc, S, vals, labs, vf, vy, vl, hOn ? S * .05 : 0) : -1;
      if (dx >= 0) break;
    }
  }
  if (dx < 0) dx = S * .18;
  const sep = vy - up(dc, vf) - G - 1;
  for (let i = 0; i < 3; i++) {
    const x = c + (i - 1) * dx;
    txt(dc, x, vy, vf, vals[i], P.fg);
    if (i === 2 && hOn) heart(dc, x - dc.getTextWidthInPixels('BPM', XT) / 2 - S * .02, vl, S * .03, P.hr);
    txt(dc, x + (i === 2 && hOn ? S * .015 : 0), vl, XT, labs[i], P.lbl);
  }
  dc.setColor(P.line); dc.setPenWidth(pw(S * .006 > 2 ? S * .006 : 2)); dc.drawLine(S * .12, sep, S * .88, sep); dc.setPenWidth(1);
  // the target between the label and the separator, the small - / + beside it, the offset under it when there is one (the wheel: the
  // neighbours instead)
  // 28.11.: a ramp says so under the target, plain: "WARM-UP" above it, "100 TO 180 W" (with the offset in it) under it, the offset after it
  const aj = W ? wkAdj(W) : 0, t = String(R.tgt), top = (wh ? ty + dn(dc, tf, '0') : ly + dn(dc, XT, 'W')) + G, sf = XT, rp = W ? wkRamp(W) : null;
  const ajt = (aj > 0 ? '+' : '-') + Math.abs(aj) + ' W', ut = rp ? rp[0] + ' TO ' + rp[1] + ' W' + (aj !== 0 ? ', ' + ajt + '|' + rp[0] + ' TO ' + rp[1] + ' W' : '') : (aj !== 0 ? ajt : '');
  const room = sep - G - top - (wh || ut.length === 0 ? 0 : inkH(dc, sf) + G), gf = numIn(dc, [t], [NTH, NHO, NME, NMI], [T(S * .44)], [c], top, top + room, R0), gy = numY(dc, gf, top, top + room);
  txt(dc, c, gy, gf, t, paused ? P.dim : P.acc); LAY.t0 = top / S; LAY.t1 = sep / S;
  const xs = [.16, .84];
  for (let i = 0; i < 2; i++) trBtn(dc, S, P, S * xs[i], gy, (i === 0 ? '-' : '+') + R.step, i === 1);
  if (wh) { for (let dd = -1; dd <= 1; dd += 2) { const w = W ? R.tgt + dd * R.step : nextTarget(R, dd, false); if (w === R.tgt) continue; const yy = dd < 0 ? above(dc, gy - up(dc, gf), XT, '0', S) : below(dc, gy + dn(dc, gf, '0'), XT, 0);
    if (yy - up(dc, XT) >= ty + dn(dc, tf, '0') + G && yy + dn(dc, XT, '0') <= sep - G) txt(dc, c, yy, XT, String(w), P.dim); } }
  else if (ut.length > 0) put(dc, c, below(dc, gy + dn(dc, gf, '0'), sf, 0), sf, ut, T(S * .8), P.fg, false, R0); // clear of the page dots
}
// 28.11.: the workout page (where am I, what comes next, how long is left): the repeat's counter (else the step's label), the target and
// the time left in the step, the workout as blocks under a magnifying glass (the step now wide in the middle with its progress and a
// marker, four steps each side narrower towards the edges; height = target watts, ramps as slopes, the step kinds' colours, done ones
// grey), NEXT with its watts and length, the time left of the whole workout (the ring: the whole workout)
function trWork(dc, F, S, P, now) {
  const R = F.tr, W = F.wk, c = S / 2, G = gap(S), i = W.i, n = W.dur.length, run = R.st === 'run';
  if (i >= n) return;
  const ly = S * .15 > up(dc, XT) + S * .1 ? S * .15 : up(dc, XT) + S * .1, cn = W.cnt[i], k = cn.indexOf(','), lm = roomC(dc, c, ly, XT, cn, R0);
  // the counter "5/13, SET 2/3", where it does not fit "5/13"; outside repeats the step's label
  const lab = cn.length === 0 ? wkShown(W) : (k > 0 && dc.getTextWidthInPixels(cn, XT) > (lm < T(S * .62) ? lm : T(S * .62)) ? cn.substring(0, k) : cn);
  put(dc, c, ly, XT, lab, T(S * .62), W.hard[i] ? P.acc : P.lbl, true, R0);
  // the target and the time left in the step: one line, one font
  const tw = R.tgt + ' W', tl = clock(wkLeft(W, R.t)), sp = S * .06, fs = [ME, SM, XT];
  let f2 = XT, y2 = 0;
  for (let j = 0; j < fs.length; j++) {
    f2 = fs[j]; y2 = below(dc, ly + dn(dc, XT, lab), f2, 0);
    if (dc.getTextWidthInPixels(tw, f2) + sp + dc.getTextWidthInPixels(tl, f2) <= roomC(dc, c, y2, f2, tw + tl, R0) && inkH(dc, f2) <= S * .12) break;
  }
  const w1 = dc.getTextWidthInPixels(tw, f2), x0 = c - (w1 + sp + dc.getTextWidthInPixels(tl, f2)) / 2;
  txtL(dc, x0, y2, f2, tw, run ? P.acc : P.dim); txtL(dc, x0 + w1 + sp, y2, f2, tl, P.fg);
  // the bottom: the time left of the workout (where two lines fit), NEXT above it
  const by = S * .84, nw = wkNextW(W), nx = nw < 0 ? 'LAST STEP' : 'NEXT ' + nw + ' W, ' + clock(W.dur[i + 1]) + '|' + nw + ' W, ' + clock(W.dur[i + 1]) + '|' + nw + ' W';
  const tot = clock(wkTotLeft(W, R.t));
  let ny = by;
  if (inkH(dc, XT) <= S * .08) { put(dc, c, by, XT, tot + ' LEFT|' + tot, S, P.lbl, false, R0); ny = above(dc, by - up(dc, XT), XT, 'g', S); }
  put(dc, c, ny, XT, nx, S, P.fg, false, R0);
  // the magnifying glass between them
  const top = y2 + dn(dc, f2, '0') + 3 * G, bot = ny - up(dc, XT) - 2 * G;
  if (bot - top < S * .06) return;
  const hw = half(S, top, bot, .44), mw = 2 * hw * .32, sw = (2 * hw - mw) / 2, g = pw(S * .008), fr = [.36, .27, .21, .16];
  let mx = 1;
  for (let k = i - 4; k <= i + 4; k++) { if (k < 0 || k >= n) continue; const a = wkPlat(W, k, 0), b = wkPlat(W, k, W.dur[k]); if (a > mx) mx = a; if (b > mx) mx = b; }
  for (let d = -4; d <= 4; d++) {
    const k = i + d, ad = d < 0 ? -d : d; if (k < 0 || k >= n) continue;
    let xa = c - mw / 2, xb = c + mw / 2;
    if (d !== 0) { let o = mw / 2; for (let j = 1; j < ad; j++) o += sw * fr[j - 1]; const wd = sw * fr[ad - 1]; xa = d < 0 ? c - o - wd : c + o; xb = xa + wd; }
    xa += g / 2; xb -= g / 2;
    const ha = trH(top, bot, wkPlat(W, k, 0), mx), hb = trH(top, bot, wkPlat(W, k, W.dur[k]), mx), col = kindCol(P, W.kd[k]);
    if (d !== 0) { dc.setColor(d < 0 ? P.faint : col); dc.fillPolygon([[xa, bot], [xa, bot - ha], [xb, bot - hb], [xb, bot]]); continue; }
    const into = R.t - W.s0, f = into <= 0 ? 0.0 : (into >= W.dur[k] ? 1.0 : into * 1.0 / W.dur[k]), xs = xa + (xb - xa) * f, hs = trH(top, bot, wkPlat(W, k, into), mx);
    if (xs - xa >= 1) { dc.setColor(P.faint); dc.fillPolygon([[xa, bot], [xa, bot - ha], [xs, bot - hs], [xs, bot]]); }
    if (xb - xs >= 1) { dc.setColor(run ? col : P.dim); dc.fillPolygon([[xs, bot], [xs, bot - hs], [xb, bot - hb], [xb, bot]]); }
    dc.setColor(P.fg); dc.setPenWidth(pw(S * .008)); dc.drawLine(xs, top, xs, bot); dc.setPenWidth(1);
    tri(dc, xs, top, S * .018, false, P.fg);
  }
}
// a block's height for w watts (the highest shown = the whole height top .. bot), at least 2 px
function trH(top, bot, w, mx) { const h = (bot - top) * w / mx; return h > 2 ? h : 2; }
// 28.11.: the body page (how is my body doing): the ride's time, the heart rate big with the heart, its average and max, then cadence,
// average power and kJ in a row
function trBody(dc, F, S, P, now) {
  const R = F.tr, L = F.link, c = S / 2, G = gap(S);
  const ct = clock(R.t), tf = fontIn(dc, ct, [NMI, ME, SM, XT], T(S * .44), S * .1), ty = S * .15 > up(dc, tf) + S * .085 ? S * .15 : up(dc, tf) + S * .085;
  put(dc, c, ty, tf, ct, S, P.fg, false, R0);
  const ly = below(dc, ty + dn(dc, tf, '0'), XT, 0); put(dc, c, ly, XT, 'RIDE TIME|TIME', S, P.lbl, false, R0);
  // the row at the bottom: the largest font whose numbers and labels fit the circle
  const v = [hasCad(L, now) ? String(tLive(L, now).cad) : '--', String(avgPw(R)), String(Math.round(R.kj))], fs = [ME, SM, XT];
  let l = ['RPM', 'AVG W', 'KJ'], vf = XT, vy = 0, vl = 0, dx = -1;
  for (let pass = 0; pass < 2 && dx < 0; pass++) {
    if (pass === 1) l = ['RPM', 'W', 'KJ'];
    for (let i = 0; i < fs.length && dx < 0; i++) {
      vf = fs[i]; vy = S * .68; vl = below(dc, vy + dn(dc, vf, '0'), XT, 0);
      if (vl + dn(dc, XT, 'G') > S * .9) { vy = vy - (vl + dn(dc, XT, 'G') - S * .9); vl = below(dc, vy + dn(dc, vf, '0'), XT, 0); }
      dx = colDx(dc, S, v, l, vf, vy, vl, S * .03);
    }
  }
  if (dx < 0) dx = S * .2;
  for (let j = 0; j < 3; j++) { txt(dc, c + (j - 1) * dx, vy, vf, v[j], P.fg); txt(dc, c + (j - 1) * dx, vl, XT, l[j], P.lbl); }
  // the average and max heart rate above the row, the heart rate big between
  const am = R.hrN ? Math.round(R.hrSum / R.hrN) : 0, at = 'AVG ' + orDash(am) + ', MAX ' + orDash(R.hrMax) + '|' + orDash(am) + ' / ' + orDash(R.hrMax);
  const ay = above(dc, vy - up(dc, vf) - G, XT, 'g', S); put(dc, c, ay, XT, at, S, P.lbl, false, R0);
  const top = ly + dn(dc, XT, 'T') + G, bt = ay - up(dc, XT) - G, h = F.hr > 0 ? String(F.hr) : '--', hx = c + S * .04;
  const hf = numIn(dc, [h], [NTH, NHO, NME, NMI], [T(S * .5)], [hx], top, bt, R0), hy = numY(dc, hf, top, bt), hs = S * .06;
  txt(dc, hx, hy, hf, h, P.fg);
  heart(dc, hx - dc.getTextWidthInPixels(h, hf) / 2 - G - hs * .7, hy, hs, F.hr > 0 ? P.hr : P.dim);
}
// 27.11.: the trainer's choice: a free ride (one target) or a workout (its length under it); while connecting it says so
function drawTPick(dc, F, S, P) {
  const l = rides(F), v = shown(F.link), w = F.sel > 0 && F.sel <= l.length ? l[F.sel - 1] : null, m = w ? T((wkDur(w.s) + 30) / 60) : 0;
  const sub = w ? m + ' min' : 'One target, + / - change it|One target';
  list(dc, F, S, P, listItems(F), 'INDOOR TRAINER', 'TRAINER', false, sub, null, v === 'ready' || v === 'refused' ? [] : [['Still connecting|Connecting|Wait', P.lbl, false]]);
}
const orDash = n => n > 0 ? String(n) : '--';
// the ride's second page: this target's block (time, avg power), then the whole ride
function trStats(dc, S, P, R) {
  const c = S / 2, G = gap(S), bAvg = R.bN > 0 ? Math.round(R.bSum / R.bN) : 0, sm = { np: R.npN ? Math.round(Math.pow(R.np4 / R.npN, .25)) : 0, cad: R.cadN ? Math.round(R.cadSum / R.cadN) : 0, hr: R.hrN ? Math.round(R.hrSum / R.hrN) : 0 };
  const af = byInk(dc, [SM, XT], S * .1), ay = S * .17 > up(dc, af) + S * .09 ? S * .17 : up(dc, af) + S * .09; put(dc, c, ay, af, 'AT ' + R.tgt + ' W', S, P.acc, false, R0);
  const v1 = [String(avgPw(R)), String(R.pwMax), String(Math.round(R.kj))], v2 = [orDash(sm.np), orDash(sm.cad), orDash(sm.hr)];
  // the block's time, its average, the separator, two rows of three: the numbers' font shrinks first, then the time, then the average
  // goes, then the second row
  const FS3 = [[ME, SM, XT], [SM, XT], [XT]], l1 = ['AVG W', 'MAX W', 'KJ'], l2 = ['NP', 'RPM', 'AVG HR'];
  for (let q = 0; q < 12; q++) {
    const lvl = q < 9 ? T(q / 3) : 2, fs = FS3[q % 3], two = q < 9;
    const tf = fontIn(dc, clock(R.t - R.bT0), [NME, NMI, ME, SM], T(S * .7), lvl === 0 ? S * .2 : S * .14), ty = below(dc, ay + dn(dc, af, 'A'), tf, S * .3);
    const ly = below(dc, ty + dn(dc, tf, '0'), XT, S * .41), lt = bAvg + ' W avg at this target|' + bAvg + ' W avg';
    const sep = (lvl < 2 ? ly + dn(dc, XT, 'g') : ty + dn(dc, tf, '0')) + G + 1;
    const b1 = cols(dc, S, P, v1, l1, sep + 1, S * .58, S * (.5 + R0), fs, false);
    const b2 = b1 < 0 || !two ? -1 : cols(dc, S, P, v2, l2, b1, 0, S * .9, fs, false);
    if ((two ? b2 : b1) < 0 && q < 11) continue;
    txt(dc, c, ty, tf, clock(R.t - R.bT0), P.fg);
    if (lvl < 2) put(dc, c, ly, XT, lt, S, P.lbl, false, R0);
    dc.setColor(P.line); dc.setPenWidth(pw(S * .006 > 2 ? S * .006 : 2)); dc.drawLine(S * .12, sep, S * .88, sep); dc.setPenWidth(1);
    const c1 = cols(dc, S, P, v1, l1, sep + 1, S * .58, S * (.5 + R0), fs, true);
    if (c1 > 0 && two) cols(dc, S, P, v2, l2, c1, 0, S * .9, fs, true);
    return;
  }
}
// BACK on the ride (28.11.: "it must be obvious this is a menu and not a pause"): RIDE MENU, the line under the rows says the ride goes on
// ("Riding 12:34, 180 W", green; "Paused 12:34", orange); Back to ride (Resume when paused), Finish & save, Discard (with a confirm step)
function drawTEnd(dc, F, S, P) {
  const R = F.tr, run = R && R.st === 'run', a = R ? (run ? 'Riding ' : 'Paused ') + clock(R.t) : '';
  list(dc, F, S, P, listItems(F), F.tConf ? 'DISCARD RIDE?' : 'RIDE MENU', F.tConf ? 'DISCARD?' : 'MENU', true, null, null, R ? [[a + ', ' + R.tgt + ' W|' + a, run ? P.good : P.acc, false]] : []);
}
/* ---- 27.11.4: the summary after a trainer ride, one question per page (js/watchflow.js tsPages; F.sel = the page): what did I do (ov),
 *      did I hit the targets, did I fade (iv: a workout), how hard was it for my body (hr), what were my numbers (pw, the last: DONE).
 *      The page dots on the left as on the ride; UP / DOWN page, START / BACK done ---- */
function drawTSum(dc, F, S, P) {
  const s = F.tsum; if (!s) return;
  const pg = tsPages(F), n = pg.length, i = F.sel % n, id = pg[i], last = i === n - 1;
  pageDots(dc, S, P, n, i);
  if (id === 'iv') tsIv(dc, S, P, s, last); else if (id === 'hr') tsHr(dc, S, P, s, last); else if (id === 'pw') tsPw(dc, S, P, s, last); else tsOver(dc, S, P, s, last);
}
/** a page's title (XTINY, the accent) at the top; its ink bottom */
function tsHead(dc, S, P, t) { const y = downTo(dc, XT, t.split('|')[0], S * .13 > up(dc, XT) + S * .09 ? S * .13 : up(dc, XT) + S * .09, R0); put(dc, S / 2, y, XT, t, S, P.acc, false, R0); return y + dn(dc, XT, 'G'); }
/** the last page's DONE at the bottom (a tap on it: done); the ink top left above it */
function tsDone(dc, S, P) { const y = S * .88; put(dc, S / 2, y, XT, 'DONE', S, P.lbl, false, R0); return y - up(dc, XT) - gap(S); }
/** a difference as "+2", "-9", "0" */
const sgnTxt = d => d > 0 ? '+' + d : String(d);
/** the units ridden (sets, else intervals: uw > 0) */
function tsUnits(s) { const r = [], uw = s.uw || []; for (let u = 0; u < uw.length; u++) if (uw[u] > 0) r.push(u); return r; }
/** row j of k over the n units ridden U: its first and last index in U (k runs as even as whole units allow) */
const tsFrom = (n, k, j) => T(j * n / k);
/** the row's label: "SET 2", "SET 1-2", "#3", "1-13" */
function tsLab(U, a, b, sets) { return (sets ? 'SET ' : (a === b ? '#' : '')) + (U[a] + 1) + (a === b ? '' : '-' + (U[b] + 1)); }
/** 27.11.4: a small table in XTINY: a header row hh (or null, the label colour) and the rows [a (labels), b, d] (b in fg, d in cl[j]); the
 *  columns as wide as their widest text, the numbers right-aligned, the table centred, the rows from top; the ink bottom, -1 where a row
 *  does not fit above bot or inside the circle (at most 0.8 S wide: clear of the page dots) */
function tsTab(dc, S, P, hh, a, b, d, cl, top, bot, draw) {
  const G = gap(S), sp = S * .05, rh = inkH(dc, XT) + G, n = a.length + (hh ? 1 : 0), w = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const j = hh ? k - 1 : k, r = j < 0 ? hh : [a[j], b[j], d[j]];
    for (let q = 0; q < 3; q++) { const x = dc.getTextWidthInPixels(r[q], XT); if (x > w[q]) w[q] = x; }
  }
  const tw = w[0] + w[1] + w[2] + 2 * sp, x0 = S / 2 - tw / 2, y0 = top + up(dc, XT);
  for (let k = 0; k < n; k++) { const y = y0 + k * rh; if (y + dn(dc, XT, 'g') > bot || tw > roomC(dc, S / 2, y, XT, 'g', R0) || tw > S * .8) return -1; }
  if (draw) {
    for (let k = 0; k < n; k++) {
      const j = hh ? k - 1 : k, r = j < 0 ? hh : [a[j], b[j], d[j]], y = y0 + k * rh, x1 = x0 + w[0] + sp + w[1], x2 = x0 + tw;
      txtL(dc, x0, y, XT, r[0], P.lbl); txtL(dc, x1 - dc.getTextWidthInPixels(r[1], XT), y, XT, r[1], j < 0 ? P.lbl : P.fg);
      txtL(dc, x2 - dc.getTextWidthInPixels(r[2], XT), y, XT, r[2], j < 0 ? P.lbl : cl[j]);
    }
  }
  return y0 + (n - 1) * rh + dn(dc, XT, 'g');
}
/** the lowest top (not above lo) from which that table fits above bot and inside the circle (the round screen is narrow at the bottom:
 *  it moves up a gap at a time), -1 when none */
function tsFit(dc, S, P, hh, a, b, d, cl, lo, bot) {
  const G = gap(S), n = a.length + (hh ? 1 : 0);
  for (let tt = bot - n * (inkH(dc, XT) + G) + G; tt >= lo; tt -= G) if (tsTab(dc, S, P, hh, a, b, d, cl, tt, bot, false) >= 0) return tt;
  return -1;
}
/** 1. what did I do: SAVED, the workout's name (or Free ride), the ride's time big, how much of the workout was done (all: green), average
 *  power and kJ. Where it does not fit: the numbers' font shrinks, then the time's, then the name goes */
function tsOver(dc, S, P, s, last) {
  const c = S / 2, bot = last ? tsDone(dc, S, P) : S * .9, ct = clock(s.t), wk = s.wt > 0, nm = wk ? s.wn : 'Free ride';
  const sf = byInk(dc, [SM, XT], S * .1), sy = S * .15 > up(dc, sf) + S * .1 ? S * .15 : up(dc, sf) + S * .1; put(dc, c, sy, sf, 'SAVED', S, P.acc, false, R0);
  let ln = '', lc = P.good;
  if (wk && s.ivN > 0) { const a = s.ivD + '/' + s.ivN; ln = (s.uS ? a + ' INTERVALS, ' + s.uD + '/' + s.uN + ' SETS|' : '') + a + ' INTERVALS|' + a; lc = s.ivD >= s.ivN ? P.good : P.acc; }
  else if (wk) { const p = Math.round(100 * s.wd / s.wt); ln = p + '% OF THE WORKOUT|' + p + '%'; lc = p >= 100 ? P.good : P.acc; }
  const v = [String(s.avgPw), '', String(s.kj)], l = ['AVG W', '', 'KJ'], FS3 = [[NME, ME, SM, XT], [ME, SM, XT], [SM, XT]];
  for (let q = 0; q < 9; q++) {
    const lvl = T(q / 3), fs = FS3[q % 3], nmOn = lvl < 2, nf = byInk(dc, [SM, XT], S * .1), ny = below(dc, sy + dn(dc, sf, 'S'), nf, 0);
    const nb = nmOn ? ny + dn(dc, nf, nm) : sy + dn(dc, sf, 'S'), tf = topFont(dc, ct, lvl < 1 ? [NME, NMI, ME] : [NMI, ME, SM], T(S * .8), lvl < 1 ? S * .2 : S * .13, nb, S * .4);
    const ty = below(dc, nb, tf, S * .4); let yb = ty + dn(dc, tf, '0'), ly = 0;
    if (ln.length > 0) { ly = below(dc, yb, XT, 0); yb = ly + dn(dc, XT, 'g'); }
    if (cols(dc, S, P, v, l, yb, S * .66, bot, fs, false) < 0 && q < 8) continue;
    if (nmOn) put(dc, c, ny, nf, nm, T(S * .8), P.fg, true, R0);
    txt(dc, c, ty, tf, ct, P.fg);
    if (ln.length > 0) put(dc, c, ly, XT, ln, T(S * .8), lc, false, R0);
    cols(dc, S, P, v, l, yb, S * .66, bot, fs, true);
    return;
  }
}
/** 2. did I hit the targets, did I fade: one bar per interval (height = the watts ridden without the ramp seconds, the white line = the
 *  target, a gap between sets, the last one grey when the ride ended inside it), under it per set (else per interval) the average watts
 *  and the difference to the target (green: at most 5 W under). More than four: runs of them ("SET 1-2", "1-13"); where the rows do not
 *  fit, fewer runs, then none */
function tsIv(dc, S, P, s, last) {
  const G = gap(S), top = tsHead(dc, S, P, 'INTERVALS') + 2 * G, bot = last ? tsDone(dc, S, P) : S * .9, U = tsUnits(s), nu = U.length, sets = s.uS === true;
  for (let k = nu < 4 ? nu : 4; k >= 0; k--) {
    const a = [], b = [], d = [], cl = [];
    for (let j = 0; j < k; j++) {
      const f = tsFrom(nu, k, j), t = tsFrom(nu, k, j + 1) - 1; let w = 0, g = 0;
      for (let q = f; q <= t; q++) { w += s.uw[U[q]]; g += s.ut[U[q]]; }
      w = Math.round(w / (t - f + 1)); g = Math.round(g / (t - f + 1));
      a.push(tsLab(U, f, t, sets)); b.push(w + ' W'); d.push(sgnTxt(w - g)); cl.push(w - g >= -5 ? P.good : P.bad);
    }
    const rt = k > 0 ? tsFit(dc, S, P, null, a, b, d, cl, top + S * .14 + 2 * G, bot) : bot, cb = rt - 2 * G;
    if (rt < 0) continue;
    tsBars(dc, S, P, s, top, k > 0 ? cb : bot);
    if (k > 0) tsTab(dc, S, P, null, a, b, d, cl, rt, bot, true);
    return;
  }
}
/** the intervals' bars between top and bot inside the circle (0.42 S): the scale from a little under the lowest watts / target to the
 *  highest (a fade of a few percent shows); too many for 2 px each: neighbours averaged into one bar, no set gaps */
function tsBars(dc, S, P, s, top, bot) {
  const iw = s.iw, it = s.it, iu = s.iu, n = iw.length, c = S / 2; if (n === 0 || bot - top < 4) return;
  const hw = half(S, top, bot, .42), W = 2 * hw, ug = pw(S * .02), part = n > s.ivD; let ng = 0;
  if (s.uS === true) for (let k = 1; k < n; k++) if (iu[k] !== iu[k - 1]) ng++;
  let m = 1, nb = n, slot = (W - ng * ug) / n;
  if (slot < 2) { m = T(2 * n / W) + 1; nb = T((n + m - 1) / m); ng = 0; slot = W / nb; }
  let mn = 99999, mx = 0;
  for (let k = 0; k < n; k++) { const a = iw[k], b = it[k]; if (a < mn) mn = a; if (b < mn) mn = b; if (a > mx) mx = a; if (b > mx) mx = b; }
  const lo0 = mn - (mx - mn) * .5 - mx * .05, lo = lo0 > 0 ? lo0 : 0, hi = mx + mx * .02 + 1, H = bot - top, bw = slot >= 3 ? slot - 1 : slot;
  let x = c - hw;
  for (let j = 0; j < nb; j++) {
    const k0 = j * m, k1 = k0 + m < n ? k0 + m : n; let a = 0, b = 0;
    for (let k = k0; k < k1; k++) { a += iw[k]; b += it[k]; }
    a = a / (k1 - k0); b = b / (k1 - k0);
    if (ng > 0 && k0 > 0 && iu[k0] !== iu[k0 - 1]) x += ug;
    const ha0 = (a - lo) / (hi - lo) * H, ha = ha0 > 2 ? ha0 : 2, hb = (b - lo) / (hi - lo) * H;
    dc.setColor(part && k1 === n ? P.dim : P.acc); dc.fillRectangle(x, bot - ha, bw, ha);
    dc.setColor(P.fg); dc.fillRectangle(x, bot - hb - 1, slot, 2);
    x += slot;
  }
}
/** 3. how hard was it for my body: average and max heart rate; the time in the five zones (only with the profile's zones: grey, blue,
 *  green, orange, red, the share under each) or else the heart rate over the ride; per set (else per interval) its peak and the recovery
 *  (the drop in the 60 s after it). No heart rate: one line. Where it does not fit: fewer rows (at least two), then the zones / the curve
 *  go, then the rows */
function tsHr(dc, S, P, s, last) {
  const c = S / 2, G = gap(S), top = tsHead(dc, S, P, 'HEART RATE|HR'), bot = last ? tsDone(dc, S, P) : S * .9;
  if (!(s.hr > 0)) {
    dc.setColor(P.faint); dc.fillCircle(c, S * .38, S * .09); heart(dc, c, S * .38, S * .1, P.dim);
    const f = byInk(dc, [SM, XT], S * .1), y = below(dc, S * .47, f, S * .58); put(dc, c, y, f, 'No heart rate|No HR', S, P.fg, false, R0);
    const y1 = below(dc, y + dn(dc, f, 'g'), XT, 0); if (y1 + dn(dc, XT, 'g') <= bot) put(dc, c, y1, XT, 'recorded', S, P.lbl, false, R0);
    return;
  }
  const v = [String(s.hr), '', String(s.maxHr)], l = ['AVG', '', 'MAX'], U = tsUnits(s), nu = U.length, zs = s.zs, hs = s.hs || [];
  const cb = cols(dc, S, P, v, l, top, S * .27, bot, [NMI, ME, SM, XT], false), mt = (cb < 0 ? top : cb) + 2 * G;
  if (cb >= 0) cols(dc, S, P, v, l, top, S * .27, bot, [NMI, ME, SM, XT], true);
  let zt = 0, hn = 0;
  if (zs) for (let k = 0; k < 5; k++) zt += zs[k];
  for (let k = 0; k < hs.length; k++) if (hs[k] > 0) hn++;
  const ex = zt > 0 || hn >= 2, kx = nu < 3 ? nu : 3, km = nu < 2 ? nu : 2, xh = zt > 0 ? S * .07 + G + inkH(dc, XT) : S * .1;
  // the tries in order: [rows, with the zones / curve]
  const tries = [];
  if (ex) for (let k = kx; k >= km && k > 0; k--) tries.push([k, 1]);
  for (let k = kx; k >= km && k > 0; k--) tries.push([k, 0]);
  if (ex) tries.push([0, 1]);
  for (let k = km - 1; k > 0; k--) tries.push([k, 0]);
  for (let q = 0; q < tries.length; q++) {
    const k = tries[q][0], on = tries[q][1] === 1, a = [], b = [], d = [];
    for (let j = 0; j < k; j++) {
      const f = tsFrom(nu, k, j), t = tsFrom(nu, k, j + 1) - 1; let pk = 0, rs = 0, rn = 0;
      for (let i = f; i <= t; i++) { const u = U[i]; if (s.uhp[u] > pk) pk = s.uhp[u]; if (s.urec[u] !== REC_NONE) { rs += s.urec[u]; rn++; } }
      const r = rn > 0 ? Math.round(rs / rn) : 0;
      a.push(tsLab(U, f, t, s.uS === true)); b.push(pk > 0 ? String(pk) : '--'); d.push(rn === 0 ? '--' : (r > 0 ? '-' + r : (r < 0 ? '+' + (-r) : '0')));
    }
    const hh = ['', 'PEAK', 'REC'], cl = [P.fg, P.fg, P.fg, P.fg];
    let tt = k > 0 ? tsFit(dc, S, P, hh, a, b, d, cl, on ? mt + xh + 2 * G : mt, bot) : bot;
    if (k > 0 && !on && tsTab(dc, S, P, hh, a, b, d, cl, mt, bot, false) >= 0) tt = mt; // alone: right under the numbers
    const xb = k > 0 ? tt - 2 * G : (bot < S * .82 ? bot : S * .82); // alone: not down into the narrow bottom of the round screen
    if (tt < 0 || (on && xb - mt < xh)) continue;
    if (on) { if (zt > 0) tsZones(dc, S, P, zs, mt, xb); else tsCurve(dc, S, P, hs, mt, xb); }
    if (k > 0) tsTab(dc, S, P, hh, a, b, d, cl, tt, bot, true);
    return;
  }
}
/** the five zones as bars between top and bot (the share under each, "%" where it fits), the zone colours */
function tsZones(dc, S, P, zs, top, bot) {
  const c = S / 2, G = gap(S), ly = bot - dn(dc, XT, '0'), bb = ly - up(dc, XT) - G, H = bb - top, cl = [P.dim, P.wCool, P.wRec, P.acc, P.bad];
  let zt = 0, mx = 1;
  for (let k = 0; k < 5; k++) { zt += zs[k]; if (zs[k] > mx) mx = zs[k]; }
  const hw = half(S, top, bot, R0) - S * .04, sl = 2 * hw / 5, bw = sl * .6; let pc = 2; // the shares with "%", without, none (font size setting)
  for (let k = 0; k < 5; k++) { const p = String(Math.round(100 * zs[k] / zt)); if (dc.getTextWidthInPixels(p + '%', XT) > sl - 2 && pc > 1) pc = 1; if (dc.getTextWidthInPixels(p, XT) > sl - 2) pc = 0; }
  for (let k = 0; k < 5; k++) {
    const x = c - hw + sl * k + sl / 2, h0 = H * zs[k] / mx, h = h0 > 2 ? h0 : 2, p = Math.round(100 * zs[k] / zt);
    dc.setColor(cl[k]); dc.fillRectangle(x - bw / 2, bb - h, bw, h);
    if (pc > 0) txt(dc, x, ly, XT, p + (pc > 1 ? '%' : ''), P.lbl);
  }
}
/** the heart rate over the ride (the upload's series, one value per 10 s or more; 0 = none: a gap) between top and bot */
function tsCurve(dc, S, P, hs, top, bot) {
  const c = S / 2, n = hs.length, hw = half(S, top, bot, .42); let mn = 999, mx = 0;
  for (let k = 0; k < n; k++) { const h = hs[k]; if (h > 0 && h < mn) mn = h; if (h > mx) mx = h; }
  if (mx <= 0 || n < 2) return;
  const lo = mn - 5, H = bot - top, sc = H / (mx + 5 - lo), dx = 2 * hw / (n - 1);
  dc.setColor(P.hr); dc.setPenWidth(pw(S * .01));
  for (let k = 1; k < n; k++) { const a = hs[k - 1], b = hs[k]; if (a > 0 && b > 0) dc.drawLine(c - hw + (k - 1) * dx, bot - (a - lo) * sc, c - hw + k * dx, bot - (b - lo) * sc); }
  dc.setPenWidth(1);
}
/** 4. what were my numbers: NP, max power, average cadence; the best 30 s, 1 min, 5 min (those the ride was long enough for); DONE.
 *  Where it does not fit: the numbers' font shrinks, then the best row goes */
function tsPw(dc, S, P, s, last) {
  const c = S / 2, G = gap(S), top = tsHead(dc, S, P, 'POWER'), bot = last ? tsDone(dc, S, P) : S * .9;
  const v1 = [orDash(s.np), String(s.maxPw), orDash(s.cad)], l1 = ['NP', 'MAX W', 'RPM'], two = s.b30 > 0;
  // the best row: three columns, two the outer ones, one the middle (a ride of 30 s .. 5 min)
  const v2 = s.b300 > 0 ? [String(s.b30), String(s.b60), String(s.b300)] : (s.b60 > 0 ? [String(s.b30), '', String(s.b60)] : ['', String(s.b30), '']);
  const l2 = s.b300 > 0 ? ['30 S', '1 MIN', '5 MIN'] : (s.b60 > 0 ? ['30 S', '', '1 MIN'] : ['', '30 S', '']);
  const lo = bot - 2 * G; // the best row not right on DONE
  const FS3 = [[ME, SM, XT], [SM, XT], [XT]];
  for (let q = 0; q < 6; q++) {
    const fs = FS3[q % 3], on = two && q < 3, b1 = cols(dc, S, P, v1, l1, top, S * .3, bot, fs, false), by = b1 < 0 ? 0 : below(dc, b1 + G, XT, S * .56);
    const b2 = on && b1 >= 0 ? cols(dc, S, P, v2, l2, by + dn(dc, XT, 'B'), 0, lo, fs, false) : 0;
    if ((b1 < 0 || b2 < 0) && q < 5) continue;
    cols(dc, S, P, v1, l1, top, S * .3, bot, fs, true);
    if (on) { put(dc, c, by, XT, 'BEST', S, P.acc, false, R0); cols(dc, S, P, v2, l2, by + dn(dc, XT, 'B'), 0, lo, fs, true); }
    return;
  }
}
const distTxt = m => m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
// the segment popup: warning before, live delta against the PR, the result for 5 s (inside the ring)
function segScreen(dc, F, S, P, g) {
  const c = S / 2, k = g.k, len = +g.len || 0, name = String(g.name || ''), r = c - T(S * .03), ri = .5 - .03 - .015 - .015, G = gap(S);
  if (k === 'warn') {
    dc.setColor(P.acc); dc.setPenWidth(pw(S * .03)); dc.drawCircle(c, c, r); dc.setPenWidth(1);
    const a = byInk(dc, [SM, XT], S * .1), ay = S * .22; put(dc, c, ay, a, 'SEGMENT IN', S, P.acc, false, ri);
    const pr = g.pr | 0, t = distTxt(len) + (pr > 0 ? ', PR ' + clock(pr) + '|' + distTxt(len) : ''), nf = byInk(dc, [SM, XT], S * .1);
    const ty = S * .74, ny = above(dc, ty - up(dc, XT), nf, name, S * .62);
    put(dc, c, ty, XT, t, T(S * .7), P.lbl, false, ri); put(dc, c, ny, nf, name, T(S * .74), P.fg, true, ri);
    const ct = clock(Math.max(0, g.eta | 0)), top = ay + dn(dc, a, 'G') + G, bot = ny - up(dc, nf) - G, f = numIn(dc, [ct], [NHO, NME, NMI, ME], [T(S * .8)], [c], top, bot, ri);
    txt(dc, c, numY(dc, f, top, bot), f, ct, P.fg);
    return;
  }
  if (k === 'live') {
    const done = +g.done || 0, delta = g.delta | 0, ahead = delta <= 0, col = ahead ? P.good : P.bad; let part = len > 0 ? done / len : 0; if (part > 1) part = 1;
    dc.setPenWidth(pw(S * .03)); dc.setColor(P.faint); dc.drawCircle(c, c, r);
    if (part > 0) { dc.setColor(P.acc); if (part >= .999) dc.drawCircle(c, c, r); else dc.drawArc(c, c, r, ARC_CW, 90, 90 - T(part * 360)); }
    dc.setPenWidth(1);
    const ny = S * .17 > up(dc, XT) + S * .1 ? S * .17 : up(dc, XT) + S * .1; put(dc, c, ny, XT, name, T(S * .6), P.fg, true, ri);
    const left = len - done, gt = distTxt(left > 0 ? left : 0) + ' to go|' + distTxt(left > 0 ? left : 0), gy = S * .8; put(dc, c, gy, XT, gt, S, P.lbl, false, ri);
    const ref = g.ref == null ? 'PR' : g.ref, top = ny + dn(dc, XT, name) + G;
    let bot = gy - up(dc, XT) - G, big = '', bc = P.fg, l1 = '', l1c = P.lbl, l2 = '', l3 = '';
    if (ref.length === 0) { big = clock(g.time | 0); l1 = 'NO TIME TO BEAT'; }
    else {
      big = clock(ahead ? -delta : delta); bc = col; l1 = (ahead ? 'AHEAD OF ' : 'BEHIND ') + ref; l1c = col;
      const need = +g.need || 0;
      if (need > 0) { l2 = 'Need ' + (F.sp === 'ride' ? (need * 3.6).toFixed(1) + ' km/h' : pace(1000 / need, 1000) + ' /km'); l3 = 'FOR ' + ref; }
      else l2 = ref + ' out of reach';
    }
    // from the bottom: FOR KOM, Need ..., then the big delta and its line in the rest
    const f2 = byInk(dc, [SM, XT], S * .1);
    if (l3.length > 0) { const y3 = above(dc, bot, XT, l3, S * .7); put(dc, c, y3, XT, l3, S, P.lbl, false, ri); bot = y3 - up(dc, XT) - G; }
    if (l2.length > 0) { const y2 = above(dc, bot, f2, l2, S * .63); put(dc, c, y2, f2, l2, T(S * .76), l3.length > 0 ? P.fg : P.lbl, false, ri); bot = y2 - up(dc, f2) - G; }
    const y1 = above(dc, bot, XT, l1, S * .505); put(dc, c, y1, XT, l1, S, l1c, false, ri); bot = y1 - up(dc, XT) - G;
    // the sign in a text font (the fenix 7's number fonts have digits only)
    const sg = ref.length === 0 ? '' : (ahead ? '-' : '+'), sw = sg.length > 0 ? dc.getTextWidthInPixels(sg, LA) + 2 : 0;
    const f = numIn(dc, [big], [NHO, NME, NMI, ME], [T(S * .8) - sw], [c + sw / 2], top, bot, ri), bw = dc.getTextWidthInPixels(big, f), by = numY(dc, f, top, bot), bx = c - (bw + sw) / 2;
    dc.setColor(bc); if (sw > 0) dc.drawText(bx, by, LA, sg, VL); dc.drawText(bx + sw, by, f, big, VL);
    return;
  }
  const pr2 = g.pr === true, dl = g.delta | 0, col2 = pr2 || dl <= 0 ? P.good : P.bad, ink = pr2 ? P.ink : P.fg;
  if (pr2) { dc.setColor(col2); dc.fillCircle(c, c, c); }
  const a = byInk(dc, [SM, XT], S * .1), ay = S * .2 > up(dc, a) + S * .1 ? S * .2 : up(dc, a) + S * .1; put(dc, c, ay, a, pr2 ? 'NEW PR' : 'SEGMENT DONE', S, pr2 ? ink : P.acc, false, R0);
  const ny = below(dc, ay + dn(dc, a, 'G'), XT, S * .3); put(dc, c, ny, XT, name, T(S * .66), ink, true, R0);
  const ref2 = g.ref == null ? 'PR' : g.ref, vt = (dl <= 0 ? '-' : '+') + clock(dl < 0 ? -dl : dl) + ' vs ' + ref2;
  let bot = S * .82;
  if (ref2.length > 0) { const vf = fontIn(dc, vt, [ME, SM, XT], T(S * .7), S * .12), vy = above(dc, S * .82, vf, vt, S * .7); put(dc, c, vy, vf, vt, S, pr2 ? ink : col2, false, R0); bot = vy - up(dc, vf) - G; }
  const top = ny + dn(dc, XT, name) + G, ct = clock(g.time | 0), f = numIn(dc, [ct], [NHO, NME, NMI, ME], [T(S * .8)], [c], top, bot, R0);
  txt(dc, c, numY(dc, f, top, bot), f, ct, ink);
}
// the route page: next turn on top, the line with the position dot, the distance left at the bottom
function routePage(dc, F, S, P) {
  const r = F.route, ri = routeInfo(F), G = gap(S); if (!r || !ri) return;
  let tb = S * .25;
  if (ri.off > 0) { const f = byInk(dc, [SM, XT], S * .1), y = S * .165 > up(dc, f) + S * .1 ? S * .165 : up(dc, f) + S * .1; put(dc, c0(S), y, f, 'OFF ROUTE', S, P.bad, false, R0); const y2 = below(dc, y + dn(dc, f, 'O'), XT, S * .235); put(dc, c0(S), y2, XT, distTxt(ri.off) + ' away', S, P.fg, false, R0); tb = y2 + dn(dc, XT, 'y'); }
  else if (ri.turn) {
    const tn = ri.turn; turnArrow(dc, S * .28, S * .2, S * .08, tn.dir === 'L', P.acc);
    const d = tn.in < 1000 ? Math.round(tn.in / 10) * 10 + ' m' : (tn.in / 1000).toFixed(1) + ' km', f = byInk(dc, [ME, SM, XT], S * .1), y = S * .175 > up(dc, f) + S * .1 ? S * .175 : up(dc, f) + S * .1;
    putL(dc, S * .37, y, f, d, T(S * .42), P.fg, false, R0);
    const tt = tn.txt || (tn.dir === 'L' ? 'Turn left' : 'Turn right'), y2 = below(dc, y + dn(dc, f, 'm'), XT, S * .245);
    putL(dc, S * .37, y2, XT, tt, T(S * .45), P.lbl, true, R0); tb = y2 + dn(dc, XT, tt);
  } else { const y = S * .2; put(dc, c0(S), y, XT, 'FINISH AHEAD', S, P.acc, false, R0); tb = y + dn(dc, XT, 'F'); }
  // the bottom: the km left, TO FINISH where there is room
  const kf = byInk(dc, [ME, SM, XT], S * .1), km = kmTxt(ri.left), w = dc.getTextWidthInPixels(km, kf), uw = S * .07;
  const fy = S * .885, ft = pick(dc, 'TO FINISH|TO GO', XT, roomC(dc, S / 2, fy, XT, 'T', R0), false), two = fy - up(dc, XT) - G - inkH(dc, kf) > S * .7 && dc.getTextWidthInPixels(ft, XT) <= roomC(dc, S / 2, fy, XT, 'T', R0), ky = two ? above(dc, fy - up(dc, XT), kf, '0', S * .79) : S * .82, x = S / 2 - (w + uw) / 2;
  txtL(dc, x, ky, kf, km, P.fg);
  const base = ky - dc.getFontHeight(kf) / 2 + asc(dc, kf); txtL(dc, x + w + S * .015, base - asc(dc, XT) + dc.getFontHeight(XT) / 2, XT, 'km', P.lbl);
  if (two) put(dc, c0(S), fy, XT, ft, S, P.lbl, false, R0);
  // the route in the box between
  const bx = S * .2, bw = S * .6, by = tb + G + S * .03, bh = ky - up(dc, kf) - G - S * .03 - by, pts = r.pts, n = pts.length; if (n < 2 || bh < S * .1) return;
  const X = q => bx + q[0] * bw, Y = q => by + q[1] * bh; let tot = 0; const seg = [];
  for (let k = 1; k < n; k++) { const l = Math.hypot(X(pts[k]) - X(pts[k - 1]), Y(pts[k]) - Y(pts[k - 1])); seg.push(l); tot += l; }
  dc.setColor(P.path); dc.setPenWidth(pw(S * .014)); for (let k = 1; k < n; k++) dc.drawLine(X(pts[k - 1]), Y(pts[k - 1]), X(pts[k]), Y(pts[k]));
  const to = ri.pos * tot; let acc = 0, ax = X(pts[0]), ay = Y(pts[0]);
  dc.setColor(P.acc); dc.setPenWidth(pw(S * .022));
  for (let k = 1; k < n; k++) { const l = seg[k - 1], x0 = X(pts[k - 1]), y0 = Y(pts[k - 1]), x1 = X(pts[k]), y1 = Y(pts[k]);
    if (acc + l >= to) { const f = l > 0 ? (to - acc) / l : 0; ax = x0 + (x1 - x0) * f; ay = y0 + (y1 - y0) * f; dc.drawLine(x0, y0, ax, ay); break; }
    dc.drawLine(x0, y0, x1, y1); acc += l; ax = x1; ay = y1; }
  dc.setPenWidth(1);
  const fx = X(pts[n - 1]), fy2 = Y(pts[n - 1]); dc.setColor(P.fg); dc.fillRectangle(fx - S * .016, fy2 - S * .016, S * .032, S * .032);
  dc.setColor(P.acc); dc.fillCircle(ax, ay, S * .034); dc.setColor(P.fg); dc.fillCircle(ax, ay, S * .019);
}
const c0 = S => S / 2;
function turnArrow(dc, x, y, s, left, col) {
  const k = left ? -1 : 1; dc.setColor(col); dc.setPenWidth(pw(s * .3));
  dc.drawLine(x - k * s * .3, y + s * .9, x - k * s * .3, y - s * .1); dc.drawLine(x - k * s * .3, y - s * .1, x - k * s * .05, y - s * .4); dc.drawLine(x - k * s * .05, y - s * .4, x + k * s * .2, y - s * .4);
  dc.setPenWidth(1); dc.fillPolygon([[x + k * s * .8, y - s * .4], [x + k * s * .2, y - s * .95], [x + k * s * .2, y + s * .15]]);
}
/** the glance loop as the watch face shows it: neighbours dimmed, ours in the middle; the middle row's texts as Glance.mc draws them in
 *  its own dc (here a 0.6 x 0.26 S box from x 0.33 S) */
function drawGlance(dc, S, P, sum) {
  dc.setColor(P.faint); dc.fillRoundedRectangle(S * .08, S * .1, S * .84, S * .14, S * .04); dc.fillRoundedRectangle(S * .08, S * .76, S * .84, S * .14, S * .04);
  dc.setColor(P.acc); dc.fillCircle(S * .2, S * .5, S * .085); dumbbell(dc, S * .2, S * .5, S * .1, P.ink);
  glance(dc, S * .33, S * .37, T(S * .58), T(S * .26), P, sum);
}
/** Glance.mc onUpdate in a box (x, y, w, h): RIDEFRAME, the points (SMALL, else XTINY), the change (with "vs last week" where it fits) */
export function glance(dc, x, y, w, h, P, sum) {
  const G = gap(dc.getWidth()), tf = XT, ty = y + up(dc, tf) + 1;
  dc.setColor(P.dim); dc.drawText(x, ty, tf, 'RIDEFRAME', VL);
  const vy0 = ty + dn(dc, tf, 'R') + G;
  if (!sum || sum.pts == null) { const f = byInk(dc, [SM, XT], y + h - vy0); dc.setColor(P.fg); dc.drawText(x, vy0 + up(dc, f), f, 'Strength', VL); return; }
  const pts = Math.round(sum.pts) + ' pts', d = Math.round(sum.delta || 0), ad = d < 0 ? -d : d;
  const f = byInk(dc, [SM, XT], y + h - vy0), vy = vy0 + up(dc, f), pw0 = dc.getTextWidthInPixels(pts, f);
  dc.setColor(P.fg); dc.drawText(x, vy, f, pts, VL);
  const t = dc.getFontHeight(XT) * .25, x1 = x + pw0 + 8, room = w - (pw0 + 8 + 2 * t + 4);
  const dt = dc.getTextWidthInPixels(ad + ' vs last week', XT) <= room ? ad + ' vs last week' : String(ad);
  if (dc.getTextWidthInPixels(dt, XT) > room) return;
  dc.setColor(P.acc); dc.fillPolygon(d >= 0 ? [[x1, vy + t], [x1 + 2 * t, vy + t], [x1 + t, vy - t]] : [[x1, vy - t], [x1 + 2 * t, vy - t], [x1 + t, vy + t]]);
  dc.drawText(x1 + 2 * t + 4, vy, XT, dt, VL);
}
