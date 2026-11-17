// RIDEFRAME on a Garmin watch: the watch's own segment timing and route following (19.11.). The twin of js/watchfeed.js,
// line by line: that file is tested in Node (tools/watchfeed-test.mjs) because this one cannot be compiled here. Keep both in step.
// The rules are the phone's (js/segtrack.js, js/navroute.js needSpeed) in their simplest robust form:
//   warn   within 300 m of a segment start (or under 45 s away), closing in, heading at the start or along the first leg
//   start  within 25 m of the start point      progress  nearest point on the line in a forward window of 60 points
//   finish within 25 m of the end (85 % done)  lost      more than 60 m off for more than 10 s (then 120 s cool down)
//   route  on it within 40 m, off after 8 s further away; metres along, metres off, the position in the route page's box
// Memory: flat arrays of local metres (Float), no per-second lists and no nested point arrays. At most 8 segments of 40 points
// (GET /api/watch/segments) and one route of 200 points (GET /api/watch/route).
// The outputs are the flow's segment events (Flow.segment): warn / live / end, and none (popup away).
import Toybox.Lang;
import Toybox.Math;

const FD_WARN_M = 300.0;
const FD_WARN_ETA = 45.0;
const FD_WARN_MAX = 1500.0;
const FD_GATE_M = 25.0;
const FD_LOST_M = 60.0;
const FD_LOST_S = 10;
const FD_COOL_S = 120;
const FD_WIN = 60;
const FD_OFF_M = 40.0;
const FD_OFF_S = 8;
const FD_AHEAD_M = 1000.0;
const FD_BOX_W = 0.6;    // js/watchflow.js BOX: the route page's drawing box, as parts of the screen
const FD_BOX_H = 0.38;
const FD_RE = 6371008.8d;                  // VERIFY: the d suffix makes a Double literal (Monkey C reference, literals)
const FD_RAD = 0.017453292519943295d;

function dblOf(v) as Double {
    if (v instanceof Double) { return v as Double; }
    if (v instanceof Float) { return (v as Float).toDouble(); }
    if (v instanceof Number) { return (v as Number).toDouble(); }
    if (v instanceof Long) { return (v as Long).toDouble(); }
    return 0.0d;
}
function fdHyp(dx as Float, dy as Float) as Float { return Math.sqrt(dx * dx + dy * dy).toFloat(); }
// compass bearing of a step (0 = north, 90 = east)
function fdBrg(dx as Float, dy as Float) as Float {
    var a = (Math.atan2(dx, dy) / FD_RAD).toFloat() + 360.0;
    return a >= 360.0 ? a - 360.0 : a;
}
// the turn from bearing a to bearing b, -180..180 (js: turnOf)
function fdTurn(a as Float, b as Float) as Float {
    var d = b - a;
    while (d >= 180.0) { d -= 360.0; }
    while (d < -180.0) { d += 360.0; }
    return d;
}
// js/navroute.js needSpeed: m/s over the rest to still beat ref seconds; 0 = out of reach or unknown
function needSpeed(len as Float, el as Number, ref as Number, prog as Float) as Float {
    if (!(len > 0.0) || ref <= 0) { return 0.0; }
    var left = ref - el, p = prog < 0.0 ? 0.0 : (prog > 1.0 ? 1.0 : prog), rest = len * (1.0 - p);
    if (left <= 0 || rest <= 0.0) { return 0.0; }
    var v = rest / left;
    return v > 40.0 ? 0.0 : v;
}
// the nearest point of the polyline xs / ys (points o + a .. o + b) to x, y: [index, distance, metres along]
function fdNearest(xs as Array<Float>, ys as Array<Float>, cum as Array<Float>, o as Number, a as Number, b as Number, x as Float, y as Float) as Array {
    var bi = a, bd = 1000000000.0, ba = cum[o + a];
    for (var i = a; i < b; i++) {
        var ax = xs[o + i], ay = ys[o + i], dx = xs[o + i + 1] - ax, dy = ys[o + i + 1] - ay, l = dx * dx + dy * dy;
        var u = l > 0.0 ? ((x - ax) * dx + (y - ay) * dy) / l : 0.0;
        if (u < 0.0) { u = 0.0; } else if (u > 1.0) { u = 1.0; }
        var d = fdHyp(x - ax - u * dx, y - ay - u * dy);
        if (d < bd) { bd = d; bi = i; ba = cum[o + i] + (cum[o + i + 1] - cum[o + i]) * u; }
    }
    return [bi, bd, ba];
}
// a point list [[lat, lon], ...] with at least 2 usable points
function fdPtsOk(p as Array) as Boolean {
    if (p.size() < 2) { return false; }
    for (var i = 0; i < p.size(); i++) { if (arrOf(p[i]).size() < 2) { return false; } }
    return true;
}

