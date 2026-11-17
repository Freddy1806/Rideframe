// RIDEFRAME on a Garmin watch: the app. Owns the Flow (Flow.mc = js/watchflow.js), the server calls (Api.mc), the offline
// queue and the caches in Application.Storage, heart rate (Sensor), vibration cues (Attention), the run / ride / more
// recordings (Recorder.mc) and the optional native strength activity (ActivityRecording). The JS twin of this file is the
// controller part of js/watchsim.js.
// Storage: token, setup (strength setup), summary (week points), cfg (watch config), last (sport used last), queue,
// aqueue (19.11.: saved runs / rides / more for POST /api/watch/activity, sent like the strength queue).
// 19.11.: the routes for the ready screen's Route choice (GET /api/watch/routes, /route) and the segments near the watch
// (GET /api/watch/segments at the start of a run / ride and every 3 km; timed on the watch by Feed.mc).
import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.Application;
import Toybox.Attention;
import Toybox.Lang;
import Toybox.Sensor;
import Toybox.System;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

// VERIFY ("Glances" core topic): the app class must carry (:glance) so the glance process can start it; check that the
// compiler accepts getInitialView() referring to non-glance classes (it is never called in the glance process).
(:glance)
class RideframeApp extends Application.AppBase {
    var flow = null;
    var api = null;
    var timer = null;
    var recorder = null;        // Recorder: run / ride / more (a normal Garmin activity)
    var rec = null;             // ActivityRecording.Session of a strength workout (only with the recordActivity setting)
    var sending as Boolean = false;
    var lastTry as Number = 0;
    var summary = null;
    var lastKey as String = "";
    var acts as Array<Dictionary> = [] as Array<Dictionary>;   // saved activities waiting for the phone (Storage "aqueue")
    var actSending as Boolean = false;
    var actTry as Number = 0;

    function initialize() { AppBase.initialize(); }

    function onStart(state) as Void {
        // the glance process runs this too: keep it to reading Storage (VERIFY: what a glance may do, "Glances" core topic)
        summary = Application.Storage.getValue("summary");
    }

    function getInitialView() {
        var token = Application.Storage.getValue("token");
        var q = Application.Storage.getValue("queue");
        var f = new Flow(Application.Storage.getValue("setup"), token != null, q instanceof Array ? q : [], Application.Storage.getValue("cfg"), Application.Storage.getValue("last"));
        flow = f; lastKey = f.last;
        api = new Api();
        recorder = new Recorder(f);
        var aq = Application.Storage.getValue("aqueue");
        if (aq instanceof Array) { acts = aq as Array<Dictionary>; }
        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        Sensor.enableSensorEvents(method(:onSensor));
        timer = new Timer.Timer();
        timer.start(method(:onTick), 200, true);
        if (token != null) { refresh(); push(); pushAct(); }
        return [new FlowView(f, self), new FlowDelegate(f, self)];
    }

    (:glance)
    function getGlanceView() {
        return [new RideframeGlance()];
    }

    function onStop(state) as Void {
        if (timer != null) { timer.stop(); }
        Sensor.enableSensorEvents(null);
        if (flow != null) { Application.Storage.setValue("queue", flow.queue); }
        // a run / ride the system closes keeps what was recorded (Recorder.shutdown); an open strength workout is lost
        // (VERIFY on the device: does the system close the app mid-workout, e.g. on a notification? then keep a draft)
        if (recorder != null) { // not in the glance process (it never loads the queues, so it must not write them)
            recorder.shutdown();
            var b = recorder.lastAct; // an activity saved but not queued yet goes into the queue for the next start
            if (b != null) { acts.add(b); recorder.lastAct = null; }
            saveActs();
        }
        if (rec != null && rec.isRecording()) { rec.stop(); rec.discard(); rec = null; }
    }

    function now() as Number { return Time.now().value(); }

