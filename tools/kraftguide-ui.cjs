// Guided strength workouts on kraft.html (js/kraftplayer.js, plans in js/kraftguide.js): the two cards on the Workout tab,
// the intro sheet (level picker, steps, safety note), a whole one-arm pull-up run through on Playwright's fake clock
// (step order, reps correction, recorded seconds, rest +15 s, a reload in the middle that comes back paused with Resume),
// the summary, the saved history entry, and the level-up suggestion after a second strong session. Also the push-up plan
// starts, and the player fits 360×640 without sideways scrolling. Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) node tools/kraftguide-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-kraftguide-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.clock.install({ time: new Date('2026-11-20T08:00:00') });
    await p.goto(BASE + '/kraft.html'); await p.waitForSelector('#kNew'); await p.clock.pauseAt(new Date('2026-11-20T08:00:05')); // time moves only when the test says so
    await p.evaluate(async () => { const { db } = await import('/js/db.js'); await db.kvSet('settings', { theme: 'dark' }); });
    await p.reload(); await p.waitForSelector('[data-guide]');
    const shot = async n => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.jpg`, type: 'jpeg', quality: 88 }); };
    const accent = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    ok(accent === '#ff4f9a', `Strength accent is pink (${accent})`);

    // ---- the two cards ----
    const cards = await p.$$eval('[data-guide]', l => l.map(c => ({ id: c.dataset.guide, t: c.textContent.replace(/\s+/g, ' ').trim() })));
    ok(cards.length === 2 && cards[0].id === 'oapull' && cards[1].id === 'oapush', `two guided cards (${cards.map(c => c.id)})`);
    const minOf = t => +(t.match(/≈ (\d+) min/) || [])[1];
    ok(cards.every(c => minOf(c.t) >= 18 && minOf(c.t) <= 22 && /Level 1/.test(c.t)), `cards show ≈ minutes and the level (${cards.map(c => minOf(c.t))})`);
    const want = await p.evaluate(async () => { const G = await import('/js/kraftguide.js'); return G.PLANS.map(x => Math.round(G.planSeconds(G.buildSteps(x, 1, x.base)) / 60)); });
    ok(cards.every((c, i) => minOf(c.t) === want[i]), `card minutes = computed plan length (${want})`);
    await p.evaluate(() => document.querySelector('.kgcards').scrollIntoView({ block: 'center' })); await shot('01_start_cards');
    await p.evaluate(() => scrollTo(0, 0));

    // ---- intro sheet ----
    await p.click('[data-guide="oapull"]'); await p.waitForSelector('.kgsheet');
    const intro = await p.evaluate(() => ({ lv: [...document.querySelectorAll('.kgsheet [data-lv]')].map(b => b.textContent.trim()), on: document.querySelector('.kgsheet [data-lv].on')?.dataset.lv,
      steps: document.querySelectorAll('#giSteps li').length, safe: document.querySelector('.kgsafe').textContent, need: document.querySelector('.kgneed').textContent, meta: document.querySelector('#giMeta').textContent }));
    ok(intro.lv.length === 3 && intro.on === '1' && /Assisted/.test(intro.lv[0]) && /Free/.test(intro.lv[2]), `intro: 3 levels, level 1 preselected (${intro.lv.join(' | ')})`);
    ok(intro.steps === 3 && /Pull-up bar/.test(intro.need) && /14\s*sets/.test(intro.meta), `intro: what you need, 3 blocks, 14 sets (${intro.meta})`);
    ok(/Stop if your elbow or shoulder hurts\. Train this at most every other day\./.test(intro.safe), 'intro: safety note');
    await p.click('.kgsheet [data-lv="2"]'); ok(/Two fingers/.test(await p.textContent('#giHow')), 'intro: level 2 explained when picked');
    await p.click('.kgsheet [data-lv="1"]');
    await shot('02_intro');
    await p.click('#giGo'); await p.waitForSelector('#kgPlayer');

    // ---- the run on the fake clock ----
    const plan = await p.evaluate(async () => { const G = await import('/js/kraftguide.js'); return G.buildSteps(G.planOf('oapull'), 1).map(s => ({ kind: s.kind, n: s.n, title: s.title || '', target: s.target || 0, reps: s.reps || 0, sec: s.sec || 0 })); });
    const st = () => p.evaluate(() => { const r = document.querySelector('#kgPlayer'); return r && { kind: r.dataset.kind, title: r.querySelector('.kgtitle')?.textContent || '', step: r.querySelector('#kgStep')?.textContent, num: r.querySelector('#kgNum')?.textContent, paused: r.classList.contains('paused'), next: r.querySelector('.kgnext b')?.textContent || '' }; });
    const ff = ms => p.clock.fastForward(ms).then(() => p.clock.runFor(150));
    const seen = [], rec = {}; let i = 0, reloaded = false, skipNext = false, s;
    const secsFor = n => 9 + (n % 3); // what the test "holds": 9, 10, 11 s
    while (i < plan.length) {
      s = await st(); const want2 = plan[i];
      if (!s || s.kind !== want2.kind) { ok(false, `step ${i}: expected ${want2.kind}, got ${s?.kind}`); break; }
      seen.push(s.kind + (want2.title ? ':' + s.title : ''));
      if (s.kind === 'ready' || s.kind === 'rest') {
        if (s.kind === 'rest' && i === 2) { // the first rest: correct the reps just done, +15 s, screenshot
          ok(/6 reps/.test(await p.textContent('.kgrec')), 'rest shows the reps just done (corrected to 6)');
          const t0 = await p.textContent('#kgNum'); await p.click('[data-a="more"]'); await p.clock.runFor(150); const t1 = await p.textContent('#kgNum');
          ok(t0 === '1:15' && t1 === '1:30', `+15 s lengthens the rest (${t0} → ${t1})`);
          await ff(30000); await shot('04_player_rest');
          await ff(61000);
        } else if (skipNext) { skipNext = false; await p.click('[data-a="skip"]'); await p.clock.runFor(150); } // the rest after the reload: Skip rest
        else await ff(want2.sec * 1000 + 100);
        i++; continue;
      }
      if (s.kind === 'reps') {
        ok(s.num === String(want2.reps), `set ${want2.n + 1}: target ${want2.reps} reps shown`);
        if (want2.n === 0) { await p.click('[data-a="rp"]'); rec[0] = 6; } else rec[want2.n] = want2.reps;
        await p.click('[data-a="done"]'); await p.clock.runFor(150); i++; continue;
      }
      // hold / negative: counts up past the target until Done
      const sec = secsFor(want2.n);
      if (want2.n === 2) { await ff(4000); const m = await st(); ok(m.num === '4' && /LEFT ARM/.test(m.title), `hold counts up (${m.num} s, ${m.title})`); await shot('03_player_hold'); await ff((sec - 4) * 1000); }
      else await ff(sec * 1000);
      const m = await st(); ok(+m.num === sec, `${want2.kind} ${want2.title}: ${m.num} s on the clock (target ${want2.target}, past it)`);
      await p.click('[data-a="done"]'); await p.clock.runFor(150); rec[want2.n] = sec; i++;
      if (want2.n === 7 && !reloaded) { // reload in the rest after the 8th effort: the run comes back paused, Resume goes on
        reloaded = true; await p.clock.runFor(2500);
        await p.reload(); await p.waitForSelector('#kgPlayer'); await p.clock.runFor(300);
        const r = await st(); ok(r.paused && r.kind === 'rest' && r.step === '9', `after a reload the run is back, paused (step ${r.step}, ${r.kind})`);
        ok(await p.isVisible('.kgpaused'), 'the paused screen offers Resume');
        await ff(20000); const r2 = await st(); ok(r2.kind === 'rest' && r2.num === r.num, `paused: the rest timer stands (${r.num} = ${r2.num})`);
        await p.click('.kgpaused'); await p.clock.runFor(200); ok(!(await st()).paused, 'Resume goes on'); skipNext = true;
      }
    }
    const order = plan.map(x => x.kind + (x.title ? ':' + x.title : ''));
    ok(JSON.stringify(seen) === JSON.stringify(order.slice(0, seen.length)) && seen.length === order.length, `step order as planned (${seen.length} steps: ready, warm-up, rest, … holds L/R, negatives L/R)`);

    // ---- summary and the saved workout ----
    await p.waitForSelector('.kgsum'); const sum = await p.textContent('.kgsum');
    ok(/Workout complete/.test(sum) && /Best hold/.test(sum) && /Best negative/.test(sum), 'summary: complete, best hold and negative per arm');
    ok(/Your first session/.test(sum) && !/Level up/.test(sum), 'summary: first session, no level-up yet');
    await shot('05_summary_first');
    const saved = await p.evaluate(async () => { const { db } = await import('/js/db.js'); return { list: await db.kvGet('kraft'), draft: await db.kvGet('kraftGuideDraft') }; });
    const w = saved.list?.[0];
    ok(saved.list?.length === 1 && w.guide?.id === 'oapull' && w.guide.lvl === 1 && !saved.draft, `saved to the history (guide ${JSON.stringify(w?.guide)}), draft gone`);
    ok(JSON.stringify(w.ex.map(x => x.k)) === JSON.stringify(['pull', 'oap_hold_l', 'oap_hold_r', 'oap_neg_l', 'oap_neg_r']), `one exercise per arm (${w.ex.map(x => x.k)})`);
    const got = {}; { const ef = plan.filter(x => x.kind !== 'ready' && x.kind !== 'rest'); const cnt = {}; for (const e of ef) { const x = w.ex.find(y => y.k === (e.kind === 'reps' ? 'pull' : `oap_${e.kind}_${e.title.startsWith('LEFT') ? 'l' : 'r'}`)); const j = cnt[x.k] = (cnt[x.k] ?? -1) + 1; got[e.n] = e.kind === 'reps' ? x.sets[j].r : x.sets[j].s; } }
    ok(JSON.stringify(got) === JSON.stringify(rec), `recorded reps and seconds match (${Object.values(got).join(',')})`);
    ok(w.ex[1].t === 'time' && w.ex[1].sets.every(y => y.done && y.lvl === 1), 'holds stored as time sets with the level');
    ok(w.dur > 1100 && w.dur < 1500, `duration ${w.dur} s (pause left out)`);
    await p.click('#kgDone'); await p.waitForTimeout(300);
    ok(!(await p.$('#kgPlayer')) && await p.isVisible('.psheet') && /One-arm pull-up training/.test(await p.textContent('.psheet')) && /Guided · Level 1/.test(await p.textContent('.psheet')), 'Done: the session sheet in the history');
    await p.evaluate(() => document.querySelectorAll('.psheet').forEach(x => x.remove()));
    await p.click('[data-tab="hist"]'); ok(/One-arm pull-up training/.test(await p.textContent('.kmain')), 'listed in the history');
    await p.click('[data-tab="ex"]'); const exl = await p.textContent('#kExList');
    ok(/One-arm lock-off hold \(left\)/.test(exl) && /11 s/.test(exl), 'the per-arm exercises are in the exercise list with their best');
    await p.click('[data-tab="start"]');

    // ---- second strong session: level up suggested, level 2 preselected next time ----
    await p.clock.fastForward(2 * 864e5);
    await p.click('[data-guide="oapull"]'); await p.waitForSelector('.kgsheet'); ok((await p.$eval('.kgsheet [data-lv].on', x => x.dataset.lv)) === '1', 'second time: still level 1');
    await p.click('#giGo'); await p.waitForSelector('#kgPlayer');
    for (let k = 0; k < 80; k++) { await p.waitForTimeout(60); s = await st(); if (!s || !s.kind || s.kind === 'sum' || await p.$('.kgsum')) break;
      if (s.kind === 'ready' || s.kind === 'rest') { await p.click('[data-a="skip"]'); await p.clock.runFor(150); } else if (s.kind === 'reps') { await p.click('[data-a="done"]'); await p.clock.runFor(150); } else { await ff(8500); await p.click('[data-a="done"]'); await p.clock.runFor(150); } }
    await p.waitForSelector('.kgsum'); const sum2 = await p.textContent('.kgsum');
    ok(/Level up earned/.test(sum2) && /Level 2 · Two fingers/.test(sum2), 'summary: level-up earned, next time level 2');
    ok(/Compared with/.test(sum2) && /−/.test(sum2), 'summary: compared with last time (8 s against 9-11 s → minus)');
    await shot('06_summary_levelup');
    await p.click('#kgDone'); await p.waitForTimeout(200); await p.evaluate(() => document.querySelectorAll('.psheet').forEach(x => x.remove()));
    await p.click('[data-tab="start"]'); ok(/Level 2/.test(await p.textContent('[data-guide="oapull"]')), 'the card now says Level 2');
    await p.click('[data-guide="oapull"]'); await p.waitForSelector('.kgsheet'); ok((await p.$eval('.kgsheet [data-lv].on', x => x.dataset.lv)) === '2', 'intro preselects level 2');
    await p.evaluate(() => document.querySelectorAll('.psheet').forEach(x => x.remove()));

    // ---- push-up plan: starts, close asks, discard leaves nothing ----
    await p.click('[data-guide="oapush"]'); await p.waitForSelector('.kgsheet'); await p.click('#giGo'); await p.waitForSelector('#kgPlayer');
    ok((await st()).step === '1' && /16/.test(await p.textContent('.kgpos')), 'push-up plan: 16 sets');
    await ff(5200); ok((await st()).num === '10', 'push-up warm-up: 10 reps');
    await p.click('[data-a="close"]'); await p.waitForSelector('.kgclose'); await p.click('#kcDrop'); await p.waitForTimeout(200);
    ok(!(await p.$('#kgPlayer')) && !(await p.evaluate(async () => (await import('/js/db.js')).db.kvGet('kraftGuideDraft'))), 'Close → Discard: player gone, no draft');
    const n = await p.evaluate(async () => (await (await import('/js/db.js')).db.kvGet('kraft')).length); ok(n === 2, `nothing saved by the discarded run (${n} workouts)`);

    // ---- small phone: 360×640, nothing cut off, no sideways scroll ----
    await p.setViewportSize({ width: 360, height: 640 });
    const over = () => p.evaluate(() => { const W = document.documentElement.clientWidth, H = innerHeight, bad = [];
      for (const e of document.querySelectorAll('#kgPlayer *')) { const r = e.getBoundingClientRect(); if (!r.width || e.closest('svg')) continue; if (r.right > W + 1 || r.left < -1 || r.bottom > H + 1) bad.push(e.className || e.tagName); }
      return { sx: document.documentElement.scrollWidth > W, bad: bad.slice(0, 5) }; });
    await p.click('[data-guide="oapush"]'); await p.waitForSelector('.kgsheet'); await p.click('#giGo'); await p.waitForSelector('#kgPlayer');
    let o = await over(); ok(!o.sx && !o.bad.length, `360×640 get ready fits (${o.bad})`); if (SHOTS) await p.screenshot({ path: `${SHOTS}/07_360_ready.jpg`, type: 'jpeg', quality: 85 });
    await ff(5200); o = await over(); ok(!o.sx && !o.bad.length, `360×640 reps fits (${o.bad})`);
    await p.click('[data-a="done"]'); await p.clock.runFor(150); o = await over(); ok(!o.sx && !o.bad.length, `360×640 rest fits (${o.bad})`); if (SHOTS) await p.screenshot({ path: `${SHOTS}/08_360_rest.jpg`, type: 'jpeg', quality: 85 });
    await ff(61000); await ff(5200); await p.click('[data-a="done"]'); await p.clock.runFor(150); await ff(61000); await ff(5200); await ff(3000);
    o = await over(); ok((await st()).kind === 'hold' && !o.sx && !o.bad.length, `360×640 hold fits (${o.bad})`); if (SHOTS) await p.screenshot({ path: `${SHOTS}/09_360_hold.jpg`, type: 'jpeg', quality: 85 });
    ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  } catch (e) { ok(false, 'crashed: ' + (e.stack || e)); }
  finally { await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }
  console.log(fails ? `\n${fails} failed` : '\nall passed'); process.exit(fails ? 1 : 0);
})();
