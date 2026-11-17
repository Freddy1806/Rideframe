// Zwift Click end-to-end with a fake Web Bluetooth device (no hardware): node tools/clicktest-ui.cjs
// Serves the repo on a free port, connects the Click from Settings, starts a ride on the same page, sends + / − frames
// and checks the virtual gear, then drops the connection and checks the automatic reconnect.
// Needs Playwright (preinstalled in the cloud box: NODE_PATH=$(npm root -g)). SHOTS=<dir> saves screenshots.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const net = require('node:net'), path = require('node:path'), fs = require('node:fs');
const ROOT = path.join(__dirname, '..'), SHOTS = process.env.SHOTS || '';

// runs in the page before the app: a Click v1 with battery service; window.__fake drives it
function fakeBluetooth() {
  const C = n => `0000000${n}-19ca-4651-86e5-fa29dcdd09d1`, RIDE_ON = [0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e];
  const f = window.__fake = { connects: 0, writes: [], requests: [], chars: {}, battery: 77, svc: C(1) };
  class Char extends EventTarget {
    constructor(uuid) { super(); this.uuid = uuid; this.value = null; this.properties = {}; }
    async startNotifications() { if (!dev.gatt.connected) throw new DOMException('GATT Server is disconnected.', 'NetworkError'); this.notifying = true; return this; }
    async readValue() { if (this.uuid.startsWith('00002a19')) return new DataView(Uint8Array.of(f.battery).buffer); throw new DOMException('no', 'NotSupportedError'); }
    async writeValueWithoutResponse(v) {
      if (!dev.gatt.connected) throw new DOMException('GATT Server is disconnected.', 'NetworkError');
      const b = [...new Uint8Array(v.buffer || v, v.byteOffset || 0, v.byteLength)]; f.writes.push(b);
      if (b.length === 6 && b.every((x, i) => x === RIDE_ON[i])) setTimeout(() => f.chars[C(4)].emit([...RIDE_ON, 0x01, 0x03]), 5); // handshake reply on sync TX
    }
    emit(bytes) { if (!this.notifying || !dev.gatt.connected) return; this.value = new DataView(Uint8Array.from(bytes).buffer); this.dispatchEvent(new Event('characteristicvaluechanged')); }
  }
  for (const u of [C(2), C(3), C(4), '00002a19-0000-1000-8000-00805f9b34fb']) f.chars[u] = new Char(u);
  const svc = uuid => ({ uuid, async getCharacteristic(u) { if (!dev.gatt.connected) throw new DOMException('GATT Server is disconnected.', 'NetworkError'); if (!f.chars[u]) throw new DOMException('No Characteristics matching UUID ' + u, 'NotFoundError'); return f.chars[u]; } });
  const dev = new EventTarget(); dev.id = 'fake1'; dev.name = 'Zwift Click';
  dev.gatt = { connected: false, device: dev,
    async connect() { if (f.refuse) throw new DOMException('Connection failed for unknown reason.', 'NetworkError'); f.connects++; this.connected = true; return this; },
    disconnect() { if (!this.connected) return; this.connected = false; for (const c of Object.values(f.chars)) c.notifying = false; dev.dispatchEvent(new Event('gattserverdisconnected')); },
    async getPrimaryService(u) { if (!this.connected) throw new DOMException('GATT Server is disconnected.', 'NetworkError');
      if (u === f.svc || u === '0000180f-0000-1000-8000-00805f9b34fb') return svc(u); throw new DOMException('No Services matching UUID ' + u, 'NotFoundError'); } };
  f.send = hex => f.chars[C(2)].emit(hex.trim().split(/\s+/).map(x => parseInt(x, 16)));
  f.drop = () => dev.gatt.disconnect(); // the Click goes away by itself (no call from the app)
  const bt = { async requestDevice(o) { f.requests.push(JSON.parse(JSON.stringify(o))); return dev; }, async getAvailability() { return true; } };
  Object.defineProperty(navigator, 'bluetooth', { value: bt, configurable: true });
}

