// Workout, mode and shifting chosen inside the ride (Freddy 17.11. 22:14): right after the start or any time later from the
// pause menu ("Workout & mode"), the HUD chip "Workout" or the key O. Mode: ERG (the trainer holds the workout's watts),
// with gradient (the trainer follows the road) or just ride (no gradient); shifting: virtual or on the bike; the workout:
// any built-in or personal one, or none. Every change applies at once and the ride keeps recording: a new workout starts
// from its first step (js/ride.js _wClock), the interval bar comes and goes, the trainer switches between ERG and grade.
// It lives in the pause overlay, so the ride's own controller menu (D-pad, A, B) and the keyboard (Tab, Enter) reach every
// button; no browser dialogs. The pure part (choices, which mode is on) is tested in Node (tools/ridesetup-test.mjs).
import { esc } from './util.js';
import { allWorkouts, workoutDuration, workoutSVG } from './workouts.js';

if (typeof document !== 'undefined' && !document.querySelector('link[data-rs]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/ridesetup.css'; l.dataset.rs = '1'; document.head.append(l); }

export const MODES = [
  ['erg', 'ERG', 'The trainer holds the workout watts'],
  ['sim', 'With gradient', 'The trainer follows the road'],
  ['flat', 'Just ride', 'No gradient: flat road feel'],
];
export const SHIFTS = [['virtual', 'Virtual', 'Electronic gears: Q / E, L / R'], ['real', 'On the bike', 'Shift your real gears']];

/** which mode runs: ERG only with a workout (without one the ERG setting has nothing to hold) */
export const modeOf = r => r.workout && r.erg ? 'erg' : r.flatRide ? 'flat' : 'sim';
export const shiftOf = r => r.virtual ? 'virtual' : 'real';
/** the workout list: your own first (personal ★, then the Training-tab ones), then the standard ones; minutes rounded */
export function workoutChoices(list = allWorkouts()) {
  const rank = w => w.personal ? 0 : w.mine ? 1 : 2;
  return list.map((w, i) => ({ w, i, r: rank(w) })).sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ w }) => ({ id: w.id, name: w.name, min: Math.round(workoutDuration(w) / 60), own: !!(w.personal || w.mine), w }));
}
/** what a tap changes, without touching the ride: { erg, flat } for a mode; null when it is not possible (ERG, no workout) */
export function modeChange(m, hasWorkout) {
  if (m === 'erg') return hasWorkout ? { erg: true, flat: false } : null;
  return { erg: false, flat: m === 'flat' };
}

/* ---------------- applied to a running ride (js/ride.js RideSession) ---------------- */
export function setMode(r, m) {
  const c = modeChange(m, !!r.workout); if (!c) return false;
  const t = r.state.trainer, wasErg = r.workout && r.erg;
  r.erg = c.erg; r.flatRide = c.flat;
  if (r.workout) r.state.settings.erg = r.erg; // the route page's ERG switch is the same setting
  if (wasErg && !r.erg) { t.setPower(null); r._ergSpan(false); }
  if (r.erg) r._workout(0); // the target goes to the trainer now, not with the next frame
  else if (t.connected && !r.berg) t.setGrade(r._trainerGrade(), true);
  const nm = r.q('#hWName'); if (nm && r.workout) nm.textContent = r.workout.name + (r.erg ? ' · ERG' : '');
  r._flash({ erg: 'ERG · the trainer holds the watts', sim: 'With gradient · the trainer follows the road', flat: 'Just ride · no gradient' }[m]);
  return true;
}
export function setShift(r, s) {
  if (shiftOf(r) === s && !r.berg) return;
  r._setShift(s === 'virtual' ? (r.state.settings.autoShift ? 'auto' : 'virtual') : 'real');
}
/** a new workout (or none) mid-ride: from its first step, offsets back to 0, the interval bar built or removed */
export function setWorkout(r, w) {
  const t = r.state.trainer, old = r.workout;
  if (old && w && old.id === w.id && !r.wDone) return;
  if (old) r._wName = old.name + (r.wDone ? '' : ' (ended early)');
  const wasErg = old && r.erg && !r.wDone;
  r.workout = w || null; r.wNow = null; r.wDone = false; r._wi = undefined; r._wT = 0; r._wbh = 0;
  if (w) { r._wDef = w; r._wId = w.id; r._wT0 = r.elapsed; r.wAdj = 0; r.wAdjE = 0; r._adjAcc = 0; r._adjT = 0; r._stepAdj = []; r._wName = ''; }
  if (wasErg && !(w && r.erg)) { t.setPower(null); r._ergSpan(false); }
  r.q('#hWork')?.remove(); r.el.classList.toggle('wk', !!w); r.q('.metric.power')?.classList.remove('z-lo', 'z-ok', 'z-hi');
  if (w) { r.q('.hud-top')?.insertAdjacentHTML('afterend', r._workoutBarHTML()); r._wireWorkoutStop(); r._workout(0); r._workoutHUD(r.power); }
  else if (t.connected && !r.berg) t.setGrade(r._trainerGrade(), true);
  r._flash(w ? `${w.name} · starts now from step 1` : 'No workout · ride freely');
}

