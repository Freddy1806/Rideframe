// RIDEFRAME: the glance in the watch's glance list. Shows the week's points and the change against last week, as the app last saw
// them (GET /api/watch/summary, kept in Application.Storage "summary"). A glance does no web requests of its own here; the numbers
// refresh whenever the app runs.
// 23.11.8: the layout of js/watchscreens.js glance() (same numbers): the lines stacked from the fonts' real sizes, SMALL for the points
// and XTINY where SMALL does not fit the glance's height (font size setting), the change with "vs last week" only where it fits.
// The glance runs in the glance process, so it has its own copies of the few layout helpers (module Draw is not loaded there).
import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

(:glance)
class RideframeGlance extends WatchUi.GlanceView {
    function initialize() { GlanceView.initialize(); }

    // js/watchscreens.js gap / hasDesc / up / dn / byInk
    function gap(S) as Float { return S * 0.008 > 2 ? S * 0.008 : 2.0; }
    function hasDesc(t as String) as Boolean {
        var a = t.toCharArray();
        for (var i = 0; i < a.size(); i++) { if ("gjpqy,;()Q".find(a[i].toString()) != null) { return true; } }
        return false;
    }
    // VERIFY (Toybox.Graphics.getFontAscent): callable from the glance process
    function up(dc as Dc, f) as Float { return dc.getFontHeight(f) / 2.0 - 0.16 * Graphics.getFontAscent(f); }
    function dn(dc as Dc, f, t as String) as Float {
        var h = dc.getFontHeight(f).toFloat(), a = Graphics.getFontAscent(f).toFloat();
        return hasDesc(t) ? a - h / 2.0 + 1.1 * (h - a) : a - h / 2.0 + 1;
    }
    function byInk(dc as Dc, fonts as Array, h) {
        for (var i = 0; i < fonts.size(); i++) { if (up(dc, fonts[i]) + dn(dc, fonts[i], "g") <= h) { return fonts[i]; } }
        return fonts[fonts.size() - 1];
    }

    // a number from Storage, rounded (0 for anything else)
    function rd(v) as Number {
        if (!(v instanceof Number || v instanceof Float || v instanceof Double || v instanceof Long)) { return 0; }
        var x = v.toFloat();
        return x >= 0.0 ? (x + 0.5).toNumber() : -((0.5 - x).toNumber());
    }

    function onUpdate(dc as Dc) as Void {
        var s = Application.Storage.getValue("summary"); // VERIFY: Storage is readable from the glance process ("Glances" core topic)
        glance(dc, 0, 0, dc.getWidth(), dc.getHeight(), s);
    }
    // RIDEFRAME, the points (SMALL, else XTINY), the change (with "vs last week" where it fits) in the box (x, y, w, h)
    function glance(dc as Dc, x, y, w, h, sum) as Void {
        var VL = Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER, XT = Graphics.FONT_XTINY, SM = Graphics.FONT_SMALL;
        // VERIFY: glance colours; most devices draw glances on black. The accent from the 64-colour palette works on both screens.
        var fg = Graphics.COLOR_WHITE, dim = Graphics.COLOR_LT_GRAY, acc = 0xFF5500;
        var G = gap(dc.getWidth()), tf = XT, ty = y + up(dc, tf) + 1;
        dc.setColor(dim, Graphics.COLOR_TRANSPARENT); dc.drawText(x, ty, tf, "RIDEFRAME", VL);
        var vy0 = ty + dn(dc, tf, "R") + G;
        if (!(sum instanceof Dictionary) || (sum as Dictionary)["pts"] == null) {
            var f0 = byInk(dc, [SM, XT], y + h - vy0);
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT); dc.drawText(x, vy0 + up(dc, f0), f0, "Strength", VL);
            return;
        }
        var sd = sum as Dictionary, pv = sd["pts"], dv = sd["delta"];
        var pts = rd(pv).toString() + " pts", d = rd(dv), ad = d < 0 ? -d : d;
        var f = byInk(dc, [SM, XT], y + h - vy0), vy = vy0 + up(dc, f), pw0 = dc.getTextWidthInPixels(pts, f);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT); dc.drawText(x, vy, f, pts, VL);
        var t = dc.getFontHeight(XT) * 0.25, x1 = x + pw0 + 8, room = w - (pw0 + 8 + 2 * t + 4);
        var dt = dc.getTextWidthInPixels(ad.toString() + " vs last week", XT) <= room ? ad.toString() + " vs last week" : ad.toString();
        if (dc.getTextWidthInPixels(dt, XT) > room) { return; }
        dc.setColor(acc, Graphics.COLOR_TRANSPARENT);
        if (d >= 0) { dc.fillPolygon([[x1, vy + t], [x1 + 2 * t, vy + t], [x1 + t, vy - t]]); }
        else { dc.fillPolygon([[x1, vy - t], [x1 + 2 * t, vy - t], [x1 + t, vy + t]]); }
        dc.drawText(x1 + 2 * t + 4, vy, XT, dt, VL);
    }
}