// degrees -> local metres around an origin (equirectangular, plenty for a few km); Double for the subtraction, Float after
class Proj {
    var lat0 = 0.0d;
    var lon0 = 0.0d;
    var k = 0.0d;
    function initialize(la as Double, lo as Double) { lat0 = la; lon0 = lo; k = Math.cos(la * FD_RAD) * FD_RAD * FD_RE; }
    function x(lo as Double) as Float { return ((lo - lon0) * k).toFloat(); }
    function y(la as Double) as Float { return ((la - lat0) * FD_RAD * FD_RE).toFloat(); }
}

// Strava segments near the watch and the one being timed (js/watchfeed.js SegFeed)
class SegFeed {
    var n as Number = 0;
    var ids as Array<String> = [] as Array<String>;
    var names as Array<String> = [] as Array<String>;
    var lens as Array<Float> = [] as Array<Float>;
    var prs as Array<Number> = [] as Array<Number>;
    var koms as Array<Number> = [] as Array<Number>;
    var first as Array<Number> = [] as Array<Number>;   // the first point of segment s in xs / ys / cum
    var cnt as Array<Number> = [] as Array<Number>;
    var xs as Array<Float> = [] as Array<Float>;
    var ys as Array<Float> = [] as Array<Float>;
    var cum as Array<Float> = [] as Array<Float>;
    var prev as Array<Float> = [] as Array<Float>;      // the last distance to each start (-1 = none yet)
    var proj as Proj or Null = null;
    var active as Number = -1;
    var idx as Number = 0;
    var along as Float = 0.0;
    var t0 as Number = 0;
    var offAt as Number = -1;
    var warned as Boolean = false;
    var coolId as Array<String> = [] as Array<String>;
    var coolAt as Array<Number> = [] as Array<Number>;

