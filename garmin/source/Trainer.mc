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
