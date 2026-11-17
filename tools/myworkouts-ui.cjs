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
    ok((await D.locator('.mwstep').count()) === 3 + 9 + 1, `editor: the 13 steps of VO2max 5 × 3 (${await D.locator('.mwstep').count()})`);
    ok(await D.locator('#mwSum').textContent().then(t => /route/.test(t)), 'editor: the route duration is compared');
    const s3 = '.mwstep[data-i="3"]';
    ok((await D.textContent(`${s3} .mww`)).trim() === '295 W', 'editor: step 4 at 118 % of 250 W = 295 W');
    await D.fill(`${s3} input[data-f="pct"]`, '120'); await D.fill(`${s3} input[data-f="min"]`, '3.5');
    ok((await D.textContent(`${s3} .mww`)).trim() === '300 W', 'editor: the watts follow the % live (120 % → 300 W)');
    const n0 = await D.locator('.mwstep').count(); await D.click('.mwstep[data-i="0"] button[data-a="dup"]');
    ok((await D.locator('.mwstep').count()) === n0 + 1, 'editor: duplicate adds a step');
    await D.click('.mwstep[data-i="1"] button[data-a="del"]'); ok((await D.locator('.mwstep').count()) === n0, 'editor: remove takes it out again');
    await D.fill('#mwName', ''); await D.click('#mwSave'); ok(/Name/.test(await D.textContent('#mwErr')), 'editor: an empty name is refused');
    await D.fill('#mwName', 'My VO2');
    if (SHOTS) await D.screenshot({ path: `${SHOTS}/myworkouts_editor_1280.png` });
    await D.click('#mwSave'); await D.waitForSelector('.mwbox', { state: 'detached' }); await D.waitForTimeout(300);
    const saved = (await listOf(token)).find(w => w.name === 'My VO2');
    ok(!!saved && saved.steps[3].pct === 120 && saved.steps[3].min === 3.5 && saved.routeId === 'fluss' && saved.base === 'vo2_5x3', 'server: “My VO2” stored with the changed step, made for River Valley');
    ok(await D.inputValue('#workSel') === saved?.id, 'route page: the new workout is chosen');
    ok(await D.locator('#workSel optgroup[label="My workouts"] option', { hasText: 'My VO2' }).count() === 1, 'route page: “My VO2” in the “My workouts” group');
    ok(/made for this route/.test(await D.locator('#workSel option', { hasText: 'My VO2' }).textContent()), 'route page: marked as made for this route');
    if (SHOTS) { await D.locator('.workout-pick').scrollIntoViewIfNeeded(); await D.screenshot({ path: `${SHOTS}/myworkouts_route_1280.png` }); }
    // another route lists it too, after the ones made for that route
    await D.click('#back'); await D.click('.card[data-id="coast"]'); await D.waitForSelector('#workSel');
    ok(await D.locator('#workSel optgroup[label="My workouts"] option', { hasText: 'My VO2' }).count() === 1, 'another route: “My VO2” in its workout choice too');

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
    await D.locator('.mwitem', { hasText: 'My VO2 copy' }).locator('[data-del]').click(); await D.waitForTimeout(400);
    ok(!(await listOf(token)).some(w => w.name === 'My VO2 copy') && await D.locator('.mwitem', { hasText: 'My VO2 copy' }).count() === 0, 'profile: delete removes the copy');

    // ---- ride with it: the first target is FTP × % of the first step, the saved ride carries the name ----
    // (the River Valley world is too heavy for the headless software renderer: the ride itself runs on the light Passo Demo,
    //  where the personal workout is in the choice like on every route)
    await D.goto(BASE + '/?desktop&noprofile&demo&view=detail&id=demo'); await D.waitForSelector('#rideBtn'); await D.waitForTimeout(500);
    ok(await D.inputValue('#workSel') === saved?.id, 'Passo Demo route page: “My VO2” still chosen');
    await D.click('#rideBtn'); await D.waitForSelector('#hWT', { timeout: 60000 }); await D.waitForFunction(() => /\d/.test(document.querySelector('#hWT')?.textContent || ''), null, { timeout: 30000 });
    const want = Math.round(saved.steps[0].pct / 100 * 260), got = +(await D.textContent('#hWT')).trim();
    ok(got === want, `ride: first target ${got} W = 260 W × ${saved.steps[0].pct} % (${want} W)`);
    ok(/My VO2/.test(await D.textContent('#hWName')), 'ride: the HUD names “My VO2”');
    if (SHOTS) await D.screenshot({ path: `${SHOTS}/myworkouts_ride_1280.png` });
    // rides under 30 s are not saved: wait until 35 s of the first step (4 min) are gone
    await D.waitForFunction(() => { const [m, s] = (document.querySelector('#hWLeft')?.textContent || '9:99').split(':').map(Number); return m * 60 + s <= 240 - 35; }, null, { timeout: 90000 });
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
    ok((await P.textContent('.mwstep[data-i="3"] .mww')).trim() === '312 W', 'phone editor: 120 % of 260 W = 312 W');
    await P.fill('#mwInt', '10'); await P.dispatchEvent('#mwInt', 'input');
    ok(await P.inputValue('.mwstep[data-i="3"] input[data-f="pct"]') === '132' && await P.inputValue('.mwstep[data-i="0"] input[data-f="pct"]') === '50', 'phone editor: intensity +10 % scales only the work steps (120 → 132, warm-up stays 50)');
    await P.fill('#mwRf', '1'); await P.fill('#mwRt', '1'); await P.fill('#mwRn', '2'); const c0 = await P.locator('.mwstep').count(); await P.click('#mwRep');
    ok((await P.locator('.mwstep').count()) === c0 + 1, 'phone editor: repeat step 1 ×2 adds one step');
    if (SHOTS) await P.screenshot({ path: `${SHOTS}/myworkouts_editor_390.png` });
    await P.click('#mwCancel'); await P.waitForSelector('.mwbox', { state: 'detached' });
    ok((await listOf(token)).find(w => w.id === saved.id).steps[3].pct === 120, 'phone editor: Cancel keeps the stored workout');
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

    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + e.message); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nMy workouts UI: all good'); process.exit(fails ? 1 : 0);
})();
