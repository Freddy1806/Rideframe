// RIDEFRAME on a Garmin watch: the state machine. A function-by-function port of js/watchflow.js (the browser preview and
// its Node tests use that file): same screens, same events, same numbers. Keep both in step when one changes.
// Time is in seconds (Time.now().value()); kg is a Float, reps a Number (a timed exercise: seconds).
// Outputs drained by RideframeApp: cues (vibrations) and out (requests to the server, saveAct).
// Watch-only additions (not in the JS, the preview has no clock to hold): the hold timer of a timed exercise (holdAt,
// first START starts it, the second logs the seconds held, C_HOLD at the planned time) and the gps quality (gps).
// 19.11.: READY (run / ride) -> RPICK (UP / DOWN or a tap on the route line): None or a route sent from the phone; O_ROUTES asks
// for the list (GET /api/watch/routes), O_ROUTE for one route; the app answers with setRoutes / setRoute. The route is kept in
// the flat form of Feed.mc RouteTrack.face; routeNav takes the watch's own position on it.
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
const S_HOME = 8;
const S_SMODE = 9;
const S_WPICK = 10;
const S_MORE = 11;
const S_READY = 12;
const S_REC = 13;
const S_PAUSE = 14;
const S_RSUM = 15;
const S_RPICK = 16;
// the start menu (js/watchflow.js HOME_FIT, HOME_LAY): four rows at once; first row y, row step (= touch target) in screen fractions
const HOME_FIT = 4;
const HOME_Y0 = 0.27;
const HOME_DY = 0.155;
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
const E_SAMPLE = 17;
const E_SEG = 18;
// vibration cues
const C_SET = 1;
const C_PR = 2;
const C_REST = 3;
const C_DONE = 4;
const C_ERROR = 5;
const C_START = 6;
const C_STOP = 7;
const C_LAP = 8;
const C_SEG = 9;
const C_HOLD = 10;
// requests
const O_SEND = 1;
const O_PAIR = 2;
const O_SETUP = 3;
const O_EXIT = 4;
const O_SAVEACT = 5;
const O_ROUTES = 6;
const O_ROUTE = 7;
// menu items (js: MENU)
const M_EX = "Change exercise";
const M_SKIP = "Skip exercise";
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
// recording states (js: rec.st 'run' / 'pause')
const RS_RUN = 0;
const RS_PAUSE = 1;

const KG_STEP = 2.5;
const KG_HOLD = 10.0;
const KG_MAX = 500.0;
const REPS_HOLD = 5;
const REPS_MAX = 100;
const SEC_STEP = 5;
const SEC_HOLD = 15;
const SEC_MAX = 600;
const REST_STEP = 15;
const PR_SECS = 3;
const LAP_SECS = 5;
const SEG_SECS = 5;
const PAUSE_MS = 0.7;

// ---- small typed readers for JSON values (Dictionary / Array elements are untyped) ----
function numOf(v) as Number {
    if (v instanceof Number) { return v as Number; }
    if (v instanceof Float) { return (v as Float).toNumber(); }
    if (v instanceof Double) { return (v as Double).toNumber(); }
    if (v instanceof Long) { return (v as Long).toNumber(); }
    return 0;
}
function fltOf(v) as Float {
    if (v instanceof Float) { return v as Float; }
    if (v instanceof Number) { return (v as Number).toFloat(); }
    if (v instanceof Double) { return (v as Double).toFloat(); }
    if (v instanceof Long) { return (v as Long).toFloat(); }
    return 0.0;
}
function strOf(v) as String { return v instanceof String ? v as String : ""; }
function arrOf(v) as Array { return v instanceof Array ? v as Array : [] as Array; }
function rnd(x as Float) as Number { return x >= 0.0 ? (x + 0.5).toNumber() : -((0.5 - x).toNumber()); }
function imax(a as Number, b as Number) as Number { return a > b ? a : b; }
function imin(a as Number, b as Number) as Number { return a < b ? a : b; }

// Epley, like kraftlib.js
function e1rm(kg as Float, r as Number) as Float {
    if (kg <= 0 || r <= 0) { return 0.0; }
    return r == 1 ? kg : kg * (1.0 + r / 30.0);
}
// the index of exercise id in a list of exercise Dictionaries, or -1
function exIndex(ex as Array, id) as Number {
    var s = strOf(id);
    for (var i = 0; i < ex.size(); i++) {
        var e = ex[i];
        if (e instanceof Dictionary && s.equals(strOf((e as Dictionary)["id"]))) { return i; }
    }
    return -1;
}
// js: order(setup): the free picker's order: done lately, then the 20 standard exercises, then everything else
function order(s as Dictionary) as Array<Number> {
    var ex = arrOf(s["ex"]), out = [] as Array<Number>, ids = [] as Array;
    ids.addAll(arrOf(s["recent"]));
    ids.addAll(arrOf(s["top"]));
    for (var k = 0; k < ids.size(); k++) { var i = exIndex(ex, ids[k]); if (i >= 0 && out.indexOf(i) < 0) { out.add(i); } }
    for (var i = 0; i < ex.size(); i++) { if (out.indexOf(i) < 0) { out.add(i); } }
    return out;
}
// a config from GET /api/watch/config (or the cache) that the flow can use (js: setConfig's check)
function cfgOk(c) as Boolean {
    if (!(c instanceof Dictionary)) { return false; }
    var d = c as Dictionary;
    var ks = ["run", "ride", "other"] as Array<String>;
    for (var i = 0; i < ks.size(); i++) {
        var s = d[ks[i]];
        if (!(s instanceof Dictionary) || !((s as Dictionary)["p"] instanceof Array)) { return false; }
    }
    return true;
}

