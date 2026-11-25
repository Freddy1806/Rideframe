# RIDEFRAME scale bridge

This program lets the Mac mini that runs `serve.mjs` hear a eufy Bluetooth bathroom scale. It passes each weigh-in to the household it belongs to (see the Body page and Settings → Bathroom scale).

```
 eufy scale ──BLE advertisement / notification──▶ scale-bridge (Swift, CoreBluetooth)
                                                     │ raw hex, POST /api/scale/frame (127.0.0.1 + secret)
                                                     ▼
                                    serve.mjs: tools/scale-decode.mjs → tools/body-assign.mjs → users/<id>/body.json
```

The bridge only scans, connects when the server asks it to, subscribes to notifications, writes what the server answers, and reads the battery. **All decoding happens in JavaScript on the server** (`tools/scale-decode.mjs`, unit-tested in `tools/scale-test.mjs`). If a byte offset turns out to be wrong, the fix goes there and the Swift binary does not need a rebuild.

## Why Swift

The Mac mini runs macOS 15.5 (Apple silicon) with the Command Line Tools (Swift 6.1). Python has no `bleak` and Node has no `noble`.

- **Swift + CoreBluetooth needs nothing extra.** You get one source file, `swiftc` from the Command Line Tools, and a tiny `.app` bundle. The bundle's `Info.plist` holds `NSBluetoothAlwaysUsageDescription`, which macOS requires before it shows the Bluetooth permission question. The plist is also embedded in the binary.
- Python + bleak would need pip packages plus pyobjc, and the permission would go to the Python interpreter.
- Node + noble needs native modules that break with new Node versions (node 25 here).

## Install and first run: `--scan` first

On the Mac mini, in the RIDEFRAME folder:

```sh
xcode-select -p || xcode-select --install          # Command Line Tools (already there)
cd tools/scale-bridge && ./build.sh                # builds RideframeScaleBridge.app (ad-hoc signed)
```

**1. Find out what the scale really sends.** Nothing goes to the server in this step.

```sh
open RideframeScaleBridge.app --args --scan --out ~/scale-scan.jsonl
```

macOS asks once: *"RIDEFRAME Scale Bridge" would like to use Bluetooth*. Click **Allow**. Then step on the scale two or three times (on, wait for the final number, off). Afterwards:

```sh
pkill -f RideframeScaleBridge.app ; node replay.mjs ~/scale-scan.jsonl
```

- `replay.mjs` decodes the recording with the server's decoder and prints every frame plus one `==> WEIGH-IN` per weigh-in.
- If the scale is listed under "not recognised", or no line shows its weight, send `~/scale-scan.jsonl`. It holds the raw hex, which is what is needed to add the model.
- `--scan-all` records every Bluetooth LE device nearby. Use it if the scale names itself differently.

You can also run the scan straight from Terminal: `./RideframeScaleBridge.app/Contents/MacOS/scale-bridge --scan`. macOS then asks for Bluetooth permission **for Terminal**, not for the bridge.

**2. Run it for real.** `serve.mjs` must have started once, so that it has written `~/RIDEFRAME_data/scale-bridge.secret` (mode 0600).

```sh
./RideframeScaleBridge.app/Contents/MacOS/scale-bridge -v          # watch it once in the foreground; Ctrl-C to stop
```

**3. Run it permanently as a LaunchAgent.** It starts at login and restarts if it stops. This is not installed for you:

```sh
sed "s#/Users/USER#$HOME#g" com.rideframe.scale-bridge.plist > ~/Library/LaunchAgents/com.rideframe.scale-bridge.plist
# check the two paths inside: the RIDEFRAME folder and the data folder (RIDEFRAME_DATA)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rideframe.scale-bridge.plist
tail -f ~/Library/Logs/rideframe-scale-bridge.log
# stop / remove:  launchctl bootout gui/$(id -u)/com.rideframe.scale-bridge
```

A LaunchAgent runs in the logged-in user's session. The Mac mini must therefore stay logged in, for example with automatic login. That is also what CoreBluetooth needs.

If the first LaunchAgent start shows no permission question and the log says "Bluetooth NOT allowed", do this: System Settings → Privacy & Security → Bluetooth → turn on "RIDEFRAME Scale Bridge" (or add it with +), then `launchctl kickstart -k gui/$(id -u)/com.rideframe.scale-bridge`.

**4. In the app.** On your phone, go to Settings → Bathroom scale → **Set up the scale**. Step on the scale once and **Add** it under "Scales the bridge hears now". Then tap **Invite** to get a 6-digit code for Riley, who enters it under Settings → Bathroom scale → **Join with a code**.

Options: `--server http://127.0.0.1:8765`, `--data <data folder>`, `--record file.jsonl` (records everything it forwards, for `replay.mjs`), `--replay file.jsonl` (sends a recording to the server with its original gaps), `-v`.

On the server, `RIDEFRAME_SCALE_LOG=1 node serve.mjs` logs every decoded frame and each assignment decision.

The bridge does not touch port 8888 (the existing health webhook); it only talks to the RIDEFRAME server.

## macOS specifics

