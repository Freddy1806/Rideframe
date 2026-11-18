// Interval views (owner 17.11.): the ridden intervals on the ride summary with "Last time …" per set, and "Intervals over
// time" on Rides & Records (desktop) and the phone Stats page: pick a kind, the average ridden watts per session over time
// (one orange line; heart rate as its own small chart under it, same time axis, never a second y-axis), best and latest
// session and a table. HTML strings only; the numbers come from ivhistory.js.
import { sessions, compare } from './ivhistory.js';
import { workoutById } from './workouts.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const v = (x, u = '') => x > 0 ? `${x}${u}` : '–';
const mm = t => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const dshort = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dlong = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const wkg = x => x > 0 ? x.toFixed(2) : '–';
const opts = o => ({ workoutById, ...o });

/** the ridden intervals of one ride, set by set, each set with its comparison line (cmp = compare(), may be empty) */
export function ivSummaryHTML(rec, cmp = []) {
  const ivs = rec?.ivs || []; if (!ivs.some(x => x.kind)) return '';
  const groups = []; for (const iv of ivs) { const g = groups[groups.length - 1]; if (g && g.kind === (iv.kind || iv.name)) g.ivs.push(iv); else groups.push({ kind: iv.kind || iv.name, ivs: [iv] }); }
  const hasHr = ivs.some(x => x.hr > 0), hasCad = ivs.some(x => x.cad > 0);
  const head = `<tr><th>Interval</th><th>Time</th><th>Avg W</th><th class="ivx">Max W</th>${hasHr ? '<th>Avg HR</th><th class="ivx">Max HR</th>' : ''}${hasCad ? '<th class="ivx">rpm</th>' : ''}</tr>`;
  const rows = groups.map(g => { const c = cmp.find(x => x.kind === g.kind);
    return g.ivs.map(x => `<tr${x.part ? ' class="ivpart"' : ''}><td>${esc(x.name)}</td><td class="num">${mm(x.t)}</td><td class="num"><b>${v(x.w)}</b></td><td class="num ivx">${v(x.wMax)}</td>${hasHr ? `<td class="num">${v(x.hr)}</td><td class="num ivx">${v(x.hrMax)}</td>` : ''}${hasCad ? `<td class="num ivx">${v(x.cad)}</td>` : ''}</tr>`).join('')
      + (c ? `<tr class="ivcmprow"><td colspan="7"><div class="ivcmp${c.dw > 0 ? ' up' : c.dw < 0 ? ' down' : ''}" data-kind="${esc(c.kind)}"><span>${esc(c.label)}</span> ${esc(c.line)}</div></td></tr>` : ''); }).join('');
  return `<div class="ivsum"><div class="label">Intervals · ridden</div><table class="ivtbl">${head}${rows}</table></div>`;
}
/** the comparison for a just-finished ride against all saved rides */
export const ivCompare = (rec, rides, kg) => compare(rec, rides, opts({ kg }));

// ---------- history ----------
/** watts per session over time, HR as its own small chart under it; W = drawing width in px (1 user unit = 1 px, labels stay readable) */
export function ivChartHTML(list, W = 640) {
  const P = { l: 44, r: 14, t: 24, b: 26 }, n = list.length; if (!n) return '';
  const t0 = list[0].date, t1 = list[n - 1].date, span = Math.max(1, t1 - t0);
  const x = s => n === 1 ? (P.l + W - P.r) / 2 : P.l + (s.date - t0) / span * (W - P.l - P.r);
  const ticks = (lo, hi) => { const r = hi - lo || 1, raw = r / 4, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p, st = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p, out = [];
    for (let k = Math.ceil(lo / st) * st; k <= hi + 1e-9; k += st) out.push(k); return out; };
  const nx = Math.max(2, Math.min(n, Math.floor((W - P.l - P.r) / 80))); // date labels that fit
  const xi = n === 1 ? [0] : [...new Set(Array.from({ length: nx }, (_, k) => Math.round(k * (n - 1) / (nx - 1))))];
  const keep = []; for (const i of xi) { if (keep.length && x(list[i]) - x(list[keep[keep.length - 1]]) < 72) { if (i !== n - 1) continue; if (keep.length > 1) keep.pop(); else continue; } keep.push(i); } // no two dates on top of each other; the latest always shows
  const xlab = h => keep.map(i => `<text x="${x(list[i]).toFixed(1)}" y="${h - 8}" class="ax" text-anchor="${n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}">${dshort(list[i].date)}</text>`).join('');
  const chart = (key, h, cls, dot, unit, aria, labels) => {
    const pts = list.filter(s => s[key] > 0); if (!pts.length) return '';
    const vals = pts.map(s => s[key]), lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = Math.max(5, (hi0 - lo0) * 0.15);
    const tk = ticks(Math.max(0, lo0 - pad), hi0 + pad), lo = tk[0], hi = tk[tk.length - 1], y = val => P.t + (1 - (val - lo) / (hi - lo || 1)) * (h - P.t - P.b);
    const grid = tk.map(k => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(k).toFixed(1)}" y2="${y(k).toFixed(1)}" class="grid"/><text x="${P.l - 6}" y="${(y(k) + 4).toFixed(1)}" class="ax" text-anchor="end">${Math.round(k)}</text>`).join('');
    const line = pts.length > 1 ? `<path d="${pts.map((s, i) => `${i ? 'L' : 'M'}${x(s).toFixed(1)},${y(s[key]).toFixed(1)}`).join('')}" class="${cls}"/>` : '';
    const lab = labels ? labels.map(([s, txt]) => `<text x="${Math.min(W - P.r, Math.max(P.l, x(s))).toFixed(1)}" y="${(y(s[key]) - 10).toFixed(1)}" class="ivlab" text-anchor="${x(s) > W - 60 ? 'end' : x(s) < P.l + 40 ? 'start' : 'middle'}">${txt}</text>`).join('') : '';
    const dots = pts.map(s => `<circle cx="${x(s).toFixed(1)}" cy="${y(s[key]).toFixed(1)}" r="4.5" class="${dot}"/><rect x="${(x(s) - 14).toFixed(1)}" y="${P.t}" width="28" height="${h - P.t - P.b}" class="hit"><title>${dlong(s.date)} · ${s.n}× · avg ${v(s.w, ' W')}${s.wkg ? ` (${wkg(s.wkg)} W/kg)` : ''} · HR ${v(s.hr)}</title></rect>`).join('');
    return `<svg viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" class="dchart ivchart" role="img" aria-label="${aria}"><text x="${P.l - 6}" y="12" class="ax ivunit" text-anchor="end">${unit}</text>${grid}${line}${lab}${dots}${xlab(h)}</svg>`;
  };
  const best = list.reduce((m, s) => !m || s.w > m.w ? s : m, null), last = list[n - 1];
  const labels = [[last, `${last.w} W`], ...(best !== last ? [[best, `best ${best.w} W`]] : [])];
  const hr = chart('hr', 120, 'lhr', 'dhr', 'bpm', 'Average heart rate per session', null);
  return `<div class="ivcap"><i class="sw w"></i>Average ridden watts per session</div>${chart('w', 200, 'l1', 'd1', 'W', 'Average ridden watts per session', labels)}
    ${hr ? `<div class="ivcap"><i class="sw h"></i>Average heart rate per session</div>${hr}` : list.length ? '<div class="ivcap dim">Heart rate: ride with a strap to see it here</div>' : ''}`;
}

