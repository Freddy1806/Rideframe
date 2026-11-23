// RIDEFRAME on a Garmin watch: the data fields of run / ride / other (js/watchfields.js FIELDS), the built-in config
// (= compact(defaults()) in js/watchfields.js, used until GET /api/watch/config answered once) and the text of a field
// during a recording (js/watchfields.js fieldText). Keep in step with the JS.
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;

module Fields {
    // js: FIELDS[sp]: the field ids each sport can show
    function ids(sp as String) as Array<String> {
        if (sp.equals("run")) { return ["pace", "lapPace", "avgPace", "dist", "lapDist", "time", "lapTime", "hr", "hrZone", "cadence", "kcal", "clock", "climb"] as Array<String>; }
        if (sp.equals("ride")) { return ["power3s", "power", "avgPower", "speed", "avgSpeed", "dist", "time", "hr", "hrZone", "cadence", "climb", "kcal", "clock", "np"] as Array<String>; }
        return ["hr", "hrZone", "time", "clock", "kcal", "dist"] as Array<String>;
    }
    function known(sp as String, id as String) as Boolean { return ids(sp).indexOf(id) >= 0; }
    // js: FIELDS[sp][id].l
    function label(id as String) as String {
        if (id.equals("pace")) { return "Pace"; }
        if (id.equals("lapPace")) { return "Lap pace"; }
        if (id.equals("avgPace")) { return "Avg pace"; }
        if (id.equals("dist")) { return "Distance"; }
        if (id.equals("lapDist")) { return "Lap dist"; }
        if (id.equals("time")) { return "Time"; }
        if (id.equals("lapTime")) { return "Lap time"; }
        if (id.equals("hr")) { return "Heart rate"; }
        if (id.equals("hrZone")) { return "HR zone"; }
        if (id.equals("cadence")) { return "Cadence"; }
        if (id.equals("kcal")) { return "Calories"; }
        if (id.equals("clock")) { return "Clock"; }
        if (id.equals("climb")) { return "Climb"; }
        if (id.equals("power3s")) { return "Power 3s"; }
        if (id.equals("power")) { return "Power"; }
        if (id.equals("avgPower")) { return "Avg power"; }
        if (id.equals("speed")) { return "Speed"; }
        if (id.equals("avgSpeed")) { return "Avg speed"; }
        if (id.equals("np")) { return "NP"; }
        return id;
    }
    // js: FIELDS[sp][id].u
    function unit(sp as String, id as String) as String {
        if (id.equals("pace") || id.equals("lapPace") || id.equals("avgPace")) { return "/km"; }
        if (id.equals("dist") || id.equals("lapDist")) { return "km"; }
        if (id.equals("hr")) { return "bpm"; }
        if (id.equals("cadence")) { return sp.equals("ride") ? "rpm" : "spm"; }
        if (id.equals("kcal")) { return "kcal"; }
        if (id.equals("climb")) { return "m"; }
        if (id.equals("power3s") || id.equals("power") || id.equals("avgPower") || id.equals("np")) { return "W"; }
        if (id.equals("speed") || id.equals("avgSpeed")) { return "km/h"; }
        return "";
    }

    // js: compact(defaults()) - must stay identical (tools/watchflow-test.mjs checks the JS side)
    function defaultCfg() as Dictionary {
        return {
            "v" => 1,
            "run" => { "p" => [["pace", "dist", "time", "hr"], ["lapPace", "lapDist", "avgPace", "hrZone"]], "map" => 1, "seg" => 1, "lap" => 1, "pause" => 0, "vib" => 1 },
            "ride" => { "p" => [["power3s", "speed", "hr", "time"], ["dist", "climb", "avgPower", "cadence"]], "map" => 1, "seg" => 1, "lap" => 1, "pause" => 1, "vib" => 1 },
            "other" => { "p" => [["hr", "time", "clock", "kcal"]] },
            "more" => [["Walk", "Walk"], ["Hike", "Hike"], ["Yoga", "Yoga"], ["Workout", "Workout"]],
            "w" => []
        } as Dictionary;
    }

