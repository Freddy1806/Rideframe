# Coach workouts

The app reads `coach/workouts.json` from the web server every time a page starts (desktop app, Training tab, route page,
ride setup, `pure.html`). New or changed workouts therefore show up with the next page load, without a new app version.

`coach/workouts.json` lives **only on the host**. It is in `.gitignore`, so a rollout never overwrites it. This folder in the
repo only holds this README and `workouts.example.json`. A missing file or broken JSON is silently ignored: the built-in
workouts are still there.

## Adding a workout

1. Write the workout in the format below (start from `workouts.example.json`).
2. Check it: `node tools/coach-workout.mjs check path/to/workouts.json` (prints each workout with minutes, steps and
   highest watts; exit code 1 on any error; `--ftp 280` for the %-steps).
3. Put it on the host as `coach/workouts.json` next to `index.html`. Reload the page. No server restart needed.

## Format

```json
{ "workouts": [
  { "id": "c_my_workout", "name": "Name", "what": "Description",
    "rampIn": 3, "rampOut": 2,
    "steps": [
      { "min": 10, "pct": 40, "pct2": 72, "label": "Warm-up" },
      { "repeat": 13, "label": "30 / 15 · set 1", "skipLastRest": true,
        "steps": [ { "sec": 30, "watts": 340 }, { "sec": 15, "watts": 125, "label": "Float" } ] },
      { "sec": 180, "watts": 130, "label": "Rest" }
    ] }
] }
```

Workout
- `id`: 4–40 characters `A–Z a–z 0–9 _ -`, must start with `c_`. The same id as a built-in workout replaces it
  (e.g. `c_30_15_3x13`). Ids must be unique in the file.
- `name`: up to 40 characters (required). `what`: up to 400 characters.
- `rampIn` / `rampOut` (optional, 0–10 s): how fast ERG rises into / falls out of a hard interval (default 10 / 5 s).
  Short on / off sets want short ramps.
- `steps`: a list of steps and repeats.

Step
- duration: exactly one of `"sec"` or `"min"`, 5 s to 120 min.
- target: exactly one of `"watts"` (50–2000, absolute) or `"pct"` (30–200 % FTP).
- `"pct2"` (only with `pct`): a ramp from `pct` to `pct2` over the step.
- `"label"`: up to 24 characters, shown in the HUD. `"free": true`: no ERG, the rider sets the pace (test blocks).
- Steps at 88 % FTP and more count as hard intervals (counted, tunable live, ERG ramps into them).

Repeat
- `{ "repeat": n (2–50), "label": "...", "steps": [step, ...], "skipLastRest": true }` repeats its steps n times.
- With a label, the first step of every repetition is labelled `<label> · i/n` (e.g. `30 / 15 · set 1 · 3/13`), which the
  HUD uses to count the intervals of a series. The other steps keep their own labels.
- `skipLastRest`: the last step of the last repetition is left out (no float before the set break).
- No repeats inside repeats.

Limits: at most 50 workouts, 400 steps (after expanding repeats) and 6 hours per workout. Control characters and `< >` are
removed from texts. An invalid workout is skipped (the browser console and the check tool name the reason); the others load.
