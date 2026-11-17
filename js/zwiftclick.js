// Zwift Click (v1) and Click v2 as a shifter for the virtual gears in the 3D ride.
// Protocol as documented by the open-source BikeControl/SwiftControl project: subscribe, write "RideOn", then the
// buttons arrive unencrypted as <type byte><protobuf>. No hardware was at hand when this was written: the decoding
// follows those facts exactly and is tested with recorded-style frames (tools/clicktest.mjs, tools/clicktest-ui.cjs).
import { U, pickDevice, btError } from './trainer.js';

const Z = n => `0000000${n}-19ca-4651-86e5-fa29dcdd09d1`; // full 128-bit, lowercase: Bluefy cannot parse short UUIDs
export const CLICK_SVC = Z(1), RIDE_SVC = U(0xfc82), ASYNC = Z(2), SYNC_RX = Z(3), SYNC_TX = Z(4);
const BAT = U(0x180f), BATL = U(0x2a19);
const RIDE_ON = [0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e]; // "RideOn"
const T_EMPTY = 0x15, T_BATTERY = 0x19, T_RIDE_KEYS = 0x23, T_CLICK_KEYS = 0x37;

/** Ride / Click v2 button bits: a 0 bit means pressed (idle frame: 08 ff ff ff ff 0f) */
export const MASK = { LEFT: 0x1, UP: 0x2, RIGHT: 0x4, DOWN: 0x8, A: 0x10, B: 0x20, Y: 0x40, Z: 0x100,
  SHFT_UP_L: 0x200, SHFT_DN_L: 0x400, POWERUP_L: 0x800, ONOFF_L: 0x1000, SHFT_UP_R: 0x2000, SHFT_DN_R: 0x4000, POWERUP_R: 0x10000, ONOFF_R: 0x20000 };
/** which buttons shift: v1 + / −, v2 right puck harder, left puck easier. A/B/Y/Z and the arrows stay free (still sent as 'button') */
export const SHIFT = { PLUS: 1, SHFT_UP_R: 1, SHFT_DN_R: 1, MINUS: -1, SHFT_UP_L: -1, SHFT_DN_L: -1 };

const bytesOf = v => v instanceof Uint8Array ? v : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(v || []);
/** one protobuf varint at i: [value, next index] or null when cut off. Plain arithmetic, not bit ops: the v2 mask uses all 32 bits */
export function readVarint(b, i) {
  let v = 0, mul = 1;
  for (let k = 0; k < 10 && i < b.length; k++, i++) { const x = b[i]; v += (x & 0x7f) * mul; mul *= 128; if (!(x & 0x80)) return [v, i + 1]; }
  return null;
}
/** the varint fields of a protobuf message (field number -> last value); other wire types are skipped. null when malformed */
export function readProto(b, i = 0) {
  b = bytesOf(b); const f = new Map();
  while (i < b.length) {
    const key = readVarint(b, i); if (!key) return null;
    const field = Math.floor(key[0] / 8), wire = key[0] % 8; i = key[1];
    if (wire === 0) { const v = readVarint(b, i); if (!v) return null; f.set(field, v[0]); i = v[1]; }
    else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else if (wire === 2) { const n = readVarint(b, i); if (!n) return null; i = n[1] + n[0]; }
    else return null;
    if (i > b.length) return null;
  }
  return f;
}
/** a keypad frame -> { plus, minus, buttons: { NAME: pressed } }, anything else (battery, keep-alive, garbage) -> null */
export function decodeFrame(bytes) {
  const b = bytesOf(bytes); if (b.length < 1) return null;
  if (b[0] === T_CLICK_KEYS) {
    const f = readProto(b, 1); if (!f) return null;
    // 0 = pressed, 1 = released. Protobuf would read a missing field as 0 (pressed), as BikeControl does; we read it
    // as released instead, so a short or odd frame can never shift on its own (the Click sends both fields anyway)
    const plus = (f.has(1) ? f.get(1) : 1) === 0, minus = (f.has(2) ? f.get(2) : 1) === 0;
    return { plus, minus, buttons: { PLUS: plus, MINUS: minus } };
  }
  if (b[0] === T_RIDE_KEYS) {
    const f = readProto(b, 1); if (!f || !f.has(1)) return null;
    const m = f.get(1), buttons = {};
    for (const [k, bit] of Object.entries(MASK)) buttons[k] = Math.floor(m / bit) % 2 === 0;
    return { plus: buttons.SHFT_UP_R || buttons.SHFT_DN_R, minus: buttons.SHFT_UP_L || buttons.SHFT_DN_L, buttons };
  }
  return null;
}
/** battery frame (0x19) -> percent, else null. v1: payload byte 1 (= field 1); v2: BatteryNotification field 2 (newPercLevel) */
export function decodeBattery(bytes) {
  const b = bytesOf(bytes); if (b.length < 2 || b[0] !== T_BATTERY) return null;
  const f = readProto(b, 1), v = f?.has(2) ? f.get(2) : f?.has(1) ? f.get(1) : b[2];
  return Number.isInteger(v) && v >= 0 && v <= 100 ? v : null;
}
/** edge detection: the Click repeats its state while a button is held, so only released -> pressed counts.
 *  feed(bytes) -> { pressed: [names newly down], shifts: [+1/-1 ...], battery } (pure, Node-testable) */
