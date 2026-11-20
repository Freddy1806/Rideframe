// Gamepad (and keyboard) navigation for the whole desktop app, like a TV remote (owner 17.11.): D-pad / left stick move
// the focus to the nearest control in that direction, A selects, B goes back (closes the topmost window, else one screen
// back; nothing on the main menu), L / R switch the tabs. Arrow keys, Enter and Escape drive the same navigator.
// It stands down while a ride runs: there js/ride.js _pollPad owns the pad (pause menu included) and the arrow keys
// mean watts. Only the ride's end screen (.ride .finish) is navigated here again, where the ride no longer reads the pad.
// Button numbers are the standard mapping, read through padButtons() like the ride (Nintendo-style pads swapped back).
import { padButtons, activePad } from './controller.js';

export const DIRS = ['up', 'down', 'left', 'right'];
const ORANGE = '#ff5a1f'; // the product's one accent; the focus ring stays orange whatever accent colour is chosen

// ---------------- pure logic: which rectangle lies next in a direction (tested in tools/padnav-test.mjs) ----------------
const cx = r => (r.left + r.right) / 2, cy = r => (r.top + r.bottom) / 2;
/** dest lies in that direction of src: it starts past src's middle and ends beyond src's far edge (a neighbour in the same
 *  row that sits a few pixels lower is not "below", a box around src is in no direction) */
export function isCandidate(src, d, dir) {
  if (dir === 'right') return d.left >= cx(src) - 1 && d.right > src.right;
  if (dir === 'left') return d.right <= cx(src) + 1 && d.left < src.left;
  if (dir === 'down') return d.top >= cy(src) - 1 && d.bottom > src.bottom;
  return d.bottom <= cy(src) + 1 && d.top < src.top;
}
const horiz = dir => dir === 'left' || dir === 'right';
/** dest overlaps src across the direction of travel (same row for left / right, same column for up / down) */
export function inBeam(src, d, dir) {
  return horiz(dir) ? d.bottom > src.top && d.top < src.bottom : d.right > src.left && d.left < src.right;
}
const major = (src, d, dir) => Math.max(0, dir === 'right' ? d.left - src.right : dir === 'left' ? src.left - d.right : dir === 'down' ? d.top - src.bottom : src.top - d.bottom);
const majorFar = (src, d, dir) => Math.max(1, dir === 'right' ? d.right - src.right : dir === 'left' ? src.left - d.left : dir === 'down' ? d.bottom - src.bottom : src.top - d.top);
const minor = (src, d, dir) => horiz(dir) ? Math.abs(cy(d) - cy(src)) : Math.abs(cx(d) - cx(src));
const score = (src, d, dir) => 13 * major(src, d, dir) ** 2 + minor(src, d, dir) ** 2;
function better(src, a, b, dir) { // a beats b (the focus finder of Android: same row / column first, then distance)
  const ab = inBeam(src, a, dir), bb = inBeam(src, b, dir);
  if (ab && !bb && (horiz(dir) || major(src, a, dir) < majorFar(src, b, dir))) return true;
  if (bb && !ab && (horiz(dir) || major(src, b, dir) < majorFar(src, a, dir))) return false;
  return score(src, a, dir) < score(src, b, dir);
}
/** gap across the direction of travel (0 when they overlap) */
const across = (src, d, dir) => horiz(dir) ? Math.max(0, d.top - src.bottom, src.top - d.bottom) : Math.max(0, d.left - src.right, src.left - d.right);
/** index of the rect in cands that is next from src in dir, or -1. Rects: { left, top, right, bottom }.
 *  Left / right stay near the row (at most 48 px above or below): at the end of a row nothing happens, no jump to the top bar. */
