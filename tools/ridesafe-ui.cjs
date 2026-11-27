// A running ride survives a reload, a trainer drop and the internet going away (Freddy 20.11.: "Sicherheitsprogramme … wenn
// der Trainer sich entkoppelt … dass es nicht an einer Session hängt … auch wenn das Internet mal ausfällt").
// 1. Save as it is: a ride, a reload, the "Unfinished ride" sheet, "Save as it is" stores the ride with its samples.
// 2. Continue: Passo Demo with the workout 30 / 15 (c_30_15_3x13) in ERG, ridden into the hard sets, a reload: the sheet
//    (Continue focused, keyboard), the same route, distance, time, samples and workout step go on, paused.
// 3. The trainer drops (a fake device fires gattserverdisconnected, gatt.connect fails 3 times): "lost · reconnecting",
//    then it is back by itself and the ERG target is written again.
// 5. Open world (island): a ride on a later road, a reload, Continue: the same road, spot, time, samples and sun.
// 4. Offline (context.setOffline): the ride goes on, Finish stores ONE ride locally with the samples from before and after the
//    reload; the account gets it when the line is back. No page error.
// Starts its own serve.mjs on a free port with a temp data folder (a throwaway account in it).
// Usage: NODE_PATH=$(npm root -g) RIDEFRAME_DATA=$(mktemp -d) node tools/ridesafe-ui.cjs [shotsDir]   (shots: JPG, scale 1)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0; const ok = (c, m, info = '') => { n++; console.log(`${c ? '✓' : '✗'} ${m}${!c && info ? ' · ' + info : ''}`); if (!c) fails++; };
const URL_Q = '/?desktop&noprofile&demo&laptest&nowizard&draft'; // ?draft: drafts on in an automated browser (js/ridedraft.js draftOn)

/** in the page: a fake KICKR (FTMS, control point records every write; gatt.connect fails `fails` times) and a pump of
 *  Indoor Bike Data at `watts`, the way a real trainer notifies */
const FAKE = ({ fails, watts }) => {
  const dev = new EventTarget(), chars = new Map(), U = n => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
  const ch = u => { if (!chars.has(u)) { const c = new EventTarget(); c.startNotifications = async () => c; c.writeValueWithResponse = async b => { window.__writes.push([...b]); }; chars.set(u, c); } return chars.get(u); };
  const server = { getPrimaryService: async u => { if (u !== U(0x1826)) throw new Error('no service'); return { getCharacteristic: async c => ch(c) }; } };
  Object.assign(dev, { id: 'fakeKickr', name: 'KICKR fake', tries: 0, fails, chars });
  dev.gatt = { connected: false, connect: async () => { dev.tries++; await new Promise(r => setTimeout(r, 20)); if (dev.fails > 0) { dev.fails--; throw new Error('out of range'); } dev.gatt.connected = true; return server; },
    disconnect: () => { dev.gatt.connected = false; } };
  window.__writes = window.__writes || []; window.__fake = dev; window.__watts = watts;
  clearInterval(window.__pump); window.__pump = setInterval(() => { if (!dev.gatt.connected) return; const w = window.__watts, b = new Uint8Array([0x44, 0, 0xb8, 0x0b, 180, 0, w & 255, w >> 8]);
    const ibd = chars.get(U(0x2ad2)); if (ibd) { ibd.value = new DataView(b.buffer); ibd.dispatchEvent(new Event('characteristicvaluechanged')); } }, 100);
  return dev;
};

