// Training tab: all standard workouts, started with one click on the coast road, plus the workout helper
// (5 questions -> the best workout for today).
import { WORKOUTS, MY, buildMy, defFrom, setMyWorkouts, workoutById, workoutDuration, workoutSVG } from './workouts.js';
import { esc } from './util.js';

// what each workout is good for: goal, how hard (1-5)
const META = {
  rec30: { goal: 'erholung', hard: 1 }, z2_60: { goal: 'grundlage', hard: 2 }, z2_90: { goal: 'grundlage', hard: 2 },
  tempo2x15: { goal: 'grundlage', hard: 3 }, ss2x12: { goal: 'ftp', hard: 3 }, ss3x10: { goal: 'ftp', hard: 3 },
  thr2x20: { goal: 'ftp', hard: 4 }, over_under: { goal: 'ftp', hard: 4 }, vo2_4x4: { goal: 'berg', hard: 5 },
  vo2_5x3: { goal: 'berg', hard: 5 }, pyramid: { goal: 'berg', hard: 4 }, sprints: { goal: 'sprint', hard: 4 }, ramp: { goal: 'test', hard: 5 }, ftp20: { goal: 'test', hard: 5 },
};
const HARD = ['', 'easy', 'steady', 'moderate', 'hard', 'very hard'];

const QUESTIONS = [
  { k: 'time', q: 'How much time do you have today?', a: [['35', 'up to 35 min'], ['50', 'about 45–50 min'], ['65', 'about 1 hour'], ['100', '1.5 hours or more']] },
  { k: 'goal', q: 'What do you want to get better at?', a: [['grundlage', 'Riding longer (endurance)'], ['ftp', 'Faster for a long time (FTP)'], ['berg', 'Climbs and attacks'], ['sprint', 'Sprinting'], ['test', 'Re-test my FTP']] },
  { k: 'feel', q: 'How do you feel right now?', a: [['3', 'Fresh, full of energy'], ['2', 'Normal'], ['1', 'Tired or heavy legs']] },
  { k: 'last', q: 'When was your last hard session?', a: [['1', 'Today or yesterday'], ['2', '2–3 days ago'], ['3', 'Longer ago']] },
  { k: 'want', q: 'How hard may it be today?', a: [['2', 'Relaxed'], ['3', 'Challenging'], ['5', 'Full gas']] },
];

/** scores every workout for the answers; best first */
export function recommend(ans) {
  const time = +ans.time, feel = +ans.feel, last = +ans.last, want = +ans.want;
  const cap = Math.max(1, Math.min(want, feel === 1 || last === 1 ? 2 + (feel === 3 ? 1 : 0) : 5)); // tired or hard yesterday: keep it easy
  return WORKOUTS.map(w => {
    const m = META[w.id] || { goal: 'grundlage', hard: 3 }, min = workoutDuration(w) / 60;
    let s = 0;
    if (m.goal === ans.goal) s += 40; else if (cap <= 2 && (m.goal === 'erholung' || m.goal === 'grundlage')) s += 30;
    if (ans.goal === 'test' && (feel < 3 || last === 1) && m.goal === 'test') s -= 45; // a test only when fresh
    s -= Math.max(0, min - time) * 1.5 + Math.max(0, time - min - 20) * 0.3;            // too long hurts more than too short
    s -= Math.max(0, m.hard - cap) * 18 + Math.abs(m.hard - cap) * 4;
    return { w, s, m, min };
  }).sort((a, b) => b.s - a.s);
}

function why(r, ans) {
  const bits = [];
  if (r.m.goal === ans.goal) bits.push('fits your goal');
  if (+ans.feel === 1 || +ans.last === 1) bits.push('goes easy on you because you are not quite fresh');
  bits.push(`${Math.round(r.min)} min, ${HARD[r.m.hard]}`);
  return bits.join(' · ');
}

