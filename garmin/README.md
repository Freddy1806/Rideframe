# RIDEFRAME for Garmin (Connect IQ watch app)

**Status:** step 1 (strength) compiled on a Mac (SDK 9.3.0, ~35 warnings). Step 2 (start menu, run / ride / more
recording, guided workouts, config) was written without an SDK in the container that wrote it and has **not been
compiled yet**. Every place where the API was not certain is marked `// VERIFY:` (full list below).

The design, the screens and the whole flow are in the browser preview `watch.html` (open `/watch.html` on the
RIDEFRAME host). `source/Flow.mc` is a line-by-line port of `js/watchflow.js`, which is unit-tested in Node
(`node --test tools/watchflow-test.mjs`). When you change the flow, change both.

Target watches: Forerunner 265 / 265S (416 / 360 px round AMOLED, touch + 5 buttons) and fenix 7X Pro / 7 Pro
(280 / 260 px round MIP, 64 colours, touch + 5 buttons), all on Connect IQ API 5.x.

## Files

| File | What it is |
| --- | --- |
| `manifest.xml` | watch-app, products fr265, fr265s, fenix7xpro, fenix7pro, minApiLevel 5.0.0, permissions Communications, Sensor, Fit, Positioning |
| `monkey.jungle` | project file (default `source/` and `resources/`) |
| `resources/settings/properties.xml` | `baseUrl` (default `https://mac-mini-von-gary.tailcde074.ts.net`), `recordActivity` (off) |
| `resources/settings/settings.xml` | both editable in the Garmin Connect app (app settings) |
| `source/Flow.mc` | the state machine (= `js/watchflow.js`), the recording state `Rec`, typed JSON readers (`numOf`, `strOf`, …) |
| `source/Fields.mc` | field ids, labels, units per sport, the built-in config (= `compact(defaults())`), `fieldText` (= `js/watchfields.js`) |
| `source/Sports.mc` | Strava type of a "more" sport → Garmin `Activity.SPORT_*` / `SUB_SPORT_*`, GPS or not, group name |
| `source/Draw.mc` | every screen drawn with `dc` calls, sizes as fractions of the screen (= `DRAW` in `js/watchsim.js`, `js/watchdraw.js`) |
| `source/FlowView.mc`, `source/FlowDelegate.mc` | one view, one BehaviorDelegate: buttons, holds, taps, swipes to flow events |
| `source/Api.mc` | `Communications.makeWebRequest` client, bearer token from `Application.Storage` |
| `source/Recorder.mc` | run / ride / more: `ActivityRecording` session, GPS (`Position`), one sample a second, the activity body, segment and route following once a second, the demo feed flag |
| `source/Feed.mc` | 19.11.: segment timing (`SegFeed`) and route following (`RouteTrack`) on the watch, flat arrays of local metres (= `js/watchfeed.js`, tests: `tools/watchfeed-test.mjs`) |
| `source/RideframeApp.mc` | app: flow, queues (strength, activities), caches, routes and segments calls, heart rate, vibration, optional strength `ActivityRecording` |
| `source/Glance.mc` | glance: week points and the change against last week |

One view for all screens on purpose: the flow decides the screen (exactly like the preview), so there is no view
stack to keep in step with it. BACK on the start screen leaves the app.

## Set up on a Mac

1. Install **Visual Studio Code** (code.visualstudio.com).
2. Download the **Connect IQ SDK Manager** from developer.garmin.com/connect-iq/sdk/, open it, sign in with a Garmin
   account, download the newest SDK and the devices **Forerunner 265**, **Forerunner 265S**, **fenix 7X Pro**,
   **fenix 7 Pro** (Devices tab). If macOS blocks it, allow it under System Settings → Privacy & Security.
3. In VS Code, install the extension **Monkey C** (publisher Garmin). Then Command Palette (⇧⌘P) →
   **Monkey C: Verify Installation**.
4. Developer key, once, and keep it (the same key is needed for every update):
   Command Palette → **Monkey C: Generate a Developer Key**, save it as `~/garmin/developer_key.der`.
   Or in Terminal:
   ```sh
   mkdir -p ~/garmin && cd ~/garmin
   openssl genrsa -out developer_key.pem 4096
   openssl pkcs8 -topk8 -inform PEM -outform DER -in developer_key.pem -out developer_key.der -nocrypt
   ```
   Then VS Code Settings → Extensions → Monkey C → Developer Key Path → `~/garmin/developer_key.der`.

