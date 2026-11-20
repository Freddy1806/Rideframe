// Coach workouts end to end (js/coachworkouts.js, owner 20.11.: "give you a workout in chat, it is in the app without a new
// version"): Playwright answers /coach/workouts.json with a test file. The workout shows on the desktop Training tab with
// "· Coach", on the route page and in pure.html's picker under "Coach", and it starts (3D ride and indoor page). A coach entry
// with a built-in id replaces it. A 404 and broken JSON give no page error and the built-ins still show.
// Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) RIDEFRAME_DATA=$(mktemp -d) node tools/coach-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, extra = '') => { console.log(`${c ? '✓' : '✗'} ${m}${!c && extra ? ' · ' + extra : ''}`); if (!c) fails++; };

const FILE = { workouts: [
  { id: 'c_ui_test', name: 'UI Coach Test', what: 'A coach workout from the test file.', rampIn: 3, rampOut: 2,
    steps: [{ sec: 60, watts: 222, label: 'Coach warm' }, { repeat: 3, label: 'Push', skipLastRest: true, steps: [{ sec: 30, watts: 340 }, { sec: 15, watts: 125, label: 'Float' }] }, { min: 5, pct: 50, pct2: 35, label: 'Cool-down' }] },
  { id: 'c_30_15_3x13', name: 'Override 30 / 15', what: 'Replaces the built-in.', steps: [{ min: 10, pct: 60 }] },
  { id: 'bad id', name: 'Broken', steps: [{ sec: 30, watts: 300 }] },
] };

