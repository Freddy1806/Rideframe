// RIDEFRAME Strength: the few server calls (tools/watch-api.mjs), one at a time, through Garmin Connect Mobile on the phone.
// The device token lives in Application.Storage ("token"), the server address in the "baseUrl" property (HTTPS only).
// DRAFT, NOT COMPILED YET.
import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;

class Api {
    var busy as Boolean = false;
    var jobs as Array = [];        // [[method, path, body, callback]]
    var cb = null;

    function initialize() {}

    function base() as String {
        var u = Application.Properties.getValue("baseUrl");
        if (!(u instanceof String) || u.length() < 8) { u = "https://mac-mini-von-gary.tailcde074.ts.net"; }
        while (u.length() > 0 && u.substring(u.length() - 1, u.length()).equals("/")) { u = u.substring(0, u.length() - 1); }
        return u;
    }
    function token() { return Application.Storage.getValue("token"); }

    // POST /api/watch/pair { code, label } -> { token, name, label }
    function pair(code as String, done as Method) as Void { add(Communications.HTTP_REQUEST_METHOD_POST, "/api/watch/pair", { "code" => code, "label" => deviceLabel() }, done); }
    // GET /api/watch/strength/setup -> { ex: [{ id, n, t, s, b }], rest, unit, last }
    function setup(done as Method) as Void { add(Communications.HTTP_REQUEST_METHOD_GET, "/api/watch/strength/setup", null, done); }
    // GET /api/watch/summary -> { pts, prev, delta, sessions, strength, streak }
    function summary(done as Method) as Void { add(Communications.HTTP_REQUEST_METHOD_GET, "/api/watch/summary", null, done); }
    // POST /api/watch/strength { id, start, duration, sets: [{ ex, kg, reps, t }], hr? } -> { ok, id, prs, dup? }
    function session(s as Dictionary, done as Method) as Void { add(Communications.HTTP_REQUEST_METHOD_POST, "/api/watch/strength", s, done); }

    function deviceLabel() as String {
        // VERIFY: System.DeviceSettings has no product name; partNumber is a code. A fixed label is fine, the phone shows it.
        return "Garmin watch";
    }
    function add(verb, path as String, body, done as Method) as Void {
        jobs.add([verb, path, body, done]);
        next();
    }
    function next() as Void {
        if (busy || jobs.size() == 0) { return; }
        var j = jobs[0];
        jobs = jobs.slice(1, jobs.size());
        busy = true; cb = j[3];
        var headers = { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON };
        var t = token();
        if (t != null) { headers["Authorization"] = "Bearer " + t; }
        var options = { :method => j[0], :headers => headers, :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON };
        // VERIFY (Communications.makeWebRequest): a Dictionary body with nested Arrays / Dictionaries is sent as JSON when
        // Content-Type is REQUEST_CONTENT_TYPE_JSON; GET with null params sends no body. Response codes < 0 are phone / BLE errors.
        Communications.makeWebRequest(base() + j[1], j[2], options, method(:onResponse));
    }
    function onResponse(code as Number, data) as Void {
        busy = false;
        var c = cb; cb = null;
        if (c != null) { c.invoke(code, data); }
        next();
    }
}
