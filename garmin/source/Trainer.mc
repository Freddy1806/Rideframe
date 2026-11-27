// RIDEFRAME on a Garmin watch, 23.11.: the indoor trainer (ERG) as pure state machines, a port of js/watchtrainer.js (one function per
// function, tested in Node: tools/watchtrainer-test.mjs). No Bluetooth here: TrainerBle.mc carries the link's actions (act) to the radio
// and the radio's callbacks back as events (bleEv). The protocol (the same as js/trainer.js over Web Bluetooth):
//   FTMS 0x1826: Indoor Bike Data 0x2AD2 (notify), Control Point 0x2AD9 (write with response + indicate): 0x00 request control, 0x07 start,
//     0x05 + watts LE = ERG target; answers 0x80, op, result (0x01 ok, 0x05 control not permitted = another app has it).
//   Wahoo fallback: Cycling Power 0x1818 with 0x2A63 (notify) + a026e005-0a7d-4ab3-97fa-f1500f9feb8b: unlock 0x20 0xEE 0xFC, ERG 0x42 + watts LE.
// One GATT operation at a time ("Operation already in progress" otherwise): setup steps wait in q, the next starts on "done" (or after
// OP_S). Latest wins: a target is never queued; with the line free and the trainer not having tgt yet, exactly one write goes out.
// Channels: "ibd" (0x2AD2), "fcp" (0x2AD9), "cpm" (0x2A63), "wcp" (Wahoo). Time in whole seconds (Time.now().value()).
import Toybox.Lang;
import Toybox.Math;

const TW_MIN = 30;
const TW_MAX = 1000;
const TW_START = 100;
const TW_PAUSE = 30;     // pause: easy to spin, no ERG spiral when the legs start again
const TW_HOLD = 25;      // UP / DOWN held
const T_OP_S = 3;        // a GATT operation without an answer: failed
const T_CONN_S = 12;     // connecting without a connection
const T_REPAIR_S = 15;   // lost: pair again from a new scan this often
const T_CTL_S = 5;       // refused: ask for control again this often
const T_DATA_S = 3;      // the trainer silent longer: 0 W, 0 rpm
const T_SER_DT = 10;     // the upload's series: one value per 10 s, at most 240, then two become one
const T_SER_MAX = 240;
// link states (js: LST)
const TL_OFF = 0;
const TL_SCAN = 1;
const TL_CONN = 2;
const TL_SETUP = 3;
const TL_READY = 4;
const TL_REFUSED = 5;
const TL_LOST = 6;
// trainer modes
const TM_NONE = 0;
const TM_FTMS = 1;
const TM_WAHOO = 2;
const TM_PM = 3;         // a power meter (or a trainer without control): read, never written

class TLink {
    var st as Number = TL_OFF;
    var list as Array<Dictionary> = [] as Array<Dictionary>;   // [{ "name", "ftms" (Boolean), "rssi" }], FTMS first, then by signal
    var name as String = "";
    var want as String = "";      // the trainer used last: connected by itself when the scan sees it
    var mode as Number = TM_NONE;
    var ever as Boolean = false;  // it was ready once in this session: a drop is "lost, reconnecting"
    var q as Array<Dictionary> = [] as Array<Dictionary>;      // setup steps { "k" => "cccd" | "write", "ch", "v" }
    var op as Dictionary or Null = null;                       // the operation under way (a step, or { "k" => "tgt", "w" })
    var opAt as Number = 0;
    var erg as Boolean = false;   // a target was asked for (connected on the list = no ERG yet)
    var tgt as Number = TW_START;
    var sent as Number = -1;      // the target written last (-1 = the trainer may not have one)
    var ctl as Boolean = false;
    var pw as Number = 0;
    var cad as Number = 0;
    var at as Number = -1000000;
    var crRevs as Number = -1;    // the last crank revolutions (Cycling Power), -1 = none
    var crT as Number = 0;
    var crAt as Number = 0;
    var t0 as Number = 0;
    var setAt as Number = 0;
    var lostAt as Number = 0;
    var ctlAt as Number = 0;
    var act as Array<Dictionary> = [] as Array<Dictionary>;    // for TrainerBle: { "k" => "scan" (on), "pair" (name), "unpair", "cccd" / "write" (ch, v) }