/** the five questions, one after another; resolves with the chosen workout id (or null) */
export function helperModal() {
  return new Promise(done => {
    const m = document.createElement('div'); m.className = 'modal'; document.body.append(m);
    const ans = {}; let i = 0;
    const close = v => { m.remove(); done(v); };
    const step = () => {
      if (i >= QUESTIONS.length) return result();
      const Q = QUESTIONS[i];
      m.innerHTML = `<div class="box"><div class="label">Workout helper · question ${i + 1} of ${QUESTIONS.length}</div><h2 class="display" style="font-size:28px">${esc(Q.q)}</h2>
        <div class="helper-answers">${Q.a.map(([v, t]) => `<button class="btn ghost" data-v="${v}">${esc(t)}</button>`).join('')}</div>
        <div class="actions">${i ? '<button class="btn ghost small" id="hBack">Back</button>' : ''}<button class="btn ghost small" id="hX">Cancel</button></div></div>`;
      m.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { ans[Q.k] = b.dataset.v; i++; step(); });
      m.querySelector('#hBack')?.addEventListener('click', () => { i--; step(); });
      m.querySelector('#hX').onclick = () => close(null);
    };
    const result = () => {
      const [best, alt] = recommend(ans);
      m.innerHTML = `<div class="box"><div class="label">Your workout for today</div><h2 class="display" style="font-size:32px">${esc(best.w.name)}</h2>
        <p>${esc(best.w.what)}</p><p style="margin-top:6px"><b>Why:</b> ${esc(why(best, ans))}</p>${workoutSVG(best.w)}
        ${alt ? `<p style="margin-top:14px">Alternative: <a href="#" id="hAlt">${esc(alt.w.name)}</a> (${Math.round(alt.min)} min, ${HARD[alt.m.hard]})</p>` : ''}
        <div class="actions"><button class="btn ghost" id="hAgain">Again</button><button class="btn" id="hGo">Start on the coast road ▸</button></div></div>`;
      m.querySelector('#hGo').onclick = () => close(best.w.id);
      m.querySelector('#hAlt')?.addEventListener('click', e => { e.preventDefault(); close(alt.w.id); });
      m.querySelector('#hAgain').onclick = () => { i = 0; step(); };
    };
    step();
  });
}


const IN = 'background:var(--ink);color:var(--paper);border:1px solid var(--line-2);border-radius:var(--radius);height:40px;padding:0 10px;font:inherit;font-weight:700';
const fmtMin = sec => { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return s ? `${m}:${String(s).padStart(2, '0')} min` : `${m} min`; };

