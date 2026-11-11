// Training tab: all standard workouts, started with one click on the coast road, plus the workout helper
// (5 questions -> the best workout for today).
import { WORKOUTS, workoutById, workoutDuration, workoutSVG } from './workouts.js';
import { esc } from './util.js';

// what each workout is good for: goal, how hard (1-5)
const META = {
  rec30: { goal: 'erholung', hard: 1 }, z2_60: { goal: 'grundlage', hard: 2 }, z2_90: { goal: 'grundlage', hard: 2 },
  tempo2x15: { goal: 'grundlage', hard: 3 }, ss2x12: { goal: 'ftp', hard: 3 }, ss3x10: { goal: 'ftp', hard: 3 },
  thr2x20: { goal: 'ftp', hard: 4 }, over_under: { goal: 'ftp', hard: 4 }, vo2_4x4: { goal: 'berg', hard: 5 },
  vo2_5x3: { goal: 'berg', hard: 5 }, pyramid: { goal: 'berg', hard: 4 }, sprints: { goal: 'sprint', hard: 4 }, ramp: { goal: 'test', hard: 5 },
};
const HARD = ['', 'locker', 'ruhig', 'mittel', 'hart', 'sehr hart'];

const QUESTIONS = [
  { k: 'time', q: 'Wie viel Zeit hast du heute?', a: [['35', 'bis 35 min'], ['50', 'ca. 45–50 min'], ['65', 'ca. 1 Stunde'], ['100', '1,5 Stunden oder mehr']] },
  { k: 'goal', q: 'Was willst du besser können?', a: [['grundlage', 'Länger fahren (Ausdauer)'], ['ftp', 'Schneller über lange Zeit (FTP)'], ['berg', 'Berge und Attacken'], ['sprint', 'Sprinten'], ['test', 'Meine FTP neu messen']] },
  { k: 'feel', q: 'Wie fühlst du dich gerade?', a: [['3', 'Frisch, voll Energie'], ['2', 'Normal'], ['1', 'Müde oder schwere Beine']] },
  { k: 'last', q: 'Wann war dein letztes hartes Training?', a: [['1', 'Heute oder gestern'], ['2', 'Vor 2–3 Tagen'], ['3', 'Länger her']] },
  { k: 'want', q: 'Wie hart darf es heute werden?', a: [['2', 'Entspannt'], ['3', 'Fordernd'], ['5', 'Vollgas']] },
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
  if (r.m.goal === ans.goal) bits.push('passt zu deinem Ziel');
  if (+ans.feel === 1 || +ans.last === 1) bits.push('schont dich, weil du nicht ganz frisch bist');
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
      m.innerHTML = `<div class="box"><div class="label">Workout-Helfer · Frage ${i + 1} von ${QUESTIONS.length}</div><h2 class="display" style="font-size:28px">${esc(Q.q)}</h2>
        <div class="helper-answers">${Q.a.map(([v, t]) => `<button class="btn ghost" data-v="${v}">${esc(t)}</button>`).join('')}</div>
        <div class="actions">${i ? '<button class="btn ghost small" id="hBack">Zurück</button>' : ''}<button class="btn ghost small" id="hX">Abbrechen</button></div></div>`;
      m.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { ans[Q.k] = b.dataset.v; i++; step(); });
      m.querySelector('#hBack')?.addEventListener('click', () => { i--; step(); });
      m.querySelector('#hX').onclick = () => close(null);
    };
    const result = () => {
      const [best, alt] = recommend(ans);
      m.innerHTML = `<div class="box"><div class="label">Dein Workout für heute</div><h2 class="display" style="font-size:32px">${esc(best.w.name)}</h2>
        <p>${esc(best.w.what)}</p><p style="margin-top:6px"><b>Warum:</b> ${esc(why(best, ans))}</p>${workoutSVG(best.w)}
        ${alt ? `<p style="margin-top:14px">Alternative: <a href="#" id="hAlt">${esc(alt.w.name)}</a> (${Math.round(alt.min)} min, ${HARD[alt.m.hard]})</p>` : ''}
        <div class="actions"><button class="btn ghost" id="hAgain">Nochmal</button><button class="btn" id="hGo">Auf der Küstenstraße starten ▸</button></div></div>`;
      m.querySelector('#hGo').onclick = () => close(best.w.id);
      m.querySelector('#hAlt')?.addEventListener('click', e => { e.preventDefault(); close(alt.w.id); });
      m.querySelector('#hAgain').onclick = () => { i = 0; step(); };
    };
    step();
  });
}

/** the Training tab; ctx = { state, saveSettings, startRide, routeById } */
export function trainingView(main, ctx) {
  const { state } = ctx, coast = ctx.routeById('kueste60') ? 'kueste60' : 'demo', ftp = state.settings.ftp || 200;
  main.innerHTML = `
  <section class="view">
    <div class="view-head"><div><div class="label">Training</div><h1 class="display" style="margin-top:14px">Work&shy;outs</h1>
      <div class="meta">${WORKOUTS.length} Standard-Workouts auf der ${coast === 'kueste60' ? 'Küstenstraße' : 'Felsenküste'} · Ziel-Watt aus deiner FTP (${ftp} W)</div></div>
      <div><button class="btn" id="helperBtn">Welches Workout passt heute? ▸</button></div></div>
    <label style="display:flex;gap:8px;align-items:center;margin:0 0 18px" title="Der Trainer hält die Zielwatt selbst"><input type="checkbox" class="toggle" id="ergChk2" ${state.settings.erg !== false ? 'checked' : ''}> ERG (Trainer hält die Watt)</label>
    <div class="wgrid">${WORKOUTS.map(w => { const m = META[w.id] || {}; return `<div class="panel wcard">
      <div class="label">${Math.round(workoutDuration(w) / 60)} min · ${HARD[m.hard] || ''}</div><h3>${esc(w.name)}</h3><p>${esc(w.what)}</p>${workoutSVG(w)}
      <button class="btn small" data-go="${w.id}">Starten ▸</button></div>`; }).join('')}</div>
  </section>`;
  const start = id => { state.settings.workout = id; ctx.saveSettings(); ctx.startRide(coast); };
  main.querySelectorAll('[data-go]').forEach(b => b.onclick = () => start(b.dataset.go));
  main.querySelector('#ergChk2').onchange = e => { state.settings.erg = e.target.checked; ctx.saveSettings(); };
  main.querySelector('#helperBtn').onclick = async () => { const id = await helperModal(); if (workoutById(id)) start(id); };
}
