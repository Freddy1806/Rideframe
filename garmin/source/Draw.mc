// RIDEFRAME on a Garmin watch: drawing of every screen with the plain dc calls, scaled by the screen size (S = dc.getWidth()).
// Same layout numbers as js/watchsim.js DRAW and js/watchdraw.js (drawPage, pageDots, recRing), so the browser preview is
// the design reference. Fonts are the device's system fonts, so sizes differ a little from the preview.
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;

// colours (js/watchdraw.js FACES): AMOLED (fr265) gets the RIDEFRAME tones on black, MIP (fenix 7 Pro, 64 colours) only
// palette colours (channels 00 / 55 / AA / FF), field labels white and no dark grey text
// AMOLED (fr265: the touch face with the "Hold to finish" pill) or MIP (fenix: buttons only, js/watchdraw.js FACES mip)
function isAmoled() as Boolean {
    var ds = System.getDeviceSettings();
    // VERIFY: DeviceSettings.requiresBurnInProtection (API 3.0) is true on AMOLED watches (doc page Toybox.System.DeviceSettings)
    return (ds has :requiresBurnInProtection) && ds.requiresBurnInProtection;
}
// 23.11.: a touchscreen (fr265, fenix 7 Pro / 7X Pro, fenix 8: all of them), not AMOLED, decides the touch-only parts (the "Hold to
// finish" pill); before, the MIP fenix were taken for button-only watches
function hasTouch() as Boolean {
    var ds = System.getDeviceSettings();
    // VERIFY (Toybox.System.DeviceSettings.isTouchScreen, API 1.0): true on the fenix 8 Solar 47 mm (and stays true with touch locked)
    return (ds has :isTouchScreen) && ds.isTouchScreen;
}
class Palette {
    var fg as Number; var dim as Number; var faint as Number; var acc as Number; var ink as Number; var hr as Number;
    var lbl as Number; var line as Number; var good as Number; var bad as Number; var far as Number; var path as Number;
    var cRun as Number; var cRide as Number; var cKraft as Number; var cOther as Number;
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
    }
    // js: C.sp[k]: run, ride, kraft, more / other
    function sport(k as String) as Number {
        if (k.equals("run")) { return cRun; }
        if (k.equals("ride")) { return cRide; }
        if (k.equals("kraft")) { return cKraft; }
        return cOther;
    }
}

