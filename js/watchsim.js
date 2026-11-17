// watch.html: design preview of RIDEFRAME Strength on a Garmin watch (17.11.). Two faces run the same js/watchflow.js:
// Forerunner 265 (416 px AMOLED) and fenix 7X Pro (280 px MIP, 64 colours: every pixel is snapped to the palette).
// Drawn like the watch draws (dc.fillCircle / drawText / drawArc in garmin/source/Draw.mc), driven by the five buttons,
// touch (tap, swipe) or the keyboard, with demo data or against the real API (tools/watch-api.mjs) after pairing.
import { newFlow, handle, SCR, curEx, setNo, restLeft, clock, sent, paired, setSetup } from './watchflow.js';
import { MODES } from './theme.js';

const $ = s => document.querySelector(s), LS = window.localStorage;
const store = { get: (k, d) => { try { const v = LS.getItem('rf_watch_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { v == null ? LS.removeItem('rf_watch_' + k) : LS.setItem('rf_watch_' + k, JSON.stringify(v)); } catch {} } };
const now = () => Date.now() / 1000;

/* ---- the two faces: colours per screen technology ---- */
const ACC = MODES.kraft.color; // strength pink
const FACES = [
  { id: 'fr265', name: 'Forerunner 265', sub: '416 × 416 AMOLED', S: 416, mip: false, C: { bg: '#000000', fg: '#f4f4ef', dim: '#8b8b85', faint: '#2c2c2a', acc: ACC, ink: '#0b0b0b', hr: '#ff5a5a' } },
  { id: 'fenix7xpro', name: 'fenix 7X Pro', sub: '280 × 280 MIP · 64 colours', S: 280, mip: true, C: { bg: '#000000', fg: '#ffffff', dim: '#aaaaaa', faint: '#555555', acc: '#ff55aa', ink: '#000000', hr: '#ff5555' } },
];

/* ---- demo data: what GET /api/watch/strength/setup and /summary answer ---- */
const DEMO = { v: 1, unit: 'kg', rest: 90, last: { at: Math.round(now() - 2 * 86400), sets: 18, n: 'Push day' }, ex: [
  { id: 'bench', n: 'Bench press', t: 'w', s: [[80, 8], [80, 8], [80, 7]], b: 104.5 }, { id: 'squat', n: 'Squat', t: 'w', s: [[100, 5], [100, 5], [100, 5]], b: 120 },
  { id: 'pull', n: 'Pull-ups', t: 'bw', s: [[0, 10], [0, 9]], b: 12 }, { id: 'ohp', n: 'Overhead press', t: 'w', s: [[47.5, 6]], b: 58 },
  { id: 'row', n: 'Barbell row', t: 'w', s: [[70, 8]], b: 86 }, { id: 'dead', n: 'Deadlift', t: 'w', s: [[140, 3]], b: 158 },
  { id: 'dip', n: 'Dips', t: 'bw', s: [[0, 12]], b: 15 }, { id: 'lat', n: 'Lat pulldown', t: 'w', s: [[60, 10]], b: 80 },
  { id: 'legpress', n: 'Leg press', t: 'w' }, { id: 'curl', n: 'Biceps curls', t: 'w', s: [[14, 10]], b: 18.7 }, { id: 'my_thai', n: 'Thai kicks on bag', t: 'bw' } ] };
const DEMO_SUM = { pts: 245, prev: 233, delta: 12, sessions: 4, strength: 2, streak: 3 };

/* ---- app state around the flow: mode, token, queue, phone nearby ---- */
let mode = store.get('mode', 'demo'), token = store.get('token', null), who = store.get('name', ''), F, sum = null, near = true, net = '', light = false;
const live = () => mode === 'live';
function boot() {
  const q = live() ? store.get('queue', []) : [];
  F = live() ? newFlow(token ? store.get('setup', null) : null, { paired: !!token, queue: q }) : newFlow(structuredClone(DEMO), { queue: [] });
  sum = live() ? store.get('summary', null) : DEMO_SUM; net = '';
  if (live() && token) { refresh(); push(); }
  window.__watch = { get F() { return F; }, get mode() { return mode; }, get net() { return net; } };
  panel(); paint();
}
async function api(method, path, body) {
  const r = await fetch('/api/watch/' + path, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j };
}
async function refresh() { // setup + summary, kept for the next start (the watch keeps them in Application.Storage)
  if (!near) return;
  try { const s = await api('GET', 'strength/setup'); if (s.status === 401) return unpair('This watch was removed on the phone.'); if (s.ok) { setSetup(F, s.j); store.set('setup', s.j); }
    const g = await api('GET', 'summary'); if (g.ok) { sum = g.j; store.set('summary', sum); } } catch {}
  paint();
}
let pushing = false;
async function push() { // the queue, oldest first; kept on any network trouble, dropped only when the server refuses a session for good
  if (pushing) return; pushing = true;
  try {
    for (const s of F.queue.slice()) {
      if (!near) { sent(F, s.id, 'retry'); continue; }
      if (!live()) { await new Promise(r => setTimeout(r, 500)); sent(F, s.id, 'ok'); continue; }
      let res = 'retry';
      try { const r = await api('POST', 'strength', s); res = r.ok ? 'ok' : r.status === 400 || r.status === 413 ? 'drop' : 'retry'; if (r.status === 401) { unpair('This watch was removed on the phone.'); break; } } catch {}
      sent(F, s.id, res);
    }
  } finally { pushing = false; if (live()) store.set('queue', F.queue); panel(); paint(); }
  if (live() && near && F.sets.length === 0) refresh();
}
function unpair(t) { token = null; store.set('token', null); net = t || ''; F.paired = false; F.scr = SCR.PAIR; panel(); paint(); }
function drain() {
  const cues = F.cues.splice(0), out = F.out.splice(0);
  if (cues.length) buzz(cues[cues.length - 1]);
  for (const o of out) {
    if (o.k === 'send') push();
    else if (o.k === 'setup') { if (live()) refresh(); else { setSetup(F, structuredClone(DEMO)); } }
    else if (o.k === 'exit') F.scr = SCR.GLANCE;
    else if (o.k === 'pair') pairNow(o.code);
  }
  if (live()) store.set('queue', F.queue);
  panel();
}
async function pairNow(code) {
  if (!live()) { mode = 'live'; store.set('mode', mode); }
  if (!near) { net = 'No phone nearby.'; paired(F, false); return paint(); }
  try { const r = await api('POST', 'pair', { code, label: 'Preview (browser)' });
    if (r.ok) { token = r.j.token; who = r.j.name; store.set('token', token); store.set('name', who); net = ''; paired(F, true, null); drain(); refresh(); }
    else { net = r.j.error || 'Pairing failed.'; paired(F, false); }
  } catch { net = 'Server not reachable.'; paired(F, false); }
  panel(); paint();
}
const ev = (e, arg) => { handle(F, e, now(), arg); drain(); paint(); };

/* ---- drawing: one function per screen, in watch pixels; the same numbers as Draw.mc ---- */
function fit(g, t, max, px, w = 800) { let p = px; g.font = `${w} ${p}px Archivo, system-ui, sans-serif`; while (g.measureText(t).width > max && p > px * .62) { p -= 1; g.font = `${w} ${p}px Archivo, system-ui, sans-serif`; }
  if (g.measureText(t).width <= max) return t; let s = t; while (s.length > 1 && g.measureText(s + '.').width > max) s = s.slice(0, -1); return s.trim() + '.'; }
function txt(g, t, x, y, px, col, o = {}) { const w = o.w || 800; t = String(t); if (o.max) t = fit(g, t, o.max, px, w); else g.font = `${w} ${px}px Archivo, system-ui, sans-serif`;
  g.fillStyle = col; g.textAlign = o.al || 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y); return g.measureText(t).width; }
const pill = (g, x, y, w, h, col, fill = true) => { g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, h / 2); if (fill) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.lineWidth = 2; g.stroke(); } };
const arc = (g, cx, cy, r, a0, a1, col, lw) => { g.beginPath(); g.arc(cx, cy, r, a0, a1); g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'butt'; g.stroke(); };
const DEG = Math.PI / 180;
function startHint(g, S, C) { arc(g, S / 2, S / 2, S / 2 - S * .02, -30 * DEG - 12 * DEG, -30 * DEG + 12 * DEG, C.acc, S * .03); } // points at the START button (2 o'clock)
function tri(g, x, y, s, up, col) { g.beginPath(); g.moveTo(x - s, up ? y + s * .6 : y - s * .6); g.lineTo(x + s, up ? y + s * .6 : y - s * .6); g.lineTo(x, up ? y - s * .6 : y + s * .6); g.closePath(); g.fillStyle = col; g.fill(); }
function dumbbell(g, x, y, s, col) { g.strokeStyle = col; g.lineWidth = s * .13; g.lineCap = 'round'; g.beginPath(); const p = (a, b, c, d) => { g.moveTo(x + (a - 12) * s / 24, y + (b - 12) * s / 24); g.lineTo(x + (c - 12) * s / 24, y + (d - 12) * s / 24); };
  p(3, 9, 3, 15); p(6, 7, 6, 17); p(18, 7, 18, 17); p(21, 9, 21, 15); p(6, 12, 18, 12); g.stroke(); }
function heart(g, x, y, s, col) { g.fillStyle = col; g.beginPath(); g.moveTo(x, y + s * .45); g.bezierCurveTo(x - s * .9, y - s * .1, x - s * .45, y - s * .75, x, y - s * .3); g.bezierCurveTo(x + s * .45, y - s * .75, x + s * .9, y - s * .1, x, y + s * .45); g.fill(); }
const kgTxt = kg => (Math.round(kg * 10) / 10).toString();
const volTxt = v => v >= 10000 ? (Math.round(v / 100) / 10) + ' t' : Math.round(v).toLocaleString('en-GB');
const ago = t => { const d = Math.floor((now() - t) / 86400); return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : new Date(t * 1000).toLocaleDateString('en-GB', { weekday: 'short' }); };

const DRAW = {
  [SCR.START](g, S, C) {
    const L = F.setup.last; startHint(g, S, C);
    let w = txt(g, 'RIDE', 0, -99, S * .055, C.fg, { w: 900 }); const w2 = g.measureText('FRAME').width, x0 = S / 2 - (w + w2) / 2;
    txt(g, 'RIDE', x0, S * .2, S * .055, C.fg, { al: 'left', w: 900 }); txt(g, 'FRAME', x0 + w, S * .2, S * .055, C.acc, { al: 'left', w: 900 });
    dumbbell(g, S / 2, S * .31, S * .1, C.acc);
    txt(g, 'Strength', S / 2, S * .44, S * .13, C.fg, { w: 900, max: S * .8 });
    txt(g, L ? `${ago(L.at)}, ${L.sets} sets` : F.setup.ex.length ? 'First session' : 'Loading', S / 2, S * .56, S * .06, C.dim, { w: 600, max: S * .7 });
    if (sum && sum.pts != null) { const t = `${Math.round(sum.pts)} pts`, d = sum.delta || 0; const tw = txt(g, t, 0, -99, S * .058, C.fg, { w: 700 });
      txt(g, t, S / 2 - S * .04, S * .66, S * .058, C.fg, { w: 700 }); if (d) { tri(g, S / 2 + tw / 2 + S * .01, S * .66, S * .018, d > 0, C.acc); txt(g, Math.abs(Math.round(d)), S / 2 + tw / 2 + S * .035, S * .66, S * .05, C.acc, { al: 'left', w: 700 }); } }
    pill(g, S / 2, S * .81, S * .42, S * .13, C.acc); txt(g, 'START', S / 2, S * .812, S * .062, C.ink, { w: 900 });
  },
  [SCR.PICK](g, S, C) { list(g, S, C, F.setup.ex.map(e => e.n), F.sel, 'EXERCISE', i => { const e = F.setup.ex[i]; return e.s ? `${e.t === 'bw' && !e.s[0][0] ? 'BW' : kgTxt(e.s[0][0]) + ' kg'} × ${e.s[0][1]}` : 'New'; }); },
  [SCR.MENU](g, S, C) { list(g, S, C, F.menu, F.sel, 'MENU', null, true); },
  [SCR.SET](g, S, C) {
    const e = curEx(F); startHint(g, S, C);
    txt(g, clock(now() - F.start), S / 2, S * .12, S * .048, C.dim, { w: 700 });
    txt(g, e.n, S / 2, S * .22, S * .08, C.fg, { w: 800, max: S * .74 });
    txt(g, 'SET ' + setNo(F), S / 2, S * .315, S * .055, C.acc, { w: 900 });
    const bw = e.t === 'bw', val = [bw && !F.kg ? 'BW' : kgTxt(F.kg), String(F.reps)], unit = [bw ? '+kg' : 'kg', 'reps'], xs = [S * .285, S * .735];
    txt(g, '×', S * .515, S * .5, S * .08, C.dim, { w: 600 });
    for (const i of [0, 1]) { const on = F.focus === i; txt(g, val[i], xs[i], S * .5, S * .21, on ? C.acc : C.fg, { w: 900, max: i ? S * .27 : S * .32 });
      if (on) { g.fillStyle = C.acc; g.fillRect(xs[i] - S * .12, S * .615, S * .24, S * .016); } txt(g, unit[i], xs[i], S * .665, S * .048, on ? C.fg : C.dim, { w: 700 }); }
    pill(g, S / 2, S * .815, S * .4, S * .12, C.acc); txt(g, 'DONE', S / 2, S * .817, S * .062, C.ink, { w: 900 });
  },
  [SCR.REST](g, S, C) {
    const left = restLeft(F, now()), part = F.restLen ? Math.max(0, Math.min(1, (F.restEnd - now()) / F.restLen)) : 0, r = S / 2 - S * .04, e = curEx(F);
    arc(g, S / 2, S / 2, r, 0, Math.PI * 2, C.faint, S * .05); if (part > 0) arc(g, S / 2, S / 2, r, -Math.PI / 2, -Math.PI / 2 + part * Math.PI * 2, C.acc, S * .05);
    heart(g, S / 2 - S * .08, S * .27, S * .05, C.hr); txt(g, F.hr || '--', S / 2 - S * .03, S * .27, S * .065, C.fg, { al: 'left', w: 800 });
    txt(g, clock(left), S / 2, S * .46, S * .23, left <= 5 ? C.acc : C.fg, { w: 900 });
    txt(g, 'NEXT', S / 2, S * .625, S * .042, C.dim, { w: 800 });
    txt(g, `Set ${setNo(F)}: ${e.n}`, S / 2, S * .7, S * .058, C.fg, { w: 700, max: S * .66 });
    txt(g, 'SKIP', S / 2, S * .82, S * .05, C.acc, { w: 900 });
  },
  [SCR.SUM](g, S, C) {
    const s = F.sum || { dur: 0, sets: 0, vol: 0, exs: 0, st: 'saved' };
    if (s.st === 'saved') txt(g, '✓ SAVED', S / 2, S * .17, S * .058, C.acc, { w: 900 });
    else if (s.st === 'sending') txt(g, 'SENDING', S / 2, S * .17, S * .055, C.dim, { w: 900 });
    else if (s.st === 'failed') txt(g, 'NOT SAVED', S / 2, S * .17, S * .055, C.acc, { w: 900 });
    else { txt(g, 'Will send when', S / 2, S * .14, S * .048, C.fg, { w: 700 }); txt(g, 'the phone is near', S / 2, S * .2, S * .048, C.fg, { w: 700 }); }
    txt(g, clock(s.dur), S / 2, S * .36, S * .16, C.fg, { w: 900 }); txt(g, 'TIME', S / 2, S * .46, S * .042, C.dim, { w: 800 });
    const col = [[s.sets, 'SETS'], [volTxt(s.vol), 'KG'], [s.exs, 'LIFTS']];
    col.forEach(([v, l], i) => { const x = S * (.27 + i * .23); txt(g, v, x, S * .6, S * .085, C.fg, { w: 900, max: S * .22 }); txt(g, l, x, S * .68, S * .04, C.dim, { w: 800 }); });
    if (s.prs) txt(g, `${s.prs} PR`, S / 2, S * .78, S * .055, C.acc, { w: 900 });
    txt(g, 'DONE', S / 2, S * .87, S * .05, C.dim, { w: 900 });
  },
  [SCR.PAIR](g, S, C) {
    const P = F.pair, bw = S * .1, gap = S * .018, x0 = S / 2 - (6 * bw + 5 * gap) / 2 + bw / 2;
    txt(g, 'PAIR', S / 2, S * .19, S * .065, C.acc, { w: 900 });
    txt(g, 'Code from the phone', S / 2, S * .28, S * .05, C.fg, { w: 700, max: S * .72 });
    P.d.forEach((d, i) => { const x = x0 + i * (bw + gap), on = i === P.i;
      g.beginPath(); g.roundRect(x - bw / 2, S * .5 - bw * .7, bw, bw * 1.4, S * .015); if (on) { g.fillStyle = C.acc; g.fill(); } else { g.strokeStyle = C.faint; g.lineWidth = 2; g.stroke(); }
      txt(g, d, x, S * .505, S * .09, on ? C.ink : i < P.i ? C.fg : C.dim, { w: 900 });
      if (on) { tri(g, x, S * .375, S * .022, true, C.acc); tri(g, x, S * .625, S * .022, false, C.acc); } });
    const st = P.st === 'sending' ? 'Pairing' : P.st === 'fail' ? 'Wrong code' : P.i === 5 ? 'START: pair' : 'START: next';
    txt(g, st, S / 2, S * .72, S * .055, P.st === 'fail' ? C.acc : C.dim, { w: 800 });
    txt(g, 'Phone: Settings > Devices', S / 2, S * .82, S * .042, C.dim, { w: 600, max: S * .66 });
  },
  [SCR.GLANCE](g, S, C) { // the glance loop on the watch face: neighbours dimmed, ours in the middle
    const row = (y, h, a) => { g.beginPath(); g.roundRect(S * .08, y - h / 2, S * .84, h, S * .04); g.fillStyle = a; g.fill(); };
    row(S * .17, S * .14, C.faint); row(S * .83, S * .14, C.faint);
    txt(g, 'Heart rate', S * .22, S * .17, S * .045, C.dim, { al: 'left', w: 600 }); txt(g, 'Calendar', S * .22, S * .83, S * .045, C.dim, { al: 'left', w: 600 });
    g.beginPath(); g.arc(S * .2, S * .5, S * .085, 0, Math.PI * 2); g.fillStyle = C.acc; g.fill(); dumbbell(g, S * .2, S * .5, S * .1, C.ink);
    txt(g, 'RIDEFRAME', S * .33, S * .39, S * .045, C.dim, { al: 'left', w: 800 });
    const p = sum && sum.pts != null ? Math.round(sum.pts) : '--'; const w = txt(g, p, S * .33, S * .5, S * .13, C.fg, { al: 'left', w: 900 }); txt(g, 'pts', S * .33 + w + S * .02, S * .53, S * .05, C.dim, { al: 'left', w: 700 });
    if (sum && sum.delta != null) { const d = Math.round(sum.delta); tri(g, S * .35, S * .615, S * .02, d >= 0, C.acc); txt(g, `${Math.abs(d)} vs last week`, S * .385, S * .615, S * .045, C.acc, { al: 'left', w: 700, max: S * .5 }); }
  },
};
function list(g, S, C, items, sel, title, sub, menu = false) {
  const n = items.length; txt(g, title, S / 2, S * .13, S * .045, C.dim, { w: 900 }); if (!n) return txt(g, 'Nothing yet', S / 2, S / 2, S * .07, C.dim);
  if (!menu) txt(g, `${sel + 1}/${n}`, S / 2, S * .185, S * .04, C.faint === '#555555' ? C.dim : C.dim, { w: 600 });
  const rows = menu ? [[-1, .33, .07], [0, .5, .085], [1, .67, .07]] : [[-2, .24, .05], [-1, .345, .065], [0, .5, .095], [1, .7, .065], [2, .8, .05]];
  for (const [o, y, px] of rows) { const i = sel + o; if (i < 0 || i >= n) continue; const on = !o;
    if (on && menu) { pill(g, S / 2, S * y, S * .78, S * .14, C.acc); txt(g, items[i], S / 2, S * y + 1, S * px, C.ink, { w: 900, max: S * .7 }); continue; }
    if (on) { g.fillStyle = C.acc; g.fillRect(S * .1, S * (y - .055), S * .012, S * .11); }
    txt(g, items[i], S / 2, S * y, S * px, on ? C.fg : Math.abs(o) > 1 ? C.faint : C.dim, { w: on ? 900 : 700, max: S * (Math.abs(o) > 1 ? .55 : .74) });
    if (on && sub) txt(g, sub(i), S / 2, S * (y + .085), S * .055, C.acc, { w: 800 }); }
  if (n > 1) { const a0 = 150 * DEG, span = 60 * DEG; arc(g, S / 2, S / 2, S / 2 - S * .03, a0, a0 + span, C.faint, S * .012); const p = sel / (n - 1);
    arc(g, S / 2, S / 2, S / 2 - S * .03, a0 + span - p * span * .85 - span * .15, a0 + span - p * span * .85, C.acc, S * .012); }
  startHint(g, S, C);
}
function prFlash(g, S, C) {
  const f = F.flash; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.fillStyle = C.acc; g.fill();
  txt(g, 'NEW RECORD', S / 2, S * .27, S * .06, C.ink, { w: 900 }); txt(g, 'PR', S / 2, S * .5, S * .3, C.ink, { w: 900 });
  txt(g, f.t === 'bw' ? `${f.reps} reps` : `${kgTxt(f.kg)} × ${f.reps}`, S / 2, S * .72, S * .085, C.ink, { w: 900 });
}

/* ---- faces on the page: bezel, five buttons, touch ---- */
const BTN = [['light', 'LIGHT', 300], ['up', 'UP', 262], ['down', 'DOWN', 218], ['start', 'START', 60], ['back', 'BACK', 120]];
const views = [];
function mount() {
  const host = $('#faces');
  for (const f of FACES) {
    const fig = document.createElement('figure'); fig.className = `wface ${f.mip ? 'mip' : 'amoled'}`; fig.dataset.face = f.id; fig.style.setProperty('--S', f.S + 'px');
    fig.innerHTML = `<div class="wscale"><div class="wbody">${BTN.map(([k, l, a]) => `<button class="wbtn ${k}" data-k="${k}" style="--a:${a}deg" aria-label="${l}"><i></i><span>${l}</span></button>`).join('')}
      <div class="wbezel">${f.mip ? '<b></b><b></b><b></b><b></b>' : ''}<canvas width="${f.S}" height="${f.S}" aria-label="${f.name} screen"></canvas><div class="wbuzz"></div></div></div></div>
      <figcaption><b>${f.name}</b><span>${f.sub}</span></figcaption>`;
    host.append(fig);
    const cv = fig.querySelector('canvas'), dpr = f.mip ? 1 : Math.min(3, window.devicePixelRatio || 1);
    cv.width = cv.height = f.S * dpr; const g = cv.getContext('2d'); views.push({ f, fig, cv, g, dpr });
    fig.querySelectorAll('.wbtn').forEach(b => holdable(b, b.dataset.k));
    touch(cv, f);
  }
  scale(); window.addEventListener('resize', scale);
}
function scale() { // phones: the watch shrinks to fit (the buttons stay clickable, taps are mapped back to watch pixels)
  for (const v of views) { const room = Math.min(document.documentElement.clientWidth - 32, 900), need = v.f.S + 170, k = Math.min(1, room / need); v.fig.style.setProperty('--k', k); }
}
function holdable(el, k) { // UP / DOWN: short = one step, held = big steps every 350 ms; BACK held = menu
  let t = 0, rep = 0, held = false;
  const down = e => { e.preventDefault(); el.classList.add('on'); held = false; clearTimeout(t); clearInterval(rep);
    if (k === 'up' || k === 'down') t = setTimeout(() => { held = true; ev(k + 'Hold'); rep = setInterval(() => ev(k + 'Hold'), 350); }, 500);
    if (k === 'back') t = setTimeout(() => { held = true; ev('menu'); }, 700); };
  const up = e => { if (!el.classList.contains('on')) return; el.classList.remove('on'); clearTimeout(t); clearInterval(rep); if (held) return;
    if (k === 'light') { light = !light; paint(); return; } ev(k); };
  el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', () => { if (el.classList.contains('on')) { el.classList.remove('on'); clearTimeout(t); clearInterval(rep); } });
  el.addEventListener('contextmenu', e => e.preventDefault());
}
function touch(cv, f) {
  let p0 = null;
  cv.addEventListener('pointerdown', e => { p0 = { x: e.clientX, y: e.clientY }; cv.setPointerCapture?.(e.pointerId); });
  cv.addEventListener('pointerup', e => {
    if (!p0) return; const r = cv.getBoundingClientRect(), k = f.S / r.width, dx = (e.clientX - p0.x) * k, dy = (e.clientY - p0.y) * k; p0 = null;
    if (Math.hypot(dx, dy) > f.S * .08) return ev(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'swipeLeft' : 'swipeRight') : (dy < 0 ? 'swipeUp' : 'swipeDown'));
    tapAt((e.clientX - r.left) * k / f.S, (e.clientY - r.top) * k / f.S);
  });
}
/** a tap in face coordinates (0..1) -> the flow's event; the same table is in garmin/source/Delegates.mc onTap */
function tapAt(u, v) {
  const s = F.scr;
  if (F.flash) return ev('tap');
  if (s === SCR.SET) { if (v > .72 && Math.abs(u - .5) < .24) return ev('start'); if (v > .36 && v < .72) return ev('focus', u < .51 ? 0 : 1); return; }
  if (s === SCR.PICK || s === SCR.MENU) { const rows = s === SCR.MENU ? [[-1, .33], [0, .5], [1, .67]] : [[-2, .24], [-1, .345], [0, .5], [1, .7], [2, .8]];
    const [o] = rows.reduce((a, r) => Math.abs(r[1] - v) < Math.abs(a[1] - v) ? r : a); const n = s === SCR.MENU ? F.menu.length : F.setup.ex.length, i = F.sel + o;
    if (i >= 0 && i < n) ev('item', i); return; }
  if (s === SCR.PAIR) { if (v > .4 && v < .6 && u > .13 && u < .87) return ev('focus', Math.min(5, Math.max(0, Math.floor((u - .146) / .118)))); return ev('tap'); }
  ev('tap');
}
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'start', ' ': 'start', Escape: 'back', Backspace: 'back' };
function keys() {
  const st = {};
  addEventListener('keydown', e => { if (e.target.closest?.('input, textarea, select')) return; const k = KEYS[e.key]; if (e.key === 'ArrowLeft') { e.preventDefault(); return ev('swipeLeft'); } if (e.key === 'ArrowRight') { e.preventDefault(); return ev('swipeRight'); }
    if (e.key === 'm') return ev('menu'); if (!k) return; e.preventDefault(); if (e.repeat) return;
    st[k] = { at: Date.now(), held: false, t: setTimeout(function hold() { st[k].held = true; if (k === 'back') return ev('menu'); if (k === 'up' || k === 'down') { ev(k + 'Hold'); st[k].t = setTimeout(hold, 350); } }, k === 'back' ? 700 : 500) }; });
  addEventListener('keyup', e => { const k = KEYS[e.key]; if (!k || !st[k]) return; clearTimeout(st[k].t); const h = st[k].held; delete st[k]; if (!h) ev(k); });
}

