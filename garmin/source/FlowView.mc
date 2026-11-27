// RIDEFRAME Strength: one View for every screen. The Flow decides which screen shows (like js/watchflow.js), so the
// view stack stays one deep: BACK on the start screen leaves the app, every other BACK is the flow's.
// DRAFT, NOT COMPILED YET.
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

class FlowView extends WatchUi.View {
    var flow as Flow;
    var app;
    var pal as Palette;

    function initialize(f as Flow, a) {
        View.initialize();
        flow = f; app = a; pal = new Palette();
    }
    function onUpdate(dc as Dc) as Void {
        var t = Time.now().value();
        app.drawnSec = t; // 27.11.6: RideframeApp.onTick redraws when the second changes
        Draw.screen(dc, flow, pal, t, app.summary);
    }
}
