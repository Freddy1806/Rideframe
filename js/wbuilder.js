// The workout builder (owner 24.11.: "rebuild the workout builder exactly like the one in Garmin Connect, really the same";
// before: "clean, very fast to use"). The flow and the step model of a bike-computer workout builder, in RIDEFRAME's own look:
// a title, the steps as cards with a coloured edge by step type (Warm up, Bike, Recover, Rest, Cool down, Other), each with
// its step type, duration (time, distance, lap button press, calories, heart rate, power) and intensity target (none, power
// zone, custom power, % FTP with ramps, heart rate zone, custom heart rate, cadence, speed), an optional secondary target and
// notes; "Add a step", "Add repeat" (a block ×N, steps dragged in and out), drag handles, a live summary and chart, Save.
// Desktop: the cards open, the summary beside them. Phone (≤ 700 px): compact cards, a tap opens the step in a sheet.
// One window, no chains: a value change never redraws the field you type in; delete has an Undo toast instead of a question.
// The model is js/myworkouts.js (v2); the ride runs it through js/workouts.js (runTick: steps that end by lap, distance …).
import { esc, fmtKm } from './util.js';
import { catalog } from './workouts.js';
import * as M from './myworkouts.js';
import { fitRoute, AFTER_PCT, FREE_PCT } from './routefit.js';
import { savePersonal, deletePersonal } from './myworkouts-store.js';

