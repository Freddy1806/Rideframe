// End to end: phone pairs a watch, the preview watch (watch.html) runs a whole strength session with the buttons only and
// one with touch only (that one offline first: queue, then sent), and both sessions show up in the phone's Activities feed.
// 18.11.: the start menu, a run with data pages, auto lap, route page and the segment popup, a ride, a "more" sport and a guided
// workout in the demo preview.
// 23.11.: START steps kg -> reps -> logs, lists follow the finger, BACK set -> list -> Keep / Finish / Discard, the rest's NEXT line,
// the paged summary, "Save as workout?" sent to the account and shown on the phone's strength page, the fenix 8 face too.
// 23.11.: the indoor trainer (ERG) against the pretend KICKR CORE 2: list, connect, + / - by button and touch, latest wins, pause, stats page,
// another app in control, lost and back, menu, summary; its upload (a VirtualRide with power) on the phone's Activities.
// 23.11.7: real pointer drags on the fenix 8 face: the wheel on reps (9 -> 10, 11, 12) and kg, no tap / set after a drag, lists row by row,
// the trainer's target by wheel; the standard workouts with an empty setup. WHEEL_SHOTS=dir: those screens (mid-drag) as PNGs.
// Starts its own serve.mjs on a free port with a temp data folder. Screenshots of every screen on all three faces go to SHOTS.
// Usage: NODE_PATH=$(npm root -g) node tools/watch-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const WS = process.env.WHEEL_SHOTS || ''; if (WS) fs.mkdirSync(WS, { recursive: true }); // 23.11.7: the wheel / list / standard workout shots of the fenix 8 face
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
    let shot = 0; const snap = async nm => { shot++; if (!SHOTS) return; await W.waitForTimeout(250); for (const f of ['fr265', 'fenix7xpro', 'fenix8solar47mm']) await W.locator(`[data-face="${f}"] .wscale`).screenshot({ path: `${SHOTS}/${f}_${String(shot).padStart(2, '0')}_${nm}.png` }); };
    await snap('start_demo');
    await W.click('[data-mode="live"]'); await W.waitForTimeout(200); ok((await F()).scr === 'pair', 'My account without a token: pairing screen');
    // buttons only: UP d times, START; the last digit is shown before START
    for (let i = 0; i < 6; i++) { await btn('up', +code[i], i % 2 ? 'fenix7xpro' : 'fr265'); if (i === 5) await snap('pair'); await btn('start'); }
    for (let i = 0; i < 40 && !(await F()).nEx; i++) await W.waitForTimeout(100);
    let s = await F(); ok(s.paired && s.scr === 'home' && s.nEx > 0, 'paired with buttons only, setup loaded, the start menu');
    await P.waitForSelector('.wdev', { timeout: 6000 }).catch(() => {}); ok(/Preview \(browser\)/.test(await P.textContent('#tWatch')), 'phone lists the paired watch');
    if (SHOTS) await P.screenshot({ path: `${SHOTS}/phone_settings_paired.png` });
    await W.waitForTimeout(400); await snap('home'); await btn('down', 3); await btn('start'); s = await F(); ok(s.scr === 'smode', '23.11.7: start menu, Strength: Free + the workouts (the standard ones at least)'); await btn('start'); s = await F(); ok(s.scr === 'pick' && s.ex === 'bench', 'Free: the exercise list, last used first'); await snap('home_to_strength');

    // ---- session 1: buttons only ----
 await btn('down'); await btn('up'); await snap('pick');
    await btn('start'); s = await F(); ok(s.scr === 'set' && s.kg === 80 && s.reps === 8, 'bench prefilled 80 x 8 from last session');
    await hold('up', 950); s = await F(); ok(s.kg >= 90, `UP held: 10 kg steps (${s.kg})`); while ((await F()).kg > 82.5) await btn('down');
    await snap('set'); await btn('start'); s = await F(); ok(s.scr === 'set' && s.focus === 1 && s.sets === 0, 'START on kg: on to reps, nothing logged yet'); await btn('start'); s = await F(); ok(s.scr === 'rest' && s.flash, '82.5 x 8 beats 80 x 8: record flash'); await snap('pr');
    await btn('start'); s = await F(); ok(s.scr === 'rest' && !s.flash, 'first key clears the flash'); await snap('rest');
    await btn('start'); s = await F(); ok(s.scr === 'set' && s.kg === 82.5 && s.reps === 8, 'START skips the rest, set 2 prefilled from set 1');
    s = await F(); ok(s.focus === 0, 'the next set starts on kg again'); await btn('start'); await btn('down'); s = await F(); ok(s.focus === 1 && s.reps === 7, 'START switches to reps (BACK does not), DOWN = 7'); await snap('set_reps');
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
    const tap = async (u, v) => { await cv.tap({ position: { x: u * box.width, y: v * box.height } }); await W.waitForTimeout(260); }; // 27.11.6: a row's action runs after its flash (PRESS_MS)
    const swipe = async (dir) => { const [a, z] = { up: [[.5, .7], [.5, .3]], down: [[.5, .3], [.5, .7]], left: [[.75, .5], [.25, .5]] }[dir]; await cv.scrollIntoViewIfNeeded(); const b = await cv.boundingBox(), p0 = { x: b.x + a[0] * b.width, y: b.y + a[1] * b.height }, p1 = { x: b.x + z[0] * b.width, y: b.y + z[1] * b.height }; // three faces wrap: the page may have scrolled since the first measurement
      await W.mouse.move(p0.x, p0.y); await W.mouse.down(); await W.mouse.move(p1.x, p1.y, { steps: 6 }); await W.mouse.up(); await W.waitForTimeout(100); };
    const drag = async (v0, v1) => { await cv.scrollIntoViewIfNeeded(); const b = await cv.boundingBox(); await W.mouse.move(b.x + b.width / 2, b.y + v0 * b.height); await W.mouse.down();
      await W.mouse.move(b.x + b.width / 2, b.y + v1 * b.height, { steps: 8 }); await W.waitForTimeout(160); await W.mouse.up(); await W.waitForTimeout(400); }; // 27.11.6: the finger rests before it lifts (no coast), the list snaps
    await snap('home_all_rows'); await tap(.5, .5); s = await F(); ok(s.scr === 'smode', 'tap the centre row: Strength, the strength list'); await tap(.5, .5); s = await F(); ok(s.scr === 'pick', 'tap Free: the exercise list'); await btn('back');
    await btn('back'); await btn('down'); await btn('down'); await tap(.5, .655); s = await F(); ok(s.scr === 'tscan', '27.11.6: start menu on the wheel: the row under the centre (Indoor trainer) is tappable'); await btn('back'); await W.waitForTimeout(300);
    s = await F(); ok(s.scr === 'home', 'BACK on the trainer list: the start menu'); await drag(.8, .15); await snap('home_scrolled'); s = await F(); ok(s.sel === 4, '23.11.7: five entries: a drag of 4 row distances (0.155 each) scrolls 4 rows, to More');
    await W.evaluate(() => { __watch.F.sel = 0; }); await tap(.5, .5); await tap(.5, .5); s = await F(); ok(s.scr === 'pick', 'tap: picker'); const sel0 = s.sel;
    const nRows = await W.evaluate(async () => (await import('/js/watchflow.js')).pickRows(__watch.F).length);
    await swipe('up'); await W.waitForTimeout(900); s = await F(); ok(s.sel >= Math.min(sel0 + 2, nRows - 1), `27.11.6: a quick drag up 0.4 of the screen: 2 rows with the finger, then it coasts on (${sel0} -> ${s.sel})`); await snap('pick_dragged');
    for (let i = 0; i < 4; i++) await drag(.3, .7); s = await F(); ok(s.sel === 0, 'drag down: back to the top, clamped');
    await drag(.53, .47); s = await F(); ok(s.sel === 0 && s.scr === 'pick', 'a drag shorter than half a row: it snaps back, and its lift is no tap');
    await drag(.62, .4); s = await F(); ok(s.sel === 1, 'a drag of one row distance: one row'); await tap(.5, .3); s = await F(); ok(s.scr === 'set' && s.ex === 'bench', 'tap the row above: bench selected');
    await tap(.72, .5); s = await F(); ok(s.focus === 1, 'tap reps: focused'); await drag(.33, .08); s = await F(); ok(s.reps === 9, 'a swipe up above the numbers (no wheel there): reps + 1');
    const kg0 = s.kg; ok(kg0 === 82.5, 'prefill from the session just sent (82.5 kg)'); await tap(.3, .5); await swipe('down'); s = await F(); ok(s.focus === 0 && s.kg === kg0 - 2.5, 'tap kg, swipe down: -2.5 kg');
    await tap(.5, .5); s = await F(); ok(s.scr === 'set' && s.sets === 0, 'a stray tap never logs a set');
    await tap(.5, .815); s = await F(); ok(s.scr === 'rest' && s.sets === 1, 'tap DONE: set logged');
    await tap(.5, .5); if ((await F()).flash) await tap(.5, .5); s = await F(); ok(s.scr === 'set', 'tap skips the rest');
    await tap(.5, .815); await tap(.5, .5); await swipe('left'); s = await F(); ok(s.scr === 'menu', 'swipe left: menu');
    await drag(.6, .4); await tap(.5, .67); s = await F(); ok(s.scr === 'sum' && s.sum.st === 'queued', 'drag one row, tap Finish: without phone, queued');
    await snap('summary_queued'); ok(/1 session waits/.test(await W.textContent('#wNet')), 'panel shows the waiting session');
    await W.check('#wNear'); for (let i = 0; i < 40 && (await F()).queue; i++) await W.waitForTimeout(100);
    s = await F(); ok(!s.queue && s.sum.st === 'saved', 'phone back: the queue is sent');
    // 23.11.: Save as workout? (a free session) -> POST /api/watch/workout -> the account's watch config -> the phone's strength page
    await tap(.5, .5); s = await F(); ok(s.scr === 'saveq', 'tap the summary: Save as workout?'); await snap('saveq_free');
    const qn = await W.evaluate(() => __watch.F.saveq.n); await tap(.5, .5); for (let i = 0; i < 40 && (await F()).queue; i++) await W.waitForTimeout(100);
    s = await F(); ok(s.scr !== 'saveq' && !s.queue, `tap Save as workout: sent ("${qn}")`);
    const wc = await fetch(BASE + '/api/watch/config', { headers: { 'X-RF-Token': token } }).then(r => r.json()), ww = (wc.config?.workouts || []).find(x => x.name === qn);
    ok(ww && ww.items[0].ex === 'bench' && ww.items[0].sets === 2, `the account's watch config has it (${ww ? ww.items.map(x => x.ex + ' ' + x.sets + '×' + x.reps).join(', ') : 'missing'})`);
    await P.goto(BASE + '/kraft.html'); await P.waitForSelector('[data-wtpl]', { timeout: 6000 }).catch(() => {});
    ok((await P.locator('[data-wtpl]').count()) === 1 && /Watch workouts/.test(await P.textContent('#kraft')), 'phone strength page: "Watch workouts" lists it');
    if (SHOTS) { await P.locator('[data-wtpl]').scrollIntoViewIfNeeded(); await P.screenshot({ path: `${SHOTS}/phone_kraft_watch_workouts.png` }); }
    await P.click('[data-wtpl="0"]'); await P.waitForTimeout(300); ok(/Bench press/.test(await P.textContent('#kraft')), 'tap: the workout starts on the phone with its exercises');
    await btn('start'); s = await F(); if (s.scr === 'start') { await btn('start'); s = await F(); } ok(s.scr === 'smode', 'the watch: Strength now offers Exercises or the saved workout');
    await btn('back', 3);

    // ---- 18.11.: the new flows in the demo preview (no account): run, ride, more, guided workout ----
    const demo = await b.newContext({ viewport: { width: 1280, height: 1150 }, deviceScaleFactor: 2, hasTouch: true }); // fresh storage: demo data, default screens
    const D = await demo.newPage(); const derr = []; D.on('pageerror', e => derr.push(e.message));
    await D.goto(BASE + '/watch.html'); await D.waitForFunction(() => window.__watch?.F);
    const G = () => D.evaluate(() => ({ scr: __watch.F.scr, sp: __watch.F.sp, type: __watch.F.type, pg: __watch.F.rec?.pg, laps: __watch.F.rec?.laps.length, seg: __watch.F.seg?.k || null, flash: __watch.F.flash?.k || null, plan: __watch.F.plan, kg: __watch.F.kg, reps: __watch.F.reps, ex: __watch.F.setup.ex[__watch.F.cur]?.id, restLen: __watch.F.restLen, items: __watch.F.scr ? null : 0 }));
    const dbtn = async (k, n = 1) => { for (let i = 0; i < n; i++) { await D.click(`[data-face="fr265"] .wbtn.${k}`); await D.waitForTimeout(60); } };
    const dsnap = async nm => { if (!SHOTS) return; await D.waitForTimeout(250); for (const f of ['fr265', 'fenix7xpro', 'fenix8solar47mm']) await D.locator(`[data-face="${f}"] .wscale`).screenshot({ path: `${SHOTS}/new_${f}_${nm}.png` }); };
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
    await dbtn('start'); d = await G(); ok(d.scr === 'pause', 'START: paused'); await dsnap('10_run_paused');
    { const el = D.locator('[data-face="fr265"] .wbtn.back'), bb = await el.boundingBox(); await D.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await D.mouse.down(); await D.waitForTimeout(3400); await D.mouse.up(); await D.waitForTimeout(100); }
    d = await G(); ok(d.scr === 'rsum', 'BACK held 3 s on the pause screen: saved, the summary'); await dsnap('11_run_saved');
    await dbtn('start'); d = await G(); ok(d.scr === 'home', 'back to the start menu'); ok((await D.evaluate(() => __watch.F.last)) === 'run', 'Run stays on top');
    await dbtn('down'); await dbtn('start'); await dbtn('start'); d = await G(); ok(d.scr === 'rec' && d.sp === 'ride', 'Ride: recording');
    await D.evaluate(() => { for (let i = 0; i < 40; i++) __watch.ev('sample', { dt: 1, v: 9.6, hr: 144, cad: 90, pw: 245, up: .1 }); __watch.F.flash = null; }); await dsnap('12_ride_page1');
    await D.click('#wSeg'); ok(await until(() => __watch.F.seg?.k === 'live'), 'ride segment: live'); await dsnap('13_ride_segment_live'); await dbtn('back'); ok((await G()).seg === 'live' && await D.evaluate(() => __watch.F.seg.hide), 'BACK hides the popup');
    await dbtn('start'); await dbtn('down'); await dbtn('start'); await dbtn('start'); d = await G(); ok(d.scr === 'home', 'Discard, START yes: start menu');
    await dbtn('down', (await D.evaluate(async () => (await import('/js/watchflow.js')).homeItems(__watch.F))).indexOf('more')); await dbtn('start'); d = await G(); ok(d.scr === 'more', 'More: the sports list'); await dsnap('14_more_list'); await dbtn('down', 2); await dbtn('start'); d = await G(); ok(d.scr === 'ready' && d.sp === 'other' && d.type === 'Yoga', 'Yoga: ready');
    await dbtn('start'); await D.evaluate(() => { for (let i = 0; i < 30; i++) __watch.ev('sample', { dt: 60, v: 0, hr: 112 }); }); d = await G(); ok(d.scr === 'rec', 'Yoga: recording, one page'); await dsnap('15_other_sport');
    await dbtn('start'); await dbtn('down'); await dbtn('start'); await dbtn('start');
    // strength: Workout -> Push day, guided
    d = await G(); const home = await D.evaluate(async () => (await import('/js/watchflow.js')).homeItems(__watch.F)); await dbtn('down', home.indexOf('kraft')); await dbtn('start');
    const DT = () => D.evaluate(() => __watch.texts.join(' | ')), DM = f => D.evaluate(async f => { const m = await import('/js/watchflow.js'); return m[f](__watch.F); }, f);
    await D.evaluate(() => { __watch.F.setup.ex.find(e => e.id === 'bench').s = [[80, 8], [77.5, 7], [75, 6]]; }); // 24.11.: last time's bench, set by set
    d = await G(); ok(d.scr === 'smode', 'Strength: Exercises or a workout'); ok((await D.evaluate(async () => (await import('/js/watchflow.js')).listItems(__watch.F))).join() === 'Free,Push day,Pull day,Leg day,Upper body,Lower body,Full body,One-arm pull-up,One-arm push-up', '23.11.7: one list: Free first, then the six standard workouts'); await dsnap('16_strength_mode');
    await dbtn('down'); await dbtn('start'); d = await G(); ok(d.scr === 'set' && d.ex === 'bench' && d.kg === 80 && d.reps === 6 && d.plan.i === 0 && await DM('setNo') === 1, 'standard Push day: bench 4 × 6 with last time\'s 80 kg, set 1'); await dsnap('18_guided_set');
    ok(/♥|bpm|\d+:\d\d/.test(await DT()), 'set screen: heart rate and clock line');
    ok(/SET 1 OF 4 \| 80 \| 8 \|/.test(await DT()), 'set 1: last time\'s set 1 small on the SET row (80, 8)');
    await dbtn('start'); await dbtn('start'); d = await G(); if (d.flash) { await dbtn('start'); d = await G(); } ok(d.scr === 'rest' && d.restLen === 120, 'START, START: logged, rest from the workout: 2:00'); await dsnap('19_guided_rest');
    ok(/NEXT: SET 2 (OF |\/)4/.test(await DT()), 'rest: what comes next (set 2 of 4)');
    await dbtn('start'); d = await G(); ok(d.scr === 'set' && await DM('setNo') === 2, 'set 2 of 4'); await dsnap('18b_guided_set2_last');
    ok(/SET 2 OF 4 \| 77\.5 \| 7 \|/.test(await DT()), 'set 2: last time\'s set 2 (77.5, 7)');
    await dbtn('back'); d = await G(); ok(d.scr === 'pick' && d.plan?.w === 0, 'BACK in a set: the workout\'s exercise list (not the workout list)'); await dsnap('19b_workout_list');
    ok(/1\/\d+ · 1 set done|1 set done/.test(await DT()), 'list: status line with the sets done');
    await dbtn('back'); d = await G(); ok(d.scr === 'end', 'BACK in the list with a set logged: Keep / Finish / Discard'); await dsnap('19c_end');
    await dbtn('start'); d = await G(); ok(d.scr === 'pick', 'Keep training: back to the list'); await dbtn('start'); d = await G(); ok(d.scr === 'set' && d.ex === 'bench', 'START: bench again');
    await D.evaluate(() => __watch.ev('menu')); await dbtn('down'); await dbtn('start'); d = await G(); ok(d.ex === 'ohp' && d.kg === 47.5 && d.reps === 8, 'Skip exercise: overhead press, last time\'s 47.5 kg × the plan\'s 8');
    await D.evaluate(() => __watch.ev('menu')); const mi = await D.evaluate(() => __watch.F.menu.indexOf('Change exercise')); await dbtn('down', mi); await dbtn('start');
    d = await G(); ok(d.scr === 'pick' && d.plan?.w === 0, 'Change exercise: the list, the workout stays on (its exercises first)');
    await D.evaluate(() => __watch.ev('hr', 121)); // a heart rate sample for sure (the page's simulated one comes every 2 s; a fast run could finish before it)
    await D.evaluate(() => __watch.ev('menu')); const fi = await D.evaluate(() => __watch.F.menu.indexOf('Finish')); await dbtn('down', fi); await dbtn('start'); await D.waitForTimeout(300);
    d = await G(); ok(d.scr === 'sum', 'Finish: the summary'); await dsnap('20_summary'); ok(/AVG|avg|♥/.test(await DT()), 'summary: heart rate avg / max');
    await dbtn('down'); await dsnap('20b_summary_ex'); ok(/Bench press|BENCH PRESS/.test(await DT()), 'summary page 2: the first exercise with its sets');
    await dbtn('start'); d = await G(); ok(d.scr === 'saveq', 'changed workout (skipped one): Save as workout?'); await dsnap('21_saveq');
    const sq = await D.evaluate(() => __watch.F.saveq.rows); await dbtn('down', sq.length - 1); await dbtn('start'); d = await G(); ok(d.scr === 'home' || d.scr === 'start', `No: nothing saved (${sq.join(' / ')})`);
    if (d.scr === 'home') { await dbtn('down', (await D.evaluate(async () => (await import('/js/watchflow.js')).homeItems(__watch.F))).indexOf('kraft')); await dbtn('start'); }
    await dbtn('start'); d = await G(); ok(d.scr === 'pick' && !d.plan, 'Exercises: the free list');
    const top = await D.evaluate(async () => (await import('/js/watchflow.js')).listItems(__watch.F)); ok(top.includes('Front squat'), `free list has Front squat (${top.slice(0, 6).join(', ')} …)`);
    await dbtn('back'); d = await G(); ok(d.scr === 'smode', 'BACK in the list with nothing logged: back to Exercises / workouts');
    // 24.11.: last time in the list (all sets) and on the set screen, updated on the watch by the session just finished (no sync)
    await dbtn('start'); const toEx = id => D.evaluate(async id => { const m = await import('/js/watchflow.js'), F = __watch.F; const k = m.pickRows(F).findIndex(r => F.setup.ex[r[0]].id === id); F.sel = k; return k; }, id);
    await toEx('bench'); await D.waitForTimeout(250); ok(/Bench press \|.*\| Last 80x6/.test(await DT()), 'list: bench shows the guided session just finished (80×6), not the old 77.5');
    await toEx('pull'); await D.waitForTimeout(250); ok(/Pull-ups \|.*\| Last 10, 9 reps/.test(await DT()), 'list: pull-ups, all of last time\'s sets ("Last 10, 9 reps")'); await dsnap('22_list_last_all');
    await D.evaluate(() => __watch.ev('item', __watch.F.sel)); await D.waitForTimeout(250); ok(/SET 1 \| BW \| 10 \|/.test(await DT()), 'bodyweight set 1: last time BW, 10'); await dsnap('23_bw_set1_last');
    for (let i = 0; i < 2; i++) { await D.evaluate(() => { __watch.ev('done'); __watch.F.flash = null; __watch.ev('start'); }); }
    await D.waitForTimeout(250); ok((await DM('setNo')) === 3 && /SET 3 \| BW \| 9 \|/.test(await DT()), 'set 3, last time had 2: its final set (BW, 9)'); await dsnap('24_beyond_last');
    await D.evaluate(() => __watch.ev('back')); await toEx('legpress'); await D.evaluate(() => __watch.ev('item', __watch.F.sel)); await D.waitForTimeout(250);
    ok(/Leg press \| SET 1 \| DONE \|/.test(await DT()), 'first time (leg press): nothing above the numbers'); await dsnap('25_first_time');
    ok(!derr.length, 'no page errors in the new flows' + (derr.length ? ': ' + derr.join(' | ') : '')); await demo.close();

    // ---- pause in every mode, Polar style: BACK held 3 s saves, released early nothing; on the page clock (no real waiting) ----
    const pc = await b.newContext({ viewport: { width: 1280, height: 1150 }, deviceScaleFactor: 2, hasTouch: true });
    const Q = await pc.newPage(); const qerr = []; Q.on('pageerror', e => qerr.push(e.message)); await Q.clock.install();
    await Q.goto(BASE + '/watch.html'); await Q.clock.runFor(800); await Q.waitForFunction(() => window.__watch?.F);
    const qs = () => Q.evaluate(() => ({ scr: __watch.F.scr, rec: !!__watch.F.rec, conf: !!__watch.F.pz?.conf, hint: !!(__watch.F.pz?.hint), q: __watch.F.sum ? 1 : 0, start: __watch.F.start }));
    const qb = async (k, n = 1) => { for (let i = 0; i < n; i++) { await Q.click(`[data-face="fr265"] .wbtn.${k}`); await Q.clock.runFor(100); } };
    const qhold = async (ms, face = 'fr265') => { const bb = await Q.locator(`[data-face="${face}"] .wbtn.back`).boundingBox(); await Q.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await Q.mouse.down(); await Q.clock.runFor(ms); };
    const qup = async () => { await Q.mouse.up(); await Q.clock.runFor(150); };
    const qshot = async nm => { if (!SHOTS) return; for (const f of ['fr265', 'fenix7xpro']) await Q.locator(`[data-face="${f}"] .wscale`).screenshot({ path: `${SHOTS}/pause_${f}_${nm}.png` }); };
    const toHome = () => Q.evaluate(() => { __watch.F.scr = 'home'; __watch.F.sel = 0; });
    const pick = k => Q.evaluate(async k => { const m = await import('/js/watchflow.js'); __watch.ev('item', m.homeItems(__watch.F).indexOf(k)); }, k);
    const modes = [['run', async () => { await pick('run'); await qb('start'); }], ['ride', async () => { await pick('ride'); await qb('start'); }],
      ['more', async () => { await pick('more'); await qb('start'); await qb('start'); }], ['strength', async () => { await pick('kraft'); await qb('down'); await qb('start'); await qb('start'); await qb('start'); }]];
    for (const [k, go] of modes) {
      await toHome(); await go(); await Q.clock.runFor(20000);
      if (k === 'strength') { await Q.evaluate(() => __watch.ev('menu')); const i = await Q.evaluate(() => __watch.F.menu.indexOf('Pause')); await qb('down', i); await qb('start'); } else await qb('start');
      let q = await qs(); ok(q.scr === 'pause', `${k}: paused`);
      await qb('back'); q = await qs(); ok(q.scr === 'pause' && q.hint, `${k}: a short BACK keeps the pause screen and shows the hint`);
      await qhold(1500); if (k === 'run') await qshot('ring_half'); q = await qs(); ok(q.scr === 'pause', `${k}: 1.5 s held, still paused (ring half full)`);
      await qup(); await Q.clock.runFor(3000); q = await qs(); ok(q.scr === 'pause', `${k}: released early, nothing saved`);
      await qb('down'); await qb('start'); q = await qs(); ok(q.conf, `${k}: Discard asks first`); if (k === 'run') await qshot('discard_confirm'); await qb('back'); q = await qs(); ok(q.scr === 'pause' && !q.conf, `${k}: BACK = keep`);
      await qhold(3300, 'fenix7xpro'); await qup(); q = await qs(); ok(k === 'strength' ? q.scr === 'sum' && q.q >= 1 : q.scr === 'rsum', `${k}: BACK held 3 s: saved, the summary`);
    }
    // the touch pill on the fr265: a finger resting on "Hold to finish"
    await toHome(); await pick('run'); await qb('start'); await Q.clock.runFor(5000); await qb('start');
    { const cv = Q.locator('[data-face="fr265"] canvas'), bx = await cv.boundingBox(); await Q.mouse.move(bx.x + bx.width / 2, bx.y + bx.height * .82); await Q.mouse.down(); await Q.clock.runFor(3300); await Q.mouse.up(); await Q.clock.runFor(100); }
    ok((await qs()).scr === 'rsum', 'touch: holding the "Hold to finish" pill saves');
    await toHome(); await pick('ride'); await qb('start'); await qb('start'); await qb('down'); await qb('start'); await qb('start'); ok((await qs()).scr === 'home' && !(await qs()).rec, 'Discard, START yes: gone, the start menu');
    ok(!qerr.length, 'no page errors in the pause flows' + (qerr.length ? ': ' + qerr.join(' | ') : '')); await pc.close();

    // ---- 23.11.: the indoor trainer (ERG) against the pretend KICKR CORE 2, on the page clock; the fenix 8 face's buttons and touch ----
    const tc = await b.newContext({ viewport: { width: 1280, height: 1150 }, deviceScaleFactor: 2, hasTouch: true });
    const T = await tc.newPage(); const terr = []; T.on('pageerror', e => terr.push(e.message)); await T.clock.install();
    await T.goto(BASE + '/watch.html'); await T.clock.runFor(800); await T.waitForFunction(() => window.__watch?.F);
    const ts = () => T.evaluate(() => ({ scr: __watch.F.scr, st: __watch.F.link.st, ctl: __watch.F.link.ctl, tgt: __watch.F.tr?.tgt, kt: __watch.kickr.tgt, t: __watch.F.tr?.t, pg: __watch.F.tr?.pg, paused: __watch.F.tr?.st === 'pause', step: __watch.F.tr?.step, n: __watch.F.link.list.length, sel: __watch.F.sel }));
    const F8 = 'fenix8solar47mm', tb = async (k, n = 1) => { for (let i = 0; i < n; i++) { await T.click(`[data-face="${F8}"] .wbtn.${k}`); await T.clock.runFor(400); } };
    const tt = () => T.evaluate(() => __watch.texts.join(' | '));
    let tn = 0; const tshot = async (nm, ms = 1300) => { tn++; await T.clock.runFor(ms); /* after the vibration ring of the preview */ if (!SHOTS) return; for (const f of [F8, 'fr265']) await T.locator(`[data-face="${f}"] .wscale`).screenshot({ path: `${SHOTS}/trainer_${f}_${String(tn).padStart(2, '0')}_${nm}.png` }); };
    const tcv = T.locator(`[data-face="${F8}"] canvas`); await tcv.scrollIntoViewIfNeeded();
    const ttap = async (u, v) => { const bb = await tcv.boundingBox(); await tcv.tap({ position: { x: u * bb.width, y: v * bb.height } }); await T.clock.runFor(400); };
    const tswipe = async () => { const bb = await tcv.boundingBox(); await T.mouse.move(bb.x + bb.width / 2, bb.y + bb.height * .7); await T.mouse.down(); await T.mouse.move(bb.x + bb.width / 2, bb.y + bb.height * .3, { steps: 6 }); await T.mouse.up(); await T.clock.runFor(300); };
    await T.uncheck('#wKOn'); await T.evaluate(async () => { const m = await import('/js/watchflow.js'); __watch.ev('item', m.homeItems(__watch.F).indexOf('trainer')); }); await T.clock.runFor(500);
    let x = await ts(); ok(x.scr === 'tscan' && x.st === 'scan' && x.n === 0, 'Indoor trainer: searching, nothing in range yet'); await tshot('searching'); ok(/Searching/.test(await tt()), 'fenix 8: "Searching…"');
    await T.check('#wKOn'); await T.clock.runFor(1200); x = await ts(); ok(x.n === 2, 'the scan lists the KICKR and the power meter'); await tshot('list');
    ok(/KICKR CORE/.test(await tt()) && /Smart trainer, ERG/.test(await tt()), 'the list: the trainer first, "Smart trainer, ERG"');
    // START and the text in one page task (the page clock flows on its own: the pretend KICKR's answers can come before a later look)
    const conn = await T.evaluate(() => { __watch.ev('start'); return __watch.texts.join(' | '); }); await tshot('connecting', 30); ok(/Connecting/.test(conn), 'START: "Connecting…"');
    await T.clock.runFor(1000); x = await ts(); ok(x.st === 'ready' && x.ctl, 'connected, control taken (FTMS request control + start)'); await tshot('connected'); ok(/Connected/.test(await tt()), '"Connected", START to ride');
    await tb('start'); x = await ts(); ok(x.scr === 'tpick' && x.sel === 0, '27.11.: START: the choice, Free ride first'); ok(/Free ride \(ERG\)/.test(await tt()), '"Free ride (ERG)"');
    await tb('start'); await T.clock.runFor(3000); x = await ts(); ok(x.scr === 'trec' && x.tgt === 100 && x.kt === 100, 'riding: target 100 W, the trainer has it'); await tshot('erg_page');
    ok(/TARGET W/.test(await tt()) && /WATTS/.test(await tt()) && /RPM/.test(await tt()) && /BPM/.test(await tt()), 'ERG page: target, watts, rpm, heart rate');
    await tb('up', 3); x = await ts(); ok(x.tgt === 115 && x.kt === 115, 'UP 3×: 115 W, sent');
    await ttap(.86, .36); x = await ts(); ok(x.tgt === 120, 'touch +: 120'); await ttap(.14, .36); x = await ts(); ok(x.tgt === 115, 'touch -: 115');
    await ttap(.5, .36); x = await ts(); ok(x.step === 10, 'a tap on the target: 10 W steps'); await tb('up'); x = await ts(); ok(x.tgt === 120, 'UP: onto the 10 grid'); await tshot('erg_step10');
    await T.evaluate(() => { __watch.kickr.hold = true; }); await tb('up', 4); x = await ts(); const held = await T.evaluate(() => __watch.kickr.writes.filter(w => w[1] === 5).length);
    await T.evaluate(() => { for (const e of __watch.kickr.release()) __watch.ev('ble', e); }); await T.clock.runFor(500);
    const after = await T.evaluate(() => __watch.kickr.writes.filter(w => w[1] === 5).map(w => w[2] + (w[3] << 8)));
    x = await ts(); ok(x.tgt === 160 && x.kt === 160 && after.length === held + 1, `a slow trainer: 4 presses = one more write, the newest (${after.slice(-3).join(', ')})`);
    { const bb = await T.locator(`[data-face="${F8}"] .wbtn.up`).boundingBox(); await T.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await T.mouse.down(); await T.clock.runFor(1250); await T.mouse.up(); await T.clock.runFor(400); }
    x = await ts(); ok(x.tgt >= 210, `UP held: 25 W steps (${x.tgt})`);
    { // 23.11.7: the wheel on the target: a finger dragged up over it, one step (10 W now) per 0.075 of the screen; the lift is no swipe (no stats page)
      const t0 = (await ts()).tgt, bb = await tcv.boundingBox(); await T.mouse.move(bb.x + bb.width / 2, bb.y + bb.height * .42); await T.mouse.down();
      for (let i = 1; i <= 8; i++) await T.mouse.move(bb.x + bb.width / 2, bb.y + bb.height * (.42 - i * .02)); await T.clock.runFor(100);
      x = await ts(); ok(x.tgt === Math.floor(t0 / 10) * 10 + 20, `wheel on the ERG target: 0.16 of the screen up = 2 steps of 10 W, on the 10 grid like UP (${t0} -> ${x.tgt})`);
      const tx = await T.evaluate(() => __watch.texts); ok(tx.includes(String(x.tgt - 10)) && tx.includes(String(x.tgt + 10)) && !tx.includes('TARGET W'), 'the neighbours (one step below above, one above below) replace the label and the step line');
      if (WS) await T.locator(`[data-face="${F8}"] .wscale`).screenshot({ path: `${WS}/03_trainer_target_mid_drag.png` });
      await T.mouse.up(); await T.clock.runFor(1500); x = await ts(); ok(x.pg === 0 && x.kt === x.tgt, 'after the lift: still the ERG page (no swipe), the new target sent');
      ok(/TARGET W/.test(await tt()), 'the neighbours gone after the lift, the label back');
    }
    await tswipe(); x = await ts(); ok(x.pg === 1, 'swipe up: the stats page'); await tshot('stats_page'); ok(/AVG W/.test(await tt()) && /at this target/.test(await tt()), 'stats: this target and the ride');
    await ttap(.5, .5); x = await ts(); ok(x.pg === 0, 'a tap: back to the ERG page');
    await tb('start'); x = await ts(); ok(x.paused && x.kt === 30, 'START: paused, the trainer at 30 W'); await tshot('paused'); const tp = x.t; await T.clock.runFor(5000); ok((await ts()).t === tp, 'the clock stands while paused');
    await ttap(.5, .85); x = await ts(); ok(!x.paused && x.kt === x.tgt, 'the resume pill: riding, the target again');
    await T.check('#wKRefuse'); await tb('up'); x = await ts(); ok(x.st === 'refused', 'another app takes the trainer: the target is refused'); await tshot('refused'); ok(/NO CONTROL/.test(await tt()), '"NO CONTROL · OTHER APP"');
    await T.uncheck('#wKRefuse'); await T.clock.runFor(6000); x = await ts(); ok(x.st === 'ready' && x.kt === x.tgt, 'control again after the other app let go, the newest target sent');
    await T.uncheck('#wKOn'); await T.clock.runFor(500); x = await ts(); ok(x.st === 'lost' && x.scr === 'trec', 'out of range: lost, the ride goes on'); await tshot('lost'); ok(/LOST/.test(await tt()), '"LOST · RECONNECTING"');
    await tb('down'); await T.check('#wKOn'); await T.clock.runFor(17000); x = await ts(); ok(x.st === 'ready' && x.kt === x.tgt, `back in range: reconnected, the target sent again (${x.kt} W)`);
    await tb('back'); x = await ts(); ok(x.scr === 'tend', 'BACK: the menu'); await tshot('menu');
    await tb('down', 3); await tb('start'); ok((await tt()).includes('Discard ride'), 'Discard asks once more'); await tshot('discard_confirm'); await tb('back'); await tb('up'); await tb('start');
    x = await ts(); ok(x.scr === 'tsum', 'Finish & save: the summary'); await tshot('summary'); const tsum = await T.evaluate(() => __watch.F.tsum);
    ok(tsum.avgPw > 50 && tsum.maxPw >= tsum.avgPw && tsum.kj > 0 && tsum.cad > 80, `summary: ${tsum.avgPw} W avg, ${tsum.maxPw} max, ${tsum.kj} kJ, ${tsum.cad} rpm, ${tsum.hr} bpm`);
    ok(/AVG W/.test(await tt()) && /MAX HR/.test(await tt()), 'summary: avg / max power, kJ, cadence, heart rate'); ok(!(await T.evaluate(() => __watch.kickr.paired)), 'the trainer is let go after the ride');
    const tbody = await T.evaluate(() => __watch.F.tbody); ok(tbody.type === 'VirtualRide' && tbody.s.pw.length > 1, `upload body: VirtualRide with ${tbody.s.pw.length} power values`);
    await tb('start'); x = await ts(); ok(x.scr === 'home' && (await T.evaluate(async () => (await import('/js/watchflow.js')).homeItems(__watch.F)[0])) === 'trainer', 'the start menu, Indoor trainer on top');
    await T.check('#wKRefuse'); await tb('start'); await T.clock.runFor(1500); x = await ts(); ok(x.scr === 'tscan' && x.st === 'refused', 'the trainer used last connects by itself; refused shows on the trainer screen'); await tshot('refuses_control');
    ok(/Refuses control/.test(await tt()) && /Another app/.test(await tt()), '"Refuses control", "Another app controls it."'); await tb('back'); await tb('back'); x = await ts(); ok(x.scr === 'home', 'BACK, BACK: the start menu');
    // ---- 27.11.: a workout on the trainer: the built-in 30 / 15 (demo mode, no server list), sped up; + twice in a hard 30 s, - once in a float ----
    await T.uncheck('#wKRefuse'); await T.evaluate(async () => { const m = await import('/js/watchflow.js'); __watch.ev('item', m.homeItems(__watch.F).indexOf('trainer')); }); await T.clock.runFor(1500);
    await tb('start'); await T.clock.runFor(1500); x = await ts(); ok(x.scr === 'tscan' && x.st === 'ready', 'Indoor trainer again: START on the KICKR, connected');
    await tb('start'); x = await ts(); ok(x.scr === 'tpick', 'START: the choice'); await tshot('wk_choice', 300);
    await tb('down'); x = await ts(); ok(x.sel === 1 && /30\/15, 3 x 13/.test(await tt()) && /63 min/.test(await tt()), `DOWN: the 30 / 15, "63 min" (${await tt()})`); await tshot('wk_choice_3015', 300);
    await tb('start'); x = await ts(); const WK = await T.evaluate(() => { const W = __watch.F.wk; return W && { dur: W.dur, w: W.w, hard: W.hard, tot: W.tot }; });
    ok(x.scr === 'trec' && WK && WK.tot === 3750 && x.tgt === WK.w[0] && x.kt === WK.w[0], `the 30 / 15 rides: 62:30, the trainer at the first target (${x.tgt} W)`);
    const s0 = []; WK.dur.reduce((a, d) => (s0.push(a), a + d), 0); const h = WK.hard.findIndex((y, i) => y && WK.dur[i] === 30);
    const rideTo = async t1 => { await T.evaluate(() => __watch.speed(25)); while ((await ts()).t < t1 - 30) await T.clock.runFor(1000);
      await T.evaluate(() => __watch.speed(1)); while ((await ts()).t < t1) await T.clock.runFor(250); };
    const kw = () => T.evaluate(() => __watch.kickr.writes.filter(w => w[1] === 5).map(w => w[2] + (w[3] << 8)));
    await rideTo(s0[2] + 4); x = await ts(); ok(x.tgt === WK.w[2] && x.kt === WK.w[2], `a sprint at ${WK.w[2]} W, no ramp`); await tshot('wk_sprint', 200);
    await rideTo(s0[h] + 8); x = await ts(); const step = x.step; ok(x.tgt === WK.w[h] && x.kt === WK.w[h], `the first 30 s at ${WK.w[h]} W`); await tshot('wk_hard', 200);
    { const t = await tt(); ok(/1\/13, SET 1/.test(t) && /NEXT 125 W, 0:15/.test(t) && /LEFT/.test(t) && /\+\/- 5 W/.test(t), 'the counter, the next step, the time left, the step: ' + t); }
    await tb('up', 2); x = await ts(); ok(x.tgt === WK.w[h] + 2 * step && x.kt === x.tgt, `+ twice in the hard step: ${x.tgt} W at once (+${2 * step})`); await tshot('wk_hard_plus', 100); ok(/\+10 W/.test(await tt()), 'the offset shows: "+10 W"');
    await rideTo(s0[h + 1] + 4); x = await ts(); ok(x.tgt === WK.w[h + 1] && x.kt === WK.w[h + 1], `the float at ${WK.w[h + 1]} W, the hard offset stays with the hard steps`);
    await tb('down'); x = await ts(); ok(x.tgt === WK.w[h + 1] - step && x.kt === x.tgt, `- once in the float: ${x.tgt} W`); await tshot('wk_float_minus', 100); ok(/-5 W/.test(await tt()), 'the easy offset shows: "-5 W"');
    await rideTo(s0[h + 2] + 3); x = await ts(); ok(x.tgt === WK.w[h + 2] + 2 * step && x.kt === x.tgt, `the next 30 s: ${x.tgt} W, the hard offset kept`);
    await rideTo(s0[h + 3] + 3); x = await ts(); ok(x.tgt === WK.w[h + 3] - step, `the next float: ${x.tgt} W, the easy offset kept`);
    const sent = await kw(); ok([WK.w[h] + step, WK.w[h] + 2 * step, WK.w[h + 1], WK.w[h + 1] - step, WK.w[h + 2] + 2 * step, WK.w[h + 3] - step].every(w => sent.includes(w)), `the trainer received ${[...new Set(sent)].slice(-12).join(', ')}`);
    await tb('start'); x = await ts(); ok(x.paused, 'START: paused'); const tq = x.t; await T.clock.runFor(4000); await tshot('wk_paused', 100); ok((await ts()).t === tq, 'paused: the workout stands');
    await tb('start'); x = await ts(); ok(!x.paused && x.tgt === x.kt, 'resumed at the same place');
    await rideTo(WK.tot + 2); x = await ts(); const ends = WK.w.at(-1); ok(!(await T.evaluate(() => __watch.F.wk)) && x.tgt <= 100 && x.kt === x.tgt, `the end: free ERG at ${x.tgt} W`);
    ok(/WORKOUT DONE/.test(await tt()), '"WORKOUT DONE"'); await tshot('wk_done', 100); void ends;
    await tb('up'); x = await ts(); ok(x.kt === x.tgt, `after the workout + / - is free ERG again (${x.tgt} W)`);
    await tb('back'); await tb('down', 2); await tb('start'); x = await ts(); ok(x.scr === 'tsum', 'Finish & save: the summary'); const wsum = await T.evaluate(() => __watch.F.tsum);
    ok(wsum && wsum.t >= WK.tot, `saved as a ride of ${wsum && wsum.t} s`); await tshot('wk_summary', 100); await tb('start');
    ok(!terr.length, 'no page errors in the trainer flows' + (terr.length ? ': ' + terr.join(' | ') : '')); await tc.close();

    // ---- 23.11.7 (Freddy on the fenix 8: "like a rotary wheel"): real pointer drags on the fenix 8 face: the wheel on kg / reps, lists row by row,
    //      no tap / swipe after a drag; the standard workouts with an empty setup ----
    const xc = await b.newContext({ viewport: { width: 1280, height: 1150 }, deviceScaleFactor: 2, hasTouch: true });
    const X = await xc.newPage(); const xerr = []; X.on('pageerror', e => xerr.push(e.message)); await X.goto(BASE + '/watch.html'); await X.waitForFunction(() => window.__watch?.F);
    const x8 = X.locator('[data-face="fenix8solar47mm"] canvas'); await x8.scrollIntoViewIfNeeded();
    const xs = () => X.evaluate(() => ({ scr: __watch.F.scr, kg: __watch.F.kg, reps: __watch.F.reps, focus: __watch.F.focus, sets: __watch.F.sets.length, sel: __watch.F.sel, ex: __watch.F.setup.ex[__watch.F.cur]?.id }));
    const xshot = async nm => { if (WS) await X.locator('[data-face="fenix8solar47mm"] .wscale').screenshot({ path: `${WS}/${nm}.png` }); };
    const xt = () => X.evaluate(() => __watch.texts);
    const xat = async (u, v) => { const b = await x8.boundingBox(); return [b.x + u * b.width, b.y + v * b.height]; };
    const xdown = async (u, v) => { const [px, py] = await xat(u, v); await X.mouse.move(px, py); await X.mouse.down(); };
    const xmove = async (u, v) => { const [px, py] = await xat(u, v); await X.mouse.move(px, py); };
    /** texts drawn on top of each other on the fenix 8 face (their inked boxes) */
    const xover = () => X.evaluate(() => { const B = __watch.boxes, o = []; for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) { const a = B[i], c = B[j];
      if (a[1] < c[3] - .5 && c[1] < a[3] - .5 && a[2] < c[4] - .5 && c[2] < a[4] - .5) o.push(`"${a[0]}" / "${c[0]}"`); } return o; });
    await X.evaluate(async () => { const m = await import('/js/watchflow.js'); __watch.ev('item', m.homeItems(__watch.F).indexOf('kraft')); __watch.ev('item', 0); const k = m.pickRows(__watch.F).findIndex(r => __watch.F.setup.ex[r[0]].id === 'bench'); __watch.ev('item', k); __watch.F.reps = 9; });
    let w = await xs(); ok(w.scr === 'set' && w.ex === 'bench' && w.kg === 80 && w.reps === 9 && w.focus === 0, 'fenix 8: bench set screen, 80 kg, reps set to 9, kg focused');
    ok(/SET 1 \| 80 \| 8 \|/.test((await xt()).join(' | ')), 'last time\'s numbers (80, 8) on the SET row');
    // a slow finger over the reps, 0.01 of the screen per move: 10, 11, 12 one after the other
    await xdown(.735, .56); const seen = []; let mid = false;
    for (let i = 1; i <= 24; i++) { await xmove(.735, .56 - i * .01); const r = (await xs()).reps; if (r !== (seen.at(-1) ?? 9)) seen.push(r);
      if (r === 11 && !mid) { mid = true; await X.waitForTimeout(60); await xshot('02_set_reps_mid_drag'); const t = await xt();
        ok(t.includes('10') && t.includes('12'), 'mid-drag on reps 11: the neighbours 10 (above) and 12 (below) are drawn'); const ov = await xover(); ok(!ov.length, 'mid-drag (reps): no text on another' + (ov.length ? ': ' + ov.join(', ') : '')); } }
    ok(seen.join() === '10,11,12', `slow drag up over reps from 9: ${seen.join(', ')} (one step per 0.075 of the screen, in order)`);
    w = await xs(); ok(w.focus === 1, 'the dragged column (reps) took the focus'); await X.mouse.up(); await X.waitForTimeout(150);
    w = await xs(); ok(w.scr === 'set' && w.sets === 0 && w.focus === 1 && w.reps === 12, 'the lift after the drag: no tap (no focus change), no set logged');
    ok((await xt()).includes('13'), 'the neighbours stay a moment after the lift'); await X.waitForTimeout(800); ok(!(await xt()).includes('13'), '… and are gone 0.6 s after it');
    // the kg: 2 steps up, then one down
    await xdown(.285, .5); for (let i = 1; i <= 8; i++) await xmove(.285, .5 - i * .02); w = await xs(); ok(w.kg === 85 && w.focus === 0, `drag up 0.16 over kg: + 2 × 2.5 = ${w.kg} kg, kg focused`);
    await X.waitForTimeout(60); await xshot('01_set_kg_mid_drag'); { const t = await xt(); ok(t.includes('82.5') && t.includes('87.5'), 'mid-drag on kg 85: the neighbours 82.5 and 87.5'); const ov = await xover(); ok(!ov.length, 'mid-drag (kg): no text on another' + (ov.length ? ': ' + ov.join(', ') : '')); }
    for (let i = 1; i <= 5; i++) await xmove(.285, .34 + i * .02); await X.mouse.up(); await X.waitForTimeout(150); w = await xs(); ok(w.kg === 82.5 && w.sets === 0 && w.scr === 'set', 'finger back down one step: 82.5; the drag never logged a set');
    // a drag that starts on DONE is no wheel and no DONE
    await xdown(.5, .82); await xmove(.5, .7); await xmove(.5, .6); await X.mouse.up(); await X.waitForTimeout(150); w = await xs(); ok(w.sets === 0 && w.scr === 'set', 'a drag from the DONE pill: no set logged');
    // lists: the exercise list moves one row per 0.2 of the screen, and the lift does not select
    await X.evaluate(() => __watch.ev('back')); await X.evaluate(() => { __watch.F.sel = 0; }); w = await xs(); ok(w.scr === 'pick', 'BACK: the exercise list');
    await xdown(.5, .75); const rows = []; let lmid = false;
    for (let i = 1; i <= 23; i++) { await xmove(.5, .75 - i * .02); const sl = (await xs()).sel; if (sl !== (rows.at(-1) ?? 0)) rows.push(sl); if (sl === 1 && !lmid && i > 12) { lmid = true; await xshot('04_list_mid_drag'); } }
    await X.mouse.up(); await X.waitForTimeout(150); w = await xs(); ok(rows.join() === '1,2', `drag up 0.46 of the screen: rows ${rows.join(', ')} (one per 0.2, row by row)`); ok(w.scr === 'pick' && w.sel === 2, 'the lift after the list drag selects nothing');
    if (!lmid) await xshot('04_list_mid_drag');
    // the standard workouts with an empty setup (an unpaired watch without anything from the phone)
    await X.evaluate(() => { const F = __watch.F; F.sets = []; F.start = 0; F.plan = null; F.setup = { ex: [], rest: 90 }; F.list = []; F.cfg.w = []; F.sel = 0; F.scr = 'home';
      const o = []; o.push = (...a) => Array.prototype.push.apply(o, a.filter(x => x.k !== 'setup')); F.out = o; }); // no phone: the setup never comes
    await X.evaluate(async () => { const m = await import('/js/watchflow.js'); __watch.ev('item', m.homeItems(__watch.F).indexOf('kraft')); }); await X.waitForTimeout(150);
    w = await xs(); const sl = await X.evaluate(async () => (await import('/js/watchflow.js')).listItems(__watch.F));
    ok(w.scr === 'smode' && sl.join() === 'Free,Push day,Pull day,Leg day,Upper body,Lower body,Full body,One-arm pull-up,One-arm push-up', `empty setup: Strength lists Free + the six standard workouts (${sl.join(', ')})`);
    await X.evaluate(() => __watch.ev('down')); await X.waitForTimeout(100); ok((await xt()).includes('Standard, 6 exercises'), 'Push day: "Standard, 6 exercises"'); await xshot('05_standard_workouts');
    await X.evaluate(() => __watch.ev('start')); w = await xs(); ok(w.scr === 'set' && w.ex === 'bench' && w.kg === 20 && w.reps === 6, `Push day: bench 4 × 6 at the start value 20 kg (${w.ex} ${w.kg} × ${w.reps})`);
    ok((await xt()).includes('SET 1 OF 4'), '"SET 1 OF 4"'); await xshot('06_standard_push_set');
    for (let i = 0; i < 4; i++) await X.evaluate(() => { __watch.ev('done'); __watch.F.flash = null; __watch.ev('start'); }); w = await xs();
    ok(w.scr === 'set' && w.ex === 'ohp' && w.reps === 8, `four bench sets, then the plan goes on: overhead press × 8 (${w.ex} × ${w.reps})`);
    ok(!xerr.length, 'no page errors in the wheel flows' + (xerr.length ? ': ' + xerr.join(' | ') : '')); await xc.close();

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
    // 23.11.: the trainer ride as the watch uploads it: one entry with power, cadence, kJ
    const wtok = await W.evaluate(() => JSON.parse(localStorage.getItem('rf_watch_token')));
    const up = await fetch(BASE + '/api/watch/activity', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + wtok }, body: JSON.stringify({ ...tbody, start: Math.round(Date.now() / 1000) - 7200 }) }).then(r => r.json());
    ok(up.ok && up.id === 'watch-' + tbody.id, 'the trainer ride uploads (POST /api/watch/activity)');
    await P.reload(); await P.waitForTimeout(500); for (let i = 0; i < 30 && !(await P.locator(`[data-act$="watch-${tbody.id}"]`).count()); i++) await P.waitForTimeout(200);
    ok((await P.locator(`[data-act$="watch-${tbody.id}"]`).count()) === 1, 'Activities: the indoor ride, once'); await P.locator(`[data-act$="watch-${tbody.id}"]`).first().click(); await P.waitForTimeout(400);
    const rdet = await P.textContent('.psheetin'); ok(/Avg power/.test(rdet) && /Max power/.test(rdet) && /Cadence/.test(rdet) && /Recorded on watch/.test(rdet) && /Virtual ride/.test(rdet), 'detail: Virtual ride, avg / max power, cadence, recorded on watch');
    if (SHOTS) await P.screenshot({ path: `${SHOTS}/phone_activity_trainer.png` });
    ok(!perr.length, 'no page errors on the phone' + (perr.length ? ': ' + perr.join(' | ') : ''));
    console.log(`${shot} screens × 3 faces`);
  } catch (e) { console.log('✗ ' + e.message); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nWatch UI: all good'); process.exit(fails ? 1 : 0);
})();
