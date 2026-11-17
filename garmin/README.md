# RIDEFRAME Strength for Garmin (Connect IQ watch app)

**Status: draft, not compiled.** Everything in this folder was written against the Connect IQ documentation without
an SDK, compiler or simulator, and it has never run on a watch. Expect compile errors on the first build. Every place
where the API was not certain is marked `// VERIFY:` with the doc page to check.

The design, the screens and the whole flow are in the browser preview `watch.html` (open `/watch.html` on the
RIDEFRAME host). `source/Flow.mc` is a line-by-line port of `js/watchflow.js`, which is unit-tested in Node
(`node --test tools/watchflow-test.mjs`). When you change the flow, change both.

Target watches: Forerunner 265 / 265S (416 / 360 px round AMOLED, touch + 5 buttons) and fenix 7X Pro / 7 Pro
(280 / 260 px round MIP, 64 colours, touch + 5 buttons), all on Connect IQ API 5.x.

## Files

| File | What it is |
| --- | --- |
| `manifest.xml` | watch-app, products fr265, fr265s, fenix7xpro, fenix7pro, permissions Communications, Sensor, Fit |
| `monkey.jungle` | project file (default `source/` and `resources/`) |
| `resources/settings/properties.xml` | `baseUrl` (default `https://mac-mini-von-gary.tailcde074.ts.net`), `recordActivity` (off) |
| `resources/settings/settings.xml` | both editable in the Garmin Connect app (app settings) |
| `source/Flow.mc` | the state machine (= `js/watchflow.js`) |
| `source/Draw.mc` | every screen drawn with `dc` calls, sizes as fractions of the screen (= `DRAW` in `js/watchsim.js`) |
| `source/FlowView.mc`, `source/FlowDelegate.mc` | one view, one BehaviorDelegate: buttons, holds, taps, swipes to flow events |
| `source/Api.mc` | `Communications.makeWebRequest` client, bearer token from `Application.Storage` |
| `source/RideframeApp.mc` | app: flow, queue, heart rate, vibration, optional `ActivityRecording` |
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
- Storage: File → Edit Persistent Storage shows `token`, `setup`, `queue`, `summary`.

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

## Native activity (optional, off by default)

With the app setting **Also save as a Garmin activity** the workout is also recorded as a strength activity
(`ActivityRecording`, one lap per set) and lands in Garmin Connect. If Garmin Connect passes it on to Strava,
RIDEFRAME's Strava import would bring it back as a second session. Before turning this on for real: teach
`js/actimport.js` to skip a Strava `WeightTraining` activity whose start is within 2 minutes of a strength session
with `source: 'watch'` (not done yet).

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
