// Rand-Check (Freddy 15.11.: "die Abstände zum Rand müssen immer passen"): opens every phone screen at the common phone
// widths and the main app from tablet to TV width, each twice (Chrome and Safari-wide letters), and measures each piece of text: cut off, sticking out of its box, or closer than 6 px to the edge of its
// button/pill/card. Run before every deploy:  PORT=8799 node serve.mjs &  node tools/layoutcheck.cjs [http://localhost:8799]
// Needs Playwright (preinstalled in the cloud box: NODE_PATH=$(npm root -g)). Exit code 1 when something is found.
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8799', OUT = process.env.SHOTS || '';
const WIDTHS = (process.env.WIDTHS || '320,360,375,390,414,430').split(',').map(Number), MIN_GAP = 6;
const WIDE = (process.env.WIDE || '768,1024,1280,1440,1920').split(',').filter(Boolean).map(Number); // main app (laptop/TV/tablet)
const NAME = process.env.NAME || 'FREDDY TEST MAXIMILIAN';
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null; // ONLY=^workouts: just those screens
const LONG = 'Rumänisches Kreuzheben mit Pause';
const seed = async p => p.evaluate(async ([long, NAME]) => { const { db } = await import('/js/db.js'); const now = Date.now(), d = 864e5;
  await db.kvSet('kraft', [0, 1, 2].map(i => ({ id: 'w' + i, name: 'Oberkörper schwer und lang benannt', start: now - i * 3 * d, date: now - i * 3 * d + 3600e3, dur: 3725, prs: 2,
    ex: [{ k: 'bench', n: 'Bankdrücken', t: 'w', sets: [{ kg: 102.5, r: 10, done: true }, { kg: 100, r: 8, done: true }] }, { k: 'my_x', n: long, t: 'w', sets: [{ kg: 140, r: 12, done: true }] },
      { k: 'pull', n: 'Klimmzüge', t: 'bw', sets: [{ kg: 12.5, r: 12, done: true }] }, { k: 'plank', n: 'Plank', t: 'time', sets: [{ s: 185, done: true }] }] }))
    .concat([{ id: 'watch-ww', name: 'Evening workout', source: 'watch', start: now - 4 * d, date: now - 4 * d + 2700e3, dur: 2700, prs: 1, avgHr: 128, maxHr: 171, kcal: 412, // from the Garmin watch (tools/watch-api.mjs)
      ex: [{ k: 'bench', n: 'Bench press', t: 'w', sets: [{ kg: 102.5, r: 8, s: '', done: true, pr: true }, { kg: 102.5, r: 7, s: '', done: true }] }, { k: 'my_x', n: long, t: 'w', sets: [{ kg: 140, r: 12, s: '', done: true }] }] }]));
  // rides and runs for the feed, the stats and the detail sheet: samples rows like outdoor.js writes them
  // [sec, metres, watts, km/h, cadence, bpm, lat, lon, ele]; 2 = power and 5 = heart rate are what fitness.js reads
  const ride = (id, routeId, ago, dur, dist, w, nm2, x = {}) => ({ id, routeId, sport: routeId === 'run' ? 'run' : 'ride', outdoor: routeId === 'outdoor' || routeId === 'run', date: now - ago * d, complete: true, duration: dur, elapsed: dur + 60, distance: dist, gain: 420,
    workout: nm2, avgPower: w, np: w ? w + 8 : 0, best20: w ? w + 12 : 0, best5: w ? w + 35 : 0, kj: Math.round(w * dur / 1000), ...x,
    samples: [...Array(240)].map((_, i) => [i * dur / 240 | 0, Math.round(dist * i / 240), w ? w + Math.round(30 * Math.sin(i / 9)) : 0, Math.round(dist / dur * 36 * (1 + .1 * Math.sin(i / 20))) / 10, 88, 128 + Math.round(30 * Math.sin(i / 40)), 67.93 + i / 24000, 13.09 + i / 9000, 20 + i % 60]) });
  for (const r of await db.all('rides')) await db.del('rides', r.id);
  for (const r of [ride('lr1', 'outdoor', 0, 8125, 98765, 238, long + ' über den Pass und zurück'), ride('lr2', 'run', 1, 3725, 12345, 0, 'Lauf ' + long, { kmSplits: [301, 296, 305, 299, 310, 288, 301, 297, 300, 304, 299, 302] }),
    ride('lr3', 'pure', 2, 3600, 33100, 215, 'Sweet spot', { laps: [{ t: 720, d: 6900, w: 238 }, { t: 720, d: 6800, w: 241 }] }), ride('lr4', 'kurz', 9, 2700, 21300, 180, '', { routeName: 'Lofoten Küste virtuell mit langem Namen' })]) await db.put('rides', r);
  // other sports from outside (17.11.): imported from Strava (no samples, a polyline), entered by hand (note), an unknown Strava type
  const ext = (id, type, ago, dur, dist, x) => ({ id, routeId: 'ext', sportType: type, sport: type, start: now - ago * d, date: now - ago * d + dur * 1000, duration: dur, elapsed: dur, distance: dist, gain: 12, complete: true, avgPower: 0, ...x });
  for (const r of [ext('st9001', 'IceSkate', 0.5, 4520, 23456, { source: 'strava', stravaId: '9001', strava: 'https://www.strava.com/activities/9001', workout: 'Eislaufen am Weissensee mit der ganzen Familie und Freunden', avgHr: 142, maxHr: 177, kcal: 812, polyline: 'u{~vFvyys@fS]a@lXeSxB' }),
    ext('man1', 'HighIntensityIntervalTraining', 3, 2700, 0, { source: 'manual', workout: 'HIIT', note: 'Zirkeltraining im Park, ' + long + ', sehr anstrengend und lang beschrieben' }),
    ext('st9002', 'UnderwaterHockeyTournamentFinal', 5, 3600, 0, { source: 'strava', stravaId: '9002', strava: 'https://www.strava.com/activities/9002', workout: 'Finale' })]) await db.put('rides', r);
  await db.kvDel('outdoorDraft').catch(() => {}); await db.kvDel('runDraft').catch(() => {}); await db.kvDel('kraftDraft').catch(() => {}); await db.kvDel('pureDraft').catch(() => {});
  localStorage.setItem('rf_account', JSON.stringify({ token: 'x', name: NAME }));
}, [LONG, NAME]);
// a Strava connection from before the read permission (the import asks to reconnect): only the status answer is faked
const stravaOld = p => p.route('**/api/strava/status', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":true,"connected":true,"canImport":false}' }));
// a route around the demo loop (outdoor.js ?demo&feed): seeded, chosen, then ridden with fixes the check feeds itself (to angle a1, off = metres off the loop at the end)
const routeRide = (a1, off = 0, name = 'Lofoten Küste über Reine und Hamnøy zurück') => async p => {
  await p.evaluate(async name => { const { db } = await import('/js/db.js'), { makeRoute } = await import('/js/navroute.js'), C = [67.9326, 13.0890], r = .006, pts = [];
    for (let a = -1; a <= 2.4; a += .01) pts.push([C[0] + Math.sin(a) * r, C[1] + Math.cos(a) * r * 2.4, 20 + a * 20]);
    const rt = makeRoute(name, pts); await db.kvSet('navRoutes', [rt]); const st = (await db.kvGet('settings')) || {}; st.outdoor = { ...st.outdoor, route: rt.id }; await db.kvSet('settings', st); }, name);
  await p.reload(); await p.waitForTimeout(700); if (a1 == null) return;
  await p.evaluate(() => window.__rfFix({ timestamp: Date.now() - 600e3, coords: { latitude: 67.9326 - Math.sin(1) * .006, longitude: 13.0890 + Math.cos(1) * .0144, accuracy: 5, altitude: 30, speed: 0 } }));
  await p.waitForTimeout(300); await p.click('#oStart'); // the first fix loads the (demo) segments
  await p.evaluate(([a1, off]) => { const C = [67.9326, 13.0890], r = .006; let t = Date.now();
    const at = (a, m = 0) => { const k = 1 + m / 667; return [C[0] + Math.sin(a) * r * k, C[1] + Math.cos(a) * r * 2.4 * k]; };
    const fix = (q, sp = 7) => window.__rfFix({ timestamp: t += 1000, coords: { latitude: q[0], longitude: q[1], accuracy: 5, altitude: 30, speed: sp } });
    let a = -1; for (; a < a1; a += .0105) fix(at(a)); for (let m = 15; m <= off; m += 15) fix(at(a += .003, m), 4); }, [a1, off]);
  await p.waitForTimeout(400);
  await p.evaluate(async () => { const { db } = await import('/js/db.js'); const st = (await db.kvGet('settings')) || {}; if (st.outdoor) delete st.outdoor.route; await db.kvSet('settings', st); });
};
// "Riding now" and the friends with a green dot (js/live.js): riding / online / offline friends with long names, an invite (answers of /api/live/* faked)
const liveFake = (sel = '.live.on .lvcard', act = null) => async p => {
  const now = Date.now(), ride = (id, routeId, routeName, d, len, mins, code) => ({ id, routeId, routeName, d, len, since: now - mins * 60e3, group: !!code, code, ask: false });
  const riders = [{ name: 'Konstantin Langenberg', ...ride('a1b2c3d4e5f6', 'coast', 'Lofoten Küste über Reine und Hamnøy zurück mit langem Namen', 12400, 37000, 83, null) }, { name: 'Maximilian Oberhuber', ...ride('f6e5d4c3b2a1', 'demo', 'Passo Demo', 812, 12400, 4, 'kq7mz') }];
  const friends = [...riders.map(({ name, ...r }) => ({ key: name.toLowerCase(), name, look: null, state: 'riding', lastSeen: now, ride: r })),
    ...['Anna-Lena Wiesenthal', 'Bo'].map(name => ({ key: name.toLowerCase(), name, look: null, state: 'online', lastSeen: now, ride: null })),
    ...['Bartholomäus Kirchberger', 'Dora', 'Christophorus Wendelin', 'Eva', 'Friedrich der Große XIV', 'Gustav', 'Henrietta Adalbertine', 'Ida', 'Jo'].map((name, i) => ({ key: name.toLowerCase(), name, look: null, state: 'offline', lastSeen: i === 1 ? null : now - (i + 1) * 97 * 60e3, ride: null }))];
  const invites = [{ id: '0a1b2c3d4e5f', from: 'Maximilian Oberhuber', code: 'kq7mz', routeId: 'coast', routeName: 'Lofoten Küste über Reine und Hamnøy zurück mit langem Namen', at: now }];
  const answer = u => /prefs$/.test(u) ? { show: true, auto: true } : /friends$/.test(u) ? { friends, invites, now, every: 30 } : /online$/.test(u) ? { ok: true, every: 30, invites } : { riders: riders.map(({ name, ...r }) => ({ name, look: null, me: false, canJoin: true, ...r })), now, every: 20 };
  await p.route('**/api/account/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })); // signed in (the fake login stays)
  await p.route(/\/api\/live(\/[a-z]+)?$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(r.request().url())) }));
  await p.route(/\/api\/account\/kraft/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ids":[]}' })); // the strength sync must not sign the fake login out
  await p.evaluate(n => localStorage.setItem('rf_account', JSON.stringify({ token: 'x', name: n })), NAME); // the first load (unfaked) signed the fake login out
  await p.reload(); await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(600);
  if (act) { await p.evaluate(s => document.querySelector(s).click(), act); await p.waitForTimeout(500); } // the strip redraws with the beat; a plain click is enough here
};
const SCREENS = [
  ['handy-fahren-gerade', '/handy.html', liveFake()],
  ['app-strecken-live-handy', '/?desktop&noprofile', liveFake()],
  ['handy-freunde', '/handy.html', liveFake('#hFriends', '#hFriends')],
  ['app-freunde-handy', '/?desktop&noprofile', liveFake('#frAll', '#frAll')],
  ['handy', '/handy.html', null],
  ['handy-login', '/handy.html', async p => { await p.evaluate(() => localStorage.removeItem('rf_account')); await p.reload(); await p.waitForTimeout(500); await p.click('#hAcc'); }],
  ['handy-registrieren', '/handy.html', async p => { await p.evaluate(() => localStorage.removeItem('rf_account')); await p.reload(); await p.waitForTimeout(500); await p.click('#hAcc'); await p.click('#aSwitch'); }],
  ['handy-passwort-vergessen', '/handy.html', async p => { await p.evaluate(() => localStorage.removeItem('rf_account')); await p.reload(); await p.waitForTimeout(500); await p.click('#hAcc'); await p.click('#aForgot'); }],
  ['passwort-neu', '/reset.html#t=' + 'a'.repeat(64), null],
  ['draussen', '/outdoor.html?demo&run', null],
  ['draussen-sensoren', '/outdoor.html?demo', p => p.click('#oSens')],
  ['menu-einstellungen', '/handy.html', p => p.click('#hSet')],
  // Settings -> Devices -> Garmin watch: the code with its steps and two paired watches with long names (answers faked), and signed out
  ['menu-einstellungen-uhr', '/handy.html', async p => { const day = 864e5, w = [{ id: 'a1b2c3d4e5f6', label: 'Forerunner 265 von Maximilian am Handgelenk', created: Date.now() - 40 * day, used: Date.now() - 3600e3 }, { id: 'f6e5d4c3b2a1', label: 'fenix 7X Pro', created: Date.now() - 2 * day, used: Date.now() - 2 * day }];
    await p.route('**/api/watch/devices', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ watches: w }) }));
    await p.route('**/api/watch/code', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '048213', exp: Date.now() + 600e3, ttl: 600 }) }));
    await p.route(/\/api\/account\/kraft/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ids":[]}' })); // the strength sync must not sign the fake login out
    await p.evaluate(n => localStorage.setItem('rf_account', JSON.stringify({ token: 'x', name: n })), NAME); await p.reload(); await p.waitForTimeout(500); // the login screens before signed out
    await p.click('#hSet'); await p.waitForSelector('#wPair', { timeout: 15000 }); await p.click('#wPair'); await p.waitForSelector('.wcode'); await p.waitForTimeout(300); await p.locator('#tWatch').scrollIntoViewIfNeeded(); }],
  ['menu-einstellungen-uhr-abgemeldet', '/handy.html', async p => { await p.evaluate(() => localStorage.removeItem('rf_account')); await p.reload(); await p.waitForTimeout(500); await p.click('#hSet'); await p.waitForSelector('#wIn'); await p.locator('#tWatch').scrollIntoViewIfNeeded(); }],
  // Settings -> Devices -> Watch screens & workouts (js/watchcfg.js): signed in, the account's watch config faked with long names (regex routes)
  ...[['uhr-setup-laufen', null], ['uhr-setup-rad', p => p.click('#wcSheet [data-tab="ride"]')], ['uhr-setup-feld', p => p.click('#wcSheet [data-slot="0"]')],
    ['uhr-setup-kraft', p => p.click('#wcSheet [data-tab="kraft"]')], ['uhr-setup-workout', async p => { await p.click('#wcSheet [data-tab="kraft"]'); await p.click('[data-w="0"]'); await p.waitForSelector('#wcWork'); }],
    ['uhr-setup-uebung', async p => { await p.click('#wcSheet [data-tab="kraft"]'); await p.click('[data-w="0"]'); await p.click('#wcWork [data-it="1"]'); await p.waitForSelector('#wcItem'); }],
    ['uhr-setup-uebungen', async p => { await p.click('#wcSheet [data-tab="kraft"]'); await p.click('[data-w="0"]'); await p.click('#wcAddEx'); await p.waitForSelector('#wcEx'); }],
    ['uhr-setup-mehr', p => p.click('#wcSheet [data-tab="more"]')]].map(([nm, act]) => [nm, '/handy.html', async p => {
    const W = { id: 'wl', name: 'Oberkörper schwer und lang benannt xx', items: [{ ex: 'bench', sets: 10, reps: 100, kg: 487.75, rest: 600 }, { ex: 'my_x', sets: 4, reps: 12, kg: 140, rest: 150 }, { ex: 'plank', sets: 3, reps: 95, kg: 0, rest: 45 }] };
    const cfg = { v: 1, sports: { run: { pages: [{ fields: ['lapPace', 'avgPace', 'lapDist', 'hrZone'] }, { fields: ['pace'] }, { fields: ['kcal', 'climb'] }, { fields: ['clock', 'cadence', 'lapTime'] }], map: true, segWarn: true, autoLap: true, autoPause: false, vibrate: true },
      ride: { pages: [{ fields: ['power3s', 'avgSpeed', 'avgPower', 'time'] }], map: false, segWarn: true, autoLap: false, autoPause: true, vibrate: true }, other: { pages: [{ fields: ['hr', 'time', 'clock', 'kcal'] }] } },
      more: ['HighIntensityIntervalTraining', 'StandUpPaddling', 'BackcountrySki'], workouts: [W, { ...W, id: 'w2', name: 'Beine' }] };
    await p.route(/\/api\/watch\/config$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ config: cfg, at: Date.now(), stored: true }) }));
    await p.route(/\/api\/watch\/devices$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"watches":[]}' }));
    await p.route(/\/api\/account\/kraft/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ids":[]}' })); // the strength sync must not sign the fake login out
    await p.evaluate(async n => { localStorage.setItem('rf_account', JSON.stringify({ token: 'x', name: n })); const { db } = await import('/js/db.js'); await db.kvDel('watchCfg'); }, NAME); await p.reload(); await p.waitForTimeout(500);
    await p.click('#hSet'); await p.waitForSelector('#wcOpen', { timeout: 15000 }); await p.click('#wcOpen'); await p.waitForFunction(() => /Saved/.test(document.querySelector('#wcState')?.textContent || ''), null, { timeout: 15000 });
    if (act) await act(p); }]),
  ['app-strecken-handy', '/?desktop&noprofile', null],
  ['app-training-handy', '/?desktop&noprofile', p => p.click('[data-view="training"]')],
  ['app-fahrten-handy', '/?desktop&noprofile', p => p.click('[data-view="history"]')],
  ['app-optionen-handy', '/?desktop&noprofile', p => p.click('[data-view="settings"]')],
  ['laufen', '/outdoor.html?sport=run&demo&run', null],
  ['laufen-ende', '/outdoor.html?sport=run&demo&fast&run', async p => { await p.waitForTimeout(3000); await p.click('#oPause'); await p.click('#oEnd'); }],
  ['draussen-einstellungen', '/outdoor.html?demo', p => p.click('#oSet')],
  ['draussen-routen', '/outdoor.html?demo', async p => { await routeRide(null)(p); await p.click('#oRoute'); }],
  ['draussen-route-karte', '/outdoor.html?demo&feed', routeRide(null)],
  ['draussen-route-segment-bald', '/outdoor.html?demo&feed', routeRide(-.05)],
  ['draussen-route-segment', '/outdoor.html?demo&feed', routeRide(.3)],
  ['draussen-route-ab', '/outdoor.html?demo&feed', routeRide(.8, 180)],
  ['laufen-route', '/outdoor.html?sport=run&demo&feed', async p => { await routeRide(null)(p); await p.evaluate(async () => { const { db } = await import('/js/db.js'); const st = (await db.kvGet('settings')) || {}; st.run = { ...st.run, route: st.outdoor.route }; await db.kvSet('settings', st); }); await p.reload(); await p.waitForTimeout(700); }],
  ['draussen-4felder', '/outdoor.html?demo&run', async p => { await p.evaluate(async () => { const { db } = await import('/js/db.js'); const st = (await db.kvGet('settings')) || {}; st.outdoor = { n: 4, map: 'small' }; await db.kvSet('settings', st); }); await p.reload(); await p.waitForTimeout(1500);
    await p.evaluate(async () => { const { db } = await import('/js/db.js'); const st = (await db.kvGet('settings')) || {}; delete st.outdoor; await db.kvSet('settings', st); }); }],
  ['draussen-6felder-hell', '/outdoor.html?demo&run', async p => { await p.evaluate(async () => { const { db } = await import('/js/db.js'); const st = (await db.kvGet('settings')) || {}; st.outdoor = { n: 6, map: 'off', big: 'hr' }; st.theme = 'light'; await db.kvSet('settings', st); }); await p.reload(); await p.waitForTimeout(1500);
    await p.evaluate(async () => { const { db } = await import('/js/db.js'); const st = (await db.kvGet('settings')) || {}; delete st.outdoor; delete st.theme; await db.kvSet('settings', st); }); }],
  ['draussen-ende', '/outdoor.html?demo&fast&run', async p => { await p.waitForTimeout(3000); await p.click('#oPause'); await p.click('#oEnd'); }],
  ['kraft', '/kraft.html', null],
  ['kraft-verlauf', '/kraft.html', p => p.click('[data-tab="hist"]')],
  ['kraft-uebungen', '/kraft.html', p => p.click('[data-tab="ex"]')],
  ['kraft-graph', '/kraft.html', async p => { await p.click('[data-tab="ex"]'); await p.click('[data-ex="bench"]'); }],
  ['kraft-workout', '/kraft.html', async p => { await p.click('[data-again]'); }],
  ['kraft-pause', '/kraft.html', async p => { await p.click('[data-again]'); await p.click('#kPause'); }],
  ['kraft-ende', '/kraft.html', async p => { await p.click('[data-again]'); await p.click('.kex[data-i="0"] [data-chk="0"]'); await p.click('#kFin'); }],
  ['rollentrainer', '/pure.html', null],
  ['rollentrainer-entwurf', '/pure.html', async p => { await p.evaluate(async () => { const { db } = await import('/js/db.js'); await db.kvSet('pureDraft', { state: 'pause', moving: 3725, wall: 3800, d: 42345, samples: [[1, 5, 200, 30, 90, 140]], savedAt: Date.now() }); }); await p.reload(); await p.waitForTimeout(700); }],
  // virtual gears in Grade mode (Zwift Cog), the sensors sheet with a Zwift Click connected, the settings with the gear switch
  ...[['rollentrainer-gaenge', null], ['rollentrainer-sensoren-click', async p => { await p.evaluate(async () => { const { click } = await import('/js/zwiftclick.js'); click.device = { name: 'Zwift Click', gatt: { connected: true } }; click.battery = 77; click._set('on'); }); await p.click('#pSens'); }],
    ['rollentrainer-einstellungen-gaenge', p => p.click('#pSetBtn')]].map(([nm, act]) => [nm, '/pure.html', async p => {
    await p.evaluate(async () => { const { db } = await import('/js/db.js'); const st = (await db.kvGet('settings')) || {}; await db.kvSet('settings', { ...st, shiftMode: 'virtual', realGear: '50x14', pure: { ...st.pure, mode: 'grade' } }); }); await p.reload(); await p.waitForTimeout(700);
    await p.evaluate(async () => { const { db } = await import('/js/db.js'); const st = (await db.kvGet('settings')) || {}; delete st.shiftMode; delete st.realGear; delete st.pure; await db.kvSet('settings', st); });
    if (act) await act(p); }]),
  ['rollentrainer-sensoren', '/pure.html', p => p.click('#pSens')],
  ['kraft-schnell', '/kraft.html', async p => { await p.click('#kQuick'); await p.fill('#qT', 'Ich habe gerade 100 Liegestütze und 50 Klimmzüge gemacht, 3x10 Bankdrücken mit 80 kg, 30 Hampelmänner mit Klatschen, 2 Minuten Plank, blabla, ungefähr 45 Minuten trainiert'); await p.click('#qGo'); }],
  ['kraft-schnell-ki', '/kraft.html', async p => { await p.click('#kQuick'); await p.click('#qAi'); }],
  ['aktivitaeten', '/aktivitaeten.html', null],
  ['aktivitaeten-filter', '/aktivitaeten.html', async p => { await p.click('#fFilter'); await p.click('[data-f="run"]'); }],
  ['aktivitaeten-plus', '/aktivitaeten.html', p => p.click('#fPlus')],
  ['aktivitaet-fahrt', '/aktivitaeten.html', p => p.click('[data-act="r:lr1"]')],
  ['aktivitaet-lauf', '/aktivitaeten.html', p => p.click('[data-act="r:lr2"]')],
  ['aktivitaet-kraft', '/aktivitaeten.html', p => p.click('[data-act="k:w0"]')],
  ['aktivitaet-kraft-uhr', '/aktivitaeten.html', p => p.click('[data-act="k:watch-ww"]')],
  ['kraft-verlauf-uhr', '/kraft.html', async p => { await p.click('[data-tab="hist"]'); await p.click('[data-open="watch-ww"]'); }],
  ['aktivitaet-import', '/aktivitaeten.html', p => p.click('[data-act="r:st9001"]')],
  ['aktivitaet-manuell', '/aktivitaeten.html', p => p.click('[data-act="r:man1"]')],
  ['aktivitaet-neu', '/aktivitaeten.html', async p => { await p.click('#fPlus'); await p.click('#fAdd'); }],
  ['aktivitaet-bearbeiten', '/aktivitaeten.html', async p => { await p.click('[data-act="r:man1"]'); await p.click('#dEdit'); }],
  ['aktivitaet-datei', '/aktivitaeten.html', async p => { await p.click('#fPlus'); await p.click('#fAdd'); await p.setInputFiles('#aFileIn', require('node:path').join(__dirname, 'fixtures/hike.gpx')); await p.waitForTimeout(300); }],
  ['aktivitaeten-strava', '/aktivitaeten.html', async p => { await stravaOld(p); await p.reload(); await p.waitForTimeout(700); }],
  ['menu-einstellungen-strava', '/handy.html', async p => { await stravaOld(p); await p.reload(); await p.waitForTimeout(500); await p.click('#hSet'); await p.waitForTimeout(300); }],
  ['statistik', '/statistik.html', null],
  ['statistik-last', '/statistik.html', p => p.click('[data-by="load"]')],
  ['handy-aktivitaet', '/handy.html', p => p.click('[data-act]')],
  ['profil', '/profil.html', null],
  ['remote', '/remote.html', null], // phone remote (js/remote.js): the code screen
  ['profil-daten', '/profil.html', p => p.click('#fSet')],
  ['handy-updates', '/handy.html', p => p.click('#hBell')],
  ['handy-woche', '/handy.html', async p => { await p.click('#tdWeek'); await p.waitForTimeout(500); }],
  ['workouts', '/workouts.html', null],
  ['workouts-lauf-neu', '/workouts.html', async p => { await p.click('[data-new="run"]'); await p.waitForSelector('#rwSheet'); }],
  // personal workouts (js/myworkouts-ui.js): on the Workouts page (27.11.) with a long name, its detail, its editor on the phone
  ['workouts-eigene', '/workouts.html', async p => { await p.evaluate(() => localStorage.setItem('rf_myworkouts', JSON.stringify([{ id: 'pw_layout1', name: 'Schwelle lang über den Pass mit Freddy x', base: 'thr2x20', routeId: 'fluss', routeName: 'River Valley mit sehr langem Namen', updated: 1,
    steps: [{ min: 10, pct: 55, label: 'Einfahren lang benannt' }, ...Array.from({ length: 6 }, (_, i) => ({ min: 7.5, pct: i % 2 ? 55 : 104, label: i % 2 ? 'Pause' : 'Schwelle ' + (i / 2 + 1) })), { min: 0.25, pct: 200, label: 'Sprint', free: true }] }]))); await p.reload(); await p.waitForSelector('#wk-ride .wkr'); await p.click('#wk-ride .wkr'); await p.waitForSelector('#wkSheet'); }],
  ['workouts-editor', '/workouts.html', async p => { await p.evaluate(() => localStorage.setItem('rf_myworkouts', JSON.stringify([{ id: 'pw_layout1', name: 'Schwelle lang über den Pass mit Freddy x', base: null, routeId: 'fluss', routeName: 'River Valley mit sehr langem Namen', updated: 1,
    steps: [{ min: 10, pct: 55, label: 'Einfahren lang benannt' }, { min: 117.75, pct: 104, label: 'Schwelle über alles' }, { min: 0.25, pct: 200, label: 'Sprint', free: true }] }]))); await p.reload(); await p.waitForSelector('#wk-ride .wkr'); await p.click('#wk-ride .wkr'); await p.click('#wkEdit'); await p.waitForSelector('.mwbox'); }],
];
const DESK = [ // the main app with its top bar (account pill, tabs) on tablet, laptop and TV widths
  ['app-strecken', '/?desktop&noprofile', null],
  ['app-strecken-live', '/?desktop&noprofile', liveFake()],
  ['app-freunde', '/?desktop&noprofile', liveFake('#frAll', '#frAll')],
  ['app-strecke-live', '/?desktop&noprofile&view=detail&id=coast', liveFake('.livehint')],
  ['app-training', '/?desktop&noprofile&view=training', null],
  ['app-fahrten', '/?desktop&noprofile&view=history', null],
  ['app-einstellungen', '/?desktop&noprofile&view=settings', null],
  ['app-strecke-workout', '/?desktop&noprofile&view=detail&id=fluss', async p => { await p.selectOption('#workSel', 'z2_90'); await p.locator('#wCustom').scrollIntoViewIfNeeded(); }],
  // does the workout fit the route (js/routefit.js): the "too short" line with its buttons, and the library marks
  ['app-strecke-zukurz', '/?desktop&noprofile&demo&view=detail&id=demo', async p => { await p.selectOption('#lapSel', '1'); await p.selectOption('#workSel', 'z2_90'); await p.waitForSelector('#mwFitLine'); await p.locator('#mwFitLine').scrollIntoViewIfNeeded(); }],
  ['app-strecken-zukurz', '/?desktop&noprofile&demo&view=detail&id=demo', async p => { await p.selectOption('#lapSel', '1'); await p.selectOption('#workSel', 'z2_90'); await p.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove())); await p.click('#back'); await p.waitForSelector('.card .fitshort'); }],
  ['app-workout-editor', '/?desktop&noprofile&view=detail&id=fluss', async p => { await p.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove())); // the faked login asks for an email first
    await p.selectOption('#workSel', 'over_under'); await p.click('#wCustom'); await p.waitForSelector('.mwbox'); }],
];
// Safari on the iPhone sets capitals with letter-spacing a little wider than Chrome: the second pass widens every
// letter by 0.03 em, so text that only just fits in Chrome is reported too
const SAFARI = () => { for (const e of document.querySelectorAll('body *')) { const s = getComputedStyle(e), ls = s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing); e.style.letterSpacing = (ls + parseFloat(s.fontSize) * .03) + 'px'; } };
function measure(minGap) { // runs in the page
  const bad = [], seen = new Set();
  const vis = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
  const boxed = e => { const s = getComputedStyle(e); return parseFloat(s.borderLeftWidth) > 0 || (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent'); }; // a visible frame or fill: button, pill, card, tile
  const name = e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''));
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`Seite scrollt seitlich (${document.documentElement.scrollWidth} > ${innerWidth})`);
  // a box that scrolls sideways hides its content just like a page that scrolls (only the tab rows may do that on purpose)
  for (const e of document.querySelectorAll('body *')) { const s = getComputedStyle(e);
    if (/auto|scroll|hidden/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 40 && vis(e) && !e.closest('.tabs, .leaflet-container, .ptabs, .kseg, .kmseg') && !(s.textOverflow === 'ellipsis'))
      bad.push(`Inhalt läuft seitlich aus ${name(e)} (${e.scrollWidth} > ${e.clientWidth})`); }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const txt = n.textContent.trim(); if (!txt) continue;
    const el = n.parentElement; if (!el || !vis(el) || el.closest('.leaflet-container, svg, script, style')) continue;
    const rg = document.createRange(); rg.selectNodeContents(n); const tr = rg.getBoundingClientRect(); if (!tr.width) continue;
    // the box the text visually sits in: nearest ancestor with border or background (button, pill, card, tile)
    let box = el; while (box && box !== document.body && !boxed(box)) box = box.parentElement;
    const key = txt.slice(0, 40) + '|' + (box && name(box));
    const clip = []; for (let a = el; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/hidden|clip|auto|scroll/.test(s.overflowX)) clip.push(a); }
    let shown = tr; // what is really visible: an ellipsis box ("Maximilian Muster…") shows its own width, that is fine
    for (const a of clip) { const r = a.getBoundingClientRect(), s = getComputedStyle(a);
      if (s.textOverflow === 'ellipsis' && /hidden|clip/.test(s.overflowX)) { if (!a.closest('.ppill, .pname, .khh, .hrow, .oinfo, #accPill') && (tr.right > r.right + 1)) { bad.push(`mit … gekürzt: „${txt.slice(0, 40)}“ in ${name(a)}`); seen.add(key); break; } shown = { left: Math.max(tr.left, r.left), right: Math.min(tr.right, r.right), top: tr.top, bottom: tr.bottom }; break; }
      if ((tr.right > r.right + 1 || tr.left < r.left - 1) && !/auto|scroll/.test(s.overflowX)) { bad.push(`abgeschnitten: „${txt.slice(0, 40)}“ in ${name(a)}`); seen.add(key); break; } }
    if (box && box !== document.body && !seen.has(key)) {
      const r = box.getBoundingClientRect(), s = getComputedStyle(box), bl = parseFloat(s.borderLeftWidth) || 0, br = parseFloat(s.borderRightWidth) || 0;
      const gl = shown.left - r.left - bl, gr = r.right - br - shown.right, gt = tr.top - r.top, gb = r.bottom - tr.bottom;
      if (gl < minGap - .5 || gr < minGap - .5) { bad.push(`zu nah am Rand (${Math.round(Math.min(gl, gr))} px): „${txt.slice(0, 40)}“ in ${name(box)}`); seen.add(key); }
      else if ((gt < -1 || gb < -1) && !/auto|scroll/.test(s.overflowY)) { bad.push(`ragt oben/unten raus: „${txt.slice(0, 40)}“ in ${name(box)}`); seen.add(key); }
    }
  }
  return [...new Set(bad)];
}
(async () => {
  const b = await chromium.launch(); let total = 0;
  const runs = [...WIDTHS.map(w => [w, SCREENS, true]), ...WIDE.map(w => [w, DESK, false])];
  for (const [w, list, mobile] of runs) {
    const c = await b.newContext({ viewport: { width: w, height: mobile ? 800 : Math.round(w * .5625) }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const p0 = await c.newPage(); await p0.goto(BASE + '/kraft.html'); await seed(p0); await p0.close();
    for (const [nm, url, act] of list.filter(([n]) => !ONLY || ONLY.test(n))) for (const safari of [false, true]) {
      const p = await c.newPage(); p.setDefaultTimeout(4000);
      if (!mobile) await p.route('**/api/account/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })); // signed in: the pill shows the long name
      const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.goto(BASE + '/handy.html'); await p.evaluate(async () => { const { db } = await import('/js/db.js'); await db.kvDel('outdoorDraft'); await db.kvDel('runDraft'); await db.kvDel('kraftDraft'); await db.kvDel('pureDraft'); await db.kvDel('navRoutes'); }); // each screen starts clean
      await p.goto(BASE + url); await p.waitForTimeout(mobile ? 700 : 1500);
      try { if (act) { await act(p); await p.waitForTimeout(400); } } catch (e) { errs.push('Schritt ging nicht: ' + e.message.split('\n').slice(0, 6).join(' | ')); }
      if (safari) await p.evaluate(SAFARI);
      const bad = [...(safari ? [] : errs.map(e => 'Fehler: ' + e)), ...await p.evaluate(measure, MIN_GAP)];
      const tag = `${nm} @ ${w}px${safari ? ' (Safari-Breite)' : ''}`;
      if (bad.length) { total += bad.length; console.log(`✗ ${tag}`); bad.forEach(x => console.log('   ' + x)); if (OUT) await p.screenshot({ path: `${OUT}/rand_${nm}_${w}${safari ? '_s' : ''}.png`, fullPage: true }); }
      await p.close();
    }
    await c.close();
  }
  await b.close();
  console.log(total ? `\n${total} Probleme` : `Rand-Check: alles sauber auf ${WIDTHS.join(', ')} px (Handy) und ${WIDE.join(', ')} px (App), je auch mit Safari-Breite`); process.exit(total ? 1 : 0);
})();
