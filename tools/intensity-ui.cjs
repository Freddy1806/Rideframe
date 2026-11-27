// Live interval watts in a workout end to end (owner: "VO2max 5 × 5, and turn the watts up while riding, also with the controller"),
// the easy-step offset (A / D, pad ← / →), the ERG ramps, and arrow keys from a controller in keyboard mode with a live
// (faked) trainer: interval / step watts, never keyboard watts; the group tailwind never touches the ERG target.
// 3D ride (Passo Demo, no trainer, 2D demo scene) with the "VO2max 5 × 5" preset: W / S keys (Shift 1 W), the − / + buttons in
// the workout panel, pause Options and a fake gamepad (navigator.getGamepads replaced before the app loads; D-pad ↑ / ↓ in a
// workout) move the hard intervals' target in watts (±150 W); rests stay; the gear keys + / − and pad R still shift; the saved
// ride keeps wAdj and its time-weighted average, the summary shows "Intervals +10 W". Also: the preset in the Training tab
// and route picker, a free ride without the control, and the phone indoor page ("Intensity" %, interval watts by buttons,
// arrows, Q/E/PageUp/PageDown; a builder workout in absolute watts: 30 / 15 with the offset during the interval, the float, the next set).
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
    ok(/5 × 5 min at 110 % FTP/.test(await card.textContent().catch(() => '')), 'Training tab: its description');
    if (SHOTS) { await card.scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(SHOTS, 'training_tab_vo2_5x5_1280.png') }); }

    // ---- the route page picker, then a 3D ride with the workout ----
    await p.click('.tab[data-view="library"]'); await p.click('.card[data-id="demo"]'); await p.waitForSelector('#workSel');
    ok(await p.locator('#workSel option[value="vo2_5x5"]').count() === 1, 'route page: "VO2max 5 × 5" in the workout picker');
    await p.selectOption('#workSel', 'vo2_5x5'); await p.waitForTimeout(300);
    if (SHOTS) { const wp = p.locator('.workout-pick'); await wp.scrollIntoViewIfNeeded(); await wp.screenshot({ path: path.join(SHOTS, 'workout_picker_vo2_5x5_1280.png') }); }
    await p.click('#rideBtn');
    await p.waitForFunction(() => window.__ride?.q && document.querySelector('#hWork'), null, { timeout: 30000 });
    await p.waitForFunction(() => window.__ride.running && !document.querySelector('.countdown'), null, { timeout: 15000 });
    await p.evaluate(() => { window.__A = window.__ride.workout.steps.slice(0, window.__ride.workout.steps.findIndex(x => x.label === 'VO2max 1/5')).reduce((t, x) => t + x.dur, 0); window.__RS = window.__A + 300; window.__B2 = window.__RS + 240; }); // the step times of this workout: VO2max 1/5 at __A, the first rest at __RS, VO2max 2/5 at __B2
    await p.evaluate(() => { window.__ride.elapsed = __A + 5; }); // into the first interval: VO2max 1/5 at 110 % of FTP
    await p.waitForTimeout(300);
    const H = () => p.evaluate(() => { const q = s => document.querySelector(s), r = window.__ride;
      return { a: r.wAdj, t: q('#hWT').textContent, v: q('#hWAdjV').textContent, adj: q('#hWork').classList.contains('adj'), tag: getComputedStyle(q('#hWAdjV')).display,
        next: q('#hWNextN').textContent + ' · ' + q('#hWNext').textContent.split(' · ')[0], step: q('#hWStep').textContent, of: q('#hWOf').textContent, st: q('#hWState').textContent, flash: q('#hFlash')?.textContent || '', target: r.wNow?.target, gi: r.gi }; });
    const F = await p.evaluate(() => window.__ride.ftp), B = Math.round(110 * F / 100), RB = Math.round(50 * F / 100), T = a => String(Math.max(50, B + a)); // interval and rest targets from this FTP
    const h0 = await H();
    ok(h0.step === 'VO2max 1/5' && h0.t === String(B) && h0.a === 0, `workout runs: VO2max 1/5, target ${B} W (110 % of FTP ${F}), offset 0`, JSON.stringify(h0));
    ok(!h0.adj && h0.tag === 'none', 'offset 0: no "+N W" tag in the bar', JSON.stringify(h0));
    ok(h0.of === 'interval 1 of 5', 'bar: "interval 1 of 5" next to the step name', h0.of);
    // design C: the bar sits at the bottom over the whole width, the metrics row above it, nothing overlaps
    const lay = await p.evaluate(() => { const bar = document.querySelector('#hWork').getBoundingClientRect(), hb = document.querySelector('.hud-bottom').getBoundingClientRect();
      return { bot: Math.round(innerHeight - bar.bottom), w: Math.round(bar.width), top: Math.round(bar.top), hb: Math.round(hb.bottom), ring: !!document.querySelector('#hWArc'), tl: document.querySelectorAll('#hWChart .wtl rect').length }; });
    ok(lay.bot <= 1 && lay.w >= 1270 && lay.hb <= lay.top, 'workout bar at the bottom, full width, metrics row above it', JSON.stringify(lay));
    ok(lay.ring && lay.tl >= 12, 'bar: time ring and the whole workout as a timeline (every step a block)', JSON.stringify(lay));
    await p.waitForTimeout(1800);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'ride_hud_0_1280.png') });

    // ---- keyboard: W twice -> +10 W, S three times -> −5 W ----
    await p.keyboard.press('w'); await p.keyboard.press('w'); await p.waitForTimeout(200);
    const h1 = await H();
    ok(h1.a === 10 && h1.v === '+10 W' && h1.t === T(10), `W W: offset +10 W, #hWT = ${T(10)}`, JSON.stringify(h1));
    ok(h1.adj && h1.tag !== 'none', 'offset not 0: the bar shows the "+10 W" tag', JSON.stringify(h1));
    ok(h1.flash === `Target ${T(10)} W (+10 W on the intervals)`, `flash "Target ${T(10)} W (+10 W on the intervals)"`, h1.flash);
    ok(h1.next === `Rest · ${RB} W`, `next step "Rest · ${RB} W" (the rest stays)`, h1.next);
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
    await p.evaluate(() => { window.__ride.elapsed = __RS + 8; }); await p.waitForTimeout(300); // past the 5 s ramp down
    const hr = await H();
    ok(hr.a === 10 && hr.step === 'Rest' && hr.t === String(RB) && hr.next === `VO2max 2/5 · ${T(10)} W`, `in a rest: target ${RB} W untouched, next interval previewed at ${T(10)} W`, JSON.stringify(hr));
    // ---- the easy parts have their own offset (owner 17.11.): W / S in a rest move it, kept for every later easy step ----
    await p.keyboard.press('w'); await p.keyboard.press('w'); await p.keyboard.press('Shift+S'); await p.waitForTimeout(150);
    const hs = await p.evaluate(() => ({ e: window.__ride.wAdjE, a: window.__ride.wAdj, t: document.querySelector('#hWT').textContent, tag: document.querySelector('#hWAdjV').textContent, f: document.querySelector('#hFlash')?.textContent }));
    ok(hs.e === 9 && hs.a === 10 && hs.t === String(RB + 9) && hs.tag === '+9 W', `W W Shift+S in the rest: easy parts +9 W (${RB + 9} W), interval offset still +10, the bar shows +9 W`, JSON.stringify(hs));
    ok(hs.f === `Target ${RB + 9} W (+9 W on the easy parts)`, 'flash says "on the easy parts"', hs.f);
    await p.evaluate(() => { window.__ride.elapsed = __B2 + 68; }); await p.waitForTimeout(200);
    ok(await p.evaluate(() => window.__ride.wAdjE === 9 && window.__ride.wNow.target === window.__ride.wNow.plateau && +document.querySelector('#hWAdjV').textContent.replace(/\D/g, '') === 10), 'in the next interval: its own +10 W, the easy offset waits');
    await p.evaluate(() => { window.__ride.elapsed = __RS + 8; }); await p.waitForTimeout(200);
    // ---- ERG ramp: 10 s up into the interval, the step offset ends with the rest ----
    await p.evaluate(() => { window.__ride.elapsed = __B2 - 5; }); await p.waitForTimeout(200);
    const rp = await p.evaluate(() => ({ t: +document.querySelector('#hWT').textContent, of: document.querySelector('#hWOf').textContent, cue: !document.querySelector('#hWCue').hidden && document.querySelector('#hWCueN').textContent, ramp: window.__ride.wNow.ramp }));
    ok(rp.ramp === 'in' && rp.t > RB + 9 && rp.t < B + 10 && rp.of === 'ramp up', `ERG ramp: 5 s before the interval the target is ${rp.t} W (between ${RB + 9} and ${B + 10})`, JSON.stringify(rp));
    await p.evaluate(() => { window.__ride.elapsed = __B2 - 2.5; }); await p.waitForTimeout(200);
    const cd = await p.evaluate(() => ({ on: !document.querySelector('#hWCue').hidden, n: document.querySelector('#hWCueN').textContent, w: document.querySelector('#hWCueW').textContent }));
    ok(cd.on && cd.n === '3' && /^VO2max 2\/5 · \d+ W$/.test(cd.w), `countdown into the interval: "3" above the bar, "${cd.w}"`, JSON.stringify(cd));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'ride_hud_ramp_1280.png') });
    await p.waitForFunction(() => document.querySelector('#hWStep').textContent === 'VO2max 2/5', null, { timeout: 8000 });
    await p.evaluate(() => { window.__ride.elapsed = __A + 30; }); await p.waitForTimeout(300);

    // ---- gear keys still shift, not the watts ----
    await p.keyboard.press('+'); await p.waitForTimeout(150);
    ok((await H()).a === 10, 'the + key still shifts gears, offset unchanged');

    // ---- on-screen buttons ----
    await p.click('#hWAdj [data-wa="5"]'); await p.click('#hWAdj [data-wa="5"]'); await p.waitForTimeout(150);
    ok((await H()).a === 20, 'HUD + clicked twice: +20 W');
    await p.click('#hWAdj [data-wa="-5"]'); await p.waitForTimeout(150);
    ok((await H()).a === 15 && (await H()).t === T(15), `HUD − clicked: +15 W, target ${T(15)}`);
    const box = await p.locator('#hWAdj [data-wa="5"]').boundingBox();
    // ---- three views of the interval display (owner 17.11.): button on the bar, key L, pause Options; kept in the settings ----
    const vw = () => p.evaluate(() => ({ c: document.querySelector('#hWork').className, s: window.__ride.state.settings.wbView, f: document.querySelector('#hFlash')?.textContent }));
    ok(/v-big/.test((await vw()).c), 'interval display: big (design C) by default');
    await p.click('#hWView'); await p.waitForTimeout(300); const v1 = await vw();
    ok(/v-compact/.test(v1.c) && v1.s === 'compact' && v1.f === 'Interval display: compact', 'View button: compact', JSON.stringify(v1));
    const cl = await p.evaluate(() => { const r = document.querySelector('#hWork .wb-row').getBoundingClientRect(), t = document.querySelector('#hWTime'); return { h: Math.round(document.querySelector('#hWork').getBoundingClientRect().height), ring: getComputedStyle(document.querySelector('.wring')).display, time: getComputedStyle(t).display !== 'none' && t.textContent }; });
    ok(cl.ring === 'none' && cl.time && cl.h < 200, `compact: slim bar (${cl.h} px), time left as text, no ring`, JSON.stringify(cl));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'ride_view_compact_1280.png') });
    await p.keyboard.press('l'); await p.waitForTimeout(300); const v2 = await vw();
    const fc = await p.evaluate(() => { const r = document.querySelector('#hWork .wb-row').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(innerWidth - r.right), z: getComputedStyle(document.querySelector('#hWZone')).visibility }; });
    ok(/v-focus/.test(v2.c) && v2.s === 'focus' && Math.abs(fc.l - fc.r) <= 2 && fc.l > 100 && fc.z === 'visible', 'key L: focus, a centred card with the zone gauge', JSON.stringify({ v2, fc }));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'ride_view_focus_1280.png') });
    await p.keyboard.press('l'); await p.waitForTimeout(300);
    const kept = await p.evaluate(async () => { const { db } = await import('/js/db.js'); return (await db.kvGet('settings'))?.wbView; });
    ok(/v-big/.test((await vw()).c) && kept === 'big', 'key L again: back to big, saved in the settings', String(kept));
    ok(box && box.width >= 36 && box.height >= 32, `HUD buttons large enough to click (${box && Math.round(box.width)}×${box && Math.round(box.height)} px)`);

    // ---- the controller: D-pad ↑ / ↓ tune the watts in a workout, L/R still shift ----
    await p.evaluate(() => { window.__pad.on = true; }); await p.waitForTimeout(200);
    ok(/Controller ready/.test((await H()).flash), 'pad hint on connect: "Controller ready"', (await H()).flash);
    const gA = (await H()).gi;
    await p.evaluate(() => window.__pad.press(12)); await p.evaluate(() => window.__pad.press(12));
    const h6 = await H(); ok(h6.a === 25 && h6.gi === gA, 'pad D-pad ↑ twice: +25 W (5 W steps), gear unchanged', JSON.stringify(h6));
    await p.evaluate(() => window.__pad.press(13));
    const h7 = await H(); ok(h7.a === 20 && h7.gi === gA && h7.t === T(20), `pad D-pad ↓: +20 W (${T(20)} W), gear unchanged`, JSON.stringify(h7));
    await p.evaluate(() => window.__pad.press(5)); await p.evaluate(() => window.__pad.press(4)); await p.evaluate(() => window.__pad.press(5)); const h8 = await H();
    ok(h8.a === 25 && h8.gi === gA, 'pad R, L, R in a workout: ±5 W each (+25 W), no gear change', JSON.stringify({ gA, gi: h8.gi, a: h8.a }));
    await p.evaluate(() => window.__pad.press(6)); await p.evaluate(() => window.__pad.press(6)); await p.evaluate(() => window.__pad.press(6)); const h9 = await H();
    ok(h9.a === 22, 'pad L2 three times: −1 W each (+22 W)', JSON.stringify(h9));

    await p.evaluate(() => { window.__ride.elapsed = __RS + 30; }); await p.waitForTimeout(250);
    await p.evaluate(() => window.__pad.press(7));
    ok(await p.evaluate(() => window.__ride.wAdjE === 10 && window.__ride.wAdj === 22), 'pad R2 in the rest: easy parts +10 W, intervals untouched');
    await p.evaluate(() => { window.__ride.elapsed = __A + 40; }); await p.waitForTimeout(250);
    // ---- back to +10 W and finish: options, saved record and summary ----
    await p.keyboard.press('s'); await p.keyboard.press('s'); await p.keyboard.press('Shift+S'); await p.keyboard.press('Shift+S'); await p.waitForTimeout(1200);
    ok((await H()).a === 10, 'back to +10 W');
    await p.evaluate(() => window.__pad.press(9)); await p.waitForSelector('#pOpts');
    await p.click('#pOpts'); await p.waitForTimeout(200);
    const opt = await p.textContent('#pauseOverlay');
    ok(/Target \+5 W \(intervals now \+10 W\)/.test(opt) && /Target −5 W/.test(opt) && /L \/ R or D-pad up \/ down: target ±5 W/.test(opt) && /W \/ S/.test(opt) && /Interval display: big/.test(opt), 'pause Options: target items, interval display and the key / pad help', opt);
    await p.click('#oAdjDn'); await p.waitForTimeout(200); ok((await H()).a === 5, 'Options "Target −5 W" works (in an interval: the intervals)');
    await p.click('#oAdjUp'); await p.waitForTimeout(200); ok((await H()).a === 10, 'Options "Target +5 W" works');
    await p.click('#oBack'); await p.waitForSelector('#pSave'); await p.click('#pSave');
    await p.waitForSelector('.finish', { timeout: 10000 });
    const fin = await p.textContent('.finish');
    ok(/Intervals \+10 W/.test(fin) && /easy parts \+10 W/.test(fin), 'summary shows "Intervals +10 W … easy parts +10 W"', fin.slice(0, 300));
    const rec = await p.evaluate(async () => { const { db } = await import('/js/db.js'); const rs = await db.ridesFor('demo'); return rs.sort((a, b) => b.date - a.date)[0] || null; });
    ok(rec && rec.wAdj === 10 && Number.isFinite(rec.wAdjAvg) && rec.wAdjAvg !== 0 && Math.abs(rec.wAdjAvg) <= 150, `saved ride: wAdj 10, time-weighted average ${rec?.wAdjAvg}`, JSON.stringify(rec && { a: rec.wAdj, v: rec.wAdjAvg }));
    ok(rec && rec.workoutId === 'vo2_5x5' && rec.wAdjE === 10, 'saved ride: workoutId vo2_5x5, easy parts offset wAdjE 10');
    const iv = rec?.ivs?.[0];
    ok(!iv || (iv.target > B && iv.target <= B + 150), `interval summary target uses the tuned watts (${iv?.target ?? 'no interval row'})`, JSON.stringify(rec?.ivs));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'ride_summary_1280.png') });
    await ctx.close();

    // ---- non-ERG workout: the target is a zone to hold ----
    const ride2 = async (work, erg, tag) => { const c = await b.newContext({ viewport: { width: 1280, height: 720 } }), q2 = await c.newPage();
      q2.on('pageerror', e => errs.push(tag + ': ' + e.message)); q2.on('dialog', d => d.accept());
      await q2.goto(BASE + '/?desktop&noprofile&demo&laptest'); await q2.waitForTimeout(600);
      await q2.click('.tab[data-view="library"]'); await q2.click('.card[data-id="demo"]'); await q2.waitForSelector('#workSel'); await q2.selectOption('#workSel', work);
      if (await q2.isChecked('#ergChk') !== erg) await q2.click('#ergChk');
      await q2.click('#rideBtn'); await q2.waitForFunction(() => window.__ride?.running && !document.querySelector('.countdown'), null, { timeout: 30000 });
      if (work) await q2.evaluate(() => { window.__A = window.__ride.workout.steps.slice(0, window.__ride.workout.steps.findIndex(x => x.label === 'VO2max 1/5')).reduce((t, x) => t + x.dur, 0); window.__RS = window.__A + 300; window.__B2 = window.__RS + 240; });
      return [c, q2]; };
    // a trainer that delivers power (no Bluetooth: the shared Trainer object gets a fake connection and fresh data)
    const fakeTrainer = q2 => q2.evaluate(() => { const t = window.__ride.state.trainer; t.device = { gatt: { connected: true } }; t.data = { power: 240, cadence: 90, speed: 9, hr: 0 };
      window.__tl = setInterval(() => { t.lastData = performance.now(); t.data.power = window.__tp ?? 240; t.data.cadence = window.__tc ?? 90; }, 100); t.lastData = performance.now(); });
    {
      const [c, q2] = await ride2('vo2_5x5', false, 'non-ERG');
      await q2.evaluate(() => { window.__ride.elapsed = __A + 5; }); await q2.waitForTimeout(300);
      const z = await q2.evaluate(() => ({ name: document.querySelector('#hWName').textContent, t: +document.querySelector('#hWT').textContent, w: window.__ride.wNow }));
      ok(z.name === 'VO2max 5 × 5' && z.t === z.w.target, 'non-ERG workout: panel without "ERG", target shown', JSON.stringify({ name: z.name, t: z.t }));
      await q2.evaluate(() => { window.__ride.elapsed = __A - 5; }); await q2.waitForTimeout(200);
      ok(await q2.evaluate(() => window.__ride.wNow.ramp === null), 'non-ERG: no ramp (the target is a step to hit, nothing is pushed to the trainer)');
      await c.close();
    }
    // ---- ERG workout on a route (owner 17.11.): the climb counts as on any ride (speed comes from the power on the route's
    //      grade); the saved ride only carries a marker; the Strava file is the same as without it ----
    {
      const [c, q2] = await ride2('vo2_5x5', true, 'erg climb');
      const up = await q2.evaluate(async () => { const r = window.__ride; r.elapsed = 60; r.manualPower = 400; const d0 = r.d; /* over the 30 s a saved ride needs */ await new Promise(z => setTimeout(z, 4000)); return { dd: r.d - d0, gain: r.gainAcc, on: r._ergOn }; });
      ok(up.on && up.dd > 10 && up.gain > 0.3, `ERG part: ${up.dd.toFixed(0)} m uphill ridden, ${up.gain.toFixed(1)} m climb counted (as on any ride)`, JSON.stringify(up));
      await q2.keyboard.press('Space'); await q2.waitForSelector('#pSave'); await q2.click('#pSave'); await q2.waitForSelector('.finish', { timeout: 10000 });
      const fin = await q2.textContent('.finish');
      const rec = await q2.evaluate(async () => { const { db } = await import('/js/db.js'); return (await db.ridesFor('demo')).sort((a, b) => b.date - a.date)[0]; });
      ok(rec.erg === true && rec.mode === 'Workout (ERG)' && rec.ergSpans === undefined && rec.gain >= Math.floor(up.gain), `saved: erg true, mode "Workout (ERG)", gain ${rec.gain} m kept`, JSON.stringify({ erg: rec.erg, mode: rec.mode, gain: rec.gain }));
      ok(/Workout \(ERG\)/.test(fin) && !/no climb|no best time on this route/i.test(fin), 'summary says "Workout (ERG)", nothing about climb or best times', fin.slice(0, 300));
      let sent = null;
      await q2.route('**/api/strava/upload', r => { sent = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":1}' }); });
      await q2.route('**/api/strava/upload/1*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"activity_id":42}' }));
      const same = await q2.evaluate(async rec => { const [{ stravaUpload }, { routeFns, toTCX }] = await Promise.all([import('/js/stravaup.js'), import('/js/tcx.js')]); const { routeById } = await import('/js/app.js');
        const fns = routeFns(routeById('demo').track); await stravaUpload(rec, 'Passo Demo', fns); const plain = { ...rec }; delete plain.erg; delete plain.mode;
        return toTCX(rec, 'Passo Demo', fns) === toTCX(plain, 'Passo Demo', fns); }, rec);
      const al = sent ? [...sent.tcx.matchAll(/<AltitudeMeters>([\d.]+)/g)].map(m => +m[1]) : [];
      ok(sent && /· Workout \(ERG\)$/.test(sent.name) && /Workout \(ERG\)/.test(sent.description) && !/not ridden|flat/.test(sent.description), 'Strava title and description: "Workout (ERG)" marker only', JSON.stringify(sent && { n: sent.name, d: sent.description.slice(0, 200) }));
      ok(same && al.length > 3 && al.at(-1) > al[0], `Strava file identical to the same ride without the marker, altitude climbing (${al[0]} → ${al.at(-1)} m)`, JSON.stringify({ same, a: al.slice(0, 5) }));
      await c.close();
    }
    {
      const [c, q2] = await ride2('vo2_5x5', false, 'sim climb');
      const up = await q2.evaluate(async () => { const r = window.__ride; r.manualPower = 400; await new Promise(z => setTimeout(z, 4000)); return { gain: r.gainAcc, on: !!r._ergOn }; });
      ok(!up.on && up.gain > 0.3, `workout without ERG: the gradient is simulated, ${up.gain.toFixed(1)} m climb counted`, JSON.stringify(up));
      await c.close();
    }
    // ---- B: a controller in keyboard mode sends ↑ / ↓; with a live trainer they tune the intervals, never keyboard watts ----
    {
      const [c, q2] = await ride2('vo2_5x5', true, 'trainer workout');
      await q2.evaluate(() => { window.__ride.elapsed = __A + 5; }); await fakeTrainer(q2); await q2.waitForTimeout(400);
      const base = await q2.evaluate(() => +document.querySelector('#hWT').textContent);
      for (let k = 0; k < 3; k++) await q2.keyboard.press('ArrowUp');
      await q2.waitForTimeout(150);
      const k1 = await q2.evaluate(() => { const r = window.__ride; return { a: r.wAdj, kp: !!r.keyPower, mp: r.manualPower, src: r.source, t: +document.querySelector('#hWT').textContent, erg: r.state.trainer.erg, f: document.querySelector('#hFlash')?.textContent }; });
      ok(k1.a === 3 && !k1.kp && k1.mp === 0 && k1.src === 'trainer', 'trainer + workout: ↑ ↑ ↑ = target +3 W (1 W steps), no keyboard watts', JSON.stringify(k1));
      ok(k1.t === base + 3 && k1.erg === base + 3, `ERG follows: the trainer is asked for ${base + 3} W`, JSON.stringify(k1));
      ok(k1.f === 'Controller is in keyboard mode: switch it to D for all buttons', 'one-time hint: controller in keyboard mode', k1.f);
      // the zone band: too low / in zone / too high from the trainer's power against the (tuned) target
      const zs = async pw => { await q2.evaluate(pw => { window.__tp = pw; window.__ride.powerHist = []; }, pw); await q2.waitForTimeout(1500);
        return q2.evaluate(() => ({ st: document.querySelector('#hWState').textContent, cls: document.querySelector('#hWPow').className, zone: document.querySelector('#hWZone').className, p: +document.querySelector('#hWP').textContent })); };
      const zl = await zs(base - 40), zo = await zs(base + 15), zh = await zs(base + 60);
      // ERG: the trainer holds the watts, so no red verdict for the rider (owner 18.11.), only a calm "trainer settling", after 12 s "trainer N W off"
      ok(zl.st === 'trainer settling' && !/z-/.test(zl.cls) && !/z-/.test(zl.zone), `ERG, ${base - 40} W: "${zl.st}", no red verdict`, JSON.stringify(zl));
      ok(zo.st === 'in zone' && !/z-/.test(zo.cls), `${base + 15} W: "in zone"`, JSON.stringify(zo));
      ok(zh.st === 'trainer settling' && !/z-/.test(zh.cls), `ERG, ${base + 60} W: "${zh.st}", no red verdict`, JSON.stringify(zh));
      await q2.evaluate(() => { window.__ride._ergOffAt = performance.now() - 13000; }); await q2.waitForTimeout(700);
      const zo2 = await q2.evaluate(() => ({ st: document.querySelector('#hWState').textContent, cls: document.querySelector('#hWPow').className }));
      ok(/^trainer \d+ W off$/.test(zo2.st) && !/z-/.test(zo2.cls), `ERG, off for 12 s: "${zo2.st}", still not red`, JSON.stringify(zo2));
      const ne = await q2.evaluate(async () => { const r = window.__ride, was = r._ergOn; r._ergOn = false; r._workoutHUD(r.power); const o = { st: document.querySelector('#hWState').textContent, cls: document.querySelector('#hWPow').className }; r._ergOn = was; return o; });
      ok(/^\d+ W too high$/.test(ne.st) && /z-hi/.test(ne.cls), `without ERG the verdict stays: "${ne.st}"`, JSON.stringify(ne));
      await q2.evaluate(() => { window.__tp = 240; });
      await q2.keyboard.press('Shift+ArrowDown'); await q2.waitForTimeout(100);
      ok(await q2.evaluate(() => window.__ride.wAdj === -2 && !window.__ride.keyPower), 'Shift+↓ = −5 W');
      // group seams: "keep the group together" tailwind and drafting only change the virtual speed, never the ERG target
      const tw = await q2.evaluate(async () => { const r = window.__ride, t = r.state.trainer; r._togetherTo = 0.6; r._draftTo = 0.3; await new Promise(z => setTimeout(z, 1500));
        return { erg: t.erg, target: r.wNow.target, togK: r._togK }; });
      ok(tw.togK > 0.1 && tw.erg === tw.target && tw.erg === base - 2, `tailwind / slipstream on (k ${tw.togK.toFixed(2)}): the trainer still holds ${base - 2} W`, JSON.stringify(tw));
      await q2.evaluate(() => { const r = window.__ride; r._togetherTo = 0; r._draftTo = 0; r.elapsed = __B2 - 5; }); await q2.waitForTimeout(200);
      const rr = await q2.evaluate(() => ({ erg: window.__ride.state.trainer.erg, t: window.__ride.wNow.target, ramp: window.__ride.wNow.ramp }));
      ok(rr.ramp === 'in' && rr.erg === rr.t && rr.t < base - 2, `ERG ramp reaches the trainer (${rr.erg} W, 5 s before the interval)`, JSON.stringify(rr));
      await q2.keyboard.press('ArrowUp'); await q2.waitForTimeout(100);
      ok(await q2.evaluate(() => window.__ride.wAdjE === 1 && window.__ride.wAdj === -2 && !window.__ride.keyPower), 'trainer: ↑ in the rest = easy parts +1 W');
      // ERG (owner 17.11.): no shifting advice under the cadence; at very low cadence and power under target only "spin faster"
      const sh = async (cad, pw) => { await q2.evaluate(([c, w]) => { window.__tc = c; window.__tp = w; }, [cad, pw]); await q2.waitForTimeout(700); return q2.evaluate(() => document.querySelector('#hHr').textContent); };
      const s1 = await sh(110, 240), s2 = await sh(70, 240), s3 = await sh(50, 60);
      ok(!/shift/i.test(s1 + s2 + s3) && s3 === '▲ spin faster', `ERG: no "shift easier / harder" (${s1} | ${s2} | ${s3})`, JSON.stringify([s1, s2, s3]));
      await q2.evaluate(() => { window.__tc = null; window.__tp = 240; });
      // the trainer drops: "–" and "Connection lost" with a reconnect button, not 0 W
      await q2.evaluate(() => { clearInterval(window.__tl); window.__ride.state.trainer.device.gatt.connected = false; }); await q2.waitForTimeout(3600);
      const lost = await q2.evaluate(() => ({ p: document.querySelector('#hWP').textContent, st: document.querySelector('#hWState').textContent, rc: !document.querySelector('#hWRc').hidden, cad: document.querySelector('#hCad').textContent, cs: document.querySelector('#hCadS').textContent, hr: document.querySelector('#hBpm').textContent }));
      ok(lost.p === '–' && lost.st === 'connection lost' && lost.rc && lost.cad === '–' && /Connection lost/.test(lost.cs), 'trainer dropped: bar "–" + "connection lost" + Reconnect, cadence "–"', JSON.stringify(lost));
      ok(lost.hr === '–', 'heart rate from the trainer gone: "–", not 0', JSON.stringify(lost));
      await q2.keyboard.press('Space'); await q2.waitForSelector('#pSave'); await q2.click('#pSave'); await q2.waitForSelector('.finish', { timeout: 10000 });
      ok(!/arrow keys/i.test(await q2.textContent('.finish')), 'the ride is saved normally (not "ridden with the arrow keys")');
      await c.close();
    }
    {
      const [c, q2] = await ride2('', true, 'trainer free ride');
      await fakeTrainer(q2); await q2.waitForTimeout(300);
      await q2.keyboard.press('ArrowUp'); await q2.keyboard.press('ArrowUp'); await q2.waitForTimeout(100);
      ok(await q2.evaluate(() => !window.__ride.keyPower && window.__ride.manualPower === 0 && !window.__ride.wAdj), 'trainer, no workout: ↑ does nothing (no keyboard watts)');
      await c.close();
    }
    {
      const [c, q2] = await ride2('', true, 'free ride');
      // nothing connected, no test watts: "–" and "No connection" / "No sensor" instead of 0 W / 0 bpm
      await q2.waitForTimeout(400);
      const nc = await q2.evaluate(() => ({ p: document.querySelector('#hPow').textContent, ps: document.querySelector('#hPowS').textContent, psh: document.querySelector('#hPowS').hidden, hr: document.querySelector('#hBpm').textContent, hs: document.querySelector('#hHrS').textContent, cad: document.querySelector('#hCad').textContent, rc: document.querySelectorAll('#hPowS .sens-rc').length }));
      ok(nc.p === '–' && !nc.psh && /No connection/.test(nc.ps) && /Connect/.test(nc.ps) && nc.rc === 1 && nc.hr === '–' && /No sensor/.test(nc.hs) && nc.cad === '–', 'nothing connected: power, cadence, heart rate "–" with "No connection" / "No sensor" and a Connect button each for trainer and strap', JSON.stringify(nc));
      await q2.keyboard.press('w'); await q2.waitForTimeout(150);
      ok(await q2.evaluate(() => !window.__ride.wAdj && !document.querySelector('#hWAdj') && !document.querySelector('#hWork')), 'free ride: no workout bar, W does nothing');
      await q2.keyboard.press('ArrowUp'); await q2.waitForTimeout(100);
      ok(await q2.evaluate(() => window.__ride.keyPower === true && window.__ride.manualPower === 10), 'no trainer: ↑ still sets test watts (as before)');
      await q2.waitForTimeout(300);
      ok(await q2.evaluate(() => document.querySelector('#hPow').textContent !== '–' && document.querySelector('#hPowS').hidden), 'test watts count as a source: a number again, no "No connection"');
      // a real 0 from a connected trainer stays 0
      await fakeTrainer(q2); await q2.evaluate(() => { window.__tp = 0; window.__ride.keyPower = false; window.__ride.manualPower = 0; }); await q2.waitForTimeout(4200); // the shown watts average the last 3 s
      const z0 = await q2.evaluate(() => ({ p: document.querySelector('#hPow').textContent, h: document.querySelector('#hPowS').hidden, src: window.__ride.source, pw: window.__ride.power }));
      ok(z0.p === '0' && z0.h, 'connected trainer saying 0 W: shows 0', JSON.stringify(z0));
      await c.close();
    }

    // ---- no coach voice in a workout (owner 17.11.): with coach lines available, a whole workout plays none of them ----
    {
      const c = await b.newContext({ viewport: { width: 1280, height: 720 } }), q2 = await c.newPage();
      q2.on('pageerror', e => errs.push('coach: ' + e.message));
      const keys = ['warm', 'ten', 'three', 'go', 'last', 'half', 'good', 'low', 'rest', 'sprint', 'cool', 'done', 'challenge', 'wizard'];
      await q2.route('**/assets/audio/manifest.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ coach: Object.fromEntries(keys.map(k => [k, `coach/${k}.mp3`])) }) }));
      await q2.route('**/assets/audio/coach/**', r => r.fulfill({ status: 404, body: '' }));
      await q2.addInitScript(() => { const A = window.Audio; window.__aud = []; window.__voice = 0; addEventListener('rf-voice', () => window.__voice++);
        window.Audio = function (src) { window.__aud.push(String(src || '')); return new A(src); }; window.Audio.prototype = A.prototype; });
      await q2.goto(BASE + '/?desktop&noprofile&demo&laptest'); await q2.waitForTimeout(600);
      await q2.click('.tab[data-view="library"]'); await q2.click('.card[data-id="demo"]'); await q2.waitForSelector('#workSel'); await q2.selectOption('#workSel', 'vo2_5x5');
      await q2.click('#rideBtn'); await q2.waitForFunction(() => window.__ride?.running && !document.querySelector('.countdown'), null, { timeout: 30000 });
      await fakeTrainer(q2); await q2.evaluate(() => { window.__tp = 120; }); // far too low in the intervals: the old coach said "low"
      await q2.evaluate(() => { window.__A = window.__ride.workout.steps.slice(0, window.__ride.workout.steps.findIndex(x => x.label === 'VO2max 1/5')).reduce((t, x) => t + x.dur, 0); window.__RS = window.__A + 300; window.__B2 = window.__RS + 240; });
      const times = await q2.evaluate(() => [5, 300, 610, __A - 10, __A - 3, __A + 3, __A + 150, __RS, __B2 + 3, __B2 + 1000, __B2 + 1700]);
      for (const t of times) { await q2.evaluate(t => { window.__ride.elapsed = t; }, t); await q2.waitForTimeout(1300); }
      const dur = await q2.evaluate(() => window.__ride.workout.steps.reduce((a, s) => a + s.dur, 0));
      await q2.evaluate(d => { window.__ride.elapsed = d + 1; }, dur); await q2.waitForTimeout(1200);
      const v = await q2.evaluate(() => ({ coach: window.__aud.filter(s => /assets\/audio\/coach\//.test(s)), voice: window.__voice, done: window.__ride.wDone, lines: Object.keys(window.__ride.coach?.lines || {}).length }));
      ok(v.lines === keys.length && v.done && !v.coach.length && !v.voice, 'workout start to finish: no coach line plays (warm-up, countdown, go, half, low, rest, done)', JSON.stringify(v));
      await q2.evaluate(() => { window.__ride.coach.say('challenge', 0); new Audio('assets/audio/spy-check.mp3'); });
      ok(await q2.evaluate(() => window.__aud.some(s => /spy-check/.test(s)) && !window.__aud.some(s => /coach\//.test(s))), 'control: the Audio spy sees new sounds; the coach is off everywhere now (main 92fa9ac), a challenge line plays nothing either');
      await c.close();
    }

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

    // ---- phone indoor page, a builder workout in absolute watts (audit 27.11., the owner's 3 × 13 × 30 s at 370 W / 15 s at 125 W):
    //      + / − during a running interval reach the trainer at once, the float stays, the offset stays for the next set, no ramp eats
    //      the 30 s, the saved ride keeps it. The page clock is skipped ahead (pure.js catches up second by second) ----
    {
      const P3 = lo => ({ kind: 'power', lo, hi: lo }), set = () => ({ repeat: 13, skipLast: true, steps: [{ type: 'work', dur: { kind: 'time', sec: 30 }, target: P3(370) }, { type: 'recover', dur: { kind: 'time', sec: 15 }, target: P3(125) }] });
      const OW = { v: 2, id: 'pw_aud3015', name: 'Audit 30/15', notes: '', sport: 'bike', base: null, updated: 1, steps: [{ type: 'warmup', dur: { kind: 'time', sec: 600 }, target: { kind: 'ftp', pct: 40, pct2: 72 } }, set(), { type: 'rest', dur: { kind: 'time', sec: 180 }, target: P3(130) }, set(), { type: 'cooldown', dur: { kind: 'time', sec: 300 }, target: { kind: 'ftp', pct: 50 } }] };
      const c4 = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await c4.addInitScript(w => { let off = 0; const dn = Date.now.bind(Date), pn = performance.now.bind(performance); Date.now = () => dn() + off; performance.now = () => pn() + off; window.__skip = s => { off += s * 1000; };
        localStorage.setItem('rf_myworkouts', JSON.stringify([w])); }, OW);
      const Q = await c4.newPage(); Q.on('pageerror', e => errs.push('pure 30/15: ' + e.message)); Q.on('dialog', d => d.accept());
      await Q.goto(BASE + '/pure.html?demo'); await Q.evaluate(async () => { const { db } = await import('/js/db.js'); await db.kvSet('settings', { ...((await db.kvGet('settings')) || {}), ftp: 287 }); });
      await Q.goto(BASE + '/pure.html?demo&workout=pw_aud3015'); await Q.waitForSelector('#pWork'); await Q.waitForTimeout(300);
      await Q.evaluate(async () => { const { Trainer } = await import('/js/trainer.js'); const o = Trainer.prototype.setPower; window.__erg = []; Trainer.prototype.setPower = function (w) { window.__erg.push(w); return o.call(this, w); }; });
      const skip = async n => { while (n > 0) { const k = Math.min(200, n); await Q.evaluate(k => window.__skip(k), k); await Q.waitForTimeout(350); n -= k; } }; // the page counts at most 600 s per catch-up
      const st = () => Q.evaluate(() => ({ step: document.querySelector('#pStep').textContent.replace(/\s+/g, ' '), t: +(/Target (\d+)/.exec(document.querySelector('#pTarget').textContent) || [])[1], adj: document.querySelector('#pAdj b').textContent, erg: window.__erg.at(-1) }));
      await Q.tap('#pStart'); await skip(605); let s = await st();
      ok(/^Bike 1\/13 · 0:2\d left/.test(s.step) && s.t === 370 && s.erg === 370, `pure 30/15: Bike 1/13 at 370 W whatever the FTP (287), the trainer gets 370`, JSON.stringify(s));
      await Q.tap('[data-wa="5"]'); s = await st(); ok(s.t === 375 && s.erg === 375 && s.adj === '+5 W', 'pure 30/15: +5 W in the running interval: target and trainer 375 W at once, "+5 W" shown', JSON.stringify(s));
      await Q.keyboard.press('Shift+ArrowUp'); await Q.keyboard.press('ArrowUp'); s = await st(); ok(s.t === 381 && s.erg === 381 && s.adj === '+11 W', 'pure 30/15: Shift+↑ +1, ↑ +5: 381 W', JSON.stringify(s));
      await Q.tap('[data-wa="-5"]'); await Q.keyboard.press('Shift+ArrowDown'); s = await st(); ok(s.t === 375 && s.adj === '+5 W', 'pure 30/15: −5 W, Shift+↓ −1: 375 W', JSON.stringify(s));
      if (SHOTS) await Q.screenshot({ path: path.join(SHOTS, 'pure_3015_offset_360.png') });
      await skip(27); s = await st(); ok(/^Recover/.test(s.step) && s.t === 125 && s.erg === 125 && /then 375 W/.test(s.step), 'pure 30/15: the 15 s float stays 125 W, "then 375 W"', JSON.stringify(s));
      await skip(15); s = await st(); ok(/^Bike 2\/13 · 0:2\d left/.test(s.step) && s.t === 375 && s.erg === 375, 'pure 30/15: Bike 2/13 at 375 W from its first second (no ramp)', JSON.stringify(s));
      await skip(11 * 45 + 30 + 180 + 2); s = await st(); ok(/^Bike 1\/13/.test(s.step) && s.t === 375, 'pure 30/15: set 2 starts at 375 W, the offset stays (last float skipped, 3 min rest)', JSON.stringify(s));
      await Q.tap('#pPause'); await Q.tap('#pEnd'); await Q.tap('#eSave'); await Q.waitForTimeout(600);
      const rec = await Q.evaluate(async () => { const { db } = await import('/js/db.js'); return (await db.all('rides')).sort((a, b) => b.date - a.date)[0]; });
      ok(rec?.workout === 'Audit 30/15' && rec.wAdj === 5 && rec.wAdjAvg === 5, `pure 30/15: the saved ride keeps the offset (wAdj ${rec?.wAdj}, average ${rec?.wAdjAvg})`);
      await c4.close();
    }

    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + (e.stack || e.message)); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} of ${n} failed` : `\nIntensity UI: all ${n} good`); process.exit(fails ? 1 : 0);
})();
