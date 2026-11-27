// RIDEFRAME Strength: buttons and touch -> Flow events. The same mapping as js/watchsim.js (holdable, tapAt, touch):
//   START = select / skip rest; on a set: weight -> reps -> set logged; START held = weight <-> reps (23.11.)
//   UP, DOWN = scroll / change value (held: 10 kg or 5 reps, repeating)
//   BACK = back (23.11.: on a set or the rest: the exercise list; on the list with sets: Keep / Finish / Discard)
//   BACK held = menu        swipe left = menu, swipe right = back
//   tap = the thing under the finger (a list row, a value, DONE (logs at once), a digit); 27.11.6: a finger dragged over a list moves it
//   by its pixels (Flow E_DRAG), the lift lets it coast and snap onto a row (E_DRAG_END, the app's timer E_ANIM); a tapped row / button
//   flashes PRESS_MS (E_PRESS), a row's action runs after the flash (taps in between are dropped: the screen may change)
//   23.11.7: a finger dragged up / down over kg / reps (the trainer's target) turns it like a wheel, one step per WHEEL_STEP, up = more;
//   a drag is never also a tap or a swipe
//   recording: UP / DOWN = page, START = pause, BACK = lap (first it closes the segment popup); swipe up / down = page
//   ready (run / ride): UP / DOWN or a tap on the route line = the Route choice (RPICK)
//   pause screen (every mode): START = resume, BACK held 3 s = save (a short BACK only shows the hint), DOWN / tap = Discard (confirm);
//   on the AMOLED touch face a finger resting on the "Hold to finish" pill = BACK held
//   indoor trainer ride (28.11., 27.11.3): UP / DOWN = the previous / next page (wrapping, like Garmin's activity pages), UP / DOWN held =
//   + / - one step (repeating every 350 ms), on the target page a tap on the left / right third = - / +, on the target = the step 5 / 10 / 25,
//   a tap on another page = the target page, START = pause / resume, BACK = the ride menu (the ride goes on), swipe up / down = page
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// 27.11.6: the touch diagnostics line under the menu (23.11., gTouch / touchNote) is gone: it redrew on every touch event (touch-concept.md)
// 23.11.7: the wheel on screen (Draw.wheelOn / wheelNb; js/watchsim.js wheelUi): the column turned (-1 none; the trainer's target 0),
// on which screen, and when the finger lifted (System.getTimer(); 0 while it is down); the neighbours go WHEEL_SHOW_MS after the lift
// (27.11.6: the app's timer redraws then, RideframeApp.onTick; no timer of its own)
var gWheel as Number = -1;
var gWheelScr as Number = -1;
var gWheelEnd as Number = 0;
// a number's size as a Float (one helper for Number and Float; the coordinates come as Number)
function absF(x) as Float { return x < 0 ? -x.toFloat() : x.toFloat(); }
// 23.11.8: the row Draw drew nearest to v (within 0.09 of the screen), from gRows ([offset, y / S]); null when none
function rowAt(v as Float) as Array? {
    var b = null, bd = 0.09;
    for (var i = 0; i < gRows.size(); i++) { var r = gRows[i] as Array, d = absF((r[1] as Float) - v); if (d < bd) { b = r; bd = d; } }
    return b;
}
// 23.11.8: one back per gesture. A swipe right is a back (Flow: E_SWIPE_RIGHT = E_BACK); a device that also reports it as the BACK
// behaviour (onBack) or the BACK key must not step back twice: whichever comes second within BACK_DEDUP_MS is dropped.
const BACK_DEDUP_MS = 300;

