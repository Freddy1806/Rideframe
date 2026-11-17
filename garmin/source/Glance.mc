// RIDEFRAME Strength: the glance in the watch's glance list. Shows the week's points and the change against last week,
// as the app last saw them (GET /api/watch/summary, kept in Application.Storage "summary"). A glance does no web
// requests of its own here; the numbers refresh whenever the app runs.
// DRAFT, NOT COMPILED YET.
import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

(:glance)
class RideframeGlance extends WatchUi.GlanceView {
    function initialize() { GlanceView.initialize(); }

    function onUpdate(dc as Dc) as Void {
        var s = Application.Storage.getValue("summary"); // VERIFY: Storage is readable from the glance process ("Glances" core topic)
        var h = dc.getHeight(), y = h / 2;
        // VERIFY: glance colours; most devices draw glances on black. Accent from the 64-colour palette works on both screens.
        var acc = 0xFF55AA;
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(0, y - h * 0.28, Graphics.FONT_XTINY, "RIDEFRAME", Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        if (!(s instanceof Dictionary) || s["pts"] == null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(0, y + h * 0.1, Graphics.FONT_SMALL, "Strength", Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }
        var pts = s["pts"].toNumber() + " pts", d = s["delta"] == null ? 0 : s["delta"].toNumber();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(0, y + h * 0.05, Graphics.FONT_SMALL, pts, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        var w = dc.getTextWidthInPixels(pts, Graphics.FONT_SMALL) + 8, t = h * 0.08, ty = y + h * 0.05;
        dc.setColor(acc, Graphics.COLOR_TRANSPARENT);
        if (d >= 0) { dc.fillPolygon([[w, ty + t], [w + 2 * t, ty + t], [w + t, ty - t]]); }
        else { dc.fillPolygon([[w, ty - t], [w + 2 * t, ty - t], [w + t, ty + t]]); }
        dc.drawText(w + 2 * t + 4, ty, Graphics.FONT_XTINY, (d < 0 ? -d : d) + " vs last week", Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}
