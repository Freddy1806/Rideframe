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

    // ---- the 3D ride (Passo Demo, desktop): #hPause opens the pause menu with Resume, Finish & save and Discard ----
    const dctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    const R = await dctx.newPage(); R.on('pageerror', e => errs.push('ride: ' + e.message)); R.on('dialog', d => d.accept());
    await R.goto(BASE + '/?desktop&noprofile&demo'); await R.waitForTimeout(800);
    await R.click('.tab[data-view="library"]'); await R.click('.card[data-id="demo"]'); await R.click('#rideBtn');
    await R.waitForSelector('#hPause', { timeout: 30000 }); await R.waitForTimeout(500);
    ok(await vis(R, '#hPause'), '3D ride: Pause on the HUD');
    await R.click('#hPause'); await R.waitForTimeout(400);
    ok(await vis(R, '#pResume') && await vis(R, '#pSave') && await vis(R, '#pDiscard'), '3D ride paused: Resume, Finish & save, Discard');
    await R.click('#pResume'); await R.waitForTimeout(300); ok(!(await vis(R, '#pauseOverlay')), '3D ride: Resume closes the pause menu');
    await dctx.close();

    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + e.message); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nPause UI: all good'); process.exit(fails ? 1 : 0);
})();
