// 25.11.: Garmin's own recovery values for the coach (RIDEFRAME is where all the data comes together): read once per app start and
// before each upload (RideframeApp.sendHealth) and sent as POST /api/watch/health (tools/health-api.mjs). JS twin: js/watchflow.js healthBody.
// Short keys: ss sleep score, bb body battery, rt recovery time (minutes), st stress, rhr resting heart rate, v2r / v2b VO2max run / bike,
// ts training status (text), rr respiration rate, spo2 pulse ox, steps; plus day (the watch's local day, YYYY-MM-DD) and t (Unix s).
// Only values the watch really has go out: every read is guarded (has checks, null checks, try / catch), a device without a value
// simply leaves the key out, and nothing here may stop the app.
// Sources (Connect IQ API docs, developer.garmin.com/connect-iq/api-docs, read 25.11.; none of it ran on a device yet):
//   UserProfile.getProfile() (permission UserProfile): restingHeartRate (1.0.0), averageRestingHeartRate (3.2.0, 7-day average),
//     vo2maxRunning / vo2maxCycling (3.3.0), all Number or Null
//   ActivityMonitor.getInfo(): timeToRecovery (3.3.0, HOURS), stressScore (5.0.0, 0-100), respirationRate (3.3.0), steps (1.0.0)
//   SensorHistory.getBodyBatteryHistory({ :period => 1, :order => ORDER_NEWEST_FIRST }) (3.3.0, permission SensorHistory): SensorSample.data
//   Complications.getComplication(new Complications.Id(type)) (4.2.0, permission ComplicationSubscriber; throws ComplicationNotFoundException):
//     RECOVERY_TIME (minutes), BODY_BATTERY, STRESS, VO2MAX_RUN, VO2MAX_BIKE, TRAINING_STATUS (String), RESPIRATION_RATE, PULSE_OX (4.2.0),
//     SLEEP_SCORE (6.0.2, value 42: referenced by number behind a has check, so devices on an older SDK still compile)
// VERIFY on the fenix 8: the Core Topics page "Complications" says only watch faces subscribe; a one-off getComplication from a
// watch-app is not described there. If it is refused, the try / catch leaves those keys out (sleep score and training status then
// never arrive; the rest come from UserProfile / ActivityMonitor / SensorHistory).
import Toybox.ActivityMonitor;
import Toybox.Complications;
import Toybox.Lang;
import Toybox.Math;
import Toybox.SensorHistory;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.UserProfile;

// a Number (whole) or Float (one decimal) from whatever an API gave, or null; lo / hi: the server's ranges (tools/health-api.mjs)
function hNum(v, lo as Number, hi as Number, dec as Boolean) as Numeric or Null {
    if (v == null) { return null; }
    var f = null;
    if (v instanceof Number) { f = (v as Number).toFloat(); }
    else if (v instanceof Float) { f = v as Float; }
    else if (v instanceof Long) { f = (v as Long).toFloat(); }
    else if (v instanceof Double) { f = (v as Double).toFloat(); }
    if (f == null) { return null; }
    var x = f as Float;
    if (x != x || x < lo || x > hi) { return null; } // x != x: NaN
    if (dec) { return Math.round(x * 10.0).toFloat() / 10.0; }
    return Math.round(x).toNumber();
}
// one native complication's value, or null (not on this device, not allowed, no value)
function hComp(type) {
    if (!(Toybox has :Complications) || !(Complications has :getComplication)) { return null; }
    try {
        var c = Complications.getComplication(new Complications.Id(type as Complications.Type));
        return c != null ? c.value : null;
    } catch (e) {
        return null;
    }
}
function hPut(d as Dictionary, k as String, v) as Void { if (v != null) { d[k] = v; } }

