// Phone remote end to end (remote.html + js/remote.js on the phone, js/remotepad.js on the desktop, tools/remote-api.mjs):
// two browser contexts, desktop 1280 and phone 390. Pair by code (Settings → Phone remote), move the focus in the desktop
// main menu from the phone, open a route with A, B back, start a workout ride (VO2max 5 × 5, fake trainer), +5 W from the
// phone moves the desktop's target, the phone shows step and target, pause / resume and the pause menu from the phone,
// disconnect / reconnect (offline, reload), leave, account discovery (signed in on both: one tap, no code), latency, no
// page errors. Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) node tools/remote-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, info = '') => { console.log(`${c ? '✓' : '✗'} ${m}${!c && info ? ' · ' + info : ''}`); if (!c) fails++; };
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-remote-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  const errs = [];
  try {
    const dctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    const pctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 3 : 1, isMobile: true, hasTouch: true });
    const D = await dctx.newPage(); D.on('pageerror', e => errs.push('desktop: ' + e.message)); D.on('dialog', d => d.accept());
    const P = await pctx.newPage(); P.on('pageerror', e => errs.push('phone: ' + e.message));
    await D.goto(BASE + '/?desktop&noprofile&demo&laptest'); await D.waitForSelector('.card[data-id]'); await D.waitForTimeout(500);
    const dshot = async n => { if (SHOTS) await D.screenshot({ path: `${SHOTS}/${n}.png` }); };
    const pshot = async n => { if (SHOTS) await P.screenshot({ path: `${SHOTS}/${n}.png` }); };

    // ---- desktop: Settings → Phone remote shows a code and a QR code ----
    ok(!(await D.evaluate(() => window.__remote.session)), 'not signed in: no session before the user asks for one');
    await D.click('.tab[data-view="settings"]'); await D.click('#rmBtn');
    await D.waitForFunction(() => /^\d{3} \d{3}$/.test(document.querySelector('#rmCode')?.textContent || ''), null, { timeout: 5000 });
    const code = (await D.textContent('#rmCode')).replace(/\D/g, '');
    ok(/^\d{6}$/.test(code), `Settings → Phone remote: code ${code}`);
    ok(await D.locator('#rmQr svg path').count() === 1, 'a QR code is drawn');
    ok(/remote\.html/.test(await D.textContent('#rmBox')), 'the short address …/remote.html is shown');
    ok(/Waiting for your phone/.test(await D.textContent('#rmState')), 'state: waiting for the phone');
    await dshot('desktop_settings_code_1280');

    // ---- phone: enter the code ----
    await P.goto(BASE + '/remote.html'); await P.waitForSelector('#rCode');
    ok(await P.isVisible('#rJoin') && !(await P.isVisible('#rPad')), 'phone: the code screen');
    await pshot('phone_join_390');
    await P.fill('#rCode', '000000'.slice(0, 5)); await P.click('#rGo'); ok(/6 digits/.test(await P.textContent('#rErr')), 'phone: 5 digits → "The code has 6 digits."');
    const wrong = code === '111111' ? '222222' : '111111'; await P.fill('#rCode', wrong); await P.dispatchEvent('#rCode', 'input'); await P.waitForTimeout(400);
    ok(/Wrong or expired/.test(await P.textContent('#rErr')), 'phone: a wrong code is refused');
    await P.fill('#rCode', code); await P.dispatchEvent('#rCode', 'input');
    await P.waitForSelector('#rPad:not([hidden])', { timeout: 5000 });
    ok(true, 'phone: paired with the code');
    await D.waitForFunction(() => document.querySelector('#rmState')?.classList.contains('on'), null, { timeout: 5000 }).catch(() => {});
    ok(/Phone connected/.test(await D.textContent('#rmState')), 'desktop: "Phone connected"');
    await D.waitForFunction(c => { const t = document.querySelector('#rmCode')?.textContent.replace(/\D/g, ''); return t && t !== c; }, code, { timeout: 5000 }).catch(() => {});
    ok((await D.textContent('#rmCode')).replace(/\D/g, '') !== code, 'desktop: the used code is replaced by a fresh one (for a second phone)');
    ok(await D.isVisible('#rmPill') && await D.evaluate(() => document.querySelector('#rmPill').classList.contains('on')), 'desktop: phone pill in the top bar');
    await D.click('#rmClose');
    await P.waitForFunction(() => document.querySelector('#rConn')?.classList.contains('on'), null, { timeout: 5000 }).catch(() => {});
    ok(/Live/.test(await P.textContent('#rConn')), 'phone: "Live"');

    // ---- the main menu from the phone (the virtual pad drives js/padnav.js) ----
    await D.click('.tab[data-view="library"]'); await D.mouse.move(5, 5); await D.waitForTimeout(300);
    const press = async (sel, hold = 90) => { const l = P.locator(sel).first(); const bx = await l.boundingBox(); await l.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, clientX: bx.x + 5, clientY: bx.y + 5 }); await P.waitForTimeout(hold); await l.dispatchEvent('pointerup', { pointerId: 1, isPrimary: true }); await P.waitForTimeout(220); };
    const cur = () => D.evaluate(() => { const c = window.__padnav?.cur; if (!c || !c.isConnected || !document.documentElement.classList.contains('pn-active')) return null; const r = c.getBoundingClientRect(); return { text: c.textContent.trim().slice(0, 30), did: c.dataset.id || '', cls: c.className, x: r.left, y: r.top, topbar: !!c.closest('.topbar') }; });
    await press('.rd.down'); await D.waitForTimeout(150);
    const c0 = await cur(); ok(!!c0, `phone D-pad ↓: the focus ring shows on the desktop (${c0?.text})`);
    await press('.rd.right'); const c1 = await cur(); ok(c1 && c0 && (c1.x > c0.x || c1.text !== c0.text), `phone D-pad →: focus moves (${c0?.text} → ${c1?.text})`);
    await press('.rd.left'); const c2 = await cur(); ok(c2 && c2.text === c0?.text, 'phone D-pad ←: back');
    await P.waitForFunction(() => /Focus:/.test(document.querySelector('#rCtx')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
    ok(/Routes/i.test(await P.textContent('#rCtx')) && /Focus:/.test(await P.textContent('#rCtx')), 'phone shows the desktop screen (Routes) and the focused control', await P.textContent('#rCtx'));
    await pshot('phone_menu_390');
    await press('.rb[aria-label^="R"]'); ok(await D.evaluate(() => document.querySelector('.topbar .tab.active')?.dataset.view) === 'training', 'phone R: next tab (Training)');
    await press('.rbtn.b'); ok(await D.evaluate(() => document.querySelector('.topbar .tab.active')?.dataset.view) === 'library', 'phone B: back to Routes');
    let card = null; for (let i = 0; i < 12; i++) { const c = await cur(); if (c && /\bcard\b/.test(c.cls) && c.did) { card = c; break; } await press('.rd.down'); }
    ok(!!card, `phone D-pad reaches a route card (${card?.did})`);
    await press('.rbtn.a'); await D.waitForTimeout(400);
    ok(await D.locator('#main #rideBtn').isVisible(), 'phone A: the route opens');
    await press('.rbtn.b'); await D.waitForTimeout(300);
    ok(!(await D.locator('#main #rideBtn').count()) && await D.locator('.card[data-id]').count() > 0, 'phone B: back to the library');

    // ---- a workout ride (VO2max 5 × 5, fake trainer) ----
    await D.click('.card[data-id="demo"]'); await D.waitForSelector('#workSel'); await D.selectOption('#workSel', 'vo2_5x5'); await D.click('#rideBtn');
    await D.waitForFunction(() => window.__ride?.q && document.querySelector('#hWork'), null, { timeout: 30000 });
    await D.waitForFunction(() => window.__ride.running && !document.querySelector('.countdown'), null, { timeout: 20000 });
    await D.evaluate(() => { const r = window.__ride, t = r.state.trainer; t.device = { gatt: { connected: true } }; t.data = { power: 262, cadence: 90, speed: 9, hr: 0 };
      window.__tl = setInterval(() => { t.lastData = performance.now(); }, 100); t.lastData = performance.now();
      r.elapsed = r.workout.steps.slice(0, r.workout.steps.findIndex(x => x.label === 'VO2max 1/5')).reduce((s, x) => s + x.dur, 0) + 5; });
    await D.waitForTimeout(400);
    const tgt0 = await D.evaluate(() => +document.querySelector('#hWT').textContent);
    await P.waitForSelector('#rRide:not([hidden])', { timeout: 5000 }).catch(() => {});
    await P.waitForFunction(t => document.querySelector('#rTgt')?.textContent === String(t), tgt0, { timeout: 5000 }).catch(() => {});
    const pv = await P.evaluate(() => ({ step: document.querySelector('.rstep b')?.textContent, tgt: document.querySelector('#rTgt')?.textContent, keys: document.querySelectorAll('#rWatts .rk').length, wv: !document.querySelector('#rWatts').hidden }));
    ok(pv.step === 'VO2max 1/5' && pv.tgt === String(tgt0), `phone shows the step and the target (${pv.step} · ${pv.tgt} W)`, JSON.stringify(pv));
    ok(pv.wv && pv.keys === 4, 'phone: −5 −1 +1 +5 keys in a workout');
    await pshot('phone_ride_390');
    await press('.rk[data-hold="7"]'); await D.waitForTimeout(200);
    const a1 = await D.evaluate(() => ({ a: window.__ride.wAdj, t: +document.querySelector('#hWT').textContent }));
    ok(a1.a === 5 && a1.t === tgt0 + 5, `phone +5: the desktop target ${tgt0} → ${a1.t} W`, JSON.stringify(a1));
    await press('.rk[data-hold="4"]'); await D.waitForTimeout(200);
    ok(await D.evaluate(() => window.__ride.wAdj) === 4, 'phone −1: offset +4 W');
    await P.waitForFunction(t => document.querySelector('#rTgt')?.textContent === String(t), tgt0 + 4, { timeout: 4000 }).catch(() => {});
    ok(await P.textContent('#rTgt') === String(tgt0 + 4), `phone follows the new target (${tgt0 + 4} W)`);
    // hold +1: repeats as real down / up
    await press('.rk[data-hold="5"]', 1000); await D.waitForTimeout(300);
    const held = await D.evaluate(() => window.__ride.wAdj);
    ok(held >= 4 + 4, `holding +1 for 1 s repeats (offset 4 → ${held})`);
    // latency: phone tap → desktop target changed (same machine, same server)
    const lat = [];
    for (let i = 0; i < 8; i++) {
      const before = await D.evaluate(() => window.__ride.wAdj);
      await D.evaluate(b0 => { window.__latT = 0; const f = () => { if (window.__ride.wAdj !== b0) window.__latT = performance.timeOrigin + performance.now(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }, before);
      const t0 = await P.evaluate(() => performance.timeOrigin + performance.now());
      await P.locator(i % 2 ? '#rWatts .rk[data-hold="4"]' : '#rWatts .rk[data-hold="5"]').dispatchEvent('pointerdown', { pointerId: 2 }); await P.locator(i % 2 ? '#rWatts .rk[data-hold="4"]' : '#rWatts .rk[data-hold="5"]').dispatchEvent('pointerup', { pointerId: 2 });
      await D.waitForFunction(() => window.__latT > 0, null, { timeout: 3000 }).catch(() => {});
      const t1 = await D.evaluate(() => window.__latT); if (t1) lat.push(t1 - t0); await D.waitForTimeout(150);
    }
    const sendMs = await P.evaluate(() => window.__rmLast);
    ok(lat.length === 8 && median(lat) < 250, `latency phone tap → desktop target: median ${Math.round(median(lat))} ms, max ${Math.round(Math.max(...lat))} ms (POST round trip ${Math.round(sendMs)} ms)`, JSON.stringify(lat.map(Math.round)));
    console.log(`  latency samples (ms): ${lat.map(Math.round).join(', ')}`);
    // commands
    const view0 = await D.evaluate(() => window.__ride.state.settings.wbView || 'big');
    await P.click('[data-cmd="wbview"]'); await D.waitForTimeout(300);
    ok(await D.evaluate(() => window.__ride.state.settings.wbView) !== view0, `phone "Intervals": interval display ${view0} → ${await D.evaluate(() => window.__ride.state.settings.wbView)}`);
    const hud0 = await D.evaluate(() => JSON.stringify(window.__ride.state.settings.hud || null));
    await P.click('[data-cmd="hud"]'); await D.waitForTimeout(300);
    ok(await D.evaluate(() => JSON.stringify(window.__ride.state.settings.hud || null)) !== hud0, 'phone "Display": the HUD preset changes');

    // ---- pause / resume, the pause menu from the phone ----
    await P.click('[data-cmd="pause"]'); await D.waitForSelector('#pauseOverlay', { timeout: 3000 }).catch(() => {});
    ok(await D.evaluate(() => window.__ride.paused && !!document.querySelector('#pauseOverlay')), 'phone Pause: the desktop pauses');
    await P.waitForFunction(() => document.querySelector('#rm')?.dataset.scr === 'paused', null, { timeout: 4000 }).catch(() => {});
    const pm = await P.evaluate(() => ({ items: [...document.querySelectorAll('.rmi')].map(b => b.textContent), resume: !document.querySelector('#rResume').hidden, nav: !document.querySelector('#rNav').hidden }));
    ok(pm.items.includes('Resume') && pm.items.includes('Options') && pm.resume && pm.nav, `phone paused: the pause menu (${pm.items.join(' · ')}), D-pad and Resume`, JSON.stringify(pm));
    await pshot('phone_paused_390');
    await press('.rd.down'); ok(await D.evaluate(() => window.__ride._padI) === 1, 'phone D-pad ↓ in the pause menu: Options highlighted');
    await press('.rbtn.a'); await D.waitForTimeout(250);
    ok(await D.locator('#pauseOverlay #oBack').count() === 1, 'phone A: Options open');
    const remoteOpt = await D.textContent('#oRemote').catch(() => ''); ok(/Phone remote: connected/.test(remoteOpt), `pause Options: "${remoteOpt}"`);
    await press('.rbtn.b'); await D.waitForTimeout(250); ok(await D.locator('#pauseOverlay #pResume').count() === 1, 'phone B: back to the pause menu');
    await P.waitForFunction(() => document.querySelectorAll('.rmi').length > 2 && [...document.querySelectorAll('.rmi')].some(b => b.textContent === 'Resume'), null, { timeout: 3000 }).catch(() => {});
    await P.click('#rResume'); await D.waitForTimeout(300);
    ok(await D.evaluate(() => !window.__ride.paused && !document.querySelector('#pauseOverlay')), 'phone Resume: the ride goes on');
    await P.click('[data-cmd="pause"]');
    await P.waitForFunction(() => document.querySelector('#rm')?.dataset.scr === 'paused', null, { timeout: 3000 }).catch(() => {});
    await P.locator('.rmi', { hasText: 'Resume' }).click(); await D.waitForTimeout(400);
    ok(await D.evaluate(() => !window.__ride.paused), 'phone: a tap on "Resume" in the menu list resumes');

    // ---- disconnect / reconnect ----
    await pctx.setOffline(true); await P.waitForTimeout(2500); await pctx.setOffline(false);
    await P.waitForFunction(() => document.querySelector('#rConn')?.classList.contains('on'), null, { timeout: 15000 }).catch(() => {});
    ok(/Live/.test(await P.textContent('#rConn')), 'phone offline 2.5 s, then back: "Live" again by itself');
    const w0 = await D.evaluate(() => window.__ride.wAdj); await press('.rk[data-hold="5"]'); await D.waitForTimeout(250);
    ok(await D.evaluate(() => window.__ride.wAdj) === w0 + 1, 'after the reconnect +1 W still works');
    await P.reload(); await P.waitForSelector('#rPad:not([hidden])', { timeout: 5000 }).catch(() => {});
    ok(await P.isVisible('#rPad'), 'phone reload: reconnected without a code');
    await P.waitForFunction(() => document.querySelector('#rTgt'), null, { timeout: 4000 }).catch(() => {});
    ok(!!(await P.textContent('#rTgt').catch(() => '')), 'phone reload: the ride state is back');
    await P.click('#rLeave'); await P.waitForTimeout(300);
    ok(await P.isVisible('#rJoin'), 'phone ✕: back to the code screen');
    await D.waitForFunction(() => window.__remote.phones === 0, null, { timeout: 5000 }).catch(() => {});
    ok(await D.evaluate(() => window.__remote.phones) === 0 && await D.evaluate(() => document.querySelector('#rmPill').hidden), 'desktop: 0 phones, pill gone');
    ok(await D.evaluate(() => window.__remote.pad.buttons.every(x => !x.pressed)), 'desktop: no button left held');
    // leave the ride, then account discovery
    await D.evaluate(() => { clearInterval(window.__tl); window.__ride._end(false); }); await D.waitForTimeout(800);

    // ---- signed in on both: the phone lists the computer, one tap, no code ----
    const reg = await fetch(BASE + '/api/account/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Freddy', email: 'freddy@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' }) }).then(r => r.json());
    const accJ = JSON.stringify({ token: reg.token, name: 'Freddy' });
    await D.evaluate(a => { localStorage.setItem('rf_account', a); sessionStorage.clear(); }, accJ); await D.reload(); await D.waitForSelector('.card[data-id]');
    await D.waitForFunction(() => !!window.__remote.session, null, { timeout: 8000 }).catch(() => {});
    ok(!!(await D.evaluate(() => window.__remote.session)), 'signed in: the desktop opens its remote session by itself');
    await P.evaluate(a => localStorage.setItem('rf_account', a), accJ); await P.reload(); await P.waitForSelector('.rdesk', { timeout: 5000 }).catch(() => {});
    const dl = await P.textContent('.rdesk').catch(() => '');
    ok(/Freddy’s/.test(dl), `phone lists "${dl.replace(/RIDEFRAME is open.*/, '').trim()}"`);
    await pshot('phone_mine_390');
    await P.click('.rdesk'); await P.waitForSelector('#rPad:not([hidden])', { timeout: 5000 }).catch(() => {});
    ok(await P.isVisible('#rPad'), 'one tap: connected without a code');
    await D.waitForFunction(() => window.__remote.phones === 1, null, { timeout: 5000 }).catch(() => {});
    ok(await D.evaluate(() => window.__remote.phones) === 1, 'desktop: the phone is connected');
    // a foreign account does not see it
    const reg2 = await fetch(BASE + '/api/account/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Stranger', email: 'stranger@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' }) }).then(r => r.json());
    const other = await fetch(BASE + '/api/remote/mine', { headers: { 'X-RF-Token': reg2.token } }).then(r => r.json());
    ok(Array.isArray(other.desks) && other.desks.length === 0, 'another account sees no computer');
    // the phone's layout: no sideways scroll, touch targets ≥ 56 px
    for (const w of [320, 390, 430]) {
      await P.setViewportSize({ width: w, height: 760 }); await P.waitForTimeout(200);
      const lay = await P.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small: [...document.querySelectorAll('#rPad button')].filter(x => x.offsetParent && (x.offsetWidth < 56 || x.offsetHeight < 56)).map(x => x.className + ' ' + x.offsetWidth + 'x' + x.offsetHeight) }));
      ok(lay.sw <= lay.cw && !lay.small.length, `phone ${w} px (menu): no sideways scroll, every control ≥ 56 px`, JSON.stringify(lay));
    }
    ok(!errs.length, 'no page errors', errs.join(' | '));
  } catch (e) { ok(false, 'run: ' + e.message); }
  finally { await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
})();
