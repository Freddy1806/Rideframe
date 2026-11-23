// RIDEFRAME on a Garmin watch: the state machine. A function-by-function port of js/watchflow.js (the browser preview and
// its Node tests use that file): same screens, same events, same numbers. Keep both in step when one changes.
// Time is in seconds (Time.now().value()); kg is a Float, reps a Number (a timed exercise: seconds).
// Outputs drained by RideframeApp: cues (vibrations) and out (requests to the server, saveAct).
// 23.11. (the owner's first day on his fenix 8): BACK goes back (SET / REST -> PICK -> END once sets are logged), START goes weight -> reps ->
// logged, E_DONE (the DONE pill) logs at once, E_START_HOLD switches the field, E_SCROLL (a dragged finger) moves lists, SMODE = Exercises or
// a saved workout, a workout keeps its items in the exercise list (sets carry "pi"), the paged summary, SAVEQ saves the session as a workout.
// Watch-only additions (not in the JS, the preview has no clock to hold): the hold timer of a timed exercise (holdAt,
// first START starts it, the second logs the seconds held, C_HOLD at the planned time) and the gps quality (gps).
// 19.11.: READY (run / ride) -> RPICK (UP / DOWN or a tap on the route line): None or a route sent from the phone; O_ROUTES asks
// for the list (GET /api/watch/routes), O_ROUTE for one route; the app answers with setRoutes / setRoute. The route is kept in
// the flat form of Feed.mc RouteTrack.face; routeNav takes the watch's own position on it.
// 23.11.: the indoor trainer (ERG, js/watchflow.js tOpen ... onTRec): HOME -> S_TSCAN (find / connect, Trainer.mc TLink) -> S_TREC (target, - / +,
// power, cadence, heart rate; a stats page) <-> S_TEND (Resume, Stats page, Finish & save, Discard) -> S_TSUM. E_BLE carries the radio's
// events (TrainerBle.mc), O_TRAINER keeps the trainer's name and the last target, O_SAVEACT with tsum saves the ride (tbody = the upload).
import Toybox.Lang;
import Toybox.Math;