## Build

In VS Code open the folder `garmin/` (File → Open Folder), then Command Palette → **Monkey C: Build for Device**
→ `fr265` (and again for `fenix7xpro`). Or in Terminal (the SDK's `bin` folder on the PATH, the SDK Manager shows it):

```sh
cd garmin
monkeyc -d fr265      -f monkey.jungle -o bin/rideframe-fr265.prg      -y ~/garmin/developer_key.der
monkeyc -d fenix7xpro -f monkey.jungle -o bin/rideframe-fenix7xpro.prg -y ~/garmin/developer_key.der
```

The first build will most likely stop at type errors (the code was never compiled). Fix them one by one; if the type
checker is too strict at first, VS Code Settings → Monkey C → Type Check Level → Gradual.

## Run in the simulator

Command Palette → **Monkey C: Run** (pick `fr265`), or `connectiq` (opens the simulator) and then
`monkeydo bin/rideframe-fr265.prg fr265`.

- The simulator makes the web requests itself from the Mac (no phone needed), so it talks to the live host directly.
  For a local server use an HTTPS address the Mac trusts, or change `baseUrl` in Simulator → File → Edit Application Settings (VERIFY menu name).
- Pairing: on the phone (or in the browser at the host) sign in, Settings → Devices → Garmin watch → **Pair a watch**,
  then type the 6 digits on the simulated watch with UP / DOWN / START.
- Heart rate: Simulator → Simulation → Activity Data (or FIT data playback) feeds the sensor.
- No phone: Simulator → Settings → Connection Type / "BLE" off (VERIFY menu name) shows the offline queue
  ("Will send when the phone is near").
- Storage: File → Edit Persistent Storage shows `token`, `setup`, `queue`, `summary`, `cfg`, `last`, `aqueue`.

## Put it on the watch (sideload)

1. Connect the watch with its USB cable. Newer Garmins (Forerunner 265, fenix 7 Pro) use **MTP**, which macOS does not
   mount: install **OpenMTP** (or Android File Transfer) to see the watch's files. VERIFY with your watch.
2. Copy `bin/rideframe-fr265.prg` (or the fenix one) into `GARMIN/APPS/` on the watch.
3. Unplug. The app shows up in the apps / activities list as **RIDEFRAME** (a sideloaded app may only appear after the
   watch has rebuilt its app list, give it a minute).
4. For the HTTP calls the watch needs **Garmin Connect Mobile** on the paired phone (it carries the requests over
   Bluetooth). Keep the phone near and the Garmin Connect app allowed to run in the background.

## API (tools/watch-api.mjs)

- `POST /api/watch/pair` `{ code: "123456", label }` → `{ token, name, label }` (code from the phone, 10 min, one use)
- `GET /api/watch/strength/setup` → `{ v, unit: "kg", rest, last: { at, sets, n } | null, ex: [{ id, n (≤ 18), t: "w" | "bw", s: [[kg, reps], …], b }] }`
- `POST /api/watch/strength` `{ id, start (Unix s), duration (s), sets: [{ ex, kg, reps, t (s since start) }], hr: { avg, max }? }`
  → `{ ok, id, prs, dup? }`; the same `id` twice is stored once. 400 / 413 = never send it again, anything else = retry.
- `GET /api/watch/summary` → `{ pts, prev, delta, sessions, strength, streak, week }`
- All with `Authorization: Bearer <token>`; 401 = the watch was removed on the phone (pair again).
- 19.11.: `POST /api/watch/activity`, `GET /api/watch/segments`, `GET /api/watch/routes`, `GET /api/watch/route`: see
  "Activities, segments, routes" below.

## Step 2: start menu, run / ride / more, workouts (18.11., ported to Monkey C, see "Port status" below)

Set up on the phone (Settings → Devices → **Watch screens & workouts**, `js/watchcfg.js`), kept per account in
`users/<id>/watch.json`, tried out in `watch.html` (it loads the signed-in account's config, else the defaults).
The tables (fields, defaults, top 20, "more" sports, limits) are in `js/watchfields.js`; the flow additions in
`js/watchflow.js` (tests: `tools/watchflow-test.mjs`). Port both like `Flow.mc`, one function per function.

API:

- `GET /api/watch/config` (watch token) → the compact form to keep in `Application.Storage` (`cfg`):
  `{ v: 1, run: { p: [["pace", "dist", "time", "hr"], …], map, seg, lap, pause, vib }, ride: { … }, other: { p: [[…]] },
  more: [["Basketball", "Basketball"], …], w: [{ id, n, it: [[ex, sets, reps, kg, rest], …] }], at }` (flags 0 / 1, at = Unix s).
  Up to 4 pages per sport, 1 to 4 field ids per page (field ids per sport in `FIELDS`), up to 40 more sports, 30 workouts × 20 items.
- `GET /api/watch/strength/setup` also brings `workouts` (the same `w`), `top` (the 20 standard exercise ids) and `recent`
  (ids done in the last 90 days, newest first, up to 8); every id in them is described in `ex`. Plank comes as `t: "time"`:
  its `reps` are seconds (stored as seconds in the strength record).
- Phone only (login token): `GET /api/watch/config` → `{ config, at, stored }`, `PUT /api/watch/config` (strict check, 400 with
  the reason, 413 over 64 KB).

Flow additions (`SCR`): `HOME` (start menu: Run, Ride, Strength, More, the last used on top, week points) → `READY` (GPS ready,
START) → `REC` (data pages from `cfg`, then the fixed route page when `map` is on and a route is loaded; UP / DOWN = page,
START = pause, BACK = lap, or first closes the segment popup) ⇄ `PAUSE` (Resume, Save, Discard) → `RSUM`. `MORE` lists
`cfg.more`, its sports record one fixed page. Strength: `HOME` → `START` → `SMODE` (Workout, Free) → `WPICK` → guided `SET`
(kg / reps / rest from the plan, the last planned set finishes) or `PICK` (recent, then top 20, then the rest).
Events: `sample` `{ dt, v, hr, pw, cad, up }` once a second from Position / Sensor (auto lap, auto pause, NP),
`seg` `{ k: "warn" | "live" | "end" | "none", name, len, eta, done, delta, need, time, pr, ref }` for the segment popup (result 5 s).
Outputs: cues `start`, `stop`, `lap`, `seg` (suppressed while recording with `vib: 0`), `out` `saveAct` (save the activity),
`routes` / `route` (19.11., the Route choice; answered with `setRoutes` / `setRoute`).

## Port status (step 2)

Ported from `js/watchflow.js` / `js/watchfields.js` / `js/watchsim.js` / `js/watchdraw.js`, same screens, events and numbers:

- **Start menu** (`S_HOME`): Run, Ride, Strength, More, the last used on top (`last` in Storage), week points and the
  change against last week from `/api/watch/summary`. BACK leaves the app. **More** (`S_MORE`) lists `cfg.more` with
  the group name under the selected row.
- **Config**: `GET /api/watch/config` after pairing and at every app start while `DeviceSettings.phoneConnected`, cached
  as `cfg` in Storage; until then (or when the cache is unusable) `Fields.defaultCfg()`, identical to
  `compact(defaults())` in `js/watchfields.js`. A new config changes the pages only while nothing records.
- **Run, Ride, More sports**: READY (GPS state for outdoor sports, heart rate for indoor ones, START) → REC → PAUSE
  (Resume, Save, Discard) → RSUM. Data pages from the config with the 1 to 4 field layouts of `js/watchdraw.js`, UP /
  DOWN (and swipe up / down) switch pages, START pauses, BACK = manual lap, BACK held = nothing while recording.
  Auto lap (1 km run, 5 km ride; the more sports have none, like the preview) with the 5 s banner and a vibration, auto pause below
  0.7 m/s when switched on (run / ride only). `Recorder.mc` keeps an `ActivityRecording` session in step: started on
  START, stopped while paused or auto paused, `addLap()` per flow lap, `save()` on Save (a normal Garmin activity,
  synced by Garmin Connect), `discard()` on Discard. Sport / sub sport per type in `Sports.mc` (generic fallback).
  Once a second (on the 200 ms timer) one `sample` from `Activity.getActivityInfo()`: speed, heart rate, cadence,
  power, ascent (delta of `totalAscent`), distance (delta of `elapsedDistance`, `dd`) and calories (`calories`); the
  last two replace the JS estimates when the watch has them. Nothing per second is kept in a growing list: 3 s power
  and the NP window are rings, laps are a count.
- **Strength**: START → `S_SMODE` (Workout / Free, only when there are workouts) → `S_WPICK` → guided `S_SET` with the
  planned kg / reps / rest ("SET 2 OF 3", the next planned set on the rest screen, Skip exercise in the menu, the last
  planned set finishes) or `S_PICK` in the free order (recent, then the 20 standard, then the rest). Logging, queue
  and upload unchanged.
- **Timed exercises** (`t: "time"`, reps are seconds): watch only (the preview has no clock for it): the first START
  starts the hold clock (counts up, "of 1:00" below), a triple vibration at the planned time, the second START logs
  the seconds held; BACK while it runs cancels it.
- **Route page and segment popup**: drawing and state (`Flow.setRoute`, `E_SEG` events, `Draw.routePage`,
  `Draw.segScreen`) like the preview, fed since 19.11. by the watch itself (see below). `DEMO_FEED` in `Recorder.mc`
  (`false`): set it `true` in the simulator without a phone to get the demo routes (Riverside 8k chosen) and a demo
  segment 30 s into a run or ride; it turns the real segment and route following off.
- **Colours**: AMOLED (fr265) black with the RIDEFRAME sport colours; MIP (fenix) only 64-colour palette colours,
  white field labels, light grey (not dark grey) far list rows (`Palette` in `Draw.mc`).
- **Touch** (fr265, fenix 7 Pro): taps on list rows / home rows / START pill, swipes as in the preview (`FlowDelegate.onTap`).

Not ported on purpose: the preview's panel, demo data, keyboard. `js/watchflow.js` is unchanged (its comment in
`setConfig` says a running recording keeps its pages; the JS does not do that, the watch does).

## Activities, segments, routes (19.11.)

Server: `tools/watch-feed.mjs` (tests: `tools/watch-feed-test.mjs`), wired in `tools/watch-api.mjs`. Watch: `Api.mc`,
`RideframeApp.mc`, `Recorder.mc`, `Feed.mc`. Preview: `js/watchsim.js` (Route choice), `js/watchfeed.js` (the tested twin
of `Feed.mc`). All watch calls with the bearer token; 401 = pair again; each limited per watch (429 = later).

**Activity upload.** At Save `Recorder.activityBody()` builds the body, `RideframeApp.queueAct()` puts it into Storage
`aqueue` (at most 10, oldest first) and sends it like the strength queue: at app start, after Save, and every 30 s while
something waits. 200 (also `dup` / `merged`) and 400 / 413 drop it, anything else keeps it.

```
POST /api/watch/activity            Authorization: Bearer <watch token>, body at most 4 KB, only these keys
{ "id": "3fa2c91b6744e0a1",          6-40 chars [A-Za-z0-9_-], the same id twice = stored once
  "type": "Run" | "Ride" | "<Strava type of a more sport, e.g. Hike>",
  "start": 1763450000,               Unix seconds, within the last 60 days
  "duration": 3720,                  s, start to Save
  "moving": 3540,                    s, the timer (pauses and auto pauses excluded), at most duration + 60
  "dist": 10230, "climb": 84,        m
  "hr": 151, "maxHr": 178,           bpm, 0 = no sensor
  "kcal": 712,
  "power": 221,                      W, optional (rides)
  "laps": 11 }                       optional, a count (stored as nLaps)
→ { "ok": true, "id": "watch-…", "dup"?: true, "merged"?: true }
```

Stored as a ride record `users/<id>/rides/watch-<id>.json` (`source: 'watch'`), synced to the phone like any ride.
Dedupe with the Strava import, both orders (same family, start ± 2 min, duration ± 5 %): Strava first → the watch numbers
go into the Strava ride (`merged: true`, `watch: <id>`); watch first → the import links the Strava activity to the watch
ride (`js/actimport.js` `mergeAct`), and the feed / profile / summary show one entry (`collapse`). Strength the same way:
a Strava `WeightTraining` within 2 min links to the `kraft/watch-<id>` session (`linkStrength`).

**Segments near the watch.** At the start of a run / ride (with `seg` on, a GPS fix, the phone connected) and again every
3 km recorded, never while a segment is timed; a failed call is tried again after 60 s.

```
GET /api/watch/segments?lat=47.37000&lon=8.54000&type=run|ride
→ { "segs": [{ "id", "n" (name, ≤ 24), "len" (m), "pr" (s, 0 = none), "kom" (s, 0 = none),
               "p": [[lat, lon], …] (≤ 40 points, 5 decimals) }], "strava": true }      at most 8, nearest first, < 8 KB
→ { "segs": [], "strava": false }    the account has no Strava link (the phone sends its Strava key with the watch calls)
```

Cached per watch by rounded position (2 decimals) and type for 5 min. Timed on the watch by `Feed.mc` `SegFeed` (rules
in its header): warning within 300 m (or under 45 s away) when closing in and heading at the start or along the first
leg, start within 25 m, progress on the nearest point in a forward window, finish within 25 m of the end, lost after more
than 60 m off for more than 10 s. Live delta = elapsed - reference × progress, needed speed = `js/navroute.js needSpeed`
(0 = out of reach: "PR out of reach"); the reference is the PR, else the KOM ("ref"), else none (the time runs).

**Routes.** Sent from the phone: Outdoor → Routes sheet → **Send to watch** per route (signed in only), stored per account
(`users/<id>/watch-routes.json`, at most 20, a simplified copy of at most 500 points). The ready screen of a run / ride
has a **Route** line: UP / DOWN or a tap opens the list (None, then the routes with length and climb).

```
phone (X-RF-Token): GET /api/watch/routes, PUT /api/watch/routes/<id> { name, pts: [[lat, lon, ele?]] } (409 = 20 already),
                    DELETE /api/watch/routes/<id>, GET /api/watch/route?id= (the preview without a watch)
watch:  GET /api/watch/routes → { "routes": [{ "id", "name" (≤ 24), "dist" (m), "climb" (m) }] }
        GET /api/watch/route?id=<id> → { "id", "name", "dist", "climb", "p": [[lat, lon], …] (≤ 200, 5 decimals),
                                         "turns": [[at (m), "L" | "R" | "U"], …] (≤ 80) }      < 12 KB
```

`Feed.mc` `RouteTrack` follows it: on the route within 40 m (ahead first, so out and back works), off after 8 s further
away ("OFF ROUTE, 120 m away" instead of the next turn), metres along for the distance left and the next turn, the real
position as the dot. The route page draws the flat `u` / `v` points of `RouteTrack.face` (one scale, north up).

## Permissions (manifest.xml)

| Permission | For |
| --- | --- |
| `Communications` | `makeWebRequest` through Garmin Connect Mobile (pair, setup, summary, config, strength and activity upload, segments, routes) |
| `Sensor` | heart rate between sets (`Sensor.enableSensorEvents`) |
| `Fit` | `ActivityRecording`: run / ride / more as Garmin activities, the optional strength activity |
| `Positioning` | GPS for outdoor recordings (`Position.enableLocationEvents`), segment timing and route following |

## Memory

The public device list (developer.garmin.com/connect-iq/compatible-devices) gives API 5.2 for all four watches but
no memory limits. They are in the SDK: `~/Library/Application Support/Garmin/ConnectIQ/Devices/<fr265|fr265s|fenix7pro|fenix7xpro>/compiler.json`
(`appTypes` → `watchApp` / `glance` → `memoryLimit`); the simulator shows the use under File → View Memory. Fill in:

| Device | watch-app | glance |
| --- | --- | --- |
| fr265 / fr265s | ? | ? |
| fenix7pro / fenix7xpro | ? | ? |

What the app keeps: the strength setup (< 8 KB from the server), the config (up to ~48 KB of JSON at the limits: 30
workouts × 20 items, usually a few KB), the queue, one `Rec` with two small rings. Look at the peak in View Memory with
a full config; if it is tight, keep `w` (workouts) out of `cfg` (the setup brings them too). Recorder code is outside
the `(:glance)` app class so the glance does not load it. 19.11.: segments (8 × 40 points) and the route (200 points) are
kept as flat `Array<Float>` (x, y, metres along; the route also u, v), about 3 000 numbers at most; no per-second lists.
The JSON answers (< 8 KB, < 12 KB) are dropped after they are turned into these arrays.

## VERIFY items (30)

`grep -rn VERIFY source manifest.xml resources`

- **Recorder.mc** (5): `createSession` takes `Activity.SPORT_*` / `SUB_SPORT_*` (and the API 4.1.6 constants in
  Sports.mc); `Position.Info.accuracy` is a `Position.Quality`; `Activity.Info.currentCadence` on a run is steps per minute;
  `Position.Location.toDegrees()` gives Doubles; `Position.Info.heading` is radians from north.
- **Feed.mc** (1): the `d` suffix for Double literals.
- **Sports.mc** (1): run sub sport `SUB_SPORT_STREET` or `SUB_SPORT_GENERIC` (what the watch's Run app writes).
- **Fields.mc** (1): `Math.pow` result type for NP.
- **Draw.mc** (7): `requiresBurnInProtection` tells AMOLED from MIP; `Gregorian.info(...).day_of_week` is a String with
  `FORMAT_MEDIUM`; the glyphs of `FONT_NUMBER_*` (digits, `:`, `.`, `-`; anything else uses text fonts) (2×); "PR"
  in `FONT_LARGE` may look small; the unit's vertical place next to a number; the two XTINY lines on the ready screen
  (data pages, route) do not touch.
- **Api.mc** (3): device label; JSON body / GET without body / negative codes in `makeWebRequest`; a query string in
  the URL of a GET with null params.
- **FlowDelegate.mc** (1): returning true from `onKeyPressed` / `onKeyReleased` stops onSelect / onBack / onNextPage.
- **RideframeApp.mc** (7): `(:glance)` on the app class; what onStart may do in the glance; the system closing the app
  mid-workout; the size limit of one Storage value (queue); which exception a too large value throws (`store`, `saveActs`);
  sets as laps in the native strength activity.
- **Glance.mc** (2): Storage readable in the glance; glance colours.
- **manifest.xml** (1): product ids.
- **resources/drawables/drawables.xml** (1): launcher icon size.

Most likely to fail the build, in order: the `Activity.SPORT_*` / `SUB_SPORT_*` enum return types in `Sports.mc` and
the API 4.1.6 constants; null narrowing of `Rec or Null` / `Dictionary or Null` members (all are copied to a local and
checked with a plain `if` first); `Math.pow(...) as Float`; `try { } catch (e) { }` in `store`; `String.substring`
returning `String or Null` (cast with `as String`). 19.11. (`Feed.mc`): Double literals (`6371008.8d`) and Double / Float
mixing in `Proj` (untyped members on purpose); `Array` elements cast with `as Float` / `as Number` from `fdNearest`'s
`[index, distance, along]`; `Lang.Object.toString()` on a segment id that comes as a Number; the same local name (`s`, `o`,
`rf`) in sibling blocks of `SegFeed.step`.

## Simulator test script (step 2, 19.11. additions in 10 to 13)

Build for `fr265` and again for `fenix7xpro`, run, pair (or put a `token` into File → Edit Persistent Storage).

1. **Start menu**: Run, Ride, Strength, More with the week points at the bottom; UP / DOWN wrap, a tap on a row opens
   it; BACK leaves. Restart: the sport used last is on top.
2. **Config**: Settings → Connection Type / "BLE" off → start: the defaults (run 2 pages, ride 2 pages). Back on → the
   account's config (change a page on the phone, restart the app). File → Edit Persistent Storage shows `cfg`.
3. **Run**: Simulation → Activity Data (or File → playback of a FIT / GPX file of a run): READY shows "GPS search",
   then "GPS ready" with a fix (Simulation → Set Position / GPS quality if the menu has it). START: the page with pace,
   distance, time, heart rate; UP / DOWN and swipe up / down: page 2; BACK: lap banner "LAP 1" for 5 s with a long
   vibration; after 1 km of playback: an auto lap. START: PAUSED menu; Resume; START, Save: SAVED with time, km,
   pace, kcal; the simulator writes the FIT file of the saved activity (check where on the Mac).
4. **Ride**: as 3 with a ride FIT file (power, cadence): auto pause shows "AUTO PAUSE" and the ring turns dim while the
   playback stands still; auto lap at 5 km; the summary shows km/h and AVG W. Discard: back on the start menu, nothing saved.
5. **More**: More → Yoga (indoor: heart rate, no GPS) and Hike (GPS): one page heart rate, time, clock, calories;
   Save: the summary shows KCAL and LAPS, the activity's sport is Training / Yoga and Hiking.
6. **Strength, workout**: needs a workout set up on the phone. Strength → START → Workout → the workout: "SET 1 OF 3"
   with the planned kg / reps; DONE → rest with the planned rest and the next set; the last planned set ends on the
   summary. Menu (BACK held): Skip exercise. A plank in the workout: START starts the clock, a vibration at the planned
   seconds, START logs them.
7. **Strength, free**: Free → the picker starts with the recent exercises, then the standard 20; the session uploads
   as before (Settings → Connection Type off: "Will send when the phone is near", on again: SAVED).
8. **Route page / segment, demo** (only with `DEMO_FEED = true`, rebuild): READY says "+ route" and "Route: Riverside 8k",
   the last page is the route with the next turn; 30 s into a run the segment popup counts down, then shows ahead /
   behind, then the result for 5 s (BACK closes it first; BACK again is a lap). DOWN on READY: None takes the route page away.
9. **fenix 7X Pro** (MIP): every screen once more; no dark grey text, field labels white, colours unchanged by the
   64-colour palette.
10. **Activity upload** (`DEMO_FEED = false`, paired): record a short run, Save. File → Edit Persistent Storage: `aqueue`
    has it while the connection is off, empty after it is back (within 30 s); on the phone it shows under Activities
    ("Recorded on watch"). With the same run on Strava (or a Strava import afterwards): one entry, not two.
11. **Routes**: on the phone, Outdoor → Routes → **Send to watch** on a route. On the watch, Run → READY → DOWN: the list
    (None, the route with km and climb); pick it: "Route: <name>", START: the route page is the last page. Play a GPX of
    that route (Simulation → playback): the dot moves along, the distance left shrinks, the next turn counts down. Play a
    GPX that leaves the route: after 8 s "OFF ROUTE" with the metres; back on it, the turn again.
12. **Segments**: an account linked to Strava (the phone sent its key once with a watch call). Play a GPX along a known
    segment: about 300 m before the start "SEGMENT IN" with the countdown (only when heading to it), at the start the
    live delta against the PR (or KOM) with the needed pace / speed, at the end the result for 5 s; leave the segment for
    more than 10 s: the popup goes. Without a Strava link nothing shows (the answer is `strava: false`).
13. **Every 3 km**: on a long playback the watch asks again (server log: `GET /api/watch/segments` about every 3 km), never
    while a segment is timed.

## Native activity (optional, off by default)

With the app setting **Also save as a Garmin activity** the workout is also recorded as a strength activity
(`ActivityRecording`, one lap per set) and lands in Garmin Connect. If Garmin Connect passes it on to Strava, the
Strava `WeightTraining` is linked to the watch session (start within 2 minutes, both orders, 19.11.) instead of
becoming a second session.

## Check first on a real watch

1. It compiles for `fr265` and `fenix7xpro`; fix every `VERIFY` (`grep -rn VERIFY source manifest.xml resources`).
2. The launcher icon shows (size per device), the app opens, BACK on the start screen closes it.
3. Buttons: UP / DOWN step once on a press and keep stepping when held (10 kg); BACK switches weight / reps; BACK held
   opens the menu; START logs the set. No double events (a press must not also trigger onSelect / onNextPage).
4. Touch: tap a value, swipe up / down to change it, tap DONE; swipe left opens the menu; swipe right is not taken by
   the system as "leave the app".
5. Pairing with the code over Garmin Connect Mobile on the iPhone (HTTPS to the ts.net host works, no certificate error).
6. A whole session with the phone away: "Will send when the phone is near", then it arrives after the phone is back
   and shows on the phone under Activities with "Recorded on watch".
7. Vibration cues are strong enough mid-set (set saved, record, rest over) and the rest timer returns by itself.
8. Heart rate shows on the rest screen; the numbers stay readable in sunlight on the fenix (MIP) and the AMOLED does
   not stay on full brightness longer than needed.
9. The glance shows the week points after the app ran once.
10. Battery over a 60 minute session (the 200 ms timer and the heart rate sensor are the main cost).
11. A real run and ride: GPS fix time on the ready screen, pace / distance against the watch's own Run app, auto lap
    at 1 km / 5 km, auto pause at traffic lights, the saved activity in Garmin Connect with the right sport and laps.
12. A ride with a power meter and a cadence sensor paired on the watch: power, 3 s power, NP and cadence fields fill.
13. A guided workout with a plank: the hold clock and its vibration at the planned time.
