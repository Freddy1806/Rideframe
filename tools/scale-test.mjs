// The scale decoder (tools/scale-decode.mjs), who-stood-on-it (tools/body-assign.mjs) and the trend / CSV rules (js/bodylib.js).
// Test vectors: REAL frames captured by owners, as collected with their source in KristianP26/ble-scale-sync tests/scales/
// eufy-c20-p3.test.ts and eufy-p2.test.ts (commit b3daf97): C20 / P3 from Home Assistant debug logs in bdr99/eufylife-ble-client
// #3 and #5, the P2 Pro advertisement from eufylife-ble-client#8, the P2 Pro FFF2 notifications with the app's figures from
// ble-scale-sync#289. Everything marked "synthetic" is built here from the documented layout (no capture exists).
// Usage: node --test tools/scale-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from './scale-decode.mjs';
import { assign, reference } from './body-assign.mjs';
import * as B from '../js/bodylib.js';
import { replayLines } from './scale-bridge/replay.mjs';
import { readFileSync } from 'node:fs';

const raw = (company, payloadHex) => Buffer.from([company & 255, company >> 8]).toString('hex') + payloadHex; // as macOS hands it over
const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≈ ${b}`);

/* C20 (T9130), BC:0F:B7:00:9C:9D, company id 0xBC64, eufylife-ble-client#5 comment 2564606224: "100.1kg" */
const C20 = { idle: '0fb7009c9d00c0c970670000000000000000', off0d: '0fb7009c9d00c0c970670d00000000000000', live: '0fb7009c9d00c3c9706701001a2700000000',
  lock: '0fb7009c9d00c5c9706705001a2700000000', s15: '0fb7009c9d00c7c9706715001a2700000000', end25: '0fb7009c9d00c9c9706725801a27000000641104038a0000', off: '0fb7009c9d00e2c970670d40000000000000' };
/* P3 (T9150), CF:E7:09:18:28:04, company id 0xCF4D, eufylife-ble-client#3 comment 2564412265: locked 82.80 kg, heart rate 95 */
const P3 = { lock: 'e709182804002c4f706705005820000000000000000000', s25: 'e709182804002f4f7067250058200000000b143534d900', s65: 'e70918280400324f7067650058200000000b143534d900', a5: 'e70918280400384f7067a5805820005f000b143534d900' };
/* P3, CF:E7:0B:08:81:8A, company id 0xCF45, #3 comment 2873299889: live 123.20, final 123.00 */
const P3b = { live: 'e70b08818a008025226801002030000000000000000000', end25: 'e70b08818a008c25226825800c30000000eb10f1f73500' };
/* P2 Pro (T9149), CF:E8:12:18:33:EE, eufylife-ble-client#8 (company id 0xFF48 as another P2 Pro in ble-scale-sync#98): 105.10 kg */
const P2a = 'cfe8121833eecf51c00e29dcd69700000000e4', P2b = 'cfe8121833eecf4cc00e2904032c000000004f';
/* P2 Pro FFF2 notifications, ble-scale-sync#289, weights the Eufy app showed for the same weigh-in */
const N = [['cf0e00cf081156220803880000000021', 87.9, 436], ['cf0e00cf72102e22eee71000000000b8', 87.5, 421], ['cf0e00cf4a103d22393429000000' + '00ae', 87.65, 417],
  ['cf0e00cf5c1260221113f10000000030', 88, 470], ['cf0e00cf721abd1a0605620000000061', 68.45, 677], ['cf0e00cf00006022000000000000008d', 88, null]]; // app: 30.1 / 29.5 / 29.8 / 30.4 / 42.4 % fat, the last one socks on

test('identify: by the name from the scan response, P2 family also by its company id 0xFF48', () => {
  assert.equal(D.identify('eufy T9148', ''), 'T9148'); assert.equal(D.identify('eufy T9149', ''), 'T9149'); assert.equal(D.identify('eufy T9146 C1', ''), 'T9146');
  assert.equal(D.identify('eufy T9130', ''), 'T9130'); assert.equal(D.identify('', raw(0xff48, P2a)), 'T9148');
  assert.equal(D.identify('', raw(0xbc64, C20.lock)), null, 'C20 / P3 only by name: the company id changes per unit');
  assert.equal(D.identify('Mi Scale', 'ffff00'), null); assert.equal(D.identify('eufy T9999', ''), null);
});
test('MAC from the advertisement (macOS hides it): P2 payload [0..5], C20/P3 company-id high byte + [0..4]', () => {
  assert.equal(D.macOf('T9149', raw(0xff48, P2a)), 'CF:E8:12:18:33:EE');
  assert.equal(D.macOf('T9130', raw(0xbc64, C20.lock)), 'BC:0F:B7:00:9C:9D');
  assert.equal(D.macOf('T9150', raw(0xcf4d, P3.lock)), 'CF:E7:09:18:28:04');
  assert.equal(D.macOf('T9150', raw(0xcf45, P3b.live)), 'CF:E7:0B:08:81:8A');
});
test('P2 / P2 Pro advertisement (real capture): 105.10 kg, final, heart rate, checksum', () => {
  for (const [h, hr] of [[P2a, 81], [P2b, 76]]) { const f = D.decodeAdv('T9149', raw(0xff48, h)); close(f.kg, 105.1); assert.equal(f.final, true); assert.equal(f.hr, hr); }
  const notFinal = Buffer.from(P2a, 'hex'); notFinal[15] = 1; notFinal[18] ^= 1; // synthetic: [15] != 0, checksum fixed up
  assert.equal(D.decodeAdv('T9149', raw(0xff48, notFinal.toString('hex'))).final, false);
  const broken = Buffer.from(P2a, 'hex'); broken[10] ^= 4; assert.equal(D.decodeAdv('T9149', raw(0xff48, broken.toString('hex'))), null, 'a damaged frame fails the XOR');
  assert.equal(D.decodeAdv('T9149', raw(0xbc64, P2a)), null, 'only under 0xFF48');
});
test('C20 advertisement (real capture): idle, live 100.10, locked 100.10 through 0x05/0x15/0x25 with the end flag', () => {
  const d = h => D.decodeAdv('T9130', raw(0xbc64, h));
  assert.equal(d(C20.idle).quiet, true); assert.equal(d(C20.off0d).quiet, true); assert.equal(d(C20.off).quiet, true);
  assert.deepEqual(d(C20.live), { kg: 100.1, final: false, status: 1 });
  for (const h of [C20.lock, C20.s15, C20.end25]) { const f = d(h); close(f.kg, 100.1); assert.equal(f.final, true); assert.equal(f.impedance, undefined, 'the C20 impedance bytes are not used'); }
  assert.equal(d(C20.end25).end, true); assert.equal(d(C20.lock).end, false);
});
test('P3 advertisement (real captures): 82.80 kg with heart rate 95 at 0xA5; 123.20 live then 123.00 final', () => {
  const d = (c, h) => D.decodeAdv('T9150', raw(c, h));
  for (const h of [P3.lock, P3.s25, P3.s65]) close(d(0xcf4d, h).kg, 82.8);
  const a5 = d(0xcf4d, P3.a5); close(a5.kg, 82.8); assert.equal(a5.hr, 95); assert.equal(a5.end, true);
  assert.equal(d(0xcf45, P3b.live).final, false); close(d(0xcf45, P3b.live).kg, 123.2); close(d(0xcf45, P3b.end25).kg, 123); assert.equal(d(0xcf45, P3b.end25).final, true);
});
test('P2 Pro FFF2 notification (real, ble-scale-sync#289): weight as the app showed it, impedance [4..5] / 10, XOR [2..14]', () => {
  for (const [h, kg, imp] of N) { const b = Buffer.from(h, 'hex'); assert.equal(b.length, 16);
    let x = 0; for (let i = 2; i < 15; i++) x ^= b[i]; assert.equal(x, b[15], 'checksum as documented');
    const f = D.decodeNotify('T9149', '0000fff2-0000-1000-8000-00805f9b34fb', h); close(f.kg, kg); assert.equal(f.final, true);
    if (imp == null) assert.equal(f.impedance, undefined, 'no skin contact: no impedance'); else close(f.impedance, imp, 1e-6); }
  assert.equal(D.decodeNotify('T9149', 'FFF4', N[0][0]), null, 'weight only on FFF2');
});
test('C1 / P1 / A1 / T9140 frames (synthetic, from eufylife-ble-client\'s code only: no capture published)', () => {
  const f11 = (kg, fin) => { const b = Buffer.alloc(11); b[0] = 0xcf; const r = Math.round(kg * 100); b[3] = r & 255; b[4] = r >> 8; b[9] = fin ? 0 : 1; let x = 0; for (let i = 0; i < 10; i++) x ^= b[i]; b[10] = x; return b; };
  const adv = Buffer.concat([Buffer.from([1, 2, 3, 4]), f11(72.35, true), Buffer.from([0, 0, 0])]);
  const f = D.decodeAdv('T9147', raw(0x1234, adv.toString('hex'))); close(f.kg, 72.35); assert.equal(f.final, true);
  const bad = Buffer.from(adv); bad[8] ^= 1; assert.equal(D.decodeAdv('T9147', raw(0x1234, bad.toString('hex'))), null, 'checksum');
  close(D.decodeNotify('T9146', 'FFF4', f11(64.1, false).toString('hex')).kg, 64.1);
  const t9140 = Buffer.from([0xac, 0x02, 0x03, 0x20, 0, 0, 0xca, 0]); assert.deepEqual(D.decodeNotify('T9140', 'FFB2', t9140.toString('hex')), { kg: 80, final: true });
});

test('one weigh-in -> exactly one measurement: C20 ends with the end flag; the repeat on the air is ignored', () => {
  let s = D.session(), out = []; const t0 = 1e6;
  for (const [i, h] of [C20.idle, C20.live, C20.lock, C20.s15, C20.end25, C20.end25, C20.off].entries()) { const r = D.feed(s, D.decodeAdv('T9130', raw(0xbc64, h)), t0 + i * 1000); s = r.s; if (r.out) out.push(r.out); }
  assert.equal(out.length, 1); close(out[0].kg, 100.1); assert.equal(out[0].t, t0 + 2000, 'the time of the first locked frame');
});
test('one weigh-in -> one: P2 repeats its final frame and settles; the LAST final weight after 4 s of quiet', () => {
  let s = D.session(), out = []; const f = kg => ({ kg, final: true });
  const run = (fr, t) => { const r = D.feed(s, fr, t); s = r.s; if (r.out) out.push(r.out); };
  run({ kg: 81.9, final: false }, 0); run(f(82.0), 1000); run(f(82.05), 1500); run(f(82.05), 2500);
  let r = D.flush(s, 4000); assert.equal(r.out, null, 'not settled yet'); r = D.flush(s, 5600); s = r.s; close(r.out.kg, 82.05); out.push(r.out);
  run(f(82.05), 9000); run(f(82.05), 30000); assert.equal(D.flush(s, 40000).out, null, 'the same weigh-in still on the air');
  run({ kg: 64.2, final: false }, 70000); run(f(64.2), 71000); r = D.flush(s, 76000); close(r.out.kg, 64.2, 1e-9); // the flatmate next
  assert.equal(out.length, 1);
});
test('P2 authentication: C0 / C1 / C2 / C3 against an emulated scale (synthetic; framing as in the three sources)', () => {
  const mac = 'CF:E6:03:1D:09:F7', a = D.p2Auth(mac, 'abcdef123456789'), c0 = a.c0();
  assert.equal(c0.length, 2); assert.equal(c0[0][0], 0xc0); assert.equal(c0[0][1], 2); assert.equal(c0[0][3], 0x18, '24 base64 characters');
  for (const f of c0) { let x = 0; for (let i = 0; i < f.length - 1; i++) x ^= f[i]; assert.equal(f[f.length - 1], x); }
  let c2 = null; for (const f of D.scaleC1(mac, 'DEVICEUUID12345')) c2 = a.onAuth(f) || c2;
  assert.equal(a.device, 'DEVICEUUID12345'); assert.equal(c2[0][0], 0xc2);
  assert.equal(a.onAuth(Buffer.from([0xc3, 1, 0, 1, 0, 0xc3])), true); assert.equal(a.ok, true);
  const b = D.p2Auth(mac); assert.equal(b.onAuth(Buffer.from([0xc3, 1, 0, 1, 1, 0xc2])), false);
  assert.deepEqual([...D.keyOf('cf:e6:03:1d:09:f7')], [...D.keyOf('CFE6031D09F7')]); assert.throws(() => D.keyOf('nope'));
});

/* ---- who stood on it ---- */
const day = 864e5, NOW = Date.UTC(2026, 10, 25, 6, 12);
const hist = (kg, n, every = 1, from = 1, drift = 0) => [...Array(n)].map((_, i) => ({ t: NOW - (from + i * every) * day, kg: kg + drift * (from + i * every) }));
const M = (id, list, joined = NOW - 100 * day) => ({ id, joined, list });
test('assign: two people 82 vs 64 kg -> automatic for both, nobody else sees it', () => {
  const fr = M('freddy', hist(82, 10)), ri = M('riley', hist(64, 10));
  assert.deepEqual([assign(82.4, [fr, ri], NOW).decision, assign(82.4, [fr, ri], NOW).id], ['auto', 'freddy']);
  assert.equal(assign(63.6, [fr, ri], NOW).id, 'riley');
});
test('assign: two people 78 vs 80 kg -> always ask', () => {
  const a = M('a', hist(78, 10)), b = M('b', hist(80, 10));
  for (let kg = 74; kg <= 84; kg += 0.25) assert.equal(assign(kg, [a, b], NOW).decision, 'ask', kg + ' kg');
});
test('assign: a guest at 95 kg is nobody\'s; a new member\'s first weigh-ins are asked', () => {
  const fr = M('freddy', hist(82, 10)), ri = M('riley', hist(64, 10));
  const g = assign(95, [fr, ri], NOW); assert.equal(g.decision, 'ask'); assert.equal(g.reason, 'nobody near');
  const newbie = M('riley', [], NOW - 2 * day); assert.equal(assign(82.1, [fr, newbie], NOW).reason, 'new member', 'could be the new one');
  assert.equal(assign(64, [fr, M('riley', hist(64, 1), NOW - 30 * day)], NOW).reason, 'first weigh-ins');
  assert.equal(assign(82.1, [fr, M('riley', [], NOW - 20 * day)], NOW).decision, 'auto', 'a member who never weighs in does not block for ever');
  assert.equal(assign(82.1, [M('solo', [], NOW)], NOW).decision, 'ask', 'the very first weigh-in of a new household');
});
test('assign: weight loss of 0.1 kg a day over 8 weeks stays automatic every morning', () => {
  const list = [{ t: NOW - 60 * day, kg: 90.3 }, { t: NOW - 59 * day, kg: 90.2 }]; let miss = 0; // two confirmed weigh-ins before
  for (let d = 0; d < 56; d++) { const t = NOW - (56 - d) * day, kg = Math.round((90 - 0.1 * d + 0.3 * Math.sin(d)) * 20) / 20, r = assign(kg, [M('f', list.slice()), M('r', hist(64, 10))], t);
    if (r.decision !== 'auto' || r.id !== 'f') miss++; list.push({ t, kg }); }
  assert.equal(miss, 0);
});
test('assign: after a long break the window grows to 4 kg at most', () => {
  const fr = M('freddy', hist(82, 10, 1, 60)), ri = M('riley', hist(64, 10));
  assert.equal(reference(fr.list, NOW).tol, 4); assert.equal(assign(85.5, [fr, ri], NOW).id, 'freddy'); assert.equal(assign(86.5, [fr, ri], NOW).decision, 'ask');
  close(reference(hist(82, 3, 1, 2), NOW).tol, 1.5 + 0.3, 1e-9);
});

/* ---- trend, day value, changes, CSV ---- */
const at = (d, h = 7, kg) => ({ t: new Date(2026, 9, d, h, 0).getTime(), kg });
test('trend: Hacker\'s Diet 10 % smoothing on the first weigh-in of each day', () => {
  const l = [at(1, 7, 80), at(1, 21, 82), at(2, 7, 81), at(3, 7, 79)], tr = B.trend(l);
  assert.equal(tr.length, 3, 'one value per day: the evening weigh-in is listed, not trended'); close(tr[0].trend, 80); close(tr[1].trend, 80.1, 1e-9); close(tr[2].trend, 80.1 + 0.1 * (79 - 80.1), 1e-3);
  const gap = B.trend([at(1, 7, 80), at(11, 7, 78)]); close(gap[1].trend, 80 - (1 - 0.9 ** 10) * 2, 1e-3, 'a 10-day gap weighs like 10 days');
});
test('trend: outlier guard leaves out a single jump, a confirmed jump counts', () => {
  const one = B.trend([at(1, 7, 80), at(2, 7, 80), at(3, 7, 86), at(4, 7, 80)]); assert.equal(one[2].out, true); close(one[3].trend, 80);
  const real = B.trend([at(1, 7, 80), at(2, 7, 80), at(3, 7, 85), at(4, 7, 85.2)]); assert.equal(real[2].out, false); assert.ok(real[3].trend > 80.9);
});
test('changes over 7 / 30 days and since start, neutral words; merge of repeats; kg kept at the scale\'s resolution', () => {
  const now = new Date(2026, 9, 31, 8).getTime(), l = [...Array(31)].map((_, i) => at(i + 1, 7, 85 - i * 0.1)), c = B.changes(l, now);
  assert.ok(c.d7 < 0 && c.d30 < c.d7 && c.start <= c.d30); assert.equal(B.changeWords(c.d7).arrow, '↓'); assert.match(B.changeWords(c.d7).text, /^down \d/);
  assert.equal(B.changeWords(0.1).text, 'about the same'); assert.equal(B.changeWords(null).text, 'not enough data yet'); assert.equal(B.changes(l.slice(-3), now).d30, null);
  const m1 = B.merge([], { id: 'a', t: 1e12, kg: 82.4, src: 'scale' }), m2 = B.merge(m1.list, { id: 'b', t: 1e12 + 120e3, kg: 82.55, src: 'scale' });
  assert.equal(m2.list.length, 1); assert.equal(m2.list[0].id, 'a'); close(m2.list[0].kg, 82.55); assert.equal(B.merge(m2.list, { id: 'c', t: 1e12 + 400e3, kg: 82.5, src: 'scale' }).list.length, 2);
  assert.equal(B.fmtKg(82.45), '82.45'); assert.equal(B.fmtKg(82.4), '82.4'); assert.equal(B.fmtKg(82), '82.0'); assert.equal(B.kgOf('82,45'), 82.45);
  assert.equal(B.validate({ t: Date.now() + 864e5, kg: 80 }).error, 't is in the future.'); assert.ok(B.validate({ t: Date.now(), kg: 10 }).error); assert.equal(B.validate({ t: Date.now(), kg: 80, fatPct: 101 }).error, 'fatPct: 2 to 75.');
});
test('CSV: EufyLife-style export, generic "date;kg", US dates, pounds', () => {
  const eufy = B.parseCsv('Time,WEIGHT (kg),BMI,BODY FAT %,MUSCLE MASS (kg),WATER %\n2026-03-14 12:55:51,101.9,32.8,34.7,62.1,45.2\n2026-03-15 07:01:02,101.4,32.6,34.5,,');
  assert.equal(eufy.rows.length, 2); close(eufy.rows[0].kg, 101.9); assert.equal(eufy.rows[0].bmi, 32.8); assert.equal(eufy.rows[0].fatPct, 34.7); assert.equal(eufy.rows[0].waterPct, 45.2); assert.equal(eufy.rows[0].musclePct, undefined, 'muscle MASS in kg is not a percentage');
  assert.equal(new Date(eufy.rows[1].t).getHours(), 7);
  const g = B.parseCsv('25.11.2026 07:12;82,4\n26.11.2026;82,1\nnonsense;x'); assert.equal(g.rows.length, 2); assert.equal(g.skipped, 1); close(g.rows[0].kg, 82.4); assert.equal(new Date(g.rows[0].t).getDate(), 25);
  const us = B.parseCsv('date,weight (lb)\n11/25/2026 7:12 AM,180'); close(us.rows[0].kg, 81.65, 0.01); assert.equal(new Date(us.rows[0].t).getMonth(), 10);
});

test('--replay of a recorded file (real C20 and P2 Pro frames, tools/fixtures/scale-replay.jsonl): two weigh-ins, the speaker ignored', () => {
  const lines = readFileSync(new URL('./fixtures/scale-replay.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const w = replayLines(lines).filter(e => e.weighIn);
  assert.deepEqual(w.map(e => [e.model, e.weighIn.kg, e.weighIn.hr || null]), [['T9130', 100.1, null], ['T9149', 105.1, 81]]);
});

test("C20, Freddy's own scale (capture 26.11.): it locks with status 0x35, which the list of known states did not have", () => {
  const d = h => D.decodeAdv('T9130', raw(0xbc64, h));
  const live = d('0fb7030da200aaca076b0100631a00000000'), lock = d('0fb7030da200acca076b3500631a00000000'), end = d('0fb7030da200b1ca076b3580631a00000041150000000000');
  assert.equal(live.kg, 67.55); assert.equal(live.final, false);
  assert.equal(lock.kg, 67.55); assert.equal(lock.final, true); assert.equal(lock.end, false);
  assert.equal(end.kg, 67.55); assert.equal(end.final, true); assert.equal(end.end, true);
  assert.equal(d('0fb7030da2008dca076b0500660300000000').kg, 8.7, 'a partial load locks with 0x05');
  assert.equal(d('0fb7030da200aaca076b0200631a00000000'), null, 'an unknown state stays unknown');
});
