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
| `manifest.xml` | watch-app, products fr265, fr265s, fenix7xpro, fenix7pro, fenix8solar47mm, minApiLevel 5.0.0, permissions Communications, Sensor, Fit, Positioning, FitContributor, BluetoothLowEnergy, UserProfile, SensorHistory (25.11.) |
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
| `source/Health.mc` | 25.11.: `healthSnapshot()`: Garmin's own recovery values (body battery, recovery time, stress, resting HR, VO2max, respiration, SpO2, steps) from `UserProfile`, `ActivityMonitor` and `SensorHistory` (no sleep score: `Toybox.Complications` is not allowed for a watch-app), every read guarded; sent as `POST /api/watch/health` at the start and before each upload (= `js/watchflow.js healthBody`, tests: `tools/watchflow-test.mjs`, `tools/health-test.mjs`) |
| `source/Trainer.mc` | 23.11.: the indoor trainer as pure state machines: `TLink` (scan, connect, FTMS / Wahoo setup, latest-wins target, lost / refused) and `TRide` (target steps, seconds, NP, the upload's series) (= `js/watchtrainer.js`, tests: `tools/watchtrainer-test.mjs`) |
| `source/TrainerBle.mc` | 23.11.: the radio: `TLink.act` to `Toybox.BluetoothLowEnergy`, the `BleDelegate` callbacks back as `E_BLE` events (the preview's twin is the pretend KICKR `js/watchkickr.js`) |

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

**On-device tests (23.11.8).** `tests/` holds only `(:test)` code (left out of the app build): `smokeWalk` drives the flow with
random buttons, taps, swipes, drags and wheel turns plus scripted trips through the indoor trainer (a pretend FTMS trainer over
`E_BLE`) and a saved run, and draws every screen with `Draw.screen` on the watch's own fonts (it fails when TREC, TEND, TSUM, RSUM
or another main screen was never reached); `measureFonts` logs the fonts' height / ascent / descent and worst-case widths (to compare
with `js/watchfontdata.js`); `layoutCheck` checks the layout helpers on worst-case texts. Run them per watch, also with the fenix 8's
font size setting at its largest:

```sh
monkeyc -d fenix8solar47mm -f monkey.jungle -o bin/test.prg -y ~/garmin/developer_key.der -t
monkeydo bin/test.prg fenix8solar47mm -t
```

**Layout.** `source/Draw.mc` and `js/watchscreens.js` are the same code; `node --test tools/watch-layout-test.mjs` checks every
screen of `js/watchscreens.js` on all five watches (fenix 8 also at font size 0.8 and 1.45) and that both files have the same
numbers function by function. A layout change goes into both. `node tools/watch-layout.mjs [scene]` prints the findings,
`node tools/watch-sheets.cjs <dir> <device> <scale>` draws contact sheets (with `GARMIN_FONTS` set: in the device fonts, which are
not in the repo).

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
- 23.11.: `POST /api/watch/workout` `{ id, n, it: [[ex, sets, reps, kg, rest], …] }` (body ≤ 8 KB, 1 to 20 items): a workout saved
  on the watch ("Save as workout?"). The same `id` replaces its items (the phone's name stays), a new `id` is added (400 at 30:
  "Up to 30 workouts. Delete one on the phone."). Stored in the account's watch config, so it shows on the phone under
  Settings → Devices → Watch screens & workouts and as **Watch workouts** on the strength page (`js/kraft.js`), and comes
  back to the watch with the next config / setup. Queued like a session (a queue entry with `tpl`); answer `{ ok, id, new }`.
