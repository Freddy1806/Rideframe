// "Controller testen": find any Bluetooth device (e.g. Shimano Di2 D-FLY, Zwift Click, remotes)
// and show every notification it sends, so buttons can be mapped to game actions.
import { virtualPad } from './remotepad.js';
const SHIMANO_BASE = n => `0000${n.toString(16).padStart(4, '0')}-5348-494d-414e-4f5f424c4500`; // "SHIMANO_BLE"
const CANDIDATES = [
  ...Array.from({ length: 256 }, (_, i) => 0x1800 + i),          // all standard 16-bit services
  ...Array.from({ length: 32 }, (_, i) => SHIMANO_BASE(0x18e0 + i)),
  '00000001-19ca-4651-86e5-fa29dcdd09d1',                         // Zwift Click / Play
  'a026ee01-0a7d-4ab3-97fa-f1500f9feb8b', 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
];
// what each gamepad button does during a ride (standard mapping; same numbers as js/ride.js _pollPad)
export const PAD_MAP = [['L / R', 'Gears: easier / harder · ERG (workout or free ride): −5 / +5 W'], ['L2 / R2', 'ERG: −1 / +1 W'], ['D-pad ↓ / ↑', 'The same as L / R'], ['D-pad →', 'Workout: next step (like the lap key of a bike computer)'],
  ['A', 'Accept challenge'], ['B', 'Switch display'], ['X', 'Photo'], ['Y', 'Switch camera'], ['Select (−)', 'Shifting: on the bike / virtual / auto / ERG'],
  ['Start (+) / Home', 'Pause menu (D-pad to choose, A ok, B back; camera, bars, view, music and voice are in Options)']];
// the same pad outside the ride, in every menu and window (js/padnav.js)
export const MENU_MAP = [['D-pad / left stick', 'Move between buttons, lists and fields'], ['A', 'Select (on a list field: A, then ↑ ↓ to change, A to confirm)'],
  ['B', 'Back: closes the window, otherwise one screen back'], ['D-pad ← → on a slider', 'Change the value'], ['L / R', 'Previous / next tab'],
  ['Keyboard', 'Arrow keys, Enter and Escape work the same in the menus']];
/** pressed state per standard button index, so the printed letters mean the same on every pad; the one helper for the ride
 *  (js/ride.js) and the menus (js/padnav.js). Only a pad that reports itself as a Switch controller (Switch Pro, Joy-Con,
 *  Nintendo vendor 057e, which is also what an 8BitDo in switch position "S" pretends to be) is read by position by Chrome
 *  (0 = bottom = its printed "B"), so A/B and X/Y are swapped back for it. An 8BitDo in position "D" (owner 17.11.: the one
 *  that works on a Mac) reports its own name and is taken as it comes. Not verified on hardware: if A and B still come out
 *  the wrong way round, "Swap A / B" in the Test controller window turns it around for that pad (kept in this browser). */
export const NINTENDO = id => /pro controller|nintendo|057e|joy-?con/i.test(id || '');
const SWAP_KEY = 'rf-padSwapAB';
const swapPrefs = () => { try { return JSON.parse(localStorage.getItem(SWAP_KEY) || '{}'); } catch { return {}; } };
let swapCache = null;
/** true when A/B (and X/Y) of this pad are swapped: the owner's choice for this pad id, else the Switch-controller rule */
export function padSwapped(pad) { const p = swapCache ||= swapPrefs(); return pad.id in p ? !!p[pad.id] : NINTENDO(pad.id); }
export function setPadSwapped(pad, on) { const p = swapPrefs(); p[pad.id] = !!on; swapCache = p; try { localStorage.setItem(SWAP_KEY, JSON.stringify(p)); } catch {} }
/** D-pad of a pad Chrome does not know ("D" mode of the 8BitDo on a Mac): a hat switch on one axis (−1 = up, clockwise in steps of 2/7,
 *  neutral is outside −1…1) or plain left/right, up/down axes. Returns [up, down, left, right]. */
