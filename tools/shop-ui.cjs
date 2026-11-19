// The Wizard points shop in the browser (js/shop-ui.js): open it from the library with ?wp=5000&laptest, buy the wizard hat
// (asks once, balance −500, "Wearing", the look in the settings has it, a reload keeps it), the rider editor shows unowned
// items locked with their price, a low balance disables Buy and shows the missing points, the game pad reaches every card,
// B closes, and a phone in portrait (390×844) has no horizontal overflow. Starts its own serve.mjs with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) node tools/shop-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, extra = '') => { console.log(`${c ? '✓' : '✗'} ${m}${c || !extra ? '' : ' · ' + extra}`); if (!c) fails++; };
const BTN = { A: 0, B: 1, up: 12, down: 13, left: 14, right: 15 };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-shop-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch(), errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    await ctx.addInitScript(() => { const btn = () => ({ pressed: false, value: 0, touched: false });
      window.__pad = { id: 'Test pad (STANDARD GAMEPAD Vendor: 045e)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, btn), axes: [0, 0, 0, 0] };
      Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [window.__pad, null, null, null], configurable: true }); });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    const press = async (k) => { const i = BTN[k]; await p.evaluate(i => { const x = window.__pad.buttons[i]; x.pressed = true; x.value = 1; }, i); await p.waitForTimeout(70);
      await p.evaluate(i => { const x = window.__pad.buttons[i]; x.pressed = false; x.value = 0; }, i); await p.waitForTimeout(110); };
    const URL0 = BASE + '/?desktop&noprofile&laptest&wp=5000';
    await p.goto(URL0); await p.waitForSelector('#shopBtnLib');
    await p.waitForFunction(() => /5 000/.test(document.querySelector('#shopBalLib')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(/^Shop\s*🧙 5 000$/.test((await p.textContent('#shopBtnLib')).trim()), 'library: a "Shop 🧙 5 000" entry with the balance', await p.textContent('#shopBtnLib'));

    // ---- the shop page ----
    await p.click('#shopBtnLib'); await p.waitForSelector('.shopcard');
    const bal = () => p.textContent('#shBal');
    ok(await bal() === '🧙 5 000', 'shop: balance 5 000 at the top', await bal());
    ok(await p.locator('.shopcard').count() === 12 && await p.locator('.shopslot').count() === 4, 'shop: 12 cards in 4 slots (head, outfit, bike, gloves)');
    const gold = p.locator('[data-item="golden-bike"] button');
    ok(await gold.isEnabled() && /Buy · 🧙 5 000/.test(await gold.textContent()), 'golden bike (5 000) is just affordable');
    await p.hover('[data-item="crown"]'); await p.waitForTimeout(300);
    ok(/Trying on\s*Crown/.test(await p.textContent('#shCap')), 'pointing at a card puts it on the preview ("Trying on Crown")');
    await p.mouse.move(5, 5);
    if (SHOTS) { await p.waitForTimeout(900); await p.screenshot({ path: path.join(SHOTS, 'shop_desktop_1280.png') }); }
    await p.click('[data-buy="wizard-hat"]'); await p.waitForSelector('#shopConfirm');
    ok(await p.textContent('#shConfText') === 'Buy Wizard hat for 500 points?', 'buying asks once: "Buy Wizard hat for 500 points?"');
    await p.click('#shConfCancel'); ok(await bal() === '🧙 5 000' && await p.locator('[data-buy="wizard-hat"]').count() === 1, 'Cancel: nothing bought');
    await p.click('[data-buy="wizard-hat"]'); await p.click('#shConfBuy'); await p.waitForSelector('[data-off="wizard-hat"]');
    ok(await bal() === '🧙 4 500', 'bought: balance down by 500', await bal());
    ok(/Wearing/.test(await p.textContent('[data-item="wizard-hat"] button')) && await p.locator('[data-item="wizard-hat"].wearing').count() === 1, 'card shows "Wearing · Take off"');
    const look = () => p.evaluate(async () => (await import('./js/app.js')).state.settings.look);
    ok((await look())?.helmet === 'zauberhut', 'the look in the settings wears the hat');
    ok((await p.evaluate(async () => (await (await import('./js/db.js')).db.kvGet('settings'))?.look?.helmet)) === 'zauberhut', 'and it is saved');
    await p.click('[data-off="wizard-hat"]'); ok((await look()).helmet === 'aero' && await p.locator('[data-wear="wizard-hat"]').count() === 1, 'Take off: back to the helmet, card says "Wear"');
    await p.click('[data-wear="wizard-hat"]'); ok((await look()).helmet === 'zauberhut', 'Wear: on again, for free');

    // ---- pad: every card reachable, B closes ----
    // breadth-first over D-pad moves from the first stop: focus a reached card's stop again, try all four directions
    const curId = () => p.evaluate(() => window.__padnav?.cur?.closest?.('.shopcard')?.dataset.item || null);
    const stop = id => p.evaluate(id => { const c = document.querySelector(`.shopcard[data-item="${id}"]`); (c.querySelector('button:not([disabled])') || c).focus(); }, id);
    await press('down'); await press('down'); const seen = new Set(), todo = [];
    { const id = await curId(); if (id) { seen.add(id); todo.push(id); } }
    while (todo.length) { const from = todo.shift();
      for (const dir of ['up', 'down', 'left', 'right']) { await stop(from); await press(dir); const id = await curId(); if (id && !seen.has(id)) { seen.add(id); todo.push(id); } } }
    ok(seen.size === 12, `pad: the D-pad reaches every card (${seen.size}/12)`, [...seen].join(','));
    ok(/Trying on|Wearing/.test(await p.textContent('#shCap')), 'pad focus puts the card on the preview');
    await press('B'); await p.waitForTimeout(200); ok(await p.locator('#shopModal').count() === 0, 'B closes the shop');
    await p.waitForFunction(() => /4 500/.test(document.querySelector('#shopBalLib')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
    ok(/4 500/.test(await p.textContent('#shopBtnLib')), 'library button shows the new balance');

    // ---- rider editor: owned hat selectable, others locked with price and the shop hint ----
    await p.click('#lookBtnLib'); await p.waitForSelector('.avtab'); await p.click('.avtab[data-tab="kopf"]'); await p.waitForTimeout(400);
    ok(await p.locator('.avchip.on[data-v="zauberhut"]').count() === 1, 'editor: the owned wizard hat is a normal, selected chip');
    const lockC = p.locator('.avchip.locked[data-lock="crown"]');
    ok(await lockC.count() === 1 && /🔒 Crown\s*🧙 2 500/.test(await lockC.textContent()), 'editor: the crown is locked with its price', await lockC.textContent().catch(() => ''));
    await lockC.click(); ok(/Get it in the shop/.test(await p.textContent('.avlock')), 'clicking a locked item: "Get it in the shop" instead of selecting it');
    ok((await p.evaluate(() => document.querySelector('.avchip[data-v="zauberhut"]')?.classList.contains('on'))), 'the hat stays selected');
    await p.click('#avCancel');

    // ---- reload keeps it (the ?wp hook sets the balance again, the purchase stays) ----
    await p.reload(); await p.waitForSelector('#shopBtnLib'); await p.click('#shopBtnLib'); await p.waitForSelector('.shopcard');
    ok(await p.locator('[data-item="wizard-hat"].wearing').count() === 1 && (await look()).helmet === 'zauberhut', 'reload: still owned and worn');
    await p.click('#shClose');

    // ---- a low balance: Buy disabled, missing points shown ----
    await p.goto(BASE + '/?desktop&noprofile&laptest&wp=350'); await p.waitForSelector('#shopBtnLib'); await p.click('#shopBtnLib'); await p.waitForSelector('.shopcard');
    const cr = p.locator('[data-item="crown"] button');
    ok(await cr.isDisabled() && /Not enough points · 2 150 missing/.test(await cr.textContent()), 'low balance: crown button disabled, "2 150 missing"', await cr.textContent());
    ok(await p.locator('[data-buy="eagle-feather"]').isEnabled(), 'the feather (300) can still be bought');
    ok(await p.locator('[data-item="crown"][tabindex="0"]').count() === 1, 'a card with a disabled button is itself a pad stop');

    // ---- phone portrait ----
    const ph = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: true, hasTouch: true });
    const q = await ph.newPage(); q.on('pageerror', e => errs.push(e.message));
    await q.goto(URL0); await q.waitForSelector('#shopBtnLib'); await q.click('#shopBtnLib'); await q.waitForSelector('.shopcard'); await q.waitForTimeout(1200);
    const ov = await q.evaluate(() => { const box = document.querySelector('.shopbox'); return { doc: document.documentElement.scrollWidth, w: innerWidth, box: box.scrollWidth - box.clientWidth,
      cards: [...document.querySelectorAll('.shopcard, .shopcard .btn')].filter(e => e.getBoundingClientRect().right > innerWidth + 0.5 || e.scrollWidth > e.clientWidth + 1).length }; });
    ok(ov.doc <= ov.w && ov.box <= 0 && ov.cards === 0, 'phone 390×844: no horizontal overflow', JSON.stringify(ov));
    if (SHOTS) await q.screenshot({ path: path.join(SHOTS, 'shop_phone_390.png') });
    ok(!errs.length, 'no page errors', errs.join(' | '));
  } finally { await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