- 23.11.: `POST /api/watch/activity` takes up to 8 KB now and, for the indoor trainer (`type: "VirtualRide"`), also `maxPower`, `np`,
  `kj`, `cad` and the series `s: { dt (1..600 s), pw, cad, hr, tgt }` (at most 400 values each). Stored as an indoor ride with
  power (Activities shows Avg / Max power, Cadence, the power chart from the series); a Strava twin is merged, not doubled.

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
START = pause, BACK = lap, or first closes the segment popup) ⇄ `PAUSE` → `RSUM`. `PAUSE` is one screen in every mode (strength:
the menu's Pause; its clock and a running rest stop): START resumes, BACK held 3 s saves (an orange ring with 3-2-1, released
early = nothing; on the touch face also a finger on the "Hold to finish" pill; events `holdStart` / `holdEnd`), a short BACK
only shows the hint, DOWN / a tap reaches Discard with a confirm step (START yes, BACK no). `MORE` lists
`cfg.more`, its sports record one fixed page. Strength (23.11.): `HOME` → `START` → `SMODE` (one list: **Exercises**, then the saved workouts; skipped when there are none) →
`PICK` (a workout's exercises first with "1/4 sets", then the rest: recent, top 21, the others) ⇄ `SET` → `REST` → `SET` ….
`SET`: START on kg goes to reps, START on reps logs; the DONE pill (touch) logs at once; START held 0.7 s (`startHold`)
switches kg / reps; a tap on a value focuses it. BACK in `SET` / `REST` → `PICK` (the exercise just done selected); BACK in
`PICK` → `END` (Keep training / Finish & save / Discard, Discard asks again) when sets are logged, else back to `SMODE`.
Finish → `SUM` (paged: totals with avg / max heart rate, then one page per exercise) → `SAVEQ` "Save as workout?" (Update
<name> / Save as new / No; not asked when a saved workout was done exactly as planned) → `HOME`. Lists scroll with the finger
(`scroll` event, one row per 0.1 of the screen dragged, `DRAG_ROW`); a swipe still moves one row.
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
  (START resume, BACK held 3 s = save, Discard with a confirm) → RSUM. Data pages from the config with the 1 to 4 field layouts of `js/watchdraw.js`, UP /
  DOWN (and swipe up / down) switch pages, START pauses, BACK = manual lap, BACK held = nothing while recording.
  Auto lap (1 km run, 5 km ride; the more sports have none, like the preview) with the 5 s banner and a vibration, auto pause below
  0.7 m/s when switched on (run / ride only). `Recorder.mc` keeps an `ActivityRecording` session in step: started on
  START, stopped while paused or auto paused, `addLap()` per flow lap, `save()` on Save (a normal Garmin activity,
  synced by Garmin Connect), `discard()` on Discard. Sport / sub sport per type in `Sports.mc` (generic fallback).
  Once a second (on the 200 ms timer) one `sample` from `Activity.getActivityInfo()`: speed, heart rate, cadence,
  power, ascent (delta of `totalAscent`), distance (delta of `elapsedDistance`, `dd`) and calories (`calories`); the
  last two replace the JS estimates when the watch has them. Nothing per second is kept in a growing list: 3 s power
  and the NP window are rings, laps are a count.
- **Strength** (23.11. rework, = `js/watchflow.js`): START → `S_SMODE` (Exercises + the workouts, only when there are
  workouts) → `S_PICK` → `S_SET` / `S_REST` with heart rate and clock on both; BACK → `S_PICK` → `S_END`; Finish → paged
  `S_SUM` → `S_SAVEQ` (`saveTpl` queues `{ id: "t…", tpl }`, `RideframeApp.push` sends it to `Api.workout`, `O_TPL` keeps
  setup and cfg). The rest screen shows the last 3 sets of the exercise and NEXT (the next set, or the next exercise of
  the workout). A workout set may also be left for a free exercise and picked up again from the list. Events `E_SCROLL`,
  `E_DONE`, `E_START_HOLD`. Front squat (`frontsquat`) is in the top list and the phone catalogue.
- **Timed exercises** (`t: "time"`, reps are seconds): watch only (the preview has no clock for it): the first START
  starts the hold clock (counts up, "of 1:00" below), a triple vibration at the planned time, the second START logs
  the seconds held; BACK while it runs cancels it.
- **Route page and segment popup**: drawing and state (`Flow.setRoute`, `E_SEG` events, `Draw.routePage`,
  `Draw.segScreen`) like the preview, fed since 19.11. by the watch itself (see below). `DEMO_FEED` in `Recorder.mc`
  (`false`): set it `true` in the simulator without a phone to get the demo routes (Riverside 8k chosen) and a demo
  segment 30 s into a run or ride; it turns the real segment and route following off.
- **Colours**: AMOLED (fr265) black with the RIDEFRAME sport colours; MIP (fenix) only 64-colour palette colours,
  white field labels, light grey (not dark grey) far list rows (`Palette` in `Draw.mc`).
- **Touch** (every device with `DeviceSettings.isTouchScreen`, fenix 8 Solar included; 23.11.): taps on list rows (4 rows, each
  tap zone at least 0.17 S = 44 px high on 260 px), the DONE pill, kg / reps; lists follow the finger (`onDrag`); swipes as in the preview.

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

## Indoor trainer (23.11.)

ERG rides on the watch against a smart trainer (the owner's Wahoo KICKR Core 2), like the Wahoo app's ERG page. The flow is
in `js/watchtrainer.js` + `js/watchflow.js` (tested, `tools/watchtrainer-test.mjs`) and ported to `Trainer.mc` + `Flow.mc`; the
preview (`watch.html`) runs it against a pretend KICKR (`js/watchkickr.js`, panel: "in range", "Another app controls the trainer").

**Use.** Home → **Indoor trainer** (5th entry, after Ride). The watch searches (FTMS trainers first, then power-only devices
with Cycling Power and a name); a tap or START connects; the trainer used last connects by itself. States: Searching,
Connecting, Connected (ERG ready, or "Power only, no ERG"), **Refuses control** (another app has it: close it, or ride without
ERG), **Lost · reconnecting** (keeps trying the whole ride, the target is sent again when it is back). START rides:
the target big (start = the last target, default 100 W, 30 to 1000 W), UP / DOWN = ± the step (held: 25 W), a tap on the
left / right half = − / +, a tap on the target = step 5 / 10 / 25 W; power, cadence, heart rate and the time below. START =
pause (the clock stops, the trainer goes to 30 W) / resume. Swipe up / down = the stats page (this target's time and
average, the ride's avg / max / NP / kJ / cadence / heart rate). BACK = the menu (Resume, Stats page, Finish & save,
Discard with a second step); the menu does not pause. Finish & save: the summary (time, avg / max power, kJ, cadence,
avg / max heart rate), the trainer is let go (the laptop can take it).

**Recording.** `Recorder.openTrainer`: a native `ActivityRecording` session, `SPORT_CYCLING` / `SUB_SPORT_INDOOR_CYCLING`,
heart rate from the watch as always, power (`UINT16`, `:nativeNum => 7`), cadence (`UINT8`, `:nativeNum => 4`) and the ERG
target (`target_power`, a plain developer field) through `FitContributor`, once a second. Limits: Connect IQ cannot pair the
trainer as a watch sensor, so the watch's own power / cadence fields stay empty; whether Garmin Connect treats the native-number
fields as its own power and cadence is not confirmed (VERIFY; otherwise they show as the app's charts). No speed or distance
is recorded. RIDEFRAME gets the ride from the watch itself (`POST /api/watch/activity`, `VirtualRide`, avg / max / NP power,
kJ, cadence, the series every 10 s, at most 240 values, halved when full), not from the FIT file.

**BLE design** (`TrainerBle.mc`, one GATT operation at a time):
- Profiles, registered one after the other (a second `registerProfile` before the first answered fails on some watches):
  FTMS `0x1826` with Indoor Bike Data `0x2AD2` and Control Point `0x2AD9`; Cycling Power `0x1818` with `0x2A63` and the
  Wahoo control `a026e005-0a7d-4ab3-97fa-f1500f9feb8b`. Each carries the CCCD. 2 of the 3 allowed profiles.
- Scan (`setScanState`, `onScanResults`): a trainer needs a name and `0x1826` or `0x1818` among its service UUIDs. Connect:
  `pairDevice(ScanResult)` (the `ScanResult` of this scan, it cannot be stored), then `onConnectedStateChanged`.
- FTMS setup: notify on `0x2AD2` (`01 00`), indicate on `0x2AD9` (`02 00`), write `0x00` (request control), `0x07` (start),
  then `0x05` + watts (LE). The answer `0x80 op result`: `0x01` ok, anything else (`0x05` not permitted) = **Refuses control**,
  asked again every 5 s. No indication within 3 s after the setup = taken as control (VERIFY on the KICKR Core 2).
  Wahoo fallback: unlock `0x20 0xEE 0xFC`, ERG `0x42` + watts. A power meter without control is only read.
- Latest wins: a target is never queued; when the line is free and the trainer does not have the newest target, exactly
  one write goes out. Every write is with response; its `onCharacteristicWrite` / `onDescriptorWrite` frees the line (or 3 s).
- Lost: the watch may reconnect by itself; if not within 15 s, unpair and pair again from a new scan, the whole ride.
- Never two controllers: the watch does not fight for the trainer, it shows that another app has it (laptop, Zwift, Wahoo app).

**Monkey C API used** (level from the API docs): `Toybox.BluetoothLowEnergy` 3.1.0 (`registerProfile`, `setScanState`,
`pairDevice`, `unpairDevice`, `setDelegate`, `cccdUuid`, `stringToUuid`, `BleDelegate.onScanResults` / `onConnectedStateChanged`
/ `onCharacteristicChanged` / `onCharacteristicWrite` / `onDescriptorWrite` / `onProfileRegister`, `Characteristic.requestWrite`
with `:writeType`, `Descriptor.requestWrite`, `ScanResult.getDeviceName` / `getServiceUuids` / `getRssi`, `Device.getService`,
`Service.getCharacteristic`, `Characteristic.getDescriptor`); `ActivityRecording.Session.createField` with `:nativeNum`
(`FitContributor`, 1.3.0; `:nativeNum` per the Session page); `Activity.SUB_SPORT_INDOOR_CYCLING`. All are below the
manifest's `minApiLevel` 5.0.0.

Sources:
- API: [BluetoothLowEnergy](https://developer.garmin.com/connect-iq/api-docs/Toybox/BluetoothLowEnergy.html) (profiles: "the
  current limit is 3"; `pairDevice` "does not persist across application instances"),
  [BleDelegate](https://developer.garmin.com/connect-iq/api-docs/Toybox/BluetoothLowEnergy/BleDelegate.html),
  [Characteristic](https://developer.garmin.com/connect-iq/api-docs/Toybox/BluetoothLowEnergy/Characteristic.html) (more than
  20 bytes: `InvalidRequestException`), [ScanResult](https://developer.garmin.com/connect-iq/api-docs/Toybox/BluetoothLowEnergy/ScanResult.html),
  [Device](https://developer.garmin.com/connect-iq/api-docs/Toybox/BluetoothLowEnergy/Device.html),
  [ActivityRecording.Session](https://developer.garmin.com/connect-iq/api-docs/Toybox/ActivityRecording/Session.html) (`createField`, `:nativeNum`).
- One operation at a time ("Operation already in progress"):
  [258434](https://forums.garmin.com/developer/connect-iq/f/discussion/258434/how-to-do-multiple-successive-btle-characteristic-requestwrite),
  [406309](https://forums.garmin.com/developer/connect-iq/f/discussion/406309/can-t-write-ble-second-message-on-a-edge-530).
- FTMS notifications that did not arrive: [282112](https://forums.garmin.com/developer/connect-iq/f/discussion/282112/ble-notification-not-appearing-for-ftms-ble).
- `onProfileRegister` status 2 on back-to-back registrations:
  [bug report](https://forums.garmin.com/developer/connect-iq/i/bug-reports/vivoactive-4-bledelegate-onprofileregister-returns-status-value-2-on-every-2nd-and-3rd-registerprofile).
- `onConnectedStateChanged` not called when the device is paired to the phone:
  [332580](https://forums.garmin.com/developer/connect-iq/f/discussion/332580/onconnectedstatechanged-is-never-called-after-a-ble-pairing-request).
- A `ScanResult` cannot be kept in Storage: [281789](https://forums.garmin.com/developer/connect-iq/f/discussion/281789/ble-register-and-limit-connections/1353034).
- FTMS client ideas: [206704](https://forums.garmin.com/developer/connect-iq/f/app-ideas/206704/developing-a-ciq-ble-client-for-treadmill-and-fitness-equipment/971778);
  an app doing FTMS ERG with native FIT fields on the fenix 8 (author: simulator-tested):
  [445299](https://forums.garmin.com/developer/connect-iq/f/showcase/445299/free-garmin-indoor-workout-app-structured-bike-and-run-workouts-with-smart-trainer-support).

## Permissions (manifest.xml)

| Permission | For |
| --- | --- |
| `Communications` | `makeWebRequest` through Garmin Connect Mobile (pair, setup, summary, config, strength and activity upload, segments, routes) |
| `Sensor` | heart rate between sets (`Sensor.enableSensorEvents`) |
| `Fit` | `ActivityRecording`: run / ride / more as Garmin activities, the optional strength activity |
| `Positioning` | GPS for outdoor recordings (`Position.enableLocationEvents`), segment timing and route following |
| `FitContributor` | 23.11.: the trainer's power, cadence and ERG target in the indoor ride's FIT file (`Session.createField`) |
| `BluetoothLowEnergy` | 23.11.: the indoor trainer (FTMS / Wahoo) over `Toybox.BluetoothLowEnergy` |
| `UserProfile` | 25.11.: resting heart rate and VO2max for the recovery snapshot (`Health.mc`) |
| `SensorHistory` | 25.11.: the newest body battery sample (`getBodyBatteryHistory`) |

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

## VERIFY items (50)

`grep -rn VERIFY source manifest.xml resources`

- **Recorder.mc** (8): `createSession` takes `Activity.SPORT_*` / `SUB_SPORT_*` (and the API 4.1.6 constants in
  Sports.mc); `Position.Info.accuracy` is a `Position.Quality`; `Activity.Info.currentCadence` on a run is steps per minute;
  `Position.Location.toDegrees()` gives Doubles; `Position.Info.heading` is radians from north; 23.11.: FitContributor fields
  with `:nativeNum` 7 / 4 count as power / cadence in Garmin Connect (2×); `SUB_SPORT_INDOOR_CYCLING`.
- **Trainer.mc** (3): an FTMS trainer that does not indicate the control request is taken as controlled after 3 s; the watch
  reconnects a paired trainer by itself after a drop; `Math.pow` result type.
- **TrainerBle.mc** (5): the `registerProfile` dictionary keys; scanning before the profiles are registered; `onConnectedStateChanged`
  after `pairDevice`; the KICKR's name in the scan response; `Device.equals`.
- **Feed.mc** (1): the `d` suffix for Double literals.
- **Sports.mc** (1): run sub sport `SUB_SPORT_STREET` or `SUB_SPORT_GENERIC` (what the watch's Run app writes).
- **Fields.mc** (1): `Math.pow` result type for NP.
- **Draw.mc** (12): `isTouchScreen` is true on the fenix 8 (23.11.); the rest screen's clock font and its three XTINY set rows
  fit on 260 px (23.11., 2×); `requiresBurnInProtection` tells AMOLED from MIP; `Gregorian.info(...).day_of_week` is a String with
  `FORMAT_MEDIUM`; the glyphs of `FONT_NUMBER_*` (digits, `:`, `.`, `-`; anything else uses text fonts) (2×); "PR"
  in `FONT_LARGE` may look small; the unit's vertical place next to a number; the two XTINY lines on the ready screen
  (data pages, route) do not touch.
- **Api.mc** (3): device label; JSON body / GET without body / negative codes in `makeWebRequest`; a query string in
  the URL of a GET with null params.
- **FlowDelegate.mc** (4): returning true from `onKeyPressed` / `onKeyReleased` stops onSelect / onBack / onNextPage;
  `onHold` / `onRelease`; 23.11.: START held (`KEY_ENTER`) reaches the app; `onDrag` / `DragEvent` (API 3.3.0) on the fenix 8.
- **RideframeApp.mc** (8): pause / resume of the strength `ActivityRecording`; `(:glance)` on the app class; what onStart may do in the glance; the system closing the app
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
   vibration; after 1 km of playback: an auto lap. START: the PAUSED screen; START resumes; START, then BACK held 3 s (the ring fills, 3-2-1): SAVED with time, km,
   pace, kcal; the simulator writes the FIT file of the saved activity (check where on the Mac).
4. **Ride**: as 3 with a ride FIT file (power, cadence): auto pause shows "AUTO PAUSE" and the ring turns dim while the
   playback stands still; auto lap at 5 km; the summary shows km/h and AVG W. Discard: back on the start menu, nothing saved.
5. **More**: More → Yoga (indoor: heart rate, no GPS) and Hike (GPS): one page heart rate, time, clock, calories;
   Save: the summary shows KCAL and LAPS, the activity's sport is Training / Yoga and Hiking.
6. **Strength, workout**: needs a workout set up on the phone. Strength → START → the workout (second row): "SET 1 OF 3"
   with the planned kg / reps; START, START (or DONE) → rest with the planned rest, the sets so far and NEXT; BACK → the
   workout's exercise list ("1/3 sets"); BACK → Keep training / Finish & save / Discard. Done as planned: no "Save as
   workout?"; one set more or less, or Skip exercise (menu, BACK held): "Update <name> / Save as new / No". A plank in the workout: START starts the clock, a vibration at the planned
   seconds, START logs them.
7. **Strength, free**: Exercises → the list starts with the recent exercises, then the standard 21 (Front squat after
   Squat); Finish → the summary pages (UP / DOWN) → "Save as workout?" → Save: the phone shows it; the session uploads
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

1. It compiles for `fr265`, `fr265s`, `fenix7pro`, `fenix7xpro` and `fenix8solar47mm`; fix every `VERIFY`
   (`grep -rn VERIFY source manifest.xml resources`).
2. The launcher icon shows (size per device), the app opens, BACK on the start screen closes it.
3. Buttons: UP / DOWN step once on a press and keep stepping when held (10 kg); START on kg goes to reps, START on reps
   logs the set; START held 0.7 s switches kg / reps; BACK leaves the set for the exercise list; BACK held opens the menu. No double events (a press must not also trigger onSelect / onNextPage).
4. Touch: tap a value, swipe up / down to change it, tap DONE; swipe left opens the menu; swipe right is not taken by
   the system as "leave the app". See "VERIFY on the device (23.11.)" below for the fenix 8.
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

## VERIFY on the device (23.11., strength rework after the first fenix 8 run)

Not compiled here; the JS mirror (`js/watchflow.js`, `tools/watchflow-test.mjs`, `tools/watch-ui.cjs`) is green. On the Mac:

1. **Compile for all five**: `fr265`, `fr265s`, `fenix7pro`, `fenix7xpro`, `fenix8solar47mm` (Command Palette → Monkey C: Build
   for Device, or `monkeyc -d <id> -f monkey.jungle -o bin/rideframe-<id>.prg -y ~/garmin/developer_key.der`). Likely build
   errors in the new code: `WatchUi.DragEvent` / `DRAG_TYPE_*` names and `evt.getCoordinates()` in `FlowDelegate.onDrag`;
   `ds has :isTouchScreen` in `Draw.hasTouch`; Dictionary / Array casts in `Flow.saveOffer`, `Flow.sumEx`, `Flow.saveTpl`.
2. **Touch on the fenix 8 at all**: first the watch's own setting (Settings → System → Touch, and the per-activity /
   per-app touch toggle; a "touch off during activities" setting would explain the first run). `Draw.hasTouch()`
   (`DeviceSettings.isTouchScreen`) decides the DONE / "Hold to finish" pills.
3. **Taps**: every list row (4 rows, tap zones ≥ 44 px), the DONE pill, kg / reps on the set screen, the rows of END, SAVEQ and the menu.
4. **Drag scroll** (`onDrag`, API 3.3.0): a list follows the finger, one row per 26 px on 260 px; lifting the finger does
   not also count as a tap or a swipe (`dragEnd`, 500 ms). If the fenix 8 sends no drag events, swipes still step one row.
5. **START held** (`KEY_ENTER`, 700 ms on the existing hold timer) switches kg / reps and is not taken by the system;
   START now fires on release (so a hold does not also log). A short START must still feel instant.
6. **BACK**: set / rest → the exercise list (never leaves the app); list → END when sets are logged; END → Discard asks again.
   BACK held still opens the menu. With nothing logged BACK goes back to the Exercises / workouts choice.
7. **Rest screen** on 260 px: heart rate, clock (`FONT_NUMBER_MEDIUM` when `getFontHeight` ≤ 0.2 S, else `NUMBER_MILD`),
   the exercise name, the last 3 sets, NEXT and SKIP do not touch or clip at the round edge; same on 280 / 360 / 416 px.
8. **Heart rate** on the set and rest screens updates (`Sensor` heart rate) and the summary shows avg / max.
9. **Save as workout**: after a free session "Save as workout" → the phone (strength page, Watch workouts; and Settings →
   Devices → Watch screens & workouts) shows it after the queue is sent; the watch lists it under Strength next start.
   A saved workout done as planned does not ask; with a skipped exercise it offers Update / Save as new / No.
10. **Front squat** appears in the list and uploads as `frontsquat` (Front squat on the phone).

### Indoor trainer (23.11.), most likely to fail first

Nothing of this ran on a watch or in the simulator; the JS mirror and the pretend KICKR are green.

1. **Build errors in the new files**: `TrainerBle.mc` (the `BleDelegate` method signatures and types, `new [n]b` ByteArray,
   `Uuid.equals`, the `registerProfile` dictionary, `results.next()` on the scan iterator, `getServiceUuids()` iterator),
   `Recorder.openTrainer` (`FitContributor.MESG_TYPE_RECORD`, `DATA_TYPE_UINT16`, `:nativeNum`), `Draw.drawTRec` (font lists,
   `Number` / `Float` mixes), the new `Flow` constructor arguments.
2. **Profile registration**: both `onProfileRegister` answers are `STATUS_SUCCESS` (`System.println` shows a status otherwise);
   with a failed one the trainer is not usable.
3. **Scan**: the KICKR CORE 2 shows by name (not only after a second result; `getDeviceName` may be null at first) and carries
   `0x1826`. A trainer paired to the phone or the watch's own sensors may hide or refuse (pair it nowhere else while testing).
4. **Connect**: `pairDevice` then `onConnectedStateChanged(CONNECTED)` within 12 s; `Device.equals` matches the paired device.
5. **Setup**: the two CCCD writes answer in `onDescriptorWrite`; Indoor Bike Data arrives each second (power, cadence on screen);
   the control point indicates `80 00 01` and `80 07 01`. If no indication comes, the 3 s fallback still sends targets: check
   the trainer follows them.
6. **ERG**: UP / DOWN change the resistance within about a second; quick presses end on the last target (latest wins);
   pause drops to 30 W, resume goes back.
7. **Another app**: with the laptop (`pure.html`) or the Wahoo app holding the trainer, the watch shows "Refuses control" and
   keeps the power reading if it gets it; closing the other app gives control back within about 5 s.
8. **Lost**: switch the trainer off mid-ride: "LOST, RECONNECTING", the clock goes on; back on: it reconnects (by itself or
   after the 15 s re-pair) and the target is sent again.
9. **Saved activity**: Garmin Connect shows an Indoor Cycling activity with heart rate; check whether power and cadence show as
   native power / cadence (the `:nativeNum` fields) or as app charts; the ride shows in RIDEFRAME Activities as an indoor ride with
   power, and once only after Strava passes it on.
10. **Finish / Discard**: the trainer is free afterwards (the laptop connects); BACK on the app's home closes it, no scan left on.
11. **Battery** over 60 minutes of ERG (BLE notifications every second, the 200 ms timer, heart rate).

## VERIFY on the device (24.11.: last time on the set screen, GPS on the fenix 8 Solar)

1. **Last time on the set screen** (`Draw.drawSet`, `Draw.lastSet`): last session's kg and reps for this set in `FONT_XTINY` on
   the "SET n OF m" row (y 0.315 S), above the kg / reps columns, pushed outward so they never touch the SET text; timed: the clock
   at x 0.735 S. White on MIP (`P.lbl`). They must not touch the big number font (`FONT_NUMBER_HOT`) on 260 px. First time: nothing.
2. **Exercise list sub line** (`Draw.pickSub` / `lastTxt`): "Last 80x8, 8, 6" with as many whole sets as fit in 0.7 S, then " ...".
3. **Last time without a phone** (`Flow.keepLast`, `O_KEEP`): finish a session with the phone away, start a new one: the set
   screen and the list show today's sets; after the upload the server's setup says the same (queued sessions go over a fresh setup).
4. **GPS on Dynamic SatIQ** (`Recorder.setGps` / `gpsConfig`): the options form `{ :acquisitionType => LOCATION_CONTINUOUS,
   :configuration => cfg }` (API 3.3.6), in the order `CONFIGURATION_SAT_IQ`, `..._GPS_GLONASS_GALILEO_BEIDOU_L1_L5`, `..._L1`, else
   the legacy `enableLocationEvents(LOCATION_CONTINUOUS, ...)`; every symbol checked with `has`, an exception falls back to the
   legacy call. VERIFY: `Position.hasConfigurationSupport(CONFIGURATION_SAT_IQ)` is true on the fenix 8 Solar 47 mm (forum reports
   say the simulator answers false for some new devices, then L1_L5 / L1 / legacy is used); `CONFIGURATION_GPS*` are documented
   as not supported on Dynamic SatIQ devices; the fr265 / fenix 7 Pro still compile (the `has` checks) and get a fix.
5. **Ready screen GPS state** (`Draw.drawReady`, `Recorder.onPosition`): "GPS search" (no callback yet or
   `QUALITY_NOT_AVAILABLE`), "GPS weak" in orange (`QUALITY_POOR` or `QUALITY_LAST_KNOWN`), "GPS ready" in green (usable / good).
   GPS goes on as soon as the ready screen of an outdoor sport shows: `RideframeApp.drain` runs `Recorder.sync` after every
   input and every 200 ms tick, and `sync` wants GPS on `S_READY` or while recording when `Sports.gps(sp, type)`.
   VERIFY: `Position.Info.accuracy` takes `QUALITY_LAST_KNOWN` before the first real fix (the docs list the constants only).
6. **No strength ready screen** (24.11.): Strength on the start menu opens Exercises / workouts (or the exercise list) at once and
   starts the session clock (and the optional native strength activity); BACK there goes to the start menu, which also takes the
   end of a finished or discarded session. With no setup yet the list says "Loading exercises / from the phone" until it comes.
7. **Heart rate** (`RideframeApp.sensorsOn`, `pollHr`, `onActive`): `Sensor.setEnabledSensors([SENSOR_HEARTRATE])` plus
   `Sensor.enableSensorType(SENSOR_ONBOARD_HEARTRATE)` (API 3.2.0, guarded with `has`, in try/catch); sensor events as before; when
   none brought a heart rate for 5 s, once a second `Activity.getActivityInfo().currentHeartRate`, else `Sensor.getInfo().heartRate`.
   `onActive` (API 4.2.3) turns the sensors on again when the app is back in the foreground. VERIFY: that the wrist heart rate
   reaches `onSensor` / `currentHeartRate` on the fenix 8 without a recording session; that defining `onActive` compiles on the
   older targets (it is simply never called there); whether a strength workout without the native activity gets a heart rate at all.