    function initialize(w) { want = w instanceof String ? w as String : ""; }

    function a(d as Dictionary) as Void { act.add(d); }
    // js: scan(L, now)
    function scan(now as Number) as Void { st = TL_SCAN; list = [] as Array<Dictionary>; t0 = now; a({ "k" => "scan", "on" => true }); }
    // js: connect(L, name, now)
    function connect(n as String, now as Number) as Void { a({ "k" => "scan", "on" => false }); a({ "k" => "pair", "name" => n }); name = n; st = TL_CONN; t0 = now; }
    // js: stop(L): let it go (finish, discard, BACK); the laptop or the Wahoo app may take it then
    function stop() as Void {
        if (st == TL_SCAN || st == TL_LOST) { a({ "k" => "scan", "on" => false }); }
        if (st != TL_OFF && st != TL_SCAN) { a({ "k" => "unpair" }); }
        st = TL_OFF; q = [] as Array<Dictionary>; op = null; erg = false; sent = -1; ctl = false; ever = false; pw = 0; cad = 0; list = [] as Array<Dictionary>;
    }
    // js: setTarget(L, w, now)
    function setTarget(w as Number, now as Number) as Void { tgt = w < 0 ? 0 : (w > 2000 ? 2000 : w); erg = true; pump(now); }
    // js: live(L, now): power and cadence, 0 when the trainer has been silent
    function livePw(now as Number) as Number { return now - at > T_DATA_S ? 0 : pw; }
    function liveCad(now as Number) as Number { return now - at > T_DATA_S ? 0 : cad; }
    // js: shown(L): TL_LOST also for connecting again after it had worked; TL_SETUP shows as TL_CONN
    function shown() as Number {
        if (ever && (st == TL_LOST || st == TL_CONN || st == TL_SETUP)) { return TL_LOST; }
        return st == TL_SETUP ? TL_CONN : st;
    }

    // js: pump(L, now): a setup step from the queue, else the newest target when the trainer does not have it yet
    function pump(now as Number) as Void {
        if (op != null) { return; }
        if (q.size() > 0) {
            var o = q[0]; q = q.slice(1, q.size()) as Array<Dictionary>; op = o; opAt = now;
            a({ "k" => o["k"], "ch" => o["ch"], "v" => o["v"] });
            return;
        }
        if (!erg || st != TL_READY || !ctl || (mode != TM_FTMS && mode != TM_WAHOO) || tgt == sent) { return; }
        var w = tgt, ch = mode == TM_FTMS ? "fcp" : "wcp", v = [mode == TM_FTMS ? 0x05 : 0x42, w & 255, (w >> 8) & 255] as Array<Number>;
        op = { "k" => "tgt", "ch" => ch, "v" => v, "w" => w }; opAt = now; sent = w;
        a({ "k" => "write", "ch" => ch, "v" => v });
    }
    function step(k as String, ch as String, v as Array<Number>) as Dictionary { return { "k" => k, "ch" => ch, "v" => v }; }
    // js: setup(L, e, now): subscribe, take control, start; the target goes out again by itself (sent = -1)
    function setup(e as Dictionary, now as Number) as Void {
        st = TL_SETUP; setAt = now; sent = -1; ctl = false; op = null; crRevs = -1;
        mode = e["ftms"] == true ? TM_FTMS : (e["wahoo"] == true ? TM_WAHOO : TM_PM);
        if (mode == TM_FTMS) { q = [step("cccd", "ibd", [1, 0]), step("cccd", "fcp", [2, 0]), step("write", "fcp", [0x00]), step("write", "fcp", [0x07])] as Array<Dictionary>; }
        else if (mode == TM_WAHOO) { q = [step("cccd", "cpm", [1, 0]), step("cccd", "wcp", [2, 0]), step("write", "wcp", [0x20, 0xEE, 0xFC])] as Array<Dictionary>; }
        else { q = [step("cccd", "cpm", [1, 0])] as Array<Dictionary>; }
        pump(now);
    }
    function ready() as Void { st = TL_READY; ever = true; want = name; }
    // js: refused(L, now): say so, ask for control again later, send the target again
    function refused(now as Number) as Void { st = TL_REFUSED; ctl = false; sent = -1; ctlAt = now + T_CTL_S; }
    function lost(now as Number) as Void { st = TL_LOST; lostAt = now; q = [] as Array<Dictionary>; op = null; sent = -1; ctl = false; pw = 0; cad = 0; crRevs = -1; }

