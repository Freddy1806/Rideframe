// Indoor page (pure.html) with virtual gears, a fake smart trainer and a fake Zwift Click (no hardware): node tools/indoortest-ui.cjs
// Serves the repo on a free port, phone at 390 px: Virtual gears on in the settings (persists), trainer + Click connected in
// the Sensors sheet, + / − from the Click, the screen buttons and Q/E change the gear and the grade sent to the trainer in the
// right direction, an ERG workout ignores shifts, the Click comes back after a reload without the chooser (Chrome getDevices)
// and nothing breaks without getDevices (Bluefy). Needs Playwright (NODE_PATH=$(npm root -g)). SHOTS=<dir> saves screenshots.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const net = require('node:net'), path = require('node:path'), fs = require('node:fs');
const ROOT = path.join(__dirname, '..'), SHOTS = process.env.SHOTS || '';

// runs in the page before the app: an FTMS trainer and a Click v1; window.__fake drives them, records what the app writes
function fakeBluetooth(opt) {
  const L = n => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`, C = n => `0000000${n}-19ca-4651-86e5-fa29dcdd09d1`;
  const RIDE_ON = [0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e];
  const f = window.__fake = { requests: [], tw: [], cw: [], connects: 0, getDevices: 0 };
  const nerr = () => new DOMException('GATT Server is disconnected.', 'NetworkError');
  function device(id, name, services) {
    const dev = new EventTarget(); dev.id = id; dev.name = name;
    class Char extends EventTarget {
      constructor(uuid, onWrite) { super(); this.uuid = uuid; this.onWrite = onWrite; this.value = null; }
      async startNotifications() { if (!dev.gatt.connected) throw nerr(); this.notifying = true; return this; }
      async readValue() { if (this.uuid === L(0x2a19)) return new DataView(Uint8Array.of(77).buffer); throw new DOMException('no', 'NotSupportedError'); }
      async writeValueWithResponse(v) { return this.writeValueWithoutResponse(v); }
      async writeValueWithoutResponse(v) { if (!dev.gatt.connected) throw nerr(); this.onWrite?.([...new Uint8Array(v.buffer || v, v.byteOffset || 0, v.byteLength)], this); }
      emit(bytes) { if (!this.notifying || !dev.gatt.connected) return; this.value = new DataView(Uint8Array.from(bytes).buffer); this.dispatchEvent(new Event('characteristicvaluechanged')); }
    }
    const svcs = {}; for (const [su, chars] of Object.entries(services)) { svcs[su] = {}; for (const [cu, w] of Object.entries(chars)) svcs[su][cu] = new Char(cu, w); }
    dev.chars = Object.assign({}, ...Object.values(svcs));
    dev.gatt = { connected: false, device: dev,
      async connect() { f.connects++; this.connected = true; return this; },
      disconnect() { if (!this.connected) return; this.connected = false; dev.dispatchEvent(new Event('gattserverdisconnected')); },
      async getPrimaryService(u) { if (!this.connected) throw nerr(); const s = svcs[u]; if (!s) throw new DOMException('No Services matching UUID ' + u, 'NotFoundError');
        return { uuid: u, async getCharacteristic(c) { if (!s[c]) throw new DOMException('No Characteristics matching UUID ' + c, 'NotFoundError'); return s[c]; } }; } };
    return dev;
  }
  const trainer = f.trainer = device('tr1', 'KICKR CORE 2 FAKE', { [L(0x1826)]: { [L(0x2ad2)]: null, [L(0x2ad9)]: b => f.tw.push(b) } });
  const clickDev = f.click = device('zc1', 'Zwift Click', { [C(1)]: { [C(2)]: null, [C(3)]: b => { f.cw.push(b); if (b.length === 6 && b.every((x, i) => x === RIDE_ON[i])) setTimeout(() => clickDev.chars[C(4)].emit([...RIDE_ON, 1, 3]), 5); }, [C(4)]: null }, [L(0x180f)]: { [L(0x2a19)]: null } });
  // indoor bike data: speed (km/h × 100), cadence (rpm × 2), power
  f.ride = (kmh, rpm, w) => { const b = new DataView(new ArrayBuffer(8)); b.setUint16(0, 0x44, true); b.setUint16(2, kmh * 100, true); b.setUint16(4, rpm * 2, true); b.setInt16(6, w, true); trainer.chars[L(0x2ad2)].emit([...new Uint8Array(b.buffer)]); };
  f.send = hex => clickDev.chars[C(2)].emit(hex.trim().split(/\s+/).map(x => parseInt(x, 16)));
  f.grades = () => f.tw.filter(b => b[0] === 0x11).map(b => (((b[4] << 8) | b[3]) << 16 >> 16) / 100);
  f.ergs = () => f.tw.filter(b => b[0] === 0x05).map(b => b[1] | (b[2] << 8));
  const bt = { async requestDevice(o) { f.requests.push(JSON.parse(JSON.stringify(o)));
      const s = JSON.stringify(o); return s.includes(C(1)) ? clickDev : s.includes(L(0x1826)) ? trainer : Promise.reject(new DOMException('User cancelled', 'NotFoundError')); },
    async getAvailability() { return true; } };
  if (opt.getDevices) bt.getDevices = async () => { f.getDevices++; return [clickDev]; }; // Chrome with the permissions backend: devices allowed before
  Object.defineProperty(navigator, 'bluetooth', { value: bt, configurable: true });
}

const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${info !== '' ? ' · ' + info : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const PORT = await freePort(), BASE = `http://localhost:${PORT}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/index.html`); break; } catch { await wait(100); } }
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript(`(${fakeBluetooth})({ getDevices: false })`);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => d.accept());
    await p.goto(`${BASE}/pure.html`); // first visit: clean settings for this test
    await p.evaluate(async () => { const { db } = await import('/js/db.js'); await db.kvDel('settings'); await db.kvDel('pureDraft'); localStorage.clear(); });
    await p.reload(); await p.waitForSelector('#pSens');
    const gear = () => p.evaluate(() => { const g = document.querySelector('#pGear'); return g ? { name: g.querySelector('b').textContent, n: +g.querySelector('small').textContent.match(/(\d+)\//)[1] } : null; });
    const last = () => p.evaluate(() => window.__fake.grades().at(-1));
    const flashText = () => p.evaluate(() => document.querySelector('#pflash.on')?.textContent || '');

    // settings: Virtual gears off by default, switch persists (same settings object as the 3D ride: shiftMode)
    await p.click('[data-m="grade"]');
    ok('no gear row while virtual gears are off', !(await p.$('#pGear')));
    await p.click('#pSetBtn');
    ok('settings: Virtual gears off by default', !(await p.isChecked('#sVg')));
    await p.check('#sVg'); await p.selectOption('#sRg', '50x14');
    await p.click('#sOk');
    ok('gear row shows after switching on', !!(await gear()), JSON.stringify(await gear()));
    await p.reload(); await p.waitForSelector('#pSens');
    const st = await p.evaluate(async () => { const { db } = await import('/js/db.js'); const s = await db.kvGet('settings'); return { shiftMode: s.shiftMode, realGear: s.realGear, mode: s.pure?.mode }; });
    ok('switch and bike gear saved as shiftMode / realGear', st.shiftMode === 'virtual' && st.realGear === '50x14' && st.mode === 'grade', JSON.stringify(st));
    ok('after reload: gear row still there, start gear = the bike gear 50×14', (await gear())?.name === '50×14', JSON.stringify(await gear()));
    await p.click('#pSetBtn'); ok('after reload: toggle checked', await p.isChecked('#sVg')); await p.click('#sOk');

    // connect trainer (header pill) and Click (Sensors sheet)
    await p.click('#pTr'); await p.waitForFunction(() => document.querySelector('#pTr')?.classList.contains('on'));
    await p.evaluate(() => window.__fake.ride(30, 90, 200)); await wait(50);
    await p.click('#pSens'); await p.click('#sClk');
    await p.waitForFunction(() => /connected/.test(document.querySelector('#sClk')?.previousElementSibling?.textContent || ''), null, { timeout: 5000 });
    const line = await p.textContent('#sClk >> xpath=preceding-sibling::div');
    ok('Sensors sheet: Click name, connected, battery', /Zwift Click · connected · battery 77\s%/.test(line), line);
    ok('Sensors sheet: trainer shown as connected', /KICKR CORE 2 FAKE · connected/.test(await p.textContent('#sTr >> xpath=preceding-sibling::div')));
    ok('Click device id remembered for next time', await p.evaluate(() => localStorage.getItem('rf_click') === 'zc1'));
    ok('Sensors pill lights up', await p.evaluate(() => document.querySelector('#pSens').classList.contains('on')));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'indoor-sensors-click-390.png') });
    await p.click('#sDone');

    // shifting: Click +, Click −, screen + / −, Q / E; each changes the gear and the grade sent (higher gear = steeper)
    const step = async (name, act, dir) => {
      const g0 = await gear(), s0 = await last(); await act(); await wait(120); const g1 = await gear(), s1 = await last();
      ok(`${name}: gear ${dir > 0 ? 'up' : 'down'} and grade ${dir > 0 ? 'up' : 'down'}`, g1.n === g0.n + dir && (dir > 0 ? s1 > s0 : s1 < s0), `${g0.name} ${s0} % -> ${g1.name} ${s1} %`);
    };
    await p.click('[data-sh="1"]'); await wait(100); // first shift: makes sure a grade was written
    await step('Click +', () => p.evaluate(() => { const f = window.__fake; f.send('37 08 00 10 01'); f.send('37 08 00 10 01'); f.send('37 08 01 10 01'); }), 1);
    await step('Click −', () => p.evaluate(() => { const f = window.__fake; f.send('37 08 01 10 00'); f.send('37 08 01 10 01'); }), -1);
    await step('screen +', () => p.click('[data-sh="1"]'), 1);
    await step('screen −', () => p.click('[data-sh="-1"]'), -1);
    await step('key E', () => p.keyboard.press('e'), 1);
    await step('key Q', () => p.keyboard.press('q'), -1);
    ok('real gear (50×14) on the flat sends the grade itself', await p.evaluate(async () => { while (document.querySelector('#pGear b').textContent !== '50×14') document.querySelector('[data-sh="-1"]').click(); await new Promise(r => setTimeout(r, 100)); return Math.abs(window.__fake.grades().at(-1)) < 0.05; }), String(await last()));
    if (SHOTS) { await p.click('[data-sh="1"]'); await wait(400); await p.screenshot({ path: path.join(SHOTS, 'indoor-gears-390.png') }); }
    for (let i = 0; i < 30; i++) await p.click('[data-sh="-1"]');
    ok('lowest gear: stops at 1, grade within the trainer range', (await gear()).n === 1 && (await last()) >= -10, `${(await gear()).name} ${await last()} %`);
    for (let i = 0; i < 30; i++) await p.click('[data-sh="1"]');
    const top = await gear();
    ok('highest gear: stops at the last gear, grade ≤ 20 %', (await last()) <= 20 && top.name === '50×11', `${top.name} ${await last()} %`);
    ok('no sideways scroll at 390 px', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    // ERG workout: the trainer holds the watts, shifts do nothing but show a hint
    await p.click('[data-m="work"]'); await p.click('#pStart'); await wait(600);
    const w0 = await p.evaluate(() => ({ g: window.__fake.grades().length, e: window.__fake.ergs().length }));
    await p.evaluate(() => { const f = window.__fake; f.send('37 08 00 10 01'); f.send('37 08 01 10 01'); }); await p.keyboard.press('e'); await wait(150);
    const w1 = await p.evaluate(() => ({ g: window.__fake.grades().length, e: window.__fake.ergs().length }));
    ok('workout: ERG watts were sent', w0.e > 0, JSON.stringify(w0));
    ok('workout: Click + and E send no grade', w1.g === w0.g, `${w0.g} -> ${w1.g}`);
    ok('workout: hint instead', /holds the watts/.test(await flashText()), await flashText());
    ok('workout: no gear row', !(await p.$('#pGear')));
    await p.click('#pPause'); await p.click('[data-m="grade"]');
    ok('back in Grade mode: the gear is kept', (await gear())?.name === top.name, JSON.stringify(await gear()));

    // 320 px: the gear row fits, nothing sideways
    await p.setViewportSize({ width: 320, height: 640 }); await wait(300);
    ok('no sideways scroll at 320 px', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    ok('gear row inside the screen at 320 px', await p.evaluate(() => { const r = document.querySelector('.pgears').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'indoor-gears-320.png') });
    await p.setViewportSize({ width: 390, height: 844 });

    // a new page load: Chrome with getDevices brings the Click back without the chooser
    await p.evaluate(async () => { const { db } = await import('/js/db.js'); await db.kvDel('pureDraft'); });
    // same profile (IndexedDB settings, the Click id in localStorage), a fresh page = a new page load
    const q = await ctx.newPage(); q.on('pageerror', e => errs.push(e.message));
    await q.addInitScript(`(${fakeBluetooth})({ getDevices: true })`);
    await q.goto(`${BASE}/pure.html`); await q.waitForSelector('#pSens');
    await q.waitForFunction(async () => (await import('/js/zwiftclick.js')).click.status === 'on', null, { timeout: 5000 }).catch(() => {});
    const rs = await q.evaluate(async () => ({ status: (await import('/js/zwiftclick.js')).click.status, chooser: window.__fake.requests.length, gd: window.__fake.getDevices }));
    ok('reload with getDevices: Click back without the chooser', rs.status === 'on' && rs.chooser === 0 && rs.gd === 1, JSON.stringify(rs));
    const r0 = await q.evaluate(() => document.querySelector('#pGear b').textContent);
    await q.evaluate(() => { const f = window.__fake; f.send('37 08 01 10 00'); f.send('37 08 01 10 01'); }); await wait(100);
    ok('…and it shifts', (await q.evaluate(() => document.querySelector('#pGear b').textContent)) !== r0);
    await q.close();
    // Bluefy / older Chrome: no getDevices, nothing happens, no error; one tap on Connect
    const q2 = await ctx.newPage(); q2.on('pageerror', e => errs.push(e.message));
    await q2.addInitScript(`(${fakeBluetooth})({ getDevices: false })`);
    await q2.goto(`${BASE}/pure.html`); await q2.waitForSelector('#pSens'); await wait(400);
    ok('reload without getDevices: stays off quietly', await q2.evaluate(async () => (await import('/js/zwiftclick.js')).click.status === 'off'));
    await q2.close();
    ok('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL test crashed · ' + (e.stack || e)); }
  finally { await browser?.close(); srv.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
