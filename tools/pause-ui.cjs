// Pause and finish in every phone mode (owner 20.11.: "make sure you can pause and finish in every mode"): strength (kraft.html,
// the new Pause / Resume that stops the session clock and the rest timer), indoor (pure.html), outdoor ride and run
// (outdoor.html, demo GPS) and the 3D ride (index.html, Passo Demo): Pause is there while recording, and while paused both
// Resume and an end / save control are there and work. Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) node tools/pause-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-pause-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  const vis = (p, s) => p.locator(s).isVisible().catch(() => false);
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errs = [];
    const page = async url => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(url + ': ' + e.message)); p.on('dialog', d => d.accept()); await p.goto(BASE + url); await p.waitForTimeout(700); return p; };

    // ---- strength (kraft.html): Pause stops the clock and the rest timer, Resume goes on, Finish and Discard stay reachable ----
    const K = await page('/kraft.html');
    await K.click('#kNew'); await K.waitForSelector('#kPause');
    ok(await vis(K, '#kPause') && await vis(K, '#kFin') && await vis(K, '#kDrop'), 'strength: Pause, Finish and Discard on the workout screen');
    await K.evaluate(() => { const c = document.querySelector('#kAdd'); c && c.click(); }); await K.waitForTimeout(300);
    const pickFirst = K.locator('.psheet [data-k], .psheet .kexrow').first(); if (await pickFirst.count()) { await pickFirst.click(); await K.waitForTimeout(300); }
    if (await K.locator('[data-chk="0"]').count()) { await K.locator('.kex[data-i="0"] input[data-f="r"]').first().fill('8').catch(() => {}); await K.click('.kex[data-i="0"] [data-chk="0"]'); await K.waitForTimeout(300); }
    const restOn = !(await K.locator('#kRest').isHidden());
    await K.click('#kPause'); await K.waitForTimeout(200);
    const c1 = await K.textContent('#kClock'), r1 = restOn ? await K.textContent('#kRt') : ''; await K.waitForTimeout(2300);
    const c2 = await K.textContent('#kClock'), r2 = restOn ? await K.textContent('#kRt') : '';
    ok(c1 === c2, `strength paused: the clock stands (${c1} = ${c2})`); if (restOn) ok(r1 === r2, `strength paused: the rest timer stands (${r1} = ${r2})`);
    ok(/Resume/.test(await K.textContent('#kPause')) && await vis(K, '#kFin') && await vis(K, '#kDrop'), 'strength paused: Resume, Finish and Discard reachable');
    if (SHOTS) await K.screenshot({ path: `${SHOTS}/kraft_paused_390.png` });
    await K.reload(); await K.waitForSelector('#kPause'); ok(/Resume/.test(await K.textContent('#kPause')), 'strength: the pause survives a reload (draft)');
    await K.click('#kPause'); await K.waitForTimeout(2300); const c3 = await K.textContent('#kClock');
    ok(c3 !== c2 && /Pause/.test(await K.textContent('#kPause')), `strength resumed: the clock runs again (${c2} -> ${c3})`);
    const dur = await K.evaluate(() => { const [m, s] = document.querySelector('#kClock').textContent.split(':').map(Number); return m * 60 + s; });
    ok(dur < 8, `strength: the paused time is not counted (${dur} s)`);
    await K.click('#kFin'); await K.waitForTimeout(300);
    ok(await vis(K, '#fSave') || /No set ticked/.test(await K.textContent('body')), 'strength: Finish opens the save sheet (or asks for a set)');
    await K.close();

    // ---- indoor (pure.html): Pause while recording; Resume and Finish while paused ----
    const P = await page('/pure.html');
    await P.click('#pStart'); await P.waitForTimeout(600);
    ok(await vis(P, '#pPause'), 'indoor recording: Pause');
    await P.click('#pPause'); await P.waitForTimeout(300);
    ok(await vis(P, '#pStart') && /Resume/.test(await P.textContent('#pStart')) && await vis(P, '#pEnd'), 'indoor paused: Resume and Finish');
    await P.click('#pStart'); await P.waitForTimeout(300); ok(await vis(P, '#pPause'), 'indoor: Resume records again');
    await P.click('#pPause'); await P.click('#pEnd'); await P.waitForTimeout(400); ok(!(await vis(P, '#pPause')) && (await P.locator('.psheet, .sheet, [role="dialog"]').count()) > 0, 'indoor: Finish opens the end sheet');
    await P.close();

    // ---- outdoor ride and run (demo GPS) ----
    for (const [nm, url] of [['outdoor ride', '/outdoor.html?demo&run'], ['run', '/outdoor.html?sport=run&demo&run']]) {
      const O = await page(url); await O.waitForTimeout(1200);
      if (!(await vis(O, '#oPause')) && await vis(O, '#oStart')) { await O.click('#oStart'); await O.waitForTimeout(800); }
      ok(await vis(O, '#oPause'), `${nm} recording: Pause`);
      await O.click('#oPause'); await O.waitForTimeout(300);
      ok(await vis(O, '#oStart') && /Resume/.test(await O.textContent('#oStart')) && await vis(O, '#oEnd'), `${nm} paused: Resume and Finish`);
      await O.click('#oStart'); await O.waitForTimeout(300); ok(await vis(O, '#oPause'), `${nm}: Resume records again`);
      await O.click('#oPause'); await O.click('#oEnd'); await O.waitForTimeout(400); ok((await O.locator('.psheet, .sheet').count()) > 0, `${nm}: Finish opens the end sheet`);
      await O.close();
    }

    // ---- the 3D ride (Passo Demo, desktop): the pause menu (owner 27.11.: one clear list, each thing in ONE place) ----
    const dctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const R = await dctx.newPage(); R.on('pageerror', e => errs.push('ride: ' + e.message)); R.on('dialog', d => { errs.push('a native dialog: ' + d.message()); d.dismiss(); });
    await R.goto(BASE + '/?desktop&noprofile&demo&laptest'); await R.waitForTimeout(800);
    await R.click('.tab[data-view="library"]'); await R.click('.card[data-id="demo"]'); await R.click('#rideBtn');
    await R.waitForSelector('#hPause', { timeout: 30000 }); await R.waitForTimeout(500);
    ok(await vis(R, '#hPause'), '3D ride: Pause on the HUD');
    const act = () => R.evaluate(() => document.activeElement?.id || '');
    const pick = () => R.evaluate(() => { window.__picks = []; const bt = navigator.bluetooth || {}; bt.requestDevice = async o => { window.__picks.push(JSON.stringify(o || {})); throw Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' }); }; bt.getDevices = async () => []; if (!navigator.bluetooth) Object.defineProperty(navigator, 'bluetooth', { value: bt, configurable: true }); });
    await pick();
    await R.click('#hPause'); await R.waitForTimeout(400);
    const ids = await R.evaluate(() => [...document.querySelectorAll('#pauseOverlay .padmenu button')].map(b => b.id));
    ok(JSON.stringify(ids) === JSON.stringify(['pSetup', 'pDev', 'pOpts', 'pGroupOpen', 'pSet', 'pEnd', 'pResume']), `pause: one list, End ride bottom left, Resume bottom right (${ids.join(' · ')})`);
    ok(await act() === 'pResume', 'the focus starts on Resume');
    { const h = await R.evaluate(() => { const o = document.querySelector('#pauseOverlay'), r = id => o.querySelector(id).getBoundingClientRect();
        return { title: o.querySelector('h2').textContent.trim(), labels: o.querySelectorAll('.label').length, hint: o.querySelectorAll('.pad-hint, .hint').length, endL: r('#pEnd').left < r('#pResume').left, below: r('#pResume').top > r('#pSet').bottom, pause: (o.textContent.match(/Pause ·/gi) || []).length }; });
      ok(h.title === 'Paused' && !h.labels && !h.pause, `the title once (“${h.title}”), no crumb line above it`);
      ok(!h.hint, 'no pad hint line'); ok(h.endL && h.below, 'the foot: End ride left, Resume right, under the list'); }
    ok(!(await R.locator('#pauseOverlay #pConn, #pauseOverlay #pHr, #pauseOverlay #pRejoin, #pauseOverlay #pSave, #pauseOverlay #pDiscard, #pauseOverlay #pInvite, #pauseOverlay #pGroup').count()), 'no connect, save, discard, invite or group sheet buttons in the list itself');
    ok(/trainer not connected · heart rate not connected/.test(await R.textContent('#pDev')), `Devices shows the live state ("${(await R.textContent('#pDev')).trim()}")`);
    ok(/No workout · gradient/.test(await R.textContent('#pSetup')), `Workout & mode shows the workout and the mode ("${(await R.textContent('#pSetup')).trim()}")`);
    { const f = await R.evaluate(() => { const r = document.querySelector('#pauseOverlay .box').getBoundingClientRect(), l = document.querySelector('#pauseOverlay .pmlist'); return { top: r.top, bottom: r.bottom, h: innerHeight, scroll: l.scrollHeight > l.clientHeight + 1 }; });
      ok(f.top >= 0 && f.bottom <= f.h && !f.scroll, `1280 × 720: the whole pause list fits without scrolling (${Math.round(f.top)}–${Math.round(f.bottom)} px)`); }
    // pad order: ↓ walks the list top to bottom, then the foot, and wraps; ↑ back
    { const seq = []; for (let i = 0; i < 7; i++) { await R.evaluate(() => window.__ride._padMove('down')); seq.push(await act()); }
      ok(seq.join() === 'pSetup,pDev,pOpts,pGroupOpen,pSet,pEnd,pResume', `D-pad ↓ goes down the list and wraps (${seq.join(' → ')})`);
      await R.evaluate(() => window.__ride._padMove('up')); ok(await act() === 'pEnd', 'D-pad ↑ steps back');
      ok(await R.evaluate(() => [...document.querySelectorAll('#pauseOverlay .padmenu button')].every(b => b.getBoundingClientRect().height >= 40)), 'every entry is at least 40 px high'); }
    if (SHOTS) await R.screenshot({ path: `${SHOTS}/ride_pause_1280x720.png` });
    const back = async (id, how = 'button') => { if (how === 'esc') await R.keyboard.press('Escape'); else await R.click('#mBack'); await R.waitForTimeout(200); return await act() === id && await R.locator('#pauseOverlay .pmlist').count() === 1; };
    /** every sheet: "‹ Back" top left, the title once, no crumb, no pad hint, "Ride on ▸" bottom right and focused */
    const frame = async (name, go = '#oBack') => { const f = await R.evaluate(go => { const b = document.querySelector('#pauseOverlay .box'), r = s => b.querySelector(s)?.getBoundingClientRect();
        const bk = r('#mBack'), h2 = r('h2'), g = r(go), bx = b.getBoundingClientRect();
        return { h2: b.querySelectorAll('h2').length, label: b.querySelectorAll('.label').length, hint: b.querySelectorAll('.pad-hint').length, pad: /D-pad|Tab · Enter/.test(b.textContent),
          backTL: !!bk && bk.left - bx.left < 40 && bk.top - bx.top < 40 && bk.right <= h2.left, goBR: !!g && bx.right - g.right < 40 && bx.bottom - g.bottom < 40, focus: document.activeElement === b.querySelector(go) }; }, go);
      ok(f.h2 === 1 && !f.label && !f.hint && !f.pad, `${name}: the title once, no crumb line, no pad hint`);
      ok(f.backTL && f.goBR && f.focus, `${name}: ‹ Back top left, ${go} bottom right and focused`); };

    // Workout & mode: no connect button, one devices line
    await R.click('#pSetup'); await R.waitForSelector('.rsbox [data-mode]'); await frame('Workout & mode');
    { const w = await R.evaluate(() => { const b = document.querySelector('.rsbox'); return { conn: [...b.querySelectorAll('button')].filter(x => /connect/i.test(x.textContent)).map(x => x.textContent.trim()), line: b.querySelector('.rsdevline')?.textContent.trim() || '', dev: !!b.querySelector('#rsDev'), laps: b.querySelectorAll('[data-laps]').length, shift: b.querySelectorAll('[data-shift]').length,
        info: b.querySelector('[aria-controls="rsNote"]')?.getAttribute('aria-expanded'), hidden: b.querySelector('#rsNote')?.hidden }; });
      ok(!w.conn.length && w.dev && /Trainer: not connected · Heart rate: not connected/.test(w.line), `Workout & mode: no connect button (${w.conn.join(', ') || 'none'}), one line “${w.line.replace(/\s+/g, ' ')}”`);
      ok(w.laps >= 1 && w.shift === 2, `Workout & mode has shifting and the laps (${w.laps} choices)`);
      ok(w.info === 'false' && w.hidden, 'the power source sentence waits behind its (i)');
      await R.click('[aria-controls="rsNote"]'); ok(await R.evaluate(() => !document.querySelector('#rsNote').hidden && document.querySelector('[aria-controls="rsNote"]').getAttribute('aria-expanded') === 'true'), 'the (i) shows it (aria-expanded true)'); }
    // the pad walks the sheet from the top down: from "‹ Back" ↓ reaches the devices line first, from "Ride on" ↑ the body
    { await R.evaluate(() => { const r = window.__ride, bs = [...document.querySelectorAll('#pauseOverlay .padmenu button')]; r._padFocus(bs.findIndex(b => b.id === 'mBack')); r._padMove('down'); });
      const d = await R.evaluate(() => { const a = document.activeElement, m = document.querySelector('#mBack').getBoundingClientRect(), r = a.getBoundingClientRect(); return { inBody: !!a.closest('.rs'), below: r.top > m.bottom, id: a.id || a.dataset.w }; });
      ok(d.inBody && d.below, `D-pad ↓ from ‹ Back: into the sheet under the title (${d.id})`);
      await R.evaluate(() => { const r = window.__ride, bs = [...document.querySelectorAll('#pauseOverlay .padmenu button')]; r._padFocus(bs.findIndex(b => b.id === 'oBack')); r._padMove('up'); });
      ok(await R.evaluate(() => !!document.activeElement.closest('.rs')), 'D-pad ↑ from Ride on: the last controls of the sheet'); }
    await R.click('#rsDev'); await R.waitForSelector('#dvTr'); ok(true, 'its “Devices” button opens Devices');
    await R.click('#mBack'); await R.waitForSelector('.rsbox [data-mode]'); ok(await act() === 'rsDev', 'Back from there: Workout & mode again, on its Devices button');
    ok(await back('pSetup'), 'Back: the pause list, the focus on “Workout & mode”');

    // Devices: one place for Bluetooth; the chooser opens inside the tap
    await R.click('#pDev'); await R.waitForSelector('#dvTr'); await frame('Devices');
    await R.click('#dvTr'); await R.waitForTimeout(500);
    ok((await R.evaluate(() => window.__picks.length)) === 1, 'Devices → “Connect trainer” opens the browser’s device list');
    await R.waitForSelector('#dvHr'); await R.click('#dvHr'); await R.waitForTimeout(500);
    ok((await R.evaluate(() => window.__picks.length)) === 2 && /180d|heart_rate/i.test(await R.evaluate(() => window.__picks[1])), 'Devices → “Connect heart rate” opens it for a heart rate strap');
    ok(await R.locator('#pauseOverlay #dvHrAll').count() === 1 && await R.locator('#pauseOverlay #dvZc').count() === 1 && await R.locator('#pauseOverlay #dvCt').count() === 1, 'Devices: “All devices”, Zwift Click and the button layout are there');
    ok(/^Phone remote · /.test((await R.textContent('#oRemote')).trim()), `the phone remote is an info line (“${(await R.textContent('#oRemote')).trim()}”)`);
    if (SHOTS) await R.screenshot({ path: `${SHOTS}/ride_devices_1280x720.png` });
    await R.evaluate(() => { const t = window.__ride.state.trainer; t.device = { name: 'KICKR TEST', gatt: { connected: true, disconnect() { this.connected = false; } } }; t.mode = 'ftms'; t.lastData = performance.now(); window.__ride._repaint(); });
    ok(/KICKR TEST/.test(await R.textContent('#dvTrC')) && await R.locator('#dvTrOff').count() === 1, 'a connected trainer: its name and Disconnect');
    await R.click('#dvTrOff'); ok(/Tap again/.test(await R.textContent('#dvTrOff')), 'Disconnect asks with a second tap');
    await R.evaluate(() => { const t = window.__ride.state.trainer; t.device = null; t.mode = null; });
    // Button layout: Settings on its Controller tab; Back comes back to Devices
    await R.click('#dvCt'); await R.waitForSelector('.rideset .ctab');
    ok(await R.evaluate(() => document.querySelector('.rideset [data-stab="ctrl"]').getAttribute('aria-selected') === 'true' && /Start \(\+\) \/ Home/.test(document.querySelector('.rideset').textContent)), 'Devices → Button layout: Settings, Controller tab, the pad layout');
    await R.click('#rsetBack'); await R.waitForSelector('#dvTr'); ok(await act() === 'dvCt', 'Back: Devices again, on “Button layout”');
    ok(await back('pDev', 'esc'), 'Esc: one level back, the focus on “Devices”');

    // Display & sound: toggles show their state, no Shifting / Laps / phone remote
    await R.click('#pOpts'); await R.waitForSelector('#oEagle'); await frame('Display & sound');
    { const d = await R.evaluate(() => { const b = document.querySelector('.rsbox'); return { t: b.textContent, sw: b.querySelector('#oEagle').getAttribute('role'), on: b.querySelector('#oEagle').getAttribute('aria-checked'), hud: b.querySelectorAll('[data-hud]').length }; });
      ok(d.sw === 'switch' && d.on === 'true' && d.hud >= 5 && !/Shifting|Laps|Phone remote|key [A-Z]/.test(d.t), `Display & sound: the eagle is a switch (${d.on}), ${d.hud} display layouts, no shifting / laps / phone remote / key hints`); }
    await R.click('#oEagle'); await R.waitForTimeout(300);
    ok(await R.evaluate(() => document.querySelector('#oEagle')?.getAttribute('aria-checked') === 'false' && window.__ride.state.settings.eagle === false), 'the switch turns the eagle off, its label stays');
    await R.click('#oEagle'); await R.waitForTimeout(300);
    await R.click('[data-hud="pur"]'); await R.waitForTimeout(300); ok(await R.evaluate(() => document.querySelector('[data-hud="pur"]')?.classList.contains('on')), 'a display layout is picked by name');
    await R.click('[data-hud="voll"]'); await R.waitForTimeout(300);
    ok(await back('pOpts'), 'Back: the focus on “Display & sound”');

    // Ride together: one row in the list (the group server is not reachable from every test machine: a stand-in group)
    await R.evaluate(() => { const r = window.__ride; r._hostGroup = async () => (r.group = { code: '482913', open: true, link: location.origin + '/?join=482913', me: {}, others: () => [], update() {}, close() {} }); });
    ok(/Open for friends/.test(await R.textContent('#pGroupOpen')) && !/Friends can join/.test(await R.textContent('#pGroupRow')), 'Ride together, no group yet: one button “Open for friends”');
    await R.evaluate(() => { const r = window.__ride; r.presence = { on: true, beat() {}, stop() {} }; r._pause('pGroupOpen'); });
    ok(/Friends can join/.test(await R.textContent('#pGroupRow')), 'signed in, friends may join without asking: “Friends can join”, no paragraph');
    await R.evaluate(() => { window.__ride.presence = null; window.__ride._pause('pGroupOpen'); });
    await R.click('#pGroupOpen'); await R.waitForSelector('#pGroupLink');
    { const g = await R.evaluate(() => ({ row: document.querySelector('#pGroupRow').textContent, f: document.activeElement?.id, sheet: !!document.querySelector('#pauseOverlay .rmcode, #pauseOverlay #pInvite, #pauseOverlay [data-jump]') }));
      ok(/482913/.test(g.row) && /Copy invite link/.test(g.row) && g.f === 'pGroupLink' && !g.sheet, `the group opens in place: the code and “Copy invite link” (focused), no sheet, no riders, no invite (${g.row.replace(/\s+/g, ' ').trim()})`); }
    await R.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async t => { window.__copied = t; }; });
    await R.click('#pGroupLink'); await R.waitForTimeout(150);
    ok(await R.evaluate(() => window.__copied) === BASE + '/?join=482913' && /Copied/.test(await R.textContent('#pGroupLink')), 'Copy invite link copies the join link and says “Copied”');
    await R.evaluate(() => { window.__ride.group = null; window.__ride._pause(); });

    // Settings over the ride: no device rows, no shifting switch (the main menu still has both); a Controller tab
    await R.click('#pSet'); await R.waitForSelector('.rideset #chainrings');
    { const st = await R.evaluate(() => { const m = document.querySelector('.rideset'), r = s => m.querySelector(s).getBoundingClientRect();
        return { rows: m.querySelectorAll('#trBtn, #hrBtn, #zcBtn, #rmBtn, #shiftMode, #voicePtt, #voiceVol').length, voice: /voice chat|push-to-talk/i.test(m.textContent), crumb: /Pause · /.test(m.textContent),
          backL: r('#rsetBack').left < r('.rsethead h2').left, goR: r('#rsetGo').right > innerWidth / 2, tabs: [...m.querySelectorAll('[role=tab]')].map(t => t.textContent.trim()).join() }; });
      ok(!st.rows && !st.voice && !st.crumb, 'in-ride Settings: no connect rows, no shifting switch, no voice chat, no crumb line; chainrings stay');
      ok(st.backL && st.goR && st.tabs === 'General,Controller', `in-ride Settings: ‹ Back left of the title, Ride on bottom right, tabs ${st.tabs}`); }
    if (SHOTS) await R.screenshot({ path: `${SHOTS}/ride_settings_1280x720.png` });
    await R.click('.rideset [data-stab="ctrl"]'); await R.waitForSelector('.rideset .ctab');
    ok(await R.evaluate(() => { const t = document.querySelector('.rideset').textContent; return /Gamepad · riding/i.test(t) && /Keyboard · riding/i.test(t) && /Select \(−\)/.test(t) && /L2 \/ R2/.test(t) && !!document.querySelector('.rideset #ctBtn'); }), 'Controller tab: the gamepad and keyboard layout and the controller test');
    await R.click('.rideset #ctBtn'); await R.waitForSelector('#ctLog'); ok(await R.evaluate(() => [...document.querySelectorAll('.modal')].at(-1).querySelector('#ctLog') && +getComputedStyle([...document.querySelectorAll('.modal')].at(-1)).zIndex > +getComputedStyle(document.querySelector('.rideset')).zIndex), 'the controller test opens above the in-ride Settings');
    await R.keyboard.press('Escape'); await R.waitForTimeout(200); ok(!(await R.locator('#ctLog').count()) && await R.locator('.rideset').count() === 1, 'Esc closes only the test');
    await R.click('#rsetBack'); await R.waitForTimeout(300); ok(await act() === 'pSet', 'back from Settings: the focus on “Settings”');
    await R.click('#pSet'); await R.waitForSelector('.rideset #rsetGo'); await R.click('#rsetGo'); await R.waitForTimeout(300);
    ok(!(await R.locator('.rideset').count()) && !(await vis(R, '#pauseOverlay')) && !(await R.evaluate(() => window.__ride.paused)), 'Settings → Ride on: straight back on the road');

    // a click beside a sheet rides on
    await R.click('#hPause'); await R.click('#pOpts'); await R.waitForSelector('#oEagle'); await R.mouse.click(6, 360); await R.waitForTimeout(300);
    ok(!(await vis(R, '#pauseOverlay')) && !(await R.evaluate(() => window.__ride.paused)), 'a click beside a sheet closes it and rides on');
    await R.click('#hPause'); await R.waitForTimeout(300); await R.mouse.click(6, 360); await R.waitForTimeout(300);
    ok(!(await vis(R, '#pauseOverlay')), 'a click beside the pause list rides on');

    // End ride: Save / Discard, Discard asks once
    await R.click('#hPause'); await R.click('#pEnd'); await R.waitForSelector('#pSave'); await frame('End ride', '#pSave');
    ok(await vis(R, '#pSave') && await vis(R, '#pDiscard') && await act() === 'pSave' && await R.evaluate(() => document.querySelector('#pDiscard').getBoundingClientRect().left < document.querySelector('#pSave').getBoundingClientRect().left), 'End ride: Save (focused, right) and Discard (left)');
    await R.click('#pDiscard'); await R.waitForSelector('#pDiscardYes');
    ok(/Discard ride\?/.test(await R.textContent('#pauseOverlay h2')) && await act() === 'mBack' && await R.locator('.ride').count() === 1, 'Discard asks “Discard ride?” first, the focus on Back');
    await R.click('#mBack'); await R.waitForSelector('#pSave'); ok(true, 'Back: the End sheet again');
    await R.click('#mBack'); await R.waitForTimeout(200); ok(await act() === 'pEnd', 'Back: the pause list, the focus on “End ride”');
    await R.click('#pResume'); await R.waitForTimeout(300); ok(!(await vis(R, '#pauseOverlay')), '3D ride: Resume closes the pause menu');
    // the finish: the title once, Finish & save bottom right (focused), Another lap left
    await R.evaluate(() => window.__ride._goalAsk()); await R.waitForSelector('#gEnd');
    ok(await R.evaluate(() => { const o = document.querySelector('#pauseOverlay'), a = o.querySelector('#gOn').getBoundingClientRect(), e = o.querySelector('#gEnd').getBoundingClientRect(); return a.left < e.left && document.activeElement?.id === 'gEnd' && !o.querySelector('.pad-hint, .label'); }), 'Finished: Another lap left, Finish & save right and focused, no pad hint');
    await R.evaluate(() => window.__ride._again()); await R.waitForTimeout(300);
    await R.click('#hPause'); await R.click('#pEnd'); await R.click('#pDiscard'); await R.click('#pDiscardYes'); await R.waitForTimeout(800);
    ok(!(await R.locator('.ride').count()), 'Discard → yes: the ride is gone');

    // the main-menu Settings still have the device rows and the shifting switch
    await R.goto(BASE + '/?desktop&noprofile&demo&view=settings'); await R.waitForSelector('#trBtn', { timeout: 15000 }).catch(() => {});
    ok(await R.locator('#main #trBtn').count() === 1 && await R.locator('#main #hrBtn').count() === 1 && await R.locator('#main #shiftMode').count() === 1, 'main-menu Settings: Connect trainer, heart rate and the shifting switch are still there');
    ok(!(await R.locator('#main #voicePtt, #main #voiceVol').count()) && !/voice chat/i.test(await R.textContent('#main')), 'main-menu Settings: no voice chat');
    await R.click('#main [data-stab="ctrl"]'); await R.waitForSelector('#main .ctab'); ok(await R.locator('#main #ctBtn').count() === 1, 'main-menu Settings: the Controller tab with the controller test');
    { const b = R.locator('#main .ibtn').first(); await R.click('#main [data-stab="general"]'); await R.waitForSelector('#main #chainrings');
      const id = await R.locator('#main .ibtn').first().getAttribute('aria-controls'); await R.locator('#main .ibtn').first().click();
      ok(await R.evaluate(id => !document.getElementById(id).hidden && document.querySelector(`[aria-controls="${id}"]`).getAttribute('aria-expanded') === 'true', id), 'Settings: a (i) shows its sentence'); }
    await dctx.close();

    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + e.message); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nPause UI: all good'); process.exit(fails ? 1 : 0);
})();
