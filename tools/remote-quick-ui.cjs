// Phone remote quick setup (owner 19.11.): in a free ride the phone switches ERG / shift on the bike / virtual gears with
// one tap, sets the ERG watts with −5 −1 +1 +5, shifts virtual gears and takes a photo. Desktop 1280 + phone 390, own server.
// Usage: NODE_PATH=$(npm root -g) node tools/remote-quick-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, info = '') => { console.log(`${c ? '✓' : '✗'} ${m}${!c && info ? ' · ' + info : ''}`); if (!c) fails++; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-remote-q-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch(), errs = [];
  try {
    const D = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); D.on('pageerror', e => errs.push('desktop: ' + e.message)); D.on('dialog', d => d.accept());
    const P = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: true, hasTouch: true })).newPage(); P.on('pageerror', e => errs.push('phone: ' + e.message));
    const pshot = async n => { if (SHOTS) await P.screenshot({ path: `${SHOTS}/${n}.png` }); };
    await D.goto(BASE + '/?desktop&noprofile&demo&laptest'); await D.waitForSelector('.card[data-id]');
    await D.waitForFunction(() => /^\d{6}$/.test(window.__remote?.session?.code || ''), null, { timeout: 15000 });
    const code = await D.evaluate(() => window.__remote.session.code);
    await P.goto(BASE + '/remote.html'); await P.fill('#rCode', code); await P.dispatchEvent('#rCode', 'input'); await P.waitForSelector('#rPad:not([hidden])', { timeout: 5000 });
    await D.click('.card[data-id="demo"]'); await D.waitForSelector('#rideBtn'); await D.click('#rideBtn');
    await D.waitForFunction(() => window.__ride?.running && !document.querySelector('.countdown'), null, { timeout: 40000 });
    await D.evaluate(() => { const r = window.__ride, t = r.state.trainer; t.device = { gatt: { connected: true } }; t.data = { power: 182, cadence: 88, speed: 8, hr: 0 }; t.setPower = w => { window.__setP = w; }; t.setGrade = () => {};
      window.__tl = setInterval(() => { t.lastData = performance.now(); }, 100); t.lastData = performance.now(); if (r.berg || r.virtual) r._setShift('real'); });
    const tapP = async sel => { await P.locator(sel).first().click(); await wait(350); };
    const press = async sel => { const l = P.locator(sel).first(), bx = await l.boundingBox(); await l.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, clientX: bx.x + 5, clientY: bx.y + 5 }); await wait(90); await l.dispatchEvent('pointerup', { pointerId: 1, isPrimary: true }); await wait(350); };
    const R = () => D.evaluate(() => { const r = window.__ride; return { berg: !!r.berg, virtual: !!r.virtual, hold: r._holdW || 0, gi: r.gi, setP: window.__setP ?? null }; });
    const vis = () => P.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; };
      return { mode: v('#rMode'), sel: document.querySelector('#rMode .rm.sel')?.dataset.m || '', watts: v('#rWatts'), gears: v('#rGears'), bike: v('#rBike'), tgt: document.querySelector('#rTgt')?.textContent || '', cmds: [...document.querySelectorAll('.rcmds .rc')].filter(e => !e.hidden).map(e => e.dataset.cmd), ow: document.documentElement.scrollWidth - innerWidth, oh: document.documentElement.scrollHeight - innerHeight }; });
    await P.waitForFunction(() => document.querySelector('#rMode .rm.sel'), null, { timeout: 6000 }).catch(() => {});
    let v = await vis();
    ok(v.mode && v.sel === 'real' && v.bike && !v.watts && !v.gears, 'free ride: mode bar, "Shift on bike" selected, no keys', JSON.stringify(v));
    ok(['pause', 'lap', 'photo', 'view', 'hud', 'music', 'next'].every(c => v.cmds.includes(c)) && !v.cmds.includes('wbview'), 'quick row: pause, lap, photo, view, display, music, next song', v.cmds.join());
    ok(v.ow <= 0 && v.oh <= 0, `fits 390×844 without scrolling (${v.ow}, ${v.oh})`);
    await pshot('1_phone_bike_390');
    await tapP('.rm[data-m="erg"]'); await P.waitForFunction(() => document.querySelector('#rMode .rm.sel')?.dataset.m === 'erg', null, { timeout: 5000 }).catch(() => {});
    let r = await R(); v = await vis();
    ok(r.berg && r.hold === 180 && r.setP === 180, `ERG from the phone: the trainer holds what you ride (${r.hold} W)`, JSON.stringify(r));
    ok(v.sel === 'erg' && v.watts && !v.gears && !v.bike && v.tgt === '180', 'phone: ERG selected, −5 −1 +1 +5, target 180 W', JSON.stringify(v));
    await press('.rk[data-hold="5"]'); r = await R(); ok(r.hold === 185, `+5 → ${r.hold} W`);
    await press('.rk[data-hold="7"]'); r = await R(); ok(r.hold === 186, `+1 → ${r.hold} W`);
    await press('.rk[data-hold="4"]'); r = await R(); ok(r.hold === 181, `−5 → ${r.hold} W`);
    await press('.rk[data-hold="6"]'); r = await R(); ok(r.hold === 180 && r.setP === 180, `−1 → ${r.hold} W, sent to the trainer`);
    await press('.rk[data-hold="5"]'); await P.waitForFunction(() => document.querySelector('#rTgt')?.textContent === '185', null, { timeout: 5000 }).catch(() => {});
    ok((await vis()).tgt === '185', 'phone shows the new target 185 W'); await pshot('2_phone_erg_390');
    await tapP('.rm[data-m="virtual"]'); await P.waitForFunction(() => document.querySelector('#rMode .rm.sel')?.dataset.m === 'virtual', null, { timeout: 5000 }).catch(() => {});
    r = await R(); v = await vis(); const g0 = r.gi;
    ok(!r.berg && r.virtual && r.hold === 0 && r.setP === null, 'virtual gears from the phone: ERG off', JSON.stringify(r));
    ok(v.sel === 'virtual' && v.gears && !v.watts && !v.bike, 'phone: gear easier / harder', JSON.stringify(v));
    await press('#rGears .rk[data-hold="5"]'); r = await R(); ok(r.gi === g0 + 1, `gear harder: ${g0} → ${r.gi}`);
    await press('#rGears .rk[data-hold="4"]'); r = await R(); ok(r.gi === g0, 'gear easier: back'); await pshot('3_phone_virtual_390');
    await tapP('.rm[data-m="real"]'); await P.waitForFunction(() => document.querySelector('#rMode .rm.sel')?.dataset.m === 'real', null, { timeout: 5000 }).catch(() => {});
    r = await R(); ok(!r.berg && !r.virtual, 'shift on the bike from the phone');
    await D.evaluate(() => { window.__ride.elapsed += 60; }); await tapP('.rc[data-cmd="lap"]');
    const ml = await D.evaluate(() => window.__ride.manLaps || []); ok(ml.length === 1 && ml[0].t >= 60, `lap from the phone: ${JSON.stringify(ml[0])}`);
    ok(await D.evaluate(() => { const r = window.__ride, rec = r._rideRecord(false); return rec.manLaps?.length === 2 && rec.lapMarks.includes(Math.round(r._ml.t)); }), 'the ride record has the laps and the lap mark for the file');
    await tapP('.rc[data-cmd="photo"]'); await D.waitForSelector('#hShot.on, .flash', { timeout: 8000 }).catch(() => {});
    ok(await D.evaluate(() => !!document.querySelector('#hShot.on') || (window.__ride.photos?.length || 0) > 0 || /photo/i.test(document.querySelector('.ride')?.textContent || '')), 'photo from the phone: the desktop takes one');
    await D.screenshot({ path: SHOTS ? `${SHOTS}/4_desktop_after_photo.png` : path.join(DATA, 'd.png') });
    ok(!errs.length, 'no page errors', errs.join(' | '));
  } catch (e) { ok(false, 'run · ' + e.message); }
  await b.close(); srv.kill(); console.log(fails ? `\n${fails} failed` : '\nall passed'); process.exit(fails ? 1 : 0);
})();
