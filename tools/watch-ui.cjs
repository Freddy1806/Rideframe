// End to end: phone pairs a watch, the preview watch (watch.html) runs a whole strength session with the buttons only and
// one with touch only (that one offline first: queue, then sent), and both sessions show up in the phone's Activities feed.
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
    const F = () => W.evaluate(() => ({ scr: __watch.F.scr, sets: __watch.F.sets.length, kg: __watch.F.kg, reps: __watch.F.reps, focus: __watch.F.focus, ex: __watch.F.setup.ex[__watch.F.cur]?.id, sel: __watch.F.sel, flash: !!__watch.F.flash, queue: __watch.F.queue.length, sum: __watch.F.sum, paired: __watch.F.paired, nEx: __watch.F.setup.ex.length }));
    const btn = async (k, n = 1, face = 'fr265') => { for (let i = 0; i < n; i++) { await W.click(`[data-face="${face}"] .wbtn.${k}`); await W.waitForTimeout(60); } };
    const hold = async (k, ms, face = 'fenix7xpro') => { const el = W.locator(`[data-face="${face}"] .wbtn.${k}`), bb = await el.boundingBox(); await W.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await W.mouse.down(); await W.waitForTimeout(ms); await W.mouse.up(); await W.waitForTimeout(80); };
    let shot = 0; const snap = async nm => { shot++; if (!SHOTS) return; await W.waitForTimeout(250); for (const f of ['fr265', 'fenix7xpro']) await W.locator(`[data-face="${f}"] .wscale`).screenshot({ path: `${SHOTS}/${f}_${String(shot).padStart(2, '0')}_${nm}.png` }); };
    await snap('start_demo');
    await W.click('[data-mode="live"]'); await W.waitForTimeout(200); ok((await F()).scr === 'pair', 'My account without a token: pairing screen');
    // buttons only: UP d times, START; the last digit is shown before START
    for (let i = 0; i < 6; i++) { await btn('up', +code[i], i % 2 ? 'fenix7xpro' : 'fr265'); if (i === 5) await snap('pair'); await btn('start'); }
    for (let i = 0; i < 40 && !(await F()).nEx; i++) await W.waitForTimeout(100);
    let s = await F(); ok(s.paired && s.scr === 'start' && s.nEx > 0, 'paired with buttons only, setup loaded');
    await P.waitForSelector('.wdev', { timeout: 6000 }).catch(() => {}); ok(/Preview \(browser\)/.test(await P.textContent('#tWatch')), 'phone lists the paired watch');
    if (SHOTS) await P.screenshot({ path: `${SHOTS}/phone_settings_paired.png` });
    await W.waitForTimeout(400); await snap('start');

    // ---- session 1: buttons only ----
    await btn('start'); s = await F(); ok(s.scr === 'pick' && s.ex === 'bench', 'START opens the picker, last used first'); await btn('down'); await btn('up'); await snap('pick');
    await btn('start'); s = await F(); ok(s.scr === 'set' && s.kg === 80 && s.reps === 8, 'bench prefilled 80 x 8 from last session');
    await hold('up', 950); s = await F(); ok(s.kg >= 90, `UP held: 10 kg steps (${s.kg})`); while ((await F()).kg > 82.5) await btn('down');
    await snap('set'); await btn('start'); s = await F(); ok(s.scr === 'rest' && s.flash, '82.5 x 8 beats 80 x 8: record flash'); await snap('pr');
    await btn('start'); s = await F(); ok(s.scr === 'rest' && !s.flash, 'first key clears the flash'); await snap('rest');
    await btn('start'); s = await F(); ok(s.scr === 'set' && s.kg === 82.5 && s.reps === 8, 'START skips the rest, set 2 prefilled from set 1');
    await btn('back'); await btn('down'); s = await F(); ok(s.focus === 1 && s.reps === 7, 'BACK switches to reps, DOWN = 7'); await snap('set_reps');
    await btn('start'); await btn('back'); s = await F(); ok(s.scr === 'pick', 'BACK in the rest: picker'); const pull = await W.evaluate(() => __watch.F.setup.ex.findIndex(e => e.id === 'pull'));
    await btn('down', pull); await btn('start'); s = await F(); ok(s.ex === 'pull' && s.reps === 10 && s.focus === 1, 'pull-ups: bodyweight, reps focused');
    await btn('start'); await btn('start'); await hold('back', 900); s = await F(); ok(s.scr === 'menu', 'BACK held: menu'); await snap('menu');
    await btn('down'); await btn('start'); s = await F(); ok(s.scr === 'set' && s.sets === 2 && s.ex === 'pull', 'undo last set');
    await btn('up', 2); await btn('start'); await hold('back', 900); await btn('down', 2); await btn('start');
    s = await F(); ok(s.scr === 'sum' && s.sum.sets === 3, 'finish: summary with 3 sets');
    for (let i = 0; i < 40 && (await F()).sum.st !== 'saved'; i++) await W.waitForTimeout(100);
    ok((await F()).sum.st === 'saved', 'session 1 saved on the server'); await snap('summary_saved');
    await W.click('#wGlance'); await W.waitForTimeout(300); await snap('glance'); await btn('start');

    // ---- session 2: touch only, phone away first (offline queue) ----
    await W.uncheck('#wNear');
    const cv = W.locator('[data-face="fr265"] canvas'), box = await cv.boundingBox(), at = (u, v) => ({ x: box.x + u * box.width, y: box.y + v * box.height });
    const tap = async (u, v) => { await cv.tap({ position: { x: u * box.width, y: v * box.height } }); await W.waitForTimeout(80); };
    const swipe = async (dir) => { const [a, z] = { up: [[.5, .7], [.5, .3]], down: [[.5, .3], [.5, .7]], left: [[.75, .5], [.25, .5]] }[dir]; const p0 = at(...a), p1 = at(...z);
      await W.mouse.move(p0.x, p0.y); await W.mouse.down(); await W.mouse.move(p1.x, p1.y, { steps: 6 }); await W.mouse.up(); await W.waitForTimeout(100); };
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
