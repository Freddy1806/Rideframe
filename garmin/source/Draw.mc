// RIDEFRAME Strength: drawing of every screen with the plain dc calls, scaled by the screen size (S = dc.getWidth()).
// Same layout numbers as js/watchsim.js DRAW (the browser preview), so the preview is the design reference.
// DRAFT, NOT COMPILED YET. Fonts are the device's system fonts, so sizes differ a little from the preview.
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;

// colours: AMOLED (fr265) gets the RIDEFRAME tones, MIP (fenix 7X Pro, 64 colours) only palette colours, no blending
class Palette {
    var fg as Number; var dim as Number; var faint as Number; var acc as Number; var ink as Number; var hr as Number;
    function initialize() {
        var ds = System.getDeviceSettings();
        // VERIFY: DeviceSettings.requiresBurnInProtection (API 3.0) is true on AMOLED watches (doc page Toybox.System.DeviceSettings)
        var amoled = (ds has :requiresBurnInProtection) && ds.requiresBurnInProtection;
        if (amoled) { fg = 0xF4F4EF; dim = 0x8B8B85; faint = 0x2C2C2A; acc = 0xFF4F9A; ink = 0x0B0B0B; hr = 0xFF5A5A; }
        else { fg = 0xFFFFFF; dim = 0xAAAAAA; faint = 0x555555; acc = 0xFF55AA; ink = 0x000000; hr = 0xFF5555; }
    }
}

// VERIFY (Monkey C "Scope" in the Programmer's Guide): the screen constants (S_START …) are globals from Flow.mc; if the
// compiler does not find them inside this module, write $.S_START.
module Draw {
    const VC = Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
    const VL = Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER;

    function clock(s as Number) as String {
        if (s < 0) { s = 0; }
        var h = s / 3600, m = (s % 3600) / 60, x = s % 60;
        return h > 0 ? h + ":" + m.format("%02d") + ":" + x.format("%02d") : m + ":" + x.format("%02d");
    }
    function kgTxt(kg as Float) as String {
        var r = (kg * 10.0 + 0.5).toNumber();
        return r % 10 == 0 ? (r / 10).toString() : (r / 10) + "." + (r % 10);
    }
    function volTxt(v as Float) as String {
        if (v >= 10000.0) { return kgTxt(v / 1000.0) + " t"; }
        return v.toNumber().toString();
    }
    // text cut to fit max px (with a dot, the system fonts may have no ellipsis)
    function fit(dc as Dc, t as String, font, max as Number) as String {
        if (dc.getTextWidthInPixels(t, font) <= max) { return t; }
        var s = t;
        while (s.length() > 1 && dc.getTextWidthInPixels(s + ".", font) > max) { s = s.substring(0, s.length() - 1); }
        return s + ".";
    }
    // the first font of the list that fits (big numbers shrink instead of being cut)
    function fontFor(dc as Dc, t as String, fonts as Array, max as Number) {
        for (var i = 0; i < fonts.size(); i++) { if (dc.getTextWidthInPixels(t, fonts[i]) <= max) { return fonts[i]; } }
        return fonts[fonts.size() - 1];
    }
    function txt(dc as Dc, x, y, font, t, col as Number) as Void { dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.drawText(x, y, font, t.toString(), VC); }
    function pill(dc as Dc, cx, cy, w, h, col as Number) as Void { dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.fillRoundedRectangle(cx - w / 2, cy - h / 2, w, h, h / 2); }
    // the arc that points at the START button (2 o'clock = 30 degrees, counter-clockwise from 3 o'clock)
    function startHint(dc as Dc, S as Number, P as Palette) as Void {
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.setPenWidth((S * 0.03).toNumber());
        dc.drawArc(S / 2, S / 2, S / 2 - (S * 0.02).toNumber(), Graphics.ARC_CLOCKWISE, 42, 18);
        dc.setPenWidth(1);
    }
    function tri(dc as Dc, x, y, s, up as Boolean, col as Number) as Void {
        dc.setColor(col, Graphics.COLOR_TRANSPARENT);
        var a = up ? y + s * 0.6 : y - s * 0.6, b = up ? y - s * 0.6 : y + s * 0.6;
        dc.fillPolygon([[x - s, a], [x + s, a], [x, b]]);
    }
    function dumbbell(dc as Dc, x, y, s, col as Number) as Void {
        dc.setColor(col, Graphics.COLOR_TRANSPARENT); dc.setPenWidth((s * 0.13).toNumber() + 1);
        var k = s / 24.0, L = [[3, 9, 3, 15], [6, 7, 6, 17], [18, 7, 18, 17], [21, 9, 21, 15], [6, 12, 18, 12]];
        for (var i = 0; i < L.size(); i++) { var l = L[i]; dc.drawLine(x + (l[0] - 12) * k, y + (l[1] - 12) * k, x + (l[2] - 12) * k, y + (l[3] - 12) * k); }
        dc.setPenWidth(1);
    }
    function heart(dc as Dc, x, y, s, col as Number) as Void {
        dc.setColor(col, Graphics.COLOR_TRANSPARENT);
        var r = s * 0.32; dc.fillCircle(x - r, y - r * 0.4, r); dc.fillCircle(x + r, y - r * 0.4, r);
        dc.fillPolygon([[x - 2 * r, y - r * 0.2], [x + 2 * r, y - r * 0.2], [x, y + s * 0.55]]);
    }
    function ago(at as Number) as String {
        var d = (Time.now().value() - at) / 86400;
        if (d < 1) { return "Today"; }
        if (d < 2) { return "Yesterday"; }
        var info = Gregorian.info(new Time.Moment(at), Time.FORMAT_MEDIUM); // VERIFY: day_of_week is a String with FORMAT_MEDIUM (Toybox.Time.Gregorian.info)
        return info.day_of_week.toString();
    }

