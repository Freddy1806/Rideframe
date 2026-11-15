// Rand-Check (Freddy 15.11.: "die Abstände zum Rand müssen immer passen"): opens every phone screen at the common phone
// widths and the main app from tablet to TV width, each twice (Chrome and Safari-wide letters), and measures each piece of text: cut off, sticking out of its box, or closer than 6 px to the edge of its
// button/pill/card. Run before every deploy:  PORT=8799 node serve.mjs &  node tools/layoutcheck.cjs [http://localhost:8799]
// Needs Playwright (preinstalled in the cloud box: NODE_PATH=$(npm root -g)). Exit code 1 when something is found.
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8799', OUT = process.env.SHOTS || '';
const WIDTHS = (process.env.WIDTHS || '320,360,375,390,414,430').split(',').map(Number), MIN_GAP = 6;
const WIDE = (process.env.WIDE || '768,1024,1280,1440,1920').split(',').filter(Boolean).map(Number); // main app (laptop/TV/tablet)
const NAME = process.env.NAME || 'FREDDY TEST MAXIMILIAN';
const LONG = 'Rumänisches Kreuzheben mit Pause';
const seed = async p => p.evaluate(async ([long, NAME]) => { const { db } = await import('/js/db.js'); const now = Date.now(), d = 864e5;
  await db.kvSet('kraft', [0, 1, 2].map(i => ({ id: 'w' + i, name: 'Oberkörper schwer und lang benannt', start: now - i * 3 * d, date: now - i * 3 * d + 3600e3, dur: 3725, prs: 2,
    ex: [{ k: 'bench', n: 'Bankdrücken', t: 'w', sets: [{ kg: 102.5, r: 10, done: true }, { kg: 100, r: 8, done: true }] }, { k: 'my_x', n: long, t: 'w', sets: [{ kg: 140, r: 12, done: true }] },
      { k: 'pull', n: 'Klimmzüge', t: 'bw', sets: [{ kg: 12.5, r: 12, done: true }] }, { k: 'plank', n: 'Plank', t: 'time', sets: [{ s: 185, done: true }] }] })));
  await db.kvDel('outdoorDraft').catch(() => {}); await db.kvDel('kraftDraft').catch(() => {});
  localStorage.setItem('rf_account', JSON.stringify({ token: 'x', name: NAME }));
}, [LONG, NAME]);
const SCREENS = [
  ['handy', '/handy.html', null],
  ['handy-login', '/handy.html', async p => { await p.evaluate(() => localStorage.removeItem('rf_account')); await p.reload(); await p.waitForTimeout(500); await p.click('#hAcc'); }],
  ['draussen', '/outdoor.html?demo&run', null],
  ['draussen-sensoren', '/outdoor.html?demo', p => p.click('#oSens')],
  ['draussen-ende', '/outdoor.html?demo&fast&run', async p => { await p.waitForTimeout(3000); await p.click('#oPause'); await p.click('#oEnd'); }],
  ['kraft', '/kraft.html', null],
  ['kraft-verlauf', '/kraft.html', p => p.click('[data-tab="hist"]')],
  ['kraft-uebungen', '/kraft.html', p => p.click('[data-tab="ex"]')],
  ['kraft-graph', '/kraft.html', async p => { await p.click('[data-tab="ex"]'); await p.click('[data-ex="bench"]'); }],
  ['kraft-workout', '/kraft.html', async p => { await p.click('[data-again]'); }],
  ['kraft-ende', '/kraft.html', async p => { await p.click('[data-again]'); await p.click('.kex[data-i="0"] [data-chk="0"]'); await p.click('#kFin'); }],
  ['rollentrainer', '/pure.html', null],
];
const DESK = [ // the main app with its top bar (account pill, tabs) on tablet, laptop and TV widths
  ['app-strecken', '/?desktop&noprofile', null],
  ['app-training', '/?desktop&noprofile&view=training', null],
  ['app-fahrten', '/?desktop&noprofile&view=history', null],
  ['app-einstellungen', '/?desktop&noprofile&view=settings', null],
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
      else if (gt < -1 || gb < -1) { bad.push(`ragt oben/unten raus: „${txt.slice(0, 40)}“ in ${name(box)}`); seen.add(key); }
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
    for (const [nm, url, act] of list) for (const safari of [false, true]) {
      const p = await c.newPage(); p.setDefaultTimeout(4000);
      if (!mobile) await p.route('**/api/account/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })); // signed in: the pill shows the long name
      const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.goto(BASE + '/handy.html'); await p.evaluate(async () => { const { db } = await import('/js/db.js'); await db.kvDel('outdoorDraft'); await db.kvDel('kraftDraft'); }); // each screen starts clean
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
