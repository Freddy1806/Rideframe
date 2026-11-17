// Live interval watts in a workout end to end (owner: "VO2max 5 × 5, and turn the watts up while riding, also with the controller").
// 3D ride (Passo Demo, no trainer, 2D demo scene) with the "VO2max 5 × 5" preset: W / S keys (Shift 1 W), the − / + buttons in
// the workout panel, pause Options and a fake gamepad (navigator.getGamepads replaced before the app loads; D-pad ↑ / ↓ in a
// workout) move the hard intervals' target in watts (±150 W); rests stay; the gear keys + / − and pad R still shift; the saved
// ride keeps wAdj and its time-weighted average, the summary shows "Intervals +10 W". Also: the preset in the Training tab
// and route picker, a free ride without the control, and the phone indoor page ("Intensity" %, interval watts by buttons,
// arrows, Q/E/PageUp/PageDown).
// Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) node tools/intensity-ui.cjs   SHOTS=<dir> saves screenshots (deviceScaleFactor 2).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0; const ok = (c, m, info = '') => { n++; console.log(`${c ? '✓' : '✗'} ${m}${!c && info ? ' · ' + info : ''}`); if (!c) fails++; };

function fakePad() { // a standard-mapping gamepad; window.__pad.press(i) holds button i for a few frames
  const btn = () => ({ pressed: false, value: 0 });
  const pad = { id: 'Test pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, btn), axes: [0, 0, 0, 0] };
  window.__pad = { pad, on: false, press: i => new Promise(r => { pad.buttons[i].pressed = true; setTimeout(() => { pad.buttons[i].pressed = false; setTimeout(r, 120); }, 120); }) };
  navigator.getGamepads = () => window.__pad.on ? [pad] : [];
}

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-intensity-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push('desktop: ' + e.message)); p.on('dialog', d => d.accept());
    await p.addInitScript(fakePad);
    await p.goto(BASE + '/?desktop&noprofile&demo&laptest'); await p.waitForTimeout(800);

    // ---- the preset in the Training tab ----
    await p.click('.tab[data-view="training"]'); await p.waitForTimeout(400);
    const card = p.locator('.wcard', { hasText: 'VO2max 5 × 5' });
    ok(await card.count() === 1, 'Training tab: a "VO2max 5 × 5" card');
    ok(/5 × 5 min at 110 % FTP, 5 min easy\. Long VO2max intervals, hard but steady\./.test(await card.textContent().catch(() => '')), 'Training tab: its description');
    if (SHOTS) { await card.scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(SHOTS, 'training_tab_vo2_5x5_1280.png') }); }

    // ---- the route page picker, then a 3D ride with the workout ----
    await p.click('.tab[data-view="library"]'); await p.click('.card[data-id="demo"]'); await p.waitForSelector('#workSel');
    ok(await p.locator('#workSel option[value="vo2_5x5"]').count() === 1, 'route page: "VO2max 5 × 5" in the workout picker');
    await p.selectOption('#workSel', 'vo2_5x5'); await p.waitForTimeout(300);
    if (SHOTS) { const wp = p.locator('.workout-pick'); await wp.scrollIntoViewIfNeeded(); await wp.screenshot({ path: path.join(SHOTS, 'workout_picker_vo2_5x5_1280.png') }); }
    await p.click('#rideBtn');
    await p.waitForFunction(() => window.__ride?.q && document.querySelector('#hWork'), null, { timeout: 30000 });
    await p.waitForFunction(() => window.__ride.running && !document.querySelector('.countdown'), null, { timeout: 15000 });
    await p.evaluate(() => { window.__ride.elapsed = 10 * 60 + 5; }); // into the first interval: VO2max 1/5 at 110 % of FTP 200 = 220 W
    await p.waitForTimeout(300);
    const H = () => p.evaluate(() => { const q = s => document.querySelector(s), r = window.__ride;
      return { a: r.wAdj, t: q('#hWT').textContent, v: q('#hWAdjV').textContent, adj: q('#hWAdj').classList.contains('adj'), op: getComputedStyle(q('#hWAdj')).opacity,
        next: q('#hWNext').textContent, step: q('#hWStep').textContent, flash: q('#hFlash')?.textContent || '', target: r.wNow?.target, gi: r.gi }; });
    const F = await p.evaluate(() => window.__ride.ftp), B = Math.round(110 * F / 100), RB = Math.round(50 * F / 100), T = a => String(Math.max(50, B + a)); // interval and rest targets from this FTP
    const h0 = await H();
    ok(h0.step === 'VO2max 1/5' && h0.t === String(B) && h0.a === 0, `workout runs: VO2max 1/5, target ${B} W (110 % of FTP ${F}), offset 0`, JSON.stringify(h0));
    ok(!h0.adj && h0.op === '0', 'offset 0: the − / + control stays hidden (calm HUD)', JSON.stringify(h0));
    await p.hover('#hWork'); await p.waitForTimeout(350);
    ok(+(await H()).op > 0.95, 'hovering the workout panel shows − ±0 W +');
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'ride_hud_0_hover_1280.png') });
    await p.mouse.move(640, 300); await p.waitForTimeout(1800);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'ride_hud_0_1280.png') });

    // ---- keyboard: W twice -> +10 W, S three times -> −5 W ----
    await p.keyboard.press('w'); await p.keyboard.press('w'); await p.waitForTimeout(200);
    const h1 = await H();
    ok(h1.a === 10 && h1.v === '+10 W' && h1.t === T(10), `W W: offset +10 W, #hWT = ${T(10)}`, JSON.stringify(h1));
    await p.waitForTimeout(300); ok(h1.adj && +(await H()).op > 0.95, 'offset not 0: the control stays visible', JSON.stringify(h1));
    ok(h1.flash === `Intervals +10 W · target ${T(10)} W`, `flash "Intervals +10 W · target ${T(10)} W"`, h1.flash);
    ok(h1.next === `Next: Rest · ${RB} W`, `the rest after it stays ${RB} W`, h1.next);
    await p.waitForTimeout(1800);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'ride_hud_plus10_1280.png') });
    for (let i = 0; i < 3; i++) await p.keyboard.press('s');
    await p.waitForTimeout(200);
    const h2 = await H();
    ok(h2.a === -5 && h2.v === '−5 W' && h2.t === T(-5), `S S S: −5 W, target ${T(-5)}`, JSON.stringify(h2));
    await p.keyboard.press('Shift+W'); await p.waitForTimeout(100);
    ok((await H()).a === -4, 'Shift+W: 1 W step (−4 W)');
    await p.keyboard.press('Shift+S'); await p.waitForTimeout(100);

    // ---- clamps ----
    for (let i = 0; i < 40; i++) await p.keyboard.press('w');
    await p.waitForTimeout(150); const h3 = await H();
    ok(h3.a === 150 && h3.t === T(150), `clamped at +150 W (${T(150)} W)`, JSON.stringify(h3));
    for (let i = 0; i < 70; i++) await p.keyboard.press('s');
    await p.waitForTimeout(150); const h4 = await H();
    ok(h4.a === -150 && h4.t === T(-150), `clamped at −150 W (${T(-150)} W)`, JSON.stringify(h4));

    // ---- the "then" preview in a rest is the next interval, tuned ----
    for (let i = 0; i < 32; i++) await p.keyboard.press('w'); // −150 + 160 -> +10
    await p.evaluate(() => { window.__ride.elapsed = 15 * 60 + 5; }); await p.waitForTimeout(300);
    const hr = await H();
    ok(hr.a === 10 && hr.step === 'Rest' && hr.t === String(RB) && hr.next === `Next: VO2max 2/5 · ${T(10)} W`, `in a rest: target ${RB} W untouched, next interval previewed at ${T(10)} W`, JSON.stringify(hr));
    await p.evaluate(() => { window.__ride.elapsed = 10 * 60 + 30; }); await p.waitForTimeout(300);

    // ---- gear keys still shift, not the watts ----
    await p.keyboard.press('+'); await p.waitForTimeout(150);
    ok((await H()).a === 10, 'the + key still shifts gears, offset unchanged');

    // ---- on-screen buttons ----
    await p.click('#hWAdj [data-wa="5"]'); await p.click('#hWAdj [data-wa="5"]'); await p.waitForTimeout(150);
    ok((await H()).a === 20, 'HUD + clicked twice: +20 W');
    await p.click('#hWAdj [data-wa="-5"]'); await p.waitForTimeout(150);
    ok((await H()).a === 15 && (await H()).t === T(15), `HUD − clicked: +15 W, target ${T(15)}`);
    const box = await p.locator('#hWAdj [data-wa="5"]').boundingBox();
    ok(box && box.width >= 36 && box.height >= 32, `HUD buttons large enough to click (${box && Math.round(box.width)}×${box && Math.round(box.height)} px)`);

    // ---- the controller: D-pad ↑ / ↓ tune the watts in a workout, L/R still shift ----
    await p.evaluate(() => { window.__pad.on = true; }); await p.waitForTimeout(200);
    ok(/D-pad up \/ down: interval watts/.test((await H()).flash), 'pad hint on connect: "D-pad up / down: interval watts"', (await H()).flash);
    const gA = (await H()).gi;
    await p.evaluate(() => window.__pad.press(12)); await p.evaluate(() => window.__pad.press(12));
    const h6 = await H(); ok(h6.a === 25 && h6.gi === gA, 'pad D-pad ↑ twice: +25 W, gear unchanged', JSON.stringify(h6));
    await p.evaluate(() => window.__pad.press(13));
    const h7 = await H(); ok(h7.a === 20 && h7.gi === gA && h7.t === T(20), `pad D-pad ↓: +20 W (${T(20)} W), gear unchanged`, JSON.stringify(h7));
    await p.evaluate(() => window.__pad.press(5)); const h8 = await H();
    ok(h8.a === 20 && h8.gi !== gA, 'pad R still shifts, offset unchanged', JSON.stringify({ gA, gi: h8.gi }));

    // ---- back to +10 W and finish: options, saved record and summary ----
    await p.keyboard.press('s'); await p.keyboard.press('s'); await p.waitForTimeout(1200);
    ok((await H()).a === 10, 'back to +10 W');
    await p.evaluate(() => window.__pad.press(9)); await p.waitForSelector('#pOpts');
    await p.click('#pOpts'); await p.waitForTimeout(200);
    const opt = await p.textContent('#pauseOverlay');
    ok(/Intervals \+5 W \(now \+10 W\)/.test(opt) && /Intervals −5 W/.test(opt) && /D-pad up \/ down: interval watts/.test(opt) && /W \/ S/.test(opt), 'pause Options: interval watt items and the key / pad help', opt);
    await p.click('#oAdjDn'); await p.waitForTimeout(200); ok((await H()).a === 5, 'Options "Intervals −5 W" works');
    await p.click('#oAdjUp'); await p.waitForTimeout(200); ok((await H()).a === 10, 'Options "Intervals +5 W" works');
    await p.click('#oBack'); await p.waitForSelector('#pSave'); await p.click('#pSave');
    await p.waitForSelector('.finish', { timeout: 10000 });
    const fin = await p.textContent('.finish');
    ok(/Intervals \+10 W/.test(fin), 'summary shows "Intervals +10 W"', fin.slice(0, 300));
    const rec = await p.evaluate(async () => { const { db } = await import('/js/db.js'); const rs = await db.ridesFor('demo'); return rs.sort((a, b) => b.date - a.date)[0] || null; });
    ok(rec && rec.wAdj === 10 && Number.isFinite(rec.wAdjAvg) && rec.wAdjAvg !== 0 && Math.abs(rec.wAdjAvg) <= 150, `saved ride: wAdj 10, time-weighted average ${rec?.wAdjAvg}`, JSON.stringify(rec && { a: rec.wAdj, v: rec.wAdjAvg }));
    ok(rec && rec.workoutId === 'vo2_5x5', 'saved ride: workoutId vo2_5x5');
    const iv = rec?.ivs?.[0];
    ok(!iv || (iv.target > B && iv.target <= B + 150), `interval summary target uses the tuned watts (${iv?.target ?? 'no interval row'})`, JSON.stringify(rec?.ivs));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'ride_summary_1280.png') });
    await ctx.close();

    // ---- a ride without a workout: W / S do nothing, no control ----
    const c2 = await b.newContext({ viewport: { width: 1280, height: 860 } });
    const p2 = await c2.newPage(); p2.on('pageerror', e => errs.push('free ride: ' + e.message)); p2.on('dialog', d => d.accept());
    await p2.goto(BASE + '/?desktop&noprofile&demo&laptest'); await p2.waitForTimeout(600);
    await p2.click('.tab[data-view="library"]'); await p2.click('.card[data-id="demo"]'); await p2.waitForSelector('#workSel'); await p2.selectOption('#workSel', '');
    await p2.click('#rideBtn'); await p2.waitForFunction(() => window.__ride?.running && !document.querySelector('.countdown'), null, { timeout: 30000 });
    await p2.keyboard.press('w'); await p2.waitForTimeout(150);
    ok(await p2.evaluate(() => !window.__ride.wAdj && !document.querySelector('#hWAdj')), 'free ride: no interval watt control, W does nothing');
    await c2.close();

    // ---- phone indoor page: the preset, "Intensity" and the interval watts ----
    const c3 = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const P = await c3.newPage(); P.on('pageerror', e => errs.push('pure: ' + e.message)); P.on('dialog', d => d.accept());
    await P.goto(BASE + '/pure.html?demo'); await P.waitForTimeout(700);
    await P.click('[data-m="work"]'); await P.waitForSelector('#pWork');
    ok(await P.locator('#pWork option[value="vo2_5x5"]').count() === 1, 'phone indoor: "VO2max 5 × 5" in the list');
    await P.selectOption('#pWork', 'vo2_5x5'); await P.waitForTimeout(300);
    ok(/Intensity/.test(await P.textContent('#pInt')) && /100 %/.test(await P.textContent('#pInt')), 'phone indoor: labelled "Intensity 100 %"');
    ok(/Intervals/.test(await P.textContent('#pAdj')) && /±0 W/.test(await P.textContent('#pAdj')), 'phone indoor: "Intervals ±0 W"');
    const warmT = await P.textContent('#pTarget'), fT = async () => +((await P.textContent('#pflash')).match(/^Intervals [+−±]\d+ W · target (\d+) W$/) || [])[1];
    await P.click('[data-wa="5"]'); const t5 = await fT(); await P.click('[data-wa="5"]'); await P.waitForTimeout(150); const t10 = await fT();
    ok(/\+10 W/.test(await P.textContent('#pAdj')) && t10 - t5 === 5, `phone indoor: +5 W twice = +10 W, flash "Intervals +10 W · target ${t10} W"`, await P.textContent('#pflash'));
    await P.click('[data-wa="-5"]'); await P.waitForTimeout(100);
    ok(/\+5 W/.test(await P.textContent('#pAdj')), 'phone indoor: −5 W = +5 W');
    await P.keyboard.press('ArrowUp'); await P.keyboard.press('Shift+ArrowUp'); await P.waitForTimeout(100);
    ok(/\+11 W/.test(await P.textContent('#pAdj')), 'phone indoor: ArrowUp +5, Shift+ArrowUp +1 = +11 W');
    await P.keyboard.press('q'); await P.keyboard.press('PageDown'); await P.waitForTimeout(100);
    ok(/\+1 W/.test(await P.textContent('#pAdj')) && !/Virtual gears are off/.test(await P.textContent('#pflash')), 'phone indoor: Q and PageDown move the watts (not "Virtual gears are off")');
    await P.keyboard.press('e'); await P.keyboard.press('PageUp'); await P.waitForTimeout(100);
    ok(/\+11 W/.test(await P.textContent('#pAdj')), 'phone indoor: E and PageUp +5 W each');
    for (let i = 0; i < 6; i++) await P.click('[data-i="5"]');
    ok(/130 %/.test(await P.textContent('#pInt')), 'phone indoor: intensity +5 % still works (130 %)');
    for (let i = 0; i < 6; i++) await P.click('[data-i="-5"]');
    await P.waitForTimeout(400); // #pTarget is painted by the 250 ms loop
    // the warm-up is not a hard step: its target is only scaled by the intensity, the offset does not touch it
    ok(/^Target \d+ W$/.test(warmT) && await P.textContent('#pTarget') === warmT, `phone indoor: warm-up target unchanged by the offset (${warmT}), the offset is only on intervals`, await P.textContent('#pTarget'));
    if (SHOTS) await P.screenshot({ path: path.join(SHOTS, 'pure_workout_390.png') });
    await c3.close();

    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + (e.stack || e.message)); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} of ${n} failed` : `\nIntensity UI: all ${n} good`); process.exit(fails ? 1 : 0);
})();
