// Zwift Click decoder test (no hardware, no deps): node tools/clicktest.mjs
// Feeds byte frames as the Click / Click v2 send them into js/zwiftclick.js and checks the result.
globalThis.navigator ??= { userAgent: 'node' }; // trainer.js (imported for pickDevice) reads it at load
const { decodeFrame, decodeBattery, readVarint, readProto, KeyState, MASK } = await import('../js/zwiftclick.js');

let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${info && !cond ? ' · ' + info : ''}`); };
const hex = s => Uint8Array.from(s.trim().split(/\s+/), x => parseInt(x, 16));
const varint = n => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b); } while (n); return o; };
const v2 = pressed => Uint8Array.of(0x23, 0x08, ...varint(0xffffffff - pressed.reduce((s, k) => s + MASK[k], 0))); // all bits set except the pressed ones

// varint / protobuf basics
ok('varint 300', JSON.stringify(readVarint([0xac, 0x02], 0)) === '[300,2]');
ok('varint 32-bit all ones', readVarint(hex('ff ff ff ff 0f'), 0)[0] === 0xffffffff);
ok('varint cut off -> null', readVarint([0x80, 0x80], 0) === null);
ok('proto skips len-delimited', readProto(hex('12 02 aa bb 08 05')).get(1) === 5);

// Click v1 (0x37)
let f = decodeFrame(hex('37 08 00 10 01'));
ok('v1 plus pressed', f && f.plus === true && f.minus === false);
f = decodeFrame(hex('37 08 01 10 01'));
ok('v1 released', f && !f.plus && !f.minus);
f = decodeFrame(hex('37 08 01 10 00'));
ok('v1 minus pressed', f && !f.plus && f.minus);
f = decodeFrame(hex('37 10 01'));
ok('v1 missing plus field = released (no phantom shift)', f && !f.plus && !f.minus);

// Ride / Click v2 (0x23)
f = decodeFrame(hex('23 08 ff ff ff ff 0f'));
ok('v2 idle', f && !f.plus && !f.minus && Object.values(f.buttons).every(x => !x));
f = decodeFrame(v2(['SHFT_UP_R']));
ok('v2 SHFT_UP_R -> plus', f && f.plus && !f.minus && f.buttons.SHFT_UP_R && !f.buttons.A, [...v2(['SHFT_UP_R'])].map(x => x.toString(16)).join(' '));
f = decodeFrame(v2(['SHFT_UP_L']));
ok('v2 SHFT_UP_L -> minus', f && !f.plus && f.minus);
f = decodeFrame(v2(['SHFT_DN_R', 'A']));
ok('v2 SHFT_DN_R -> plus, A reported but unmapped', f && f.plus && f.buttons.A && !f.buttons.B);
f = decodeFrame(v2(['POWERUP_R', 'ONOFF_R']));
ok('v2 high bits (0x10000, 0x20000) decode', f && f.buttons.POWERUP_R && f.buttons.ONOFF_R && !f.plus);
f = decodeFrame(Uint8Array.of(0x23, 0x08, ...varint(0xffffffff - MASK.SHFT_UP_R), 0x1a, 0x03, 0x08, 0x00, 0x10)); // plus an analog sub-message
ok('v2 with extra sub-message', f && f.plus);

// edge detection: held buttons repeat their state
let ks = new KeyState(), shifts = [];
for (const fr of ['37 08 01 10 01', '37 08 00 10 01', '37 08 00 10 01', '37 08 00 10 01', '37 08 01 10 01']) shifts.push(...ks.feed(hex(fr)).shifts);
ok('v1 held plus = exactly one shift', JSON.stringify(shifts) === '[1]', JSON.stringify(shifts));
shifts = []; for (const fr of ['37 08 01 10 00', '37 08 01 10 01', '37 08 01 10 00']) shifts.push(...ks.feed(hex(fr)).shifts);
ok('v1 minus twice = two shifts', JSON.stringify(shifts) === '[-1,-1]', JSON.stringify(shifts));
ks = new KeyState(); shifts = [];
for (const fr of [v2([]), v2(['SHFT_UP_R']), v2(['SHFT_UP_R']), v2([]), v2(['SHFT_UP_L']), v2(['SHFT_UP_L']), v2([])]) shifts.push(...ks.feed(fr).shifts);
ok('v2 held + then - = one shift each', JSON.stringify(shifts) === '[1,-1]', JSON.stringify(shifts));
ok('v2 A press -> button event, no shift', (r => r.pressed.join() === 'A' && !r.shifts.length)(new KeyState().feed(v2(['A']))));

// battery (0x19)
ok('battery v1 (payload byte 1)', decodeBattery(hex('19 08 4b')) === 75);
ok('battery v2 (field 2)', decodeBattery(hex('19 08 00 10 3c')) === 60);
ok('battery frame is no keypad frame', decodeFrame(hex('19 08 4b')) === null);
ok('battery garbage -> null', decodeBattery(hex('19 08 ff')) === null && decodeBattery(hex('19')) === null);
ok('keystate passes battery', new KeyState().feed(hex('19 08 50')).battery === 80);

// nothing throws, nothing shifts on junk
const junk = [[], [0x15], [0x37], [0x23], [0x23, 0x08], [0x23, 0x08, 0xff, 0xff], [0x37, 0x08], [0x37, 0x0a, 0x05, 0x01], [0x37, 0x0f], [0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e, 0x01, 0x03],
  [0xff, 0x05, 0x00, 0xea, 0x05], [0x42, 1, 2, 3], [0x23, 0x08, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80], null, undefined];
let threw = null, shifted = 0; ks = new KeyState();
for (const j of junk) try { decodeFrame(j); decodeBattery(j); shifted += ks.feed(j).shifts.length; } catch (e) { threw = e; }
ok('garbage / empty / truncated frames do not throw', !threw, threw?.message);
ok('garbage / empty / truncated frames do not shift', shifted === 0, String(shifted));
for (let i = 0; i < 2000; i++) { const b = Array.from({ length: Math.random() * 12 | 0 }, () => Math.random() * 256 | 0); try { decodeFrame(b); decodeBattery(b); } catch (e) { threw = e; } }
ok('2000 random frames do not throw', !threw, threw?.message);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