    // ---- inputs from the delegate and the timer ----
    function input(ev as Number, arg) as Void {
        var wasStart = flow.start;
        flow.handle(ev, now(), arg);
        if (wasStart == 0 && flow.start != 0) { startRecording(); }
        drain();
        WatchUi.requestUpdate();
    }
    function onTick() as Void {
        var t = now();
        flow.handle(E_TICK, t, System.getTimer()); // ms for the pause screen's 3 s hold (t has whole seconds)
        recorder.tick(System.getTimer(), t);
        drain();
        // retry the queue every 30 s while the app is open (the phone may be back)
        if (flow.queue.size() > 0 && !sending && t - lastTry >= 30 && flow.paired) { push(); }
        if (acts.size() > 0 && !actSending && t - actTry >= 30 && flow.paired) { pushAct(); }
        // segments near the watch: at the start of a run / ride and every 3 km (Recorder.needSegs), through the phone
        if (flow.paired && recorder.needSegs(t) && System.getDeviceSettings().phoneConnected) {
            recorder.segsAsked();
            api.segments(recorder.segLat, recorder.segLon, flow.sp, method(:onSegs));
        }
        WatchUi.requestUpdate();
    }
    function onSensor(info as Sensor.Info) as Void {
        if (info has :heartRate && info.heartRate != null) { flow.handle(E_HR, now(), info.heartRate); }
    }

    // ---- what the flow asks for ----
    function drain() as Void {
        var cues = flow.cues as Array<Number>;
        if (cues.size() > 0) { vibe(cues[cues.size() - 1]); flow.cues = [] as Array<Number>; }
        if (flow.sets.size() > 0 && rec != null) { lap(); }
        var out = flow.out as Array<Dictionary>;
        flow.out = [] as Array<Dictionary>;
        for (var i = 0; i < out.size(); i++) {
            var o = out[i], k = numOf(o["k"]);
            if (k == O_SEND) { push(); saveQueue(); }
            else if (k == O_SETUP) { refresh(); }
            else if (k == O_PAIR) { api.pair(strOf(o["code"]), method(:onPair)); }
            else if (k == O_EXIT) { System.exit(); }
            else if (k == O_SAVEACT) { recorder.close(true); queueAct(); } // saved on the watch (Garmin Connect) and queued for RIDEFRAME
            else if (k == O_ROUTES) { loadRoutes(); }
            else if (k == O_ROUTE) { loadRoute(strOf(o["id"])); }
        }
        if (flow.routeId == null) { recorder.track = null; }
        recorder.sync();
        if (rec != null && flow.start != 0) { pauseRecording(flow.scr == S_PAUSE && flow.rec == null); } // a paused strength workout stops its timer
        if (flow.scr == S_SUM && rec != null) { stopRecording(true); }
        if (flow.scr == S_START && flow.start == 0 && rec != null) { stopRecording(false); }
        if (!lastKey.equals(flow.last)) { lastKey = flow.last; Application.Storage.setValue("last", lastKey); }
    }
    function saveQueue() as Void {
        // VERIFY (Toybox.Application.Storage): the size limit of one value; a queue of a few sessions (~2 KB each) should fit
        Application.Storage.setValue("queue", flow.queue);
    }
    function vibe(c as Number) as Void {
        if (!(Attention has :vibrate)) { return; }
        var p;
        if (c == C_PR || c == C_LAP) { p = [new Attention.VibeProfile(100, 300), new Attention.VibeProfile(0, 150), new Attention.VibeProfile(100, 300)]; }
        else if (c == C_REST || c == C_HOLD) { p = [new Attention.VibeProfile(80, 200), new Attention.VibeProfile(0, 120), new Attention.VibeProfile(80, 200), new Attention.VibeProfile(0, 120), new Attention.VibeProfile(80, 200)]; }
        else if (c == C_DONE) { p = [new Attention.VibeProfile(100, 500)]; }
        else if (c == C_ERROR) { p = [new Attention.VibeProfile(50, 100), new Attention.VibeProfile(0, 100), new Attention.VibeProfile(50, 100)]; }
        else if (c == C_STOP || c == C_SEG) { p = [new Attention.VibeProfile(80, 150), new Attention.VibeProfile(0, 120), new Attention.VibeProfile(80, 150)]; }
        else { p = [new Attention.VibeProfile(60, 150)]; } // set, start
        Attention.vibrate(p);
    }

