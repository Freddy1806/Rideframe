// 23.11.8: contact sheets of every watch screen (tools/watch-scenes.mjs), drawn by js/watchscreens.js on a js/watchdc.js Dc in headless
// Chromium, at most 12 screens per sheet, labelled. With the device fonts (GARMIN_FONTS = a folder with RobotoCondensed-Bold.ttf,
// Bionic_semibold.ttf, Roboto-Regular.ttf: loaded only here, never shipped) the texts look as on the watch; without them the preview's
// look-alike font is used. Red frames: the text boxes of the layout check's findings (tools/watch-layout.mjs).
// Usage: NODE_PATH=$(npm root -g) node tools/watch-sheets.cjs <out dir> [device] [font scale] [scene ids, comma separated]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.join(__dirname, '..'), OUT = process.argv[2] || 'sheets', DEVICE = process.argv[3] || 'fenix8solar47mm', SCALE = +(process.argv[4] || 1), ONLY = process.argv[5] ? process.argv[5].split(',') : null;
const GF = process.env.GARMIN_FONTS || '';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.html': 'text/html' };
const FONTS = [['RFW RCB', 'RobotoCondensed-Bold.ttf'], ['RFW Bionic', 'Bionic_semibold.ttf'], ['RFW Roboto', 'Roboto-Regular.ttf']];
const real = GF && FONTS.every(([, f]) => fs.existsSync(path.join(GF, f)));
const PAGE = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Archivo'; src: url(/fonts/archivo-latin.woff2) format('woff2'); font-weight: 100 900; font-stretch: 62% 125%; }
${real ? FONTS.map(([n, f]) => `@font-face { font-family: '${n}'; src: url(/__gf/${f}); }`).join('\n') : ''}
body { margin: 0; background: #111; }</style><body><script type="module">
import { Dc } from '/js/watchdc.js'; import { screen, palette } from '/js/watchscreens.js'; import { SCENES, NOW } from '/tools/watch-scenes.mjs'; import { check } from '/tools/watch-layout.mjs';
window.sheet = async (dev, k, ids, per) => {
  await document.fonts.load('700 20px "RFW RCB"'); await document.fonts.load('600 20px "RFW Bionic"'); await document.fonts.load('400 20px "RFW Roboto"'); await document.fonts.load('700 20px Archivo'); await document.fonts.ready;
  const list = SCENES.filter(s => !ids || ids.includes(s[0])), out = [];
  for (let p = 0; p < list.length; p += per) {
    const part = list.slice(p, p + per), cols = 4, rows = Math.ceil(part.length / cols), Z = 1.5, S0 = (await import('/js/watchfontdata.js')).DEV[dev].S, cw = Math.round(S0 * Z) + 24, ch = Math.round(S0 * Z) + 64;
    const cv = document.createElement('canvas'); cv.width = cols * cw; cv.height = rows * ch + 40; const g = cv.getContext('2d');
    g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#ddd'; g.font = '600 18px system-ui'; g.fillText(dev + ' · font scale ' + k + ' · ${real ? 'device fonts' : 'preview font'}' + ' · sheet ' + (p / per + 1), 12, 26);
    part.forEach((sc, i) => {
      const o = sc[2](), c = document.createElement('canvas'); c.width = c.height = S0; const cg = c.getContext('2d');
      const dc = new Dc({ dev, scale: k, g: cg }); cg.save(); cg.beginPath(); cg.arc(S0 / 2, S0 / 2, S0 / 2, 0, Math.PI * 2); cg.clip();
      screen(dc, o.F, palette(dev.startsWith('fr265')), o.now ?? NOW, o.sum ?? null, { hasTouch: true, ...(o.ui || {}) }); cg.restore();
      const bad = check(dc), x = (i % cols) * cw + 12, y = Math.floor(i / cols) * ch + 40;
      g.fillStyle = '#000'; g.fillRect(x, y, S0 * Z, S0 * Z); g.imageSmoothingEnabled = false; g.drawImage(c, x, y, S0 * Z, S0 * Z);
      g.strokeStyle = '#444'; g.beginPath(); g.arc(x + S0 * Z / 2, y + S0 * Z / 2, S0 * Z / 2, 0, Math.PI * 2); g.stroke();
      const hot = new Set(bad.map(b => b.msg.match(/"([^"]*)"/)?.[1]).filter(Boolean));
      g.strokeStyle = '#ff2d2d'; g.lineWidth = 1; for (const t of dc.texts) if ([...hot].some(h => h.replace(/…$/, '') && t.t.startsWith(h.replace(/…$/, '')))) g.strokeRect(x + t.x0 * Z, y + t.iy0 * Z, (t.x1 - t.x0) * Z, (t.iy1 - t.iy0) * Z);
      g.fillStyle = bad.length ? '#ff6b6b' : '#9be39b'; g.font = '600 15px system-ui'; g.fillText(sc[0] + (bad.length ? '  (' + bad.length + ' findings)' : ''), x, y + S0 * Z + 20);
      g.fillStyle = '#aaa'; g.font = '13px system-ui'; g.fillText(sc[1].slice(0, 52), x, y + S0 * Z + 40);
    });
    out.push(cv.toDataURL('image/png'));
  }
  return out;
};
window.ready = true;
</script>`;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(), p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route('http://rf.test/**', async r => {
    const u = new URL(r.request().url()).pathname;
    if (u === '/sheet.html') return r.fulfill({ body: PAGE, contentType: 'text/html' });
    if (u.startsWith('/__gf/') && real) return r.fulfill({ body: fs.readFileSync(path.join(GF, path.basename(u))), contentType: 'font/ttf' });
    const f = path.join(ROOT, path.normalize(u)); if (!f.startsWith(ROOT) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  await p.goto('http://rf.test/sheet.html'); await p.waitForFunction(() => window.ready, null, { timeout: 10000 }).catch(() => {});
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  const urls = await p.evaluate(([d, k, ids]) => window.sheet(d, k, ids, 12), [DEVICE, SCALE, ONLY]);
  urls.forEach((u, i) => { const f = path.join(OUT, `${DEVICE}_x${SCALE}_${String(i + 1).padStart(2, '0')}.png`); fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')); console.log(f); });
  if (errs.length) console.error(errs.join('\n'));
  await b.close();
})();
