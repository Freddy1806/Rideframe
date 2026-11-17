// RIDEFRAME on a Garmin watch: the few server calls (tools/watch-api.mjs), one at a time, through Garmin Connect Mobile on the phone.
// The device token lives in Application.Storage ("token"), the server address in the "baseUrl" property (HTTPS only).
import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.PersistedContent;

// one queued request
class ApiJob {
    var verb;                       // Communications.HTTP_REQUEST_METHOD_*
    var path as String;
    var body as Dictionary or Null;
    var done as Method;
    function initialize(v, p as String, b as Dictionary or Null, d as Method) { verb = v; path = p; body = b; done = d; }
}

class Api {
    var busy as Boolean = false;
    var jobs as Array<ApiJob> = [] as Array<ApiJob>;
    var cb as Method or Null = null;

    function initialize() {}

    function base() as String {
        var v = Application.Properties.getValue("baseUrl");
        var u = v instanceof String && (v as String).length() >= 8 ? v as String : "https://mac-mini-von-gary.tailcde074.ts.net";
        while (u.length() > 0 && u.substring(u.length() - 1, u.length()).equals("/")) { u = u.substring(0, u.length() - 1) as String; }
        return u;
    }
    function token() as String or Null { var t = Application.Storage.getValue("token"); return t instanceof String ? t as String : null; }

    // POST /api/watch/pair { code, label } -> { token, name, label }
    function pair(code as String, done as Method) as Void { add(Communications.HTTP_REQUEST_METHOD_POST, "/api/watch/pair", { "code" => code, "label" => deviceLabel() }, done); }
    // GET /api/watch/strength/setup -> { ex: [{ id, n, t, s, b }], rest, unit, last, top, recent, workouts }
    function setup(done as Method) as Void { add(Communications.HTTP_REQUEST_METHOD_GET, "/api/watch/strength/setup", null, done); }
    // GET /api/watch/summary -> { pts, prev, delta, sessions, strength, streak }
    function summary(done as Method) as Void { add(Communications.HTTP_REQUEST_METHOD_GET, "/api/watch/summary", null, done); }
    // GET /api/watch/config -> { v, run, ride, other, more, w, at } (js/watchfields.js compact)
    function config(done as Method) as Void { add(Communications.HTTP_REQUEST_METHOD_GET, "/api/watch/config", null, done); }
    // POST /api/watch/strength { id, start, duration, sets: [{ ex, kg, reps, t }], hr? } -> { ok, id, prs, dup? }
    function session(s as Dictionary, done as Method) as Void { add(Communications.HTTP_REQUEST_METHOD_POST, "/api/watch/strength", s, done); }
    // POST /api/watch/activity { id, type, start, duration, moving, dist, climb, hr, maxHr, kcal, power?, laps? } -> { ok, id, dup?, merged? }
    function activity(a as Dictionary, done as Method) as Void { add(Communications.HTTP_REQUEST_METHOD_POST, "/api/watch/activity", a, done); }
    // GET /api/watch/segments?lat&lon&type -> { segs: [{ id, n, len, pr, kom, p: [[lat, lon]] }], strava } (at most 8, nearest first)
    // VERIFY (Communications.makeWebRequest): a query string in the URL is kept for GET with null params
    function segments(lat as Double, lon as Double, type as String, done as Method) as Void {
        add(Communications.HTTP_REQUEST_METHOD_GET, "/api/watch/segments?lat=" + lat.format("%.5f") + "&lon=" + lon.format("%.5f") + "&type=" + type, null, done);
    }
    // GET /api/watch/routes -> { routes: [{ id, name, dist, climb }] } (at most 20, sent from the phone)
    function routes(done as Method) as Void { add(Communications.HTTP_REQUEST_METHOD_GET, "/api/watch/routes", null, done); }
    // GET /api/watch/route?id -> { id, name, dist, climb, p: [[lat, lon]] (<= 200), turns: [[at, "L" | "R" | "U"]] }; ids are [A-Za-z0-9_-]
    function route(id as String, done as Method) as Void { add(Communications.HTTP_REQUEST_METHOD_GET, "/api/watch/route?id=" + id, null, done); }

    function deviceLabel() as String {
        // VERIFY: System.DeviceSettings has no product name; partNumber is a code. A fixed label is fine, the phone shows it.
        return "Garmin watch";
    }
    function add(verb, path as String, body as Dictionary or Null, done as Method) as Void {
        jobs.add(new ApiJob(verb, path, body, done));
        next();
    }
    function next() as Void {
        if (busy || jobs.size() == 0) { return; }
        var j = jobs[0];
        jobs = jobs.slice(1, jobs.size()) as Array<ApiJob>;
        busy = true; cb = j.done;
        var headers = { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON }; // this form compiled in the first build
        var t = token();
        if (t != null) { headers["Authorization"] = "Bearer " + t; }
        var options = { :method => j.verb, :headers => headers, :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON };
        // VERIFY (Communications.makeWebRequest): a Dictionary body with nested Arrays / Dictionaries is sent as JSON when
        // Content-Type is REQUEST_CONTENT_TYPE_JSON; GET with null params sends no body. Response codes < 0 are phone / BLE errors.
        Communications.makeWebRequest(base() + j.path, j.body, options, method(:onResponse));
    }
    function onResponse(code as Number, data as Null or Dictionary or String or ByteArray or PersistedContent.Iterator) as Void {
        busy = false;
        var c = cb; cb = null;
        if (c != null) { c.invoke(code, data); }
        next();
    }
}