/** Pro-Modus: build your own interval workout. Resolves with the saved definition (or null). */
export function editorModal(def0, ftp, isNew = !def0) {
  const def = JSON.parse(JSON.stringify(def0 || { id: 'my_' + Date.now().toString(36), name: 'My workout', warm: true, cool: true,
    rows: [{ t: 'i', n: 5, onMin: 3, onPct: 110, offMin: 3, offPct: 55, label: 'Interval' }] }));
  return new Promise(done => {
    const m = document.createElement('div'); m.className = 'modal'; document.body.append(m);
    const close = v => { m.remove(); done(v); };
    const inp = (k, i, v, w = 64, step = 'any') => `<input type="number" step="${step}" data-k="${k}" data-i="${i}" value="${esc(String(v))}" style="width:${w}px;${IN}">`;
    const w2 = pct => `<span class="hint">${Math.round(pct / 100 * ftp)} W</span>`;
    const row = (r, i) => r.t === 'i'
      ? `<div class="wrow" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0">
          <b style="min-width:84px">Intervals</b>${inp('n', i, r.n, 52, 1)} ×
          ${inp('onMin', i, r.onMin)} min at ${inp('onPct', i, r.onPct)} % ${w2(r.onPct)} ·
          Rest ${inp('offMin', i, r.offMin)} min at ${inp('offPct', i, r.offPct)} % ${w2(r.offPct)}
          <button class="btn ghost small" data-del="${i}" title="Remove">✕</button></div>`
      : `<div class="wrow" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0">
          <b style="min-width:84px">Block</b>${inp('min', i, r.min)} min at ${inp('pct', i, r.pct)} % ${w2(r.pct)}
          <input type="text" data-k="label" data-i="${i}" value="${esc(r.label || '')}" placeholder="Name (e.g. Tempo)" style="width:150px;${IN}">
          <button class="btn ghost small" data-del="${i}" title="Remove">✕</button></div>`;
    const draw = () => {
      const w = buildMy(def), sec = workoutDuration(w);
      m.innerHTML = `<div class="box wedbox" style="width:min(860px,94vw)"><div class="label">${def0 ? 'Adjust workout' : 'Build workout'}</div>
        <h2 class="display" style="font-size:28px;margin:8px 0 12px"><input type="text" id="eName" value="${esc(def.name)}" style="font:inherit;width:100%;background:transparent;border:0;border-bottom:1px solid #fff3;color:inherit"></h2>
        <p class="hint" style="margin:0 0 8px">In ERG mode the trainer holds the watts; the route only sets the picture. % refer to your FTP (${ftp} W).</p>
        <label class="tgl"><input type="checkbox" class="toggle" id="eWarm" ${def.warm !== false ? 'checked' : ''}> 10 min warm-up</label>
        <label class="tgl"><input type="checkbox" class="toggle" id="eCool" ${def.cool !== false ? 'checked' : ''}> 5 min cool-down</label>
        <div id="eRows" style="margin:10px 0">${def.rows.map(row).join('') || '<p class="hint">Still empty: add blocks or intervals.</p>'}</div>
        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap"><button class="btn ghost small" id="eAddB">+ Block</button><button class="btn ghost small" id="eAddI">+ Intervals</button>
          <span style="flex:1"></span><button class="btn ghost small" data-all="-5" title="All blocks 5 % easier">All −5 %</button><button class="btn ghost small" data-all="5" title="All blocks 5 % harder">All +5 %</button></div>
        <div class="label">${fmtMin(sec)} total</div>${workoutSVG(w)}
        <div class="actions">${!isNew ? '<button class="btn ghost" id="eDel">Delete</button>' : ''}<button class="btn ghost" id="eX">Cancel</button><button class="btn" id="eSave">Save</button></div></div>`;
      m.querySelector('#eName').oninput = e => { def.name = e.target.value; };
      m.querySelector('#eWarm').onchange = e => { def.warm = e.target.checked; draw(); };
      m.querySelector('#eCool').onchange = e => { def.cool = e.target.checked; draw(); };
      m.querySelectorAll('[data-k]').forEach(el => el.onchange = () => { const r = def.rows[+el.dataset.i]; r[el.dataset.k] = el.type === 'number' ? +el.value : el.value; draw(); });
      m.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { def.rows.splice(+b.dataset.del, 1); draw(); });
      m.querySelector('#eAddB').onclick = () => { def.rows.push({ t: 'b', min: 10, pct: 75, label: 'Tempo' }); draw(); };
      m.querySelector('#eAddI').onclick = () => { def.rows.push({ t: 'i', n: 4, onMin: 4, onPct: 105, offMin: 3, offPct: 55, label: 'Interval' }); draw(); };
      m.querySelectorAll('[data-all]').forEach(b => b.onclick = () => { const d = +b.dataset.all, c = v => Math.max(30, Math.min(200, Math.round(+v + d)));
        for (const r of def.rows) { if (r.t === 'i') r.onPct = c(r.onPct); else r.pct = c(r.pct); } draw(); });
      m.querySelector('#eX').onclick = () => close(null);
      m.querySelector('#eDel')?.addEventListener('click', () => { if (confirm(`Delete “${def.name}”?`)) close({ del: def.id }); });
      m.querySelector('#eSave').onclick = () => { def.name = (def.name || '').trim() || 'My workout'; close(def); };
    };
    draw();
  });
}