export function hatDirs(axes = []) {
  const out = [false, false, false, false];
  for (const i of [9]) { // only the hat axis: the others are sticks and analog triggers (read as a hat they gave ±1 W on L2 / R2)
    const v = axes[i]; if (typeof v !== 'number' || v === 0 || Math.abs(v) > 1.05) continue;
    const k = Math.round((v + 1) * 3.5), err = Math.abs((v + 1) * 3.5 - k); if (err > 0.08) continue;
    out[0] = k === 7 || k === 0 || k === 1; out[3] = k >= 1 && k <= 3; out[1] = k >= 3 && k <= 5; out[2] = k >= 5 && k <= 7;
    return out;
  }
  const x = axes[0] || 0, y = axes[1] || 0;
  return [y < -0.5, y > 0.5, x < -0.5, x > 0.5];
}
/** raw button order of 8BitDo pads in "D" mode (DirectInput): A B · X Y · L R L2 R2 Select Start Home */
const RAW = { 0: 0, 1: 1, 3: 2, 4: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, 11: 9 };
export function padButtons(pad) {
  const p = pad.buttons.map(x => x.pressed);
  if (pad.mapping !== 'standard') { // unknown to the browser (8BitDo in "D" on a Mac): sort the raw buttons into the standard places, D-pad from the hat
    const b = new Array(17).fill(false);
    for (const [raw, std] of Object.entries(RAW)) b[std] = !!p[raw];
    const [u, d, l, r] = hatDirs([...(pad.axes || [])]); b[12] = u; b[13] = d; b[14] = l; b[15] = r;
    if ((swapCache ||= swapPrefs())[pad.id]) { [b[0], b[1]] = [b[1], b[0]]; [b[2], b[3]] = [b[3], b[2]]; } // only when the owner asked for it
    return b;
  }
  if (padSwapped(pad)) { [p[0], p[1]] = [p[1], p[0]]; [p[2], p[3]] = [p[3], p[2]]; }
  return p;
}
/** the pad the ride (js/ride.js) and the menus (js/padnav.js) read: the first real pad, the phone remote as a virtual standard
 *  pad (js/remotepad.js), or both at once with their buttons OR-ed (the real pad's own A/B swap already applied) */
export function activePad() {
  const real = navigator.getGamepads?.().find(Boolean) || null, v = virtualPad();
  if (!v) return real; if (!real) return v;
  const a = padButtons(real), n = Math.max(a.length, v.buttons.length);
  return { ...v, axes: real.axes, buttons: Array.from({ length: n }, (_, i) => { const on = !!a[i] || !!v.buttons[i]?.pressed; return { pressed: on, touched: on, value: on ? 1 : 0 }; }) };
}
const BTN = ['A', 'B', 'X', 'Y', 'L', 'R', 'L2 / ZL', 'R2 / ZR', 'Select (−)', 'Start (+)', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home'];
const ACT = ['Accept challenge / menu ok', 'Switch display / back', 'Photo', 'Switch camera', 'Gear easier (ERG: −5 W)', 'Gear harder (ERG: +5 W)', 'ERG: −1 W', 'ERG: +1 W', 'Shifting mode', 'Pause menu', '', '', 'Gear harder (ERG: +5 W)', 'Gear easier (ERG: −5 W)', 'Menu left', 'Menu right', 'Pause menu'];
const hex = dv => [...new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)].map(b => b.toString(16).padStart(2, '0')).join(' ');

