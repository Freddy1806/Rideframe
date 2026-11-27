// Run workouts (27.11., the Workouts page's Running tile): RIDEFRAME had no run builder, so this is a small honest one: a warm-up,
// blocks and interval sets with an effort (easy … hard, shown with the heart-rate zone in bpm when the max HR is known) and a cool-down,
// in minutes only. They are kept in the settings (settings.runWorkouts, so they ride along to the account like the strength templates),
// can be planned for a day (js/weekplan.js, ref = the workout id) and Start opens the run recorder (outdoor.html?sport=run). The recorder
// does not guide the steps yet: the workout is the plan you follow, its shape and minutes are what you see.
// The model and the checks are pure (tools/runworkouts-test.mjs); the sheet below needs a page.
export const EFFORTS = [['easy', 'Easy', 1, 60], ['steady', 'Steady', 2, 70], ['tempo', 'Tempo', 3, 80], ['threshold', 'Threshold', 4, 88], ['hard', 'Hard', 5, 95]]; // [key, name, HR zone, % max HR]
export const RLIM = { name: 40, rows: 12, n: 30, min: 0.25, max: 180, count: 50 };
const EF = new Map(EFFORTS.map(e => [e[0], e]));
const num = (v, lo, hi, d) => { const x = +v; return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x * 4) / 4)) : d; };
export const newRunId = () => 'rw_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

/** a clean run workout or { error } */
export function validateRun(w) {
  if (!w || typeof w !== 'object') return { error: 'A workout.' };
  const name = String(w.name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, RLIM.name);
  if (!name) return { error: 'Give the workout a name.' };
  const rows = Array.isArray(w.rows) ? w.rows.slice(0, RLIM.rows) : [];
  const out = rows.map(r => r && r.t === 'i'
    ? { t: 'i', n: Math.round(num(r.n, 1, RLIM.n, 4)), on: num(r.on, RLIM.min, 60, 3), off: num(r.off, 0, 30, 2), tgt: EF.has(r.tgt) ? r.tgt : 'hard' }
    : { t: 'b', min: num(r?.min, RLIM.min, RLIM.max, 10), tgt: EF.has(r?.tgt) ? r.tgt : 'steady' });
  if (!out.length) return { error: 'Add at least one block or interval set.' };
  return { w: { id: /^rw_[\w]{4,30}$/.test(w.id) ? w.id : newRunId(), name, warm: num(w.warm, 0, 60, 10), cool: num(w.cool, 0, 60, 5), rows: out, updated: Date.now() } };
}
/** the steps in order: [{ min, tgt, label }] */
export function runSteps(w) {
  const s = []; if (w.warm > 0) s.push({ min: w.warm, tgt: 'easy', label: 'Warm-up' });
  for (const r of w.rows || []) {
    if (r.t === 'i') for (let i = 0; i < r.n; i++) { s.push({ min: r.on, tgt: r.tgt, label: `${EF.get(r.tgt)[1]} ${i + 1}/${r.n}` }); if (r.off > 0 && i < r.n - 1) s.push({ min: r.off, tgt: 'easy', label: 'Jog' }); }
    else s.push({ min: r.min, tgt: r.tgt, label: EF.get(r.tgt)[1] });
  }
  if (w.cool > 0) s.push({ min: w.cool, tgt: 'easy', label: 'Cool-down' });
  return s;
}
export const runMinutes = w => Math.round(runSteps(w).reduce((a, x) => a + x.min, 0));
/** one line: "10 min easy · 6 × 3 min hard / 2 min jog · 5 min easy" */
export function runLine(w) {
  const p = []; if (w.warm > 0) p.push(`${w.warm} min easy`);
  for (const r of w.rows || []) p.push(r.t === 'i' ? `${r.n} × ${r.on} min ${r.tgt}${r.off ? ` / ${r.off} min jog` : ''}` : `${r.min} min ${r.tgt}`);
  if (w.cool > 0) p.push(`${w.cool} min easy`); return p.join(' · ');
}
const COL = { easy: '#6b7480', steady: '#2fb36b', tempo: '#f2b630', threshold: 'var(--rc, #2fd3e0)', hard: 'var(--rc, #2fd3e0)' };
/** the shape as bars (height = effort), like js/workouts.js workoutSVG */
export function runSVG(w, h = 46) {
  const st = runSteps(w), tot = st.reduce((a, x) => a + x.min, 0) || 1; let x = 0;
  return `<svg viewBox="0 0 1000 ${h}" preserveAspectRatio="none" class="wsvg" aria-hidden="true">${st.map(s => { const bw = s.min / tot * 1000, bh = EF.get(s.tgt)[2] / 5 * h * .92 + h * .08;
    const r = `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(0.5, bw - 0.8).toFixed(1)}" height="${bh.toFixed(1)}" fill="${COL[s.tgt]}"${s.tgt === 'threshold' ? ' opacity=".75"' : ''}/>`; x += bw; return r; }).join('')}</svg>`;
}
export const TEMPLATES = [
  { name: 'Easy run 45', warm: 0, cool: 0, rows: [{ t: 'b', min: 45, tgt: 'easy' }] },
  { name: 'Intervals 6 × 3 min', warm: 12, cool: 8, rows: [{ t: 'i', n: 6, on: 3, off: 2, tgt: 'hard' }] },
  { name: 'Tempo 2 × 12 min', warm: 12, cool: 8, rows: [{ t: 'i', n: 2, on: 12, off: 3, tgt: 'tempo' }] },
];

