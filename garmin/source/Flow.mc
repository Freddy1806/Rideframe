// RIDEFRAME Strength: the state machine of the watch app. A line-by-line port of js/watchflow.js (the browser preview and
// its Node tests use that file): same screens, same events, same numbers. Keep both in step when one changes.
// DRAFT, NOT COMPILED YET. Time is in seconds (Time.now().value()); kg is a Float, reps a Number.
// Outputs drained by RideframeApp: cues (vibrations) and out (requests to the server).
import Toybox.Lang;
import Toybox.Math;

// screens (js: SCR)
const S_START = 0;
const S_PICK = 1;
const S_SET = 2;
const S_REST = 3;
const S_MENU = 4;
const S_SUM = 5;
const S_PAIR = 6;
const S_GLANCE = 7;
// events (js: the ev strings of handle())
const E_UP = 1;
const E_DOWN = 2;
const E_UP_HOLD = 3;
const E_DOWN_HOLD = 4;
const E_START = 5;
const E_BACK = 6;
const E_MENU = 7;
const E_SWIPE_UP = 8;
const E_SWIPE_DOWN = 9;
const E_SWIPE_LEFT = 10;
const E_SWIPE_RIGHT = 11;
const E_TAP = 12;
const E_ITEM = 13;
const E_FOCUS = 14;
const E_HR = 15;
const E_TICK = 16;
// vibration cues
const C_SET = 1;
const C_PR = 2;
const C_REST = 3;
const C_DONE = 4;
const C_ERROR = 5;
// requests
const O_SEND = 1;
const O_PAIR = 2;
const O_SETUP = 3;
const O_EXIT = 4;
// menu items (js: MENU)
const M_EX = "Change exercise";
const M_UNDO = "Undo last set";
const M_FIN = "Finish";
const M_SYNC = "Sync now";
const M_PAIR = "Pair with phone";
// pairing states / sum states
const P_ENTER = 0;
const P_SENDING = 1;
const P_FAIL = 2;
const ST_SENDING = 0;
const ST_SAVED = 1;
const ST_QUEUED = 2;
const ST_FAILED = 3;
const R_OK = 0;
const R_RETRY = 1;
const R_DROP = 2;

const KG_STEP = 2.5;
const KG_HOLD = 10.0;
const KG_MAX = 500.0;
const REPS_HOLD = 5;
const REPS_MAX = 100;
const REST_STEP = 15;
const PR_SECS = 3;

// Epley, like kraftlib.js
function e1rm(kg as Float, r as Number) as Float {
    if (kg <= 0 || r <= 0) { return 0.0; }
    return r == 1 ? kg : kg * (1.0 + r / 30.0);
}

class Flow {
    var setup as Dictionary;
    var paired as Boolean;
    var queue as Array;
    var scr as Number = S_START;
    var back as Number = S_START;
    var sel as Number = 0;
    var menu as Array = [];
    var cur as Number = 0;
    var focus as Number = 0;
    var kg as Float = 0.0;
    var reps as Number = 0;
    var sets as Array = [];          // [{ "ex", "kg", "reps", "t", "pr" }]
    var start as Number = 0;
    var restEnd as Number = 0;
    var restLen as Number = 0;
    var flash = null;                // { "until", "kg", "reps", "t" } or null
    var sum = null;                  // { "id", "dur", "sets", "vol", "exs", "prs", "st" } or null
    var hr as Number = 0;
    var hrN as Number = 0;
    var hrSum as Number = 0;
    var hrMax as Number = 0;
    var pairD as Array = [0, 0, 0, 0, 0, 0];
    var pairI as Number = 0;
    var pairSt as Number = P_ENTER;
    var cues as Array = [];
    var out as Array = [];           // [{ "k" => O_..., "code" => "123456" }]

    // js: newFlow(setup, { paired, queue })
    function initialize(setupIn, isPaired as Boolean, q) {
        setup = (setupIn instanceof Dictionary && setupIn["ex"] instanceof Array) ? setupIn : { "ex" => [], "rest" => 90 };
        paired = isPaired;
        queue = q instanceof Array ? q : [];
        if (!paired) { scr = S_PAIR; }
    }

