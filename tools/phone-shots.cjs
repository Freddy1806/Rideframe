// Screenshots of every phone page at 390 × 844 @2x with a rich demo account (27.11., the owner's iPhone feedback): 8 weeks of rides
// (intervals with power samples), runs, strength sessions, weigh-ins with body fat / muscle / water / bone, the watch's recovery values,
// a plan for this week. Shoots every page at the top and as a full page, plus the sheets (Updates, Filter, the "+" menu, the week planner,
// a new workout) when they exist, and the same pages signed out and with a brand-new empty account.
// Usage: NODE_PATH=$(npm root -g) node tools/phone-shots.cjs <outDir> [--quick]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const OUT = process.argv[2] || 'shots-phone/after', QUICK = process.argv.includes('--quick'); fs.mkdirSync(OUT, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0'), dk = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ROOT = path.join(__dirname, '..');

/** the phone's activities: 8 weeks of rides (every second with power, the interval days with their intervals), runs, strength */
const seedActs = p => p.evaluate(async () => {
  const { db } = await import('/js/db.js'), now = Date.now(), D = 864e5, day0 = new Date(now).setHours(0, 0, 0, 0);
  for (const r of await db.all('rides')) await db.del('rides', r.id);
  const at = (n, h) => day0 - n * D + h * 3600e3;
  const samples = (blocks, hr0 = 118) => { const s = []; let t = 0, d = 0; for (const [sec, w] of blocks) for (let i = 0; i < sec; i++) { const p = Math.max(0, Math.round(w + Math.sin(t / 7) * 8 + (t % 13) - 6)), v = 6 + p / 40; d += v; s.push([t, Math.round(d), p, Math.round(v * 36) / 10, 88, Math.round(hr0 + p / 6)]); t++; } return s; };
  const ride = (id, n, blocks, name, x = {}) => { const S = samples(blocks), pw = S.map(q => q[2]), dur = S.length, avg = Math.round(pw.reduce((a, b) => a + b, 0) / dur);
    const best = sec => { let b = 0, sum = 0; for (let i = 0; i < pw.length; i++) { sum += pw[i]; if (i >= sec) sum -= pw[i - sec]; if (i >= sec - 1) b = Math.max(b, sum / sec); } return Math.round(b); };
    return { id, routeId: x.indoor ? 'pure' : 'outdoor', sport: 'ride', outdoor: !x.indoor, date: at(n, 18), complete: true, duration: dur, elapsed: dur + 60, distance: S[dur - 1][1], gain: x.indoor ? 0 : 420, workout: name,
      avgPower: avg, np: avg + 12, maxPower: Math.max(...pw), best20: best(1200), best5: best(300), kj: Math.round(avg * dur / 1000), avgHr: 142, maxHr: 176, samples: S, ...x }; };
  const run = (id, n, min, km, name, pace) => ({ id, routeId: 'run', sport: 'run', outdoor: true, date: at(n, 7), complete: true, duration: min * 60, elapsed: min * 60, distance: km * 1000, gain: 60, workout: name, avgHr: 151, maxHr: 178,
    kmSplits: [...Array(Math.floor(km))].map((_, i) => pace + (i % 3) * 4 - 4) });
  const L = [];
  for (let wk = 7; wk >= 0; wk--) {
    const b = wk * 7, f = 1 + (7 - wk) * 0.012; // a slowly rising form
    if (b + 1 > 0) L.push(ride('ivr' + wk, b + 1, [[900, 150], ...[...Array(5)].flatMap(() => [[180, Math.round(310 * f)], [180, 130]]), [600, 140]], 'VO2max 5 × 3', { indoor: true, workoutId: 'vo2_5x3',
      ivs: [...Array(5)].map((_, i) => ({ name: `VO2max ${i + 1}/5`, at: 900 + i * 360, t: 180, w: Math.round(305 * f) + i, wMax: Math.round(360 * f), hr: 166 + i, hrMax: 172 + i, cad: 94, ftp: 255, pct: 120, target: 306 })) }));
    if (b + 3 > 0) L.push(ride('end' + wk, b + 3, [[600, 150], [3600, Math.round(185 * f)], [600, 130]], 'Endurance ride'));
    if (b + 5 > 0 && wk % 2 === 0) L.push(ride('ss' + wk, b + 5, [[600, 150], [1200, Math.round(232 * f)], [240, 130], [1200, Math.round(234 * f)], [600, 130]], 'Sweet Spot 2 × 20', { indoor: true, workoutId: 'ss2x12' }));
    if (b + 2 > 0) L.push(run('run' + wk, b + 2, 44, 8.4, 'Easy run', 316 - (7 - wk) * 2));
    if (wk % 2 === 1) L.push(run('tempo' + wk, b + 4, 36, 7.2, 'Tempo run', 290 - (7 - wk) * 2));
  }
  for (const r of L) await db.put('rides', r);
  const set = (kg, r, pr) => ({ kg: String(kg), r: String(r), done: true, ...(pr ? { pr: true } : {}) });
  const k = [];
  for (let wk = 7; wk >= 0; wk--) k.push({ id: 'k' + wk, name: wk % 2 ? 'Pull day' : 'Push day', start: at(wk * 7 + 2, 18), date: at(wk * 7 + 2, 19), dur: 3300, prs: wk ? 0 : 1,
    ex: [{ k: 'bench', n: 'Bench press', t: 'w', sets: [set(80 + (7 - wk) * 2.5, 8, !wk), set(80, 8), set(80, 7)] }, { k: 'pull', n: 'Pull-ups', t: 'bw', sets: [{ kg: '', r: '10', done: true }, { kg: '', r: '9', done: true }] }, { k: 'ohp', n: 'Overhead press', t: 'w', sets: [set(45, 8), set(45, 8)] }] });
  await db.kvSet('kraft', k);
  await db.kvSet('kraftTpl', [{ name: 'Push day', ex: [{ k: 'bench', n: 3 }, { k: 'ohp', n: 3 }] }, { name: 'Pull day', ex: [{ k: 'pull', n: 3 }] }]);
  const st = (await db.kvGet('settings')) || {}; st.ftp = 255; st.riderKg = 74; st.hrMax = 186; st.hrRest = 48; await db.kvSet('settings', st);
});

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-phone-shots-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch(), errs = [], files = [];
  try {
    const api = (m, p, body, h = {}) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...h }, body: body && JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json().catch(() => ({})) }));
    const reg = async name => (await api('POST', '/api/account/register', { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' })).j;
    const A = await reg('Freddy Demo'), E = await reg('New Nora'), T = { 'X-RF-Token': A.token }, now = Date.now(), today = dk(now);
    // body: 90 mornings, slowly down, with what a smart scale reports
    await api('POST', '/api/body/import', { rows: [...Array(90)].map((_, i) => ({ t: now - (89 - i) * 864e5 - 2 * 3600e3, kg: Math.round((77.2 - i * 0.03 + (i % 3) * 0.2) * 10) / 10,
      fatPct: Math.round((17.8 - i * 0.02 + (i % 4) * 0.15) * 10) / 10, musclePct: Math.round((44.1 + i * 0.008) * 10) / 10, waterPct: 58.4, boneKg: 3.3, bmi: Math.round((77.2 - i * 0.03) / 1.82 / 1.82 * 10) / 10 })) }, T);
    await api('PUT', '/api/body/prefs', { heightCm: 182, sex: 'm', birthYear: 1988, goalKg: 73 }, T);
    // the watch: 14 days of recovery values
    const code = (await api('POST', '/api/watch/code', null, T)).j.code, w = (await api('POST', '/api/watch/pair', { code, label: 'fenix 8' })).j.token;
    const snap = (i, v) => api('POST', '/api/watch/health', { day: dk(now - i * 864e5), t: Math.round((now - i * 864e5 - (i ? 0 : 60e3)) / 1000), ...v }, { Authorization: 'Bearer ' + w });
    for (let i = 13; i >= 1; i--) await snap(i, { rhr: 49 + (i % 3), bb: 55 + (i * 7) % 30, st: 22 + i % 5, steps: 8000 + i * 300 });
    await snap(0, { rhr: 47, bb: 82, rt: 420, v2r: 54, v2b: 57, ts: 'Productive', st: 19, steps: 3200, rr: 14.5 });
    await api('POST', '/api/account/mcp', {}, T);
    // the plan of this week
    const mon = (() => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
    const wd = n => { const d = new Date(mon); d.setDate(d.getDate() + n); return dk(d); };
    await api('POST', '/api/account/plan', { day: today, kind: 'ride', title: 'VO2max 5 × 3', ref: 'vo2_5x3', minutes: 62, note: '3 min at 120 % FTP, 3 min easy.' }, T);
    for (const [n, e] of [[0, { kind: 'strength', title: 'Push day' }], [2, { kind: 'run', title: 'Easy run', minutes: 45 }], [4, { kind: 'rest', title: 'Rest day' }], [6, { kind: 'ride', title: 'Long ride', minutes: 150 }]])
      if (wd(n) !== today) await api('POST', '/api/account/plan', { day: wd(n), ...e }, T);

    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const P = await ctx.newPage(); P.on('pageerror', e => errs.push(P.url().replace(BASE, '') + ': ' + e.message));
    const as = async a => { await P.goto(BASE + '/reset.html').catch(() => {}); await P.evaluate(a => a ? localStorage.setItem('rf_account', JSON.stringify({ token: a.token, name: a.name })) : localStorage.removeItem('rf_account'), a); };
    const shot = async (nm, full = false) => { const f = path.join(OUT, nm + '.png'); await P.screenshot({ path: f, fullPage: full }); files.push(f); };
    const side = () => P.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    const go = async (url, settle = 1800) => { await P.goto(BASE + url, { waitUntil: 'commit' }); await P.waitForSelector('.bnav, .ptop', { timeout: 20000 }).catch(() => errs.push('slow: ' + url)); await wait(settle); await P.evaluate(() => scrollTo(0, 0)); };
    const exists = async u => (await fetch(BASE + u)).status === 200;
    const workoutsUrl = (await exists('/workouts.html')) ? '/workouts.html' : '/training.html';
    const pages = [['today', '/handy.html'], ['workouts', workoutsUrl], ['activities', '/aktivitaeten.html'], ['stats', '/statistik.html'], ['body', '/body.html'], ['profile', '/profil.html']];
    const shootAll = async pre => { for (const [nm, u] of pages) { await go(u); await shot(`${pre}${nm}_top`); await shot(`${pre}${nm}_full`, true); if (await side()) errs.push(`${pre}${nm}: page scrolls sideways`); } };
    const sheet = async (nm, sel, open) => { if (!(await P.$(sel))) return; await open(); await wait(700); await shot(nm); await P.evaluate(() => document.querySelectorAll('.psheet, .fmenu, .modal').forEach(s => s.remove())); };

    /* ---- the demo account ---- */
    await as(A); await P.goto(BASE + '/handy.html'); await wait(500); await seedActs(P);
    await shootAll('');
    if (!QUICK) for (const [nm, u] of [['outdoor', '/outdoor.html'], ['indoor', '/pure.html'], ['strength', '/kraft.html']]) { await go(u, 1500); await shot(nm + '_top'); }
    // the sheets
    await go('/handy.html', 2500);
    await sheet('sheet_updates', '#hBell', () => P.click('#hBell'));
    await sheet('sheet_week_planner', '#tdWeek', () => P.click('#tdWeek'));
    await sheet('sheet_day_planner', '.tdday', () => P.click('.tdday.now'));
    await sheet('sheet_day_new', '.tdday', () => P.click('.tdweek li:last-child .tdday'));
    await go('/handy.html', 2500); await P.evaluate(() => document.querySelector('#hOv')?.scrollIntoView()); await wait(400); await shot('today_overview');
    await P.evaluate(() => document.querySelector('[data-card="weight"]')?.scrollIntoView({ block: 'center' })); await wait(300); await shot('today_weight_vo2');
    await go('/aktivitaeten.html');
    await sheet('sheet_filter', '#fFilter', () => P.click('#fFilter'));
    await sheet('sheet_plus_menu', '#fPlus', () => P.click('#fPlus'));
    await go(workoutsUrl, 2000);
    await sheet('sheet_new_ride_workout', '[data-new="ride"]', () => P.click('[data-new="ride"]'));
    await go(workoutsUrl, 2000);
    await sheet('sheet_new_run_workout', '[data-new="run"]', () => P.click('[data-new="run"]'));
    await go('/profil.html');
    for (const k of ['personal', 'records', 'totals']) await sheet('sheet_profile_' + k, `[data-open="${k}"]`, () => P.click(`[data-open="${k}"]`));
    await go('/handy.html#settings', 1500); await wait(500); if (await P.$('.psheet')) { await P.evaluate(() => document.querySelector('#tActs, #tStrava')?.scrollIntoView({ block: 'start' })); await wait(300); await shot('sheet_settings_activities'); }

    /* ---- a brand-new account and signed out ---- */
    if (!QUICK) {
      await P.evaluate(async () => { const { db } = await import('/js/db.js'); for (const r of await db.all('rides')) await db.del('rides', r.id); await db.kvSet('kraft', []); await db.kvSet('kraftTpl', []); await db.kvSet('settings', {}); });
      await as(E); await shootAll('new_');
      await as(null); await shootAll('signedout_');
    }
    console.log(files.map(f => path.relative(ROOT, f)).join('\n'));
    console.log(errs.length ? '\nproblems:\n' + errs.join('\n') : '\nno page errors, nothing scrolls sideways');
  } catch (e) { console.log('✗ ' + (e.stack || e.message)); }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
})();
