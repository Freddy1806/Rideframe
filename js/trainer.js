// Smart trainer over Web Bluetooth.
// 1) FTMS (Fitness Machine Service, KICKR since 2020 firmware, also Tacx/Elite/Saris)
// 2) Fallback: Wahoo legacy trainer characteristic inside the Cycling Power service
// Plus optional heart-rate strap.
// every UUID as a full lowercase 128-bit string: Bluefy on the iPhone cannot parse 16-bit numbers or names like BAT
// and then rejects the whole device search with a bare code (Freddy 16.11.: a white "2")
export const U = n => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
const FTMS = U(0x1826), IBD = U(0x2ad2), FTMS_CP = U(0x2ad9), FTMS_STATUS = U(0x2ada);
const CPS = U(0x1818), CPM = U(0x2a63), BAT = U(0x180f), BATL = U(0x2a19);
const WAHOO_CP = 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b';
const HRS = U(0x180d), HRM = U(0x2a37);

/** what to tell people where the browser has no Bluetooth (every iPhone browser except Bluefy; Firefox) */
export const BT_HELP = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  ? 'Apple does not allow Bluetooth in iPhone browsers. Open RIDEFRAME in the free “Bluefy” browser, or in Chrome on a laptop.'
  : 'This browser has no Bluetooth. Please use Chrome or Edge.';
/** the device chooser. Some browsers (Bluefy on the iPhone) reject long filter lists: then show every device nearby instead of failing silently */
export async function pickDevice(o) {
  if (!navigator.bluetooth) throw new Error(BT_HELP);
  try { return await navigator.bluetooth.requestDevice(o); }
  catch (e) { if (o.acceptAllDevices || ['NotFoundError', 'SecurityError', 'AbortError', 'NotAllowedError'].includes(e?.name)) throw btError('Device list', e);
    try { return await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: o.optionalServices || [] }); } catch (e2) { throw btError('Device list', e2); } }
}
/** Bluefy rejects with bare codes like "2" (Freddy 16.11.): say at which step it failed, so the message means something */
export function btError(step, e) {
  if (e?.name === 'NotFoundError') return e; // the chooser was closed: nothing to report
  const raw = e?.message || String(e), bare = !e?.name || /^\d*$/.test(raw); // no proper error: a wrapper browser like Bluefy
  const err = new Error(bare && step === 'Device list' ? `The browser refused the Bluetooth search (code ${raw}). iPhone: Settings → Privacy & Security → Bluetooth → allow Bluefy, switch Bluetooth on, then reopen Bluefy.`
    : `${step} failed (${raw}). Close other apps that use the device, wake it up, then try again.`);
  err.step = step; return err;
}

