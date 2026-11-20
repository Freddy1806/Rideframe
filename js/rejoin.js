// Getting a dropped Bluetooth device back (Freddy 20.11.: the trainer dropped mid-workout, the old loop gave up after five
// tries and the ride was lost). One loop per device that never gives up while the device is wanted: tries with a growing
// pause (capped at 10 s, cheap), and where the browser can (Chrome watchAdvertisements) it tries the moment the device is seen.
// A user's disconnect (wanted() false) or stop() ends it. start() while it runs returns the same loop: never two at once.
// kick() (the Reconnect button) tries right away. Timers are injectable (tools/rejoin-test.mjs).
export const REJOIN = { delays: [1000, 2000, 3000, 5000, 8000, 10000] }; // the pause before each try; the last one repeats

export class Rejoin {
  /** o: { device: () => BluetoothDevice, open: () => Promise (connect + set up), wanted: () => bool, on(state, n): 'lost' |
   *  'try' | 'back' | 'idle', delays?: ms[] (default REJOIN.delays, read at start), max?: tries, wait?: (ms, wake) => Promise } */
  constructor(o) { this.o = o; this.loop = null; this.n = 0; this._wake = null; this._stop = false; }
  get running() { return !!this.loop; }
  /** max: tries before only an advertisement or a kick wakes it (a reopen after a reload: a few tries, then quiet) */
  start(max) {
    if (this.loop) return this.loop;
    this._stop = false; this.n = 0; this._max = max ?? this.o.max ?? Infinity;
    return this.loop = this._run().finally(() => { this.loop = null; this._unwatch(); });
  }
  /** try now (a tap on Reconnect, or an advertisement): wakes the waiting loop, or starts one */
  kick() { if (this.loop) { this._wake?.(); return this.loop; } return this.start(); }
  stop() { this._stop = true; this._wake?.(); }
  _ok() { return !this._stop && this.o.wanted(); }
  async _run() {
    const o = this.o, delays = o.delays || REJOIN.delays, max = this._max;
    o.on?.('lost', 0); this._watch();
    while (this._ok()) {
      const ms = this.n < max ? delays[Math.min(this.n, delays.length - 1)] : 6e5; // after max tries: only an advertisement (or a kick) wakes it
      await this._sleep(ms);
      if (!this._ok()) break;
      this.n++; o.on?.('try', this.n);
      try { await o.open(); if (!this._ok()) break; return this._done(); }
      catch { try { const d = o.device(); if (d?.gatt?.connected) d.gatt.disconnect(); } catch {} } // half set up: start clean next time
    }
    o.on?.('idle', this.n); return false;
  }
  _done() { this.o.on?.('back', this.n); return true; }
  _sleep(ms) {
    if (this.o.wait) return this.o.wait(ms, f => { this._wake = f; });
    return new Promise(r => { const t = setTimeout(r, ms); this._wake = () => { clearTimeout(t); r(); }; }).finally(() => { this._wake = null; });
  }
  /** Chrome (with the new Bluetooth permissions): the device's adverts wake the loop the moment it is switched on again */
  _watch() {
    const dev = this.o.device(); if (!dev?.watchAdvertisements || this._wd) return;
    this._wd = dev; this._adH = () => this._wake?.();
    try { dev.addEventListener('advertisementreceived', this._adH); const p = dev.watchAdvertisements(); p?.catch?.(() => {}); } catch {}
  }
  _unwatch() {
    const dev = this._wd; if (!dev) return; this._wd = null;
    try { dev.removeEventListener('advertisementreceived', this._adH); } catch {}
    try { if (dev.watchingAdvertisements) dev.unwatchAdvertisements?.(); } catch {}
  }
}

/** Chrome getDevices(): the devices this site may open again without a chooser (after a reload); [] where the browser lacks it */
export async function knownDevices() {
  try { return navigator.bluetooth?.getDevices ? await navigator.bluetooth.getDevices() : []; } catch { return []; }
}
const KEY = 'rf_dev_';
/** remember which device was the trainer / the strap (localStorage; ids are per site and browser profile) */
export function rememberDevice(role, dev, extra = {}) { try { dev?.id && localStorage.setItem(KEY + role, JSON.stringify({ id: dev.id, name: dev.name || '', at: Date.now(), ...extra })); } catch {} }
export function rememberedDevice(role) { try { return JSON.parse(localStorage.getItem(KEY + role) || 'null'); } catch { return null; } }
export function forgetDevice(role) { try { localStorage.removeItem(KEY + role); } catch {} }