export function pickInDir(src, cands, dir) {
  let best = -1;
  cands.forEach((c, i) => { if (c === src || !isCandidate(src, c, dir) || (horiz(dir) && across(src, c, dir) > 48)) return; if (best < 0 || better(src, c, cands[best], dir)) best = i; });
  return best;
}
/** key repeat for a held direction: fires on press, after `delay` ms once, then every `rate` ms */
export function repeater(delay = 350, rate = 120) {
  let since = null, next = 0;
  return (held, now) => {
    if (!held) { since = null; return false; }
    if (since == null) { since = now; next = now + delay; return true; }
    if (now >= next) { next = now + rate; return true; }
    return false;
  };
}
/** left stick to a direction with hysteresis: on beyond 0.6, off again only under 0.35 */
export function stickDir(x, y, prev) {
  const on = 0.6, off = 0.35, ax = Math.abs(x), ay = Math.abs(y);
  if (prev) { const v = prev === 'left' ? -x : prev === 'right' ? x : prev === 'up' ? -y : y; if (v > off) return prev; }
  if (Math.max(ax, ay) < on) return null;
  return ax >= ay ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
}
/** a number field one step up (d = 1) or down (d = −1), kept within min / max; an empty field starts from `start` (else min, else 0).
 *  No snapping to the step grid: 118 % + 5 = 123 %, as typed values stay what they are. */
export function stepValue(value, d, { step, min, max, start } = {}) {
  const st = Number.isFinite(+step) && +step > 0 ? +step : 1, lo = Number.isFinite(min) ? min : -Infinity, hi = Number.isFinite(max) ? max : Infinity;
  const v0 = value === '' || value == null || !Number.isFinite(+value) ? (Number.isFinite(start) ? start : Number.isFinite(min) ? min : 0) : +value;
  return Math.max(lo, Math.min(hi, Math.round((v0 + d * st) * 1e6) / 1e6));
}
// ---------------- the browser part ----------------
const FOCUSABLE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [tabindex]:not([tabindex="-1"]), .card[data-id], tr[data-key]';
const TEXTY = el => (el.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|reset|color|file)$/i.test(el.type)) || el.tagName === 'TEXTAREA' || el.isContentEditable;
const OVERLAYS = '.modal, .ride .finish';
const NUMBER = el => el?.tagName === 'INPUT' && el.type === 'number';
const numAttr = (el, a) => el.getAttribute(a) === null || el.getAttribute(a) === '' ? NaN : +el.getAttribute(a);
/** a number field changed by the pad: one step, the page hears input + change like from typing */
function stepNum(el, d) {
  const v = stepValue(el.value, d, { step: numAttr(el, 'step'), min: numAttr(el, 'min'), max: numAttr(el, 'max'), start: el.dataset.start === undefined ? NaN : +el.dataset.start });
  if (String(v) === el.value) return;
  el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}
const HINT = 'D-pad move · A select · B back', HINT_NUM = '↑ → more · ↓ ← less · L / R one step · A or B done';
function hintFor() { const h = document.getElementById('pnHint'); if (h) h.textContent = editing && NUMBER(cur) ? HINT_NUM : HINT; }

let cur = null, editing = false, active = false, viaPad = false;
const memory = new WeakMap(); // overlay (or document) -> the element focused there last, so closing a window returns to it

