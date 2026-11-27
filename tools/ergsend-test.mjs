// ERG targets to the trainer: only the newest wattage counts, nothing queues up behind a ramp (Freddy 20.11.: the trainer was 30 s late).
import test from 'node:test'; import assert from 'node:assert/strict';
import { Trainer } from '../js/trainer.js';
import { workoutById, workoutState } from '../js/workouts.js';
const wait = ms => new Promise(r => setTimeout(r, ms));
function rig(delay = 40) { const t = new Trainer(), sent = []; t.device = { gatt: { connected: true } }; t.mode = 'ftms';
  t.cp = { writeValueWithResponse: b => { sent.push(b[1] | b[2] << 8); return wait(delay); } }; return { t, sent }; }

test('a ramp of 300 different targets in 300 ms: a handful of writes, the last one is the final target, at once', async () => {
  const { t, sent } = rig(40);
  for (let w = 130; w <= 420; w++) { t.setPower(w); if (w % 10 === 0) await wait(10); }
  await wait(120);
  assert.equal(sent.at(-1), 420); assert.ok(sent.length <= 12, `writes: ${sent.length}`);
  assert.deepEqual(sent, [...sent].sort((a, b) => a - b), 'never an older target after a newer one');
});
test('a jump is written immediately when nothing is under way, the same target is not repeated', async () => {
  const { t, sent } = rig(20);
  t.setPower(130); await wait(60); t.setPower(420); await wait(1); assert.deepEqual(sent, [130, 420]);
  t.setPower(420); t.setPower(420); await wait(60); assert.deepEqual(sent, [130, 420]);
});
test('null ends ERG: a waiting target is not sent afterwards', async () => {
  const { t, sent } = rig(40);
  t.setPower(200); t.setPower(300); t.setPower(null); await wait(120); assert.deepEqual(sent, [200]); assert.equal(t.erg, null);
});
test('30 / 15 and sprints: no ramp, the target jumps at the second the effort starts and ends', () => {
  const w = workoutById('c_30_15_3x13'), at = t => workoutState(w, t, 280, { ramp: true }).target;
  // 27.11.: the warm-up is 780 s (ramp, build, spin), then openers of 20 s at 300 / 335 / 370 W; the first set starts at 1170 s
  assert.equal(at(779.9), 130); assert.equal(at(780), 300); assert.equal(at(799.9), 300); assert.equal(at(800), 130);
  assert.equal(at(1169.9), 130); assert.equal(at(1170), 370); assert.equal(at(1199.9), 370); assert.equal(at(1200), 125); assert.equal(at(1214.9), 125); assert.equal(at(1215), 370);
});
test('long intervals keep their ramp in', () => { const w = workoutById('vo2_5x3'); let s = 0, i = w.steps.findIndex(x => /VO2max 1\//.test(x.label)); for (let k = 0; k < i; k++) s += w.steps[k].dur;
  const a = workoutState(w, s - 5, 280, { ramp: true }), b = workoutState(w, s - 20, 280, { ramp: true }); assert.equal(a.ramp, 'in'); assert.ok(a.target > b.target); });
test('a refused ERG target: control is requested again, the target is resent, and the ride is told once', async () => {
  const t = new Trainer(), raw = [], ev = []; t.device = { gatt: { connected: true } }; t.mode = 'ftms';
  t.cp = { writeValueWithResponse: b => { raw.push([...b]); return wait(5); } }; t.addEventListener('control', e => ev.push(e.detail.ok));
  const resp = (op, res) => t._onCPResponse(new DataView(new Uint8Array([0x80, op, res]).buffer));
  t.setPower(340); await wait(20); resp(0x05, 0x05); resp(0x05, 0x05); await wait(40);
  assert.deepEqual(raw, [[5, 84, 1], [0], [7], [5, 84, 1]]); assert.deepEqual(ev, [false]); assert.ok(t.ctlRefused);
  resp(0x05, 0x01); assert.equal(t.ctlRefused, null); assert.deepEqual(ev, [false, true]);
});
