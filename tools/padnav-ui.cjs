// The whole desktop app by gamepad, like a TV remote (js/padnav.js): a fake pad (navigator.getGamepads overridden) moves
// through the main menu in all four directions, opens a route, changes a list field, goes back with B, moves a settings
// slider, opens and closes windows with A / B, L / R switch tabs; arrow keys / Enter / Escape do the same; the ring hides on
// mouse movement. In the ride the ride's own mapping stays untouched (Start = pause menu, D-pad there, B back / resume,
// padnav keeps out). Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) node tools/padnav-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };
const BTN = { A: 0, B: 1, L: 4, R: 5, START: 9, up: 12, down: 13, left: 14, right: 15 };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-padnav-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript(() => { // a standard-mapping pad whose buttons the test presses
      const btn = () => ({ pressed: false, value: 0, touched: false });
      window.__pad = { id: 'Test pad (STANDARD GAMEPAD Vendor: 045e)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, btn), axes: [0, 0, 0, 0] };
      Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [window.__pad, null, null, null], configurable: true });
    });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto(BASE + '/?desktop&noprofile&demo'); await p.waitForSelector('.card[data-id]'); await p.waitForTimeout(600);
    const press = async (k, hold = 70) => { const i = BTN[k]; await p.evaluate(i => { const x = window.__pad.buttons[i]; x.pressed = true; x.value = 1; }, i); await p.waitForTimeout(hold);
      await p.evaluate(i => { const x = window.__pad.buttons[i]; x.pressed = false; x.value = 0; }, i); await p.waitForTimeout(110); };
    const padTo = async sel => { for (let k = 0; k < 24 && !/3px/.test((await p.evaluate(s => document.querySelector(s)?.style.outline, sel)) || ''); k++) await press(['right', 'right', 'down', 'right', 'up'][k % 5]); }; // walk the ride's pause menu to one button
    const cur = () => p.evaluate(() => { const c = window.__padnav?.cur; if (!c || !c.isConnected) return null; const r = c.getBoundingClientRect();
      return { id: c.id, tag: c.tagName, type: c.type || '', cls: c.className, view: c.dataset.view || '', did: c.dataset.id || '', text: c.textContent.trim().slice(0, 30), x: r.left + r.width / 2, y: r.top + r.height / 2,
        topbar: !!c.closest('.topbar'), modal: !!c.closest('.modal'), ride: !!c.closest('.ride'), ring: getComputedStyle(c).outlineColor, ringW: getComputedStyle(c).outlineWidth }; });
    const seek = async (dir, pred, max = 12) => { for (let i = 0; i < max; i++) { const c = await cur(); if (c && pred(c)) return c; await press(dir); } const c = await cur(); return c && pred(c) ? c : null; };
    const seekRow = async pred => await seek('left', pred, 8) || await seek('right', pred, 10);
    const view = () => p.evaluate(() => document.querySelector('.topbar .tab.active')?.dataset.view);
    const shot = async n => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png` }); };

    // ---- main menu: the first press shows the focus, then all four directions ----
    ok(!(await p.evaluate(() => document.documentElement.classList.contains('pn-active'))), 'no focus ring before the pad is used');
    await press('down'); const c0 = await cur();
    ok(!!c0 && !c0.topbar, `first press: focus on the first control of the screen (${c0?.text})`);
    ok(c0?.ring === 'rgb(255, 90, 31)' && parseFloat(c0.ringW) >= 3, `focus ring is orange #ff5a1f, ${c0?.ringW} (${c0?.ring})`);
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('#pnHint')).display !== 'none' && document.querySelector('#pnHint').textContent === 'D-pad move · A select · B back'), 'hint line "D-pad move · A select · B back" shown while the pad is used');
    await press('right'); const cR = await cur(); ok(cR && cR.x > c0.x && Math.abs(cR.y - c0.y) < 20, `right: ${c0.text} → ${cR?.text}`);
    await press('left'); const cL = await cur(); ok(cL && cL.text === c0.text, `left: back to ${cL?.text}`);
    await press('down'); const cD = await cur(); ok(cD && cD.y > c0.y, `down: ${c0.text} → ${cD?.text}`);
    await press('up'); const cU = await cur(); ok(cU && cU.text === c0.text, `up: back to ${cU?.text}`);
    await shot('01_menu_focus');
    const tb = await seek('up', c => c.topbar, 4); ok(!!tb, `up reaches the top bar (${tb?.text})`);
    const lib = await seek('left', c => c.view === 'library', 8); ok(!!lib, 'left along the top bar to "Routes"');
    await shot('02_topbar_focus');

    // ---- L / R switch the tabs, B on another tab goes back to the main menu, B there does nothing ----
    await press('R'); ok(await view() === 'training', 'R bumper: next tab (Training)');
    await press('R'); ok(await view() === 'history', 'R bumper: next tab (Rides & Records)');
    await press('L'); ok(await view() === 'training', 'L bumper: previous tab');
    await press('B'); ok(await view() === 'library', 'B on a tab: back to the main menu (Routes)');
    await press('B'); ok(await view() === 'library' && await p.locator('.card[data-id]').count() > 0, 'B on the main menu does nothing');

    // ---- the route library: down to a route card, A opens it, a list field, B back twice ----
    await press('down');
    const card = await seek('down', c => /\bcard\b/.test(c.cls) && !!c.did, 12); ok(!!card, `D-pad down reaches a route card (${card?.did})`);
    await shot('03_route_card_focus');
    await press('A'); await p.waitForTimeout(300);
    ok(await p.locator('#main #rideBtn').isVisible(), `A opens the route (${card?.did})`);
    await press('down'); const d0 = await cur(); ok(!!d0 && !d0.topbar, `route page: focus on its first control (${d0?.text})`);
    const sel = await seek('down', c => c.tag === 'SELECT', 10); ok(!!sel, `down reaches a list field (#${sel?.id})`);
    if (sel) {
      const v0 = await p.inputValue('#' + sel.id);
      await press('A'); ok(await p.evaluate(() => window.__padnav.editing), 'A on a list field: edit mode');
      await shot('04_select_editing');
      await press('down'); const v1 = await p.inputValue('#' + sel.id); ok(v1 !== v0, `↓ while editing changes the value (${v0} → ${v1})`);
      await press('up'); ok(await p.inputValue('#' + sel.id) === v0, '↑ steps back');
      await press('B'); ok(!(await p.evaluate(() => window.__padnav.editing)) && await p.locator('#main #rideBtn').isVisible(), 'B leaves edit mode, still on the route page');
    }
    await press('B'); await p.waitForTimeout(200); ok(!(await p.locator('#main #rideBtn').count()) && await p.locator('.card[data-id]').count() > 0, 'B: back from the route to the library');
    await press('B'); ok(await view() === 'library' && await p.locator('.card[data-id]').count() > 0, 'B again: stays on the main menu');

    // ---- settings: a slider with ← →, a window opened with A and closed with B ----
    const tb2 = await seek('up', c => c.topbar, 30); const st = await seekRow(c => c.view === 'settings'); ok(!!tb2 && !!st, `up to the top bar (${tb2?.text}), along it to "Settings"`);
    await press('A'); await p.waitForTimeout(200); ok(await view() === 'settings', 'A on the "Settings" tab opens the settings');
    await press('down');
    const rg = await seek('down', c => c.type === 'range', 40); ok(!!rg, `down reaches a slider (#${rg?.id})`);
    if (rg) {
      const v0 = +await p.inputValue('#' + rg.id), atMax = v0 >= +(await p.getAttribute('#' + rg.id, 'max'));
      await press(atMax ? 'left' : 'right'); const v1 = +await p.inputValue('#' + rg.id);
      const saved = await p.evaluate(id => import('/js/app.js').then(m => m.state.settings[id]), rg.id), label = await p.evaluate(id => document.getElementById(id).closest('.field').querySelector('b')?.textContent, rg.id);
      ok(v1 !== v0 && saved === v1 && (!label || label.startsWith(String(v1))), `${atMax ? '←' : '→'} moves the slider (${v0} → ${v1}), the setting follows (${saved}, label ${label})`);
      const c1 = await cur(); ok(c1?.id === rg.id, 'the focus stays on the slider while changing it');
      await shot('05_settings_slider');
      await press(atMax ? 'right' : 'left'); ok(+await p.inputValue('#' + rg.id) === v0, `and back (${v0})`);
    }
    const ct = await seek('down', c => c.id === 'ctBtn', 10); ok(!!ct, 'down reaches "Test controller"');
    await press('A'); await p.waitForTimeout(200); ok(await p.locator('#ctLog').isVisible(), 'A opens the controller test window');
    await press('down'); const m1 = await cur(); ok(m1?.modal, `the focus stays inside the window (${m1?.text})`);
    ok(await p.evaluate(() => /Gamepad in the menus/.test(document.querySelector('.modal').textContent)), 'the controller window lists the menu controls');
    ok(await p.evaluate(() => /Test pad/.test(document.querySelector('#ctPad').textContent) && !document.querySelector('#ctSwap').hidden && /Zwift Click \/ Di2/.test(document.querySelector('#ctScan').textContent) && /set to D on a Mac/.test(document.querySelector('.modal').textContent)), 'controller window: the pad is named, Swap A / B offered, "Find device" is for Zwift Click / Di2, switch D on a Mac');
    await shot('06_modal_focus');
    await press('B'); await p.waitForTimeout(150); const m2 = await cur();
    ok(!(await p.locator('#ctLog').count()) && m2?.id === 'ctBtn', `B closes the window, the focus returns to ${m2?.id}`);
    await press('B'); ok(await view() === 'library', 'B from the settings: main menu');

    // ---- "Ride together" window by pad, then by keyboard (Enter / Escape), arrows move the focus ----
    await press('down'); const gb = await seek('down', c => c.id === 'groupBtnLib', 6) || await seek('left', c => c.id === 'groupBtnLib', 3); ok(!!gb, 'focus on "Ride together"');
    await press('A'); await p.waitForTimeout(200); ok(await p.locator('#gClose').isVisible(), 'A opens the group window');
    await press('B'); await p.waitForTimeout(150); ok(!(await p.locator('#gClose').count()), 'B closes the group window');
    await p.keyboard.press('Enter'); await p.waitForTimeout(200); ok(await p.locator('#gClose').isVisible(), 'keyboard Enter opens it again');
    await p.keyboard.press('Escape'); await p.waitForTimeout(150); ok(!(await p.locator('#gClose').count()) && await view() === 'library', 'keyboard Escape closes only the window');
    const k0 = await cur(); await p.keyboard.press('ArrowRight'); const k1 = await cur(); ok(k1 && k1.x > k0.x, `keyboard → moves the focus (${k0?.text} → ${k1?.text})`);
    await p.keyboard.press('ArrowLeft');
    await p.mouse.move(200, 300); await p.mouse.move(260, 340); await p.waitForTimeout(100);
    ok(!(await p.evaluate(() => document.documentElement.classList.contains('pn-active'))) && await p.evaluate(() => getComputedStyle(document.querySelector('#pnHint')).display === 'none'), 'mouse movement hides the ring and the hint');

    // ---- the ride: its own pad mapping, padnav keeps out ----
    await press('down'); await press('down');
    await seek('down', c => /\bcard\b/.test(c.cls), 12); const demo = await seek('right', c => c.did === 'demo', 4) || await seek('left', c => c.did === 'demo', 4);
    ok(!!demo, 'focus on the Passo Demo card');
    await press('A'); await p.waitForTimeout(300); await press('down');
    const rb = await seek('down', c => c.id === 'rideBtn', 8) || await seek('right', c => c.id === 'rideBtn', 4); ok(!!rb, 'focus on "Ride ▸"');
    await press('A'); await p.waitForSelector('#hPause', { timeout: 30000 }); await p.waitForFunction(() => !document.querySelector('.ride .countdown'), null, { timeout: 30000 }); await p.waitForTimeout(400);
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('#pnHint')).display === 'none'), 'the menu hint is hidden in the ride');
    const before = await cur();
    await press('B'); await p.waitForTimeout(150);
    ok(await p.locator('#main #rideBtn').count() === 1 && !(await p.locator('#pauseOverlay').count()), 'in the ride B is the ride\'s (display), the menu behind does not go back');
    await press('down'); await press('right'); await p.keyboard.press('ArrowLeft');
    const after = await cur(); ok((after?.id || null) === (before?.id || null) && !after?.ride, 'D-pad and arrow keys in the ride do not move the menu focus');
    await press('START'); await p.waitForTimeout(200); ok(await p.locator('#pauseOverlay #pResume').isVisible(), 'Start opens the ride\'s pause menu (unchanged)');
    await press('down'); const out = await p.evaluate(() => [...document.querySelectorAll('#pauseOverlay .padmenu button')].map(x => x.style.outline));
    ok(out.some((o, i) => i > 0 && /3px/.test(o)) && !/3px/.test(out[0] || ''), 'D-pad ↓ in the pause menu moves the ride\'s own highlight');
    await padTo('#pOpts'); // the menu wraps into rows since Settings / Connect trainer
    ok(!(await p.locator('.ride .pn-focus').count()), 'no padnav focus inside the ride');
    await shot('07_ride_pause_menu');
    await press('A'); await p.waitForTimeout(150); ok(await p.locator('#oBack').isVisible(), 'A opens Options (ride mapping)');
    await press('B'); await p.waitForTimeout(150); ok(await p.locator('#pResume').isVisible(), 'B goes back to the pause menu (ride mapping)');
    await padTo('#pSet'); await press('A'); await p.waitForSelector('.rideset #trBtn', { timeout: 15000 }).catch(() => {});
    ok(await p.locator('.rideset #trBtn').isVisible(), 'pause menu → Settings: the whole settings page over the ride, with Connect trainer');
    await press('down'); await press('down'); await p.waitForTimeout(150);
    ok(await p.locator('.rideset .pn-focus').count() === 1, 'the pad drives the settings sheet like the main menu');
    await shot('07b_ride_settings');
    for (let k = 0; k < 3 && await p.locator('.rideset').count(); k++) { await press('B'); await p.waitForTimeout(200); }
    ok(!(await p.locator('.rideset').count()) && await p.locator('#pResume').isVisible(), 'B closes the settings, back in the pause menu');
    await press('B'); await p.waitForTimeout(150); ok(!(await p.locator('#pauseOverlay').count()), 'B resumes the ride (ride mapping)');
    await press('START'); await p.waitForTimeout(200);
    await padTo('#pDiscard');
    await press('A'); await p.waitForTimeout(600);
    ok(!(await p.locator('.ride').count()) && await p.locator('#main #rideBtn').count() === 1, 'Discard by pad: back on the route page');
    await press('down'); const back = await cur(); ok(!!back && !back.ride, `after the ride the pad drives the menus again (${back?.text})`);

    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + e.message); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nPad navigation UI: all good'); process.exit(fails ? 1 : 0);
})();
