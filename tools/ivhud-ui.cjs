// The interval window's numbers (owner 20.11. after a workout on the laptop: "My heart rate? I simply cannot see it. Why do I not
// see my cadence? When I press Display the interval window does not change. The top says ERG target 165 W although I ride 122 W").
// 1. The gear chip shows the watts the trainer is told right now: in an ERG workout the same (ramped) target as the interval
//    window, through warm-up ramp, hard step, float and rest, also when the ERG mode with a hill / held wattage was on before
//    (saved in the settings from an earlier ride, or hold watts in this ride and the workout picked mid-ride); no "ERG" label
//    when no ERG target is sent (a free block, ERG off).
// 2. Heart rate and cadence are visible (inside the viewport, not covered: elementFromPoint) in all three views (big / compact /
//    focus) and every Display mode (key I); in the big view the Display mode decides which ride numbers the window shows.
// 3. Nothing in the window overlaps or leaves the screen at 1280×720, 1440×900, 1920×1080 with a long step name, a three-digit
//    heart rate and four-digit watts. No page error.
// Starts its own serve.mjs on a free port with a temp data folder; demo route, 2D demo scene, a faked live trainer.
// Usage: NODE_PATH=$(npm root -g) RIDEFRAME_DATA=$(mktemp -d) node tools/ivhud-ui.cjs [shotsDir]   (shots: JPG, deviceScaleFactor 1)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0; const ok = (c, m, info = '') => { n++; console.log(`${c ? '✓' : '✗'} ${m}${!c && info ? ' · ' + info : ''}`); if (!c) fails++; };
const PRESETS = ['voll', 'kompakt', 'training', 'pur', 'kino'];
// which live numbers the big view shows per Display mode (js/ride.js WB_LIVE, js/hudprefs.js HUD_PRESETS); hr + cad always
const EXPECT = { voll: 'hr cad speed dist time avg grade', kompakt: 'hr cad speed dist time avg', training: 'hr cad time avg wkg', pur: 'hr cad avg', kino: 'hr cad' };