/* ---- vibration shown on the page: the watch shakes, a ring pulses ---- */
let buzzT = 0;
function buzz(kind) { for (const v of views) { v.fig.classList.remove('buzz', 'long'); void v.fig.offsetWidth; v.fig.classList.add('buzz'); if (kind === 'pr' || kind === 'rest') v.fig.classList.add('long'); }
  clearTimeout(buzzT); buzzT = setTimeout(() => views.forEach(v => v.fig.classList.remove('buzz', 'long')), 1200); const b = $('#wCue'); if (b) { b.textContent = { set: 'Vibration: short (set saved)', pr: 'Vibration: long double (record)', rest: 'Vibration: triple (rest over)', done: 'Vibration: long (finished)', error: 'Vibration: short double (no reps)' }[kind] || ''; } }

/* ---- 64-colour MIP: every pixel snapped to the palette (channels 00 / 55 / AA / FF), no soft edges, no transparency ---- */
function snap64(g, S) { const im = g.getImageData(0, 0, S, S), d = im.data; for (let i = 0; i < d.length; i += 4) { d[i] = Math.round(d[i] / 85) * 85; d[i + 1] = Math.round(d[i + 1] / 85) * 85; d[i + 2] = Math.round(d[i + 2] / 85) * 85; d[i + 3] = 255; } g.putImageData(im, 0, 0); }
function paint() {
  for (const { f, g, dpr } of views) {
    const S = f.S, C = f.C; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = C.bg; g.fillRect(0, 0, S, S);
    g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.clip();
    (DRAW[F.scr] || DRAW[SCR.START])(g, S, C); if (F.flash) prFlash(g, S, C);
    g.restore();
    if (f.mip) { if (light) { g.globalCompositeOperation = 'lighter'; g.fillStyle = '#003355'; g.fillRect(0, 0, S, S); g.globalCompositeOperation = 'source-over'; } snap64(g, S); }
  }
  const s = $('#wScr'); if (s) s.textContent = F.scr;
}

