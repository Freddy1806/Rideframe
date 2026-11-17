// "Controller testen": find any Bluetooth device (e.g. Shimano Di2 D-FLY, Zwift Click, remotes)
// and show every notification it sends, so buttons can be mapped to game actions.
const SHIMANO_BASE = n => `0000${n.toString(16).padStart(4, '0')}-5348-494d-414e-4f5f424c4500`; // "SHIMANO_BLE"
const CANDIDATES = [
  ...Array.from({ length: 256 }, (_, i) => 0x1800 + i),          // all standard 16-bit services
  ...Array.from({ length: 32 }, (_, i) => SHIMANO_BASE(0x18e0 + i)),
  '00000001-19ca-4651-86e5-fa29dcdd09d1',                         // Zwift Click / Play
  'a026ee01-0a7d-4ab3-97fa-f1500f9feb8b', 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
];
// what each gamepad button does during a ride (standard mapping; same numbers as js/ride.js _pollPad)
export const PAD_MAP = [['L / R', 'Gear easier / harder'], ['D-pad ↓ / ↑', 'Gear easier / harder'], ['A', 'Accept challenge'], ['B', 'Switch display'],
  ['X', 'Photo'], ['Y', 'Switch view'], ['L2 / R2', 'Field of view wider / narrower'], ['Select (−)', 'Gear mode: real / virtual / auto / climb watts'],
  ['Start (+) / Home', 'Pause menu (D-pad to choose, A ok, B back; options in there too)'], ['D-pad ←', 'Music on / off'], ['D-pad →', 'Next song']];
/** pressed state per standard button index, so the printed letters mean the same on every pad. Nintendo-style pads
 *  (8BitDo in Switch mode "S", Switch Pro): Chrome reports them by position (0 = bottom = their "B"), so A/B and X/Y are swapped
 *  back here: "A" in PAD_MAP is the button printed A (Freddy's 8BitDo Micro). */
export const NINTENDO = id => /8bitdo|pro controller|nintendo|057e|joy-?con/i.test(id || '');
/** D-pad of a pad Chrome does not know ("D" mode of the 8BitDo on a Mac): a hat switch on one axis (−1 = up, clockwise in steps of 2/7,
 *  neutral is outside −1…1) or plain left/right, up/down axes. Returns [up, down, left, right]. */
export function hatDirs(axes = []) {
  const out = [false, false, false, false];
  for (const i of [9, 4, 5, 6, 7, 8]) {
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
  if (pad.mapping !== 'standard') { // unknown to the browser: sort the raw buttons into the standard places, D-pad from the hat
    const b = new Array(17).fill(false);
    for (const [raw, std] of Object.entries(RAW)) b[std] = !!p[raw];
    const [u, d, l, r] = hatDirs([...(pad.axes || [])]); b[12] = u; b[13] = d; b[14] = l; b[15] = r;
    return b;
  }
  if (NINTENDO(pad.id)) { [p[0], p[1]] = [p[1], p[0]]; [p[2], p[3]] = [p[3], p[2]]; }
  return p;
}
const BTN = ['A', 'B', 'X', 'Y', 'L', 'R', 'L2 / ZL', 'R2 / ZR', 'Select (−)', 'Start (+)', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home'];
const ACT = ['Accept challenge / menu ok', 'Switch display / back', 'Photo', 'Switch view', 'Gear easier', 'Gear harder', 'Field of view wider (workout: −5 W)', 'Field of view narrower (workout: +5 W)', 'Gear mode', 'Pause menu', '', '', 'Gear harder (workout: +1 W)', 'Gear easier (workout: −1 W)', 'Music on/off', 'Next song', 'Pause menu'];
const hex = dv => [...new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)].map(b => b.toString(16).padStart(2, '0')).join(' ');

export function openControllerTest() {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box" style="width:min(820px,94vw)">
    <div class="label">Bluetooth</div><h2 class="display" style="margin-top:10px">Test<br>controller</h2>
    <p>Choose a device (e.g. your Di2 derailleur: shift once first so it wakes up), then press the buttons. Every message shows up below. Gamepads and keyboard are shown too.</p>
    <details style="margin:6px 0 10px"><summary style="cursor:pointer"><b>Gamepad buttons during a ride</b> (e.g. 8BitDo Micro, switch on the back set to D on a Mac, S elsewhere)</summary>
      <table style="margin-top:8px;border-collapse:collapse">${PAD_MAP.map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;white-space:nowrap"><b>${k}</b></td><td>${v}</td></tr>`).join('')}</table>
      <p style="margin-top:8px"><b>Zwift Click + / −</b>: Gear harder / easier (connect it in Settings → Trainer)</p></details>
    <div class="actions" style="justify-content:flex-start"><button class="btn small" id="ctScan">Find device</button><button class="btn ghost small" id="ctCopy">Copy log</button><button class="btn ghost small" id="ctClose">Close</button></div>
    <pre id="ctLog" style="margin-top:18px;height:340px;overflow:auto;background:#000;border:1px solid var(--line-2);border-radius:4px;padding:12px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap"></pre></div>`;
  document.body.append(m);
  const logEl = m.querySelector('#ctLog');
  const log = s => { logEl.textContent += `${new Date().toLocaleTimeString('en-GB')}.${String(Date.now() % 1000).padStart(3, '0')}  ${s}\n`; logEl.scrollTop = 1e9; };
  let device, raf;
  m.querySelector('#ctClose').onclick = () => { cancelAnimationFrame(raf); device?.gatt?.disconnect(); document.removeEventListener('keydown', onKey); m.remove(); };
  m.querySelector('#ctCopy').onclick = () => navigator.clipboard?.writeText(logEl.textContent);
  const onKey = e => { if (e.key === 'Escape') return m.querySelector('#ctClose').click(); log(`Key: ${e.code}`); }; document.addEventListener('keydown', onKey);
  // gamepads
  const prev = {};
  const poll = () => { for (const gp of navigator.getGamepads?.() || []) { if (!gp) continue; padButtons(gp).forEach((p, i) => { const k = gp.index + ':' + i; if (p !== !!prev[k]) { prev[k] = p; log(`Gamepad ${gp.id.slice(0, 30)} ${BTN[i] || 'Button ' + i}${p ? ` pressed${ACT[i] ? ' → ' + ACT[i] : ''}` : ' released'}`); } }); } raf = requestAnimationFrame(poll); }; poll();
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
