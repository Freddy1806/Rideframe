// RIDEFRAME on a Garmin watch: drawing of every screen with the plain dc calls, scaled by the screen size (S = dc.getWidth()).
// 23.11.8: js/watchscreens.js is this file in JavaScript, function by function, with the same numbers (tools/watch-layout-test.mjs
// compares the fractional numbers of both files per function). The layout comes from the watch's own fonts: every text gets its rows
// from the font's box (dc.getFontHeight, Graphics.getFontAscent), a font falls back to the next smaller one where it does not fit its
// room (width, rows, the round screen), and a line without room is left out (in the order given per screen), so the fenix 8's font
// size setting (up to 1.45) never makes texts overlap. tools/watch-layout.mjs checks every screen on the five watches with the real fonts.
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;

// AMOLED (fr265: the touch face) or MIP (fenix: 64 colours)
function isAmoled() as Boolean {
    var ds = System.getDeviceSettings();
    // VERIFY: DeviceSettings.requiresBurnInProtection (API 3.0) is true on AMOLED watches (doc page Toybox.System.DeviceSettings)
    return (ds has :requiresBurnInProtection) && ds.requiresBurnInProtection;
}
// 23.11.: a touchscreen (fr265, fenix 7 Pro / 7X Pro, fenix 8: all of them), not AMOLED, decides the touch-only parts (the "Hold to
// finish" pill)
function hasTouch() as Boolean {
    var ds = System.getDeviceSettings();
    // VERIFY (Toybox.System.DeviceSettings.isTouchScreen, API 1.0): true on the fenix 8 Solar 47 mm (and stays true with touch locked)
    return (ds has :isTouchScreen) && ds.isTouchScreen;
}
class Palette {
    var fg as Number; var dim as Number; var faint as Number; var acc as Number; var ink as Number; var hr as Number;
    var lbl as Number; var line as Number; var good as Number; var bad as Number; var far as Number; var path as Number;
    var cRun as Number; var cRide as Number; var cKraft as Number; var cOther as Number;
    var wWarm as Number; var wRec as Number; var wCool as Number;   // 28.11.: the workout builder's step colours (work = acc)
    var mip as Boolean;
    function initialize() {
        var amoled = isAmoled();
        mip = !amoled;
        if (amoled) {
            fg = 0xF4F4EF; dim = 0x8B8B85; faint = 0x2C2C2A; ink = 0x0B0B0B; hr = 0xFF5A5A; lbl = 0xA3A39C; line = 0x3A3A37; good = 0x3DDC84; bad = 0xFF5A5A;
            far = faint; path = 0x6A6A66; cRun = 0xFF5A1F; cRide = 0xFF5A1F; cKraft = 0xFF5A1F; cOther = 0xFF5A1F; // orange is the one accent everywhere
        } else {
            fg = 0xFFFFFF; dim = 0xAAAAAA; faint = 0x555555; ink = 0x000000; hr = 0xFF5555; lbl = 0xFFFFFF; line = 0x555555; good = 0x55FF55; bad = 0xFF5555;
            far = dim; path = dim; cRun = 0xFF5500; cRide = 0xFF5500; cKraft = 0xFF5500; cOther = 0xFF5500;
        }
        acc = cKraft;
        // 28.11.: js/myworkouts.js STEP_TYPES (warm-up #f2b630, recover #2fb36b, cool-down #2f8fe0); MIP: the nearest of the 64 colours
        wWarm = amoled ? 0xF2B630 : 0xFFAA00; wRec = amoled ? 0x2FB36B : 0x00AA55; wCool = amoled ? 0x2F8FE0 : 0x00AAFF;
    }
}

// 23.11.8: where the screen drawn last put its rows (js/watchscreens.js LAY): the list rows [offset, y / S] (the start menu: [row, y / S]),
// the ready screen's route line (y / S, 0 = none) and the trainer's target zone (gT0 .. gT1, y / S). FlowDelegate.onTap / dragModeAt
// take them as drawn, so a tap always lands on the row the finger is on, whatever font the watch chose.
var gRows as Array = [] as Array;
var gRouteY as Float = 0.0;
var gT0 as Float = 0.0;
var gT1 as Float = 0.0;

// The screen constants (S_START ...) are globals from Flow.mc.
module Draw {
    const VC = Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
    const VL = Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER;
    const XT = Graphics.FONT_XTINY;
    const TI = Graphics.FONT_TINY;
    const SM = Graphics.FONT_SMALL;
    const ME = Graphics.FONT_MEDIUM;
    const LA = Graphics.FONT_LARGE;
    const NMI = Graphics.FONT_NUMBER_MILD;
    const NME = Graphics.FONT_NUMBER_MEDIUM;
    const NHO = Graphics.FONT_NUMBER_HOT;
    const NTH = Graphics.FONT_NUMBER_THAI_HOT;
    const R0 = 0.47;     // texts stay inside this circle (fraction of S: 0.5 - the 0.03 S margin)

