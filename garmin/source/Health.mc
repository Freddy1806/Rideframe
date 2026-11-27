// 25.11.: Garmin's own recovery values for the coach (RIDEFRAME is where all the data comes together): read once per app start and
// before each upload (RideframeApp.sendHealth) and sent as POST /api/watch/health (tools/health-api.mjs). JS twin: js/watchflow.js healthBody.
// Short keys: bb body battery, rt recovery time (minutes), st stress, rhr resting heart rate, v2r / v2b VO2max run / bike,
// rr respiration rate, spo2 pulse ox, steps; plus day (the watch's local day, YYYY-MM-DD) and t (Unix s).
// Only values the watch really has go out: every read is guarded (has checks, null checks, try / catch), a device without a value
// simply leaves the key out, and nothing here may stop the app.
// Sources (Connect IQ API docs, developer.garmin.com/connect-iq/api-docs, read 25.11.; none of it ran on a device yet):
//   UserProfile.getProfile() (permission UserProfile): restingHeartRate (1.0.0), averageRestingHeartRate (3.2.0, 7-day average),
//     vo2maxRunning / vo2maxCycling (3.3.0), all Number or Null
//   ActivityMonitor.getInfo(): timeToRecovery (3.3.0, HOURS), stressScore (5.0.0, 0-100), respirationRate (3.3.0), steps (1.0.0)
//   SensorHistory.getBodyBatteryHistory({ :period => 1, :order => ORDER_NEWEST_FIRST }) (3.3.0, permission SensorHistory): SensorSample.data
// 25.11. (compiled on the Mac): Toybox.Complications cannot be read from a watch-app (the permission ComplicationSubscriber is only
// valid for watch faces, a compile-time rule), so sleep score and training status do NOT come from here; sleep comes another way.
import Toybox.ActivityMonitor;
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
function hPut(d as Dictionary, k as String, v) as Void { if (v != null) { d[k] = v; } }

// 27.11.4: the profile's cycling heart rate zones for the trainer summary (UserProfile.getHeartRateZones(HR_ZONE_SPORT_BIKING), 1.0.0:
// min zone 1, max zone 1 ... max zone 5); Flow.setHrZones checks them (hrZones), null or anything else: no zones on the summary
function bikeZones() {
    try {
        if ((Toybox has :UserProfile) && (UserProfile has :getHeartRateZones)) { return UserProfile.getHeartRateZones(UserProfile.HR_ZONE_SPORT_BIKING); }
    } catch (e) { System.println("health: zones"); }
    return null;
}
// the snapshot: a Dictionary with day and t and only the keys that have a value; null when there is none at all
function healthSnapshot() as Dictionary or Null {
    var d = {} as Dictionary;
    // UserProfile: resting heart rate and the two VO2max values
    try {
        if (Toybox has :UserProfile) {
            var p = UserProfile.getProfile();
            if (p != null) {
                var r = null; // the measured 7-day average first; restingHeartRate is the value set in the user profile
                if (p has :averageRestingHeartRate) { r = hNum(p.averageRestingHeartRate, 25, 150, false); }
                if (r == null && (p has :restingHeartRate)) { r = hNum(p.restingHeartRate, 25, 150, false); }
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
    // SensorHistory: the newest pulse ox sample, where the watch records it
    try {
        if ((Toybox has :SensorHistory) && (SensorHistory has :getOxygenSaturationHistory)) {
            var io = SensorHistory.getOxygenSaturationHistory({ :period => 1, :order => SensorHistory.ORDER_NEWEST_FIRST });
            if (io != null) { var so = io.next(); if (so != null) { hPut(d, "spo2", hNum(so.data, 50, 100, false)); } }
        }
    } catch (e) { System.println("health: pulse ox"); }
    if (d.size() == 0) { return null; }
    var now = Time.now();
    var g = Gregorian.info(now, Time.FORMAT_SHORT);
    d["day"] = Lang.format("$1$-$2$-$3$", [g.year, (g.month as Number).format("%02d"), g.day.format("%02d")]);
    d["t"] = now.value();
    return d;
}