    // js: bleEv(L, now, e): { "k" => "found" (list) | "conn" (ftms, wahoo) | "drop" | "done" (ok) | "ind" (ch, v) }
    function bleEv(now as Number, e as Dictionary) as Void {
        var k = strOf(e["k"]);
        if (k.equals("found")) {
            if (st != TL_SCAN && st != TL_LOST) { return; }
            var l = arrOf(e["list"]);
            for (var i = 0; i < l.size(); i++) {
                var d = l[i];
                if (!(d instanceof Dictionary)) { continue; }
                var n = strOf(d["name"]), f = d["ftms"] == true;
                if (n.length() == 0 || !(f || d["cps"] == true)) { continue; }
                var o = null;
                for (var j = 0; j < list.size(); j++) { if (n.equals(list[j]["name"])) { o = list[j]; } }
                if (o != null) { o["rssi"] = numOf(d["rssi"]); if (f) { o["ftms"] = true; } }
                else { list.add({ "name" => n, "ftms" => f, "rssi" => numOf(d["rssi"]) }); }
            }
            sortList();
            var w = st == TL_LOST ? name : want; // lost: only the trainer of this ride; scan: the one used last
            if (w.length() > 0) { for (var j = 0; j < list.size(); j++) { if (w.equals(list[j]["name"])) { connect(w, now); return; } } }
            return;
        }
        if (k.equals("conn")) { if (st == TL_CONN || st == TL_LOST) { setup(e, now); } return; }
        if (k.equals("drop")) {
            if (st == TL_CONN || st == TL_SETUP || st == TL_READY || st == TL_REFUSED) { if (ever) { lost(now); } else { a({ "k" => "unpair" }); scan(now); } }
            return;
        }
        if (k.equals("done")) { done(now, e["ok"] == true); return; }
        if (k.equals("ind")) {
            var ch = strOf(e["ch"]), v = e["v"];
            if (v == null) { return; }
            if (ch.equals("fcp")) {
                if (v.size() >= 3 && v[0] == 0x80) {
                    if (v[1] == 0x00) { if (v[2] == 0x01) { ctl = true; if (st == TL_SETUP || st == TL_REFUSED) { ready(); } } else { refused(now); } }
                    else if (v[1] == 0x05) { if (v[2] == 0x01) { if (st == TL_REFUSED) { ctl = true; ready(); } } else { refused(now); } }
                    pump(now);
                }
            } else if (ch.equals("ibd")) { ibd(v, now); }
            else if (ch.equals("cpm")) { cpm(v, now); }
        }
    }
    // FTMS first, then the strongest signal (a small insertion sort: a few devices)
    function sortList() as Void {
        for (var i = 1; i < list.size(); i++) {
            var x = list[i], j = i - 1;
            while (j >= 0 && better(x, list[j])) { list[j + 1] = list[j]; j--; }
            list[j + 1] = x;
        }
    }
    function better(x as Dictionary, y as Dictionary) as Boolean {
        var fx = x["ftms"] == true, fy = y["ftms"] == true;
        if (fx != fy) { return fx; }
        return numOf(x["rssi"]) > numOf(y["rssi"]);
    }
    // js: done(L, now, ok): a failed target or control request = refused; a failed subscription = no data from it, the setup goes on
    function done(now as Number, ok as Boolean) as Void {
        var o = op;
        if (o == null) { return; }
        op = null;
        if (!ok) {
            var ch = strOf(o["ch"]), v0 = -1, v = o["v"];
            if (v instanceof Array && (v as Array).size() > 0) { v0 = numOf((v as Array)[0]); }
            if ("tgt".equals(o["k"]) || (ch.equals("fcp") && v0 == 0x00) || (ch.equals("wcp") && v0 == 0x20)) { q = [] as Array<Dictionary>; refused(now); }
        }
        if (st == TL_SETUP && q.size() == 0 && op == null && mode != TM_FTMS && ok) { ctl = mode == TM_WAHOO; ready(); } // Wahoo / power only: no answer to wait for
        pump(now);
    }
    // js: linkTick(L, now): every 200 ms: timeouts, the control retry, the reconnect cycle
    function tick(now as Number) as Void {
        if (op != null && now - opAt > T_OP_S) { done(now, false); }
        if (st == TL_CONN && now - t0 > T_CONN_S) { a({ "k" => "unpair" }); if (ever) { lost(now); } else { want = ""; scan(now); } }
        // FTMS without an indication of the control request (VERIFY on the KICKR Core 2): the writes went through, so take it as control
        if (st == TL_SETUP && mode == TM_FTMS && q.size() == 0 && op == null && now - setAt > T_OP_S) { ctl = true; ready(); }
        if (st == TL_REFUSED && mode == TM_FTMS && op == null && q.size() == 0 && now >= ctlAt) {
            ctlAt = now + T_CTL_S; q = [step("write", "fcp", [0x00]), step("write", "fcp", [0x07])] as Array<Dictionary>;
        }
        if (st == TL_REFUSED && mode == TM_WAHOO && op == null && q.size() == 0 && now >= ctlAt) {
            ctlAt = now + T_CTL_S; q = [step("write", "wcp", [0x20, 0xEE, 0xFC])] as Array<Dictionary>; ctl = true; st = TL_READY;
        }
        // lost: the watch reconnects a paired device by itself (VERIFY); if it is not back in T_REPAIR_S, pair it again from a new scan
        if (st == TL_LOST && now - lostAt >= T_REPAIR_S) { lostAt = now; list = [] as Array<Dictionary>; a({ "k" => "unpair" }); a({ "k" => "scan", "on" => true }); }
        pump(now);
    }

