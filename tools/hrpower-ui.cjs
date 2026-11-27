// Heart rate vs power end to end (owner 20.11.): the coach workout 30 / 15 · 3 × 13 is ridden with a (faked) trainer and heart rate
// strap (samples with a modelled heart rate are put into the ride, like ivstats-ui does), "Finish & save": the summary shows the
// section with the recovery index, its three parts, the table per set and the reps chart; the ride record carries rec.hrp (small);
// a second ride of the same workout shows "Last time" with good / bad colours; a ride without a strap shows the one-line hint;
// Rides & Records (1280 / 1440) shows the section for a past ride and the trend over the rides of the workout; the phone Stats page
// (390) too, without sideways scrolling. No page errors.
// Usage: NODE_PATH=$(npm root -g) node tools/hrpower-ui.cjs [<shots folder>]   (or SHOTS=<dir>)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0; const ok = (c, m, info = '') => { n++; console.log(`${c ? '✓' : '✗'} ${m}${!c && info ? ' · ' + info : ''}`); if (!c) fails++; };
const resize = async (p, w, h) => { await p.evaluate(() => document.fullscreenElement && document.exitFullscreen().catch(() => {})); await p.waitForTimeout(200); await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(300); };
const shot = async (loc, name) => { if (SHOTS) await loc.screenshot({ path: path.join(SHOTS, name), type: 'jpeg', quality: 88 }); };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-hrp-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push('desktop: ' + e.message)); p.on('dialog', d => d.accept());

    const startRide = async workout => {
      await p.goto(BASE + '/?desktop&noprofile&demo&laptest&nowizard'); await p.waitForTimeout(700);
      await p.click('.tab[data-view="library"]'); await p.click('.card[data-id="demo"]'); await p.waitForSelector('#workSel');
      await p.selectOption('#workSel', workout); await p.click('#rideBtn');
      await p.waitForFunction(() => window.__ride?.running && !document.querySelector('.countdown'), null, { timeout: 30000 });
      await p.evaluate(() => { const r = window.__ride, t = r.state.trainer; t.device = { gatt: { connected: true } }; t.data = { power: 200, cadence: 90, speed: 9, hr: 120 };
        clearInterval(window.__tl); window.__tl = setInterval(() => { t.lastData = performance.now(); }, 100); t.lastData = performance.now(); });
    };
    /** the whole ride's samples up to `upTo` s after the last hard step: ERG watts of the plan (± noise), heart rate from a
     *  first-order lag towards 52 + k × W (6 s late) plus slow drift; strap = false: 0 */
    const rideAll = (k, strap = true) => p.evaluate(([k, strap]) => {
      const r = window.__ride, ftp = r.ftp, steps = r.workout.steps, s = [], pw = []; let t = 0, h = 75, lastHard = 0;
      steps.forEach(st => { const pct = st.watts ? st.watts / ftp * 100 : st.pct; if (pct >= 88) lastHard = steps.indexOf(st); });
      const end = steps.slice(0, lastHard + 1).reduce((a, x) => a + x.dur, 0) + 200;
      for (const st of steps) for (let i = 0; i < st.dur && t < end; i++) { t++;
        const w = Math.round(st.watts || (st.pct2 != null ? st.pct + (st.pct2 - st.pct) * i / st.dur : st.pct) / 100 * ftp) + (t % 2 ? 2 : -2); pw.push(w);
        const ss = 52 + k * pw[Math.max(0, pw.length - 7)] + 0.004 * t; h += (ss - h) / (ss > h ? 22 : 32);
        s.push([t, t * 9, w, 32, 90, strap ? Math.round(h) : 0]); }
      r.samples = s; r.lastSample = t; r.elapsed = t; r.powerHist = s.map(x => x[2]); }, [k, strap]);
    const save = async () => { await p.keyboard.press('Space'); await p.waitForSelector('#pEnd'); await p.click('#pEnd'); await p.click('#pSave'); await p.waitForSelector('.finish', { timeout: 10000 }); await p.waitForTimeout(1200); };
    const last = () => p.evaluate(async () => { const { db } = await import('/js/db.js'); return (await db.all('rides')).sort((a, b) => b.date - a.date)[0]; });

    // ---- ride 1: 30 / 15 with a strap ----
    await startRide('c_30_15_3x13'); await rideAll(0.34); await save();
    const r1 = await last();
    ok(r1?.hrp?.v === 1 && r1.hrp.ok && r1.hrp.index >= 0 && r1.hrp.index <= 100 && r1.hrp.sets.length === 3 && r1.hrp.reps.length === 39, `saved ride: rec.hrp with index ${r1?.hrp?.index}, 3 sets, 39 reps`, JSON.stringify(r1?.hrp)?.slice(0, 300));
    const size = JSON.stringify(r1.hrp).length; ok(size < 4000, `rec.hrp is small: ${size} bytes`);
    ok(r1.hrp.main?.tg === 340, 'main kind: 340 W', JSON.stringify(r1.hrp.main));
    await p.waitForSelector('#fHrp .hrp', { timeout: 8000 });
    const f1 = await p.evaluate(() => { const h = document.querySelector('#fHrp .hrp'); return { idx: h.querySelector('.hrp-big')?.textContent, parts: h.querySelectorAll('.hrp-part').length, rows: h.querySelectorAll('.hrp-tbl tr').length - 1,
      lines: h.querySelectorAll('svg.hrp-chart path.hrp-l').length, bars: h.querySelectorAll('svg.hrp-chart rect.hrp-wbar').length, cmp: !!h.querySelector('.hrp-cmp'), txt: h.textContent }; });
    ok(f1.idx === `${r1.hrp.index}/100` && f1.parts === 3, `summary: index ${f1.idx} with its 3 parts`, JSON.stringify(f1).slice(0, 300));
    ok(f1.rows === 3 && /Set 1/.test(f1.txt) && /13 × 30 s/.test(f1.txt) && /HRR60/.test(f1.txt), 'summary: table with one row per set (avg W, HR, peak, drift, HRR60)');
    ok(f1.lines === 3 && f1.bars === 13, 'summary: reps chart, one line per set, 13 power bars');
    ok(!f1.cmp && /not a medical value/.test(f1.txt), 'first ride: no "last time", the note says it is no medical value');
    // nothing cut off at 1280 × 720
    await resize(p, 1280, 720);
    const fit = await p.evaluate(() => { const h = document.querySelector('#fHrp .hrp'), b = h.getBoundingClientRect(), box = document.querySelector('.finish .box').getBoundingClientRect(); const s = h.querySelector('svg.hrp-chart').getBoundingClientRect();
      return { l: Math.round(b.left), r: Math.round(b.right), bl: Math.round(box.left), br: Math.round(box.right), sw: h.scrollWidth <= h.clientWidth + 1, sr: Math.round(s.right), over: document.documentElement.scrollWidth > innerWidth }; });
    ok(fit.l >= fit.bl && fit.r <= fit.br && fit.sw && fit.sr <= fit.r && !fit.over, '1280 × 720: the section and its chart fit the summary', JSON.stringify(fit));
    await resize(p, 1440, 900);
    await p.click('#fDone'); await p.waitForTimeout(600);
    await p.evaluate(async () => { const { db } = await import('/js/db.js'); const r = (await db.all('rides')).sort((a, b) => b.date - a.date)[0]; r.date -= 3 * 864e5; await db.put('rides', r); });

    // ---- ride 2: the same workout, a lower heart rate ----
    await startRide('c_30_15_3x13'); await rideAll(0.32); await save();
    const r2 = await last(); await p.waitForSelector('#fHrp .hrp-cmp', { timeout: 8000 });
    const c2 = await p.evaluate(() => [...document.querySelectorAll('#fHrp .hrp-cmp li')].map(li => ({ k: li.dataset.k, cls: li.className, t: li.textContent, c: getComputedStyle(li).color })));
    const hr = c2.find(x => x.k === 'hr'), d = r2.hrp.main.hr - r1.hrp.main.hr;
    ok(hr && d < 0 && hr.t.startsWith(`HR at 340 W: ${r2.hrp.main.hr} bpm (−${-d} vs last time)`) && hr.cls === 'good' && hr.c === 'rgb(47, 191, 113)', `second ride: "${hr?.t}" in green`, JSON.stringify(c2));
    ok(c2.some(x => x.k === 'idx' && x.t.startsWith(`Recovery index ${r2.hrp.index} (last ${r1.hrp.index})`)) && c2.some(x => x.k === 'ef'), 'second ride: EF and "Recovery index … (last …)"', JSON.stringify(c2));
    await p.evaluate(() => document.querySelector('#fHrp').scrollIntoView({ block: 'start' })); await p.waitForTimeout(200);
    await shot(p, 'summary_hrp_1440.jpg'); await shot(p.locator('#fHrp'), 'summary_hrp_section_1440.jpg');
    await p.click('#fDone'); await p.waitForTimeout(600);

    // ---- ride 3: no strap ----
    await startRide('vo2_5x3'); await rideAll(0.34, false); await save();
    await p.waitForSelector('#fHrp .hrp-hint', { timeout: 8000 });
    const h3 = await p.textContent('#fHrp');
    ok(/ride with a heart rate strap/.test(h3) && !(await p.$('#fHrp .hrp-big')), 'no strap: one hint line instead of the section', h3);
    const r3 = await last(); ok(r3.hrp && !r3.hrp.ok && /No heart rate/.test(r3.hrp.reason), 'no strap: rec.hrp says why', JSON.stringify(r3.hrp));
    await p.click('#fDone'); await p.waitForTimeout(600);

    // ---- Rides & Records ----
    await p.click('.tab[data-view="history"]'); await p.waitForSelector('#hrpHist .hrp', { timeout: 8000 });
    const h = await p.evaluate(() => { const r = document.querySelector('#hrpHist'); return { opts: [...r.querySelectorAll('#hrpRide option')].map(o => o.textContent), idx: r.querySelector('.hrp-big')?.textContent,
      rows: r.querySelectorAll('.hrp-tbl tr').length - 1, trend: r.querySelectorAll('svg.hrp-trend[data-k="index"] circle').length, trhr: r.querySelectorAll('svg.hrp-trend[data-k="hr"] circle').length, cmp: r.querySelectorAll('.hrp-cmp li').length,
      over: document.documentElement.scrollWidth > innerWidth, w: Math.round(r.querySelector('svg.hrp-trend').getBoundingClientRect().width), vb: r.querySelector('svg.hrp-trend').getAttribute('viewBox') }; });
    ok(h.opts.length === 2 && /30 \/ 15/.test(h.opts[0]) && h.idx === `${r2.hrp.index}/100`, 'history: the two strap rides to pick, the latest shown with its index', JSON.stringify(h));
    ok(h.rows === 3 && h.cmp >= 3, 'history: table per set and the comparison with the ride before', JSON.stringify(h));
    ok(h.trend === 2 && h.trhr === 2 && h.vb.startsWith(`0 0 ${h.w} `) && !h.over, 'history: trend of the index and of HR at 340 W over 2 rides, drawn at its real width', JSON.stringify(h));
    await p.locator('#hrpHist').scrollIntoViewIfNeeded(); await shot(p.locator('#hrpHist .hrp'), 'history_hrp_1440.jpg');
    await p.locator('#hrpHist .hrp-trendbox').scrollIntoViewIfNeeded(); await shot(p.locator('#hrpHist .hrp-trendbox'), 'history_hrp_trend_1440.jpg');
    await p.selectOption('#hrpRide', r1.id); await p.waitForTimeout(200);
    ok(await p.evaluate(i => document.querySelector('#hrpHist .hrp-big')?.textContent === `${i}/100` && !document.querySelector('#hrpHist .hrp-cmp'), r1.hrp.index), 'history: picking the older ride shows its section (no earlier ride to compare)');
    // an old ride without rec.hrp: worked out from its samples
    await p.evaluate(async () => { const { db } = await import('/js/db.js'); const r = (await db.all('rides')).find(x => x.hrp?.ok); const o = { ...r, id: 'oldhrp', date: r.date - 864e5 }; delete o.hrp; await db.put('rides', o); });
    await p.goto(BASE + '/?desktop&noprofile&demo&laptest&nowizard'); await p.waitForTimeout(700); await p.click('.tab[data-view="history"]'); await p.waitForSelector('#hrpHist .hrp', { timeout: 8000 });
    ok((await p.$$eval('#hrpHist #hrpRide option', o => o.length)) === 3, 'history: an older ride without a stored analysis gets one from its samples');
    await resize(p, 1280, 720); await p.click('.tab[data-view="library"]'); await p.click('.tab[data-view="history"]'); await p.waitForSelector('#hrpHist .hrp', { timeout: 8000 });
    ok(await p.evaluate(() => { const r = document.querySelector('#hrpHist'); return r.scrollWidth <= r.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; }), 'history 1280 × 720: nothing sideways');

    // ---- phone Stats page (390) ----
    await p.evaluate(async () => { const { db } = await import('/js/db.js'); for (const r of await db.all('rides')) { r.routeId = 'kueste60'; await db.put('rides', r); } }); // the phone pages leave out the demo route
    const q = await ctx.newPage(); q.on('pageerror', e => errs.push('stats: ' + e.message)); await q.setViewportSize({ width: 390, height: 844 });
    await q.goto(BASE + '/statistik.html'); await q.waitForSelector('#hrpHist .hrp', { timeout: 8000 });
    const ph = await q.evaluate(() => { const r = document.querySelector('#hrpHist'), s = r.querySelector('svg.hrp-chart'); return { idx: r.querySelector('.hrp-big')?.textContent, over: document.documentElement.scrollWidth > innerWidth, chart: !!s, sw: Math.round(s?.getBoundingClientRect().right || 0), rr: Math.round(r.getBoundingClientRect().right) }; });
    ok(/\/100$/.test(ph.idx || '') && ph.chart && ph.sw <= ph.rr && !ph.over, 'phone Stats: the section with index and chart, no sideways scroll', JSON.stringify(ph));
    await q.locator('#hrpHist').scrollIntoViewIfNeeded(); await shot(q.locator('#hrpHist .hrp'), 'stats_hrp_390.jpg');
    await q.locator('#hrpHist .hrp-trendbox').scrollIntoViewIfNeeded(); await shot(q.locator('#hrpHist .hrp-trendbox'), 'stats_hrp_trend_390.jpg');
    await q.close();
    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + (e.stack || e.message)); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} of ${n} failed` : `\nHR vs power UI: all ${n} good`); process.exit(fails ? 1 : 0);
})();