class FlowDelegate extends WatchUi.BehaviorDelegate {
    var flow as Flow;
    var app;
    var downKey = null;      // the key held right now
    var downAt as Number = 0;
    var held as Boolean = false;
    var holdTimer = null;
    var pillHold as Boolean = false; // a finger on the pause screen's "Hold to finish" pill
    var pillUp as Number = 0;        // when it lifted (a tap right after a hold is not a tap)
    // 23.11.7 (js/watchsim.js touch): one drag: where it started, the anchor of the next step (moved by whole steps, so no movement is
    // lost between events), what it does (DM_*), the wheel's column, when it ended (the swipe / tap that ends it is swallowed)
    var dragOn as Boolean = false;
    var dragX0 as Float = 0.0;
    var dragY0 as Float = 0.0;
    var dragY as Float = 0.0;
    var dragMode as Number = 0;      // 0 not decided yet, 1 rows (the summary pages), 2 wheel, 3 nothing (a swipe, horizontal, or a screen without either), 4 a list by its pixels (27.11.6)
    var dragCol as Number = 0;
    var dragEnd as Number = 0;
    var swipedIn as Boolean = false;
    var dragLast as Number = 0;      // the last drag event (a drag whose STOP never comes stops counting after 1.5 s)
    var backAt as Number = -100000;  // 23.11.8: when the last back went to the flow (the BACK key or onBack), and the last swipe right
    var swipeRAt as Number = -100000;
    var escAt as Number = -100000;   // the BACK key's last press / release (its onBack, if the system still sends one, is the same back)
    var keyAt as Number = -100000;   // 28.11.: the last release of a key this delegate handles (a menu behaviour that comes with it is the key's)
    var scrS as Float = 260.0;       // 27.11.6: the screen size, once (touch-concept.md: no getDeviceSettings per drag event)

    function initialize(f as Flow, a) {
        BehaviorDelegate.initialize();
        flow = f; app = a;
        scrS = System.getDeviceSettings().screenWidth.toFloat();
    }

    // ---- buttons: pressed / released, so a hold can be told from a press ----
    // VERIFY (Toybox.WatchUi.InputDelegate onKeyPressed / onKeyReleased): returning true here keeps the system from also
    // sending onSelect / onBack / onNextPage / onPreviousPage. If not, those four must return true and do nothing.
    function onKeyPressed(evt as WatchUi.KeyEvent) as Boolean {
        var k = evt.getKey();
        if (k != WatchUi.KEY_UP && k != WatchUi.KEY_DOWN && k != WatchUi.KEY_ESC && k != WatchUi.KEY_ENTER) { return false; } // LIGHT stays the system's
        downKey = k; downAt = System.getTimer(); held = false;
        if (k == WatchUi.KEY_ESC) { escAt = downAt; app.input(E_HOLD_START, downAt); } // the pause screen's hold to finish (the flow ignores it elsewhere)
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
        downKey = null; keyAt = System.getTimer();
        if (k == WatchUi.KEY_ESC) { escAt = keyAt; app.input(E_HOLD_END, escAt); }
        if (held) { return true; }
        if (k == WatchUi.KEY_ENTER) { app.input(E_START, null); }
        else if (k == WatchUi.KEY_ESC) { back(); }
        else if (k == WatchUi.KEY_UP) { app.input(E_UP, null); }
        else if (k == WatchUi.KEY_DOWN) { app.input(E_DOWN, null); }
        return true;
    }
    // behaviours the keys above already cover (and that touch devices also send for swipes): swallowed
    // 23.11. (Freddy on the fenix 8: no touch anywhere): a BehaviorDelegate that returns true for a behaviour stops the matching
    // InputDelegate call (SDK BehaviorDelegate overview). A tap is the Select behaviour and swipes are next / previous page, so
    // returning true here ate every onTap / onSwipe. false lets them through; the keys are handled in onKeyPressed / onKeyReleased.
    // onBack stays true: false would let the system leave the app on BACK.
    function onSelect() as Boolean { return false; }
    // the BACK behaviour: the key is handled in onKeyPressed / onKeyReleased (its onBack, if one still comes, is dropped); a back that
    // comes without the key (a device that sends a swipe right as BACK) is one back, unless its swipe already was
    function onBack() as Boolean {
        if (System.getTimer() - escAt > 1000) { back(); }
        return true;
    }
    // 23.11.8: one E_BACK per gesture (BACK_DEDUP_MS)
    function back() as Void {
        var t = System.getTimer();
        if (t - swipeRAt < BACK_DEDUP_MS) { return; }
        backAt = t; app.input(E_BACK, null);
    }
    function onNextPage() as Boolean { return false; }
    function onPreviousPage() as Boolean { return false; }
    // 28.11.: on the fenix 8 the menu behaviour is UP held (VERIFY: whether it still comes when onKeyPressed took KEY_UP). UP held is + one
    // step on the ride, so a menu behaviour while one of our keys is down (or just released) belongs to that key and is dropped; a real
    // MENU key (other watches: not handled in onKeyPressed) still opens the menu
    function onMenu() as Boolean {
        if (downKey != null || System.getTimer() - keyAt < 600) { return true; }
        app.input(E_MENU, null); return true;
    }