const press = (on, extra = '') => `aria-pressed="${on}"${on ? ' class="rsopt on"' : ' class="rsopt"'}${extra}`;
/** the setup in the pause overlay; focus = index of the button to stand on (the pad's menu index) */
export function openSetup(r, focus = 0) {
  const box = r.q('#pauseOverlay .box'); if (!box) return;
  const mode = modeOf(r), shift = shiftOf(r), cur = r.workout?.id || '', ftp = r.ftp || 200;
  const list = workoutChoices();
  box.classList.add('rsbox');
  box.innerHTML = `<div class="label">Ride setup · ${esc(r.route?.name || '')}</div><h2 class="display">Workout &amp; mode</h2>
    <div class="padmenu rs">
      <button class="btn rsgo" id="oBack">Ride on ▸</button>
      <div class="rsg" role="group" aria-label="Mode"><div class="rsl">Mode</div><div class="rsrow">${MODES.map(([id, t, h]) => { const off = id === 'erg' && !r.workout;
        return `<button type="button" data-mode="${id}" ${press(mode === id, off ? ' disabled' : '')} title="${esc(h)}"><b>${t}</b><small>${off ? 'Pick a workout first' : h}</small></button>`; }).join('')}</div></div>
      <div class="rsg" role="group" aria-label="Shifting"><div class="rsl">Shifting</div><div class="rsrow">${SHIFTS.map(([id, t, h]) => `<button type="button" data-shift="${id}" ${press(shift === id && !r.berg)} title="${esc(h)}"><b>${t}</b><small>${h}</small></button>`).join('')}</div></div>
      <div class="rsg" role="group" aria-label="Workout"><div class="rsl">Workout${r.workout ? ` <span class="rscur">now: ${esc(r.workout.name)}${r.wDone ? ' · done' : ''}</span>` : ''}</div>
        <div class="rsw"><button type="button" data-w="" ${press(!cur)}><b>No workout</b><small>Ride freely</small></button>${list.map(x => `<button type="button" data-w="${esc(x.id)}" ${press(cur === x.id)}>
          <b>${x.own ? '★ ' : ''}${esc(x.name)}</b><small>${x.min} min${ftp ? ` · FTP ${ftp} W` : ''}</small><span class="rsmini">${workoutSVG(x.w, null, 18)}</span></button>`).join('')}</div></div>
    </div>
    <div class="hint pad-hint">🎮 D-pad to choose · A take it · B ride on &nbsp;·&nbsp; ⌨ Tab · Enter · O</div>`;
  const again = el => { const bs = [...box.querySelectorAll('.padmenu button')]; openSetup(r, Math.max(0, bs.indexOf(el))); };
  box.querySelector('#oBack').onclick = () => { box.classList.remove('rsbox'); r._resume(); };
  box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (setMode(r, b.dataset.mode)) again(b); });
  box.querySelectorAll('[data-shift]').forEach(b => b.onclick = () => { setShift(r, b.dataset.shift); again(b); });
  box.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { setWorkout(r, list.find(x => x.id === b.dataset.w)?.w || null); again(b); });
  r._padFocus(focus);
  const f = [...box.querySelectorAll('.padmenu button')][r._padI || 0]; f?.scrollIntoView?.({ block: 'nearest' });
}
