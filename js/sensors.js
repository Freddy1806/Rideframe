// Sensors for rides outside (Freddy 15.11.): one button "Gerät verbinden", the app finds out by itself what a device
// can do (heart rate, power, cadence, speed; also Wahoo/FTMS devices), keeps several connected at once and remembers
// every device (several bikes): next time it reconnects on its own where the browser allows it (Chrome getDevices),
// otherwise one tap on the remembered device opens the chooser again.
import { db } from './db.js';
import { pickDevice } from './trainer.js';

const HRS = 0x180d, HRM = 0x2a37, CPS = 0x1818, CPM = 0x2a63, CSC = 0x1816, CSCM = 0x2a5b, FTMS = 0x1826, IBD = 0x2ad2;
const NAMES = ['HRM', 'Polar', 'TICKR', 'Wahoo', 'KICKR', 'ELEMNT', 'Garmin', 'HRM-Pro', 'COOSPO', 'Coospo', 'CooSpo', 'Magene', 'Suunto', 'Decathlon', 'XOSS', 'iGPSPORT',
  'Favero', 'ASSIOMA', 'Assioma', 'Stages', '4iiii', 'SRM', 'Quarq', 'Rally', 'Vector', 'PowerTap', 'Rotor', 'SIGEYI', 'Shimano', 'Verity', 'H10', 'H9', 'Forerunner', 'fenix', 'Edge', 'RPM', 'Whoop', 'WHOOP', 'Amazfit'];
const WHAT = { hr: 'Puls', power: 'Leistung', cad: 'Trittfrequenz', speed: 'Tempo' };

export class SensorHub extends EventTarget {
  constructor() { super(); this.live = { hr: 0, power: 0, cad: 0, speed: 0 }; this.at = { hr: 0, power: 0, cad: 0 }; this.devs = new Map(); this.known = []; }
  static supported() { return !!navigator.bluetooth; }
  get count() { return [...this.devs.values()].filter(d => d.dev.gatt?.connected).length; }
  emit(t) { this.dispatchEvent(new Event(t)); }
  async load() { this.known = (await db.kvGet('sensors').catch(() => null)) || []; return this.known; }
  async save() { await db.kvSet('sensors', this.known).catch(() => {}); }
  /** the remembered devices with their state, for the list */
  list() { return this.known.map(k => ({ ...k, on: !!this.devs.get(k.id)?.dev.gatt?.connected })); }

  /** one chooser for every kind of sensor */
  async pair() {
    const dev = await pickDevice({ filters: [{ services: [HRS] }, { services: [CPS] }, { services: [CSC] }, { services: [FTMS] }, ...NAMES.map(namePrefix => ({ namePrefix }))],
      optionalServices: [HRS, CPS, CSC, FTMS, 'battery_service'] });
    await this._open(dev);
  }
  /** reconnect remembered devices without a chooser (Chrome with getDevices); returns how many came back */
  async auto() {
    if (!navigator.bluetooth?.getDevices) return 0;
    let n = 0; const ids = new Set(this.known.map(k => k.id));
    for (const dev of await navigator.bluetooth.getDevices().catch(() => [])) {
      if (!ids.has(dev.id) || this.devs.get(dev.id)?.dev.gatt?.connected) continue;
      try { await this._open(dev); n++; } catch { // not in range yet: connect as soon as it advertises
        try { await dev.watchAdvertisements?.(); dev.addEventListener('advertisementreceived', () => this._open(dev).catch(() => {}), { once: true }); } catch {} }
    }
    return n;
  }
  async forget(id) { this.known = this.known.filter(k => k.id !== id); await this.save(); const d = this.devs.get(id); this.devs.delete(id); try { d && (d.closing = true, d.dev.gatt.disconnect()); } catch {} this.emit('change'); }
  disconnect(id) { const d = this.devs.get(id); if (d) { d.closing = true; try { d.dev.gatt.disconnect(); } catch {} } this.emit('change'); }

