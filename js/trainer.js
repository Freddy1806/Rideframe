// Smart trainer over Web Bluetooth.
// 1) FTMS (Fitness Machine Service, KICKR since 2020 firmware, also Tacx/Elite/Saris)
// 2) Fallback: Wahoo legacy trainer characteristic inside the Cycling Power service
// Plus optional heart-rate strap.
const FTMS = 0x1826, IBD = 0x2ad2, FTMS_CP = 0x2ad9, FTMS_STATUS = 0x2ada;
const CPS = 0x1818, CPM = 0x2a63;
const WAHOO_CP = 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b';
const HRS = 0x180d, HRM = 0x2a37;

/** what to tell people where the browser has no Bluetooth (every iPhone browser except Bluefy; Firefox) */
export const BT_HELP = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  ? 'Apple does not allow Bluetooth in iPhone browsers. Open RIDEFRAME in the free “Bluefy” browser, or in Chrome on a laptop.'
  : 'This browser has no Bluetooth. Please use Chrome or Edge.';
/** the device chooser. Some browsers (Bluefy on the iPhone) reject long filter lists: then show every device nearby instead of failing silently */
export async function pickDevice(o) {
  if (!navigator.bluetooth) throw new Error(BT_HELP);
  try { return await navigator.bluetooth.requestDevice(o); }
  catch (e) { if (o.acceptAllDevices || ['NotFoundError', 'SecurityError', 'AbortError', 'NotAllowedError'].includes(e.name)) throw e;
    return await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: o.optionalServices || [] }); }
}

