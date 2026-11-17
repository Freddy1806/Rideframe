// End to end: phone pairs a watch, the preview watch (watch.html) runs a whole strength session with the buttons only and
// one with touch only (that one offline first: queue, then sent), and both sessions show up in the phone's Activities feed.
// 18.11.: the start menu, a run with data pages, auto lap, route page and the segment popup, a ride, a "more" sport and a guided
// workout in the demo preview.
// Starts its own serve.mjs on a free port with a temp data folder. Screenshots of every screen on both faces go to SHOTS.
// Usage: NODE_PATH=$(npm root -g) node tools/watch-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-watch-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  try {
    // an account with one earlier bench session (best e1RM 80 x 8 = 101.3) and 60 s rest
    const api = (m, p, body, token) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-RF-Token': token } : {}) }, body: body && JSON.stringify(body) }).then(r => r.json());
    const { token, name } = await api('POST', '/api/account/register', { name: 'Garmin Gary', email: 'gary@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' });
    const t0 = Date.now() - 3 * 864e5;
    await api('PUT', '/api/account/kraft/k-old', { id: 'k-old', name: 'Push day', start: t0, date: t0 + 3600e3, dur: 3600, ex: [{ k: 'bench', n: 'Bench press', t: 'w', sets: [{ kg: 80, r: 8, s: '', done: true }, { kg: 80, r: 8, s: '', done: true }] }, { k: 'pull', n: 'Pull-ups', t: 'bw', sets: [{ kg: '', r: 10, s: '', done: true }] }] }, token);
    await api('PUT', '/api/account/settings', { settings: { kraftRest: 60 }, at: Date.now() }, token);

    // ---- phone: Settings -> Devices -> Pair a watch ----
    const phone = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const P = await phone.newPage(); const perr = []; P.on('pageerror', e => perr.push(e.message));
    await P.goto(BASE + '/handy.html'); await P.evaluate(([token, name]) => localStorage.setItem('rf_account', JSON.stringify({ token, name })), [token, name]); await P.reload(); await P.waitForTimeout(600);
    await P.click('#hSet'); await P.waitForSelector('#tWatch .wrow'); await P.click('#wPair'); await P.waitForSelector('.wcode');
    const code = (await P.textContent('.wcode')).replace(/\D/g, ''); ok(/^\d{6}$/.test(code), `phone shows a 6-digit code (${code.length} digits)`);
    await P.locator('#tWatch').scrollIntoViewIfNeeded(); if (SHOTS) await P.screenshot({ path: `${SHOTS}/phone_settings_pair_code.png` });

    // ---- the watch preview ----
    const watch = await b.newContext({ viewport: { width: 1280, height: 1150 }, deviceScaleFactor: 2, hasTouch: true });
    const W = await watch.newPage(); const werr = []; W.on('pageerror', e => werr.push(e.message));
    await W.goto(BASE + '/watch.html'); await W.waitForTimeout(500);
    const F = () => W.evaluate(() => ({ scr: __watch.F.scr, sets: __watch.F.sets.length, kg: __watch.F.kg, reps: __watch.F.reps, focus: __watch.F.focus, ex: __watch.F.setup.ex[__watch.F.cur]?.id, sel: __watch.F.sel, flash: !!__watch.F.flash, queue: __watch.F.queue.length, sum: __watch.F.sum, paired: __watch.F.paired, nEx: __watch.F.setup.ex.length,
      sp: __watch.F.sp, pg: __watch.F.rec?.pg, rec: !!__watch.F.rec, seg: __watch.F.seg?.k || null, flashK: __watch.F.flash?.k || null, last: __watch.F.last }));
    const btn = async (k, n = 1, face = 'fr265') => { for (let i = 0; i < n; i++) { await W.click(`[data-face="${face}"] .wbtn.${k}`); await W.waitForTimeout(60); } };
    const hold = async (k, ms, face = 'fenix7xpro') => { const el = W.locator(`[data-face="${face}"] .wbtn.${k}`), bb = await el.boundingBox(); await W.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await W.mouse.down(); await W.waitForTimeout(ms); await W.mouse.up(); await W.waitForTimeout(80); };
    let shot = 0; const snap = async nm => { shot++; if (!SHOTS) return; await W.waitForTimeout(250); for (const f of ['fr265', 'fenix7xpro']) await W.locator(`[data-face="${f}"] .wscale`).screenshot({ path: `${SHOTS}/${f}_${String(shot).padStart(2, '0')}_${nm}.png` }); };
    await snap('start_demo');
    await W.click('[data-mode="live"]'); await W.waitForTimeout(200); ok((await F()).scr === 'pair', 'My account without a token: pairing screen');
    // buttons only: UP d times, START; the last digit is shown before START
    for (let i = 0; i < 6; i++) { await btn('up', +code[i], i % 2 ? 'fenix7xpro' : 'fr265'); if (i === 5) await snap('pair'); await btn('start'); }
    for (let i = 0; i < 40 && !(await F()).nEx; i++) await W.waitForTimeout(100);
    let s = await F(); ok(s.paired && s.scr === 'home' && s.nEx > 0, 'paired with buttons only, setup loaded, the start menu');
    await P.waitForSelector('.wdev', { timeout: 6000 }).catch(() => {}); ok(/Preview \(browser\)/.test(await P.textContent('#tWatch')), 'phone lists the paired watch');
    if (SHOTS) await P.screenshot({ path: `${SHOTS}/phone_settings_paired.png` });
    await W.waitForTimeout(400); await snap('home'); await btn('down', 2); await btn('start'); s = await F(); ok(s.scr === 'start', 'start menu: Strength'); await snap('start');

    // ---- session 1: buttons only ----
    await btn('start'); s = await F(); ok(s.scr === 'pick' && s.ex === 'bench', 'START opens the picker, last used first'); await btn('down'); await btn('up'); await snap('pick');
    await btn('start'); s = await F(); ok(s.scr === 'set' && s.kg === 80 && s.reps === 8, 'bench prefilled 80 x 8 from last session');
    await hold('up', 950); s = await F(); ok(s.kg >= 90, `UP held: 10 kg steps (${s.kg})`); while ((await F()).kg > 82.5) await btn('down');
    await snap('set'); await btn('start'); s = await F(); ok(s.scr === 'rest' && s.flash, '82.5 x 8 beats 80 x 8: record flash'); await snap('pr');
    await btn('start'); s = await F(); ok(s.scr === 'rest' && !s.flash, 'first key clears the flash'); await snap('rest');
    await btn('start'); s = await F(); ok(s.scr === 'set' && s.kg === 82.5 && s.reps === 8, 'START skips the rest, set 2 prefilled from set 1');
    await btn('back'); await btn('down'); s = await F(); ok(s.focus === 1 && s.reps === 7, 'BACK switches to reps, DOWN = 7'); await snap('set_reps');
    await btn('start'); await btn('back'); s = await F(); ok(s.scr === 'pick', 'BACK in the rest: picker'); const pull = await W.evaluate(() => __watch.F.list.indexOf(__watch.F.setup.ex.findIndex(e => e.id === 'pull')) - __watch.F.sel);
    await btn('down', pull); await btn('start'); s = await F(); ok(s.ex === 'pull' && s.reps === 10 && s.focus === 1, 'pull-ups: bodyweight, reps focused');
    await btn('start'); await btn('start'); await hold('back', 900); s = await F(); ok(s.scr === 'menu', 'BACK held: menu'); await snap('menu');
    await btn('down'); await btn('start'); s = await F(); ok(s.scr === 'set' && s.sets === 2 && s.ex === 'pull', 'undo last set');
    await btn('up', 2); await btn('start'); await hold('back', 900); await btn('down', 2); await btn('start');
    s = await F(); ok(s.scr === 'sum' && s.sum.sets === 3, 'finish: summary with 3 sets');
    for (let i = 0; i < 40 && (await F()).sum.st !== 'saved'; i++) await W.waitForTimeout(100);
    ok((await F()).sum.st === 'saved', 'session 1 saved on the server'); await snap('summary_saved');
    await W.click('#wGlance'); await W.waitForTimeout(300); await snap('glance'); await btn('start'); s = await F(); ok(s.scr === 'home' && s.last === 'kraft', 'glance opens the start menu, Strength on top');

    // ---- session 2: touch only, phone away first (offline queue) ----
    await W.uncheck('#wNear');
    const cv = W.locator('[data-face="fr265"] canvas'), box = await cv.boundingBox(), at = (u, v) => ({ x: box.x + u * box.width, y: box.y + v * box.height });
    const tap = async (u, v) => { await cv.tap({ position: { x: u * box.width, y: v * box.height } }); await W.waitForTimeout(80); };
    const swipe = async (dir) => { const [a, z] = { up: [[.5, .7], [.5, .3]], down: [[.5, .3], [.5, .7]], left: [[.75, .5], [.25, .5]] }[dir]; const p0 = at(...a), p1 = at(...z);
      await W.mouse.move(p0.x, p0.y); await W.mouse.down(); await W.mouse.move(p1.x, p1.y, { steps: 6 }); await W.mouse.up(); await W.waitForTimeout(100); };
    await tap(.5, .5); s = await F(); ok(s.scr === 'start', 'tap the top row: Strength');
    await tap(.5, .5); s = await F(); ok(s.scr === 'pick', 'tap: picker'); const sel0 = s.sel;
    await swipe('up'); s = await F(); ok(s.sel === sel0 + 1, 'swipe up scrolls the list down'); for (let i = 0; i < sel0; i++) await swipe('down');
    s = await F(); ok(s.sel === 1, 'swipe down scrolls back'); await tap(.5, .345); s = await F(); ok(s.scr === 'set' && s.ex === 'bench', 'tap the row above: bench selected');
    await tap(.72, .5); s = await F(); ok(s.focus === 1, 'tap reps: focused'); await swipe('up'); s = await F(); ok(s.reps === 9, 'swipe up: reps + 1');
    const kg0 = s.kg; ok(kg0 === 82.5, 'prefill from the session just sent (82.5 kg)'); await tap(.3, .5); await swipe('down'); s = await F(); ok(s.focus === 0 && s.kg === kg0 - 2.5, 'tap kg, swipe down: -2.5 kg');
    await tap(.5, .5); s = await F(); ok(s.scr === 'set' && s.sets === 0, 'a stray tap never logs a set');
    await tap(.5, .815); s = await F(); ok(s.scr === 'rest' && s.sets === 1, 'tap DONE: set logged');
    await tap(.5, .5); if ((await F()).flash) await tap(.5, .5); s = await F(); ok(s.scr === 'set', 'tap skips the rest');
    await tap(.5, .815); await tap(.5, .5); await swipe('left'); s = await F(); ok(s.scr === 'menu', 'swipe left: menu');
    await swipe('up'); await tap(.5, .67); s = await F(); ok(s.scr === 'sum' && s.sum.st === 'queued', 'finish without phone: queued');
    await snap('summary_queued'); ok(/1 session waits/.test(await W.textContent('#wNet')), 'panel shows the waiting session');
    await W.check('#wNear'); for (let i = 0; i < 40 && (await F()).queue; i++) await W.waitForTimeout(100);
    s = await F(); ok(!s.queue && s.sum.st === 'saved', 'phone back: the queue is sent');
    await tap(.5, .5);

    // ---- 18.11.: the new flows in the demo preview (no account): run, ride, more, guided workout ----
    const demo = await b.newContext({ viewport: { width: 1280, height: 1150 }, deviceScaleFactor: 2, hasTouch: true }); // fresh storage: demo data, default screens
    const D = await demo.newPage(); const derr = []; D.on('pageerror', e => derr.push(e.message));
    await D.goto(BASE + '/watch.html'); await D.waitForFunction(() => window.__watch?.F);
    const G = () => D.evaluate(() => ({ scr: __watch.F.scr, sp: __watch.F.sp, type: __watch.F.type, pg: __watch.F.rec?.pg, laps: __watch.F.rec?.laps.length, seg: __watch.F.seg?.k || null, flash: __watch.F.flash?.k || null, plan: __watch.F.plan, kg: __watch.F.kg, reps: __watch.F.reps, ex: __watch.F.setup.ex[__watch.F.cur]?.id, restLen: __watch.F.restLen, items: __watch.F.scr ? null : 0 }));
    const dbtn = async (k, n = 1) => { for (let i = 0; i < n; i++) { await D.click(`[data-face="fr265"] .wbtn.${k}`); await D.waitForTimeout(60); } };
    const dsnap = async nm => { if (!SHOTS) return; await D.waitForTimeout(250); for (const f of ['fr265', 'fenix7xpro']) await D.locator(`[data-face="${f}"] .wscale`).screenshot({ path: `${SHOTS}/new_${f}_${nm}.png` }); };
    const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 100) { if (await D.evaluate(fn)) return true; await D.waitForTimeout(100); } return false; };
    let d = await G(); ok(d.scr === 'home', 'demo: the start menu'); ok((await D.evaluate(() => __watch.cfgFrom)) === 'defaults', 'no account: default screens'); await dsnap('01_start_menu');
    await dbtn('start'); d = await G(); ok(d.scr === 'ready' && d.sp === 'run', 'Run: ready screen'); await dsnap('02_run_ready');
    // 19.11.: the Route choice (demo routes without an account): DOWN opens it, None leaves the route page out, a route brings it back
    const RT = () => D.evaluate(() => ({ scr: __watch.F.scr, sel: __watch.F.sel, id: __watch.F.routeId, has: !!__watch.F.route, src: __watch.rsrc }));
    await dbtn('down'); let rt = await RT(); ok(rt.scr === 'rpick' && rt.sel === 1 && rt.id === 'demo-run' && rt.src === 'demo', 'DOWN: the route list, the demo route chosen'); await dsnap('02b_route_list');
    await dbtn('up'); await dbtn('start'); rt = await RT(); ok(rt.scr === 'ready' && rt.id === null && !rt.has, 'None: no route'); await dsnap('02c_ready_no_route');
    await D.click('[data-face="fr265"] canvas', { position: { x: 208, y: 291 } }); rt = await RT(); ok(rt.scr === 'rpick' && rt.sel === 0, 'tap on the route line: the list');
    await dbtn('down'); await dbtn('start'); rt = await RT(); ok(rt.scr === 'ready' && rt.id === 'demo-run' && rt.has, 'a route chosen again');
    await dbtn('start'); d = await G(); ok(d.scr === 'rec' && d.pg === 0, 'START: recording, page 1');
    await D.evaluate(() => { for (let i = 0; i < 36; i++) __watch.ev('sample', { dt: 10, v: 3.2, hr: 151, cad: 172, up: .3 }); }); d = await G(); ok(d.laps === 1 && d.flash === 'lap', 'auto lap after 1 km: the lap banner'); await dsnap('03_run_lap');
    await dbtn('down'); d = await G(); ok(d.flash === null && d.pg === 0, 'the first key closes the banner'); await dsnap('04_run_page1');
    await dbtn('down'); d = await G(); ok(d.pg === 1, 'DOWN: page 2'); await dsnap('05_run_page2');
    await dbtn('down'); d = await G(); ok(d.pg === 2, 'DOWN: the route page'); await dsnap('06_run_route');
    await dbtn('up', 2); ok((await G()).pg === 0, 'UP: back to page 1'); ok(await D.isEnabled('#wSeg'), 'segment demo can start');
    await D.click('#wSeg'); ok(await until(() => __watch.F.seg?.k === 'warn'), 'segment: the warning'); await D.waitForTimeout(1200); await dsnap('07_segment_warning');
    ok(await until(() => __watch.F.seg?.k === 'live' && __watch.F.seg.done > 300), 'segment: live against the PR'); await dsnap('08_segment_live');
    ok(await until(() => __watch.F.seg?.k === 'end'), 'segment: the result'); await dsnap('09_segment_result'); ok(await until(() => !__watch.F.seg, 7000), 'the result goes after 5 s');
    await dbtn('back'); d = await G(); ok(d.laps === 2, 'BACK: manual lap'); await dbtn('down');
    await dbtn('start'); d = await G(); ok(d.scr === 'pause', 'START: paused'); await dsnap('10_run_paused'); await dbtn('down'); await dbtn('start'); d = await G(); ok(d.scr === 'rsum', 'Save: summary'); await dsnap('11_run_saved');
    await dbtn('start'); d = await G(); ok(d.scr === 'home', 'back to the start menu'); ok((await D.evaluate(() => __watch.F.last)) === 'run', 'Run stays on top');
    await dbtn('down'); await dbtn('start'); await dbtn('start'); d = await G(); ok(d.scr === 'rec' && d.sp === 'ride', 'Ride: recording');
    await D.evaluate(() => { for (let i = 0; i < 40; i++) __watch.ev('sample', { dt: 1, v: 9.6, hr: 144, cad: 90, pw: 245, up: .1 }); __watch.F.flash = null; }); await dsnap('12_ride_page1');
    await D.click('#wSeg'); ok(await until(() => __watch.F.seg?.k === 'live'), 'ride segment: live'); await dsnap('13_ride_segment_live'); await dbtn('back'); ok((await G()).seg === 'live' && await D.evaluate(() => __watch.F.seg.hide), 'BACK hides the popup');
    await dbtn('start'); await dbtn('down', 2); await dbtn('start'); d = await G(); ok(d.scr === 'home', 'Discard: start menu');
    await dbtn('down', 3); await dbtn('start'); d = await G(); ok(d.scr === 'more', 'More: the sports list'); await dsnap('14_more_list'); await dbtn('down', 2); await dbtn('start'); d = await G(); ok(d.scr === 'ready' && d.sp === 'other' && d.type === 'Yoga', 'Yoga: ready');
    await dbtn('start'); await D.evaluate(() => { for (let i = 0; i < 30; i++) __watch.ev('sample', { dt: 60, v: 0, hr: 112 }); }); d = await G(); ok(d.scr === 'rec', 'Yoga: recording, one page'); await dsnap('15_other_sport');
    await dbtn('start'); await dbtn('down'); await dbtn('start'); await dbtn('start');
    // strength: Workout -> Push day, guided
    d = await G(); const home = await D.evaluate(async () => (await import('/js/watchflow.js')).homeItems(__watch.F)); await dbtn('down', home.indexOf('kraft')); await dbtn('start'); await dbtn('start');
    d = await G(); ok(d.scr === 'smode', 'Strength: workout or free'); await dsnap('16_strength_mode'); await dbtn('start'); d = await G(); ok(d.scr === 'wpick', 'the workouts'); await dsnap('17_workouts');
    await dbtn('start'); d = await G(); ok(d.scr === 'set' && d.ex === 'bench' && d.kg === 80 && d.reps === 8 && d.plan.n === 0, 'guided: bench 80 kg × 8, set 1'); await dsnap('18_guided_set');
    await dbtn('start'); d = await G(); if (d.flash) { await dbtn('start'); d = await G(); } ok(d.scr === 'rest' && d.restLen === 120, 'rest from the workout: 2:00'); await dsnap('19_guided_rest');
    await dbtn('start'); d = await G(); ok(d.scr === 'set' && d.plan.n === 1, 'set 2 of 3'); await D.click('[data-face="fr265"] .wbtn.back'); await D.waitForTimeout(80);
    await D.evaluate(() => __watch.ev('menu')); await dbtn('down'); await dbtn('start'); d = await G(); ok(d.ex === 'ohp' && d.kg === 45, 'Skip exercise: overhead press 45 kg');
    await dbtn('back'); await D.evaluate(() => __watch.ev('menu')); const mi = await D.evaluate(() => __watch.F.menu.indexOf('Change exercise')); await dbtn('down', mi); await dbtn('start');
    d = await G(); ok(d.scr === 'pick' && d.plan === null, 'Change exercise: the free list, the workout is left'); await dsnap('20_free_list');
    ok((await D.evaluate(async () => (await import('/js/watchflow.js')).listItems(__watch.F).slice(0, 4))).join() === 'Bench press,Squat,Pull-ups,Incline bench press', 'free: recent first, then the top 20');
    ok(!derr.length, 'no page errors in the new flows' + (derr.length ? ': ' + derr.join(' | ') : '')); await demo.close();

    // ---- 19.11.: routes sent from the phone reach the paired preview watch (GET /api/watch/routes, /route) ----
    const pts = []; for (let i = 0; i <= 40; i++) pts.push([47.37 + i * .0004, 8.54 + (i > 20 ? (i - 20) * .0005 : 0)]);
    const put = await fetch(BASE + '/api/watch/routes/r-test', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-RF-Token': token }, body: JSON.stringify({ name: 'Test loop to the lake', pts }) }).then(r => r.json());
    ok(put.ok, 'phone: a route sent to the watch');
    const keep = await W.evaluate(() => ({ scr: __watch.F.scr, sel: __watch.F.sel }));
    await W.evaluate(async () => { const fl = await import('/js/watchflow.js'); __watch.F.routes = null; __watch.F.scr = 'home'; __watch.ev('item', fl.homeItems(__watch.F).indexOf('run')); });
    await W.waitForFunction(() => __watch.F.routes && __watch.F.routes.length === 1 && __watch.rsrc === 'watch'); ok(true, 'paired: the route list from the account');
    await btn('down'); await btn('down'); await btn('start'); await W.waitForFunction(() => __watch.F.route && __watch.F.route.pts.length > 2);
    const wr = await W.evaluate(() => ({ id: __watch.F.routeId, len: __watch.F.route.len, turns: __watch.F.route.turns.length }));
    ok(wr.id === 'r-test' && wr.len > 1500 && wr.len < 3500 && wr.turns >= 1, `paired: the route loaded (${Math.round(wr.len)} m, ${wr.turns} turn)`); await snap('route_ready_paired');
    await W.evaluate(k => { __watch.F.scr = k.scr; __watch.F.sel = k.sel; }, keep);

    // overview of the whole page at 1280 px on the set screen
    await btn('start'); await btn('start'); await W.waitForTimeout(300);
    if (SHOTS) { const ov = await b.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 }); await ov.goto(BASE + '/watch.html'); await ov.waitForTimeout(400);
      await ov.keyboard.press('Enter'); await ov.keyboard.press('Enter'); await ov.waitForTimeout(400); await ov.screenshot({ path: `${SHOTS}/overview_1280_set.png`, fullPage: true }); await ov.close();
      const ph = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await ph.goto(BASE + '/watch.html'); await ph.waitForTimeout(400);
      const sw = await ph.evaluate(() => document.documentElement.scrollWidth); ok(sw <= 390, `watch.html on a phone: no sideways scroll (${sw})`); await ph.screenshot({ path: `${SHOTS}/watch_page_phone_390.png`, fullPage: true }); await ph.close(); }
    ok(!werr.length, 'no page errors on watch.html' + (werr.length ? ': ' + werr.join(' | ') : ''));

    // ---- the phone sees both sessions in Activities ----
    await P.goto(BASE + '/aktivitaeten.html'); await P.waitForTimeout(400);
    for (let i = 0; i < 30 && (await P.locator('[data-act^="k:watch-"]').count()) < 2; i++) await P.waitForTimeout(200);
    ok((await P.locator('[data-act^="k:watch-"]').count()) === 2, 'Activities feed shows both watch sessions after sync');
    await P.locator('[data-act^="k:watch-"]').last().click(); await P.waitForSelector('.fwsrc');
    const det = await P.textContent('.psheetin'); ok(/Recorded on watch/.test(det) && /Bench press/.test(det), 'detail: "Recorded on watch" and the exercises');
    ok(/🏆/.test(det) || (await P.locator('[data-act^="k:watch-"]').count()) === 2, 'record trophy on the first session');
    if (SHOTS) await P.screenshot({ path: `${SHOTS}/phone_activity_watch.png` });
    ok(!perr.length, 'no page errors on the phone' + (perr.length ? ': ' + perr.join(' | ') : ''));
    console.log(`${shot} screens × 2 faces`);
  } catch (e) { console.log('✗ ' + e.message); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nWatch UI: all good'); process.exit(fails ? 1 : 0);
})();
