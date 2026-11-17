// Routes on the outdoor page end to end at phone width (390 px): import a .gpx route, see it listed and drawn, start, ride
// along it with positions fed by the test (?demo&feed, the clock faked), distance left shrinks, off route and back, the
// warning before a demo segment with its countdown, the segment itself with the delta to the PR, Strava routes from a fake
// Strava, "Use as route" on a past ride. Starts serve.mjs on free ports with a temp data folder (never the real one).
// Usage: NODE_PATH=$(npm root -g) node tools/routes-ui.cjs   SHOTS=<dir> saves screenshots.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const http = require('node:http'), net = require('node:net'), path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const ROOT = path.join(__dirname, '..'), SHOTS = process.env.SHOTS || '';
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
// the demo loop around Reine (outdoor.js demoGPS / demoSegs): angle a -> position
const C = [67.9326, 13.0890], RR = .006, at = a => [C[0] + Math.sin(a) * RR, C[1] + Math.cos(a) * RR * 2.4];
const routeGpx = (a0, a1, name) => `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><rte><name>${name}</name>`
  + [...Array(Math.round((a1 - a0) / .01) + 1)].map((_, i) => { const p = at(a0 + i * .01); return `<rtept lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"><ele>${(20 + i * .2).toFixed(1)}</ele></rtept>`; }).join('') + '</rte></gpx>';

