// 27.11.7: Connect IQ Store screenshots from the JS twin (js/watchscreens.js on a js/watchdc.js Dc, as tools/watch-sheets.cjs draws them):
// the ten scenes of tools/watch-scenes.mjs STORE (plausible numbers) on the fenix 8 47 mm at font scale 1, each as the round screen on a
// black square, nothing else: NN_<scene>.png at the native 260 x 260 and NN_<scene>@3x.png drawn again at 3x (780 x 780, sharp text),
// plus store_overview.png (the ten 3x shots in a 5 x 2 grid on black). With GARMIN_FONTS (a folder with RobotoCondensed-Bold.ttf,
// Bionic_semibold.ttf, Roboto-Regular.ttf: loaded only here, never shipped or committed) the texts are the watch's; without them the
// preview's look-alike font. Fails when the layout check (tools/watch-layout.mjs) finds anything in a store scene.
// Usage: NODE_PATH=$(npm root -g) node tools/watch-storeshots.cjs <out dir>
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.join(__dirname, '..'), OUT = process.argv[2] || 'storeshots', DEVICE = 'fenix8solar47mm', SCALE = 1, X3 = 3, GAP = 12;
const GF = process.env.GARMIN_FONTS || '';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.html': 'text/html' };
const FONTS = [['RFW RCB', 'RobotoCondensed-Bold.ttf'], ['RFW Bionic', 'Bionic_semibold.ttf'], ['RFW Roboto', 'Roboto-Regular.ttf']];
const real = GF && FONTS.every(([, f]) => fs.existsSync(path.join(GF, f)));
const PAGE = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Archivo'; src: url(/fonts/archivo-latin.woff2) format('woff2'); font-weight: 100 900; font-stretch: 62% 125%; }
${real ? FONTS.map(([n, f]) => `@font-face { font-family: '${n}'; src: url(/__gf/${f}); }`).join('\n') : ''}
body { margin: 0; background: #000; }</style><body><script type="module">
import { Dc } from '/js/watchdc.js'; import { screen, palette } from '/js/watchscreens.js'; import { STORE, NOW } from '/tools/watch-scenes.mjs'; import { check } from '/tools/watch-layout.mjs';
window.shots = async (dev, k, z, gap) => {
  await document.fonts.load('700 20px "RFW RCB"'); await document.fonts.load('600 20px "RFW Bionic"'); await document.fonts.load('400 20px "RFW Roboto"'); await document.fonts.load('700 20px Archivo'); await document.fonts.ready;
  const S = (await import('/js/watchfontdata.js')).DEV[dev].S, out = [], big = [];
  // one scene drawn at zoom m: the screen clipped to its circle on a black square (the Dc measures in device pixels, the context is scaled)
  const draw = (sc, m) => {
    const o = sc[2](), c = document.createElement('canvas'); c.width = c.height = S * m; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.scale(m, m);
    const dc = new Dc({ dev, scale: k, g }); g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.clip();
    screen(dc, o.F, palette(dev.startsWith('fr265')), o.now ?? NOW, o.sum ?? null, { hasTouch: true, ...(o.ui || {}) }); g.restore();
    return { c, bad: check(dc) };
  };
  for (const sc of STORE) {
    const a = draw(sc, 1), b = draw(sc, z); big.push(b.c);
    out.push({ id: sc[0], label: sc[1], bad: a.bad.map(f => f.kind + ': ' + f.msg), x1: a.c.toDataURL('image/png'), x3: b.c.toDataURL('image/png') });
  }
  const cols = 5, rows = Math.ceil(big.length / cols), W = S * z, ov = document.createElement('canvas');
  ov.width = cols * W + (cols - 1) * gap; ov.height = rows * W + (rows - 1) * gap; const g = ov.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, ov.width, ov.height);
  big.forEach((c, i) => g.drawImage(c, (i % cols) * (W + gap), Math.floor(i / cols) * (W + gap)));
  return { S, shots: out, overview: ov.toDataURL('image/png') };
};
window.ready = true;
</script>`;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(), p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route('http://rf.test/**', async r => {
    const u = new URL(r.request().url()).pathname;
    if (u === '/shots.html') return r.fulfill({ body: PAGE, contentType: 'text/html' });
    if (u.startsWith('/__gf/') && real) return r.fulfill({ body: fs.readFileSync(path.join(GF, path.basename(u))), contentType: 'font/ttf' });
    const f = path.join(ROOT, path.normalize(u)); if (!f.startsWith(ROOT) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  await p.goto('http://rf.test/shots.html'); await p.waitForFunction(() => window.ready, null, { timeout: 10000 }).catch(() => {});
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  const res = await p.evaluate(([d, k, z, gap]) => window.shots(d, k, z, gap), [DEVICE, SCALE, X3, GAP]);
  const png = u => Buffer.from(u.split(',')[1], 'base64'); let bad = 0;
  res.shots.forEach((s, i) => {
    const n = String(i + 1).padStart(2, '0') + '_' + s.id;
    fs.writeFileSync(path.join(OUT, n + '.png'), png(s.x1)); fs.writeFileSync(path.join(OUT, n + '@3x.png'), png(s.x3));
    console.log(n + '  ' + s.label + (s.bad.length ? '\n  ' + s.bad.join('\n  ') : '')); bad += s.bad.length;
  });
  fs.writeFileSync(path.join(OUT, 'store_overview.png'), png(res.overview));
  console.log(`${DEVICE}, font scale ${SCALE}, ${real ? 'device fonts' : 'preview font (GARMIN_FONTS not set)'}, ${res.shots.length} x ${res.S} px + @3x, store_overview.png -> ${OUT}`);
  if (errs.length) console.error(errs.join('\n'));
  await b.close();
  if (bad || errs.length) process.exit(1);
})();
