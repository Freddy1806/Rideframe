// Interval records from the ridden power (js/ivhistory.js), grouping by kind over all rides, the "Last time" comparison,
// the history view (js/ivview.js), the wizard and the challengers inside workout intervals and in a group (js/ivgate.js,
// js/wizard.js, js/challenges.js, js/group.js).
// Usage: node --test tools/ivhistory-test.mjs   (no browser, no network)
import test from 'node:test';
import assert from 'node:assert/strict';
import { intervalRecords, kindOf, sessions, compare, compareLine, legacyKind, bucket, zoneOf } from '../js/ivhistory.js';
import { WORKOUTS, workoutById, buildMy, workoutDuration } from '../js/workouts.js';
import { hardWindow, wizardGate, challengeGate, approachS, wzOf, friendCalls, friendsLine, cleanWz, WZ } from '../js/ivgate.js';
import { Wizard, WIZ } from '../js/wizard.js';
import { Challenges } from '../js/challenges.js';
import { Group } from '../js/group.js';

globalThis.getComputedStyle ||= () => ({});
const { ivSummaryHTML, ivHistoryHTML, ivChartHTML } = await import('../js/ivview.js');

const W55 = workoutById('vo2_5x5'), FTP = 250;
const startOf = (w, label) => w.steps.slice(0, w.steps.findIndex(x => x.label === label)).reduce((t, x) => t + x.dur, 0);
/** samples for a whole workout: watts per step from fn(step), heart rate and cadence optional */
function ride(w, fn, { hr = 0, cad = 90, upTo = Infinity } = {}) {
  const out = []; let t = 0;
  for (const st of w.steps) for (let k = 0; k < st.dur && t < upTo; k++) { t++; out.push([t, t * 8, fn(st, k), 30, cad, hr ? hr(st, k) : 0]); }
  return out;
}

test('interval records: ridden avg / max W, HR, cadence; plan only as context', () => {
  const smp = ride(W55, (st, k) => st.label.startsWith('VO2max') ? (k < 10 ? 330 : 280) : 120, { hr: (st, k) => st.label.startsWith('VO2max') ? 160 + (k % 10) : 120, cad: 95 });
  const ivs = intervalRecords({ workout: W55, samples: smp, ftp: FTP, stepAdj: [], kg: 72 });
  const vo = ivs.filter(x => /^VO2max/.test(x.name));
  assert.equal(vo.length, 5);
  const a = vo[0];
  assert.equal(a.name, 'VO2max 1/5'); assert.equal(a.t, 300);
  assert.equal(a.w, Math.round((10 * 330 + 290 * 280) / 300)); // what was ridden, never 110 % of FTP (275)
  assert.equal(a.wMax, 330); assert.equal(a.hr, 165); assert.equal(a.hrMax, 169); assert.equal(a.cad, 95);
  assert.equal(a.pct, 110); assert.equal(a.ftp, FTP); assert.equal(a.target, 275); assert.equal(a.kg, 72);
  assert.equal(a.kind, 'vo2_5x5:vo2max:300'); assert.equal(a.kl, 'VO2max 5 min');
  assert.equal(a.at, startOf(W55, 'VO2max 1/5'));
  assert.ok(ivs.some(x => /^Opener/.test(x.name)), 'openers stay laps / intervals of the ride');
  assert.ok(!ivs.some(x => x.name.startsWith('Rest')), 'rests are no intervals');
});

test('interval records: no heart rate strap -> no HR fields; the tuned target; a cut interval is marked part', () => {
  const st = startOf(W55, 'VO2max 2/5');
  const smp = ride(W55, () => 250, { upTo: st + 100 });
  const adj = []; adj[W55.steps.findIndex(x => x.label === 'VO2max 1/5')] = [10 * 300, 300];
  const ivs = intervalRecords({ workout: W55, samples: smp, elapsed: st + 100, ftp: FTP, stepAdj: adj }).filter(x => /^VO2/.test(x.name));
  assert.equal(ivs.length, 2);
  assert.equal(ivs[0].hr, undefined); assert.equal(ivs[0].hrMax, undefined);
  assert.equal(ivs[0].target, 285, 'target = 110 % of 250 + the rider\'s +10 W');
  assert.equal(ivs[1].t, 100); assert.equal(ivs[1].part, true);
});

