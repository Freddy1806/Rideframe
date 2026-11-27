// FTP from all the evidence (27.11., js/stats.js ftpEvidence / ftpUpdate, js/fitness.js profileOf, js/cardlib.js ftpSummary).
// Synthetic rides: samples [t, d, W, km/h, rpm, bpm] built from segments [seconds, watts, bpm?].
// Usage: node --test tools/ftp-evidence-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ftpEvidence, ftpUpdate, estimateFTP, perSecond, topRatio } from '../js/stats.js';
import { profileOf } from '../js/fitness.js';
import { ftpSummary } from '../js/cardlib.js';

const D = 864e5, NOW = new Date(2026, 10, 27, 18).getTime();
let id = 0;
/** a ride n days ago from segments [[sec, W, bpm]], 1 sample per second (every = 10: a watch's 10 s averages) */
function ride(daysAgo, segs, extra = {}, every = 1) {
  const s = []; let t = 0;
  for (const [sec, w, hr = 0] of segs) for (let i = 0; i < sec; i += every) { s.push([t, t * 8, w, 30, 90, hr]); t += every; }
  return { id: 'r' + ++id, routeId: 'pure', sportType: 'VirtualRide', date: NOW - daysAgo * D, duration: t, samples: s, ...extra };
}
const set3015 = (n = 13, on = 370, off = 185) => Array.from({ length: n }, () => [[30, on], [15, off]]).flat();
const ivs3015 = (n = 13, on = 370) => Array.from({ length: n }, (_, i) => ({ name: `30/15 ${i + 1}`, t: 30, w: on, pct: 130, target: on, dur: 30, kind: 'z:ana:30' }));
const used = ev => ev.sources.filter(s => s.used).map(s => s.k);

test('the owner\'s 13 × 30/15 s at 370 W: far above 197 W, the set is named', () => {
  const r = ride(1, [[900, 180], ...set3015(), [1800, 200]], { ivs: ivs3015() });
  const ev = ftpEvidence([r], { now: NOW });
  assert.ok(ev.w >= 260 && ev.w <= 300, String(ev.w)); assert.ok(used(ev).includes('set'), used(ev).join());
  assert.match(ev.from, /13 × 30 s set at 370 W/); assert.ok(ev.lo <= ev.w && ev.hi >= ev.w && ev.lo >= ev.floor);
  // the same ride ridden freely (no workout, no ivs): the curve's shape alone still shows a maximal effort
  const free = ftpEvidence([ride(1, [[900, 180], ...set3015(), [1800, 200]])], { now: NOW });
  assert.ok(free.w >= 250, String(free.w)); assert.ok(free.maxish);
  // the old rule said 0.95 × best 20 min
  assert.ok(ev.w > Math.round(0.95 * free.curve[1200]) + 20, `${ev.w} vs ${free.curve[1200]}`);
});

test('classic evidence: 5 min best 372 W and 20 min best 305 W, critical power fitted, "Based on" with dates', () => {
  const a = ride(3, [[1200, 180], [300, 372], [1800, 190]]), b = ride(15, [[900, 190], [1200, 305], [1200, 180]]);
  const ev = ftpEvidence([a, b], { now: NOW });
  assert.ok(ev.w >= 280 && ev.w <= 300, String(ev.w)); assert.ok(used(ev).includes('cp'), used(ev).join()); assert.ok(used(ev).includes('p20'));
  const cp = ev.sources.find(s => s.k === 'cp'); assert.match(cp.label, /critical power 28\d W \(W′ \d+ kJ\)/);
  assert.match(ev.from, /20 min best 305 W \(\d+ Nov\)/); assert.ok(['medium', 'high'].includes(ev.confidence), ev.confidence);
  assert.equal(ev.updated, a.date);
  // compatible estimateFTP: { w, from } plus the new fields
  const e = estimateFTP([a, b], 42, { now: NOW }); assert.equal(e.w, ev.w); assert.equal(typeof e.from, 'string'); assert.ok(e.lo && e.hi && e.confidence);
  const t = estimateFTP([a, b, ride(5, [[600, 150]], { ftpTest: 301 })], 42, { now: NOW }); assert.equal(t.w, 301); assert.match(t.from, /^test on/);
});

