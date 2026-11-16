// Inside the RIDEFRAME Android app (Capacitor shell, folder app/) the page runs in a WebView that has neither Web
// Bluetooth nor GPS with the screen off. This file gives the page the same browser interfaces backed by the native
// plugins, so sensors.js, trainer.js and outdoor.js work unchanged:
//   navigator.bluetooth      -> @capacitor-community/bluetooth-le
//   navigator.geolocation.watchPosition -> @capacitor-community/background-geolocation (keeps running with the screen off)
// In a normal browser it does nothing. Loaded as a classic script in <head>, before the page modules.
(function () {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform() || window.__rfNative) return;
  window.__rfNative = true;
  document.documentElement.classList.add('native-app');

  // ---------------- Bluetooth ----------------
  const BLE = C.registerPlugin('BluetoothLe');
  const NAMED = { battery_service: 0x180f, battery_level: 0x2a19, heart_rate: 0x180d, heart_rate_measurement: 0x2a37, cycling_power: 0x1818, cycling_power_measurement: 0x2a63, cycling_speed_and_cadence: 0x1816, csc_measurement: 0x2a5b, fitness_machine: 0x1826, device_information: 0x180a };
  const uuid = v => { if (typeof v === 'string' && NAMED[v] != null) v = NAMED[v];
    return typeof v === 'number' ? `0000${v.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb` : String(v).toLowerCase(); };
  const toDV = hex => { const b = []; String(hex || '').replace(/[^0-9a-f]/gi, '').replace(/../g, h => { b.push(parseInt(h, 16)); }); return new DataView(Uint8Array.from(b).buffer); };
  const toHex = buf => { const u = buf instanceof DataView ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf);
    return [...u].map(n => n.toString(16).padStart(2, '0')).join(''); };
  let ready = null;
  const init = () => ready || (ready = BLE.initialize({ androidNeverForLocation: false }).catch(e => { ready = null; throw e; }));
  const KNOWN = 'rf_ble_devices'; // remembered devices for getDevices() (id = MAC address on Android)
  const known = () => { try { return JSON.parse(localStorage.getItem(KNOWN) || '[]'); } catch { return []; } };
  const remember = d => { try { const l = known().filter(x => x.id !== d.id); l.push({ id: d.id, name: d.name }); localStorage.setItem(KNOWN, JSON.stringify(l)); } catch {} };
  const devices = new Map();

  class Characteristic extends EventTarget {
    constructor(dev, svc, uuid) { super(); this.service = svc; this.uuid = uuid; this._dev = dev; this.value = null; this.properties = {}; }
    async startNotifications() {
      const key = `notification|${this._dev.id}|${this.service.uuid}|${this.uuid}`;
      this._l?.remove?.(); this._l = await BLE.addListener(key, r => { this.value = toDV(r?.value); this.dispatchEvent(new Event('characteristicvaluechanged')); /* e.target is this characteristic */ });
      await BLE.startNotifications({ deviceId: this._dev.id, service: this.service.uuid, characteristic: this.uuid });
      return this;
    }
    async stopNotifications() { this._l?.remove?.(); this._l = null; try { await BLE.stopNotifications({ deviceId: this._dev.id, service: this.service.uuid, characteristic: this.uuid }); } catch {} return this; }
    async readValue() { const r = await BLE.read({ deviceId: this._dev.id, service: this.service.uuid, characteristic: this.uuid }); return (this.value = toDV(r?.value)); }
    writeValueWithResponse(v) { return BLE.write({ deviceId: this._dev.id, service: this.service.uuid, characteristic: this.uuid, value: toHex(v) }); }
    writeValueWithoutResponse(v) { return BLE.writeWithoutResponse({ deviceId: this._dev.id, service: this.service.uuid, characteristic: this.uuid, value: toHex(v) }); }
    writeValue(v) { return this.writeValueWithResponse(v); }
  }
  class Service {
    constructor(dev, uuid, chars) { this._dev = dev; this.uuid = uuid; this._chars = chars || []; this.isPrimary = true; }
    async getCharacteristic(u) { u = uuid(u); const c = this._chars.find(x => x.uuid.toLowerCase() === u); if (!c) throw new DOMException('Characteristic not found', 'NotFoundError');
      const ch = new Characteristic(this._dev, this, u); ch.properties = c.properties || {}; return ch; }
    async getCharacteristics() { return this._chars.map(c => { const ch = new Characteristic(this._dev, this, c.uuid.toLowerCase()); ch.properties = c.properties || {}; return ch; }); }
  }
  class Device extends EventTarget {
    constructor(id, name) { super(); this.id = id; this.name = name || ''; const dev = this;
      this.gatt = { connected: false, device: dev,
        async connect() { await init(); await BLE.addListener(`disconnected|${dev.id}`, () => { dev.gatt.connected = false; dev.dispatchEvent(new Event('gattserverdisconnected')); });
          await BLE.connect({ deviceId: dev.id, timeout: 15000 }); dev.gatt.connected = true; dev._svcs = null; remember(dev); return dev.gatt; },
        disconnect() { dev.gatt.connected = false; BLE.disconnect({ deviceId: dev.id }).catch(() => {}); },
        async getPrimaryServices() { return (await dev._services()).map(s => new Service(dev, s.uuid.toLowerCase(), s.characteristics)); },
        async getPrimaryService(u) { u = uuid(u); const s = (await dev._services()).find(x => x.uuid.toLowerCase() === u); if (!s) throw new DOMException('Service not found', 'NotFoundError'); return new Service(dev, u, s.characteristics); } };
    }
    async _services() { return this._svcs || (this._svcs = (await BLE.getServices({ deviceId: this.id })).services || []); }
    async watchAdvertisements() { // reconnect when the sensor wakes up: retry connecting quietly every few seconds
      if (this._watch) return; this._watch = setInterval(async () => { try { await BLE.connect({ deviceId: this.id, timeout: 4000 }); await BLE.disconnect({ deviceId: this.id }); clearInterval(this._watch); this._watch = null; this.dispatchEvent(new Event('advertisementreceived')); } catch {} }, 8000); }
  }
  const dev = (id, name) => devices.get(id) || (devices.set(id, new Device(id, name)), devices.get(id));
  const bluetooth = {
    async getAvailability() { try { await init(); return (await BLE.isEnabled()).value; } catch { return false; } },
    async requestDevice(o = {}) {
      await init();
      const services = [...new Set((o.filters || []).flatMap(f => f.services || []).map(uuid))], prefix = (o.filters || []).map(f => f.namePrefix).filter(Boolean);
      const opt = { optionalServices: (o.optionalServices || []).map(uuid) };
      if (!o.acceptAllDevices && services.length && !prefix.length) opt.services = services; // with name prefixes too: show all nearby devices, the app checks what each one sends
      const d = await BLE.requestDevice(opt);
      return dev(d.deviceId, d.name);
    },
    async getDevices() { return known().map(k => dev(k.id, k.name)); },
  };
  try { Object.defineProperty(navigator, 'bluetooth', { value: bluetooth, configurable: true }); } catch { navigator.bluetooth = bluetooth; }

  // ---------------- GPS with the screen off ----------------
  const BG = C.registerPlugin('BackgroundGeolocation');
  const watches = new Map(); let next = 1;
  const geo = Object.create(navigator.geolocation || {});
  geo.watchPosition = (ok, fail) => {
    const id = next++;
    BG.addWatcher({ backgroundTitle: 'RIDEFRAME is recording', backgroundMessage: 'GPS keeps running, even with the screen off.', requestPermissions: true, stale: false, distanceFilter: 0 }, (l, err) => {
      if (err) { fail?.({ code: err.code === 'NOT_AUTHORIZED' ? 1 : 2, message: err.message }); return; }
      if (l) ok({ timestamp: l.time || Date.now(), coords: { latitude: l.latitude, longitude: l.longitude, accuracy: l.accuracy, altitude: l.altitude, altitudeAccuracy: l.altitudeAccuracy, speed: l.speed, heading: l.bearing } });
    }).then(w => { if (watches.has(id)) watches.set(id, w); else BG.removeWatcher({ id: w }).catch(() => {}); }, e => fail?.({ code: 2, message: e.message }));
    watches.set(id, null); return id;
  };
  geo.clearWatch = id => { const w = watches.get(id); watches.delete(id); if (w) BG.removeWatcher({ id: w }).catch(() => {}); };
  try { Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true }); } catch {}
})();