- **No MAC address.** CoreBluetooth gives each peripheral a random UUID per Mac instead of its MAC address. The scale's MAC is still needed: the server uses it as the scale's identity, and the P2 handshake key is the MD5 of it. It is taken from the advertisement's manufacturer data:
  - P2 / P2 Pro: payload [0..5]
  - C20 / P3: the company id's high byte + payload [0..4] (see [B])
  - For C1 / P1 / A1 / T9140 no MAC is known from the advertisement. These scales are keyed by the Mac's peripheral UUID, which is stable on this Mac.
- **Company id comes first.** `kCBAdvDataManufacturerData` includes the 2-byte company id (little-endian) at the start. Android, BlueZ and bleak strip it. The server's decoder expects the macOS form.
- **The name only arrives in the scan response.** macOS scans actively and merges the scan response, so "eufy T9149" shows up after a moment. The bridge remembers the name for each peripheral.
- **Duplicates.** The scan runs with `AllowDuplicates`, but the bridge forwards an advertisement only when it changed, or every 30 s as a heartbeat. The server turns the frames of one weigh-in into exactly one measurement.
- **Connections and the eufy phone app.** By default nothing connects: P2 / P2 Pro / C20 / P3 / C1 / P1 put the weight into the advertisement. The bridge connects only for:
  - the A1 (T9120) and the old Smart Scale (T9140), which send nothing in the advertisement;
  - a P2 / P2 Pro, and only when the owner turns on "Impedance too" in the settings.
  
  While the bridge is connected, the eufy app on a phone may not get that weigh-in. A phone that holds the connection may make the bridge time out (it logs this and tries again later). The bridge lets go after 90 s without notifications.
- **Re-signing.** `build.sh` signs ad-hoc. A rebuild changes the signature, and macOS may ask for Bluetooth again. Rebuild only when needed. Because of the design (decoding on the server), that should be rare.

## Supported models and how sure we are

| Model | Name | How the weight arrives | Status |
|---|---|---|---|
| T9148 | Smart Scale P2 | advertisement, company id 0xFF48 | **verified with real frames** (same frames as P2 Pro, [L][B][O]) |
| T9149 | Smart Scale P2 Pro | advertisement (+ heart rate) | **verified**: real capture from eufylife-ble-client#8, 105.10 kg, HR 81/76; checksum [18] = XOR [6..17] holds on both |
| T9148/T9149 | impedance | GATT FFF2 after the C0–C3 handshake | frame layout **verified** against 6 real frames with the app's figures (ble-scale-sync#289); the handshake is only tested against an emulated scale (no hardware) |
| T9130 | Smart Scale C20 | advertisement (company id = MAC-derived) | **verified**: real Home Assistant log, 100.10 kg, status sequence 0x00 → 0x01 → 0x05/0x15/0x25 (+end flag) |
| T9150 | Smart Scale P3 | advertisement | **verified**: three units, 82.80 / 68.55 / 123.00 kg, HR 95 at status 0xA5 |
| T9146 / T9147 | Smart Scale C1 / P1 | advertisement, 11-byte CF frame with XOR | **guess**: from [L]'s code only, no capture published |
| T9120 | Smart Scale A1 | GATT notify | **guess** ([L] only) |
| T9140 | Smart Scale (original) | GATT notify, "AC 02" frames | **guess** ([L] only) |

"P20" is not a eufy model. The owner's scale is most likely the P2 / P2 Pro, the C20, or the P3. All three have verified decoders.

Not stored on purpose:
- The C20 / P3 bytes [17..18], which look like an impedance but were never compared with the app.
- Any body-fat percentage computed from impedance, because there is no Eufy formula and generic ones are off by 3–5 points ([B]).

Body fat, water, muscle and bone are only stored from an import of the eufy app's own figures. BMI is only computed from the height the user enters (kg/m², WHO).

## Sources

- [L] bdr99/eufylife-ble-client (MIT), the library behind Home Assistant's `eufylife_ble`: `client.py`, `auth_handler.py`, `util.py`, commit 8916e44 — https://github.com/bdr99/eufylife-ble-client
- [B] KristianP26/ble-scale-sync (GPL-3.0): `src/scales/eufy-p2.ts`, `src/scales/eufy-c20-p3.ts` and their tests with the real frames and their origin (eufylife-ble-client issues #3, #5, #8, #98; ble-scale-sync #284, #289), commit b3daf97 — https://github.com/KristianP26/ble-scale-sync
- [O] oliexdev/openScale: `EufyP2Lib.kt`, `EufyP2Handler.kt`, `EufyC20Handler.kt`, `EufyP2LibTest.kt`, commit 2f5eeb7 — https://github.com/oliexdev/openScale
- yarkoody/scale-sync PR #6 (cross-check of the same captures) — https://github.com/yarkoody/scale-sync/pull/6
- Home Assistant issues core#193433 (C1 advertises "eufy T9146 C1") and core#194112 (P3 sends under two company ids)
- Trend: John Walker, *The Hacker's Diet*, "Signal and Noise" (10 % exponentially smoothed moving average) — https://www.fourmilab.ch/hackdiet/

No code was copied from these projects (two of them are GPL). The offsets were re-implemented and checked against the captured frames, which are reproduced as test vectors in `tools/scale-test.mjs` and `tools/fixtures/scale-replay.jsonl`.
