// RIDEFRAME Strength for Garmin watches: the app. Owns the Flow (Flow.mc = js/watchflow.js), the server calls (Api.mc),
// the offline queue in Application.Storage, heart rate (Sensor), vibration cues (Attention) and the optional native
// strength activity (ActivityRecording). The JS twin of this file is the controller part of js/watchsim.js.
// DRAFT, NOT COMPILED YET.
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
    var rec = null;            // ActivityRecording.Session while a workout runs (only with the recordActivity setting)
    var sending as Boolean = false;
    var lastTry as Number = 0;
    var summary = null;

    function initialize() { AppBase.initialize(); }

    function onStart(state) as Void {
        // the glance process runs this too: keep it to reading Storage (VERIFY: what a glance may do, "Glances" core topic)
        summary = Application.Storage.getValue("summary");
    }

    function getInitialView() {
        var token = Application.Storage.getValue("token");
        var q = Application.Storage.getValue("queue");
        flow = new Flow(Application.Storage.getValue("setup"), token != null, q instanceof Array ? q : []);
        api = new Api();
        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        Sensor.enableSensorEvents(method(:onSensor));
        timer = new Timer.Timer();
        timer.start(method(:onTick), 200, true);
        if (token != null) { refresh(); push(); }
        return [new FlowView(flow, self), new FlowDelegate(flow, self)];
    }

    (:glance)
    function getGlanceView() {
        return [new RideframeGlance()];
    }

    function onStop(state) as Void {
        if (timer != null) { timer.stop(); }
        Sensor.enableSensorEvents(null);
        if (flow != null) { Application.Storage.setValue("queue", flow.queue); }
        // an open workout is lost when the app is closed; the queue of finished ones stays (VERIFY on the device: does the
        // system close the app while a set runs, e.g. on a notification? then keep a draft in Storage like kraft.js does)
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
        flow.handle(E_TICK, now(), null);
        drain();
        // retry the queue every 30 s while the app is open (the phone may be back)
        if (flow.queue.size() > 0 && !sending && now() - lastTry >= 30 && flow.paired) { push(); }
        WatchUi.requestUpdate();
    }
    function onSensor(info as Sensor.Info) as Void {
        if (info has :heartRate && info.heartRate != null) { flow.handle(E_HR, now(), info.heartRate); }
    }

    // ---- what the flow asks for ----
    function drain() as Void {
        if (flow.cues.size() > 0) { vibe(flow.cues[flow.cues.size() - 1]); flow.cues = []; }
        if (flow.sets.size() > 0 && rec != null) { lap(); }
        var out = flow.out; flow.out = [];
        for (var i = 0; i < out.size(); i++) {
            var k = out[i]["k"];
            // VERIFY (Toybox.Application.Storage): the size limit of one value; a queue of a few sessions (~2 KB each) should fit
        if (k == O_SEND) { push(); Application.Storage.setValue("queue", flow.queue); }
            else if (k == O_SETUP) { refresh(); }
            else if (k == O_PAIR) { api.pair(out[i]["code"], method(:onPair)); }
            else if (k == O_EXIT) { System.exit(); }
        }
        if (flow.scr == S_SUM && rec != null) { stopRecording(true); }
        if (flow.scr == S_START && flow.start == 0 && rec != null) { stopRecording(false); }
    }
    function vibe(c as Number) as Void {
        if (!(Attention has :vibrate)) { return; }
        var p;
        if (c == C_PR) { p = [new Attention.VibeProfile(100, 300), new Attention.VibeProfile(0, 150), new Attention.VibeProfile(100, 300)]; }
        else if (c == C_REST) { p = [new Attention.VibeProfile(80, 200), new Attention.VibeProfile(0, 120), new Attention.VibeProfile(80, 200), new Attention.VibeProfile(0, 120), new Attention.VibeProfile(80, 200)]; }
        else if (c == C_DONE) { p = [new Attention.VibeProfile(100, 500)]; }
        else if (c == C_ERROR) { p = [new Attention.VibeProfile(50, 100), new Attention.VibeProfile(0, 100), new Attention.VibeProfile(50, 100)]; }
        else { p = [new Attention.VibeProfile(60, 150)]; }
        Attention.vibrate(p);
    }

    // ---- server ----
    function refresh() as Void { api.setup(method(:onSetup)); api.summary(method(:onSummary)); }
    function onSetup(code as Number, data) as Void {
        if (code == 401) { unpair(); return; }
        if (code == 200 && data instanceof Dictionary) { flow.setSetup(data); Application.Storage.setValue("setup", data); WatchUi.requestUpdate(); }
    }
    function onSummary(code as Number, data) as Void {
        if (code == 200 && data instanceof Dictionary) { summary = data; Application.Storage.setValue("summary", data); WatchUi.requestUpdate(); }
    }
    function onPair(code as Number, data) as Void {
        if (code == 200 && data instanceof Dictionary && data["token"] != null) {
            Application.Storage.setValue("token", data["token"]);
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
        var id = flow.queue[0]["id"];
        if (code == 401) { flow.sent(id, R_RETRY); unpair(); return; }
        var res = code == 200 ? R_OK : ((code == 400 || code == 413) ? R_DROP : R_RETRY);
        flow.sent(id, res);
        Application.Storage.setValue("queue", flow.queue);
        WatchUi.requestUpdate();
        if (res != R_RETRY && flow.queue.size() > 0) { push(); }
        else if (res == R_OK) { refresh(); }
    }
    function unpair() as Void {
        Application.Storage.deleteValue("token");
        flow.paired = false; flow.scr = S_PAIR;
        WatchUi.requestUpdate();
    }

    // ---- optional: the workout as a native strength activity, so it also lands in Garmin Connect ----
    // Dedupe: Garmin Connect may pass it on to Strava, and RIDEFRAME's Strava import would then bring it back as a second
    // strength session. js/actimport.js must skip a Strava "WeightTraining" whose start is within 2 minutes of a
    // source: 'watch' session (not done yet, see README).
    function startRecording() as Void {
        if (Application.Properties.getValue("recordActivity") != true || !(Toybox has :ActivityRecording)) { return; }
        // VERIFY: Activity.SPORT_TRAINING / Activity.SUB_SPORT_STRENGTH_TRAINING (API 3.2+; older: ActivityRecording.SPORT_*), doc page Toybox.ActivityRecording.createSession
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