    function two(n as Number) as String { return n.format("%02d"); }
    // js: hms(s)
    function hms(s as Number) as String {
        if (s < 0) { s = 0; }
        var h = s / 3600, m = (s % 3600) / 60;
        return (h > 0 ? h.toString() + ":" + two(m) : m.toString()) + ":" + two(s % 60);
    }
    // js: pace(sec, m): min:s per km over m metres in sec seconds
    function pace(sec as Float, m as Float) as String {
        if (!(m > 5.0) || !(sec > 0.0) || sec / m * 1000.0 > 3600.0) { return "--:--"; }
        var x = rnd(sec / m * 1000.0);
        return (x / 60).toString() + ":" + two(x % 60);
    }
    // js: km(m)
    function km(m as Float) as String { return (m / 1000.0).format(m < 100000.0 ? "%.2f" : "%.1f"); }
    // js: zoneOf(hr, max): below 60 % of max zone 1 ... above 90 % zone 5
    function zoneOf(hr as Number, max as Number) as Number {
        if (hr <= 0) { return 0; }
        var z = 1, f = [0.6, 0.7, 0.8, 0.9] as Array<Float>;
        for (var i = 0; i < f.size(); i++) { if (hr >= f[i] * max) { z++; } }
        return z;
    }
    // 1234 -> "1,234" (js: the kcal field)
    function thousands(n as Number) as String {
        var s = n.toString();
        if (n < 1000) { return s; }
        var r = "", k = s.length();
        for (var i = 0; i < k; i++) {
            if (i > 0 && (k - i) % 3 == 0) { r += ","; }
            r += s.substring(i, i + 1) as String;
        }
        return r;
    }

    // js: fieldText(id, R, now): the text of field id (the unit comes from unit())
    function text(id as String, R as Rec) as String {
        var lapT = R.t - R.lapT0, lapD = R.d - R.lapD0;
        if (id.equals("pace")) { return R.v > 0.5 ? pace(1000.0 / R.v, 1000.0) : "--:--"; }
        if (id.equals("lapPace")) { return pace(lapT.toFloat(), lapD); }
        if (id.equals("avgPace")) { return pace(R.t.toFloat(), R.d); }
        if (id.equals("dist")) { return km(R.d); }
        if (id.equals("lapDist")) { return km(lapD); }
        if (id.equals("time")) { return hms(R.t); }
        if (id.equals("lapTime")) { return hms(lapT); }
        if (id.equals("hr")) { return R.hr > 0 ? R.hr.toString() : "--"; }
        if (id.equals("hrZone")) { return R.hr > 0 ? "Z" + zoneOf(R.hr, R.hrMax).toString() : "--"; }
        if (id.equals("cadence")) { return R.cad > 0 ? R.cad.toString() : "--"; }
        if (id.equals("kcal")) { return thousands(rnd(R.kcal)); }
        if (id.equals("clock")) { var c = System.getClockTime(); return c.hour.toString() + ":" + two(c.min); }
        if (id.equals("climb")) { return rnd(R.gain).toString(); }
        if (id.equals("power3s")) {
            if (R.p3N == 0) { return "--"; }
            var a = 0;
            for (var i = 0; i < R.p3N; i++) { a += R.p3[i]; }
            return rnd(a.toFloat() / R.p3N).toString();
        }
        if (id.equals("power")) { return R.pw.toString(); }
        if (id.equals("avgPower")) { return R.t > 0 ? rnd(R.pwSum / R.t).toString() : "--"; }
        if (id.equals("speed")) { return (R.v * 3.6).format("%.1f"); }
        if (id.equals("avgSpeed")) { return R.t > 0 ? (R.d / R.t * 3.6).format("%.1f") : "0.0"; }
        if (id.equals("np")) {
            if (R.npN == 0) { return "--"; }
            var np = Math.pow(R.np4 / R.npN, 0.25) as Float; // VERIFY: Math.pow returns a Float here (Toybox.Math.pow: Numeric)
            return rnd(np.toFloat()).toString();
        }
        return "--";
    }
}