    // ---- server ----
    function refresh() as Void {
        api.setup(method(:onSetup));
        api.summary(method(:onSummary));
        // the watch config: after pairing and at every start while the phone is reachable (else the cached one or the defaults)
        if (System.getDeviceSettings().phoneConnected) { api.config(method(:onConfig)); }
    }
    function onSetup(code as Number, data) as Void {
        if (code == 401) { unpair(); return; }
        if (code == 200 && data instanceof Dictionary) { flow.setSetup(data); store("setup", data as Dictionary); WatchUi.requestUpdate(); }
    }
    function onSummary(code as Number, data) as Void {
        if (code == 200 && data instanceof Dictionary) { summary = data; store("summary", data as Dictionary); WatchUi.requestUpdate(); }
    }
    function onConfig(code as Number, data) as Void {
        if (code == 401) { unpair(); return; }
        if (code == 200 && cfgOk(data)) { flow.setConfig(data); store("cfg", data as Dictionary); WatchUi.requestUpdate(); }
    }
    // a cache that does not fit is simply not kept (the app then uses what it has in memory now, the defaults next time)
    function store(key as String, v as Dictionary) as Void {
        try { Application.Storage.setValue(key, v); } // VERIFY (Application.Storage.setValue): which exception a too large value throws
        catch (e) { System.println("storage: " + key + " not kept"); }
    }
    function onPair(code as Number, data) as Void {
        if (code == 200 && data instanceof Dictionary && (data as Dictionary)["token"] != null) {
            Application.Storage.setValue("token", strOf((data as Dictionary)["token"]));
            flow.pairedResult(true, null);
        } else {
            flow.pairedResult(false, null);
        }
        drain(); WatchUi.requestUpdate();
    }
    // the queue, oldest first, one at a time; kept on any trouble, dropped only when the server refuses a session for good
    function push() as Void {
        if (sending || flow.queue.size() == 0 || !flow.paired) { return; }
        sending = true; lastTry = now();
        api.session(flow.queue[0], method(:onSent));
    }
    function onSent(code as Number, data) as Void {
        sending = false;
        if (flow.queue.size() == 0) { return; }
        var id = strOf((flow.queue[0] as Dictionary)["id"]);
        if (code == 401) { flow.sent(id, R_RETRY); unpair(); return; }
        var res = code == 200 ? R_OK : ((code == 400 || code == 413) ? R_DROP : R_RETRY);
        flow.sent(id, res);
        saveQueue();
        WatchUi.requestUpdate();
        if (res != R_RETRY && flow.queue.size() > 0) { push(); }
        else if (res == R_OK) { refresh(); }
    }
    /* ---- 19.11.: activities, routes, segments ---- */
    function saveActs() as Void {
        try { Application.Storage.setValue("aqueue", acts); } // VERIFY (Application.Storage.setValue): which exception a too large value throws
        catch (e) { System.println("storage: aqueue not kept"); }
    }
    // the activity just saved (Recorder.activityBody) goes into the queue; at most 10 wait, the oldest goes first
    function queueAct() as Void {
        var b = recorder.lastAct;
        if (b == null) { return; }
        recorder.lastAct = null;
        acts.add(b);
        if (acts.size() > 10) { acts = acts.slice(acts.size() - 10, acts.size()) as Array<Dictionary>; }
        saveActs(); pushAct();
    }
    function pushAct() as Void {
        if (actSending || acts.size() == 0 || !flow.paired) { return; }
        actSending = true; actTry = now();
        api.activity(acts[0], method(:onActSent));
    }
    // 200 (also dup / merged with a Strava twin) and 400 / 413 (refused for good) drop it; anything else keeps it for the next try
    function onActSent(code as Number, data) as Void {
        actSending = false;
        if (code == 401) { unpair(); return; }
        if (acts.size() == 0) { return; }
        if (code == 200 || code == 400 || code == 413) {
            acts = acts.slice(1, acts.size()) as Array<Dictionary>;
            saveActs();
            if (acts.size() > 0) { pushAct(); } else if (code == 200) { api.summary(method(:onSummary)); }
        }
    }
    // the routes for RPICK; without the phone the list stays unknown, so the next ready screen asks again
    function loadRoutes() as Void {
        if (DEMO_FEED) {
            flow.setRoutes([{ "id" => "demo-run", "name" => "Riverside 8k", "dist" => 8000 }, { "id" => "demo-ride", "name" => "Lake loop", "dist" => 42000 }]);
            if (flow.routeId == null) { flow.routeId = "demo-" + flow.sp; flow.setRoute(recorder.demoRoute(flow.sp)); }
            return;
        }
        if (flow.paired && System.getDeviceSettings().phoneConnected) { api.routes(method(:onRoutes)); }
    }
    function onRoutes(code as Number, data) as Void {
        if (code == 401) { unpair(); return; }
        if (code == 200 && data instanceof Dictionary) { flow.setRoutes((data as Dictionary)["routes"]); WatchUi.requestUpdate(); }
    }
    function loadRoute(id as String) as Void {
        if (DEMO_FEED && id.find("demo-") == 0) { flow.setRoute(recorder.demoRoute(id.equals("demo-ride") ? "ride" : "run")); return; }
        if (!System.getDeviceSettings().phoneConnected) { flow.routeId = null; return; } // shown as "No route"
        api.route(id, method(:onRoute));
    }
    // the route: followed by Recorder.track, drawn from its flat face; a failed or late answer leaves no route
    function onRoute(code as Number, data) as Void {
        var want = flow.routeId;
        if (want == null) { return; }
        if (code == 401) { unpair(); }
        if (code == 200 && data instanceof Dictionary) {
            var d = data as Dictionary;
            if (!want.equals(strOf(d["id"]))) { return; } // the answer for an earlier choice
            var p = arrOf(d["p"]);
            if (fdPtsOk(p)) {
                var t = new RouteTrack(p);
                recorder.track = t;
                flow.setRoute(t.face(d));
                WatchUi.requestUpdate();
                return;
            }
        }
        flow.routeId = null; recorder.track = null; // shown as "No route"
        WatchUi.requestUpdate();
    }
    function onSegs(code as Number, data) as Void {
        if (code == 401) { recorder.segsLoaded(null, now()); unpair(); return; }
        if (code == 200 && data instanceof Dictionary) { recorder.segsLoaded(arrOf((data as Dictionary)["segs"]), now()); }
        else { recorder.segsLoaded(null, now()); }
    }
    function unpair() as Void {
        Application.Storage.deleteValue("token");
        flow.paired = false;
        if (flow.rec == null) { flow.scr = S_PAIR; } // a running recording goes on; pairing waits for its end
        WatchUi.requestUpdate();
    }

