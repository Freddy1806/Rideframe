// Workout, mode and shifting inside the ride (js/ridesetup.js, Freddy 17.11. 22:14), end to end on Passo Demo: a free ride,
// then by fake pad only: Start -> "Workout & mode" -> a workout (the interval bar comes, step 1, ERG target to the trainer),
// "With gradient" (ERG off), virtual shifting; by keyboard only: O -> ERG again -> no
// workout (the bar goes, the trainer free). The ride records all along and the saved ride names the workout. No browser
// dialogs. Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) node tools/ridesetup-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS && /^https?:/.test(SHOTS)) { console.log('The argument is a folder for screenshots, not a URL.'); process.exit(2); }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-ridesetup-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch(), errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript(() => { const btn = () => ({ pressed: false, value: 0, touched: false });
      window.__pad = { id: 'Test pad (STANDARD GAMEPAD Vendor: 045e)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, btn), axes: [0, 0, 0, 0] };
      Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [window.__pad, null, null, null], configurable: true }); });
    const R = await ctx.newPage(); R.on('pageerror', e => errs.push(e.message)); R.on('dialog', d => { errs.push('a native dialog: ' + d.message()); d.dismiss(); });
    const BTN = { A: 0, B: 1, start: 9, up: 12, down: 13, left: 14, right: 15 };
    const press = async (k, hold = 80) => { await R.evaluate(i => { const x = window.__pad.buttons[i]; x.pressed = true; x.value = 1; }, BTN[k]); await R.waitForTimeout(hold);
      await R.evaluate(i => { const x = window.__pad.buttons[i]; x.pressed = false; x.value = 0; }, BTN[k]); await R.waitForTimeout(120); };
    const on = () => R.evaluate(() => { const a = document.activeElement; return a ? (a.id || (a.dataset.src ? 'src:' + a.dataset.src : '') || a.dataset.mode || a.dataset.shift || (a.dataset.w !== undefined ? 'w:' + a.dataset.w : a.textContent.trim())) : ''; });
    /** the ride's own menu: D-pad down / up until the wanted button is the focused one */
    // → and ← walk through every button in order (the D-pad goes where it points; at the end of a row it steps on to the next one)
    const padTo = async (want, dir = 'down', max = 80) => { dir = dir === 'up' ? 'left' : 'right'; for (let i = 0; i < max; i++) { const o = await on(); if (process.env.DBG) console.log("  pad", dir, o); if (o === want) return true; await press(dir); } return (await on()) === want; };
    const st = () => R.evaluate(() => { const r = window.__ride, t = r.state.trainer; return { w: r.workout?.id || null, erg: r.erg, flat: r.flatRide, virt: r.virtual, t0: r._wT0, el: r.elapsed, step: r.wNow?.i ?? null, target: r.wNow?.target ?? null,
      trainerErg: t.erg ?? null, bar: !!document.querySelector('#hWork'), wk: r.el.classList.contains('wk'), n: r.samples.length, paused: r.paused, grade: window.__grade }; });

    await R.goto(BASE + '/?desktop&noprofile&demo&laptest&view=detail&id=demo'); await R.waitForSelector('#workSel'); await R.selectOption('#workSel', ''); await R.waitForTimeout(300);
    await R.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
    await R.click('#rideBtn'); await R.waitForSelector('#hPause', { timeout: 60000 }); await R.waitForFunction(() => window.__ride && window.__ride.elapsed > 2, null, { timeout: 30000 });
    await R.evaluate(() => { const t = window.__ride.state.trainer, g = t.setGrade.bind(t); t.setGrade = (x, f) => { window.__grade = x; return g(x, f); }; });
    let s = await st(); ok(!s.w && !s.bar, 'a free ride: no workout, no interval bar');
    ok(await R.locator('#hSetup').isVisible(), 'HUD: the “Workout” chip');

    // ---- by pad only ----
    await press('start'); await R.waitForSelector('#pSetup'); ok(await padTo('pSetup'), 'pad: Start, then down to “Workout & mode”'); await press('A');
    await R.waitForSelector('.rsbox'); ok(await R.locator('.rsbox [data-mode]').count() === 2 && await R.locator('.rsbox [data-shift]').count() === 2 && await R.locator('.rsbox [data-w]').count() > 10, 'setup: 2 modes, 2 shiftings, the workouts');
    ok(!(await R.locator('.rsbox [data-mode="erg"]').isDisabled()) && /Holds your watts/.test(await R.textContent('.rsbox [data-mode="erg"]')), 'ERG without a workout offers hold watts');
    { await R.evaluate(() => { const r = window.__ride, t = r.state.trainer, p = t.setPower.bind(t); window.__hw = []; t.setPower = x => { window.__hw.push(x); return p(x); }; });
      await R.click('.rsbox [data-mode="erg"]'); await R.waitForTimeout(250);
      const h = await R.evaluate(() => { const r = window.__ride; const a = r._holdW; r._holdTune(5); r._holdTune(25); r._holdTune(-5); return { a, b: r._holdW, berg: r.berg, last: window.__hw.at(-1), lbl: document.querySelector('#hGearL').textContent, pressed: document.querySelector('.rsbox [data-mode="erg"]')?.getAttribute('aria-pressed') }; });
      ok(h.berg && h.a >= 30 && h.b === h.a + 25 && h.last === h.b && /^ERG/.test(h.lbl), `hold watts: ERG without a workout holds ${h.a} W, the pad steps (+5, +25, −5) make it ${h.b} W and that goes to the trainer`);
      await R.click('.rsbox [data-mode="sim"]'); await R.waitForTimeout(250);
      const g = await R.evaluate(() => { const r = window.__ride; return { berg: r.berg, hold: r._holdW, last: window.__hw.at(-1) }; }); ok(!g.berg && !g.hold && g.last === null, 'With gradient ends hold watts (the trainer is back on the road)');
      await R.evaluate(() => { const r = window.__ride; r.erg = true; r.state.settings.erg = true; }); } // as before this detour: ERG is the setting for the workout picked next
    if (SHOTS) await R.screenshot({ path: `${SHOTS}/ridesetup_1280.png` });
    const el0 = (await st()).el;
    ok(await padTo('w:ss2x12'), 'pad: down to “Sweet Spot 2 × 12”'); await press('A'); await R.waitForSelector('#raGo');
    { // the adjust step (owner 19.11.): rows of equal steps, minutes and watts, leave the warm-up out
      const a0 = await R.evaluate(() => ({ rows: document.querySelectorAll('.rsar').length, focus: document.activeElement?.id, warm: !!document.querySelector('#raWarm'), sum: document.querySelector('.rsasum').textContent, w: window.__ride.workout?.id || null }));
      ok(a0.rows >= 3 && a0.focus === 'raGo' && a0.warm && !a0.w, `adjust: ${a0.rows} rows, the pad stands on “Start workout”, nothing started yet (${a0.sum.trim()})`);
      await R.click('#raWarm'); const a1 = await R.evaluate(() => ({ off: document.querySelectorAll('.rsar.off').length, sum: document.querySelector('.rsasum').textContent }));
      ok(a1.off >= 1 && a1.sum !== a0.sum, `“Skip warm-up” leaves it out (${a1.sum.trim()})`);
      await R.click('#raWarm'); // back in: the checks below ride the standard workout
      const row = '.rsar:nth-last-child(2)', rd = () => R.evaluate(q => [...document.querySelectorAll(q + ' .rsaf b')].map(b => b.textContent), row);
      const b0 = await rd(); await R.click(row + ' [data-a="t+"]'); await R.click(row + ' [data-a="w+"]'); const b1 = await rd();
      ok(b0[0] !== b1[0] && +b1[1] === +b0[1] + 5, `a row: time ${b0[0]} → ${b1[0]}, watts ${b0[1]} → ${b1[1]}`);
      await R.click(row + ' [data-a="t-"]'); await R.click(row + ' [data-a="w-"]'); ok(JSON.stringify(await rd()) === JSON.stringify(b0), 'and back');
      await R.evaluate(() => document.querySelector('#raGo').focus()); await R.click('#raGo'); await R.waitForTimeout(300);
      ok(!(await R.locator('.rsbox').count()), '“Start workout” rides on');
      await R.keyboard.press('o'); await R.waitForSelector('.rsbox [data-mode]'); }
    s = await st(); ok(s.w === 'ss2x12' && s.bar && s.wk && Math.abs(s.t0 - el0) < 1, `pad A: the workout from now (clock from ${s.t0?.toFixed(1)} s), the interval bar is there`);
    ok(s.step === 0 && s.target > 0 && s.trainerErg === s.target, `step 1, ERG target ${s.target} W at the trainer`);
    ok(await R.locator('.rsbox [data-mode="erg"].on').count() === 1, 'the panel shows ERG on');
    if (SHOTS) await R.screenshot({ path: `${SHOTS}/ridesetup_workout_1280.png` });
    ok(await padTo('sim', 'up'), 'pad: up to “With gradient”'); await press('A'); await R.waitForTimeout(200);
    s = await st(); ok(!s.erg && s.trainerErg === null && s.w === 'ss2x12', 'with gradient: ERG off, the trainer back on the road, the workout goes on');
    ok(await R.evaluate(() => !document.querySelector('.rsbox [data-mode="flat"]') && document.querySelectorAll('.rsbox [data-mode]').length === 2), 'two modes only: ERG and With gradient (“Just ride” is gone)');
    ok(await padTo('virtual'), 'pad: to “Virtual” shifting'); await press('A'); await R.waitForTimeout(200); s = await st(); ok(s.virt, 'virtual shifting on');
    await press('B'); await R.waitForTimeout(1200); s = await st(); ok(!s.paused && !(await R.locator('#pauseOverlay').count()), 'pad B: back on the road');
    await R.keyboard.press('o'); await R.waitForSelector('.rsbox'); await R.mouse.click(6, 300); await R.waitForTimeout(600);
    ok(!(await R.locator('#pauseOverlay').count()) && !(await R.evaluate(() => window.__ride.paused)), 'a click beside the window closes it and rides on (owner 27.11.)');
    await R.keyboard.press('o'); await R.waitForSelector('.rsbox'); await R.mouse.move(700, 300); await R.mouse.down(); await R.mouse.move(6, 300); await R.mouse.up(); await R.waitForTimeout(400);
    ok(await R.locator('#pauseOverlay .rsbox').count() === 1, 'a drag out of the window closes nothing'); await press('B'); await R.waitForTimeout(800);
    const tl = await R.evaluate(() => { const r = window.__ride; return [r.wNow?.i, Math.round(r._wClock())]; }); ok(tl[0] === 0 && tl[1] > 0, `the workout clock runs from the choice (${tl[1]} s, step ${tl[0] + 1})`);

    // ---- by keyboard only: O, Tab, Enter ----
    await R.keyboard.press('o'); await R.waitForSelector('.rsbox');
    const tabTo = async want => { for (let i = 0; i < 120; i++) { if (await on() === want) return true; await R.keyboard.press('Tab'); } return false; };
    ok(await tabTo('erg'), 'keyboard: O opens it, Tab to ERG'); await R.keyboard.press('Enter'); await R.waitForTimeout(200);
    s = await st(); ok(s.erg && !s.flat && s.trainerErg === s.target && s.target > 0, `Enter: ERG again, ${s.target} W at the trainer`);
    ok(await tabTo('w:'), 'keyboard: Tab to “No workout”'); await R.keyboard.press('Enter'); await R.waitForTimeout(200);
    s = await st(); ok(!s.w && !s.bar && !s.wk && s.trainerErg === null, 'no workout: the bar is gone, the trainer free');
    ok(/Holds your watts/.test(await R.textContent('.rsbox [data-mode="erg"]')), 'without the workout ERG offers hold watts again');
    const n0 = s.n; await R.keyboard.press('Enter').catch(() => {}); await tabTo('oBack'); await R.keyboard.press('Enter'); await R.waitForTimeout(2500);
    s = await st(); ok(!s.paused && s.n > n0, `recording went on all along (${s.n} samples)`);

    // ---- power meter only (Freddy 18.11. 11:34): a connected trainer is dropped, nothing is ever written to a trainer ----
    await R.evaluate(() => { const t = window.__ride.state.trainer; window.__w = []; window.__gone = false;
      t.device = { name: 'KICKR TEST', gatt: { get connected() { return !window.__gone; }, disconnect() { window.__gone = true; } } };
      t.cp = { writeValue: b => { window.__w.push([...b]); return Promise.resolve(); } }; t.mode = 'ftms'; });
    await R.keyboard.press('o'); await R.waitForSelector('.rsbox');
    ok(await tabTo('w:ss2x12'), 'keyboard: Tab to “Sweet Spot 2 × 12”'); await R.keyboard.press('Enter'); await R.waitForSelector('#raGo'); await R.keyboard.press('Enter'); await R.waitForTimeout(300); await R.keyboard.press('o'); await R.waitForSelector('.rsbox [data-mode]');
    ok((await R.evaluate(() => window.__w.length)) > 0, 'trainer control: the ERG target went to the (fake) trainer');
    ok(await padTo('src:pm', 'up'), 'pad: up to “Power meter only”'); await press('A'); await R.waitForTimeout(300);
    const pm = await R.evaluate(() => { const r = window.__ride, t = r.state.trainer, b = document.querySelector('.rsbox');
      return { pm: t.pmOnly, gone: window.__gone, dev: !!t.device, erg: r.erg, tErg: t.erg ?? null, w: r.workout?.id, set: r.state.settings.powerSource,
        modesOff: [...b.querySelectorAll('[data-mode]')].every(x => x.disabled), virtOff: b.querySelector('[data-shift="virtual"]').disabled, realOn: b.querySelector('[data-shift="real"]').classList.contains('on'),
        note: b.querySelector('#rsNote')?.textContent || '', conn: b.querySelector('#rsDevS')?.textContent || '', btns: [...b.querySelectorAll('button')].filter(x => /connect/i.test(x.textContent)).length, on: b.querySelector('[data-src="pm"]').classList.contains('on') }; });
    ok(pm.pm && pm.gone && !pm.dev && pm.set === 'pm' && pm.on, 'power meter only: the trainer is disconnected, the choice is kept');
    ok(!pm.erg && pm.tErg === null && pm.modesOff && pm.virtOff && pm.realOn, 'no ERG, no gradient modes, no virtual gears');
    ok(/never controls the trainer/.test(pm.note) && /Power meter: not connected/.test(pm.conn) && pm.btns === 0, `one line explains it, the devices line says “${pm.conn}”, no connect button in the setup (owner 27.11.: one home)`);
    { // the devices line leads to Devices: the power meter and the strap connect there, Back returns to the setup
      await R.evaluate(() => { window.__picks = 0; const bt = navigator.bluetooth || {}; bt.requestDevice = async () => { window.__picks++; throw Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' }); }; if (!navigator.bluetooth) Object.defineProperty(navigator, 'bluetooth', { value: bt, configurable: true }); });
      await R.click('.rsbox #rsDev'); await R.waitForSelector('#dvHr');
      ok(/Connect power meter/.test(await R.textContent('#dvTr')), 'Devices offers “Connect power meter”');
      await R.click('#dvHr'); await R.waitForTimeout(400);
      ok(await R.evaluate(() => window.__picks) === 1 && await R.evaluate(() => !!document.querySelector('#dvHr')), 'Devices: “Connect heart rate” opens the device list, the sheet stays open');
      await R.click('#mBack'); await R.waitForSelector('.rsbox [data-mode]'); ok(true, 'Back: Workout & mode again'); }
    if (SHOTS) await R.screenshot({ path: `${SHOTS}/ridesetup_pm_1280.png` });
    await R.evaluate(() => { const t = window.__ride.state.trainer; window.__w = []; // a power meter connected (fake): watts in, nothing out
      t.device = { name: 'ASSIOMA TEST', gatt: { connected: true, disconnect() {} } }; t.mode = 'pm'; t.lastData = performance.now();
      t.cp = { writeValue: b => { window.__w.push([...b]); return Promise.resolve(); } }; });
    await press('B'); await R.waitForTimeout(2500);
    const pr = await R.evaluate(() => { const r = window.__ride; return { w: window.__w.length, paused: r.paused, target: r.wNow?.target, wt: document.querySelector('#hWT')?.textContent || '', step: document.querySelector('#hWStep')?.textContent || '' }; });
    ok(!pr.paused && pr.w === 0, `riding with the power meter: nothing written to a trainer (${pr.w} writes)`);
    ok(pr.target > 0 && /\d/.test(pr.wt + pr.step), `the workout shows its target only (${pr.target} W)`);
    await R.keyboard.press('o'); await R.waitForSelector('.rsbox'); ok(/Power meter: ASSIOMA TEST ✓/.test(await R.locator('#rsDevS').textContent()), 'the setup names the connected power meter');
    ok(await tabTo('src:trainer'), 'keyboard: Tab to “Trainer control”'); await R.keyboard.press('Enter'); await R.waitForTimeout(300);
    const tc = await R.evaluate(() => { const r = window.__ride; return { pm: r.state.trainer.pmOnly, dev: !!r.state.trainer.device, erg: r.erg, set: r.state.settings.powerSource }; });
    ok(!tc.pm && !tc.dev && tc.erg && tc.set === 'trainer', 'trainer control again: the power meter is disconnected, ERG back');
    await R.keyboard.press('Escape').catch(() => {}); await tabTo('oBack'); await R.keyboard.press('Enter'); await R.waitForTimeout(500);

    // ---- the phone width: the panel fits ----
    await R.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {}); await R.waitForTimeout(300); await R.setViewportSize({ width: 390, height: 844 }); await R.keyboard.press('o'); await R.waitForSelector('.rsbox'); await R.waitForTimeout(300);
    ok(await R.evaluate(() => { const b = document.querySelector('.rsbox').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; }), 'setup at 390 px: inside the screen, no sideways scroll');
    if (SHOTS) await R.screenshot({ path: `${SHOTS}/ridesetup_390.png` });
    await R.click('.rsbox [data-w="ss2x12"]'); await R.waitForSelector('#raGo'); ok(await R.evaluate(() => { const b = document.querySelector('.rsbox').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; }), 'adjust at 390 px: inside the screen'); await R.click('#raGo'); await R.setViewportSize({ width: 1280, height: 860 });
    await R.waitForTimeout(31000); // a saved ride needs 30 s
    await R.click('#hPause'); await R.click('#pEnd'); await R.click('#pSave'); await R.waitForTimeout(2500);
    const rec = await R.evaluate(async () => { const { db } = await import('/js/db.js'); return (await db.all('rides')).filter(r => r.routeId === 'demo').sort((a, b) => b.date - a.date)[0]; });
    ok(rec && /Sweet Spot/.test(rec.workout || '') && rec.workoutId === 'ss2x12', `saved ride: the workout chosen in the ride (${rec?.workout})`);
    ok(!errs.length, 'no page errors, no browser dialogs' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + e.message.split('\n').slice(0, 4).join(' | ')); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nRide setup UI: all good'); process.exit(fails ? 1 : 0);
})();