    // js: ibd(L, v, now): FTMS Indoor Bike Data; v is the ByteArray of onCharacteristicChanged (elements are Numbers)
    function ibd(v, now as Number) as Void {
        var n = v.size();
        if (n < 2) { return; }
        var f = u16(v, 0), o = 2;
        if ((f & 0x0001) == 0) { o += 2; }                         // instantaneous speed
        if ((f & 0x0002) != 0) { o += 2; }                         // average speed
        if ((f & 0x0004) != 0) { if (o + 1 < n) { cad = (u16(v, o) + 1) / 2; } o += 2; } // cadence, 0.5 rpm
        if ((f & 0x0008) != 0) { o += 2; }
        if ((f & 0x0010) != 0) { o += 3; }
        if ((f & 0x0020) != 0) { o += 2; }
        if ((f & 0x0040) != 0) { if (o + 1 < n) { var p = s16(v, o); pw = p > 0 ? p : 0; } o += 2; }
        at = now;
    }
    // js: cpm(L, v, now): Cycling Power Measurement, cadence from the crank revolutions
    function cpm(v, now as Number) as Void {
        var n = v.size();
        if (n < 4) { return; }
        var f = u16(v, 0), p = s16(v, 2), o = 4;
        pw = p > 0 ? p : 0;
        if ((f & 0x01) != 0) { o += 1; }
        if ((f & 0x04) != 0) { o += 2; }
        if ((f & 0x10) != 0) { o += 6; }
        if ((f & 0x20) != 0 && o + 3 < n) {
            var revs = u16(v, o), t = u16(v, o + 2);
            if (crRevs >= 0) {
                var dr = (revs - crRevs + 65536) % 65536, dt = ((t - crT + 65536) % 65536) / 1024.0;
                if (dt > 0) { cad = rnd(dr / dt * 60.0); } else if (now - crAt > 2) { cad = 0; }
            }
            if (crRevs < 0 || revs != crRevs) { crRevs = revs; crT = t; crAt = now; }
        }
        at = now;
    }
    function u16(v, o as Number) as Number { return (v[o] as Number) + ((v[o + 1] as Number) << 8); }
    function s16(v, o as Number) as Number { var x = u16(v, o); return x >= 32768 ? x - 65536 : x; }
}

