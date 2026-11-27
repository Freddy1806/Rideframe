// End to end for the watch setup on the phone (Settings → Devices → Watch screens & workouts, js/watchcfg.js): edit a data page
// (change, remove, add fields, add and remove a page), switches, a workout with a custom exercise, the "more" sports; it saves by
// itself, survives a reload, keeps an offline edit and sends it the next time; the preview watch (watch.html) shows the result.
// 23.11.: the start page has "Watch · Screens & workouts" only signed in with a paired watch; Settings has its own WATCH section;
// signed out a line says what can be set up there after signing in. No sideways scroll at 320 / 390 px, no page errors. Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) node tools/watchcfg-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-watchcfg-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  try {
    const api = (m, p, body, token) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-RF-Token': token } : {}) }, body: body && JSON.stringify(body) }).then(r => r.json());
    const { token, name } = await api('POST', '/api/account/register', { name: 'Watch Wanda', email: 'wanda@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' });
    const phone = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const P = await phone.newPage(); const perr = []; P.on('pageerror', e => perr.push(e.message));
    await P.goto(BASE + '/handy.html');
    // signed out: no editor row, the pairing row asks to sign in
    await P.click('#hSet'); await P.waitForSelector('#wIn'); ok(!(await P.locator('#wcOpen').count()), 'signed out: no watch editor, the sign-in hint instead');
    await P.waitForSelector('#wcSignedOut'); ok(/After signing in.*watch screens \(data fields per sport\) and workouts/.test(await P.textContent('#wcSignedOut')) && await P.isVisible('#wcSignedOut'), 'signed out: one line says the watch screens and workouts are set up here after signing in');
    ok(await P.evaluate(() => { const h = document.querySelector('#tWatchSec'), w = document.querySelector('#tWatch'); return /^watch$/i.test(h?.textContent.trim()) && !!(h.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'Settings: its own WATCH heading above the Garmin watch row');
    await P.click('#tOk'); ok(!(await P.locator('#hWcfg').count()), 'signed out: no watch card on the start page');
    await P.evaluate(async ([token, name]) => { localStorage.setItem('rf_account', JSON.stringify({ token, name }));
      const { db } = await import('/js/db.js'); await db.kvSet('kraftEx', [{ k: 'my_thai', n: 'Thai kick on the heavy bag', t: 'w', g: 'Eigene' }]); }, [token, name]);
    await P.reload(); await P.waitForSelector('#hSet');
    await P.waitForResponse(r => /\/api\/watch\/devices$/.test(r.url()), { timeout: 5000 }).catch(() => {}); await P.waitForTimeout(300);
    ok(!(await P.locator('#hWcfg').count()), 'signed in, no watch paired: the start page stays as it is (no watch card)');
    const state = () => P.textContent('#wcState');
    const open = async () => { await P.click('#hSet'); await P.waitForSelector('#wcOpen'); await P.click('#wcOpen'); await P.waitForFunction(() => /Saved|Defaults|Offline/.test(document.querySelector('#wcState')?.textContent || '')); };
    const saved = () => P.waitForFunction(() => /Saved ✓/.test(document.querySelector('#wcState')?.textContent || ''), null, { timeout: 8000 });
    const fieldsShown = () => P.$$eval('#wcBody .wcslot b', l => l.map(e => e.textContent));
    const prev = () => P.getAttribute('#wcCv', 'data-fields');
    const sideways = async w => { await P.setViewportSize({ width: w, height: 800 }); await P.waitForTimeout(150); return P.evaluate(() => [document.documentElement.scrollWidth > innerWidth + 1, ...[...document.querySelectorAll('.psheetin')].map(e => e.scrollWidth > e.clientWidth + 1)].some(Boolean)); };
    const shot = async nm => { if (SHOTS) { await P.setViewportSize({ width: 390, height: 844 }); await P.waitForTimeout(200); await P.screenshot({ path: `${SHOTS}/phone_${nm}.png` }); } };
    await open(); ok(/Defaults/.test(await state()), 'nothing stored yet: the defaults');
    ok((await fieldsShown()).join() === 'Pace,Distance,Time,Heart rate', 'run page 1: pace, distance, time, heart rate'); ok(await prev() === 'pace,dist,time,hr', 'the preview draws the same fields');
    await shot('run');
    // edit the run page: slot 2 -> avg pace, remove heart rate, add climb, add a page and remove it again
    await P.click('[data-slot="1"]'); await P.waitForSelector('#wcPick'); await P.click('#wcPick [data-f="avgPace"]'); ok((await fieldsShown())[1] === 'Avg pace', 'tap a slot, pick a value');
    await P.click('[data-rm="3"]'); ok((await fieldsShown()).length === 3 && await prev() === 'pace,avgPace,time', 'remove a field: 3 left, the preview follows');
    await P.click('#wcAddF'); await P.click('#wcPick [data-f="climb"]'); ok(await prev() === 'pace,avgPace,time,climb', 'add a field (up to 4)'); ok(!(await P.locator('#wcAddF').count()), 'no fifth field');
    await P.click('[data-slot="0"]'); await P.click('#wcPick [data-f="time"]'); ok(await prev() === 'time,avgPace,pace,climb', 'a value already on the page swaps places');
    await P.click('[data-addpg]'); ok(await P.locator('[data-pg]').count() === 3, 'add a page'); await P.click('#wcDelPg'); ok(await P.locator('[data-pg]').count() === 2, 'remove it again');
    await P.click('[data-pg="0"]'); await P.check('[data-sw="autoPause"]'); await P.uncheck('[data-sw="map"]'); ok(!(await P.locator('.wcfixed').count()), 'route page switched off');
    await saved(); ok(true, 'saved by itself');
    for (const w of [320, 390]) ok(!(await sideways(w)), `run editor: no sideways scroll at ${w} px`);
    await P.click('[data-tab="ride"]'); ok(await prev() === 'power3s,speed,hr,time', 'ride page 1: power 3s, speed, heart rate, time'); await P.click('[data-face="1"]'); await P.waitForTimeout(100);
    ok(await P.getAttribute('#wcCv', 'class') === 'mip', 'fenix preview: 280 px MIP'); await shot('ride'); await P.click('[data-face="0"]');
    for (const w of [320, 390]) ok(!(await sideways(w)), `ride editor: no sideways scroll at ${w} px`);
    // 28.11.: the indoor trainer's pages: Target fixed first, Stats switched off, Body moved above Workout
    await P.click('[data-tab="trainer"]'); ok(await P.$$eval('[data-tp]', l => l.map(e => e.dataset.tp).join()) === 'wk,body,stats', 'trainer: workout, body, stats after the fixed target page');
    ok(/Always on/.test(await P.textContent('.wcfix')), 'trainer: the target page cannot be switched off');
    await P.uncheck('[data-tpon="stats"]'); await P.click('[data-tpup="body"]'); ok(await P.$$eval('[data-tp]', l => l.map(e => e.dataset.tp).join()) === 'body,wk,stats', 'trainer: body moved up, stats off at the end');
    ok(/3 of 4/.test(await P.textContent('.wccount')), 'trainer: the count follows'); await saved();
    ok(JSON.stringify((await api('GET', '/api/watch/config', null, token)).config.trainer) === '{"pages":["body","wk"]}', 'trainer: the server has the pages in order');
    for (const w of [320, 390]) ok(!(await sideways(w)), `trainer: no sideways scroll at ${w} px`); await shot('trainer');
    // strength: a workout with a custom exercise
    await P.click('[data-tab="kraft"]'); await P.click('#wcNewW'); await P.waitForSelector('#wcWork'); await P.fill('#wcWName', 'Push day heavy');
    await P.click('#wcAddEx'); await P.waitForSelector('#wcEx'); await P.fill('#wcQ', 'bench'); ok(await P.locator('#wcEx [data-ex]:visible').count() >= 2, 'search the exercises');
    await P.click('#wcEx [data-ex="bench"]'); await P.waitForSelector('#wcItem');
    await P.fill('#wcItem [data-n="sets"]', '4'); await P.fill('#wcItem [data-n="reps"]', '6'); await P.fill('#wcItem [data-n="kg"]', '82.5'); await P.selectOption('#wcItem [data-n="rest"]', '150'); await P.click('#wcItOk');
    await P.click('#wcAddEx'); ok(await P.locator('#wcEx [data-ex="my_thai"]').count() === 1, 'own exercises are in the list'); await P.click('#wcEx [data-ex="my_thai"]'); await P.click('#wcItOk');
    await P.click('#wcAddEx'); await P.click('#wcEx [data-ex="plank"]'); await P.click('#wcItOk'); await P.click('[data-up="2"]');
    const items = await P.$$eval('#wcWork .wcit b', l => l.map(e => e.textContent)); ok(items.join() === 'Bench press,Plank,Thai kick on the heavy bag', 'three exercises, plank moved up');
    ok(/4 × 6 reps · 82.5 kg · rest 2:30/.test(await P.textContent('#wcWork .wcit small')), 'sets, reps, kg and rest of the first one');
    for (const w of [320, 390]) ok(!(await sideways(w)), `workout editor: no sideways scroll at ${w} px`);
    await shot('strength_workout'); await P.click('#wcWOk'); ok(/Push day heavy/.test(await P.textContent('#wcBody')), 'the workout is listed');
    await P.click('#wcNewW'); await P.waitForSelector('#wcWork'); ok((await P.locator('[data-w]').count()) === 2, 'a second workout'); // deleted again (after a confirm)
    P.once('dialog', d => d.accept()); await P.click('#wcWDel'); await P.waitForSelector('#wcWork', { state: 'detached' });
    ok((await P.locator('[data-w]').count()) === 1, 'a workout can be deleted');
    // more sports
    await P.click('[data-tab="more"]'); await P.check('[data-sp="Basketball"]'); await P.uncheck('[data-sp="Walk"]'); ok(/4 of/.test(await P.textContent('.wccount')), 'the count follows');
    ok(await prev() === 'hr,time,clock,kcal', 'more: the fixed screen'); for (const w of [320, 390]) ok(!(await sideways(w)), `more: no sideways scroll at ${w} px`);
    await shot('more'); await saved(); await P.click('#wcDone');
    // reload: everything comes back from the server
    await P.evaluate(async () => { const { db } = await import('/js/db.js'); await db.kvDel('watchCfg'); }); await P.reload(); await P.waitForSelector('#hSet'); await open();
    ok(/Saved ✓/.test(await state()), 'after a reload: loaded from the account'); ok(await prev() === 'time,avgPace,pace,climb', 'run page 1 persisted');
    ok(await P.isChecked('[data-sw="autoPause"]') && !(await P.isChecked('[data-sw="map"]')), 'switches persisted');
    await P.click('[data-tab="kraft"]'); ok(/Push day heavy.*3 exercises · 10 sets/.test(await P.textContent('#wcBody')), 'workout persisted');
    await P.click('[data-tab="more"]'); ok(await P.isChecked('[data-sp="Basketball"]') && !(await P.isChecked('[data-sp="Walk"]')), 'more sports persisted');
    const S = await api('GET', '/api/watch/config', null, token); ok(S.config.workouts[0].items.map(i => i.ex).join() === 'bench,plank,my_thai' && S.config.workouts[0].items[0].kg === 82.5 && S.config.workouts[0].items[0].rest === 150, 'the server has the workout');
    // offline: the change stays on the phone and goes out the next time
    await P.route(/\/api\/watch\/config$/, r => r.request().method() === 'PUT' ? r.abort() : r.continue());
    await P.check('[data-sp="Golf"]'); await P.waitForFunction(() => /Offline/.test(document.querySelector('#wcState')?.textContent || '')); ok(true, 'offline: kept on this phone');
    await P.click('#wcDone'); await P.unroute(/\/api\/watch\/config$/); await P.reload(); await P.waitForSelector('#hSet'); await open(); await saved();
    ok((await api('GET', '/api/watch/config', null, token)).config.more.includes('Golf'), 'the offline change was sent on the next open');
    await P.click('#wcDone');

    // the preview watch loads the account's setup (signed in on this browser, no watch paired)
    const W = await phone.newPage(); const werr = []; W.on('pageerror', e => werr.push(e.message));
    await W.setViewportSize({ width: 390, height: 844 }); await W.goto(BASE + '/watch.html'); await W.waitForFunction(() => window.__watch?.cfgFrom === 'account', null, { timeout: 8000 });
    const pg = await W.evaluate(async () => { const m = await import('/js/watchflow.js'), F = __watch.F; __watch.ev('start'); __watch.ev('start'); return { scr: F.scr, pages: m.recPages(F), w: m.workouts(F).map(w => w.n), more: F.cfg.more.map(x => x[1]) }; });
    ok(pg.scr === 'rec' && JSON.stringify(pg.pages) === JSON.stringify([['time', 'avgPace', 'pace', 'climb'], ['lapPace', 'lapDist', 'avgPace', 'hrZone']]), 'preview: the run pages from the phone (route page off)');
    ok(pg.w[0] === 'Push day heavy' && pg.w.includes('One-arm pull-up') && pg.more.includes('Basketball') && pg.more.includes('Golf') && !pg.more.includes('Walk'), 'preview: the workout and the more sports from the phone');
    ok(/your account/.test(await W.textContent('#wCfg')), 'the panel says where the screens come from');
    ok(await W.evaluate(() => document.documentElement.scrollWidth) <= 390, 'watch.html: no sideways scroll at 390 px');
    // a paired watch: the start page has the card, it opens the same editor (23.11.)
    const { code } = await api('POST', '/api/watch/code', {}, token); ok((await api('POST', '/api/watch/pair', { code, label: 'fenix 8 Solar' })).token, 'a watch paired (API)');
    await P.setViewportSize({ width: 390, height: 844 }); await P.reload(); await P.waitForSelector('#hWcfg', { timeout: 6000 }).catch(() => {});
    ok(await P.isVisible('#hWcfg') && /Watch · Screens & workouts/.test(await P.textContent('#hWcfg')) && /fenix 8 Solar/.test(await P.textContent('#hWcfg')), 'paired: "Watch · Screens & workouts" card on the start page, with the watch name');
    ok(await P.evaluate(() => { const c = document.querySelector('#hWcfg'), m = document.querySelector('.hmodes'), w = document.querySelector('#ovGrid'); return !!(m.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) && w.contains(c); }), 'the card sits under Record, in the overview (the Watch card)');
    for (const w of [320, 390]) ok(!(await sideways(w)), `start page with the watch card: no sideways scroll at ${w} px`);
    if (SHOTS) { await P.setViewportSize({ width: 390, height: 844 }); await P.locator('#hWcfg').scrollIntoViewIfNeeded(); await P.screenshot({ path: `${SHOTS}/phone_home_watch_card.png` }); }
    await P.click('#hWcfg'); await P.waitForFunction(() => /Saved|Defaults|Offline/.test(document.querySelector('#wcState')?.textContent || ''));
    ok(await P.isVisible('#wcSheet') && await prev() === 'time,avgPace,pace,climb', 'the card opens the watch editor with the account\'s setup');
    await P.click('#wcDone'); ok(!(await P.locator('#wcSheet').count()), 'Done closes it, back on the start page');
    await P.route(/\/api\/watch\/devices$/, r => r.abort()); await P.reload(); await P.waitForSelector('#hSet'); await P.waitForTimeout(300);
    ok(await P.isVisible('#hWcfg'), 'after a reload, server not answering: the card is still there (kept on this phone)'); await P.unroute(/\/api\/watch\/devices$/);
    ok(!werr.length, 'no page errors on watch.html' + (werr.length ? ': ' + werr.join(' | ') : ''));
    ok(!perr.length, 'no page errors on the phone' + (perr.length ? ': ' + perr.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + e.message); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nWatch setup UI: all good'); process.exit(fails ? 1 : 0);
})();