    // ---- optional: the strength workout as a native strength activity, so it also lands in Garmin Connect ----
    // Dedupe: Garmin Connect may pass it on to Strava; RIDEFRAME links a Strava "WeightTraining" within 2 minutes of a watch
    // session to it instead of keeping two (tools/watch-feed.mjs linkStrength, js/actimport.js), in either order.
    function startRecording() as Void {
        if (Application.Properties.getValue("recordActivity") != true || !(Toybox has :ActivityRecording)) { return; }
        rec = ActivityRecording.createSession({ :name => "Strength", :sport => Activity.SPORT_TRAINING, :subSport => Activity.SUB_SPORT_STRENGTH_TRAINING });
        rec.start();
    }
    var laps as Number = 0;
    function lap() as Void { // one lap per set, so the activity shows the sets as laps (real "sets" in the FIT file are not open to Connect IQ: VERIFY)
        if (flow.sets.size() > laps && rec.isRecording()) { rec.addLap(); }
        laps = flow.sets.size();
    }
    // VERIFY (Toybox.ActivityRecording.Session): stop() then start() again on the same session pauses and resumes its timer
    function pauseRecording(paused as Boolean) as Void {
        if (paused && rec.isRecording()) { rec.stop(); }
        else if (!paused && !rec.isRecording()) { rec.start(); }
    }
    function stopRecording(save as Boolean) as Void {
        if (rec.isRecording()) { rec.stop(); }
        if (save) { rec.save(); } else { rec.discard(); }
        rec = null; laps = 0;
    }
}

function getApp() as RideframeApp { return Application.getApp() as RideframeApp; }
