// Interval stats end to end (owner 17.11.): a workout ride with a (faked) trainer and heart rate strap is saved with its ridden
// intervals, the summary shows the ridden values per interval and, after a second ride, "Last time (…): avg … W · today … W";
// "Intervals over time" on Rides & Records (1280) and on the phone Stats page (390) with the chart and the table, an old ride
// with name / t / w only shows "–"; the wizard in a workout never comes in a rest and does come inside a hard interval with
// the interval target incl. the rider's offset (time is set by hand, like intensity-ui does).
// Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) node tools/ivstats-ui.cjs [<shots folder>]   (or SHOTS=<dir>)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0; const ok = (c, m, info = '') => { n++; console.log(`${c ? '✓' : '✗'} ${m}${!c && info ? ' · ' + info : ''}`); if (!c) fails++; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-ivstats-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push('desktop: ' + e.message)); p.on('dialog', d => d.accept());

    /** a workout ride on the demo route with a live (fake) trainer; extra = more query string */
    const startRide = async (extra = '') => {
      await p.goto(BASE + '/?desktop&noprofile&demo&laptest' + extra); await p.waitForTimeout(700);
      await p.click('.tab[data-view="library"]'); await p.click('.card[data-id="demo"]'); await p.waitForSelector('#workSel');
      await p.selectOption('#workSel', 'vo2_5x5'); await p.click('#rideBtn');
      await p.waitForFunction(() => window.__ride?.running && !document.querySelector('.countdown'), null, { timeout: 30000 });
      await p.evaluate(() => { const r = window.__ride, t = r.state.trainer; t.device = { gatt: { connected: true } }; t.data = { power: 280, cadence: 92, speed: 9, hr: 160 };
        clearInterval(window.__tl); window.__tl = setInterval(() => { t.lastData = performance.now(); t.data.power = window.__tp ?? 280; t.data.hr = window.__th ?? 160; }, 100); t.lastData = performance.now();
        const st = r.workout.steps, at = l => st.slice(0, st.findIndex(x => x.label === l)).reduce((a, x) => a + x.dur, 0);
        window.__A = at('VO2max 1/5'); window.__RS = window.__A + 300; window.__B2 = at('VO2max 2/5'); window.__C = at('VO2max 3/5'); });
    };
    /** the ride's samples as a trainer would have recorded them up to the end of VO2max 2/5: w on the intervals, 130 W else */
    const rideTo = (w, hr) => p.evaluate(([w, hr]) => { const r = window.__ride, end = window.__C - 30, s = [];
      const hard = t => (t > __A && t <= __A + 300) || (t > __B2 && t <= __B2 + 300);
      for (let t = 1; t <= end; t++) s.push([t, t * 8, hard(t) ? w + (t % 2 ? 6 : -6) : 130, 30, 92, hard(t) ? hr : 118]);
      r.samples = s; r.lastSample = end; r.elapsed = end; }, [w, hr]);
    const save = async () => { await p.keyboard.press('Space'); await p.waitForSelector('#pEnd'); await p.click('#pEnd'); await p.click('#pSave'); await p.waitForSelector('.finish', { timeout: 10000 });
      await p.waitForFunction(() => document.querySelector('#fIvs .ivtbl'), null, { timeout: 8000 }); await p.waitForTimeout(500); };
    const last = () => p.evaluate(async () => { const { db } = await import('/js/db.js'); return (await db.all('rides')).sort((a, b) => b.date - a.date)[0]; });

    // ---- ride 1 ----
    await startRide('&nowizard');
    await rideTo(281, 168); await save();
    const r1 = await last();
    const v1 = (r1?.ivs || []).filter(x => /^VO2max/.test(x.name));
    ok(v1.length === 2 && v1.every(x => x.w === 281 && x.wMax === 287 && x.hr === 168 && x.hrMax === 168 && x.cad === 92), 'saved ride: VO2max intervals with ridden avg / max W, avg / max HR, cadence', JSON.stringify(v1));
    ok(v1[0]?.kind === 'vo2_5x5:vo2max:300' && v1[0]?.pct === 110 && v1[0]?.ftp > 0 && v1[0]?.target === Math.round(1.1 * v1[0].ftp), 'kind "vo2_5x5:vo2max:300", plan (110 % of FTP) as context only', JSON.stringify(v1[0]));
    const s1 = await p.textContent('#fIvs');
    ok(/VO2max 1\/5/.test(s1) && /281/.test(s1) && /287/.test(s1) && /168/.test(s1) && /First time: avg 281 W · HR 168/.test(s1), 'summary 1: interval table with ridden values, "First time"', s1.slice(0, 300));
    // ride 1 was a month ago
    await p.evaluate(async () => { const { db } = await import('/js/db.js'); const rs = await db.all('rides'), r = rs.sort((a, b) => b.date - a.date)[0]; r.date -= 30 * 864e5; await db.put('rides', r);
      await db.put('rides', { id: 'oldone', routeId: 'demo', date: Date.now() - 180 * 864e5, duration: 3000, distance: 20000, gain: 100, avgPower: 200, complete: false, workoutId: 'vo2_5x5', workout: 'VO2max 5 × 5', samples: [], ivs: [1, 2, 3, 4, 5].map(i => ({ name: `VO2max ${i}/5`, t: 300, w: 262 })) }); }); // an old ride: name / t / w only
    // ---- ride 2 ----
    await startRide('&nowizard');
    await rideTo(288, 165); await save();
    const day = await p.evaluate(() => new Date(Date.now() - 30 * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    const cmp = await p.textContent('#fIvs .ivcmp');
    ok(cmp.includes(`Last time (${day}): avg 281 W · today 288 W (+7 W), HR 168 → 165`), `summary 2: "Last time (${day}): avg 281 W · today 288 W (+7 W), HR 168 → 165"`, cmp);
    const fit = await p.evaluate(() => { const f = document.querySelector('.finish'), iv = document.querySelector('#fIvs .ivsum').getBoundingClientRect(); f.scrollTop = f.scrollHeight; const d = document.querySelector('#fDone').getBoundingClientRect(); const r = { done: Math.round(d.bottom), h: innerHeight, ivh: Math.round(iv.height) }; f.scrollTop = 0; return r; });
    ok(fit.done <= fit.h && fit.ivh <= 200, `summary: interval table ${fit.ivh} px high (scrolls inside), the buttons reachable`, JSON.stringify(fit));
    await p.evaluate(() => document.querySelector('#fIvs').scrollIntoView({ block: 'center' }));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'summary_last_time_1280.png') });
    // Strava description: name · time · avg W · avg HR, no target
    const desc = await p.evaluate(async () => { let body = null; const f = window.fetch; window.fetch = async (u, o) => { if (String(u).endsWith('/api/strava/upload')) { body = JSON.parse(o.body); throw new Error('stop'); } return f(u, o); };
      const { db } = await import('/js/db.js'), { stravaUpload } = await import('/js/stravaup.js'); const r = (await db.all('rides')).sort((a, b) => b.date - a.date)[0];
      try { await stravaUpload(r, 'Passo Demo', () => 0); } catch {} window.fetch = f; return body?.description || ''; }).catch(e => 'ERR ' + e.message);
    ok(/\d\. VO2max 1\/5 · 5:00 · avg 288 W · avg HR 165/.test(desc) && !/target/i.test(desc.split('Intervals:')[1] || 'target'), 'Strava description: "VO2max 1/5 · 5:00 · avg 288 W · avg HR 165", no target', desc.slice(-300));
    await p.click('#fDone'); await p.waitForTimeout(800);

    // ---- Rides & Records: Intervals over time (1280) ----
    await p.click('.tab[data-view="history"]'); await p.waitForSelector('#ivHist .ivhist', { timeout: 8000 });
    const h = await p.evaluate(() => { const r = document.querySelector('#ivHist'); return { sel: r.querySelector('#ivKind option:checked')?.textContent, dots: r.querySelectorAll('svg.ivchart circle.d1').length, hr: r.querySelectorAll('svg.ivchart circle.dhr').length,
      rows: [...r.querySelectorAll('.ivhtbl tr')].slice(1).map(tr => [...tr.cells].map(c => c.textContent)), tiles: r.querySelector('.ivtiles').textContent, w: Math.round(r.querySelector('svg.ivchart').getBoundingClientRect().width), vb: r.querySelector('svg.ivchart').getAttribute('viewBox') }; });
    ok(/^VO2max 5 min · VO2max 5 × 5 \(3×\)/.test(h.sel || ''), 'history: kind "VO2max 5 min · VO2max 5 × 5 (3×)" picked', h.sel);
    ok(h.dots === 3 && h.hr === 2, 'chart: 3 sessions of watts (orange), 2 with heart rate (own chart, the old ride has none)', JSON.stringify(h));
    ok(h.rows.length === 3 && h.rows[0][2] === '288' && h.rows[2][2] === '262' && h.rows[2][5] === '–' && h.rows[2][4] === '–', 'table: newest first, old ride with "–" for missing fields', JSON.stringify(h.rows));
    ok(/Best session.*288/.test(h.tiles) && /Latest session.*288.*\+26 W since/.test(h.tiles), 'best and latest session tiles', h.tiles);
    ok(h.vb.startsWith(`0 0 ${h.w} `), `chart drawn at its real width (${h.w} px): labels stay readable`, h.vb);
    if (SHOTS) { await p.locator('#ivHist').scrollIntoViewIfNeeded(); await p.locator('#ivHist').screenshot({ path: path.join(SHOTS, 'history_intervals_1280.png') }); }

    // ---- phone Stats page (390) ----
    await p.evaluate(async () => { const { db } = await import('/js/db.js'); for (const r of await db.all('rides')) { r.routeId = 'kueste60'; await db.put('rides', r); } }); // the phone pages leave out the demo route
    const q = await ctx.newPage(); q.on('pageerror', e => errs.push('stats: ' + e.message)); await q.setViewportSize({ width: 390, height: 844 });
    await q.goto(BASE + '/statistik.html'); await q.waitForSelector('#ivHist .ivhist', { timeout: 8000 });
    const ph = await q.evaluate(() => { const r = document.querySelector('#ivHist'), s = r.querySelector('svg.ivchart'), sb = s.getBoundingClientRect();
      return { dots: r.querySelectorAll('svg.ivchart circle.d1').length, w: Math.round(sb.width), vb: s.getAttribute('viewBox'), over: document.documentElement.scrollWidth > innerWidth, ax: Math.round(parseFloat(getComputedStyle(s.querySelector('.ax')).fontSize) * sb.width / +s.getAttribute('viewBox').split(' ')[2]) }; });
    ok(ph.dots === 3 && !ph.over && ph.ax >= 10, `phone: chart with 3 sessions, axis labels ${ph.ax} px, no sideways scroll`, JSON.stringify(ph));
    if (SHOTS) { await q.locator('#ivHist').scrollIntoViewIfNeeded(); await q.locator('#ivHist').screenshot({ path: path.join(SHOTS, 'history_intervals_390.png') }); }
    await q.close();

    // ---- the wizard in a workout: never in a rest, inside a hard interval at its target ----
    await startRide('&wizard');
    const wz = () => p.evaluate(() => { const z = window.__ride.wiz, c = document.querySelector('#hWiz'); return { st: z?.state, at: z?.at, W: z?.W, card: c && !c.hidden ? c.textContent : '', t: window.__ride.wNow?.plateau, step: window.__ride.wNow?.step?.label }; });
    await p.waitForTimeout(1500);
    const w0 = await wz();
    ok(w0.st === 'wait' && !w0.card, 'warm-up: no wizard', JSON.stringify(w0));
    await p.evaluate(() => { window.__ride.elapsed = __RS + 20; }); await p.waitForTimeout(2500);
    const w1 = await wz();
    ok(w1.step === 'Rest' && w1.st === 'wait' && !w1.card && !Number.isFinite(w1.at), 'rest: no wizard (he waits, not placed on the road)', JSON.stringify(w1));
    await p.evaluate(() => { window.__ride.elapsed = __B2 + 300 - 50; }); await p.waitForTimeout(1500);
    ok((await wz()).st === 'wait', '50 s left in the interval: too little for his trial, he waits for the next one');
    await p.evaluate(() => { window.__ride.elapsed = __C - 10; }); await p.waitForTimeout(400); // in the rest before VO2max 3/5: tune the intervals +10 W
    await p.evaluate(() => { window.__ride.elapsed = __C + 3; }); await p.waitForTimeout(300);
    await p.keyboard.press('w'); await p.keyboard.press('w'); await p.waitForTimeout(400);
    const w2 = await wz();
    ok(/^VO2max 3\/5/.test(w2.step) && (w2.st === 'ann' || w2.st === 'near' || w2.st === 'cast') && w2.W === w2.t && w2.card.includes(`${w2.t} W`), `hard interval: the wizard comes, his test = interval target ${w2.t} W (incl. +10 W)`, JSON.stringify(w2));
    await p.waitForFunction(() => window.__ride.wiz?.state === 'cast', null, { timeout: 40000 }).catch(() => {});
    await p.waitForTimeout(2500);
    const w3 = await wz();
    ok(w3.st === 'cast' && /The Wizard’s test/.test(w3.card) && w3.card.includes(`Target ${w3.t} W`), `trial running inside the interval: "Target ${w3.t} W"`, JSON.stringify(w3));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'wizard_in_interval_1280.png') });
    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + (e.stack || e.message)); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} of ${n} failed` : `\nIV stats UI: all ${n} good`); process.exit(fails ? 1 : 0);
})();