// js: newRec(now): one recording (run, ride, other). Rings instead of growing arrays: p3 (3 s power), p30 (NP).
class Rec {
    var st as Number = RS_RUN;
    var start as Number = 0;
    var t as Number = 0;            // seconds moving (the timer, stops on pause and auto pause)
    var d as Float = 0.0;           // metres
    var v as Float = 0.0;           // m/s now
    var hr as Number = 0;
    var hrMax as Number = 190;
    var cad as Number = 0;
    var pw as Number = 0;
    var p3 as Array<Number> = [0, 0, 0] as Array<Number>;
    var p3N as Number = 0;
    var p3I as Number = 0;
    var pwSum as Float = 0.0;
    var p30 as Array<Number> = [] as Array<Number>;
    var p30N as Number = 0;
    var p30I as Number = 0;
    var p30Sum as Number = 0;
    var np4 as Float = 0.0;
    var npN as Number = 0;
    var gain as Float = 0.0;
    var kcal as Float = 0.0;
    var auto as Boolean = false;
    var pg as Number = 0;
    var lapT0 as Number = 0;
    var lapD0 as Float = 0.0;
    var lapN as Number = 0;          // js: laps.length (the laps themselves are not kept)

    function initialize(now as Number) {
        start = now;
        for (var i = 0; i < 30; i++) { p30.add(0); }
    }
}

class Flow {
    var setup as Dictionary = {} as Dictionary;
    var list as Array<Number> = [] as Array<Number>;
    var cfg as Dictionary;
    var last as String = "run";
    var paired as Boolean;
    var queue as Array<Dictionary>;
    var scr as Number = S_HOME;
    var back as Number = S_HOME;
    var sel as Number = 0;
    var menu as Array<String> = [] as Array<String>;
    var cur as Number = 0;
    var focus as Number = 0;
    var kg as Float = 0.0;
    var reps as Number = 0;
    var sets as Array<Dictionary> = [] as Array<Dictionary>;   // [{ "ex", "kg", "reps", "t", "pr"? }]
    var start as Number = 0;
    var restEnd as Number = 0;
    var restLen as Number = 0;
    var plan as Array<Number> or Null = null;                  // js: plan { w, i, n } as [w, i, n]
    var flash as Dictionary or Null = null;                    // { "k" => "pr" | "lap", "until", ... }
    var sum as Dictionary or Null = null;                      // { "id", "dur", "sets", "vol", "exs", "prs", "st" }
    var hr as Number = 0;
    var hrN as Number = 0;
    var hrSum as Number = 0;
    var hrMax as Number = 0;
    var pairD as Array<Number> = [0, 0, 0, 0, 0, 0] as Array<Number>;
    var pairI as Number = 0;
    var pairSt as Number = P_ENTER;
    var cues as Array<Number> = [] as Array<Number>;
    var out as Array<Dictionary> = [] as Array<Dictionary>;    // [{ "k" => O_..., "code" => "123456" }]
    // run / ride / other
    var sp as String = "run";
    var type as String = "";                                    // the Strava type of a "more" sport
    var tname as String = "";                                   // its label (cfg.more[i][1])
    var pages as Array<Array<String>> = [] as Array<Array<String>>;  // js: recPages without the route page
    var rec as Rec or Null = null;
    var seg as Dictionary or Null = null;
    var route as Dictionary or Null = null;                     // { "name", "len", "u", "v" (points 0..1 in the box), "ta", "td" (turns), "tt"? }
    var rsum as Dictionary or Null = null;
    var routes as Array<Dictionary> or Null = null;             // GET /api/watch/routes: [{ id, name, dist, climb }], null = not asked yet
    var routeId as String or Null = null;
    var navOn as Boolean = false;                                // js: F.nav (the watch's own tracking of the route)
    var navAlong as Float = 0.0;
    var navOff as Number = 0;
    var navU as Float = 0.0;
    var navV as Float = 0.0;
    // watch only
    var holdAt as Number = 0;
    var holdCued as Boolean = false;
    var gps as Number = 0;                                      // 0 none, 1 poor, 2 usable / good (set by Recorder)

    // js: newFlow(setup, { paired, queue, cfg, last })
    function initialize(setupIn, isPaired as Boolean, q, cfgIn, lastIn) {
        setup = { "ex" => [], "rest" => 90 } as Dictionary;
        cfg = cfgOk(cfgIn) ? cfgIn as Dictionary : Fields.defaultCfg();
        if (lastIn instanceof String && homeKeys().indexOf(lastIn) >= 0) { last = lastIn as String; }
        paired = isPaired;
        queue = q instanceof Array ? q as Array<Dictionary> : [] as Array<Dictionary>;
        setSetup(setupIn);
        scr = paired ? S_HOME : S_PAIR;
    }

