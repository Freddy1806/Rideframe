// RIDEFRAME on a Garmin watch: run / ride / "more" recordings. Keeps a native ActivityRecording session in step with the
// flow's recording (Flow.rec): created on START, stopped while paused or auto paused, a lap per flow lap, saved as a
// normal Garmin activity on Save (it syncs to Garmin Connect like any watch activity), discarded on Discard.
// GPS (Position) runs from the ready screen to the end for outdoor sports. Once a second the values of the session
// (Activity.getActivityInfo) go into the flow as one "sample" (js/watchflow.js sample), so fields, laps and auto pause
// work exactly like the preview. Kept out of RideframeApp so the glance process does not load it.
import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.Lang;
import Toybox.Math;
import Toybox.Position;
import Toybox.System;
import Toybox.Time;

// The route page and the segment popup get their data from the phone in a later step. Until then nothing feeds them;
// true = a demo route on the ready screen and a demo segment 30 s into a run / ride (for the simulator only).
const DEMO_FEED = false;

class Recorder {
    var flow as Flow;
    var session as ActivityRecording.Session or Null = null;
    var laps as Number = 0;
    var gpsOn as Boolean = false;
    var lastMs as Number = 0;
    var lastAsc as Number = -1;
    var lastDist as Float = -1.0;
    var lastAct as Dictionary or Null = null; // the body POST /api/watch/activity would get (see postActivityStub)

    function initialize(f as Flow) { flow = f; }