test('only easy riding: no estimate (w null), but the best hour is a floor; profileOf gives no ftpEst', () => {
  const easy = [1, 3, 6, 9, 13].map(d => ride(d, [[600, 150], [3600, 200 + (d % 3)], [300, 150]], { routeId: 'outdoor' }));
  const ev = ftpEvidence(easy, { now: NOW });
  assert.equal(ev.w, null); assert.equal(ev.confidence, 'none'); assert.ok(ev.floor >= 200, String(ev.floor)); assert.match(ev.from, /^at least 20\d W/);
  const P = profileOf({ ftp: 0 }, easy.map(r => ({ ...r, date: Date.now() - (NOW - r.date) })));
  assert.equal(P.ftpEst, null); assert.ok(P.ftpEv.floor >= 200);
  const F = ftpSummary({}, P, null); assert.equal(F.est, null); assert.ok(F.floor >= 200); assert.match(F.floorFrom, /at least/);
});

test('Strava summaries only (no samples): never a 197-like estimate, NP of long rides as a floor or nothing', () => {
  const sum = (d, dur, np, avg) => ({ id: 's' + d, routeId: 'ext', source: 'strava', sportType: 'Ride', date: NOW - d * D, duration: dur, ...(np ? { np } : {}), ...(avg ? { avgPower: avg } : {}) });
  const ev = ftpEvidence([sum(2, 3600, 262, 248), sum(6, 5400, 240, 228), sum(9, 1800, 300, 280)], { now: NOW });
  assert.equal(ev.w, null); assert.equal(ev.floor, Math.round(262 / 1.03)); assert.match(ev.from, /262 W normalized over 60 min \(summary\)/);
  assert.ok(ev.sources.every(s => s.kind === 'floor' || !s.used));
  assert.equal(ftpEvidence([sum(2, 3600, 0, 180)], { now: NOW }), null, 'no device watts: no evidence at all');
  assert.equal(ftpEvidence([], { now: NOW }), null);
  // with sample evidence the summaries only raise the floor
  const r = ride(1, [[900, 180], ...set3015(), [1800, 200]], { ivs: ivs3015() }), withS = ftpEvidence([r, sum(4, 4800, 290, 280)], { now: NOW });
  assert.ok(withS.w >= 290, 'a hard 80-min ride at NP 290 lifts the value to its floor'); assert.equal(withS.floor, 290);
});

test('floors: never below the best hour; completed threshold steps count; a long steady hour beats a weak 5 min', () => {
  const r = ride(2, [[3600, 280], [300, 330]]); const ev = ftpEvidence([r], { now: NOW });
  assert.ok(ev.w == null || ev.w >= 284); assert.equal(ev.floor, Math.round((3300 * 280 + 300 * 330) / 3600), 'the best hour, with the end of the 5 min in it');
  const th = ride(4, [[600, 160], [1200, 250], [300, 150], [1200, 250], [600, 150]], { ivs: [{ name: 'Threshold 1', t: 1200, w: 250, pct: 98, target: 250 }, { name: 'Threshold 2', t: 1200, w: 250, pct: 98, target: 250 }] });
  const e2 = ftpEvidence([th, ride(3, [[600, 170], [300, 360], [600, 160]])], { now: NOW });
  const st = e2.sources.find(s => s.k === 'steps'); assert.ok(st && st.w === Math.round(250 / topRatio(2040)), JSON.stringify(st)); assert.match(st.label, /2 × 20 min at 250 W/);
  assert.ok(e2.w >= st.w);
});