(async () => {
  const DATA = process.env.RIDEFRAME_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'rf-ivhud-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());

    /** the app with these settings (as saved by an earlier ride), then a ride on the demo route with workout wid ('' = free ride) */
    const startRide = async (wid, set = {}) => {
      await p.goto(BASE + '/?desktop&noprofile&demo&laptest&nowizard'); await p.waitForTimeout(600);
      await p.evaluate(async set => { const m = await import('/js/app.js'); Object.assign(m.state.settings, { ftp: 250, erg: true, wbView: 'big', hud: { preset: 'voll' }, eagle: false }, set); }, set);
      await p.click('.tab[data-view="library"]'); await p.click('.card[data-id="demo"]'); await p.waitForSelector('#workSel');
      await p.selectOption('#workSel', wid); await p.click('#rideBtn');
      await p.waitForFunction(() => window.__ride?.running && !document.querySelector('.countdown'), null, { timeout: 60000 });
      // a live trainer (FTMS data, no control point: the targets are kept in trainer.erg) and a heart rate from it
      await p.evaluate(() => { const r = window.__ride, t = r.state.trainer; r.eg = null; t.device = { gatt: { connected: true } }; t.mode = "ftms"; t.cp = { writeValueWithResponse: async () => {} }; t.data = { power: 150, cadence: 90, speed: 9, hr: 140 };
        clearInterval(window.__tl); window.__tl = setInterval(() => { t.lastData = performance.now(); t.data.power = window.__tp ?? 150; t.data.cadence = window.__tc ?? 90; t.data.hr = window.__th ?? 140; }, 50); t.lastData = performance.now(); });
    };
    /** jump to `into` seconds into the step that matches (label regex or index), then let the HUD catch up */
    const goStep = async (m, into = 3, ms = 400) => { await p.evaluate(([src, into]) => { const r = window.__ride, st = r.workout.steps, re = new RegExp(src);
      const i = st.findIndex(x => re.test(x.label || '')); r.elapsed = (r._wT0 || 0) + st.slice(0, i).reduce((a, x) => a + x.dur, 0) + into; }, [m, into]); await p.waitForTimeout(ms); };
    // the ramps change every frame and the HUD paints every 100 ms: compare on a held ride clock (the HUD keeps painting)
    const chip = () => p.evaluate(async () => { const r = window.__ride, q = s => document.querySelector(s); r.paused = true; await new Promise(f => setTimeout(f, 250));
      const o = { lbl: q('#hGearL').textContent, txt: q('#hGear').textContent, w: parseInt(q('#hGear').textContent), t: q('#hWT')?.textContent, target: r.wNow?.target, ramp: r.wNow?.ramp || null, step: q('#hWStep')?.textContent, erg: r.state.trainer.erg }; r.paused = false; return o; });
    const same = async (name) => { const c = await chip();
      ok(/^ERG · workout$/.test(c.lbl) && c.w === +c.t && c.w === c.erg && c.w === c.target, `${name}: gear chip "${c.lbl} ${c.txt}" = interval window ${c.t} W = trainer ${c.erg} W`, JSON.stringify(c)); return c; };

    // ---- 1a: the ERG mode (hill watts) saved from an earlier ride, then the absolute-watt workout 30 / 15 in ERG ----
    await startRide('c_30_15_3x13', { bergWatt: true, shiftMode: 'real' });
    ok(await p.evaluate(() => window.__ride.berg && window.__ride.erg), 'ride starts with the saved ERG mode (hill watts) and the workout in ERG');
    await goStep('^Warm-up$', 200); await same('warm-up ramp (% FTP)');
    await goStep('^Spin$', 47); { const c = await same('3 s before a sprint'); ok(c.ramp === null && c.w === 130, 'no ERG ramp into a short sprint (the target jumps at its start, 20.11.)', JSON.stringify(c)); }
    await goStep('30 / 15 · set 1 · 1/13', 5); { const c = await same('hard step 30 s at 370 W'); ok(c.w === 370, 'hard step: 370 W', JSON.stringify(c)); }
    await goStep('^Float$', 7); { const c = await same('float'); ok(c.w === 125, 'float: 125 W', JSON.stringify(c)); }
    await goStep('^Rest$', 60); { const c = await same('rest between the sets'); ok(c.w === 130, 'rest: 130 W', JSON.stringify(c)); }
    // the phone remote's status (js/remotepad.js snapshot) reads this chip: /^ERG/ = ERG mode, the number = its target
    { const c = await chip(); ok(/^ERG/.test(c.lbl) && c.txt.replace(/\s*W$/, '') === c.t, 'phone remote status: ERG mode with the window\'s target', JSON.stringify(c)); }
    // pressing G (shifting) in an ERG workout: the workout keeps the trainer, the chip keeps saying so
    await p.keyboard.press('g'); await p.waitForTimeout(300); await same('after G (shifting) in the ERG workout');
    // ERG off for the workout (ride setup "With gradient"): the saved ERG mode holds hill watts again, and the chip says that
    ok(await p.evaluate(() => !window.__ride.berg), 'G stepped the shifting on (ERG mode → on the bike)');
    await p.evaluate(async () => { const r = window.__ride; r._setShift('berg'); (await import('/js/ridesetup.js')).setMode(r, 'sim'); }); await p.waitForTimeout(400);
    { const c = await chip(); ok(c.erg != null && c.lbl === 'ERG · target' && c.w === c.erg && !/workout/.test(c.lbl), `workout without ERG, ERG mode on: chip "${c.lbl} ${c.txt}" = what the trainer holds (${c.erg} W)`, JSON.stringify(c)); }
    await p.evaluate(async () => { const r = window.__ride; r._setShift('real'); }); await p.waitForTimeout(300);
    { const c = await chip(); ok(c.erg == null && !/ERG/.test(c.lbl), `workout without ERG, gradient: no ERG label ("${c.lbl} ${c.txt}")`, JSON.stringify(c)); }

    // ---- 1b: hold watts in a free ride, then a % FTP workout picked mid-ride ----
    await startRide('', { bergWatt: false, shiftMode: 'real' });
    await p.evaluate(() => { window.__tp = 180; }); await p.waitForTimeout(400);
    await p.evaluate(() => window.__ride.holdWatts()); await p.waitForTimeout(300);
    { const c = await chip(); ok(c.lbl === 'ERG · target' && c.w === c.erg && c.w >= 150, `free ride, hold watts: "${c.lbl} ${c.txt}" (trainer ${c.erg} W)`, JSON.stringify(c)); }
    await p.evaluate(async () => { const { setWorkout } = await import('/js/ridesetup.js'), { workoutById } = await import('/js/workouts.js'); setWorkout(window.__ride, workoutById('vo2_5x5')); });
    await p.waitForTimeout(400);
    await goStep('Warm', 60); await same('vo2_5x5 (110 % FTP) after hold watts: warm-up');
    await goStep('VO2max 1/5', 20); { const c = await same('vo2_5x5: VO2max 1/5'); ok(c.w === 275, 'VO2max: 275 W (110 % of FTP 250)', JSON.stringify(c)); }
    await goStep('VO2max 2/5', -3); await same('vo2_5x5: ramp into VO2max 2/5');
    await goStep('^Rest$', 120); await same('vo2_5x5: rest');

    // ---- 1c: a free block (20-min test): no ERG target, no ERG label ----
    await startRide('ftp20', { bergWatt: true, shiftMode: 'real' });
    await goStep('Test 20 min', 30);
    { const c = await chip(); ok(c.erg == null && !/ERG/.test(c.lbl), `free block in an ERG workout: no target sent, chip "${c.lbl} ${c.txt}" (no ERG)`, JSON.stringify(c)); }
    await goStep('Opener 5 min', 30); await same('20-min test: the opener before it');

    // ---- 2 + 3: heart rate and cadence in every view × Display mode; the Display cycle changes the window; no overlap ----
    const visible = () => p.evaluate(() => { const out = {};
      for (const c of document.querySelectorAll('#hWork .wl')) { const r = c.getBoundingClientRect(), b = c.querySelector('b').getBoundingClientRect(), cs = getComputedStyle(c);
        if (c.hidden || cs.display === 'none' || !r.width) continue;
        const inV = b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        out[c.dataset.wl] = { v: c.querySelector('b span').textContent, inV, top: !!hit && c.contains(hit) }; }
      return out; });
    /** pairs of boxes in the window that overlap, and boxes outside the window or the screen */
    const overlaps = () => p.evaluate(() => { const bar = document.querySelector('#hWork'), B = bar.getBoundingClientRect(), bad = [];
      const els = ['.wring', '.wb-name', '#hWStep', '#hWOf', '.wb-t', '.wb-p', '.wadj', '.wb-next .n', '.wb-next .d', '.wb-end', ...[...bar.querySelectorAll('.wl')].map(c => `[data-wl="${c.dataset.wl}"]`)]
        .map(s => [s, bar.querySelector(s)]).filter(([, e]) => e && getComputedStyle(e).display !== 'none' && !e.hidden && e.getBoundingClientRect().width > 0)
        .map(([s, e]) => [s, e.getBoundingClientRect()]);
      const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
      const parent = { '#hWStep': '.wb-name', '#hWOf': '.wb-name' };
      for (const [s, r] of els) { if (r.left < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5 || r.top < 0) bad.push(s + ' off screen'); }
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const [s1, a] = els[i], [s2, c] = els[j];
        if (parent[s1] === s2 || parent[s2] === s1) continue;
        const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left), oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        if (ox > 1 && oy > 1) bad.push(`${s1} × ${s2}`); }
      // the step name and the numbers are not cut (no ellipsis / overflow hidden), the bar is fully on screen
      if (B.bottom > innerHeight + 0.5 || B.top < 0) bad.push('bar off screen');
      return bad; });
    const setHud = pre => p.evaluate(pre => window.__ride._setHud({ preset: pre }), pre);
    const setView = v => p.evaluate(v => { const r = window.__ride; while (r._wbView() !== v) r._cycleWbView(); }, v);

    await startRide('c_30_15_3x13', { bergWatt: true, shiftMode: 'real' });
    await p.evaluate(() => { window.__tp = 338; window.__tc = 94; window.__th = 168; });
    await goStep('30 / 15 · set 2 · 11/13', 8, 900);
    // the Display cycle (key I) changes the window as designed
    { const seen = [];
      for (let i = 0; i < PRESETS.length; i++) {
        const pre = await p.evaluate(async () => (await import('/js/hudprefs.js')).hudPrefs((await import('/js/app.js')).state.settings).preset);
        const v = await visible(), keys = Object.keys(v).join(' '), chart = await p.evaluate(() => getComputedStyle(document.querySelector('#hWChart')).display !== 'none');
        seen.push(pre);
        ok(keys === EXPECT[pre], `Display "${pre}", big view: the window shows ${EXPECT[pre]}`, keys);
        ok(chart === (pre !== 'kino'), `Display "${pre}": timeline ${pre !== 'kino' ? 'shown' : 'hidden (landscape only)'}`);
        await p.keyboard.press('i'); await p.waitForTimeout(250);
      }
      ok(seen.join() === PRESETS.join(), 'key I cycles Everything → Compact → Workout → Pure → Landscape only', seen.join()); }
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('.hud-bottom')).display === 'none'), 'in a workout the separate metrics row is gone (its numbers are in the window)');
    // over the 3D world (.ride.world3d, its own HUD rules; the demo here is the 2D scene) the metrics row sat under the bar on main
    await p.evaluate(() => document.querySelector('.ride').classList.add('world3d')); await p.waitForTimeout(250);
    { const v = await visible(); ok(v.hr?.v === '168' && v.hr.top && v.cad?.v === '94' && v.cad.top, '3D world HUD: heart rate and cadence visible, not covered', JSON.stringify(v)); }
    await p.evaluate(() => document.querySelector('.ride').classList.remove('world3d'));

    const VPS = [[1280, 720], [1440, 900], [1920, 1080]], VIEWS = ['big', 'compact', 'focus'];
    await p.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {}); await p.waitForTimeout(300); // the ride asks for fullscreen
    for (const [w, h] of VPS) {
      await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(300);
      for (const view of VIEWS) { await setView(view);
        for (const pre of PRESETS) { await setHud(pre); await p.waitForTimeout(250);
          const v = await visible();
          ok(v.hr?.v === '168' && v.hr.inV && v.hr.top && v.cad?.v === '94' && v.cad.inV && v.cad.top, `${w}×${h} ${view} / ${pre}: heart rate 168 and cadence 94 visible, not covered`, JSON.stringify(v));
          const bad = await overlaps(); ok(!bad.length, `${w}×${h} ${view} / ${pre}: nothing overlaps or leaves the screen`, bad.join(', '));
          if (SHOTS && w !== 1280) await p.screenshot({ path: path.join(SHOTS, `ivhud_${view}_${pre}_${w}.jpg`), type: 'jpeg', quality: 82 });
        }
      }
    }
    // four-digit watts and a three-digit heart rate at the narrowest size
    await p.evaluate(async () => { const { setWorkout } = await import('/js/ridesetup.js'), { workoutById } = await import('/js/workouts.js'); setWorkout(window.__ride, workoutById('vo2_5x5')); });
    await p.evaluate(() => { const r = window.__ride; r.ftp = 900; r.wAdj = 150; window.__tp = 1288; window.__th = 199; window.__tc = 118; }); // 110 % of 900 + 150 = 1140 W
    await goStep('VO2max 3/5', 30, 900);
    for (const [w, h] of VPS) {
      await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(300);
      for (const view of VIEWS) { await setView(view);
        for (const pre of ['voll', 'kino']) { await setHud(pre); await p.waitForTimeout(250);
          const t = await p.textContent('#hWT'), v = await visible(), bad = await overlaps();
          ok(t.length === 4 && v.hr?.v === '199' && v.hr.top && v.cad?.top && !bad.length, `${w}×${h} ${view} / ${pre}, target ${t} W, power 4 digits, HR 199: readable, no overlap`, bad.join(', ') + ' ' + JSON.stringify(v));
          if (SHOTS && w === 1280 && pre === 'voll') await p.screenshot({ path: path.join(SHOTS, `ivhud_${view}_4digit_1280.jpg`), type: 'jpeg', quality: 82 });
        }
      }
    }
    { // the trainer refuses the ERG target: the chip says so in red, and it clears when the trainer follows again
      const st = async refused => p.evaluate(async refused => { const r = window.__ride, t = r.state.trainer; t.device = { gatt: { connected: true } }; t.mode = 'ftms'; t.cp = { writeValueWithResponse: async () => {} };
        t.ctlRefused = refused ? { op: 5, res: 5 } : null; r.paused = false; await new Promise(f => setTimeout(f, 400)); const l = document.querySelector('#hGearL');
        return { erg: !!r._ergNow(), lbl: l.textContent, warn: l.classList.contains('warn') }; }, refused);
      const a = await st(true), b2 = await st(false);
      ok(a.erg && a.lbl === 'ERG · trainer not following' && a.warn, 'trainer refuses the target: chip “ERG · trainer not following”, red · ' + JSON.stringify(a));
      ok(!b2.warn && /^ERG · (workout|target)$/.test(b2.lbl), 'trainer follows again: the warning is gone · ' + JSON.stringify(b2));
    }
    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + (e.stack || e.message)); fails++; }
  await b.close(); srv.kill(); if (!process.env.RIDEFRAME_DATA) fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} of ${n} failed` : `\nInterval HUD UI: all ${n} good`); process.exit(fails ? 1 : 0);
})();