// js: newRide(now, tgt) and the functions on it: target steps, one second of riding, the stats page, the summary, the upload
class TRide {
    var st as Number = RS_RUN;
    var start as Number = 0;
    var ts as Number = 0;          // the last whole second counted
    var t as Number = 0;           // seconds ridden (not paused)
    var tgt as Number = TW_START;
    var step as Number = 5;
    var pg as Number = 0;          // 0 = ERG page, 1 = stats page
    var pwSum as Number = 0;
    var pwMax as Number = 0;
    var cadSum as Number = 0;
    var cadN as Number = 0;
    var hrSum as Number = 0;
    var hrN as Number = 0;
    var hrMax as Number = 0;
    var kj as Float = 0.0;
    var p30 as Array<Number> = [] as Array<Number>;   // a ring (js: an array that shifts)
    var p30N as Number = 0;
    var p30I as Number = 0;
    var p30Sum as Number = 0;
    var np4 as Float = 0.0;
    var npN as Number = 0;
    var bT0 as Number = 0;         // the block since the last target change
    var bSum as Number = 0;
    var bN as Number = 0;
    var dt as Number = T_SER_DT;
    var sPw as Array<Number> = [] as Array<Number>;
    var sCad as Array<Number> = [] as Array<Number>;
    var sHr as Array<Number> = [] as Array<Number>;
    var sTgt as Array<Number> = [] as Array<Number>;
    var aPw as Number = 0;
    var aCad as Number = 0;
    var aHr as Number = 0;
    var aTgt as Number = 0;
    var aN as Number = 0;

    function initialize(now as Number, w as Number) {
        start = now; ts = now; tgt = w < TW_MIN ? TW_MIN : (w > TW_MAX ? TW_MAX : w);
        for (var i = 0; i < 30; i++) { p30.add(0); }
    }
    // js: nextTarget(R, d, big): a step on, on the step grid, inside 30..1000 W
    function nextTarget(d as Number, big as Boolean) as Number {
        var k = big ? (step > TW_HOLD ? step : TW_HOLD) : step;
        var v = d > 0 ? (tgt / k) * k + k : ((tgt + k - 1) / k) * k - k;
        return v < TW_MIN ? TW_MIN : (v > TW_MAX ? TW_MAX : v);
    }
    // js: nextStep(s): 5 -> 10 -> 25 -> 5
    function nextStep() as Void { step = step == 5 ? 10 : (step == 10 ? 25 : 5); }
    function newBlock() as Void { bT0 = t; bSum = 0; bN = 0; }
    // js: rideSec(R, pw, cad, hr)
    function sec(pw as Number, cad as Number, hr as Number) as Void {
        t++; pwSum += pw; if (pw > pwMax) { pwMax = pw; } kj += pw / 1000.0; bSum += pw; bN++;
        if (cad > 0) { cadSum += cad; cadN++; }
        if (hr > 0) { hrSum += hr; hrN++; if (hr > hrMax) { hrMax = hr; } }
        p30Sum = p30Sum + pw - p30[p30I]; p30[p30I] = pw; p30I = (p30I + 1) % 30;
        if (p30N < 30) { p30N++; }
        if (p30N == 30) { var m = p30Sum / 30.0; np4 += m * m * m * m; npN++; }
        aPw += pw; aCad += cad; aHr += hr; aTgt += tgt; aN++;
        if (aN >= dt) {
            sPw.add(rnd(aPw.toFloat() / aN)); sCad.add(rnd(aCad.toFloat() / aN)); sHr.add(rnd(aHr.toFloat() / aN)); sTgt.add(rnd(aTgt.toFloat() / aN));
            aPw = 0; aCad = 0; aHr = 0; aTgt = 0; aN = 0;
            if (sPw.size() > T_SER_MAX) { sPw = halve(sPw); sCad = halve(sCad); sHr = halve(sHr); sTgt = halve(sTgt); dt *= 2; }
        }
    }
    // js: halve(R): neighbours averaged (an odd last value stays)
    function halve(x as Array<Number>) as Array<Number> {
        var y = [] as Array<Number>;
        for (var i = 0; i < x.size(); i += 2) { y.add(i + 1 < x.size() ? rnd((x[i] + x[i + 1]) / 2.0) : x[i]); }
        return y;
    }
    function avgPw() as Number { return t > 0 ? rnd(pwSum.toFloat() / t) : 0; }
    function np() as Number { return npN > 0 ? rnd(Math.pow(np4 / npN, 0.25).toFloat()) : 0; } // VERIFY: Math.pow result type (as in Fields.mc)
    // js: rideSum(R): { "t", "avgPw", "maxPw", "np", "cad", "hr", "maxHr", "kj", "start" }
    function sum() as Dictionary {
        return { "t" => t, "avgPw" => avgPw(), "maxPw" => pwMax, "np" => np(), "cad" => cadN > 0 ? rnd(cadSum.toFloat() / cadN) : 0,
                 "hr" => hrN > 0 ? rnd(hrSum.toFloat() / hrN) : 0, "maxHr" => hrMax, "kj" => rnd(kj), "start" => start };
    }
    // js: rideBody(R, sum, id, now): POST /api/watch/activity, a VirtualRide with power, cadence and the series
    function body(s as Dictionary, id as String, now as Number) as Dictionary {
        var d = now - start; if (d < 1) { d = 1; }
        return { "id" => id, "type" => "VirtualRide", "start" => start, "duration" => d, "moving" => s["t"], "dist" => 0, "climb" => 0, "hr" => s["hr"], "maxHr" => s["maxHr"],
                 "kcal" => s["kj"], "power" => s["avgPw"], "maxPower" => s["maxPw"], "np" => s["np"], "kj" => s["kj"], "cad" => s["cad"],
                 "s" => { "dt" => dt, "pw" => sPw, "cad" => sCad, "hr" => sHr, "tgt" => sTgt } };
    }
}