// The screen constants (S_START ...) are globals from Flow.mc.
module Draw {
    const VC = Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
    const VL = Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER;

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
    // js/watchsim.js kmTxt
    function kmTxt(m as Float) as String { return (m / 1000.0).format(m >= 10000.0 ? "%.1f" : "%.2f"); }
    // js/watchsim.js setTxt: the last set of an exercise in the picker
    function setTxt(t as String, kg as Float, r as Number) as String {
        if (t.equals("time")) { return clock(r); }
        return (t.equals("bw") && kg == 0.0 ? "BW" : kgTxt(kg) + " kg") + " x " + r.toString();
    }
    // text cut to fit max px (with a dot, the system fonts may have no ellipsis)
    function fit(dc as Dc, t as String, font, max as Number) as String {
        if (dc.getTextWidthInPixels(t, font) <= max) { return t; }
        var s = t;
        while (s.length() > 1 && dc.getTextWidthInPixels(s + ".", font) > max) { s = s.substring(0, s.length() - 1) as String; }
        return s + ".";
    }
    // the first font of the list that fits (big numbers shrink instead of being cut)
    function fontFor(dc as Dc, t as String, fonts as Array, max as Number) {
        for (var i = 0; i < fonts.size(); i++) { if (dc.getTextWidthInPixels(t, fonts[i]) <= max) { return fonts[i]; } }
        return fonts[fonts.size() - 1];
    }
    function txt(dc as Dc, x, y, font, t, col as Number) as Void { dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.drawText(x, y, font, t.toString(), VC); }
    function txtL(dc as Dc, x, y, font, t, col as Number) as Void { dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.drawText(x, y, font, t.toString(), VL); }
    function pill(dc as Dc, cx, cy, w, h, col as Number) as Void { dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.fillRoundedRectangle(cx - w / 2, cy - h / 2, w, h, h / 2); }
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
    // the sport icons of the start menu, drawn with lines (the preview strokes js/theme.js ICONS; bitmaps per size later)
    function icon(dc as Dc, k as String, x, y, s, col as Number) as Void {
        if (k.equals("kraft")) { dumbbell(dc, x, y, s, col); return; }
        dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(s * 0.11 + 1));
        if (k.equals("run")) {
            dc.fillCircle(x + s * 0.12, y - s * 0.36, s * 0.1);
            dc.drawLine(x + s * 0.04, y - s * 0.2, x - s * 0.08, y + s * 0.1);   // body
            dc.drawLine(x - s * 0.08, y + s * 0.1, x + s * 0.14, y + s * 0.42);  // front leg
            dc.drawLine(x - s * 0.08, y + s * 0.1, x - s * 0.3, y + s * 0.38);   // back leg
            dc.drawLine(x - s * 0.26, y - s * 0.08, x + s * 0.02, y - s * 0.16); // arm back
            dc.drawLine(x + s * 0.02, y - s * 0.16, x + s * 0.3, y - s * 0.02);  // arm front
        } else if (k.equals("ride")) {
            var r = s * 0.2;
            dc.drawCircle(x - s * 0.27, y + s * 0.16, r); dc.drawCircle(x + s * 0.27, y + s * 0.16, r);
            dc.drawLine(x - s * 0.27, y + s * 0.16, x - s * 0.05, y - s * 0.16);
            dc.drawLine(x - s * 0.05, y - s * 0.16, x + s * 0.27, y + s * 0.16);
            dc.drawLine(x - s * 0.05, y - s * 0.16, x - s * 0.14, y - s * 0.3);
        } else if (k.equals("trainer")) { // 23.11. (js/theme.js ICONS trainer): a dial on a stand
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
    // a number text in a number font when it only has digits and : . - (VERIFY: the glyphs FONT_NUMBER_* carry), else text fonts
    function isNum(t as String) as Boolean {
        var a = t.toCharArray();
        for (var i = 0; i < a.size(); i++) { if ("0123456789:.-".find(a[i].toString()) == null) { return false; } }
        return a.size() > 0;
    }
    // the fonts for a value of height px (fraction of S) from big to small
    function valFonts(px as Float, num as Boolean) as Array {
        if (num) {
            if (px >= 0.28) { return [Graphics.FONT_NUMBER_THAI_HOT, Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD]; }
            if (px >= 0.18) { return [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD]; }
            if (px >= 0.15) { return [Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD, Graphics.FONT_MEDIUM]; }
            return [Graphics.FONT_NUMBER_MILD, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL];
        }
        if (px >= 0.18) { return [Graphics.FONT_LARGE, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL]; }
        return [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY];
    }

    // ---- one function per screen (js/watchsim.js DRAW) ----
    function screen(dc as Dc, F as Flow, P as Palette, now as Number, sum) as Void {
        var S = dc.getWidth();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK); dc.clear();
        var s = F.scr;
        P.acc = P.cKraft;
        if (s == S_MORE) { P.acc = P.cOther; }
        else if (s == S_READY || s == S_REC || s == S_PAUSE || s == S_RPICK) { P.acc = P.sport(F.sp); }
        else if (s == S_RSUM) { var r = F.rsum, k = F.sp; if (r != null) { k = strOf(r["sp"]); } P.acc = P.sport(k); }
        else if (s == S_TSCAN || s == S_TREC || s == S_TEND || s == S_TSUM) { P.acc = P.cRide; }
        var f = F.flash;
        if (f != null) {
            if ("lap".equals(f["k"])) { P.acc = P.sport(F.sp); lapFlash(dc, F, S, P, f); } else { prFlash(dc, S, P, f); }
            return;
        }
        if (s == S_HOME) { drawHome(dc, F, S, P, sum); }
        else if (s == S_PICK) { drawPick(dc, F, S, P); }
        else if (s == S_SMODE) { drawSmode(dc, F, S, P); }
        else if (s == S_MORE) { drawMore(dc, F, S, P); }
        else if (s == S_MENU) { list(dc, F, S, P, F.menu, "MENU v" + RF_VERSION, true, null, null); }
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
        else if (s == S_TSUM) { drawTSum(dc, F, S, P); }
        else { drawHome(dc, F, S, P, sum); }
    }
    // RIDE in white, FRAME in the accent, centred on y
    function logo(dc as Dc, S as Number, y, col as Number, P as Palette) as Void {
        var c = S / 2, wR = dc.getTextWidthInPixels("RIDE", Graphics.FONT_XTINY), wF = dc.getTextWidthInPixels("FRAME", Graphics.FONT_XTINY), x0 = c - (wR + wF) / 2;
        txtL(dc, x0, y, Graphics.FONT_XTINY, "RIDE", P.fg);
        txtL(dc, x0 + wR, y, Graphics.FONT_XTINY, "FRAME", col);
    }
    // the start menu (js/watchsim.js DRAW[SCR.HOME]): Run, Ride, Strength, More (the last used on top) all at once, the selected
    // one as the orange pill, the week points below; rows at HOME_Y0 + r * HOME_DY (the tap table in FlowDelegate.onTap)
    function drawHome(dc as Dc, F as Flow, S as Number, P as Palette, sum) as Void {
        var items = F.homeItems(), n = items.size(), c = S / 2, top = F.homeTop(n);
        logo(dc, S, S * 0.12, P.cKraft, P);
        for (var r = 0; r < HOME_FIT; r++) {
            var i = top + r;
            if (i >= n) { break; }
            var k = items[i], y = S * (HOME_Y0 + r * HOME_DY), lab = F.homeLabel(k);
            if (i == F.sel) {
                // VERIFY: FONT_MEDIUM fits the 0.13 S pill on the 280 px MIP (36 px high); else FONT_SMALL for the selected row there
                pill(dc, c, y, S * 0.74, S * 0.13, P.acc);
                icon(dc, k, S * 0.25, y, S * 0.085, P.ink);
                txtL(dc, S * 0.33, y, Graphics.FONT_MEDIUM, fit(dc, lab, Graphics.FONT_MEDIUM, (S * 0.45).toNumber()), P.ink);
            } else {
                icon(dc, k, S * 0.25, y, S * 0.075, P.acc);
                txtL(dc, S * 0.33, y, Graphics.FONT_SMALL, fit(dc, lab, Graphics.FONT_SMALL, (S * 0.45).toNumber()), P.fg);
            }
        }
        if (sum instanceof Dictionary) { points(dc, S, P, sum as Dictionary, S * 0.87); }
        if (n > HOME_FIT) { scrollArc(dc, S, P, F.sel, n); }
        startHint(dc, S, P);
    }
    // "245 pts" and the change against last week (GET /api/watch/summary)
    function points(g as Dc, S as Number, P as Palette, sum as Dictionary, y) as Void {
        if (sum["pts"] == null) { return; }
        var t = rnd(fltOf(sum["pts"])).toString() + " pts", d = rnd(fltOf(sum["delta"]));
        var tw = g.getTextWidthInPixels(t, Graphics.FONT_SMALL), ad = d < 0 ? -d : d;
        var dw = d != 0 ? S * 0.07 + ad.toString().length() * S * 0.03 : 0, x = S / 2 - (tw + dw) / 2;
        txtL(g, x, y, Graphics.FONT_SMALL, t, P.fg);
        if (d != 0) { tri(g, x + tw + S * 0.035, y, S * 0.018, d > 0, P.good); txtL(g, x + tw + S * 0.06, y, Graphics.FONT_XTINY, ad.toString(), P.good); }
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
    // js/watchsim.js setShort: one set, short: 80 kg x 8, +5 x 10, 10 reps, 1:00
    function setShort(t as String, kg as Float, r as Number) as String {
        if (t.equals("time")) { return clock(r); }
        if (t.equals("bw")) { return kg > 0.0 ? "+" + kgTxt(kg) + " x " + r.toString() : r.toString() + " reps"; }
        return kgTxt(kg) + " kg x " + r.toString();
    }
    function plural(n as Number, one as String, many as String) as String { return n.toString() + " " + (n == 1 ? one : many); }
    // js/watchsim.js pickSub: row k's sub line: a workout item's progress, else this session's sets, else last time's
    function pickSub(dc as Dc, F as Flow, S as Number, k as Number) as String {
        var rows = F.pickRows();
        if (k < 0 || k >= rows.size()) { return ""; }
        var l = F.exList(), e = l[rows[k][0]], j = rows[k][1];
        if (!(e instanceof Dictionary)) { return ""; }
        var ed = e as Dictionary, t = F.exT(ed), mine = F.setsOf(strOf(ed["id"])), n = mine.size();
        if (j >= 0) {
            var it = F.itAt(j), d = F.doneOf(j);
            if (it == null) { return ""; }
            if (d >= numOf(it[1])) { return "Done, " + plural(d, "set", "sets"); }
            if (F.planSkip.indexOf(j) >= 0) { return "Skipped"; }
            return d.toString() + "/" + numOf(it[1]).toString() + " sets, " + (t.equals("time") ? clock(numOf(it[2])) : numOf(it[2]).toString() + " reps");
        }
        if (n > 0) { return n.toString() + " done, " + setShort(t, fltOf(mine[n - 1]["kg"]), numOf(mine[n - 1]["reps"])); }
        var s = arrOf(ed["s"]);
        if (s.size() == 0) { return "New"; }
        // 24.11.: all of last time's sets ("Last 80x8, 8, 6"); too long for the line: as many whole sets as fit, then " ..."
        var k2 = s.size(), lt = lastTxt(t, s, k2), mw = (S * 0.7).toNumber();
        while (k2 > 1 && dc.getTextWidthInPixels(lt, Graphics.FONT_XTINY) > mw) { k2--; lt = lastTxt(t, s, k2); }
        return lt;
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
    // the exercise list: in a workout its items first with what is done; the counter line is the session so far (js DRAW[SCR.PICK])
    function drawPick(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var items = F.listItems(), n = items.size(), k = F.sets.size(), title = "EXERCISES", p = F.plan, ws = F.workouts();
        if (n == 0 && F.exCount() == 0) { // 24.11.: the setup is on its way (js DRAW[SCR.PICK] loading)
            txt(dc, S / 2, S * 0.12, Graphics.FONT_XTINY, title, P.dim);
            txt(dc, S / 2, S / 2, Graphics.FONT_SMALL, fit(dc, "Loading exercises", Graphics.FONT_SMALL, (S * 0.74).toNumber()), P.fg);
            txt(dc, S / 2, S * 0.585, Graphics.FONT_XTINY, "from the phone", P.lbl);
            return;
        }
        if (p != null) { if (p[0] >= 0 && p[0] < ws.size()) { title = strOf(ws[p[0]]["n"]).toUpper(); } }
        var cnt = (F.sel + 1).toString() + "/" + n.toString() + (k > 0 ? ", " + plural(k, "set", "sets") + " done" : "");
        list(dc, F, S, P, items, title, false, pickSub(dc, F, S, F.sel), cnt);
    }
    // Exercises or a saved workout (the phone's and those saved on the watch)
    function drawSmode(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var sub = "Choose exercises", ws = F.workouts();
        if (F.sel > 0 && F.sel - 1 < ws.size()) {
            var it = arrOf(ws[F.sel - 1]["it"]), n = 0;
            for (var i = 0; i < it.size(); i++) { var x = arrOf(it[i]); if (x.size() > 1) { n += numOf(x[1]); } }
            sub = plural(it.size(), "exercise", "exercises") + ", " + n.toString() + " sets";
        }
        list(dc, F, S, P, F.listItems(), "STRENGTH", false, sub, null);
    }
    // BACK on the exercise list with sets logged (js DRAW[SCR.END])
    function drawEnd(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        list(dc, F, S, P, F.listItems(), F.endConf ? "DISCARD?" : "END WORKOUT?", true, null, null);
        txt(dc, S / 2, S * 0.82, Graphics.FONT_XTINY, plural(F.sets.size(), "set", "sets") + ", " + clock(now - F.start - F.pauseT), P.lbl);
    }
    // after the summary: save the session as a workout (js DRAW[SCR.SAVEQ])
    function drawSaveq(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var q = F.saveq;
        if (q == null) { return; }
        var rows = q["rows"] as Array, it = q["it"] as Array;
        list(dc, F, S, P, rows as Array<String>, "SAVE AS WORKOUT?", true, null, null);
        if (F.sel < rows.size() - 1) {
            var nm = q["wid"] != null && F.sel == 0 ? strOf(q["wn"]) : strOf(q["n"]), n = 0;
            for (var i = 0; i < it.size(); i++) { n += numOf((it[i] as Array)[1]); }
            txt(dc, S / 2, S * 0.81, Graphics.FONT_XTINY, fit(dc, nm, Graphics.FONT_XTINY, (S * 0.62).toNumber()), P.fg);
            txt(dc, S / 2, S * 0.875, Graphics.FONT_XTINY, fit(dc, plural(it.size(), "exercise", "exercises") + ", " + n.toString() + " sets", Graphics.FONT_XTINY, (S * 0.56).toNumber()), P.lbl);
        }
    }
    function drawMore(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var m = F.moreList(), sub = null;
        if (F.sel < m.size()) { var x = arrOf(m[F.sel]); if (x.size() > 0) { sub = Sports.group(strOf(x[0])); } }
        list(dc, F, S, P, F.listItems(), "MORE SPORTS", false, sub, null);
        if (m.size() == 0) {
            txt(dc, S / 2, S * 0.62, Graphics.FONT_XTINY, fit(dc, "Choose sports in the app:", Graphics.FONT_XTINY, (S * 0.7).toNumber()), P.fg);
            txt(dc, S / 2, S * 0.69, Graphics.FONT_XTINY, fit(dc, "Settings > Watch > More", Graphics.FONT_XTINY, (S * 0.7).toNumber()), P.fg);
        }
    }
    // every list (js/watchflow.js LIST_LAY, 23.11.: rows 0.17 S apart around the selected one = 44 px touch targets on the 260 px fenix 8):
    // the selected row big in the middle with its sub line, the neighbours smaller and dimmer; a menu has three rows and a pill on the
    // selected one. count = the line under the title (null: n / N)
    function list(dc as Dc, F as Flow, S as Number, P as Palette, items as Array<String>, title as String, isMenu as Boolean, sub, count) as Void {
        var n = items.size(), c = S / 2, sel = F.sel;
        txt(dc, c, S * 0.12, Graphics.FONT_XTINY, fit(dc, title, Graphics.FONT_XTINY, (S * 0.56).toNumber()), P.dim);
        if (n == 0) { txt(dc, c, c, Graphics.FONT_SMALL, "Nothing yet", P.dim); return; }
        if (!isMenu) {
            var ct = count instanceof String ? count as String : (sel + 1).toString() + "/" + n.toString();
            txt(dc, c, S * 0.19, Graphics.FONT_XTINY, fit(dc, ct, Graphics.FONT_XTINY, (S * 0.62).toNumber()), P.dim);
        }
        // rows: [offset, y]; the same y values are the tap table in FlowDelegate.onTap
        var offs = isMenu ? [-1, 0, 1] as Array<Number> : [-1, 0, 1, 2] as Array<Number>;
        var ys = isMenu ? [0.33, 0.5, 0.67] as Array<Float> : [0.3, 0.5, 0.72, 0.845] as Array<Float>;
        var fs = isMenu ? [Graphics.FONT_SMALL, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL] : [Graphics.FONT_SMALL, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_XTINY];
        for (var r = 0; r < offs.size(); r++) {
            var o = offs[r], y = S * ys[r], f = fs[r], i = sel + o;
            if (i < 0 || i >= n) { continue; }
            var far = o > 1 || o < -1, w = (S * (far ? 0.55 : 0.74)).toNumber(), t = fit(dc, items[i], f, w);
            if (o == 0 && isMenu) { pill(dc, c, y, S * 0.78, S * 0.14, P.acc); txt(dc, c, y, f, fit(dc, items[i], f, (S * 0.7).toNumber()), P.ink); continue; }
            if (o == 0) { dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillRectangle(S * 0.1, y - S * 0.055, S * 0.012 + 1, S * 0.11); }
            txt(dc, c, y, f, t, o == 0 ? P.fg : (far ? P.far : P.dim)); // far rows: dark grey on AMOLED, light grey on MIP
            if (o == 0 && sub instanceof String) { txt(dc, c, S * 0.585, Graphics.FONT_XTINY, fit(dc, sub as String, Graphics.FONT_XTINY, (S * 0.7).toNumber()), P.acc); }
        }
        scrollArc(dc, S, P, sel, n);
        startHint(dc, S, P);
    }
    // js/watchsim.js hrClock: the heart rate (and the session clock) on one line, centred at y; 23.11.: shown the whole time in strength
    function hrClock(dc as Dc, F as Flow, S as Number, P as Palette, y, now as Number, hrOnly as Boolean) as Void {
        var c = S / 2, h = F.hr > 0 ? F.hr.toString() : "--";
        if (hrOnly) { heart(dc, c - S * 0.07, y, S * 0.045, P.hr); txtL(dc, c - S * 0.035, y, Graphics.FONT_SMALL, h, P.fg); return; }
        heart(dc, c - S * 0.17, y, S * 0.04, P.hr); txtL(dc, c - S * 0.14, y, Graphics.FONT_XTINY, h, P.fg);
        txtL(dc, c + S * 0.03, y, Graphics.FONT_XTINY, clock(now - F.start - F.pauseT), P.dim);
    }
    function drawSet(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var e = F.curEx(), c = S / 2, t = F.exT(e), it = F.planItem();
        startHint(dc, S, P);
        hrClock(dc, F, S, P, S * 0.12, now, false);
        txt(dc, c, S * 0.22, Graphics.FONT_SMALL, fit(dc, strOf(e["n"]), Graphics.FONT_SMALL, (S * 0.74).toNumber()), P.fg);
        var no = "SET " + F.setNo().toString();
        if (it != null) { no = no + " OF " + numOf(it[1]).toString(); }
        txt(dc, c, S * 0.315, Graphics.FONT_XTINY, no, P.acc);
        // 24.11. (Freddy): last time's same set as small numbers on the SET row above kg / reps, only on the set screen, no label;
        // white on MIP (P.lbl), first time nothing (js/watchsim.js DRAW[SCR.SET])
        var lp = lastSet(F, e);
        if (t.equals("time")) {
            if (lp != null) { txt(dc, S * 0.735, S * 0.315, Graphics.FONT_XTINY, clock(numOf(lp[1])), P.lbl); }
            // watch only: while the hold clock runs it counts up, the planned time below; else the planned time
            var held = F.holdAt > 0, v = held ? clock(now - F.holdAt) : clock(F.reps);
            txt(dc, c, S * 0.5, fontFor(dc, v, [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD], (S * 0.6).toNumber()), v, P.acc);
            dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillRectangle(S * 0.36, S * 0.615, S * 0.28, S * 0.016 + 1);
            txt(dc, c, S * 0.665, Graphics.FONT_XTINY, held ? "of " + clock(F.reps) : "hold", P.fg);
        } else {
            var bw = t.equals("bw");
            var val = [bw && F.kg == 0.0 ? "BW" : kgTxt(F.kg), F.reps.toString()] as Array<String>, unit = [bw ? "+kg" : "kg", "reps"] as Array<String>;
            var xs = [S * 0.285, S * 0.735] as Array<Float>, mx = [S * 0.32, S * 0.27] as Array<Float>;
            txt(dc, S * 0.515, S * 0.5, Graphics.FONT_SMALL, "x", P.dim);
            if (lp != null) {
                var lk = fltOf(lp[0]), ls = [bw && lk == 0.0 ? "BW" : kgTxt(lk), numOf(lp[1]).toString()] as Array<String>;
                var half = dc.getTextWidthInPixels(no, Graphics.FONT_XTINY) / 2 + S * 0.03; // never touches "SET n OF m" in the middle
                for (var i = 0; i < 2; i++) {
                    var w = dc.getTextWidthInPixels(ls[i], Graphics.FONT_XTINY) / 2, x = xs[i];
                    if (i == 0 && x + w > c - half) { x = c - half - w; }
                    if (i == 1 && x - w < c + half) { x = c + half + w; }
                    txt(dc, x, S * 0.315, Graphics.FONT_XTINY, ls[i], P.lbl);
                }
            }
            for (var i = 0; i < 2; i++) {
                var on = F.focus == i;
                // number fonts have digits only (VERIFY: which glyphs FONT_NUMBER_* carry), so "BW" takes a text font
                // a wide kg ("102.5") takes the next smaller font instead of being cut; text fonts last (js/watchsim.js SET_NUM)
                var f = "BW".equals(val[i]) ? Graphics.FONT_LARGE : fontFor(dc, val[i], [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD, Graphics.FONT_LARGE, Graphics.FONT_MEDIUM], mx[i].toNumber());
                txt(dc, xs[i], S * 0.5, f, val[i], on ? P.acc : P.fg);
                if (on) { dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillRectangle(xs[i] - S * 0.12, S * 0.615, S * 0.24, S * 0.016 + 1); }
                txt(dc, xs[i], S * 0.665, Graphics.FONT_XTINY, unit[i], on ? P.fg : P.lbl);
            }
        }
        pill(dc, c, S * 0.815, S * 0.4, S * 0.12, P.acc); txt(dc, c, S * 0.815, Graphics.FONT_SMALL, t.equals("time") && F.holdAt == 0 ? "GO" : "DONE", P.ink);
    }
    // js/watchflow.js lastSet(F, e): last session's set with the number of the set now (its last one when today goes further): [kg, reps] or null
    function lastSet(F as Flow, e as Dictionary) as Array? {
        var s = arrOf(e["s"]);
        if (s.size() == 0) { return null; }
        var n = F.setNo() - 1;
        var p = arrOf(n >= 0 && n < s.size() ? s[n] : s[s.size() - 1]);
        return p.size() >= 2 ? p : null;
    }
    // js/watchsim.js DRAW[SCR.REST] and REST_LAY (23.11.): heart rate, the clock, what this exercise has so far (the last 3 sets), what comes next
    function drawRest(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var left = F.restLeft(now), c = S / 2, r = c - (S * 0.04).toNumber(), e = F.curEx(), t = F.exT(e);
        var part = F.restLen > 0 ? left.toFloat() / F.restLen : 0.0;
        dc.setPenWidth(pw(S * 0.05)); dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT); dc.drawCircle(c, c, r);
        if (part > 0.0) {
            dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT);
            if (part >= 0.999) { dc.drawCircle(c, c, r); }
            else { dc.drawArc(c, c, r, Graphics.ARC_CLOCKWISE, 90, 90 - (part * 360).toNumber()); } // from 12 o'clock, clockwise
        }
        dc.setPenWidth(1);
        hrClock(dc, F, S, P, S * 0.15, now, true);
        // the clock no taller than 0.2 S, so the sets below keep their room (VERIFY on the device: NUMBER_MEDIUM on 260 px)
        var cf = dc.getFontHeight(Graphics.FONT_NUMBER_MEDIUM) <= S * 0.2 ? Graphics.FONT_NUMBER_MEDIUM : Graphics.FONT_NUMBER_MILD;
        txt(dc, c, S * 0.3, cf, clock(left), left <= 5 ? P.acc : P.fg);
        txt(dc, c, S * 0.425, Graphics.FONT_XTINY, fit(dc, strOf(e["n"]).toUpper(), Graphics.FONT_XTINY, (S * 0.62).toNumber()), P.acc);
        var mine = F.setsOf(strOf(e["id"])), k0 = mine.size() > 3 ? mine.size() - 3 : 0, fh = dc.getFontHeight(Graphics.FONT_XTINY) * 0.85;
        var dy = S * 0.062 > fh ? S * 0.062 : fh; // VERIFY on the device: three XTINY rows fit between the name and NEXT
        for (var k = k0; k < mine.size(); k++) {
            var ln = (k + 1).toString() + "   " + setShort(t, fltOf(mine[k]["kg"]), numOf(mine[k]["reps"]));
            txt(dc, c, S * 0.49 + (k - k0) * dy, Graphics.FONT_XTINY, fit(dc, ln, Graphics.FONT_XTINY, (S * 0.64).toNumber()), P.fg);
        }
        // NEXT: the next set of this exercise, or the next exercise of the workout (js nextTxt)
        var it = F.planItem(), nx = e;
        if (it != null) { var l = F.exList(), j = exIndex(l, it[0]); nx = j >= 0 ? l[j] as Dictionary : { "id" => strOf(it[0]), "n" => strOf(it[0]), "t" => "w" } as Dictionary; }
        var v = F.prefillOf(nx), vt = setShort(F.exT(nx), fltOf(v[0]), numOf(v[1])), no = F.setNo().toString(), lab = "", val = vt;
        if (strOf(nx["id"]).equals(strOf(e["id"]))) { lab = "NEXT: SET " + no + (it != null ? " OF " + numOf(it[1]).toString() : ""); }
        else { lab = "NEXT: " + strOf(nx["n"]).toUpper(); val = "Set " + no + (it != null ? "/" + numOf(it[1]).toString() : "") + ", " + vt; }
        txt(dc, c, S * 0.7, Graphics.FONT_XTINY, fit(dc, lab, Graphics.FONT_XTINY, (S * 0.66).toNumber()), P.lbl);
        txt(dc, c, S * 0.758, Graphics.FONT_XTINY, fit(dc, val, Graphics.FONT_XTINY, (S * 0.66).toNumber()), P.fg);
        txt(dc, c, S * 0.855, Graphics.FONT_XTINY, "SKIP", P.acc);
    }
    function prFlash(dc as Dc, S as Number, P as Palette, f as Dictionary) as Void {
        var c = S / 2, t = strOf(f["t"]), kg = fltOf(f["kg"]), r = numOf(f["reps"]);
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, c, c);
        txt(dc, c, S * 0.27, Graphics.FONT_SMALL, "NEW RECORD", P.ink);
        txt(dc, c, S * 0.5, Graphics.FONT_LARGE, "PR", P.ink); // VERIFY on the device: FONT_LARGE may look small here; a bitmap "PR" would be bigger
        txt(dc, c, S * 0.72, Graphics.FONT_MEDIUM, t.equals("bw") ? r.toString() + " reps" : (t.equals("time") ? clock(r) : kgTxt(kg) + " x " + r.toString()), P.ink);
    }
    // js/watchsim.js lapFlash: the lap banner for 5 s
    function lapFlash(dc as Dc, F as Flow, S as Number, P as Palette, f as Dictionary) as Void {
        var c = S / 2, t = numOf(f["t"]), d = fltOf(f["d"]), l = "";
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, c, c);
        txt(dc, c, S * 0.26, Graphics.FONT_MEDIUM, "LAP " + numOf(f["n"]).toString(), P.ink);
        txt(dc, c, S * 0.47, Graphics.FONT_NUMBER_HOT, clock(t), P.ink);
        if (F.sp.equals("ride")) { l = (t > 0 ? d / t * 3.6 : 0.0).format("%.1f") + " km/h"; }
        else if (F.sp.equals("run")) { l = Fields.pace(t.toFloat(), d) + " /km"; }
        else { l = kmTxt(d) + " km"; }
        txt(dc, c, S * 0.69, Graphics.FONT_MEDIUM, l, P.ink);
    }
    // js/watchsim.js DRAW[SCR.SUM] and SUM_LAY (23.11.): page 0 the totals with the heart rate, then one page per exercise with every set
    function drawSum(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var s = F.sum, c = S / 2;
        if (s == null) { return; }
        var exs = arrOf(s["ex"]), pg = F.sel;
        pageDots(dc, S, P, exs.size() + 1, pg);
        txt(dc, c, S * 0.87, Graphics.FONT_XTINY, "DONE", P.lbl);
        if (pg > 0 && pg <= exs.size()) {
            var ex1 = exs[pg - 1] as Dictionary, t = strOf(ex1["t"]), ss = arrOf(ex1["s"]), vol = 0.0, many = ss.size() > 5;
            for (var i = 0; i < ss.size(); i++) { var y0 = arrOf(ss[i]); vol += fltOf(y0[0]) * numOf(y0[1]); }
            txt(dc, c, S * 0.2, Graphics.FONT_SMALL, fit(dc, strOf(ex1["n"]), Graphics.FONT_SMALL, (S * 0.66).toNumber()), P.acc);
            txt(dc, c, S * 0.285, Graphics.FONT_XTINY, plural(ss.size(), "set", "sets") + (!t.equals("time") && vol > 0.0 ? ", " + volTxt(vol) + " kg" : ""), P.lbl);
            var shown = many ? 4 : ss.size();
            for (var i = 0; i < shown; i++) {
                var y1 = arrOf(ss[i]), pr = numOf(y1[2]) == 1;
                var ln = (i + 1).toString() + "   " + setShort(t, fltOf(y1[0]), numOf(y1[1])) + (pr ? "  PR" : "");
                txt(dc, c, S * (0.38 + i * 0.08), Graphics.FONT_XTINY, fit(dc, ln, Graphics.FONT_XTINY, (S * 0.7).toNumber()), pr ? P.acc : P.fg);
            }
            if (many) { txt(dc, c, S * (0.38 + 4 * 0.08), Graphics.FONT_XTINY, "+ " + (ss.size() - 4).toString() + " more", P.lbl); }
            return;
        }
        var st = numOf(s["st"]);
        if (st == ST_SAVED) { txt(dc, c, S * 0.15, Graphics.FONT_SMALL, "SAVED", P.acc); }
        else if (st == ST_SENDING) { txt(dc, c, S * 0.15, Graphics.FONT_SMALL, "SENDING", P.dim); }
        else if (st == ST_FAILED) { txt(dc, c, S * 0.15, Graphics.FONT_SMALL, "NOT SAVED", P.acc); }
        else { txt(dc, c, S * 0.15, Graphics.FONT_XTINY, fit(dc, "Sends when the phone is near", Graphics.FONT_XTINY, (S * 0.6).toNumber()), P.fg); }
        txt(dc, c, S * 0.3, Graphics.FONT_NUMBER_MILD, clock(numOf(s["dur"])), P.fg);
        txt(dc, c, S * 0.395, Graphics.FONT_XTINY, "TIME", P.lbl);
        var v = [numOf(s["sets"]).toString(), volTxt(fltOf(s["vol"])), numOf(s["exs"]).toString()] as Array<String>, l = ["SETS", "KG", "LIFTS"] as Array<String>;
        for (var i = 0; i < 3; i++) { var x = S * (0.27 + i * 0.23); txt(dc, x, S * 0.52, fontFor(dc, v[i], [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL], (S * 0.22).toNumber()), v[i], P.fg); txt(dc, x, S * 0.59, Graphics.FONT_XTINY, l[i], P.lbl); }
        var h = s["hr"];
        heart(dc, c - S * 0.2, S * 0.69, S * 0.042, P.hr);
        var ht = h instanceof Dictionary ? numOf((h as Dictionary)["avg"]).toString() + " avg, " + numOf((h as Dictionary)["max"]).toString() + " max" : "no heart rate";
        txtL(dc, c - S * 0.16, S * 0.69, Graphics.FONT_XTINY, fit(dc, ht, Graphics.FONT_XTINY, (S * 0.44).toNumber()), P.fg);
        var prs = numOf(s["prs"]);
        if (prs > 0) { txt(dc, c, S * 0.77, Graphics.FONT_XTINY, prs.toString() + " PR", P.acc); }
    }
    function drawPair(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var c = S / 2, bw = S * 0.1, gap = S * 0.018, x0 = c - (6 * bw + 5 * gap) / 2 + bw / 2;
        txt(dc, c, S * 0.19, Graphics.FONT_SMALL, "PAIR", P.acc);
        txt(dc, c, S * 0.28, Graphics.FONT_XTINY, "Code from the phone", P.fg);
        for (var i = 0; i < 6; i++) {
            var x = x0 + i * (bw + gap), on = i == F.pairI;
            if (on) { dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillRoundedRectangle(x - bw / 2, S * 0.5 - bw * 0.7, bw, bw * 1.4, S * 0.015); }
            else { dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(2); dc.drawRoundedRectangle(x - bw / 2, S * 0.5 - bw * 0.7, bw, bw * 1.4, S * 0.015); dc.setPenWidth(1); }
            txt(dc, x, S * 0.5, Graphics.FONT_MEDIUM, F.pairD[i], on ? P.ink : (i < F.pairI ? P.fg : P.dim));
            if (on) { tri(dc, x, S * 0.375, S * 0.022, true, P.acc); tri(dc, x, S * 0.625, S * 0.022, false, P.acc); }
        }
        var st = F.pairSt == P_SENDING ? "Pairing" : (F.pairSt == P_FAIL ? "Wrong code" : (F.pairI == 5 ? "START: pair" : "START: next"));
        txt(dc, c, S * 0.72, Graphics.FONT_XTINY, st, F.pairSt == P_FAIL ? P.acc : P.dim);
        txt(dc, c, S * 0.82, Graphics.FONT_XTINY, fit(dc, "Phone: Settings > Devices", Graphics.FONT_XTINY, (S * 0.66).toNumber()), P.dim);
    }

    /* ---- run, ride, other ---- */
    // js/watchsim.js DRAW[SCR.PAUSE] and PAUSE_LAY: one screen in every mode: PAUSED, the time, START resume, Hold BACK to finish,
    // Discard (with a confirm step); while BACK is held an orange ring fills with 3-2-1. Rows: the tap table in FlowDelegate.onTap.
    // VERIFY on the 280 px MIP: FONT_SMALL at 0.5 and FONT_XTINY at 0.57 do not touch (20 px apart)
    function drawPause(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var c = S / 2, part = F.holdPart(System.getTimer()), touch = hasTouch();
        if (part >= 0.0) {
            var r = c - (S * 0.035).toNumber();
            dc.setPenWidth(pw(S * 0.05)); dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT); dc.drawCircle(c, c, r);
            if (part > 0.01) {
                dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT);
                if (part >= 0.99) { dc.drawCircle(c, c, r); }
                else { var a = 90 - (part * 360).toNumber(); if (a < 0) { a += 360; } dc.drawArc(c, c, r, Graphics.ARC_CLOCKWISE, 90, a); } // from 12 o'clock, clockwise
            }
            dc.setPenWidth(1);
        }
        txt(dc, c, S * 0.17, Graphics.FONT_SMALL, "PAUSED", P.acc);
        txt(dc, c, S * 0.235, Graphics.FONT_XTINY, fit(dc, F.rec != null ? sportName(F) : "Strength", Graphics.FONT_XTINY, (S * 0.5).toNumber()), P.lbl);
        if (F.pzConf) {
            txt(dc, c, S * 0.37, Graphics.FONT_LARGE, "Discard?", P.fg);
            txt(dc, c, S * 0.5, Graphics.FONT_XTINY, fit(dc, "START yes, BACK no", Graphics.FONT_XTINY, (S * 0.74).toNumber()), P.lbl);
            pill(dc, c, S * 0.68, S * 0.46, S * 0.1, P.acc); txt(dc, c, S * 0.68, Graphics.FONT_SMALL, "Discard", P.ink);
            if (touch) { pill(dc, c, S * 0.82, S * 0.4, S * 0.1, P.faint); txt(dc, c, S * 0.82, Graphics.FONT_SMALL, "Keep", P.fg); }
            return;
        }
        if (part >= 0.0) { txt(dc, c, S * 0.37, Graphics.FONT_NUMBER_HOT, F.holdCount(System.getTimer()).toString(), P.acc); }
        else { txt(dc, c, S * 0.37, Graphics.FONT_NUMBER_MEDIUM, clock(F.pausedTime()), P.fg); }
        txt(dc, c, S * 0.5, Graphics.FONT_SMALL, "START resume", P.fg);
        txt(dc, c, S * 0.57, Graphics.FONT_XTINY, fit(dc, "Hold BACK to finish", Graphics.FONT_XTINY, (S * 0.72).toNumber()), F.pzHint > now || part >= 0.0 ? P.acc : P.lbl);
        if (F.pzSel != 0) {
            var w = S * 0.46, h = S * 0.1;
            dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(2); dc.drawRoundedRectangle(c - w / 2, S * 0.68 - h / 2, w, h, h / 2); dc.setPenWidth(1);
        }
        txt(dc, c, S * 0.68, Graphics.FONT_SMALL, "Discard", F.pzSel != 0 ? P.fg : P.dim);
        if (touch) {
            var on = part >= 0.0;
            pill(dc, c, S * 0.82, S * 0.5, S * 0.11, on ? P.acc : P.faint);
            txt(dc, c, S * 0.82, Graphics.FONT_XTINY, "Hold to finish", on ? P.ink : P.fg);
        }
    }
    function sportName(F as Flow) as String { return F.sp.equals("other") ? F.tname : F.homeLabel(F.sp); }
    function drawReady(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var c = S / 2;
        startHint(dc, S, P);
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, S * 0.25, S * 0.1);
        icon(dc, F.sp.equals("other") ? "more" : F.sp, c, S * 0.25, S * 0.12, P.ink);
        txt(dc, c, S * 0.445, Graphics.FONT_LARGE, fit(dc, sportName(F), Graphics.FONT_LARGE, (S * 0.8).toNumber()), P.fg);
        if (!Sports.gps(F.sp, F.type)) {
            heart(dc, c - S * 0.1, S * 0.565, S * 0.045, P.hr);
            txtL(dc, c - S * 0.06, S * 0.565, Graphics.FONT_SMALL, F.hr > 0 ? F.hr.toString() + " bpm" : "Heart rate", P.fg);
        } else {
            // the real fix quality (Recorder.onPosition), so it can be reported: ready (usable / good), weak (poor / last known), search
            var col = F.gps >= 2 ? P.good : (F.gps == 1 ? P.acc : P.lbl);
            dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c - S * 0.135, S * 0.565, S * 0.02);
            txtL(dc, c - S * 0.1, S * 0.565, Graphics.FONT_SMALL, F.gps >= 2 ? "GPS ready" : (F.gps == 1 ? "GPS weak" : "GPS search"), col);
        }
        var n = F.pages.size(), t = n.toString() + (n == 1 ? " data page" : " data pages") + (F.hasRoutePage() ? " + route" : "");
        if (F.sp.equals("other")) { txt(dc, c, S * 0.655, Graphics.FONT_XTINY, fit(dc, t, Graphics.FONT_XTINY, (S * 0.62).toNumber()), P.lbl); }
        else { // 19.11.: the route line; UP / DOWN or a tap on it opens the choice (RPICK). VERIFY on the device: the two XTINY lines do not touch
            // js/watchsim.js READY: "2 pages, edit on phone", "2 pages + route, on phone" or the short line: the first that fits in full
            // (", " for the "·" of js, like RPICK)
            var np = n.toString() + (n == 1 ? " page" : " pages") + (F.hasRoutePage() ? " + route" : ""), mw = (S * 0.62).toNumber();
            if (dc.getTextWidthInPixels(np + ", edit on phone", Graphics.FONT_XTINY) <= mw) { t = np + ", edit on phone"; }
            else if (dc.getTextWidthInPixels(np + ", on phone", Graphics.FONT_XTINY) <= mw) { t = np + ", on phone"; }
            txt(dc, c, S * 0.635, Graphics.FONT_XTINY, fit(dc, t, Graphics.FONT_XTINY, (S * 0.62).toNumber()), P.lbl);
            var i = F.routeIndex(), l = F.routes, rt = "No route";
            if (i >= 0) { if (l != null) { rt = F.route != null ? "Route: " + strOf(l[i]["name"]) : "Loading route"; } }
            txt(dc, c, S * 0.705, Graphics.FONT_XTINY, fit(dc, rt, Graphics.FONT_XTINY, (S * 0.6).toNumber()), i >= 0 ? P.acc : P.fg);
        }
        pill(dc, c, S * 0.81, S * 0.42, S * 0.13, P.acc); txt(dc, c, S * 0.81, Graphics.FONT_SMALL, "START", P.ink);
    }
    // js/watchsim.js RPICK: None or a route sent from the phone, with its length and climb
    function drawRpick(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var l = F.routes, sub = "Data pages only";
        if (l != null) {
            if (F.sel > 0 && F.sel - 1 < l.size()) { var r = l[F.sel - 1], cl = rnd(fltOf(r["climb"])); sub = kmTxt(fltOf(r["dist"])) + " km" + (cl > 0 ? ", " + cl.toString() + " m up" : ""); }
        }
        list(dc, F, S, P, F.listItems(), "ROUTE", false, sub, null);
        if (l != null) { if (l.size() == 0) { txt(dc, S / 2, S * 0.81, Graphics.FONT_XTINY, fit(dc, "Send routes from the phone", Graphics.FONT_XTINY, (S * 0.62).toNumber()), P.lbl); } }
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
        if (R.auto) { pill(dc, S / 2, S * 0.06, S * 0.36, S * 0.062, P.acc); txt(dc, S / 2, S * 0.061, Graphics.FONT_XTINY, "AUTO PAUSE", P.ink); }
    }
    // js/watchdraw.js LAY: [x, value y, label y, value size, max width] per field for 1 to 4 fields; h = separator rows, v = the middle line
    function drawPage(dc as Dc, S as Number, P as Palette, sp as String, ids as Array<String>, R as Rec) as Void {
        var k = ids.size(), c = S / 2;
        if (k == 0) { return; }
        if (k > 4) { k = 4; }
        var L = [[0.5, 0.53, 0.32, 0.3, 0.84]] as Array<Array<Float>>, h = [] as Array<Float>, v = [] as Array<Float>;
        if (k == 2) { L = [[0.5, 0.34, 0.2, 0.2, 0.74], [0.5, 0.72, 0.58, 0.2, 0.7]] as Array<Array<Float>>; h = [0.5] as Array<Float>; }
        else if (k == 3) { L = [[0.5, 0.33, 0.18, 0.2, 0.7], [0.29, 0.7, 0.575, 0.14, 0.37], [0.71, 0.7, 0.575, 0.14, 0.37]] as Array<Array<Float>>; h = [0.48] as Array<Float>; v = [0.48, 0.9] as Array<Float>; }
        else if (k == 4) { L = [[0.5, 0.255, 0.13, 0.16, 0.6], [0.29, 0.5, 0.405, 0.13, 0.37], [0.71, 0.5, 0.405, 0.13, 0.37], [0.5, 0.765, 0.67, 0.13, 0.5]] as Array<Array<Float>>; h = [0.355, 0.615] as Array<Float>; v = [0.355, 0.615] as Array<Float>; }
        dc.setColor(P.line, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.006 > 2 ? S * 0.006 : 2));
        for (var j = 0; j < h.size(); j++) {
            var y = h[j], q = 0.25 - (y - 0.5) * (y - 0.5), hw = Math.sqrt(q > 0 ? q : 0.0) * S - S * 0.05;
            dc.drawLine(c - hw, y * S, c + hw, y * S);
        }
        if (v.size() == 2) { dc.drawLine(c, v[0] * S, c, v[1] * S); }
        dc.setPenWidth(1);
        for (var i = 0; i < k; i++) {
            var row = L[i], id = ids[i], x = row[0] * S, y = row[1] * S, ly = row[2] * S, px = row[3], mw = (row[4] * S).toNumber();
            var small = px < 0.15, hrt = id.equals("hr") && !small;
            var lab = fit(dc, Fields.label(id).toUpper(), Graphics.FONT_XTINY, mw - (hrt ? (S * 0.05).toNumber() : 0));
            var lx = x + (hrt ? S * 0.022 : 0);
            txt(dc, lx, ly, Graphics.FONT_XTINY, lab, P.lbl);
            if (hrt) { heart(dc, lx - dc.getTextWidthInPixels(lab, Graphics.FONT_XTINY) / 2 - S * 0.035, ly, S * 0.034, P.hr); } // the heart before "HEART RATE"
            valUnit(dc, x, y, Fields.text(id, R), small && k > 1 ? "" : Fields.unit(sp, id), px, mw, P);
        }
    }
    // js/watchdraw.js valUnit: a value with its unit after it, centred on x and kept inside max (the value shrinks, the unit goes first)
    function valUnit(dc as Dc, x, y, v as String, u as String, px as Float, max as Number, P as Palette) as Void {
        var fonts = valFonts(px, isNum(v)), uf = Graphics.FONT_XTINY;
        var uw = u.length() > 0 ? dc.getTextWidthInPixels(u, uf) + 4 : 0, f = fonts[fonts.size() - 1], vw = 0, found = false;
        for (var i = 0; i < fonts.size() && !found; i++) {
            vw = dc.getTextWidthInPixels(v, fonts[i]);
            if (vw + uw <= max) { f = fonts[i]; found = true; }
        }
        if (!found) { uw = 0; f = fontFor(dc, v, fonts, max); vw = dc.getTextWidthInPixels(v, f); }
        var x0 = x - (vw + uw) / 2;
        txtL(dc, x0, y, f, v, P.fg);
        if (uw > 0) { txtL(dc, x0 + vw + 4, y + dc.getFontHeight(f) * 0.22, uf, u, P.lbl); } // VERIFY on the device: the unit sits near the number's baseline
    }
    // js/watchdraw.js pageDots: page dots on the left edge, where the UP / DOWN buttons are, the first page on top
    function pageDots(dc as Dc, S as Number, P as Palette, n as Number, i as Number) as Void {
        if (n < 2) { return; }
        var r = S / 2 - S * 0.035, a0 = 180 + (n - 1) * 5;
        for (var k = 0; k < n; k++) {
            var a = (a0 - k * 10) * Math.PI / 180.0, x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
            dc.setColor(k == i ? P.acc : P.dim, Graphics.COLOR_TRANSPARENT); dc.fillCircle(x, y, S * (k == i ? 0.016 : 0.011));
        }
    }
    // js/watchdraw.js recRing: the recording ring at the top in the sport's colour (dim while paused)
    function recRing(dc as Dc, S as Number, P as Palette, on as Boolean) as Void {
        dc.setColor(on ? P.acc : P.dim, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.024));
        dc.drawArc(S / 2, S / 2, S / 2 - (S * 0.012).toNumber(), Graphics.ARC_CLOCKWISE, 120, 60);
        dc.setPenWidth(1);
    }
    // js/watchsim.js RSUM: the summary after Save
    function drawRsum(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var s = F.rsum, c = S / 2;
        if (s == null) { return; }
        var sp = strOf(s["sp"]), t = numOf(s["t"]), d = fltOf(s["d"]), kc = rnd(fltOf(s["kcal"]));
        txt(dc, c, S * 0.16, Graphics.FONT_SMALL, "SAVED", P.acc);
        txt(dc, c, S * 0.33, Graphics.FONT_NUMBER_MEDIUM, clock(t), P.fg);
        txt(dc, c, S * 0.435, Graphics.FONT_XTINY, "TIME", P.lbl);
        var v = [kmTxt(d), "", ""] as Array<String>, l = ["KM", "", ""] as Array<String>;
        if (sp.equals("ride")) { v[1] = (t > 0 ? d / t * 3.6 : 0.0).format("%.1f"); l[1] = "KM/H"; v[2] = rnd(fltOf(s["avgPw"])).toString(); l[2] = "AVG W"; }
        else if (sp.equals("run")) { v[1] = Fields.pace(t.toFloat(), d); l[1] = "/KM"; v[2] = kc.toString(); l[2] = "KCAL"; }
        else { v[1] = kc.toString(); l[1] = "KCAL"; v[2] = numOf(s["laps"]).toString(); l[2] = "LAPS"; }
        for (var i = 0; i < 3; i++) {
            var x = S * (0.27 + i * 0.23);
            txt(dc, x, S * 0.59, fontFor(dc, v[i], [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_XTINY], (S * 0.22).toNumber()), v[i], P.fg);
            txt(dc, x, S * 0.665, Graphics.FONT_XTINY, l[i], P.lbl);
        }
        var nm = sp.equals("other") ? strOf(s["name"]) : F.homeLabel(sp);
        txt(dc, c, S * 0.76, Graphics.FONT_SMALL, fit(dc, nm, Graphics.FONT_SMALL, (S * 0.6).toNumber()), P.acc);
        txt(dc, c, S * 0.86, Graphics.FONT_XTINY, "DONE", P.lbl);
    }
    /* ---- 23.11.: the indoor trainer (js/watchsim.js DRAW[SCR.TSCAN ... TSUM], TSCAN_LAY, TREC_LAY, TSUM_LAY, STATS_LAY) ---- */
    // the trainers nearby (FTMS first) while searching, else the state of the one chosen with START to ride
    function drawTScan(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var L = F.link, v = L.shown(), c = S / 2;
        if (v == TL_SCAN || v == TL_OFF) {
            var n = L.list.size();
            if (n > 0) {
                var sub = F.sel < n && L.list[F.sel]["ftms"] == true ? "Smart trainer, ERG" : "Power only, no ERG";
                list(dc, F, S, P, F.listItems(), "INDOOR TRAINER", false, sub, "Searching, START connects");
                return;
            }
            txt(dc, c, S * 0.12, Graphics.FONT_XTINY, "INDOOR TRAINER", P.dim);
            dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, S * 0.3, S * 0.07);
            icon(dc, "trainer", c, S * 0.3, S * 0.085, P.ink);
            txt(dc, c, S * 0.45, Graphics.FONT_MEDIUM, "Searching", P.fg);
            txt(dc, c, S * 0.56, Graphics.FONT_XTINY, "Pedal a few turns", P.lbl);
            txt(dc, c, S * 0.62, Graphics.FONT_XTINY, "to wake the trainer", P.lbl);
            return;
        }
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, S * 0.24, S * 0.1);
        icon(dc, "trainer", c, S * 0.24, S * 0.12, P.ink);
        txt(dc, c, S * 0.4, Graphics.FONT_SMALL, fit(dc, L.name, Graphics.FONT_SMALL, (S * 0.74).toNumber()), P.fg);
        var a = "", col = P.fg, b = "", d = "";
        if (v == TL_CONN) { a = "Connecting"; b = "Taking control"; }
        else if (v == TL_READY) { a = "Connected"; col = P.good; b = L.ctl ? "ERG ready" : "Power only, no ERG"; }
        else if (v == TL_REFUSED) { a = "Refuses control"; col = P.bad; b = "Another app controls it."; d = "Close it, or ride without ERG"; }
        else if (v == TL_LOST) { a = "Lost, reconnecting"; col = P.bad; b = "Keeps trying"; }
        txt(dc, c, S * 0.52, Graphics.FONT_MEDIUM, fit(dc, a, Graphics.FONT_MEDIUM, (S * 0.8).toNumber()), col);
        txt(dc, c, S * 0.61, Graphics.FONT_XTINY, fit(dc, b, Graphics.FONT_XTINY, (S * 0.74).toNumber()), P.fg);
        if (d.length() > 0) { txt(dc, c, S * 0.675, Graphics.FONT_XTINY, fit(dc, d, Graphics.FONT_XTINY, (S * 0.68).toNumber()), P.lbl); }
        if (v == TL_READY || v == TL_REFUSED) { startHint(dc, S, P); pill(dc, c, S * 0.81, S * 0.42, S * 0.13, P.acc); txt(dc, c, S * 0.81, Graphics.FONT_SMALL, "START", P.ink); }
        else { txt(dc, c, S * 0.81, Graphics.FONT_XTINY, "BACK: the list", P.lbl); }
    }
    // the ERG ride (like the Wahoo app's ERG page): the target big with - / + beside it, the trainer's power, cadence, heart rate below
    function drawTRec(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var R = F.tr;
        if (R == null) { return; }
        var L = F.link, v = L.shown(), paused = R.st != RS_RUN, c = S / 2;
        recRing(dc, S, P, !paused); pageDots(dc, S, P, 2, R.pg);
        if (R.pg != 0) { trStats(dc, S, P, R); return; }
        txt(dc, c, S * 0.12, Graphics.FONT_NUMBER_MILD, clock(R.t), P.fg);
        var warn = v == TL_LOST ? "LOST, RECONNECTING" : (v == TL_REFUSED ? "NO CONTROL, OTHER APP" : (!L.ctl ? "POWER ONLY, NO ERG" : (paused ? "PAUSED" : "")));
        var wc = warn.length() == 0 ? P.lbl : (paused && L.ctl && v != TL_LOST && v != TL_REFUSED ? P.acc : P.bad);
        txt(dc, c, S * 0.205, Graphics.FONT_XTINY, fit(dc, warn.length() > 0 ? warn : "TARGET W", Graphics.FONT_XTINY, (S * 0.6).toNumber()), wc);
        var t = R.tgt.toString();
        txt(dc, c, S * 0.36, fontFor(dc, t, [Graphics.FONT_NUMBER_THAI_HOT, Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM], (S * 0.46).toNumber()), t, paused ? P.dim : P.acc);
        var xs = [0.15, 0.85] as Array<Float>;
        for (var i = 0; i < 2; i++) {
            var x = S * xs[i], y = S * 0.36, h = S * 0.035;
            dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT); dc.fillCircle(x, y, S * 0.085);
            dc.setColor(P.fg, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.018));
            dc.drawLine(x - h, y, x + h, y); if (i == 1) { dc.drawLine(x, y - h, x, y + h); } // drawn: the fonts may have no minus sign
            dc.setPenWidth(1);
        }
        txt(dc, c, S * 0.5, Graphics.FONT_XTINY, "+/- " + R.step.toString() + " W", P.lbl);
        dc.setColor(P.line, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.006 > 2 ? S * 0.006 : 2));
        dc.drawLine(S * 0.12, S * 0.56, S * 0.88, S * 0.56); dc.setPenWidth(1);
        var vals = [L.livePw(now).toString(), L.liveCad(now).toString(), F.hr > 0 ? F.hr.toString() : "--"] as Array<String>, labs = ["WATTS", "RPM", "BPM"] as Array<String>;
        for (var i = 0; i < 3; i++) {
            var x = S * (0.27 + i * 0.23);
            txt(dc, x, S * 0.655, fontFor(dc, vals[i], [Graphics.FONT_NUMBER_MILD, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL], (S * 0.21).toNumber()), vals[i], P.fg);
            if (i == 2) { heart(dc, x - S * 0.055, S * 0.735, S * 0.03, P.hr); }
            txt(dc, x + (i == 2 ? S * 0.015 : 0), S * 0.735, Graphics.FONT_XTINY, labs[i], P.lbl);
        }
        if (paused) { pill(dc, c, S * 0.85, S * 0.44, S * 0.1, P.acc); txt(dc, c, S * 0.85, Graphics.FONT_XTINY, "START resume", P.ink); }
        else { txt(dc, c, S * 0.85, Graphics.FONT_XTINY, "AVG " + R.avgPw().toString() + " W, " + rnd(R.kj).toString() + " kJ", P.lbl); }
    }
    // three numbers with labels in a row (x 0.27 / 0.5 / 0.73; js cols)
    function cols(dc as Dc, S as Number, P as Palette, v as Array<String>, l as Array<String>, y as Float, yl as Float) as Void {
        for (var i = 0; i < 3; i++) {
            var x = S * (0.27 + i * 0.23);
            txt(dc, x, S * y, fontFor(dc, v[i], [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_XTINY], (S * 0.22).toNumber()), v[i], P.fg);
            txt(dc, x, S * yl, Graphics.FONT_XTINY, l[i], P.lbl);
        }
    }
    function orDash(n as Number) as String { return n > 0 ? n.toString() : "--"; }
    // the ride's second page: this target's block (time, avg power), then the whole ride
    function trStats(dc as Dc, S as Number, P as Palette, R as TRide) as Void {
        var c = S / 2, bAvg = R.bN > 0 ? rnd(R.bSum.toFloat() / R.bN) : 0, sm = R.sum();
        txt(dc, c, S * 0.17, Graphics.FONT_SMALL, "AT " + R.tgt.toString() + " W", P.acc);
        txt(dc, c, S * 0.3, Graphics.FONT_NUMBER_MEDIUM, clock(R.t - R.bT0), P.fg);
        txt(dc, c, S * 0.41, Graphics.FONT_XTINY, fit(dc, bAvg.toString() + " W avg at this target", Graphics.FONT_XTINY, (S * 0.7).toNumber()), P.lbl);
        dc.setColor(P.line, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.006 > 2 ? S * 0.006 : 2));
        dc.drawLine(S * 0.12, S * 0.48, S * 0.88, S * 0.48); dc.setPenWidth(1);
        cols(dc, S, P, [R.avgPw().toString(), R.pwMax.toString(), rnd(R.kj).toString()] as Array<String>, ["AVG W", "MAX W", "KJ"] as Array<String>, 0.58, 0.655);
        cols(dc, S, P, [orDash(numOf(sm["np"])), orDash(numOf(sm["cad"])), orDash(numOf(sm["hr"]))] as Array<String>, ["NP", "RPM", "AVG HR"] as Array<String>, 0.75, 0.82);
    }
    // BACK on the ride: Resume, Stats page, Finish & save, Discard (with a confirm step)
    function drawTEnd(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        list(dc, F, S, P, F.listItems(), F.tConf ? "DISCARD RIDE?" : "INDOOR TRAINER", true, null, null);
        var R = F.tr;
        if (R != null) { txt(dc, S / 2, S * 0.82, Graphics.FONT_XTINY, fit(dc, clock(R.t) + ", " + R.tgt.toString() + " W" + (R.st != RS_RUN ? ", paused" : ""), Graphics.FONT_XTINY, (S * 0.6).toNumber()), P.lbl); }
    }
    // the summary: time, avg / max power, kJ, cadence, avg / max heart rate
    function drawTSum(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var s = F.tsum, c = S / 2;
        if (s == null) { return; }
        txt(dc, c, S * 0.15, Graphics.FONT_SMALL, "SAVED", P.acc);
        txt(dc, c, S * 0.3, Graphics.FONT_NUMBER_MEDIUM, clock(numOf(s["t"])), P.fg);
        txt(dc, c, S * 0.395, Graphics.FONT_XTINY, "INDOOR RIDE", P.lbl);
        cols(dc, S, P, [numOf(s["avgPw"]).toString(), numOf(s["maxPw"]).toString(), numOf(s["kj"]).toString()] as Array<String>, ["AVG W", "MAX W", "KJ"] as Array<String>, 0.52, 0.59);
        cols(dc, S, P, [orDash(numOf(s["cad"])), orDash(numOf(s["hr"])), orDash(numOf(s["maxHr"]))] as Array<String>, ["RPM", "AVG HR", "MAX HR"] as Array<String>, 0.7, 0.77);
        txt(dc, c, S * 0.88, Graphics.FONT_XTINY, "DONE", P.lbl);
    }
    function distTxt(m as Float) as String { return m >= 1000.0 ? (m / 1000.0).format("%.1f") + " km" : rnd(m).toString() + " m"; }
    // js/watchsim.js segScreen: the segment popup: warning before, live delta against the PR, the result for 5 s
    function segScreen(dc as Dc, F as Flow, S as Number, P as Palette, g as Dictionary) as Void {
        var c = S / 2, k = strOf(g["k"]), len = fltOf(g["len"]), name = strOf(g["name"]), r = c - (S * 0.03).toNumber();
        if (k.equals("warn")) {
            dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.03)); dc.drawCircle(c, c, r); dc.setPenWidth(1);
            txt(dc, c, S * 0.22, Graphics.FONT_SMALL, "SEGMENT IN", P.acc);
            txt(dc, c, S * 0.42, Graphics.FONT_NUMBER_HOT, clock(imax(0, numOf(g["eta"]))), P.fg);
            txt(dc, c, S * 0.62, Graphics.FONT_SMALL, fit(dc, name, Graphics.FONT_SMALL, (S * 0.74).toNumber()), P.fg);
            var pr = numOf(g["pr"]), t = distTxt(len) + (pr > 0 ? ", PR " + clock(pr) : "");
            txt(dc, c, S * 0.72, Graphics.FONT_XTINY, fit(dc, t, Graphics.FONT_XTINY, (S * 0.6).toNumber()), P.lbl);
            return;
        }
        if (k.equals("live")) {
            var done = fltOf(g["done"]), part = len > 0.0 ? done / len : 0.0, delta = numOf(g["delta"]), ahead = delta <= 0, col = ahead ? P.good : P.bad;
            if (part > 1.0) { part = 1.0; }
            dc.setPenWidth(pw(S * 0.03)); dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT); dc.drawCircle(c, c, r);
            if (part > 0.0) { dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); if (part >= 0.999) { dc.drawCircle(c, c, r); } else { dc.drawArc(c, c, r, Graphics.ARC_CLOCKWISE, 90, 90 - (part * 360).toNumber()); } }
            dc.setPenWidth(1);
            txt(dc, c, S * 0.17, Graphics.FONT_XTINY, fit(dc, name, Graphics.FONT_XTINY, (S * 0.6).toNumber()), P.fg);
            var ref = g.hasKey("ref") ? strOf(g["ref"]) : "PR"; // "PR" | "KOM" | "" (nothing to beat: the time runs)
            if (ref.length() == 0) {
                txt(dc, c, S * 0.37, Graphics.FONT_NUMBER_HOT, clock(numOf(g["time"])), P.fg);
                txt(dc, c, S * 0.505, Graphics.FONT_XTINY, "NO TIME TO BEAT", P.lbl);
            } else {
                txt(dc, c, S * 0.37, Graphics.FONT_NUMBER_HOT, (ahead ? "-" : "+") + clock(ahead ? -delta : delta), col);
                txt(dc, c, S * 0.505, Graphics.FONT_XTINY, (ahead ? "AHEAD OF " : "BEHIND ") + ref, col);
                var need = fltOf(g["need"]);
                if (need > 0.0) { // js/navroute.js needSpeed; 0 = out of reach
                    var nt = F.sp.equals("ride") ? (need * 3.6).format("%.1f") + " km/h" : Fields.pace(1000.0 / need, 1000.0) + " /km";
                    txt(dc, c, S * 0.63, Graphics.FONT_SMALL, fit(dc, "Need " + nt, Graphics.FONT_SMALL, (S * 0.76).toNumber()), P.fg);
                    txt(dc, c, S * 0.7, Graphics.FONT_XTINY, "FOR " + ref, P.lbl);
                } else { txt(dc, c, S * 0.655, Graphics.FONT_SMALL, fit(dc, ref + " out of reach", Graphics.FONT_SMALL, (S * 0.7).toNumber()), P.lbl); }
            }
            var left = len - done;
            txt(dc, c, S * 0.81, Graphics.FONT_XTINY, distTxt(left > 0.0 ? left : 0.0) + " to go", P.lbl);
            return;
        }
        var pr2 = g["pr"] == true, dl = numOf(g["delta"]), col2 = pr2 || dl <= 0 ? P.good : P.bad, ink = pr2 ? P.ink : P.fg;
        if (pr2) { dc.setColor(col2, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, c, c); }
        txt(dc, c, S * 0.22, Graphics.FONT_SMALL, pr2 ? "NEW PR" : "SEGMENT DONE", pr2 ? ink : P.acc);
        txt(dc, c, S * 0.31, Graphics.FONT_XTINY, fit(dc, name, Graphics.FONT_XTINY, (S * 0.66).toNumber()), ink);
        txt(dc, c, S * 0.5, Graphics.FONT_NUMBER_HOT, clock(numOf(g["time"])), ink);
        var ref2 = g.hasKey("ref") ? strOf(g["ref"]) : "PR";
        if (ref2.length() > 0) { txt(dc, c, S * 0.7, Graphics.FONT_MEDIUM, (dl <= 0 ? "-" : "+") + clock(dl < 0 ? -dl : dl) + " vs " + ref2, pr2 ? ink : col2); }
    }
    // js/watchsim.js routePage: next turn on top, the line with the position dot, the distance left at the bottom
    function routePage(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var r = F.route, ri = F.routeInfo();
        if (r == null) { return; }
        if (ri == null) { return; }
        var turn = ri["turn"], off = numOf(ri["off"]);
        if (off > 0) { // 19.11.: off the route (Feed.mc RouteTrack: more than 40 m for 8 s)
            txt(dc, S / 2, S * 0.165, Graphics.FONT_SMALL, "OFF ROUTE", P.bad);
            txt(dc, S / 2, S * 0.235, Graphics.FONT_XTINY, distTxt(off.toFloat()) + " away", P.fg);
        } else if (turn instanceof Dictionary) {
            var tn = turn as Dictionary, dir = strOf(tn["dir"]), tin = fltOf(tn["in"]), tt = strOf(tn["txt"]);
            turnArrow(dc, S * 0.28, S * 0.2, S * 0.08, dir.equals("L"), P.acc);
            var d = tin < 1000.0 ? (rnd(tin / 10.0) * 10).toString() + " m" : (tin / 1000.0).format("%.1f") + " km";
            txtL(dc, S * 0.37, S * 0.175, Graphics.FONT_MEDIUM, fit(dc, d, Graphics.FONT_MEDIUM, (S * 0.42).toNumber()), P.fg);
            if (tt.length() == 0) { tt = dir.equals("L") ? "Turn left" : "Turn right"; }
            txtL(dc, S * 0.37, S * 0.245, Graphics.FONT_XTINY, fit(dc, tt, Graphics.FONT_XTINY, (S * 0.4).toNumber()), P.lbl);
        } else {
            txt(dc, S / 2, S * 0.2, Graphics.FONT_XTINY, "FINISH AHEAD", P.acc);
        }
        // the route: points 0..1 in a box (flat u / v, Feed.mc RouteTrack.face); total length, then the part done in the accent up to the position
        var pu = arrOf(r["u"]), pv = arrOf(r["v"]), bx = S * 0.2, by = S * 0.315, bw = S * 0.6, bh = S * 0.38, n = pu.size();
        if (n < 2 || pv.size() != n) { return; }
        var tot = 0.0;
        for (var k = 1; k < n; k++) { tot += segLen(pu, pv, k, bw, bh); }
        dc.setColor(P.path, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.014));
        for (var k = 1; k < n; k++) { dc.drawLine(rp(pu, k - 1, bx, bw), rp(pv, k - 1, by, bh), rp(pu, k, bx, bw), rp(pv, k, by, bh)); }
        var to = fltOf(ri["pos"]) * tot, acc = 0.0, ax = rp(pu, 0, bx, bw), ay = rp(pv, 0, by, bh);
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.setPenWidth(pw(S * 0.022));
        for (var k = 1; k < n; k++) {
            var l = segLen(pu, pv, k, bw, bh), x0 = rp(pu, k - 1, bx, bw), y0 = rp(pv, k - 1, by, bh), x1 = rp(pu, k, bx, bw), y1 = rp(pv, k, by, bh);
            if (acc + l >= to) { var f = l > 0.0 ? (to - acc) / l : 0.0; ax = x0 + (x1 - x0) * f; ay = y0 + (y1 - y0) * f; dc.drawLine(x0, y0, ax, ay); break; }
            dc.drawLine(x0, y0, x1, y1); acc += l; ax = x1; ay = y1;
        }
        dc.setPenWidth(1);
        var fx = rp(pu, n - 1, bx, bw), fy = rp(pv, n - 1, by, bh);
        dc.setColor(P.fg, Graphics.COLOR_TRANSPARENT); dc.fillRectangle(fx - S * 0.016, fy - S * 0.016, S * 0.032, S * 0.032); // the finish
        if (F.navOn) { // the watch's real position (off the route it leaves the line; kept inside the screen)
            var mu = F.navU < -0.2 ? -0.2 : (F.navU > 1.2 ? 1.2 : F.navU), mv = F.navV < -0.4 ? -0.4 : (F.navV > 1.2 ? 1.2 : F.navV);
            ax = bx + mu * bw; ay = by + mv * bh;
        }
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(ax, ay, S * 0.034);
        dc.setColor(P.fg, Graphics.COLOR_TRANSPARENT); dc.fillCircle(ax, ay, S * 0.019);
        var km = kmTxt(fltOf(ri["left"])), w = dc.getTextWidthInPixels(km, Graphics.FONT_MEDIUM), uw = S * 0.07, x = S / 2 - (w + uw) / 2;
        txtL(dc, x, S * 0.79, Graphics.FONT_MEDIUM, km, P.fg);
        txtL(dc, x + w + S * 0.015, S * 0.805, Graphics.FONT_XTINY, "km", P.lbl);
        txt(dc, S / 2, S * 0.875, Graphics.FONT_XTINY, "TO FINISH", P.lbl);
    }
    // point k of the route on one axis (the flat u or v array), in pixels of the box at o with size w
    function rp(a as Array, k as Number, o as Float, w as Float) as Float { return o + fltOf(a[k]) * w; }
    function segLen(pu as Array, pv as Array, k as Number, bw as Float, bh as Float) as Float {
        var dx = (fltOf(pu[k]) - fltOf(pu[k - 1])) * bw, dy = (fltOf(pv[k]) - fltOf(pv[k - 1])) * bh;
        return Math.sqrt(dx * dx + dy * dy).toFloat();
    }
    // js/watchsim.js turnArrow: an arrow turning left or right (the curve as two lines)
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