    function exList() as Array { return arrOf(setup["ex"]); }
    function exCount() as Number { return exList().size(); }
    // js: curEx(F)
    function curEx() as Dictionary {
        var l = exList();
        if (cur >= 0 && cur < l.size() && l[cur] instanceof Dictionary) { return l[cur] as Dictionary; }
        return { "id" => "", "n" => "Exercise", "t" => "w" } as Dictionary;
    }
    function exT(e as Dictionary) as String { var t = e["t"]; return t instanceof String ? t as String : "w"; }
    function isBw(e as Dictionary) as Boolean { return "bw".equals(exT(e)); }
    function isTime(e as Dictionary) as Boolean { return "time".equals(exT(e)); }
    // the sets of exercise id in this session
    function setsOf(id as String) as Array<Dictionary> {
        var r = [] as Array<Dictionary>;
        for (var i = 0; i < sets.size(); i++) { if (id.equals(sets[i]["ex"])) { r.add(sets[i]); } }
        return r;
    }
    // js: setNo(F)
    function setNo() as Number {
        var p = plan;
        if (p != null) { return p[2] + 1; }
        return setsOf(strOf(curEx()["id"])).size() + 1;
    }
    // js: workouts(F): from the setup, else from the config, only those with exercises
    function workouts() as Array<Dictionary> {
        var src = setup["workouts"] instanceof Array ? setup["workouts"] : cfg["w"];
        var a = arrOf(src), r = [] as Array<Dictionary>;
        for (var i = 0; i < a.size(); i++) {
            var w = a[i];
            if (w instanceof Dictionary && arrOf((w as Dictionary)["it"]).size() > 0) { r.add(w as Dictionary); }
        }
        return r;
    }
    // js: planItem(F): [ex, sets, reps, kg, rest, name?] or null
    function planItem() as Array or Null {
        var p = plan;
        if (p == null) { return null; }
        var ws = workouts();
        if (p[0] < 0 || p[0] >= ws.size()) { return null; }
        var it = arrOf(ws[p[0]]["it"]);
        if (p[1] < 0 || p[1] >= it.size() || !(it[p[1]] instanceof Array)) { return null; }
        var x = it[p[1]] as Array;
        return x.size() >= 5 ? x : null;
    }
    // js: HOME and homeItems(F): the sport used last on top
    function homeKeys() as Array<String> { return ["run", "ride", "kraft", "more"] as Array<String>; }
    function homeItems() as Array<String> {
        var r = [last] as Array<String>, k = homeKeys();
        for (var i = 0; i < k.size(); i++) { if (!k[i].equals(last)) { r.add(k[i]); } }
        return r;
    }
    // js: homeTop(sel, n): the first row shown (0 while all entries fit; a longer list keeps the selection on the last row)
    function homeTop(n as Number) as Number {
        if (sel < HOME_FIT) { return 0; }
        var t = sel - HOME_FIT + 1, m = n - HOME_FIT;
        return t < m ? t : m;
    }
    function homeLabel(k as String) as String {
        if (k.equals("run")) { return "Run"; }
        if (k.equals("ride")) { return "Ride"; }
        if (k.equals("kraft")) { return "Strength"; }
        return "More";
    }
    function moreList() as Array { return arrOf(cfg["more"]); }
    // js: restLeft(F, now)
    function restLeft(now as Number) as Number { var l = restEnd - now; return l > 0 ? l : 0; }
    function volume() as Float {
        var v = 0.0;
        for (var i = 0; i < sets.size(); i++) { v += fltOf(sets[i]["kg"]) * numOf(sets[i]["reps"]); }
        return v;
    }
    function distinctEx() as Number {
        var seen = [] as Array<String>;
        for (var i = 0; i < sets.size(); i++) { var x = strOf(sets[i]["ex"]); if (seen.indexOf(x) < 0) { seen.add(x); } }
        return seen.size();
    }

    // js: prefill(F): last set of this session, else last session's set n (or its last), else a start value; a workout suggests its own
    function prefill() as Void {
        var e = curEx(), id = strOf(e["id"]), t = exT(e), mine = setsOf(id), n = mine.size();
        if (n > 0) { kg = fltOf(mine[n - 1]["kg"]); reps = numOf(mine[n - 1]["reps"]); return; }
        var s = arrOf(e["s"]);
        var p = s.size() > 0 ? arrOf(n < s.size() ? s[n] : s[s.size() - 1]) : [] as Array;
        if (p.size() >= 2) { kg = fltOf(p[0]); reps = numOf(p[1]); }
        else { kg = "w".equals(t) ? 20.0 : 0.0; reps = "time".equals(t) ? 60 : ("bw".equals(t) ? 10 : 8); }
        var it = planItem();
        if (it != null) { if (id.equals(it[0])) { var pk = fltOf(it[3]); if (pk > 0.0 || !"w".equals(t)) { kg = pk; } reps = numOf(it[2]); } }
    }
    // js: stepValue(F, d, big)
    function stepValue(d as Number, big as Boolean) as Void {
        if (focus == 0) {
            var v = kg + d * (big ? KG_HOLD : KG_STEP);
            v = rnd(v * 100.0) / 100.0;
            kg = v < 0.0 ? 0.0 : (v > KG_MAX ? KG_MAX : v);
        } else if (isTime(curEx())) {
            var r = reps + d * (big ? SEC_HOLD : SEC_STEP);
            reps = r < 0 ? 0 : (r > SEC_MAX ? SEC_MAX : r);
        } else {
            var r = reps + d * (big ? REPS_HOLD : 1);
            reps = r < 0 ? 0 : (r > REPS_MAX ? REPS_MAX : r);
        }
    }
    function menuFor() as Array<String> {
        if (start != 0) {
            var m = [M_EX] as Array<String>;
            if (plan != null) { m.add(M_SKIP); }
            if (sets.size() > 0) { m.add(M_UNDO); }
            m.add(M_FIN);
            return m;
        }
        return paired ? [M_SYNC, M_PAIR] as Array<String> : [M_PAIR] as Array<String>;
    }
    function openMenu() as Void { back = scr; menu = menuFor(); sel = 0; scr = S_MENU; }
    function choose(i as Number) as Void {
        var n = exCount();
        cur = i < 0 ? 0 : (i > n - 1 ? imax(0, n - 1) : i);
        focus = "w".equals(exT(curEx())) ? 0 : 1;
        holdAt = 0;
        prefill();
        scr = S_SET;
    }
    // the free picker leaves a workout
    function toPick() as Void { plan = null; holdAt = 0; sel = sets.size() > 0 ? imax(0, list.indexOf(cur)) : 0; scr = S_PICK; }
    // js: goPlan(F): to the planned exercise (added to the setup when the setup does not know it)
    function goPlan() as Void {
        var it = planItem();
        if (it == null) { return; }
        var id = strOf(it[0]), l = exList(), i = exIndex(l, id);
        if (i < 0) {
            var nm = it.size() > 5 && it[5] instanceof String ? it[5] as String : id;
            l.add({ "id" => id, "n" => nm, "t" => "w" });
            i = l.size() - 1;
            list.add(i);
        }
        choose(i);
    }
    // js: advance(F): one step on in the workout
    function advance() as Void {
        var it = planItem(), p = plan;
        if (it == null) { return; }
        if (p == null) { return; }
        p[2] = p[2] + 1;
        if (p[2] >= numOf(it[1])) { p[1] = p[1] + 1; p[2] = 0; }
    }
    function startPlan(w as Number, now as Number) as Void { plan = [w, 0, 0] as Array<Number>; if (start == 0) { start = now; } goPlan(); }