(async () => {
  const DATA = process.env.RIDEFRAME_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'rf-ridesafe-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const name = 'Safe Rider', reg = await (await fetch(BASE + '/api/account/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email: 'saferider@example.org', password: 'secret-pw-1' }) })).json();
  const serverRides = async () => (await (await fetch(BASE + '/api/account/rides', { headers: { 'X-RF-Token': reg.token } })).json()).ids || [];
  const b = await chromium.launch();
  const errs = [], dialogs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { dialogs.push(d.type()); d.accept(); });
    await p.goto(BASE + URL_Q);
    await p.evaluate(async ([token, name]) => { localStorage.setItem('rf_account', JSON.stringify({ token, name, email: 'saferider@example.org' }));
      const { db } = await import('/js/db.js'); const st = (await db.kvGet('settings')) || {}; await db.kvSet('settings', { ...st, ftp: 250, erg: true, eagle: false, profileDone: true, accountAsked: true, wbView: 'big' }); await db.kvSet('settingsAt', Date.now()); }, [reg.token, name]);
    const kv = k => p.evaluate(async k => { const { db } = await import('/js/db.js'); return db.kvGet(k); }, k);
    const rides = () => p.evaluate(async () => { const { db } = await import('/js/db.js'); return (await db.all('rides')).filter(r => r.routeId === 'demo'); });
    const ride = () => p.evaluate(() => { const r = window.__ride; if (!r) return null; return { route: r.route.id, d: r.d, ridden: r._ridden(), elapsed: r.elapsed, samples: r.samples.length, last: r.samples.at(-1)?.[0], first: r.samples[0]?.[0],
      w: r.workout?.id, wi: r.wNow?.i, step: r.wNow?.step?.label, wclock: r._wClock(), paused: r.paused, erg: r.erg, target: r.wNow?.target, terg: r.state.trainer.erg, conn: r.state.trainer.connected, rj: !!r.state.trainer.rejoining, source: r.source }; });
    const startRide = async wid => {
      await p.goto(BASE + URL_Q); await p.waitForTimeout(700);
      await p.click('.tab[data-view="library"]'); await p.click('.card[data-id="demo"]'); await p.waitForSelector('#workSel');
      await p.selectOption('#workSel', wid); await p.click('#rideBtn');
      await p.waitForFunction(() => window.__ride?.running && !document.querySelector('.countdown'), null, { timeout: 60000 });
      await p.evaluate(() => { window.__ride.eg = null; });
    };
    /** the ride clock to `into` seconds into the workout step whose label matches */
    const goStep = (m, into) => p.evaluate(([src, into]) => { const r = window.__ride, st = r.workout.steps, re = new RegExp(src), i = st.findIndex(x => re.test(x.label || ''));
      r.elapsed = (r._wT0 || 0) + st.slice(0, i).reduce((a, x) => a + x.dur, 0) + into; }, [m, into]);
    const pauseAndDraft = async () => { await p.keyboard.press(' '); await p.waitForSelector('#pauseOverlay');
      const e = await p.evaluate(() => window.__ride.elapsed);
      for (let i = 0; i < 40; i++) { const d = await kv('rideDraft'); if (d && Math.abs(d.elapsed - e) < 0.01) return d; await wait(100); } return null; };
    const sheet = async () => { await p.waitForSelector('.mwask', { timeout: 15000 }); return p.evaluate(() => ({ title: document.querySelector('.mwask h3')?.textContent, text: document.querySelector('.mwask p')?.textContent,
      btns: [...document.querySelectorAll('.mwask button')].map(b => b.textContent), focus: document.activeElement?.textContent })); };

    // ---- 1. Save as it is (a workout ridden for a while: its intervals come along) ----
    await startRide('vo2_5x3');
    await p.evaluate(FAKE, { fails: 0, watts: 210 }); await p.evaluate(() => window.__ride.state.trainer.use(window.__fake));
    await p.waitForTimeout(1500); await goStep('VO2max 1/', 60); await p.waitForTimeout(1500); // a minute into the first hard interval
    const d1 = await pauseAndDraft(), r1 = await ride();
    ok(!!d1 && d1.samples.length === r1.samples && d1.routeId === 'demo', `pause writes the draft (${d1?.samples.length} samples, ${Math.round(d1?.elapsed)} s)`);
    await p.reload(); const s1 = await sheet();
    ok(dialogs.includes('beforeunload'), 'leaving the page during a ride asks first (beforeunload)', dialogs.join());
    ok(s1.title === 'Unfinished ride' && /Passo Demo/.test(s1.text) && /km/.test(s1.text) && s1.btns.join('|') === 'Continue|Save as it is|Discard', `the sheet: "${s1.title} · ${s1.text}"`, s1.btns.join('|'));
    await p.click('.mwask button:has-text("Save as it is")'); await p.waitForTimeout(800);
    const id1 = (await rides())[0]?.id;
    { const rs = await rides(); ok(rs.length === 1 && rs[0].samples.length === d1.samples.length && rs[0].duration === Math.round(d1.elapsed) && rs[0].avgPower > 150 && rs[0].workoutId === 'vo2_5x3' && rs[0].ivs?.length > 0, `Save as it is: one ride stored (${rs[0]?.samples.length} samples, ${rs[0]?.duration} s, ${rs[0]?.avgPower} W, ${rs[0]?.workout}, ${rs[0]?.ivs?.length} intervals)`, JSON.stringify(rs.map(r => [r.duration, r.samples.length]))); }
    ok(await kv('rideDraft') == null, 'the draft is gone after saving');
    await p.waitForTimeout(500); ok((await serverRides()).length === 1, 'the saved ride went to the account');
    const onServer0 = (await serverRides()).length;

    // ---- 2. Continue: the 30 / 15 workout in ERG, a reload in the hard sets ----
    await startRide('c_30_15_3x13');
    await p.evaluate(FAKE, { fails: 0, watts: 300 }); await p.evaluate(() => window.__ride.state.trainer.use(window.__fake));
    await p.waitForTimeout(1200); await p.evaluate(() => { window.__ride.d += 3200; }); await goStep('30 / 15 · set 1 · 3/13', 4); await p.waitForTimeout(2500);
    const before = await ride();
    ok(before.erg && before.w === 'c_30_15_3x13' && /30 \/ 15/.test(before.step) && before.source === 'trainer', `riding the 30 / 15 in ERG: "${before.step}", ${before.samples} samples, ${Math.round(before.elapsed)} s`, JSON.stringify(before));
    const d2 = await pauseAndDraft(), b2 = await ride();
    ok(!!d2 && d2.workout?.id === 'c_30_15_3x13' && d2.erg === true && Math.abs(d2.d - b2.d) < 0.01, 'the draft holds the workout, ERG and the position');
    await p.reload(); const s2 = await sheet();
    ok(s2.focus === 'Continue', `Continue is focused (Enter / pad A), focus on "${s2.focus}"`);
    ok(new RegExp(`^Passo Demo · ${(b2.ridden / 1000).toFixed(1).replace('.', '[.,]')} km · 19:3\\d · 30 / 15`).test(s2.text) && b2.ridden > 3000 && /30 \/ 15/.test(s2.text), `sheet: "${s2.text}"`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/ridesafe_resume_sheet.jpg`, type: 'jpeg', quality: 80 });
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__ride?.running && document.querySelector('#pauseOverlay'), null, { timeout: 60000 }); await p.waitForTimeout(600);
    const after = await ride();
    ok(after.route === 'demo' && Math.abs(after.d - b2.d) < 0.01 && Math.abs(after.elapsed - b2.elapsed) < 0.01 && after.samples === b2.samples, `same route, km ${(after.ridden / 1000).toFixed(2)}, time ${Math.round(after.elapsed)} s, ${after.samples} samples (before ${b2.samples})`, JSON.stringify([b2, after]));
    ok(after.w === 'c_30_15_3x13' && after.wi === b2.wi && after.step === b2.step && Math.abs(after.wclock - b2.wclock) < 0.01 && after.erg, `the workout goes on at "${after.step}" (step ${after.wi}), not from the start`);
    ok(after.paused && await p.locator('#pauseOverlay #pResume').count() === 1, 'restored paused: the rider connects first');
    ok(await p.locator('#pauseOverlay #pConn').count() === 1, 'the pause menu offers Connect trainer (the chooser needs a tap after a reload)');
    ok(/km/.test(await p.textContent('#pauseOverlay .label')) && (await p.textContent('#hWStep')) === b2.step, 'the pause card and the workout bar show where it stopped');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/ridesafe_after_continue.jpg`, type: 'jpeg', quality: 80 });
    // the trainer back without a chooser (what Chrome's getDevices gives), then ride on
    await p.evaluate(FAKE, { fails: 0, watts: 300 }); await p.evaluate(() => window.__ride.state.trainer.use(window.__fake)); await p.waitForTimeout(300);
    await p.click('#pResume'); await p.waitForTimeout(2500);
    { const r = await ride(); ok(!r.paused && r.elapsed > b2.elapsed + 1.5 && r.samples > b2.samples && r.source === 'trainer', `riding on: ${Math.round(r.elapsed)} s, ${r.samples} samples`); }

    // ---- 3. the trainer drops: gatt.connect fails 3 times, then works ----
    await p.evaluate(async () => { (await import('/js/rejoin.js')).REJOIN.delays = [1500, 1500, 1500, 1500]; });
    const w0 = await p.evaluate(() => window.__writes.length);
    await p.evaluate(() => { const d = window.__fake; d.fails = 3; d.gatt.connected = false; d.dispatchEvent(new Event('gattserverdisconnected')); d.dispatchEvent(new Event('gattserverdisconnected')); });
    await p.waitForTimeout(400); const fl = await p.textContent('#hFlash');
    ok(/Trainer lost · reconnecting/.test(fl), `at once a calm line: "${fl}"`);
    await p.waitForTimeout(2600);
    const lost = await p.evaluate(() => ({ pow: document.querySelector('#hPowS')?.textContent, ws: document.querySelector('#hWState')?.textContent, rj: window.__ride.state.trainer.rejoining, btn: !!document.querySelector('#hPowS .sens-rc'), wrc: !document.querySelector('#hWRc')?.hidden }));
    ok(lost.rj && /Lost · reconnecting/.test(lost.pow) && lost.btn, `HUD power: "${lost.pow}" with Reconnect`, JSON.stringify(lost));
    ok(/reconnecting/.test(lost.ws) && lost.wrc, `workout bar: "${lost.ws}" with Reconnect`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/ridesafe_trainer_lost.jpg`, type: 'jpeg', quality: 80 });
    await p.waitForFunction(() => window.__ride.state.trainer.connected && !window.__ride.state.trainer.rejoining, null, { timeout: 15000 });
    await p.waitForTimeout(400);
    const back = await p.evaluate(w0 => ({ tries: window.__fake.tries, writes: window.__writes.slice(w0), erg: window.__ride.state.trainer.erg, flash: document.querySelector('#hFlash')?.textContent, pow: document.querySelector('#hPowS')?.hidden }), w0);
    const ergW = back.writes.filter(x => x[0] === 5);
    ok(back.tries === 1 + 4, `back by itself after 3 failed tries (${back.tries - 1} tries in one loop, the double disconnect event started no second one)`);
    ok(back.writes[0]?.[0] === 0 && back.writes[1]?.[0] === 7 && ergW.length >= 1 && ergW.some(x => (x[1] | x[2] << 8) === back.erg), `after the reconnect: control, start, ERG ${back.erg} W written again`, JSON.stringify(back.writes));
    ok(/Trainer back/.test(back.flash || ''), `HUD: "${back.flash}"`);
    await p.waitForTimeout(800); ok(await p.evaluate(() => document.querySelector('#hPowS').hidden && window.__ride.source === 'trainer'), 'the watts flow again, the lost line is gone');
    // the manual Reconnect button at any time: wakes the loop at once (a 10 s pause would otherwise come first)
    await p.evaluate(async () => { (await import('/js/rejoin.js')).REJOIN.delays = [10000]; const d = window.__fake; d.fails = 0; d.gatt.connected = false; d.dispatchEvent(new Event('gattserverdisconnected')); });
    await p.evaluate(() => { window.__picks = 0; const bt = navigator.bluetooth || {}; bt.requestDevice = async () => { window.__picks++; throw Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' }); }; if (!navigator.bluetooth) Object.defineProperty(navigator, 'bluetooth', { value: bt, configurable: true }); });
    await p.waitForSelector('#hWRc:not([hidden])', { timeout: 6000 }); await p.click('#hWRc');
    await p.waitForTimeout(300); ok(await p.evaluate(() => window.__picks) === 1, 'Reconnect also opens the browser\'s device list in the same tap (owner 27.11.: "the popup does not open")');
    await p.waitForFunction(() => window.__ride.state.trainer.connected, null, { timeout: 3000 }).then(() => ok(true, 'Reconnect button: back at once, without the 10 s wait'), () => ok(false, 'Reconnect button: back at once'));

    // ---- 4. offline: the ride goes on and is stored locally; the account gets it when the line is back ----
    await ctx.setOffline(true); const o0 = await ride(); await p.waitForTimeout(3000);
    { const r = await ride(); ok(r.elapsed > o0.elapsed + 2 && r.samples > o0.samples && !r.paused, `offline: the ride goes on (${Math.round(r.elapsed - o0.elapsed)} s, +${r.samples - o0.samples} samples)`); }
    await p.keyboard.press(' '); await p.waitForSelector('#pSave'); await p.click('#pSave'); await p.waitForSelector('.finish', { timeout: 15000 }); await p.waitForTimeout(800);
    const fin = (await rides()).filter(r => r.id !== id1), all = fin[0]?.samples || [];
    ok(fin.length === 1, `finishing offline stores ONE ride locally (${fin.length}, besides the one saved as it was)`);
    ok(all.length > b2.samples && all.some(s => s[0] <= b2.last && s[0] >= b2.first) && all.some(s => s[0] > b2.last + 2) && all[0][0] === before.first, `its samples run from before the reload (t ${all[0]?.[0]} … ${b2.last}) to after it (… ${all.at(-1)?.[0]})`);
    ok(fin[0]?.workoutId === 'c_30_15_3x13' && fin[0]?.erg && fin[0]?.ivs?.length > 0, `the ride carries the workout and its intervals (${fin[0]?.ivs?.length})`);
    ok(await kv('rideDraft') == null, 'no draft after the finish');
    ok((await kv('ridePush'))?.includes(fin[0]?.id), 'the push failed offline: the ride waits for the line');
    ok((await serverRides()).length === onServer0, 'nothing reached the server while offline');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/ridesafe_offline_finish.jpg`, type: 'jpeg', quality: 80 });
    await ctx.setOffline(false); await p.waitForTimeout(1500);
    let up = (await serverRides()).includes(fin[0]?.id);
    ok(up, 'back online: the ride went to the account by itself (window online)');
    ok(!(await kv('ridePush'))?.length, 'nothing waits any more');
    // ---- 5. the open world on the island: a later road, a reload, Continue on the same road at the same spot ----
    await p.goto(BASE + URL_Q + '&view=ride&open=H-L');
    await p.waitForFunction(() => window.__ride?.running && window.__ride.ow && !document.querySelector('.countdown'), null, { timeout: 300000 });
    await p.evaluate(FAKE, { fails: 0, watts: 240 }); await p.evaluate(() => window.__ride.state.trainer.use(window.__fake));
    ok(await p.evaluate(() => !window.__ride.workout), 'the open world starts without the workout chosen on a route page before (30 / 15 from step 2)');
    await p.evaluate(() => { const r = window.__ride; r.eg = null; r.d = r.track.length - 25; });
    await p.waitForFunction(() => { const r = window.__ride; return r.ow.leg.a !== 'H' && !r.ow.busy && r.d > 5; }, null, { timeout: 300000 }); // on the next road
    await p.evaluate(() => { const r = window.__ride; r.elapsed += 40; r.d += 600; }); await p.waitForTimeout(1500);
    const ow = () => p.evaluate(() => { const r = window.__ride; return r && { route: r.route.id, a: r.ow?.leg.a ?? r.route.leg?.a, b: r.ow?.leg.b ?? r.route.leg?.b, d: r.d, ridden: r._ridden(), elapsed: r.elapsed, samples: r.samples.length, dOff: r.track.__dOff, paused: r.paused, ow: !!r.ow }; });
    const o1 = await ow(), d5 = await pauseAndDraft(), o2 = await ow();
    ok(!!d5 && d5.leg && d5.ow?.a === o2.a && d5.ow?.b === o2.b && Math.abs(d5.d - o2.d) < 0.01 && d5.dOff === o2.dOff, `open world: the draft holds the road ${o2.a}-${o2.b}, km ${(o2.d / 1000).toFixed(2)} on it, ${(o2.ridden / 1000).toFixed(2)} km in all`, JSON.stringify({ ow: d5?.ow, d: d5?.d, o2 }));
    await p.reload(); const s5 = await sheet();
    ok(/Island/.test(s5.text) && s5.btns[0] === 'Continue', `open world sheet: "${s5.text}"`, s5.btns.join('|'));
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__ride?.running && window.__ride.ow && document.querySelector('#pauseOverlay'), null, { timeout: 300000 }); await p.waitForTimeout(600);
    const o3 = await ow();
    ok(o3.route === 'insel_frei' && o3.a === o2.a && o3.b === o2.b && Math.abs(o3.d - o2.d) < 0.01 && Math.abs(o3.ridden - o2.ridden) < 0.01, `open world Continue: same road ${o3.a}-${o3.b}, same spot, ${(o3.ridden / 1000).toFixed(2)} km in all`, JSON.stringify(o3));
    { const lb = await p.textContent('#pauseOverlay .label'), km = parseFloat(lb.replace(',', '.')); ok(Math.abs(km - (o3.ridden + (o3.ridden < 1e9 ? 0 : 0)) / 1000) < 0.6 && km > 10, `the pause card shows the km of the whole ride: "${lb}"`); }
    ok(Math.abs(o3.elapsed - o2.elapsed) < 0.01 && o3.samples === o2.samples && o3.dOff === o2.dOff && o3.paused, `time ${Math.round(o3.elapsed)} s, ${o3.samples} samples and the sun go on, paused`);
    await p.evaluate(FAKE, { fails: 0, watts: 240 }); await p.evaluate(() => window.__ride.state.trainer.use(window.__fake)); await p.waitForTimeout(300);
    await p.click('#pResume'); await p.waitForFunction(e => window.__ride.elapsed > e + 3, o2.elapsed, { timeout: 60000 }).catch(() => {}); // the island world is heavy in a software-GL test browser: wait for the ride clock, not the wall clock
    { const r = await ow(); ok(!r.paused && r.elapsed > o2.elapsed + 1.5 && r.samples > o2.samples && r.d > o2.d && r.a === o2.a, `riding on in the open world: ${Math.round(r.elapsed)} s, ${r.samples} samples, km ${(r.d / 1000).toFixed(2)} on ${r.a}-${r.b}`); }
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/ridesafe_openworld_continue.jpg`, type: 'jpeg', quality: 80 });
    ok(errs.length === 0, 'no page errors', errs.join(' | '));
  } catch (e) { ok(false, 'test crashed: ' + (e.stack || e)); }
  finally { await b.close(); srv.kill(); }
  console.log(`\n${n - fails}/${n} ok`); process.exit(fails ? 1 : 0);
})();
