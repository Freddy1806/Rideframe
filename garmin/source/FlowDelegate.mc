// RIDEFRAME Strength: buttons and touch -> Flow events. The same mapping as js/watchsim.js (holdable, tapAt, touch):
//   START = select / skip rest; on a set: weight -> reps -> set logged; START held = weight <-> reps (23.11.)
//   UP, DOWN = scroll / change value (held: 10 kg or 5 reps, repeating)
//   BACK = back (23.11.: on a set or the rest: the exercise list; on the list with sets: Keep / Finish / Discard)
//   BACK held = menu        swipe left = menu, swipe right = back
//   tap = the thing under the finger (a list row, a value, DONE (logs at once), a digit); a finger dragged over a list moves it row by row
//   recording: UP / DOWN = page, START = pause, BACK = lap (first it closes the segment popup); swipe up / down = page
//   ready (run / ride): UP / DOWN or a tap on the route line = the Route choice (RPICK)
//   pause screen (every mode): START = resume, BACK held 3 s = save (a short BACK only shows the hint), DOWN / tap = Discard (confirm);
//   on the AMOLED touch face a finger resting on the "Hold to finish" pill = BACK held
//   indoor trainer (23.11.): UP / DOWN = +/- the step (held: 25 W), a tap on the left / right half = - / +, on the target = the step 5 / 10 / 25,
//   START = pause / resume, BACK = its menu, swipe up / down = the stats page
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// 23.11. diagnostics (Freddy: no touch arrives in the app on his fenix 8): the last touch event and how many came, shown under the menu
var gTouch as String = "touch: none yet";
var gTouchN as Number = 0;
function touchNote(kind as String, xy) as Void {
    gTouchN += 1;
    var t = kind;
    if (xy != null) { t = t + " " + xy[0].toString() + "," + xy[1].toString(); }
    gTouch = "touch " + gTouchN.toString() + ": " + t;
    WatchUi.requestUpdate();
}