    // ---- touch ----
    function onSwipe(evt as WatchUi.SwipeEvent) as Boolean {
        var d = evt.getDirection();
        if (dragged()) { // 23.11.7: the drag already moved the list / turned the wheel: no page change, no menu
            if (dragMode == 4 && flow.lmode == 1) { dragOn = false; dragEnd = System.getTimer(); app.input(E_DRAG_END, dragEnd); } // its STOP did not come: the swipe ends it
            return true;
        }
        if (dragOn) { swipedIn = true; }  // a swipe before the drag was decided (a flick): the drag's end adds no rows to it
        if (d == WatchUi.SWIPE_UP) { app.input(E_SWIPE_UP, null); }
        else if (d == WatchUi.SWIPE_DOWN) { app.input(E_SWIPE_DOWN, null); }
        else if (d == WatchUi.SWIPE_LEFT) { app.input(E_SWIPE_LEFT, null); }
        else if (d == WatchUi.SWIPE_RIGHT) { var t = System.getTimer(); if (t - backAt >= BACK_DEDUP_MS) { swipeRAt = t; app.input(E_SWIPE_RIGHT, null); } }
        return true;
    }
    // 23.11.: the screens a dragged finger scrolls (js/watchsim.js scrollable)
    function scrollable() as Boolean {
        var s = flow.scr;
        return flow.flash == null && (s == S_PICK || s == S_MENU || s == S_HOME || s == S_MORE || s == S_SMODE || s == S_RPICK || s == S_END || s == S_SAVEQ || s == S_SUM
            || s == S_TEND || s == S_TPICK || (s == S_TSCAN && tList()));
    }
    // 23.11.: the trainer screen shows the list (searching), not one trainer's state (js tList)
    function tList() as Boolean { var v = flow.link.shown(); return v == TL_SCAN || v == TL_OFF; }
    // a drag that moved a list or turned a wheel is running or ended less than 500 ms ago: the swipe / tap the system sends after it is no input
    function dragged() as Boolean {
        var t = System.getTimer();
        return (dragMode == 1 || dragMode == 2 || dragMode == 4) && ((dragOn && t - dragLast < 1500) || t - dragEnd < 500);
    }
    // js/watchsim.js dragMode(u, v): what a vertical drag that starts at (u, v) does: 2 = the wheel over the set screen's numbers (timed: the
    // seconds; dragCol = the column) or the trainer's target, 1 = a list, 3 = nothing (the swipe that follows counts)
    function dragModeAt(u as Float, v as Float) as Number {
        var s = flow.scr;
        if (flow.flash != null) { return 3; }
        if (s == S_SET && v > 0.36 && v < 0.72) { dragCol = flow.isTime(flow.curEx()) || u >= 0.51 ? 1 : 0; return 2; }
        if (s == S_TREC) {
            var R = flow.tr;
            if (R != null) { if (flow.tPage().equals("target") && v > gT0 && v < gT1) { dragCol = 0; return 2; } } // the target's zone as drawn (Draw gT0 / gT1)
        }
        return scrollable() ? 1 : 3;
    }
    // 23.11.7 (js/watchsim.js touch pointermove; Freddy: "scrolling works really badly", "like a rotary wheel"): once the finger has moved
    // DRAG_MIN of the screen, mostly up / down, the drag is decided by where it started: the wheel (one step per WHEEL_STEP, finger up = more)
    // or the list (one row per row distance as drawn, flow.dragRow()). Every step is measured from an anchor that moves by whole steps, so
    // slow or sparse events lose nothing (the tactix / fenix 8 sends about 15 a second, fewer on a long drag: forum bug CIQQA-4206).
    // VERIFY (Toybox.WatchUi.InputDelegate.onDrag / DragEvent, API 3.3.0): DRAG_TYPE_START / CONTINUE / STOP with screen pixel coordinates;
    // a swipe follows the drag (swallowed in onSwipe while dragged()); without any drag events the swipe moves a list SWIPE_ROWS rows.
    function onDrag(evt as WatchUi.DragEvent) as Boolean {
        var xy = evt.getCoordinates(), t = evt.getType(), S = scrS;
        var x = xy[0].toFloat(), y = xy[1].toFloat(), ms = System.getTimer();
        dragLast = ms;
        if (t == WatchUi.DRAG_TYPE_START || !dragOn) { dragOn = true; dragX0 = x; dragY0 = y; dragY = y; dragMode = 0; swipedIn = false; }
        if (dragMode == 0) {
            var dx = absF(x - dragX0), dy = absF(y - dragY0);
            if (dy >= S * DRAG_MIN && dy > dx) {
                if (flow.prWait()) { app.input(E_ANIM, ms + PRESS_MS); } // 27.11.6: a tapped row's action first (its flash is cut short)
                dragMode = dragModeAt(dragX0 / S, dragY0 / S);
                if (dragMode == 1 && flow.pxList()) { dragMode = 4; }
                if (dragMode == 2) { gWheel = dragCol; gWheelScr = flow.scr; gWheelEnd = 0; }
            } else if (dx >= S * DRAG_MIN && dx > dy) { dragMode = 3; }
        }
        if (dragMode == 4) { // 27.11.6: the list moves by the finger's pixels since the last event (the first one: since the touch)
            var dd = (dragY - y) / S;
            dragY = y;
            if (dd != 0.0 && !swipedIn) { app.input(E_DRAG, [dd, ms]); }
        } else if (dragMode == 1 || dragMode == 2) {
            var step = S * (dragMode == 2 ? WHEEL_STEP : flow.dragRow()), n = ((dragY - y) / step).toNumber();
            if (n != 0 && !swipedIn) {
                dragY = dragY - n * step;
                if (dragMode == 2) { app.input(E_WHEEL, [dragCol, n]); } else { app.input(E_SCROLL, n); }
            }
        }
        if (t == WatchUi.DRAG_TYPE_STOP) {
            dragOn = false; dragEnd = ms;
            if (dragMode == 2) { gWheelEnd = dragEnd; WatchUi.requestUpdate(); } // the neighbours stay WHEEL_SHOW_MS (RideframeApp.onTick redraws then)
            if (dragMode == 4) { app.input(E_DRAG_END, ms); }   // coast / snap (the app's timer runs at ANIM_MS)
        }
        return dragMode == 1 || dragMode == 2 || dragMode == 4;
    }
    // the "Hold to finish" pill (js/watchsim.js touch: pointerdown / pointerup on the pill)
    // VERIFY (Toybox.WatchUi.InputDelegate onHold / onRelease, API 1.0 / 3.x): onHold comes after the system's hold delay (so the
    // 3 s run from there), onRelease when the finger lifts, and no onTap follows a hold; if one does, pillUp skips it
    function onPill(evt as WatchUi.ClickEvent) as Boolean {
        var xy = evt.getCoordinates(), S = scrS;
        var u = xy[0] / S, v = xy[1] / S;
        return flow.scr == S_PAUSE && !flow.pzConf && hasTouch() && v > 0.75 && absF(u - 0.5) < 0.27;
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
        var xy = evt.getCoordinates(), S = scrS;
        var u = xy[0] / S, v = xy[1] / S, s = flow.scr;
        if (dragged()) { return true; } // the end of a drag is no tap
        if (flow.flash != null) { app.input(E_TAP, null); return true; }
        if (flow.prWait()) { return true; } // 27.11.6: a tapped row waits for its flash (the screen may change under this tap)
        if (s == S_PAUSE) { // js PAUSE_LAY: confirm: the Discard pill = yes, elsewhere = no; else the Discard row = ask, the top = resume
            if (pillHold || System.getTimer() - pillUp < 400) { return true; }
            if (flow.pzConf) { app.input(absF(v - 0.68) < 0.06 ? E_START : E_BACK, null); }
            else if (absF(v - 0.68) < 0.055) { app.input(E_ITEM, 1); }
            else if (v < 0.62) { app.input(E_ITEM, 0); }
            return true;
        }
        if (s == S_SET) {
            if (v > 0.72 && absF(u - 0.5) < 0.24) { press(PK_DONE, -1, E_DONE, null, true); } // DONE logs at once (START goes weight -> reps first), after its flash
            else if (v > 0.36 && v < 0.72) { app.input(E_FOCUS, u < 0.51 ? 0 : 1); }
            return true;
        }
        if (s == S_READY && !flow.sp.equals("other") && gRouteY > 0 && absF(v - gRouteY) < 0.04) { app.input(E_DOWN, null); return true; } // the route line as drawn
        if (s == S_TREC) { // 23.11. (js TREC_LAY): another page: the target page; - / + (the outer thirds) and the target (step size); the resume pill
            var R = flow.tr;
            if (R != null && !flow.tPage().equals("target")) { app.input(E_TAP, null); }
            else if (v > gT0 && v < gT1) { var z = u < 0.31 ? 0 : (u > 0.69 ? 1 : 2); press(z == 0 ? PK_MINUS : (z == 1 ? PK_PLUS : PK_TGT), -1, E_ITEM, z, false); } // at once, flashing
            else if (v > 0.78 && R != null && R.st != RS_RUN) { press(PK_RESUME, -1, E_START, null, true); }
            return true;
        }
        if (s == S_THR || (s == S_TSCAN && !tList())) { app.input(E_TAP, null); return true; } // one trainer's state: like START
        if (s == S_TSUM) { var n = flow.tsPages().size(); app.input(flow.sel % n == n - 1 && v > 0.78 ? E_DONE : E_TAP, null); return true; } // 27.11.4: the last page's DONE: done, else the next page
        var menu = s == S_MENU || s == S_END || s == S_SAVEQ || s == S_TEND, pick = s == S_PICK || s == S_MORE || s == S_SMODE || s == S_RPICK || s == S_TSCAN || s == S_TPICK;
        if (s == S_HOME || menu || pick) { // 23.11.8: the rows as Draw.list / drawHome drew them (gRows: [offset, y / S]); the title and the counter are no row
            var r = rowAt(v), n = flow.listItems().size(), idx = r == null ? -1 : flow.sel + (r[0] as Number);
            if (idx >= 0 && idx < n) { press(PK_ROW, idx, E_ITEM, idx, true); } // 27.11.6: the row flashes, then it is chosen
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
    // 27.11.6 (js watchsim tapAt press): a tapped row / button flashes PRESS_MS; later: its action after the flash, else at once
    function press(k as Number, i as Number, ev as Number, arg, later as Boolean) as Void {
        app.input(E_PRESS, [k, i, ev, arg, System.getTimer(), later]);
    }
}
