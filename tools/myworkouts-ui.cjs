// Personal workouts end to end (owner 17.11.: "personalise the workout for the route, save it under my name, find and edit it
// in my profile"): an account, River Valley, Customise on VO2max 5 × 3, one step changed, saved as "My VO2"; it is on the
// server, under Profile → My workouts and in the route's workout choice; the FTP set in the profile is the one of "My data";
// the 3D ride (Passo Demo) starts with it and its first target is FTP × % of the first step, and the saved ride carries its name.
// Phone: the profile editor at 390 px, the indoor page lists it, and a workout made signed out goes up after signing in.
// Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) node tools/myworkouts-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS) { if (/^https?:/.test(SHOTS)) { console.log('The first argument is a screenshot folder, not a URL.'); process.exit(2); } fs.mkdirSync(SHOTS, { recursive: true }); }
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-myworkouts-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const reg = async name => { const r = await fetch(BASE + '/api/account/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1' }) }); return (await r.json()).token; };
  const listOf = async token => (await (await fetch(BASE + '/api/account/workouts', { headers: { 'X-RF-Token': token } })).json()).workouts || [];
  const b = await chromium.launch();
  const errs = [];
  const signIn = (p, token, name, ftp) => p.evaluate(async ([token, name, ftp]) => { localStorage.setItem('rf_account', JSON.stringify({ token, name, email: name.replace(/\W/g, '') + '@example.org' }));
    const { db } = await import('/js/db.js'); const st = (await db.kvGet('settings')) || {}; await db.kvSet('settings', { ...st, ftp, profileDone: true, accountAsked: true, workout: '' }); await db.kvSet('settingsAt', Date.now()); }, [token, name, ftp]);
  try {
    // ---- the big screen: an account, River Valley, Customise ----
    const token = await reg('Freddy Workouts');
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    const D = await ctx.newPage(); D.on('pageerror', e => errs.push('desktop: ' + e.message)); D.on('dialog', d => d.accept());
    await D.goto(BASE + '/?desktop&noprofile'); await signIn(D, token, 'Freddy Workouts', 250); await D.reload(); await D.waitForTimeout(900);
    await D.click('.card[data-id="fluss"]'); await D.waitForSelector('#wCustom');
    ok(/River Valley/.test(await D.textContent('h1')), 'route page: River Valley');
    await D.selectOption('#workSel', 'vo2_5x3'); await D.click('#wCustom'); await D.waitForSelector('.mwbox');
    ok(/for River Valley/.test(await D.textContent('#mwTitle')), 'editor: made for River Valley');
    const bw = await D.evaluate(() => import('/js/workouts.js').then(m => m.WORKOUTS.find(w => w.id === 'vo2_5x3').steps)), iv = bw.findIndex(x => /^VO2max/.test(x.label));
    ok((await D.locator('.mwstep').count()) === bw.length, `editor: all ${bw.length} steps of VO2max 5 × 3 (${await D.locator('.mwstep').count()})`);
    ok(await D.inputValue('#mwName') === 'River Valley VO2 1', `editor: a default name without typing (${await D.inputValue('#mwName')})`);
    ok(await D.locator('.mwchip').count() >= 3, 'editor: one-tap name suggestions');
    ok(await D.inputValue('.mwstep[data-i="0"] input[data-f="pct2"]') === '75' && (await D.textContent('.mwstep[data-i="0"] .mww')).trim() === '100 → 188 W', 'editor: the warm-up stays a ramp 40 → 75 % (100 → 188 W)');
    ok(await D.locator('#mwGraph polygon').count() >= 2, 'editor: ramps drawn sloped in the graph');
    ok(await D.locator('#mwSum .mwfit, #mwSum .mwwarn').count() === 1, 'editor: the route is ridden with these watts (js/routefit.js): ' + (await D.locator('#mwSum .mwfit, #mwSum .mwwarn').first().textContent().catch(() => '')).trim());
    const s3 = `.mwstep[data-i="${iv}"]`;
    ok((await D.textContent(`${s3} .mww`)).trim() === '300 W', `editor: step ${iv + 1} at 120 % of 250 W = 300 W`);
    await D.fill(`${s3} input[data-f="pct"]`, '125'); await D.fill(`${s3} input[data-f="min"]`, '3.5');
    ok((await D.textContent(`${s3} .mww`)).trim() === '313 W', 'editor: the watts follow the % live (125 % → 313 W)');
    await D.fill(`${s3} input[data-f="pct2"]`, '130');
    ok((await D.textContent(`${s3} .mww`)).trim() === '313 → 325 W', 'editor: a ramp to 130 % shows 313 → 325 W');
    const n0 = await D.locator('.mwstep').count(); await D.click('.mwstep[data-i="0"] button[data-a="dup"]');
    ok((await D.locator('.mwstep').count()) === n0 + 1, 'editor: duplicate adds a step');
    await D.click('.mwstep[data-i="1"] button[data-a="del"]'); ok((await D.locator('.mwstep').count()) === n0, 'editor: remove takes it out again');
    await D.fill('#mwName', ''); await D.click('#mwSave'); ok(/Name/.test(await D.textContent('#mwErr')), 'editor: an empty name is refused');
    await D.fill('#mwName', 'My VO2');
    if (SHOTS) await D.screenshot({ path: `${SHOTS}/myworkouts_editor_1280.png` });
    if (SHOTS) { await D.locator(s3).scrollIntoViewIfNeeded(); await D.screenshot({ path: `${SHOTS}/myworkouts_editor_ramp_1280.png` }); }
    await D.click('#mwSave'); await D.waitForSelector('.mwbox', { state: 'detached' }); await D.waitForTimeout(300);
    const saved = (await listOf(token)).find(w => w.name === 'My VO2');
    ok(!!saved && saved.steps[iv].pct === 125 && saved.steps[iv].pct2 === 130 && saved.steps[iv].min === 3.5 && saved.steps[0].pct2 === 75 && saved.routeId === 'fluss' && saved.base === 'vo2_5x3', 'server: “My VO2” stored with the changed step and the ramps, made for River Valley');
    ok(await D.inputValue('#workSel') === saved?.id, 'route page: the new workout is chosen');
    ok(await D.locator('#workSel optgroup[label="My workouts"] option', { hasText: 'My VO2' }).count() === 1, 'route page: “My VO2” in the “My workouts” group');
    ok(/made for this route/.test(await D.locator('#workSel option', { hasText: 'My VO2' }).textContent()), 'route page: marked as made for this route');
    if (SHOTS) { await D.locator('.workout-pick').scrollIntoViewIfNeeded(); await D.screenshot({ path: `${SHOTS}/myworkouts_route_1280.png` }); }
    // another route lists it too, after the ones made for that route
    await D.click('#back'); await D.click('.card[data-id="coast"]'); await D.waitForSelector('#workSel');
    ok(await D.locator('#workSel optgroup[label="My workouts"] option', { hasText: 'My VO2' }).count() === 1, 'another route: “My VO2” in its workout choice too');

    // ---- does the workout fit the route? (js/routefit.js) too short: more laps or a longer route; fits; much longer ----
    await D.goto(BASE + '/?desktop&noprofile&demo&view=detail&id=demo'); await D.waitForSelector('#workSel'); await D.selectOption('#lapSel', '1'); await D.waitForTimeout(200);
    const fitOf = async () => ({ fit: await D.getAttribute('#mwFitLine', 'data-fit').catch(() => null), txt: (await D.textContent('#mwFitLine').catch(() => '')).replace(/\s+/g, ' ').trim() });
    await D.selectOption('#workSel', 'z2_90'); await D.waitForTimeout(200); let fl = await fitOf();
    ok(fl.fit === 'short' && /Route ends after about \d+ min, the workout needs 90 min: this workout does not fit on this route/.test(fl.txt), 'route page, 90 min on Passo Demo: ' + fl.txt);
    ok(await D.locator('#mwFitLaps').count() === 1 && /Ride \d+ laps/.test(await D.textContent('#mwFitLaps')), 'too short: a button for the laps it needs');
    const sugg = await D.locator('#mwFitLine .mwfitr').allTextContents(); ok(sugg.length >= 1, 'too short: longer routes to pick, closest fit first: ' + sugg.join(', '));
    if (SHOTS) { await D.locator('#mwFitLine').scrollIntoViewIfNeeded(); await D.screenshot({ path: `${SHOTS}/routefit_short_1280.png` }); }
    const need = await D.getAttribute('#mwFitLaps', 'data-laps'); await D.click('#mwFitLaps'); await D.waitForTimeout(300); fl = await fitOf();
    ok(await D.inputValue('#lapSel') === need && ['fits', 'long'].includes(fl.fit) && new RegExp(need + ' laps take about').test(fl.txt), `“Ride ${need} laps” sets the laps and the line turns: ${fl.txt}`);
    await D.selectOption('#lapSel', '1'); await D.waitForTimeout(200);
    await D.selectOption('#workSel', 'rec30'); await D.waitForTimeout(200); fl = await fitOf();
    ok(fl.fit === 'long' && /the workout ends at km [\d.,]+ of [\d.,]+, the rest is free riding/.test(fl.txt), 'much longer route: where the workout ends: ' + fl.txt);
    await D.selectOption('#workSel', 'vo2_5x3'); await D.waitForTimeout(200); fl = await fitOf();
    ok(fl.fit === 'fits' && /Workout 49 min · route takes about \d+ min at these watts: fits/.test(fl.txt), 'fits: ' + fl.txt);
    if (SHOTS) { await D.locator('#mwFitLine').scrollIntoViewIfNeeded(); await D.screenshot({ path: `${SHOTS}/routefit_fits_1280.png` }); }
    await D.selectOption('#workSel', 'z2_90'); await D.waitForTimeout(200);
    const first = D.locator('#mwFitLine .mwfitr').first(), toId = await first.getAttribute('data-route'); await first.click(); await D.waitForTimeout(400);
    ok((await D.textContent('h1')).replace(/\s/g, '') === sugg[0].replace(/\s/g, '') && await D.getAttribute('#mwFitLine', 'data-fit') !== 'short', `a suggested route opens and the workout fits there (${sugg[0]})`);
    await D.click('#back'); await D.waitForSelector('.card[data-id="demo"]');
    ok(!/Too short/.test(await D.textContent('.card[data-id="demo"]')) && await D.locator('.card .fitshort').count() === 0, 'library: the cards carry no "too short" mark (it shows on the route page only)');
    if (SHOTS) { await D.locator('.card[data-id="demo"]').scrollIntoViewIfNeeded(); await D.screenshot({ path: `${SHOTS}/routefit_library_1280.png` }); }
    await D.click('.card[data-id="demo"]'); await D.waitForSelector('#workSel'); await D.selectOption('#workSel', ''); await D.waitForTimeout(200);
    ok(await D.locator('#mwFitLine').count() === 0, 'free ride: no fit line');
    await D.selectOption('#workSel', saved.id); await D.waitForTimeout(200); // back to “My VO2” for the ride below

    // ---- Profile → My workouts, FTP there = the FTP of "My data" ----
    await D.goto(BASE + '/profil.html#myworkouts'); await D.waitForSelector('.mwitem');
    const item = D.locator('.mwitem', { hasText: 'My VO2' });
    ok(await item.count() === 1 && /for River Valley/.test(await item.textContent()), 'profile: “My VO2” listed, made for River Valley');
    ok(await D.inputValue('#mwFtp') === '250', 'profile: the FTP field shows the stored FTP');
    await D.fill('#mwB20', '280'); ok((await D.textContent('#mwEst')).trim() === '266 W', 'profile: 20 min best 280 W × 0.95 = 266 W');
    await D.fill('#mwFtp', '260'); await D.press('#mwFtp', 'Tab'); await D.waitForTimeout(400);
    await D.click('#fSet'); ok(await D.inputValue('#dFtp') === '260', 'profile: “My data” shows the FTP set in My workouts (one value)'); await D.click('#dX');
    if (SHOTS) await D.locator('#mwProf').screenshot({ path: `${SHOTS}/myworkouts_profile_1280.png` });
    await D.locator('.mwitem', { hasText: 'My VO2' }).locator('[data-dup]').click(); await D.waitForTimeout(400);
    ok((await listOf(token)).some(w => w.name === 'My VO2 copy'), 'profile: duplicate → “My VO2 copy” on the server');
    await D.locator('.mwitem', { hasText: 'My VO2 copy' }).locator('[data-del]').click(); await D.waitForSelector('.mwask');
    ok(/Delete “My VO2 copy”/.test(await D.textContent('.mwask')), 'profile: delete asks in the page (no browser dialog)');
    await D.click('.mwask button:has-text("Delete")'); await D.waitForTimeout(400);
    ok(!(await listOf(token)).some(w => w.name === 'My VO2 copy') && await D.locator('.mwitem', { hasText: 'My VO2 copy' }).count() === 0, 'profile: delete removes the copy');

    // ---- the fast editor (owner 17.11. 22:14): a template in one tap, − / +, a whole set, the chart picks a block ----
    await D.click('#mwNew'); await D.waitForSelector('.mwbox');
    await D.click('.mwtpl[data-tpl="vo2"]'); await D.waitForTimeout(150);
    ok(!(await D.locator('.mwask').count()) && await D.locator('.mwstep').count() === 12 && /48:00/.test(await D.textContent('#mwTotal')), 'template “VO2max” in one tap: 12 blocks, 48 min (no question, nothing changed yet)');
    ok(await D.inputValue('#mwName') === 'VO2 1', `the default name follows the template (${await D.inputValue('#mwName')})`);
    const r1 = '.mwstep[data-i="1"]'; await D.click(`${r1} [data-a="min+"]`); await D.click(`${r1} [data-a="pct+"]`); await D.click(`${r1} [data-a="pct+"]`);
    ok(await D.inputValue(`${r1} input[data-f="min"]`) === '3.5' && await D.inputValue(`${r1} input[data-f="pct"]`) === '125', '+ on minutes 3 → 3.5, + + on % 118 → 120 → 125 (to the next 5)');
    ok((await D.textContent(`${r1} .mww`)).trim() === '325 W' && /48:30/.test(await D.textContent('#mwTotal')), 'watts and total follow at once (125 % of 260 W = 325 W, 48:30)');
    const nB = await D.locator('.mwstep').count(); await D.click('#mwAddSet'); await D.waitForTimeout(100);
    ok(await D.locator('.mwstep').count() === nB + 8 && /Cool-down/.test(await D.inputValue(`.mwstep[data-i="${nB + 7}"] .mwlab`)), '+ Set of 4: 8 blocks before the cool-down');
    await D.click('.mwstep[data-i="3"] [data-a="rep"]'); ok(await D.inputValue('#mwRf') === '4' && await D.inputValue('#mwRt') === '5' && await D.evaluate(() => document.activeElement.id) === 'mwRn', '↻ on a hard block: repeat it with its rest, the count is next');
    await D.locator('#mwGraph [data-i="0"]').click({ force: true }); await D.waitForTimeout(150);
    ok(await D.locator('.mwstep[data-i="0"].sel').count() === 1 && await D.locator('#mwGraph [data-i="0"][stroke]').count() === 1, 'a tap on the chart picks that block');
    if (SHOTS) await D.screenshot({ path: `${SHOTS}/myworkouts_editor_fast_1280.png` });
    await D.click('.mwtpl[data-tpl="ss"]'); await D.waitForSelector('.mwask'); ok(/Start from “Sweet spot”/.test(await D.textContent('.mwask')), 'another template with changes: asked first (in the page)');
    await D.click('.mwask button:has-text("Keep mine")'); await D.waitForTimeout(150); ok(await D.locator('.mwstep').count() === nB + 8, 'Keep mine: the blocks stay');
    await D.click('#mwCancel'); await D.waitForSelector('.mwask'); await D.click('.mwask button:has-text("Discard")'); await D.waitForSelector('.mwbox', { state: 'detached' });

    // ---- ride with it: the first target is FTP × % of the first step, the saved ride carries the name ----
    // (the River Valley world is too heavy for the headless software renderer: the ride itself runs on the light Passo Demo,
    //  where the personal workout is in the choice like on every route)
    await D.goto(BASE + '/?desktop&noprofile&demo&view=detail&id=demo'); await D.waitForSelector('#rideBtn'); await D.waitForTimeout(500);
    ok(await D.inputValue('#workSel') === saved?.id, 'Passo Demo route page: “My VO2” still chosen');
    await D.click('#rideBtn'); await D.waitForSelector('#hWT', { timeout: 60000 }); await D.waitForFunction(() => /\d/.test(document.querySelector('#hWT')?.textContent || ''), null, { timeout: 30000 });
    const got = +(await D.textContent('#hWT')).trim(), lo = Math.round(saved.steps[0].pct / 100 * 260), hi = Math.round((saved.steps[0].pct + 3) / 100 * 260);
    ok(got >= lo && got <= hi, `ride: first target ${got} W = 260 W × the warm-up ramp start ${saved.steps[0].pct} % (${lo} W, rising)`);
    ok(/My VO2/.test(await D.textContent('#hWName')), 'ride: the HUD names “My VO2”');
    if (SHOTS) await D.screenshot({ path: `${SHOTS}/myworkouts_ride_1280.png` });
    // rides under 30 s are not saved: wait until 35 s of the first step are gone
    await D.waitForFunction(d0 => { const [m, s] = (document.querySelector('#hWLeft')?.textContent || '99:99').split(':').map(Number); return m * 60 + s <= d0 - 35; }, Math.round(saved.steps[0].min * 60), { timeout: 90000 });
    await D.click('#hPause'); await D.waitForSelector('#pSave'); await D.click('#pSave'); await D.waitForTimeout(2500);
    const rides = await D.evaluate(async () => { const { db } = await import('/js/db.js'); return (await db.all('rides')).map(r => ({ workout: r.workout, workoutId: r.workoutId })); });
    ok(rides.some(r => r.workout === 'My VO2' && r.workoutId === saved.id), `finished ride records the workout name (${JSON.stringify(rides)})`);
    await ctx.close();

    // ---- phone: the profile editor at 390 px, the indoor page lists it ----
    const pctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const P = await pctx.newPage(); P.on('pageerror', e => errs.push('phone: ' + e.message)); P.on('dialog', d => d.accept());
    await P.goto(BASE + '/profil.html'); await signIn(P, token, 'Freddy Workouts', 260); await P.reload(); await P.waitForSelector('.mwitem');
    if (SHOTS) { await P.locator('#mwProf').scrollIntoViewIfNeeded(); await P.screenshot({ path: `${SHOTS}/myworkouts_profile_390.png` }); }
    await P.locator('.mwitem', { hasText: 'My VO2' }).locator('[data-ed]').click(); await P.waitForSelector('.mwbox');
    ok(await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone editor: no sideways scrolling at 390 px');
    ok((await P.textContent(`.mwstep[data-i="${iv}"] .mww`)).trim() === '325 → 338 W', 'phone editor: 125 → 130 % of 260 W = 325 → 338 W');
    await P.fill('#mwInt', '10'); await P.dispatchEvent('#mwInt', 'input');
    ok(await P.inputValue(`.mwstep[data-i="${iv}"] input[data-f="pct"]`) === '138' && await P.inputValue(`.mwstep[data-i="${iv}"] input[data-f="pct2"]`) === '143' && await P.inputValue('.mwstep[data-i="0"] input[data-f="pct"]') === '40', 'phone editor: intensity +10 % scales only the work steps (125 → 130 % becomes 138 → 143 %, warm-up ramp stays 40)');
    await P.fill('#mwRf', '1'); await P.fill('#mwRt', '1'); await P.fill('#mwRn', '2'); const c0 = await P.locator('.mwstep').count(); await P.click('#mwRep');
    ok((await P.locator('.mwstep').count()) === c0 + 1, 'phone editor: repeat step 1 ×2 adds one step');
    if (SHOTS) await P.screenshot({ path: `${SHOTS}/myworkouts_editor_390.png` });
    await P.click('#mwCancel'); await P.waitForSelector('.mwask'); ok(/Discard your changes/.test(await P.textContent('.mwask')), 'phone editor: Cancel with changes asks first (in the page)');
    await P.click('.mwask button:has-text("Discard")'); await P.waitForSelector('.mwbox', { state: 'detached' });
    ok((await listOf(token)).find(w => w.id === saved.id).steps[iv].pct === 125, 'phone editor: Discard keeps the stored workout');
    await P.goto(BASE + '/pure.html'); await P.waitForTimeout(800); await P.click('[data-m="work"]'); await P.waitForSelector('#pWork');
    ok(await P.locator('#pWork option', { hasText: 'My VO2' }).count() === 1, 'indoor page: “My VO2” selectable');
    await P.selectOption('#pWork', saved.id); await P.waitForTimeout(300); ok(await P.inputValue('#pWork') === saved.id, 'indoor page: “My VO2” chosen');
    if (SHOTS) await P.screenshot({ path: `${SHOTS}/myworkouts_indoor_390.png` });
    await pctx.close();

    // ---- signed out: kept in this browser, offered for upload after signing in ----
    const octx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const O = await octx.newPage(); O.on('pageerror', e => errs.push('signed out: ' + e.message)); O.on('dialog', d => d.accept());
    await O.goto(BASE + '/profil.html'); await O.waitForSelector('#mwNew'); await O.click('#mwNew'); await O.waitForSelector('.mwbox');
    await O.fill('#mwName', 'Offline intervals'); await O.click('#mwSave'); await O.waitForSelector('.mwbox', { state: 'detached' });
    ok(await O.evaluate(() => JSON.parse(localStorage.getItem('rf_myworkouts') || '[]').some(w => w.name === 'Offline intervals')), 'signed out: saved in this browser');
    const t2 = await reg('Offline Rider'); await signIn(O, t2, 'Offline Rider', 220); await O.reload(); await O.waitForSelector('#mwUpP');
    await O.click('#mwUpP'); await O.waitForTimeout(500);
    ok((await listOf(t2)).some(w => w.name === 'Offline intervals') && !(await listOf(token)).some(w => w.name === 'Offline intervals'), 'after sign-in: uploaded to that account only');
    ok(await O.locator('#mwUpP').count() === 0, 'after the upload: no offer any more');
    await octx.close();

    // ---- the whole thing by gamepad only (js/padnav.js, a fake standard pad): create, two values, repeat, save, profile, delete ----
    const gctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    await gctx.addInitScript(() => { const btn = () => ({ pressed: false, value: 0, touched: false });
      window.__pad = { id: 'Test pad (STANDARD GAMEPAD Vendor: 045e)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, btn), axes: [0, 0, 0, 0] };
      Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [window.__pad, null, null, null], configurable: true }); });
    const G = await gctx.newPage(); G.on('pageerror', e => errs.push('pad: ' + e.message)); G.on('dialog', d => { errs.push('pad: a native dialog: ' + d.message()); d.dismiss(); });
    await G.goto(BASE + '/?desktop&noprofile'); await signIn(G, token, 'Freddy Workouts', 250); await G.goto(BASE + '/?desktop&noprofile&view=detail&id=fluss'); await G.waitForSelector('#wCustom'); await G.waitForTimeout(600);
    const BTN = { A: 0, B: 1, L: 4, R: 5, up: 12, down: 13, left: 14, right: 15 };
    const press = async (k, hold = 60) => { await G.evaluate(i => { const x = window.__pad.buttons[i]; x.pressed = true; x.value = 1; }, BTN[k]); await G.waitForTimeout(hold);
      await G.evaluate(i => { const x = window.__pad.buttons[i]; x.pressed = false; x.value = 0; }, BTN[k]); await G.waitForTimeout(90); };
    const curIs = sel => G.evaluate(sel => { const c = window.__padnav?.cur; return !!c && c.isConnected && c.matches(sel); }, sel);
    /** the pad's way to a control: the test only chooses the direction to press, toward where the control is on screen */
    const padTo = async (sel, max = 80) => {
      for (let i = 0; i < max; i++) {
        if (await curIs(sel)) return true;
        const dir = await G.evaluate(sel => { const c = window.__padnav?.cur, t = [...document.querySelectorAll(sel)].find(e => e.getBoundingClientRect().width > 0); if (!c || !t) return 'down';
          const a = c.getBoundingClientRect(), b = t.getBoundingClientRect(), ax = (a.left + a.right) / 2, bx = (b.left + b.right) / 2;
          if (b.top >= a.bottom - 2) return 'down'; if (b.bottom <= a.top + 2) return 'up'; return bx > ax ? 'right' : 'left'; }, sel);
        const before = await G.evaluate(() => window.__padnav?.cur?.outerHTML.slice(0, 120));
        await press(dir);
        if (before === await G.evaluate(() => window.__padnav?.cur?.outerHTML.slice(0, 120))) await press(dir === 'up' || dir === 'down' ? (i % 2 ? 'left' : 'right') : (i % 2 ? 'up' : 'down')); // stuck: sidestep
      }
      return curIs(sel);
    };
    const val = sel => G.inputValue(sel);
    await press('down'); // the first press shows the focus
    ok(await padTo('#workSel'), 'pad: reaches the workout choice');
    // past "My workouts" (pw_) and the "Coach" group (c_: 86 steps in watts, more than an own workout holds) to a standard one
    await press('A'); for (let i = 0; i < 40 && /^(pw_|c_|$)/.test(await val('#workSel')); i++) await press('down'); await press('B');
    const pick = await val('#workSel'); ok(!/^(pw_|c_|$)/.test(pick), `pad: a standard workout chosen with A and ↓ (${pick})`);
    ok(await padTo('#wCustom'), 'pad: reaches “Customise”'); await press('A'); await G.waitForSelector('.mwbox');
    const nm = await val('#mwName'); ok(/^River Valley .+ \d+$/.test(nm), `pad: the editor opens with a default name (${nm})`);
    const iv2 = await G.evaluate(() => [...document.querySelectorAll('.mwstep input[data-f="pct"]')].findIndex((x, i) => i >= 3 && +x.value >= 88)); // a work step after the repeated block (steps 1–2)
    const minSel = `.mwstep[data-i="${iv2}"] input[data-f="min"]`, pctSel = `.mwstep[data-i="${iv2}"] input[data-f="pct"]`, m0 = +await val(minSel), p0 = +await val(pctSel);
    ok(await padTo(minSel), `pad: reaches the minutes of step ${iv2 + 1}`);
    await press('A'); ok(await G.evaluate(() => window.__padnav.editing), 'pad: A on a number field = change mode');
    if (SHOTS) await G.screenshot({ path: `${SHOTS}/myworkouts_pad_editor_1280.png` });
    await press('up'); await press('up'); await press('B');
    ok(+await val(minSel) === m0 + 1, `pad: ↑ ↑ = +2 × 0.5 min (${m0} → ${await val(minSel)})`);
    ok(await padTo(pctSel), 'pad: right to the % field'); await press('A'); await press('up', 700); await press('A'); // held: repeats
    const p1 = +await val(pctSel); ok(p1 >= p0 + 15, `pad: held ↑ repeats (${p0} → ${p1} %)`);
    await press('R'); ok(+await val(pctSel) === p1 + 5, 'pad: R = one step up without change mode'); await press('L');
    const plus = `.mwstep[data-i="${iv2}"] [data-a="pct+"]`, minus = `.mwstep[data-i="${iv2}"] [data-a="pct-"]`;
    ok(await padTo(plus), 'pad: reaches the + of the %'); await press('A'); ok(+await val(pctSel) === p1 + 5, 'pad: A on + = 5 % more');
    ok(await padTo(minus), 'pad: and its −'); await press('A'); ok(+await val(pctSel) === p1, 'pad: A on − = back');
    const wtxt = (await G.textContent(`.mwstep[data-i="${iv2}"] .mww`)).trim(); ok(wtxt === `${Math.round(p1 / 100 * 250)} W`, `pad: the watts follow (${wtxt})`);
    // B with unsaved changes: the question, B again keeps editing
    await press('B'); await G.waitForSelector('.mwask'); ok(/Discard your changes/.test(await G.textContent('.mwask')), 'pad: B with changes asks (in the page)');
    await press('B'); await G.waitForTimeout(150); ok(!(await G.locator('.mwask').count()) && await G.locator('.mwbox').count() === 1, 'pad: B on the question keeps editing');
    const n1 = await G.locator('.mwstep').count();
    ok(await padTo('#mwRn'), 'pad: reaches “× N” of Repeat'); await press('A'); await press('down'); await press('A');
    ok(await val('#mwRn') === '2', 'pad: × 2'); ok(await padTo('#mwRep'), 'pad: reaches “Repeat”'); await press('A');
    ok(await G.locator('.mwstep').count() === n1 + 2, `pad: repeat steps 1–2 × 2 (${n1} → ${await G.locator('.mwstep').count()} steps)`);
    ok(await padTo('.mwchip:nth-child(2)'), 'pad: reaches a name suggestion'); const chip = await G.textContent('.mwchip:nth-child(2)'); await press('A');
    ok(await val('#mwName') === chip, `pad: one tap names it “${chip}”`);
    ok(await padTo('#mwSave'), 'pad: reaches Save'); await press('A'); await G.waitForSelector('.mwbox', { state: 'detached' }); await G.waitForTimeout(300);
    const padW = (await listOf(token)).find(w => w.name === chip);
    ok(!!padW && padW.steps[iv2 + 2].min === m0 + 1 && padW.steps[iv2 + 2].pct === p1 && padW.steps.length === n1 + 2, 'pad: saved on the server with both values and the repeat');
    ok(await padTo('#wMine'), 'pad: reaches “My workouts”'); await press('A'); await G.waitForURL(/profil\.html/); await G.waitForSelector('.mwitem'); await G.waitForTimeout(500);
    await press('down');
    const del = `.mwitem[data-id="${padW?.id}"] [data-del]`;
    ok(await padTo(del, 120), 'pad: in the profile, reaches Delete of the new workout');
    await press('A'); await G.waitForSelector('.mwask'); await padTo('.mwask button.danger'); await press('A'); await G.waitForTimeout(500);
    ok(!(await listOf(token)).some(w => w.id === padW?.id) && !(await G.locator(`.mwitem[data-id="${padW?.id}"]`).count()), 'pad: deleted after the in-page question');
    // the fit line by pad: “Ride N laps” and a suggested route are buttons the pad reaches
    await G.goto(BASE + '/?desktop&noprofile&demo&view=detail&id=demo'); await G.waitForSelector('#workSel'); await G.selectOption('#workSel', 'z2_90'); await G.waitForTimeout(500);
    await press('down'); ok(await padTo('#mwFitLaps'), 'pad: reaches “Ride N laps”'); const needG = await G.getAttribute('#mwFitLaps', 'data-laps'); await press('A'); await G.waitForTimeout(300);
    ok(await val('#lapSel') === needG, `pad: A sets ${needG} laps`);
    await G.selectOption('#lapSel', '1'); await G.waitForTimeout(300);
    ok(await padTo('#mwFitLine .mwfitr'), 'pad: reaches a suggested route'); const toG = await G.evaluate(() => window.__padnav.cur.textContent); // the one the pad stands on
    await press('A');
    const h1G = await G.waitForFunction(t => { const h = document.querySelector('h1')?.textContent.replace(/\s/g, ''); return h === t && h; }, toG.replace(/\s/g, ''), { timeout: 30000 }).then(h => h.jsonValue(), () => G.textContent('h1'));
    ok(h1G.replace(/\s/g, '') === toG.replace(/\s/g, ''), `pad: A opens ${toG} (${h1G})`); // the title may break into lines
    if (SHOTS) await G.screenshot({ path: `${SHOTS}/routefit_pad_1280.png` });
    await gctx.close();

    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + e.message); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nMy workouts UI: all good'); process.exit(fails ? 1 : 0);
})();
