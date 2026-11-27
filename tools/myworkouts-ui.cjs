// Personal workouts end to end with the workout builder (js/wbuilder.js, owner 24.11.: "rebuild the builder exactly like the
// Garmin Connect one"; before, 17.11.: "personalise the workout for the route, save it under my name, find and edit it in my
// profile"). Desktop 1280 × 800: River Valley, Customise on VO2max 5 × 3 (its set comes in as a repeat block ×5), a step
// changed, saved as "My VO2" (on the server as steps v2), in the route's workout choice; the long coach workout keeps every
// step; the route fit line; Profile → My workouts (FTP, duplicate, delete). The builder's flow: a new workout starts with warm
// up / bike / cool down, Add a step, every duration and every target type, Add repeat with × N, skip last recovery, drag and
// drop by mouse (in and out of the repeat, the whole block) and by keyboard, Undo after delete, notes, save, reopen. The ride:
// a lap-button warm-up ended by "Next step", the repeat ridden expanded, the phone remote's Next, a heart-rate target shown as
// a band (no ERG); "My VO2"'s first target and the saved ride's name. Phone 360 × 740: compact cards, the step sheet, drag by
// touch, no sideways scrolling and no overlapping controls; the indoor page lists it; signed out → upload after sign-in; and
// the whole thing by gamepad. Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) node tools/myworkouts-ui.cjs [shotsDir]   (with a folder: screenshots at device scale 2)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS) { if (/^https?:/.test(SHOTS)) { console.log('The first argument is a screenshot folder, not a URL.'); process.exit(2); } fs.mkdirSync(SHOTS, { recursive: true }); }
const DSF = SHOTS ? 2 : 1;
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