// screens (js: SCR)
const S_START = 0;          // 24.11.: no longer shown (Strength opens the choice / the list at once); the number stays free
const S_PICK = 1;
const S_SET = 2;
const S_REST = 3;
const S_MENU = 4;
const S_SUM = 5;
const S_PAIR = 6;
const S_GLANCE = 7;
const S_HOME = 8;
const S_SMODE = 9;          // 23.11.: Exercises or a saved workout in one list (10 was WPICK)
const S_MORE = 11;
const S_READY = 12;
const S_REC = 13;
const S_PAUSE = 14;
const S_RSUM = 15;
const S_RPICK = 16;
const S_END = 17;          // 23.11.: BACK on the exercise list with sets logged: Keep training, Finish & save, Discard (asks once more)
const S_SAVEQ = 18;        // 23.11.: after the summary: save the session as a workout
const S_TSCAN = 19;        // 23.11.: the indoor trainer: the trainers nearby, or the state of the one chosen
const S_TREC = 20;         // the ERG ride
const S_TEND = 21;         // its menu (BACK)
const S_TSUM = 22;         // its summary
// 23.11.: a finger dragged over a list moves it one row per DRAG_ROW of the screen (js: DRAG_ROW); the list rows: js LIST_LAY
const DRAG_ROW = 0.1;
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
const E_HOLD_START = 19;   // BACK pressed (arg = System.getTimer() ms), or a finger on the pause screen's "Hold to finish" pill
const E_HOLD_END = 20;     // released
const E_SCROLL = 21;       // 23.11.: a finger dragged over a list or the summary, arg = rows (+ = on down the list)
const E_DONE = 22;         // 23.11.: the set screen's DONE pill (logs at once; START goes weight -> reps -> logged)
const E_START_HOLD = 23;   // 23.11.: START held: weight <-> reps
const E_BLE = 24;          // 23.11.: the trainer's radio (TrainerBle.mc): arg = { "k" => "found" | "conn" | "drop" | "done" | "ind", ... }
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
const O_TPL = 8;           // 23.11.: a workout saved on the watch: keep setup and cfg in Storage (it is queued for POST /api/watch/workout)
const O_TRAINER = 9;       // 23.11.: keep the trainer's name (link.want) and the last target (tTgt) in Storage
const O_KEEP = 10;         // 24.11.: keep the setup in Storage (a finished session changed last time's sets, js 'keep')
// menu items (js: MENU)
const M_EX = "Change exercise";
const M_SKIP = "Skip exercise";
const M_UNDO = "Undo last set";
const M_FIN = "Finish";
const M_PAUSE = "Pause";
const M_SYNC = "Sync now";
const M_PAIR = "Pair with phone";
const FREE_ROW = "Free";
// js/watchflow.js VERSION: the menu title shows it
const RF_VERSION = "23.11.6";
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
// the pause screen (js: HOLD_S, HINT_S): BACK held 3 s saves (timed in ms: Time.now() has whole seconds), the short-press hint 2 s
const HOLD_MS = 3000;
const HINT_S = 2;

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
// js: keepLast(setup, sess): a finished session in the cached setup at once (no phone for days, or the server's setup back before the
// upload): each exercise done gets these sets as its last ("s", at most 6) and the best ("b") raised; "recent" and "last" updated
function keepLast(st as Dictionary, sess) as Void {
    if (!(sess instanceof Dictionary)) { return; }
    var ss = arrOf((sess as Dictionary)["sets"]), ex = arrOf(st["ex"]), ids = [] as Array<String>;
    if (ss.size() == 0) { return; }
    for (var i0 = 0; i0 < ss.size(); i0++) { var id = strOf((ss[i0] as Dictionary)["ex"]); if (ids.indexOf(id) < 0) { ids.add(id); } }
    for (var k = 0; k < ids.size(); k++) {
        var j = exIndex(ex, ids[k]);
        if (j < 0) { continue; }
        var e = ex[j] as Dictionary, t = strOf(e["t"]), l = [] as Array, best = 0.0;
        for (var i = 0; i < ss.size(); i++) {
            var x = ss[i] as Dictionary;
            if (!ids[k].equals(strOf(x["ex"]))) { continue; }
            var kg = fltOf(x["kg"]), r = numOf(x["reps"]);
            if (l.size() < 6) { l.add("time".equals(t) ? [0, r] : [kg, r]); }
            var v = "bw".equals(t) || "time".equals(t) ? r.toFloat() : e1rm(kg, r);
            if (v > best) { best = v; }
        }
        e["s"] = l;
        if (best > fltOf(e["b"])) { e["b"] = rnd(best * 10.0) / 10.0; }
    }
    var rc = ids.slice(0, ids.size()) as Array, old = arrOf(st["recent"]);
    for (var i2 = 0; i2 < old.size(); i2++) { if (ids.indexOf(strOf(old[i2])) < 0) { rc.add(old[i2]); } }
    st["recent"] = rc.size() > 8 ? rc.slice(0, 8) : rc;
    var at = numOf((sess as Dictionary)["start"]), la = st["last"];
    if (!(la instanceof Dictionary) || numOf((la as Dictionary)["at"]) <= at) { st["last"] = { "at" => at, "sets" => ss.size(), "n" => "" }; }
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
    var plan as Array<Number> or Null = null;                  // js: plan { w, i, on } as [w, i, on (1 / 0)]; sets on a planned item carry "pi"
    var planSkip as Array<Number> = [] as Array<Number>;       // js: plan.skip
    var endConf as Boolean = false;                            // S_END: the Discard step
    var saveq as Dictionary or Null = null;                    // js: F.saveq { "it", "n", "rows", "wid"?, "wn"? }
    var flash as Dictionary or Null = null;                    // { "k" => "pr" | "lap", "until", ... }
    var sum as Dictionary or Null = null;                      // { "id", "dur", "sets", "vol", "exs", "prs", "st", "hr" ({ avg, max } or null), "ex" ([{ n, t, s: [[kg, reps, pr]] }]) }
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
    // the pause screen, every mode (js: F.pz { from, sel0, at, sel, conf, hold, hint } and F.pauseT)
    var pauseT as Number = 0;                                   // strength: seconds paused in this session
    var pzFrom as Number = S_HOME;
    var pzSel0 as Number = 0;
    var pzAt as Number = 0;
    var pzSel as Number = 0;                                    // 0 = resume, 1 = Discard selected
    var pzConf as Boolean = false;                              // "Discard? START yes, BACK no"
    var pzHolding as Boolean = false;
    var pzHold as Number = 0;                                   // System.getTimer() at the hold start
    var pzHint as Number = 0;
    var gps as Number = 0;                                      // 0 none, 1 poor, 2 usable / good (set by Recorder)
    // 23.11.: the indoor trainer (js: F.link, F.tr, F.tsum, F.tbody, F.tTgt, F.tConf)
    var link as TLink;
    var tr as TRide or Null = null;
    var tsum as Dictionary or Null = null;                      // TRide.sum() + "name"
    var tbody as Dictionary or Null = null;                     // POST /api/watch/activity of the ride just saved (Recorder takes it)
    var tTgt as Number = TW_START;
    var tConf as Boolean = false;

    // js: newFlow(setup, { paired, queue, cfg, last })
    function initialize(setupIn, isPaired as Boolean, q, cfgIn, lastIn, trainerIn, tgtIn) {
        setup = { "ex" => [], "rest" => 90 } as Dictionary;
        link = new TLink(trainerIn);
        var tg = numOf(tgtIn); if (tg >= TW_MIN && tg <= TW_MAX) { tTgt = tg; }
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
    // js: planIts(F): the items of the workout in progress
    function planIts() as Array {
        var p = plan, ws = workouts();
        if (p == null) { return [] as Array; }
        if (p[0] < 0 || p[0] >= ws.size()) { return [] as Array; }
        return arrOf(ws[p[0]]["it"]);
    }
    // item j of the workout: [ex, sets, reps, kg, rest, name?] or null
    function itAt(j as Number) as Array or Null {
        var a = planIts();
        if (j < 0 || j >= a.size() || !(a[j] instanceof Array)) { return null; }
        var x = a[j] as Array;
        return x.size() >= 5 ? x : null;
    }
    // js: planItem(F): the planned item now, null without a workout or while a free exercise is done in between
    function planItem() as Array or Null {
        var p = plan;
        if (p == null) { return null; }
        if (p[2] == 0) { return null; }
        return itAt(p[1]);
    }
    // js: doneOf(F, j): sets logged on planned item j
    function doneOf(j as Number) as Number {
        var n = 0;
        for (var i = 0; i < sets.size(); i++) { var pi = sets[i]["pi"]; if (pi != null) { if (numOf(pi) == j) { n++; } } }
        return n;
    }
    // js: setNo(F)
    function setNo() as Number {
        var p = plan;
        if (p != null && planItem() != null) { return doneOf(p[1]) + 1; }
        return setsOf(strOf(curEx()["id"])).size() + 1;
    }
    // js: nextOpen(F): the next item with sets left (after the one now, wrapping, skipped ones not), -1 = all done
    function nextOpen() as Number {
        var p = plan;
        if (p == null) { return -1; }
        var n = planIts().size();
        for (var k = 1; k <= n; k++) {
            var j = (p[1] + k) % n, x = itAt(j);
            if (x != null) { if (planSkip.indexOf(j) < 0 && doneOf(j) < numOf(x[1])) { return j; } }
        }
        return -1;
    }
    function unskip(j as Number) as Void {
        var r = [] as Array<Number>;
        for (var i = 0; i < planSkip.size(); i++) { if (planSkip[i] != j) { r.add(planSkip[i]); } }
        planSkip = r;
    }
    // js: pickRows(F): [setup index, planned item or -1]; in a workout its items first, then every other exercise in the free order
    function pickRows() as Array<Array<Number>> {
        var r = [] as Array<Array<Number>>, a = planIts(), l = exList(), inPlan = [] as Array<Number>;
        for (var j = 0; j < a.size(); j++) {
            var x = arrOf(a[j]);
            if (x.size() > 0) { var i = exIndex(l, x[0]); if (i >= 0) { r.add([i, j] as Array<Number>); inPlan.add(i); } }
        }
        for (var k = 0; k < list.size(); k++) { if (inPlan.indexOf(list[k]) < 0) { r.add([list[k], -1] as Array<Number>); } }
        return r;
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
    // js: HOME and homeItems(F): the sport used last on top
    function homeKeys() as Array<String> { return ["run", "ride", "trainer", "kraft", "more"] as Array<String>; }
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
        if (k.equals("trainer")) { return "Indoor trainer"; }
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

    // js: prefillOf(F, e): [kg, reps] for the next set of e: last set of this session, else last session's set n (or its last), else a start
    // value; a workout suggests its own
    function prefillOf(e as Dictionary) as Array {
        var id = strOf(e["id"]), t = exT(e), mine = setsOf(id), n = mine.size(), k = 0.0, r = 0;
        if (n > 0) { return [fltOf(mine[n - 1]["kg"]), numOf(mine[n - 1]["reps"])]; }
        var s = arrOf(e["s"]);
        var p = s.size() > 0 ? arrOf(n < s.size() ? s[n] : s[s.size() - 1]) : [] as Array;
        if (p.size() >= 2) { k = fltOf(p[0]); r = numOf(p[1]); }
        else { k = "w".equals(t) ? 20.0 : 0.0; r = "time".equals(t) ? 60 : ("bw".equals(t) ? 10 : 8); }
        var it = planItem();
        if (it != null) { if (id.equals(it[0])) { var pk = fltOf(it[3]); if (pk > 0.0 || !"w".equals(t)) { k = pk; } r = numOf(it[2]); } }
        return [k, r];
    }
    function prefill() as Void { var v = prefillOf(curEx()); kg = fltOf(v[0]); reps = numOf(v[1]); }
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
            if (planItem() != null) { m.add(M_SKIP); }
            if (sets.size() > 0) { m.add(M_UNDO); }
            m.add(M_FIN);
            m.add(M_PAUSE);
            return m;
        }
        return paired ? [M_SYNC, M_PAIR] as Array<String> : [M_PAIR] as Array<String>;
    }
    function openMenu() as Void { back = scr; menu = menuFor(); sel = 0; scr = S_MENU; }
    // to exercise i: weight first (bodyweight and timed: reps / seconds), prefilled
    function choose(i as Number) as Void {
        var n = exCount();
        cur = i < 0 ? 0 : (i > n - 1 ? imax(0, n - 1) : i);
        focus = "w".equals(exT(curEx())) ? 0 : 1;
        holdAt = 0;
        prefill();
        scr = S_SET;
    }
    // js: toPick(F, keep): the exercise list (BACK from a set or the rest, Change exercise); a workout stays on; keep = on the exercise now
    function toPick(keep as Boolean) as Void {
        restEnd = 0; holdAt = 0;
        var p = plan, pi = -1, k = -1;
        if (p != null) { if (p[2] != 0) { pi = p[1]; } }
        if (keep) {
            var rows = pickRows();
            for (var i = 0; i < rows.size() && k < 0; i++) { if (rows[i][0] == cur && rows[i][1] == pi) { k = i; } }
        }
        sel = k < 0 ? 0 : k; scr = S_PICK;
    }
    // js: ensureEx(F, id, n): the setup index of exercise id (added with its name when the setup does not know it)
    function ensureEx(id as String, nm) as Number {
        var l = exList(), i = exIndex(l, id);
        if (i < 0) {
            l.add({ "id" => id, "n" => nm instanceof String ? nm as String : id, "t" => "w" });
            i = l.size() - 1;
            list.add(i);
        }
        return i;
    }
    // js: goPlan(F): to the planned item now
    function goPlan() as Void {
        var p = plan;
        if (p == null) { return; }
        var x = itAt(p[1]);
        if (x == null) { return; }
        p[2] = 1;
        choose(ensureEx(strOf(x[0]), x.size() > 5 ? x[5] : null));
    }
    function startPlan(w as Number, now as Number) as Void {
        plan = [w, 0, 1] as Array<Number>; planSkip = [] as Array<Number>;
        if (start == 0) { start = now; }
        var a = planIts();
        for (var j = 0; j < a.size(); j++) { var x = arrOf(a[j]); if (x.size() > 0) { ensureEx(strOf(x[0]), x.size() > 5 ? x[5] : null); } }
        goPlan();
    }

    // js: completeSet(F, now): stored, record check, rest; a workout goes on to the next item with sets left (none left = finished)
    function completeSet(now as Number) as Void {
        if (reps <= 0) { cues.add(C_ERROR); return; }
        var e = curEx(), id = strOf(e["id"]), w = "w".equals(exT(e));
        var v = w ? e1rm(kg, reps) : reps.toFloat();
        var before = 0.0, mine = setsOf(id);
        for (var i = 0; i < mine.size(); i++) {
            var x = w ? e1rm(fltOf(mine[i]["kg"]), numOf(mine[i]["reps"])) : numOf(mine[i]["reps"]).toFloat();
            if (x > before) { before = x; }
        }
        var t = now - start - pauseT, it = planItem(), p = plan;
        var set = { "ex" => id, "kg" => kg, "reps" => reps, "t" => t > 0 ? t : 0 } as Dictionary;
        if (it != null && p != null) { set["pi"] = p[1]; }
        var best = fltOf(e["b"]);
        if (best > 0.0 && v > best + 0.01 && v > before + 0.01) {
            set["pr"] = true;
            flash = { "k" => "pr", "until" => now + PR_SECS, "kg" => kg, "reps" => reps, "t" => exT(e) } as Dictionary;
            cues.add(C_PR);
        } else {
            cues.add(C_SET);
        }
        sets.add(set);
        var sr = numOf(setup["rest"]);
        restLen = sr > 0 ? sr : 90;
        if (it != null && p != null) {
            if (numOf(it[4]) > 0) { restLen = numOf(it[4]); }
            if (doneOf(p[1]) >= numOf(it[1])) { var j = nextOpen(); if (j < 0) { finish(now); return; } p[1] = j; } // the last planned set ends the workout
        }
        restEnd = now + restLen;
        scr = S_REST;
    }
    function endRest(vib as Boolean) as Void {
        restEnd = 0;
        if (planItem() != null) { goPlan(); } else { choose(cur); }
        if (vib) { cues.add(C_REST); }
    }
    // js: undo(F): back on that set with its values, to fix and tick again (a workout: back on its item)
    function undo() as Void {
        var n = sets.size();
        if (n == 0) { return; }
        var s = sets[n - 1];
        sets = sets.slice(0, n - 1) as Array<Dictionary>;
        var i = exIndex(exList(), s["ex"]);
        if (i >= 0) { cur = i; }
        var p = plan;
        if (p != null) { var pi = s["pi"]; if (pi != null) { p[1] = numOf(pi); p[2] = 1; unskip(p[1]); } else { p[2] = 0; } }
        focus = "w".equals(exT(curEx())) ? 0 : 1;
        kg = fltOf(s["kg"]); reps = numOf(s["reps"]); restEnd = 0; holdAt = 0; scr = S_SET;
    }
    // js: tplOf(F): the session as a workout, one item per block (a planned item, else an exercise) in the order first done:
    // [ex, sets, reps, kg, rest] with the last set's reps and kg, inside the phone editor's limits (js/watchfields.js LIM), at most 20
    function tplOf() as Array<Array> {
        var keys = [] as Array<String>, b = [] as Array<Array>, r0 = numOf(setup["rest"]);
        if (r0 <= 0) { r0 = 90; }
        for (var i = 0; i < sets.size(); i++) {
            var s = sets[i], pi = s["pi"], k = pi != null ? "p" + numOf(pi).toString() : "e" + strOf(s["ex"]), at = keys.indexOf(k);
            if (at < 0) {
                var rest = r0;
                if (pi != null) { var x = itAt(numOf(pi)); if (x != null) { if (numOf(x[4]) > 0) { rest = numOf(x[4]); } } }
                keys.add(k); b.add([strOf(s["ex"]), 0, 0, 0.0, rest]); at = b.size() - 1;
            }
            var o = b[at];
            o[1] = numOf(o[1]) + 1; o[2] = numOf(s["reps"]); o[3] = fltOf(s["kg"]);
        }
        var r = [] as Array<Array>;
        for (var i = 0; i < b.size() && i < 20; i++) {
            var ob = b[i], kq = rnd(fltOf(ob[3]) * 4.0).toFloat() / 4.0;
            r.add([ob[0], imin(10, imax(1, numOf(ob[1]))), imin(100, imax(1, numOf(ob[2]))), kq < 0.0 ? 0.0 : (kq > 500.0 ? 500.0 : kq), imin(600, imax(0, rnd(numOf(ob[4]) / 5.0) * 5))]);
        }
        return r;
    }
    // js: saveOffer(F): null (a saved workout done as planned), else { "it", "n" (name for a new one), "rows", "wid" / "wn" (the workout done) }
    function saveOffer() as Dictionary or Null {
        var p = plan, ws = workouts(), w = null;
        if (p != null) { if (p[0] >= 0 && p[0] < ws.size()) { w = ws[p[0]]; } }
        if (w != null && planSkip.size() == 0) {
            var same = true, n = planIts().size();
            for (var i = 0; i < sets.size() && same; i++) { if (sets[i]["pi"] == null) { same = false; } }
            for (var j = 0; j < n && same; j++) { var x = itAt(j); if (x == null || doneOf(j) != numOf(x[1])) { same = false; } }
            if (same) { return null; }
        }
        var it = tplOf(), l = exList(), nm = "", room = ws.size() < 30;
        for (var i = 0; i < it.size() && i < 2; i++) {
            var k = exIndex(l, it[i][0]), en = k >= 0 ? strOf((l[k] as Dictionary)["n"]) : strOf(it[i][0]);
            nm = i == 0 ? en : nm + " + " + en;
        }
        if (it.size() > 2) { nm = nm + " +" + (it.size() - 2).toString(); }
        if (nm.length() > 40) { nm = nm.substring(0, 40) as String; }
        var rows = [] as Array<String>;
        if (w != null) { rows.add("Update " + strOf(w["n"])); if (room) { rows.add("Save as new"); } rows.add("No"); }
        else if (room) { rows.add("Save as workout"); rows.add("No"); }
        else { return null; }
        var q = { "it" => it, "n" => nm, "rows" => rows } as Dictionary;
        if (w != null) { q["wid"] = strOf(w["id"]); q["wn"] = strOf(w["n"]); }
        return q;
    }
    // js: sumEx(F): the summary's exercises in the order first done: [{ "n", "t", "s" => [[kg, reps, pr 1 / 0]] }]
    function sumEx() as Array<Dictionary> {
        var r = [] as Array<Dictionary>, ids = [] as Array<String>, l = exList();
        for (var i = 0; i < sets.size(); i++) {
            var s = sets[i], id = strOf(s["ex"]), k = ids.indexOf(id);
            if (k < 0) {
                var j = exIndex(l, id), e = j >= 0 ? l[j] as Dictionary : { "n" => id, "t" => "w" } as Dictionary;
                ids.add(id); r.add({ "n" => strOf(e["n"]), "t" => exT(e), "s" => [] as Array } as Dictionary); k = r.size() - 1;
            }
            (r[k]["s"] as Array).add([fltOf(s["kg"]), numOf(s["reps"]), s["pr"] == true ? 1 : 0]);
        }
        return r;
    }
    function newId(now as Number) as String { return Math.rand().format("%08x") + now.format("%x"); }
    // js: finish(F, now): the session goes into the queue (sent and retried by the app), the summary shows, then the question to save it
    function finish(now as Number) as Void {
        if (sets.size() == 0) { reset(); return; }
        var id = newId(now);
        var dur = now - start - pauseT; if (dur < 1) { dur = 1; }
        var l = [] as Array<Dictionary>, prs = 0;
        for (var i = 0; i < sets.size(); i++) {
            var s = sets[i];
            l.add({ "ex" => s["ex"], "kg" => s["kg"], "reps" => s["reps"], "t" => s["t"] } as Dictionary);
            if (s["pr"] == true) { prs++; }
        }
        var sess = { "id" => id, "start" => start, "duration" => dur, "sets" => l } as Dictionary, h = null;
        if (hrN > 0) { h = { "avg" => rnd(hrSum.toFloat() / hrN), "max" => hrMax } as Dictionary; sess["hr"] = h; }
        queue.add(sess);
        keepLast(setup, sess); list = order(setup); // 24.11.: the next session shows these sets as last time's, phone or not
        sum = { "id" => id, "dur" => dur, "sets" => sets.size(), "vol" => volume(), "exs" => distinctEx(), "prs" => prs, "st" => paired ? ST_SENDING : ST_QUEUED,
                "hr" => h, "ex" => sumEx() } as Dictionary;
        saveq = saveOffer();
        sets = [] as Array<Dictionary>; start = 0; pauseT = 0; restEnd = 0; plan = null; planSkip = [] as Array<Number>; holdAt = 0; hrN = 0; hrSum = 0; hrMax = 0;
        sel = 0; scr = S_SUM; cues.add(C_DONE); out.add({ "k" => O_KEEP } as Dictionary); out.add({ "k" => O_SEND } as Dictionary);
    }
    function reset() as Void {
        sets = [] as Array<Dictionary>; start = 0; pauseT = 0; pzConf = false; pzHolding = false; restEnd = 0; plan = null; planSkip = [] as Array<Number>;
        flash = null; sum = null; saveq = null; endConf = false; holdAt = 0; sel = 0; scr = S_HOME; // 24.11.: the start menu, Strength on top
    }
    // js: strength(F, now) (24.11., no strength ready screen): Strength on the start menu opens the choice (Exercises + saved workouts) or,
    // without saved workouts, the exercise list; the session clock starts here. No setup yet: asked for, the list says it is loading.
    function strength(now as Number) as Void {
        start = now; sets = [] as Array<Dictionary>; sum = null; plan = null; last = "kraft"; sel = 0;
        if (exCount() == 0) { out.add({ "k" => O_SETUP } as Dictionary); }
        if (workouts().size() > 0) { scr = S_SMODE; } else { toPick(false); }
    }
    // js: saveTpl(F, asNew): on the watch at once (the strength list), for the account through the queue (POST /api/watch/workout)
    function saveTpl(asNew as Boolean, now as Number) as Void {
        var q = saveq;
        if (q == null) { return; }
        var upd = !asNew && q["wid"] != null;
        var w = { "id" => upd ? strOf(q["wid"]) : "w" + newId(now), "n" => upd ? strOf(q["wn"]) : strOf(q["n"]), "it" => q["it"] } as Dictionary;
        var ls = [setup["workouts"], cfg["w"]] as Array;
        for (var i = 0; i < ls.size(); i++) {
            var a = ls[i];
            if (!(a instanceof Array)) { continue; }
            var la = a as Array, k = -1;
            for (var j = 0; j < la.size(); j++) { var x = la[j]; if (x instanceof Dictionary) { if (strOf((x as Dictionary)["id"]).equals(w["id"])) { k = j; } } }
            if (k >= 0) { la[k] = w; } else { la.add(w); }
        }
        queue.add({ "id" => "t" + newId(now), "tpl" => w } as Dictionary);
        out.add({ "k" => O_TPL } as Dictionary); out.add({ "k" => O_SEND } as Dictionary); cues.add(C_DONE);
    }
    // js: pickBack(F): BACK on the exercise list: with sets the end question, else back to the choice (nothing to lose)
    function pickBack() as Void {
        if (sets.size() > 0) { endConf = false; sel = 0; scr = S_END; return; }
        var w = workouts().size();
        reset();
        if (w > 0) { scr = S_SMODE; }
    }
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
        // sessions still in the queue (not on the server yet) go over it, so last time stays the newest (js setSetup)
        for (var k = 0; k < queue.size(); k++) { if (queue[k]["tpl"] == null) { keepLast(s as Dictionary, queue[k]); } }
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

    /* ---- js: pause, the same in every mode: START resumes, BACK held 3 s saves (an orange ring fills with 3-2-1; released early =
     *      nothing), DOWN / a tap reaches Discard with a confirm step; a short BACK only shows the hint ---- */
    // js: pause(F, now): run / ride / more: START; strength: the menu's Pause. Strength: the clock and a running rest stop.
    function pause(now as Number) as Void {
        pzFrom = scr == S_MENU ? back : scr; pzSel0 = sel; pzAt = now; pzSel = 0; pzConf = false; pzHolding = false; pzHold = 0; pzHint = 0;
        var R = rec;
        if (R != null) { R.st = RS_PAUSE; }
        flash = null; sel = 0; scr = S_PAUSE; cue(C_STOP);
    }
    function resume(now as Number) as Void {
        pzHolding = false; pzConf = false;
        var R = rec;
        if (R != null) { R.st = RS_RUN; scr = S_REC; }
        else {
            var d = now - pzAt; if (d < 0) { d = 0; }
            pauseT += d;
            if (restEnd != 0) { restEnd += d; }
            if (holdAt > 0) { holdAt += d; }
            scr = pzFrom; sel = pzSel0;
        }
        cue(C_START);
    }
    // the hold is full: saved (run / ride / more: the activity; strength: the session, its time without the pauses)
    function endPaused(now as Number) as Void {
        pzHolding = false; pzConf = false;
        if (rec != null) { saveRec(now); }
        else { var d = now - pzAt; if (d > 0) { pauseT += d; } finish(now); }
    }
    function discardPaused() as Void {
        pzHolding = false; pzConf = false;
        if (rec != null) { discardRec(); } else { reset(); }
    }
    // js: holdPart(F, now).p: how full the finish ring is (0..1), -1 when no hold runs; ms = System.getTimer()
    function holdPart(ms as Number) as Float {
        if (scr != S_PAUSE || !pzHolding) { return -1.0; }
        var p = (ms - pzHold).toFloat() / HOLD_MS;
        return p < 0.0 ? 0.0 : (p > 1.0 ? 1.0 : p);
    }
    // js: holdPart(F, now).n: the 3-2-1 count
    function holdCount(ms as Number) as Number {
        var left = HOLD_MS - (ms - pzHold), n = (left + 999) / 1000;
        return n < 1 ? 1 : (n > 3 ? 3 : n);
    }
    // js: pausedTime(F): the moving time, strength: the session time without pauses
    function pausedTime() as Number {
        var R = rec;
        if (R != null) { return R.t; }
        var t = pzAt - start - pauseT;
        return t > 0 ? t : 0;
    }
    // js: onPause(F, ev, now, arg)
    function onPause(ev as Number, now as Number, arg) as Void {
        if (pzConf) { if (ev == E_START) { discardPaused(); } else if (ev == E_BACK) { pzConf = false; } return; }
        if (ev == E_UP || ev == E_DOWN) { pzSel = pzSel != 0 ? 0 : 1; }
        else if (ev == E_START || ev == E_TAP) { if (pzSel != 0) { pzConf = true; } else { resume(now); } }
        else if (ev == E_ITEM) { if (numOf(arg) == 1) { pzSel = 1; pzConf = true; } else { resume(now); } }
        else if (ev == E_BACK) { pzHint = now + HINT_S; }
    }

    /* ---- 23.11.: the indoor trainer (js/watchflow.js tOpen, tBegin, tTarget, tPause, tResume, tFinish, tDiscard, tSecs, onTScan, onTRec) ---- */
    function tOpen(now as Number) as Void { sel = 0; scr = S_TSCAN; if (link.st == TL_OFF) { link.scan(now); } }
    function tBegin(now as Number) as Void {
        var R = new TRide(now, tTgt); tr = R; tsum = null; tbody = null; tConf = false;
        link.setTarget(R.tgt, now); last = "trainer"; scr = S_TREC; cues.add(C_START);
    }
    // a new target: shown at once, sent when the line is free (latest wins); while paused it waits for the resume
    function tTarget(w as Number, now as Number) as Void {
        var R = tr;
        if (R == null || w == R.tgt) { return; }
        R.tgt = w; tTgt = w; R.newBlock();
        if (R.st == RS_RUN) { link.setTarget(w, now); }
    }
    // pause: the clock stops, the trainer goes down to TW_PAUSE; resume: the target again
    function tPause(now as Number) as Void { var R = tr; if (R == null) { return; } R.st = RS_PAUSE; link.setTarget(TW_PAUSE, now); cues.add(C_STOP); }
    function tResume(now as Number) as Void { var R = tr; if (R == null) { return; } R.st = RS_RUN; link.setTarget(R.tgt, now); cues.add(C_START); }
    function tFinish(now as Number) as Void {
        var R = tr;
        if (R == null) { return; }
        if (R.t == 0) { tDiscard(); return; }
        var su = R.sum();
        tbody = R.body(su, newId(now), now);
        su["name"] = link.name; tsum = su;
        out.add({ "k" => O_SAVEACT } as Dictionary); out.add({ "k" => O_TRAINER } as Dictionary);
        link.stop(); tr = null; sel = 0; scr = S_TSUM; cues.add(C_DONE);
    }
    function tDiscard() as Void { link.stop(); tr = null; tConf = false; sel = 0; scr = S_HOME; }
    // the ride's seconds up to now (at most 5 at once, a longer gap is not made up)
    function tSecs(now as Number) as Void {
        var R = tr;
        if (R == null) { return; }
        if (now - R.ts > 5) { R.ts = now - 5; }
        while (R.ts + 1 <= now) { R.ts++; if (R.st == RS_RUN) { R.sec(link.livePw(now), link.liveCad(now), hr); } }
    }
    // S_TSCAN: the list while searching (UP / DOWN, drag, START or a tap connects), else the state with START to ride
    function onTScan(ev as Number, now as Number, arg) as Void {
        var v = link.shown(), n = link.list.size();
        if (v == TL_SCAN || v == TL_OFF) {
            if (ev == E_SCROLL) { var x = sel + numOf(arg); sel = x < 0 ? 0 : (x > n - 1 ? imax(0, n - 1) : x); return; }
            if (ev == E_BACK) { link.stop(); sel = 0; scr = S_HOME; return; }
            if (n == 0) { return; }
            if (ev == E_UP) { sel = (sel + n - 1) % n; }
            else if (ev == E_DOWN) { sel = (sel + 1) % n; }
            else if (ev == E_START || ev == E_TAP || ev == E_ITEM) {
                var i = ev == E_ITEM ? numOf(arg) : sel; i = i < 0 ? 0 : (i > n - 1 ? n - 1 : i);
                link.connect(strOf(link.list[i]["name"]), now);
            }
            return;
        }
        if (ev == E_START || ev == E_TAP) { if (v == TL_READY || v == TL_REFUSED) { tBegin(now); } } // refused: ride anyway, the power is recorded
        else if (ev == E_BACK) { link.stop(); link.want = ""; link.scan(now); sel = 0; }        // cancel: the list, no automatic connect this time
    }
    // S_TREC: UP / DOWN (and the - / + zones, E_ITEM 0 / 1) = a step, held = 25 W; a tap on the target (E_ITEM 2) = 5 / 10 / 25 W steps;
    // START = pause / resume; BACK (BACK held, swipe left / right) = the menu; swipe up / down = the stats page
    function onTRec(ev as Number, now as Number, arg) as Void {
        var R = tr;
        if (R == null) { scr = S_HOME; return; }
        var a = ev == E_ITEM ? numOf(arg) : -1;
        var plus = ev == E_UP || ev == E_UP_HOLD || a == 1, minus = ev == E_DOWN || ev == E_DOWN_HOLD || a == 0;
        if (plus || minus) { tTarget(R.nextTarget(plus ? 1 : -1, ev == E_UP_HOLD || ev == E_DOWN_HOLD), now); }
        else if (ev == E_ITEM) { R.nextStep(); }
        else if (ev == E_START) { if (R.st == RS_RUN) { tPause(now); } else { tResume(now); } }
        else if (ev == E_SWIPE_UP || ev == E_SWIPE_DOWN) { R.pg = 1 - R.pg; }
        else if (ev == E_TAP) { R.pg = 0; } // the stats page: a tap goes back to the ERG page
        else if (ev == E_BACK || ev == E_MENU) { tConf = false; sel = 0; scr = S_TEND; }
    }

    // js: handle(F, ev, now, arg)
    function handle(ev as Number, now as Number, arg) as Void {
        if (ev == E_HR) {
            hr = numOf(arg);
            if (start != 0 && hr > 0) { hrN++; hrSum += hr; if (hr > hrMax) { hrMax = hr; } }
            return;
        }
        if (ev == E_SAMPLE) { if (arg instanceof Dictionary) { sample(now, arg as Dictionary); } return; }
        if (ev == E_SEG) { segment(now, arg); return; }
        if (ev == E_BLE) { // the trainer's radio; a newly remembered trainer is kept (O_TRAINER)
            if (arg instanceof Dictionary) { var w = link.want; link.bleEv(now, arg as Dictionary); if (link.want.length() > 0 && !link.want.equals(w)) { out.add({ "k" => O_TRAINER } as Dictionary); } }
            return;
        }
        if (ev == E_HOLD_START || ev == E_HOLD_END) { // BACK pressed / released (and the touch pill): only the pause screen listens
            if (scr != S_PAUSE || pzConf) { return; }
            if (ev == E_HOLD_START) { pzHolding = true; pzHold = numOf(arg); }
            else if (pzHolding) { pzHolding = false; pzHint = now + HINT_S; } // released early: nothing, the hint
            return;
        }
        if (ev == E_TICK) { // arg = System.getTimer() (RideframeApp.onTick)
            link.tick(now); tSecs(now);
            if (scr == S_PAUSE && pzHolding && numOf(arg) - pzHold >= HOLD_MS) { endPaused(now); return; }
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
        var isList = s == S_PICK || s == S_MENU || s == S_HOME || s == S_MORE || s == S_SMODE || s == S_RPICK || s == S_END || s == S_SAVEQ || s == S_TEND;
        var paged = isList || s == S_REC || s == S_PAUSE || s == S_SUM || s == S_TSCAN;
        if (s == S_TREC) { onTRec(ev, now, arg); return; } // before the swipe mapping: swipe up / down is the stats page there, UP / DOWN the watts
        // a list (the data pages, the summary) scrolls with the finger, a number counts up
        if (ev == E_SWIPE_UP) { ev = paged ? E_DOWN : E_UP; }
        else if (ev == E_SWIPE_DOWN) { ev = paged ? E_UP : E_DOWN; }
        if (s == S_TSCAN) { onTScan(ev, now, arg); return; }
        if (s == S_TSUM) { if (ev == E_START || ev == E_BACK || ev == E_TAP) { sel = 0; scr = S_HOME; } return; }
        if (ev == E_SCROLL) { // the finger dragged: the list follows it row by row (no wrapping)
            var d = numOf(arg), m = -1;
            if (isList) { m = listItems().size() - 1; }
            else if (s == S_SUM) { var u = sum; if (u != null) { m = arrOf(u["ex"]).size(); } }
            if (m >= 0) { var v = sel + d; sel = v < 0 ? 0 : (v > m ? m : v); }
            return;
        }
        if (ev == E_MENU) { if (s == S_HOME || s == S_PICK || s == S_SET || s == S_REST) { openMenu(); } return; }
        if (s == S_PAUSE) { if (rec != null || start != 0) { onPause(ev, now, arg); } else { scr = S_HOME; } return; }
        if (s == S_GLANCE) { if (ev == E_START || ev == E_TAP) { sel = 0; scr = paired ? S_HOME : S_PAIR; } return; }
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
            else if (ev == E_START) { pause(now); }
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
                    else if (s == S_RPICK) { scr = S_READY; }
                    else if (s == S_HOME) { out.add({ "k" => O_EXIT } as Dictionary); }
                    else if (s == S_PICK) { pickBack(); }
                    else { reset(); }
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
                else if (s == S_RPICK) { sel = 0; scr = S_READY; }
                else if (s == S_PICK) { pickBack(); }
                else if (s == S_END) { if (endConf) { endConf = false; sel = 2; } else { toPick(true); } } // BACK = keep training
                else if (s == S_TEND) { if (tConf) { tConf = false; sel = 3; } else { scr = S_TREC; } }  // BACK = resume
                else { reset(); } // SMODE: the strength screen; SAVEQ: = No
            }
            return;
        }
        if (s == S_RSUM) { if (ev == E_START || ev == E_BACK || ev == E_TAP) { rsum = null; sel = 0; scr = S_HOME; } return; }
        if (s == S_SET) {
            var timed = isTime(curEx());
            if (ev == E_UP || ev == E_DOWN) { stepValue(ev == E_UP ? 1 : -1, false); }
            else if (ev == E_UP_HOLD || ev == E_DOWN_HOLD) { stepValue(ev == E_UP_HOLD ? 1 : -1, true); }
            else if (ev == E_FOCUS) { focus = numOf(arg) == 0 ? 0 : 1; }                           // touch: a tap on the weight or the reps
            else if (ev == E_START_HOLD) { if (!timed) { focus = 1 - focus; } }                      // buttons: START held moves between weight and reps
            else if (ev == E_BACK) { if (timed && holdAt > 0) { holdAt = 0; } else { toPick(true); } } // 23.11.: BACK goes back to the exercise list; a running hold timer is cancelled first
            else if (ev == E_START && !timed && focus == 0) { focus = 1; }                           // START: weight, then reps, then the set is logged
            else if (ev == E_START || ev == E_DONE) {                                                // the DONE pill logs at once
                if (timed && holdAt == 0) { holdAt = now; holdCued = false; cues.add(C_START); }    // watch only: the first START / DONE starts the hold clock
                else { if (timed) { var el = now - holdAt; holdAt = 0; if (el > 0) { reps = el; } } completeSet(now); }
            }
            return;
        }
        if (s == S_REST) {
            if (ev == E_START || ev == E_TAP) { endRest(false); }
            else if (ev == E_BACK) { toPick(true); }
            else if (ev == E_UP) { restEnd += REST_STEP; restLen += REST_STEP; }
            else if (ev == E_DOWN) { var e2 = restEnd - REST_STEP; restEnd = e2 > now + 1 ? e2 : now + 1; }
            return;
        }
        if (s == S_SUM) { // 23.11.: page 0 the totals, then one page per exercise; done: the question to save it as a workout (when there is one)
            var su = sum, pn = 1;
            if (su != null) { pn = arrOf(su["ex"]).size() + 1; }
            if (ev == E_UP || ev == E_DOWN) { sel = (sel + (ev == E_DOWN ? 1 : pn - 1)) % pn; }
            else if (ev == E_START || ev == E_BACK || ev == E_TAP) { if (saveq != null) { sel = 0; scr = S_SAVEQ; } else { reset(); } }
            return;
        }
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
        if (s == S_PICK) { var el = exList(), rows = pickRows(); for (var i = 0; i < rows.size(); i++) { var e = el[rows[i][0]]; r.add(e instanceof Dictionary ? strOf((e as Dictionary)["n"]) : ""); } }
        else if (s == S_HOME) { var h = homeItems(); for (var i = 0; i < h.size(); i++) { r.add(homeLabel(h[i])); } }
        else if (s == S_MORE) { var m = moreList(); for (var i = 0; i < m.size(); i++) { var x = arrOf(m[i]); r.add(x.size() > 1 ? strOf(x[1]) : ""); } }
        else if (s == S_SMODE) { r.add(FREE_ROW); var w = workouts(); for (var i = 0; i < w.size(); i++) { r.add(strOf(w[i]["n"])); } }
        else if (s == S_RPICK) { r.add("None"); var l = routes; if (l != null) { for (var i = 0; i < l.size(); i++) { r.add(strOf(l[i]["name"])); } } }
        else if (s == S_END) {
            if (endConf) { var k = sets.size(); r = ["Keep", "Discard " + k.toString() + (k == 1 ? " set" : " sets")] as Array<String>; }
            else { r = ["Keep training", "Finish & save", "Discard"] as Array<String>; }
        }
        else if (s == S_SAVEQ) { var q = saveq; if (q != null) { return q["rows"] as Array<String>; } }
        else if (s == S_TEND) {
            var R = tr;
            if (tConf) { r = ["Keep riding", "Discard ride"] as Array<String>; }
            else { r = ["Resume", R != null && R.pg == 1 ? "ERG page" : "Stats page", "Finish & save", "Discard"] as Array<String>; }
        }
        else if (s == S_TSCAN) { for (var i = 0; i < link.list.size(); i++) { r.add(strOf(link.list[i]["name"])); } }
        return r;
    }
    function pickItem(i as Number, now as Number) as Void {
        var s = scr;
        if (s == S_PICK) {
            var rows = pickRows(), p = plan;
            if (i >= rows.size()) { return; }
            var j = rows[i][1];
            if (j >= 0 && p != null) { p[1] = j; unskip(j); goPlan(); }
            else { if (p != null) { p[2] = 0; } choose(rows[i][0]); }
        }
        else if (s == S_MENU) { act(menu[i], now); }
        else if (s == S_HOME) {
            var k = homeItems()[i];
            sel = 0;
            if (k.equals("kraft")) { strength(now); } else if (k.equals("more")) { scr = S_MORE; } else if (k.equals("trainer")) { tOpen(now); } else { ready(k, "", ""); }
        }
        else if (s == S_MORE) { var x = arrOf(moreList()[i]); ready("other", x.size() > 0 ? strOf(x[0]) : "", x.size() > 1 ? strOf(x[1]) : ""); }
        else if (s == S_SMODE) { if (start == 0) { start = now; } if (i == 0) { toPick(false); } else { startPlan(i - 1, now); } }
        else if (s == S_RPICK) { chooseRoute(i); }
        else if (s == S_END) {
            if (endConf) { if (i == 1) { reset(); } else { endConf = false; sel = 2; } } // the second step: Discard for real, or keep
            else if (i == 0) { toPick(true); } else if (i == 1) { finish(now); } else { endConf = true; sel = 0; }
        }
        else if (s == S_TEND) {
            var R = tr;
            if (tConf) { if (i == 1) { tDiscard(); } else { tConf = false; sel = 3; } }   // the second step: Discard for real, or keep riding
            else if (R == null) { scr = S_HOME; }
            else if (i == 0) { scr = S_TREC; if (R.st != RS_RUN) { tResume(now); } }
            else if (i == 1) { R.pg = 1 - R.pg; scr = S_TREC; }
            else if (i == 2) { tFinish(now); } else { tConf = true; sel = 0; }
        }
        else if (s == S_SAVEQ) { // the last row is No
            var q = saveq;
            if (q != null) { var lastRow = (q["rows"] as Array).size() - 1; if (i < lastRow) { saveTpl(q["wid"] == null || i == 1, now); } }
            reset();
        }
    }
    function act(item as String, now as Number) as Void {
        if (M_EX.equals(item)) { toPick(true); }
        else if (M_SKIP.equals(item)) {
            var p = plan;
            restEnd = 0;
            if (p != null) { planSkip.add(p[1]); var j = nextOpen(); if (j < 0) { finish(now); } else { p[1] = j; goPlan(); } }
        }
        else if (M_UNDO.equals(item)) { undo(); }
        else if (M_FIN.equals(item)) { finish(now); }
        else if (M_PAUSE.equals(item)) { pause(now); }
        else if (M_SYNC.equals(item)) { out.add({ "k" => O_SETUP } as Dictionary); out.add({ "k" => O_SEND } as Dictionary); scr = back; }
        else if (M_PAIR.equals(item)) { pairD = [0, 0, 0, 0, 0, 0] as Array<Number>; pairI = 0; pairSt = P_ENTER; scr = S_PAIR; }
    }
}
