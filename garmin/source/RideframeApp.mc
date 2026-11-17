// RIDEFRAME on a Garmin watch: the app. Owns the Flow (Flow.mc = js/watchflow.js), the server calls (Api.mc), the offline
// queue and the caches in Application.Storage, heart rate (Sensor), vibration cues (Attention), the run / ride / more
// recordings (Recorder.mc) and the optional native strength activity (ActivityRecording). The JS twin of this file is the
// controller part of js/watchsim.js.
// Storage: token, setup (strength setup), summary (week points), cfg (watch config), last (sport used last), queue.
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
        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        Sensor.enableSensorEvents(method(:onSensor));
        timer = new Timer.Timer();
        timer.start(method(:onTick), 200, true);
        if (token != null) { refresh(); push(); }
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
        if (recorder != null) { recorder.shutdown(); }
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
        flow.handle(E_TICK, t, null);
        recorder.tick(System.getTimer(), t);
        drain();
        // retry the queue every 30 s while the app is open (the phone may be back)
        if (flow.queue.size() > 0 && !sending && t - lastTry >= 30 && flow.paired) { push(); }
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
            else if (k == O_SAVEACT) { recorder.close(true); } // the activity is saved on the watch; nothing goes to RIDEFRAME yet (README)
        }
        recorder.sync();
        if (flow.scr == S_SUM && rec != null) { stopRecording(true); }
        if (flow.scr == S_START && flow.start == 0 && rec != null) { stopRecording(false); }
        if (!lastKey.equals(flow.last)) { lastKey = flow.last; Application.Storage.setValue("last", lastKey); }
        if (DEMO_FEED && flow.scr == S_READY && !"other".equals(flow.sp) && flow.route == null) { flow.setRoute(recorder.demoRoute(flow.sp)); }
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
    function unpair() as Void {
        Application.Storage.deleteValue("token");
        flow.paired = false;
        if (flow.rec == null) { flow.scr = S_PAIR; } // a running recording goes on; pairing waits for its end
        WatchUi.requestUpdate();
    }

    // ---- optional: the strength workout as a native strength activity, so it also lands in Garmin Connect ----
    // Dedupe: Garmin Connect may pass it on to Strava, and RIDEFRAME's Strava import would then bring it back as a second
    // strength session. js/actimport.js must skip a Strava "WeightTraining" whose start is within 2 minutes of a
    // source: 'watch' session (not done yet, see README).
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
    function stopRecording(save as Boolean) as Void {
        if (rec.isRecording()) { rec.stop(); }
        if (save) { rec.save(); } else { rec.discard(); }
        rec = null; laps = 0;
    }
}

function getApp() as RideframeApp { return Application.getApp() as RideframeApp; }