/** visible controls inside root: none wider than the viewport, none overlapping another (bounding boxes) */
const layoutOf = (page, root) => page.evaluate(root => {
  const els = [...document.querySelectorAll(`${root} :is(button, input, select, textarea)`)].filter(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && !e.closest('[hidden]'); });
  const R = els.map(e => e.getBoundingClientRect()), out = [], vw = document.documentElement.clientWidth;
  const pinned = e => { for (let x = e; x && x !== document.body; x = x.parentElement) { const p = getComputedStyle(x).position; if (p === 'sticky' || p === 'fixed') return x.closest('.modal') === x ? null : x; } return null; };
  R.forEach((r, i) => { if (r.left < -1 || r.right > vw + 1) out.push(`outside: ${els[i].outerHTML.slice(0, 70)}`); });
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
    if (pinned(els[i]) !== pinned(els[j])) continue; // a sticky bar (Save / Cancel on the phone) over steps scrolled under it: by design
    const a = R[i], b = R[j], w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 1 && h > 1) out.push(`overlap: ${els[i].outerHTML.slice(0, 60)} × ${els[j].outerHTML.slice(0, 60)}`);
  }
  return { n: els.length, bad: out.slice(0, 6), sw: document.documentElement.scrollWidth, iw: innerWidth };
}, root);

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-myworkouts-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const reg = async name => { const r = await fetch(BASE + '/api/account/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1' }) }); return (await r.json()).token; };
  const listOf = async token => (await (await fetch(BASE + '/api/account/workouts', { headers: { 'X-RF-Token': token } })).json()).workouts || [];
  const MW = await import(path.join(__dirname, '..', 'js', 'myworkouts.js'));
  const b = await chromium.launch();
  const errs = [];
  const signIn = (p, token, name, ftp, hrMax = 0) => p.evaluate(async ([token, name, ftp, hrMax]) => { localStorage.setItem('rf_account', JSON.stringify({ token, name, email: name.replace(/\W/g, '') + '@example.org' }));
    const { db } = await import('/js/db.js'); const st = (await db.kvGet('settings')) || {}; await db.kvSet('settings', { ...st, ftp, ...(hrMax ? { hrMax } : {}), profileDone: true, accountAsked: true, workout: '' }); await db.kvSet('settingsAt', Date.now()); }, [token, name, ftp, hrMax]);
  const cards = (P, sel = '.wbcard') => P.locator(`#wbList ${sel}`).count();
  const total = async P => +(await P.textContent('#mwSum span:nth-child(4) b'));
  try {
    // ---- the big screen: an account, River Valley, Customise ----
    const token = await reg('Freddy Workouts');
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: DSF });
    const D = await ctx.newPage(); D.on('pageerror', e => errs.push('desktop: ' + e.message)); D.on('dialog', d => d.accept());
    await D.goto(BASE + '/?desktop&noprofile'); await signIn(D, token, 'Freddy Workouts', 250, 190); await D.reload(); await D.waitForTimeout(900);
    await D.click('.card[data-id="fluss"]'); await D.waitForSelector('#wCustom');
    ok(/River Valley/.test(await D.textContent('h1')), 'route page: River Valley');
    await D.selectOption('#workSel', 'vo2_5x3'); await D.click('#wCustom'); await D.waitForSelector('.mwbox.wb');
    ok(/for River Valley/.test(await D.textContent('#mwTitle')), 'builder: made for River Valley');
    const bw = await D.evaluate(() => import('/js/workouts.js').then(m => m.WORKOUTS.find(w => w.id === 'vo2_5x3').steps.map(s => ({ dur: s.dur, pct: s.pct, label: s.label }))));
    ok(await total(D) === bw.length, `builder: all ${bw.length} steps of VO2max 5 × 3 counted (${await total(D)})`);
    ok(await D.locator('.wbrep').count() === 1 && await D.inputValue('.wbrep [data-f="rep"]') === '5' && await D.isChecked('.wbrep [data-f="skip"]'), 'builder: the set comes in as one repeat block × 5 that skips its last rest');
    ok(await D.inputValue('#mwName') === 'River Valley VO2 1', `builder: a default name without typing (${await D.inputValue('#mwName')})`);
    const w0 = '.wbcard[data-p="0"]';
    ok(await D.inputValue(`${w0} [data-f="pct"]`) === '40' && await D.inputValue(`${w0} [data-f="pct2"]`) === '75' && (await D.textContent(`${w0} [data-w]`)).trim() === '100 → 188 W', 'builder: the warm-up stays a ramp 40 → 75 % (100 → 188 W)');
    ok(await D.locator('#mwGraph polygon').count() >= 2, 'builder: ramps drawn sloped in the chart');
    ok(await D.locator('#mwSum .mwfit, #mwSum .mwwarn').count() === 1, 'builder: the route is ridden with these watts (js/routefit.js): ' + (await D.locator('#mwSum .mwfit, #mwSum .mwwarn').first().textContent().catch(() => '')).trim());
    const iv = '.wbrep .wbcard[data-p$=".0"]', ivP = await D.getAttribute(iv, 'data-p');
    ok((await D.textContent(`${iv} [data-w]`)).trim() === '300 W', 'builder: the VO2max step at 120 % of 250 W = 300 W');
    await D.fill(`${iv} [data-f="pct"]`, '125'); await D.fill(`${iv} [data-f="sec"]`, '3:30');
    ok((await D.textContent(`${iv} [data-w]`)).trim() === '313 W', 'builder: the watts follow the % live (125 % → 313 W)');
    await D.fill(`${iv} [data-f="pct2"]`, '130');
    ok((await D.textContent(`${iv} [data-w]`)).trim() === '313 → 325 W', 'builder: a ramp to 130 % shows 313 → 325 W');
    ok(await D.evaluate(sel => document.activeElement === document.querySelector(sel), `${iv} [data-f="pct2"]`), 'builder: typing never loses the focus (the field is not redrawn)');
    const n0 = await cards(D); await D.click(`${w0} [data-a="del"]`);
    ok(await cards(D) === n0 - 1 && /Step deleted/.test(await D.textContent('#wbToast')), 'builder: delete takes the step out, a toast offers Undo');
    await D.click('#wbUndo'); ok(await cards(D) === n0 && await D.inputValue(`${w0} [data-f="pct2"]`) === '75', 'builder: Undo brings it back as it was');
    await D.fill('#mwName', ''); await D.click('#mwSave'); ok(/Name/.test(await D.textContent('#mwErr')), 'builder: an empty name is refused');
    await D.fill('#mwName', 'My VO2'); await D.fill('#wbNotes', 'Five hard threes');
    await D.click('#mwSave'); await D.waitForSelector('.mwbox', { state: 'detached' }); await D.waitForTimeout(300);
    const saved = (await listOf(token)).find(w => w.name === 'My VO2'), rep = saved?.steps.find(x => x.repeat), svIv = rep?.steps[0];
    ok(!!saved && saved.v === 2 && rep.repeat === 5 && rep.skipLast && svIv.target.pct === 125 && svIv.target.pct2 === 130 && svIv.dur.sec === 210 && saved.steps[0].target.pct2 === 75 && saved.routeId === 'fluss' && saved.base === 'vo2_5x3' && saved.notes === 'Five hard threes',
      'server: “My VO2” stored as steps (v2) with the repeat ×5, the changed step, the ramps, the notes, made for River Valley');
    ok(await D.inputValue('#workSel') === saved?.id, 'route page: the new workout is chosen');
    ok(await D.locator('#workSel optgroup[label="My workouts"] option', { hasText: 'My VO2' }).count() === 1, 'route page: “My VO2” in the “My workouts” group');
    ok(/made for this route/.test(await D.locator('#workSel option', { hasText: 'My VO2' }).textContent()), 'route page: marked as made for this route');
    await D.click('#back'); await D.click('.card[data-id="coast"]'); await D.waitForSelector('#workSel');
    ok(await D.locator('#workSel optgroup[label="My workouts"] option', { hasText: 'My VO2' }).count() === 1, 'another route: “My VO2” in its workout choice too');

    // ---- the long coach workout (owner 20.11.: "I deleted the start and it threw out the last interval block"): every step stays ----
    await D.selectOption('#workSel', 'c_30_15_3x13'); await D.click('#wCustom'); await D.waitForSelector('.mwbox.wb');
    const cw = await D.evaluate(() => import('/js/workouts.js').then(m => m.WORKOUTS.find(w => w.id === 'c_30_15_3x13').steps.map(s => ({ dur: s.dur, label: s.label }))));
    ok(await total(D) === cw.length, `builder: all ${cw.length} steps of 30 / 15 · 3 × 13 (${await total(D)})`);
    await D.click('.wbcard[data-p="0"] [data-a="del"]'); await D.click('.wbcard[data-p="0"] [data-a="del"]'); // the start deleted
    ok(await total(D) === cw.length - 2, 'builder: two steps deleted at the start, nothing else is gone');
    await D.fill('#mwName', 'My 30 15'); await D.click('#mwSave'); await D.waitForSelector('.mwbox', { state: 'detached' }); await D.waitForTimeout(300);
    const long = (await listOf(token)).find(w => w.name === 'My 30 15'), lf = long ? MW.toRide(long).steps : [];
    ok(lf.length === cw.length - 2, `server: “My 30 15” has ${cw.length - 2} steps with the repeats written out (${lf.length})`);
    ok(lf.filter(s => s.dur === 30 && s.watts === 370).length === 39 && /Cool/i.test(lf.at(-1)?.label || ''), 'server: all 3 × 13 efforts of 30 s at 370 W and the cool-down are there');
    ok(lf.every((s, i) => s.dur === cw[i + 2].dur), 'server: every step keeps its length (10 s sprints stay 10 s)');

    // ---- does the workout fit the route? (js/routefit.js) too short: more laps or a longer route; fits; much longer ----
    await D.goto(BASE + '/?desktop&noprofile&demo&view=detail&id=demo'); await D.waitForSelector('#workSel'); await D.selectOption('#lapSel', '1'); await D.waitForTimeout(200);
    const fitOf = async () => ({ fit: await D.getAttribute('#mwFitLine', 'data-fit').catch(() => null), txt: (await D.textContent('#mwFitLine').catch(() => '')).replace(/\s+/g, ' ').trim() });
    await D.selectOption('#workSel', 'z2_90'); await D.waitForTimeout(200); let fl = await fitOf();
    ok(fl.fit === 'short' && /Route ends after about \d+ min, the workout needs 90 min: this workout does not fit on this route/.test(fl.txt), 'route page, 90 min on Passo Demo: ' + fl.txt);
    ok(await D.locator('#mwFitLaps').count() === 1 && /Ride \d+ laps/.test(await D.textContent('#mwFitLaps')), 'too short: a button for the laps it needs');
    const sugg = await D.locator('#mwFitLine .mwfitr').allTextContents(); ok(sugg.length >= 1, 'too short: longer routes to pick, closest fit first: ' + sugg.join(', '));
    const need = await D.getAttribute('#mwFitLaps', 'data-laps'); await D.click('#mwFitLaps'); await D.waitForTimeout(300); fl = await fitOf();
    ok(await D.inputValue('#lapSel') === need && ['fits', 'long'].includes(fl.fit) && new RegExp(need + ' laps take about').test(fl.txt), `“Ride ${need} laps” sets the laps and the line turns: ${fl.txt}`);
    await D.selectOption('#lapSel', '1'); await D.waitForTimeout(200);
    await D.selectOption('#workSel', 'rec30'); await D.waitForTimeout(200); fl = await fitOf();
    ok(fl.fit === 'long' && /the workout ends at km [\d.,]+ of [\d.,]+, the rest is free riding/.test(fl.txt), 'much longer route: where the workout ends: ' + fl.txt);
    await D.selectOption('#workSel', 'vo2_5x3'); await D.waitForTimeout(200); fl = await fitOf();
    ok(fl.fit === 'fits' && /Workout 49 min · route takes about \d+ min at these watts: fits/.test(fl.txt), 'fits: ' + fl.txt);
    await D.selectOption('#workSel', 'z2_90'); await D.waitForTimeout(200);
    const first = D.locator('#mwFitLine .mwfitr').first(); await first.click(); await D.waitForTimeout(400);
    ok((await D.textContent('h1')).replace(/\s/g, '') === sugg[0].replace(/\s/g, '') && await D.getAttribute('#mwFitLine', 'data-fit') !== 'short', `a suggested route opens and the workout fits there (${sugg[0]})`);
    await D.click('#back'); await D.waitForSelector('.card[data-id="demo"]');
    ok(!/Too short/.test(await D.textContent('.card[data-id="demo"]')) && await D.locator('.card .fitshort').count() === 0, 'library: the cards carry no "too short" mark (it shows on the route page only)');
    await D.click('.card[data-id="demo"]'); await D.waitForSelector('#workSel'); await D.selectOption('#workSel', ''); await D.waitForTimeout(200);
    ok(await D.locator('#mwFitLine').count() === 0, 'free ride: no fit line');

    // ---- Profile → My workouts, FTP there = the FTP of "My data" ----
    await D.goto(BASE + '/profil.html#myworkouts'); await D.waitForSelector('.mwitem');
    const item = D.locator('.mwitem', { hasText: 'My VO2' });
    ok(await item.count() === 1 && /for River Valley/.test(await item.textContent()) && /18 steps/.test(await item.textContent()), 'profile: “My VO2” listed with its 18 steps, made for River Valley');
    ok(await D.inputValue('#mwFtp') === '250', 'profile: the FTP field shows the stored FTP');
    await D.fill('#mwB20', '280'); ok((await D.textContent('#mwEst')).trim() === '266 W', 'profile: 20 min best 280 W × 0.95 = 266 W');
    await D.fill('#mwFtp', '260'); await D.press('#mwFtp', 'Tab'); await D.waitForTimeout(400);
    await D.click('#fSet'); ok(await D.inputValue('#dFtp') === '260', 'profile: “My data” shows the FTP set in My workouts (one value)'); await D.click('#dX');
    await D.locator('.mwitem', { hasText: 'My VO2' }).locator('[data-dup]').click(); await D.waitForTimeout(400);
    ok((await listOf(token)).some(w => w.name === 'My VO2 copy' && w.v === 2), 'profile: duplicate → “My VO2 copy” on the server');
    await D.locator('.mwitem', { hasText: 'My VO2 copy' }).locator('[data-del]').click(); await D.waitForSelector('.mwask');
    ok(/Delete “My VO2 copy”/.test(await D.textContent('.mwask')), 'profile: delete asks in the page (no browser dialog)');
    await D.click('.mwask button:has-text("Delete")'); await D.waitForTimeout(400);
    ok(!(await listOf(token)).some(w => w.name === 'My VO2 copy') && await D.locator('.mwitem', { hasText: 'My VO2 copy' }).count() === 0, 'profile: delete removes the copy');

    // ---- the builder's flow: a new workout, every duration and target type, a repeat, drag and drop, save, reopen ----
    await D.click('#mwNew'); await D.waitForSelector('.mwbox.wb');
    ok(await D.inputValue('#mwName') === 'Bike Workout', 'new: titled “Bike Workout”');
    const kinds = async () => D.evaluate(() => [...document.querySelectorAll('#wbList .wbcard')].map(c => [c.querySelector('[data-f="type"]').value, c.querySelector('[data-f="dk"]').value, c.querySelector('[data-f="tk"]').value].join('/')));
    ok(JSON.stringify(await kinds()) === JSON.stringify(['warmup/lap/none', 'work/time/none', 'cooldown/lap/none']), 'new: warm up and cool down until the lap button, one bike step of 10:00 between: ' + (await kinds()).join(', '));
    ok(/~/.test(await D.textContent('#mwTotal')) && await D.locator('#mwGraph rect[fill="url(#wbHatch)"]').count() === 2, 'new: the open steps are estimated (~) and hatched in the chart');
    if (SHOTS) await D.screenshot({ path: `${SHOTS}/desktop_new_workout.png` });
    await D.click('#wbAddStep'); ok(await cards(D) === 4 && await D.evaluate(() => document.activeElement?.closest('[data-p]')?.dataset.p + ':' + document.activeElement?.dataset.f) === '2:type' && await D.inputValue('.wbcard[data-p="3"] [data-f="type"]') === 'cooldown',
      'Add a step: in before the cool-down (it stays the last step), its step type has the focus');
    const s3 = '.wbcard[data-p="2"]';
    await D.selectOption(`${s3} [data-f="type"]`, 'other'); ok(await D.evaluate(s => getComputedStyle(document.querySelector(s)).borderLeftColor, s3) === 'rgb(176, 97, 255)', 'step type “Other”: the card edge turns its colour');
    // every duration type: its own input, the summary follows
    const durs = { time: '[data-f="sec"]', distance: '[data-f="km"]', lap: '.wbhint:has(b)', calories: '[data-f="kcal"]', hr: '[data-f="bpm"]', power: '[data-f="dw"]' };
    for (const [k, sel] of Object.entries(durs)) { await D.selectOption(`${s3} [data-f="dk"]`, k); ok(await D.locator(`${s3} ${sel}`).count() === 1 && await D.evaluate(s => document.activeElement === document.querySelector(s), `${s3} [data-f="dk"]`), `duration “${k}”: its field shows, the focus stays on the choice`); }
    await D.selectOption(`${s3} [data-f="dop"]`, 'lt'); await D.fill(`${s3} [data-f="dw"]`, '120');
    await D.selectOption(`${s3} [data-f="dk"]`, 'distance'); await D.fill(`${s3} [data-f="km"]`, '7.5');
    await D.selectOption(`${s3} [data-f="dk"]`, 'time'); await D.fill(`${s3} [data-f="sec"]`, '1:02:03'); await D.press(`${s3} [data-f="sec"]`, 'Tab');
    ok(await D.inputValue(`${s3} [data-f="sec"]`) === '1:02:03', 'time entry h:mm:ss');
    await D.fill(`${s3} [data-f="sec"]`, '4:75'); ok(await D.getAttribute(`${s3} [data-f="sec"]`, 'aria-invalid') === 'true' && /Time/.test(await D.textContent('#mwErr')), 'a bad time is marked, not taken');
    await D.fill(`${s3} [data-f="sec"]`, '12:30'); await D.press(`${s3} [data-f="sec"]`, 'Tab'); ok(!(await D.textContent('#mwErr')), 'a good time clears it');
    // every target type
    const tg = { none: '.wbhint', powerZone: 'select[data-f="zone"]', power: '[data-f="lo"]', ftp: '[data-f="pct"]', hrZone: 'select[data-f="zone"]', hr: '[data-f="hi"]', cadence: '[data-f="lo"]', speed: '[data-f="hi"]' };
    for (const [k, sel] of Object.entries(tg)) { await D.selectOption(`${s3} [data-f="tk"]`, k); ok(await D.locator(`${s3} ${sel}`).count() === 1, `target “${k}”: its field shows (${(await D.locator(`${s3} .wbsumtxt`).count()) ? '' : 'card'})`); }
    await D.selectOption(`${s3} [data-f="tk"]`, 'powerZone');
    ok(/Zone 4 · 91–105 % · 237–273 W/.test(await D.locator(`${s3} select[data-f="zone"] option[value="4"]`).textContent()), 'power zones listed with the watts from the FTP (260 W, set above)');
    await D.selectOption(`${s3} select[data-f="zone"]`, '5');
    await D.selectOption(`${s3} [data-f="tk"]`, 'hrZone');
    ok(/Zone 2 · 60–70 % max · 114–133 bpm/.test(await D.locator(`${s3} select[data-f="zone"] option[value="2"]`).textContent()), 'heart-rate zones listed with bpm from the max HR (190)');
    await D.selectOption(`${s3} [data-f="tk"]`, 'power'); await D.fill(`${s3} [data-f="lo"]`, '280'); await D.fill(`${s3} [data-f="hi"]`, '300');
    await D.click(`${s3} [data-a="t2add"]`); await D.selectOption(`${s3} [data-f="t2k"]`, 'cadence'); await D.fill(`${s3} [data-f="2lo"]`, '90'); await D.fill(`${s3} [data-f="2hi"]`, '100');
    await D.click(`${s3} [data-a="note"]`); await D.fill(`${s3} [data-f="note"]`, 'Seated, smooth');
    ok(await D.evaluate(s => document.activeElement === document.querySelector(s), `${s3} [data-f="note"]`), 'Add notes: the note field opens with the focus');
    if (SHOTS) { // the dropdowns of one card, drawn open (a native list does not show in a screenshot: the same options as an open list box)
      await D.evaluate(s => { for (const f of ['type', 'dk', 'tk']) { const e = document.querySelector(`${s} [data-f="${f}"]`); e.size = e.options.length; e.style.height = 'auto'; e.style.position = 'relative'; e.style.zIndex = 3; } }, s3);
      await D.locator(s3).scrollIntoViewIfNeeded(); await D.screenshot({ path: `${SHOTS}/desktop_step_dropdowns_open.png` });
      await D.evaluate(s => { for (const f of ['type', 'dk', 'tk']) { const e = document.querySelector(`${s} [data-f="${f}"]`); e.size = 0; e.removeAttribute('style'); } }, s3);
    }
    // Add repeat: × 2 with a bike and a recover step, the stepper, skip last recovery
    await D.click('#wbAddRep'); const R = '.wbrep[data-p="3"]';
    ok(await D.locator(R).count() === 1 && await D.inputValue('.wbcard[data-p="4"] [data-f="type"]') === 'cooldown' && await D.inputValue(`${R} [data-f="rep"]`) === '2' && await D.locator(`${R} .wbcard`).count() === 2, 'Add repeat: a block × 2 with a bike and a recover step, before the cool-down');
    await D.click(`${R} [data-a="rep+"]`); await D.click(`${R} [data-a="rep+"]`); ok(await D.inputValue(`${R} [data-f="rep"]`) === '4', '+ + : × 4');
    await D.click(`${R} [data-a="rep-"]`); ok(await D.inputValue(`${R} [data-f="rep"]`) === '3', '− : × 3');
    await D.check(`${R} [data-f="skip"]`); ok(await total(D) === 4 + 3 * 2 - 1, `skip the last recovery: ${await total(D)} steps`);
    await D.selectOption(`${R} .wbcard[data-p="3.0"] [data-f="tk"]`, 'ftp'); await D.fill(`${R} .wbcard[data-p="3.0"] [data-f="pct"]`, '115');
    // drag by mouse: the cool-down (step 5 of 5) above the repeat, then back to the very end
    const dragTo = async (from, to, where = 'below') => { await D.evaluate(([f, t]) => { const a = document.querySelector(f).closest('.wbcard, .wbrep'), b = document.querySelector(t); (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? b : a).scrollIntoView({ block: 'start' }); }, [from, to]); /* the upper one at the top: both in view */ const a = await D.locator(`${from}`).boundingBox(), t = await D.locator(to).boundingBox();
      await D.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await D.mouse.down(); await D.mouse.move(a.x + a.width / 2, a.y + 30, { steps: 4 });
      const y = where === 'below' ? t.y + t.height - 4 : where === 'above' ? t.y + 4 : t.y + t.height / 2; await D.mouse.move(t.x + t.width / 2, y, { steps: 10 }); await D.waitForTimeout(80); return y; };
    await dragTo('.wbcard[data-p="4"] .wbgrip', R, 'above'); await D.mouse.up(); await D.waitForTimeout(100);
    ok(await D.inputValue('.wbcard[data-p="3"] [data-f="type"]') === 'cooldown' && await D.locator('.wbrep[data-p="4"]').count() === 1, 'mouse drag: the cool-down above the repeat');
    await dragTo('.wbcard[data-p="3"] .wbgrip', '.wbrep[data-p="4"]', 'below');
    if (SHOTS) await D.screenshot({ path: `${SHOTS}/desktop_drag_in_progress.png` });
    await D.mouse.up(); await D.waitForTimeout(100);
    ok(JSON.stringify((await kinds()).filter((_, i, a) => i === 0 || i === a.length - 1)) === JSON.stringify(['warmup/lap/none', 'cooldown/lap/none']) && await D.getAttribute('#wbList > :last-child', 'data-p') === '4' && await D.locator('#wbList > :last-child .wbtype').inputValue() === 'cooldown',
      'mouse drag: the cool-down moved to the end, below the repeat');
    // drag the "Other" step into the repeat (between its two steps), then out again by keyboard
    await dragTo('.wbcard[data-p="2"] .wbgrip', '.wbrep .wbcard[data-p="3.1"]', 'above'); await D.mouse.up(); await D.waitForTimeout(100);
    ok(await D.locator('.wbrep .wbcard').count() === 3 && await D.inputValue('.wbrep .wbcard[data-p="2.1"] [data-f="type"]') === 'other', 'mouse drag: a step dropped into the repeat block, between its steps');
    ok(await total(D) === 3 + 3 * 3 - 1, `the repeat now repeats three steps, still skipping its last recovery (${await total(D)})`);
    await D.focus('.wbcard[data-p="2.1"] .wbgrip'); await D.keyboard.press('ArrowUp'); await D.keyboard.press('ArrowUp');
    ok(await D.locator('.wbrep .wbcard').count() === 2 && await D.inputValue('.wbcard[data-p="2"] [data-f="type"]') === 'other' && await D.evaluate(() => document.activeElement?.dataset.drag) === '2', 'keyboard ↑ ↑ on the handle: up within the block, then out of it (focus stays on the handle)');
    await D.click('.wbcard[data-p="2"] [data-a="down"]'); ok(await D.locator('.wbrep .wbcard').count() === 3, 'the ↓ button moves it into the block below');
    await D.click('.wbcard[data-p="2.0"] [data-a="up"]'); ok(await D.locator('.wbrep .wbcard').count() === 2 && await D.inputValue('.wbcard[data-p="2"] [data-f="type"]') === 'other', 'and ↑ out again');
    // the whole block by its handle: above the "Other" step
    await dragTo('.wbrep .wbrephead .wbgrip', '.wbcard[data-p="2"]', 'above'); await D.mouse.up(); await D.waitForTimeout(100);
    ok(await D.getAttribute('#wbList > :nth-child(3)', 'class').then(c => /wbrep/.test(c)) && await D.locator('.wbrep .wbcard').count() === 2, 'mouse drag: the repeat block moves as a whole');
    ok(await D.isChecked('.wbrep [data-f="skip"]'), 'the block still skips its last recovery after all the moves');
    // audit 27.11.: a step moved down through a repeat (in at the top, past its last recovery, out at the bottom) took the block's
    // "skip the last recovery" with it (3 sets of 13 × 30/15 got 45 s and 3 steps longer); and back up the other way
    const tk0 = await total(D), focP = () => D.evaluate(() => document.activeElement?.closest('[data-p]')?.dataset.p);
    await D.click('.wbcard[data-p="1"] [data-a="down"]'); for (let k = 0; k < 3; k++) await D.click(`.wbcard[data-p="${await focP()}"] [data-a="down"]`);
    ok(await D.isChecked('.wbrep [data-f="skip"]') && await total(D) === tk0 && await D.locator('.wbrep .wbcard').count() === 2 && await D.getAttribute('#wbList > :nth-child(2)', 'class').then(c => /wbrep/.test(c)),
      `↓ ↓ ↓ ↓: a step through the whole repeat and out below it, the block still skips its last recovery (${await total(D)} steps, as before)`);
    for (let k = 0; k < 4; k++) await D.click(`.wbcard[data-p="${await focP()}"] [data-a="up"]`);
    ok(await D.isChecked('.wbrep [data-f="skip"]') && await total(D) === tk0 && await D.getAttribute('#wbList > :nth-child(3)', 'class').then(c => /wbrep/.test(c)), '↑ ↑ ↑ ↑: and back the same way, still skipping');
    await D.selectOption('.wbrep .wbcard[data-p="2.1"] [data-f="type"]', 'work'); ok(await total(D) === tk0 + 1, 'the last step of the block made a bike step: nothing to skip'); await D.selectOption('.wbrep .wbcard[data-p="2.1"] [data-f="type"]', 'recover');
    ok(await D.isChecked('.wbrep [data-f="skip"]') && await total(D) === tk0, 'and back to recover: the tick is still there and counts again');
    // audit 27.11.: a value out of range went back to the old one when the field was left, so a click on Save stored the old value without a word
    const so = '.wbcard[data-p="3"] [data-f="sec"]';
    await D.fill(so, '0:02'); await D.click('#mwSave');
    ok(await D.locator('.mwbox').count() === 1 && await D.inputValue(so) === '0:02' && await D.getAttribute(so, 'aria-invalid') === 'true' && /out of range/.test(await D.textContent('#mwErr')), 'a time out of range (2 s) stays as typed and marked when the field is left; Save refuses it');
    await D.click('#wbAddStep'); ok(await D.getAttribute(so, 'aria-invalid') === 'true' && await D.inputValue(so) === '0:02', 'a redraw of the list (Add a step) keeps it marked'); await D.click('.wbcard[data-p="4"] [data-a="del"]');
    await D.fill(so, '12:30'); await D.press(so, 'Tab'); ok(!(await D.locator('.wb .bad').count()), 'fixed: nothing marked');
    // audit 27.11.: Tab left the builder (aria-modal) for the page behind it
    await D.focus('#mwSave'); let inside = true; for (let k = 0; k < 4; k++) { await D.keyboard.press('Tab'); inside &&= await D.evaluate(() => !!document.activeElement?.closest('.wb')); }
    await D.keyboard.press('Shift+Tab'); inside &&= await D.evaluate(() => !!document.activeElement?.closest('.wb')); ok(inside, 'Tab / Shift+Tab stay inside the builder');
    if (SHOTS) { await D.evaluate(() => { document.querySelector('.wb').scrollTop = 0; }); await D.screenshot({ path: `${SHOTS}/desktop_repeat_and_chart.png` }); }
    const lay = await layoutOf(D, '.wb'); ok(!lay.bad.length && lay.sw <= lay.iw, `desktop builder: ${lay.n} controls, none overlapping, no sideways scrolling ${lay.bad.join(' | ')}`);
    await D.fill('#mwName', 'Builder test'); await D.fill('#wbNotes', 'All the options');
    await D.click('#mwSave'); await D.waitForSelector('.mwbox', { state: 'detached' }); await D.waitForTimeout(300);
    const bt = (await listOf(token)).find(w => w.name === 'Builder test');
    const btSt = bt?.steps.find(s => s.type === 'other');
    ok(!!bt && bt.notes === 'All the options' && bt.steps.length === 5 && bt.steps[2].repeat === 3 && bt.steps[2].skipLast && bt.steps[2].steps[0].target.pct === 115 && btSt?.dur.sec === 750
      && JSON.stringify(btSt.target) === JSON.stringify({ kind: 'power', lo: 280, hi: 300 }) && JSON.stringify(btSt.target2) === JSON.stringify({ kind: 'cadence', lo: 90, hi: 100 }) && btSt.note === 'Seated, smooth' && bt.steps[4].type === 'cooldown',
      'saved: the order, the repeat × 3 skipping its last recovery, 12:30 at 280–300 W with cadence 90–100 and the note');
    await D.locator('.mwitem', { hasText: 'Builder test' }).locator('[data-ed]').click(); await D.waitForSelector('.mwbox.wb');
    ok(await D.inputValue('.wbcard[data-p="3"] [data-f="sec"]') === '12:30' && await D.inputValue('.wbcard[data-p="3"] [data-f="lo"]') === '280' && await D.inputValue('.wbcard[data-p="3"] [data-f="2hi"]') === '100' && await D.inputValue('.wbrep [data-f="rep"]') === '3' && await D.inputValue('#wbNotes') === 'All the options',
      'reopened with Edit: every value as saved');
    // start from a standard workout: the steps are replaced, Undo brings them back
    await D.selectOption('#wbBase', 'thr2x20'); ok(await D.locator('.wbrep').count() >= 1 && /Threshold/.test(await D.textContent('#wbToast')), 'start from “Threshold 2 × 20”: its steps (repeats found), a toast to undo');
    await D.click('#wbUndo'); ok(await D.inputValue('.wbcard[data-p="3"] [data-f="sec"]') === '12:30', 'Undo: my steps are back');
    await D.click('#mwCancel'); await D.waitForSelector('.mwask'); await D.click('.mwask button:has-text("Discard")'); await D.waitForSelector('.mwbox', { state: 'detached' });

    // ---- a ride: lap-button warm-up ended by Next, the repeat expanded, a heart-rate target shown as a band ----
    const rideW = { v: 2, id: 'pw_ridelap1', name: 'Lap test', notes: '', steps: [
      { type: 'warmup', dur: { kind: 'lap' }, target: { kind: 'ftp', pct: 50 }, note: 'Spin easy, press Next when warm' },
      { repeat: 2, steps: [{ type: 'work', dur: { kind: 'time', sec: 40 }, target: { kind: 'power', lo: 240, hi: 260 } }, { type: 'recover', dur: { kind: 'time', sec: 20 }, target: { kind: 'ftp', pct: 50 } }], skipLast: true },
      { type: 'work', dur: { kind: 'time', sec: 300 }, target: { kind: 'hrZone', zone: 3 }, target2: { kind: 'cadence', lo: 85, hi: 95 } },
      { type: 'cooldown', dur: { kind: 'distance', m: 2000 }, target: { kind: 'ftp', pct: 45 } }] };
    ok((await fetch(BASE + '/api/account/workouts/pw_ridelap1', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-RF-Token': token }, body: JSON.stringify(rideW) })).status === 200, 'ride: a workout with a lap step, a repeat, an HR target and a distance step stored');
    await D.goto(BASE + '/?desktop&noprofile&demo&laptest&view=detail&id=demo'); await D.waitForSelector('#workSel'); await D.waitForTimeout(400); await D.selectOption('#workSel', 'pw_ridelap1'); await D.waitForTimeout(200);
    await D.click('#rideBtn'); await D.waitForSelector('#hWT', { timeout: 60000 }); await D.waitForFunction(() => window.__ride?.running && /\d/.test(document.querySelector('#hWT')?.textContent || ''), null, { timeout: 60000 });
    await D.waitForTimeout(2500);
    const hud = () => D.evaluate(() => ({ step: document.querySelector('#hWStep').textContent, left: document.querySelector('#hWLeft').textContent, leftL: document.querySelector('#hWLeftL').textContent, t: document.querySelector('#hWT').textContent, u: document.querySelector('#hWTU').textContent, of: document.querySelector('#hWOf').textContent,
      note: document.querySelector('#hWNote').hidden ? '' : document.querySelector('#hWNote').textContent, state: document.querySelector('#hWState').textContent, lap: document.querySelector('#hWork').classList.contains('lapstep'), t2: document.querySelector('#hWTgt2').hidden ? '' : document.querySelector('#hWTgt2').textContent, i: window.__ride.wNow?.i, erg: window.__ride._ergNow(), ergOn: !!window.__ride.erg, free: !!window.__ride.wNow?.step?.free }));
    let h = await hud();
    ok(h.step === 'Warm up' && h.left === 'Lap' && /Next/i.test(h.leftL) && h.lap && h.t === '130' && h.note === 'Spin easy, press Next when warm', `ride: the warm-up runs until the lap button (${JSON.stringify(h)})`);
    ok(await D.isVisible('#hWNextBtn'), 'ride: a visible “Next step” control in the workout bar');
    if (SHOTS) await D.screenshot({ path: `${SHOTS}/ride_hud_lap_step_next.png` });
    await D.click('#hWNextBtn'); await D.waitForTimeout(400); h = await hud();
    ok(h.step === 'Bike 1/2' && h.t === '250' && /240–260 W/.test(h.of) && !h.lap, `ride: Next → the repeat's first bike step, ERG at the middle of 240–260 W, the range shown (${h.step} · ${h.t} · ${h.of})`);
    await D.keyboard.press('x'); await D.waitForTimeout(300); ok((await hud()).step === 'Recover', 'ride: key X = next step');
    await D.evaluate(() => document.dispatchEvent(new CustomEvent('rf-remote', { detail: { name: 'wnext' } }))); await D.waitForTimeout(300);
    ok((await hud()).step === 'Bike 2/2', 'ride: the phone remote\'s “Next step” (wnext): the repeat\'s second round');
    await D.evaluate(() => document.dispatchEvent(new CustomEvent('rf-remote', { detail: { name: 'wnext' } }))); await D.waitForTimeout(300);
    await D.evaluate(() => { window.__ride.state.hr = { hr: 172, connected: true }; }); await D.waitForTimeout(600); h = await hud();
    ok(h.i === 4 && h.step === 'Bike' && h.t === '133–152' && h.u === 'bpm' && /heart rate too high/.test(h.state) && /Cadence 85–95 rpm/.test(h.t2), `ride: the last recovery skipped, the heart-rate step shows its band 133–152 bpm and “too high” at 172 (${JSON.stringify(h)})`);
    ok(h.erg === null && h.free && h.ergOn, `ride: a heart-rate target never goes to the trainer (ERG on, no ERG target on this step) ${JSON.stringify([h.erg, h.free, h.ergOn])}`);
    await D.evaluate(() => { window.__ride.state.hr = { hr: 140, connected: true }; }); await D.waitForTimeout(500); h = await hud(); ok(/in zone/.test(h.state), 'ride: 140 bpm: in zone');
    if (SHOTS) await D.screenshot({ path: `${SHOTS}/ride_hud_hr_target_step.png` });
    await D.click('#hWNextBtn'); await D.waitForTimeout(400); h = await hud(); ok(h.step === 'Cool down' && /km to go/.test(h.leftL) && h.left === '2.00', `ride: the distance step counts the km down (${h.left} ${h.leftL})`);
    await D.goto(BASE + '/?desktop&noprofile'); await D.waitForTimeout(300);

    // ---- ride “My VO2”: the first target is FTP × % of the first step, the saved ride carries the name ----
    await D.goto(BASE + '/?desktop&noprofile&demo&view=detail&id=demo'); await D.waitForSelector('#rideBtn'); await D.waitForTimeout(500); await D.selectOption('#workSel', saved.id); await D.waitForTimeout(200);
    await D.click('#rideBtn'); await D.waitForSelector('#hWT', { timeout: 60000 }); await D.waitForFunction(() => /\d/.test(document.querySelector('#hWT')?.textContent || ''), null, { timeout: 30000 });
    const got = +(await D.textContent('#hWT')).trim(), lo = Math.round(40 / 100 * 260), hi = Math.round(43 / 100 * 260);
    ok(got >= lo && got <= hi, `ride: first target ${got} W = 260 W × the warm-up ramp start 40 % (${lo} W, rising)`);
    ok(/My VO2/.test(await D.textContent('#hWName')), 'ride: the HUD names “My VO2”');
    await D.waitForFunction(d0 => { const [m, s] = (document.querySelector('#hWLeft')?.textContent || '99:99').split(':').map(Number); return m * 60 + s <= d0 - 35; }, 480, { timeout: 90000 });
    await D.click('#hPause'); await D.waitForSelector('#pSave'); await D.click('#pSave'); await D.waitForTimeout(2500);
    const rides = await D.evaluate(async () => { const { db } = await import('/js/db.js'); return (await db.all('rides')).map(r => ({ workout: r.workout, workoutId: r.workoutId })); });
    ok(rides.some(r => r.workout === 'My VO2' && r.workoutId === saved.id), `finished ride records the workout name (${JSON.stringify(rides)})`);
    await ctx.close();

    // ---- phone 360 × 740: compact cards, the step sheet, drag by touch, nothing overlaps, the indoor page lists it ----
    const pctx = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const P = await pctx.newPage(); P.on('pageerror', e => errs.push('phone: ' + e.message)); P.on('dialog', d => d.accept());
    await P.goto(BASE + '/profil.html'); await signIn(P, token, 'Freddy Workouts', 260, 190); await P.reload(); await P.waitForSelector('.mwitem');
    await P.locator('.mwitem', { hasText: 'My VO2' }).locator('[data-ed]').click(); await P.waitForSelector('.mwbox.wb');
    let pl = await layoutOf(P, '.wb'); ok(pl.sw <= pl.iw && !pl.bad.length, `phone builder: no sideways scrolling at 360 px, ${pl.n} controls, none overlapping ${pl.bad.join(' | ')}`);
    ok(await P.locator('#wbList .wbcard.compact').count() === await P.locator('#wbList .wbcard').count() && await P.locator('#wbList .wbcard [data-f]').count() === 0, 'phone: compact cards (type, duration · target), no fields in the list');
    ok(/125 → 130 % FTP · 325 → 338 W/.test(await P.textContent('.wbrep .wbcard[data-p$=".0"] .wbsumtxt')), 'phone: the VO2max step reads 3:30 · 125 → 130 % FTP · 325 → 338 W');
    if (SHOTS) await P.screenshot({ path: `${SHOTS}/phone_list.png` });
    await P.tap('.wbrep .wbcard[data-p$=".0"] .wbopen'); await P.waitForSelector('.wbsheet');
    ok(await P.inputValue('.wbsheet [data-f="pct"]') === '125' && /Step \d+ · Bike/.test(await P.textContent('.wbshead b')), 'phone: a tap opens the step in a sheet (type, duration, target, notes)');
    await P.selectOption('.wbsheet [data-f="tk"]', 'powerZone'); await P.selectOption('.wbsheet [data-f="zone"]', '5');
    ok(/Power zone 5/.test(await P.textContent('.wbrep .wbcard[data-p$=".0"] .wbsumtxt')), 'phone sheet: the target type changes, the card follows');
    pl = await layoutOf(P, '.wbsheet'); ok(!pl.bad.length, `phone sheet: ${pl.n} controls, none overlapping, inside 360 px ${pl.bad.join(' | ')}`);
    if (SHOTS) await P.screenshot({ path: `${SHOTS}/phone_step_edit.png` });
    // audit 27.11.: Done closed the sheet over a value out of range, and the old value was kept without a word
    await P.fill('.wbsheet [data-f="sec"]', '0:01'); await P.tap('.wbsheet [data-a="done"]'); await P.waitForTimeout(150);
    ok(await P.locator('.wbsheet').count() === 1 && /out of range/.test(await P.textContent('.wbsheet .wbserr')), 'phone sheet: Done refuses a time out of range and says so in the sheet');
    await P.fill('.wbsheet [data-f="sec"]', '3:30'); await P.locator('.wbsheet [data-f="sec"]').blur();
    // audit 27.11.: thumb-sized controls on the phone (the repeat's − / + / ✕ were 34 px, "+ Add a step to the repeat" 23 px)
    const tiny = await P.evaluate(() => [...document.querySelectorAll('.wb :is(button, input, select), .wbsheet :is(button, input, select)')].filter(e => e.type !== 'checkbox' && e.getClientRects().length).map(e => [e, e.getBoundingClientRect()]).filter(([, r]) => r.height < 40 || r.width < 36).map(([e, r]) => `${Math.round(r.width)}×${Math.round(r.height)} ${e.outerHTML.slice(0, 50)}`));
    ok(!tiny.length, `phone: every control at least 40 px high and 36 px wide ${tiny.slice(0, 4).join(' | ')}`);
    await P.tap('.wbsheet [data-a="done"]'); await P.waitForSelector('.wbsheet', { state: 'detached' });
    // drag by touch (real touch events: Chrome turns them into pointer events): the first card below the second
    const cdp = await pctx.newCDPSession(P), touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await P.evaluate(() => { document.querySelector('.wb').scrollTop = 0; }); await P.locator('#wbList .wbcard[data-p="0"]').scrollIntoViewIfNeeded();
    const t0 = await P.evaluate(() => [...document.querySelectorAll('#wbList > .wbcard')].slice(0, 3).map(c => c.querySelector('.wbopen b').textContent + ':' + c.querySelector('.wbsumtxt').textContent));
    const g = await P.locator('#wbList .wbcard[data-p="0"] .wbgrip').boundingBox(), c2 = await P.locator('#wbList .wbcard[data-p="1"]').boundingBox();
    await touch('touchStart', g.x + g.width / 2, g.y + g.height / 2);
    for (let k = 1; k <= 8; k++) await touch('touchMove', g.x + g.width / 2, g.y + g.height / 2 + (c2.y + c2.height - 6 - (g.y + g.height / 2)) * k / 8);
    await P.waitForTimeout(80); if (SHOTS) await P.screenshot({ path: `${SHOTS}/phone_drag_in_progress.png` });
    ok(await P.locator('.wbdrop').count() === 1 && await P.locator('.wbghost').count() === 1, 'phone: dragging by touch shows the card under the finger and where it lands');
    await touch('touchEnd'); await P.waitForTimeout(150);
    const t1 = await P.evaluate(() => [...document.querySelectorAll('#wbList > .wbcard')].slice(0, 3).map(c => c.querySelector('.wbopen b').textContent + ':' + c.querySelector('.wbsumtxt').textContent));
    ok(t1[0] === t0[1] && t1[1] === t0[0], `phone: touch drag swapped the first two steps (${t0.slice(0, 2).join(' | ')} → ${t1.slice(0, 2).join(' | ')})`);
    await P.click('#mwCancel'); await P.waitForSelector('.mwask'); ok(/Discard your changes/.test(await P.textContent('.mwask')), 'phone: Cancel with changes asks first (in the page)');
    await P.click('.mwask button:has-text("Discard")'); await P.waitForSelector('.mwbox', { state: 'detached' });
    ok((await listOf(token)).find(w => w.id === saved.id).steps.find(x => x.repeat).steps[0].target.pct === 125, 'phone: Discard keeps the stored workout');
    await P.click('#mwNew'); await P.waitForSelector('.mwbox.wb'); await P.click('#wbAddRep'); await P.waitForTimeout(150);
    pl = await layoutOf(P, '.wb'); ok(pl.sw <= pl.iw && !pl.bad.length, `phone: a new workout with a repeat block fits 360 px without overlaps ${pl.bad.join(' | ')}`);
    // audit 27.11.: the last step of the only repeat (or the only repeat) could be deleted: an empty workout that Save then refused
    for (let k = 0; k < 4 && await P.locator('#wbList > .wbcard').count(); k++) { await P.tap('#wbList > .wbcard .wbopen'); await P.waitForSelector('.wbsheet'); await P.tap('.wbsheet [data-a="del"]'); await P.waitForTimeout(100); }
    await P.tap('.wbrep .wbcard[data-p="0.1"] .wbopen'); await P.tap('.wbsheet [data-a="del"]'); await P.waitForTimeout(100);
    await P.tap('.wbrep .wbcard[data-p="0.0"] .wbopen'); await P.tap('.wbsheet [data-a="del"]'); await P.waitForTimeout(100);
    ok(await P.locator('.wbrep .wbcard').count() === 1 && /at least one step/.test(await P.textContent('.wbsheet .wbserr')), 'phone: the only step of the only repeat cannot be deleted (says so in the sheet)');
    await P.tap('.wbsheet [data-a="done"]'); await P.tap('.wbrep [data-a="del"]'); ok(await P.locator('.wbrep').count() === 1 && /at least one step/.test(await P.textContent('#mwErr')), 'phone: nor the only repeat');
    await P.click('#mwCancel'); await P.waitForSelector('.mwask'); await P.click('.mwask button:has-text("Discard")'); await P.waitForSelector('.mwbox', { state: 'detached' });
    await P.goto(BASE + '/pure.html'); await P.waitForTimeout(800); await P.click('[data-m="work"]'); await P.waitForSelector('#pWork');
    ok(await P.locator('#pWork option', { hasText: 'My VO2' }).count() === 1, 'indoor page: “My VO2” selectable');
    await P.selectOption('#pWork', 'pw_ridelap1'); await P.waitForTimeout(300); ok(await P.inputValue('#pWork') === 'pw_ridelap1', 'indoor page: the lap workout chosen');
    await pctx.close();

    // ---- signed out: kept in this browser, offered for upload after signing in ----
    const octx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const O = await octx.newPage(); O.on('pageerror', e => errs.push('signed out: ' + e.message)); O.on('dialog', d => d.accept());
    await O.goto(BASE + '/profil.html'); await O.waitForSelector('#mwNew'); await O.click('#mwNew'); await O.waitForSelector('.mwbox');
    await O.fill('#mwName', 'Offline intervals'); await O.click('#mwSave'); await O.waitForSelector('.mwbox', { state: 'detached' });
    ok(await O.evaluate(() => JSON.parse(localStorage.getItem('rf_myworkouts') || '[]').some(w => w.name === 'Offline intervals' && w.v === 2)), 'signed out: saved in this browser');
    const t2 = await reg('Offline Rider'); await signIn(O, t2, 'Offline Rider', 220); await O.reload(); await O.waitForSelector('#mwUpP');
    await O.click('#mwUpP'); await O.waitForTimeout(500);
    ok((await listOf(t2)).some(w => w.name === 'Offline intervals') && !(await listOf(token)).some(w => w.name === 'Offline intervals'), 'after sign-in: uploaded to that account only');
    ok(await O.locator('#mwUpP').count() === 0, 'after the upload: no offer any more');
    await octx.close();

    // ---- the whole thing by gamepad only (js/padnav.js, a fake standard pad): Customise, a value, a step, save, profile, delete ----
    const gctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    await gctx.addInitScript(() => { const btn = () => ({ pressed: false, value: 0, touched: false });
      window.__pad = { id: 'Test pad (STANDARD GAMEPAD Vendor: 045e)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, btn), axes: [0, 0, 0, 0] };
      Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [window.__pad, null, null, null], configurable: true }); });
    const G = await gctx.newPage(); G.on('pageerror', e => errs.push('pad: ' + e.message)); G.on('dialog', d => { errs.push('pad: a native dialog: ' + d.message()); d.dismiss(); });
    await G.goto(BASE + '/?desktop&noprofile'); await signIn(G, token, 'Freddy Workouts', 250); await G.goto(BASE + '/?desktop&noprofile&view=detail&id=fluss'); await G.waitForSelector('#wCustom'); await G.waitForTimeout(600);
    const BTN = { A: 0, B: 1, L: 4, R: 5, up: 12, down: 13, left: 14, right: 15 };
    const press = async (k, hold = 60) => { await G.evaluate(i => { const x = window.__pad.buttons[i]; x.pressed = true; x.value = 1; }, BTN[k]); await G.waitForTimeout(hold);
      await G.evaluate(i => { const x = window.__pad.buttons[i]; x.pressed = false; x.value = 0; }, BTN[k]); await G.waitForTimeout(90); };
    const curIs = sel => G.evaluate(sel => { const c = window.__padnav?.cur; return !!c && c.isConnected && c.matches(sel); }, sel);
    /** the pad's way to a control: the test only chooses the direction to press, toward where the control is on screen */
    const padTo = async (sel, max = 80) => {
      for (let i = 0; i < max; i++) {
        if (await curIs(sel)) return true;
        const dir = await G.evaluate(sel => { const c = window.__padnav?.cur, t = [...document.querySelectorAll(sel)].find(e => e.getBoundingClientRect().width > 0); if (!c || !t) return 'down';
          const a = c.getBoundingClientRect(), b = t.getBoundingClientRect(), ax = (a.left + a.right) / 2, bx = (b.left + b.right) / 2;
          if (!c.closest('.wbside') !== !t.closest('.wbside')) return bx > ax ? 'right' : 'left'; /* the builder's side panel is another column: across first */ if (b.top >= a.bottom - 2) return 'down'; if (b.bottom <= a.top + 2) return 'up'; return bx > ax ? 'right' : 'left'; }, sel);
        const before = await G.evaluate(() => window.__padnav?.cur?.outerHTML.slice(0, 120));
        await press(dir);
        if (before === await G.evaluate(() => window.__padnav?.cur?.outerHTML.slice(0, 120))) await press(dir === 'up' || dir === 'down' ? (i % 2 ? 'left' : 'right') : (i % 2 ? 'up' : 'down')); // stuck: sidestep
      }
      return curIs(sel);
    };
    const val = sel => G.inputValue(sel);
    await press('down'); // the first press shows the focus
    ok(await padTo('#workSel'), 'pad: reaches the workout choice');
    await press('A'); for (let i = 0; i < 40 && /^(pw_|c_|$)/.test(await val('#workSel')); i++) await press('down'); await press('B');
    const pick = await val('#workSel'); ok(!/^(pw_|c_|$)/.test(pick), `pad: a standard workout chosen with A and ↓ (${pick})`);
    ok(await padTo('#wCustom'), 'pad: reaches “Customise”'); await press('A'); await G.waitForSelector('.mwbox.wb');
    const nm = await val('#mwName'); ok(/^River Valley .+ \d+$/.test(nm), `pad: the builder opens with a default name (${nm})`);
    const pctSel = '.wbcard[data-p="1"] [data-f="pct"]', p0 = +await val(pctSel);
    ok(await padTo(pctSel), 'pad: reaches the % FTP of step 2');
    await press('A'); ok(await G.evaluate(() => window.__padnav.editing), 'pad: A on a number field = change mode');
    if (SHOTS) await G.screenshot({ path: `${SHOTS}/pad_builder_1280.png` });
    await press('up'); await press('up'); await press('B');
    ok(+await val(pctSel) === p0 + 2, `pad: ↑ ↑ = +2 % (${p0} → ${await val(pctSel)})`);
    await press('B'); await G.waitForSelector('.mwask'); ok(/Discard your changes/.test(await G.textContent('.mwask')), 'pad: B with changes asks (in the page)');
    await press('B'); await G.waitForTimeout(150); ok(!(await G.locator('.mwask').count()) && await G.locator('.mwbox').count() === 1, 'pad: B on the question keeps editing');
    const n1 = await G.locator('#wbList .wbcard').count();
    ok(await padTo('#wbAddStep'), 'pad: reaches “Add a step”'); await press('A'); await G.waitForTimeout(150);
    ok(await G.locator('#wbList .wbcard').count() === n1 + 1, 'pad: A adds a step');
    ok(await padTo('#mwSave'), 'pad: reaches Save workout'); await press('A'); await G.waitForSelector('.mwbox', { state: 'detached' }); await G.waitForTimeout(300);
    const padW = (await listOf(token)).find(w => w.name === nm);
    ok(!!padW && padW.v === 2 && padW.steps[1].target.pct === p0 + 2 && padW.steps.at(-2).type === 'work' && padW.steps.at(-1).type === 'cooldown', 'pad: saved on the server with the value and the new step (in before the cool-down)');
    ok(await padTo('#wMine'), 'pad: reaches “My workouts”'); await press('A'); await G.waitForURL(/profil\.html/); await G.waitForSelector('.mwitem'); await G.waitForTimeout(500);
    await press('down');
    const del = `.mwitem[data-id="${padW?.id}"] [data-del]`;
    ok(await padTo(del, 120), 'pad: in the profile, reaches Delete of the new workout');
    await press('A'); await G.waitForSelector('.mwask'); await padTo('.mwask button.danger'); await press('A'); await G.waitForTimeout(500);
    ok(!(await listOf(token)).some(w => w.id === padW?.id) && !(await G.locator(`.mwitem[data-id="${padW?.id}"]`).count()), 'pad: deleted after the in-page question');
    // the fit line by pad: “Ride N laps” and a suggested route are buttons the pad reaches
    await G.goto(BASE + '/?desktop&noprofile&demo&view=detail&id=demo'); await G.waitForSelector('#workSel'); await G.selectOption('#workSel', 'z2_90'); await G.waitForTimeout(500);
    await press('down'); ok(await padTo('#mwFitLaps'), 'pad: reaches “Ride N laps”'); const needG = await G.getAttribute('#mwFitLaps', 'data-laps'); await press('A'); await G.waitForTimeout(300);
    ok(await val('#lapSel') === needG, `pad: A sets ${needG} laps`);
    await G.selectOption('#lapSel', '1'); await G.waitForTimeout(300);
    ok(await padTo('#mwFitLine .mwfitr'), 'pad: reaches a suggested route'); const toG = await G.evaluate(() => window.__padnav.cur.textContent);
    await press('A');
    const h1G = await G.waitForFunction(t => { const h = document.querySelector('h1')?.textContent.replace(/\s/g, ''); return h === t && h; }, toG.replace(/\s/g, ''), { timeout: 30000 }).then(h => h.jsonValue(), () => G.textContent('h1'));
    ok(h1G.replace(/\s/g, '') === toG.replace(/\s/g, ''), `pad: A opens ${toG} (${h1G})`);
    await gctx.close();

    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + e.message); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nMy workouts UI: all good'); process.exit(fails ? 1 : 0);
})();
