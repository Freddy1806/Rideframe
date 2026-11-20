// Heart rate vs power, the views (owner 20.11.): the section on the ride summary, the same for a past ride on Rides & Records
// (desktop) and the phone Stats page, with the trend of the recovery index and of the heart rate at the target power over the
// rides of the same workout. HTML strings and one mount function; all numbers come from js/hrpower.js.
import { hrpOf, compareHrp, trend } from './hrpower.js';
import { workoutById } from './workouts.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const v = (x, u = '') => x != null && Number.isFinite(+x) ? `${x}${u}` : '–';
const sg = d => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}`;
const dshort = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dlong = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const HINT = 'Heart rate vs power: ride with a heart rate strap to see how your heart answers the watts and how fast it recovers.';

/** the three ingredients as small bars, each with one sentence in plain words */
function partsHTML(h) {
  const P = h.parts || {}, row = (k, name, p, txt) => p ? `<div class="hrp-part" data-k="${k}"><div class="hrp-pn"><span>${name}</span><b>${Math.round(p.v * 100)}</b><small>${Math.round(p.w * 100)} % weight</small></div>
    <div class="hrp-bar"><i style="width:${Math.round(p.v * 100)}%"></i></div><p>${txt}</p></div>` : '';
  const a = P.a, b = P.b, c = P.c;
  return row('a', 'Recovery after the sets', a, `Your heart rate fell <b>${Math.round(a?.val)} bpm</b> in the first minute after ${h.sets.length > 1 ? 'the sets (average)' : 'the work'}. 10 bpm counts as 0, 40 bpm as full.`)
    + row('b', 'Steadiness', b, b ? `Watts per heart beat were <b>${Math.abs(b.val).toFixed(1)} % ${b.val >= 0 ? 'lower' : 'higher'}</b> ${b.by === 'sets' ? 'in the last set than in the first' : 'in the last third of the reps than in the first'}. 0 % counts as full, 12 % as 0.` : '')
    + row('c', 'Recovery inside the sets', c, c ? (c.kind === 'float' ? `In the short rests your heart rate came back <b>${Math.round(c.val * 100)} %</b> of the way it had climbed since the set started. Half the way counts as full.`
      : `Between the reps it fell <b>${Math.round(c.val)} bpm</b> in the first minute of each rest. 10 bpm counts as 0, 40 bpm as full.`) : '');
}

/** reps as lines: x = rep number in the set, y = avg HR per rep, one line per set (the latest set in orange), power as faint bars */
export function repChartHTML(h, W = 460) {
  const sets = (h.sets || []).map((s, i) => ({ ...s, i, reps: (h.reps || []).filter(r => r[0] === i && r[2] > 0) })).filter(s => s.reps.length);
  const nMax = Math.max(0, ...sets.map(s => s.reps.length)); if (nMax < 2) return '';
  const H = 190, P = { l: 40, r: 40, t: 18, b: 26 };
  const hrs = sets.flatMap(s => s.reps.map(r => r[2])), lo0 = Math.min(...hrs), hi0 = Math.max(...hrs), pad = Math.max(3, (hi0 - lo0) * 0.12);
  const st = (hi0 - lo0 + 2 * pad) > 40 ? 10 : 5, lo = Math.floor((lo0 - pad) / st) * st, hi = Math.ceil((hi0 + pad) / st) * st;
  const x = k => P.l + (nMax === 1 ? 0.5 : k / (nMax - 1)) * (W - P.l - P.r), y = val => P.t + (1 - (val - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const wMax = Math.max(1, ...sets.flatMap(s => s.reps.map(r => r[1]))), bw = Math.max(3, Math.min(18, (W - P.l - P.r) / nMax * 0.5));
  const wAt = k => { const w = sets.map(s => s.reps[k]?.[1]).filter(z => z > 0); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0; };
  const bars = Array.from({ length: nMax }, (_, k) => { const w = wAt(k), bh = w / wMax * (H - P.t - P.b) * 0.4; return w ? `<rect x="${(x(k) - bw / 2).toFixed(1)}" y="${(H - P.b - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" class="hrp-wbar"><title>Rep ${k + 1}: ${Math.round(w)} W</title></rect>` : ''; }).join('');
  const grid = []; for (let g = lo; g <= hi; g += st) grid.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}" class="grid"/><text x="${P.l - 6}" y="${(y(g) + 4).toFixed(1)}" class="ax" text-anchor="end">${g}</text>`);
  const nx = Math.min(nMax, Math.max(2, Math.floor((W - P.l - P.r) / 34))), xs = [...new Set(Array.from({ length: nx }, (_, k) => Math.round(k * (nMax - 1) / (nx - 1))))];
  const xl = xs.map(k => `<text x="${x(k).toFixed(1)}" y="${H - 8}" class="ax" text-anchor="middle">${k + 1}</text>`).join('');
  const last = sets.length - 1, ends = [];
  const lines = sets.map((s, j) => { const cls = j === last ? 'hrp-l now' : 'hrp-l', op = j === last ? 1 : 0.35 + 0.4 * j / Math.max(1, last);
    const d = s.reps.map((r, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(r[2]).toFixed(1)}`).join('');
    const e = s.reps[s.reps.length - 1]; ends.push({ y: y(e[2]), x: x(s.reps.length - 1), t: sets.length > 1 ? `S${j + 1}` : '', j, op });
    return `<path d="${d}" class="${cls}" style="opacity:${op.toFixed(2)}"/>${s.reps.map((r, k) => `<circle cx="${x(k).toFixed(1)}" cy="${y(r[2]).toFixed(1)}" r="${j === last ? 3.2 : 2.4}" class="${j === last ? 'hrp-d now' : 'hrp-d'}" style="opacity:${op.toFixed(2)}"><title>${esc(s.l)} · rep ${k + 1}: ${r[1]} W · avg HR ${r[2]} · peak ${v(r[3])}</title></circle>`).join('')}`; }).join('');
  ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12; // labels never on top of each other
  const lab = ends.filter(e => e.t).map(e => `<text x="${(e.x + 8).toFixed(1)}" y="${(e.y + 4).toFixed(1)}" class="hrp-lab${e.j === last ? ' now' : ''}">${e.t}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="dchart hrp-chart" role="img" aria-label="Average heart rate per rep, one line per set"><text x="${P.l - 6}" y="10" class="ax ivunit" text-anchor="end">bpm</text>${grid.join('')}${bars}${lines}${lab}${xl}</svg>
    <div class="hrp-cap"><span><i class="sw"></i>avg HR per rep${sets.length > 1 ? ', one line per set' : ''}</span><span><i class="sw w"></i>avg W per rep (${Math.round(wMax)} W max)</span><span>x: rep number</span></div>`;
}

function cmpHTML(c) {
  if (!c?.lines?.length) return '';
  return `<div class="hrp-cmp"><div class="label">Last time (${esc(c.prev.day)})${c.n > 1 ? ` · grey: mean of the last ${Math.min(5, c.n)}` : ''}</div><ul>${c.lines.map(l => `<li class="${l.good === true ? 'good' : l.good === false ? 'bad' : ''}" data-k="${l.k}">${esc(l.text)}${c.n > 1 && l.avg5 != null ? ` <small>${l.k === 'ef' ? l.avg5.toFixed(2) : l.avg5}</small>` : ''}</li>`).join('')}</ul></div>`;
}

function setsHTML(h) {
  if (!h.sets?.length) return '';
  const name = l => { const m = /·\s*set\s*(\d+)$/i.exec(l || ''); return m ? `Set ${m[1]}` : l; }; // "30 / 15 · set 2" → "Set 2" (the workout's name is above)
  const row = s => `<tr><td title="${esc(s.l)}">${esc(name(s.l))}</td><td class="num ivx">${s.n} × ${s.d < 60 ? s.d + ' s' : Math.round(s.d / 60) + ' min'}</td><td class="num"><b>${v(s.w)}</b></td><td class="num">${v(s.hr)}</td><td class="num ivx">${v(s.pk)}</td><td class="num">${s.dr != null ? `${sg(Math.round(s.dr))} bpm` : '–'}<span class="ivx">${s.de != null ? ` · ${sg(Math.round(s.de))} %` : ''}</span></td><td class="num">${s.r60 != null ? `${s.r60} bpm` : '–'}</td></tr>`;
  return `<div class="hrp-twrap"><table class="ivtbl hrp-tbl"><tr><th>Set</th><th class="ivx">Reps</th><th>Avg W</th><th>Avg HR</th><th class="ivx">Peak HR</th><th>Drift</th><th>HRR60</th></tr>${h.sets.map(row).join('')}</table></div>`;
}

/** the whole section; rec = { id, date, workoutId, hrp }, list = the other rides as { id, date, workoutId, hrp } */
export function hrpSectionHTML(rec, list = [], o = {}) {
  const h = rec?.hrp; if (!h) return '';
  if (!h.reps?.length && /^No heart rate/.test(h.reason || '')) return `<div class="hrp hrp-hint">${esc(HINT)}</div>`;
  if (!h.reps?.length) return '';
  const c = compareHrp(rec, list);
  const big = h.ok ? `<div class="hrp-big">${h.index}<small>/100</small></div>` : `<div class="hrp-big off">–</div><p class="hrp-why">${esc(h.reason || '')}</p>`;
  const m = h.main, at = m ? `<div class="hrp-at"><span>HR at ${m.tg} W</span><b>${v(m.hr)}</b><small>bpm</small><span>EF</span><b>${m.ef != null ? m.ef.toFixed(2) : '–'}</b><small>W/beat</small></div>` : '';
  return `<div class="hrp" data-index="${h.ok ? h.index : ''}">
    <div class="hrp-head"><div class="label">Heart rate vs power</div><span class="hrp-note">A guide to compare your own rides, not a medical value</span></div>
    <div class="hrp-top"><div class="hrp-idx"><div class="label">Recovery index</div>${big}${at}${partsHTML(h)}</div>
      <div class="hrp-right">${repChartHTML(h, o.chartW || 460)}${cmpHTML(c)}</div></div>
    ${setsHTML(h)}</div>`;
}

/** the analysis of every workout ride (stored, or worked out now from the samples of an older ride) */
export const withHrp = rides => (rides || []).filter(r => r?.workoutId && !r.unsaved).map(r => { const hrp = hrpOf(r, workoutById); return hrp ? { id: r.id, date: r.date, workoutId: r.workoutId, workout: r.workout || '', hrp } : null; }).filter(Boolean);

/** on the summary after a ride */
export function mountHrpRide(box, rec, rides) {
  if (!box || !rec) return;
  const list = withHrp((rides || []).filter(r => r.id !== rec.id)), me = { id: rec.id, date: rec.date, workoutId: rec.workoutId, hrp: rec.hrp || hrpOf(rec, workoutById) };
  box.innerHTML = hrpSectionHTML(me, list, { chartW: Math.max(280, Math.min(520, Math.round((box.clientWidth || 900) / 2 - 20))) });
}

// ---------- history ----------
/** recovery index and heart rate at the target power over the rides of one workout (two small charts on one time axis) */
export function trendHTML(list, W = 640) {
  const n = list.length; if (!n) return '';
  const P = { l: 44, r: 16, t: 20, b: 26 }, t0 = list[0].date, span = Math.max(1, list[n - 1].date - t0);
  const x = s => n === 1 ? (P.l + W - P.r) / 2 : P.l + (s.date - t0) / span * (W - P.l - P.r);
  const keep = []; for (let i = 0; i < n; i++) { if (keep.length && x(list[i]) - x(list[keep[keep.length - 1]]) < 64) { if (i === n - 1) keep[keep.length - 1] = i; continue; } keep.push(i); }
  const chart = (key, h, cls, unit, aria, fix) => {
    const pts = list.filter(s => s[key] != null); if (!pts.length) return '';
    const vals = pts.map(s => s[key]); let lo = Math.min(...vals), hi = Math.max(...vals);
    if (fix) { lo = 0; hi = 100; } else { const st = hi - lo > 30 ? 10 : 5; lo = Math.floor((lo - 3) / st) * st; hi = Math.ceil((hi + 3) / st) * st; }
    const y = val => P.t + (1 - (val - lo) / (hi - lo || 1)) * (h - P.t - P.b), stp = fix ? 25 : (hi - lo > 30 ? 10 : 5), g = [];
    for (let k = lo; k <= hi; k += stp) g.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${y(k).toFixed(1)}" y2="${y(k).toFixed(1)}" class="grid"/><text x="${P.l - 6}" y="${(y(k) + 4).toFixed(1)}" class="ax" text-anchor="end">${k}</text>`);
    const line = pts.length > 1 ? `<path d="${pts.map((s, i) => `${i ? 'L' : 'M'}${x(s).toFixed(1)},${y(s[key]).toFixed(1)}`).join('')}" class="${cls}"/>` : '';
    const L = pts[pts.length - 1], lab = `<text x="${Math.min(W - P.r, x(L)).toFixed(1)}" y="${(y(L[key]) - 9).toFixed(1)}" class="ivlab" text-anchor="${n > 1 ? 'end' : 'middle'}">${L[key]}</text>`;
    const dots = pts.map(s => `<circle cx="${x(s).toFixed(1)}" cy="${y(s[key]).toFixed(1)}" r="4.5" class="${cls === 'l1' ? 'd1' : 'dhr'}"><title>${dlong(s.date)} · index ${v(s.index)} · HR ${v(s.hr)} at ${s.tg} W</title></circle>`).join('');
    const xl = keep.map(i => `<text x="${x(list[i]).toFixed(1)}" y="${h - 8}" class="ax" text-anchor="${n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}">${dshort(list[i].date)}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" class="dchart ivchart hrp-trend" data-k="${key}" role="img" aria-label="${aria}"><text x="${P.l - 6}" y="11" class="ax ivunit" text-anchor="end">${unit}</text>${g.join('')}${line}${lab}${dots}${xl}</svg>`;
  };
  const tg = list[n - 1].tg;
  return `<div class="ivcap"><i class="sw w"></i>Recovery index per ride</div>${chart('index', 150, 'l1', '', 'Recovery index per ride', true)}
    <div class="ivcap"><i class="sw h"></i>Average heart rate at ${tg} W per ride (lower is better)</div>${chart('hr', 130, 'lhr', 'bpm', 'Heart rate at the target power per ride')}`;
}

const LS = 'rf_hrpride';
const getSel = () => { try { return localStorage.getItem(LS) || ''; } catch { return ''; } };
const setSel = k => { try { localStorage.setItem(LS, k); } catch {} };
const inner = el => { const cs = getComputedStyle(el); return (el.clientWidth || 640) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0); };
/** Rides & Records / phone Stats: pick a workout ride, its section, the trend of its workout */
export function mountHrpHistory(root, rides) {
  if (!root) return;
  const all = withHrp(rides).sort((a, b) => b.date - a.date), useful = all.filter(r => r.hrp.reps?.length);
  if (!useful.length) { root.innerHTML = `<div class="hrp-hist"><p class="hint">${all.length ? esc(HINT) : 'No workout rides yet. Ride a structured workout with a heart rate strap: here you then see how your heart answers the watts, how fast it recovers, and how that changes from ride to ride.'}</p></div>`; return; }
  const draw = sel => {
    const cur = useful.find(r => r.id === sel) || useful[0], W = Math.max(260, Math.round(inner(root)));
    const same = useful.filter(r => r.workoutId === cur.workoutId && r.hrp.main && cur.hrp.main && Math.abs(r.hrp.main.tg - cur.hrp.main.tg) <= 5).sort((a, b) => a.date - b.date);
    const opt = r => `<option value="${esc(r.id)}"${r === cur ? ' selected' : ''}>${dlong(r.date)} · ${esc(r.workout || r.workoutId)}${r.hrp.ok ? ` · index ${r.hrp.index}` : ''}</option>`;
    root.innerHTML = `<div class="hrp-hist"><label class="ivpick"><span class="label">Ride</span><select id="hrpRide">${useful.map(opt).join('')}</select></label>
      ${hrpSectionHTML(cur, all.filter(r => r.id !== cur.id), { chartW: Math.max(280, Math.min(560, W > 760 ? Math.round(W / 2 - 24) : W)) })}
      <div class="hrp-trendbox"><div class="label">${esc(cur.workout || 'This workout')} over time · ${same.length} ${same.length === 1 ? 'ride' : 'rides'}</div>${trendHTML(trend(same, cur.workoutId), W)}</div></div>`;
    root.querySelector('#hrpRide')?.addEventListener('change', ev => { setSel(ev.target.value); draw(ev.target.value); });
  };
  draw(getSel());
}