// 27.11.: a structured workout in ERG (js/watchtrainer.js newWk ... wkNextW, one function per function). The server sends the ride
// workouts (GET /api/watch/rides, Storage "rides") in watts: { "id", "n", "s" => [entry], "ri"?, "ro"? }; an entry is a step
// [sec, watts, wattsEnd (ramp) or null, hard (1 / 0), label] or a repeat [n, [entry ...], trim] (trim 1: the last round leaves out its last
// entry). One workout is expanded when it starts (at most WK_STEPS steps) and stepped through by the ride's own clock (TRide.t).
const WK_STEPS = 400;
const WK_ADJ = 150;       // the offsets stay inside -150 .. +150 W
const WK_FLOOR = 50;      // an offset never takes a target below 50 W
const WK_SHORT = 60;      // hard steps up to 60 s get no ramp in / out (30 / 15, sprints): the target jumps
const WK_RI = 10;         // a flat easy step ramps into a long hard one over its last 10 s, out of it over its first 5 s
const WK_RO = 5;
const WK_EASY = 100;      // after the end: free ERG at the last step's end watts, at most 100 W
const WK_FB_HARD = 370;   // the built-in 30 / 15's hard watts
const WK_FB_ID = "c_30_15_3x13";

function wkNum(v) as Boolean { return v instanceof Number || v instanceof Float || v instanceof Double || v instanceof Long; }
// js: wkDur(l): the length of entries in seconds, without expanding them (the TPICK sub line)
function wkDur(l) as Number {
    var t = 0;
    if (!(l instanceof Array)) { return 0; }
    var a = l as Array;
    for (var j = 0; j < a.size(); j++) {
        var e = a[j];
        if (!(e instanceof Array)) { continue; }
        var x = e as Array;
        if (x.size() < 2) { continue; }
        if (wkNum(x[0]) && x[1] instanceof Array) {
            var n = numOf(x[0]), sub = x[1] as Array;
            n = n < 0 ? 0 : (n > 100 ? 100 : n);
            if (n > 0) { t += n * wkDur(sub); if (x.size() > 2 && numOf(x[2]) == 1 && sub.size() > 0) { t -= wkDur([sub[sub.size() - 1]] as Array); } }
        } else if (wkNum(x[1])) { var s = numOf(x[0]); if (s >= 1 && s <= 36000) { t += s; } }
    }
    return t;
}
// js: wkFallback(ftp): the owner's 30 / 15 (js/workouts.js c_30_15_3x13), built in so it can be ridden before the first sync; the ramps
// in % of the FTP sent last (else 250 W)
function wkFallback(ftp as Number) as Dictionary {
    var f = ftp > 0 ? ftp : 250;
    return { "id" => WK_FB_ID, "n" => "30/15, 3 x 13", "ri" => 3, "ro" => 2, "s" => [
        [600, rnd(40.0 * f / 100), rnd(72.0 * f / 100), 0, "Warm-up"], [180, rnd(72.0 * f / 100), null, 0, "Warm-up"],
        [3, [[10, 420, null, 1, "Sprint"], [50, 130, null, 0, "Spin"]], 1], [170, 130, null, 0, "Spin"],
        [3, [[13, [[30, WK_FB_HARD, null, 1, "30/15"], [15, 125, null, 0, "Float"]], 1], [180, 130, null, 0, "Rest"]], 1],
        [600, rnd(50.0 * f / 100), rnd(35.0 * f / 100), 0, "Cool-down"]] } as Dictionary;
}
// js: newWk(def): null when it has no step
function newWk(def) as TWork or Null {
    if (!(def instanceof Dictionary)) { return null; }
    var W = new TWork(def as Dictionary);
    return W.dur.size() > 0 ? W : null;
}