    function initialize() { clear(); }
    function clear() as Void {
        n = 0; ids = [] as Array<String>; names = [] as Array<String>; lens = [] as Array<Float>; prs = [] as Array<Number>; koms = [] as Array<Number>;
        first = [] as Array<Number>; cnt = [] as Array<Number>; xs = [] as Array<Float>; ys = [] as Array<Float>; cum = [] as Array<Float>; prev = [] as Array<Float>;
        proj = null; active = -1; idx = 0; along = 0.0; t0 = 0; offAt = -1; warned = false;
    }
    // segs = the answer's "segs": [{ id, n, len, pr, kom, p: [[lat, lon]] }], at the position lat / lon of the request.
    // Never while one is timed (the app waits for active < 0).
    function load(segs as Array, lat as Double, lon as Double) as Void {
        clear();
        var pj = new Proj(lat, lon);
        proj = pj;
        for (var i = 0; i < segs.size(); i++) {
            var s = segs[i];
            if (!(s instanceof Dictionary)) { continue; }
            var d = s as Dictionary, p = arrOf(d["p"]);
            if (!fdPtsOk(p)) { continue; }
            var idv = d["id"], nm = strOf(d["n"]);
            ids.add(idv == null ? "" : idv.toString()); names.add(nm.length() > 0 ? nm : "Segment");
            prs.add(numOf(d["pr"])); koms.add(numOf(d["kom"])); first.add(xs.size()); cnt.add(p.size()); prev.add(-1.0);
            var c = 0.0;
            for (var j = 0; j < p.size(); j++) {
                var q = p[j] as Array, x = pj.x(dblOf(q[1])), y = pj.y(dblOf(q[0]));
                if (j > 0) { c += fdHyp(x - xs[xs.size() - 1], y - ys[ys.size() - 1]); }
                xs.add(x); ys.add(y); cum.add(c);
            }
            var L = fltOf(d["len"]);
            lens.add(L > 0.0 ? L : c);
            n++;
        }
    }
    function coolIdx(id as String) as Number {
        for (var i = 0; i < coolId.size(); i++) { if (id.equals(coolId[i])) { return i; } }
        return -1;
    }
    function cooling(s as Number, now as Number) as Boolean { var i = coolIdx(ids[s]); return i >= 0 && now - coolAt[i] < FD_COOL_S; }
    function cool(s as Number, now as Number) as Void {
        var i = coolIdx(ids[s]);
        if (i >= 0) { coolAt[i] = now; return; }
        coolId.add(ids[s]); coolAt.add(now);
        if (coolId.size() > 20) { coolId = coolId.slice(1, coolId.size()) as Array<String>; coolAt = coolAt.slice(1, coolAt.size()) as Array<Number>; }
    }
    // the reference: the PR, else the KOM; [seconds, "PR" | "KOM" | ""]
    function ref(s as Number) as Array {
        if (prs[s] > 0) { return [prs[s], "PR"]; }
        if (koms[s] > 0) { return [koms[s], "KOM"]; }
        return [0, ""];
    }
    // one GPS point a second: heading in degrees (-1 = unknown), v in m/s, now in s -> a segment event or null
    function step(lat as Double, lon as Double, heading as Float, v as Float, now as Number) as Dictionary or Null {
        var pj = proj;
        if (pj == null || n == 0) { return null; }
        var x = pj.x(lon), y = pj.y(lat);
        if (active >= 0) {
            var s = active, o = first[s], c = cnt[s], last = imin(c - 1, idx + FD_WIN), len = cum[o + c - 1];
            var h = fdNearest(xs, ys, cum, o, idx, last, x, y), bd = h[1] as Float;
            if (bd > FD_LOST_M) {
                if (offAt < 0) { offAt = now; }
                if (now - offAt > FD_LOST_S) { active = -1; cool(s, now); return { "k" => "none", "lost" => true } as Dictionary; }
            } else { offAt = -1; idx = h[0] as Number; along = h[2] as Float; }
            var prog = len > 0.0 ? along / len : 0.0;
            if (prog > 1.0) { prog = 1.0; }
            var el = now - t0, rf = ref(s), rv = rf[0] as Number, lab = rf[1] as String, L = lens[s];
            if (prog > 0.85 && fdHyp(x - xs[o + c - 1], y - ys[o + c - 1]) < FD_GATE_M) {
                active = -1; cool(s, now);
                return { "k" => "end", "name" => names[s], "len" => L, "time" => el, "delta" => rv > 0 ? el - rv : 0, "pr" => prs[s] > 0 && el < prs[s], "ref" => lab } as Dictionary;
            }
            return { "k" => "live", "name" => names[s], "len" => L, "done" => prog * L, "delta" => rv > 0 ? rnd(el - rv * prog) : 0,
                     "need" => needSpeed(L, el, rv, prog), "time" => el, "ref" => lab } as Dictionary;
        }
        var best = -1, bd2 = 0.0, vv = v > 0.5 ? v : 0.5;
        for (var s = 0; s < n; s++) {
            if (cooling(s, now)) { continue; }
            var o = first[s], sx = xs[o], sy = ys[o], d = fdHyp(sx - x, sy - y), pv = prev[s];
            prev[s] = d;
            if (d < FD_GATE_M) {
                active = s; t0 = now; idx = 0; along = 0.0; offAt = -1; warned = false;
                var rf = ref(s);
                return { "k" => "live", "name" => names[s], "len" => lens[s], "done" => 0.0, "delta" => 0, "need" => needSpeed(lens[s], 0, rf[0] as Number, 0.0), "time" => 0, "ref" => rf[1] } as Dictionary;
            }
            var eta = d / vv;
            if (d > FD_WARN_MAX || !(d <= FD_WARN_M || eta < FD_WARN_ETA) || pv < 0.0 || d >= pv) { continue; } // near, and closing in
            var k = imin(cnt[s] - 1, 3), leg = fdBrg(xs[o + k] - sx, ys[o + k] - sy), at = fdBrg(sx - x, sy - y);
            if (d > 30.0 && (heading < 0.0 || (fdTurn(heading, at).abs() > 60.0 && fdTurn(heading, leg).abs() > 60.0))) { continue; }
            if (best < 0 || d < bd2) { best = s; bd2 = d; }
        }
        if (best >= 0) { warned = true; return { "k" => "warn", "name" => names[best], "len" => lens[best], "eta" => rnd(bd2 / vv), "pr" => prs[best] } as Dictionary; }
        if (warned) { warned = false; return { "k" => "none" } as Dictionary; }
        return null;
    }
}

