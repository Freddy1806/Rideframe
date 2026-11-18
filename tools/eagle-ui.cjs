// The Eagle of Destiny end to end (owner 18.11.): a workout ride (Harbour Loop, VO2max 5 × 5) with ?eagle: the eagle comes 3 s
// into the first hard interval; its head sits at the right edge (visible part 25–38 % of the width, upper two thirds, never
// over the interval bar) at 1280×720, 1920×1080 and 2560×1080; the beak moves while it speaks (no audio files in the cloud:
// the fallback syllable timing); no text, subtitle or speech bubble appears; it flies off ahead swerving left and right and is
// gone at the end. Also the Settings toggle and the pause menu Options. Without the Blender models (cloud checkout) the
// procedural stand-in plays the eagle. The 3D world draws at ~1 fps in headless Chromium, so the world sleeps while the
// scene runs (the eagle's head box is measured in camera space, not from pixels) and wakes only for the screenshots.
// Starts its own serve.mjs on a free port with a temp data folder.
// Usage: NODE_PATH=$(npm root -g) node tools/eagle-ui.cjs [<shots folder>]   (or SHOTS=<dir>)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const SHOTS = process.argv[2] || process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0; const ok = (c, m, info = '') => { n++; console.log(`${c ? '✓' : '✗'} ${m}${!c && info ? ' · ' + info : ''}`); if (!c) fails++; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-eagle-ui-')), port = await free(), BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/account/ping'); break; } catch { await wait(100); } }
  const b = await chromium.launch();
  const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); const boxLog = [], offLog = []; p.on('console', m => { if (/^\[eagle\] head box/.test(m.text())) boxLog.push(m.text()); if (/^\[eagle\] look off/.test(m.text())) offLog.push(m.text()); }); p.on('dialog', d => d.accept());

    // ---- Settings: the toggle, on by default ----
    await p.goto(BASE + '/?desktop&noprofile&laptest&eagle'); await p.waitForTimeout(700);
    await p.click('.tab[data-view="settings"]'); await p.waitForSelector('#eagle');
    const st = await p.evaluate(() => { const i = document.querySelector('#eagle'); return { on: i.checked, label: i.closest('label').textContent }; });
    ok(st.on && /Eagle of Destiny/.test(st.label), 'Settings: "Eagle of Destiny" toggle, on by default', JSON.stringify(st));

    // ---- the ride ----
    await p.click('.tab[data-view="library"]'); await p.click('.card[data-id="kurz"]'); await p.waitForSelector('#workSel');
    await p.selectOption('#workSel', 'vo2_5x5'); await p.click('#rideBtn');
    await p.waitForFunction(() => window.__ride?.running && window.__world, null, { timeout: 240000 });
    await p.evaluate(() => { window.__world.sleep = true; });
    await p.waitForFunction(() => !document.querySelector('.countdown') && window.__ride.eagle, null, { timeout: 240000 });
    await p.evaluate(() => { const r = window.__ride, t = r.state.trainer; t.device = { gatt: { connected: true } }; t.data = { power: 300, cadence: 92, speed: 9, hr: 160 };
      clearInterval(window.__tl); window.__tl = setInterval(() => { t.lastData = performance.now(); }, 100); t.lastData = performance.now();
      const s = r.workout.steps, at = l => s.slice(0, s.findIndex(x => x.label === l)).reduce((a, x) => a + x.dur, 0);
      window.__A = at('VO2max 1/5'); r.elapsed = window.__A - 20; });
    ok(await p.evaluate(() => window.__ride.eg?.state === 'wait' && window.__ride.eagle.kind === 'standin'), 'eagle planned; no Blender model here: the procedural stand-in');
    await p.waitForTimeout(1500);
    ok(await p.evaluate(() => window.__ride.eagle.state === 'idle'), 'not in the rest before the interval');

    /** record one scene frame by frame; shots: freeze it at these moments for a screenshot */
    const scene = async (tag, shots) => {
      await p.evaluate(shots => { const r = window.__ride, e = r.eagle; window.__log = []; window.__txt = []; window.__shotAt = shots ? { line: false, away: false } : null;
        const mo = window.__mo = new MutationObserver(ms => { for (const m of ms) for (const x of m.addedNodes) { const t = (x.textContent || '') + ' ' + (x.className || ''); if (t.trim()) window.__txt.push(t.slice(0, 120)); } });
        mo.observe(document.body, { childList: true, subtree: true, characterData: false });
        const bar = () => document.querySelector('#hWork')?.getBoundingClientRect();
        window.__hudOp = () => { const op = s => { const x = document.querySelector(s); return x ? +getComputedStyle(x).opacity : -1; }; // the right-side HUD fades while the eagle sits there
          return { cls: !!document.querySelector('.hud.eagle-on'), map: op('.minimap'), grade: op('.grade-tag'), top: op('.hud-top'), stats: op('.hud-bottom'), bar: op('#hWork') }; };
        const loop = () => { if (!window.__log) return;
          if (!window.__hold) { const b = e.box(), br = bar(); window.__log.push({ t: e.t, st: e.state, jaw: e.jaw, box: b, lineT: e.lineT, L: e.L, hud: window.__hudOp(), tOff: e.state === 'play' ? e.tOff : 0, iv: r.wNow?.i, el: r.elapsed, barTop: br ? br.top / innerHeight : 1, H: innerHeight, txt: document.body.innerText.length });
            const S = window.__shotAt;
            if (S && !S.line && e.lineT && e.t - e.lineT > 1.2 && e.jaw > 0.28) { S.line = true; window.__hold = 'line'; }
            if (S && !S.away && e.state === 'play' && e.t > e.tOff + 1.25) { S.away = true; window.__hold = 'away'; } }
          if (e.state === 'done' && window.__log.some(x => x.st === 'play') && !window.__hold) { window.__done = true; return; }
          requestAnimationFrame(loop); };
        window.__done = false; window.__hold = null;
        if (!e._tick0) { e._tick0 = e.tick; e.tick = dt => window.__hold ? null : e._tick0.call(e, dt); }
        requestAnimationFrame(loop); }, shots);
      for (let k = 0; k < 600; k++) {
        const h = await p.evaluate(() => window.__hold || (window.__done ? 'done' : ''));
        if (h === 'done') break;
        if (h === 'line' || h === 'away') { // wake the world for one picture of this moment
          await p.evaluate(() => { window.__world.sleep = false; window.__f0 = window.__world.renderer.info.render.frame; });
          await p.waitForFunction(() => window.__world.renderer.info.render.frame >= window.__f0 + 2, null, { timeout: 120000 });
          if (SHOTS) await p.screenshot({ path: path.join(SHOTS, (shots === 'rig' ? 'eagle_rig_' : 'eagle_') + (h === 'line' ? 'mid_sentence_1280.png' : 'fly_away_1280.png')), timeout: 120000 });
          await p.evaluate(() => { window.__world.sleep = true; window.__hold = null; });
        }
        await p.waitForTimeout(200);
      }
      await p.waitForTimeout(600); const hudAfter = await p.evaluate(() => window.__hudOp());
      const L = await p.evaluate(() => { window.__mo.disconnect(); const l = window.__log; window.__log = null; return { log: l, txt: window.__txt, body: document.body.innerText,
        gone: !window.__world.camera.getObjectByName('eagleOfDestiny'), rig: window.__ride.eagle.rig, eg: window.__ride.eg.state }; });
      const log = L.log, first = log.find(x => x.st === 'play'), line = log.filter(x => x.lineT && x.t > x.lineT + 0.25 && x.t < x.lineT + x.L - 0.25);
      const H = log[0].H, W = await p.evaluate(() => innerWidth);
      return { log, first, line, L, W, H, hudAfter, away: log.filter(x => x.tOff && x.t > x.tOff + 0.5 && x.box) };
    };
    const checks = (tag, R) => {
      const { line, L, away } = R;
      ok(line.length > 10, `${tag}: the line plays (${line.length} frames)`);
      const bx = line.filter(x => x.box), vis = bx.map(x => 1 - x.box.x0), cut = bx.every(x => x.box.x1 > 0.99); // box from the skinned vertices, projected
      ok(bx.length === line.length && Math.min(...vis) >= 0.25 && Math.max(...vis) <= 0.38 && cut, `${tag}: head at the right edge, ${Math.round(Math.min(...vis) * 100)}–${Math.round(Math.max(...vis) * 100)} % of the width visible, cut by the edge`, JSON.stringify(bx[0]?.box));
      const yc = bx.map(x => (x.box.y0 + x.box.y1) / 2), y1 = Math.max(...bx.map(x => x.box.y1)), bar = Math.min(...line.map(x => x.barTop));
      ok(Math.max(...yc) < 2 / 3 && Math.min(...bx.map(x => x.box.y0)) > -0.05, `${tag}: in the upper two thirds (centre ${Math.round(Math.max(...yc) * 100)} % from the top)`);
      ok(y1 < bar, `${tag}: interval bar not covered (head down to ${Math.round(y1 * 100)} %, bar from ${Math.round(bar * 100)} %)`);
      const jaws = line.map(x => x.jaw); let moves = 0; for (let i = 1; i < jaws.length; i++) if (Math.abs(jaws[i] - jaws[i - 1]) > 0.02) moves++;
      ok(Math.max(...jaws) > 0.2 && Math.min(...jaws) < 0.05 && moves >= 4, `${tag}: the beak opens and closes while it speaks (jaw ${Math.min(...jaws).toFixed(2)}–${Math.max(...jaws).toFixed(2)} rad, ${moves} changes)`);
      const bad = L.txt.filter(t => /eagle|destiny|bitch|faster|bubble|subtitle|caption/i.test(t));
      ok(!bad.length && !/destiny|bitch/i.test(L.body), `${tag}: no text, subtitle or speech bubble on screen`, JSON.stringify(bad.slice(0, 3)));
      const cx = away.filter(x => x.t > x.tOff + 0.8 && x.t < x.tOff + 3.6).map(x => (x.box.x0 + x.box.x1) / 2);
      ok(cx.length > 5 && Math.min(...cx) < 0.45 && Math.max(...cx) > 0.55, `${tag}: flies off ahead, swerving left and right (centre ${Math.round(Math.min(...cx) * 100)}–${Math.round(Math.max(...cx) * 100)} %)`);
      ok(L.gone && !L.rig && L.eg === 'done' && R.log.at(-1).st === 'done', `${tag}: gone at the end`);
      const hid = line.map(x => x.hud), late = hid.filter((_, i) => line[i].t > line[i].lineT + 0.2);
      ok(hid.every(h => h.cls) && late.every(h => h.map <= 0.01 && h.grade <= 0.01), `${tag}: minimap, big grade and next-interval pill faded out while it speaks`, JSON.stringify(late[0]));
      ok(hid.every(h => h.top === 1 && h.stats === 1 && (h.bar === 1 || h.bar === -1)), `${tag}: top buttons, stats row and interval bar stay`, JSON.stringify(hid[0]));
      const hf = R.log.filter(x => x.tOff && x.t > x.tOff + 0.5).map(x => x.hud);
      ok(hf.length && hf.every(h => !h.cls), `${tag}: the class goes at take-off`);
      ok(!R.hudAfter.cls && R.hudAfter.map === 1 && R.hudAfter.grade === 1, `${tag}: all back after the scene`, JSON.stringify(R.hudAfter));
    };

    // 1280×720: the real gate, 3 s into the first hard interval, with the screenshots
    const R1 = await scene('1280', true);
    ok(R1.first && Math.abs(R1.first.el - (await p.evaluate(() => window.__A)) - 3) < 0.6, '?eagle: starts 3 s into the first hard interval', JSON.stringify(R1.first));
    ok(R1.first && R1.first.iv === (await p.evaluate(() => window.__ride.workout.steps.findIndex(x => x.label === 'VO2max 1/5'))), 'inside the hard interval VO2max 1/5');
    checks('1280×720', R1);
    // once per workout
    await p.evaluate(() => { const r = window.__ride, s = r.workout.steps; r.elapsed = s.slice(0, s.findIndex(x => x.label === 'VO2max 2/5')).reduce((a, x) => a + x.dur, 0) + 2; });
    await p.waitForTimeout(2500);
    ok(await p.evaluate(() => window.__ride.eagle.state === 'done' && window.__ride.eg.state === 'done'), 'once per workout: not again in the next interval');

    const run = async (w, h, tag, shots) => {
      await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(500);
      const n0 = boxLog.length, o0 = offLog.length;
      await p.evaluate(() => { window.__ride.eg = { state: 'wait', now: true, iv: -1 }; }); // ?eagle=now hook for another run
      checks(`${tag}${w}×${h}`, await scene(`${w}`, shots));
      ok(boxLog.length === n0 + 1 && /^\[eagle\] head box x\d+\.\.\d+ y-?\d+\.\.\d+ %/.test(boxLog.at(-1)), `${tag}${w}×${h}: one console line "${boxLog.at(-1)}"`);
      const off = +(/^\[eagle\] look off (\d+)°$/.exec(offLog.at(-1) || '') || [])[1];
      ok(offLog.length === o0 + 1 && off < 12, `${tag}${w}×${h}: eye contact while it speaks ("${offLog.at(-1)}", beak to camera < 12°)`);
    };
    await run(1920, 1080, '', false); await run(2560, 1080, '', false);
    ok(/^\[eagle\] head box x/.test(boxLog[0] || ''), `the first scene logged its head box too ("${boxLog[0]}")`);
    ok(+(/look off (\d+)°$/.exec(offLog[0] || '') || [])[1] < 12, `the first scene (1280×720) has eye contact too ("${offLog[0]}")`);
    // a stand-in rigged like the real adler_nah (one SkinnedMesh, armature −90° X / 180° Y, rotated head rest, jaw offset, 2.3 m wings)
    await p.evaluate(() => { history.replaceState(null, '', location.pathname + location.search + '&eaglerig=real'); const r = window.__ride, E = r.eagle.constructor; r.eagle = new E(window.__world); });
    ok(await p.evaluate(() => window.__ride.eagle.kind === 'rig' && !!window.__ride.eagle), '?eaglerig=real: the rigged stand-in');
    await run(1280, 720, 'rig ', 'rig'); await run(1920, 1080, 'rig ', false); await run(2560, 1080, 'rig ', false);
    ok(await p.evaluate(() => { const R = window.__ride.eagle; return R.state === 'done'; }), 'rig: done');

    // the HUD comes back on pause and when the scene is aborted (Options: off while it sits there)
    await p.setViewportSize({ width: 1280, height: 720 }); await p.waitForTimeout(400);
    await p.evaluate(() => { window.__ride.eg = { state: 'wait', now: true, iv: -1 }; });
    await p.waitForFunction(() => window.__ride.eagle.perched && window.__ride.eagle.t > 5, null, { timeout: 60000 }); await p.waitForTimeout(400);
    ok(await p.evaluate(() => window.__hudOp().cls && window.__hudOp().map === 0), 'perched: right-side HUD hidden');
    await p.keyboard.press('Space'); await p.waitForSelector('#pOpts'); await p.waitForTimeout(500);
    ok(await p.evaluate(() => { const h = window.__hudOp(); return !h.cls && h.map === 1 && h.grade === 1; }), 'pause: the HUD is back');
    await p.click('#pOpts'); await p.waitForSelector('#oEagle');
    ok(/Eagle of Destiny: on/.test(await p.textContent('#oEagle')), 'pause Options: "Eagle of Destiny: on"');
    await p.click('#oEagle'); await p.waitForTimeout(200);
    ok(/Eagle of Destiny: off/.test(await p.textContent('#oEagle')) && await p.evaluate(() => window.__ride.state.settings.eagle === false), 'Options: switched off (saved in the settings)');
    await p.click('#oBack'); await p.waitForSelector('#pResume'); await p.click('#pResume'); await p.waitForTimeout(500);
    ok(await p.evaluate(() => { const h = window.__hudOp(); return !h.cls && h.map === 1 && !window.__ride.eagle.rig && !window.__world.camera.getObjectByName('eagleOfDestiny'); }), 'aborted mid-scene: eagle gone, the HUD stays back');
    await p.evaluate(() => { window.__ride.eg = { state: 'wait', now: true, iv: -1 }; }); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => window.__ride.eagle.state !== 'play' && window.__ride.eg.state === 'wait'), 'switched off: no eagle');
    ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  } catch (e) { ok(false, 'run', e.stack); }
  finally { await b.close(); srv.kill(); }
  console.log(`\n${n - fails}/${n} ok`); process.exit(fails ? 1 : 0);
})();