export function openControllerTest() {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box" style="width:min(820px,94vw)">
    <div class="label">Bluetooth</div><h2 class="display" style="margin-top:10px">Test<br>controller</h2>
    <p><b>Gamepad</b> (e.g. 8BitDo Micro, switch on the back set to D on a Mac, S if D does not work): pair it in the computer's Bluetooth settings, then just press a button here. It shows up below by itself, no search needed.
      <b>Zwift Click / Di2</b>: “Find device”, choose it (Di2: shift once first so it wakes up), then press the buttons. Every message shows up below, keyboard too.</p>
    <p id="ctPad" class="hint" style="margin-top:8px"></p>
    <details style="margin:6px 0 10px"><summary style="cursor:pointer"><b>Gamepad buttons during a ride</b> (e.g. 8BitDo Micro, switch on the back set to D on a Mac, S if D does not work)</summary>
      <table style="margin-top:8px;border-collapse:collapse">${PAD_MAP.map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;white-space:nowrap"><b>${k}</b></td><td>${v}</td></tr>`).join('')}</table>
      <p style="margin-top:8px"><b>Keyboard in a workout</b>: W / S target +5 / −5 W (Shift 1 W); with a trainer connected the arrow keys ↑ / ↓ move it 1 W (Shift 5 W) and never set test watts. Hard intervals and easy parts keep their own offset. L switches the interval display (big / compact / focus). X ends the step running now (next step).</p>
      <p style="margin-top:8px"><b>Zwift Click + / −</b>: Gear harder / easier (connect it in Settings → Trainer)</p></details>
    <details style="margin:0 0 10px"><summary style="cursor:pointer"><b>Gamepad in the menus</b> (everywhere outside the ride, like a TV remote)</summary>
      <table style="margin-top:8px;border-collapse:collapse">${MENU_MAP.map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;white-space:nowrap"><b>${k}</b></td><td>${v}</td></tr>`).join('')}</table></details>
    <div class="actions" style="justify-content:flex-start"><button class="btn small" id="ctScan" title="Only for Zwift Click, Di2 and other Bluetooth buttons; gamepads need no search">Find device (Zwift Click / Di2)</button><button class="btn ghost small" id="ctSwap" hidden>Swap A / B</button><button class="btn ghost small" id="ctCopy">Copy log</button><button class="btn ghost small" id="ctClose">Close</button></div>
    <pre id="ctLog" style="margin-top:18px;height:340px;overflow:auto;background:#000;border:1px solid var(--line-2);border-radius:4px;padding:12px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap"></pre></div>`;
  document.body.append(m);
  const logEl = m.querySelector('#ctLog');
  const log = s => { logEl.textContent += `${new Date().toLocaleTimeString('en-GB')}.${String(Date.now() % 1000).padStart(3, '0')}  ${s}\n`; logEl.scrollTop = 1e9; };
  let device, raf;
  m.querySelector('#ctClose').onclick = () => { cancelAnimationFrame(raf); clearTimeout(noPadT); device?.gatt?.disconnect(); document.removeEventListener('keydown', onKey); m.remove(); };
  m.querySelector('#ctCopy').onclick = () => navigator.clipboard?.writeText(logEl.textContent);
  const onKey = e => { if (e.key === 'Escape') return m.querySelector('#ctClose').click(); log(`Key: ${e.code}`); }; document.addEventListener('keydown', onKey);
  // gamepads
  const prev = {};
  // which pad, A/B swapped or not (and a button to turn it around); no pad after 10 s: how to get one recognised
  const padEl = m.querySelector('#ctPad'), swapBtn = m.querySelector('#ctSwap'); let seen = null;
  const showPad = gp => { padEl.innerHTML = ''; padEl.append(`Gamepad: ${gp.id} · ${gp.mapping === 'standard' ? 'standard layout' : 'non-standard layout, read as 8BitDo “D” mode'} · A/B ${padSwapped(gp) ? 'swapped (Switch layout)' : 'as reported'}. Press A: it must say “A pressed”.`); swapBtn.hidden = false; };
  swapBtn.onclick = () => { if (!seen) return; setPadSwapped(seen, !padSwapped(seen)); showPad(seen); log(`A / B ${padSwapped(seen) ? 'swapped' : 'not swapped'} for ${seen.id.slice(0, 30)}`); };
  const noPadT = setTimeout(() => { if (!seen) padEl.innerHTML = '<b style="color:var(--paper)">No controller detected:</b> set the switch to D, remove and pair it again in the Mac\'s Bluetooth settings, restart Chrome. Then press a button here.'; }, 10000);
  const poll = () => { for (const gp of navigator.getGamepads?.() || []) { if (!gp) continue; if (!seen || seen.id !== gp.id) { seen = gp; showPad(gp); log(`Gamepad found: ${gp.id} (${gp.mapping || 'no'} mapping, ${gp.buttons.length} buttons)`); } padButtons(gp).forEach((p, i) => { const k = gp.index + ':' + i; if (p !== !!prev[k]) { prev[k] = p; log(`Gamepad ${gp.id.slice(0, 30)} ${BTN[i] || 'Button ' + i}${p ? ` pressed${ACT[i] ? ' → ' + ACT[i] : ''}` : ' released'}`); } }); } raf = requestAnimationFrame(poll); }; poll();
  m.querySelector('#ctScan').onclick = async () => {
    if (!navigator.bluetooth) return log('No Web Bluetooth (please use Chrome/Edge).');
    try {
      device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: CANDIDATES });
      log(`Device: ${device.name || '(no name)'} – connecting…`);
      const server = await device.gatt.connect();
      const services = await server.getPrimaryServices();
      for (const s of services) {
        log(`Service ${s.uuid}`);
        let chars = []; try { chars = await s.getCharacteristics(); } catch (e) { log(`  (characteristics blocked: ${e.message})`); }
        for (const c of chars) {
          const p = Object.entries(c.properties).filter(([, v]) => v).map(([k]) => k).join(',');
          log(`  Characteristic ${c.uuid} [${p}]`);
          if (c.properties.read) try { log(`    Value: ${hex(await c.readValue())}`); } catch {}
          if (c.properties.notify || c.properties.indicate) {
            try { c.addEventListener('characteristicvaluechanged', e => log(`◆ ${c.uuid.slice(0, 8)}: ${hex(e.target.value)}`)); await c.startNotifications(); log('    listening'); }
            catch (e) { log(`    Subscribe failed: ${e.message}`); }
          }
        }
      }
      log('Ready. Press buttons now.');
    } catch (e) { log('Error: ' + e.message); }
  };
}