test('kinds: built-in workout + step name + length; own workouts by zone and length bucket', () => {
  assert.equal(kindOf({ dur: 1200, pct: 97, label: 'Threshold 1/2' }, workoutById('thr2x20')).kind, 'thr2x20:threshold:1200');
  assert.equal(kindOf({ dur: 1200, pct: 97, label: 'Threshold 1/2' }, workoutById('thr2x20')).label, 'Threshold 20 min');
  const my = buildMy({ id: 'my_x', name: 'Mine', rows: [{ t: 'i', n: 4, onMin: 4.9, onPct: 112, offMin: 3, offPct: 50, label: 'Hard' }] });
  const st = my.steps.find(x => x.label === 'Hard 1/4');
  assert.deepEqual(kindOf(st, my), { kind: 'z:vo2:300', label: 'VO2max 5 min' });
  assert.equal(bucket(40), 45); assert.equal(bucket(290), 300); assert.equal(bucket(1150), 1200);
  assert.equal(zoneOf(90)[1], 'ss'); assert.equal(zoneOf(100)[1], 'thr'); assert.equal(zoneOf(120)[1], 'vo2'); assert.equal(zoneOf(150)[1], 'ana');
  // an old ride: only name / t / w
  assert.equal(legacyKind({ workoutId: 'vo2_5x5' }, { name: 'VO2max 3/5', t: 300, w: 280 }, W55).kind, 'vo2_5x5:vo2max:300');
  assert.equal(legacyKind({ workoutId: 'vo2_5x5' }, { name: 'VO2max 3/5', t: 300, w: 280 }, null).kind, 'vo2_5x5:vo2max:300');
  assert.equal(legacyKind({}, { name: 'Passo climb', t: 600, w: 250 }), null, 'climbs of a free ride have no kind');
});

const DAY = 864e5, NOW = Date.UTC(2026, 10, 17, 18);
const mk = (id, daysAgo, w, hr, extra = {}) => { const smp = ride(W55, st => st.label.startsWith('VO2max') ? w : 120, { hr: hr ? () => hr : null });
  return { id, date: NOW - daysAgo * DAY, workoutId: 'vo2_5x5', workout: 'VO2max 5 × 5', ivs: intervalRecords({ workout: W55, samples: smp, ftp: FTP, kg: 75 }), ...extra }; };

test('sessions: one per ride and kind, oldest first, best and latest; old rides without HR still count', () => {
  const old = { id: 'old', date: NOW - 180 * DAY, workoutId: 'vo2_5x5', workout: 'VO2max 5 × 5', ivs: [1, 2, 3, 4, 5].map(i => ({ name: `VO2max ${i}/5`, t: 300, w: 250 })) };
  const rides = [mk('b', 30, 281, 168), old, mk('c', 0, 288, 165), { id: 'x', date: NOW, unsaved: true, ivs: mk('x', 0, 999, 0).ivs }, { id: 'free', date: NOW, ivs: [{ name: 'Climb', t: 500, w: 300 }] }];
  const all = sessions(rides, { workoutById });
  const e = all.find(x => x.kind === 'vo2_5x5:vo2max:300');
  assert.ok(e); assert.equal(e.label, 'VO2max 5 min');
  assert.deepEqual(e.sessions.map(s => s.rideId), ['old', 'b', 'c']);
  assert.equal(e.sessions[0].w, 250); assert.equal(e.sessions[0].hr, undefined); assert.equal(e.sessions[0].n, 5);
  assert.equal(e.latest.rideId, 'c'); assert.equal(e.best.rideId, 'c'); assert.equal(e.latest.wkg, Math.round(288 / 75 * 100) / 100);
  assert.ok(!all.some(x => /opener|warm/i.test(x.label)), 'openers and warm-up are not offered as kinds');
  assert.ok(!all.some(x => x.sessions.some(s => s.rideId === 'x' || s.rideId === 'free')), 'unsaved rides and climbs stay out');
});

