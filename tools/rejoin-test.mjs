// A dropped trainer / strap comes back by itself for the whole ride (Freddy 20.11.: the old loop gave up after five tries).
// js/rejoin.js with fake devices and short timers; the Trainer and HeartRate classes on top of it.
import test from 'node:test'; import assert from 'node:assert/strict';
import { Rejoin, REJOIN } from '../js/rejoin.js';
import { Trainer, HeartRate, U } from '../js/trainer.js';
const wait = ms => new Promise(r => setTimeout(r, ms));
REJOIN.delays = [5, 10, 15, 20]; // the real pauses are 1 … 10 s

/** a fake Bluetooth device: gatt.connect fails `fails` times, then works; FTMS with a control point that records the writes */
function fakeDevice({ fails = 0, hr = false } = {}) {
  const dev = new EventTarget(), writes = [], chars = new Map();
  const ch = uuid => { if (!chars.has(uuid)) { const c = new EventTarget(); c.startNotifications = async () => c; c.writeValueWithResponse = async b => { writes.push([...b]); }; chars.set(uuid, c); } return chars.get(uuid); };
  const services = hr ? [U(0x180d)] : [U(0x1826)];
  const server = { getPrimaryService: async u => { if (!services.includes(u)) throw new Error('no service'); return { getCharacteristic: async c => ch(c) }; } };
  dev.id = 'fake'; dev.name = hr ? 'Fake HRM' : 'Fake KICKR'; dev.tries = 0; dev.fails = fails; dev.writes = writes; dev.chars = chars;
  dev.gatt = { connected: false, connect: async () => { dev.tries++; await wait(1); if (dev.fails > 0) { dev.fails--; throw new Error('out of range'); } dev.gatt.connected = true; return server; },
    disconnect: () => { if (!dev.gatt.connected) return; dev.gatt.connected = false; setTimeout(() => dev.dispatchEvent(new Event('gattserverdisconnected')), 0); } };
  dev.drop = (fails = 0) => { dev.fails = fails; dev.gatt.connected = false; dev.dispatchEvent(new Event('gattserverdisconnected')); };
  return dev;
}
const until = async (f, ms = 2000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(2); } };

test('Rejoin: never gives up while wanted, backs off, one loop however often it is started', async () => {
  let tries = 0, okAt = 12; const states = [], waits = [];
  const rj = new Rejoin({ device: () => ({}), open: async () => { if (++tries < okAt) throw new Error('no'); }, wanted: () => true, on: s => states.push(s),
    wait: (ms) => { waits.push(ms); return wait(1); } });
  const a = rj.start(), b = rj.start(); assert.equal(a, b, 'a second start joins the running loop');
  assert.equal(await a, true); assert.equal(tries, 12, 'more than the old 5 / 6 / 8 tries');
  assert.deepEqual(waits.slice(0, 5), [5, 10, 15, 20, 20], 'growing pause, capped'); assert.equal(states[0], 'lost'); assert.equal(states.at(-1), 'back');
  assert.equal(states.filter(s => s === 'try').length, 12); assert.equal(rj.running, false);
});
test('Rejoin: stop() and a user disconnect (wanted false) end the loop, kick() tries at once', async () => {
  let want = true, tries = 0;
  const rj = new Rejoin({ device: () => ({}), open: async () => { tries++; throw new Error('no'); }, wanted: () => want, delays: [10000] });
  const p = rj.start(); await wait(5); assert.equal(tries, 0, 'waits first');
  rj.kick(); await wait(5); assert.equal(tries, 1, 'kick tries without waiting the 10 s');
  want = false; rj.kick(); assert.equal(await p, false); assert.equal(tries, 1, 'not wanted any more: no further try');
  want = true; const q = rj.start(); rj.stop(); assert.equal(await q, false);
});
test('Rejoin: after max tries it only wakes on an advertisement (watchAdvertisements), then connects', async () => {
  const dev = new EventTarget(); let watched = 0, tries = 0, up = false;
  dev.watchAdvertisements = async () => { watched++; }; dev.unwatchAdvertisements = () => {}; dev.watchingAdvertisements = true;
  const rj = new Rejoin({ device: () => dev, open: async () => { tries++; if (!up) throw new Error('off'); }, wanted: () => true, delays: [2] });
  const p = rj.start(2); await wait(40); assert.equal(watched, 1); assert.equal(tries, 2, 'two tries, then quiet');
  up = true; dev.dispatchEvent(new Event('advertisementreceived')); assert.equal(await p, true); assert.equal(tries, 3);
});

test('Trainer: drops, fails 4 times, comes back by itself; ERG target resent; no doubled listeners; user disconnect stops it', async () => {
  const t = new Trainer(), dev = fakeDevice(), links = [];
  t.addEventListener('link', e => links.push(e.detail.state));
  assert.equal(await t.use(dev), true); assert.equal(t.mode, 'ftms');
  t.setPower(250); await wait(5); assert.deepEqual(dev.writes.at(-1), [5, 250, 0]);
  dev.writes.length = 0; dev.drop(4); dev.dispatchEvent(new Event('gattserverdisconnected')); // Chrome may fire it twice
  assert.equal(t.rejoining, true);
  await until(() => t.connected && !t.rejoining);
  assert.equal(dev.tries, 1 + 5, 'one first connect, four failures, one success'); assert.deepEqual(links, ['ok', 'lost', 'try', 'try', 'try', 'try', 'try', 'back']);
  assert.deepEqual(dev.writes, [[0], [7], [5, 250, 0]], 'control again, start, the ERG target again');
  const ibd = dev.chars.get(U(0x2ad2)); let n = 0; t.addEventListener('data', () => n++);
  ibd.value = new DataView(new Uint8Array([0x40, 0x00, 0x00, 0x00, 200, 0]).buffer); ibd.dispatchEvent(new Event('characteristicvaluechanged'));
  assert.equal(n, 1, 'one data event per notification after the reconnect (one listener)'); assert.equal(t.data.power, 200);
  dev.drop(1000); await wait(30); const before = dev.tries; t.disconnect(); await wait(60);
  assert.equal(dev.tries, before, 'the user disconnected: no more tries'); assert.equal(t.rejoining, false);
});
test('HeartRate: the strap drops and comes back; reconnected event; disconnect by hand stops the loop', async () => {
  const h = new HeartRate(), dev = fakeDevice({ hr: true }); let back = 0; h.addEventListener('reconnected', () => back++);
  assert.equal(await h.use(dev), true);
  dev.drop(3); assert.equal(h.rejoining, true); await until(() => h.connected && !h.rejoining); assert.equal(back, 1);
  dev.drop(1000); await wait(20); h.disconnect(); const n = dev.tries; await wait(60); assert.equal(dev.tries, n);
});
test('use() on a device that is off: a few tries in the background, no throw', async () => {
  const t = new Trainer(), dev = fakeDevice({ fails: 1000 });
  assert.equal(await t.use(dev, 3), false); await wait(80); assert.equal(dev.tries, 1 + 3, 'one at once, three more, then quiet');
  t.disconnect();
});