// a route from GET /api/watch/route ({ id, name, dist, p: [[lat, lon]], turns: [[at, "L" | "R" | "U"]] }) followed by GPS
// (js/watchfeed.js RouteTrack). Build it only for fdPtsOk(p).
class RouteTrack {
    var proj as Proj;
    var xs as Array<Float> = [] as Array<Float>;
    var ys as Array<Float> = [] as Array<Float>;
    var cum as Array<Float> = [] as Array<Float>;
    var len as Float = 0.0;
    var idx as Number = 0;
    var along as Float = 0.0;
    var started as Boolean = false;
    var offAt as Number = -1;
    var off as Number = 0;          // metres off the route, 0 = on it (or not off long enough)
    var offD as Float = 0.0;
    var u as Float = 0.5;           // the last position in the box (0..1 of its width / height)
    var v as Float = 0.5;
    // the route page's box (js/watchflow.js routeFace): one scale, north up
    var sc as Float = 1.0;
    var ox as Float = 0.0;
    var oy as Float = 0.0;
    var x0 as Float = 0.0;
    var y1 as Float = 0.0;

    function initialize(p as Array) {
        var q0 = p[0] as Array;
        proj = new Proj(dblOf(q0[0]), dblOf(q0[1]));
        var c = 0.0, mx0 = 1000000000.0, mx1 = -1000000000.0, my0 = 1000000000.0, my1 = -1000000000.0;
        for (var i = 0; i < p.size(); i++) {
            var q = p[i] as Array, x = proj.x(dblOf(q[1])), y = proj.y(dblOf(q[0]));
            if (i > 0) { c += fdHyp(x - xs[i - 1], y - ys[i - 1]); }
            xs.add(x); ys.add(y); cum.add(c);
            if (x < mx0) { mx0 = x; } if (x > mx1) { mx1 = x; } if (y < my0) { my0 = y; } if (y > my1) { my1 = y; }
        }
        len = c;
        var w = mx1 - mx0, h = my1 - my0;
        if (w < 1.0) { w = 1.0; } if (h < 1.0) { h = 1.0; }
        var a = FD_BOX_W / w, b = FD_BOX_H / h;
        sc = a < b ? a : b;
        ox = (FD_BOX_W - (mx1 - mx0) * sc) / 2.0; oy = (FD_BOX_H - (my1 - my0) * sc) / 2.0; x0 = mx0; y1 = my1;
    }
    function uOf(x as Float) as Float { return (ox + (x - x0) * sc) / FD_BOX_W; }
    function vOf(y as Float) as Float { return (oy + (y1 - y) * sc) / FD_BOX_H; }
    // the flow's route (Flow.setRoute; js/watchflow.js routeFace with flat arrays): { name, len, u, v, ta (turn at, m), td (L | R | U) }
    function face(r as Dictionary) as Dictionary {
        var pu = [] as Array<Float>, pv = [] as Array<Float>, ta = [] as Array<Float>, td = [] as Array<String>;
        for (var i = 0; i < xs.size(); i++) { pu.add(uOf(xs[i])); pv.add(vOf(ys[i])); }
        var t = arrOf(r["turns"]);
        for (var i = 0; i < t.size(); i++) {
            var x = arrOf(t[i]);
            if (x.size() < 2 || fltOf(x[0]) <= 0.0) { continue; }
            ta.add(fltOf(x[0])); td.add(strOf(x[1]));
        }
        var dist = fltOf(r["dist"]), nm = strOf(r["name"]);
        return { "id" => strOf(r["id"]), "name" => nm.length() > 0 ? nm : "Route", "len" => dist > 0.0 ? dist : len, "u" => pu, "v" => pv, "ta" => ta, "td" => td } as Dictionary;
    }
    // one GPS point: along, off, u, v are updated
    function step(lat as Double, lon as Double, now as Number) as Void {
        var x = proj.x(lon), y = proj.y(lat), n = xs.size(), found = false, hi = 0, ha = 0.0;
        if (started) { // ahead first (out and back, a route crossing itself), then the whole route
            var b = idx;
            while (b < n - 1 && cum[b] <= along + FD_AHEAD_M) { b++; }
            var h = fdNearest(xs, ys, cum, 0, imax(0, idx - 3), b, x, y);
            if ((h[1] as Float) <= FD_OFF_M) { found = true; hi = h[0] as Number; ha = h[2] as Float; }
        }
        if (!found) {
            var h2 = fdNearest(xs, ys, cum, 0, 0, n - 1, x, y);
            if ((h2[1] as Float) <= FD_OFF_M) { found = true; hi = h2[0] as Number; ha = h2[2] as Float; } else { offD = h2[1] as Float; }
        }
        if (found) { idx = hi; along = ha; started = true; offAt = -1; off = 0; }
        else {
            if (offAt < 0) { offAt = now; }
            if (now - offAt > FD_OFF_S) { off = imax(1, rnd(offD)); }
        }
        u = uOf(x); v = vOf(y);
    }
}