const LS = 'rf_ivkind';
const getSel = () => { try { return localStorage.getItem(LS) || ''; } catch { return ''; } };
const setSel = k => { try { localStorage.setItem(LS, k); } catch {} };
/** the whole "Intervals over time" block; o: { kg, width, sel } */
export function ivHistoryHTML(rides, o = {}) {
  const all = sessions(rides, opts({ kg: o.kg }));
  if (!all.length) return `<div class="ivhist"><p class="hint">No workout intervals yet. Ride a structured workout (VO2max, Threshold, Sweet Spot …) and each interval shows up here with the watts you rode.</p></div>`;
  const e = all.find(x => x.kind === (o.sel ?? getSel())) || all[0], list = e.sessions, best = e.best, last = e.latest, first = list[0];
  const tile = (lbl, s, sub) => `<div class="record"><div class="label">${lbl}</div><div class="v">${v(s.w)}<small>W</small></div><div class="s">${dlong(s.date)}${s.wkg ? ` · ${wkg(s.wkg)} W/kg` : ''}${s.hr ? ` · HR ${s.hr}` : ''}${sub ? ` · ${sub}` : ''}</div></div>`;
  const d = last.w - first.w, opt = x => `<option value="${esc(x.kind)}"${x === e ? ' selected' : ''}>${esc(x.label)}${x.workout ? ` · ${esc(x.workout)}` : ''} (${x.sessions.length}×)</option>`;
  return `<div class="ivhist" data-kind="${esc(e.kind)}">
    <label class="ivpick"><span class="label">Interval</span><select id="ivKind">${all.map(opt).join('')}</select></label>
    <div class="records ivtiles">${tile('Best session', best)}${tile('Latest session', last, list.length > 1 ? `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} W since ${dshort(first.date)}` : 'first one')}</div>
    <div class="ivcharts">${ivChartHTML(list, o.width || 640)}</div>
    <div class="ivtwrap"><table class="ivtbl ivhtbl"><tr><th>Date</th><th>Intervals</th><th>Avg W</th><th>W/kg</th><th class="ivx">Max W</th><th>Avg HR</th><th class="ivx">Max HR</th><th class="ivx">rpm</th></tr>
      ${list.slice().reverse().map(s => `<tr${s === best ? ' class="ivbest"' : ''}><td>${dlong(s.date)}</td><td class="num">${s.n} × ${mm(s.t / s.n)}</td><td class="num"><b>${v(s.w)}</b></td><td class="num">${wkg(s.wkg)}</td><td class="num ivx">${v(s.wMax)}</td><td class="num">${v(s.hr)}</td><td class="num ivx">${v(s.hrMax)}</td><td class="num ivx">${v(s.cad)}</td></tr>`).join('')}</table></div></div>`;
}
const inner = el => { const cs = getComputedStyle(el); return (el.clientWidth || 640) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0); };
/** draws into root and wires the picker; width() = drawing width now */
export function mountIvHistory(root, rides, o = {}) {
  if (!root) return;
  const draw = sel => { root.innerHTML = ivHistoryHTML(rides, { ...o, sel, width: Math.max(260, Math.round(o.width ? o.width() : inner(root))) });
    root.querySelector('#ivKind')?.addEventListener('change', ev => { setSel(ev.target.value); draw(ev.target.value); }); };
  draw(undefined);
}
