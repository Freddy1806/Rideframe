// End to end for the recovery card on the phone's start page (js/healthcard.js, tools/health-api.mjs): signed out nothing; signed in
// without values the honest empty state; with a week of snapshots from a paired watch (POST /api/watch/health) the card under the
// weight card with sleep score, body battery, resting HR against its 7-day average, recovery time and VO2max. No sideways scroll and
// nothing overflowing at 360 px (and 320), no page errors. Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) RIDEFRAME_DATA=$(mktemp -d) node tools/healthcard-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0'), dk = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-healthcard-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  try {
    const api = (m, p, body, h = {}) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...h }, body: body && JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json().catch(() => ({})) }));
    const reg = async name => (await api('POST', '/api/account/register', { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' })).j;
    const A = await reg('Rest Rosa'), E = await reg('Empty Ezra');
    const code = (await api('POST', '/api/watch/code', null, { 'X-RF-Token': A.token })).j.code, w = (await api('POST', '/api/watch/pair', { code, label: 'fenix 8' })).j.token;
    const now = Date.now();
    for (let i = 7; i >= 0; i--) { const t = now - i * 864e5 - (i ? 0 : 60e3);
      const r = await api('POST', '/api/watch/health', { day: dk(t), t: Math.round(t / 1000), rhr: i ? 50 : 47, ...(i ? {} : { ss: 86, bb: 81, rt: 420, v2r: 54, v2b: 56, ts: 'Productive', st: 18 }) }, { Authorization: 'Bearer ' + w });
      if (r.status !== 200) throw new Error('snapshot not stored: ' + JSON.stringify(r.j)); }
    await api('POST', '/api/body', { t: now - 3600e3, kg: 74.2 }, { 'X-RF-Token': A.token });

    const ctx = await b.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('rfStartCards', '1'); } catch {} }); // off by default until the new start page
    const P = await ctx.newPage(); const perr = []; P.on('pageerror', e => perr.push(e.message));
    await P.goto(BASE + '/handy.html'); await P.waitForSelector('#hSet'); await wait(500);
    ok(!(await P.locator('.hcard').count()), 'signed out: no recovery card');
    const as = async a => { await P.evaluate(([token, name]) => localStorage.setItem('rf_account', JSON.stringify({ token, name })), [a.token, a.name]); await P.reload(); await P.waitForSelector('#hSet'); };
    const overflow = () => P.evaluate(() => { const c = document.querySelector('#hHealth'), r = c.getBoundingClientRect(), bad = [];
      for (const e of c.querySelectorAll('*')) { const q = e.getBoundingClientRect(); if (q.width && (q.left < r.left - .5 || q.right > r.right + .5)) bad.push(e.className || e.tagName); if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'visible' && e.clientWidth) bad.push('scroll:' + (e.className || e.tagName)); }
      return { side: document.documentElement.scrollWidth > innerWidth + 1, bad }; });
    const shot = async nm => { if (!SHOTS) return; await P.evaluate(() => document.querySelector('#hBody').scrollIntoView({ block: 'start' })); await wait(150); await P.screenshot({ path: `${SHOTS}/health_${nm}.png` }); };

    // a new account: the Today page greets with its first steps (no recovery card made up from nothing); the recovery card's own
    // honest empty state lives on the Body page now (the Today overview's Recovery card has its own empty text, tools/cards-ui.cjs)
    await as(E); await P.waitForSelector('#ovFirst');
    await wait(800); ok(!(await P.locator('.hcard:visible').count()) && !(await P.locator('#hHealth:visible').count()) && await P.locator('#ovFirst').isVisible(), 'new account on Today: no empty recovery card, the first steps instead');
    // the Body page (27.11.): the watch's values are tiles there; without any, one small "No sleep source yet" tile and no paragraphs
    await P.goto(BASE + '/body.html'); await P.waitForSelector('#bComp .bcc', { timeout: 8000 }).catch(() => {});
    ok(/No sleep source yet/.test(await P.textContent('#bComp').catch(() => '')) && !(await P.locator('#bHealth').count()), 'no values yet: one "No sleep source yet" tile on the Body page');
    const e1 = await P.evaluate(() => ({ side: document.documentElement.scrollWidth > innerWidth + 1 }));
    ok(!e1.side, 'empty state: no sideways scroll at 360 px');
    if (SHOTS) await P.screenshot({ path: `${SHOTS}/health_empty_body.png` });
    await P.goto(BASE + '/handy.html'); await P.waitForSelector('#hSet');

    await as(A); await P.waitForSelector('.hcard .hct'); await P.waitForSelector('#hBody .bcard');
    const txt = await P.textContent('.hcard');
    ok(/Recovery/.test(txt) && /Garmin watch · today/.test(txt) && /Productive/.test(txt), 'the head: from the watch, today, training status');
    const tile = l => P.evaluate(l => [...document.querySelectorAll('.hct')].find(e => e.querySelector('span').textContent === l)?.textContent || '', l);
    ok(/Sleep score86good/.test(await tile('Sleep score')), 'sleep score with its word');
    ok(/Body battery81charged/.test(await tile('Body battery')), 'body battery');
    ok(/Resting HR47 bpm−3 vs 7 days/.test(await tile('Resting HR')), 'resting HR against the 7-day average: ' + await tile('Resting HR'));
    ok(/Recovery7 hto recover/.test(await tile('Recovery')), 'recovery time in hours');
    ok(/VO2max54run · bike 56/.test(await tile('VO2max')), 'VO2max run and bike');
    ok(await P.evaluate(() => { const a = document.querySelector('#hBody'), h = document.querySelector('#hHealth'), ca = a.closest('.cd') || a, ch = h.closest('.cd') || h; return ca.compareDocumentPosition(ch) & Node.DOCUMENT_POSITION_FOLLOWING && a.getBoundingClientRect().bottom <= h.getBoundingClientRect().top; }), 'below the weight card (27.11.: Weight leads the body group, Recovery after it)');
    const cut = () => P.evaluate(() => [...document.querySelectorAll('.hct > *')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
    for (const wd of [360, 320]) { await P.setViewportSize({ width: wd, height: 800 }); await wait(150); const o = await overflow(); ok(!o.side && !o.bad.length, `full card: nothing overflows at ${wd} px ` + JSON.stringify(o)); const c = await cut(); ok(!c.length, `no tile text cut at ${wd} px ` + JSON.stringify(c)); }
    await P.setViewportSize({ width: 360, height: 800 }); await shot('full');
    await P.emulateMedia({ colorScheme: 'light' }); await P.evaluate(() => document.documentElement.dataset.theme = 'light'); await wait(100);
    ok(await P.evaluate(() => getComputedStyle(document.querySelector('.hcico')).color) === 'rgb(70, 82, 200)', 'light theme: the darker area colour');
    await shot('full_light');
    await P.emulateMedia({ colorScheme: 'dark' }); await P.goto(BASE + '/body.html'); await P.waitForSelector('#bComp .bcc');
    const bt = await P.textContent('#bComp'); ok(/Sleep score\s*86/.test(bt) && /Resting HR\s*47/.test(bt) && /Body battery\s*81/.test(bt), 'Body page: sleep score, resting HR and body battery as tiles');
    if (SHOTS) await P.screenshot({ path: `${SHOTS}/health_body_tiles.png`, fullPage: true });
    ok(!perr.length, 'no page errors' + (perr.length ? ': ' + perr.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + e.message); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nRecovery card UI: all good'); process.exit(fails ? 1 : 0);
})();