    // ---- one function per screen (js/watchsim.js DRAW) ----
    function screen(dc as Dc, F as Flow, P as Palette, now as Number, sum) as Void {
        var S = dc.getWidth();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK); dc.clear();
        if (F.flash != null) { prFlash(dc, F, S, P); return; }
        var s = F.scr;
        if (s == S_START) { drawStart(dc, F, S, P, sum); }
        else if (s == S_PICK) { drawPick(dc, F, S, P); }
        else if (s == S_MENU) { drawMenu(dc, F, S, P); }
        else if (s == S_SET) { drawSet(dc, F, S, P, now); }
        else if (s == S_REST) { drawRest(dc, F, S, P, now); }
        else if (s == S_SUM) { drawSum(dc, F, S, P); }
        else if (s == S_PAIR) { drawPair(dc, F, S, P); }
    }
    function drawStart(dc as Dc, F as Flow, S as Number, P as Palette, sum) as Void {
        startHint(dc, S, P);
        var c = S / 2, wR = dc.getTextWidthInPixels("RIDE", Graphics.FONT_XTINY), wF = dc.getTextWidthInPixels("FRAME", Graphics.FONT_XTINY), x0 = c - (wR + wF) / 2;
        dc.setColor(P.fg, Graphics.COLOR_TRANSPARENT); dc.drawText(x0, S * 0.2, Graphics.FONT_XTINY, "RIDE", VL);
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.drawText(x0 + wR, S * 0.2, Graphics.FONT_XTINY, "FRAME", VL);
        dumbbell(dc, c, S * 0.31, S * 0.1, P.acc);
        txt(dc, c, S * 0.44, Graphics.FONT_LARGE, "Strength", P.fg);
        var L = F.setup["last"], line = F.exCount() == 0 ? "Loading" : "First session";
        if (L instanceof Dictionary) { line = ago(L["at"]) + ", " + L["sets"] + " sets"; }
        txt(dc, c, S * 0.56, Graphics.FONT_SMALL, fit(dc, line, Graphics.FONT_SMALL, (S * 0.7).toNumber()), P.dim);
        if (sum instanceof Dictionary && sum["pts"] != null) {
            var t = sum["pts"].toNumber() + " pts", d = sum["delta"] == null ? 0 : sum["delta"].toNumber(), tw = dc.getTextWidthInPixels(t, Graphics.FONT_SMALL);
            txt(dc, c - S * 0.04, S * 0.66, Graphics.FONT_SMALL, t, P.fg);
            if (d != 0) {
                tri(dc, c + tw / 2 + S * 0.0, S * 0.66, S * 0.018, d > 0, P.acc);
                dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.drawText(c + tw / 2 + S * 0.025, S * 0.66, Graphics.FONT_XTINY, (d > 0 ? d : -d).toString(), VL);
            }
        }
        pill(dc, c, S * 0.81, S * 0.42, S * 0.13, P.acc); txt(dc, c, S * 0.81, Graphics.FONT_SMALL, "START", P.ink);
    }
    // the picker and the menu share one list: selected row big in the middle, neighbours smaller and dimmer
    function drawPick(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var l = F.exList(), names = [];
        for (var i = 0; i < l.size(); i++) { names.add(l[i]["n"]); }
        list(dc, F, S, P, names, "EXERCISE", false);
        if (l.size() > 0) {
            var e = l[F.sel], sub = "New";
            if (e["s"] instanceof Array && e["s"].size() > 0) {
                var p = e["s"][0], k = p[0].toFloat();
                sub = ("bw".equals(e["t"]) && k == 0 ? "BW" : kgTxt(k) + " kg") + " x " + p[1];
            }
            txt(dc, S / 2, S * 0.585, Graphics.FONT_XTINY, sub, P.acc);
            txt(dc, S / 2, S * 0.185, Graphics.FONT_XTINY, (F.sel + 1) + "/" + l.size(), P.dim);
        }
    }
    function drawMenu(dc as Dc, F as Flow, S as Number, P as Palette) as Void { list(dc, F, S, P, F.menu, "MENU", true); }
    function list(dc as Dc, F as Flow, S as Number, P as Palette, items as Array, title as String, isMenu as Boolean) as Void {
        var n = items.size(), c = S / 2;
        txt(dc, c, S * 0.13, Graphics.FONT_XTINY, title, P.dim);
        // rows: [offset, y, font]; the same y values are the tap table in Delegates.mc
        var rows = isMenu ? [[-1, 0.33, Graphics.FONT_SMALL], [0, 0.5, Graphics.FONT_MEDIUM], [1, 0.67, Graphics.FONT_SMALL]]
                          : [[-2, 0.24, Graphics.FONT_XTINY], [-1, 0.345, Graphics.FONT_SMALL], [0, 0.5, Graphics.FONT_MEDIUM], [1, 0.7, Graphics.FONT_SMALL], [2, 0.8, Graphics.FONT_XTINY]];
        for (var r = 0; r < rows.size(); r++) {
            var o = rows[r][0], y = S * rows[r][1], f = rows[r][2], i = F.sel + o;
            if (i < 0 || i >= n) { continue; }
            var far = o > 1 || o < -1, w = (S * (far ? 0.55 : 0.74)).toNumber(), t = fit(dc, items[i], f, w);
            if (o == 0 && isMenu) { pill(dc, c, y, S * 0.78, S * 0.14, P.acc); txt(dc, c, y, f, t, P.ink); continue; }
            if (o == 0) { dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillRectangle(S * 0.1, y - S * 0.055, S * 0.012 + 1, S * 0.11); }
            txt(dc, c, y, f, t, o == 0 ? P.fg : (far ? P.faint : P.dim));
        }
        if (n > 1) { // scroll position on the left edge (150..210 degrees)
            dc.setPenWidth((S * 0.012).toNumber() + 1); dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT);
            dc.drawArc(c, c, c - S * 0.03, Graphics.ARC_COUNTER_CLOCKWISE, 150, 210);
            var p = F.sel.toFloat() / (n - 1), a = 150 + (p * 51).toNumber();
            dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.drawArc(c, c, c - S * 0.03, Graphics.ARC_COUNTER_CLOCKWISE, a, a + 9); dc.setPenWidth(1);
        }
        startHint(dc, S, P);
    }
    function drawSet(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var e = F.curEx(), c = S / 2, bw = F.isBw(e);
        startHint(dc, S, P);
        txt(dc, c, S * 0.12, Graphics.FONT_XTINY, clock(now - F.start), P.dim);
        txt(dc, c, S * 0.22, Graphics.FONT_SMALL, fit(dc, e["n"], Graphics.FONT_SMALL, (S * 0.74).toNumber()), P.fg);
        txt(dc, c, S * 0.315, Graphics.FONT_XTINY, "SET " + F.setNo(), P.acc);
        var val = [bw && F.kg == 0 ? "BW" : kgTxt(F.kg), F.reps.toString()], unit = [bw ? "+kg" : "kg", "reps"], xs = [S * 0.285, S * 0.735], mx = [S * 0.32, S * 0.27];
        txt(dc, S * 0.515, S * 0.5, Graphics.FONT_SMALL, "x", P.dim);
        for (var i = 0; i < 2; i++) {
            var on = F.focus == i;
            // number fonts have digits only (VERIFY: which glyphs FONT_NUMBER_* carry), so "BW" takes a text font
            var f = "BW".equals(val[i]) ? Graphics.FONT_LARGE : fontFor(dc, val[i], [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD], mx[i].toNumber());
            txt(dc, xs[i], S * 0.5, f, val[i], on ? P.acc : P.fg);
            if (on) { dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillRectangle(xs[i] - S * 0.12, S * 0.615, S * 0.24, S * 0.016 + 1); }
            txt(dc, xs[i], S * 0.665, Graphics.FONT_XTINY, unit[i], on ? P.fg : P.dim);
        }
        pill(dc, c, S * 0.815, S * 0.4, S * 0.12, P.acc); txt(dc, c, S * 0.815, Graphics.FONT_SMALL, "DONE", P.ink);
    }
    function drawRest(dc as Dc, F as Flow, S as Number, P as Palette, now as Number) as Void {
        var left = F.restLeft(now), c = S / 2, r = c - (S * 0.04).toNumber(), e = F.curEx();
        var part = F.restLen > 0 ? left.toFloat() / F.restLen : 0.0;
        dc.setPenWidth((S * 0.05).toNumber()); dc.setColor(P.faint, Graphics.COLOR_TRANSPARENT); dc.drawCircle(c, c, r);
        if (part > 0.0) {
            dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT);
            if (part >= 0.999) { dc.drawCircle(c, c, r); }
            else { dc.drawArc(c, c, r, Graphics.ARC_CLOCKWISE, 90, 90 - (part * 360).toNumber()); } // from 12 o'clock, clockwise
        }
        dc.setPenWidth(1);
        heart(dc, c - S * 0.08, S * 0.27, S * 0.05, P.hr);
        dc.setColor(P.fg, Graphics.COLOR_TRANSPARENT); dc.drawText(c - S * 0.03, S * 0.27, Graphics.FONT_SMALL, F.hr > 0 ? F.hr.toString() : "--", VL);
        txt(dc, c, S * 0.46, Graphics.FONT_NUMBER_HOT, clock(left), left <= 5 ? P.acc : P.fg);
        txt(dc, c, S * 0.625, Graphics.FONT_XTINY, "NEXT", P.dim);
        txt(dc, c, S * 0.7, Graphics.FONT_XTINY, fit(dc, "Set " + F.setNo() + ": " + e["n"], Graphics.FONT_XTINY, (S * 0.66).toNumber()), P.fg);
        txt(dc, c, S * 0.82, Graphics.FONT_XTINY, "SKIP", P.acc);
    }
    function prFlash(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var f = F.flash, c = S / 2;
        dc.setColor(P.acc, Graphics.COLOR_TRANSPARENT); dc.fillCircle(c, c, c);
        txt(dc, c, S * 0.27, Graphics.FONT_SMALL, "NEW RECORD", P.ink);
        txt(dc, c, S * 0.5, Graphics.FONT_LARGE, "PR", P.ink); // VERIFY on the device: FONT_LARGE may look small here; a bitmap "PR" would be bigger
        txt(dc, c, S * 0.72, Graphics.FONT_MEDIUM, f["bw"] ? f["reps"] + " reps" : kgTxt(f["kg"]) + " x " + f["reps"], P.ink);
    }
    function drawSum(dc as Dc, F as Flow, S as Number, P as Palette) as Void {
        var s = F.sum, c = S / 2;
        if (s == null) { return; }
        var st = s["st"];
        if (st == ST_SAVED) { txt(dc, c, S * 0.17, Graphics.FONT_SMALL, "SAVED", P.acc); }
        else if (st == ST_SENDING) { txt(dc, c, S * 0.17, Graphics.FONT_SMALL, "SENDING", P.dim); }
        else if (st == ST_FAILED) { txt(dc, c, S * 0.17, Graphics.FONT_SMALL, "NOT SAVED", P.acc); }
        else { txt(dc, c, S * 0.14, Graphics.FONT_XTINY, "Will send when", P.fg); txt(dc, c, S * 0.2, Graphics.FONT_XTINY, "the phone is near", P.fg); }
        txt(dc, c, S * 0.36, Graphics.FONT_NUMBER_MEDIUM, clock(s["dur"]), P.fg);
        txt(dc, c, S * 0.46, Graphics.FONT_XTINY, "TIME", P.dim);
        var v = [s["sets"].toString(), volTxt(s["vol"]), s["exs"].toString()], l = ["SETS", "KG", "LIFTS"];
        for (var i = 0; i < 3; i++) { var x = S * (0.27 + i * 0.23); txt(dc, x, S * 0.6, Graphics.FONT_MEDIUM, v[i], P.fg); txt(dc, x, S * 0.68, Graphics.FONT_XTINY, l[i], P.dim); }
        if (s["prs"] > 0) { txt(dc, c, S * 0.78, Graphics.FONT_SMALL, s["prs"] + " PR", P.acc); }
        txt(dc, c, S * 0.87, Graphics.FONT_XTINY, "DONE", P.dim);
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
}