/* ---- the panel next to the faces ---- */
function panel() {
  const p = $('#wPanel'); if (!p) return;
  const q = F.queue.length;
  p.querySelector('#wMode').innerHTML = [['demo', 'Demo data'], ['live', 'My account']].map(([k, l]) => `<button data-mode="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('');
  p.querySelector('#wState').textContent = live() ? (token ? `Paired${who ? ' with ' + who : ''}. Sessions go to this account.` : 'Not paired. On the phone: Settings, Devices, Garmin watch, Pair a watch. Enter the code here on the watch.') : 'Demo data. Nothing is sent.';
  p.querySelector('#wNet').textContent = [net, q ? `${q} ${q === 1 ? 'session waits' : 'sessions wait'} for the phone.` : ''].filter(Boolean).join(' ');
  p.querySelector('#wUnpair').hidden = !(live() && token);
  p.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (mode === b.dataset.mode) return; mode = b.dataset.mode; store.set('mode', mode); boot(); });
}
function wirePanel() {
  $('#wNear').onchange = e => { near = e.target.checked; if (near && F.queue.length) push(); panel(); };
  $('#wGlance').onclick = () => { F.scr = SCR.GLANCE; paint(); };
  $('#wRestart').onclick = () => boot();
  $('#wUnpair').onclick = () => { if (confirm('Forget the pairing on this preview watch?')) unpair('Unpaired.'); };
}

mount(); keys(); wirePanel(); boot();
setInterval(() => { handle(F, 'tick', now()); drain(); paint(); }, 200);
setInterval(() => { const base = F.scr === SCR.REST ? 128 - Math.min(30, (now() - (F.restEnd - F.restLen)) * .5) : F.start ? 112 : 72; ev('hr', Math.round(base + Math.random() * 6)); }, 2000); // a simulated heart rate (Sensor on the watch)
setInterval(() => { if (F.queue.length && near) push(); }, 30e3); // retry, like the watch does on its timer
document.fonts?.ready.then(paint);