export class Trainer extends EventTarget {
  constructor() {
    super();
    this.device = null; this.mode = null; this.cp = null;
    this.data = { power: 0, cadence: 0, speed: 0, hr: 0 };
    this.lastGrade = null; this.lastSend = 0; this.queue = Promise.resolve();
    this._crank = null;
    this.pmOnly = false; // "Power meter only" (Freddy 18.11.): read the watts, never take control of the trainer (another app runs it)
  }
  static supported() { return !!navigator.bluetooth; }
  get connected() { return !!this.device?.gatt?.connected; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async connect() {
    this.device = await pickDevice(this.pmOnly ? { filters: [{ services: [CPS] }], optionalServices: [CPS, FTMS, U(0x180a)] } : {
      filters: [{ services: [FTMS] }, { services: [CPS] }, { namePrefix: 'KICKR' }],
      optionalServices: [FTMS, CPS, WAHOO_CP, 'a026ee01-0a7d-4ab3-97fa-f1500f9feb8b', U(0x180a)],
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
    let step = 'Connecting';
    try { await this._setupSteps(s => step = s); } catch (e) { throw e?.step ? e : btError(step, e); }
  }
  async _setupSteps(at) {
    const server = await this.device.gatt.connect();
    at('Reading the trainer');
    this.ctlRefused = null;
    if (this.pmOnly) return this._listenOnly(server);
    let ftms = null;
    try { ftms = await server.getPrimaryService(FTMS); } catch {}
    if (ftms) {
      const ibd = await ftms.getCharacteristic(IBD);
      ibd.addEventListener('characteristicvaluechanged', e => this._onIBD(e.target.value));
      await ibd.startNotifications();
      this.mode = 'ftms';
      try { // control is a bonus: without it the trainer still sends watts (some browsers refuse the control point)
        this.cp = await ftms.getCharacteristic(FTMS_CP);
        this.cp.addEventListener('characteristicvaluechanged', e => this._onCPResponse(e.target.value));
        await this.cp.startNotifications();
        await this._write([0x00]);        // request control
        await this._write([0x07]);        // start / resume
      } catch { this.cp = null; this.mode = 'power-only'; }
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
    if (this.sim) try { await this.setSim(this.sim); } catch {}
    this.emit('status', 'connected');
    if (this.erg != null) { this.ergSent = null; if (!this._pwBusy) this._sendPower(); } // after a reconnect the trainer has forgotten the ERG target: send it again at once
  }

  /** power meter only: the watts (and cadence) from the Cycling Power Service, or a trainer's own data; no control point is
   *  ever opened, so no ERG, no gradient, and another app keeps the trainer */
  async _listenOnly(server) {
    let cps = null; try { cps = await server.getPrimaryService(CPS); } catch {}
    if (cps) { const m = await cps.getCharacteristic(CPM); m.addEventListener('characteristicvaluechanged', e => this._onCPM(e.target.value)); await m.startNotifications(); }
    else { const ibd = await (await server.getPrimaryService(FTMS)).getCharacteristic(IBD); ibd.addEventListener('characteristicvaluechanged', e => this._onIBD(e.target.value)); await ibd.startNotifications(); }
    this.cp = null; this.mode = 'pm'; this.erg = null; this.lastGrade = null;
    this.emit('status', 'connected');
  }
  /** switch between trainer control and power meter only: never both, so the device connected for the other one is dropped.
   *  Returns true when a device was disconnected. */
  setPmOnly(on) {
    on = !!on; if (on === this.pmOnly) return false;
    const was = !!this.device; if (was) this.disconnect();
    this.pmOnly = on; this.cp = null; this.erg = null; this.lastGrade = null; this.mode = null;
    return was;
  }

  disconnect() { const d = this.device; this.device = null; d?.gatt?.disconnect(); this.emit('status', 'disconnected'); }

  _write(bytes) {
    this.queue = this.queue.then(() => this.cp?.writeValueWithResponse
      ? this.cp.writeValueWithResponse(new Uint8Array(bytes))
      : this.cp?.writeValue(new Uint8Array(bytes))).catch(err => console.warn('trainer write', err));
    return this.queue;
  }
  /** the trainer's answer to a control point command. A refused ERG target (0x05) or a refused "request control" (0x00) used
   *  to be a console line only, so the app showed 340 W while the trainer stayed where it was (Freddy 20.11.). Now: ask for
   *  control again and send the target once more (at most every 3 s), and tell the ride ('control' event) so it can say so. */
  _onCPResponse(dv) {
    if (dv.byteLength < 3 || dv.getUint8(0) !== 0x80) return;
    const op = dv.getUint8(1), res = dv.getUint8(2);
    if (res === 0x01) { if (op === 0x05 && this.ctlRefused) { this.ctlRefused = null; this.emit('control', { ok: true }); } return; }
    console.warn('FTMS op', op, 'result', res);
    if (op !== 0x05 && op !== 0x00) return;
    const first = !this.ctlRefused; this.ctlRefused = { op, res, at: performance.now() };
    if (first) this.emit('control', { ok: false, op, res });
    if (op === 0x05 && this.erg != null && performance.now() - (this._ctlRetry || -1e9) > 3000) { this._ctlRetry = performance.now();
      this._write([0x00]); this._write([0x07]); this.ergSent = null; if (this._pwBusy) this._pwNext = true; else this._sendPower(); }
  }

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
    if (this.pmOnly) { this.erg = null; return; } // power meter only: never a target to the trainer
    if (!this.cp || !this.connected) { this.erg = watts; return; }
    if (watts == null) { if (this.erg != null) { this.erg = null; this.lastGrade = null; } return; }
    watts = Math.max(0, Math.min(2000, Math.round(watts)));
    const now = performance.now();
    if (watts === this.erg && now - this.lastSend < 5000) return;
    this.erg = watts;
    // Only the newest target counts (Freddy 20.11.: "420 W, and the trainer needs 30 s"): a ramp asks for a new wattage every
    // frame, each write waits for the trainer's answer, so the old queue ran many seconds behind. Now at most one write is
    // under way and one waits; when the one under way is answered, the newest wattage goes out (never an older one).
    if (this._pwBusy) { this._pwNext = true; return; }
    this._sendPower();
  }
  _sendPower() {
    const watts = this.erg; if (watts == null || !this.cp || !this.connected) { this._pwBusy = false; this._pwNext = false; return; }
    this._pwBusy = true; this._pwNext = false; this.lastSend = performance.now(); this.ergSent = watts;
    const done = () => { this._pwBusy = false; if (this._pwNext && this.erg != null && this.erg !== this.ergSent) this._sendPower(); else this._pwNext = false; };
    const p = this.mode === 'ftms' ? this._write([0x05, watts & 255, (watts >> 8) & 255]) : this.mode === 'wahoo' ? this._write([0x42, watts & 255, watts >> 8]) : null;
    if (p?.then) p.then(done, done); else done();
  }

  /** Send road grade in % (already scaled by difficulty). Rate-limited. */
  setGrade(grade, force = false) {
    if (this.pmOnly || !this.cp || !this.connected || this.erg != null) return;
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
    this.device = await pickDevice(all ? { acceptAllDevices: true, optionalServices: [HRS, BAT] }
      : { filters: [{ services: [HRS] }, ...names.map(namePrefix => ({ namePrefix }))], optionalServices: [HRS, BAT] });
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
    try { const b = await (await srv.getPrimaryService(BAT)).getCharacteristic(BATL); this.battery = (await b.readValue()).getUint8(0); } catch {}
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
const CSC = U(0x1816), CSCM = U(0x2a5b);
export class CadenceSensor extends EventTarget {
  async connect() {
    this.device = await pickDevice({ filters: [{ services: [CSC] }], optionalServices: [CSC, BAT] });
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
