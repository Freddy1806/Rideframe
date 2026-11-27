// Activities page end to end at phone width (390 px): "Import from Strava" against a fake Strava, "+ Add activity" by hand,
// a .fit / .gpx file, the feed and the detail sheets, stats, settings, the reconnect hint. Starts serve.mjs on free ports with a
// temp data folder (never the real one). Part 2 (23.11.): the laptop app imports on its own at start, the server's background
// import reaches a second signed-in device once. Usage: NODE_PATH=$(npm root -g) node tools/import-ui.cjs   SHOTS=<dir> saves screenshots.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const http = require('node:http'), net = require('node:net'), path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const ROOT = path.join(__dirname, '..'), SHOTS = process.env.SHOTS || '';
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const now = () => Math.floor(Date.now() / 1000), H = 3600, D = 86400;
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };

// what the fake Strava holds: a mix of sports over the last weeks (start = now - days)
const SPORTS = [['IceSkate', 'Evening Ice Skate', 1.2, 3600, 14000], ['Run', 'Lunch Run', 2.1, 2700, 7600], ['VirtualRide', 'Zwift: Watopia', 3.3, 3900, 32000], ['Walk', 'Walk with the dog', 4.1, 2400, 3200],
  ['Swim', 'Pool', 5.2, 2100, 1800], ['NordicSki', 'Langlauf Seefeld', 9.1, 5400, 21000], ['Yoga', 'Yoga', 10.2, 3000, 0], ['Soccer', 'Football Tuesday', 11.3, 5400, 0],
  ['Tennis', 'Tennis', 12.1, 4200, 0], ['WeightTraining', 'Gym', 13.2, 3300, 0], ['Crossfit', 'WOD', 15.1, 2700, 0], ['UnderwaterHockey', 'Underwater hockey', 16.2, 3600, 0]];
const fake = { posts: [], gets: 0, auto: { gets: 0, list: [] } };
const list = () => SPORTS.map(([t, n, d, el, dist], i) => ({ id: 777000 + i, name: n, sport_type: t, start_date: new Date((now() - Math.round(d * D)) * 1000).toISOString(), elapsed_time: el, moving_time: el - 60, distance: dist,
  total_elevation_gain: dist ? 25 : 0, average_heartrate: i % 2 ? 0 : 128 + i, max_heartrate: i % 2 ? 0 : 160 + i, trainer: t === 'VirtualRide', map: { summary_polyline: i === 0 ? 'u{~vFvyys@fS]a@lXeSxB' : '' } }));

