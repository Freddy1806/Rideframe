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
// 27.11.4 (js BEST_N, IV_SKIP, HRR_S, REC_NONE): the summary's numbers, kept second by second (a 4 h ride is 14400 seconds; nothing is scanned
// at the end): the best 30 s / 1 min / 5 min from a ring of the last T_BEST_N seconds; an interval's first IV_SKIP s are not counted (the
// trainer ramps the watts; intervals of at most 2 x IV_SKIP s count every second); the recovery is the heart rate's drop in HRR_S s
const T_BEST_N = 300;
const IV_SKIP = 5;
const HRR_S = 60;
const REC_NONE = -999;
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
    var cadAt as Number = -1000000; // 28.11.: the last second a cadence value came (hasCad), from Indoor Bike Data (icAt: one above 0) or the crank (ccAt)
    var icAt as Number = -1000000;
    var ccAt as Number = -1000000;
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
    // js: hasCad(L, now) (28.11.): a cadence came in the last T_DATA_S s; without one the screens show "--"
    function hasCad(now as Number) as Boolean { return now - cadAt <= T_DATA_S; }
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
        // 28.11.: an FTMS trainer with Cycling Power: its measurement too (after control), for the crank revolutions (a KICKR may send no
        // cadence, or 0, in Indoor Bike Data); a failed subscription is no data from it
        if (mode == TM_FTMS) {
            q = [step("cccd", "ibd", [1, 0]), step("cccd", "fcp", [2, 0]), step("write", "fcp", [0x00]), step("write", "fcp", [0x07])] as Array<Dictionary>;
            if (e["cps"] == true) { q.add(step("cccd", "cpm", [1, 0])); }
        }
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
        if ((f & 0x0004) != 0) { // cadence, 0.5 rpm; a 0 does not hide the crank's
            if (o + 1 < n) { var c = (u16(v, o) + 1) / 2; if (c > 0 || now - ccAt > T_DATA_S) { cad = c; } if (c > 0) { icAt = now; } cadAt = now; }
            o += 2;
        }
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
        if (mode != TM_FTMS) { pw = p > 0 ? p : 0; } // 28.11.: an FTMS trainer's power comes from Indoor Bike Data, here only its cadence
        if ((f & 0x01) != 0) { o += 1; }
        if ((f & 0x04) != 0) { o += 2; }
        if ((f & 0x10) != 0) { o += 6; }
        if ((f & 0x20) != 0 && o + 3 < n) { // crank revolutions (uint16, wrap) and the last crank event (uint16, 1/1024 s, wrap)
            var revs = u16(v, o), t = u16(v, o + 2), useIt = mode != TM_FTMS || now - icAt > T_DATA_S;
            if (crRevs >= 0) {
                var dr = (revs - crRevs + 65536) % 65536, dt = ((t - crT + 65536) % 65536) / 1024.0;
                ccAt = now; if (useIt) { cadAt = now; }
                if (dt > 0) { if (useIt) { cad = rnd(dr / dt * 60.0); } } else if (now - crAt > 2 && useIt) { cad = 0; }
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
    var pg as Number = 0;          // the page on screen, counted in Flow.tPages (28.11.: target, workout, body, stats)
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
    // 27.11.4: the best powers (a ring of T_BEST_N seconds, three running sums) and the seconds per heart rate zone (zb: the profile's zones)
    var bw as Array<Number> = [] as Array<Number>;
    var bwI as Number = 0;
    var b30 as Number = 0;
    var b60 as Number = 0;
    var b300 as Number = 0;
    var best30 as Number = 0;
    var best60 as Number = 0;
    var best300 as Number = 0;
    var zb as Array<Number> or Null = null;
    var zs as Array<Number> = [0, 0, 0, 0, 0] as Array<Number>;

    function initialize(now as Number, w as Number) {
        start = now; ts = now; tgt = w < TW_MIN ? TW_MIN : (w > TW_MAX ? TW_MAX : w);
        for (var i = 0; i < 30; i++) { p30.add(0); }
        for (var i = 0; i < T_BEST_N; i++) { bw.add(0); }
    }
    // js: nextTarget(R, d, big): a step on, on the step grid, inside 30..1000 W
    function nextTarget(d as Number, big as Boolean) as Number { return nextBy(tgt, d, big ? (step > TW_HOLD ? step : TW_HOLD) : step); }
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
        // 27.11.4: the best 30 s / 1 min / 5 min: the values 30, 60, 300 s ago leave the sums (the ring starts as zeros, so no count is needed)
        var o30 = bw[(bwI + 270) % T_BEST_N], o60 = bw[(bwI + 240) % T_BEST_N], o300 = bw[bwI];
        bw[bwI] = pw; bwI = (bwI + 1) % T_BEST_N; b30 += pw - o30; b60 += pw - o60; b300 += pw - o300;
        if (t >= 30 && b30 > best30) { best30 = b30; }
        if (t >= 60 && b60 > best60) { best60 = b60; }
        if (t >= 300 && b300 > best300) { best300 = b300; }
        var z = zb;
        if (hr > 0 && z != null) { var q = hr > z[4] ? 4 : (hr > z[3] ? 3 : (hr > z[2] ? 2 : (hr > z[1] ? 1 : (hr >= z[0] ? 0 : -1)))); if (q >= 0) { zs[q] = zs[q] + 1; } }
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
                 "hr" => hrN > 0 ? rnd(hrSum.toFloat() / hrN) : 0, "maxHr" => hrMax, "kj" => rnd(kj), "start" => start,
                 "b30" => t >= 30 ? rnd(best30 / 30.0) : 0, "b60" => t >= 60 ? rnd(best60 / 60.0) : 0, "b300" => t >= 300 ? rnd(best300 / 300.0) : 0 };
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
const WK_WORK = 1;        // 28.11.: the step kinds (js WK_WORK, WK_WARM, WK_COOL; 0 = recovery)
const WK_WARM = 2;
const WK_COOL = 3;

// js: nextBy(w, d, k) (27.11.5): w a step of k W on (d > 0) or back, on the grid of k, inside TW_MIN..TW_MAX
function nextBy(w as Number, d as Number, k as Number) as Number {
    var v = d > 0 ? (w / k) * k + k : ((w + k - 1) / k) * k - k;
    return v < TW_MIN ? TW_MIN : (v > TW_MAX ? TW_MAX : v);
}
function wkNum(v) as Boolean { return v instanceof Number || v instanceof Float || v instanceof Double || v instanceof Long; }
// js: hrZones(z) (27.11.4): the profile's heart rate zones (UserProfile.getHeartRateZones: min zone 1, max zone 1 ... max zone 5) when they
// are 6 rising numbers 30..250, else null (then the summary shows no zones: nothing guessed)
function hrZones(z) as Array<Number> or Null {
    if (!(z instanceof Array)) { return null; }
    var a = z as Array, r = [] as Array<Number>;
    if (a.size() < 6) { return null; }
    for (var i = 0; i < 6; i++) {
        if (!wkNum(a[i])) { return null; }
        var v = rnd(fltOf(a[i]));
        if (v < 30 || v > 250 || (i > 0 && v <= r[i - 1])) { return null; }
        r.add(v);
    }
    return r;
}
// js: rideReport(o, R, W) (27.11.4): the summary (Flow.tsum) = R.sum() + "name", with the workout W (null = a free ride): "wn", "wt" (s),
// "wd" (s ridden of it), "ivN" / "ivD" (intervals in it / done), "uS" (sets), "uN" / "uD" (units / done), per interval "iw", "it", "iu", per
// unit "uw", "ut" (average watts / target without the ramp seconds, 0 = not ridden), "uhp" (peak heart rate), "urec" (the drop, REC_NONE
// none); "zs" (seconds per zone, only with zones), "hs" (the heart rate series of the upload). 27.11.5: "ivS" / "ivW" the intervals' length
// (s) and target sent where all have the same (else 0), per unit "udn" / "ucn" its intervals done / in it (fewer done: cut short)
function tReport(o as Dictionary, R as TRide, W as TWork or Null) as Void {
    if (R.zb != null) { o["zs"] = R.zs; }
    o["hs"] = R.sHr;
    if (W == null) { o["wn"] = ""; o["wt"] = 0; return; }
    var nu = W.uCnt.size(), ud = 0, uw = [] as Array<Number>, ut = [] as Array<Number>;
    for (var u = 0; u < nu; u++) {
        if (W.uDn[u] >= W.uCnt[u]) { ud++; }
        var n = W.uPn[u];
        uw.add(n > 0 ? rnd(W.uPw[u].toFloat() / n) : 0); ut.add(n > 0 ? rnd(W.uTg[u].toFloat() / n) : 0);
    }
    o["wn"] = W.n; o["wt"] = W.tot; o["wd"] = R.t < W.tot ? R.t : W.tot; o["ivN"] = W.ivN; o["ivD"] = W.ivD; o["uS"] = W.uS; o["uN"] = nu; o["uD"] = ud;
    o["iw"] = W.iw; o["it"] = W.it; o["iu"] = W.iu; o["uw"] = uw; o["ut"] = ut; o["uhp"] = W.uHp; o["urec"] = W.uRec;
    o["udn"] = W.uDn; o["ucn"] = W.uCnt;
    var d = 0, tw = W.it.size() > 0 ? W.it[0] : 0;
    for (var k = 0; k < W.dur.size(); k++) {
        if (W.un[k] < 0) { continue; }
        if (d == 0) { d = W.dur[k]; } else if (W.dur[k] != d) { d = -1; break; }
    }
    for (var k1 = 1; k1 < W.it.size(); k1++) { if (W.it[k1] != tw) { tw = 0; break; } }
    o["ivS"] = d < 0 ? 0 : d; o["ivW"] = tw;
}
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
// in % of the FTP sent last (else 250 W). 28.11.: the new warm-up (ramp 8 min 40 -> 75 %, build 3 min 75 -> 95 %, 2 min 130 W, openers
// 20 s at 300 / 335 / 370 W with 70 s at 130 W between, 190 s 130 W; = js/workouts.js after the coach review)
function wkFallback(ftp as Number) as Dictionary {
    var f = ftp > 0 ? ftp : 250;
    return { "id" => WK_FB_ID, "n" => "30/15, 3 x 13", "c" => "v", "ri" => 3, "ro" => 2, "s" => [
        [480, rnd(40.0 * f / 100), rnd(75.0 * f / 100), 0, "Warm-up"], [180, rnd(75.0 * f / 100), rnd(95.0 * f / 100), 0, "Build"], [120, 130, null, 0, "Spin"],
        [20, 300, null, 1, "Opener"], [70, 130, null, 0, "Spin"], [20, 335, null, 1, "Opener"], [70, 130, null, 0, "Spin"], [20, WK_FB_HARD, null, 1, "Opener"], [190, 130, null, 0, "Spin"],
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
    var cnt as Array<String> = [] as Array<String>;    // "7/13, SET 2/3" inside repeats, else ""
    var kd as Array<Number> = [] as Array<Number>;     // 28.11.: the step's kind (its colour): WK_WORK, WK_WARM, WK_COOL, else 0 (recovery)
    var ctx as Array<Array<Number>> = [] as Array<Array<Number>>;
    var tot as Number = 0;
    var i as Number = 0;          // the step now (dur.size() = over)
    var s0 as Number = 0;         // the ride second it started
    var ha as Number = 0;         // the rider's offset on the hard steps
    var ea as Number = 0;         // and on the others
    var ri as Number = WK_RI;
    var ro as Number = WK_RO;
    // 27.11.4 (js wkUnits ... wkClose): the intervals for the summary. sk: the set of a step (the repeat round around its own repeat, -1
    // none; rc numbers the rounds), un: its unit (-1: no interval), per unit (uS: sets, else one interval each) its last step, the easy
    // seconds after it, its intervals, the sums without the ramp seconds, the peak heart rate, the recovery, the intervals done; per
    // interval ridden its average watts / target / unit; c*: the interval under way; rec*: a recovery under way
    var sk as Array<Number> = [] as Array<Number>;
    var rc as Number = 0;
    var un as Array<Number> = [] as Array<Number>;
    var uS as Boolean = false;
    var uEnd as Array<Number> = [] as Array<Number>;
    var uGap as Array<Number> = [] as Array<Number>;
    var uCnt as Array<Number> = [] as Array<Number>;
    var uPw as Array<Number> = [] as Array<Number>;
    var uPn as Array<Number> = [] as Array<Number>;
    var uTg as Array<Number> = [] as Array<Number>;
    var uHp as Array<Number> = [] as Array<Number>;
    var uRec as Array<Number> = [] as Array<Number>;
    var uDn as Array<Number> = [] as Array<Number>;
    var ivN as Number = 0;
    var ivD as Number = 0;
    var iw as Array<Number> = [] as Array<Number>;
    var it as Array<Number> = [] as Array<Number>;
    var iu as Array<Number> = [] as Array<Number>;
    var cPw as Number = 0;
    var cPn as Number = 0;
    var cTg as Number = 0;
    var cK as Number = -1;
    var recU as Number = -1;
    var recT as Number = 0;
    var recH as Number = 0;

    function initialize(def as Dictionary) {
        id = strOf(def["id"]); n = strOf(def["n"]);
        if (wkNum(def["ri"])) { ri = imax(0, numOf(def["ri"])); }
        if (wkNum(def["ro"])) { ro = imax(0, numOf(def["ro"])); }
        add(arrOf(def["s"]));
        for (var k = 0; k < dur.size(); k++) { tot += dur[k]; }
        units();
    }
    function cl(x as Number) as Number { return x < 0 ? 0 : (x > 2000 ? 2000 : x); }
    // js: wkCnt(ctx)
    function cntOf() as String {
        var k = ctx.size();
        if (k == 0) { return ""; }
        var s = (ctx[k - 1][0] + 1).toString() + "/" + ctx[k - 1][1].toString();
        if (k > 1) { s += ", SET " + (ctx[k - 2][0] + 1).toString() + "/" + ctx[k - 2][1].toString(); }
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
                    ctx.add([r, nn, rc] as Array<Number>); rc++;
                    if (trim && r == nn - 1) { if (sub.size() > 1) { add(sub.slice(0, sub.size() - 1)); } } else { add(sub); }
                    ctx = ctx.slice(0, ctx.size() - 1) as Array<Array<Number>>;
                }
            } else if (wkNum(a[1])) {
                var sec = numOf(a[0]);
                if (sec < 1 || sec > 36000) { continue; }
                var x2 = a.size() > 2 && wkNum(a[2]) ? numOf(a[2]) : -1, h = a.size() > 3 ? a[3] : null;
                dur.add(sec); w.add(cl(numOf(a[1]))); w2.add(x2 < 0 ? -1 : cl(x2));
                hard.add(h instanceof Boolean ? h as Boolean : numOf(h) == 1); lab.add(a.size() > 4 ? strOf(a[4]) : ""); cnt.add(cntOf()); kd.add(kindOf(dur.size() - 1));
                sk.add(ctx.size() >= 2 ? ctx[ctx.size() - 2][2] : -1); // 27.11.4: the set it belongs to
            }
        }
    }
    // js: wkKind(X, i) (28.11.): the builder's step types: work (hard), warm-up (label or a ramp up), cool-down (label or a ramp down), else recovery
    function kindOf(k as Number) as Number {
        var l = lab[k].toLower();
        if (hard[k]) { return WK_WORK; }
        if (l.find("warm") != null) { return WK_WARM; }
        if (l.find("cool") != null) { return WK_COOL; }
        if (w2[k] >= 0) { return w2[k] > w[k] ? WK_WARM : WK_COOL; }
        return 0;
    }
    // js: wkRamp(W) (28.11.): a ramp step now: [start, end] watts with the offset, else null
    function ramp() as Array<Number> or Null { return i < dur.size() && w2[i] >= 0 ? [plat(i, 0), plat(i, dur[i])] as Array<Number> : null; }
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

    // js: wkPrep(l) (27.11.4): a warm-up, opener or spin (js/ivhistory.js isPrep): a hard step, but no interval
    function isPrep(k as Number) as Boolean {
        var l = lab[k].toLower(), pf = ["warm", "opener", "spin"] as Array<String>;
        for (var j = 0; j < pf.size(); j++) { var p = l.find(pf[j]); if (p != null && p == 0) { return true; } }
        return false;
    }
    // js: wkUnits(W): the intervals (hard, at least 5 s, no preparation) and their units: sets where the intervals sit in two or more
    // rounds of an outer repeat, else one interval each
    function units() as Void {
        var nn = dur.size(), keys = [] as Array<Number>;
        for (var k = 0; k < nn; k++) {
            var on = hard[k] && dur[k] >= 5 && !isPrep(k);
            un.add(on ? 0 : -1);
            if (on) { ivN++; if (sk[k] >= 0 && keys.indexOf(sk[k]) < 0) { keys.add(sk[k]); } }
        }
        uS = keys.size() >= 2;
        var u = -1, last = -2;
        for (var k = 0; k < nn; k++) {
            if (un[k] < 0) { continue; }
            var key = uS ? sk[k] : -1;
            if (u < 0 || key < 0 || key != last) { u++; uEnd.add(0); uGap.add(0); uCnt.add(0); uPw.add(0); uPn.add(0); uTg.add(0); uHp.add(0); uRec.add(REC_NONE); uDn.add(0); }
            last = key; un[k] = u; uEnd[u] = k; uCnt[u] = uCnt[u] + 1;
        }
        for (var q = 0; q <= u; q++) {
            var g = 0, j = uEnd[q] + 1;
            while (j < nn && !hard[j]) { g += dur[j]; j++; }
            uGap[q] = j >= nn ? 99999 : g;
        }
    }
    // js: wkRec(W, t, pw, hr, tg): one second of the ride (t = R.t after it was counted, before at() moves on: i is the step of this
    // second), pw / hr ridden, tg the target
    function rec(t as Number, pw as Number, hr as Number, tg as Number) as Void {
        var u0 = recU;
        if (u0 >= 0) {
            if (hr > uHp[u0]) { uHp[u0] = hr; }
            if (t >= recT) { uRec[u0] = hr > 0 && recH > 0 ? recH - hr : REC_NONE; recU = -1; }
        }
        var k = i;
        if (k >= dur.size()) { return; }
        var u = un[k];
        if (u < 0) { return; }
        var into = t - s0;
        if (hr > uHp[u]) { uHp[u] = hr; }
        if (dur[k] <= 2 * IV_SKIP || into > IV_SKIP) { cPw += pw; cPn++; cTg += tg; uPw[u] = uPw[u] + pw; uPn[u] = uPn[u] + 1; uTg[u] = uTg[u] + tg; }
        cK = k;
        if (into >= dur[k]) { // its last second
            flush(); ivD++; uDn[u] = uDn[u] + 1;
            if (k == uEnd[u] && uGap[u] >= HRR_S) { recU = u; recH = hr; recT = t + HRR_S; }
        }
    }
    // js: wkFlush(W): the interval under way into the lists; nothing when no second counted
    function flush() as Void {
        if (cK >= 0 && cPn > 0) { iw.add(rnd(cPw.toFloat() / cPn)); it.add(rnd(cTg.toFloat() / cPn)); iu.add(un[cK]); }
        cPw = 0; cPn = 0; cTg = 0; cK = -1;
    }
    // js: wkClose(W): the ride ends: an interval under way counts in part, a recovery not yet HRR_S s old is none
    function close() as Void { flush(); recU = -1; }
}
