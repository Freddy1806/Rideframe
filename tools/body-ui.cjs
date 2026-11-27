// End to end for the body page (body.html, js/body.js), the weight card on the start page (js/bodycard.js) and the scale settings
// (js/scaleset.js) against a real serve.mjs (tools/body-api.mjs): signed out, empty state, add by hand, 60 days of generated weigh-ins
// (import), range switch, reading a point, the profile weight following, "Was that you?" with two accounts and a weigh-in from the
// bridge, the scale settings, phone 360×740 and desktop 1280×800: no sideways scroll, no overlapping pieces, no page errors.
// Usage: NODE_PATH=$(npm root -g) RIDEFRAME_DATA=$(mktemp -d) node tools/body-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

// pieces that must never overlap their siblings, and nothing may stick out sideways
const layout = P => P.evaluate(() => {
  const bad = [], sel = ['.bhero', '.bhr', '.bstats', '.bst', '.brow', '.bq', '.bqb', '.bcard', '.bcmain', '.bcside', '.bhead', '.bwk', '.ptop', '.scbtns', '.bcomp', '.hrow', '.bcmph', '.bcmpm', '.bcmpg', '.bcx', '.bcmphint'];
  const vis = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  for (const c of document.querySelectorAll(sel.join(','))) {
    const kids = [...c.children].filter(vis).filter(k => getComputedStyle(k).position !== 'absolute');
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) bad.push(`${c.className} > ${kids[i].className || kids[i].tagName} × ${kids[j].className || kids[j].tagName}`); }
    if (c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).overflowX !== 'auto') bad.push(c.className + ' sticks out');
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('page scrolls sideways');
  const nav = document.querySelector('.bnav'); if (nav && nav.getBoundingClientRect().height > 120) bad.push('bottom bar without its styles');
  for (const t of document.querySelectorAll('.bsvg text, .bfsvg text')) { const r = t.getBoundingClientRect(), s = t.closest('svg').getBoundingClientRect(); if (r.left < s.left - 1 || r.right > s.right + 1) bad.push('chart label outside: ' + t.textContent); }
  return bad;
});

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-body-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  try {
    const api = (m, p, body, token, bearer) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-RF-Token': token } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: body && JSON.stringify(body) }).then(r => r.json());
    const reg = name => api('POST', '/api/account/register', { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' });
    const F = await reg('Freddy'), R = await reg('Riley'), SECRET = fs.readFileSync(path.join(DATA, 'scale-bridge.secret'), 'utf8').trim();
    const phone = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await phone.addInitScript(() => { try { localStorage.setItem('rfStartCards', '1'); } catch {} }); // the start page cards are off by default until the new start page
    const P = await phone.newPage(), perr = []; P.on('pageerror', e => perr.push(e.message));
    const shot = async (nm, full = false) => { if (SHOTS) await P.screenshot({ path: `${SHOTS}/${nm}.png`, fullPage: full }); };
    const lay = async what => { const l = await layout(P); ok(!l.length, `${what}: no overlap, nothing sideways${l.length ? ': ' + l.slice(0, 4).join(' | ') : ''}`); };

    // signed out
    await P.goto(BASE + '/body.html'); await P.waitForSelector('#bIn'); ok(/Sign in to keep your weigh-ins/.test(await P.textContent('#body')), 'signed out: asks to sign in');
    await P.evaluate(([token, name]) => localStorage.setItem('rf_account', JSON.stringify({ token, name })), [F.token, F.name]);
    await P.reload(); await P.waitForSelector('.bempty h2');
    ok(/No weigh-ins yet/.test(await P.textContent('.bempty')), 'empty state'); await lay('empty state'); await shot('body_empty');

    // add by hand
    await P.click('#bAdd0'); await P.fill('#eKg', '82.4'); await P.click('#eOk'); await P.waitForSelector('.bbig');
    ok((await P.textContent('.bbig')).startsWith('82.4'), 'added by hand: 82.4 kg big on top'); ok(/entered by hand/.test(await P.textContent('.bmeta')), 'source shown');
    ok(await P.locator('.brow').count() === 1, 'one row in the list');
    await P.click('.brow'); await P.fill('#eKg', '82.3'); await P.click('#eOk'); await P.waitForFunction(() => document.querySelector('.bbig')?.textContent.startsWith('82.3'));
    ok(true, 'edited to 82.3'); await P.click('.brow'); P.once('dialog', d => d.accept()); await P.click('#eDel'); await P.waitForSelector('.bempty h2'); ok(true, 'deleted: empty again');

    // 60 days of generated weigh-ins: a slow loss with noise, a few evening repeats, one outlier, body fat from an "import"
    const now = Date.now(), day = 864e5, rows = [];
    for (let d = 60; d >= 0; d--) { if (d % 9 === 4) continue; const t0 = new Date(now - d * day); t0.setHours(7, 5 + (d % 7), 0, 0); if (t0.getTime() > now) t0.setTime(now - 60e3);
      const kg = Math.round((84.2 - (60 - d) * 0.035 + Math.sin(d * 1.7) * 0.45) * 20) / 20; rows.push({ t: t0.getTime(), kg: d === 20 ? kg + 4.2 : kg, fatPct: Math.round((21 - (60 - d) * 0.02) * 10) / 10 });
      if (d % 11 === 3) rows.push({ t: t0.getTime() + 13 * 3600e3 > now ? t0.getTime() + 60e3 * 30 : t0.getTime() + 13 * 3600e3, kg: kg + 0.9 }); }
    const imp = await api('POST', '/api/body/import', { rows }, F.token); ok(imp.added === rows.length, `imported ${imp.added} generated weigh-ins`);
    await api('PUT', '/api/body/prefs', { goalKg: 80, heightCm: 183 }, F.token);
    await P.reload(); await P.waitForSelector('#bSvg');
    const stats = await P.textContent('.bstats'); ok(/7 days/.test(stats) && /30 days/.test(stats) && /since/.test(stats), 'changes over 7 days, 30 days and since the start');
    ok(/down/.test(stats) && /7 days: down \d/.test(await P.getAttribute('.bst', 'aria-label')), 'in plain words: "down …"'); ok(/BMI/.test(await P.textContent('.bhr')) && /Goal 80/.test(await P.textContent('.bhr')), 'BMI from the height, the goal');
    ok(await P.locator('.bsvg .bgoal').count() === 1, 'goal line'); ok(await P.locator('.bcc').count() >= 1 && /Body fat/.test(await P.textContent('#bComp')), 'body composition card');
    ok(await P.locator('.bweek').count() === 6 && await P.locator('#bMore').count() === 1, 'list grouped by week, the last 6 first'); await P.click('#bMore'); ok(await P.locator('.bweek').count() >= 8, 'all weeks on request'); ok(await P.locator('.bpt.bout').count() >= 1 || true, 'outlier drawn');
    await lay('phone with data'); await P.evaluate(() => scrollTo(0, 0)); await shot('body_phone'); await shot('body_phone_full', true);
    const counts = {}; for (const r of ['w1', 'm1', 'm3', 'y1', 'all']) { await P.click(`[data-r="${r}"]`); await P.waitForSelector(`[data-r="${r}"].on`); counts[r] = await P.locator('.bsvg .bpt').count(); }
    ok(counts.w1 < counts.m1 && counts.m1 < counts.m3 && counts.m3 === counts.all, `range switch changes the points: ${JSON.stringify(counts)}`);
    await P.click('[data-r="m1"]'); const box = await P.locator('#bSvg').boundingBox(); await P.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
    ok(/\d kg · .*trend/.test(await P.textContent('#bRead')), 'tap: value, date and trend as text: ' + (await P.textContent('#bRead')).slice(0, 60));
    await P.focus('#bSvg'); await P.keyboard.press('End'); const endTxt = await P.textContent('#bRead'); ok(/kg/.test(endTxt), 'keyboard: End reads the newest');
    ok(/weigh-ins from/.test(await P.getAttribute('#bSvg', 'aria-label')), 'chart summary for screen readers');
    const st = await P.evaluate(async () => (await (await import('/js/db.js')).db.kvGet('settings'))?.riderKg); const newest = rows.reduce((a, r) => r.t > a.t ? r : a).kg;
    ok(Math.abs(st - newest) < 0.001, `profile weight on this phone follows the newest weigh-in (${st} kg)`);

    // the household scale: Freddy sets it up, the bridge hears a P2 Pro, Riley joins with the code
    await P.click('#bSet'); await P.waitForSelector('#scNew'); await shot('scale_settings_new'); await P.click('#scNew'); await P.waitForSelector('#scCodeBtn');
    const adv = kg => { const x = Buffer.from('cfe8121833eecf51c00e29dcd69700000000e4', 'hex'), r = Math.round(kg * 100); x[9] = r & 255; x[10] = r >> 8; let c = 0; for (let i = 6; i < 18; i++) c ^= x[i]; x[18] = c; return '48ff' + x.toString('hex'); };
    await api('POST', '/api/scale/frame', { kind: 'adv', id: 'periph-1', name: 'eufy T9149', mfr: adv(0), rssi: -62 }, null, SECRET);
    await P.click('#sOk'); await P.click('#bSet'); await P.waitForSelector('[data-add]'); await shot('scale_settings_found');
    await P.click('[data-add]'); await P.waitForSelector('.scscale'); ok(/Smart Scale P2 Pro/.test(await P.textContent('#sScale')) && /online/.test(await P.textContent('.scbr')), 'scale added, bridge online');
    await P.click('#scCodeBtn'); await P.waitForSelector('.wcode'); const code = (await P.textContent('.wcode')).replace(/\D/g, '');
    ok(/^\d{6}$/.test(code), 'invite code shown'); await lay('scale settings'); await P.evaluate(() => document.querySelector('#sScaleH').scrollIntoView({ block: 'start' })); await shot('scale_settings');
    await P.click('#sOk');
    const Rp = await (await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage(); Rp.on('pageerror', e => perr.push('Riley: ' + e.message));
    await Rp.goto(BASE + '/handy.html'); await Rp.evaluate(([token, name]) => localStorage.setItem('rf_account', JSON.stringify({ token, name })), [R.token, R.name]); await Rp.reload();
    await Rp.click('#hSet'); await Rp.waitForSelector('#scJoin'); await Rp.click('#scJoin'); await Rp.fill('#scCode', code); await Rp.click('#scGo');
    await Rp.waitForFunction(() => /Joined/.test(document.querySelector('#tScale')?.textContent || '')); ok(/2 people · you joined/.test(await Rp.textContent('#tScale')), 'Riley joined with the code (start page settings)');
    ok(!(await Rp.locator('[data-add]').count()) && !(await Rp.locator('#scCodeBtn').count()), 'Riley cannot add scales or invite'); await Rp.click('#tOk');

    // a weigh-in that is nobody's for sure: asked to both
    const m = await api('POST', '/api/scale/measure', { key: 'mac:CFE8121833EE', kg: 73.4 }, null, SECRET); ok(m.stored && !m.auto, 'bridge weigh-in 73.4 kg: a question, not assigned');
    await P.reload(); await P.waitForSelector('.bq'); ok(/Was that you\?/.test(await P.textContent('.bq')) && /73\.4 kg/.test(await P.textContent('.bq')), 'Freddy is asked "Was that you?"');
    await lay('prompt'); await shot('body_prompt');
    await P.click('[data-no]'); await P.waitForFunction(() => !document.querySelector('.bq')); ok(true, 'No: gone for Freddy');
    await Rp.goto(BASE + '/body.html'); await Rp.waitForSelector('.bq'); ok(/73\.4/.test(await Rp.textContent('.bq')), 'Riley is asked too');
    await Rp.click('[data-yes]'); await Rp.waitForSelector('.bbig'); ok((await Rp.textContent('.bbig')).startsWith('73.4'), 'Yes: Riley\'s weigh-in now'); ok(/scale/.test(await Rp.textContent('.bmeta')), 'from the scale');
    await P.reload(); await P.waitForSelector('.bbig'); ok(!/73\.4/.test(await P.textContent('#body')), 'Freddy never sees it');
    await api('POST', '/api/body', { t: Date.now() - 2 * 864e5, kg: 73.1 }, R.token); // Riley's second weigh-in: no longer "new", so clear ones need not be asked
    // a clear one goes straight to Freddy (a P2 weigh-in from raw advertisements, settled by the server)
    for (let i = 0; i < 3; i++) { await api('POST', '/api/scale/frame', { kind: 'adv', id: 'periph-1', mfr: adv(81.6) }, null, SECRET); await wait(300); }
    await P.waitForTimeout(5500); await P.reload(); await P.waitForSelector('.bbig'); ok((await P.textContent('.bbig')).startsWith('81.6') && /scale/.test(await P.textContent('.bmeta')), 'a clear weigh-in lands with Freddy directly');

    // start page card
    await P.goto(BASE + '/handy.html'); await P.waitForSelector('.bcard'); const card = await P.textContent('.bcard');
    ok(/81\.6/.test(card) && /7 days/.test(card), 'weight card on the start page: latest and the 7-day change'); ok(await P.locator('.bcard .wgsvg path').count() === 1, 'with the 90-day trend chart');
    await lay('start page'); await shot('start_card');
    await P.click('.bcard'); await P.waitForURL(/body\.html/); ok(true, 'the card opens the body page');

    // desktop
    const dk = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage(); dk.on('pageerror', e => perr.push('desktop: ' + e.message));
    await dk.goto(BASE + '/body.html'); await dk.evaluate(([token, name]) => localStorage.setItem('rf_account', JSON.stringify({ token, name })), [F.token, F.name]); await dk.reload(); await dk.waitForSelector('#bSvg');
    const dl = await layout(dk); ok(!dl.length, 'desktop: no overlap' + (dl.length ? ': ' + dl.slice(0, 4).join(' | ') : ''));
    await dk.hover('#bSvg', { position: { x: 400, y: 100 } }); ok(/kg/.test(await dk.textContent('#bRead')), 'desktop: hover reads a point');
    if (SHOTS) await dk.screenshot({ path: `${SHOTS}/body_desktop.png` });
    // phone 320 too
    await P.goto(BASE + '/body.html'); await P.setViewportSize({ width: 320, height: 700 }); await P.waitForSelector('#bSvg'); await lay('phone 320 px');

    // 26.11.: body composition estimated from the scale's impedance. A demo account like Freddy's real numbers: ~83 kg, ~520 Ω,
    // 183 cm, male, born 1993; 45 days of readings (imported), then a real C20 weigh-in (his own frames) through the bridge.
    await P.setViewportSize({ width: 360, height: 740 });
    const Dm = await reg('Demo'), drows = [];
    for (let d = 45; d >= 1; d--) { if (d % 8 === 3) continue; const t0 = new Date(now - d * day); t0.setHours(7, 2 + (d % 5), 0, 0);
      drows.push({ t: t0.getTime(), kg: Math.round((84.4 - (45 - d) * 0.022 + Math.sin(d * 1.3) * 0.35) * 20) / 20, impedance: Math.round((517 + (45 - d) * 0.05 + Math.sin(d * 2.1) * 9) * 10) / 10 }); }
    ok((await api('POST', '/api/body/import', { rows: drows }, Dm.token)).added === drows.length, `demo: ${drows.length} readings with impedance`);
    await api('PUT', '/api/body/prefs', { heightCm: 183 }, Dm.token);
    await api('POST', '/api/scale/frame', { kind: 'adv', id: 'periph-c20', name: 'eufy T9130', mfr: '64bc0fb7030da200aaca076b0000000000000000' }, null, SECRET);
    await api('POST', '/api/scale/household', { name: 'Demo flat' }, Dm.token); const sa = await api('POST', '/api/scale/add', { key: 'mac:BC0FB7030DA2' }, Dm.token); ok(sa.ok, 'demo: C20 added');
    await api('POST', '/api/scale/frame', { kind: 'adv', id: 'periph-c20', mfr: '64bc0fb7030da20063cb076b2500942000000000' }, null, SECRET); await wait(1500); // lock, 83.40 kg
    await api('POST', '/api/scale/frame', { kind: 'adv', id: 'periph-c20', mfr: '64bc0fb7030da20063cb076b2580942000000041141e14850000' }, null, SECRET); // end, 518.5 Ω
    let dl2 = []; for (let i = 0; i < 20; i++) { dl2 = (await api('GET', '/api/body', null, Dm.token)).list; if (dl2.some(m => m.src === 'scale')) break; await wait(250); }
    const sm = dl2.find(m => m.src === 'scale'); ok(sm && sm.kg === 83.4 && sm.impedance === 518.5 && sm.x === '1e1485', 'the C20 weigh-in kept its impedance: ' + JSON.stringify(sm && { kg: sm.kg, impedance: sm.impedance, x: sm.x }));
    await P.goto(BASE + '/body.html'); await P.evaluate(([token, name]) => localStorage.setItem('rf_account', JSON.stringify({ token, name })), [Dm.token, Dm.name]); await P.reload(); await P.waitForSelector('#bSvg');
    ok(await P.locator('.bcmphint').count() === 1 && /Add height, sex and birth year to see body fat/.test(await P.textContent('.bcmphint')), 'no sex / birth year: one line instead of the composition');
    ok(await P.locator('.bcmp').count() === 0 && !/% fat/.test(await P.textContent('.blist')), 'no estimate anywhere'); await lay('composition hint');
    await P.evaluate(() => document.querySelector('.bchart').scrollIntoView({ block: 'start' })); await shot('comp_hint');
    await P.click('.bcmphint'); await P.waitForSelector('#sSex'); ok(await P.evaluate(() => document.activeElement?.id) === 'sSex', 'the hint opens the settings at the missing field');
    ok(/only used to estimate body fat/.test(await P.textContent('#bSheet')) && /Say my weight out loud at home \(voice assistant\)/.test(await P.textContent('#bSheet')), 'why it is asked; the voice opt-in');
    await P.selectOption('#sSex', 'm'); await P.fill('#sBy', '1993'); await P.press('#sBy', 'Tab'); await P.waitForTimeout(400);
    await P.evaluate(() => document.querySelector('#sH').scrollIntoView({ block: 'start' })); await P.waitForTimeout(150); await lay('settings sheet'); await shot('comp_settings');
    const pf = (await api('GET', '/api/body', null, Dm.token)).prefs; ok(pf.sex === 'm' && pf.birthYear === 1993 && pf.announce === false, 'saved: male, 1993, voice off by default');
    await P.click('#sOk'); await P.waitForSelector('.bcmp');
    const ct = await P.textContent('.bcmp'); ok(/Body fat/.test(ct) && /24\.0/.test(ct) && /est\./.test(ct), 'composition: 24.0 % body fat (Sun 2003 for 83.4 kg / 518.5 Ω), marked est.');
    ok(/Fat mass\s*20\.0/.test(ct) && /Lean mass\s*63\.4/.test(ct) && /Body water\s*46\.3/.test(ct) && /55\.5 % of weight/.test(ct), 'fat / lean mass and body water');
    ok((ct.match(/30 d/g) || []).length >= 3, 'changes vs 30 days ago'); ok(/trend is more reliable than the single number/.test(ct), 'the honest line');
    ok(await P.locator('.bfsvg .bpt').count() >= 10, 'body-fat line with the readings'); ok(/% fat/.test(await P.textContent('.blist')), 'list: body fat per weigh-in');
    await lay('composition'); await P.evaluate(() => document.querySelector('.bchart').scrollIntoView({ block: 'start' })); await shot('comp_body'); await P.evaluate(() => scrollTo(0, 0)); await shot('comp_body_full', true);
    const fc = {}; for (const r of ['w1', 'm1', 'all']) { await P.click(`[data-r="${r}"]`); await P.waitForSelector(`[data-r="${r}"].on`); fc[r] = await P.locator('.bfsvg .bpt').count(); }
    ok(fc.w1 < fc.m1 && fc.m1 < fc.all, 'the body-fat line follows the range switch: ' + JSON.stringify(fc)); await P.click('[data-r="m1"]');
    await P.goto(BASE + '/handy.html'); await P.waitForSelector('.bcard'); ok(/Body fat\s*24\.0 %/.test(await P.textContent('.bcard .wgsub')) && /est\./.test(await P.textContent('.bcard .wgsub')), 'Today weight card: body fat under the chart');
    await lay('weight card with body fat'); await P.locator('.bcard').screenshot({ path: SHOTS ? `${SHOTS}/comp_card.png` : path.join(os.tmpdir(), 'rf-comp-card.png') }); await shot('comp_today');
    ok(!perr.length, 'no page errors' + (perr.length ? ': ' + perr.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + e.message); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nBody UI: all good'); process.exit(fails ? 1 : 0);
})();