// the snapshot: a Dictionary with day and t and only the keys that have a value; null when there is none at all
function healthSnapshot() as Dictionary or Null {
    var d = {} as Dictionary;
    // UserProfile: resting heart rate (today's, else the 7-day average) and the two VO2max values
    try {
        if (Toybox has :UserProfile) {
            var p = UserProfile.getProfile();
            if (p != null) {
                var r = null;
                if (p has :restingHeartRate) { r = hNum(p.restingHeartRate, 25, 150, false); }
                if (r == null && (p has :averageRestingHeartRate)) { r = hNum(p.averageRestingHeartRate, 25, 150, false); }
                hPut(d, "rhr", r);
                if (p has :vo2maxRunning) { hPut(d, "v2r", hNum(p.vo2maxRunning, 10, 100, false)); }
                if (p has :vo2maxCycling) { hPut(d, "v2b", hNum(p.vo2maxCycling, 10, 100, false)); }
            }
        }
    } catch (e) { System.println("health: profile"); }
    // ActivityMonitor: steps, stress, respiration, recovery time (hours here, minutes on the server)
    try {
        var i = ActivityMonitor.getInfo();
        if (i != null) {
            if (i has :steps) { hPut(d, "steps", hNum(i.steps, 0, 200000, false)); }
            if (i has :stressScore) { hPut(d, "st", hNum(i.stressScore, 0, 100, false)); }
            if (i has :respirationRate) { hPut(d, "rr", hNum(i.respirationRate, 3, 60, true)); }
            if (i has :timeToRecovery) { var h = hNum(i.timeToRecovery, 0, 168, false); if (h != null) { d["rt"] = (h as Number) * 60; } }
        }
    } catch (e) { System.println("health: activity monitor"); }
    // SensorHistory: the newest body battery sample
    try {
        if ((Toybox has :SensorHistory) && (SensorHistory has :getBodyBatteryHistory)) {
            var it = SensorHistory.getBodyBatteryHistory({ :period => 1, :order => SensorHistory.ORDER_NEWEST_FIRST });
            if (it != null) { var s = it.next(); if (s != null) { hPut(d, "bb", hNum(s.data, 0, 100, false)); } }
        }
    } catch (e) { System.println("health: body battery"); }
    // Complications: what only they have (sleep score, training status, pulse ox), and the rest where the APIs above gave nothing.
    // The recovery time of the complication (minutes) is the one the watch shows, so it wins over timeToRecovery (whole hours).
    try {
        if (Toybox has :Complications) {
            if (Complications has :COMPLICATION_TYPE_SLEEP_SCORE) { hPut(d, "ss", hNum(hComp(42), 0, 100, false)); } // COMPLICATION_TYPE_SLEEP_SCORE = 42 (API 6.0.2)
            var rt = hNum(hComp(Complications.COMPLICATION_TYPE_RECOVERY_TIME), 0, 10080, false); if (rt != null) { d["rt"] = rt; }
            if (d["bb"] == null) { hPut(d, "bb", hNum(hComp(Complications.COMPLICATION_TYPE_BODY_BATTERY), 0, 100, false)); }
            if (d["st"] == null) { hPut(d, "st", hNum(hComp(Complications.COMPLICATION_TYPE_STRESS), 0, 100, false)); }
            if (d["v2r"] == null) { hPut(d, "v2r", hNum(hComp(Complications.COMPLICATION_TYPE_VO2MAX_RUN), 10, 100, false)); }
            if (d["v2b"] == null) { hPut(d, "v2b", hNum(hComp(Complications.COMPLICATION_TYPE_VO2MAX_BIKE), 10, 100, false)); }
            if (d["rr"] == null) { hPut(d, "rr", hNum(hComp(Complications.COMPLICATION_TYPE_RESPIRATION_RATE), 3, 60, true)); }
            hPut(d, "spo2", hNum(hComp(Complications.COMPLICATION_TYPE_PULSE_OX), 50, 100, false));
            var ts = hComp(Complications.COMPLICATION_TYPE_TRAINING_STATUS);
            if (ts instanceof String && (ts as String).length() > 0) { var t = ts as String; d["ts"] = t.length() > 40 ? t.substring(0, 40) : t; }
        }
    } catch (e) { System.println("health: complications"); }
    if (d.size() == 0) { return null; }
    var now = Time.now();
    var g = Gregorian.info(now, Time.FORMAT_SHORT);
    d["day"] = Lang.format("$1$-$2$-$3$", [g.year, (g.month as Number).format("%02d"), g.day.format("%02d")]);
    d["t"] = now.value();
    return d;
}