class FlowDelegate extends WatchUi.BehaviorDelegate {
    var flow as Flow;
    var app;
    var downKey = null;      // the key held right now
    var downAt as Number = 0;
    var held as Boolean = false;
    var holdTimer = null;
    var pillHold as Boolean = false; // a finger on the pause screen's "Hold to finish" pill
    var pillUp as Number = 0;        // when it lifted (a tap right after a hold is not a tap)
    var dragY as Float = -1.0;       // 23.11.: a finger dragging a list: where it was at the last row step (-1 = none)
    var dragMoved as Boolean = false;
    var dragEnd as Number = 0;       // when a drag that moved the list ended (its swipe / tap is swallowed)

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
        if (holdTimer == null) { holdTimer = new Timer.Timer(); }
        // VERIFY on the device: START held (KEY_ENTER) reaches the app on the fenix 8 and is not taken by the system
        holdTimer.start(method(:onKeyHold), k == WatchUi.KEY_ESC || k == WatchUi.KEY_ENTER ? 700 : 500, false);
        return true;
    }
    function onKeyHold() as Void {
        if (downKey == null) { return; }
        held = true;
        if (downKey == WatchUi.KEY_ESC) { app.input(E_MENU, null); return; }
        if (downKey == WatchUi.KEY_ENTER) { app.input(E_START_HOLD, null); return; } // the set screen: weight <-> reps (once, no repeat)
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
    // 23.11. (Freddy on the fenix 8: no touch anywhere): a BehaviorDelegate that returns true for a behaviour stops the matching
    // InputDelegate call (SDK BehaviorDelegate overview). A tap is the Select behaviour and swipes are next / previous page, so
    // returning true here ate every onTap / onSwipe. false lets them through; the keys are handled in onKeyPressed / onKeyReleased.
    // onBack stays true: false would let the system leave the app on BACK.
    function onSelect() as Boolean { touchNote("select", null); return false; }
    function onBack() as Boolean { return true; }
    function onNextPage() as Boolean { return false; }
    function onPreviousPage() as Boolean { return false; }
    function onMenu() as Boolean { app.input(E_MENU, null); return true; }

    // ---- touch ----
    function onSwipe(evt as WatchUi.SwipeEvent) as Boolean {
        var d = evt.getDirection();
        touchNote("swipe " + d.toString(), null);
        if ((d == WatchUi.SWIPE_UP || d == WatchUi.SWIPE_DOWN) && dragged()) { return true; } // the drag already moved the list
        if (d == WatchUi.SWIPE_UP) { app.input(E_SWIPE_UP, null); }
        else if (d == WatchUi.SWIPE_DOWN) { app.input(E_SWIPE_DOWN, null); }
        else if (d == WatchUi.SWIPE_LEFT) { app.input(E_SWIPE_LEFT, null); }
        else if (d == WatchUi.SWIPE_RIGHT) { app.input(E_SWIPE_RIGHT, null); }
        return true;
    }
    // 23.11.: the screens a dragged finger scrolls (js/watchsim.js scrollable)
    function scrollable() as Boolean {
        var s = flow.scr;
        return flow.flash == null && (s == S_PICK || s == S_MENU || s == S_HOME || s == S_MORE || s == S_SMODE || s == S_RPICK || s == S_END || s == S_SAVEQ || s == S_SUM
            || s == S_TEND || (s == S_TSCAN && tList()));
    }
    // 23.11.: the trainer screen shows the list (searching), not one trainer's state (js tList)
    function tList() as Boolean { var v = flow.link.shown(); return v == TL_SCAN || v == TL_OFF; }
    // a drag that moved the list is running or just ended
    function dragged() as Boolean { return dragMoved && (dragY >= 0.0 || System.getTimer() - dragEnd < 500); }
    // 23.11. (js/watchsim.js touch pointermove): the list follows the finger, one row per DRAG_ROW of the screen.
    // VERIFY (Toybox.WatchUi.InputDelegate.onDrag / DragEvent, API 3.3.0): the fenix 8 sends DRAG_TYPE_START / CONTINUE / STOP
    // while the finger moves, and onSwipe may still follow at the end (swallowed above). If no drag events come, swipes still step.
    function onDrag(evt as WatchUi.DragEvent) as Boolean {
        if (!scrollable()) { dragY = -1.0; return false; }
        touchNote("drag", evt.getCoordinates());
        var t = evt.getType(), y = evt.getCoordinates()[1].toFloat(), row = System.getDeviceSettings().screenHeight * DRAG_ROW;
        if (t == WatchUi.DRAG_TYPE_START) { dragY = y; dragMoved = false; return true; }
        if (dragY < 0.0) { return false; }
        var n = ((dragY - y) / row).toNumber();
        if (n != 0) { dragY = dragY - n * row; dragMoved = true; app.input(E_SCROLL, n); }
        if (t == WatchUi.DRAG_TYPE_STOP) { dragY = -1.0; dragEnd = System.getTimer(); }
        return true;
    }
    // the "Hold to finish" pill (js/watchsim.js touch: pointerdown / pointerup on the pill)
    // VERIFY (Toybox.WatchUi.InputDelegate onHold / onRelease, API 1.0 / 3.x): onHold comes after the system's hold delay (so the
    // 3 s run from there), onRelease when the finger lifts, and no onTap follows a hold; if one does, pillUp skips it
    function onPill(evt as WatchUi.ClickEvent) as Boolean {
        var xy = evt.getCoordinates(), S = System.getDeviceSettings().screenWidth.toFloat();
        var u = xy[0] / S, v = xy[1] / S;
        return flow.scr == S_PAUSE && !flow.pzConf && hasTouch() && v > 0.75 && (u - 0.5).abs() < 0.27;
    }
    function onHold(evt as WatchUi.ClickEvent) as Boolean {
        touchNote("hold", evt.getCoordinates());
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
        touchNote("tap", evt.getCoordinates());
        var xy = evt.getCoordinates(), S = System.getDeviceSettings().screenWidth.toFloat();
        var u = xy[0] / S, v = xy[1] / S, s = flow.scr;
        if (dragged()) { return true; } // the end of a drag is no tap
        if (flow.flash != null) { app.input(E_TAP, null); return true; }
        if (s == S_PAUSE) { // js PAUSE_LAY: confirm: the Discard pill = yes, elsewhere = no; else the Discard row = ask, the top = resume
            if (pillHold || System.getTimer() - pillUp < 400) { return true; }
            if (flow.pzConf) { app.input((v - 0.68).abs() < 0.06 ? E_START : E_BACK, null); }
            else if ((v - 0.68).abs() < 0.055) { app.input(E_ITEM, 1); }
            else if (v < 0.62) { app.input(E_ITEM, 0); }
            return true;
        }
        if (s == S_SET) {
            if (v > 0.72 && (u - 0.5).abs() < 0.24) { app.input(E_DONE, null); } // DONE logs at once (START goes weight -> reps first)
            else if (v > 0.36 && v < 0.72) { app.input(E_FOCUS, u < 0.51 ? 0 : 1); }
            return true;
        }
        if (s == S_READY && !flow.sp.equals("other") && v > 0.665 && v < 0.74) { app.input(E_DOWN, null); return true; } // the route line
        if (s == S_TREC) { // 23.11. (js TREC_LAY): the stats page: back; - / + (the whole side) and the target (step size); the resume pill
            var R = flow.tr;
            if (R != null && R.pg != 0) { app.input(E_TAP, null); }
            else if (v > 0.225 && v < 0.56) { app.input(E_ITEM, u < 0.31 ? 0 : (u > 0.69 ? 1 : 2)); }
            else if (v > 0.78 && R != null && R.st != RS_RUN) { app.input(E_START, null); }
            return true;
        }
        if (s == S_TSCAN && !tList()) { app.input(E_TAP, null); return true; } // one trainer's state: like START
        var menu = s == S_MENU || s == S_END || s == S_SAVEQ || s == S_TEND, pick = s == S_PICK || s == S_MORE || s == S_SMODE || s == S_RPICK || s == S_TSCAN;
        if (s == S_HOME) {
            // the rows as Draw.drawHome draws them: row r at HOME_Y0 + r * HOME_DY, all four entries at once
            var hr = ((v - HOME_Y0) / HOME_DY + 0.5).toNumber(), hn = flow.listItems().size(), hi = flow.homeTop(hn) + hr;
            if (v >= HOME_Y0 - HOME_DY / 2 && hr < HOME_FIT && hi < hn) { app.input(E_ITEM, hi); }
            return true;
        }
        if (menu || pick) {
            // [offset, y] of the rows as Draw.list draws them (js LIST_LAY); the title and the counter are no row
            var offs = [-1, 0, 1, 2] as Array<Number>, ys = [0.3, 0.5, 0.72, 0.845] as Array<Float>;
            if (menu) { offs = [-1, 0, 1] as Array<Number>; ys = [0.33, 0.5, 0.67] as Array<Float>; }
            else if (v < 0.23) { return true; }
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