    // after every event: GPS on / off, session start / stop / lap / discard
    function sync() as Void {
        var wantGps = (flow.scr == S_READY || flow.rec != null) && Sports.gps(flow.sp, flow.type);
        if (wantGps != gpsOn) { setGps(wantGps); }
        var R = flow.rec;
        if (R == null) {
            if (session != null) { close(false); }
            return;
        }
        if (session == null) { open(); }
        var s = session;
        if (s == null) { return; }
        var run = R.st == RS_RUN && !R.auto;
        if (run && !s.isRecording()) { s.start(); }
        else if (!run && s.isRecording()) { s.stop(); }
        if (R.lapN > laps) { if (s.isRecording()) { s.addLap(); } laps = R.lapN; }
    }
    function name() as String {
        var n = flow.sp.equals("other") ? flow.tname : flow.homeLabel(flow.sp);
        if (n.length() == 0) { n = "Activity"; }
        return n.length() > 15 ? n.substring(0, 15) as String : n; // createSession :name, 15 characters (doc)
    }
    function open() as Void {
        if (!(Toybox has :ActivityRecording)) { return; }
        // VERIFY (Toybox.ActivityRecording.createSession): Activity.SPORT_* / SUB_SPORT_* are accepted for :sport / :subSport (doc says
        // "ActivityRecording.Sport or Activity.Sport"); the 4.1.6 constants in Sports.mc compile for the API 5.2 targets
        session = ActivityRecording.createSession({ :name => name(), :sport => Sports.sport(flow.sp, flow.type), :subSport => Sports.sub(flow.sp, flow.type) });
        laps = 0; lastAsc = -1; lastDist = -1.0; lastMs = System.getTimer();
    }
    // Save (true) or Discard (false); the summary for the server is taken before the session closes
    function close(save as Boolean) as Void {
        var s = session;
        if (s == null) { return; }
        if (s.isRecording()) { s.stop(); }
        if (save) { lastAct = activityBody(); s.save(); } else { s.discard(); }
        session = null; laps = 0;
    }
    // the app is closed by the system mid-recording: keep what was recorded (a minute or more), else drop it
    function shutdown() as Void {
        var R = flow.rec, keep = false;
        if (R != null) { keep = R.t >= 60; }
        if (session != null) { close(keep); }
        if (gpsOn) { setGps(false); }
    }
    function setGps(on as Boolean) as Void {
        gpsOn = on;
        if (!(Toybox has :Position)) { return; }
        if (on) { Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition)); }
        else { Position.enableLocationEvents(Position.LOCATION_DISABLE, null); flow.gps = 0; }
    }
    function onPosition(info as Position.Info) as Void {
        var q = info.accuracy; // VERIFY: Position.Info.accuracy is a Position.Quality (QUALITY_* constants)
        flow.gps = (q == Position.QUALITY_GOOD || q == Position.QUALITY_USABLE) ? 2 : (q == Position.QUALITY_POOR ? 1 : 0);
    }

    // every app tick (200 ms): once a second one sample into the flow while the recording runs
    function tick(ms as Number, now as Number) as Void {
        var R = flow.rec;
        if (R == null) { lastMs = ms; return; }
        if (R.st != RS_RUN) { lastMs = ms; return; }
        if (ms - lastMs < 1000) { return; }
        lastMs = ms - lastMs > 3000 ? ms : lastMs + 1000;
        var a = { "dt" => 1, "v" => 0.0, "hr" => flow.hr } as Dictionary;
        var info = Activity.getActivityInfo();
        if (info != null) {
            var v = info.currentSpeed; if (v != null) { a["v"] = v; }
            var h = info.currentHeartRate; if (h != null) { a["hr"] = h; }
            var p = info.currentPower; if (p != null) { a["pw"] = p; }
            var c = info.currentCadence; if (c != null) { a["cad"] = c; } // VERIFY on a run: steps per minute (the field shows spm)
            var asc = info.totalAscent;
            if (asc != null) { if (lastAsc >= 0 && asc > lastAsc) { a["up"] = asc - lastAsc; } lastAsc = asc; }
            var dist = info.elapsedDistance; // only counts while the session records (auto pause: no metres)
            if (dist != null) { if (lastDist >= 0.0) { var dd = dist - lastDist; a["dd"] = dd > 0.0 ? dd : 0.0; } lastDist = dist; }
            var kc = info.calories; if (kc != null) { a["kcal"] = kc; }
        }
        if (DEMO_FEED) { demoSeg(R, now); }
        flow.handle(E_SAMPLE, now, a);
    }

    /* ---- after Save: what RIDEFRAME would get. There is no endpoint for it yet, so it is NOT sent; see garmin/README.md ---- */
    // POST /api/watch/activity { id, type, start, duration, moving, dist, climb, hr, maxHr, kcal, power?, laps? }
    function activityBody() as Dictionary or Null {
        var s = flow.rsum;
        if (s == null) { return null; }
        var info = Activity.getActivityInfo(), hr = 0, maxHr = 0, now = Time.now().value(), start = numOf(s["start"]);
        if (info != null) {
            var a = info.averageHeartRate; if (a != null) { hr = a; }
            var m = info.maxHeartRate; if (m != null) { maxHr = m; }
        }
        var sp = strOf(s["sp"]);
        var b = { "id" => Math.rand().format("%08x") + now.format("%x"), "type" => sp.equals("other") ? strOf(s["type"]) : (sp.equals("ride") ? "Ride" : "Run"),
                  "start" => start, "duration" => now - start, "moving" => numOf(s["t"]), "dist" => rnd(fltOf(s["d"])), "climb" => rnd(fltOf(s["gain"])),
                  "hr" => hr, "maxHr" => maxHr, "kcal" => rnd(fltOf(s["kcal"])), "laps" => numOf(s["laps"]) } as Dictionary;
        if (sp.equals("ride")) { b["power"] = rnd(fltOf(s["avgPw"])); }
        return b;
    }
    // STUB, NOT CALLED: send lastAct once the server has POST /api/watch/activity (then: queue it like the strength sessions)
    function postActivityStub(api as Api, done as Method) as Void {
        var b = lastAct;
        if (b == null) { return; }
        api.activity(b, done);
    }

    /* ---- demo feed (DEMO_FEED only): a loop with four turns and one segment, like js/watchsim.js demoRoute / segDemo ---- */
    function demoRoute(sp as String) as Dictionary {
        var len = sp.equals("ride") ? 42000.0 : 8000.0, pts = [] as Array;
        for (var i = 0; i <= 40; i++) {
            var a = i / 40.0 * Math.PI * 1.7 - 2.2;
            pts.add([0.5 + 0.42 * Math.cos(a) + 0.06 * Math.sin(3 * a), 0.5 + 0.36 * Math.sin(a) * (1 + 0.25 * Math.cos(a))]);
        }
        return { "len" => len, "pts" => pts, "turns" => [{ "at" => 0.12 * len, "dir" => "L", "txt" => "Bridge St" }, { "at" => 0.38 * len, "dir" => "R", "txt" => "Harbour Rd" },
                 { "at" => 0.61 * len, "dir" => "R", "txt" => "Mill Lane" }, { "at" => 0.84 * len, "dir" => "L", "txt" => "Park Ave" }] } as Dictionary;
    }
    function demoSeg(R as Rec, now as Number) as Void {
        if (flow.sp.equals("other")) { return; }
        var ride = flow.sp.equals("ride"), len = ride ? 2400.0 : 800.0, t = R.t - 30, nm = ride ? "Col de la Croix climb" : "Riverside sprint";
        if (t < 0 || t > 19) { return; }
        var a = { "name" => nm, "len" => len } as Dictionary;
        if (t < 7) { a["k"] = "warn"; a["eta"] = 30 - t * 5; a["pr"] = ride ? 244 : 221; }
        else if (t < 19) { a["k"] = "live"; a["done"] = (t - 6) / 12.0 * len * 0.96; a["delta"] = 3 - t / 3; a["need"] = ride ? 10.6 : 3.63; }
        else { a["k"] = "end"; a["time"] = ride ? 241 : 218; a["delta"] = -3; a["pr"] = true; }
        flow.handle(E_SEG, now, a);
    }
}