/** the Training tab; ctx = { state, saveSettings, startRide, routeById } */
export function trainingView(main, ctx) {
  const { state } = ctx, coast = ctx.routeById('kueste60') ? 'kueste60' : 'demo', ftp = state.settings.ftp || 200;
  main.innerHTML = `
  <section class="view">
    <div class="view-head"><div><div class="label">Training</div><h1 class="display" style="margin-top:14px">Work&shy;outs</h1>
      <div class="meta">${WORKOUTS.length} standard workouts${MY.length ? ` + ${MY.length} of your own` : ''} on the ${coast === 'kueste60' ? 'coast road' : 'Rocky Coast'} · target watts from your FTP (${ftp} W)</div></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end"><a class="btn ghost" href="pure.html" style="text-decoration:none" title="For the phone: just watts, numbers and workouts, no map">Pure mode (phone) ▸</a><a class="btn ghost" href="outdoor.html" style="text-decoration:none" title="Record real outdoor rides with your phone: GPS map, speed, climbing, heart rate, watts">Ride outdoors ▸</a><a class="btn ghost" href="kraft.html" style="text-decoration:none" title="Log strength workouts like in Strong: sets, weights, history, records">Strength ▸</a><button class="btn" id="helperBtn">Which workout fits today? ▸</button></div></div>
    <label style="display:flex;gap:8px;align-items:center;margin:0 0 18px" title="The trainer holds the target watts itself"><input type="checkbox" class="toggle" id="ergChk2" ${state.settings.erg !== false ? 'checked' : ''}> ERG (trainer holds the watts)</label>
    <div class="view-head" style="margin-top:6px"><div><h3 style="margin:0">My workouts</h3><div class="meta">Build your own blocks or adjust a standard workout (watts, length, laps)</div></div>
      <div><button class="btn ghost" id="newWBtn">+ Build your own workout</button></div></div>
    <div class="wgrid" style="margin-bottom:22px">${MY.length ? MY.map(w => `<div class="panel wcard">
      <div class="label">${Math.round(workoutDuration(w) / 60)} min · own</div><h3>${esc(w.name)}</h3><p>${esc(w.what)}</p>${workoutSVG(w)}
      <div style="display:flex;gap:8px"><button class="btn small" data-go="${w.id}" style="white-space:nowrap">Start ▸</button><button class="btn ghost small" data-edit="${w.id}">Edit</button></div></div>`).join('')
      : '<p class="hint">No workouts of your own yet.</p>'}</div>
    <h3 style="margin:0 0 10px">Standard workouts</h3>
    <div class="wgrid">${WORKOUTS.map(w => { const m = META[w.id] || {}; return `<div class="panel wcard">
      <div class="label">${Math.round(workoutDuration(w) / 60)} min · ${HARD[m.hard] || ''}</div><h3>${esc(w.name)}</h3><p>${esc(w.what)}</p>${workoutSVG(w)}
      <div style="display:flex;gap:8px"><button class="btn small" data-go="${w.id}" style="white-space:nowrap">Start ▸</button>${m.goal === 'test' ? '' : `<button class="btn ghost small" data-adapt="${w.id}">Adjust</button>`}</div></div>`; }).join('')}</div>
  </section>`;
  const start = id => { state.settings.workout = id; ctx.saveSettings(); ctx.startRide(coast); };
  main.querySelectorAll('[data-go]').forEach(b => b.onclick = () => start(b.dataset.go));
  main.querySelector('#ergChk2').onchange = e => { state.settings.erg = e.target.checked; ctx.saveSettings(); };
  const mine = () => (state.settings.myWorkouts ||= []);
  const edit = async (id, from) => {
    const res = from ? await editorModal(from, ftp, true) : await editorModal(id ? mine().find(d => d.id === id) : null, ftp);
    if (!res) return;
    const list = mine().filter(d => d.id !== (res.del || res.id));
    if (!res.del) { const at = mine().findIndex(d => d.id === res.id); at >= 0 ? list.splice(at, 0, res) : list.unshift(res); }
    state.settings.myWorkouts = list; setMyWorkouts(list); await ctx.saveSettings(); trainingView(main, ctx);
  };
  main.querySelector('#newWBtn').onclick = () => edit(null);
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(b.dataset.edit));
  main.querySelectorAll('[data-adapt]').forEach(b => b.onclick = () => edit(null, defFrom(workoutById(b.dataset.adapt))));
  main.querySelector('#helperBtn').onclick = async () => { const id = await helperModal(); if (workoutById(id)) start(id); };
}