    function exList() as Array { return setup["ex"] as Array; }
    function exCount() as Number { return exList().size(); }
    // js: curEx(F)
    function curEx() as Dictionary {
        var l = exList();
        return cur < l.size() ? l[cur] as Dictionary : { "id" => "", "n" => "Exercise", "t" => "w" };
    }
    function isBw(e as Dictionary) as Boolean { return "bw".equals(e["t"]); }
    function num(v) as Float { return v == null ? 0.0 : v.toFloat(); }
    // the sets of exercise id in this session
    function setsOf(id) as Array {
        var r = [];
        for (var i = 0; i < sets.size(); i++) { if (id.equals(sets[i]["ex"])) { r.add(sets[i]); } }
        return r;
    }
    // js: setNo(F)
    function setNo() as Number { return setsOf(curEx()["id"]).size() + 1; }
    // js: restLeft(F, now)
    function restLeft(now as Number) as Number { var l = restEnd - now; return l > 0 ? l : 0; }
    function volume() as Float {
        var v = 0.0;
        for (var i = 0; i < sets.size(); i++) { v += (sets[i]["kg"] as Float) * (sets[i]["reps"] as Number); }
        return v;
    }
    function distinctEx() as Number {
        var seen = [];
        for (var i = 0; i < sets.size(); i++) { if (seen.indexOf(sets[i]["ex"]) < 0) { seen.add(sets[i]["ex"]); } }
        return seen.size();
    }

    // js: prefill(F): last set of this session, else last session's set n (or its last), else a start value
    function prefill() as Void {
        var e = curEx(), mine = setsOf(e["id"]), n = mine.size();
        if (n > 0) { kg = mine[n - 1]["kg"]; reps = mine[n - 1]["reps"]; return; }
        var s = e["s"] instanceof Array ? e["s"] as Array : [];
        if (s.size() > 0) {
            var p = n < s.size() ? s[n] : s[s.size() - 1];
            kg = num(p[0]); reps = (p[1] as Number).toNumber();
        } else {
            kg = isBw(e) ? 0.0 : 20.0; reps = isBw(e) ? 10 : 8;
        }
    }
    // js: stepValue(F, d, big)
    function stepValue(d as Number, big as Boolean) as Void {
        if (focus == 0) {
            var v = kg + d * (big ? KG_HOLD : KG_STEP);
            v = Math.round(v * 100.0) / 100.0;
            kg = v < 0.0 ? 0.0 : (v > KG_MAX ? KG_MAX : v);
        } else {
            var r = reps + d * (big ? REPS_HOLD : 1);
            reps = r < 0 ? 0 : (r > REPS_MAX ? REPS_MAX : r);
        }
    }
    function menuFor() as Array {
        if (start != 0) { return sets.size() > 0 ? [M_EX, M_UNDO, M_FIN] : [M_EX, M_FIN]; }
        return paired ? [M_SYNC, M_PAIR] : [M_PAIR];
    }
    function openMenu() as Void { back = scr; menu = menuFor(); sel = 0; scr = S_MENU; }
    function choose(i as Number) as Void {
        var n = exCount();
        cur = i < 0 ? 0 : (i > n - 1 ? (n > 0 ? n - 1 : 0) : i);
        focus = isBw(curEx()) ? 1 : 0;
        prefill();
        scr = S_SET;
    }
    function toPick() as Void { sel = cur; scr = S_PICK; }