    // js: completeSet(F, now)
    function completeSet(now as Number) as Void {
        if (reps <= 0) { cues.add(C_ERROR); return; }
        var e = curEx(), id = strOf(e["id"]), w = "w".equals(exT(e));
        var v = w ? e1rm(kg, reps) : reps.toFloat();
        var before = 0.0, mine = setsOf(id);
        for (var i = 0; i < mine.size(); i++) {
            var x = w ? e1rm(fltOf(mine[i]["kg"]), numOf(mine[i]["reps"])) : numOf(mine[i]["reps"]).toFloat();
            if (x > before) { before = x; }
        }
        var t = now - start;
        var set = { "ex" => id, "kg" => kg, "reps" => reps, "t" => t > 0 ? t : 0 } as Dictionary;
        var best = fltOf(e["b"]);
        if (best > 0.0 && v > best + 0.01 && v > before + 0.01) {
            set["pr"] = true;
            flash = { "k" => "pr", "until" => now + PR_SECS, "kg" => kg, "reps" => reps, "t" => exT(e) } as Dictionary;
            cues.add(C_PR);
        } else {
            cues.add(C_SET);
        }
        sets.add(set);
        var it = planItem(), sr = numOf(setup["rest"]);
        restLen = sr > 0 ? sr : 90;
        if (it != null) {
            if (numOf(it[4]) > 0) { restLen = numOf(it[4]); }
            advance();
            if (planItem() == null) { finish(now); return; } // the last planned set ends the workout
        }
        restEnd = now + restLen;
        scr = S_REST;
    }
    function endRest(vib as Boolean) as Void {
        restEnd = 0;
        if (planItem() != null) { goPlan(); } else { prefill(); scr = S_SET; }
        if (vib) { cues.add(C_REST); }
    }
    // js: undo(F): back on that set with its values, to fix and tick again
    function undo() as Void {
        var n = sets.size();
        if (n == 0) { return; }
        var s = sets[n - 1];
        sets = sets.slice(0, n - 1) as Array<Dictionary>;
        var p = plan;
        if (p != null) {
            if (p[2] > 0) { p[2] = p[2] - 1; }
            else if (p[1] > 0) { p[1] = p[1] - 1; p[2] = 0; var it = planItem(); if (it != null) { p[2] = imax(0, numOf(it[1]) - 1); } }
        }
        var i = exIndex(exList(), s["ex"]);
        if (i >= 0) { cur = i; }
        kg = fltOf(s["kg"]); reps = numOf(s["reps"]); restEnd = 0; holdAt = 0; scr = S_SET;
    }
    // js: finish(F, now): the session goes into the queue (sent and retried by the app), the summary shows
    function finish(now as Number) as Void {
        if (sets.size() == 0) { reset(); return; }
        var id = Math.rand().format("%08x") + now.format("%x");
        var dur = now - start; if (dur < 1) { dur = 1; }
        var l = [] as Array<Dictionary>, prs = 0;
        for (var i = 0; i < sets.size(); i++) {
            var s = sets[i];
            l.add({ "ex" => s["ex"], "kg" => s["kg"], "reps" => s["reps"], "t" => s["t"] } as Dictionary);
            if (s["pr"] == true) { prs++; }
        }
        var sess = { "id" => id, "start" => start, "duration" => dur, "sets" => l } as Dictionary;
        if (hrN > 0) { sess["hr"] = { "avg" => rnd(hrSum.toFloat() / hrN), "max" => hrMax } as Dictionary; }
        queue.add(sess);
        sum = { "id" => id, "dur" => dur, "sets" => sets.size(), "vol" => volume(), "exs" => distinctEx(), "prs" => prs, "st" => paired ? ST_SENDING : ST_QUEUED } as Dictionary;
        sets = [] as Array<Dictionary>; start = 0; restEnd = 0; plan = null; holdAt = 0; hrN = 0; hrSum = 0; hrMax = 0;
        scr = S_SUM; cues.add(C_DONE); out.add({ "k" => O_SEND } as Dictionary);
    }
    function reset() as Void { sets = [] as Array<Dictionary>; start = 0; restEnd = 0; plan = null; flash = null; sum = null; holdAt = 0; scr = S_START; }
    // js: sent(F, id, res)
    function sent(id as String, res as Number) as Void {
        if (res != R_RETRY) {
            var q = [] as Array<Dictionary>;
            for (var i = 0; i < queue.size(); i++) { if (!id.equals(queue[i]["id"])) { q.add(queue[i]); } }
            queue = q;
        }
        var s = sum;
        if (s != null) { if (id.equals(s["id"])) { s["st"] = res == R_OK ? ST_SAVED : (res == R_DROP ? ST_FAILED : ST_QUEUED); } }
    }
    // js: paired(F, ok, setup)
    function pairedResult(ok as Boolean, setupIn) as Void {
        if (!ok) { pairSt = P_FAIL; return; }
        paired = true; pairD = [0, 0, 0, 0, 0, 0] as Array<Number>; pairI = 0; pairSt = P_ENTER;
        if (setupIn != null) { setSetup(setupIn); }
        sel = 0; scr = S_HOME; cues.add(C_DONE); out.add({ "k" => O_SETUP } as Dictionary); out.add({ "k" => O_SEND } as Dictionary);
    }
    // js: setSetup(F, setup): keeps the current exercise when it is still in the list
    function setSetup(s) as Void {
        if (!(s instanceof Dictionary) || !((s as Dictionary)["ex"] instanceof Array)) { return; }
        var id = strOf(curEx()["id"]);
        setup = s as Dictionary;
        list = order(setup);
        var i = exIndex(exList(), id);
        cur = i < 0 ? 0 : i;
    }
    // js: setConfig(F, cfg). The pages are worked out again when no recording runs (a running one keeps its pages).
    function setConfig(c) as Void {
        if (!cfgOk(c)) { return; }
        cfg = c as Dictionary;
        if (rec == null) { pages = dataPages(); }
    }