    function clock(s as Number) as String {
        if (s < 0) { s = 0; }
        var h = s / 3600, m = (s % 3600) / 60, x = s % 60;
        return h > 0 ? h.toString() + ":" + m.format("%02d") + ":" + x.format("%02d") : m.toString() + ":" + x.format("%02d");
    }
    function kgTxt(kg as Float) as String {
        var r = (kg * 10.0 + 0.5).toNumber();
        return r % 10 == 0 ? (r / 10).toString() : (r / 10).toString() + "." + (r % 10).toString();
    }
    function volTxt(v as Float) as String {
        if (v >= 10000.0) { return kgTxt(v / 1000.0) + " t"; }
        return v.toNumber().toString();
    }
    function kmTxt(m as Float) as String { return (m / 1000.0).format(m >= 10000.0 ? "%.1f" : "%.2f"); }
    // text cut to fit max px (with a dot, the system fonts may have no ellipsis); a space or comma before the dot goes too
    function fit(dc as Dc, t as String, font, max) as String {
        if (dc.getTextWidthInPixels(t, font) <= max) { return t; }
        var s = t;
        while (s.length() > 1 && dc.getTextWidthInPixels(s + ".", font) > max) { s = s.substring(0, s.length() - 1) as String; }
        while (s.length() > 1 && (s.substring(s.length() - 1, s.length()).equals(" ") || s.substring(s.length() - 1, s.length()).equals(","))) { s = s.substring(0, s.length() - 1) as String; }
        return s + ".";
    }
    function txt(dc as Dc, x, y, font, t, col as Number) as Void { dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.drawText(x, y, font, t.toString(), VC); }
    function txtL(dc as Dc, x, y, font, t, col as Number) as Void { dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.drawText(x, y, font, t.toString(), VL); }
    function pill(dc as Dc, cx, cy, w, h, col as Number) as Void { dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.fillRoundedRectangle(cx - w / 2.0, cy - h / 2.0, w, h, h / 2.0); }
    function pw(n) as Number { var p = n.toNumber(); return p < 1 ? 1 : p; }
    // the arc that points at the START button (2 o'clock = 30 degrees, counter-clockwise from 3 o'clock)
    function startHint(dc as Dc, S as Number, P as Palette) as Void {
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.03));
        dc.drawArc(S / 2, S / 2, S / 2 - (S * 0.02).toNumber(), Graphics.ARC_CLOCKWISE, 42, 18);
        dc.setPenWidth(1);
    }
    function tri(dc as Dc, x, y, s, up as Boolean, col as Number) as Void {
        dc.setColor(col, Graphics.COLOR_TRANSPARENT);
        var a = up ? y + s * 0.6 : y - s * 0.6, b = up ? y - s * 0.6 : y + s * 0.6;
        dc.fillPolygon([[x - s, a], [x + s, a], [x, b]]);
    }
    function dumbbell(dc as Dc, x, y, s, col as Number) as Void {
        dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(s * 0.13 + 1));
        var k = s / 24.0, L = [[3, 9, 3, 15], [6, 7, 6, 17], [18, 7, 18, 17], [21, 9, 21, 15], [6, 12, 18, 12]] as Array<Array<Number>>;
        for (var i = 0; i < L.size(); i++) { var l = L[i]; dc.drawLine(x + (l[0] - 12) * k, y + (l[1] - 12) * k, x + (l[2] - 12) * k, y + (l[3] - 12) * k); }
        dc.setPenWidth(1);
    }
    function heart(dc as Dc, x, y, s, col as Number) as Void {
        dc.setColor(col, Graphics.COLOR_TRANSPARENT);
        var r = s * 0.32; dc.fillCircle(x - r, y - r * 0.4, r); dc.fillCircle(x + r, y - r * 0.4, r);
        dc.fillPolygon([[x - 2 * r, y - r * 0.2], [x + 2 * r, y - r * 0.2], [x, y + s * 0.55]]);
    }
    // the sport icons of the start menu, drawn with lines
    function icon(dc as Dc, k as String, x, y, s, col as Number) as Void {
        if (k.equals("kraft")) { dumbbell(dc, x, y, s, col); return; }
        dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(s * 0.11 + 1));
        if (k.equals("run")) {
            dc.fillCircle(x + s * 0.12, y - s * 0.36, s * 0.1);
            dc.drawLine(x + s * 0.04, y - s * 0.2, x - s * 0.08, y + s * 0.1);
            dc.drawLine(x - s * 0.08, y + s * 0.1, x + s * 0.14, y + s * 0.42);
            dc.drawLine(x - s * 0.08, y + s * 0.1, x - s * 0.3, y + s * 0.38);
            dc.drawLine(x - s * 0.26, y - s * 0.08, x + s * 0.02, y - s * 0.16);
            dc.drawLine(x + s * 0.02, y - s * 0.16, x + s * 0.3, y - s * 0.02);
        } else if (k.equals("ride")) {
            var r = s * 0.2;
            dc.drawCircle(x - s * 0.27, y + s * 0.16, r); dc.drawCircle(x + s * 0.27, y + s * 0.16, r);
            dc.drawLine(x - s * 0.27, y + s * 0.16, x - s * 0.05, y - s * 0.16);
            dc.drawLine(x - s * 0.05, y - s * 0.16, x + s * 0.27, y + s * 0.16);
            dc.drawLine(x - s * 0.05, y - s * 0.16, x - s * 0.14, y - s * 0.3);
        } else if (k.equals("trainer")) {
            var q = s / 24.0;
            dc.drawCircle(x, y - q * 2, q * 7);
            dc.drawLine(x, y - q * 6, x, y - q * 2); dc.drawLine(x, y - q * 2, x + q * 3, y);
            dc.drawLine(x - q * 8, y + q * 8, x + q * 8, y + q * 8);
        } else {
            var r = s * 0.09;
            dc.fillCircle(x - s * 0.3, y, r); dc.fillCircle(x, y, r); dc.fillCircle(x + s * 0.3, y, r);
        }
        dc.setPenWidth(1);
    }
    // a number text in a number font when it only has digits and : . - (the fenix 7's number fonts have digits only)
    function isNum(t as String) as Boolean {
        var a = t.toCharArray();
        for (var i = 0; i < a.size(); i++) { if ("0123456789:.-".find(a[i].toString()) == null) { return false; } }
        return a.size() > 0;
    }
    // the fonts for a value of height px (fraction of S) from big to small
    function valFonts(px as Float, num as Boolean) as Array {
        if (num) {
            if (px >= 0.28) { return [NTH, NHO, NME, NMI]; }
            if (px >= 0.18) { return [NHO, NME, NMI]; }
            if (px >= 0.15) { return [NME, NMI, ME]; }
            return [NMI, ME, SM];
        }
        if (px >= 0.18) { return [LA, ME, SM]; }
        return [ME, SM, TI];
    }
    function plural(n as Number, one as String, many as String) as String { return n.toString() + " " + (n == 1 ? one : many); }

    // ---- 23.11.8: the layout from the watch's own fonts (js/watchscreens.js, same names) ----
    function gap(S) as Float { return S * 0.008 > 2 ? S * 0.008 : 2.0; }
    function hasDesc(t as String) as Boolean {
        var a = t.toCharArray();
        for (var i = 0; i < a.size(); i++) { if ("gjpqy,;()Q".find(a[i].toString()) != null) { return true; } }
        return false;
    }
    // VERIFY (Toybox.Graphics.getFontAscent, API 3.? / 1.?): the font's ascent in pixels, at the user's font size setting
    function asc(f) as Float { return Graphics.getFontAscent(f).toFloat(); }
    // the ink above the y of a VCENTER text (caps) and below it (descenders, else the baseline)
    function up(dc as Dc, f) as Float { return dc.getFontHeight(f) / 2.0 - 0.16 * asc(f); }
    function dn(dc as Dc, f, t as String) as Float {
        var h = dc.getFontHeight(f).toFloat(), a = asc(f);
        return hasDesc(t) ? a - h / 2.0 + 1.1 * (h - a) : a - h / 2.0 + 1;
    }
    // the ink height of a line with descenders
    function inkH(dc as Dc, f) as Float { return up(dc, f) + dn(dc, f, "g"); }
    // the first font whose ink is at most h px (else the last)
    function byInk(dc as Dc, fonts as Array, h) {
        for (var i = 0; i < fonts.size(); i++) { if (inkH(dc, fonts[i]) <= h) { return fonts[i]; } }
        return fonts[fonts.size() - 1];
    }
    // the first font in which t is at most w wide and whose ink is at most h (else the last)
    function fontIn(dc as Dc, t as String, fonts as Array, w, h) {
        for (var i = 0; i < fonts.size(); i++) { if (dc.getTextWidthInPixels(t, fonts[i]) <= w && up(dc, fonts[i]) + dn(dc, fonts[i], t) <= h) { return fonts[i]; } }
        return fonts[fonts.size() - 1];
    }
    // the first font whose t sits inside a pill of height ph centred on its y (else the last)
    function inPill(dc as Dc, t as String, fonts as Array, w, ph) {
        for (var i = 0; i < fonts.size(); i++) { if (dc.getTextWidthInPixels(t, fonts[i]) <= w && up(dc, fonts[i]) <= ph / 2.0 - 1 && dn(dc, fonts[i], t) <= ph / 2.0 - 1) { return fonts[i]; } }
        return fonts[fonts.size() - 1];
    }
    // half the width inside the circle of radius r (fraction of S) on the rows y0 .. y1
    function half(S, y0, y1, r) as Float {
        var c = S / 2.0, R = S * r, a = y0 - c < 0 ? c - y0 : y0 - c, b = y1 - c < 0 ? c - y1 : y1 - c, d = a > b ? a : b;
        return d >= R ? 0.0 : Math.sqrt(R * R - d * d).toFloat();
    }
    // the width a text centred on x in font f may take inside that circle
    function roomC(dc as Dc, x, y, f, t as String, r) as Number {
        var S = dc.getWidth(), h = half(S, y - up(dc, f), y + dn(dc, f, t), r) - (x > S / 2.0 ? x - S / 2.0 : S / 2.0 - x);
        return h > 0 ? (2 * h).toNumber() : 0;
    }
    // the first part of "long|shorter|short"
    function first(t as String) as String { var i = t.find("|"); return i == null ? t : t.substring(0, i) as String; }
    // the first of the variants "long|shorter|short" of t at most w wide in font f (else the last); a name (u) is never split
    function pick(dc as Dc, t as String, f, w, u as Boolean) as String {
        if (u) { return t; }
        var r = t, i = r.find("|");
        while (i != null) {
            var a = r.substring(0, i) as String;
            if (dc.getTextWidthInPixels(a, f) <= w) { return a; }
            r = r.substring(i + 1, r.length()) as String; i = r.find("|");
        }
        return r;
    }
    // t centred on (x, y) in font f, the variant that fits w and the circle r, cut to it (u: a name the user gave, may be cut)
    function put(dc as Dc, x, y, f, t as String, w, col as Number, u as Boolean, r) as Void {
        var m = roomC(dc, x, y, f, first(t), r), mm = w < m ? w : m;
        txt(dc, x, y, f, fit(dc, pick(dc, t, f, mm, u), f, mm), col);
    }
    // t from x on, the variant that fits w and the circle r, cut to it
    function putL(dc as Dc, x, y, f, t as String, w, col as Number, u as Boolean, r) as Void {
        var S = dc.getWidth(), m = (S / 2.0 + half(S, y - up(dc, f), y + dn(dc, f, t), r) - x).toNumber(), mm = w < m ? w : m;
        txtL(dc, x, y, f, fit(dc, pick(dc, t, f, mm, u), f, mm), col);
    }
    // the y (at least y0) from which a line t in font f, centred, fits inside the circle r on its upper half
    function downTo(dc as Dc, f, t as String, y0, r) as Float {
        var S = dc.getWidth(), R = S * r, hw = dc.getTextWidthInPixels(t, f) / 2.0;
        if (hw >= R) { return S / 2.0; }
        var y = S / 2.0 - Math.sqrt(R * R - hw * hw) + up(dc, f);
        return y > y0 ? y.toFloat() : y0.toFloat();
    }
    // the first font in which t, as the line below ink bottom yb (and not above y0), is at most w wide inside the circle and its ink at most h
    function topFont(dc as Dc, t as String, fonts as Array, w, h, yb, y0) {
        for (var i = 0; i < fonts.size(); i++) {
            var f = fonts[i], y = below(dc, yb, f, y0), m = roomC(dc, dc.getWidth() / 2.0, y, f, t, R0);
            if (dc.getTextWidthInPixels(t, f) <= (w < m ? w : m) && up(dc, f) + dn(dc, f, t) <= h) { return f; }
        }
        return fonts[fonts.size() - 1];
    }
    // a pill's height: h, or more where XTINY with descenders would not fit (font size setting)
    function pillH(dc as Dc, h) as Float { var k = inkH(dc, XT) + 4; return k > h ? k : h.toFloat(); }
    // a, or b when a is wider than w in font f
    function alt(dc as Dc, a as String, b as String, f, w) as String { return dc.getTextWidthInPixels(a, f) <= w ? a : b; }
    // the y of a line in font f below ink bottom yb (and not above y0)
    function below(dc as Dc, yb, f, y0) as Float { var y = yb + gap(dc.getWidth()) + up(dc, f); return y > y0 ? y : y0.toFloat(); }
    // the y of a line t in font f above ink top yt (and not below y0)
    function above(dc as Dc, yt, f, t as String, y0) as Float { var y = yt - gap(dc.getWidth()) - dn(dc, f, t); return y < y0 ? y : y0.toFloat(); }

    // ---- one function per screen ----
    function screen(dc as Dc, F as Flow, P as Palette, now as Number, sum) as Void {
        var S = dc.getWidth();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK); dc.clear();
        var s = F.scr;
        P.acc = P.cKraft;
        $.gRows = [] as Array; $.gRouteY = 0.0; $.gT0 = 0.0; $.gT1 = 0.0;
        var f = F.flash;
        if (f != null) {
            if ("lap".equals(f["k"])) { lapFlash(dc, F, S, P, f); } else { prFlash(dc, S, P, f); }
            return;
        }
        if (s == S_HOME) { drawHome(dc, F, S, P, sum); }
        else if (s == S_PICK) { drawPick(dc, F, S, P); }
        else if (s == S_SMODE) { drawSmode(dc, F, S, P); }
        else if (s == S_MORE) { drawMore(dc, F, S, P); }
        else if (s == S_MENU) { list(dc, F, S, P, F.menu, "MENU v" + RF_VERSION, "v" + RF_VERSION, true, null, null, [[gTouch, P.lbl, true]]); }
        else if (s == S_END) { drawEnd(dc, F, S, P, now); }
        else if (s == S_SAVEQ) { drawSaveq(dc, F, S, P); }
        else if (s == S_SET) { drawSet(dc, F, S, P, now); }
        else if (s == S_REST) { drawRest(dc, F, S, P, now); }
        else if (s == S_SUM) { drawSum(dc, F, S, P); }
        else if (s == S_PAIR) { drawPair(dc, F, S, P); }
        else if (s == S_READY) { drawReady(dc, F, S, P); }
        else if (s == S_REC) { drawRec(dc, F, S, P, now); }
        else if (s == S_PAUSE) { drawPause(dc, F, S, P, now); }
        else if (s == S_RSUM) { drawRsum(dc, F, S, P); }
        else if (s == S_RPICK) { drawRpick(dc, F, S, P); }
        else if (s == S_TSCAN) { drawTScan(dc, F, S, P); }
        else if (s == S_TREC) { drawTRec(dc, F, S, P, now); }
        else if (s == S_TEND) { drawTEnd(dc, F, S, P); }
        else if (s == S_TPICK) { drawTPick(dc, F, S, P); }
        else if (s == S_THR) { drawTHr(dc, F, S, P, now); }
        else if (s == S_TSUM) { drawTSum(dc, F, S, P); }
        else { drawHome(dc, F, S, P, sum); }
    }
    // RIDE in white, FRAME in the accent, moved down until it fits the circle
    function logo(dc as Dc, S as Number, y, col as Number, P as Palette) as Void {
        var c = S / 2, wR = dc.getTextWidthInPixels("RIDE", XT), wF = dc.getTextWidthInPixels("FRAME", XT), x0 = c - (wR + wF) / 2.0;
        var yy = downTo(dc, XT, "RIDEFRAME", y, R0);
        txtL(dc, x0, yy, XT, "RIDE", P.fg); txtL(dc, x0 + wR, yy, XT, "FRAME", col);
    }
    // the start menu's label: "Indoor trainer" is "Trainer" where it does not fit
    function homeLab(dc as Dc, F as Flow, k as String, f, w) as String { return k.equals("trainer") ? alt(dc, F.homeLabel(k), "Trainer", f, w) : F.homeLabel(k); }
    // the start menu: the selected entry as the orange pill (MEDIUM, else the next font that fits the pill), the week points below;
    // rows at HOME_Y0 + r * HOME_DY (gRows: the tap table in FlowDelegate.onTap)
    function drawHome(dc as Dc, F as Flow, S as Number, P as Palette, sum) as Void {
        var items = F.homeItems(), n = items.size(), c = S / 2, top = F.homeTop(n), G = gap(S), ph = S * 0.14, w = (S * 0.52).toNumber();
        logo(dc, S, S * 0.12, P.cKraft, P);
        var yb = downTo(dc, XT, "RIDEFRAME", S * 0.12, R0) + dn(dc, XT, "R");
        for (var r = 0; r < HOME_FIT; r++) {
            var i = top + r;
            if (i >= n) { break; }
            var k = items[i] as String, y = S * (HOME_Y0 + r * HOME_DY);
            if (i == F.sel) {
                pill(dc, c, y, S * 0.74, ph, P.acc); icon(dc, k, S * 0.25, y, S * 0.085, P.ink);
                var f = inPill(dc, "Ag", [ME, SM, XT], S, ph), lab = homeLab(dc, F, k, f, w);
                putL(dc, S * 0.33, y, f, lab, w, P.ink, false, R0); yb = y + ph / 2.0;
            } else {
                icon(dc, k, S * 0.25, y, S * 0.075, P.acc);
                var f = byInk(dc, [SM, XT], S * HOME_DY - 2 * G - S * 0.01), lab = homeLab(dc, F, k, f, w);
                putL(dc, S * 0.33, y, f, lab, w, P.fg, false, R0); yb = y + dn(dc, f, lab);
            }
            $.gRows.add([r, y / S]);
        }
        if (sum instanceof Dictionary) { if ((sum as Dictionary)["pts"] != null) { points(dc, S, P, sum as Dictionary, yb); } }
        if (n > HOME_FIT) { scrollArc(dc, S, P, F.sel, n); }
        startHint(dc, S, P);
    }
    // "245 pts" and the change against last week below yb (SMALL, else XTINY; the change goes first when there is no room)
    function points(g as Dc, S as Number, P as Palette, sum as Dictionary, yb) as Void {
        var t = rnd(fltOf(sum["pts"])).toString() + " pts", d = rnd(fltOf(sum["delta"])), ad = d < 0 ? -d : d, fonts = [SM, XT];
        for (var i = 0; i < 2; i++) {
            var f = fonts[i], y = below(g, yb, f, S * 0.86), tw = g.getTextWidthInPixels(t, f), dw = d != 0 ? S * 0.06 + g.getTextWidthInPixels(ad.toString(), XT) : 0;
            var m = roomC(g, S / 2, y, f, t, R0);
            if (y + dn(g, f, t) > S * (0.5 + R0) || (i == 0 && tw + dw > m)) { continue; }
            var show = tw + dw <= m, x = S / 2.0 - (tw + (show ? dw : 0)) / 2.0;
            txtL(g, x, y, f, fit(g, t, f, m), P.fg);
            if (show && d != 0) { tri(g, x + tw + S * 0.025, y, S * 0.018, d > 0, P.good); txtL(g, x + tw + S * 0.05, y, XT, ad.toString(), P.good); }
            return;
        }
    }
    // the scroll position on the left edge (150..210 degrees)
    function scrollArc(dc as Dc, S as Number, P as Palette, sel as Number, n as Number) as Void {
        if (n < 2) { return; }
        var c = S / 2;
        dc.setPenWidth(pw(S * 0.012 + 1)); dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT);
        dc.drawArc(c, c, c - S * 0.03, Graphics.ARC_COUNTER_CLOCKWISE, 150, 210);
        var p = sel.toFloat() / (n - 1), a = 150 + (p * 51).toNumber();
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.drawArc(c, c, c - S * 0.03, Graphics.ARC_COUNTER_CLOCKWISE, a, a + 9); dc.setPenWidth(1);
    }
    // setShort without spaces and units ("102.5x10", "+10x8", "12", "1:30")
    function setMini(t as String, kg as Float, r as Number) as String {
        if (t.equals("time")) { return clock(r); }
        if (t.equals("bw")) { return kg > 0.0 ? "+" + kgTxt(kg) + "x" + r.toString() : r.toString(); }
        return kgTxt(kg) + "x" + r.toString();
    }
    // one set, short: 80 kg x 8, +5 x 10, 10 reps, 1:00
    function setShort(t as String, kg as Float, r as Number) as String {
        if (t.equals("time")) { return clock(r); }
        if (t.equals("bw")) { return kg > 0.0 ? "+" + kgTxt(kg) + " x " + r.toString() : r.toString() + " reps"; }
        return kgTxt(kg) + " kg x " + r.toString();
    }
    // the exercise list's sub line of row k ("long|short" variants): a workout item's progress, else this session's sets, else all of
    // last time's (at most 4, then fewer: the list takes the first variant that fits)
    function pickSub(dc as Dc, F as Flow, S as Number, k as Number) as String {
        var rows = F.pickRows();
        if (k < 0 || k >= rows.size()) { return ""; }
        var l = F.exList(), e = l[rows[k][0]], j = rows[k][1];
        if (!(e instanceof Dictionary)) { return ""; }
        var ed = e as Dictionary, t = F.exT(ed), mine = F.setsOf(strOf(ed["id"])), n = mine.size();
        if (j >= 0) {
            var it = F.itAt(j), d = F.doneOf(j);
            if (it == null) { return ""; }
            var m = numOf(it[1]), pr = d.toString() + "/" + m.toString() + " sets";
            if (d >= m) { return "Done, " + plural(d, "set", "sets") + "|Done"; }
            if (F.planSkip.indexOf(j) >= 0) { return "Skipped"; }
            return pr + ", " + (t.equals("time") ? clock(numOf(it[2])) : numOf(it[2]).toString() + " reps") + "|" + pr;
        }
        if (n > 0) {
            var kg = fltOf(mine[n - 1]["kg"]), rp = numOf(mine[n - 1]["reps"]), nd = n.toString() + " done";
            return nd + ", " + setShort(t, kg, rp) + "|" + nd + ", " + setMini(t, kg, rp) + "|" + nd;
        }
        var s = arrOf(ed["s"]);
        if (s.size() == 0) { return "New"; }
        var lt = "";
        for (var k2 = s.size() < 4 ? s.size() : 4; k2 >= 1; k2--) { lt = lt + lastTxt(t, s, k2) + "|"; }
        var p0 = arrOf(s[0]);
        return lt + (p0.size() >= 2 ? setMini(t, fltOf(p0[0]), numOf(p0[1])) : "");
    }
    // js/watchflow.js lastParts / lastTxt: last session's first k sets, short: a weight only when it changes (80x8, 8, 75x10),
    // bodyweight only reps (+kg when added), timed the clock; fewer than all end with " ..."
    function lastTxt(t as String, s as Array, k as Number) as String {
        var n = k < s.size() ? k : s.size(), r = "Last ", pk = -1.0, bwOnly = true;
        if (n < 1) { n = 1; }
        for (var i = 0; i < n; i++) {
            var p = arrOf(s[i]);
            if (p.size() < 2) { continue; }
            var kg = fltOf(p[0]), x = numOf(p[1]), one = "";
            if (t.equals("time")) { one = clock(x); }
            else if (t.equals("bw")) { if (kg > 0.0) { one = "+" + kgTxt(kg) + "x" + x.toString(); bwOnly = false; } else { one = x.toString(); } }
            else { one = i > 0 && kg == pk ? x.toString() : kgTxt(kg) + "x" + x.toString(); }
            pk = kg;
            r = r + (i > 0 ? ", " : "") + one;
        }
        if (n < s.size()) { return r + " ..."; }
        return t.equals("bw") && bwOnly ? r + " reps" : r;
    }
    function drawPick(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var items = F.listItems(), n = items.size(), k = F.sets.size(), title = "EXERCISES", tshort = "EXERCISES", p = F.plan, ws = F.workouts();
        if (n == 0 && F.exCount() == 0) { // the setup is on its way
            var c = S / 2, f = byInk(dc, [SM, XT], S * 0.13), t = "Loading exercises|Loading";
            put(dc, c, downTo(dc, XT, "EXERCISES", S * 0.12, R0), XT, "EXERCISES", S, P.dim, false, R0); put(dc, c, c, f, t, (S * 0.8).toNumber(), P.fg, false, R0);
            put(dc, c, below(dc, c + dn(dc, f, t), XT, 0), XT, "from the phone", (S * 0.8).toNumber(), P.lbl, false, R0);
            return;
        }
        if (p != null) { if (p[0] >= 0 && p[0] < ws.size()) { title = strOf(ws[p[0]]["n"]).toUpper(); tshort = null; } }
        var nn = (F.sel + 1).toString() + "/" + n.toString(), cnt = nn + (k > 0 ? ", " + plural(k, "set", "sets") + " done" : "");
        list(dc, F, S, P, items, title, tshort, false, pickSub(dc, F, S, F.sel), cnt + "|" + nn, []);
    }
    // Free or a workout (the phone's, those saved on the watch, then the standard ones)
    function drawSmode(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var sub = "Choose exercises|Exercises", ws = F.workouts();
        if (F.sel > 0 && F.sel - 1 < ws.size()) {
            var it = arrOf(ws[F.sel - 1]["it"]), n = 0;
            for (var i = 0; i < it.size(); i++) { var x = arrOf(it[i]); if (x.size() > 1) { n += numOf(x[1]); } }
            var ne = plural(it.size(), "exercise", "exercises");
            sub = ne + ", " + n.toString() + " sets|" + ne + "|" + n.toString() + " sets";
            if (ws[F.sel - 1]["std"] == true) { sub = "Standard, " + ne + "|Standard"; } // 23.11.7: built into the watch
        }
        list(dc, F, S, P, F.listItems(), "STRENGTH", "STRENGTH", false, sub, null, []);
    }
    // BACK on the exercise list with sets logged
    function drawEnd(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var ns = plural(F.sets.size(), "set", "sets");
        list(dc, F, S, P, F.listItems(), F.endConf ? "DISCARD?" : "END WORKOUT?", F.endConf ? "DISCARD?" : "END?", true, null, null, [[ns + ", " + clock(now - F.start - F.pauseT) + "|" + ns, P.lbl, false]]);
    }
    // after the summary: save the session as a workout (its name and size under the rows)
    function drawSaveq(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var q = F.saveq;
        if (q == null) { return; }
        var rows = q["rows"] as Array, it = q["it"] as Array, ex = [] as Array;
        if (F.sel < rows.size() - 1) {
            var nm = q["wid"] != null && F.sel == 0 ? strOf(q["wn"]) : strOf(q["n"]), n = 0;
            for (var i = 0; i < it.size(); i++) { n += numOf((it[i] as Array)[1]); }
            var ne = plural(it.size(), "exercise", "exercises");
            ex.add([nm, P.fg, true]); ex.add([ne + ", " + n.toString() + " sets|" + ne + "|" + n.toString() + " sets", P.lbl, false]);
        }
        list(dc, F, S, P, rows, "SAVE AS WORKOUT?", "SAVE?", true, null, null, ex);
    }
    function drawMore(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var m = F.moreList(), sub = null;
        if (F.sel < m.size()) { var x = arrOf(m[F.sel]); if (x.size() > 0) { sub = Sports.group(strOf(x[0])); } }
        var ex = m.size() > 0 ? [] as Array : [["Choose sports in the app:|Choose in the app:|In the app:", P.fg, false], ["Settings > Watch > More|Watch > More|Watch", P.fg, false]] as Array;
        list(dc, F, S, P, F.listItems(), "MORE SPORTS", "MORE", false, sub, null, ex);
    }
    // every list: the selected row big in the middle (a menu: in the pill), its sub line under it, the neighbours smaller (one more below);
    // the rows are stacked from the fonts' real sizes around the selected one, the counter under the title and the far row only where
    // there is room; title: a fixed one with its short form tshort, or a name (tshort null); count: the counter ("long|short", null: n/N);
    // extra = lines under the rows ([text ("long|short"), colour, a name]). The rows drawn go to gRows (FlowDelegate.onTap).
    function list(dc as Dc, F as Flow, S as Number, P as Palette, items as Array, title as String, tshort, isMenu as Boolean, sub, count, extra as Array) as Void {
        var n = items.size(), c = S / 2, sel = F.sel, G = gap(S);
        // the title: a fixed one moves down until its short form fits the circle, a name is cut
        var fixed = tshort != null, tv = fixed ? title + "|" + tshort : title, ty = fixed ? downTo(dc, XT, tshort as String, S * 0.12, R0) : S * 0.12;
        var trm = roomC(dc, c, ty, XT, "A", R0), tt = pick(dc, tv, XT, trm < (S * 0.62).toNumber() ? trm : (S * 0.62).toNumber(), !fixed);
        put(dc, c, ty, XT, tt, (S * 0.62).toNumber(), P.dim, !fixed, R0);
        var tb = ty + dn(dc, XT, tt), yb = 0.0;
        if (n == 0) { var f0 = byInk(dc, [SM, XT], S * 0.12); put(dc, c, c, f0, "Nothing yet", (S * 0.74).toNumber(), P.dim, false, R0); yb = c + dn(dc, f0, "Nothing yet"); }
        else {
            // the selected row
            var ys = S * 0.5, ph = S * 0.14, st = 0.0, sb = 0.0, ti = items[sel] as String;
            if (isMenu) {
                var fm = inPill(dc, "Ag", [ME, SM, XT], S, ph);
                pill(dc, c, ys, S * 0.78, ph, P.acc); put(dc, c, ys, fm, ti, (S * 0.7).toNumber(), P.ink, true, R0); st = ys - ph / 2.0; sb = ys + ph / 2.0;
            } else {
                var fs = fontIn(dc, ti, [ME, SM], (S * 0.74).toNumber(), S * 0.15);
                dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillRectangle(S * 0.1, ys - S * 0.055, S * 0.012 + 1, S * 0.11);
                put(dc, c, ys, fs, ti, (S * 0.74).toNumber(), P.fg, true, R0); st = ys - up(dc, fs); sb = ys + dn(dc, fs, ti);
            }
            $.gRows.add([0, 0.5]); yb = sb;
            if (!isMenu && sub instanceof String) { var su = sub as String, yu = below(dc, yb, XT, 0); put(dc, c, yu, XT, su, (S * 0.7).toNumber(), P.acc, false, R0); yb = yu + dn(dc, XT, su); }
            var side = byInk(dc, [SM, XT], S * 0.11);
            // the row above, with the counter between it and the title where there is room
            if (sel > 0) {
                var ta = items[sel - 1] as String, ya = above(dc, st, side, ta, S * (isMenu ? 0.33 : 0.3));
                if (ya - up(dc, side) >= tb + G) { put(dc, c, ya, side, ta, (S * 0.74).toNumber(), P.dim, true, R0); $.gRows.add([-1, ya / S]); st = ya - up(dc, side); }
            }
            if (!isMenu) {
                var ct = pick(dc, count != null ? count as String : (sel + 1).toString() + "/" + n.toString(), XT, (S * 0.62).toNumber(), false), yc = below(dc, tb, XT, S * 0.19);
                if (yc + dn(dc, XT, ct) <= st - G) { put(dc, c, yc, XT, ct, (S * 0.62).toNumber(), P.dim, false, R0); }
            }
            // the rows below: the next one, then the far one (non-menu)
            for (var o = 1; o <= (isMenu ? 1 : 2); o++) {
                var i = sel + o;
                if (i >= n) { break; }
                var f = o > 1 ? XT : side, t = items[i] as String, y = below(dc, yb, f, S * (isMenu ? 0.67 : (o > 1 ? 0.845 : 0.72)));
                if (y + dn(dc, f, t) > S * (0.5 + R0) || roomC(dc, c, y, f, t, R0) < S * 0.3) { break; }
                put(dc, c, y, f, t, (S * (o > 1 ? 0.55 : 0.74)).toNumber(), o > 1 ? P.far : P.dim, true, R0); $.gRows.add([o, y / S]); yb = y + dn(dc, f, t);
            }
        }
        for (var k = 0; k < extra.size(); k++) {
            var e = extra[k] as Array, ye = below(dc, yb, XT, 0), m = roomC(dc, c, ye, XT, "g", R0);
            var te = pick(dc, e[0] as String, XT, m < (S * 0.7).toNumber() ? m : (S * 0.7).toNumber(), e[2] as Boolean);
            if (ye + dn(dc, XT, te) > S * (0.5 + R0) || m < S * 0.3) { break; }
            put(dc, c, ye, XT, te, (S * 0.7).toNumber(), e[1] as Number, e[2] as Boolean, R0); yb = ye + dn(dc, XT, te);
        }
        if (n > 0) { scrollArc(dc, S, P, sel, n); }
        startHint(dc, S, P);
    }
    // the heart rate (and the session clock) on one line, centred at y; the clock goes where there is no room for both
    function hrClock(dc as Dc, F as Flow, S as Number, P as Palette, y, now as Number, f, withClock as Boolean) as Void {
        var c = S / 2, h = F.hr > 0 ? F.hr.toString() : "--", ck = clock(now - F.start - F.pauseT), hs = S * 0.045, G = gap(S);
        var wh = dc.getTextWidthInPixels(h, f), wc = withClock ? dc.getTextWidthInPixels(ck, XT) + S * 0.06 : 0, m = roomC(dc, c, y, f, h, R0);
        var both = withClock && hs + G + wh + wc <= m, x0 = c - (hs + G + wh + (both ? wc : 0)) / 2.0;
        heart(dc, x0 + hs / 2.0, y, hs, P.hr); txtL(dc, x0 + hs + G, y, f, h, P.fg);
        if (both) { txtL(dc, x0 + hs + G + wh + S * 0.06, y, XT, ck, P.dim); }
    }
    // the set screen: heart rate and clock, the exercise, SET n OF m with last time's numbers left and right (pushed out, never touching it),
    // kg x reps big (one font for both, the largest that fits the room between), the bar under the focused one and the units, DONE
    function drawSet(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var e = F.curEx(), c = S / 2, t = F.exT(e), it = F.planItem(), G = gap(S), timed = t.equals("time"), bw = t.equals("bw");
        startHint(dc, S, P);
        var hf = byInk(dc, [XT], S), hy = S * 0.12;
        hrClock(dc, F, S, P, hy, now, hf, true);
        var yb = hy + dn(dc, XT, "0");
        var nm = strOf(e["n"]), nf = byInk(dc, [SM, XT], S * 0.11), ny = below(dc, yb, nf, S * 0.22);
        put(dc, c, ny, nf, nm, (S * 0.74).toNumber(), P.fg, true, R0); yb = ny + dn(dc, nf, nm);
        // SET n OF m (short: SET n/m) with last time's numbers beside it; the numbers go where there is no room
        var sy = below(dc, yb, XT, S * 0.315), lp = lastSet(F, e), xs = [S * 0.285, S * 0.735] as Array<Float>;
        var ls = ["", ""] as Array<String>;
        if (lp != null) {
            if (timed) { ls = ["", clock(numOf(lp[1]))] as Array<String>; }
            else { var lk = fltOf(lp[0]); ls = [bw && lk == 0.0 ? "BW" : kgTxt(lk), numOf(lp[1]).toString()] as Array<String>; }
        }
        var m = roomC(dc, c, sy, XT, "SET", R0), lw = [dc.getTextWidthInPixels(ls[0], XT), dc.getTextWidthInPixels(ls[1], XT)] as Array<Number>;
        var no = "SET " + F.setNo().toString() + (it != null ? " OF " + numOf(it[1]).toString() : ""), side = lw[0] > lw[1] ? lw[0] : lw[1];
        if (dc.getTextWidthInPixels(no, XT) + 2 * (side + S * 0.06) > m) { no = "SET " + F.setNo().toString() + (it != null ? "/" + numOf(it[1]).toString() : ""); }
        var nw = dc.getTextWidthInPixels(no, XT), lastOn = lp != null && nw + 2 * (side + S * 0.06) <= m;
        txt(dc, c, sy, XT, no, P.acc);
        if (lastOn) {
            for (var i = 0; i < 2; i++) {
                if (ls[i].length() == 0) { continue; }
                var x = xs[i], w = lw[i] / 2.0, hw = nw / 2.0 + S * 0.04;
                if (i == 0 && x + w > c - hw) { x = c - hw - w; }
                if (i == 1 && x - w < c + hw) { x = c + hw + w; }
                if (i == 0 && x - w < c - m / 2.0) { x = c - m / 2.0 + w; }
                if (i == 1 && x + w > c + m / 2.0) { x = c + m / 2.0 - w; }
                txt(dc, x, sy, XT, ls[i], P.lbl);
            }
        }
        yb = sy + dn(dc, XT, no);
        // DONE at the bottom, the units (timed: hold / of 10:00) and the focus bar above it
        var py = S * 0.815, ph = S * 0.12, lab = timed && !(F.holdAt > 0) ? "GO" : "DONE", pf = inPill(dc, lab, [SM, XT], S * 0.36, ph);
        pill(dc, c, py, S * 0.4, ph, P.acc); put(dc, c, py, pf, lab, (S * 0.36).toNumber(), P.ink, false, R0);
        var uy = above(dc, py - ph / 2.0, XT, "reps", S * 0.665), bh = S * 0.016 + 1, by = uy - up(dc, XT) - G - bh;
        // the wheel (a finger on a number): the numbers make room for its neighbours above and below
        var wh = wheelOn(F, 0) || wheelOn(F, 1), nb = inkH(dc, XT) + G, nbot = py - ph / 2.0 - G - nb;
        var top = yb + G + (wh ? nb : 0), bot = wh ? (by - G < nbot ? by - G : nbot) : by - G;
        if (timed) {
            var held = F.holdAt > 0, v = held ? clock(now - F.holdAt) : clock(F.reps);
            var bf = numIn(dc, [v], [NHO, NME, NMI, ME], [(S * 0.6).toNumber()], [c], top, bot, R0);
            var y = numY(dc, bf, top, bot);
            txt(dc, c, y, bf, v, P.acc);
            if (wheelOn(F, 1)) { wheelNb(dc, F, S, P, 1, c, y, bf, yb + G, py - ph / 2.0 - G, true, false); }
            else { dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillRectangle(S * 0.36, by, S * 0.28, bh); put(dc, c, uy, XT, held ? "of " + clock(F.reps) : "hold", (S * 0.5).toNumber(), P.fg, false, R0); }
        } else {
            var val = [bw && F.kg == 0.0 ? "BW" : kgTxt(F.kg), F.reps.toString()] as Array<String>, unit = [bw ? "+kg" : "kg", "reps"] as Array<String>;
            var mx = [(S * 0.34).toNumber(), (S * 0.28).toNumber()] as Array<Number>, isBW = val[0].equals("BW");
            // one number font for both (BW: a text font, the number fonts have digits only)
            var nfn = numIn(dc, isBW ? [val[1]] : val, [NHO, NME, NMI, LA, ME, SM], isBW ? [mx[1]] : mx, isBW ? [xs[1]] : xs, top, bot, R0);
            var bwf = fontIn(dc, "BW", [LA, ME, SM], mx[0], bot - top), y = numY(dc, nfn, top, bot);
            txt(dc, S * 0.515, y, XT, "x", P.dim);
            for (var i = 0; i < 2; i++) {
                var on = F.focus == i, f = val[i].equals("BW") ? bwf : nfn;
                txt(dc, xs[i], y, f, val[i], on ? P.acc : P.fg);
                if (wheelOn(F, i)) { wheelNb(dc, F, S, P, i, xs[i], y, f, yb + G, py - ph / 2.0 - G, false, bw); continue; }
                if (on) { dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillRectangle(xs[i] - S * 0.12, by, S * 0.24, bh); }
                put(dc, xs[i], uy, XT, unit[i], (S * 0.3).toNumber(), on ? P.fg : P.lbl, false, R0);
            }
        }
    }
    // the first number font in which every v[i] (centred on x[i]) is at most w[i] wide (and inside the circle r) and whose digits fit the rows top..bot
    function numIn(dc as Dc, v as Array, fonts as Array, w as Array, x as Array, top, bot, r) {
        for (var i = 0; i < fonts.size(); i++) {
            var f = fonts[i], y = numY(dc, f, top, bot), ok = up(dc, f) + dn(dc, f, "0") <= bot - top;
            for (var k = 0; k < v.size() && ok; k++) { var m = roomC(dc, x[k], y, f, "0", r), ww = w[k] < m ? w[k] : m; if (dc.getTextWidthInPixels(v[k] as String, f) > ww) { ok = false; } }
            if (ok) { return f; }
        }
        return fonts[fonts.size() - 1];
    }
    // the y that centres the digits of font f in the rows top..bot
    function numY(dc as Dc, f, top, bot) as Float { return (top + bot) / 2.0 + (up(dc, f) - dn(dc, f, "0")) / 2.0; }
    // 23.11.7 (FlowDelegate gWheel ...): a finger turns column c of the screen now (or lifted less than WHEEL_SHOW_MS ago)
    function wheelOn(F as Flow, c as Number) as Boolean {
        return gWheel == c && gWheelScr == F.scr && (gWheelEnd == 0 || System.getTimer() - gWheelEnd < WHEEL_SHOW_MS);
    }
    // the wheel's neighbours, one step below / above the number turned (at y in font f), small and dim above / below it (the next higher
    // one below: it comes up with the finger); one without room between top and bot is left out
    function wheelNb(dc as Dc, F as Flow, S as Number, P as Palette, c as Number, x, y, f, top, bot, timed as Boolean, bw as Boolean) as Void {
        for (var d = -1; d <= 1; d += 2) {
            var t = "";
            if (c == 0) {
                var k = F.kgStep(d, false);
                if (k == F.kg) { continue; }
                t = bw && k == 0.0 ? "BW" : kgTxt(k);
            } else {
                var r = F.repStep(d, false);
                if (r == F.reps) { continue; }
                t = timed ? clock(r) : r.toString();
            }
            var yy = d < 0 ? above(dc, y - up(dc, f), XT, t, S) : below(dc, y + dn(dc, f, "0"), XT, 0);
            if (yy - up(dc, XT) < top || yy + dn(dc, XT, t) > bot) { continue; }
            txt(dc, x, yy, XT, t, P.dim);
        }
    }
    // js/watchflow.js lastSet(F, e): last session's set with the number of the set now (its last one when today goes further): [kg, reps] or null
    function lastSet(F as Flow, e as Dictionary) as Array? {
        var s = arrOf(e["s"]);
        if (s.size() == 0) { return null; }
        var n = F.setNo() - 1;
        var p = arrOf(n >= 0 && n < s.size() ? s[n] : s[s.size() - 1]);
        return p.size() >= 2 ? p : null;
    }
    // the rest: the ring, heart rate, the clock, the exercise, its last sets (as many as fit, at most 3), what comes next, SKIP; all inside the ring
    function drawRest(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var left = F.restLeft(now), c = S / 2, r = c - (S * 0.04).toNumber(), e = F.curEx(), t = F.exT(e), G = gap(S), ri = 0.5 - 0.04 - 0.025 - 0.015;
        var part = F.restLen > 0 ? left.toFloat() / F.restLen : 0.0;
        dc.setPenWidth(pw(S * 0.05)); dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT); dc.drawCircle(c, c, r);
        if (part > 0.0) {
            dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT);
            if (part >= 0.999) { dc.drawCircle(c, c, r); }
            else { dc.drawArc(c, c, r, Graphics.ARC_CLOCKWISE, 90, 90 - (part * 360).toNumber()); } // from 12 o'clock, clockwise
        }
        dc.setPenWidth(1);
        // from the bottom: SKIP, the next set, NEXT
        var it = F.planItem(), nx = e;
        if (it != null) { var l = F.exList(), j = exIndex(l, it[0]); nx = j >= 0 ? l[j] as Dictionary : { "id" => strOf(it[0]), "n" => strOf(it[0]), "t" => "w" } as Dictionary; }
        var v = F.prefillOf(nx), nt = F.exT(nx), vt = setShort(nt, fltOf(v[0]), numOf(v[1])), vm = setMini(nt, fltOf(v[0]), numOf(v[1])), no = F.setNo().toString(), lab = "", val = vt;
        var same = strOf(nx["id"]).equals(strOf(e["id"]));
        if (same) { lab = "NEXT: SET " + no + (it != null ? " OF " + numOf(it[1]).toString() : "") + "|NEXT: SET " + no + (it != null ? "/" + numOf(it[1]).toString() : ""); val = vt + "|" + vm; }
        else { lab = "NEXT: " + strOf(nx["n"]).toUpper(); val = "Set " + no + (it != null ? "/" + numOf(it[1]).toString() : "") + ", " + vt + "|" + vt + "|" + vm; }
        var ky = S * 0.85; put(dc, c, ky, XT, "SKIP", S, P.acc, false, ri);
        var vy = above(dc, ky - up(dc, XT), XT, val, S * 0.758); put(dc, c, vy, XT, val, (S * 0.7).toNumber(), P.fg, false, ri);
        var ly = above(dc, vy - up(dc, XT), XT, lab, S * 0.7); put(dc, c, ly, XT, lab, (S * 0.7).toNumber(), P.lbl, !same, ri);
        // from the top: heart rate, the clock (NUMBER_MEDIUM, smaller where it does not fit), the exercise
        var hf = byInk(dc, [SM, XT], S * 0.1), hy = S * 0.15 > up(dc, hf) + S * 0.1 ? S * 0.15 : up(dc, hf) + S * 0.1;
        hrClock(dc, F, S, P, hy, now, hf, false);
        var lt = ly - up(dc, XT) - G, ct = clock(left), nm = strOf(e["n"]).toUpper();
        var cf = fontIn(dc, ct, [NME, NMI, ME], (S * 0.6).toNumber(), (lt - (hy + dn(dc, hf, "0")) - 2 * G) * 0.62), cy = below(dc, hy + dn(dc, hf, "0"), cf, S * 0.3);
        txt(dc, c, cy, cf, ct, left <= 5 ? P.acc : P.fg);
        var ny = below(dc, cy + dn(dc, cf, ct), XT, S * 0.425); put(dc, c, ny, XT, nm, (S * 0.62).toNumber(), P.acc, true, ri);
        // the sets between: the last k that fit
        var mine = F.setsOf(strOf(e["id"])), dy = up(dc, XT) + dn(dc, XT, "g") + G;
        var k = ((lt - (ny + dn(dc, XT, nm)) - G) / dy).toNumber();
        if (k > 3) { k = 3; }
        if (k > mine.size()) { k = mine.size(); }
        for (var j2 = 0; j2 < k; j2++) {
            var q = mine[mine.size() - k + j2], no2 = (mine.size() - k + j2 + 1).toString(), qk = fltOf(q["kg"]), qr = numOf(q["reps"]);
            var ln = no2 + "   " + setShort(t, qk, qr) + "|" + no2 + "  " + setMini(t, qk, qr);
            put(dc, c, ny + dn(dc, XT, nm) + G + up(dc, XT) + j2 * dy, XT, ln, (S * 0.64).toNumber(), P.fg, false, ri);
        }
    }
    function prFlash(dc as Dc, S as Number, P as Palette, f as Dictionary) as Void {
        var c = S / 2, t = strOf(f["t"]), kg = fltOf(f["kg"]), r = numOf(f["reps"]);
        var v = t.equals("bw") ? r.toString() + " reps" : (t.equals("time") ? clock(r) : kgTxt(kg) + " x " + r.toString());
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, c, c);
        var a = byInk(dc, [SM, XT], S * 0.12), b = fontIn(dc, "PR", [LA, ME, SM], S, S * 0.2), d = fontIn(dc, v, [ME, SM, XT], (S * 0.74).toNumber(), S * 0.14);
        put(dc, c, S * 0.27, a, "NEW RECORD", S, P.ink, false, R0); txt(dc, c, S * 0.5, b, "PR", P.ink); put(dc, c, S * 0.72, d, v, (S * 0.74).toNumber(), P.ink, false, R0);
    }
    // the lap banner for 5 s
    function lapFlash(dc as Dc, F as Flow, S as Number, P as Palette, f as Dictionary) as Void {
        var c = S / 2, t = numOf(f["t"]), d = fltOf(f["d"]), l = "";
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, c, c);
        if (F.sp.equals("ride")) { l = (t > 0 ? d / t * 3.6 : 0.0).format("%.1f") + " km/h"; }
        else if (F.sp.equals("run")) { l = Fields.pace(t.toFloat(), d) + " /km"; }
        else { l = kmTxt(d) + " km"; }
        var a = byInk(dc, [ME, SM, XT], S * 0.13), ay = S * 0.26, ct = clock(t);
        put(dc, c, ay, a, "LAP " + numOf(f["n"]).toString(), S, P.ink, false, R0);
        var lf = fontIn(dc, l, [ME, SM, XT], (S * 0.8).toNumber(), S * 0.13), ly = S * 0.69;
        var top = ay + dn(dc, a, "LAP") + gap(S), bot = ly - up(dc, lf) - gap(S), nf = numIn(dc, [ct], [NHO, NME, NMI], [(S * 0.84).toNumber()], [c], top, bot, R0);
        txt(dc, c, numY(dc, nf, top, bot), nf, ct, P.ink); put(dc, c, ly, lf, l, (S * 0.8).toNumber(), P.ink, false, R0);
    }
    // the summary: page 0 the totals, then one page per exercise with every set (as many as fit, then "+ n more")
    function drawSum(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var s = F.sum, c = S / 2, G = gap(S);
        if (s == null) { return; }
        var exs = arrOf(s["ex"]), pg = F.sel;
        pageDots(dc, S, P, exs.size() + 1, pg);
        var dy0 = S * 0.87, bt = dy0 - up(dc, XT) - G;
        if (pg > 0 && pg <= exs.size()) {
            put(dc, c, dy0, XT, "DONE", S, P.lbl, false, R0);
            var ex1 = exs[pg - 1] as Dictionary, t = strOf(ex1["t"]), ss = arrOf(ex1["s"]), vol = 0.0, nm = strOf(ex1["n"]);
            for (var i = 0; i < ss.size(); i++) { var y0 = arrOf(ss[i]); vol += fltOf(y0[0]) * numOf(y0[1]); }
            var nf = byInk(dc, [SM, XT], S * 0.11), ny = S * 0.2 > up(dc, nf) + S * 0.12 ? S * 0.2 : up(dc, nf) + S * 0.12;
            put(dc, c, ny, nf, nm, (S * 0.7).toNumber(), P.acc, true, R0);
            var ns = plural(ss.size(), "set", "sets"), info = ns + (!t.equals("time") && vol > 0.0 ? ", " + volTxt(vol) + " kg|" + ns : ""), iy = below(dc, ny + dn(dc, nf, nm), XT, S * 0.285);
            put(dc, c, iy, XT, info, (S * 0.7).toNumber(), P.lbl, false, R0);
            var dy1 = up(dc, XT) + dn(dc, XT, "g") + G, dy = dy1 > S * 0.08 ? dy1 : S * 0.08, ya = below(dc, iy + dn(dc, XT, info), XT, S * 0.38);
            var k = ((bt - (ya - up(dc, XT))) / dy).toNumber();
            if (k >= ss.size()) { k = ss.size(); } else { k = k - 1; }
            if (k < 0) { k = 0; }
            for (var i = 0; i < k; i++) {
                var y1 = arrOf(ss[i]), pr = numOf(y1[2]) == 1, kk = fltOf(y1[0]), rr = numOf(y1[1]);
                var ln = (i + 1).toString() + "   " + setShort(t, kk, rr) + (pr ? "  PR" : "") + "|" + (i + 1).toString() + "  " + setMini(t, kk, rr) + (pr ? " PR" : "");
                put(dc, c, ya + i * dy, XT, ln, (S * 0.7).toNumber(), pr ? P.acc : P.fg, false, R0);
            }
            if (k < ss.size()) { put(dc, c, ya + k * dy, XT, "+ " + (ss.size() - k).toString() + " more", S, P.lbl, false, R0); }
            return;
        }
        var st = numOf(s["st"]), sf = byInk(dc, [SM, XT], S * 0.1), sy = S * 0.15 > up(dc, sf) + S * 0.1 ? S * 0.15 : up(dc, sf) + S * 0.1;
        var stt = "", sc = P.acc;
        if (st == ST_SAVED) { stt = "SAVED"; } else if (st == ST_SENDING) { stt = "SENDING"; sc = P.dim; } else if (st == ST_FAILED) { stt = "NOT SAVED"; }
        if (stt.length() > 0) { put(dc, c, sy, sf, stt, S, sc, false, R0); }
        else { put(dc, c, sy, XT, "Sends when the phone is near|Waiting for the phone|Not sent yet", S, P.fg, false, R0); }
        var yb = sy + dn(dc, stt.length() > 0 ? sf : XT, "S");
        // the time, TIME, the three numbers with labels, the heart rate, the records, DONE; TIME, the records, DONE and the heart rate go
        // (in this order) when there is no room
        var v = [numOf(s["sets"]).toString(), volTxt(fltOf(s["vol"])), numOf(s["exs"]).toString()] as Array<String>, l = ["SETS", "KG", "LIFTS"] as Array<String>;
        var h = s["hr"], prs = numOf(s["prs"]), ht = "no heart rate|no HR";
        if (h instanceof Dictionary) { var ha = numOf((h as Dictionary)["avg"]).toString(); ht = ha + " avg, " + numOf((h as Dictionary)["max"]).toString() + " max|" + ha + " avg"; }
        var du = clock(numOf(s["dur"])), tf = topFont(dc, du, [NMI, ME, SM], (S * 0.8).toNumber(), S * 0.16, yb, S * 0.3);
        for (var lvl = 0; lvl < 5; lvl++) {
            var ty = below(dc, yb, tf, S * 0.3), tl = lvl < 1, py = lvl < 2 && prs > 0, dOn = lvl < 3, hOn = lvl < 4, b0 = dOn ? bt : S * (0.5 + R0);
            var ly = below(dc, ty + dn(dc, tf, "0"), XT, S * 0.395), cy0 = tl ? ly + dn(dc, XT, "T") : ty + dn(dc, tf, "0"), cb = cols(dc, S, P, v, l, cy0, S * 0.52, b0, [ME, SM, XT], false);
            var hy = below(dc, cb, XT, S * 0.69), pry = below(dc, hOn ? hy + dn(dc, XT, "g") : cb, XT, S * 0.77);
            if ((cb < 0 || (py ? pry + dn(dc, XT, "P") : (hOn ? hy + dn(dc, XT, "g") : cb)) > b0) && lvl < 4) { continue; }
            txt(dc, c, ty, tf, du, P.fg);
            if (tl) { put(dc, c, ly, XT, "TIME", S, P.lbl, false, R0); }
            if (dOn) { put(dc, c, dy0, XT, "DONE", S, P.lbl, false, R0); }
            cols(dc, S, P, v, l, cy0, S * 0.52, b0, [ME, SM, XT], true);
            if (py) { put(dc, c, pry, XT, prs.toString() + " PR", S, P.acc, false, R0); }
            if (!hOn) { return; }
            var hm = roomC(dc, c, hy, XT, "g", R0) - S * 0.07 - 2, h2 = pick(dc, ht, XT, hm, false), hw = dc.getTextWidthInPixels(h2, XT), x0 = c - (hw + S * 0.07) / 2.0;
            heart(dc, x0 + S * 0.02, hy, S * 0.042, P.hr); putL(dc, x0 + S * 0.07, hy, XT, h2, S, P.fg, false, R0);
            return;
        }
    }
    // pairing: the six digits of the code from the phone (UP / DOWN, START or a tap on a digit)
    function drawPair(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var c = S / 2, bw = S * 0.1, bh = S * 0.14, gp = S * 0.018, x0 = c - (6 * bw + 5 * gp) / 2.0 + bw / 2.0;
        var tf = byInk(dc, [SM, XT], S * 0.1), ty = S * 0.19; put(dc, c, ty, tf, "PAIR", S, P.acc, false, R0);
        var hy = below(dc, ty + dn(dc, tf, "P"), XT, S * 0.28), m = roomC(dc, c, hy, XT, "p", R0);
        put(dc, c, hy, XT, alt(dc, "Code from the phone", "Phone code", XT, m), S, P.fg, false, R0);
        var df = inPill(dc, "0", [ME, SM, XT], bw - 2, bh);
        for (var i = 0; i < 6; i++) {
            var x = x0 + i * (bw + gp), on = i == F.pairI;
            if (on) { dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillRoundedRectangle(x - bw / 2.0, S * 0.5 - bh / 2.0, bw, bh, S * 0.015); }
            else { dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(2); dc.drawRoundedRectangle(x - bw / 2.0, S * 0.5 - bh / 2.0, bw, bh, S * 0.015); dc.setPenWidth(1); }
            txt(dc, x, S * 0.5, df, F.pairD[i], on ? P.ink : (i < F.pairI ? P.fg : P.dim));
            if (on) { tri(dc, x, S * 0.5 - bh / 2.0 - S * 0.03, S * 0.022, true, P.acc); tri(dc, x, S * 0.5 + bh / 2.0 + S * 0.03, S * 0.022, false, P.acc); }
        }
        var st = F.pairSt == P_SENDING ? "Pairing" : (F.pairSt == P_FAIL ? "Wrong code" : (F.pairI == 5 ? "START: pair" : "START: next"));
        var sy = below(dc, S * 0.5 + bh / 2.0 + S * 0.045, XT, S * 0.72); put(dc, c, sy, XT, st, S, F.pairSt == P_FAIL ? P.acc : P.dim, false, R0);
        var py = below(dc, sy + dn(dc, XT, st), XT, S * 0.82), pm = roomC(dc, c, py, XT, "p", R0), pt = alt(dc, "Phone: Settings > Devices", "Settings > Devices", XT, pm);
        if (py + dn(dc, XT, pt) <= S * (0.5 + R0) && dc.getTextWidthInPixels(pt, XT) <= pm) { put(dc, c, py, XT, pt, S, P.dim, false, R0); }
    }

    /* ---- run, ride, other ---- */
    // the pause screen (every mode): PAUSED, the sport, the time, START resume, Hold BACK to finish, Discard (confirm step); while BACK is
    // held an orange ring fills with 3-2-1. Discard and the touch pill stay at 0.68 / 0.82 (the tap table); the lines above them are
    // stacked, the sport, then "Hold BACK to finish" (the touch pill says it too), then "START resume" left out where there is no room.
    function drawPause(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var c = S / 2, ms = System.getTimer(), part = F.holdPart(ms), touch = hasTouch(), G = gap(S);
        var ri = part >= 0.0 ? 0.5 - 0.035 - 0.025 - 0.015 : R0;
        if (part >= 0.0) {
            var r = c - (S * 0.035).toNumber();
            dc.setPenWidth(pw(S * 0.05)); dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT); dc.drawCircle(c, c, r);
            if (part > 0.01) {
                dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT);
                if (part >= 0.99) { dc.drawCircle(c, c, r); }
                else { var a = 90 - (part * 360).toNumber(); if (a < 0) { a += 360; } dc.drawArc(c, c, r, Graphics.ARC_CLOCKWISE, 90, a); }
            }
            dc.setPenWidth(1);
        }
        var tf = byInk(dc, [SM, XT], S * 0.1), ty = S * 0.17 > up(dc, tf) + S * 0.09 ? S * 0.17 : up(dc, tf) + S * 0.09;
        put(dc, c, ty, tf, "PAUSED", S, P.acc, false, ri);
        var sp = F.rec != null ? sportName(F) : "Strength";
        if (F.pzConf) {
            var py = S * 0.68, ph = pillH(dc, S * 0.1), qy = S * 0.82, bt = py - ph / 2.0 - G;
            pill(dc, c, py, S * 0.46, ph, P.acc); put(dc, c, py, inPill(dc, "Discard", [SM, XT], S * 0.42, ph), "Discard", S, P.ink, false, ri);
            if (touch) { pill(dc, c, qy, S * 0.4, ph, P.faint); put(dc, c, qy, inPill(dc, "Keep", [SM, XT], S * 0.36, ph), "Keep", S, P.fg, false, ri); }
            var hy = above(dc, bt + G, XT, "yes", S * 0.5), m = roomC(dc, c, hy, XT, "y", ri), ht = alt(dc, "START yes, BACK no", "START: yes", XT, m);
            put(dc, c, hy, XT, ht, S, P.lbl, false, ri);
            var qt = hy - up(dc, XT) - G, qf = fontIn(dc, "Discard?", [LA, ME, SM, XT], (S * 0.8).toNumber(), qt - (ty + dn(dc, tf, "P")) - 2 * G);
            txt(dc, c, (ty + dn(dc, tf, "P") + qt) / 2.0 + (up(dc, qf) - dn(dc, qf, "D")) / 2.0, qf, "Discard?", P.fg);
            return;
        }
        var dy = S * 0.68, dh = pillH(dc, S * 0.1), dt = dy - dh / 2.0 - G;
        if (F.pzSel != 0) { var w = S * 0.46; dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(2); dc.drawRoundedRectangle(c - w / 2.0, dy - dh / 2.0, w, dh, dh / 2.0); dc.setPenWidth(1); }
        put(dc, c, dy, inPill(dc, "Discard", [SM, XT], S * 0.42, dh), "Discard", S, F.pzSel != 0 ? P.fg : P.dim, false, ri);
        if (touch) { var on = part >= 0.0, qh = pillH(dc, S * 0.11); pill(dc, c, S * 0.82, S * 0.5, qh, on ? P.acc : P.faint); put(dc, c, S * 0.82, inPill(dc, "Hold", [XT], S * 0.46, qh), "Hold to finish|Hold to end|Hold", S * 0.46, on ? P.ink : P.fg, false, R0); }
        var tt = part >= 0.0 ? F.holdCount(ms).toString() : clock(F.pausedTime()), hint = F.pzHint > now || part >= 0.0 ? P.acc : P.lbl;
        var rf = byInk(dc, [SM, XT], S * 0.1);
        for (var lvl = 0; lvl < 4; lvl++) {
            var showSp = lvl < 1, showH2 = lvl < 2 || !touch, showH1 = lvl < 3;
            var yb = ty + dn(dc, tf, "P"), sy = 0.0, h1 = 0.0, h2 = 0.0;
            if (showSp) { sy = below(dc, yb, XT, S * 0.235); yb = sy + dn(dc, XT, sp); }
            var room = dt - yb - G - (showH1 ? inkH(dc, rf) + G : 0) - (showH2 ? inkH(dc, XT) + G : 0);
            var nf = part >= 0.0 ? fontIn(dc, tt, [NHO, NME, NMI, ME], (S * 0.5).toNumber(), room) : fontIn(dc, tt, [NME, NMI, ME], (S * 0.7).toNumber(), room);
            if (up(dc, nf) + dn(dc, nf, "0") > room && lvl < 3) { continue; }
            var ny = numY(dc, nf, yb + G, yb + G + room); yb = ny + dn(dc, nf, "0");
            if (showH1) { h1 = below(dc, yb, rf, 0); yb = h1 + dn(dc, rf, "p"); }
            if (showH2) { h2 = below(dc, yb, XT, 0); yb = h2 + dn(dc, XT, "g"); }
            if (showSp) { put(dc, c, sy, XT, sp, (S * 0.5).toNumber(), P.lbl, true, ri); }
            txt(dc, c, ny, nf, tt, part >= 0.0 ? P.acc : P.fg);
            if (showH1) { put(dc, c, h1, rf, "START resume", (S * 0.7).toNumber(), P.fg, false, ri); }
            if (showH2) { var m2 = roomC(dc, c, h2, XT, "g", ri); put(dc, c, h2, XT, alt(dc, "Hold BACK to finish", "Hold BACK: finish", XT, m2), S, hint, false, ri); }
            return;
        }
    }
    function sportName(F as Flow) as String { return F.sp.equals("other") ? F.tname : F.homeLabel(F.sp); }
    // run / ride / more: the sport, GPS (or the heart rate), the pages, the route line (UP / DOWN or a tap: RPICK; gRouteY), START
    function drawReady(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var c = S / 2, G = gap(S), other = F.sp.equals("other");
        startHint(dc, S, P);
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, S * 0.25, S * 0.1);
        icon(dc, other ? "more" : F.sp, c, S * 0.25, S * 0.12, P.ink);
        var py = S * 0.81, ph = S * 0.13; pill(dc, c, py, S * 0.42, ph, P.acc); put(dc, c, py, inPill(dc, "START", [SM, XT], S * 0.38, ph), "START", S, P.ink, false, R0);
        var bt = py - ph / 2.0 - G, nm = sportName(F), nf = fontIn(dc, nm, [LA, ME, SM, XT], (S * 0.8).toNumber(), S * 0.13);
        var ny = below(dc, S * 0.35, nf, S * 0.445); put(dc, c, ny, nf, nm, (S * 0.8).toNumber(), P.fg, true, R0);
        var yb = ny + dn(dc, nf, nm);
        var gf = byInk(dc, [SM, XT], S * 0.1), gy = below(dc, yb, gf, S * 0.565);
        if (!Sports.gps(F.sp, F.type)) {
            var t = F.hr > 0 ? F.hr.toString() + " bpm" : "Heart rate", w = S * 0.07 + dc.getTextWidthInPixels(t, gf), x0 = c - w / 2.0;
            heart(dc, x0 + S * 0.025, gy, S * 0.045, P.hr); putL(dc, x0 + S * 0.07, gy, gf, t, S, P.fg, false, R0);
        } else {
            // the real fix quality (Recorder.onPosition): ready (usable / good), weak (poor / last known), search
            var q = F.gps, col = q >= 2 ? P.good : (q == 1 ? P.acc : P.lbl), t = q >= 2 ? "GPS ready" : (q == 1 ? "GPS weak" : "GPS search");
            var w = S * 0.055 + dc.getTextWidthInPixels(t, gf), x0 = c - w / 2.0;
            dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.fillCircle(x0 + S * 0.02, gy, S * 0.02); putL(dc, x0 + S * 0.055, gy, gf, t, S, col, false, R0);
        }
        yb = gy + dn(dc, gf, "p");
        var n = F.pages.size(), route = F.hasRoutePage();
        var np = n.toString() + (n == 1 ? " page" : " pages") + (route ? " + route" : "");
        if (!other) {
            var i = F.routeIndex(), l = F.routes, rt = "No route", on = false;
            if (i >= 0 && l != null) { on = true; rt = F.route != null ? "Route: " + strOf(l[i]["name"]) : "Loading route"; }
            // the route line first (it can be tapped), the pages line where there is room
            var ry = below(dc, yb, XT, S * 0.64);
            if (ry + dn(dc, XT, rt) <= bt) {
                var y2 = below(dc, ry + dn(dc, XT, rt), XT, S * 0.705), m = roomC(dc, c, y2, XT, "p", R0);
                var pt = dc.getTextWidthInPixels(np + ", edit on phone", XT) <= m ? np + ", edit on phone" : (dc.getTextWidthInPixels(np + ", on phone", XT) <= m ? np + ", on phone" : np);
                var two = y2 + dn(dc, XT, pt) <= bt;
                var y1 = two ? ry : below(dc, yb, XT, S * 0.67);
                if (two) { put(dc, c, y1, XT, pt, (S * 0.62).toNumber(), P.lbl, false, R0); }
                var yr = two ? y2 : y1; put(dc, c, yr, XT, rt, (S * 0.6).toNumber(), on ? P.acc : P.fg, true, R0); $.gRouteY = yr / S;
            }
        } else {
            var y = below(dc, yb, XT, S * 0.655), t2 = n.toString() + (n == 1 ? " data page" : " data pages");
            if (y + dn(dc, XT, t2) <= bt) { put(dc, c, y, XT, t2, (S * 0.62).toNumber(), P.lbl, false, R0); }
        }
    }
    // None or a route sent from the phone, with its length and climb
    function drawRpick(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var l = F.routes, sub = "Data pages only", ex = [] as Array;
        if (l != null) {
            if (F.sel > 0 && F.sel - 1 < l.size()) { var r = l[F.sel - 1], cl = rnd(fltOf(r["climb"])), km = kmTxt(fltOf(r["dist"])) + " km"; sub = km + (cl > 0 ? ", " + cl.toString() + " m up|" + km : ""); }
            if (l.size() == 0) { ex = [["Send routes from the phone|Send from the phone|From the phone", P.lbl, false]] as Array; }
        }
        list(dc, F, S, P, F.listItems(), "ROUTE", "ROUTE", false, sub, null, ex);
    }
    function drawRec(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var R = F.rec;
        if (R == null) { return; }
        var g = F.seg;
        if (g != null) { if (g["hide"] != true) { segScreen(dc, F, S, P, g); return; } }
        var n = F.pageCount(), i = R.pg % n;
        if (i >= F.pages.size()) { routePage(dc, F, S, P); } else { drawPage(dc, S, P, F.sp, F.pages[i], R); }
        recRing(dc, S, P, !R.auto);
        pageDots(dc, S, P, n, i);
    }
    // a data page: [x, value y, label y, value size, max width] per field for 1 to 4 fields between the separators (h rows, v the middle
    // line); in each cell the label on top, the value with its unit as big as the cell's room allows (auto pause: the first label says so)
    function drawPage(dc as Dc, S as Number, P as Palette, sp as String, ids as Array<String>, R as Rec) as Void {
        var k = ids.size(), c = S / 2, G = gap(S);
        if (k == 0) { return; }
        if (k > 4) { k = 4; }
        var L = [[0.5, 0.53, 0.32, 0.3, 0.84]] as Array<Array<Float>>, h = [] as Array<Float>, v = [] as Array<Float>, cb = [1.0] as Array<Float>;
        if (k == 2) { L = [[0.5, 0.34, 0.2, 0.2, 0.74], [0.5, 0.72, 0.58, 0.2, 0.7]] as Array<Array<Float>>; h = [0.5] as Array<Float>; cb = [0.5, 1.0] as Array<Float>; }
        else if (k == 3) { L = [[0.5, 0.33, 0.18, 0.2, 0.7], [0.29, 0.7, 0.575, 0.14, 0.37], [0.71, 0.7, 0.575, 0.14, 0.37]] as Array<Array<Float>>; h = [0.48] as Array<Float>; v = [0.48, 0.9] as Array<Float>; cb = [0.48, 1.0, 1.0] as Array<Float>; }
        else if (k == 4) { L = [[0.5, 0.255, 0.13, 0.16, 0.6], [0.29, 0.5, 0.405, 0.13, 0.37], [0.71, 0.5, 0.405, 0.13, 0.37], [0.5, 0.765, 0.67, 0.13, 0.5]] as Array<Array<Float>>; h = [0.355, 0.615] as Array<Float>; v = [0.355, 0.615] as Array<Float>; cb = [0.355, 0.615, 0.615, 1.0] as Array<Float>; }
        dc.setColor(P.line, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.006 > 2 ? S * 0.006 : 2));
        for (var j = 0; j < h.size(); j++) {
            var y = h[j], q = 0.25 - (y - 0.5) * (y - 0.5), hw = Math.sqrt(q > 0 ? q : 0.0) * S - S * 0.05;
            dc.drawLine(c - hw, y * S, c + hw, y * S);
        }
        if (v.size() == 2) { dc.drawLine(c, v[0] * S, c, v[1] * S); }
        dc.setPenWidth(1);
        for (var i = 0; i < k; i++) {
            var row = L[i], id = ids[i], x = row[0] * S, px = row[3], mw = (row[4] * S).toNumber(), small = px < 0.15, hrt = id.equals("hr") && !small;
            var ct = (i == 0 ? 0 : (k == 4 && i == 3 ? 0.615 : (k == 4 ? 0.355 : (k == 1 ? 0 : (k == 2 ? 0.5 : 0.48))))) * S, cbt = cb[i] * S;
            var auto = R.auto && i == 0, lt = auto ? "AUTO PAUSE|PAUSED" : Fields.label(id).toUpper() + "|" + shortLab(id);
            var ly = row[2] * S > ct + G + up(dc, XT) + (ct == 0 ? S * 0.06 : 0) ? row[2] * S : ct + G + up(dc, XT) + (ct == 0 ? S * 0.06 : 0);
            var lm = roomC(dc, x, ly, XT, "A", R0) - (hrt ? (S * 0.05).toNumber() : 0), lw = mw - (hrt ? (S * 0.05).toNumber() : 0) < lm ? mw - (hrt ? (S * 0.05).toNumber() : 0) : lm;
            var lab = fit(dc, pick(dc, lt, XT, lw, false), XT, lw), lx = x + (hrt ? S * 0.022 : 0);
            if (auto) { pill(dc, lx, ly, dc.getTextWidthInPixels(lab, XT) + S * 0.06, inkH(dc, XT) + 4, P.acc); txt(dc, lx, ly, XT, lab, P.ink); }
            else { txt(dc, lx, ly, XT, lab, P.lbl); }
            if (hrt) { heart(dc, lx - dc.getTextWidthInPixels(lab, XT) / 2.0 - S * 0.035, ly, S * 0.034, P.hr); }
            var top = ly + dn(dc, XT, lab) + G, bot = cbt - G - (cb[i] == 1.0 ? S * 0.06 : 0);
            valUnit(dc, x, row[1] * S, Fields.text(id, R), small && k > 1 ? "" : Fields.unit(sp, id), px, mw, top, bot, P);
        }
    }
    // a data field's short label (where the long one does not fit)
    function shortLab(id as String) as String {
        var k = ["lapPace", "avgPace", "dist", "lapDist", "lapTime", "hr", "hrZone", "cadence", "power3s", "power", "avgPower", "speed", "avgSpeed"] as Array<String>;
        var v = ["LAP", "AVG", "DIST", "LAP", "LAP", "HR", "ZONE", "CAD", "3S", "PWR", "AVG", "SPD", "AVG"] as Array<String>;
        var i = k.indexOf(id);
        return i >= 0 ? v[i] : Fields.label(id).toUpper();
    }
    // a value with its unit after it, centred on x, its digits in the rows top..bot (near y), kept inside max and the circle: the value
    // shrinks, the unit goes first; the unit on the value's baseline
    function valUnit(dc as Dc, x, y, v as String, u as String, px as Float, max as Number, top, bot, P as Palette) as Void {
        var fonts = valFonts(px, isNum(v)), uf = XT;
        fonts.addAll([LA, ME, SM, XT]);
        var uw = u.length() > 0 ? dc.getTextWidthInPixels(u, uf) + 4 : 0, f = fonts[fonts.size() - 1], vw = 0, found = false, yy = y;
        for (var pass = 0; pass < 2 && !found; pass++) {
            if (pass == 1) { uw = 0; }
            for (var i = 0; i < fonts.size() && !found; i++) {
                var g = fonts[i], vu = uw > 0 ? v + u : v, hi = up(dc, g) + dn(dc, g, vu);
                if (hi > bot - top) { continue; }
                var yi = y;
                if (yi - up(dc, g) < top) { yi = top + up(dc, g); }
                if (yi + dn(dc, g, vu) > bot) { yi = bot - dn(dc, g, vu); }
                var m = roomC(dc, x, yi, g, vu, R0); vw = dc.getTextWidthInPixels(v, g);
                if (vw + uw <= (max < m ? max : m)) { f = g; found = true; yy = yi; }
            }
        }
        if (!found) { uw = 0; f = fonts[fonts.size() - 1]; vw = dc.getTextWidthInPixels(v, f); yy = (top + bot) / 2.0; }
        var x0 = x - (vw + uw) / 2.0;
        txtL(dc, x0, yy, f, fit(dc, v, f, vw), P.fg);
        if (uw > 0) { var base = yy - dc.getFontHeight(f) / 2.0 + asc(f); txtL(dc, x0 + vw + 4, base - asc(uf) + dc.getFontHeight(uf) / 2.0, uf, u, P.lbl); }
    }
    // page dots on the left edge, where the UP / DOWN buttons are, the first page on top
    function pageDots(dc as Dc, S as Number, P as Palette, n as Number, i as Number) as Void {
        if (n < 2) { return; }
        var r = S / 2 - S * 0.035, a0 = 180 + (n - 1) * 5;
        for (var k = 0; k < n; k++) {
            var a = (a0 - k * 10) * Math.PI / 180.0, x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
            dc.setColor(k == i ? P.acc : P.dim, Graphics.COLOR_TRANSPARENT); dc.fillCircle(x, y, S * (k == i ? 0.016 : 0.011));
        }
    }
    // the recording ring at the top (dim while paused)
    function recRing(dc as Dc, S as Number, P as Palette, on as Boolean) as Void {
        dc.setColor(on ? P.acc : P.dim, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.024));
        dc.drawArc(S / 2, S / 2, S / 2 - (S * 0.012).toNumber(), Graphics.ARC_CLOCKWISE, 120, 60);
        dc.setPenWidth(1);
    }
    // three numbers with labels in a row below yb (not above y0): one font for the three (the largest whose row fits the circle and the
    // room to bot), the labels under them; where no font fits, one line per number; returns the ink bottom, or -1 when it does not fit
    function cols(dc as Dc, S as Number, P as Palette, v as Array<String>, l as Array<String>, yb, y0, bot, fonts as Array, draw as Boolean) as Float {
        var c = S / 2;
        for (var i = 0; i < fonts.size(); i++) {
            var f = fonts[i], y = below(dc, yb, f, y0), ly = below(dc, y + dn(dc, f, "0"), XT, 0), b = ly + dn(dc, XT, "G");
            if (b > bot) { continue; }
            var dx = colDx(dc, S, v, l, f, y, ly, S * 0.03);
            if (dx < 0) { continue; }
            if (draw) { for (var j = 0; j < 3; j++) { var x = c + (j - 1) * dx; txt(dc, x, y, f, v[j], P.fg); txt(dc, x, ly, XT, l[j], P.lbl); } }
            return b;
        }
        // the last resort (font size setting): one line per number, "1250 AVG W"
        var y1 = below(dc, yb, XT, y0), b1 = -1.0;
        for (var j = 0; j < 3; j++) {
            if (v[j].length() == 0 && l[j].length() == 0) { continue; } // 27.11.4: an empty column (two numbers) is no line
            var wv = dc.getTextWidthInPixels(v[j], XT), sp = S * 0.025, wl = dc.getTextWidthInPixels(l[j], XT), bb = y1 + dn(dc, XT, "G");
            if (bb > bot || wv + sp + wl > roomC(dc, c, y1, XT, "G", R0)) { return -1.0; }
            if (draw) { var x0 = c - (wv + sp + wl) / 2.0; txtL(dc, x0, y1, XT, v[j], P.fg); txtL(dc, x0 + wv + sp, y1, XT, l[j], P.lbl); }
            b1 = bb; y1 = below(dc, bb, XT, 0);
        }
        return b1;
    }
    // the distance of three columns (0.23 S, more where wide texts need it) with the values v in font f at y and the labels l at ly: the
    // outer ones inside the circle, none touching the next; -1 when they do not fit
    function colDx(dc as Dc, S as Number, v as Array<String>, l as Array<String>, f, y, ly, pad) as Float {
        var w = 0;
        for (var j = 0; j < 3; j++) { var a = dc.getTextWidthInPixels(v[j], f), b = dc.getTextWidthInPixels(l[j], XT); if (a > w) { w = a; } if (b > w) { w = b; } }
        var h1 = half(S, y - up(dc, f), y + dn(dc, f, "0"), R0), h2 = half(S, ly - up(dc, XT), ly + dn(dc, XT, "G"), R0), hw = h1 < h2 ? h1 : h2;
        var need = w + gap(S) + pad, want = S * 0.23 > need ? S * 0.23 : need, dx = hw - w / 2.0;
        if (dx > want) { dx = want; }
        return dx < need ? -1.0 : dx.toFloat();
    }
    function drawRsum(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var s = F.rsum, c = S / 2;
        if (s == null) { return; }
        var sp = strOf(s["sp"]), t = numOf(s["t"]), d = fltOf(s["d"]), kc = rnd(fltOf(s["kcal"]));
        var v = [kmTxt(d), "", ""] as Array<String>, l = ["KM", "", ""] as Array<String>;
        if (sp.equals("ride")) { v[1] = (t > 0 ? d / t * 3.6 : 0.0).format("%.1f"); l[1] = "KM/H"; v[2] = rnd(fltOf(s["avgPw"])).toString(); l[2] = "AVG W"; }
        else if (sp.equals("run")) { v[1] = Fields.pace(t.toFloat(), d); l[1] = "/KM"; v[2] = kc.toString(); l[2] = "KCAL"; }
        else { v[1] = kc.toString(); l[1] = "KCAL"; v[2] = numOf(s["laps"]).toString(); l[2] = "LAPS"; }
        var sf = byInk(dc, [SM, XT], S * 0.1), sy = S * 0.16 > up(dc, sf) + S * 0.1 ? S * 0.16 : up(dc, sf) + S * 0.1; put(dc, c, sy, sf, "SAVED", S, P.acc, false, R0);
        var dy = S * 0.87, bt = dy - up(dc, XT) - gap(S), nm = sp.equals("other") ? strOf(s["name"]) : F.homeLabel(sp), ct = clock(t);
        // the time, TIME, three numbers with labels, the sport, DONE: TIME goes first, then DONE, then the time gets smaller, then the sport goes
        for (var lvl = 0; lvl < 4; lvl++) {
            var tl = lvl < 1, dn0 = lvl < 2, nmOn = lvl < 3, tf = topFont(dc, ct, lvl < 2 ? [NME, NMI, ME] : [NMI, ME, SM], (S * 0.8).toNumber(), lvl < 2 ? S * 0.2 : S * 0.12, sy + dn(dc, sf, "S"), S * 0.33);
            var ty = below(dc, sy + dn(dc, sf, "S"), tf, S * 0.33), ly = below(dc, ty + dn(dc, tf, "0"), XT, S * 0.435), lim = dn0 ? bt : S * (0.5 + R0);
            var cy0 = tl ? ly + dn(dc, XT, "T") : ty + dn(dc, tf, "0"), cb = cols(dc, S, P, v, l, cy0, S * 0.52, lim, [ME, SM, XT], false);
            var nf = byInk(dc, [SM, XT], S * 0.1), ny = below(dc, cb, nf, S * 0.76);
            if ((cb < 0 || (nmOn && ny + dn(dc, nf, nm) > lim)) && lvl < 3) { continue; }
            txt(dc, c, ty, tf, ct, P.fg);
            if (tl) { put(dc, c, ly, XT, "TIME", S, P.lbl, false, R0); }
            cols(dc, S, P, v, l, cy0, S * 0.52, lim, [ME, SM, XT], true);
            if (!nmOn) { return; }
            put(dc, c, ny, nf, nm, (S * 0.6).toNumber(), P.acc, true, R0);
            if (dn0) { put(dc, c, dy, XT, "DONE", S, P.lbl, false, R0); }
            return;
        }
    }
    /* ---- 23.11.: the indoor trainer ---- */
    // the trainers nearby (FTMS first) while searching, else the state of the one chosen with START to ride
    function drawTScan(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var L = F.link, v = L.shown(), c = S / 2, G = gap(S);
        if (v == TL_SCAN || v == TL_OFF) {
            var n = L.list.size();
            if (n > 0) {
                var sub = F.sel < n && L.list[F.sel]["ftms"] == true ? "Smart trainer, ERG|Smart trainer" : "Power only, no ERG|Power only";
                list(dc, F, S, P, F.listItems(), "INDOOR TRAINER", "TRAINER", false, sub, "Searching, START connects|Searching", []);
                return;
            }
            var tt = alt(dc, "INDOOR TRAINER", "TRAINER", XT, roomC(dc, c, S * 0.12, XT, "I", R0)); put(dc, c, S * 0.12, XT, tt, S, P.dim, false, R0);
            dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, S * 0.3, S * 0.07); icon(dc, "trainer", c, S * 0.3, S * 0.085, P.ink);
            var f = byInk(dc, [ME, SM, XT], S * 0.12), y = below(dc, S * 0.37, f, S * 0.45); put(dc, c, y, f, "Searching", S, P.fg, false, R0);
            var y1 = below(dc, y + dn(dc, f, "g"), XT, S * 0.56); put(dc, c, y1, XT, "Pedal a few turns", S, P.lbl, false, R0);
            var y2 = below(dc, y1 + dn(dc, XT, "P"), XT, S * 0.62), m = roomC(dc, c, y2, XT, "k", R0);
            put(dc, c, y2, XT, alt(dc, "to wake the trainer", "to wake it up", XT, m), S, P.lbl, false, R0);
            return;
        }
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, S * 0.24, S * 0.1); icon(dc, "trainer", c, S * 0.24, S * 0.12, P.ink);
        var a = "", col = P.fg, b = "", d = "";
        if (v == TL_CONN) { a = "Connecting"; b = "Taking control"; }
        else if (v == TL_READY) { a = "Connected"; col = P.good; b = L.ctl ? "ERG ready" : "Power only, no ERG|Power only"; }
        var nm = F.tw >= 0 && (v == TL_CONN || v == TL_READY); // 27.11.: the choice made while connecting (S_TPICK), START rides it
        if (nm) { var rl = F.rideList(); d = F.tw > 0 && F.tw <= rl.size() ? strOf(rl[F.tw - 1]["n"]) : FREE_RIDE; }
        else if (v == TL_REFUSED) { a = "Refuses control"; col = P.bad; b = "Another app controls it.|Another app has it.|App in use"; d = "Close it, or ride without ERG|Or ride without ERG|Or ride, no ERG"; }
        else if (v == TL_LOST) { a = "Lost, reconnecting|Lost"; col = P.bad; b = "Keeps trying"; }
        var start = v == TL_READY || v == TL_REFUSED, py = S * 0.81, ph = S * 0.13, bt = 0.0;
        if (start) { startHint(dc, S, P); pill(dc, c, py, S * 0.42, ph, P.acc); put(dc, c, py, inPill(dc, "START", [SM, XT], S * 0.38, ph), "START", S, P.ink, false, R0); bt = py - ph / 2.0 - G; }
        else { var by = S * 0.82; put(dc, c, by, XT, "BACK: the list", S, P.lbl, false, R0); bt = by - up(dc, XT) - G; }
        var nf = byInk(dc, [SM, XT], S * 0.1), ny = below(dc, S * 0.34, nf, S * 0.4); put(dc, c, ny, nf, L.name, (S * 0.74).toNumber(), P.fg, true, R0);
        var a0 = first(a), af = topFont(dc, a0, [ME, SM, XT], (S * 0.8).toNumber(), S * 0.13, ny + dn(dc, nf, L.name), S * 0.52), ay = below(dc, ny + dn(dc, nf, L.name), af, S * 0.52);
        put(dc, c, ay, af, a, (S * 0.8).toNumber(), col, false, R0);
        var yb = ay + dn(dc, af, a0), lines = [b, d] as Array<String>;
        for (var i = 0; i < 2; i++) {
            if (lines[i].length() == 0) { continue; }
            var y = below(dc, yb, XT, S * (i == 0 ? 0.61 : 0.675)), m = roomC(dc, c, y, XT, "g", R0), t = pick(dc, lines[i], XT, m < (S * 0.74).toNumber() ? m : (S * 0.74).toNumber(), false);
            if (y + dn(dc, XT, t) > bt) { break; }
            put(dc, c, y, XT, t, (S * 0.74).toNumber(), i == 0 ? P.fg : (nm ? P.acc : P.lbl), i == 1 && nm, R0); yb = y + dn(dc, XT, t);
        }
    }
    // 27.11.2: the heart rate step: the heart, Searching (where a strap is paired) or Connected with the value, START / SKIP
    function drawTHr(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var c = S / 2, on = F.hrOn(now), w = (S * 0.74).toNumber();
        put(dc, c, S * 0.12, XT, "HEART RATE|HR", S, P.dim, false, R0);
        dc.setColor(on ? P.hr : P.faint, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, S * 0.3, S * 0.09); heart(dc, c, S * 0.3, S * 0.1, on ? P.ink : P.fg);
        var a = on ? "Connected" : "Searching", f = byInk(dc, [ME, SM, XT], S * 0.12), y = below(dc, S * 0.39, f, S * 0.47); put(dc, c, y, f, a, S, on ? P.good : P.fg, false, R0);
        var b = on ? F.hr.toString() + " bpm" : "Strap: watch menu, Sensors|Pair it in Sensors|In Sensors", y1 = below(dc, y + dn(dc, f, "g"), XT, S * 0.58);
        put(dc, c, y1, XT, b, w, on ? P.fg : P.lbl, false, R0);
        if (!on) { var y2 = below(dc, y1 + dn(dc, XT, "g"), XT, S * 0.65); put(dc, c, y2, XT, "or ride without", w, P.lbl, false, R0); }
        var py = S * 0.81, ph = S * 0.13, t = on ? "START" : "SKIP";
        startHint(dc, S, P); pill(dc, c, py, S * 0.42, ph, P.acc); put(dc, c, py, inPill(dc, t, [SM, XT], S * 0.38, ph), t, S, P.ink, false, R0);
    }
    // 27.11.2: two small marks at the very top of the ride: the trainer (green connected, white without control, red lost) and the heart
    // (red while a heart rate comes, grey without)
    function linkMarks(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var v = F.link.shown(), y = S * 0.046;
        icon(dc, "trainer", S / 2 - S * 0.04, y, S * 0.045, v == TL_READY ? P.good : (v == TL_REFUSED ? P.fg : P.bad));
        heart(dc, S / 2 + S * 0.04, y, S * 0.036, F.hrOn(now) ? P.hr : P.dim);
    }
    // 28.11. (27.11.3, js drawTRec): the ride's pages (F.tPages: the target page first, then the phone's choice of workout, body, stats),
    // the edge ring, the dots and the trainer / heart marks on every page
    function drawTRec(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var R = F.tr;
        if (R == null) { return; }
        var pg = F.tPages(), n = pg.size(), id = pg[R.pg % n];
        trRing(dc, F, S, P, n, id.equals("wk")); pageDots(dc, S, P, n, R.pg % n); linkMarks(dc, F, S, P, now);
        if (id.equals("wk") && F.wk != null) { trWork(dc, F, S, P, now); }
        else if (id.equals("body")) { trBody(dc, F, S, P, now); }
        else if (id.equals("stats")) { trStats(dc, S, P, R); }
        else { trTarget(dc, F, S, P, now); }
    }
    // 28.11.: the step kinds' colours, the workout builder's (js/myworkouts.js STEP_TYPES): work = the accent (orange), warm-up yellow,
    // cool-down blue, recovery / rest green (MIP: the 64-colour palette's nearest)
    function kindCol(P as Palette, k as Number) as Number { return k == 1 ? P.acc : (k == 2 ? P.wWarm : (k == 3 ? P.wCool : P.wRec)); }
    // a band on the bezel from p0 to p1 degrees clockwise from 12 o'clock, in pieces of at most 180 degrees (none under 1: an arc from a
    // degree to itself would be a whole circle), the page dots' gap (ga degrees each side of 9 o'clock) left out
    // VERIFY (Dc.drawArc, ARC_CLOCKWISE): degrees counter-clockwise from 3 o'clock, drawn clockwise from degreeStart to degreeEnd (as recRing)
    function arcP(dc as Dc, S as Number, col as Number, p0, p1, ga as Number) as Void {
        var c = S / 2, r = S / 2 - (S * 0.01).toNumber();
        dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.02));
        var cuts = ga > 0 ? [[p0, p1 < 270 - ga ? p1 : 270 - ga], [p0 > 270 + ga ? p0 : 270 + ga, p1]] as Array<Array> : [[p0, p1]] as Array<Array>;
        for (var j = 0; j < cuts.size(); j++) {
            var a = cuts[j][0].toFloat(), b = cuts[j][1].toFloat();
            while (b - a >= 1) {
                var e = b - a > 180 ? a + 180 : b, d0 = (90 - a + 720).toNumber() % 360, d1 = (90 - e + 720).toNumber() % 360;
                if (d0 != d1) { dc.drawArc(c, c, r, Graphics.ARC_CLOCKWISE, d0, d1); }
                a = e;
            }
        }
        dc.setPenWidth(1);
    }
    // 28.11. (the owner: "a progress bar along the edge that runs down like a timer"): in a workout the time left as a band that ends at 12
    // o'clock and shrinks from its front, in the step kinds' colours (grey while paused) over a faint track: whole = the whole workout (its
    // steps still to come), else the step now. A free ride has nothing to count down: the short recording arc at the top, as on a run.
    function trRing(dc as Dc, F as Flow, S as Number, P as Palette, n as Number, whole as Boolean) as Void {
        var R = F.tr, W = F.wk;
        if (R == null) { return; }
        if (W == null || W.i >= W.dur.size()) { recRing(dc, S, P, R.st == RS_RUN); return; }
        var ga = n > 1 ? (n - 1) * 5 + 6 : 0, run = R.st == RS_RUN;
        arcP(dc, S, P.faint, 0, 360, ga);
        if (!whole) { var d = W.dur[W.i], lf = W.left(R.t); arcP(dc, S, run ? kindCol(P, W.kd[W.i]) : P.dim, 360 - 360.0 * lf / d, 360, ga); return; }
        var k0 = 360.0 / W.tot, s = W.s0, from = R.t * k0, col = -1;
        for (var k = W.i; k < W.dur.size(); k++) {
            var ck = run ? kindCol(P, W.kd[k]) : P.dim;
            if (ck != col) { if (col >= 0) { arcP(dc, S, col, from, s * k0, ga); } col = ck; from = s * k0 > from ? s * k0 : from; }
            s += W.dur[k];
        }
        if (col >= 0) { arcP(dc, S, col, from, 360, ga); }
    }
    // 28.11.: a small - / + button (the owner: "too big, write the step inside"): a faint pill w x h with the step in it ("-5", "+25") in the
    // largest font that fits it; where none does (font size setting) the drawn sign (the fonts may have no minus sign, the hyphen they have)
    function trBtn(dc as Dc, S as Number, P as Palette, x, y, t as String, plus as Boolean) as Void {
        var w = S * 0.16, h = S * 0.11, tp = "+" + (t.substring(1, t.length()) as String), f = inPill(dc, tp, [SM, XT], w - 6, h); // both buttons in the font the wider "+25" fits
        pill(dc, x, y, w, h, P.faint);
        if (dc.getTextWidthInPixels(tp, f) <= w - 6 && up(dc, f) <= h / 2 - 1 && dn(dc, f, tp) <= h / 2 - 1) { txt(dc, x, y, f, t, P.fg); return; }
        var k = S * 0.025; dc.setColor(P.fg, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.014)); dc.drawLine(x - k, y, x + k, y); if (plus) { dc.drawLine(x, y - k, x, y + k); } dc.setPenWidth(1);
    }
    // the target page, the overview (the owner: "one sheet with everything"): the time left in the step (a free ride: the ride's time) with
    // the ring, the step's label (a ramp: "WARM-UP 100 TO 180 W"), the target big with small - / + buttons that carry the step, the offset
    // under it (only when there is one), the trainer's power, cadence and heart rate, the next step (a free ride: the average).
    // gT0 .. gT1: the target's zone (the taps on - / + / the target, the wheel)
    function trTarget(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var R = F.tr;
        if (R == null) { return; }
        var L = F.link, v = L.shown(), paused = R.st != RS_RUN, c = S / 2, G = gap(S), W = F.wk;
        // 27.11.: in a workout the time left in the step (orange in a hard one), its label / counter, the offset, the next step and the time left
        var ct = clock(W != null ? W.left(R.t) : R.t), tf = fontIn(dc, ct, [NMI, ME, SM, XT], (S * 0.5).toNumber(), S * 0.1), ty = S * 0.13 > up(dc, tf) + S * 0.075 ? S * 0.13 : up(dc, tf) + S * 0.075;
        put(dc, c, ty, tf, ct, S, W != null && W.isHard() ? P.acc : P.fg, false, R0);
        var warn = v == TL_LOST ? "LOST, RECONNECTING|LOST" : (v == TL_REFUSED ? "NO CONTROL, OTHER APP|NO CONTROL" : (!L.ctl ? "POWER ONLY, NO ERG|NO ERG" : (paused ? "PAUSED" : "")));
        var done = W == null && F.wkDone > now, lab = done ? "WORKOUT DONE" : "TARGET W";
        if (W != null) { lab = W.shown(); }
        var wc = warn.length() == 0 ? (done ? P.good : (W != null ? P.fg : P.lbl)) : (paused && L.ctl && v != TL_LOST && v != TL_REFUSED ? P.acc : P.bad);
        var wh = wheelOn(F, 0), ly = below(dc, ty + dn(dc, tf, "0"), XT, S * 0.205), lp = warn.length() > 0 ? warn : lab, lm = roomC(dc, c, ly, XT, "W", R0);
        if (!wh) { put(dc, c, ly, XT, warn.length() == 0 && W != null ? lp : alt(dc, first(lp), pick(dc, lp, XT, 0, false), XT, lm), S, wc, warn.length() == 0 && W != null, R0); }
        // the bottom: AVG / the resume pill (a workout: the time left, the next step above it), the three numbers with labels, the separator
        var by = S * 0.85, bt = 0.0;
        if (paused) { var ph = S * 0.1; pill(dc, c, by, S * 0.44, ph, P.acc); put(dc, c, by, inPill(dc, "START", [XT], S * 0.4, ph), "START resume|Resume", S * 0.4, P.ink, false, R0); bt = by - ph / 2.0 - G; }
        else if (W != null) {
            var tl = clock(W.totLeft(R.t)), nw = W.nextW(), nx = "LAST STEP";
            if (nw >= 0) { var nd = clock(W.dur[W.i + 1]), ns = nw.toString() + " W"; nx = "NEXT " + ns + ", " + nd + "|" + ns + ", " + nd + "|" + ns; }
            // the time left goes where the font size setting leaves no room for two lines
            if (inkH(dc, XT) <= S * 0.08) { put(dc, c, by, XT, tl + " LEFT|" + tl, S, P.lbl, false, R0); var ny = above(dc, by - up(dc, XT), XT, "g", S); put(dc, c, ny, XT, nx, S, P.fg, false, R0); bt = ny - up(dc, XT) - G; }
            else { put(dc, c, by, XT, nx, S, P.fg, false, R0); bt = by - up(dc, XT) - G; }
        }
        else { var ap = "AVG " + R.avgPw().toString(); put(dc, c, by, XT, ap + " W, " + rnd(R.kj).toString() + " kJ|" + ap + " W|" + ap, S, P.lbl, false, R0); bt = by - up(dc, XT) - G; }
        // the three numbers: the largest font whose row and labels fit 0.2 S and the circle (WATTS is W where it does not); 28.11.: no
        // cadence from the trainer = "--" (a 0 would say "not pedalling")
        var vals = [L.livePw(now).toString(), L.hasCad(now) ? L.liveCad(now).toString() : "--", F.hr > 0 ? F.hr.toString() : "--"] as Array<String>, vfs = [NMI, ME, SM, XT], vl = above(dc, bt, XT, "G", S * 0.735);
        var labs = ["WATTS", "RPM", "BPM"] as Array<String>, vf = XT, vy = 0.0, dx = -1.0, hOn = true;
        for (var pass = 0; pass < 3 && dx < 0; pass++) {
            if (pass == 1) { labs = ["W", "RPM", "BPM"] as Array<String>; }
            if (pass == 2) { hOn = false; }
            for (var i = 0; i < vfs.size(); i++) {
                vf = vfs[i]; vy = above(dc, vl - up(dc, XT), vf, "0", S * 0.655);
                dx = inkH(dc, vf) + G + inkH(dc, XT) <= S * 0.2 || i == vfs.size() - 1 ? colDx(dc, S, vals, labs, vf, vy, vl, hOn ? S * 0.05 : 0) : -1.0;
                if (dx >= 0) { break; }
            }
        }
        if (dx < 0) { dx = S * 0.18; }
        var sep = vy - up(dc, vf) - G - 1;
        for (var i = 0; i < 3; i++) {
            var x = c + (i - 1) * dx;
            txt(dc, x, vy, vf, vals[i], P.fg);
            if (i == 2 && hOn) { heart(dc, x - dc.getTextWidthInPixels("BPM", XT) / 2.0 - S * 0.02, vl, S * 0.03, P.hr); }
            txt(dc, x + (i == 2 && hOn ? S * 0.015 : 0), vl, XT, labs[i], P.lbl);
        }
        dc.setColor(P.line, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.006 > 2 ? S * 0.006 : 2)); dc.drawLine(S * 0.12, sep, S * 0.88, sep); dc.setPenWidth(1);
        // the target between the label and the separator, the small - / + beside it, the offset under it when there is one (the wheel: the
        // neighbours instead)
        // 28.11.: a ramp says so under the target, plain: "WARM-UP" above it, "100 TO 180 W" (with the offset in it) under it, the offset after it
        var aj = W != null ? W.adj() : 0, t = R.tgt.toString(), top = (wh ? ty + dn(dc, tf, "0") : ly + dn(dc, XT, "W")) + G, sf = XT;
        var rp = W != null ? W.ramp() : null, ajt = (aj > 0 ? "+" : "-") + (aj > 0 ? aj : -aj).toString() + " W", ut = aj != 0 ? ajt : "";
        if (rp != null) { var ra = rp[0].toString() + " TO " + rp[1].toString() + " W"; ut = aj != 0 ? ra + ", " + ajt + "|" + ra : ra; }
        var room = sep - G - top - (wh || ut.length() == 0 ? 0 : inkH(dc, sf) + G), gf = numIn(dc, [t], [NTH, NHO, NME, NMI], [(S * 0.44).toNumber()], [c], top, top + room, R0), gy = numY(dc, gf, top, top + room);
        txt(dc, c, gy, gf, t, paused ? P.dim : P.acc); $.gT0 = top / S; $.gT1 = sep / S;
        var xs = [0.16, 0.84] as Array<Float>;
        for (var i = 0; i < 2; i++) { trBtn(dc, S, P, S * xs[i], gy, (i == 0 ? "-" : "+") + R.step.toString(), i == 1); }
        if (wh) {
            for (var dd = -1; dd <= 1; dd += 2) {
                var w = W != null ? R.tgt + dd * R.step : R.nextTarget(dd, false);
                if (w == R.tgt) { continue; }
                var yy = dd < 0 ? above(dc, gy - up(dc, gf), XT, "0", S) : below(dc, gy + dn(dc, gf, "0"), XT, 0);
                if (yy - up(dc, XT) >= ty + dn(dc, tf, "0") + G && yy + dn(dc, XT, "0") <= sep - G) { txt(dc, c, yy, XT, w.toString(), P.dim); }
            }
        } else if (ut.length() > 0) {
            put(dc, c, below(dc, gy + dn(dc, gf, "0"), sf, 0), sf, ut, (S * 0.8).toNumber(), P.fg, false, R0); // clear of the page dots
        }
    }
    // 28.11.: the workout page (where am I, what comes next, how long is left): the repeat's counter (else the step's label), the target and
    // the time left in the step, the workout as blocks under a magnifying glass (the step now wide in the middle with its progress and a
    // marker, four steps each side narrower towards the edges; height = target watts, ramps as slopes, the step kinds' colours, done ones
    // grey), NEXT with its watts and length, the time left of the whole workout (the ring: the whole workout)
    function trWork(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var R = F.tr, W = F.wk;
        if (R == null || W == null) { return; }
        var c = S / 2, G = gap(S), i = W.i, n = W.dur.size(), run = R.st == RS_RUN;
        if (i >= n) { return; }
        var ly = S * 0.15 > up(dc, XT) + S * 0.1 ? S * 0.15 : up(dc, XT) + S * 0.1, cn = W.cnt[i], k = cn.find(","), lm = roomC(dc, c, ly, XT, cn, R0);
        // the counter "5/13, SET 2/3", where it does not fit "5/13"; outside repeats the step's label
        var lab = cn;
        if (cn.length() == 0) { lab = W.shown(); }
        else if (k != null && k > 0 && dc.getTextWidthInPixels(cn, XT) > (lm < (S * 0.62).toNumber() ? lm : (S * 0.62).toNumber())) { lab = cn.substring(0, k) as String; }
        put(dc, c, ly, XT, lab, (S * 0.62).toNumber(), W.hard[i] ? P.acc : P.lbl, true, R0);
        // the target and the time left in the step: one line, one font
        var tw = R.tgt.toString() + " W", tl = clock(W.left(R.t)), sp = S * 0.06, fs = [ME, SM, XT], f2 = XT, y2 = 0.0;
        for (var j = 0; j < fs.size(); j++) {
            f2 = fs[j]; y2 = below(dc, ly + dn(dc, XT, lab), f2, 0);
            if (dc.getTextWidthInPixels(tw, f2) + sp + dc.getTextWidthInPixels(tl, f2) <= roomC(dc, c, y2, f2, tw + tl, R0) && inkH(dc, f2) <= S * 0.12) { break; }
        }
        var w1 = dc.getTextWidthInPixels(tw, f2), x0 = c - (w1 + sp + dc.getTextWidthInPixels(tl, f2)) / 2.0;
        txtL(dc, x0, y2, f2, tw, run ? P.acc : P.dim); txtL(dc, x0 + w1 + sp, y2, f2, tl, P.fg);
        // the bottom: the time left of the workout (where two lines fit), NEXT above it
        var by = S * 0.84, nw = W.nextW(), nx = "LAST STEP", tot = clock(W.totLeft(R.t)), ny = by;
        if (nw >= 0) { var nd = clock(W.dur[i + 1]), ns = nw.toString() + " W"; nx = "NEXT " + ns + ", " + nd + "|" + ns + ", " + nd + "|" + ns; }
        if (inkH(dc, XT) <= S * 0.08) { put(dc, c, by, XT, tot + " LEFT|" + tot, S, P.lbl, false, R0); ny = above(dc, by - up(dc, XT), XT, "g", S); }
        put(dc, c, ny, XT, nx, S, P.fg, false, R0);
        // the magnifying glass between them
        var top = y2 + dn(dc, f2, "0") + 3 * G, bot = ny - up(dc, XT) - 2 * G;
        if (bot - top < S * 0.06) { return; }
        var hw = half(S, top, bot, 0.44), mw = 2 * hw * 0.32, sw = (2 * hw - mw) / 2.0, g = pw(S * 0.008), fr = [0.36, 0.27, 0.21, 0.16] as Array<Float>;
        var mx = 1;
        for (var q = i - 4; q <= i + 4; q++) { if (q < 0 || q >= n) { continue; } var a = W.plat(q, 0), b = W.plat(q, W.dur[q]); if (a > mx) { mx = a; } if (b > mx) { mx = b; } }
        for (var d = -4; d <= 4; d++) {
            var q = i + d, ad = d < 0 ? -d : d;
            if (q < 0 || q >= n) { continue; }
            var xa = c - mw / 2.0, xb = c + mw / 2.0;
            if (d != 0) { var o = mw / 2.0; for (var j = 1; j < ad; j++) { o += sw * fr[j - 1]; } var wd = sw * fr[ad - 1]; xa = d < 0 ? c - o - wd : c + o; xb = xa + wd; }
            xa += g / 2.0; xb -= g / 2.0;
            var ha = trH(top, bot, W.plat(q, 0), mx), hb = trH(top, bot, W.plat(q, W.dur[q]), mx), col = kindCol(P, W.kd[q]);
            if (d != 0) { dc.setColor(d < 0 ? P.faint : col, Graphics.COLOR_TRANSPARENT); dc.fillPolygon([[xa, bot], [xa, bot - ha], [xb, bot - hb], [xb, bot]]); continue; }
            var into = R.t - W.s0, f = into <= 0 ? 0.0 : (into >= W.dur[q] ? 1.0 : into * 1.0 / W.dur[q]), xs = xa + (xb - xa) * f, hs = trH(top, bot, W.plat(q, into), mx);
            if (xs - xa >= 1) { dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT); dc.fillPolygon([[xa, bot], [xa, bot - ha], [xs, bot - hs], [xs, bot]]); }
            if (xb - xs >= 1) { dc.setColor(run ? col : P.dim, Graphics.COLOR_TRANSPARENT); dc.fillPolygon([[xs, bot], [xs, bot - hs], [xb, bot - hb], [xb, bot]]); }
            dc.setColor(P.fg, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.008)); dc.drawLine(xs, top, xs, bot); dc.setPenWidth(1);
            tri(dc, xs, top, S * 0.018, false, P.fg);
        }
    }
    // a block's height for w watts (the highest shown = the whole height top .. bot), at least 2 px
    function trH(top, bot, w as Number, mx as Number) as Float { var h = (bot - top) * w / mx.toFloat(); return h > 2 ? h.toFloat() : 2.0; }
    // 28.11.: the body page (how is my body doing): the ride's time, the heart rate big with the heart, its average and max, then cadence,
    // average power and kJ in a row
    function trBody(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var R = F.tr;
        if (R == null) { return; }
        var L = F.link, c = S / 2, G = gap(S);
        var ct = clock(R.t), tf = fontIn(dc, ct, [NMI, ME, SM, XT], (S * 0.44).toNumber(), S * 0.1), ty = S * 0.15 > up(dc, tf) + S * 0.085 ? S * 0.15 : up(dc, tf) + S * 0.085;
        put(dc, c, ty, tf, ct, S, P.fg, false, R0);
        var ly = below(dc, ty + dn(dc, tf, "0"), XT, 0); put(dc, c, ly, XT, "RIDE TIME|TIME", S, P.lbl, false, R0);
        // the row at the bottom: the largest font whose numbers and labels fit the circle
        var v = [L.hasCad(now) ? L.liveCad(now).toString() : "--", R.avgPw().toString(), rnd(R.kj).toString()] as Array<String>, fs = [ME, SM, XT];
        var l = ["RPM", "AVG W", "KJ"] as Array<String>, vf = XT, vy = 0.0, vl = 0.0, dx = -1.0;
        for (var pass = 0; pass < 2 && dx < 0; pass++) {
            if (pass == 1) { l = ["RPM", "W", "KJ"] as Array<String>; }
            for (var i = 0; i < fs.size() && dx < 0; i++) {
                vf = fs[i]; vy = S * 0.68; vl = below(dc, vy + dn(dc, vf, "0"), XT, 0);
                if (vl + dn(dc, XT, "G") > S * 0.9) { vy = vy - (vl + dn(dc, XT, "G") - S * 0.9); vl = below(dc, vy + dn(dc, vf, "0"), XT, 0); }
                dx = colDx(dc, S, v, l, vf, vy, vl, S * 0.03);
            }
        }
        if (dx < 0) { dx = S * 0.2; }
        for (var j = 0; j < 3; j++) { txt(dc, c + (j - 1) * dx, vy, vf, v[j], P.fg); txt(dc, c + (j - 1) * dx, vl, XT, l[j], P.lbl); }
        // the average and max heart rate above the row, the heart rate big between
        var am = R.hrN > 0 ? rnd(R.hrSum.toFloat() / R.hrN) : 0, at = "AVG " + orDash(am) + ", MAX " + orDash(R.hrMax) + "|" + orDash(am) + " / " + orDash(R.hrMax);
        var ay = above(dc, vy - up(dc, vf) - G, XT, "g", S); put(dc, c, ay, XT, at, S, P.lbl, false, R0);
        var top = ly + dn(dc, XT, "T") + G, bt = ay - up(dc, XT) - G, h = F.hr > 0 ? F.hr.toString() : "--", hx = c + S * 0.04;
        var hf = numIn(dc, [h], [NTH, NHO, NME, NMI], [(S * 0.5).toNumber()], [hx], top, bt, R0), hy = numY(dc, hf, top, bt), hs = S * 0.06;
        txt(dc, hx, hy, hf, h, P.fg);
        heart(dc, hx - dc.getTextWidthInPixels(h, hf) / 2.0 - G - hs * 0.7, hy, hs, F.hr > 0 ? P.hr : P.dim);
    }
    // 27.11.: the trainer's choice: a free ride (one target) or a workout (its length under it); while connecting it says so
    function drawTPick(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var l = F.rideList(), v = F.link.shown(), m = 0, sub = "One target, + / - change it|One target";
        if (F.sel > 0 && F.sel <= l.size()) { m = (wkDur(l[F.sel - 1]["s"]) + 30) / 60; sub = m.toString() + " min"; }
        list(dc, F, S, P, F.listItems(), "INDOOR TRAINER", "TRAINER", false, sub, null, v == TL_READY || v == TL_REFUSED ? [] : [["Still connecting|Connecting|Wait", P.lbl, false]]);
    }
    function orDash(n as Number) as String { return n > 0 ? n.toString() : "--"; }
    // the ride's second page: this target's block (time, avg power), then the whole ride
    function trStats(dc as Dc, S as Number, P as Palette, R as TRide) as Void {
        var c = S / 2, G = gap(S), bAvg = R.bN > 0 ? rnd(R.bSum.toFloat() / R.bN) : 0, sm = R.sum();
        var af = byInk(dc, [SM, XT], S * 0.1), ay = S * 0.17 > up(dc, af) + S * 0.09 ? S * 0.17 : up(dc, af) + S * 0.09; put(dc, c, ay, af, "AT " + R.tgt.toString() + " W", S, P.acc, false, R0);
        var v1 = [R.avgPw().toString(), R.pwMax.toString(), rnd(R.kj).toString()] as Array<String>, v2 = [orDash(numOf(sm["np"])), orDash(numOf(sm["cad"])), orDash(numOf(sm["hr"]))] as Array<String>;
        // the block's time, its average, the separator, two rows of three: the numbers' font shrinks first, then the time, then the average
        // goes, then the second row
        var FS3 = [[ME, SM, XT], [SM, XT], [XT]] as Array<Array>, l1 = ["AVG W", "MAX W", "KJ"] as Array<String>, l2 = ["NP", "RPM", "AVG HR"] as Array<String>, bc = clock(R.t - R.bT0);
        for (var q = 0; q < 12; q++) {
            var lvl = q < 9 ? q / 3 : 2, fs = FS3[q % 3], two = q < 9;
            var tf = fontIn(dc, bc, [NME, NMI, ME, SM], (S * 0.7).toNumber(), lvl == 0 ? S * 0.2 : S * 0.14), ty = below(dc, ay + dn(dc, af, "A"), tf, S * 0.3);
            var ly = below(dc, ty + dn(dc, tf, "0"), XT, S * 0.41), lt = bAvg.toString() + " W avg at this target|" + bAvg.toString() + " W avg";
            var sep = (lvl < 2 ? ly + dn(dc, XT, "g") : ty + dn(dc, tf, "0")) + G + 1;
            var b1 = cols(dc, S, P, v1, l1, sep + 1, S * 0.58, S * (0.5 + R0), fs, false);
            var b2 = b1 < 0 || !two ? -1.0 : cols(dc, S, P, v2, l2, b1, 0, S * 0.9, fs, false);
            if ((two ? b2 : b1) < 0 && q < 11) { continue; }
            txt(dc, c, ty, tf, bc, P.fg);
            if (lvl < 2) { put(dc, c, ly, XT, lt, S, P.lbl, false, R0); }
            dc.setColor(P.line, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.006 > 2 ? S * 0.006 : 2)); dc.drawLine(S * 0.12, sep, S * 0.88, sep); dc.setPenWidth(1);
            var c1 = cols(dc, S, P, v1, l1, sep + 1, S * 0.58, S * (0.5 + R0), fs, true);
            if (c1 > 0 && two) { cols(dc, S, P, v2, l2, c1, 0, S * 0.9, fs, true); }
            return;
        }
    }
    // BACK on the ride (28.11.: "it must be obvious this is a menu and not a pause"): RIDE MENU, the line under the rows says the ride goes
    // on ("Riding 12:34, 180 W", green; "Paused 12:34", orange); Back to ride (Resume when paused), +5 W, -5 W (27.11.5), Finish & save,
    // Discard (asks once more)
    function drawTEnd(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var R = F.tr, ex = [] as Array;
        // 27.11.5: the target the menu's + / - change, in a workout with its offset: "Riding 12:34, 285 W (+10)"
        if (R != null) {
            var run = R.st == RS_RUN, a = (run ? "Riding " : "Paused ") + clock(R.t), W = F.wk, aj = W != null ? W.adj() : 0;
            var w = R.tgt.toString() + " W" + (aj != 0 ? " (" + sgnTxt(aj) + ")" : "");
            ex = [[a + ", " + w + "|" + w, run ? P.good : P.acc, false]] as Array;
        }
        list(dc, F, S, P, F.listItems(), F.tConf ? "DISCARD RIDE?" : "RIDE MENU", F.tConf ? "DISCARD?" : "MENU", true, null, null, ex);
    }
    /* ---- 27.11.4: the summary after a trainer ride, one question per page (js drawTSum ... tsPw; Flow.tsPages, F.sel = the page): what
     *      did I do (ov), did I hit the targets, did I fade (iv: a workout), how hard was it for my body (hr), what were my numbers (pw, the
     *      last: DONE). The page dots on the left as on the ride; UP / DOWN page, START / BACK done ---- */
    function drawTSum(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var s = F.tsum;
        if (s == null) { return; }
        var pg = F.tsPages(), n = pg.size(), i = F.sel % n, id = pg[i], last = i == n - 1;
        pageDots(dc, S, P, n, i);
        if (id.equals("iv")) { tsIv(dc, S, P, s, last); }
        else if (id.equals("hr")) { tsHr(dc, S, P, s, last); }
        else if (id.equals("pw")) { tsPw(dc, S, P, s, last); }
        else { tsOver(dc, S, P, s, last); }
    }
    // a page's title (XTINY, the accent) at the top; its ink bottom
    function tsHead(dc as Dc, S as Number, P as Palette, t as String) as Float {
        var y0 = S * 0.13 > up(dc, XT) + S * 0.09 ? S * 0.13 : up(dc, XT) + S * 0.09, y = downTo(dc, XT, first(t), y0, R0);
        put(dc, S / 2, y, XT, t, S, P.acc, false, R0);
        return y + dn(dc, XT, "G");
    }
    // the last page's DONE at the bottom (a tap on it: done); the ink top left above it
    function tsDone(dc as Dc, S as Number, P as Palette) as Float {
        var y = S * 0.88;
        put(dc, S / 2, y, XT, "DONE", S, P.lbl, false, R0);
        return y - up(dc, XT) - gap(S);
    }
    // a difference as "+2", "-9", "0"
    function sgnTxt(d as Number) as String { return d > 0 ? "+" + d.toString() : d.toString(); }
    // Monkey C only: js Math.round(a / b) for b > 0 (rnd() rounds -2.5 to -3, js to -2)
    function tsDiv(a as Number, b as Number) as Number { var q = 2 * a + b, d = 2 * b; return q >= 0 ? q / d : -((d - 1 - q) / d); }
    // the units ridden (sets, else intervals: uw > 0)
    function tsUnits(s as Dictionary) as Array<Number> {
        var r = [] as Array<Number>, uw = arrOf(s["uw"]);
        for (var u = 0; u < uw.size(); u++) { if (numOf(uw[u]) > 0) { r.add(u); } }
        return r;
    }
    // row j of k over the n units ridden: its first index (k runs as even as whole units allow)
    function tsFrom(n as Number, k as Number, j as Number) as Number { return j * n / k; }
    // the row's label under SET / #: "2", "1-2"
    function tsLab(U as Array<Number>, a as Number, b as Number) as String {
        return (U[a] + 1).toString() + (a == b ? "" : "-" + (U[b] + 1).toString());
    }
    // js tsTab (27.11.5): a Garmin-style table: the header hh (XTINY, grey) and the rows r (four texts each, in font f; cl[j] the colours of
    // row j's texts; digits and capitals only: no descenders); the first column left-aligned, the others right-aligned, each as wide as its
    // widest text, sp between them, the table centred, a row pitch of the ink and two gaps. The ink bottom, -1 where a line does not fit
    // above bot or inside the circle (at most 0.8 S wide: clear of the page dots)
    function tsTab(dc as Dc, S as Number, P as Palette, hh as Array<String>, r as Array<Array<String>>, cl as Array<Array<Number>>, f, sp, top, bot, draw as Boolean) as Float {
        var G = gap(S), rh = up(dc, f) + dn(dc, f, "0") + 2 * G, n = r.size(), w = [0, 0, 0, 0] as Array<Number>;
        for (var q = 0; q < 4; q++) {
            w[q] = dc.getTextWidthInPixels(hh[q], XT);
            for (var j = 0; j < n; j++) { var x = dc.getTextWidthInPixels(r[j][q], f); if (x > w[q]) { w[q] = x; } }
        }
        var tw = w[0] + w[1] + w[2] + w[3] + 3 * sp, x0 = S / 2.0 - tw / 2.0, hy = top + up(dc, XT), y0 = hy + dn(dc, XT, "0") + 2 * G + up(dc, f);
        if (tw > S * 0.8 || tw > roomC(dc, S / 2, hy, XT, "0", R0)) { return -1.0; }
        for (var j1 = 0; j1 < n; j1++) {
            var y = y0 + j1 * rh;
            if (y + dn(dc, f, "0") > bot || tw > roomC(dc, S / 2, y, f, "0", R0)) { return -1.0; }
        }
        if (draw) {
            var xs = [x0, x0 + w[0] + sp + w[1], x0 + w[0] + w[1] + w[2] + 2 * sp, x0 + tw] as Array;
            for (var j2 = -1; j2 < n; j2++) {
                var t = j2 < 0 ? hh : r[j2], ff = j2 < 0 ? XT : f, y2 = j2 < 0 ? hy : y0 + j2 * rh;
                for (var q2 = 0; q2 < 4; q2++) {
                    var xq = q2 == 0 ? xs[0] : xs[q2] - dc.getTextWidthInPixels(t[q2], ff);
                    txtL(dc, xq, y2, ff, t[q2], j2 < 0 ? P.dim : cl[j2][q2]);
                }
            }
        }
        return y0 + (n - 1) * rh + dn(dc, f, "0");
    }
    // js tsLine (27.11.5): one XTINY line of texts t in the colours cl, centred on y: a small space after the first, third ..., a wider one
    // after the second ("136 AVG  169 MAX", "RECOVERY 60 S -56"); false where it does not fit inside the circle
    function tsLine(dc as Dc, S as Number, P as Palette, y, t as Array<String>, cl as Array<Number>, draw as Boolean) as Boolean {
        var sp = S * 0.022, w = 0.0, n = t.size();
        for (var k = 0; k < n; k++) { w += dc.getTextWidthInPixels(t[k], XT) + (k < n - 1 ? (k % 2 == 1 ? 2 * sp : sp) : 0.0); }
        if (w > roomC(dc, S / 2, y, XT, "0", R0)) { return false; }
        if (draw) {
            var x = S / 2.0 - w / 2.0;
            for (var k1 = 0; k1 < n; k1++) { txtL(dc, x, y, XT, t[k1], cl[k1]); x += dc.getTextWidthInPixels(t[k1], XT) + (k1 % 2 == 1 ? 2 * sp : sp); }
        }
        return true;
    }
    // 1. what did I do: SAVED, the workout's name (or Free ride), the ride's time big, how much of the workout was done (all: green),
    // average power and kJ. Where it does not fit: the numbers' font shrinks, then the time's, then the name goes
    function tsOver(dc as Dc, S as Number, P as Palette, s as Dictionary, last as Boolean) as Void {
        var c = S / 2, bot = last ? tsDone(dc, S, P) : S * 0.9, ct = clock(numOf(s["t"])), wt = numOf(s["wt"]), wk = wt > 0, nm = wk ? strOf(s["wn"]) : "Free ride";
        var sf = byInk(dc, [SM, XT], S * 0.1), sy = S * 0.15 > up(dc, sf) + S * 0.1 ? S * 0.15 : up(dc, sf) + S * 0.1; put(dc, c, sy, sf, "SAVED", S, P.acc, false, R0);
        var ln = "", lc = P.good, ivN = numOf(s["ivN"]), ivD = numOf(s["ivD"]);
        if (wk && ivN > 0) {
            var a = ivD.toString() + "/" + ivN.toString();
            ln = (s["uS"] == true ? a + " INTERVALS, " + numOf(s["uD"]).toString() + "/" + numOf(s["uN"]).toString() + " SETS|" : "") + a + " INTERVALS|" + a;
            lc = ivD >= ivN ? P.good : P.acc;
        } else if (wk) {
            var p = tsDiv(100 * numOf(s["wd"]), wt);
            ln = p.toString() + "% OF THE WORKOUT|" + p.toString() + "%"; lc = p >= 100 ? P.good : P.acc;
        }
        var v = [numOf(s["avgPw"]).toString(), "", numOf(s["kj"]).toString()] as Array<String>, l = ["AVG W", "", "KJ"] as Array<String>;
        var FS3 = [[NME, ME, SM, XT], [ME, SM, XT], [SM, XT]] as Array<Array>;
        for (var q = 0; q < 9; q++) {
            var lvl = q / 3, fs = FS3[q % 3], nmOn = lvl < 2, nf = byInk(dc, [SM, XT], S * 0.1), ny = below(dc, sy + dn(dc, sf, "S"), nf, 0);
            var nb = nmOn ? ny + dn(dc, nf, nm) : sy + dn(dc, sf, "S");
            var tf = topFont(dc, ct, lvl < 1 ? [NME, NMI, ME] : [NMI, ME, SM], (S * 0.8).toNumber(), lvl < 1 ? S * 0.2 : S * 0.13, nb, S * 0.4);
            var ty = below(dc, nb, tf, S * 0.4), yb = ty + dn(dc, tf, "0"), ly = 0.0;
            if (ln.length() > 0) { ly = below(dc, yb, XT, 0); yb = ly + dn(dc, XT, "g"); }
            if (cols(dc, S, P, v, l, yb, S * 0.66, bot, fs, false) < 0 && q < 8) { continue; }
            if (nmOn) { put(dc, c, ny, nf, nm, (S * 0.8).toNumber(), P.fg, true, R0); }
            txt(dc, c, ty, tf, ct, P.fg);
            if (ln.length() > 0) { put(dc, c, ly, XT, ln, (S * 0.8).toNumber(), lc, false, R0); }
            cols(dc, S, P, v, l, yb, S * 0.66, bot, fs, true);
            return;
        }
    }
    // js tsWhat (27.11.5): what the intervals were: "39 x 0:30 @ 370 W", only what they all have in common ("5 x 5:00", "5 INTERVALS @
    // 300 W", "5 INTERVALS"; the target is the one sent)
    function tsWhat(s as Dictionary) as String {
        var n = numOf(s["ivN"]), d = numOf(s["ivS"]), w = numOf(s["ivW"]);
        var a = d > 0 ? n.toString() + " x " + clock(d) : n.toString() + (n == 1 ? " INTERVAL" : " INTERVALS");
        return w > 0 ? a + " @ " + w.toString() + " W|" + a : a;
    }
    // 2. did I hit the targets, did I fade (27.11.5: Garmin's lap table): under the title what the intervals were, then a table, per set
    // (else per interval; more than four: runs of them, "1-2") the average watts without the ramp seconds, the difference to the target
    // (green: at most 5 W under) and the peak heart rate; a set or interval cut short: a grey row. Where it does not fit: narrower columns,
    // the header "W" for "AVG W", the rows' font shrinks, then fewer runs; the table sits a third down the room left where it fits there
    function tsIv(dc as Dc, S as Number, P as Palette, s as Dictionary, last as Boolean) as Void {
        var G = gap(S), top = tsHead(dc, S, P, "INTERVALS"), bot = last ? tsDone(dc, S, P) : S * 0.9, U = tsUnits(s), nu = U.size(), sets = s["uS"] == true;
        var uw = arrOf(s["uw"]), ut = arrOf(s["ut"]), uhp = arrOf(s["uhp"]), udn = arrOf(s["udn"]), ucn = arrOf(s["ucn"]);
        var h0 = sets ? "SET" : "#", what = tsWhat(s), w0 = first(what), FR = [ME, SM, TI, XT] as Array;
        var full = dc.getTextWidthInPixels(w0, TI) <= roomC(dc, S / 2, below(dc, top, TI, 0), TI, w0, R0); // all of it in TINY, else in XTINY where it fits there
        for (var k = nu < 4 ? nu : 4; k >= 0; k--) {
            var r = [] as Array<Array<String>>, cl = [] as Array<Array<Number>>;
            for (var j = 0; j < k; j++) {
                var f = tsFrom(nu, k, j), t = tsFrom(nu, k, j + 1) - 1, w = 0, g = 0, hp = 0, cut = false;
                for (var q = f; q <= t; q++) {
                    var u = U[q], h = numOf(uhp[u]);
                    w += numOf(uw[u]); g += numOf(ut[u]);
                    if (h > hp) { hp = h; }
                    if (u < udn.size() && u < ucn.size() && numOf(udn[u]) < numOf(ucn[u])) { cut = true; }
                }
                w = tsDiv(w, t - f + 1); g = tsDiv(g, t - f + 1);
                r.add([tsLab(U, f, t), w.toString(), sgnTxt(w - g), hp > 0 ? hp.toString() : "--"] as Array<String>);
                cl.add(cut ? [P.dim, P.dim, P.dim, P.dim] as Array<Number> : [P.fg, P.fg, w - g >= -5 ? P.good : P.bad, P.fg] as Array<Number>);
            }
            for (var z = 0; z < 2; z++) {
                var cf = z == (full ? 0 : 1) ? TI : XT, cy = below(dc, top, cf, 0), lo = cy + dn(dc, cf, "0") + 2 * G;
                if (k == 0) { put(dc, S / 2, cy, cf, what, (S * 0.8).toNumber(), P.fg, false, R0); return; }
                for (var st = 0; st < 3; st++) {
                    var hh = [h0, st < 2 ? "AVG W" : "W", "+/-", "HR"] as Array<String>, sp = S * (st == 0 ? 0.06 : 0.035);
                    for (var fi = 0; fi < FR.size(); fi++) {
                        var fr = FR[fi], b = tsTab(dc, S, P, hh, r, cl, fr, sp, lo, bot, false);
                        if (b < 0) { continue; }
                        var mid = lo + (bot - b) / 3.0, tt = tsTab(dc, S, P, hh, r, cl, fr, sp, mid, bot, false) >= 0 ? mid : lo;
                        put(dc, S / 2, cy, cf, what, (S * 0.8).toNumber(), P.fg, false, R0); tsTab(dc, S, P, hh, r, cl, fr, sp, tt, bot, true);
                        return;
                    }
                }
            }
        }
    }
    // 3. how hard was it for my body: average and max heart rate; with the profile's zones the time in each (tsZones), else the heart rate
    // over the ride; one line with the recovery (the average drop in the 60 s after the sets / intervals, where one was measured). No heart
    // rate: one line. Where it does not fit: the numbers' font shrinks, then they go on one line ("136 AVG  169 MAX"), then the recovery
    // line goes, then the zones / the curve
    function tsHr(dc as Dc, S as Number, P as Palette, s as Dictionary, last as Boolean) as Void {
        var c = S / 2, G = gap(S), top = tsHead(dc, S, P, "HEART RATE|HR"), bot = last ? tsDone(dc, S, P) : S * 0.9;
        if (numOf(s["hr"]) <= 0) {
            dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, S * 0.38, S * 0.09); heart(dc, c, S * 0.38, S * 0.1, P.dim);
            var nf = byInk(dc, [SM, XT], S * 0.1), ny0 = below(dc, S * 0.47, nf, S * 0.58); put(dc, c, ny0, nf, "No heart rate|No HR", S, P.fg, false, R0);
            var y1 = below(dc, ny0 + dn(dc, nf, "g"), XT, 0);
            if (y1 + dn(dc, XT, "g") <= bot) { put(dc, c, y1, XT, "recorded", S, P.lbl, false, R0); }
            return;
        }
        var v = [numOf(s["hr"]).toString(), "", numOf(s["maxHr"]).toString()] as Array<String>, l = ["AVG", "", "MAX"] as Array<String>, FN = [NMI, ME, SM, XT] as Array;
        var nv = [numOf(s["hr"]).toString(), "AVG", numOf(s["maxHr"]).toString(), "MAX"] as Array<String>, nc = [P.fg, P.lbl, P.fg, P.lbl] as Array<Number>;
        var zs = s["zs"] instanceof Array ? s["zs"] as Array : null, hs = arrOf(s["hs"]), ur = arrOf(s["urec"]);
        var zt = 0, hn = 0, rs = 0, rn = 0;
        if (zs != null) { for (var k = 0; k < 5; k++) { zt += numOf(zs[k]); } }
        for (var k1 = 0; k1 < hs.size(); k1++) { if (numOf(hs[k1]) > 0) { hn++; } }
        for (var k2 = 0; k2 < ur.size(); k2++) { var x = numOf(ur[k2]); if (x != REC_NONE) { rs += x; rn++; } }
        var rp = up(dc, XT) + dn(dc, XT, "0") + 2 * G, rd = rn > 0 ? tsDiv(rs, rn) : 0, ny = below(dc, top + G, XT, 0);
        var rv = rd > 0 ? "-" + rd.toString() : (rd < 0 ? "+" + (-rd).toString() : "0");
        var rt = [["RECOVERY 60 S", rv] as Array<String>, ["REC 60 S", rv] as Array<String>] as Array<Array<String>>, rcl = [P.lbl, P.fg] as Array<Number>;
        // the tries in order: with the zones / the curve (q < 4), with the recovery line (q % 4 < 2), the numbers on one line (q odd)
        for (var q = 0; q < 8; q++) {
            var ex = q < 4, rc = q % 4 < 2, ln = q % 2 == 1;
            if ((ex && zt <= 0 && hn < 2) || (rc && rn == 0)) { continue; }
            var nb = bot - (rc ? rp : 0.0) - (ex ? (zt > 0 ? 5 * rp - 2 * G : S * 0.1) + 2 * G : 0.0), y0 = ex ? 0.0 : S * 0.27;
            var ly0 = nb - dn(dc, XT, "0") < S * 0.3 ? nb - dn(dc, XT, "0") : S * 0.3, ly = ly0 > ny ? ly0 : ny; // the one line: lower where there is room (wider)
            var cb = -1.0;
            if (ln) { if (ly + dn(dc, XT, "0") <= nb && tsLine(dc, S, P, ly, nv, nc, false)) { cb = ly + dn(dc, XT, "0"); } }
            else { cb = cols(dc, S, P, v, l, top + G, y0, nb, FN, false); }
            if (cb < 0) { continue; }
            var mt = cb + 2 * G, zb = bot - (rc ? rp : 0.0), eb = cb;
            if (ex && zt > 0 && zs != null) { eb = tsZones(dc, S, P, zs, mt, zb, false); if (eb < 0) { continue; } }
            else if (ex) { eb = rc ? (zb < S * 0.76 ? zb : S * 0.76) : (bot < S * 0.82 ? bot : S * 0.82); if (eb - mt < S * 0.1) { continue; } }
            var ry = eb + 2 * G + up(dc, XT), ri = -1;
            if (rc && ry + dn(dc, XT, "0") <= bot) { ri = tsLine(dc, S, P, ry, rt[0], rcl, false) ? 0 : (tsLine(dc, S, P, ry, rt[1], rcl, false) ? 1 : -1); }
            if (rc && ri < 0) { continue; }
            if (ln) { tsLine(dc, S, P, ly, nv, nc, true); } else { cols(dc, S, P, v, l, top + G, y0, nb, FN, true); }
            if (ex && zt > 0 && zs != null) { tsZones(dc, S, P, zs, mt, zb, true); } else if (ex) { tsCurve(dc, S, P, hs, mt, eb); }
            if (rc) { tsLine(dc, S, P, ry, rt[ri], rcl, true); }
            return;
        }
    }
    // js zTime (27.11.5): a zone's time: m:ss, from an hour h:mm
    function zTime(x as Number) as String { return x < 3600 ? clock(x) : (x / 3600).toString() + ":" + ((x % 3600) / 60).format("%02d"); }
    // js tsZones (27.11.5): the time in the five zones as Garmin shows it: a row each, Z5 on top: the label, a bar as long as the time (the
    // longest zone the whole bar; the zone colours grey, blue, green, orange, red), the time right-aligned. The rows share their columns, as
    // wide as the lowest row inside the circle allows; the ink bottom, -1 where they do not fit above bot or a bar would be shorter than 0.2 S
    function tsZones(dc as Dc, S as Number, P as Palette, zs as Array, top, bot, draw as Boolean) as Float {
        var c = S / 2.0, G = gap(S), zp = up(dc, XT) + dn(dc, XT, "0") + 2 * G, y0 = top + up(dc, XT), sp = S * 0.03;
        var cl = [P.dim, P.wCool, P.wRec, P.acc, P.bad] as Array<Number>, tx = [] as Array<String>;
        var hw = S * 0.36, wl = 0, wt = 0, mx = 1;
        for (var k = 0; k < 5; k++) {
            var y = y0 + k * zp, h = half(S, y - up(dc, XT), y + dn(dc, XT, "0"), R0), z = numOf(zs[4 - k]);
            if (h < hw) { hw = h; }
            if (z > mx) { mx = z; }
            tx.add(zTime(z));
            var a = dc.getTextWidthInPixels("Z" + (5 - k).toString(), XT), b = dc.getTextWidthInPixels(tx[k], XT);
            if (a > wl) { wl = a; }
            if (b > wt) { wt = b; }
        }
        var bw = 2 * hw - wl - wt - 2 * sp, yb = y0 + 4 * zp + dn(dc, XT, "0");
        if (yb > bot || bw < S * 0.2) { return -1.0; }
        if (draw) {
            for (var k1 = 0; k1 < 5; k1++) {
                var y1 = y0 + k1 * zp, z1 = numOf(zs[4 - k1]), bl = bw * z1 / mx;
                txtL(dc, c - hw, y1, XT, "Z" + (5 - k1).toString(), P.lbl);
                if (z1 > 0) { dc.setColor(cl[4 - k1], Graphics.COLOR_TRANSPARENT); dc.fillRectangle(c - hw + wl + sp, y1 - up(dc, XT), bl > 2 ? bl : 2, up(dc, XT) + dn(dc, XT, "0")); }
                txtL(dc, c + hw - dc.getTextWidthInPixels(tx[k1], XT), y1, XT, tx[k1], P.fg);
            }
        }
        return yb;
    }
    // the heart rate over the ride (the upload's series, one value per 10 s or more; 0 = none: a gap) between top and bot
    function tsCurve(dc as Dc, S as Number, P as Palette, hs as Array, top, bot) as Void {
        var c = S / 2.0, n = hs.size(), hw = half(S, top, bot, 0.42), mn = 999, mx = 0;
        for (var k = 0; k < n; k++) { var h = numOf(hs[k]); if (h > 0 && h < mn) { mn = h; } if (h > mx) { mx = h; } }
        if (mx <= 0 || n < 2) { return; }
        var lo = mn - 5, H = (bot - top).toFloat(), sc = H / (mx + 5 - lo), dx = 2 * hw / (n - 1);
        dc.setColor(P.hr, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.01));
        for (var k1 = 1; k1 < n; k1++) {
            var a = numOf(hs[k1 - 1]), b = numOf(hs[k1]);
            if (a > 0 && b > 0) { dc.drawLine(c - hw + (k1 - 1) * dx, bot - (a - lo) * sc, c - hw + k1 * dx, bot - (b - lo) * sc); }
        }
        dc.setPenWidth(1);
    }
    // 4. what were my numbers: NP, max power, average cadence; the best 30 s, 1 min, 5 min (those the ride was long enough for); DONE.
    // Where it does not fit: the numbers' font shrinks, then the best row goes
    function tsPw(dc as Dc, S as Number, P as Palette, s as Dictionary, last as Boolean) as Void {
        var c = S / 2, G = gap(S), top = tsHead(dc, S, P, "POWER"), bot = last ? tsDone(dc, S, P) : S * 0.9;
        var b30 = numOf(s["b30"]), b60 = numOf(s["b60"]), b300 = numOf(s["b300"]), two = b30 > 0;
        var v1 = [orDash(numOf(s["np"])), numOf(s["maxPw"]).toString(), orDash(numOf(s["cad"]))] as Array<String>, l1 = ["NP", "MAX W", "RPM"] as Array<String>;
        // the best row: three columns, two the outer ones, one the middle (a ride of 30 s .. 5 min)
        var v2 = (b300 > 0 ? [b30.toString(), b60.toString(), b300.toString()] : (b60 > 0 ? [b30.toString(), "", b60.toString()] : ["", b30.toString(), ""])) as Array<String>;
        var l2 = (b300 > 0 ? ["30 S", "1 MIN", "5 MIN"] : (b60 > 0 ? ["30 S", "", "1 MIN"] : ["", "30 S", ""])) as Array<String>;
        var lo = bot - 2 * G; // the best row not right on DONE
        var FS3 = [[ME, SM, XT], [SM, XT], [XT]] as Array<Array>;
        for (var q = 0; q < 6; q++) {
            var fs = FS3[q % 3], on = two && q < 3, b1 = cols(dc, S, P, v1, l1, top, S * 0.3, bot, fs, false), by = b1 < 0 ? 0.0 : below(dc, b1 + G, XT, S * 0.56);
            var b2 = on && b1 >= 0 ? cols(dc, S, P, v2, l2, by + dn(dc, XT, "B"), 0, lo, fs, false) : 0.0;
            if ((b1 < 0 || b2 < 0) && q < 5) { continue; }
            cols(dc, S, P, v1, l1, top, S * 0.3, bot, fs, true);
            if (on) { put(dc, c, by, XT, "BEST", S, P.acc, false, R0); cols(dc, S, P, v2, l2, by + dn(dc, XT, "B"), 0, lo, fs, true); }
            return;
        }
    }
    function distTxt(m as Float) as String { return m >= 1000.0 ? (m / 1000.0).format("%.1f") + " km" : rnd(m).toString() + " m"; }
    // the segment popup: warning before, live delta against the PR, the result for 5 s (inside the ring)
    function segScreen(dc as Dc, F as Flow, S as Number, P as Palette, g as Dictionary) as Void {
        var c = S / 2, k = strOf(g["k"]), len = fltOf(g["len"]), name = strOf(g["name"]), r = c - (S * 0.03).toNumber(), ri = 0.5 - 0.03 - 0.015 - 0.015, G = gap(S);
        if (k.equals("warn")) {
            dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.03)); dc.drawCircle(c, c, r); dc.setPenWidth(1);
            var a = byInk(dc, [SM, XT], S * 0.1), ay = S * 0.22; put(dc, c, ay, a, "SEGMENT IN", S, P.acc, false, ri);
            var pr = numOf(g["pr"]), t = distTxt(len) + (pr > 0 ? ", PR " + clock(pr) + "|" + distTxt(len) : ""), nf = byInk(dc, [SM, XT], S * 0.1);
            var ty = S * 0.74, ny = above(dc, ty - up(dc, XT), nf, name, S * 0.62);
            put(dc, c, ty, XT, t, (S * 0.7).toNumber(), P.lbl, false, ri); put(dc, c, ny, nf, name, (S * 0.74).toNumber(), P.fg, true, ri);
            var ct = clock(imax(0, numOf(g["eta"]))), top = ay + dn(dc, a, "G") + G, bot = ny - up(dc, nf) - G, f = numIn(dc, [ct], [NHO, NME, NMI, ME], [(S * 0.8).toNumber()], [c], top, bot, ri);
            txt(dc, c, numY(dc, f, top, bot), f, ct, P.fg);
            return;
        }
        if (k.equals("live")) {
            var done = fltOf(g["done"]), delta = numOf(g["delta"]), ahead = delta <= 0, col = ahead ? P.good : P.bad, part = len > 0.0 ? done / len : 0.0;
            if (part > 1.0) { part = 1.0; }
            dc.setPenWidth(pw(S * 0.03)); dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT); dc.drawCircle(c, c, r);
            if (part > 0.0) { dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); if (part >= 0.999) { dc.drawCircle(c, c, r); } else { dc.drawArc(c, c, r, Graphics.ARC_CLOCKWISE, 90, 90 - (part * 360).toNumber()); } }
            dc.setPenWidth(1);
            var ny = S * 0.17 > up(dc, XT) + S * 0.1 ? S * 0.17 : up(dc, XT) + S * 0.1; put(dc, c, ny, XT, name, (S * 0.6).toNumber(), P.fg, true, ri);
            var left = len - done, dl = distTxt(left > 0.0 ? left : 0.0), gt = dl + " to go|" + dl, gy = S * 0.8; put(dc, c, gy, XT, gt, S, P.lbl, false, ri);
            var ref = g.hasKey("ref") ? strOf(g["ref"]) : "PR", top = ny + dn(dc, XT, name) + G; // "PR" | "KOM" | "" (nothing to beat: the time runs)
            var bot = gy - up(dc, XT) - G, big = "", bc = P.fg, l1 = "", l1c = P.lbl, l2 = "", l3 = "";
            if (ref.length() == 0) { big = clock(numOf(g["time"])); l1 = "NO TIME TO BEAT"; }
            else {
                big = clock(ahead ? -delta : delta); bc = col; l1 = (ahead ? "AHEAD OF " : "BEHIND ") + ref; l1c = col;
                var need = fltOf(g["need"]);
                if (need > 0.0) { l2 = "Need " + (F.sp.equals("ride") ? (need * 3.6).format("%.1f") + " km/h" : Fields.pace(1000.0 / need, 1000.0) + " /km"); l3 = "FOR " + ref; }
                else { l2 = ref + " out of reach"; }
            }
            // from the bottom: FOR KOM, Need ..., then the big delta and its line in the rest
            var f2 = byInk(dc, [SM, XT], S * 0.1);
            if (l3.length() > 0) { var y3 = above(dc, bot, XT, l3, S * 0.7); put(dc, c, y3, XT, l3, S, P.lbl, false, ri); bot = y3 - up(dc, XT) - G; }
            if (l2.length() > 0) { var y2 = above(dc, bot, f2, l2, S * 0.63); put(dc, c, y2, f2, l2, (S * 0.76).toNumber(), l3.length() > 0 ? P.fg : P.lbl, false, ri); bot = y2 - up(dc, f2) - G; }
            var y1 = above(dc, bot, XT, l1, S * 0.505); put(dc, c, y1, XT, l1, S, l1c, false, ri); bot = y1 - up(dc, XT) - G;
            // the sign in a text font (the fenix 7's number fonts have digits only)
            var sg = ref.length() == 0 ? "" : (ahead ? "-" : "+"), sw = sg.length() > 0 ? dc.getTextWidthInPixels(sg, LA) + 2 : 0;
            var f = numIn(dc, [big], [NHO, NME, NMI, ME], [(S * 0.8).toNumber() - sw], [c + sw / 2.0], top, bot, ri), bw = dc.getTextWidthInPixels(big, f), by = numY(dc, f, top, bot), bx = c - (bw + sw) / 2.0;
            dc.setColor(bc, Graphics.COLOR_TRANSPARENT);
            if (sw > 0) { dc.drawText(bx, by, LA, sg, VL); }
            dc.drawText(bx + sw, by, f, big, VL);
            return;
        }
        var pr2 = g["pr"] == true, dl2 = numOf(g["delta"]), col2 = pr2 || dl2 <= 0 ? P.good : P.bad, ink = pr2 ? P.ink : P.fg;
        if (pr2) { dc.setColor(col2, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, c, c); }
        var a2 = byInk(dc, [SM, XT], S * 0.1), ay2 = S * 0.2 > up(dc, a2) + S * 0.1 ? S * 0.2 : up(dc, a2) + S * 0.1; put(dc, c, ay2, a2, pr2 ? "NEW PR" : "SEGMENT DONE", S, pr2 ? ink : P.acc, false, R0);
        var ny2 = below(dc, ay2 + dn(dc, a2, "G"), XT, S * 0.3); put(dc, c, ny2, XT, name, (S * 0.66).toNumber(), ink, true, R0);
        var ref2 = g.hasKey("ref") ? strOf(g["ref"]) : "PR", vt = (dl2 <= 0 ? "-" : "+") + clock(dl2 < 0 ? -dl2 : dl2) + " vs " + ref2;
        var bot2 = S * 0.82;
        if (ref2.length() > 0) { var vf = fontIn(dc, vt, [ME, SM, XT], (S * 0.7).toNumber(), S * 0.12), vy = above(dc, S * 0.82, vf, vt, S * 0.7); put(dc, c, vy, vf, vt, S, pr2 ? ink : col2, false, R0); bot2 = vy - up(dc, vf) - G; }
        var top2 = ny2 + dn(dc, XT, name) + G, ct2 = clock(numOf(g["time"])), f3 = numIn(dc, [ct2], [NHO, NME, NMI, ME], [(S * 0.8).toNumber()], [c], top2, bot2, R0);
        txt(dc, c, numY(dc, f3, top2, bot2), f3, ct2, ink);
    }
    // the route page: next turn on top, the line with the position dot, the distance left at the bottom
    function routePage(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var r = F.route, ri = F.routeInfo(), G = gap(S), c = S / 2;
        if (r == null) { return; }
        if (ri == null) { return; }
        var turn = ri["turn"], off = numOf(ri["off"]), tb = S * 0.25;
        if (off > 0) { // off the route (Feed.mc RouteTrack: more than 40 m for 8 s)
            var f = byInk(dc, [SM, XT], S * 0.1), y = S * 0.165 > up(dc, f) + S * 0.1 ? S * 0.165 : up(dc, f) + S * 0.1; put(dc, c, y, f, "OFF ROUTE", S, P.bad, false, R0);
            var y2 = below(dc, y + dn(dc, f, "O"), XT, S * 0.235); put(dc, c, y2, XT, distTxt(off.toFloat()) + " away", S, P.fg, false, R0); tb = y2 + dn(dc, XT, "y");
        } else if (turn instanceof Dictionary) {
            var tn = turn as Dictionary, dir = strOf(tn["dir"]), tin = fltOf(tn["in"]), tt = strOf(tn["txt"]);
            turnArrow(dc, S * 0.28, S * 0.2, S * 0.08, dir.equals("L"), P.acc);
            var d = tin < 1000.0 ? (rnd(tin / 10.0) * 10).toString() + " m" : (tin / 1000.0).format("%.1f") + " km", f = byInk(dc, [ME, SM, XT], S * 0.1), y = S * 0.175 > up(dc, f) + S * 0.1 ? S * 0.175 : up(dc, f) + S * 0.1;
            putL(dc, S * 0.37, y, f, d, (S * 0.42).toNumber(), P.fg, false, R0);
            if (tt.length() == 0) { tt = dir.equals("L") ? "Turn left" : "Turn right"; }
            var y2 = below(dc, y + dn(dc, f, "m"), XT, S * 0.245);
            putL(dc, S * 0.37, y2, XT, tt, (S * 0.45).toNumber(), P.lbl, true, R0); tb = y2 + dn(dc, XT, tt);
        } else { var y = S * 0.2; put(dc, c, y, XT, "FINISH AHEAD", S, P.acc, false, R0); tb = y + dn(dc, XT, "F"); }
        // the bottom: the km left, TO FINISH where there is room
        var kf = byInk(dc, [ME, SM, XT], S * 0.1), km = kmTxt(fltOf(ri["left"])), w = dc.getTextWidthInPixels(km, kf), uw = S * 0.07;
        var fy = S * 0.885, fr = roomC(dc, S / 2, fy, XT, "T", R0), ft = pick(dc, "TO FINISH|TO GO", XT, fr, false);
        var two = fy - up(dc, XT) - G - inkH(dc, kf) > S * 0.7 && dc.getTextWidthInPixels(ft, XT) <= fr, ky = two ? above(dc, fy - up(dc, XT), kf, "0", S * 0.79) : S * 0.82, x = S / 2.0 - (w + uw) / 2.0;
        txtL(dc, x, ky, kf, km, P.fg);
        var base = ky - dc.getFontHeight(kf) / 2.0 + asc(kf); txtL(dc, x + w + S * 0.015, base - asc(XT) + dc.getFontHeight(XT) / 2.0, XT, "km", P.lbl);
        if (two) { put(dc, c, fy, XT, ft, S, P.lbl, false, R0); }
        // the route in the box between: points 0..1 (flat u / v, Feed.mc RouteTrack.face); total length, then the part done in the accent
        var pu = arrOf(r["u"]), pv = arrOf(r["v"]), bx = S * 0.2, bw = S * 0.6, by = tb + G + S * 0.03, bh = ky - up(dc, kf) - G - S * 0.03 - by, n = pu.size();
        if (n < 2 || pv.size() != n || bh < S * 0.1) { return; }
        var tot = 0.0;
        for (var k = 1; k < n; k++) { tot += segLen(pu, pv, k, bw, bh); }
        dc.setColor(P.path, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.014));
        for (var k = 1; k < n; k++) { dc.drawLine(rp(pu, k - 1, bx, bw), rp(pv, k - 1, by, bh), rp(pu, k, bx, bw), rp(pv, k, by, bh)); }
        var to = fltOf(ri["pos"]) * tot, acc = 0.0, ax = rp(pu, 0, bx, bw), ay = rp(pv, 0, by, bh);
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.022));
        for (var k = 1; k < n; k++) {
            var l = segLen(pu, pv, k, bw, bh), x0 = rp(pu, k - 1, bx, bw), y0 = rp(pv, k - 1, by, bh), x1 = rp(pu, k, bx, bw), y1 = rp(pv, k, by, bh);
            if (acc + l >= to) { var q = l > 0.0 ? (to - acc) / l : 0.0; ax = x0 + (x1 - x0) * q; ay = y0 + (y1 - y0) * q; dc.drawLine(x0, y0, ax, ay); break; }
            dc.drawLine(x0, y0, x1, y1); acc += l; ax = x1; ay = y1;
        }
        dc.setPenWidth(1);
        var fx = rp(pu, n - 1, bx, bw), fy2 = rp(pv, n - 1, by, bh);
        dc.setColor(P.fg, Graphics.COLOR_TRANSPARENT); dc.fillRectangle(fx - S * 0.016, fy2 - S * 0.016, S * 0.032, S * 0.032); // the finish
        if (F.navOn) { ax = bx + navU(F) * bw; ay = by + navV(F) * bh; } // the watch's real position (off the route it leaves the line)
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(ax, ay, S * 0.034);
        dc.setColor(P.fg, Graphics.COLOR_TRANSPARENT); dc.fillCircle(ax, ay, S * 0.019);
    }
    // the watch's own position in the route box (Feed.mc RouteTrack), kept inside the screen
    function navU(F as Flow) as Float { return F.navU < -0.2 ? -0.2 : (F.navU > 1.2 ? 1.2 : F.navU.toFloat()); }
    function navV(F as Flow) as Float { return F.navV < -0.4 ? -0.4 : (F.navV > 1.2 ? 1.2 : F.navV.toFloat()); }
    // point k of the route on one axis (the flat u or v array), in pixels of the box at o with size w
    function rp(a as Array, k as Number, o, w) as Float { return (o + fltOf(a[k]) * w).toFloat(); }
    function segLen(pu as Array, pv as Array, k as Number, bw, bh) as Float {
        var dx = (fltOf(pu[k]) - fltOf(pu[k - 1])) * bw, dy = (fltOf(pv[k]) - fltOf(pv[k - 1])) * bh;
        return Math.sqrt(dx * dx + dy * dy).toFloat();
    }
    // an arrow turning left or right (the curve as two lines)
    function turnArrow(dc as Dc, x, y, s, left as Boolean, col as Number) as Void {
        var k = left ? -1 : 1;
        dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(s * 0.3));
        dc.drawLine(x - k * s * 0.3, y + s * 0.9, x - k * s * 0.3, y - s * 0.1);
        dc.drawLine(x - k * s * 0.3, y - s * 0.1, x - k * s * 0.05, y - s * 0.4);
        dc.drawLine(x - k * s * 0.05, y - s * 0.4, x + k * s * 0.2, y - s * 0.4);
        dc.setPenWidth(1);
        dc.fillPolygon([[x + k * s * 0.8, y - s * 0.4], [x + k * s * 0.2, y - s * 0.95], [x + k * s * 0.2, y + s * 0.15]]);
    }
}
