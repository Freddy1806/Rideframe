// 23.11.8: the on-device smoke walk (monkeyc -t, then the simulator's Run No Evil / Test): Flow driven by random buttons, touches, wheel
// turns and drags on a set-up with worst-case names and numbers, plus scripted trips through the indoor trainer (a pretend FTMS trainer
// answering over E_BLE) and a run saved by holding BACK, so every screen is drawn by Draw.screen on this watch's own fonts: TREC, TEND,
// TSUM and RSUM included. Fails when a screen it must reach was never drawn; a crash in Draw / Flow fails it too.
// Only in test builds: (:test) code is left out of every other build (monkey.jungle).
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;
import Toybox.Math;

// the walk's helpers, in a (:test) module: left out of other builds, and not taken for tests themselves (only module-level
// (:test) functions that take a Logger are)
(:test)
module SmokeKit {
    function smokeSetup() as Dictionary {
        var ex = [
            { "id" => "bench", "n" => "Bench press", "t" => "w", "s" => [[80, 8], [80, 8], [77.5, 7], [75, 10]], "b" => 85 },
            { "id" => "incline", "n" => "Incline bench press with a long name", "t" => "w", "s" => [[102.5, 6]], "b" => 105 },
            { "id" => "pull", "n" => "Pull-ups", "t" => "bw", "s" => [[0, 12], [10, 8]], "b" => 12 },
            { "id" => "plank", "n" => "Plank", "t" => "time", "s" => [[0, 90]], "b" => 90 },
            { "id" => "squat", "n" => "Squat", "t" => "w", "s" => [], "b" => 0 }
        ] as Array;
        return { "ex" => ex, "rest" => 90, "top" => ["bench", "incline", "pull", "plank", "squat"], "recent" => ["bench"],
            "workouts" => [{ "id" => "w1", "n" => "Push day with a very long name", "it" => [["bench", 10, 8, 102.5, 90], ["incline", 3, 6, 102.5, 120], ["plank", 2, 600, 0, 60]] },
                           { "id" => "w2", "n" => "Leg day", "it" => [["squat", 4, 5, 100, 120]] }] } as Dictionary;
    }
    function smokeDc() as Dc {
        var ds = System.getDeviceSettings();
        // VERIFY (Graphics.createBufferedBitmap, API 4.0): returns a reference; .get() is the bitmap
        var bb = Graphics.createBufferedBitmap({ :width => ds.screenWidth, :height => ds.screenHeight }).get() as BufferedBitmap;
        return bb.getDc();
    }
    // one event, then the screen drawn as the watch would; the screen is noted, the drawn rows checked (0 < y < 1)
    function smokeEv(F as Flow, dc as Dc, P as Palette, seen as Dictionary, ev as Number, now as Number, arg) as Void {
        F.handle(ev, now, arg);
        Draw.screen(dc, F, P, now, { "pts" => 1245, "delta" => -120 });
        seen[F.scr] = true;
        for (var i = 0; i < gRows.size(); i++) { var y = (gRows[i] as Array)[1] as Float; Test.assertMessage(y > 0.0 && y < 1.0, "row y " + y + " on screen " + F.scr); }
    }
    // 27.11.4: the trainer summary's pages: DOWN through all of them (wrapping), swipe up / down, UP, a tap (the next page); it stays there
    function smokeWalkSum(F as Flow, dc as Dc, P as Palette, seen as Dictionary, now as Number) as Void {
        var n = F.tsPages().size();
        for (var k = 0; k < n; k++) { SmokeKit.smokeEv(F, dc, P, seen, E_DOWN, now, null); }
        Test.assertMessage(F.scr == S_TSUM && F.sel % n == 0, "DOWN wraps to the first page");
        SmokeKit.smokeEv(F, dc, P, seen, E_SWIPE_UP, now, null);
        SmokeKit.smokeEv(F, dc, P, seen, E_SWIPE_DOWN, now, null);
        SmokeKit.smokeEv(F, dc, P, seen, E_UP, now, null);                     // wraps to the last page
        Test.assertMessage(F.sel % n == n - 1, "UP wraps to the last page");
        SmokeKit.smokeEv(F, dc, P, seen, E_TAP, now, null);
        Test.assertMessage(F.scr == S_TSUM && F.sel % n == 0, "a tap: the next page");
    }
    // the pretend FTMS trainer's answers until the link is ready (found, connected, every setup step done, control granted)
    function smokeTrainer(F as Flow, dc as Dc, P as Palette, seen as Dictionary, now as Number) as Void {
        var found = { "k" => "found", "list" => [{ "name" => "KICKR CORE 2 5A1F WITH A LONG NAME", "ftms" => true, "rssi" => -50 }, { "name" => "Assioma DUO", "cps" => true, "rssi" => -60 }] };
        SmokeKit.smokeEv(F, dc, P, seen, E_BLE, now, found);
        SmokeKit.smokeEv(F, dc, P, seen, E_START, now, null);                       // connect the first (FTMS first)
        SmokeKit.smokeEv(F, dc, P, seen, E_BLE, now, { "k" => "conn", "ftms" => true });
        for (var i = 0; i < 4; i++) { SmokeKit.smokeEv(F, dc, P, seen, E_BLE, now, { "k" => "done", "ok" => true }); }
        SmokeKit.smokeEv(F, dc, P, seen, E_BLE, now, { "k" => "ind", "ch" => "fcp", "v" => [0x80, 0x00, 0x01] });
        SmokeKit.smokeEv(F, dc, P, seen, E_BLE, now, { "k" => "ind", "ch" => "ibd", "v" => [0x44, 0x00, 0xE8, 0x03, 0xB4, 0x00, 0xC8, 0x04] }); // 90 rpm, 1224 W
    }
}
(:test)
function smokeWalk(logger as Logger) as Boolean {
    var dc = SmokeKit.smokeDc(), P = new Palette(), setup = SmokeKit.smokeSetup(), seen = {} as Dictionary, steps = 0;
    var evs = [E_UP, E_DOWN, E_START, E_START, E_START, E_BACK, E_TAP, E_ITEM, E_SCROLL, E_DONE, E_FOCUS, E_START_HOLD, E_TICK, E_HR, E_SWIPE_UP,
        E_SWIPE_DOWN, E_SWIPE_LEFT, E_SWIPE_RIGHT, E_UP_HOLD, E_DOWN_HOLD, E_HOLD_START, E_HOLD_END, E_MENU, E_WHEEL, E_WHEEL] as Array<Number>;
    // 1. random walks (buttons, taps, swipes, drags over lists = E_SCROLL, the wheel over kg / reps / the target = E_WHEEL)
    for (var run = 0; run < 6; run++) {
        Math.srand(run * 7919 + 13);
        var F = new Flow(setup, true, [], null, null, null, null), now = 1700000000;
        for (var i = 0; i < 700; i++) {
            var ev = evs[Math.rand() % evs.size()], arg = null;
            if (ev == E_ITEM) { arg = Math.rand() % 5; }
            else if (ev == E_SCROLL) { arg = (Math.rand() % 5) - 2; }
            else if (ev == E_FOCUS) { arg = Math.rand() % 2; }
            else if (ev == E_HR) { arg = 60 + Math.rand() % 140; }
            else if (ev == E_WHEEL) { arg = [Math.rand() % 2, (Math.rand() % 9) - 4]; gWheel = (arg as Array)[0] as Number; gWheelScr = F.scr; gWheelEnd = 0; }
            else if (ev == E_HOLD_START || ev == E_HOLD_END || ev == E_TICK) { arg = System.getTimer(); }
            now += 1 + Math.rand() % 20;
            SmokeKit.smokeEv(F, dc, P, seen, ev, now, arg);
            gWheel = -1;
            steps++;
        }
    }
    // 2. the indoor trainer: ride, the wheel on the target, every page (28.11.: DOWN pages, held UP = + one step), pause, its menu, Finish & save
    var T = new Flow(setup, true, [], null, null, null, null), tn = 1700000000;
    T.setHrZones([100, 120, 140, 155, 170, 190]); // 27.11.4: the summary's zones (on the watch: the profile's, Health.mc bikeZones)
    SmokeKit.smokeEv(T, dc, P, seen, E_ITEM, tn, T.homeItems().indexOf("trainer"));
    SmokeKit.smokeTrainer(T, dc, P, seen, tn);
    // START until the ride runs: the choice (Free ride), the heart rate step skipped (27.11.2), the ride
    for (var k = 0; k < 4 && T.scr != S_TREC; k++) { SmokeKit.smokeEv(T, dc, P, seen, E_START, tn, null); }
    Test.assertMessage(T.scr == S_TREC, "the ride started");
    for (var i = 0; i < 40; i++) {
        tn++;
        SmokeKit.smokeEv(T, dc, P, seen, E_TICK, tn, System.getTimer());
        if (i % 5 == 0) { gWheel = 0; gWheelScr = T.scr; gWheelEnd = 0; SmokeKit.smokeEv(T, dc, P, seen, E_WHEEL, tn, [0, i % 10 == 0 ? 3 : -2]); gWheel = -1; }
        if (i == 10 || i == 11) { SmokeKit.smokeEv(T, dc, P, seen, E_DOWN, tn, null); } // the body page, the stats page
        if (i == 12) { SmokeKit.smokeEv(T, dc, P, seen, E_SWIPE_UP, tn, null); }   // wraps to the target page
        if (i == 13) { SmokeKit.smokeEv(T, dc, P, seen, E_UP, tn, null); SmokeKit.smokeEv(T, dc, P, seen, E_UP_HOLD, tn, null); SmokeKit.smokeEv(T, dc, P, seen, E_DOWN_HOLD, tn, null); }
        if (i == 14) { SmokeKit.smokeEv(T, dc, P, seen, E_TAP, tn, null); }        // back to the target
        if (i == 20) { SmokeKit.smokeEv(T, dc, P, seen, E_START, tn, null); }      // pause
        if (i == 24) { SmokeKit.smokeEv(T, dc, P, seen, E_BLE, tn, { "k" => "drop" }); }
        if (i == 28) { SmokeKit.smokeEv(T, dc, P, seen, E_START, tn, null); }      // resume
    }
    SmokeKit.smokeEv(T, dc, P, seen, E_BACK, tn, null);                         // its menu (the ride goes on)
    Test.assertMessage(T.listItems()[0].equals("Back to ride"), "TEND: Back to ride");
    SmokeKit.smokeEv(T, dc, P, seen, E_ITEM, tn, T.listItems().indexOf("Finish & save"));
    // 27.11.4: the summary's pages (a free ride: overview, heart rate, power): DOWN, wrapping, swipes, UP, a tap; START done
    Test.assertMessage(T.scr == S_TSUM && T.tsPages().size() == 3, "a free ride's summary: three pages");
    SmokeKit.smokeWalkSum(T, dc, P, seen, tn);
    SmokeKit.smokeEv(T, dc, P, seen, E_START, tn, null);
    Test.assertMessage(T.scr == S_HOME, "START on the summary: done");
    // 2b. 28.11.: the built-in 30 / 15: every page of a workout ride (target, workout, body, stats), the warm-up ramp and a step of the sets
    var U = new Flow(setup, true, [], null, null, null, null), un = 1700000000;
    SmokeKit.smokeEv(U, dc, P, seen, E_ITEM, un, U.homeItems().indexOf("trainer"));
    SmokeKit.smokeTrainer(U, dc, P, seen, un);
    for (var k = 0; k < 4 && U.scr != S_TREC; k++) {
        if (U.scr == S_TPICK && U.sel == 0) { SmokeKit.smokeEv(U, dc, P, seen, E_DOWN, un, null); } // the workout under Free ride
        SmokeKit.smokeEv(U, dc, P, seen, E_START, un, null);
    }
    Test.assertMessage(U.scr == S_TREC && U.tPages().size() == 4, "a workout ride with four pages");
    for (var i = 0; i < 1300; i++) {
        un++;
        SmokeKit.smokeEv(U, dc, P, seen, E_TICK, un, System.getTimer());
        if (i % 97 == 0) { SmokeKit.smokeEv(U, dc, P, seen, E_DOWN, un, null); }   // through the pages, wrapping
        if (i % 50 == 0) { SmokeKit.smokeEv(U, dc, P, seen, E_HR, un, 120 + i % 60); }
    }
    // 27.11.4: Finish & save (in the middle of the workout): the summary with the intervals page, every page, the last page's DONE
    SmokeKit.smokeEv(U, dc, P, seen, E_MENU, un, null);
    SmokeKit.smokeEv(U, dc, P, seen, E_ITEM, un, U.listItems().indexOf("Finish & save"));
    Test.assertMessage(U.scr == S_TSUM && U.tsPages().size() == 4 && U.tsPages()[1].equals("iv"), "a workout's summary: four pages with the intervals");
    SmokeKit.smokeWalkSum(U, dc, P, seen, un);
    for (var k = 0; k < 4 && U.sel % 4 != 3; k++) { SmokeKit.smokeEv(U, dc, P, seen, E_DOWN, un, null); }
    SmokeKit.smokeEv(U, dc, P, seen, E_DONE, un, null);
    Test.assertMessage(U.scr == S_HOME, "the last page's DONE: done");
    // 3. a run: ready, recording, pause, BACK held 3 s: saved, the summary
    var R = new Flow(setup, true, [], null, null, null, null), rn = 1700000000;
    SmokeKit.smokeEv(R, dc, P, seen, E_ITEM, rn, R.homeItems().indexOf("run"));
    SmokeKit.smokeEv(R, dc, P, seen, E_START, rn, null);
    for (var i = 0; i < 30; i++) { rn++; SmokeKit.smokeEv(R, dc, P, seen, E_TICK, rn, System.getTimer()); if (i % 7 == 0) { SmokeKit.smokeEv(R, dc, P, seen, E_DOWN, rn, null); } }
    SmokeKit.smokeEv(R, dc, P, seen, E_START, rn, null);                        // paused
    var t0 = System.getTimer();
    SmokeKit.smokeEv(R, dc, P, seen, E_HOLD_START, rn, t0);
    SmokeKit.smokeEv(R, dc, P, seen, E_TICK, rn, t0 + 1500);                    // the ring half full
    SmokeKit.smokeEv(R, dc, P, seen, E_TICK, rn, t0 + 3100);                    // saved
    logger.debug("screen " + dc.getWidth() + " steps " + steps + " screens seen " + seen.keys().toString());
    var must = [S_HOME, S_PICK, S_SET, S_REST, S_MENU, S_TSCAN, S_TREC, S_TEND, S_TSUM, S_READY, S_REC, S_PAUSE, S_RSUM] as Array<Number>;
    for (var i = 0; i < must.size(); i++) { Test.assertMessage(seen[must[i]] == true, "screen " + must[i] + " never drawn"); }
    return true;
}