    /* ---- run, ride and the other sports: data pages, route page, laps, pause, segment popup ---- */
    // js: sportCfg(F)[k] as a flag; "other" has no route, segments, laps or auto pause, and vibrates
    function flag(k as String) as Boolean {
        var c = cfg[sp];
        if (c instanceof Dictionary && (c as Dictionary).hasKey(k)) { var v = (c as Dictionary)[k]; return v == true || numOf(v) != 0; }
        return "other".equals(sp) && "vib".equals(k);
    }
    // js: recPages(F) without the route page: the data pages of the sport, only known field ids
    function dataPages() as Array<Array<String>> {
        var c = cfg[sp], r = [] as Array<Array<String>>;
        var p = c instanceof Dictionary ? arrOf((c as Dictionary)["p"]) : [] as Array;
        for (var i = 0; i < p.size(); i++) {
            var pg = arrOf(p[i]), f = [] as Array<String>;
            for (var j = 0; j < pg.size(); j++) { var id = pg[j]; if (id instanceof String && Fields.known(sp, id as String)) { f.add(id as String); } }
            r.add(f);
        }
        if (r.size() == 0) { r.add(["time"] as Array<String>); } // never no page (js would divide by 0)
        return r;
    }
    function hasRoutePage() as Boolean { return route != null && flag("map"); }
    function pageCount() as Number { return pages.size() + (hasRoutePage() ? 1 : 0); }
    function lapM() as Float { return "ride".equals(sp) ? 5000.0 : 1000.0; } // js: LAP_M
    function cue(k as Number) as Void { if (rec == null || flag("vib")) { cues.add(k); } }
    function ready(s as String, t as String, nm as String) as Void {
        sp = s; type = t; tname = nm; pages = dataPages(); scr = S_READY;
        if (!"other".equals(sp) && routes == null) { out.add({ "k" => O_ROUTES } as Dictionary); }
    }
    // js: setRoutes(F, list): at most 20, each with an id and a name
    function setRoutes(l) as Void {
        var a = arrOf(l), r = [] as Array<Dictionary>;
        for (var i = 0; i < a.size() && r.size() < 20; i++) {
            var x = a[i];
            if (x instanceof Dictionary && strOf((x as Dictionary)["id"]).length() > 0 && strOf((x as Dictionary)["name"]).length() > 0) { r.add(x as Dictionary); }
        }
        routes = r;
    }
    function routeIndex() as Number {
        var l = routes, id = routeId;
        if (l == null) { return -1; }
        if (id == null) { return -1; }
        for (var i = 0; i < l.size(); i++) { if (id.equals(strOf(l[i]["id"]))) { return i; } }
        return -1;
    }
    function openRoutes() as Void { sel = routeIndex() + 1; scr = S_RPICK; if (routes == null) { out.add({ "k" => O_ROUTES } as Dictionary); } }
    // js: chooseRoute(F, i): row 0 = no route, else that route (loaded with O_ROUTE, the app answers with setRoute)
    function chooseRoute(i as Number) as Void {
        var l = routes, picked = false;
        if (i > 0 && l != null) {
            if (i - 1 < l.size()) {
                var id = strOf(l[i - 1]["id"]), cur = routeId, same = false;
                picked = true;
                if (cur != null) { same = cur.equals(id); }
                if (!same || route == null) { routeId = id; route = null; out.add({ "k" => O_ROUTE, "id" => id } as Dictionary); }
            }
        }
        if (!picked) { routeId = null; route = null; }
        sel = 0; scr = S_READY;
    }
    // js: lap(F, now)
    function lap(now as Number) as Void {
        var R = rec;
        if (R == null) { return; }
        var lt = R.t - R.lapT0, ld = R.d - R.lapD0;
        R.lapN = R.lapN + 1; R.lapT0 = R.t; R.lapD0 = R.d;
        flash = { "k" => "lap", "n" => R.lapN, "t" => lt, "d" => ld, "until" => now + LAP_SECS } as Dictionary;
        cue(C_LAP);
    }
    // js: sample(F, now, a): one second of movement { "dt", "v" (m/s), "hr", "pw" (W), "cad", "up" (m climbed) }.
    // The watch adds "dd" (metres of the native session this second) and "kcal" (its calories); without them the JS estimates count.
    function sample(now as Number, a as Dictionary) as Void {
        var R = rec;
        if (R == null) { return; }
        if (R.st != RS_RUN) { return; }
        var dt = numOf(a["dt"]); if (dt <= 0) { dt = 1; }
        var v = fltOf(a["v"]); if (v < 0.0) { v = 0.0; }
        R.v = v; R.hr = numOf(a["hr"]); R.cad = numOf(a["cad"]);
        var pw = numOf(a["pw"]); R.pw = pw > 0 ? pw : 0;
        R.p3[R.p3I] = R.pw; R.p3I = (R.p3I + 1) % 3; if (R.p3N < 3) { R.p3N = R.p3N + 1; }
        if (R.hr > 0) { hr = R.hr; }
        R.auto = flag("pause") && !"other".equals(sp) && v < PAUSE_MS;
        if (R.auto) { return; } // auto pause: the clock stops while standing
        R.t = R.t + dt;
        var dd = a["dd"];
        R.d = R.d + (dd != null ? fltOf(dd) : v * dt);
        R.pwSum = R.pwSum + R.pw * dt;
        var up = fltOf(a["up"]); if (up > 0.0) { R.gain = R.gain + up; }
        var kc = numOf(a["kcal"]);
        if (kc > 0) { R.kcal = kc.toFloat(); }
        else if ("ride".equals(sp)) { R.kcal = R.kcal + R.pw * dt / 1000.0; }                // kJ ~ kcal
        else if ("run".equals(sp)) { R.kcal = R.kcal + v * dt / 1000.0 * 70.0; }            // ~70 kcal / km
        else { var h = R.hr > 0 ? (R.hr - 60) / 10.0 : 5.0; if (h < 3.0) { h = 3.0; } R.kcal = R.kcal + dt / 60.0 * h; }
        if ("ride".equals(sp)) {
            R.p30Sum = R.p30Sum + R.pw - R.p30[R.p30I]; R.p30[R.p30I] = R.pw; R.p30I = (R.p30I + 1) % 30;
            if (R.p30N < 30) { R.p30N = R.p30N + 1; }
            if (R.p30N == 30) { var m = R.p30Sum / 30.0; R.np4 = R.np4 + m * m * m * m; R.npN = R.npN + 1; }
        }
        if (flag("lap") && R.d - R.lapD0 >= lapM()) { lap(now); }
    }
    // js: segment(F, now, a): { "k" => "warn" | "live" | "end" | "none", "name", "len", "eta", "done", "delta", "need" (0 = out of reach),
    // "time", "pr" (warn: PR seconds; end: a new PR), "ref" ("PR" | "KOM" | "" = nothing to beat) } (Feed.mc SegFeed.step)
    function segment(now as Number, a) as Void {
        if (!(a instanceof Dictionary)) { return; }
        var d = a as Dictionary, k = strOf(d["k"]);
        if (k.equals("none")) { var g = seg; if (g != null) { if (!"end".equals(g["k"])) { seg = null; } } return; } // a result stays its 5 s
        if (rec == null || !flag("seg")) { return; }
        if (!k.equals("warn") && !k.equals("live") && !k.equals("end")) { return; }
        var was = seg, same = false, hide = false;
        if (was != null) { same = k.equals(was["k"]); hide = same && was["hide"] == true; }
        d["hide"] = hide;
        d["until"] = k.equals("end") ? now + SEG_SECS : 0;
        seg = d;
        if (!same) { cue(k.equals("end") && d["pr"] == true ? C_PR : C_SEG); }
    }
    // js: routeInfo(F): { "pos" (0..1), "left" (m), "turn" => { "dir", "in", "txt" } or null, "off" (m, 0 = on the route) } or null.
    // Where on the route: the watch's own tracking (routeNav) once it has a fix, else the distance recorded.
    function routeInfo() as Dictionary or Null {
        var r = route;
        if (r == null) { return null; }
        var len = fltOf(r["len"]);
        if (len <= 0.0) { return null; }
        var R = rec, d = 0.0;
        if (navOn) { d = navAlong; } else if (R != null) { d = R.d; }
        var pos = d / len, ta = arrOf(r["ta"]), td = arrOf(r["td"]), tt = arrOf(r["tt"]), turn = null, off = navOn ? navOff : 0;
        if (pos > 1.0) { pos = 1.0; }
        for (var i = 0; i < ta.size() && off == 0; i++) {
            var at = fltOf(ta[i]);
            if (at > d) {
                var dir = i < td.size() ? strOf(td[i]) : "L", txt = i < tt.size() ? strOf(tt[i]) : "";
                if (txt.length() == 0) { txt = dir.equals("U") ? "U-turn" : (dir.equals("R") ? "Turn right" : "Turn left"); }
                turn = { "dir" => dir.equals("R") ? "R" : "L", "in" => at - d, "txt" => txt } as Dictionary;
                break;
            }
        }
        var left = len - d;
        return { "pos" => pos, "left" => left > 0.0 ? left : 0.0, "turn" => turn, "off" => off } as Dictionary;
    }
    // js: routeNav(F, along, off): metres along, metres off (0 = on the route); the watch adds its position in the box (u, v)
    function routeNav(along as Float, off as Number, u as Float, v as Float) as Void {
        navOn = true; navAlong = along > 0.0 ? along : 0.0; navOff = off > 0 ? off : 0; navU = u; navV = v;
    }
    // js: setRoute(F, r): { "len" (m), "u", "v" => the points 0..1 in the box (flat), "ta", "td" => the turns (flat), "tt"? names }
    function setRoute(r) as Void {
        route = r instanceof Dictionary && fltOf((r as Dictionary)["len"]) > 0.0 && arrOf((r as Dictionary)["u"]).size() > 1
                && arrOf((r as Dictionary)["u"]).size() == arrOf((r as Dictionary)["v"]).size() ? r as Dictionary : null;
    }
    function begin(now as Number) as Void {
        rec = new Rec(now); seg = null; navOn = false; flash = null; scr = S_REC; last = "other".equals(sp) ? "more" : sp; cue(C_START);
    }
    function saveRec(now as Number) as Void {
        var R = rec;
        if (R == null) { return; }
        rsum = { "sp" => sp, "type" => type, "name" => tname, "t" => R.t, "d" => R.d, "laps" => R.lapN + (R.d - R.lapD0 > 10.0 ? 1 : 0),
                 "kcal" => R.kcal, "avgPw" => R.t > 0 ? R.pwSum / R.t : 0.0, "gain" => R.gain, "start" => R.start } as Dictionary;
        out.add({ "k" => O_SAVEACT } as Dictionary);
        rec = null; seg = null; flash = null; scr = S_RSUM; cues.add(C_DONE);
    }
    function discardRec() as Void { rec = null; seg = null; flash = null; sel = 0; scr = S_HOME; }