const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${info !== '' ? ' · ' + info : ''}`); };

(async () => {
  const PORT = await freePort();
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT}/index.html`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => d.accept());
    await p.addInitScript(fakeBluetooth);
    await p.goto(`http://localhost:${PORT}/?desktop&noprofile&demo&laptest&view=settings`);
    await p.waitForSelector('#zcBtn');
    await p.evaluate(async () => { window.__click = (await import('/js/zwiftclick.js')).click; }); // the app's own instance (same module URL)
    ok('settings row shows "Not connected"', (await p.textContent('#zcState')).includes('Not connected'));
    await p.click('#zcBtn');
    await p.waitForFunction(() => document.querySelector('#zcState')?.textContent.includes('Connected'), null, { timeout: 5000 });
    const req = await p.evaluate(() => window.__fake.requests[0]);
    ok('device chooser filters: custom service, fc82, name "Zwift"', JSON.stringify(req.filters) === JSON.stringify([{ services: ['00000001-19ca-4651-86e5-fa29dcdd09d1'] }, { services: ['0000fc82-0000-1000-8000-00805f9b34fb'] }, { namePrefix: 'Zwift' }]), JSON.stringify(req.filters));
    ok('all UUIDs are full 128-bit lowercase', [...req.filters.flatMap(x => x.services || []), ...req.optionalServices].every(u => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u)), req.optionalServices.join(' '));
    ok('"RideOn" written to sync RX', await p.evaluate(() => window.__fake.writes.some(b => String.fromCharCode(...b) === 'RideOn')));
    ok('async and sync TX subscribed', await p.evaluate(() => window.__fake.chars['00000002-19ca-4651-86e5-fa29dcdd09d1'].notifying && window.__fake.chars['00000004-19ca-4651-86e5-fa29dcdd09d1'].notifying));
    await p.waitForTimeout(100);
    ok('handshake reply seen (model Click)', await p.evaluate(async () => { const { click } = await import('/js/zwiftclick.js'); return click.handshake && click.model === 'Click'; }));
    ok('settings row: name and battery', /Zwift Click · battery 77 %/.test(await p.textContent('#zcState')), await p.textContent('#zcState'));
    ok('button says Disconnect', (await p.textContent('#zcBtn')).trim() === 'Disconnect');
    await p.evaluate(() => window.__fake.send('19 08 40'));
    ok('battery frame updates the row', (await p.textContent('#zcState')).includes('64 %'), await p.textContent('#zcState'));
    if (SHOTS) { const row = p.locator('#zcBtn').locator('xpath=ancestor::div[contains(@class,"panel")]'); await row.scrollIntoViewIfNeeded(); await row.screenshot({ path: path.join(SHOTS, 'settings-click-connected.png') }); }

    // a ride on the same page (Passo Demo: the built-in route; it is drawn by the 2D DemoScene, no WebGL needed headless)
    await p.click('.tab[data-view="library"]');
    await p.click('.card[data-id="demo"]');
    await p.click('#rideBtn');
    await p.waitForFunction(() => window.__ride?.q && document.querySelector('#hGearChip'), null, { timeout: 30000 });
    const R = () => p.evaluate(() => ({ gi: window.__ride.gi, virtual: window.__ride.virtual, n: window.__ride.gears.length, gear: document.querySelector('#hGear')?.textContent, label: document.querySelector('#hGearL')?.textContent }));
    const r0 = await R();
    ok('ride starts in real shifting (default settings)', r0.virtual === false, JSON.stringify(r0));
    await p.evaluate(() => { const f = window.__fake; f.send('37 08 01 10 01'); f.send('37 08 00 10 01'); f.send('37 08 00 10 01'); f.send('37 08 00 10 01'); f.send('37 08 01 10 01'); });
    const r1 = await R();
    ok('first + switches to virtual shifting', r1.virtual === true);
    ok('+ held (3 repeated frames) = exactly one gear harder', r1.gi === Math.min(r0.gi + 1, r0.n - 1), `${r0.gi} -> ${r1.gi}`);
    await p.evaluate(() => { const f = window.__fake; f.send('37 08 01 10 00'); f.send('37 08 01 10 01'); f.send('37 08 01 10 00'); f.send('37 08 01 10 01'); });
    const r2 = await R();
    ok('− twice = two gears easier', r2.gi === Math.max(r1.gi - 2, 0), `${r1.gi} -> ${r2.gi}`);
    // Click v2 frames: right puck + (SHFT_UP_R = bit 0x2000 cleared), left puck − (SHFT_UP_L = 0x200), A unmapped
    const v2 = bit => { let n = 0xffffffff - bit; const o = ['23', '08']; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b.toString(16).padStart(2, '0')); } while (n); return o.join(' '); };
    await p.evaluate(([up, idle, a]) => { const f = window.__fake; f.send(idle); f.send(up); f.send(up); f.send(idle); f.send(a); f.send(idle); }, [v2(0x2000), v2(0), v2(0x10)]);
    const r3 = await R();
    ok('v2 SHFT_UP_R = one gear harder, A does nothing', r3.gi === Math.min(r2.gi + 1, r3.n - 1), `${r2.gi} -> ${r3.gi}`);
    await p.evaluate(([dn, idle]) => { const f = window.__fake; f.send(dn); f.send(idle); }, [v2(0x200), v2(0)]);
    const r4 = await R();
    ok('v2 SHFT_UP_L = one gear easier', r4.gi === Math.max(r3.gi - 1, 0), `${r3.gi} -> ${r4.gi}`);
    await p.evaluate(() => { window.__fake.send('37 08 00 10 01'); window.__fake.send('37 08 01 10 01'); });
    await p.waitForFunction(() => window.__ride.running && !document.querySelector('.countdown'), null, { timeout: 15000 }).catch(() => {}); // the HUD refreshes in the ride loop, after the countdown
    await p.waitForTimeout(400);
    const r5 = await R();
    ok('HUD gear chip shows the virtual gear', /Virtual gear \d+\/\d+/.test(r5.label) && r5.label.startsWith(`Virtual gear ${r5.gi + 1}/`), `${r5.label} · ${r5.gear}`);
    if (SHOTS) { await p.evaluate(() => { window.__fake.send('37 08 00 10 01'); window.__fake.send('37 08 01 10 01'); }); await p.waitForTimeout(80); await p.screenshot({ path: path.join(SHOTS, 'ride-gear-after-shift.png') }); await p.locator('#hGearChip').screenshot({ path: path.join(SHOTS, 'ride-gear-chip.png') }); }

    // the Click drops (Click v2 without the Zwift unlock does this after about a minute): reconnect on its own
    const before = await p.evaluate(() => window.__fake.connects);
    await p.evaluate(() => window.__fake.drop());
    ok('state goes to reconnecting', await p.evaluate(async () => (await import('/js/zwiftclick.js')).click.status === 'reconnecting'));
    await p.waitForFunction(n => window.__fake.connects > n, before, { timeout: 5000 }).catch(() => {});
    await p.waitForFunction(() => window.__click.status === 'on', null, { timeout: 5000 }).catch(() => {});
    const st = await p.evaluate(async () => { const { click } = await import('/js/zwiftclick.js'); return { status: click.status, connects: window.__fake.connects, rideOns: window.__fake.writes.filter(b => String.fromCharCode(...b) === 'RideOn').length }; });
    ok('reconnected without a tap (gatt.connect again, RideOn again)', st.status === 'on' && st.connects === before + 1 && st.rideOns >= 2, JSON.stringify(st));
    const g0 = (await R()).gi;
    await p.evaluate(() => { window.__fake.send('37 08 01 10 00'); window.__fake.send('37 08 01 10 01'); });
    const g1 = (await R()).gi;
    ok('shifting works after the reconnect (one shift, listeners not doubled)', g1 === Math.max(g0 - 1, 0), `${g0} -> ${g1}`);
    // a second drop where the first reconnect attempt fails: backoff keeps trying
    await p.evaluate(() => { window.__fake.refuse = true; window.__fake.drop(); setTimeout(() => { window.__fake.refuse = false; }, 1500); });
    await p.waitForFunction(() => window.__click.status === 'on', null, { timeout: 8000 }).catch(() => {});
    const st2 = await p.evaluate(async () => { const { click } = await import('/js/zwiftclick.js'); return { status: click.status, connects: window.__fake.connects, refuse: window.__fake.refuse }; });
    ok('reconnect retries after a failed attempt (1 s, then 2 s)', st2.status === 'on', JSON.stringify(st2));

    // ride over: the ride's listener is gone
    const n = await p.evaluate(async () => { const { click } = await import('/js/zwiftclick.js'); window.__ride._close(false); return click._h.shift?.size || 0; });
    ok('ride teardown unsubscribes', n === 0, String(n));
    // disconnect from Settings: no reconnect afterwards
    await p.evaluate(async () => { const { click } = await import('/js/zwiftclick.js'); click.disconnect(); });
    await p.waitForTimeout(1300);
    ok('disconnect stays disconnected', await p.evaluate(async () => (await import('/js/zwiftclick.js')).click.status === 'off' && !window.__fake.refuse && window.__fake.connects));
    // a Click v2 / Ride that only has the fc82 service
    const v2c = await p.evaluate(async () => { window.__fake.svc = '0000fc82-0000-1000-8000-00805f9b34fb'; await window.__click.connect(); return window.__click.status; });
    ok('device with only the fc82 service connects', v2c === 'on', v2c);
    await p.evaluate(() => window.__click.disconnect());
    ok('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL test crashed · ' + (e.stack || e)); }
  finally { await browser?.close(); srv.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
