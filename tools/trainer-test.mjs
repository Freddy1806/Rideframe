// js/trainer.js without Bluetooth: the ERG target line must never get stuck (Freddy 21.11.: the trainer stayed at 164 W for a whole
// 30 / 15 planned at 340 W). A fake control point that answers, stalls or ignores stands in for the trainer.
import test from 'node:test';
import assert from 'node:assert/strict';
if (!globalThis.navigator?.userAgent) Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', platform: 'node', maxTouchPoints: 0 }, configurable: true });
const { Trainer } = await import('../js/trainer.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** a trainer with a fake FTMS control point: `mode` 'ok' answers, 'hang' never answers the writes it gets while hanging */
function fake() {
  const t = new Trainer(), sent = [], cp = { hang: false, writeValueWithResponse(u8) { const b = [...u8]; sent.push(b); return cp.hang ? new Promise(() => {}) : Promise.resolve(); } };
  t.device = { gatt: { connected: true } }; t.cp = cp; t.mode = 'ftms';
  const watts = () => sent.filter(b => b[0] === 0x05).map(b => b[1] | b[2] << 8);
  return { t, cp, sent, watts };
}
const realNow = performance.now.bind(performance);
/** a clock the test moves: js/trainer.js reads performance.now() */
function clock() { let off = 0; performance.now = () => realNow() + off; return { add: ms => { off += ms; }, restore: () => { performance.now = realNow; } }; }

test('ERG targets go out, the newest one wins while a write is under way', async () => {
  const { t, watts } = fake();
  t.setPower(150); t.setPower(160); t.setPower(170); await sleep(20);
  assert.deepEqual(watts(), [150, 170], 'the first at once, then only the newest');
  t.setPower(170); await sleep(5); assert.equal(watts().length, 2, 'the same target is not written again right away');
});

test('a write that never answers does not block the later targets (the 164 W ride)', async () => {
  const c = clock(); try {
    const { t, cp, watts } = fake();
    t.setPower(164); await sleep(10); assert.deepEqual(watts(), [164]);
    cp.hang = true; t.setPower(166); await sleep(10); assert.deepEqual(watts(), [164, 166], 'this write hangs for good');
    cp.hang = false;
    t.setPower(200); t.setPower(340); await sleep(10); assert.deepEqual(watts(), [164, 166], 'still waiting for the hanging write');
    c.add(5200); t.setPower(340); await sleep(4300); // the busy flag is given up after 5 s, the hanging write itself after 4 s
    assert.equal(watts().at(-1), 340, 'the newest target reached the trainer: ' + watts().join(','));
    assert.ok(t.stalls >= 1, 'the stall is counted');
    t.setPower(125); await sleep(20); assert.equal(watts().at(-1), 125, 'and the line works on');
  } finally { c.restore(); }
});

test('ERG not followed: control is taken again and the target resent, and the ride is told; a 30 / 15 that is followed raises nothing', async () => {
  const c = clock(); try {
    const { t, sent, watts } = fake(); const told = []; t.addEventListener('control', e => told.push(e.detail));
    const feed = (power, target, sec) => { for (let i = 0; i < sec; i++) { c.add(1000); t.setPower(target(i)); t.data.power = power(i); t.data.cadence = 85; t._ergCheck(); } };
    const plan = i => i % 45 < 30 ? 370 : 125; // 30 s on, 15 s off
    feed(i => plan(i) + (i % 2 ? 6 : -6), plan, 240); await sleep(5);
    assert.equal(told.length, 0, 'followed within a few watts: no alarm'); assert.equal(t.offRetries || 0, 0);
    const n0 = watts().length;
    feed(() => 164, plan, 60); await sleep(5); // the trainer sits at 164 W whatever is asked
    assert.equal(told[0]?.ok, false); assert.equal(told[0]?.off, true);
    assert.ok(t.offRetries >= 2, 'tried again every 10 s: ' + t.offRetries);
    assert.ok(sent.some(b => b[0] === 0x00) && sent.some(b => b[0] === 0x07), 'control requested again');
    assert.ok(watts().length > n0, 'target sent again');
    feed(i => plan(i), plan, 90); await sleep(5);
    assert.equal(told.at(-1).ok, true, 'back on target: the ride is told');
  } finally { c.restore(); }
});

test('not pedalling or power meter only: never an alarm', async () => {
  const c = clock(); try {
    const { t } = fake(); const told = []; t.addEventListener('control', e => told.push(e.detail));
    for (let i = 0; i < 90; i++) { c.add(1000); t.setPower(340); t.data.power = 0; t.data.cadence = 0; t._ergCheck(); }
    assert.equal(told.length, 0);
    t.pmOnly = true; for (let i = 0; i < 90; i++) { c.add(1000); t.data.power = 100; t.data.cadence = 90; t._ergCheck(); }
    assert.equal(told.length, 0);
  } finally { c.restore(); }
});