    // js: completeSet(F, now)
    function completeSet(now as Number) as Void {
        if (reps <= 0) { cues.add(C_ERROR); return; }
        var e = curEx(), bw = isBw(e), v = bw ? reps.toFloat() : e1rm(kg, reps);
        var before = 0.0, mine = setsOf(e["id"]);
        for (var i = 0; i < mine.size(); i++) {
            var x = bw ? (mine[i]["reps"] as Number).toFloat() : e1rm(mine[i]["kg"], mine[i]["reps"]);
            if (x > before) { before = x; }
        }
        var t = now - start;
        var set = { "ex" => e["id"], "kg" => kg, "reps" => reps, "t" => t > 0 ? t : 0 };
        var best = num(e["b"]);
        if (best > 0 && v > best + 0.01 && v > before + 0.01) {
            set["pr"] = true;
            flash = { "until" => now + PR_SECS, "kg" => kg, "reps" => reps, "bw" => bw };
            cues.add(C_PR);
        } else {
            cues.add(C_SET);
        }
        sets.add(set);
        restLen = setup["rest"] != null ? (setup["rest"] as Number) : 90;
        restEnd = now + restLen;
        scr = S_REST;
    }
    function endRest(cue as Boolean) as Void { restEnd = 0; prefill(); scr = S_SET; if (cue) { cues.add(C_REST); } }
    // js: undo(F)
    function undo() as Void {
        var n = sets.size();
        if (n == 0) { return; }
        var s = sets[n - 1];
        sets = sets.slice(0, n - 1);
        var l = exList();
        for (var i = 0; i < l.size(); i++) { if (s["ex"].equals(l[i]["id"])) { cur = i; break; } }
        kg = s["kg"]; reps = s["reps"]; restEnd = 0; scr = S_SET;
    }
    // js: finish(F, now)
    function finish(now as Number) as Void {
        if (sets.size() == 0) { reset(); return; }
        var id = Math.rand().format("%08x") + now.format("%x");
        var dur = now - start; if (dur < 1) { dur = 1; }
        var list = [], prs = 0;
        for (var i = 0; i < sets.size(); i++) {
            var s = sets[i];
            list.add({ "ex" => s["ex"], "kg" => s["kg"], "reps" => s["reps"], "t" => s["t"] });
            if (s["pr"] == true) { prs++; }
        }
        var sess = { "id" => id, "start" => start, "duration" => dur, "sets" => list };
        if (hrN > 0) { sess["hr"] = { "avg" => Math.round(hrSum.toFloat() / hrN).toNumber(), "max" => hrMax }; }
        queue.add(sess);
        sum = { "id" => id, "dur" => dur, "sets" => sets.size(), "vol" => volume(), "exs" => distinctEx(), "prs" => prs, "st" => paired ? ST_SENDING : ST_QUEUED };
        sets = []; start = 0; restEnd = 0; hrN = 0; hrSum = 0; hrMax = 0;
        scr = S_SUM; cues.add(C_DONE); out.add({ "k" => O_SEND });
    }
    function reset() as Void { sets = []; start = 0; restEnd = 0; flash = null; sum = null; scr = S_START; }
    // js: sent(F, id, res)
    function sent(id as String, res as Number) as Void {
        if (res != R_RETRY) {
            var q = [];
            for (var i = 0; i < queue.size(); i++) { if (!id.equals(queue[i]["id"])) { q.add(queue[i]); } }
            queue = q;
        }
        if (sum != null && id.equals(sum["id"])) { sum["st"] = res == R_OK ? ST_SAVED : (res == R_DROP ? ST_FAILED : ST_QUEUED); }
    }
    // js: paired(F, ok, setup)
    function pairedResult(ok as Boolean, setupIn) as Void {
        if (!ok) { pairSt = P_FAIL; return; }
        paired = true; pairD = [0, 0, 0, 0, 0, 0]; pairI = 0; pairSt = P_ENTER;
        if (setupIn != null) { setup = setupIn; }
        scr = S_START; cues.add(C_DONE); out.add({ "k" => O_SETUP }); out.add({ "k" => O_SEND });
    }
    // js: setSetup(F, setup): keeps the current exercise when it is still in the list
    function setSetup(s) as Void {
        if (!(s instanceof Dictionary) || !(s["ex"] instanceof Array)) { return; }
        var id = curEx()["id"];
        setup = s; cur = 0;
        var l = exList();
        for (var i = 0; i < l.size(); i++) { if (id.equals(l[i]["id"])) { cur = i; break; } }
    }