export class KeyState {
  constructor() { this.prev = {}; }
  reset() { this.prev = {}; }
  feed(bytes) {
    const out = { pressed: [], shifts: [], battery: decodeBattery(bytes) };
    const fr = decodeFrame(bytes); if (!fr) return out;
    for (const [k, down] of Object.entries(fr.buttons)) {
      if (down && !this.prev[k]) { out.pressed.push(k); if (SHIFT[k]) out.shifts.push(SHIFT[k]); }
      this.prev[k] = down;
    }
    return out;
  }
}
const startsWith = (b, p) => p.every((x, i) => b[i] === x);
const BACKOFF = [1000, 2000, 5000], RETRY_EVERY = 10000, RETRY_FOR = 120000;

export class ZwiftClick {
  constructor() {
    this.device = null; this.battery = null; this.status = 'off'; // off | connecting | on | reconnecting | lost
    this.model = ''; this.locked = false; this._h = {}; this.keys = new KeyState();
    this._onValue = this._onValue.bind(this); this._onDrop = this._onDrop.bind(this);
  }
  /** on('shift', dir => …) with dir +1 harder / −1 easier; on('button', name => …); on('state', click => …). Returns the unsubscribe */
  on(type, fn) { (this._h[type] ||= new Set()).add(fn); return () => this.off(type, fn); }
  off(type, fn) { this._h[type]?.delete(fn); }
  _emit(type, v) { for (const fn of [...(this._h[type] || [])]) try { fn(v); } catch (e) { console.warn('Zwift Click:', e); } }
  _set(s) { this.status = s; this._emit('state', this); }
  get connected() { return this.status === 'on' && !!this.device?.gatt?.connected; }
  get name() { return this.device?.name || 'Zwift Click'; }

  async connect() {
    if (this.device) this.disconnect();
    const dev = await pickDevice({ filters: [{ services: [CLICK_SVC] }, { services: [RIDE_SVC] }, { namePrefix: 'Zwift' }], optionalServices: [CLICK_SVC, RIDE_SVC, BAT] });
    this.device = dev; this._wanted = true; this.locked = false;
    dev.addEventListener('gattserverdisconnected', this._onDrop);
    this._set('connecting');
    try { await this._setup(); } catch (e) { this.disconnect(); throw e; }
  }
  disconnect() {
    this._wanted = false; clearTimeout(this._hsT);
    const d = this.device; this.device = null; this.battery = null; this.model = '';
    d?.removeEventListener('gattserverdisconnected', this._onDrop);
    try { d?.gatt?.disconnect(); } catch {}
    this._set('off');
  }

