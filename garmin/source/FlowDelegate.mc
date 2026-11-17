// RIDEFRAME Strength: buttons and touch -> Flow events. The same mapping as js/watchsim.js (holdable, tapAt, touch):
//   START = select / set done / skip rest     UP, DOWN = scroll / change value (held: 10 kg or 5 reps, repeating)
//   BACK = back; on a set: weight <-> reps     BACK held = menu        swipe left = menu, swipe right = back
//   tap = the thing under the finger (a list row, a value, DONE, a digit)
// DRAFT, NOT COMPILED YET.
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

class FlowDelegate extends WatchUi.BehaviorDelegate {
    var flow as Flow;
    var app;
    var downKey = null;      // the key held right now
    var downAt as Number = 0;
    var held as Boolean = false;
    var holdTimer = null;

    function initialize(f as Flow, a) {
        BehaviorDelegate.initialize();
        flow = f; app = a;
    }

    // ---- buttons: pressed / released, so a hold can be told from a press ----
    // VERIFY (Toybox.WatchUi.InputDelegate onKeyPressed / onKeyReleased): returning true here keeps the system from also
    // sending onSelect / onBack / onNextPage / onPreviousPage. If not, those four must return true and do nothing.
    function onKeyPressed(evt as WatchUi.KeyEvent) as Boolean {
        var k = evt.getKey();
        if (k != WatchUi.KEY_UP && k != WatchUi.KEY_DOWN && k != WatchUi.KEY_ESC && k != WatchUi.KEY_ENTER) { return false; } // LIGHT stays the system's
        downKey = k; downAt = System.getTimer(); held = false;
        if (k != WatchUi.KEY_ENTER) {
            if (holdTimer == null) { holdTimer = new Timer.Timer(); }
            holdTimer.start(method(:onHold), k == WatchUi.KEY_ESC ? 700 : 500, false);
        }
        return true;
    }
    function onHold() as Void {
        if (downKey == null) { return; }
        held = true;
        if (downKey == WatchUi.KEY_ESC) { app.input(E_MENU, null); return; }
        app.input(downKey == WatchUi.KEY_UP ? E_UP_HOLD : E_DOWN_HOLD, null);
        holdTimer.start(method(:onHold), 350, false); // keeps stepping while held
    }
    function onKeyReleased(evt as WatchUi.KeyEvent) as Boolean {
        var k = evt.getKey();
        if (k != downKey) { return false; }
        if (holdTimer != null) { holdTimer.stop(); }
        downKey = null;
        if (held) { return true; }
        if (k == WatchUi.KEY_ENTER) { app.input(E_START, null); }
        else if (k == WatchUi.KEY_ESC) { app.input(E_BACK, null); }
        else if (k == WatchUi.KEY_UP) { app.input(E_UP, null); }
        else if (k == WatchUi.KEY_DOWN) { app.input(E_DOWN, null); }
        return true;
    }
    // behaviours the keys above already cover (and that touch devices also send for swipes): swallowed
    function onSelect() as Boolean { return true; }
    function onBack() as Boolean { return true; }
    function onNextPage() as Boolean { return true; }
    function onPreviousPage() as Boolean { return true; }
    function onMenu() as Boolean { app.input(E_MENU, null); return true; }

    // ---- touch ----
    function onSwipe(evt as WatchUi.SwipeEvent) as Boolean {
        var d = evt.getDirection();
        if (d == WatchUi.SWIPE_UP) { app.input(E_SWIPE_UP, null); }
        else if (d == WatchUi.SWIPE_DOWN) { app.input(E_SWIPE_DOWN, null); }
        else if (d == WatchUi.SWIPE_LEFT) { app.input(E_SWIPE_LEFT, null); }
        else if (d == WatchUi.SWIPE_RIGHT) { app.input(E_SWIPE_RIGHT, null); }
        return true;
    }
    // js/watchsim.js tapAt: the same table, in screen fractions
    function onTap(evt as WatchUi.ClickEvent) as Boolean {
        var xy = evt.getCoordinates(), S = System.getDeviceSettings().screenWidth.toFloat();
        var u = xy[0] / S, v = xy[1] / S, s = flow.scr;
        if (flow.flash != null) { app.input(E_TAP, null); return true; }
        if (s == S_SET) {
            if (v > 0.72 && (u - 0.5).abs() < 0.24) { app.input(E_START, null); }
            else if (v > 0.36 && v < 0.72) { app.input(E_FOCUS, u < 0.51 ? 0 : 1); }
            return true;
        }
        if (s == S_PICK || s == S_MENU) {
            var rows = s == S_MENU ? [[-1, 0.33], [0, 0.5], [1, 0.67]] : [[-2, 0.24], [-1, 0.345], [0, 0.5], [1, 0.7], [2, 0.8]];
            var best = rows[0];
            for (var i = 1; i < rows.size(); i++) { if ((rows[i][1] - v).abs() < (best[1] - v).abs()) { best = rows[i]; } }
            var n = s == S_MENU ? flow.menu.size() : flow.exCount(), idx = flow.sel + best[0];
            if (idx >= 0 && idx < n) { app.input(E_ITEM, idx); }
            return true;
        }
        if (s == S_PAIR) {
            if (v > 0.4 && v < 0.6 && u > 0.13 && u < 0.87) {
                var d = ((u - 0.146) / 0.118).toNumber();
                app.input(E_FOCUS, d < 0 ? 0 : (d > 5 ? 5 : d));
            } else { app.input(E_TAP, null); }
            return true;
        }
        app.input(E_TAP, null);
        return true;
    }
}