test('compare: against the last earlier session of the same kind', () => {
  const rides = [mk('a', 200, 270, 170), mk('b', 30, 281, 168)], now = mk('c', 0, 288, 165);
  const c = compare(now, [...rides, now], { workoutById }).find(x => x.kind === 'vo2_5x5:vo2max:300');
  assert.equal(c.prev.rideId, 'b'); assert.equal(c.dw, 7); assert.equal(c.dhr, -3);
  const day = new Date(NOW - 30 * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  assert.equal(c.line, `Last time (${day}): avg 281 W · today 288 W (+7 W), HR 168 → 165`);
  assert.equal(compareLine({ w: 250 }, null), 'First time: avg 250 W');
  assert.equal(compareLine({ w: 250, hr: 150 }, { w: 260, date: NOW }).includes('HR'), false, 'no HR last time: no HR part');
  assert.deepEqual(compare({ id: 'z' }, rides), []);
});

test('views: summary table with ridden values and "Last time", history with chart and table', () => {
  const rides = [mk('a', 200, 270, 170), mk('b', 30, 281, 168)], now = mk('c', 0, 288, 165);
  const html = ivSummaryHTML(now, compare(now, rides, { workoutById }));
  assert.match(html, /VO2max 1\/5/); assert.match(html, /<b>288<\/b>/); assert.match(html, /Last time \(/);
  assert.doesNotMatch(html, /275/, 'never the planned watts');
  const h = ivHistoryHTML([...rides, now], { kg: 75, width: 390, sel: 'vo2_5x5:vo2max:300' });
  assert.match(h, /Intervals?/); assert.match(h, /<svg[^>]+ivchart/); assert.match(h, /Average heart rate per session/);
  assert.match(h, /Best session/); assert.match(h, /Latest session/); assert.match(h, /3\.84/);
  assert.match(ivHistoryHTML([]), /No workout intervals yet/);
  const old = { id: 'o', date: NOW - DAY, workoutId: 'vo2_5x5', ivs: [{ name: 'VO2max 1/5', t: 300, w: 240 }] };
  assert.match(ivHistoryHTML([old], { sel: 'vo2_5x5:vo2max:300' }), /<td class="num">–<\/td>/, 'missing fields as "–"');
  assert.match(ivChartHTML(sessions([old], { workoutById })[0].sessions, 390), /viewBox="0 0 390 /);
});

test('hard window: only hard steps of 1 min or more, never warm-up, openers or rests; the tuned target', () => {
  const a = startOf(W55, 'VO2max 1/5');
  assert.equal(hardWindow(W55, a - 30, FTP), null, 'rest / spin');
  assert.equal(hardWindow(W55, startOf(W55, 'Opener 1/3') + 5, FTP), null, 'openers of 30 s');
  assert.equal(hardWindow(W55, 30, FTP), null, 'warm-up');
  const w = hardWindow(W55, a + 10, FTP, { hard: 15 });
  assert.equal(w.target, 275 + 15); assert.equal(w.left, 290);
  const ss = workoutById('ss3x10'); assert.equal(hardWindow(ss, startOf(ss, 'Warm-up') + 8 * 60 + 5, FTP), null, 'the 90 % warm-up minute');
  assert.equal(hardWindow(workoutById('ftp20'), startOf(workoutById('ftp20'), 'Test 20 min') + 5, FTP), null, 'a free test block');
});

test('wizard in a workout: called inside a hard interval with time for his trial, waits otherwise; target = interval target', () => {
  const z = new Wizard({ length: 50000, startD: 0, ftp: FTP, force: true, workout: workoutDuration(W55) });
  assert.equal(z.state, 'wait'); assert.equal(z.at, Infinity); assert.equal(z.armAt, 0);
  const a = startOf(W55, 'VO2max 1/5'), v = 9;
  assert.equal(wizardGate(z, hardWindow(W55, a - 20, FTP), { elapsed: a - 20, v }), null, 'rest: no wizard');
  assert.equal(wizardGate(z, hardWindow(W55, a + 300 - 60, FTP), { elapsed: a + 240, v }), null, 'too little of the interval left: he waits');
  assert.equal(wizardGate(z, hardWindow(W55, a + 5, FTP, { hard: 10 }), { elapsed: a + 5, v }), 'summon');
  z.summon(1000, 90);
  let d = 1000, ev = [], t = a + 5;
  for (let i = 0; i < 400 && z.state !== 'cast'; i++) { const win = hardWindow(W55, t, FTP, { hard: 10 }); ev.push(...z.tick(0.1, d, 300, win.target)); d += v * 0.1; t += 0.1; }
  assert.deepEqual(ev, ['ann', 'near', 'cast']);
  assert.ok(t - a < 25, `the trial starts within seconds (${(t - a).toFixed(1)} s into the interval)`);
  assert.ok(approachS(v) < 12);
  for (let i = 0; i < 600; i++) ev.push(...z.tick(0.1, d += 0.9, 290, 285));
  assert.equal(z.W, 285); assert.ok(ev.includes('pass'), 'held the interval target: passed');
  assert.match(z.card(d)?.title || '', /Passed|fly/i);
  // a summoned wizard leaves when the interval ends before his trial
  const y = new Wizard({ length: 50000, startD: 0, ftp: FTP, force: true, workout: 3000 }); y.summon(0, 100); y.tick(0.1, 0, 0, 275);
  assert.equal(wizardGate(y, null, { elapsed: 0, v }), 'dismiss'); y.dismiss(); assert.equal(y.state, 'wait'); assert.equal(y.at, Infinity);
  // fails below 97 % of the interval target
  const f = new Wizard({ length: 50000, startD: 0, ftp: FTP, force: true, workout: 3000 }); f.summon(0, 60); let fd = 0, fe = [];
  for (let i = 0; i < 800; i++) fe.push(...f.tick(0.1, fd += 0.9, 250, 275));
  assert.ok(fe.includes('fail')); assert.equal(f.pct, 91);
  // no wizard at all without luck
  assert.equal(new Wizard({ length: 50000, startD: 0, ftp: FTP, chance: 0, workout: 3000 }).state, 'off');
});

test('challenges in a workout: only inside a hard interval, at its target; the interval ends: the challenger leaves', () => {
  const params = { mass: 83, cda: 0.32, crr: 0.004, rho: 1.2, eff: 0.97, g: 9.81 };
  const ch = new Challenges({ length: 40000, startD: 0, n: 3, ftp: FTP, params, gradeAt: () => 0, rng: () => 0.5 });
  const first = ch.list[0], at0 = first.at;
  let ev = ch.tick(0.1, at0 - 100, 150, false, 9, challengeGate(null)); // a rest: no dare, it waits on the road
  assert.deepEqual(ev, []); assert.ok(first.at > at0 - 100 + 150 && first.state === 'wait');
  assert.ok(ch.list[1].at - first.at >= 3200 - 1, 'the next dare keeps its gap');
  const win = { i: 7, left: 280, target: 290 };
  ev = ch.tick(0.1, first.at - 100, 290, false, 9, challengeGate(win));
  assert.equal(ev[0]?.type, 'offer'); assert.equal(first.W, 290, 'the target is the interval target');
  ev = ch.tick(0.1, first.at - 99, 150, false, 9, challengeGate(null));
  assert.equal(ev[0]?.type, 'expire'); assert.equal(first.state, 'gone');
  // too little time left for the race: it waits
  const ch2 = new Challenges({ length: 40000, startD: 0, n: 3, ftp: FTP, params, gradeAt: () => 0, rng: () => 0.5 }), y = ch2.list[0];
  assert.deepEqual(ch2.tick(0.1, y.at - 100, 290, false, 9, challengeGate({ i: 3, left: 20, target: 290 })), []);
  // outside a workout (no gate) nothing changes
  const ch3 = new Challenges({ length: 40000, startD: 0, n: 3, ftp: FTP, params, gradeAt: () => 0, rng: () => 0.5 }), z = ch3.list[0], W0 = z.W;
  assert.equal(ch3.tick(0.1, z.at - 100, 150, false, 9)[0]?.type, 'offer'); assert.equal(z.W, W0);
});

test('group: the wizard for everyone at once, each against his own target; the wire field', () => {
  const me = new Wizard({ length: 30000, startD: 0, ftp: 300, force: true }), lap = 1;
  assert.equal(me.state, 'wait'); assert.equal(me.W, 360, 'own target: 120 % of my own FTP');
  const tom = { name: 'Tom', wz: [1, WZ.on, 0] };
  assert.equal(friendCalls(me, [tom], lap), true); assert.equal(friendCalls(me, [{ name: 'Tom', wz: [2, 1, 0] }], lap), false, 'another lap');
  me.summon(500, 90); let d = 500, ev = [];
  for (let i = 0; i < 900; i++) ev.push(...me.tick(0.1, d += 0.9, 370));
  assert.ok(ev.includes('pass'));
  assert.deepEqual(wzOf(me, lap), [1, WZ.pass, 103]);
  assert.equal(friendsLine([{ name: 'Tom', wz: [1, WZ.pass, 104] }, { name: 'Ann', wz: [1, WZ.fail, 93] }, { name: 'Bo', wz: [1, WZ.on, 99] }], 1), 'Tom: made it · Ann: failed (93 %) · Bo: 99 %');
  assert.deepEqual(cleanWz([1, 9, 'x']), [1, 3, 0]); assert.equal(cleanWz('bad'), null);
  // the wire: wz survives the cleaner when present, and is absent otherwise (an old peer simply never sends it)
  const g = Object.assign(Object.create(Group.prototype), { me: { id: 'me' }, riders: new Map(), host: false, lastD: new Map(), onChange() {} });
  g._recv({ t: 'state', r: { id: 'f', name: 'F', wz: [1, 2, 104, 'junk'] } }, {});
  assert.deepEqual(g.riders.get('f').wz, [1, 2, 104]);
  g._recv({ t: 'state', r: { id: 'o', name: 'Old' } }, {});
  assert.equal('wz' in g.riders.get('o'), false);
});
