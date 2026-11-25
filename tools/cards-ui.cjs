// End to end for the Today page (handy.html: js/today.js, js/cards.js) and Training (training.html, js/trainplan.js), 25.11.:
// a demo account with data (activities on the phone, weigh-ins, a paired watch with recovery values, a plan, a coach link): the
// readiness hero, today's planned session with Start, the week strip, what changed, the cards; the hero states (ready / tired /
// not enough data / rest day / planned session); an empty account and signed out (an explanation and the start actions, no wall
// of empty cards); edit mode: drag by mouse and by touch, the arrows, remove, add back, size, reset; the arrangement kept after a
// reload and on the server; no sideways scroll and no overlapping cards at 360 / 320 px and 1280 px; every card's link exists;
// Training: plan a session, it shows on Today. Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) RIDEFRAME_DATA=$(mktemp -d) node tools/cards-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0'), dk = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ROOT = path.join(__dirname, '..');

/** the phone's activities for the demo account: six weeks of rides, runs and strength (light records, like imported ones) */
const seedActs = p => p.evaluate(async () => {
  const { db } = await import('/js/db.js'), now = Date.now(), d = 864e5, day0 = new Date(now).setHours(0, 0, 0, 0);
  for (const r of await db.all('rides')) await db.del('rides', r.id);
  const at = (n, h) => day0 - n * d + h * 3600e3;
  const ride = (id, n, min, km, w, name, x = {}) => ({ id, routeId: 'outdoor', sport: 'ride', outdoor: true, date: at(n, 17), complete: true, duration: min * 60, elapsed: min * 60 + 60, distance: km * 1000, gain: 300, workout: name, avgPower: w, np: w + 10, best20: x.b20 ?? w + 15, best5: x.b5 ?? w + 45, kj: Math.round(w * min * 60 / 1000), avgHr: 140, ...x });
  const run = (id, n, min, km, name, splits) => ({ id, routeId: 'run', sport: 'run', outdoor: true, date: at(n, 7), complete: true, duration: min * 60, elapsed: min * 60, distance: km * 1000, gain: 40, workout: name, avgHr: 150, kmSplits: splits });
  const L = [];
  for (let wk = 6; wk >= 1; wk--) { L.push(ride('r' + wk + 'a', wk * 7 + 1, 75, 38, 200 + wk, 'Endurance ride'), ride('r' + wk + 'b', wk * 7 + 4, 120, 62, 190, 'Long ride')); L.push(run('u' + wk, wk * 7 + 2, 42, 8, 'Easy run', [312, 309, 315, 318, 311, 307, 316, 312])); }
  L.push(ride('r0a', 3, 65, 33, 236, 'Sweet Spot 3 × 10', { b20: 262, b5: 318 }), run('u0', 2, 38, 7.5, 'Tempo run', [288, 281, 279, 284, 282, 286, 280]), ride('r0b', 1, 90, 46, 205, 'Endurance ride'));
  for (const r of L) await db.put('rides', r);
  const set = (kg, r, pr) => ({ kg: String(kg), r: String(r), done: true, ...(pr ? { pr: true } : {}) });
  const k = [];
  for (let wk = 5; wk >= 0; wk--) k.push({ id: 'k' + wk, name: wk % 2 ? 'Pull day' : 'Push day', start: at(wk * 7 + 2, 18), date: at(wk * 7 + 2, 19), dur: 3300, prs: wk ? 0 : 1,
    ex: [{ k: 'bench', n: 'Bench press', t: 'w', sets: [set(80 + (5 - wk) * 2.5, 8, !wk), set(80, 8), set(80, 7)] }, { k: 'pull', n: 'Pull-ups', t: 'bw', sets: [{ kg: '', r: '10', done: true }, { kg: '', r: '9', done: true }] }, { k: 'ohp', n: 'Overhead press', t: 'w', sets: [set(45, 8), set(45, 8)] }] });
  await db.kvSet('kraft', k);
  const st = (await db.kvGet('settings')) || {}; st.ftp = 250; st.riderKg = 75; await db.kvSet('settings', st);
});
const clearActs = p => p.evaluate(async () => { const { db } = await import('/js/db.js'); for (const r of await db.all('rides')) await db.del('rides', r.id); await db.kvSet('kraft', []); const s = (await db.kvGet('settings')) || {}; delete s.homeCards; await db.kvSet('settings', s); });

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-cards-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  try {
    const api = (m, p, body, h = {}) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...h }, body: body && JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json().catch(() => ({})) }));
    const reg = async name => (await api('POST', '/api/account/register', { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' })).j;
    const A = await reg('Demo Dana'), E = await reg('New Nora'), T = { 'X-RF-Token': A.token }, now = Date.now(), today = dk(now);
    // body: 40 mornings, slowly down; the watch: 8 days of recovery values; the coach link; the plan of this week
    await api('POST', '/api/body/import', { rows: [...Array(40)].map((_, i) => ({ t: now - (39 - i) * 864e5 - 2 * 3600e3, kg: Math.round((76.4 - i * 0.045 + (i % 3) * 0.15) * 10) / 10 })) }, T);
    const code = (await api('POST', '/api/watch/code', null, T)).j.code, w = (await api('POST', '/api/watch/pair', { code, label: 'fenix 8' })).j.token;
    const snap = (i, v) => api('POST', '/api/watch/health', { day: dk(now - i * 864e5), t: Math.round((now - i * 864e5 - (i ? 0 : 60e3)) / 1000), ...v }, { Authorization: 'Bearer ' + w });
    for (let i = 7; i >= 1; i--) await snap(i, { rhr: 50, bb: 60 });
    await snap(0, { rhr: 47, bb: 84, rt: 300, v2r: 54, v2b: 56, ts: 'Productive', st: 18 });
    await api('POST', '/api/account/mcp', {}, T);
    const monday = (() => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
    const wd = n => { const d = new Date(monday); d.setDate(d.getDate() + n); return dk(d); };
    const plan = async e => { const r = await api('POST', '/api/account/plan', e, T); if (r.status !== 200) throw new Error('plan: ' + JSON.stringify(r.j)); return r.j.entry; };
    const P0 = await plan({ day: today, kind: 'ride', title: 'Sweet Spot 3 × 10', ref: 'ss3x10', minutes: 70, note: 'Steady, 90 % FTP, cadence 90.' });
    for (const n of [0, 2, 4, 6]) if (wd(n) !== today) await plan({ day: wd(n), kind: n === 4 ? 'rest' : n === 6 ? 'run' : 'strength', title: n === 4 ? 'Rest day' : n === 6 ? 'Long run' : 'Push day', ...(n === 6 ? { minutes: 75 } : {}) });

    const errs = []; let P;
    const page = async (ctx, url = '/handy.html') => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.goto(BASE + url); return p; };
    const as = async (p, a) => { await p.evaluate(a => a ? localStorage.setItem('rf_account', JSON.stringify({ token: a.token, name: a.name })) : localStorage.removeItem('rf_account'), a); await p.reload(); await p.waitForSelector('#hSet'); };
    const settle = async p => { await p.waitForFunction(() => document.querySelector('#ovGrid') && ![...document.querySelectorAll('.cd')].some(c => c.dataset.state === 'loading') && !document.querySelector('.tdload'), null, { timeout: 15000 }); await wait(250); };
    /** no sideways scroll, nothing sticking out of the page, no two cards overlapping */
    const layout = p => p.evaluate(() => { const W = innerWidth, bad = [], over = [];
      for (const e of document.querySelectorAll('#handy *, #training *')) { const r = e.getBoundingClientRect(); if (!r.width || getComputedStyle(e).position === 'fixed' || e.closest('.ovsr, .bnav, .psheet')) continue; if (r.right > W + 1 || r.left < -1) bad.push((e.id || e.className || e.tagName) + ''); }
      const cs = [...document.querySelectorAll('.cd')].filter(c => c.offsetParent).map(c => [c.dataset.card, c.getBoundingClientRect()]);
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) { const [a, A] = cs[i], [b2, B] = cs[j]; if (A.left < B.right - 1 && B.left < A.right - 1 && A.top < B.bottom - 1 && B.top < A.bottom - 1) over.push(a + '/' + b2); }
      return { side: document.documentElement.scrollWidth > W + 1, bad: bad.slice(0, 8), over }; });
    const shot = async (p, nm, full = true) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${nm}.png`, fullPage: full }); };
    const phone = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

    /* ---- signed out, nothing on this phone ---- */
    P = await page(phone); await P.waitForSelector('#hSet'); await clearActs(P); await as(P, null); await P.waitForSelector('.ovwel');
    ok(/All your training in one place/.test(await P.textContent('.ovwel')) && await P.isVisible('#ovIn'), 'signed out: a short explanation with Sign in');
    ok(await P.locator('.hstart a.hmode').count() === 5 && await P.isVisible('.hstart'), 'signed out: the five start actions');
    ok(!(await P.locator('.cd:visible').count()), 'signed out, no data: no wall of empty cards');
    ok(/Not enough data yet/.test(await P.textContent('.tdhero')) && /Sleep/.test(await P.textContent('.tdchips')), 'signed out: the hero says not enough data, no number');
    ok(await P.textContent('.tdnum') === '–', 'no faked readiness number');
    let L = await layout(P); ok(!L.side && !L.bad.length, 'signed out: nothing sticks out at 360 px ' + JSON.stringify(L));
    await shot(P, 'signed_out_360');

    /* ---- the new account: welcome and first steps ---- */
    await as(P, E); await P.waitForSelector('.ovwel .ovsteps'); await settle(P).catch(() => {});
    ok(/Welcome, New Nora/.test(await P.textContent('.ovwel')), 'new account: welcome by name');
    const steps = await P.$$eval('.ovstep', l => l.map(a => a.getAttribute('href')));
    ok(steps.length === 5 && steps.includes('body.html') && steps.includes('handy.html#settings-watch') && steps.includes('handy.html#settings-coach'), 'new account: five first steps ' + steps.join(' '));
    ok(!(await P.locator('.cd[data-state="empty"]:visible').count()), 'new account: empty cards stay out of the way');
    ok(/Nothing planned today/.test(await P.textContent('.tdtoday')) && await P.isVisible('#tdPlanIt'), 'new account: nothing planned, a quiet suggestion with Plan it');
    await shot(P, 'empty_account_360');
    await P.click('.ovstep[href="handy.html#settings-coach"]'); await P.waitForSelector('#tMcp', { timeout: 5000 }); ok(await P.isVisible('.psheet'), 'first step "Connect your coach": opens Settings'); await P.click('#tOk');

    /* ---- the demo account ---- */
    await as(P, A); await seedActs(P); await P.reload(); await settle(P);
    const hero = await P.textContent('.tdhero');
    ok(/^\d+$/.test(await P.textContent('.tdnum')) && /Body battery/.test(hero) && /Resting HR/.test(hero) && /Form/.test(hero) && /Yesterday/.test(hero), 'hero: a readiness number with its inputs as chips');
    ok(/Sleep\s*connect/.test(await P.textContent('#tdSleep')), 'hero: "Sleep: connect" while there is no sleep data');
    await P.click('#tdSleep'); ok(await P.isVisible('#tdSleepTxt') && !/will|soon|coming/i.test(await P.textContent('#tdSleepTxt')), 'Sleep chip: says why, promises nothing');
    ok(/Sweet Spot 3 × 10/.test(await P.textContent('.tdtoday')) && await P.getAttribute('.tdstart', 'href') === 'pure.html?workout=ss3x10', 'today: the planned ride with Start opening exactly that workout');
    ok(await P.locator('.tdweek .tdday').count() === 7 && await P.locator('.tdday.now').count() === 1, 'the week strip: Monday to Sunday, today marked');
    const ins = await P.$$eval('.tdins', l => l.map(a => [a.textContent.trim(), a.getAttribute('href')]));
    ok(ins.length >= 2 && ins.length <= 4 && ins.some(([t]) => /Weight trend down/.test(t)) && ins.some(([t]) => /Fitness/.test(t)), 'what changed: 2 to 4 lines from the data ' + JSON.stringify(ins.map(x => x[0])));
    const order = await P.evaluate(() => ['#hHero', '#hPlan', '.hstart', '#hWhat', '#hOv'].map(s => document.querySelector(s).getBoundingClientRect().top));
    ok(order.every((v, i) => !i || v > order[i - 1]), 'order: readiness, today, record, what changed, cards');
    const cards = await P.$$eval('#ovGrid > .cd', l => l.map(c => c.dataset.card));
    ok(cards.slice(0, 6).join() === 'today,last,recovery,weight,fitness,strength', 'default order of the cards: ' + cards.join(','));
    ok(!(await P.locator('.cd[data-state="error"]').count()), 'no card failed');
    const states = await P.$$eval('.cd', l => l.map(c => c.dataset.card + ':' + c.dataset.state).join(' '));
    ok(!/:empty/.test(states.replace(/battery|rhr|sleep/g, '')), 'every default card has data for the demo account: ' + states);
    ok(/Watch · Screens & workouts/.test(await P.textContent('[data-card="watch"]')) && /fenix 8/.test(await P.textContent('[data-card="watch"]')), 'the watch card (paired)');
    ok(/VO2max/i.test(await P.textContent('[data-card="vo2"]')) && /watch/.test(await P.textContent('[data-card="vo2"]')) && /estimate/.test(await P.innerHTML('[data-card="vo2"]')), 'VO2max: watch value and estimate, each labelled');
    ok(/Connected/.test(await P.textContent('[data-card="coach"]')), 'the coach card: connected');
    // every link of the page goes somewhere that exists
    const links = await P.$$eval('#handy a[href]', l => [...new Set(l.map(a => a.getAttribute('href')).filter(h => h && !h.startsWith('#')))]);
    let dead = []; for (const h of links) { const u = new URL(h, BASE + '/handy.html'); if (u.origin !== BASE) continue; const r = await fetch(u.origin + u.pathname); if (r.status !== 200) dead.push(h); }
    ok(!dead.length && links.length > 15, `every link of the page exists (${links.length})` + (dead.length ? ': ' + dead.join(' ') : ''));
    for (const wdt of [360, 320]) { await P.setViewportSize({ width: wdt, height: 740 }); await wait(200); L = await layout(P); ok(!L.side && !L.bad.length && !L.over.length, `demo: no sideways scroll, nothing sticking out, no overlapping cards at ${wdt} px ` + JSON.stringify(L)); }
    await P.setViewportSize({ width: 360, height: 740 }); await wait(150);
    const halves = await P.evaluate(() => { const a = document.querySelector('[data-card="fitness"]').getBoundingClientRect(), b2 = document.querySelector('[data-card="strength"]').getBoundingClientRect(); return Math.abs(a.top - b2.top) < 2 && a.right <= b2.left; });
    ok(halves, '360 px: two half cards side by side');
    await shot(P, 'today_demo_360');
    await P.evaluate(() => document.querySelector('#hOv').scrollIntoView()); await wait(100); await shot(P, 'today_demo_cards_360', false);
    // last activity: tap opens that activity
    await P.click('[data-card="last"]'); await P.waitForSelector('.psheet .fdet', { timeout: 4000 }).catch(() => {}); ok(await P.locator('.psheet .fdet').count() === 1, 'Last activity: a tap opens that activity'); await P.evaluate(() => document.querySelectorAll('.psheet').forEach(s => s.remove()));
    ok(/aktivitaeten\.html\?open=r%3Ar0b/.test(await P.getAttribute('[data-card="last"]', 'href')), 'Last activity: its link is that activity on the Activities page');

    /* ---- edit mode ---- */
    const ids = () => P.$$eval('#ovList .ovrow', l => l.map(r => r.dataset.id));
    await P.click('#ovEdit'); await P.waitForSelector('#ovList');
    let before = await ids(); ok(before[0] === 'today' && before.length === 13, 'edit: the list of shown cards ' + before.join(','));
    // drag by touch: the third card's handle up to the top
    const touchDrag = async (fromSel, toY) => {
      const g = await P.$(fromSel), bb = await g.boundingBox(), x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
      const s = await P.context().newCDPSession(P), tp = (type, y2) => s.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: y2, id: 1 }] });
      await tp('touchStart', y); for (let i = 1; i <= 12; i++) { await tp('touchMove', y + (toY - y) * i / 12); await wait(16); } await wait(60); await tp('touchEnd'); await s.detach();
    };
    const top0 = (await (await P.$('#ovList .ovrow')).boundingBox()).y;
    await P.evaluate(() => document.querySelector('#ovList .ovrow:nth-child(3)').scrollIntoView({ block: 'center' })); await wait(100);
    const t1 = (await (await P.$('#ovList .ovrow:nth-child(1)')).boundingBox()).y;
    await touchDrag('#ovList .ovrow:nth-child(3) .ovgrip', t1 + 4);
    let after = await ids(); ok(after[0] === 'recovery' && after[1] === 'today', 'drag by touch: Recovery moved to the top ' + after.slice(0, 3).join(','));
    void top0;
    // mouse drag: the first card down below the fourth, a screenshot mid-drag
    const m = async (sel, dy, mid) => { const g = await P.$(sel), bb = await g.boundingBox(), x = bb.x + bb.width / 2, y = bb.y + bb.height / 2; await P.mouse.move(x, y); await P.mouse.down();
      for (let i = 1; i <= 10; i++) { await P.mouse.move(x, y + dy * i / 10); await wait(16); if (i === 6 && mid) await mid(); } await P.mouse.up(); };
    await P.evaluate(() => document.querySelector('#ovList').scrollIntoView({ block: 'start' })); await P.evaluate(() => scrollBy(0, -90)); await wait(100);
    const rowH = (await (await P.$('#ovList .ovrow')).boundingBox()).height + 6;
    await m('#ovList .ovrow:nth-child(1) .ovgrip', rowH * 3.5, () => shot(P, 'edit_mid_drag_360', false));
    after = await ids(); ok(after.indexOf('recovery') === 3, 'drag by mouse: Recovery to the fourth place ' + after.slice(0, 5).join(','));
    // keyboard on the handle and the arrow buttons
    await P.focus('.ovrow[data-id="recovery"] .ovgrip'); await P.keyboard.press('ArrowUp'); after = await ids(); ok(after.indexOf('recovery') === 2, 'keyboard: arrow up on the handle moves it up');
    ok(await P.evaluate(() => document.activeElement?.closest('.ovrow')?.dataset.id) === 'recovery', 'keyboard: the focus stays on the moved card');
    await P.click('.ovrow[data-id="recovery"] .ovmv[data-d="1"]'); after = await ids(); ok(after.indexOf('recovery') === 3, 'the down button');
    // size, remove, add back
    await P.click('.ovrow[data-id="today"] .ovsz'); ok(/Half/.test(await P.textContent('.ovrow[data-id="today"] .ovsz')), 'size: This week now half width');
    await P.click('.ovrow[data-id="records"] .ovrm'); ok(!(await ids()).includes('records') && await P.locator('[data-add="records"]').count() === 1, 'remove: Records is under Add cards');
    await P.click('[data-add="battery"]'); after = await ids(); ok(after[after.length - 1] === 'battery', 'add: Body battery at the end');
    await P.evaluate(() => document.querySelector('#ovAddH').scrollIntoView({ block: 'start' })); await wait(100); await shot(P, 'edit_add_cards_360', false);
    L = await layout(P); ok(!L.side && !L.bad.length, 'edit mode: nothing sticks out at 360 px ' + JSON.stringify(L));
    await P.setViewportSize({ width: 320, height: 740 }); await wait(150); L = await layout(P); ok(!L.side && !L.bad.length, 'edit mode: nothing sticks out at 320 px ' + JSON.stringify(L)); await P.setViewportSize({ width: 360, height: 740 });
    await P.click('#ovDone'); await settle(P);
    const shown = await P.$$eval('#ovGrid > .cd', l => l.map(c => c.dataset.card + ':' + c.className.match(/cd-(half|full)/)[1]));
    ok(shown[0] === 'today:half' && !shown.some(x => x.startsWith('records')) && shown[shown.length - 1].startsWith('battery'), 'the overview follows: ' + shown.join(' '));
    await wait(900); // the account gets it half a second later
    const srvL = (await api('GET', '/api/account/home', null, T)).j.layout;
    ok(srvL && srvL.cards[0].id === 'today' && srvL.cards[0].size === 'half' && srvL.hidden.includes('records'), 'saved in the account');
    await P.reload(); await settle(P);
    ok((await P.$$eval('#ovGrid > .cd', l => l.map(c => c.dataset.card + ':' + c.className.match(/cd-(half|full)/)[1]))).join() === shown.join(), 'kept after a reload');
    // another device (a fresh browser) gets the account's arrangement
    const other = await b.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true }), Q = await page(other); await Q.waitForSelector('#hSet'); await as(Q, A); await seedActs(Q); await Q.reload(); await settle(Q); await wait(500);
    ok((await Q.$$eval('#ovGrid > .cd', l => l.map(c => c.dataset.card)))[0] === 'today' && !(await Q.locator('[data-card="records"]').count()), 'another device: the same arrangement from the account'); await other.close();
    // reset
    P.once('dialog', d => d.accept()); await P.click('#ovEdit'); await P.click('#ovReset'); await P.click('#ovDone'); await settle(P);
    ok((await P.$$eval('#ovGrid > .cd', l => l.map(c => c.dataset.card))).slice(0, 4).join() === 'today,last,recovery,weight', 'reset: back to the default');
    await P.reload(); await settle(P); await wait(300); // leaving at once: the waiting save still reaches the account
    const srvR = (await api('GET', '/api/account/home', null, T)).j.layout;
    ok(srvR && srvR.def === true && !srvR.cards, 'reset: the default is saved in the account even when the page is left at once ' + JSON.stringify(srvR));

    /* ---- hero states (answers of the account faked where the server cannot make them) ---- */
    const heroWith = async (nm, h, entries) => {
      await P.route('**/api/account/health?days=8', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(h) }));
      if (entries) await P.route(/\/api\/account\/plan\?/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries }) }));
      await P.reload(); await settle(P); await P.evaluate(() => scrollTo(0, 0));
      const t = { num: await P.textContent('.tdnum'), word: await P.textContent('#tdWord'), plan: await P.textContent('.tdtoday') };
      await shot(P, 'hero_' + nm, false); await P.unroute('**/api/account/health?days=8'); if (entries) await P.unroute(/\/api\/account\/plan\?/); return t;
    };
    const hd = (i, v) => ({ day: dk(now - i * 864e5), first: now - i * 864e5, last: now - i * 864e5, ...v });
    const days = (top, rest) => [hd(0, top), ...[1, 2, 3, 4, 5, 6, 7].map(i => hd(i, rest))];
    const lat = d => ({ latest: Object.fromEntries(['bb', 'rhr', 'ss'].filter(k => d[0][k] != null).map(k => [k, { v: d[0][k], day: d[0].day }])), days: d });
    await P.route(/\/api\/account\/kraft/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ids":[]}' })); await clearActs(P); // a rested week: no training on this phone
    let h = await heroWith('ready', lat(days({ bb: 92, rhr: 45 }, { bb: 70, rhr: 50 })));
    await P.unroute(/\/api\/account\/kraft/); await seedActs(P);
    ok(+h.num >= 75 && /Ready/.test(h.word), 'hero: ready ' + h.num + ' ' + h.word);
    h = await heroWith('tired', lat(days({ bb: 14, rhr: 58 }, { bb: 60, rhr: 50 })));
    ok(+h.num < 55 && /easy|Rest/.test(h.word), 'hero: tired ' + h.num + ' ' + h.word);
    h = await heroWith('rest_day', lat(days({ bb: 70, rhr: 50 }, { bb: 60, rhr: 50 })), [{ id: 'px1', day: today, kind: 'rest', title: 'Rest day', at: 1 }]);
    ok(/Rest day/.test(h.plan) && /Recovery is part of the plan/.test(h.plan), 'today: a planned rest day');
    h = await heroWith('planned_session', lat(days({ bb: 80, rhr: 48 }, { bb: 60, rhr: 50 })), [{ id: 'px2', day: today, kind: 'strength', title: 'Push day', ref: 'w1', minutes: 50, note: 'Bench 4 × 6, add 2.5 kg.', by: 'coach', at: 1 }]);
    ok(/Push day/.test(h.plan) && /from your coach/.test(h.plan), 'today: a planned session from the coach');
    ok(await P.getAttribute('.tdstart', 'href') === 'kraft.html?watch=w1', 'Start of a strength session: exactly that watch workout');
    await P.route(/\/api\/account\/kraft/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ids":[]}' })); await clearActs(P); await as(P, E); h = await heroWith('not_enough_data', { latest: { bb: { v: 70, day: today } }, days: [hd(0, { bb: 70 })] });
    ok(h.num === '–' && /Not enough data yet/.test(h.word) && /Only body battery so far/.test(await P.textContent('.tdwhy')), 'hero: one input only: not enough data, no number, says which');
    await P.unroute(/\/api\/account\/kraft/); await as(P, A); await seedActs(P);

    /* ---- Training: plan a session, it shows on Today ---- */
    const TR = await page(phone, '/training.html'); await TR.waitForSelector('.trdays');
    ok(await TR.locator('.trday').count() === 7 && /Sweet Spot 3 × 10/.test(await TR.textContent('.trday.now')), 'Training: the week with today\'s planned ride');
    const tomorrow = dk(now + 864e5), tw = await TR.$(`[data-add="${tomorrow}"]`);
    if (!tw) { await TR.click('#trNext'); await TR.waitForSelector(`[data-add="${tomorrow}"]`); }
    await TR.click(`[data-add="${tomorrow}"]`); await TR.waitForSelector('#trSheet');
    await TR.click('#trSheet [data-k="run"]'); await TR.fill('#trTitle', 'Intervals 6 × 800 m'); await TR.fill('#trMin', '55'); await shot(TR, 'training_plan_sheet_360', false); await TR.click('#trOk');
    await TR.waitForFunction(t => /Intervals 6 × 800 m/.test(document.querySelector('#d-' + t)?.textContent || ''), tomorrow);
    ok(true, 'Training: a run planned for tomorrow');
    const lst = (await api('GET', `/api/account/plan?from=${tomorrow}&to=${tomorrow}`, null, T)).j.entries; ok(lst.length === 1 && lst[0].kind === 'run' && lst[0].minutes === 55, 'stored in the account');
    L = await layout(TR); ok(!L.side && !L.bad.length, 'Training: nothing sticks out at 360 px ' + JSON.stringify(L));
    await TR.evaluate(() => scrollTo(0, 0)); await shot(TR, 'training_360');
    const bn = await TR.$$eval('.bnav a', l => l.map(a => a.textContent.trim() + '>' + a.getAttribute('href')));
    ok(bn.join() === 'Today>handy.html,Training>training.html,Activities>aktivitaeten.html,Body>body.html,Profile>profil.html', 'bottom bar: Today, Training, Activities, Body, Profile');
    await TR.close();
    void P0;

    /* ---- the pages Today leads to open without errors; Start of a planned watch workout opens exactly it ---- */
    const cfg = (await api('GET', '/api/watch/config', null, T)).j.config; cfg.workouts = [{ id: 'wpush1', name: 'Push day', items: [{ ex: 'bench', sets: 4, reps: 6, kg: 80, rest: 120 }, { ex: 'plank', sets: 2, reps: 60, kg: 0, rest: 60 }] }, ...(cfg.workouts || [])];
    ok((await api('PUT', '/api/watch/config', cfg, T)).status === 200, 'a watch workout for the Start test');
    const kc = await b.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true }), K = await kc.newPage(); K.on('pageerror', e => errs.push('page: ' + e.message));
    await K.goto(BASE + '/reset.html').catch(() => {}); await K.evaluate(a => localStorage.setItem('rf_account', JSON.stringify({ token: a.token, name: a.name })), A); await K.goto(BASE + '/kraft.html?watch=wpush1');
    const started = await K.waitForFunction(() => document.querySelector('#kName')?.value === 'Push day' && !location.search, null, { timeout: 8000 }).then(() => true, () => false);
    ok(started && /Bench/i.test(await K.textContent('body')), 'kraft.html?watch=<id>: that watch workout starts, the address is cleaned');
    for (const u of ['/training.html', '/aktivitaeten.html', '/body.html', '/profil.html', '/statistik.html', '/kraft.html', '/?desktop&noprofile']) { const n = errs.length;
      await K.goto(BASE + u); await wait(1200); ok(errs.length === n, `${u} opens without page errors` + (errs.length > n ? ': ' + errs.slice(n).join(' | ') : '')); }
    await kc.close();

    /* ---- desktop ---- */
    const desk = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }), DP = await page(desk); await DP.waitForSelector('#hSet'); await as(DP, A); await seedActs(DP); await DP.reload(); await settle(DP);
    L = await layout(DP); ok(!L.side && !L.bad.length && !L.over.length, 'desktop 1280: no sideways scroll, no overlapping cards ' + JSON.stringify(L));
    ok(await DP.evaluate(() => { const a = document.querySelector('#hHero').getBoundingClientRect(), p = document.querySelector('#hPlan').getBoundingClientRect(); return Math.abs(a.top - p.top) < 2 && a.right < p.left; }), 'desktop: readiness and today side by side');
    ok(await DP.evaluate(() => new Set([...document.querySelectorAll('#ovGrid > .cd')].map(c => Math.round(c.getBoundingClientRect().top))).size < document.querySelectorAll('#ovGrid > .cd').length - 3), 'desktop: the cards in several columns');
    await shot(DP, 'desktop_1280');
    // edit by mouse on the desktop as well
    await DP.click('#ovEdit'); await DP.evaluate(() => document.querySelector('#ovList').scrollIntoView({ block: 'center' })); await wait(100); const g = await DP.$('#ovList .ovrow:nth-child(2) .ovgrip'), gb = await g.boundingBox(); await DP.mouse.move(gb.x + 20, gb.y + 20); await DP.mouse.down(); for (let i = 1; i <= 8; i++) { await DP.mouse.move(gb.x + 20, gb.y + 20 - 60 * i / 8); await wait(16); } await DP.mouse.up();
    ok((await DP.$$eval('#ovList .ovrow', l => l.map(r => r.dataset.id)))[0] === 'last', 'desktop: drag by mouse'); await desk.close();

    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + (e.stack || e.message)); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nToday & cards UI: all good'); process.exit(fails ? 1 : 0);
})();