test('sanity: stronger rides give a higher value, an easy ride added changes nothing, watch samples (10 s) agree with 1 s', () => {
  const base = s => [ride(3, [[1200, 180], [300, 372 * s], [1800, 190]]), ride(15, [[900, 190], [1200, 305 * s], [1200, 180]])];
  const lo = ftpEvidence(base(1), { now: NOW }).w, hi = ftpEvidence(base(1.1), { now: NOW }).w;
  assert.ok(hi > lo && Math.abs(hi / lo - 1.1) < 0.02, `${lo} -> ${hi}`);
  for (const k of [0.9, 0.95, 1, 1.05, 1.1, 1.2]) assert.ok(ftpEvidence(base(k), { now: NOW }).w >= ftpEvidence(base(k - 0.05), { now: NOW }).w, String(k));
  assert.equal(ftpEvidence([...base(1), ride(1, [[5400, 170]])], { now: NOW }).w, lo, 'an easy ride never lowers it');
  const w10 = ftpEvidence([ride(3, [[1200, 180], [300, 372], [1800, 190]], {}, 10), ride(15, [[900, 190], [1200, 305], [1200, 180]], {}, 10)], { now: NOW }).w;
  assert.ok(Math.abs(w10 - lo) <= 3, `${w10} vs ${lo}`);
  assert.equal(perSecond([[0, 0, 100], [10, 0, 200], [20, 0, 300]]).pw.length, 21);
  assert.equal(ftpEvidence([ride(100, [[1200, 300], [300, 380]])], { now: NOW }), null, 'older than 90 days: nothing');
  // newer counts more: the same two efforts, the recent one pulls harder
  const old = ride(80, [[600, 150], [1200, 320], [600, 150]]), nw = ride(2, [[600, 150], [1200, 290], [300, 150], [300, 360], [600, 150]]);
  const e = ftpEvidence([old, nw], { now: NOW }); assert.ok(e.w < Math.round(320 / 1.05), String(e.w));
  // a heart rate at 90+ % of its max over 8+ min makes a steady effort count as maximal
  const hr = ride(2, [[600, 150, 120], [1500, 270, 176], [600, 150, 130]]), noHr = ride(2, [[600, 150], [1500, 270], [600, 150]]);
  assert.equal(ftpEvidence([noHr], { now: NOW }).w, null); assert.ok(ftpEvidence([hr], { now: NOW, hrMax: 190 }).w >= 245);
});

test('ftpUpdate: up fast (max 8 %), down slowly and only after 6 weeks without support, never on weak evidence', () => {
  const src = (w, daysAgo, used = true) => ({ k: 'p20', kind: 'estimate', w, label: `20 min best ${Math.round(w * 1.05)} W`, date: NOW - daysAgo * D, weight: 1, used });
  const ev = (w, o = {}) => ({ w, lo: w - 8, hi: w + 8, floor: w - 30, confidence: 'medium', from: 'x', span: 80, sources: [src(w, 5)], ...o });
  assert.deepEqual(ftpUpdate(250, ev(268), { now: NOW }), { from: 250, to: 268, reason: 'Your rides show more: 20 min best 281 W point to 268 W.' });
  assert.equal(ftpUpdate(197, ev(280), { now: NOW }).to, Math.round(197 * 1.08), 'at most 8 % at once');
  assert.equal(ftpUpdate(250, ev(252), { now: NOW }), null, 'under 3 W');
  assert.equal(ftpUpdate(250, ev(280, { confidence: 'low' }), { now: NOW }), null, 'low confidence');
  assert.equal(ftpUpdate(250, null, { now: NOW }), null); assert.equal(ftpUpdate(250, { w: null, floor: 260, confidence: 'none' }, { now: NOW }), null);
  assert.equal(ftpUpdate(0, ev(268), { now: NOW }).to, 268, 'first estimate');
  // down: blocked while anything of the last 6 weeks backs the current value
  assert.equal(ftpUpdate(300, ev(280, { sources: [src(280, 5), src(296, 30, false)] }), { now: NOW }), null, 'a 30-day-old effort still backs 300 W');
  assert.equal(ftpUpdate(300, ev(280, { span: 30, sources: [src(280, 5)] }), { now: NOW }), null, 'too short a history to go down');
  assert.equal(ftpUpdate(300, ev(292, { sources: [src(292, 5)] }), { now: NOW }), null, 'current value inside the range');
  const dn = ftpUpdate(300, ev(270, { sources: [src(270, 5), src(299, 50)] }), { now: NOW });
  assert.equal(dn.from, 300); assert.equal(dn.to, 288, 'at most 4 % down at once'); assert.match(dn.reason, /last 6 weeks/);
  assert.equal(ftpUpdate(300, ev(289, { hi: 297, sources: [src(289, 5)] }), { now: NOW }).to, 289, 'a small step down goes all the way');
  assert.equal(ftpUpdate(300, ev(295, { hi: 299, sources: [src(295, 5)] }), { now: NOW }), null, '295 W (98 %) still backs 300 W');
  // with the real evidence of the owner's set: from 197 up, step by step
  const real = ftpEvidence([ride(1, [[900, 180], ...set3015(), [1800, 200]], { ivs: ivs3015() }), ride(8, [[900, 180], ...set3015(12, 365), [1800, 200]], { ivs: ivs3015(12, 365) })], { now: NOW });
  let f = 197, steps = 0; for (let u; (u = ftpUpdate(f, real, { now: NOW })); steps++) f = u.to;
  assert.equal(f, real.w); assert.ok(steps >= 3 && steps <= 6, String(steps));
});