  async _setup() {
    let step = 'Connecting';
    try {
      const dev = this.device, server = await dev.gatt.connect();
      step = 'Reading the Click';
      let svc = null; // newer devices (Ride, Click v2) may only have fc82
      for (const u of [RIDE_SVC, CLICK_SVC]) { try { svc = await server.getPrimaryService(u); break; } catch {} }
      if (!svc) throw new Error('no Zwift service');
      const as = await svc.getCharacteristic(ASYNC), rx = await svc.getCharacteristic(SYNC_RX);
      let tx = null; try { tx = await svc.getCharacteristic(SYNC_TX); } catch {}
      step = 'Subscribing';
      for (const c of [as, tx]) c?.addEventListener('characteristicvaluechanged', this._onValue); // same bound function: never doubled on reconnect
      await as.startNotifications();
      if (tx) await tx.startNotifications().catch(() => {}); // indications: only needed for the handshake reply
      step = 'Handshake';
      this.keys.reset(); this.handshake = false;
      const w = bytes => (rx.writeValueWithoutResponse ? rx.writeValueWithoutResponse(new Uint8Array(bytes)) : rx.writeValue(new Uint8Array(bytes)));
      await w(RIDE_ON);
      // no "RideOn" reply: BikeControl sends "RideOn" 02 03 to the Click v2, try that once
      clearTimeout(this._hsT); this._hsT = setTimeout(() => { if (!this.handshake && this.device === dev && dev.gatt.connected) w([...RIDE_ON, 0x02, 0x03]).catch(() => {}); }, 1500);
      try { const b = await (await server.getPrimaryService(BAT)).getCharacteristic(BATL); this.battery = (await b.readValue()).getUint8(0); } catch {} // optional
      if (this.device !== dev) return; // disconnected meanwhile
      this._set('on');
    } catch (e) { throw e?.step ? e : btError(step, e); }
  }

  _onValue(e) {
    const b = bytesOf(e.target.value);
    if (startsWith(b, RIDE_ON)) { this.handshake = true; this.model = b[6] === 2 ? 'Click v2' : b[6] === 1 ? 'Click' : this.model; this._emit('state', this); return; }
    // the Click v2 says "stopped" (ff 05 00 ea|fa 05) when Zwift has not unlocked it lately
    if (b[0] === 0xff && b[1] === 0x05 && b[2] === 0x00 && (b[3] === 0xea || b[3] === 0xfa) && b[4] === 0x05) { this.locked = true; this._emit('state', this); return; }
    const r = this.keys.feed(b);
    if (r.battery != null && r.battery !== this.battery) { this.battery = r.battery; this._emit('state', this); }
    for (const k of r.pressed) this._emit('button', k);
    for (const d of r.shifts) this._emit('shift', d);
  }

  /** dropped (the Click v2 does that after about a minute when Zwift has not unlocked it): reconnect without a tap, 1 s, 2 s, 5 s, then every 10 s for 2 min */
  _onDrop() {
    if (!this._wanted || this._retrying) return;
    this.keys.reset(); this._set('reconnecting'); this._retry();
  }
  async _retry() {
    this._retrying = true; const dev = this.device, t0 = Date.now();
    try {
      for (let i = 0; this._wanted && this.device === dev && Date.now() - t0 < RETRY_FOR; i++) {
        await new Promise(r => setTimeout(r, BACKOFF[i] ?? RETRY_EVERY));
        if (!this._wanted || this.device !== dev) return;
        try { await this._setup(); if (dev.gatt.connected) return; } catch {}
      }
      if (this._wanted && this.device === dev) this._set('lost');
    } finally { this._retrying = false; }
  }
}
/** one Click for the whole page: connected in Settings, used by the ride (same page) */
export const click = new ZwiftClick();