class TWork {
    var id as String = "";
    var n as String = "";
    var dur as Array<Number> = [] as Array<Number>;
    var w as Array<Number> = [] as Array<Number>;
    var w2 as Array<Number> = [] as Array<Number>;     // -1 = flat
    var hard as Array<Boolean> = [] as Array<Boolean>;
    var lab as Array<String> = [] as Array<String>;
    var cnt as Array<String> = [] as Array<String>;    // "7/13, SET 2" inside repeats, else ""
    var ctx as Array<Array<Number>> = [] as Array<Array<Number>>;
    var tot as Number = 0;
    var i as Number = 0;          // the step now (dur.size() = over)
    var s0 as Number = 0;         // the ride second it started
    var ha as Number = 0;         // the rider's offset on the hard steps
    var ea as Number = 0;         // and on the others
    var ri as Number = WK_RI;
    var ro as Number = WK_RO;

    function initialize(def as Dictionary) {
        id = strOf(def["id"]); n = strOf(def["n"]);
        if (wkNum(def["ri"])) { ri = imax(0, numOf(def["ri"])); }
        if (wkNum(def["ro"])) { ro = imax(0, numOf(def["ro"])); }
        add(arrOf(def["s"]));
        for (var k = 0; k < dur.size(); k++) { tot += dur[k]; }
    }
    function cl(x as Number) as Number { return x < 0 ? 0 : (x > 2000 ? 2000 : x); }
    // js: wkCnt(ctx)
    function cntOf() as String {
        var k = ctx.size();
        if (k == 0) { return ""; }
        var s = (ctx[k - 1][0] + 1).toString() + "/" + ctx[k - 1][1].toString();
        if (k > 1) { s += ", SET " + (ctx[k - 2][0] + 1).toString(); }
        return s;
    }
    // js: wkAdd(X, l, ctx)
    function add(l as Array) as Void {
        for (var j = 0; j < l.size(); j++) {
            if (dur.size() >= WK_STEPS) { return; }
            var e = l[j];
            if (!(e instanceof Array)) { continue; }
            var a = e as Array;
            if (a.size() < 2) { continue; }
            if (wkNum(a[0]) && a[1] instanceof Array) {
                var nn = numOf(a[0]), sub = a[1] as Array, trim = a.size() > 2 && numOf(a[2]) == 1;
                nn = nn < 0 ? 0 : (nn > 100 ? 100 : nn);
                for (var r = 0; r < nn; r++) {
                    ctx.add([r, nn] as Array<Number>);
                    if (trim && r == nn - 1) { if (sub.size() > 1) { add(sub.slice(0, sub.size() - 1)); } } else { add(sub); }
                    ctx = ctx.slice(0, ctx.size() - 1) as Array<Array<Number>>;
                }
            } else if (wkNum(a[1])) {
                var sec = numOf(a[0]);
                if (sec < 1 || sec > 36000) { continue; }
                var x2 = a.size() > 2 && wkNum(a[2]) ? numOf(a[2]) : -1, h = a.size() > 3 ? a[3] : null;
                dur.add(sec); w.add(cl(numOf(a[1]))); w2.add(x2 < 0 ? -1 : cl(x2));
                hard.add(h instanceof Boolean ? h as Boolean : numOf(h) == 1); lab.add(a.size() > 4 ? strOf(a[4]) : ""); cnt.add(cntOf());
            }
        }
    }
    // js: wkBase(W, i, into): a ramp moves evenly from w to w2
    function base(k as Number, into as Number) as Number {
        var a = w[k], b = w2[k];
        if (b < 0) { return a; }
        var f = into <= 0 ? 0.0 : (into >= dur[k] ? 1.0 : into.toFloat() / dur[k]);
        return rnd(a + (b - a) * f);
    }
    // js: wkPlat(W, i, into): with the offset of its kind, never below 50 W
    function plat(k as Number, into as Number) as Number {
        var b = base(k, into), d = hard[k] ? ha : ea;
        if (d == 0) { return b; }
        return b + d > WK_FLOOR ? b + d : WK_FLOOR;
    }
    // js: wkAt(W, t)
    function at(t as Number) as Void { while (i < dur.size() && t >= s0 + dur[i]) { s0 += dur[i]; i++; } }
    // js: wkTarget(W, t): -1 after the end
    function target(t as Number) as Number {
        var k = i, nn = dur.size();
        if (k >= nn) { return -1; }
        var into = t - s0, lf = dur[k] - into, p = plat(k, into);
        if (hard[k] || w2[k] >= 0) { return p; }
        if (k + 1 < nn && ri > 0) { if (hard[k + 1] && dur[k + 1] > WK_SHORT && lf < ri) { var a = plat(k, dur[k]), b = plat(k + 1, 0); return rnd(a + (b - a) * (1.0 - lf.toFloat() / ri)); } }
        if (k > 0 && ro > 0) { if (hard[k - 1] && dur[k - 1] > WK_SHORT && into < ro) { var a2 = plat(k - 1, dur[k - 1]), b2 = plat(k, 0); return rnd(a2 + (b2 - a2) * (into.toFloat() / ro)); } }
        return p;
    }
    // js: wkTune(W, d): the hard offset in a hard step, else the easy one
    function tune(d as Number) as Void {
        if (i >= dur.size()) { return; }
        if (hard[i]) { var x = ha + d; ha = x < -WK_ADJ ? -WK_ADJ : (x > WK_ADJ ? WK_ADJ : x); }
        else { var y = ea + d; ea = y < -WK_ADJ ? -WK_ADJ : (y > WK_ADJ ? WK_ADJ : y); }
    }
    // js: wkAdj(W), wkLeft(W, t), wkTotLeft(W, t)
    function adj() as Number { return i < dur.size() && hard[i] ? ha : ea; }
    function left(t as Number) as Number { return i < dur.size() ? s0 + dur[i] - t : 0; }
    function totLeft(t as Number) as Number { var x = tot - t; return x > 0 ? x : 0; }
    function isHard() as Boolean { return i < dur.size() && hard[i]; }
    // js: wkEasy(W): the last step's end watts, at most WK_EASY
    function easy() as Number { var k = dur.size() - 1, b = base(k, dur[k]); b = b < WK_EASY ? b : WK_EASY; return b > TW_MIN ? b : TW_MIN; }
    // js: wkShown(W): the counter in a hard step of a repeat, else the label in capitals
    function shown() as String {
        if (i >= dur.size()) { return ""; }
        if (hard[i] && cnt[i].length() > 0) { return cnt[i]; }
        return lab[i].length() > 0 ? lab[i].toUpper() : (hard[i] ? "HARD" : "EASY");
    }
    // js: wkNextW(W): the next step's target with the offsets, -1 after the last
    function nextW() as Number { return i + 1 < dur.size() ? plat(i + 1, 0) : -1; }
}