function rideRunning() { const r = document.querySelector('.ride'); return !!r && !r.querySelector('.finish') && !document.querySelector('.rideset'); } // the settings sheet over the ride (app.js openRideSettings) is a menu again
function visible(el) {
  if (!el.isConnected || el.closest('[hidden]') || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
  const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0 && el.tagName !== 'INPUT') return false;
  if (el.tagName === 'INPUT' && el.type === 'file') return false;
  const det = el.closest('details:not([open])'); if (det && !(el.tagName === 'SUMMARY' && el.parentElement === det)) return false;
  return true;
}
/** the topmost open window (modal or the ride's end screen), else the whole page */
function scope() {
  const ov = [...document.querySelectorAll(OVERLAYS)].filter(o => o.isConnected && o.getBoundingClientRect().width > 0);
  if (!ov.length) return document.body;
  const z = o => +getComputedStyle(o).zIndex || 0;
  return ov.reduce((top, o) => (z(o) >= z(top) ? o : top)); // equal z: the later one in the page is on top
}
function candidates(root) {
  const inMap = !!cur?.matches?.('.ihnode, #ihMore'); // the places on the island map: only from the button next to them or from another place, else the map swallows every ↑ ↓
  const out = [...root.querySelectorAll(FOCUSABLE)].filter(el => visible(el) && !el.closest('.ride:not(:has(.finish))') && (inMap || !el.matches('.ihnode')));
  return out.filter(el => !out.some(o => o !== el && o.contains(el) && !(o.matches('.card, tr[data-key]')))); // a button inside a clickable card stays its own stop
}
/** first sensible element of the screen: in a window its first control, on a page the first control below the tab bar */
function first(root) {
  const c = candidates(root); if (!c.length) return null;
  if (root !== document.body) return c.find(el => !TEXTY(el)) || c[0];
  const main = document.querySelector('#main');
  const inMain = c.filter(el => main?.contains(el)), view = inMain.filter(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  return view.find(el => el.hasAttribute('data-pnfirst')) || view[0] || inMain[0] || c[0]; // a page may name its main button (the island banner: not a place on the map)
}
/** an address for an element that survives a redraw of the same screen (settings redraw themselves on many changes) */
function sig(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  const da = [...el.attributes].find(a => a.name.startsWith('data-'));
  const host = el.parentElement?.closest('[id]');
  if (!da && !host) return null;
  return (host && host !== document.body ? '#' + CSS.escape(host.id) + ' ' : '') + el.tagName.toLowerCase() + (da ? `[${da.name}="${CSS.escape(da.value)}"]` : '');
}
let curSig = null, editSig = null, trail = null;

function setCur(el, { scroll = true } = {}) {
  if (cur && cur !== el) cur.classList.remove('pn-focus', 'pn-edit');
  if (cur !== el) editing = false;
  cur = el; if (!el) return;
  curSig = sig(el); el.classList.add('pn-focus'); el.classList.toggle('pn-edit', editing); hintFor();
  memory.set(scope(), el);
  if (TEXTY(el)) { if (document.activeElement && document.activeElement !== el && document.activeElement !== document.body) document.activeElement.blur(); }
  else el.focus?.({ preventScroll: true });
  if (scroll) {
    const r = el.getBoundingClientRect(), main = document.querySelector('#main'), mr = el.closest('#main') ? main.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    if (r.top < mr.top + 8 || r.bottom > mr.bottom - 8) el.scrollIntoView({ block: r.height > (mr.bottom - mr.top) * 0.8 ? 'start' : 'center', inline: 'nearest' });
  }
}
/** keep the focus valid after the page changed underneath (new screen, window opened or closed, redraw) */
function ensure() {
  const root = scope();
  if (cur && cur.isConnected && root.contains(cur) && visible(cur)) return cur;
  let el = null;
  if (curSig) { try { const again = root.querySelector(curSig); if (again && visible(again)) el = again; } catch {} }
  if (!el) { const m = memory.get(root); if (m && m.isConnected && visible(m)) el = m; }
  if (!el) el = first(root);
  const keepEdit = editing && el && curSig && sig(el) === editSig;
  setCur(el, { scroll: false }); editing = keepEdit; el?.classList.toggle('pn-edit', editing);
  return el;
}
function activate(on, pad) {
  if (active !== on || viaPad !== pad) { active = on; viaPad = pad; document.documentElement.classList.toggle('pn-active', on); document.documentElement.classList.toggle('pn-pad', on && pad); }
}

function move(dir, wasActive = active) {
  const was = wasActive && cur && cur.isConnected;
  const el = ensure(); if (!el) return;
  if (!was) return; // the first press only shows where the focus is
  if (editing && NUMBER(el)) { stepNum(el, dir === 'up' || dir === 'right' ? 1 : -1); return; } // a number field being changed: held = repeat
  if (editing && el.tagName === 'SELECT') { // a list field being changed: ↑ ↓ (and ← →) step through its values
    const n = el.options.length, i = el.selectedIndex + (dir === 'up' || dir === 'left' ? -1 : 1);
    if (i >= 0 && i < n && !el.options[i].disabled) { el.selectedIndex = i; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    return;
  }
  if (el.tagName === 'INPUT' && el.type === 'range' && horiz(dir)) {
    const st = +el.step || 1, v = Math.max(+el.min || 0, Math.min(+el.max || 100, +el.value + (dir === 'right' ? st : -st)));
    if (v !== +el.value) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    return;
  }
  const c = candidates(scope()), rect = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
  if (trail && trail.to === el && trail.dir === OPP[dir] && c.includes(trail.from)) { const t = trail.from; trail = { from: el, to: t, dir }; setCur(t); return; } // straight back: where you came from, not the nearest
  const rs = c.map(rect), me = rect(el), i = pickInDir(me, rs, dir);
  if (i >= 0) { trail = { from: el, to: c[i], dir }; setCur(c[i]); }
}
function select(wasActive = active) {
  const was = wasActive && cur && cur.isConnected;
  const el = ensure(); if (!el || !was) return;
  if (el.tagName === 'SELECT' || NUMBER(el)) { editing = !editing; editSig = editing ? sig(el) : null; el.classList.toggle('pn-edit', editing); hintFor(); return; } // a number: A, then ↑ ↓ ← → change it, A or B done
  if (TEXTY(el)) { el.focus(); el.select?.(); return; } // typing stays on the keyboard; B leaves the field
  if (el.tagName === 'INPUT' && el.type === 'range') return; // ← → change it
  el.click();
}
const CLOSE_RX = /^\s*(cancel|close|back|later|not now|no|✕|×|‹|←.*)\s*$/i, DONE_RX = /^\s*(done|ok|got it)\s*$/i;
function back() {
  const el = cur && cur.isConnected ? cur : null;
  if (el && editing) { editing = false; el.classList.remove('pn-edit'); hintFor(); return true; }
  const ae = document.activeElement; if (ae && TEXTY(ae)) { ae.blur(); if (ae.isConnected) setCur(ae, { scroll: false }); return true; }
  const root = scope();
  if (root !== document.body) { // a window: its own close / cancel / back button, else its "Done", else a click beside the box
    const bs = candidates(root).filter(b => b.tagName === 'BUTTON' || b.tagName === 'A');
    const b = bs.find(x => /(Close|Cancel|Back|X|No|Later)$/.test(x.id) && CLOSE_RX.test(x.textContent)) || bs.find(x => CLOSE_RX.test(x.textContent)) || bs.find(x => DONE_RX.test(x.textContent));
    if (b) { b.click(); return true; }
    if (root.classList.contains('modal')) { root.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; } // most windows close on a click on the dark backdrop
    return false;
  }
  const bk = document.querySelector('#main #back'); if (bk && visible(bk)) { bk.click(); return true; }
  const tab = document.querySelector('.topbar .tab.active');
  if (tab && tab.dataset.view !== 'library') { document.querySelector('.topbar .tab[data-view="library"]')?.click(); return true; }
  return false; // the main menu: B does nothing
}
function bumper(d) { // L / R: tabs of the window (rider designer) or of the app; on a number field one step down / up
  if (cur && cur.isConnected && NUMBER(cur) && visible(cur)) { stepNum(cur, d); return; }
  const root = scope();
  const tabs = root === document.body ? [...document.querySelectorAll('.topbar .tab')] : [...root.querySelectorAll('[role=tab], .avtab')];
  const vis = tabs.filter(visible); if (vis.length < 2) return;
  const on = vis.findIndex(t => t.classList.contains('active') || t.classList.contains('on') || t.getAttribute('aria-selected') === 'true');
  const next = vis[((on < 0 ? 0 : on) + d + vis.length) % vis.length];
  next.click(); setCur(next.isConnected ? next : null); if (!next.isConnected) ensure();
}

// ---------------- input: gamepad poll and keyboard ----------------
const BTN_DIR = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const reps = Object.fromEntries(DIRS.map(d => [d, repeater()]));
let prev = [], stick = null, lastEnsure = 0, inRide = false;
function poll(now) {
  requestAnimationFrame(poll);
  const riding = rideRunning(); if (riding !== inRide) { inRide = riding; document.documentElement.classList.toggle('pn-ride', riding); } // no menu hint over the ride
  if (active && now - lastEnsure > 120 && !riding) { lastEnsure = now; ensure(); } // a new screen or window: the focus follows at once
  const pad = activePad(); if (!pad) { prev = []; return; } // a real pad or the phone remote (js/remotepad.js)
  const b = padButtons(pad), was = prev; prev = b;
  stick = stickDir(pad.axes?.[0] || 0, pad.axes?.[1] || 0, stick);
  const held = Object.fromEntries(DIRS.map(d => [d, false]));
  for (const [i, d] of Object.entries(BTN_DIR)) if (b[i]) held[d] = true;
  if (stick) held[stick] = true;
  if (riding) { DIRS.forEach(d => reps[d](false, now)); return; } // the ride reads the pad itself
  const hit = i => b[i] && !was[i];
  const any = DIRS.some(d => held[d]) || b.some((x, i) => x && !was[i]), wasActive = active && viaPad;
  if (any) activate(true, true);
  for (const d of DIRS) if (reps[d](held[d], now)) move(d, wasActive);
  if (hit(0)) select(wasActive);
  if (hit(1)) { if (!active) activate(true, true); back(); }
  if (hit(4)) bumper(-1);
  if (hit(5)) bumper(1);
}
const KEY_DIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
function onKey(e) {
  if (rideRunning() || e.altKey || e.ctrlKey || e.metaKey) return; // in the ride the arrow keys are watts and Escape pauses
  const t = e.target, typing = t && t !== document.body && TEXTY(t), wasActive = active;
  if (e.key === 'Tab') { activate(true, false); return; }
  if (typing) { if (e.key === 'Escape' && TEXTY(t)) { activate(true, false); t.blur(); setCur(t, { scroll: false }); e.preventDefault(); e.stopImmediatePropagation(); } return; }
  const dir = KEY_DIR[e.key];
  if (dir) { activate(true, false); move(dir, wasActive); e.preventDefault(); return; }
  if (e.key === 'Enter' && active) { select(); e.preventDefault(); return; }
  if (e.key === 'Escape') { activate(true, false); if (back()) { e.preventDefault(); e.stopImmediatePropagation(); } }
}
function init() {
  const st = document.createElement('style');
  st.textContent = `html.pn-active .pn-focus { outline: 3px solid ${ORANGE} !important; outline-offset: 3px; box-shadow: 0 0 0 6px rgba(255,90,31,.28) !important; }
    html.pn-active .pn-focus.pn-edit { outline-style: dashed !important; outline-width: 4px !important; }
    html:not(.pn-active) .pn-focus:focus { outline: none; }
    #pnHint { position: fixed; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 2000; pointer-events: none; font: 600 12px/1 var(--wide, system-ui); letter-spacing: .04em;
      color: rgba(244,244,239,.72); background: rgba(11,11,11,.72); border: 1px solid rgba(244,244,239,.14); padding: 7px 12px; border-radius: 99px; white-space: nowrap; display: none; }
    html.pn-pad:not(.pn-ride) #pnHint { display: block; }`;
  document.head.append(st);
  const hint = document.createElement('div'); hint.id = 'pnHint'; hint.setAttribute('aria-hidden', 'true'); hint.textContent = HINT; document.body.append(hint);
  let mx = null, my = null;
  addEventListener('mousemove', e => { if (mx != null && (Math.abs(e.clientX - mx) > 2 || Math.abs(e.clientY - my) > 2)) activate(false, false); mx = e.clientX; my = e.clientY; }, { passive: true });
  addEventListener('mousedown', () => activate(false, false), true);
  addEventListener('keydown', onKey, true); // capture: runs before a window's own Escape handler, so one Escape closes one thing
  addEventListener('focusin', e => { if (active && e.target !== cur && e.target.matches?.(FOCUSABLE) && !rideRunning()) setCur(e.target, { scroll: false }); });
  requestAnimationFrame(poll);
  globalThis.__padnav = { get cur() { return cur; }, get active() { return active; }, get editing() { return editing; } }; // for tools/padnav-ui.cjs
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') init();