const $ = (s, r = document) => r.querySelector(s);
const PHONE = '(max-width: 700px)';
const opts = (list, cur) => list.map(([k, n]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(n)}</option>`).join('');
const clone = x => JSON.parse(JSON.stringify(x));
const mins = sec => `${Math.round(sec / 60)} min`;
const FIT_HOW = `Estimated with your FTP and weight at the workout's target watts (free blocks at ${FREE_PCT} %, after the workout ${AFTER_PCT} % FTP)`;
// starting values when a step's duration or target changes kind (a sensible value for the step type, the rider's numbers when known)
const BASE_PCT = { warmup: 60, work: 90, recover: 50, rest: 40, cooldown: 50, other: 65 };
function durDefault(kind, s, ctx) {
  if (kind === 'time') return { kind, sec: s.type === 'recover' ? 120 : s.type === 'rest' ? 60 : 600 };
  if (kind === 'distance') return { kind, m: 5000 };
  if (kind === 'calories') return { kind, kcal: 100 };
  if (kind === 'hr') { const down = /^(recover|rest|cooldown)$/.test(s.type); return { kind, op: down ? 'lt' : 'gt', bpm: ctx.hrMax ? Math.round((down ? 0.65 : 0.85) * ctx.hrMax) : down ? 120 : 155 }; }
  if (kind === 'power') return { kind, op: 'gt', w: ctx.ftp ? Math.round(ctx.ftp) : 200 };
  return { kind: 'lap' };
}
function tgtDefault(kind, s, ctx) {
  const p = BASE_PCT[s.type] ?? 65, f = ctx.ftp || 200;
  if (kind === 'powerZone') return { kind, zone: M.zoneOf(p) ? Math.min(7, M.ZONES.indexOf(M.zoneOf(p)) + 1) : 2 };
  if (kind === 'power') return { kind, lo: Math.round(p * 0.95 / 100 * f / 5) * 5, hi: Math.round(p * 1.05 / 100 * f / 5) * 5 };
  if (kind === 'ftp') return { kind, pct: p };
  if (kind === 'hrZone') return { kind, zone: s.type === 'work' ? 3 : 2 };
  if (kind === 'hr') return ctx.hrMax ? { kind, lo: Math.round(0.7 * ctx.hrMax), hi: Math.round(0.8 * ctx.hrMax) } : { kind, lo: 130, hi: 150 };
  if (kind === 'cadence') return { kind, lo: 85, hi: 95 };
  if (kind === 'speed') return { kind, lo: 28, hi: 32 };
  return { kind: 'none' };
}

/** opens the builder. draft = a v2 workout (or an old one: converted without loss); saved = it exists already; ftp, hrMax:
 *  the rider's numbers (watts and bpm next to zones); route = { id, name, track?, settings?, laps? } it is made for;
 *  ask = the in-page question (js/myworkouts-ui.js). Resolves { saved } | { deleted } | null. */
export function openBuilder({ draft, saved = false, ftp = 0, hrMax = 0, route = null, ask, autoName = false, nameFor = null }) {
  return new Promise(done => {
    const w = M.toV2(draft); if (route?.id && !w.routeId) { w.routeId = route.id; w.routeName = String(route.name || '').slice(0, M.LIM.name); }
    w.notes ||= '';
    const ctx = { ftp: +ftp || 0, hrMax: +hrMax || 0 };
    const key = () => JSON.stringify([String(w.name).trim(), w.notes, w.steps, w.base]), start = key(), dirty = () => key() !== start;
    let sel = '', sheet = null, undo = null, toastT = 0;
    const phone = () => matchMedia(PHONE).matches;
    const m = document.createElement('div'); m.className = 'modal mwmodal wbmodal';
    m.innerHTML = `<div class="box mwbox wb" role="dialog" aria-modal="true" aria-labelledby="mwTitle">
      <header class="wbhead">
        <div class="wbhl"><div class="label" id="mwTitle">${saved ? 'Edit workout' : 'New workout'} · Bike${w.routeName ? ` · for ${esc(w.routeName)}` : ''}</div>
          <input type="text" id="mwName" class="wbtitle" maxlength="${M.LIM.name}" value="${esc(w.name)}" autocomplete="off" aria-label="Workout name" placeholder="Workout name"></div>
        <button type="button" class="mwx" id="mwClose" aria-label="Close">✕</button></header>
      <div class="wbmain" data-pnwide>
        <section class="wbcol" aria-label="Steps">
          <div class="wblist" id="wbList"></div>
          <div class="wbadd"><button type="button" class="btn ghost small" id="wbAddStep">+ Add a step</button><button type="button" class="btn ghost small" id="wbAddRep">+ Add repeat</button></div>
        </section>
        <aside class="wbside">
          <div class="wbsum mwsum" id="mwSum"></div>
          <div class="mwgwrap wbchart" id="mwGraph"></div>
          <label class="wbnotes"><span class="label">Workout notes</span><textarea id="wbNotes" rows="3" maxlength="${M.L2.notes}" placeholder="What this session is for, how to ride it">${esc(w.notes)}</textarea></label>
          <label class="wbbase"><span class="label">Start from a standard workout</span><select id="wbBase"><option value="">Choose to replace the steps …</option>${catalog().map(b => `<option value="${esc(b.id)}"${b.id === w.base ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
          <p class="mwerr" id="mwErr" role="alert"></p>
          <div class="actions mwacts wbacts">${saved ? '<button type="button" class="btn danger small" id="mwDel">Delete</button>' : ''}<span class="mwsp"></span>
            <button type="button" class="btn ghost small" id="mwCancel">Cancel</button>${saved ? '<button type="button" class="btn ghost small" id="mwSaveNew">Save as new</button>' : ''}<button type="button" class="btn small mwsave" id="mwSave">Save workout</button></div>
        </aside>
      </div>
      <div class="wbtoast" id="wbToast" role="status" hidden><span></span><button type="button" class="btn ghost small" id="wbUndo">Undo</button></div></div>`;
    document.body.append(m);
    const box = $('.wb', m), list = $('#wbList', m);
    const err = t => { $('#mwErr', m).textContent = t || ''; };

    /* ---------- the model by path: "i" = item i, "i.j" = step j of the repeat at i ---------- */
    const get = p => { const [i, j] = String(p).split('.').map(Number); const x = w.steps[i]; return j == null || Number.isNaN(j) ? x : x?.steps?.[j]; };
    const arrOf = p => { const [i, j] = String(p).split('.').map(Number); return j == null || Number.isNaN(j) ? w.steps : w.steps[i].steps; };
    const pathOf = obj => { for (const [i, x] of w.steps.entries()) { if (x === obj) return String(i); if (x.repeat) { const j = x.steps.indexOf(obj); if (j >= 0) return `${i}.${j}`; } } return ''; };
    const count = () => M.countSteps(w.steps);
    const tidy = () => { w.steps = w.steps.filter(x => !x.repeat || x.steps.length); for (const x of w.steps) if (x.repeat && !(x.steps.length > 1 && /^(recover|rest)$/.test(x.steps.at(-1).type))) delete x.skipLast; };

    /* ---------- HTML ---------- */
    const durHTML = (s, pre = '') => { const d = s.dur, n = `${pre}`;
      if (d.kind === 'time') return `<label class="wbin"><input type="text" data-f="${n}sec" value="${M.fmtDur(d.sec)}" inputmode="decimal" autocomplete="off" placeholder="mm:ss" aria-label="Time, minutes:seconds"><small>h:mm:ss</small></label>`;
      if (d.kind === 'distance') return `<label class="wbin"><input type="number" data-f="km" value="${Math.round(d.m) / 1000}" min="0.05" max="300" step="0.1" inputmode="decimal" aria-label="Distance in km"><small>km</small></label>`;
      if (d.kind === 'calories') return `<label class="wbin"><input type="number" data-f="kcal" value="${d.kcal}" min="1" max="5000" step="10" inputmode="numeric" aria-label="Calories"><small>kcal</small></label>`;
      if (d.kind === 'hr' || d.kind === 'power') { const hr = d.kind === 'hr';
        return `<span class="wbin2"><select data-f="dop" aria-label="Until ${hr ? 'heart rate' : 'power'} is">${opts([['gt', 'above'], ['lt', 'below']], d.op)}</select><label class="wbin"><input type="number" data-f="${hr ? 'bpm' : 'dw'}" value="${hr ? d.bpm : d.w}" min="${hr ? 40 : 20}" max="${hr ? 230 : 2000}" step="1" inputmode="numeric" aria-label="${hr ? 'Heart rate in bpm' : 'Power in watts'}"><small>${hr ? 'bpm' : 'W'}</small></label></span>`; }
      return `<span class="wbhint">Until you press <b>Lap</b> / <b>Next step</b></span>`; };
    const rangeHTML = (t, pre, unit, lim, step = 1) => `<span class="wbin2"><label class="wbin"><input type="number" data-f="${pre}lo" value="${t.lo}" min="${lim[0]}" max="${lim[1]}" step="${step}" inputmode="decimal" aria-label="Low ${unit}"></label><span class="wbdash">–</span><label class="wbin"><input type="number" data-f="${pre}hi" value="${t.hi}" min="${lim[0]}" max="${lim[1]}" step="${step}" inputmode="decimal" aria-label="High ${unit}"><small>${unit}</small></label></span>`;
    const tgtHTML = (s, second = false) => { const t = second ? s.target2 : s.target, pre = second ? '2' : '';
      if (t.kind === 'powerZone') return `<select data-f="${pre}zone" class="wbzone" aria-label="Power zone">${M.ZONE_PCT.map(([lo, hi], i) => `<option value="${i + 1}"${t.zone === i + 1 ? ' selected' : ''}>Zone ${i + 1} · ${lo}–${hi} %${ctx.ftp ? ` · ${M.watts(lo, ctx.ftp)}–${M.watts(hi, ctx.ftp)} W` : ''}</option>`).join('')}</select>`;
      if (t.kind === 'hrZone') return `<select data-f="${pre}zone" class="wbzone" aria-label="Heart rate zone">${M.HR_ZONES.map(([lo, hi], i) => `<option value="${i + 1}"${t.zone === i + 1 ? ' selected' : ''}>Zone ${i + 1} · ${lo}–${hi} % max${ctx.hrMax ? ` · ${Math.round(lo / 100 * ctx.hrMax)}–${Math.round(hi / 100 * ctx.hrMax)} bpm` : ''}</option>`).join('')}</select>`;
      if (t.kind === 'power') return rangeHTML(t, pre, 'W', M.L2.w);
      if (t.kind === 'hr') return rangeHTML(t, pre, 'bpm', M.L2.bpm);
      if (t.kind === 'cadence') return rangeHTML(t, pre, 'rpm', M.L2.rpm);
      if (t.kind === 'speed') return rangeHTML(t, pre, 'km/h', M.L2.kmh, 0.5);
      if (t.kind === 'ftp') { const timed = s.dur.kind === 'time';
        return `<span class="wbin2"><label class="wbin"><input type="number" data-f="pct" value="${t.pct}" min="30" max="200" step="1" inputmode="numeric" aria-label="Percent of FTP"><small>%</small></label>${timed ? `<span class="wbdash" title="Ramp: the target moves evenly to this % over the step. Empty = flat.">→</span><label class="wbin wbramp"><input type="number" data-f="pct2" value="${t.pct2 ?? ''}" min="30" max="200" step="1" inputmode="numeric" placeholder="flat" aria-label="Ramp to percent of FTP, empty for flat"><small>%</small></label>` : ''}<b class="wbw" data-w>${wText(t)}</b></span>`; }
      return `<span class="wbhint">${second ? '' : 'Free riding: no ERG'}</span>`; };
    const wText = t => !ctx.ftp ? '' : t.pct2 != null ? `${M.watts(t.pct, ctx.ftp)} → ${M.watts(t.pct2, ctx.ftp)} W` : `${M.watts(t.pct, ctx.ftp)} W`;
    const sumText = s => `${M.durText(s.dur)} · ${M.tgtText(s.target, ctx)}${s.target2 ? ' + ' + M.tgtText(s.target2, ctx).replace(/ · .*/, '') : ''}`;
    const fieldsHTML = (s, p) => `<div class="wbfields" data-p="${p}">
        <div class="wbf wbft"><label class="label" for="wbY${p}">Step type</label><select data-f="type" class="wbtype" id="wbY${p}">${opts(M.STEP_TYPES.map(([k, n]) => [k, n]), s.type)}</select></div>
        <div class="wbf wbfd"><label class="label" for="wbD${p}">Duration</label><div class="wbpair"><select data-f="dk" id="wbD${p}">${opts(M.DUR_KINDS, s.dur.kind)}</select>${durHTML(s)}</div></div>
        <div class="wbf wbfg"><label class="label" for="wbT${p}">Intensity target</label><div class="wbpair"><select data-f="tk" id="wbT${p}">${opts(M.TGT_KINDS, s.target.kind)}</select>${tgtHTML(s)}</div></div>
        ${s.target2 ? `<div class="wbf wbfg2"><label class="label" for="wbS${p}">Secondary target</label><div class="wbpair"><select data-f="t2k" id="wbS${p}">${opts(M.TGT2_KINDS, s.target2.kind)}</select>${tgtHTML(s, true)}<button type="button" class="wbicon" data-a="t2del" aria-label="Remove the secondary target" title="Remove">✕</button></div></div>` : ''}
        <div class="wbf wbfn">${s.note != null && (s.note !== '' || sel === p + ':note') ? `<label class="label" for="wbN${p}">Notes</label><textarea data-f="note" id="wbN${p}" rows="2" maxlength="${M.L2.note}" placeholder="Shown on the ride screen during this step">${esc(s.note)}</textarea>` : `<button type="button" class="wblink" data-a="note">+ Add notes</button>`}${s.target2 ? '' : `<button type="button" class="wblink" data-a="t2add">+ Secondary target</button>`}</div>
      </div>`;
    const moveBtns = (p, label) => `<button type="button" class="wbicon" data-a="up" aria-label="Move ${label} up" title="Move up">↑</button><button type="button" class="wbicon" data-a="down" aria-label="Move ${label} down" title="Move down">↓</button>`;
    const grip = (p, label) => `<button type="button" class="wbgrip" data-drag="${p}" aria-label="Drag to move ${label} (or ↑ ↓ keys)" title="Drag to move"><i></i><i></i><i></i></button>`;
    const stepNo = p => { const f = M.flatSteps(w.steps).findIndex(x => x.path === p); return f + 1; };
    const cardHTML = (s, p) => { const lbl = `${M.typeName(s.type)} step`;
      return phone()
        ? `<div class="wbcard compact${sel === p ? ' sel' : ''}" data-p="${p}" style="--tc:${M.typeColor(s.type)}">${grip(p, lbl)}<button type="button" class="wbopen" data-a="open" aria-label="Edit ${esc(lbl)}: ${esc(sumText(s))}"><b>${esc(s.label || M.typeName(s.type))}</b><span class="wbsumtxt">${esc(sumText(s))}</span>${s.note ? `<small class="wbnote1">${esc(s.note)}</small>` : ''}</button><span class="wbchev" aria-hidden="true">›</span></div>`
        : `<div class="wbcard${sel === p ? ' sel' : ''}" data-p="${p}" style="--tc:${M.typeColor(s.type)}">${grip(p, lbl)}<div class="wbcbody">${s.label ? `<div class="wblab">${esc(s.label)}</div>` : ''}${fieldsHTML(s, p)}</div><div class="wbcact">${moveBtns(p, lbl)}<button type="button" class="wbicon wbdel" data-a="del" aria-label="Delete ${esc(lbl)}" title="Delete step">✕</button></div></div>`; };
    const repHTML = (r, i) => { const p = String(i), canSkip = r.steps.length > 1 && /^(recover|rest)$/.test(r.steps.at(-1).type);
      return `<div class="wbrep${sel === p ? ' sel' : ''}" data-p="${p}">
        <div class="wbrephead">${grip(p, 'repeat block')}<span class="wbrepl">Repeat</span>
          <span class="wbstep" role="group" aria-label="Times"><button type="button" class="wbicon" data-a="rep-" aria-label="One time less">−</button><input type="number" data-f="rep" value="${r.repeat}" min="1" max="99" inputmode="numeric" aria-label="Repeat how many times"><button type="button" class="wbicon" data-a="rep+" aria-label="One time more">+</button></span><span class="wbx">times</span>
          <span class="wbrepact">${phone() ? '' : moveBtns(p, 'repeat block')}<button type="button" class="wbicon wbdel" data-a="del" aria-label="Delete repeat block" title="Delete repeat">✕</button></span></div>
        ${canSkip ? `<label class="wbskip"><input type="checkbox" data-f="skip"${r.skipLast ? ' checked' : ''}> Skip the last ${M.typeName(r.steps.at(-1).type).toLowerCase()} step</label>` : ''}
        <div class="wbrepsteps" data-in="${i}">${r.steps.map((s, j) => cardHTML(s, `${i}.${j}`)).join('')}</div>
        <button type="button" class="wblink wbaddin" data-a="addin">+ Add a step to the repeat</button></div>`; };

    /* ---------- drawing ---------- */
    const scroller = () => phone() ? box : box; // the box scrolls (css): the page behind stays put
    const drawList = (focus = null) => {
      const top = scroller().scrollTop;
      list.innerHTML = w.steps.map((x, i) => x.repeat ? repHTML(x, i) : cardHTML(x, String(i))).join('');
      scroller().scrollTop = top; refresh();
      if (focus) { const el = typeof focus === 'string' ? $(focus, m) : focus; el?.focus({ preventScroll: true }); }
      const full = count() >= M.LIM.steps; $('#wbAddStep', m).disabled = full; $('#wbAddRep', m).disabled = count() + 2 > M.LIM.steps;
    };
    const refresh = () => { // summary, chart, route fit: after every change, cheap
      const sm = M.summary2(w.steps, ctx.ftp || undefined), aw = M.watts(sm.avg, ctx.ftp);
      let fit = ''; const f = route?.track ? fitRoute(route.track, M.toRide2(w), { ...route.settings, ftp: ctx.ftp || route.settings?.ftp }, { laps: route.laps }) : null;
      if (f) { const on = `${esc(route.name)}${f.laps > 1 ? ` (${f.laps} laps)` : ''}`;
        fit = f.verdict === 'short' ? `<p class="mwwarn" id="mwWarn" title="${FIT_HOW}">⚠ ${on} ends after about ${mins(f.routeSec)}, the workout needs ${mins(sm.sec)}. Shorten it or ride more laps.</p>`
          : f.verdict === 'long' ? `<p class="mwfit" id="mwFit" title="${FIT_HOW}">${on} takes about ${mins(f.routeSec)}: the workout ends at km ${fmtKm(f.endD)} of ${fmtKm(route.track.length)}${f.laps > 1 ? ` in lap ${f.endLap}` : ''}, the rest is free riding.</p>`
          : `<p class="mwfit" id="mwFit" title="${FIT_HOW}">Fits ${on}: about ${mins(f.routeSec)} at these watts${f.spare >= 60 ? `, ${mins(f.spare)} to spare` : ''}.</p>`; }
      const est = sm.exact ? '' : '~';
      $('#mwSum', m).innerHTML = `<span><b id="mwTotal">${est}${M.fmtDur(sm.sec)}</b><small>${sm.exact ? 'total time' : 'est. time'}</small></span>
        <span title="${sm.mExact ? '' : `Estimated: ${M.EST.kmh} km/h at ${M.EST.kmhPct} % FTP on the flat`}"><b>${sm.mExact ? '' : '~'}${fmtKm(sm.m)} km</b><small>${sm.mExact ? 'distance' : 'est. distance'}</small></span>
        <span><b>${sm.avg ? sm.avg + ' %' : '–'}</b><small>${sm.avg ? `avg FTP${aw ? ` · ${aw} W` : ''}` : 'no power targets'}</small></span><span><b>${sm.steps}</b><small>steps</small></span>${fit}
        ${sm.exact ? '' : `<p class="wbassume">~ Open steps are estimated: lap button ${M.EST.lap / 60} min, heart rate / power ${M.EST.hr / 60} / ${M.EST.power / 60} min, distance at ${M.EST.kmh} km/h, calories at the step's watts.</p>`}`;
      $('#mwGraph', m).innerHTML = M.chartSVG(w.steps, { h: 110, mark: sel, ftp: ctx.ftp || undefined });
    };
    const redrawCard = (p, focusF) => { // one card (or the sheet) after a kind change: the rest of the list stays as it is
      const s = get(p), el = list.querySelector(`.wbcard[data-p="${p}"]`);
      if (el) { const t = document.createElement('div'); t.innerHTML = cardHTML(s, p); el.replaceWith(t.firstElementChild); }
      if (sheet && sheet.p === p) sheetBody();
      if (focusF) { const root = sheet && sheet.p === p ? sheet.el : list.querySelector(`.wbcard[data-p="${p}"]`); root?.querySelector(`[data-f="${focusF}"]`)?.focus({ preventScroll: true }); }
      refresh();
    };
    const cardInfo = p => { const el = list.querySelector(`.wbcard[data-p="${p}"]`), s = get(p); if (!el || !s) return;
      const t = el.querySelector('.wbsumtxt'); if (t) t.textContent = sumText(s); el.style.setProperty('--tc', M.typeColor(s.type));
      for (const root of [el, sheet?.p === p ? sheet.el : null]) { const b = root?.querySelector('[data-w]'); if (b && s.target.kind === 'ftp') b.textContent = wText(s.target); } };

    /* ---------- the phone's step sheet ---------- */
    const sheetBody = () => { if (!sheet) return; const s = get(sheet.p); if (!s) return closeSheet();
      sheet.el.querySelector('.wbsbody').innerHTML = fieldsHTML(s, sheet.p);
      sheet.el.querySelector('.wbshead b').textContent = `Step ${stepNo(sheet.p)} · ${M.typeName(s.type)}`; sheet.el.style.setProperty('--tc', M.typeColor(s.type)); };
    const openSheet = p => {
      closeSheet(); sel = p; const el = document.createElement('div'); el.className = 'wbsheetwrap';
      el.innerHTML = `<div class="wbsheet" role="dialog" aria-label="Edit step"><div class="wbshead"><b></b><span class="wbsp"></span>${moveBtns(p, 'step')}<button type="button" class="wbicon wbdel" data-a="del" aria-label="Delete step" title="Delete step">✕</button></div>
        <div class="wbsbody" data-p="${p}"></div><div class="wbsfoot"><button type="button" class="btn small mwsave" data-a="done">Done</button></div></div>`;
      m.append(el); sheet = { p, el }; sheetBody();
      el.addEventListener('click', e => { if (e.target === el) closeSheet(); });
      el.querySelector('.wbsheet [data-f="type"]')?.focus({ preventScroll: true });
      list.querySelectorAll('.wbcard').forEach(c => c.classList.toggle('sel', c.dataset.p === p)); refresh();
    };
    function closeSheet() { if (!sheet) return; const p = sheet.p; sheet.el.remove(); sheet = null; list.querySelector(`.wbcard[data-p="${p}"] .wbopen`)?.focus({ preventScroll: true }); }

    /* ---------- changes ---------- */
    const snapshot = () => clone(w.steps);
    const toast = (text, steps) => { undo = steps; const t = $('#wbToast', m); t.querySelector('span').textContent = text; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; undo = null; }, 7000); };
    $('#wbUndo', m).onclick = () => { if (!undo) return; w.steps = undo; undo = null; $('#wbToast', m).hidden = true; closeSheet(); drawList(); err(); };
    const del = p => { const before = snapshot(), x = get(p), arr = arrOf(p);
      if (!x.repeat && w.steps.length === 1 && arr === w.steps) return err('A workout needs at least one step.');
      arr.splice(arr.indexOf(x), 1); tidy(); closeSheet(); sel = ''; drawList(); err();
      toast(x.repeat ? 'Repeat deleted' : 'Step deleted', before); $('#wbUndo', m).focus({ preventScroll: true }); };
    /** ↑ / ↓ (buttons, keys on the drag handle): items swap; a step goes into a neighbouring repeat block and out at its ends */
    const move = (p, d) => {
      const x = get(p), [i, j] = p.split('.').map(Number), inRep = !Number.isNaN(j) && j != null;
      if (inRep) { const r = w.steps[i], a = r.steps, k = j + d;
        if (k >= 0 && k < a.length) [a[j], a[k]] = [a[k], a[j]];
        else { a.splice(j, 1); w.steps.splice(d < 0 ? i : i + 1, 0, x); }
      } else { const k = i + d, n = w.steps[k];
        if (k < 0 || k >= w.steps.length) return;
        if (!x.repeat && n?.repeat && n.steps.length < M.L2.inRep) { w.steps.splice(i, 1); d < 0 ? n.steps.push(x) : n.steps.unshift(x); }
        else [w.steps[i], w.steps[k]] = [w.steps[k], w.steps[i]]; }
      tidy(); const np = pathOf(x); sel = np; drawList(); if (sheet) { sheet.p = np; sheetBody(); }
      const g = list.querySelector(`[data-drag="${np}"]`); (document.activeElement?.dataset?.a === 'up' || document.activeElement?.dataset?.a === 'down') && !sheet
        ? list.querySelector(`[data-p="${np}"] [data-a="${d < 0 ? 'up' : 'down'}"]`)?.focus({ preventScroll: true }) : !sheet && g?.focus({ preventScroll: true });
      g?.closest('[data-p]')?.scrollIntoView({ block: 'nearest' }); err(); };
    const add = (item, into = null) => {
      const n = item.repeat ? item.repeat * item.steps.length : 1; if (count() + n > M.LIM.steps) return err(`At most ${M.LIM.steps} steps with the repeats counted.`);
      if (into != null) { const r = w.steps[into]; if (r.steps.length >= M.L2.inRep) return err(`At most ${M.L2.inRep} steps in a repeat.`); r.steps.push(item); } else w.steps.push(item);
      tidy(); const p = pathOf(item.repeat ? item : item); sel = item.repeat ? '' : p; drawList(); err();
      const el = list.querySelector(`[data-p="${p}"]`); el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (phone() && !item.repeat) openSheet(p); else el?.querySelector(item.repeat ? '[data-f="rep"]' : '[data-f="type"]')?.focus({ preventScroll: true });
    };
    $('#wbAddStep', m).onclick = () => add(M.newStep('work'));
    $('#wbAddRep', m).onclick = () => add(M.newRepeat());
    const setRep = (i, n) => { const r = w.steps[i], other = count() - r.repeat * r.steps.length, max = Math.min(M.L2.rep[1], Math.floor((M.LIM.steps - other + (r.skipLast ? 1 : 0)) / r.steps.length));
      r.repeat = Math.max(1, Math.min(max, n)); return r.repeat; };

    // values: written into the model while typing (when valid), the field itself is never redrawn
    const num = v => parseFloat(String(v).replace(',', '.'));
    const setVal = (p, f, el) => {
      const s = get(p); if (!s) return; let ok = true; const v = num(el.value);
      const inr = (x, [lo, hi]) => Number.isFinite(x) && x >= lo && x <= hi;
      switch (f) {
        case 'sec': { const sec = M.parseDur(String(el.value).replace(/[.,]/g, ':')); ok = inr(sec, M.L2.sec); if (ok) s.dur.sec = sec; break; }
        case 'km': ok = inr(v * 1000, M.L2.m); if (ok) s.dur.m = Math.round(v * 1000); break;
        case 'kcal': ok = inr(v, M.L2.kcal); if (ok) s.dur.kcal = Math.round(v); break;
        case 'bpm': ok = inr(v, M.L2.bpm); if (ok) s.dur.bpm = Math.round(v); break;
        case 'dw': ok = inr(v, M.L2.w); if (ok) s.dur.w = Math.round(v); break;
        case 'pct': ok = inr(v, M.L2.pct); if (ok) { s.target.pct = Math.round(v); if (s.target.pct2 === s.target.pct) delete s.target.pct2; } break;
        case 'pct2': if (String(el.value).trim() === '') { delete s.target.pct2; break; } ok = inr(v, M.L2.pct); if (ok) { s.target.pct2 = Math.round(v); if (s.target.pct2 === s.target.pct) delete s.target.pct2; } break;
        case 'lo': case 'hi': case '2lo': case '2hi': { const t = f[0] === '2' ? s.target2 : s.target, k = f.replace('2', ''), lim = M.L2[{ power: 'w', hr: 'bpm', cadence: 'rpm', speed: 'kmh' }[t.kind]];
          ok = inr(v, lim); if (ok) t[k] = t.kind === 'speed' ? Math.round(v * 10) / 10 : Math.round(v); break; }
        case 'note': s.note = String(el.value).slice(0, M.L2.note); break;
        default: return;
      }
      el.classList.toggle('bad', !ok); el.setAttribute('aria-invalid', String(!ok));
      if (!ok) return err({ sec: 'Time: 0:05 to 6:00:00 (mm:ss or h:mm:ss)', km: 'Distance: 0.05 to 300 km', kcal: 'Calories: 1 to 5000', bpm: 'Heart rate: 40 to 230 bpm', dw: 'Power: 20 to 2000 W', pct: '% FTP: 30 to 200', pct2: 'Ramp: 30 to 200 % FTP, empty = flat' }[f] || 'Out of range.');
      err(); cardInfo(p); refresh();
    };
    const setKind = (p, f, v) => {
      const s = get(p); if (!s) return;
      if (f === 'type') { s.type = v; tidy(); if (p.includes('.')) { drawList(); if (sheet) sheetBody(); list.querySelector(`.wbcard[data-p="${p}"] [data-f="type"]`)?.focus({ preventScroll: true }); return; } }
      if (f === 'dk') { s.dur = durDefault(v, s, ctx); if (s.target.kind === 'ftp' && v !== 'time') delete s.target.pct2; }
      if (f === 'tk') s.target = tgtDefault(v, s, ctx);
      if (f === 't2k') { if (v === 'none') delete s.target2; else s.target2 = tgtDefault(v, s, ctx); }
      if (f === 'zone' || f === '2zone') (f === 'zone' ? s.target : s.target2).zone = +v;
      if (f === 'dop') s.dur.op = v;
      if (f === 'zone' || f === '2zone' || f === 'dop') { cardInfo(p); return refresh(); }
      redrawCard(p, f);
    };
    const fieldsOf = el => el.closest('[data-p]');
    m.addEventListener('input', e => {
      const el = e.target, f = el.dataset?.f; if (!f) return;
      if (f === 'rep') { const r = fieldsOf(el); const n = Math.round(num(el.value)); if (Number.isFinite(n) && n >= 1) { const got = setRep(+r.dataset.p, n); el.classList.toggle('bad', got !== n); err(got !== n ? `Repeat: 1 to ${got} times here (at most ${M.LIM.steps} steps in all).` : ''); refresh(); } else el.classList.add('bad'); return; }
      if (el.tagName === 'SELECT' || f === 'skip') return; // selects / checkbox: on change
      const host = fieldsOf(el); if (host) setVal(host.dataset.p, f, el);
    });
    m.addEventListener('change', e => {
      const el = e.target, f = el.dataset?.f; if (!f) return; const host = fieldsOf(el); if (!host) return;
      if (f === 'skip') { w.steps[+host.dataset.p].skipLast = el.checked; tidy(); return refresh(); }
      if (f === 'rep') { el.value = w.steps[+host.dataset.p].repeat; el.classList.remove('bad'); return; }
      if (el.tagName === 'SELECT') return setKind(host.dataset.p, f, el.value);
      // leaving a value field: back to the last good value, written the way it is stored (1:5 → 1:05)
      const s = get(host.dataset.p); if (!s) return;
      const back = { sec: () => M.fmtDur(s.dur.sec), km: () => s.dur.m / 1000, kcal: () => s.dur.kcal, bpm: () => s.dur.bpm, dw: () => s.dur.w, pct: () => s.target.pct, pct2: () => s.target.pct2 ?? '', lo: () => s.target.lo, hi: () => s.target.hi, '2lo': () => s.target2?.lo, '2hi': () => s.target2?.hi }[f];
      if (back) { el.value = back(); el.classList.remove('bad'); el.removeAttribute('aria-invalid'); err(); }
    });
    m.addEventListener('focusin', e => { const c = e.target.closest?.('.wbcard[data-p], .wbrep[data-p]'); if (c && c.dataset.p !== sel && !sheet) { sel = c.dataset.p; list.querySelectorAll('.wbcard, .wbrep').forEach(x => x.classList.toggle('sel', x.dataset.p === sel)); $('#mwGraph', m).innerHTML = M.chartSVG(w.steps, { h: 110, mark: sel, ftp: ctx.ftp || undefined }); } });
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b || !m.contains(b)) return;
      const a = b.dataset.a, host = sheet?.el.contains(b) ? { dataset: { p: sheet.p } } : b.closest('[data-p]'), p = host?.dataset.p;
      if (a === 'done') return closeSheet();
      if (p == null) return;
      if (a === 'open') return openSheet(p);
      if (a === 'del') return del(p);
      if (a === 'up' || a === 'down') return move(p, a === 'up' ? -1 : 1);
      if (a === 'rep-' || a === 'rep+') { const inp = host.querySelector('[data-f="rep"]'); inp.value = setRep(+p, w.steps[+p].repeat + (a === 'rep+' ? 1 : -1)); inp.classList.remove('bad'); err(); return refresh(); }
      if (a === 'addin') return add(M.newStep('work', { dur: { kind: 'time', sec: 60 } }), +p);
      if (a === 'note') { const s = get(p); s.note = s.note || ''; sel = p + ':note'; redrawCard(p, 'note'); sel = p; return; }
      if (a === 't2add') { const s = get(p); s.target2 = tgtDefault('cadence', s, ctx); return redrawCard(p, 't2k'); }
      if (a === 't2del') { delete get(p).target2; return redrawCard(p, 'tk'); }
    });
    // the chart: a tap on a bar opens its step
    $('#mwGraph', m).addEventListener('click', e => { const p = e.target.closest('[data-p]')?.dataset.p; if (p == null) return; sel = p;
      if (phone()) return openSheet(p);
      const c = list.querySelector(`.wbcard[data-p="${p}"]`); list.querySelectorAll('.wbcard, .wbrep').forEach(x => x.classList.toggle('sel', x.dataset.p === p)); refresh();
      c?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); c?.querySelector('[data-f="dk"]')?.focus({ preventScroll: true }); });

    /* ---------- drag and drop by the handles (pointer events: mouse, touch, pen) ---------- */
    let drag = null;
    const slotAt = (x, y) => {
      const d = drag, it = get(d.p), isRep = !!it.repeat;
      if (!isRep) for (const rb of list.querySelectorAll('.wbrep')) { // over a repeat block: into it
        const inn = rb.querySelector('.wbrepsteps'), r = rb.getBoundingClientRect(); if (y < r.top + 20 || y > r.bottom - 6 || x < r.left || x > r.right) continue;
        const cards = [...inn.querySelectorAll(':scope > .wbcard')].filter(c => c !== d.el);
        const before = cards.find(c => { const q = c.getBoundingClientRect(); return y < q.top + q.height / 2; });
        const ir = inn.getBoundingClientRect(), lastR = cards.at(-1)?.getBoundingClientRect();
        return { rep: +rb.dataset.p, before: before?.dataset.p ?? null, y: before ? before.getBoundingClientRect().top - 4 : lastR ? lastR.bottom + 3 : ir.top + 2, x0: ir.left, x1: ir.right };
      }
      const items = [...list.children].filter(c => c !== d.el);
      const before = items.find(c => { const q = c.getBoundingClientRect(); return y < q.top + q.height / 2; });
      const lr = list.getBoundingClientRect(), last = items.at(-1)?.getBoundingClientRect();
      return { rep: null, before: before?.dataset.p ?? null, y: before ? before.getBoundingClientRect().top - 5 : last ? last.bottom + 4 : lr.top, x0: lr.left, x1: lr.right };
    };
    const dragMove = e => {
      if (!drag || e.pointerId !== drag.id) return; e.preventDefault();
      drag.x = e.clientX; drag.y = e.clientY; drag.ghost.style.transform = `translate(${0}px, ${e.clientY - drag.y0}px)`;
      const s = drag.slot = slotAt(e.clientX, e.clientY), ln = drag.line;
      ln.style.top = s.y + 'px'; ln.style.left = s.x0 + 'px'; ln.style.width = (s.x1 - s.x0) + 'px'; ln.classList.toggle('in', s.rep != null);
    };
    const autoScroll = () => { if (!drag) return; const sc = scroller(), r = sc.getBoundingClientRect(), y = drag.y, edge = 70;
      const v = y < r.top + edge ? -Math.ceil((r.top + edge - y) / 6) : y > r.bottom - edge ? Math.ceil((y - (r.bottom - edge)) / 6) : 0;
      if (v) { sc.scrollTop += v; dragMove({ clientX: drag.x, clientY: drag.y, pointerId: drag.id, preventDefault() {} }); }
      drag.raf = requestAnimationFrame(autoScroll); };
    const dragEnd = (e, cancel) => {
      if (!drag || (e && e.pointerId !== drag.id)) return; const d = drag; drag = null; cancelAnimationFrame(d.raf);
      d.ghost.remove(); d.line.remove(); d.el.classList.remove('dragging'); box.classList.remove('wbdragging');
      document.removeEventListener('pointermove', dragMove); document.removeEventListener('pointerup', onUp); document.removeEventListener('pointercancel', onCancel);
      if (cancel || !d.slot || !d.moved) return;
      const item = get(d.p), beforeObj = d.slot.before != null ? get(d.slot.before) : null, target = d.slot.rep != null ? w.steps[d.slot.rep] : null;
      if (target && target.steps.length >= M.L2.inRep && !target.steps.includes(item)) return err(`At most ${M.L2.inRep} steps in a repeat.`);
      const from = arrOf(d.p); from.splice(from.indexOf(item), 1);
      const arr = target ? target.steps : w.steps, at = beforeObj ? arr.indexOf(beforeObj) : arr.length; arr.splice(at < 0 ? arr.length : at, 0, item);
      tidy(); const np = pathOf(item); sel = item.repeat ? '' : np; drawList(); err();
      list.querySelector(`[data-drag="${np}"]`)?.focus({ preventScroll: true });
    };
    const onUp = e => dragEnd(e, false), onCancel = e => dragEnd(e, true);
    list.addEventListener('pointerdown', e => {
      const g = e.target.closest('[data-drag]'); if (!g || e.button > 0 || drag) return;
      e.preventDefault(); closeSheet();
      const el = g.closest('.wbcard, .wbrep'), r = el.getBoundingClientRect(), ghost = el.cloneNode(true);
      ghost.classList.add('wbghost'); ghost.removeAttribute('data-p'); ghost.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
      Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' });
      const line = document.createElement('div'); line.className = 'wbdrop'; m.append(ghost, line);
      drag = { id: e.pointerId, p: g.dataset.drag, el, ghost, line, y0: e.clientY, x: e.clientX, y: e.clientY, slot: null, moved: false };
      el.classList.add('dragging'); box.classList.add('wbdragging');
      document.addEventListener('pointermove', dragMove, { passive: false }); document.addEventListener('pointerup', onUp); document.addEventListener('pointercancel', onCancel);
      const mv = ev => { if (drag && Math.abs(ev.clientY - drag.y0) > 4) { drag.moved = true; document.removeEventListener('pointermove', mv); } }; document.addEventListener('pointermove', mv);
      dragMove(e); drag.raf = requestAnimationFrame(autoScroll);
    });
    list.addEventListener('keydown', e => { const g = e.target.closest?.('[data-drag]'); if (!g) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(g.dataset.drag, e.key === 'ArrowUp' ? -1 : 1); } });

    /* ---------- title, notes, start from a standard workout ---------- */
    let named = !autoName;
    $('#mwName', m).oninput = e => { named = true; w.name = e.target.value; err(); };
    $('#wbNotes', m).oninput = e => { w.notes = e.target.value.slice(0, M.L2.notes); };
    $('#wbBase', m).onchange = e => { const bw = catalog().find(b => b.id === e.target.value); if (!bw) return;
      const before = snapshot(), d = M.fromBuiltin2(bw); w.steps = d.steps; w.base = bw.id; sel = ''; closeSheet(); drawList();
      if (!named) { w.name = nameFor ? nameFor(bw) : bw.name; $('#mwName', m).value = w.name; }
      toast(`Steps of “${bw.name}”`, before); };

    /* ---------- leaving, saving, deleting ---------- */
    const close = v => { m.remove(); document.removeEventListener('keydown', onKey, true); mq.removeEventListener?.('change', onMq); clearTimeout(toastT); done(v); };
    let asking = false;
    const leave = async () => {
      if (asking) return; if (!dirty()) return close(null);
      asking = true; const v = await ask({ title: 'Discard your changes?', text: `“${String(w.name).trim() || 'This workout'}” has changes that are not saved yet.`,
        buttons: [{ label: 'Keep editing', value: 'keep' }, { label: 'Discard', value: 'discard', cls: 'danger' }, { label: 'Save', value: 'save', cls: 'mwsave' }] }); asking = false;
      if (v === 'discard') close(null); else if (v === 'save') save(false); else $('#mwCancel', m)?.focus();
    };
    const onKey = e => { if (e.key !== 'Escape' || document.querySelector('.mwask')) return; e.stopPropagation(); e.preventDefault(); if (drag) return dragEnd(null, true); if (sheet) return closeSheet(); leave(); };
    document.addEventListener('keydown', onKey, true);
    const save = async asNew => {
      const name = String(w.name || '').trim().replace(/\s+/g, ' ');
      if (!name || name.length > M.LIM.name) { $('#mwName', m).focus(); return err(`Name: 1–${M.LIM.name} characters.`); }
      if (m.querySelector('.bad')) { m.querySelector('.bad').focus(); return err('A value is out of range: fix the marked field first.'); }
      const v = M.validateWorkout({ ...w, name, id: asNew ? M.newId() : w.id }); if (v.error) return err(v.error);
      const btn = $(asNew ? '#mwSaveNew' : '#mwSave', m); btn.disabled = true;
      try { const out = await savePersonal(v.w); close({ saved: out }); }
      catch (e) { err('Not saved: ' + e.message); btn.disabled = false; }
    };
    $('#mwSave', m).onclick = () => save(false);
    $('#mwSaveNew', m)?.addEventListener('click', () => save(true));
    $('#mwDel', m)?.addEventListener('click', async () => {
      asking = true; const v = await ask({ title: `Delete “${w.name}”?`, text: 'It is removed from your workouts for good.', buttons: [{ label: 'Keep it', value: null }, { label: 'Delete', value: 'del', cls: 'danger' }] }); asking = false;
      if (v !== 'del') return $('#mwDel', m)?.focus();
      try { await deletePersonal(w.id); close({ deleted: w.id }); } catch (e) { err('Not deleted: ' + e.message); } });
    $('#mwCancel', m).onclick = $('#mwClose', m).onclick = () => leave();
    m.addEventListener('click', e => { if (e.target === m) leave(); });
    const mq = matchMedia(PHONE), onMq = () => { closeSheet(); drawList(); }; mq.addEventListener?.('change', onMq);
    drawList(); $('#mwSave', m).focus({ preventScroll: true }); // the pad starts on Save, a keyboard can Tab back; the name is filled in
  });
}