(async () => {
  const DATA = process.env.RIDEFRAME_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'rf-coach-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  const errs = [];
  // every page of a context gets this answer for coach/workouts.json; null = leave it to the server (no file there: 404)
  const feed = async (ctx, body, status = 200) => { const seen = []; await ctx.route('**/coach/workouts.json*', r => { seen.push(r.request().url()); return body == null ? r.continue() : r.fulfill({ status, contentType: 'application/json', body }); }); return seen; };
  try {
    // ---- server: a file under coach/ is served as a static file, application/json, not cached for long ----
    const fx = path.join(__dirname, '..', 'coach', 'workouts.example.json'), sr = await fetch(BASE + '/coach/workouts.example.json');
    ok(sr.status === 200 && /application\/json/.test(sr.headers.get('content-type')) && /no-cache/.test(sr.headers.get('cache-control') || ''), `server: coach/*.json static, ${sr.headers.get('content-type')}, Cache-Control: ${sr.headers.get('cache-control')}`);
    ok((await sr.text()) === fs.readFileSync(fx, 'utf8'), 'server: the file as it is on disk');
    ok(fs.existsSync(path.join(__dirname, '..', 'coach', 'workouts.json')) || (await fetch(BASE + '/coach/workouts.json')).status === 404, 'server: no coach/workouts.json in the checkout: 404');

    // ---- desktop: Training tab, route page, 3D ride ----
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    const seen = await feed(ctx, JSON.stringify(FILE));
    const D = await ctx.newPage(); D.on('pageerror', e => errs.push('desktop: ' + e.message)); D.on('dialog', d => d.accept());
    await D.goto(BASE + '/?desktop&noprofile&demo&laptest&view=training'); await D.waitForSelector('.wcard');
    ok(seen.length >= 1 && seen.every(u => /\/coach\/workouts\.json\?t=\d+$/.test(u)), 'the app asks for coach/workouts.json with a cache-busting query', seen.join(', '));
    const card = D.locator('.wcard[data-wid="c_ui_test"]');
    ok(await card.count() === 1, 'Training tab: a card for the coach workout');
    const lab = (await card.locator('.label').first().textContent().catch(() => '')).trim();
    ok(/^8 min · Coach$/i.test(lab), `Training tab: its label "${lab}" (minutes · Coach)`);
    ok(/A coach workout from the test file/.test(await card.textContent()), 'Training tab: its description');
    const ov = D.locator('.wcard[data-wid="c_30_15_3x13"]');
    ok(await ov.count() === 1 && /Override 30 \/ 15/.test(await ov.textContent()) && /^10 min · Coach$/i.test((await ov.locator('.label').first().textContent()).trim()), 'Training tab: the coach file replaces the built-in c_30_15_3x13 (one card, "10 min · Coach")');
    ok(await D.locator('.wcard', { hasText: 'Broken' }).count() === 0, 'Training tab: the invalid entry is left out');
    ok(await D.locator('.wcard[data-wid="vo2_5x5"]').count() === 1, 'Training tab: the built-ins are still there');
    const dangling = await D.$$eval('.wcard .label', ls => ls.map(l => l.textContent.trim()).filter(t => /·\s*$/.test(t)));
    ok(dangling.length === 0, 'Training tab: no label ends in a dangling "·"', dangling.join(', '));
    if (SHOTS) { await card.scrollIntoViewIfNeeded(); await D.screenshot({ path: path.join(SHOTS, 'coach_training_1280.png') }); }
    // route page
    await D.click('.tab[data-view="library"]'); await D.click('.card[data-id="demo"]'); await D.waitForSelector('#workSel');
    ok(await D.locator('#workSel optgroup[label="Coach"] option[value="c_ui_test"]').count() === 1, 'route page: the coach workout under "Coach"');
    ok(await D.locator('#workSel option[value="c_30_15_3x13"]').count() === 1, 'route page: the replaced built-in only once');
    // start from the Training tab: the 3D ride runs it
    await D.click('.tab[data-view="training"]'); await D.waitForSelector('.wcard[data-wid="c_ui_test"]');
    await D.click('.wcard[data-wid="c_ui_test"] [data-go="c_ui_test"]');
    await D.waitForFunction(() => window.__ride?.workout, null, { timeout: 30000 });
    const rw = await D.evaluate(() => ({ id: window.__ride.workout.id, n: window.__ride.workout.steps.length, labels: window.__ride.workout.steps.map(s => s.label) }));
    ok(rw.id === 'c_ui_test' && rw.n === 7 && rw.labels[1] === 'Push · 1/3' && rw.labels[5] === 'Push · 3/3', 'desktop: Start runs the coach workout in the 3D ride (7 steps, "Push · 1/3")', JSON.stringify(rw));
    await ctx.close();

    // ---- pure.html: the picker and a start ----
    const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await feed(c2, JSON.stringify(FILE));
    const P = await c2.newPage(); P.on('pageerror', e => errs.push('pure: ' + e.message)); P.on('dialog', d => d.accept());
    await P.goto(BASE + '/pure.html?demo'); await P.waitForTimeout(700);
    await P.click('[data-m="work"]'); await P.waitForSelector('#pWork');
    ok(await P.locator('#pWork optgroup[label="Coach"] option[value="c_ui_test"]').count() === 1, 'pure: the coach workout in the picker under "Coach"');
    ok(await P.locator('#pWork optgroup[label="Standard workouts"] option[value="vo2_5x5"]').count() === 1, 'pure: the built-ins under "Standard workouts"');
    ok(await P.locator('#pWork option[value="c_30_15_3x13"]').count() === 1 && /Override/.test(await P.locator('#pWork option[value="c_30_15_3x13"]').textContent()), 'pure: the replaced built-in once, as the coach version');
    await P.selectOption('#pWork', 'c_ui_test'); await P.waitForTimeout(300);
    await P.click('#pStart'); await P.waitForTimeout(700);
    const step = await P.textContent('#pStep').catch(() => ''), tgt = await P.textContent('#pTarget').catch(() => '');
    ok(/Coach warm/.test(step) && /222/.test(tgt), `pure: started, first step "Coach warm" at 222 W (step "${step.trim()}", target "${tgt.trim()}")`);
    if (SHOTS) await P.screenshot({ path: path.join(SHOTS, 'coach_pure_390.png') });
    // the choice survives a reload (the file is read again at start)
    await P.goto(BASE + '/pure.html?workout=c_ui_test'); await P.waitForSelector('#pWork');
    ok(await P.inputValue('#pWork') === 'c_ui_test', 'pure: ?workout=c_ui_test opens it straight away');
    await c2.close();

    // ---- 404 and broken JSON: harmless ----
    for (const [name, body, status] of [['404', null, 404], ['broken JSON', '{ "workouts": [ {', 200], ['HTML instead of JSON', '<html>oops</html>', 200], ['server error', 'x', 500]]) {
      const c = await b.newContext({ viewport: { width: 1280, height: 860 } }); await feed(c, body, status);
      const e0 = errs.length, p = await c.newPage(); p.on('pageerror', e => errs.push(`${name} desktop: ` + e.message));
      await p.goto(BASE + '/?desktop&noprofile&demo&view=training'); await p.waitForSelector('.wcard');
      const builtins = await p.locator('.wcard[data-wid]').count(), coach = await p.locator('.wcard[data-wid="c_ui_test"]').count();
      const lab = (await p.locator('.wcard[data-wid="c_30_15_3x13"] .label').first().textContent().catch(() => '')).trim();
      const q = await c.newPage(); q.on('pageerror', e => errs.push(`${name} pure: ` + e.message));
      await q.goto(BASE + '/pure.html?demo'); await q.waitForTimeout(600); await q.click('[data-m="work"]'); await q.waitForSelector('#pWork');
      const pn = await q.locator('#pWork option[value="vo2_5x5"]').count(), pc = await q.locator('#pWork optgroup[label="Coach"] option[value="c_30_15_3x13"]').count();
      ok(errs.length === e0 && builtins >= 17 && !coach && pn === 1, `${name}: no page error, the ${builtins} built-ins show, nothing from the file`, errs.slice(e0).join(' | '));
      ok(/^\d+ min · Coach$/i.test(lab) && pc === 1, `${name}: the built-in coach workout still reads "${lab}" and sits under "Coach" in pure`);
      await c.close();
    }
  } catch (e) { ok(false, 'test run: ' + (e && e.stack || e)); }
  ok(!errs.length, 'no page errors', errs.join(' | '));
  await b.close(); srv.kill();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
})();
