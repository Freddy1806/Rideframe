// RIDEFRAME Strength: buttons and touch -> Flow events. The same mapping as js/watchsim.js (holdable, tapAt, touch):
//   START = select / set done / skip rest     UP, DOWN = scroll / change value (held: 10 kg or 5 reps, repeating)
//   BACK = back; on a set: weight <-> reps     BACK held = menu        swipe left = menu, swipe right = back
//   tap = the thing under the finger (a list row, a value, DONE, a digit)
//   recording: UP / DOWN = page, START = pause, BACK = lap (first it closes the segment popup); swipe up / down = page
//   ready (run / ride): UP / DOWN or a tap on the route line = the Route choice (RPICK)
//   pause screen (every mode): START = resume, BACK held 3 s = save (a short BACK only shows the hint), DOWN / tap = Discard (confirm);
//   on the AMOLED touch face a finger resting on the "Hold to finish" pill = BACK held
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
    var pillHold as Boolean = false; // a finger on the pause screen's "Hold to finish" pill
    var pillUp as Number = 0;        // when it lifted (a tap right after a hold is not a tap)

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
        if (k == WatchUi.KEY_ESC) { app.input(E_HOLD_START, downAt); } // the pause screen's hold to finish (the flow ignores it elsewhere)
        if (k != WatchUi.KEY_ENTER) {
            if (holdTimer == null) { holdTimer = new Timer.Timer(); }
            holdTimer.start(method(:onKeyHold), k == WatchUi.KEY_ESC ? 700 : 500, false);
        }
        return true;
    }
    function onKeyHold() as Void {
        if (downKey == null) { return; }
        held = true;
        if (downKey == WatchUi.KEY_ESC) { app.input(E_MENU, null); return; }
        app.input(downKey == WatchUi.KEY_UP ? E_UP_HOLD : E_DOWN_HOLD, null);
        holdTimer.start(method(:onKeyHold), 350, false); // keeps stepping while held
    }
    function onKeyReleased(evt as WatchUi.KeyEvent) as Boolean {
        var k = evt.getKey();
        if (k != downKey) { return false; }
        if (holdTimer != null) { holdTimer.stop(); }
        downKey = null;
        if (k == WatchUi.KEY_ESC) { app.input(E_HOLD_END, System.getTimer()); }
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
    // the "Hold to finish" pill (js/watchsim.js touch: pointerdown / pointerup on the pill)
    // VERIFY (Toybox.WatchUi.InputDelegate onHold / onRelease, API 1.0 / 3.x): onHold comes after the system's hold delay (so the
    // 3 s run from there), onRelease when the finger lifts, and no onTap follows a hold; if one does, pillUp skips it
    function onPill(evt as WatchUi.ClickEvent) as Boolean {
        var xy = evt.getCoordinates(), S = System.getDeviceSettings().screenWidth.toFloat();
        var u = xy[0] / S, v = xy[1] / S;
        return flow.scr == S_PAUSE && !flow.pzConf && isAmoled() && v > 0.75 && (u - 0.5).abs() < 0.27;
    }
    function onHold(evt as WatchUi.ClickEvent) as Boolean {
        if (!onPill(evt)) { return false; }
        pillHold = true; app.input(E_HOLD_START, System.getTimer());
        return true;
    }
    function onRelease(evt as WatchUi.ClickEvent) as Boolean {
        if (!pillHold) { return false; }
        pillHold = false; pillUp = System.getTimer(); app.input(E_HOLD_END, pillUp);
        return true;
    }
    // js/watchsim.js tapAt: the same table, in screen fractions
    function onTap(evt as WatchUi.ClickEvent) as Boolean {
        var xy = evt.getCoordinates(), S = System.getDeviceSettings().screenWidth.toFloat();
        var u = xy[0] / S, v = xy[1] / S, s = flow.scr;
        if (flow.flash != null) { app.input(E_TAP, null); return true; }
        if (s == S_PAUSE) { // js PAUSE_LAY: confirm: the Discard pill = yes, elsewhere = no; else the Discard row = ask, the top = resume
            if (pillHold || System.getTimer() - pillUp < 400) { return true; }
            if (flow.pzConf) { app.input((v - 0.68).abs() < 0.06 ? E_START : E_BACK, null); }
            else if ((v - 0.68).abs() < 0.055) { app.input(E_ITEM, 1); }
            else if (v < 0.62) { app.input(E_ITEM, 0); }
            return true;
        }
        if (s == S_SET) {
            if (v > 0.72 && (u - 0.5).abs() < 0.24) { app.input(E_START, null); }
            else if (v > 0.36 && v < 0.72) { app.input(E_FOCUS, u < 0.51 ? 0 : 1); }
            return true;
        }
        if (s == S_READY && !flow.sp.equals("other") && v > 0.665 && v < 0.74) { app.input(E_DOWN, null); return true; } // the route line
        var menu = s == S_MENU || s == S_SMODE, pick = s == S_PICK || s == S_MORE || s == S_WPICK || s == S_RPICK;
        if (s == S_HOME) {
            // the rows as Draw.drawHome draws them: row r at HOME_Y0 + r * HOME_DY, all four entries at once
            var hr = ((v - HOME_Y0) / HOME_DY + 0.5).toNumber(), hn = flow.listItems().size(), hi = flow.homeTop(hn) + hr;
            if (v >= HOME_Y0 - HOME_DY / 2 && hr < HOME_FIT && hi < hn) { app.input(E_ITEM, hi); }
            return true;
        }
        if (menu || pick) {
            // [offset, y] of the rows as Draw.list draws them
            var offs = [-2, -1, 0, 1, 2] as Array<Number>, ys = [0.24, 0.345, 0.5, 0.7, 0.8] as Array<Float>;
            if (menu) { offs = [-1, 0, 1] as Array<Number>; ys = [0.33, 0.5, 0.67] as Array<Float>; }
            var best = 0;
            for (var i = 1; i < ys.size(); i++) { if ((ys[i] - v).abs() < (ys[best] - v).abs()) { best = i; } }
            var n = flow.listItems().size(), idx = flow.sel + offs[best];
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
        app.input(E_TAP, null); // REC: closes the segment popup; READY / START / REST / SUM / RSUM: like START
        return true;
    }
}