    // js: handle(F, ev, now, arg)
    function handle(ev as Number, now as Number, arg) as Void {
        if (ev == E_HR) {
            hr = numOf(arg);
            if (start != 0 && hr > 0) { hrN++; hrSum += hr; if (hr > hrMax) { hrMax = hr; } }
            return;
        }
        if (ev == E_SAMPLE) { if (arg instanceof Dictionary) { sample(now, arg as Dictionary); } return; }
        if (ev == E_SEG) { segment(now, arg); return; }
        if (ev == E_TICK) {
            var f = flash;
            if (f != null) { if (now >= numOf(f["until"])) { flash = null; } }
            var g = seg;
            if (g != null) { if ("end".equals(g["k"]) && now >= numOf(g["until"])) { seg = null; } }
            if (scr == S_REST && now >= restEnd) { endRest(true); }
            if (scr == S_SET && holdAt > 0 && !holdCued && now - holdAt >= reps) { holdCued = true; cues.add(C_HOLD); }
            return;
        }
        if (flash != null) { flash = null; if (ev != E_MENU) { return; } } // the first touch after a record only clears the flash
        if (ev == E_SWIPE_LEFT) { ev = E_MENU; }
        if (ev == E_SWIPE_RIGHT) { ev = E_BACK; }
        var s = scr;
        var isList = s == S_PICK || s == S_MENU || s == S_HOME || s == S_MORE || s == S_SMODE || s == S_WPICK || s == S_PAUSE || s == S_RPICK;
        // a list (and the data pages) scroll with the finger, a number counts up
        if (ev == E_SWIPE_UP) { ev = (isList || s == S_REC) ? E_DOWN : E_UP; }
        else if (ev == E_SWIPE_DOWN) { ev = (isList || s == S_REC) ? E_UP : E_DOWN; }
        if (ev == E_MENU) { if (s == S_HOME || s == S_START || s == S_PICK || s == S_SET || s == S_REST) { openMenu(); } return; }
        if (s == S_GLANCE) { if (ev == E_START || ev == E_TAP) { sel = 0; scr = paired ? S_HOME : S_PAIR; } return; }
        if (s == S_START) {
            if (ev == E_START || ev == E_TAP) {
                if (exCount() == 0) { out.add({ "k" => O_SETUP } as Dictionary); return; }
                start = now; sets = [] as Array<Dictionary>; sum = null; plan = null; last = "kraft";
                if (workouts().size() > 0) { sel = 0; scr = S_SMODE; } else { toPick(); }
            } else if (ev == E_BACK) { sel = 0; scr = S_HOME; }
            return;
        }
        if (s == S_READY) {
            if (ev == E_START || ev == E_TAP) { begin(now); }
            else if ((ev == E_UP || ev == E_DOWN) && !"other".equals(sp)) { openRoutes(); }
            else if (ev == E_BACK) { sel = 0; scr = "other".equals(sp) ? S_MORE : S_HOME; }
            return;
        }
        if (s == S_REC) {
            var R = rec;
            if (R == null) { scr = S_HOME; return; }
            var n = pageCount();
            if (ev == E_UP || ev == E_DOWN) { R.pg = (R.pg + (ev == E_DOWN ? 1 : n - 1)) % n; }
            else if (ev == E_START) { R.st = RS_PAUSE; sel = 0; scr = S_PAUSE; cue(C_STOP); }
            else if (ev == E_BACK || ev == E_TAP) { // BACK = lap (like Garmin); first it closes the segment popup
                var g = seg, open = false;
                if (g != null) { if (g["hide"] != true) { g["hide"] = true; open = true; } }
                if (!open && ev == E_BACK) { lap(now); }
            }
            return;
        }
        if (isList) {
            var items = listItems(), n = items.size();
            if (n == 0) {
                if (ev == E_BACK) {
                    if (s == S_MENU) { scr = back; }
                    else if (s == S_MORE) { scr = S_HOME; }
                    else if (s == S_WPICK) { scr = S_SMODE; }
                    else if (s == S_RPICK) { scr = S_READY; }
                    else if (s == S_HOME) { out.add({ "k" => O_EXIT } as Dictionary); }
                    else { scr = S_START; }
                }
                return;
            }
            if (ev == E_UP) { sel = (sel + n - 1) % n; }
            else if (ev == E_DOWN) { sel = (sel + 1) % n; }
            else if (ev == E_START || ev == E_ITEM || (ev == E_TAP && s != S_PICK && s != S_MENU)) {
                var i = ev == E_ITEM ? numOf(arg) : sel;
                pickItem(i < 0 ? 0 : (i > n - 1 ? n - 1 : i), now);
            } else if (ev == E_BACK) {
                if (s == S_MENU) { scr = back; }
                else if (s == S_HOME) { out.add({ "k" => O_EXIT } as Dictionary); }
                else if (s == S_MORE) { sel = 0; scr = S_HOME; }
                else if (s == S_PAUSE) { var R = rec; if (R != null) { R.st = RS_RUN; } scr = S_REC; cue(C_START); }
                else if (s == S_WPICK) { sel = 0; scr = S_SMODE; }
                else if (s == S_RPICK) { sel = 0; scr = S_READY; }
                else if (sets.size() > 0) { if (planItem() != null) { goPlan(); } else { prefill(); scr = S_SET; } }
                else { reset(); } // PICK / SMODE
            }
            return;
        }
        if (s == S_RSUM) { if (ev == E_START || ev == E_BACK || ev == E_TAP) { rsum = null; sel = 0; scr = S_HOME; } return; }
        if (s == S_SET) {
            var timed = isTime(curEx());
            if (ev == E_UP || ev == E_DOWN) { stepValue(ev == E_UP ? 1 : -1, false); }
            else if (ev == E_UP_HOLD || ev == E_DOWN_HOLD) { stepValue(ev == E_UP_HOLD ? 1 : -1, true); }
            else if (ev == E_FOCUS) { focus = numOf(arg) == 0 ? 0 : 1; }
            else if (ev == E_BACK) { if (timed && holdAt > 0) { holdAt = 0; } else { focus = 1 - focus; } } // BACK: weight <-> reps; a running hold timer is cancelled
            else if (ev == E_START) {                                                                     // touch: the drawn DONE button sends E_START
                if (timed && holdAt == 0) { holdAt = now; holdCued = false; cues.add(C_START); }        // watch only: START starts the hold clock
                else { if (timed) { var el = now - holdAt; holdAt = 0; if (el > 0) { reps = el; } } completeSet(now); }
            }
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
            else if (ev == E_FOCUS) { var a = numOf(arg); pairI = a < 0 ? 0 : (a > 5 ? 5 : a); }
            else if (ev == E_START || ev == E_TAP) {
                if (pairI < 5) { pairI++; }
                else {
                    pairSt = P_SENDING;
                    var code = "";
                    for (var i = 0; i < 6; i++) { code += pairD[i].toString(); }
                    out.add({ "k" => O_PAIR, "code" => code } as Dictionary);
                }
            } else if (ev == E_BACK) {
                if (pairI > 0) { pairI--; } else if (paired) { sel = 0; scr = S_HOME; } else { out.add({ "k" => O_EXIT } as Dictionary); }
            }
        }
    }
    // js: listItems(F): the rows of the list on screen
    function listItems() as Array<String> {
        var s = scr, r = [] as Array<String>;
        if (s == S_MENU) { return menu; }
        if (s == S_PICK) { var l = exList(); for (var i = 0; i < list.size(); i++) { var e = l[list[i]]; r.add(e instanceof Dictionary ? strOf((e as Dictionary)["n"]) : ""); } }
        else if (s == S_HOME) { var h = homeItems(); for (var i = 0; i < h.size(); i++) { r.add(homeLabel(h[i])); } }
        else if (s == S_MORE) { var m = moreList(); for (var i = 0; i < m.size(); i++) { var x = arrOf(m[i]); r.add(x.size() > 1 ? strOf(x[1]) : ""); } }
        else if (s == S_SMODE) { r = ["Workout", "Free"] as Array<String>; }
        else if (s == S_WPICK) { var w = workouts(); for (var i = 0; i < w.size(); i++) { r.add(strOf(w[i]["n"])); } }
        else if (s == S_PAUSE) { r = ["Resume", "Save", "Discard"] as Array<String>; }
        else if (s == S_RPICK) { r.add("None"); var l = routes; if (l != null) { for (var i = 0; i < l.size(); i++) { r.add(strOf(l[i]["name"])); } } }
        return r;
    }
    function pickItem(i as Number, now as Number) as Void {
        var s = scr;
        if (s == S_PICK) { choose(i < list.size() ? list[i] : 0); }
        else if (s == S_MENU) { act(menu[i], now); }
        else if (s == S_HOME) {
            var k = homeItems()[i];
            sel = 0;
            if (k.equals("kraft")) { scr = S_START; } else if (k.equals("more")) { scr = S_MORE; } else { ready(k, "", ""); }
        }
        else if (s == S_MORE) { var x = arrOf(moreList()[i]); ready("other", x.size() > 0 ? strOf(x[0]) : "", x.size() > 1 ? strOf(x[1]) : ""); }
        else if (s == S_SMODE) { if (i == 0) { sel = 0; scr = S_WPICK; } else { toPick(); } }
        else if (s == S_WPICK) { startPlan(i, now); }
        else if (s == S_RPICK) { chooseRoute(i); }
        else if (s == S_PAUSE) {
            if (i == 0) { var R = rec; if (R != null) { R.st = RS_RUN; } scr = S_REC; cue(C_START); }
            else if (i == 1) { saveRec(now); }
            else { discardRec(); }
        }
    }
    function act(item as String, now as Number) as Void {
        if (M_EX.equals(item)) { toPick(); }
        else if (M_SKIP.equals(item)) {
            var p = plan;
            if (p != null) { p[1] = p[1] + 1; p[2] = 0; }
            restEnd = 0;
            if (planItem() != null) { goPlan(); } else { finish(now); }
        }
        else if (M_UNDO.equals(item)) { undo(); }
        else if (M_FIN.equals(item)) { finish(now); }
        else if (M_SYNC.equals(item)) { out.add({ "k" => O_SETUP } as Dictionary); out.add({ "k" => O_SEND } as Dictionary); scr = back; }
        else if (M_PAIR.equals(item)) { pairD = [0, 0, 0, 0, 0, 0] as Array<Number>; pairI = 0; pairSt = P_ENTER; scr = S_PAIR; }
    }
}