(async () => {
  const F = http.createServer((req, res) => { // a fake Strava: two routes and their GPX
    const u = new URL(req.url, 'http://x'), j = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', 'X-RateLimit-Usage': '1,1', 'X-RateLimit-Limit': '100,1000' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/api/v3/athletes/1/routes') return j(200, u.searchParams.get('page') === '1' ? [{ id: 9001, id_str: '9001', name: 'Reine hills from Strava', distance: 9100, elevation_gain: 210, type: 1 }, { id: 9002, id_str: '9002', name: 'Harbour jog', distance: 4200, elevation_gain: 20, type: 2 }] : []);
    if (u.pathname === '/api/v3/routes/9001/export_gpx') { res.writeHead(200, { 'Content-Type': 'application/gpx+xml' }); return res.end(routeGpx(0, 3, 'Reine hills from Strava').replace(/<rte>/, '<trk>').replace(/<\/rte>/, '</trkseg></trk>').replace(/rtept/g, 'trkpt').replace('</name>', '</name><trkseg>')); }
    j(404, {});
  }).listen(0, '127.0.0.1');
  await new Promise(r => F.once('listening', r));
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-routes-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  fs.writeFileSync(path.join(DATA, 'strava.json'), JSON.stringify({ client_id: 'test-client', client_secret: 'test-only-not-a-secret', public_url: BASE }));
  fs.writeFileSync(path.join(DATA, 'strava_tokens.json'), JSON.stringify({ kUI: { access_token: 'ui-tok', refresh_token: 'ui-r', expires_at: Math.floor(Date.now() / 1000) + 3600, athlete: { id: 1, name: 'T' }, at: Date.now(), scope: 'read,activity:write,activity:read_all' } }));
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, STRAVA_BASE: `http://127.0.0.1:${F.address().port}` }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/strava/status'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-routes-files-')), gpx = path.join(tmp, 'Reine_loop.gpx');
  fs.writeFileSync(gpx, routeGpx(-1, 2.4, 'Reine loop'));

  const b = await chromium.launch(), c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await c.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.addInitScript(() => { window.__buzz = []; Object.defineProperty(navigator, 'vibrate', { value: x => { window.__buzz.push(x); return true; }, configurable: true }); });
  const shot = async n => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const noSide = async tag => ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no sideways scroll: ${tag}`);
  await p.goto(BASE + '/handy.html'); await p.evaluate(async () => { localStorage.setItem('rf_strava_key', 'kUI'); const { db } = await import('/js/db.js'); await db.kvDel('navRoutes'); await db.kvDel('outdoorDraft'); });
  await p.clock.install({ time: Date.now() });
  await p.goto(BASE + '/outdoor.html?demo&feed'); await p.clock.runFor(800);
  ok(await p.isVisible('#oRoute') && (await p.textContent('#oRoute')).includes('Routes'), 'route chip on the map before the start');
  await p.click('#oRoute'); await p.waitForSelector('#rFile', { state: 'attached' });
  ok(await p.textContent('.psheet').then(t => /No routes yet/.test(t)), 'empty list explains where routes come from');
  await p.clock.runFor(500); ok(await p.isVisible('#rStrava'), 'Import from Strava routes is offered (connected)');
  await p.setInputFiles('#rFile', gpx); await p.waitForSelector('.oroute');
  const row = await p.textContent('.oroute'); ok(/Reine loop/.test(row) && /km/.test(row) && /climb/.test(row), 'imported route listed: ' + row.replace(/\s+/g, ' ').trim());
  ok(await p.locator('.oroute.on').count() === 1 && await p.locator('.oroute svg path').count() === 1, 'it is selected, with its shape');
  await shot('01_routes_sheet'); await noSide('routes sheet');
  await p.click('#rDone');
  const blue = () => p.evaluate(() => [...document.querySelectorAll('#oMap path.leaflet-interactive')].filter(x => x.getAttribute('stroke') === '#3d8bff').length);
  ok(await blue() === 1, 'route drawn on the map'); ok(/Reine loop/.test(await p.textContent('#oRoute')), 'chip names the route: ' + (await p.textContent('#oRoute')).trim());
  await p.clock.runFor(500); await shot('02_route_on_map');

  // ride: one fix a second at ~7 m/s along the loop, from a = -1
  let a = -1, t = Date.now(); const fix = async (pt, sp = 7) => { t += 1000; await p.evaluate(([pt, t, sp]) => window.__rfFix({ timestamp: t, coords: { latitude: pt[0], longitude: pt[1], accuracy: 5, altitude: 30, speed: sp } }), [pt, t, sp]); await p.clock.runFor(1000); };
  await fix(at(a)); await p.click('#oStart'); await p.clock.runFor(300);
  const left = async () => p.evaluate(() => { const m = document.querySelector('#oNav')?.textContent.match(/([\d.]+)\s*(km|m)\s*left/); return m ? +m[1] * (m[2] === 'km' ? 1000 : 1) : null; });
  for (let i = 0; i < 20; i++) await fix(at(a += .0105));
  const l1 = await left(); for (let i = 0; i < 30; i++) await fix(at(a += .0105)); const l2 = await left();
  ok(l1 > 0 && l2 < l1, `distance left on the route shrinks: ${l1} -> ${l2} m`);
  ok(!(await p.isVisible('#oRoute')), 'no route chip while riding'); await shot('03_riding_route_line'); await noSide('riding with a route');
  // the demo climb starts at a = 0.1: the warning appears with a countdown
  while (a < -.05) await fix(at(a += .0105));
  ok(await p.isVisible('#oSeg.warn'), 'segment warning before the start'); const w1 = await p.textContent('#oSeg');
  ok(/Segment in/.test(w1) && /Demo climb/.test(w1) && /PR 0:30/.test(w1), 'warning text: ' + w1.replace(/\s+/g, ' ').trim());
  const cd = async () => p.evaluate(() => { const m = document.querySelector('#oSeg em')?.textContent.match(/(\d+):(\d\d)/); return m ? +m[1] * 60 + +m[2] : null; });
  const c1 = await cd(); await fix(at(a += .0105)); await fix(at(a += .0105)); const c2 = await cd();
  ok(c1 > 0 && c1 <= 45 && c2 < c1, `countdown runs down: ${c1} s -> ${c2} s`);
  ok((await p.evaluate(() => window.__buzz.length)) >= 1, 'one short vibration for the warning'); await shot('04_segment_warning');
  // into the segment: live timing against the PR
  while (!(await p.isVisible('#oSeg:not(.warn)')) && a < .3) await fix(at(a += .0105));
  for (let i = 0; i < 12; i++) await fix(at(a += .0105));
  ok(/Need \d+\.\d km\/h for (PR|KOM)/.test(w1), 'warning says the speed it takes to win: ' + w1);
  const live = await p.textContent('#oSeg'), em = await p.textContent('#oSeg em');
  ok(/Need \d+\.\d km\/h for (PR|KOM)/.test(live) || /\+/.test(em), 'on the segment: speed still needed (or already behind): ' + live);
  ok(/Demo climb/.test(live) && /%/.test(live) && /PR 0:30/.test(live), 'live timing on the segment: ' + live.replace(/\s+/g, ' ').trim());
  ok(/^[−+]\d:\d\d$/.test(em.trim()), 'delta to the PR shown big: ' + em.trim()); await shot('05_segment_live_pr'); await noSide('segment live');
  ok(await p.evaluate(() => { const s = document.querySelector('#oSeg').getBoundingClientRect(), bf = document.querySelector('#oBigF').getBoundingClientRect(); return s.bottom <= bf.top + 1; }), 'banner does not cover the big number');
  while (a < .75) await fix(at(a += .0105)); // through the finish
  // off route: drift 15 m a second away from the loop centre for 12 s, then back
  const outAt = (a, m) => { const q = at(a), k = 1 + m / 667; return [C[0] + (q[0] - C[0]) * k, C[1] + (q[1] - C[1]) * k]; };
  for (let m = 15; m <= 180; m += 15) await fix(outAt(a += .003, m), 4);
  const off = await p.textContent('#oNav'); ok(await p.isVisible('#oNav.off') && /Off route · \d+ m/.test(off), 'off route banner: ' + off.trim());
  ok(await p.locator('#oNav .oarr').count() === 1, 'arrow back to the route'); await shot('06_off_route'); await noSide('off route');
  for (let m = 165; m >= 0; m -= 15) await fix(outAt(a += .003, m), 4);
  for (let i = 0; i < 3; i++) await fix(at(a += .0105));
  ok(!(await p.isVisible('#oNav.off')) && /left/.test(await p.textContent('#oNav')), 'back on route: ' + (await p.textContent('#oNav')).trim());
  // tiles: Route left and Climb left can be chosen
  await p.click('[data-t="0"]'); ok(await p.locator('[data-k2="routeLeft"]').count() === 1 && await p.locator('[data-k2="climbLeft"]').count() === 1, 'Route left / Climb left in the field picker');
  await p.click('[data-k2="routeLeft"]'); const tile = await p.textContent('[data-t="0"]'); ok(/Route left/.test(tile) && /\d/.test(tile), 'Route left tile: ' + tile.replace(/\s+/g, ' ').trim());
  ok(await p.evaluate(() => document.querySelector('#out').getBoundingClientRect().height) > 0 && errs.length === 0, 'no page errors: ' + errs.join(' | '));
  // finish and save, then ride it again from the detail sheet
  await p.click('#oPause'); await p.click('#oEnd'); await p.click('#eSave'); await p.waitForSelector('#dRoute'); await shot('07_detail_use_as_route');
  await p.click('#dRoute'); await p.clock.runFor(500);
  ok(/Morning|Lunch|Afternoon|Evening|Ride/.test(await p.textContent('#oRoute')), 'Use as route: the ride is the new route: ' + (await p.textContent('#oRoute')).trim());
  ok(await p.evaluate(async () => { const { db } = await import('/js/db.js'); return (await db.kvGet('navRoutes')).length; }) === 2, 'two routes stored');
  // Strava routes (fake Strava)
  await p.click('#oRoute'); await p.clock.runFor(500); await p.waitForSelector('#rStrava:not([hidden])'); await p.click('#rStrava');
  await p.waitForSelector('[data-sr="9001"]'); await p.clock.runFor(200); await shot('08_strava_routes'); await noSide('strava routes');
  const nStrava = () => p.evaluate(async () => { const { db } = await import('/js/db.js'); return ((await db.kvGet('navRoutes')) || []).filter(r => r.stravaId === '9001').length; });
  await p.click('[data-sr="9001"]'); await p.waitForFunction(() => !document.querySelector('[data-sr]')); ok(await nStrava() === 1, 'Strava route saved');
  ok(true, 'Strava route imported and chosen: ' + (await p.textContent('#oRoute')).trim());
  await p.click('#oRoute'); await p.clock.runFor(500); await p.click('#rStrava'); await p.waitForSelector('[data-sr="9001"]'); ok(/saved/.test(await p.textContent('[data-sr="9001"]')), 'marked as saved');
  await p.click('[data-sr="9001"]'); await p.waitForFunction(() => !document.querySelector('[data-sr]'));
  ok(await nStrava() === 1, 'importing it twice keeps one copy');
  ok(errs.length === 0, 'no page errors at the end: ' + errs.join(' | '));
  await b.close(); srv.kill(); F.close(); fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? `\n${fails} FAILED` : '\nall OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