export class Trainer extends EventTarget {
  constructor() {
    super();
    this.device = null; this.mode = null; this.cp = null;
    this.data = { power: 0, cadence: 0, speed: 0, hr: 0 };
    this.lastGrade = null; this.lastSend = 0; this.queue = Promise.resolve();
    this._crank = null;
  }
  static supported() { return !!navigator.bluetooth; }
  get connected() { return !!this.device?.gatt?.connected; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async connect() {
    this.device = await pickDevice({
      filters: [{ services: [FTMS] }, { services: [CPS] }, { namePrefix: 'KICKR' }],
      optionalServices: [FTMS, CPS, WAHOO_CP, 'a026ee01-0a7d-4ab3-97fa-f1500f9feb8b', 0x180a],
    });
    this.device.addEventListener('gattserverdisconnected', () => { this.emit('status', 'disconnected'); this._reconnect(); });
    await this._setup();
  }

  async _reconnect() {
    for (let i = 0; i < 5 && this.device && !this.connected; i++) {
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
      try { await this._setup(); return; } catch {}
    }
  }

  async _setup() {
    this.emit('status', 'connecting');
    const server = await this.device.gatt.connect();
    let ftms = null;
    try { ftms = await server.getPrimaryService(FTMS); } catch {}
    if (ftms) {
      const ibd = await ftms.getCharacteristic(IBD);
      ibd.addEventListener('characteristicvaluechanged', e => this._onIBD(e.target.value));
      await ibd.startNotifications();
      this.cp = await ftms.getCharacteristic(FTMS_CP);
      this.cp.addEventListener('characteristicvaluechanged', e => this._onCPResponse(e.target.value));
      await this.cp.startNotifications();
      await this._write([0x00]);        // request control
      await this._write([0x07]);        // start / resume
      this.mode = 'ftms';
    } else {
      const cps = await server.getPrimaryService(CPS);
      const m = await cps.getCharacteristic(CPM);
      m.addEventListener('characteristicvaluechanged', e => this._onCPM(e.target.value));
      await m.startNotifications();
      try {
        this.cp = await cps.getCharacteristic(WAHOO_CP);
        this.cp.addEventListener('characteristicvaluechanged', () => {});
        await this.cp.startNotifications();
        await this._write([0x20, 0xee, 0xfc]);  // unlock
        this.mode = 'wahoo';
      } catch { this.mode = 'power-only'; this.cp = null; }
    }
    this.lastGrade = null;
    if (this.sim) await this.setSim(this.sim);
    this.emit('status', 'connected');
  }

  disconnect() { const d = this.device; this.device = null; d?.gatt?.disconnect(); this.emit('status', 'disconnected'); }

  _write(bytes) {
    this.queue = this.queue.then(() => this.cp?.writeValueWithResponse
      ? this.cp.writeValueWithResponse(new Uint8Array(bytes))
      : this.cp?.writeValue(new Uint8Array(bytes))).catch(err => console.warn('trainer write', err));
    return this.queue;
  }
  _onCPResponse(dv) { if (dv.getUint8(0) === 0x80 && dv.getUint8(2) !== 0x01) console.warn('FTMS op', dv.getUint8(1), 'result', dv.getUint8(2)); }

  _onIBD(dv) {
    const flags = dv.getUint16(0, true); let o = 2;
    const d = this.data;
    if (!(flags & 0x0001)) { d.speed = dv.getUint16(o, true) / 100 / 3.6; o += 2; }
    if (flags & 0x0002) o += 2;
    if (flags & 0x0004) { d.cadence = dv.getUint16(o, true) / 2; o += 2; }
    if (flags & 0x0008) o += 2;
    if (flags & 0x0010) o += 3;
    if (flags & 0x0020) o += 2;
    if (flags & 0x0040) { d.power = dv.getInt16(o, true); o += 2; }
    if (flags & 0x0080) o += 2;
    if (flags & 0x0100) o += 5;
    if (flags & 0x0200) { const hr = dv.getUint8(o); if (hr) d.hr = hr; o += 1; }
    this.lastData = performance.now();
    this.emit('data', d);
  }

  _onCPM(dv) {
    const flags = dv.getUint16(0, true);
    this.data.power = dv.getInt16(2, true);
    let o = 4;
    if (flags & 0x01) o += 1; if (flags & 0x04) o += 2; if (flags & 0x10) o += 6;
    if (flags & 0x20) {
      const revs = dv.getUint16(o, true), time = dv.getUint16(o + 2, true);
      if (this._crank) {
        const dr = (revs - this._crank.revs + 65536) % 65536, dtm = ((time - this._crank.time + 65536) % 65536) / 1024;
        if (dtm > 0) this.data.cadence = Math.round(dr / dtm * 60);
        else if (performance.now() - this._crank.at > 2500) this.data.cadence = 0;
      }
      if (!this._crank || revs !== this._crank.revs) this._crank = { revs, time, at: performance.now() };
    }
    this.lastData = performance.now();
    this.emit('data', this.data);
  }

  async setSim(sim) {
    // sim: { riderKg, bikeKg, crr, cw }
    this.sim = sim;
    if (this.mode === 'wahoo') {
      const w = Math.round((sim.riderKg + sim.bikeKg) * 100), crr = Math.round(sim.crr * 10000), cw = Math.round(sim.cw * 1000);
      await this._write([0x43, w & 255, w >> 8, crr & 255, crr >> 8, cw & 255, cw >> 8]);
    }
  }

  /** ERG mode: the trainer holds this power whatever the cadence (training programs). null = back to road grade. */
  setPower(watts) {
    if (!this.cp || !this.connected) { this.erg = watts; return; }
    if (watts == null) { if (this.erg != null) { this.erg = null; this.lastGrade = null; } return; }
    watts = Math.max(0, Math.min(2000, Math.round(watts)));
    const now = performance.now();
    if (watts === this.erg && now - this.lastSend < 5000) return;
    this.erg = watts; this.lastSend = now;
    if (this.mode === 'ftms') this._write([0x05, watts & 255, (watts >> 8) & 255]);
    else if (this.mode === 'wahoo') this._write([0x42, watts & 255, watts >> 8]);
  }

  /** Send road grade in % (already scaled by difficulty). Rate-limited. */
  setGrade(grade, force = false) {
    if (!this.cp || !this.connected || this.erg != null) return;
    grade = Math.max(-20, Math.min(20, grade));
    const now = performance.now();
    if (!force && this.lastGrade !== null && Math.abs(grade - this.lastGrade) < 0.1 && now - this.lastSend < 5000) return;
    if (!force && now - this.lastSend < 900) return;
    this.lastGrade = grade; this.lastSend = now;
    if (this.mode === 'ftms') {
      const g = Math.round(grade * 100), crr = Math.round((this.sim?.crr ?? 0.004) * 10000), cw = Math.round((this.sim?.cw ?? 0.51) * 100);
      this._write([0x11, 0, 0, g & 255, (g >> 8) & 255, crr, cw]);
    } else if (this.mode === 'wahoo') {
      const v = Math.round((Math.max(-1, Math.min(1, grade / 100)) + 1) * 65535 / 2);
      this._write([0x46, v & 255, v >> 8]);
    }
  }
}

export class HeartRate extends EventTarget {
  async connect(all = false) {
    // straps only advertise while worn (moist electrodes) and often hide the HR service in their advert: also match common names
    const names = ['HRM', 'Polar', 'TICKR', 'Wahoo', 'Garmin', 'COOSPO', 'Coospo', 'Magene', 'Suunto', 'Decathlon', 'Kalenji', 'XOSS', 'iGPSPORT', 'H10', 'H9', 'Verity', 'Forerunner', 'fenix', 'Apple Watch', 'Whoop', 'WHOOP', 'Amazfit', 'Scosche', 'Rhythm', 'CooSpo', 'Heart'];
    this.device = await pickDevice(all ? { acceptAllDevices: true, optionalServices: [HRS, 'battery_service'] }
      : { filters: [{ services: [HRS] }, ...names.map(namePrefix => ({ namePrefix }))], optionalServices: [HRS, 'battery_service'] });
    this.device.addEventListener('gattserverdisconnected', () => this._lost());
    await this._open();
  }
  async _open() {
    const srv = await this.device.gatt.connect();
    let s;
    try { s = await srv.getPrimaryService(HRS); }
    catch { this.device.gatt.disconnect(); throw new Error(`“${this.device.name || 'Device'}” sends no heart rate (no heart rate service). On a watch, first turn on “broadcast heart rate”.`); }
    const c = await s.getCharacteristic(HRM);
    c.addEventListener('characteristicvaluechanged', e => {
      const dv = e.target.value; const f = dv.getUint8(0);
      this.hr = f & 1 ? dv.getUint16(1, true) : dv.getUint8(1);
      this.lastSeen = performance.now();
      this.dispatchEvent(new CustomEvent('hr', { detail: this.hr }));
    });
    await c.startNotifications();
    this.battery = null; // battery level, if the strap tells it: an empty battery is the most common reason a strap vanishes
    try { const b = await (await srv.getPrimaryService('battery_service')).getCharacteristic('battery_level'); this.battery = (await b.readValue()).getUint8(0); } catch {}
    this.dispatchEvent(new Event('change'));
  }
  /** strap dropped (out of range, sweat, battery): try to get it back a few times */
  async _lost() {
    this.hr = 0; this.dispatchEvent(new Event('change'));
    if (this.closing) return;
    for (let i = 0; i < 6 && !this.closing; i++) {
      await new Promise(r => setTimeout(r, 2000 + i * 2000));
      try { await this._open(); this.dispatchEvent(new CustomEvent('reconnected')); return; } catch {}
    }
  }
  disconnect() { this.closing = true; try { this.device?.gatt?.disconnect(); } catch {} }
  get connected() { return !!this.device?.gatt?.connected; }
}

/** Bluetooth speed/cadence sensor (Cycling Speed and Cadence service, e.g. Garmin, Wahoo RPM, Magene S3+): cadence for
 *  rides outside (outdoor.html). Emits 'cad' (rpm) and 'speed' (m/s, wheel 2.105 m) and 'change'. */
const CSC = 0x1816, CSCM = 0x2a5b;
export class CadenceSensor extends EventTarget {
  async connect() {
    this.device = await pickDevice({ filters: [{ services: [CSC] }], optionalServices: [CSC, 'battery_service'] });
    this.device.addEventListener('gattserverdisconnected', () => this._lost());
    await this._open();
  }
  async _open() {
    const c = await (await (await this.device.gatt.connect()).getPrimaryService(CSC)).getCharacteristic(CSCM);
    c.addEventListener('characteristicvaluechanged', e => this._on(e.target.value));
    await c.startNotifications(); this.dispatchEvent(new Event('change'));
  }
  _on(dv) {
    const f = dv.getUint8(0); let o = 1; const now = performance.now();
    if (f & 1) { const rev = dv.getUint32(o, true), t = dv.getUint16(o + 4, true); o += 6;
      if (this._w) { const dr = rev - this._w.rev, dt = ((t - this._w.t + 65536) % 65536) / 1024; if (dt > 0 && dr >= 0 && dr < 100) { this.speed = dr * 2.105 / dt; this._wAt = now; this.dispatchEvent(new CustomEvent('speed', { detail: this.speed })); } }
      this._w = { rev, t }; }
    if (f & 2) { const rev = dv.getUint16(o, true), t = dv.getUint16(o + 2, true);
      if (this._c) { const dr = (rev - this._c.rev + 65536) % 65536, dt = ((t - this._c.t + 65536) % 65536) / 1024;
        if (dt > 0 && dr < 20) { this.cad = Math.round(dr / dt * 60); this._cAt = now; this.dispatchEvent(new CustomEvent('cad', { detail: this.cad })); }
        else if (dr === 0 && now - (this._cAt || 0) > 3000) { this.cad = 0; this.dispatchEvent(new CustomEvent('cad', { detail: 0 })); } }
      this._c = { rev, t }; }
  }
  async _lost() {
    this.cad = 0; this.dispatchEvent(new Event('change'));
    for (let i = 0; i < 6 && !this.closing; i++) { await new Promise(r => setTimeout(r, 2000 + i * 2000)); try { await this._open(); return; } catch {} }
  }
  get connected() { return !!this.device?.gatt?.connected; }
}
