// End to end for Settings → Devices → Claude connector (js/mcplink.js, tools/mcp-api.mjs): signed out nothing; signed in "Create link"
// shows the full link once with Copy (clipboard holds it) and the steps for Claude; the link works as an MCP endpoint and a workout
// made through it shows up in the phone's watch editor and on the Strength page; up to 3 links; Remove kills a link.
// No sideways scroll at 320 / 390 px, no page errors. Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) RIDEFRAME_DATA=$(mktemp -d) node tools/mcplink-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-mcplink-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  try {
    const api = (m, p, body, token) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-RF-Token': token } : {}) }, body: body && JSON.stringify(body) }).then(r => r.json());
    const mcp = (url, method, params) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const { token, name } = await api('POST', '/api/account/register', { name: 'Claude Clara', email: 'clara@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' });
    const phone = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await phone.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    const P = await phone.newPage(); const perr = []; P.on('pageerror', e => perr.push(e.message));
    await P.goto(BASE + '/handy.html');
    await P.click('#hSet'); await P.waitForSelector('#wIn'); await wait(300); ok(!(await P.locator('#mNew').count()), 'signed out: no Claude connector row'); await P.click('#tOk');
    await P.evaluate(([token, name]) => localStorage.setItem('rf_account', JSON.stringify({ token, name })), [token, name]);
    await P.reload(); await P.waitForSelector('#hSet');
    const open = async () => { await P.click('#hSet'); await P.waitForSelector('#mNew:not([disabled])'); };
    const sideways = async w => { await P.setViewportSize({ width: w, height: 844 }); await P.waitForTimeout(150); return P.evaluate(() => [document.documentElement.scrollWidth > innerWidth + 1, ...[...document.querySelectorAll('.psheetin')].map(e => e.scrollWidth > e.clientWidth + 1)].some(Boolean)); };
    const shot = async (nm, w = 390) => { if (!SHOTS) return; await P.setViewportSize({ width: w, height: 844 }); await P.waitForTimeout(150);
      await P.evaluate(() => document.querySelector('#tWatch').scrollIntoView({ block: 'start' })); await P.waitForTimeout(150); await P.screenshot({ path: `${SHOTS}/mcp_${nm}.png` }); };
    await open();
    ok(/Claude connector/.test(await P.textContent('#tMcp')) && /Plan watch workouts in Claude/.test(await P.textContent('#tMcp')), 'signed in: the row next to the watch rows');
    ok(await P.locator('#tWcfg + #tMcp').count() === 1, 'right below Watch screens & workouts');
    ok(!(await P.locator('.mdev').count()), 'no links yet');
    await shot('empty');
    await P.click('#mNew'); await P.waitForSelector('#mUrl');
    const url = await P.inputValue('#mUrl'); ok(new RegExp(`^${BASE}/mcp/[A-Za-z0-9_-]{43}$`).test(url), 'the full link is shown: ' + url.replace(/[A-Za-z0-9_-]{43}$/, '<token>'));
    const box = await P.textContent('.mnew');
    ok(/Settings → Connectors → Add custom connector/.test(box), 'the steps for Claude'); ok(/Keep the link secret: anyone who has it can read this data and change your watch workouts/.test(box), 'says it is a secret');
    ok(/Claude can read your activities \(all sports\), strength sessions, fitness and form, weight and the recovery values from your watch/.test(box) && /change only your watch workouts and your training plan/.test(box), '25.11.: says plainly what the link reads');
    ok(/shown only now/.test(box), 'says it is shown once'); ok(/not opened via its public https address/.test(box), 'on localhost: warns that Claude cannot reach it');
    ok(await P.locator('.mdev').count() === 1 && /Claude link.*Created today · not used yet/.test(await P.textContent('.mdev')), 'listed with created and last use');
    for (const w of [320, 390]) ok(!(await sideways(w)), `new link: no sideways scroll at ${w} px`);
    await shot('new_link'); await shot('new_link_320', 320);
    await P.click('#mCopy'); await P.waitForSelector('#mMsg'); ok(/Copied ✓/.test(await P.textContent('#mMsg')), 'Copy says Copied');
    ok(await P.evaluate(() => navigator.clipboard.readText()) === url, 'the clipboard holds the link');
    ok(await P.inputValue('#mUrl') === url, 'the link stays on screen after Copy');

    // the link is a working MCP endpoint: a workout made through it lands in the phone's editor and on the Strength page
    const init = await mcp(url, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ui-test', version: '1' } }); ok(init.status === 200, 'the link answers initialize');
    const made = await (await mcp(url, 'tools/call', { name: 'create_workout', arguments: { name: 'Claude push', items: [{ exercise: 'bench', sets: 4, reps: 8, kg: 60 }, { exercise: 'Dips', sets: 3, reps: 10 }] } })).json();
    ok(made.result && !made.result.isError, 'create_workout through the link');
    await P.click('#mHide'); ok(!(await P.locator('#mUrl').count()), 'Done hides the link'); await P.click('#tOk');
    await P.click('#hSet'); await P.waitForSelector('.mdev'); ok(!(await P.locator('#mUrl').count()), 'shown only once: not there when the settings open again');
    await P.waitForFunction(() => /used today/.test(document.querySelector('.mdev')?.textContent || ''), null, { timeout: 5000 }).then(() => ok(true, 'last use shows up'), () => ok(false, 'last use shows up'));
    await P.click('#wcOpen'); await P.waitForFunction(() => /Saved|Defaults|Offline/.test(document.querySelector('#wcState')?.textContent || '')); await P.click('[data-tab="kraft"]');
    ok(/Claude push.*2 exercises · 7 sets/.test(await P.textContent('#wcBody')), "the workout is in the phone's watch editor"); await P.click('#wcDone');
    const K = await phone.newPage(); await K.goto(BASE + '/kraft.html'); await K.waitForFunction(() => /Watch workouts/.test(document.body.textContent), null, { timeout: 8000 }).catch(() => {});
    ok(/Watch workouts[\s\S]*Claude push[\s\S]*Bench press, Dips/.test(await K.textContent('body')), 'and on the Strength page under Watch workouts'); await K.close();

    // up to 3, then Remove
    await P.click('#mNew'); await P.waitForSelector('#mUrl'); await P.click('#mHide'); await P.click('#mNew'); await P.waitForFunction(() => document.querySelectorAll('.mdev').length === 3);
    ok(await P.locator('#mNew').isDisabled(), 'three links: Create link is off'); await P.click('#mHide');
    ok(/Up to 3 links\. Remove one to create a new one\./.test(await P.textContent('#tMcp')), 'and says why');
    await shot('three_links');
    const oldest = await P.getAttribute('.mdev:last-of-type [data-mdel]', 'data-mdel');
    P.once('dialog', d => { ok(/Claude can no longer read your data or change your workouts/.test(d.message()), 'Remove asks first'); d.accept(); });
    await P.click(`[data-mdel="${oldest}"]`); await P.waitForFunction(() => document.querySelectorAll('.mdev').length === 2);
    ok(!(await P.locator('#mNew').isDisabled()), 'removed: room for a new link');
    ok((await mcp(url, 'ping')).status === 404, 'the removed link no longer works');
    const left = await api('GET', '/api/account/mcp', null, token); ok(left.links.length === 2 && !left.links.some(l => l.id === oldest), 'the server agrees');
    for (const w of [320, 390]) ok(!(await sideways(w)), `list: no sideways scroll at ${w} px`);
    await shot('after_remove');
    // 25.11.: links from before the coach tools: a one-time notice that the link now reads more
    ok(!(await P.locator('#mNote').count()), 'new links: no notice');
    const MF = path.join(DATA, 'mcp.json'), M = JSON.parse(fs.readFileSync(MF, 'utf8')); for (const l of Object.values(M.links)) delete l.scope; fs.writeFileSync(MF, JSON.stringify(M));
    await P.click('#tOk'); await P.click('#hSet'); await P.waitForSelector('#mNote');
    ok(/This link can now also read activities, weight and recovery\./.test(await P.textContent('#mNote')), 'old links: the notice');
    for (const w of [320, 390]) ok(!(await sideways(w)), `notice: no sideways scroll at ${w} px`);
    await shot('scope_notice');
    await P.click('#mSeen'); ok(!(await P.locator('#mNote').count()), 'Got it hides it');
    await P.waitForFunction(async () => true); await wait(300);
    ok((await api('GET', '/api/account/mcp', null, token)).notice === false, 'and the server keeps that: once only');
    ok(/Claude can read your activities/.test(await P.textContent('#tMcp')), 'the row keeps saying what the link reads');
    ok(!perr.length, 'no page errors' + (perr.length ? ': ' + perr.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + e.message); fails++; }
  await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nClaude connector UI: all good'); process.exit(fails ? 1 : 0);
})();