/* ---------- the store (settings.runWorkouts) ---------- */
export async function loadRuns() { try { const { db } = await import('./db.js'); const s = (await db.kvGet('settings').catch(() => null)) || {}; return (s.runWorkouts || []).map(w => validateRun(w).w).filter(Boolean); } catch { return []; } }
async function store(f) {
  const { db } = await import('./db.js'), st = (await db.kvGet('settings').catch(() => null)) || {};
  st.runWorkouts = f((st.runWorkouts || []).slice()); await db.kvSet('settings', st);
  import('./account.js').then(a => a.settingsChanged?.(st)).catch(() => {}); return st.runWorkouts;
}
export const saveRun = w => store(l => { if (!l.some(x => x.id === w.id) && l.length >= RLIM.count) throw new Error(`At most ${RLIM.count} run workouts.`); return [w, ...l.filter(x => x.id !== w.id)]; });
export const deleteRun = id => store(l => l.filter(x => x.id !== id));

/* ---------- the builder sheet ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** opens the run builder; resolves the saved workout, { deleted } or null */
export function openRunBuilder({ draft = null, hrMax = 0 } = {}) {
  return new Promise(done => {
    const w = draft ? JSON.parse(JSON.stringify(draft)) : { name: '', warm: 10, cool: 5, rows: [{ t: 'i', n: 6, on: 3, off: 2, tgt: 'hard' }] };
    const s = document.createElement('div'); s.className = 'psheet'; s.id = 'rwSheet'; document.body.append(s);
    let err = '';
    const bpm = k => { const e = EF.get(k); return hrMax ? ` · Z${e[2]} ≈ ${Math.round(e[3] / 100 * hrMax)} bpm` : ` · Z${e[2]}`; };
    const effort = (i, v) => `<select data-r="${i}" data-k="tgt" aria-label="Effort">${EFFORTS.map(([k, n]) => `<option value="${k}"${k === v ? ' selected' : ''}>${n}${bpm(k)}</option>`).join('')}</select>`;
    const numIn = (i, k, v, lab, step = 0.5) => `<label class="rwn"><input type="number" inputmode="decimal" step="${step}" min="0" data-r="${i}" data-k="${k}" value="${v}" aria-label="${lab}"><small>${lab}</small></label>`;
    const close = v => { s.remove(); done(v); };
    const draw = () => {
      const v = validateRun({ ...w, name: w.name || 'x' }).w;
      s.innerHTML = `<div class="psheetin rwb" role="dialog" aria-modal="true" aria-labelledby="rwT"><div class="label" id="rwT">${draft ? 'Edit run workout' : 'New run workout'}</div>
        <input type="text" id="rwName" class="wbtitle rwname" maxlength="${RLIM.name}" value="${esc(w.name)}" placeholder="Name, e.g. Intervals 6 × 3 min" aria-label="Workout name">
        ${!draft ? `<div class="rwtpl">${TEMPLATES.map((t, i) => `<button type="button" class="fchip" data-tpl="${i}">${esc(t.name)}</button>`).join('')}</div>` : ''}
        ${v ? `<div class="rwshape">${runSVG(v, 54)}<small>${runMinutes(v)} min · ${esc(runLine(v))}</small></div>` : ''}
        <div class="rwrow rwfix"><b>Warm-up</b>${numIn('w', 'warm', w.warm, 'min easy', 1)}</div>
        ${w.rows.map((r, i) => `<div class="rwrow" data-i="${i}">${r.t === 'i'
          ? `<b>Intervals</b><div class="rwi">${numIn(i, 'n', r.n, '×', 1)}${numIn(i, 'on', r.on, 'min on')}${numIn(i, 'off', r.off, 'min jog')}</div>${effort(i, r.tgt)}`
          : `<b>Block</b><div class="rwi">${numIn(i, 'min', r.min, 'min', 1)}</div>${effort(i, r.tgt)}`}<button type="button" class="rwx" data-del="${i}" aria-label="Remove">✕</button></div>`).join('')}
        <div class="rwadd"><button type="button" class="btn ghost ksmall" id="rwAddI">+ Intervals</button><button type="button" class="btn ghost ksmall" id="rwAddB">+ Block</button></div>
        <div class="rwrow rwfix"><b>Cool-down</b>${numIn('c', 'cool', w.cool, 'min easy', 1)}</div>
        <p class="phint">Minutes and effort${hrMax ? ' (heart-rate zones from your max HR)' : ''}. Start opens the run recorder; it does not count the steps for you yet.</p>
        ${err ? `<p class="phint perr" role="alert">${esc(err)}</p>` : ''}
        <div class="pfoot">${draft ? '<button class="btn ghost" id="rwDel">Delete</button>' : '<button class="btn ghost" id="rwX">Cancel</button>'}<button class="btn" id="rwOk">Save</button></div></div>`;
      const q = x => s.querySelector(x);
      q('#rwName').oninput = e => { w.name = e.target.value; };
      s.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => { const k = inp.dataset.k, i = inp.dataset.r, val = k === 'tgt' ? inp.value : +inp.value;
        if (i === 'w' || i === 'c') w[k] = val; else w.rows[+i][k] = val; w.name = q('#rwName').value; draw(); });
      s.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { w.rows.splice(+b.dataset.del, 1); draw(); });
      s.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => { const t = TEMPLATES[+b.dataset.tpl]; Object.assign(w, JSON.parse(JSON.stringify(t))); draw(); });
      q('#rwAddI').onclick = () => { if (w.rows.length < RLIM.rows) w.rows.push({ t: 'i', n: 4, on: 4, off: 2, tgt: 'threshold' }); draw(); };
      q('#rwAddB').onclick = () => { if (w.rows.length < RLIM.rows) w.rows.push({ t: 'b', min: 20, tgt: 'steady' }); draw(); };
      q('#rwX')?.addEventListener('click', () => close(null));
      q('#rwDel')?.addEventListener('click', async () => { const { ask } = await import('./myworkouts-ui.js'); if (await ask({ title: 'Delete this run workout?', text: 'It is removed from your workouts for good.', buttons: [{ label: 'Keep it', value: null }, { label: 'Delete', value: 'del', cls: 'danger' }] }) !== 'del') return; await deleteRun(draft.id); close({ deleted: draft.id }); });
      q('#rwOk').onclick = async () => { w.name = q('#rwName').value; const r = validateRun(w); if (r.error) { err = r.error; return draw(); }
        try { await saveRun(r.w); close({ saved: r.w }); } catch (e) { err = e.message; draw(); } };
    };
    s.onclick = e => { if (e.target === s) close(null); }; draw();
  });
}