    // js: handle(F, ev, now, arg)
    function handle(ev as Number, now as Number, arg) as Void {
        if (ev == E_HR) {
            hr = arg == null ? 0 : arg;
            if (start != 0 && hr > 0) { hrN++; hrSum += hr; if (hr > hrMax) { hrMax = hr; } }
            return;
        }
        if (ev == E_TICK) {
            if (flash != null && now >= flash["until"]) { flash = null; }
            if (scr == S_REST && now >= restEnd) { endRest(true); }
            return;
        }
        if (flash != null) { flash = null; if (ev != E_MENU) { return; } } // the first touch after a record only clears the flash
        if (ev == E_SWIPE_LEFT) { ev = E_MENU; }
        if (ev == E_SWIPE_RIGHT) { ev = E_BACK; }
        var isList = scr == S_PICK || scr == S_MENU;
        if (ev == E_SWIPE_UP) { ev = isList ? E_DOWN : E_UP; }       // a list scrolls with the finger, a number counts up
        else if (ev == E_SWIPE_DOWN) { ev = isList ? E_UP : E_DOWN; }
        var s = scr;
        if (ev == E_MENU) { if (s == S_START || s == S_PICK || s == S_SET || s == S_REST) { openMenu(); } return; }
        if (s == S_GLANCE) { if (ev == E_START || ev == E_TAP) { scr = paired ? S_START : S_PAIR; } return; }
        if (s == S_START) {
            if (ev == E_START || ev == E_TAP) {
                if (exCount() == 0) { out.add({ "k" => O_SETUP }); return; }
                start = now; sets = []; sum = null; toPick();
            } else if (ev == E_BACK) { out.add({ "k" => O_EXIT }); }
            return;
        }
        if (s == S_PICK || s == S_MENU) {
            var n = s == S_PICK ? exCount() : menu.size();
            if (n == 0) { if (ev == E_BACK) { scr = s == S_MENU ? back : S_START; } return; }
            if (ev == E_UP) { sel = (sel + n - 1) % n; }
            else if (ev == E_DOWN) { sel = (sel + 1) % n; }
            else if (ev == E_START || ev == E_ITEM) {
                var i = ev == E_ITEM ? arg : sel;
                if (s == S_PICK) { choose(i); } else { act(menu[i], now); }
            } else if (ev == E_BACK) {
                if (s == S_MENU) { scr = back; } else if (sets.size() > 0) { prefill(); scr = S_SET; } else { reset(); }
            }
            return;
        }
        if (s == S_SET) {
            if (ev == E_UP || ev == E_DOWN) { stepValue(ev == E_UP ? 1 : -1, false); }
            else if (ev == E_UP_HOLD || ev == E_DOWN_HOLD) { stepValue(ev == E_UP_HOLD ? 1 : -1, true); }
            else if (ev == E_FOCUS) { focus = arg == 0 ? 0 : 1; }
            else if (ev == E_BACK) { focus = 1 - focus; }        // no touch needed: BACK moves between weight and reps
            else if (ev == E_START) { completeSet(now); }         // touch: the drawn DONE button sends E_START
            return;
        }
        if (s == S_REST) {
            if (ev == E_START || ev == E_TAP) { endRest(false); }
            else if (ev == E_BACK) { toPick(); }
            else if (ev == E_UP) { restEnd += REST_STEP; restLen += REST_STEP; }
            else if (ev == E_DOWN) { var e2 = restEnd - REST_STEP; restEnd = e2 > now + 1 ? e2 : now + 1; }
            return;
        }
        if (s == S_SUM) { if (ev == E_START || ev == E_BACK || ev == E_TAP) { reset(); } return; }
        if (s == S_PAIR) {
            if (pairSt == P_SENDING) { return; }
            if (pairSt == P_FAIL && ev != E_BACK) { pairSt = P_ENTER; }
            if (ev == E_UP) { pairD[pairI] = (pairD[pairI] + 1) % 10; }
            else if (ev == E_DOWN) { pairD[pairI] = (pairD[pairI] + 9) % 10; }
            else if (ev == E_FOCUS) { pairI = arg < 0 ? 0 : (arg > 5 ? 5 : arg); }
            else if (ev == E_START || ev == E_TAP) {
                if (pairI < 5) { pairI++; }
                else {
                    pairSt = P_SENDING;
                    var code = "";
                    for (var i = 0; i < 6; i++) { code += pairD[i].toString(); }
                    out.add({ "k" => O_PAIR, "code" => code });
                }
            } else if (ev == E_BACK) {
                if (pairI > 0) { pairI--; } else if (paired) { scr = S_START; } else { out.add({ "k" => O_EXIT }); }
            }
        }
    }
    function act(item as String, now as Number) as Void {
        if (M_EX.equals(item)) { toPick(); }
        else if (M_UNDO.equals(item)) { undo(); }
        else if (M_FIN.equals(item)) { finish(now); }
        else if (M_SYNC.equals(item)) { out.add({ "k" => O_SETUP }); out.add({ "k" => O_SEND }); scr = back; }
        else if (M_PAIR.equals(item)) { pairD = [0, 0, 0, 0, 0, 0]; pairI = 0; pairSt = P_ENTER; scr = S_PAIR; }
    }
}