(async () => {
  const F = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method !== 'GET') fake.posts.push(u.pathname); // uploads would land here: there must be none for imported activities
    if (u.pathname === '/api/v3/athlete/activities' && req.headers.authorization === 'Bearer auto-tok') { fake.auto.gets++; const a = fake.auto.list.filter(x => Date.parse(x.start_date) / 1000 > +u.searchParams.get('after'));
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-RateLimit-Usage': '1,1', 'X-RateLimit-Limit': '100,1000' }); return res.end(JSON.stringify(a.slice(0, 100))); } // the laptop's own Strava (part 2)
    if (u.pathname === '/api/v3/athlete/activities') { fake.gets++; const a = list().filter(x => Date.parse(x.start_date) / 1000 > +u.searchParams.get('after')), pg = +u.searchParams.get('page');
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-RateLimit-Usage': '1,1', 'X-RateLimit-Limit': '100,1000' }); return res.end(JSON.stringify(a.slice((pg - 1) * 100, pg * 100))); }
    res.writeHead(404); res.end('{}');
  }).listen(0, '127.0.0.1');
  await new Promise(r => F.once('listening', r));
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-import-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  fs.writeFileSync(path.join(DATA, 'strava.json'), JSON.stringify({ client_id: 'test-client', client_secret: 'test-only-not-a-secret', public_url: BASE }));
  const tok = scope => ({ access_token: 'ui-tok', refresh_token: 'ui-r', expires_at: now() + 3600, athlete: { id: 1, name: 'T' }, at: Date.now(), ...(scope ? { scope } : {}) });
  fs.writeFileSync(path.join(DATA, 'strava_tokens.json'), JSON.stringify({ kUI: tok('read,activity:write,activity:read_all'), kOld: tok(null), ['a'.repeat(48)]: { ...tok('read,activity:write,activity:read_all'), access_token: 'auto-tok', athlete: { id: 2, name: 'Auto' } } }));
  // part 2 needs the server's background import (tools/strava-auto.mjs): asked for here, every 1.5 s; part 1 has no account, so it finds nothing to do
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '', RIDEFRAME_STRAVA_AUTO: '1', RIDEFRAME_STRAVA_AUTO_MS: '1500', STRAVA_BASE: `http://127.0.0.1:${F.address().port}` }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/strava/status'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  // the files a watch would give: FIT from the test encoder, GPX from the fixtures
  const { iceSkateFit } = await import(path.join(ROOT, 'tools/fitenc.mjs'));
  const tmpFiles = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-import-files-')), fit = path.join(tmpFiles, 'Garmin_skate.fit');
  fs.writeFileSync(fit, iceSkateFit(Date.now() - 6 * D * 1000 - 3 * H * 1000));
  const gpx = path.join(tmpFiles, 'hike.gpx'); fs.writeFileSync(gpx, fs.readFileSync(path.join(ROOT, 'tools/fixtures/hike.gpx'), 'utf8').replace(/2026-11-16T07/g, new Date(Date.now() - 8 * D * 1000).toISOString().slice(0, 13)));

  const b = await chromium.launch(), c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await c.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  const shot = async n => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: false }); };
  const noSide = async tag => ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no sideways scroll: ${tag}`);
  const menu = async pg => { if (!await pg.isVisible('#fMenu')) await pg.click('#fPlus'); }; // Add and Import sit behind the + in the header
  await p.goto(BASE + '/handy.html'); await p.evaluate(() => { localStorage.setItem('rf_strava_key', 'kUI'); });
  await p.goto(BASE + '/aktivitaeten.html'); await p.waitForTimeout(1500);
  // the page itself does the automatic import on open (setting on by default once the permission is there)
  await p.waitForFunction(() => document.querySelectorAll('[data-act]').length >= 12, null, { timeout: 8000 }).catch(() => {});
  const n0 = await p.locator('[data-act]').count(); ok(n0 === 12, `automatic import on open: ${n0} rows (12 on the fake Strava)`);
  await menu(p); ok(await p.isVisible('#fImp') && await p.isVisible('#fAdd'), 'the + menu: Import from Strava and Add activity'); await shot('01b_plus_menu'); await p.click('#fPlus');
  await shot('01_feed_after_import'); await noSide('feed');
  await menu(p); await p.click('#fImp'); await p.waitForFunction(() => /Nothing new|new activit/.test(document.querySelector('#fMsg')?.textContent || ''));
  ok((await p.textContent('#fMsg')).trim() === 'Nothing new.', `second import: "${(await p.textContent('#fMsg')).trim()}"`);
  ok(await p.locator('[data-act]').count() === 12, 'importing twice adds nothing');
  const rows = await p.$$eval('[data-act] small', l => l.map(x => x.textContent));
  ok(rows.some(t => t.startsWith('Ice skating')) && rows.some(t => t.startsWith('Underwater hockey')) && rows.some(t => t.startsWith('Football')), 'rows say the sport (Ice skating, Football, unknown type prettified)');
  const chips = await p.$$eval('[data-f]', l => l.map(x => x.textContent));
  ok(['Skate', 'Walk', 'Swim', 'Snow', 'Fitness', 'Ball', 'Strength', 'Other', 'Run', 'Indoor'].every(k => chips.includes(k)), 'filter chips per sport: ' + chips.join(', '));
  const chipsOpen = async () => { if (!await p.isVisible('#fChips')) await p.click('#fFilter'); }; // the chips sit behind "Filter"
  await chipsOpen(); await p.click('[data-f="skate"]'); ok(/Filter · Skate/.test(await p.textContent('#fFilter')), 'the Filter button names the chosen sport'); ok(await p.locator('[data-act]').count() === 1, 'Skate filter shows the ice skating only'); await shot('02_filter_skate');
  await p.click('[data-act]'); await p.waitForSelector('.fdet');
  const det = await p.textContent('.fdet');
  ok(/Ice skating · from Strava/.test(det) && /View on Strava/.test(det) && !(await p.$('#dStrava')), 'imported detail: sport + source, View on Strava, no Upload to Strava');
  ok(!!(await p.$('.froute path')) && /Avg HR/.test(det) && /Load/.test(det), 'imported detail: route line, heart rate, load');
  await shot('03_detail_imported'); await noSide('detail');
  p.once('dialog', d => d.accept()); await p.click('#dDel'); await p.waitForTimeout(600);
  await chipsOpen().catch(() => {}); await p.click('[data-f="all"]').catch(() => {}); ok(await p.locator('[data-act]').count() === 11, 'deleting an imported one here');
  await menu(p); await p.click('#fImp'); await p.waitForFunction(() => /Nothing new|new activit/.test(document.querySelector('#fMsg')?.textContent || ''));
  ok(await p.locator('[data-act]').count() === 11, 'a deleted one does not come back with the next import');

  // ---- by hand ----
  await menu(p); await p.click('#fAdd'); await p.waitForSelector('.fadd');
  await p.selectOption('#aSport', 'Yoga'); await p.fill('#aStart', new Date(Date.now() - 2 * H * 1000 - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16));
  await p.fill('#aH', '0'); await p.fill('#aM', '45'); await p.fill('#aHr', '95'); await p.fill('#aNote', 'Sunday flow, hips and shoulders');
  await shot('04_add_manual'); await noSide('add sheet');
  await p.click('#aSave'); await p.waitForSelector('.fadd', { state: 'detached' });
  const yoga = p.locator('[data-act]').filter({ hasText: 'Yoga' }).first(); ok(await yoga.count() > 0, 'manual Yoga in the feed');
  await yoga.click(); await p.waitForSelector('.fdet');
  ok(!!(await p.$('#dEdit')) && !!(await p.$('#dStrava')) && /entered by hand/.test(await p.textContent('.fdet')) && /Sunday flow/.test(await p.textContent('.fdet')), 'manual detail: Edit, Upload to Strava, note');
  await p.click('#dEdit'); await p.waitForSelector('.fadd'); await p.fill('#aM', '50'); await p.fill('#aName', 'Evening yoga'); await p.click('#aSave'); await p.waitForSelector('.fadd', { state: 'detached' });
  ok(await p.locator('[data-act]').filter({ hasText: 'Evening yoga' }).count() === 1 && await p.locator('[data-act]').filter({ hasText: '50:00' }).count() === 1, 'edit keeps one entry, with the new name and 50 min');

  // ---- files ----
  await menu(p); await p.click('#fAdd'); await p.waitForSelector('.fadd'); await p.setInputFiles('#aFileIn', fit); await p.waitForFunction(() => /points/.test(document.querySelector('#aFileTxt')?.textContent || ''));
  const fv = await Promise.all(['#aSport', '#aH', '#aM', '#aDist', '#aGain', '#aHr'].map(k => p.inputValue(k)));
  ok(fv.join('|') === 'IceSkate|0|10|3.12|12|140', 'FIT fills the form: ice skating, 0 h 10 min, 3.12 km, 12 m, 140 bpm (' + fv.join('|') + ')');
  await shot('05_file_fit'); await p.click('#aSave'); await p.waitForSelector('.fadd', { state: 'detached' });
  await menu(p); await p.click('#fAdd'); await p.waitForSelector('.fadd'); await p.setInputFiles('#aFileIn', fit); await p.waitForFunction(() => /points/.test(document.querySelector('#aFileTxt')?.textContent || ''));
  await p.click('#aSave'); await p.waitForTimeout(300); ok(/already here/.test(await p.textContent('#aErr')), 'the same file twice: "already here"');
  await p.setInputFiles('#aFileIn', gpx); await p.waitForFunction(() => /hike\.gpx/.test(document.querySelector('#aFileTxt')?.textContent || ''));
  ok(await p.inputValue('#aSport') === 'Hike' && await p.inputValue('#aName') === 'Morning Hike & Coffee', 'GPX fills the form: hike with its name');
  await p.click('#aSave'); await p.waitForSelector('.fadd', { state: 'detached' });
  const hike = p.locator('[data-act]').filter({ hasText: 'Morning Hike' }).first(); await hike.click(); await p.waitForSelector('.fdet');
  ok(/from a file/.test(await p.textContent('.fdet')) && !(await p.$('#dStrava')) && !!(await p.$('.fchart')) && !!(await p.$('.froute')), 'file detail: heart-rate chart, route, no upload');
  await shot('06_detail_file'); await p.mouse.click(195, 30); await p.waitForTimeout(300);
  await p.evaluate(() => scrollTo(0, 0)); await shot('07_feed_all'); await noSide('feed with everything');
  const recs = await p.evaluate(async () => { const { db } = await import('/js/db.js'); return (await db.all('rides')).map(r => [r.source, r.sportType]); });
  ok(recs.filter(r => r[0] === 'strava').length === 11 && recs.filter(r => r[0] === 'file').length === 2 && recs.filter(r => r[0] === 'manual').length === 1, 'saved: 11 from Strava, 2 files, 1 by hand');

  // ---- stats, settings, reconnect ----
  await p.goto(BASE + '/statistik.html'); await p.waitForTimeout(900);
  const tot = await p.textContent('.ftot'); ok(['Skating', 'Walk & hike', 'Swim', 'Snow sports', 'Workout & yoga', 'Ball & racket', 'Other sports'].every(k => tot.includes(k)), 'stats totals per sport');
  ok(/–/.test(await p.textContent('.fest')), 'no bike: power bests stay empty'); await shot('08_stats'); await noSide('stats');
  await p.goto(BASE + '/handy.html'); await p.waitForTimeout(700); await p.click('#hSet'); await p.waitForSelector('#tImpRow:not([hidden])');
  ok(await p.isChecked('#tImp'), 'settings: "Import my Strava activities automatically" on by default'); await p.locator('#tImpRow').scrollIntoViewIfNeeded(); await shot('09_settings'); await noSide('settings');
  await p.evaluate(() => localStorage.setItem('rf_strava_key', 'kOld')); await p.goto(BASE + '/aktivitaeten.html'); await p.waitForSelector('#fImp:not([hidden])', { state: 'attached' }); await p.waitForTimeout(400);
  ok((await p.textContent('#fImp')).trim() === 'Reconnect Strava' && /Reconnect Strava to import/.test(await p.textContent('#fMsg')), 'old connection: Reconnect Strava + hint'); await shot('10_reconnect');
  await p.goto(BASE + '/handy.html'); await p.waitForTimeout(700); await p.click('#hSet'); await p.waitForTimeout(500);
  ok(!(await p.isHidden('#tImpHint')) && (await p.textContent('#tConn')).trim() === 'Reconnect', 'settings: Reconnect + hint for an old connection');

  // ---- part 2 (owner 23.11.): automatic on the laptop, and what the server imports in the background reaches a second device ----
  const jpg = async (pg, n) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, n + '.jpg'), type: 'jpeg', quality: 85, scale: 'css' }); };
  const reg = await (await fetch(BASE + '/api/account/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Auto Rider', email: 'auto@example.test', password: 'secret123' }) })).json();
  ok(!!reg.token, 'account for part 2');
  const uid = JSON.parse(fs.readFileSync(path.join(DATA, 'accounts.json'), 'utf8')).users['auto rider'].id, udir = path.join(DATA, 'users', uid);
  const sa = (id, name, hAgo, t = 'Ride') => ({ id, name, sport_type: t, start_date: new Date((now() - Math.round(hAgo * H)) * 1000).toISOString(), elapsed_time: 5400, moving_time: 5200, distance: 42000, total_elevation_gain: 380, average_heartrate: 141, map: { summary_polyline: 'u{~vFvyys@fS]a@lXeSxB' } });
  fake.auto.list = [sa(880001, 'Gravel loop with Garmin', 20)];
  const lap = await b.newContext({ viewport: { width: 1280, height: 800 } }), L = await lap.newPage(); L.on('pageerror', e => errs.push('laptop: ' + e.message)); L.setDefaultTimeout(10000);
  await L.goto(BASE + '/reset.html').catch(() => {}); await L.evaluate(({ t }) => { localStorage.setItem('rf_account', JSON.stringify({ token: t, name: 'Auto Rider' })); localStorage.setItem('rf_strava_key', 'a'.repeat(48)); }, { t: reg.token });
  await L.goto(BASE + '/?noprofile'); // no click from here on
  const nLap = id => L.evaluate(async id => { const { db } = await import('/js/db.js'); return (await db.all('rides')).filter(r => r.stravaId === id).length; }, id);
  for (let i = 0; i < 60 && !(await nLap('880001')); i++) await L.waitForTimeout(250);
  ok(await nLap('880001') === 1, 'laptop: the app start imported the Strava activity without a click');
  const toastTxt = await L.waitForSelector('.toast', { timeout: 4000 }).then(e => e.textContent()).catch(() => '');
  ok(/1 new activity from Strava/.test(toastTxt), `laptop: a quiet toast says so ("${toastTxt}")`);
  ok(!(await L.$('.modal')), 'laptop: no dialog');
  await L.click('.tab[data-view="history"]'); await L.waitForSelector('#stvNew');
  const line = await L.textContent('#stvNew'); ok(/1 new activity from Strava: Gravel loop with Garmin/.test(line) && !!(await L.$('#stvNew a[href="aktivitaeten.html"]')), `laptop Rides & records: "${line.trim()}"`);
  await jpg(L, 'desktop_auto_import');
  ok(fs.existsSync(path.join(udir, 'rides', 'st880001.json')), 'laptop pushed it to the account');
  ok(fs.existsSync(path.join(udir, 'strava-link.json')), 'the signed-in laptop linked its Strava key to the account');
  // a new activity reaches Strava while nothing of RIDEFRAME looks: the server's background import stores it in the account
  fake.auto.list.push(sa(880002, 'Wahoo evening ride', 2));
  let srvHas = false; for (let i = 0; i < 60 && !srvHas; i++) { srvHas = fs.existsSync(path.join(udir, 'rides', 'st880002.json')); if (!srvHas) await new Promise(r => setTimeout(r, 250)); }
  ok(srvHas, 'server: background import stored the new activity in the account');
  // the second device (phone, same account, no Strava connection of its own): its normal sync on opening Activities
  const ph = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), P2 = await ph.newPage(); P2.on('pageerror', e => errs.push('phone 2: ' + e.message)); P2.setDefaultTimeout(8000);
  await P2.goto(BASE + '/reset.html').catch(() => {}); await P2.evaluate(({ t }) => { localStorage.setItem('rf_account', JSON.stringify({ token: t, name: 'Auto Rider' })); }, { t: reg.token });
  await P2.goto(BASE + '/aktivitaeten.html'); await P2.waitForFunction(() => document.querySelectorAll('[data-act]').length >= 2, null, { timeout: 8000 }).catch(() => {});
  const rowsP = await P2.$$eval('[data-act]', l => l.map(x => x.textContent));
  ok(rowsP.filter(t => /Wahoo evening ride/.test(t)).length === 1 && rowsP.filter(t => /Gravel loop with Garmin/.test(t)).length === 1 && rowsP.length === 2, `phone 2: both activities, each exactly once (${rowsP.length} rows)`);
  await P2.reload(); await P2.waitForTimeout(1500);
  const recsP = await P2.evaluate(async () => { const { db } = await import('/js/db.js'); return (await db.all('rides')).map(r => r.stravaId); });
  ok(recsP.length === 2 && new Set(recsP).size === 2, 'phone 2: still once each after the next sync');
  await jpg(P2, 'phone_activities');
  // the laptop comes back to the front: it pulls the server's import, once, and says so
  await L.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await L.waitForFunction(() => /2 new activities from Strava/.test(document.querySelector('#stvNew')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
  ok(/2 new activities from Strava: Wahoo evening ride, Gravel loop/.test(await L.textContent('#stvNew').catch(() => '')), 'laptop: back to the front, the server\'s import arrives too');
  ok(await nLap('880002') === 1, 'laptop: exactly once');
  await jpg(L, 'desktop_after_server_import');
  const accIds = JSON.parse(await (await fetch(BASE + '/api/account/rides', { headers: { 'X-RF-Token': reg.token } })).text()).ids.sort();
  ok(accIds.join() === 'st880001,st880002', 'account: one record per Strava id (' + accIds.join() + ')');
  ok(fake.auto.gets >= 2, `the server read the laptop's Strava itself (${fake.auto.gets} reads)`);

  ok(fake.posts.length === 0, `nothing was sent to Strava (${fake.posts.length} writes)`);
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); srv.kill(); F.close(); fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(tmpFiles, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nall passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