  async _open(dev) {
    const srv = await dev.gatt.connect(), roles = new Set(), rec = this.devs.get(dev.id) || { dev, closing: false };
    rec.closing = false; this.devs.set(dev.id, rec);
    const sub = async (svc, ch, fn) => { try { const c = await (await srv.getPrimaryService(svc)).getCharacteristic(ch); c.addEventListener('characteristicvaluechanged', e => fn(e.target.value)); await c.startNotifications(); return true; } catch { return false; } };
    if (await sub(HRS, HRM, v => this._hr(v))) roles.add('hr');
    if (await sub(CPS, CPM, v => this._cpm(v, rec))) { roles.add('power'); roles.add('cad'); }
    else if (await sub(FTMS, IBD, v => this._ibd(v))) { roles.add('power'); roles.add('cad'); } // Wahoo KICKR & other smart trainers
    if (await sub(CSC, CSCM, v => this._csc(v, rec))) { roles.add('cad'); roles.add('speed'); }
    if (!roles.size) { dev.gatt.disconnect(); this.devs.delete(dev.id); throw new Error(`„${dev.name || 'Gerät'}“ sendet weder Puls noch Leistung noch Trittfrequenz. Bei Uhren erst „Herzfrequenz senden“ einschalten.`); }
    try { rec.battery = (await (await (await srv.getPrimaryService('battery_service')).getCharacteristic('battery_level')).readValue()).getUint8(0); } catch {}
    rec.roles = [...roles];
    if (!rec.wired) { rec.wired = true; dev.addEventListener('gattserverdisconnected', () => this._lost(rec)); }
    const k = this.known.find(x => x.id === dev.id), entry = { id: dev.id, name: dev.name || 'Sensor', roles: rec.roles, at: Date.now() };
    if (k) Object.assign(k, entry); else this.known.push(entry);
    await this.save(); this.emit('change');
  }
  async _lost(rec) {
    this.emit('change');
    for (let i = 0; i < 8 && !rec.closing; i++) { await new Promise(r => setTimeout(r, 2000 + i * 2000)); if (rec.closing) return; try { await this._open(rec.dev); return; } catch {} }
  }
  _set(k, v) { this.live[k] = v; this.at[k] = performance.now(); this.emit('data'); }
  _hr(dv) { const f = dv.getUint8(0); this._set('hr', f & 1 ? dv.getUint16(1, true) : dv.getUint8(1)); }
  _cpm(dv, rec) {
    const f = dv.getUint16(0, true); this._set('power', Math.max(0, dv.getInt16(2, true)));
    let o = 4; if (f & 0x01) o += 1; if (f & 0x04) o += 2; if (f & 0x10) o += 6;
    if (f & 0x20) this._crank(dv.getUint16(o, true), dv.getUint16(o + 2, true), rec, 'cpCrank');
  }
  _ibd(dv) {
    const f = dv.getUint16(0, true); let o = 2;
    if (!(f & 1)) o += 2; if (f & 2) o += 2; if (f & 4) { this._set('cad', Math.round(dv.getUint16(o, true) / 2)); o += 2; }
    if (f & 8) o += 2; if (f & 16) o += 3; if (f & 32) o += 2; if (f & 64) this._set('power', Math.max(0, dv.getInt16(o, true)));
  }
  _csc(dv, rec) {
    const f = dv.getUint8(0); let o = 1;
    if (f & 1) { const rev = dv.getUint32(o, true), t = dv.getUint16(o + 4, true); o += 6;
      if (rec.w) { const dr = rev - rec.w.rev, dt = ((t - rec.w.t + 65536) % 65536) / 1024; if (dt > 0 && dr >= 0 && dr < 100) this._set('speed', dr * 2.105 / dt); }
      rec.w = { rev, t }; }
    if (f & 2) this._crank(dv.getUint16(o, true), dv.getUint16(o + 2, true), rec, 'cscCrank');
  }
  _crank(revs, time, rec, key) {
    const c = rec[key], now = performance.now();
    if (c) { const dr = (revs - c.revs + 65536) % 65536, dt = ((time - c.time + 65536) % 65536) / 1024;
      if (dt > 0 && dr < 20) this._set('cad', Math.round(dr / dt * 60)); else if (now - c.at > 2500) this._set('cad', 0); }
    if (!c || revs !== c.revs) rec[key] = { revs, time, at: now };
  }
  /** values older than 3 s count as 0 (sensor asleep, stopped pedalling) */
  get(k) { return performance.now() - (this.at[k] || 0) > 3000 ? 0 : this.live[k]; }
  has(k) { return [...this.devs.values()].some(d => d.dev.gatt?.connected && d.roles?.includes(k)); }
}
export const roleText = roles => (roles || []).map(r => WHAT[r]).filter(Boolean).join(' · ');
