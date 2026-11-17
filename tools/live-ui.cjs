// "Riding now" end to end (17.11.): two signed-in accounts in two browsers. A rides Passo Demo (the same start as
// tools/pause-ui.cjs: library -> card -> Ride), B sees A in the library strip within the refresh, taps Join, A's ride opens
// a group by itself without pausing ("Freddy is joining you") and B lands in the group with A's code and starts riding.
// Then the declined case (A switches "Friends can join me without asking" off, the HUD asks, Not now -> "Max Rider declined"),
// the hidden case ("Show me when I ride" off) and a signed-out ride that never sends a heartbeat; the phone home strip at
// 390 px (read-only, Copy link, no sideways scroll) and both settings. PeerJS is replaced by a small relay through the test
// (no internet needed; real WebRTC between two machines is not tested here). Starts its own serve.mjs on a free port.
// Usage: NODE_PATH=$(npm root -g) node tools/live-ui.cjs [shotsDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || ''; if (SHOTS && /^https?:/.test(SHOTS)) { console.log('The argument is a folder for screenshots, not a URL.'); process.exit(2); }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

// ---- a stand-in for PeerJS: every page's Peer talks through the test (exposeBinding), enough for js/group.js ----
const FAKE_PEER = `(() => {
  const peers = []; window.__peers = peers;
  class Ev { constructor() { this.h = {}; } on(e, f) { (this.h[e] ||= []).push(f); return this; } emit(e, ...a) { (this.h[e] || []).forEach(f => { try { f(...a); } catch (x) { console.error(x); } }); } }
  class Conn extends Ev { constructor(peer, cid, other) { super(); this.peer = peer; this.cid = cid; this.peerId = other; this.open = false; }
    send(d) { if (this.open) window.__peerOut({ t: 'data', to: this.peerId, cid: this.cid, data: JSON.parse(JSON.stringify(d)) }); }
    close() { if (!this.open) return; this.open = false; window.__peerOut({ t: 'close', to: this.peerId, cid: this.cid }); this.emit('close'); } }
  window.Peer = class extends Ev {
    constructor(id) { super(); this.id = typeof id === 'string' ? id : 'p' + Math.random().toString(36).slice(2, 10); this.conns = {}; peers.push(this);
      setTimeout(async () => { const r = await window.__peerOut({ t: 'open', id: this.id }); r === 'taken' ? this.emit('error', { type: 'unavailable-id' }) : this.emit('open', this.id); }, 20); }
    connect(to) { const cid = Math.random().toString(36).slice(2, 10), c = new Conn(this, cid, to); this.conns[cid] = c;
      window.__peerOut({ t: 'connect', from: this.id, to, cid }).then(r => { if (r !== 'ok') this.emit('error', { type: 'peer-unavailable' }); }); return c; }
    reconnect() {} call() { throw new Error('no voice in the test'); }
    destroy() { Object.values(this.conns).forEach(c => c.close()); window.__peerOut({ t: 'gone', id: this.id }); } };
  window.__peerIn = m => { const p = peers.find(x => x.id === m.to); if (!p) return;
    if (m.t === 'conn') { const c = new Conn(p, m.cid, m.from); p.conns[m.cid] = c; c.open = true; p.emit('connection', c); }
    else if (m.t === 'connopen') { const c = p.conns[m.cid]; if (c) { c.open = true; c.emit('open'); } }
    else if (m.t === 'connready') p.conns[m.cid]?.emit('open');
    else if (m.t === 'data') p.conns[m.cid]?.emit('data', m.data);
    else if (m.t === 'close') { const c = p.conns[m.cid]; if (c?.open) { c.open = false; c.emit('close'); } } };
})();`;
const relay = new Map(); // peer id -> page
const deliver = (id, m) => { const p = relay.get(id); return p && !p.isClosed() ? p.evaluate(x => window.__peerIn?.(x), { ...m, to: id }).catch(() => {}) : Promise.resolve(); };
async function peerOut({ page }, m) {
  if (m.t === 'open') { if (relay.has(m.id) && relay.get(m.id) !== page && !relay.get(m.id).isClosed()) return 'taken'; relay.set(m.id, page); return 'ok'; }
  if (m.t === 'gone') { if (relay.get(m.id) === page) relay.delete(m.id); return 'ok'; }
  if (m.t === 'connect') { if (!relay.has(m.to)) return 'missing'; (async () => { await deliver(m.to, { t: 'conn', from: m.from, cid: m.cid }); await deliver(m.from, { t: 'connopen', cid: m.cid }); await deliver(m.to, { t: 'connready', cid: m.cid }); })(); return 'ok'; } // like WebRTC: both ends exist and the joiner is open before the host says hello // the host's side exists before the joiner says hello
  if (m.t === 'data' || m.t === 'close') { deliver(m.to, m); return 'ok'; }
}

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-live-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  let ipN = 0; const api = async (method, p, token, body) => { const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.7.0.' + ipN++, ...(token ? { 'X-RF-Token': token } : {}) }, body: body && JSON.stringify(body) }); return r.json().catch(() => ({})); };
  const reg = async name => ({ name, token: (await api('POST', '/api/account/register', null, { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' })).token });
  const A = await reg('Max Rider'), B = await reg('Freddy'), C = await reg('Anna'), X = await reg('Konstantin Langenberg'), D = await reg('Dora'), Z = await reg('Zacharias Schlummer');
  await api('POST', '/api/live/online', Z.token); await api('DELETE', '/api/live/online', Z.token); // offline, "last seen just now"
  // a third rider for the pictures: another account with a long name riding the Rocky Coast, kept alive by the test
  let xD = 12400; const xBeat = () => api('POST', '/api/live', X.token, { routeId: 'coast', routeName: 'Rocky Coast', d: xD += 180, len: 37000, startedAt: Date.now() - 23 * 60e3 });
  await xBeat(); const xT = setInterval(xBeat, 15e3);

  const b = await chromium.launch();
  const errs = [];
  const ctxFor = async (acc, opts = {}) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, ...opts });
    await ctx.exposeBinding('__peerOut', peerOut); await ctx.addInitScript(FAKE_PEER);
    if (acc) await ctx.addInitScript(a => { try { if (!sessionStorage.getItem('rf_seeded')) { localStorage.setItem('rf_account', JSON.stringify({ token: a.token, name: a.name, email: a.name.replace(/\W/g, '') + '@example.org' })); sessionStorage.setItem('rf_seeded', '1'); } } catch {} }, acc);
    return ctx;
  };
  const open = async (ctx, url, tag) => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('dialog', d => d.accept()); await p.goto(BASE + url); return p; };
  const vis = (p, s) => p.locator(s).first().isVisible().catch(() => false);
  const shot = async (p, name, opts) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name), ...opts }); };
  const startDemoRide = async p => { await p.waitForSelector('.card[data-id="demo"]'); await p.click('.card[data-id="demo"]'); await p.click('#rideBtn'); await p.waitForSelector('#hPause', { timeout: 60000 }); };

  try {
    // ---- A rides (solo), B sees him in "Riding now" ----
    const ctxA = await ctxFor(A), RA = await open(ctxA, '/?desktop&noprofile&demo&laptest', 'A');
    const beatsA = []; RA.on('request', r => { if (/\/api\/live$/.test(r.url()) && r.method() === 'POST') beatsA.push(Date.now()); });
    ok(!beatsA.length, 'no heartbeat in the library (not riding)');
    await startDemoRide(RA);
    await RA.waitForFunction(() => window.__ride?.presence?.on, null, { timeout: 15000 });
    ok(beatsA.length >= 1, 'A in a ride: heartbeat sent');

    const ctxB = await ctxFor(B), LB = await open(ctxB, '/?desktop&noprofile&demo', 'B');
    await LB.waitForSelector('#live.on .lvcard', { timeout: 20000 });
    const cardA = LB.locator('.lvcard', { hasText: 'Max Rider' });
    ok(await cardA.count() === 1, 'B sees Max Rider in "Riding now"');
    ok(/Passo Demo/.test(await cardA.textContent()) && /km \d+[.,]\d of \d+/.test(await cardA.textContent()), 'card: route and "km x of y": ' + (await cardA.locator('.lvkm').textContent()).trim());
    ok(await LB.locator('.lvcard', { hasText: 'Konstantin' }).count() === 1, 'two riders in the strip');
    ok(await LB.locator('.lvcard', { hasText: 'Freddy' }).count() === 0, 'B does not see himself');
    const top = await LB.evaluate(() => { const l = document.querySelector('#live'), h = document.querySelector('.view-head'); return { strip: l.getBoundingClientRect().top, head: h.getBoundingClientRect().top }; });
    ok(top.strip < top.head, 'the strip sits at the top of the library');
    const zc = LB.locator('.frchip', { hasText: 'Zacharias' });
    ok(await zc.count() === 1 && /offline/.test(await zc.getAttribute('class')) && /last seen/.test(await zc.textContent()), 'an offline friend: dimmed chip with "last seen"');
    await LB.waitForTimeout(600); await shot(LB, 'library_riding_now_1280.png');
    // route page: "Max Rider is riding this now · Join"
    await LB.click('.card[data-id="demo"]'); await LB.waitForSelector('.livehint', { timeout: 20000 });
    ok(/Max Rider is riding this now/.test(await LB.textContent('.livehint')), 'route page: "Max Rider is riding this now" with Join');
    await LB.waitForTimeout(600); await shot(LB, 'route_page_hint_1280.png');
    await LB.click('#back'); await LB.waitForSelector('#live.on .lvcard');

    // ---- the phone: same strip, read-only, Copy link, no sideways scroll at 390 px ----
    const ctxP = await ctxFor(C, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctxP.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    const PH = await open(ctxP, '/handy.html', 'phone');
    await PH.waitForSelector('#hLive.on .lvcard', { timeout: 20000 });
    ok(await PH.locator('#hLive .lvjoin').count() === 0 && /Join on your laptop/.test(await PH.textContent('#hLive')), 'phone: read-only, "Join on your laptop"');
    await PH.waitForTimeout(500);
    ok(await PH.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone strip: no sideways scroll at 390 px');
    ok(await vis(PH, '#hFriends .frstack .frface'), 'phone: a row of faces with dots');
    await shot(PH, 'phone_home_riding_now_390.png');
    await PH.locator('#hLive .lvcard', { hasText: 'Max Rider' }).locator('.lvcopy').click();
    await PH.waitForFunction(() => /Copied/.test(document.querySelector('#hLive').textContent));
    const link = await PH.evaluate(() => navigator.clipboard.readText());
    ok(/\/\?live=[0-9a-f]{12}$/.test(link), 'Copy link: a join link for the laptop: ' + link.replace(BASE, ''));
    await PH.click('#hFriends'); await PH.waitForSelector('#frSheet .frrow');
    ok(/last seen/.test(await PH.textContent('#frSheet')) && await PH.locator('#frSheet .frrow.riding').count() >= 2, 'phone: the friends sheet (riding, offline with last seen)');
    await shot(PH, 'phone_friends_sheet_390.png'); await PH.click('#frOk');
    await PH.click('#hSet'); await PH.waitForSelector('#tLive');
    ok(await PH.isChecked('#tLive') && await PH.isChecked('#tLiveAuto'), 'phone settings: both switches, on by default');
    await PH.locator('#tLive').scrollIntoViewIfNeeded(); await PH.waitForTimeout(300); await shot(PH, 'phone_settings_riding_now_390.png');
    await PH.click('#tOk');

    await LB.waitForSelector('.frchip.online', { timeout: 20000 }).catch(() => {});
    ok(/Anna/.test(await LB.textContent('.frchip.online').catch(() => '')), 'B sees Anna online (her phone is open): green dot');
    const green = await LB.evaluate(() => getComputedStyle(document.querySelector('.frchip.online .frdot')).backgroundColor);
    ok(green === 'rgb(47, 211, 107)', 'the online dot is green: ' + green);
    await shot(LB, 'library_friends_online_1280.png');
    // ---- B taps Join: A's ride opens a group by itself, B ends up in it with A's code ----
    const t0 = Date.now();
    await cardA.locator('.lvjoin').click();
    await LB.waitForSelector('#liveAsk'); ok(/Asking Max Rider\s*to let you in/.test(await LB.textContent('#liveAsk')), 'B: "Asking Max Rider to let you in …"');
    await shot(LB, 'join_asking_1280.png');
    await RA.waitForFunction(() => /Freddy is joining you/.test(document.querySelector('#hFlash')?.textContent || '') && document.querySelector('#hFlash').classList.contains('on'), null, { timeout: 30000 });
    ok(true, `A: "Freddy is joining you" (request came with the next heartbeat after ${Math.round((Date.now() - t0) / 1000)} s)`);
    await shot(RA, 'ride_flash_joining_1280.png');
    ok(!(await vis(RA, '#pauseOverlay')) && await RA.evaluate(() => !window.__ride.paused), 'A keeps riding: no pause');
    const code = (await RA.textContent('#hGCode')).trim(); ok(/^[a-z2-9]{5}$/.test(code), 'A: group chip with code ' + code);
    const codeIn = p => p.waitForFunction(() => { const c = document.querySelector('#hGCode')?.textContent || document.querySelector('.group-code')?.textContent || document.querySelector('#gCode')?.value || ''; return c.trim() || null; }, null, { timeout: 15000 }).then(h => h.jsonValue(), () => '');
    const gotCode = await codeIn(LB); // the group window, or already the ride when the host's start came at once
    ok(gotCode === code, `B in the join flow with A's code (${gotCode})`);
    ok(Date.now() - t0 < 45000, `within the 45 s (${Math.round((Date.now() - t0) / 1000)} s)`);
    await LB.waitForSelector('#hPause', { timeout: 120000 }).catch(() => {}); // the 3D world loads first (slow on a busy machine)
    ok(await vis(LB, '#hPause') && (await LB.textContent('#hGCode').catch(() => '')).trim() === code, 'B is riding in A\'s group (late join next to the host)');
    await RA.waitForFunction(() => /Freddy/.test(document.querySelector('#hGroup .glist')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    ok(/Freddy/.test(await RA.textContent('#hGroup .glist')), 'A sees Freddy in his group chip');

    // ---- "Friends can join me without asking" off: the HUD asks, Not now -> "Max Rider declined" ----
    await api('PUT', '/api/live/prefs', A.token, { auto: false });
    await RA.evaluate(() => window.__ride.presence.beat());
    const ctxC = await ctxFor(C), LC = await open(ctxC, '/?desktop&noprofile&demo', 'C');
    await LC.waitForSelector('#live.on .lvcard', { timeout: 20000 });
    const cardA2 = LC.locator('.lvcard', { hasText: 'Max Rider' });
    ok(/gets a short question/.test(await cardA2.locator('.lvjoin').getAttribute('title')), 'C: the Join button says Max gets a question first');
    await cardA2.locator('.lvjoin').click(); await LC.waitForSelector('#liveAsk');
    await RA.evaluate(() => window.__ride.presence.beat()); // the test does not wait for the 20 s beat this time
    await RA.waitForSelector('#hJoinAsk', { timeout: 15000 });
    ok(/Anna wants to join you/.test(await RA.textContent('#hJoinAsk')) && /A accept · B not now/.test(await RA.textContent('#hJoinAsk')), 'A: "Anna wants to join you" with Accept / Not now (pad A / B)');
    await shot(RA, 'ride_accept_prompt_1280.png');
    await RA.click('#jqNo');
    await LC.waitForSelector('#laMsg', { timeout: 15000 });
    ok(/Max Rider declined/.test(await LC.textContent('#laMsg')), 'C: "Max Rider declined"');
    await shot(LC, 'join_declined_1280.png');
    await LC.click('#laOk');

    // ---- the pad: A = accept on the prompt ----
    await LC.locator('.lvcard', { hasText: 'Max Rider' }).locator('.lvjoin').click(); await LC.waitForSelector('#liveAsk');
    await RA.evaluate(() => window.__ride.presence.beat()); await RA.waitForSelector('#hJoinAsk', { timeout: 15000 });
    await RA.evaluate(() => { const pad = { connected: true, mapping: 'standard', id: 'test pad', buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0, value: i === 0 ? 1 : 0 })), axes: [0, 0, 0, 0] }; navigator.getGamepads = () => [pad]; });
    await RA.waitForSelector('#hJoinAsk', { state: 'detached', timeout: 5000 }).catch(() => {});
    ok(!(await vis(RA, '#hJoinAsk')), 'pad A on the prompt accepts');
    await RA.evaluate(() => { navigator.getGamepads = () => []; });
    ok(await codeIn(LC) === code, 'C accepted: into the same group with the code');
    await api('DELETE', '/api/live', C.token); await ctxC.close(); // Anna's laptop is closed, her phone stays open
    await RA.waitForFunction(() => !window.__ride.group.others().some(r => r.name === 'Anna'), null, { timeout: 30000 });

    // ---- invite from the pause menu: Dora (library open) and Anna (phone) see "Max Rider invites you to ride" ----
    const ctxD = await ctxFor(D), LD = await open(ctxD, '/?desktop&noprofile&demo', 'D');
    await LD.waitForSelector('#live.on'); await RA.waitForTimeout(500);
    await RA.click('#hPause'); await RA.click('#pInvite'); await RA.waitForSelector('.invlist [data-fi]');
    const invTxt = await RA.textContent('.invlist');
    ok(await RA.locator('.invlist [data-fi]', { hasText: 'Dora' }).count() === 1 && await RA.locator('.invlist [data-fi]', { hasText: 'Freddy' }).count() === 0, 'pause menu: online friends to invite (not the ones already in the group): ' + invTxt.replace(/\s+/g, ' '));
    await shot(RA, 'ride_invite_menu_1280.png');
    for (const n of ['Dora', 'Anna']) { await RA.locator('.invlist [data-fi]', { hasText: n }).click(); await RA.waitForFunction(n => [...document.querySelectorAll('.invlist [data-fi]')].some(b => b.textContent.includes(n + ' invited')), n, { timeout: 10000 }); }
    ok(true, 'Dora and Anna invited');
    await RA.click('#invBack'); await RA.click('#pResume');
    await LD.waitForSelector('.lvinvite', { timeout: 40000 });
    ok(/Max Rider invites you to ride/.test(await LD.textContent('.lvinvite')), 'Dora: "Max Rider invites you to ride · Join"');
    await LD.waitForTimeout(500); await shot(LD, 'library_invite_1280.png');
    await PH.waitForSelector('#hLive .lvinvite', { timeout: 40000 });
    ok(/invites you to ride/.test(await PH.textContent('#hLive .lvinvite')) && await vis(PH, '#hLive .lvicopy'), 'Anna\'s phone: the invite with "join on your laptop" + Copy link');
    await PH.evaluate(() => scrollTo(0, 0)); await PH.waitForTimeout(400); await shot(PH, 'phone_invite_390.png');
    ok(await PH.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone invite: no sideways scroll');
    await LD.click('.lvijoin');
    ok(await codeIn(LD) === code, 'Dora joins with the invite: same group code');
    await ctxD.close();

    // ---- hidden: "Show me when I ride" off -> gone from the list ----
    await api('PUT', '/api/live/prefs', A.token, { show: false, auto: true });
    await RA.evaluate(() => window.__ride.presence.beat());
    const ctxC2 = await ctxFor(C), LC2 = await open(ctxC2, '/?desktop&noprofile&demo', 'C2');
    await LC2.waitForSelector('#live.on .lvcard', { timeout: 20000 });
    ok(await LC2.locator('.lvcard', { hasText: 'Max Rider' }).count() === 0, 'hidden: Max Rider (setting off) is not listed');
    ok(await LC2.locator('.lvcard', { hasText: 'Freddy' }).count() === 1, 'Freddy (riding in the group) is listed');
    ok(await RA.evaluate(() => !window.__ride.presence.on), 'A stops the heartbeat once the server says hidden');
    const nA = beatsA.length;

    // ---- signed out: a ride never sends a heartbeat ----
    const ctxS = await ctxFor(null), RS = await open(ctxS, '/?desktop&noprofile&demo&laptest', 'signed-out');
    const beatsS = []; RS.on('request', r => { if (/\/api\/live/.test(r.url())) beatsS.push(r.url()); });
    await startDemoRide(RS); await RS.waitForTimeout(1500);
    ok(!beatsS.length && await RS.evaluate(() => !window.__ride.presence), 'signed out: no heartbeat, nobody sees the ride');
    await ctxS.close();

    // ---- leaving the ride ends the entry at once (B leaves A's group ride); desktop settings ----
    const before = (await api('GET', '/api/live', C.token)).riders.some(r => r.name === 'Freddy');
    await LB.click('#hPause'); await LB.click('#pDiscard'); await LB.waitForSelector('#hPause', { state: 'detached' });
    await LC2.waitForTimeout(500); const after = (await api('GET', '/api/live', C.token)).riders.some(r => r.name === 'Freddy');
    ok(before && !after, `Freddy leaves the ride: off the list at once (DELETE) (${before} -> ${after})`);
    await ctxC2.close();
    await RA.click('#hPause'); await RA.click('#pDiscard'); await RA.waitForSelector('#hPause', { state: 'detached' }); await RA.waitForTimeout(1200);
    ok(beatsA.length === nA, 'A: no heartbeat while hidden and after the ride');
    await RA.click('.tab[data-view="settings"]'); await RA.waitForSelector('#livePanel');
    ok(await RA.isChecked('#liveShow') && await RA.isChecked('#liveAuto'), 'desktop settings: "Show me when I ride" and "Friends can join me without asking"');
    await RA.locator('#livePanel').scrollIntoViewIfNeeded(); await RA.waitForTimeout(300); await shot(RA, 'settings_riding_now_1280.png');
    await RA.click('#liveAuto'); await RA.waitForFunction(async () => true); await RA.waitForTimeout(2200);
    ok((await api('GET', '/api/live/prefs', A.token)).auto === false, 'the desktop switch lands in the account settings');

    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('✗ ' + e.message.split('\n').slice(0, 6).join(' | ')); fails++; }
  clearInterval(xT); await b.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nRiding now UI: all good'); process.exit(fails ? 1 : 0);
})();
