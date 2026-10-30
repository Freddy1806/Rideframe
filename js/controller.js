// "Controller testen": find any Bluetooth device (e.g. Shimano Di2 D-FLY, Zwift Click, remotes)
// and show every notification it sends, so buttons can be mapped to game actions.
const SHIMANO_BASE = n => `0000${n.toString(16).padStart(4, '0')}-5348-494d-414e-4f5f424c4500`; // "SHIMANO_BLE"
const CANDIDATES = [
  ...Array.from({ length: 256 }, (_, i) => 0x1800 + i),          // all standard 16-bit services
  ...Array.from({ length: 32 }, (_, i) => SHIMANO_BASE(0x18e0 + i)),
  '00000001-19ca-4651-86e5-fa29dcdd09d1',                         // Zwift Click / Play
  'a026ee01-0a7d-4ab3-97fa-f1500f9feb8b', 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
];
const hex = dv => [...new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)].map(b => b.toString(16).padStart(2, '0')).join(' ');

export function openControllerTest() {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box" style="width:min(820px,94vw)">
    <div class="label">Bluetooth</div><h2 class="display" style="margin-top:10px">Controller<br>testen</h2>
    <p>Gerät wählen (z. B. dein Di2-Schaltwerk: vorher kurz schalten, damit es aufwacht), dann die Knöpfe drücken. Jede Nachricht erscheint unten. Gamepads und Tastatur werden auch angezeigt.</p>
    <div class="actions" style="justify-content:flex-start"><button class="btn small" id="ctScan">Gerät suchen</button><button class="btn ghost small" id="ctCopy">Log kopieren</button><button class="btn ghost small" id="ctClose">Schließen</button></div>
    <pre id="ctLog" style="margin-top:18px;height:340px;overflow:auto;background:#000;border:1px solid var(--line-2);border-radius:4px;padding:12px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap"></pre></div>`;
  document.body.append(m);
  const logEl = m.querySelector('#ctLog');
  const log = s => { logEl.textContent += `${new Date().toLocaleTimeString('de-DE')}.${String(Date.now() % 1000).padStart(3, '0')}  ${s}\n`; logEl.scrollTop = 1e9; };
  let device, raf;
  m.querySelector('#ctClose').onclick = () => { cancelAnimationFrame(raf); device?.gatt?.disconnect(); document.removeEventListener('keydown', onKey); m.remove(); };
  m.querySelector('#ctCopy').onclick = () => navigator.clipboard?.writeText(logEl.textContent);
  const onKey = e => log(`Taste: ${e.code}`); document.addEventListener('keydown', onKey);
  // gamepads
  const prev = {};
  const poll = () => { for (const gp of navigator.getGamepads?.() || []) { if (!gp) continue; gp.buttons.forEach((b, i) => { const k = gp.index + ':' + i; if (b.pressed !== !!prev[k]) { prev[k] = b.pressed; log(`Gamepad ${gp.id.slice(0, 30)} Knopf ${i} ${b.pressed ? 'gedrückt' : 'los'}`); } }); } raf = requestAnimationFrame(poll); }; poll();
  m.querySelector('#ctScan').onclick = async () => {
    if (!navigator.bluetooth) return log('Kein Web Bluetooth (bitte Chrome/Edge).');
    try {
      device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: CANDIDATES });
      log(`Gerät: ${device.name || '(ohne Name)'} – verbinde…`);
      const server = await device.gatt.connect();
      const services = await server.getPrimaryServices();
      for (const s of services) {
        log(`Dienst ${s.uuid}`);
        let chars = []; try { chars = await s.getCharacteristics(); } catch (e) { log(`  (Merkmale gesperrt: ${e.message})`); }
        for (const c of chars) {
          const p = Object.entries(c.properties).filter(([, v]) => v).map(([k]) => k).join(',');
          log(`  Merkmal ${c.uuid} [${p}]`);
          if (c.properties.read) try { log(`    Wert: ${hex(await c.readValue())}`); } catch {}
          if (c.properties.notify || c.properties.indicate) {
            try { c.addEventListener('characteristicvaluechanged', e => log(`◆ ${c.uuid.slice(0, 8)}: ${hex(e.target.value)}`)); await c.startNotifications(); log('    hört zu'); }
            catch (e) { log(`    Abo fehlgeschlagen: ${e.message}`); }
          }
        }
      }
      log('Bereit. Jetzt Knöpfe drücken.');
    } catch (e) { log('Fehler: ' + e.message); }
  };
}
