// The Today page's pure parts (25.11.): the card layout model (js/cardlayout.js), readiness (js/readiness.js), "What changed"
// (js/insights.js) and the plan rules (js/planlib.js). No server, no page; the API side is tools/plan-test.mjs.
// Usage: node --test tools/today-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as LY from '../js/cardlayout.js';
import { readiness, parts, wordOf, suggestion } from '../js/readiness.js';
import { insights } from '../js/insights.js';
import { validateEntry, autoMatch, week, startHref, dayKey, addDays, monday, dayMs, kindOfAct, tidy } from '../js/planlib.js';

const CAT = [
  { id: 'today', sizes: ['full', 'half'], size: 'full' },
  { id: 'last', sizes: ['full', 'half'], size: 'full' },
  { id: 'recovery', sizes: ['full'], size: 'full' },
  { id: 'weight', sizes: ['full'], size: 'full' },
  { id: 'fitness', sizes: ['half', 'full'], size: 'half' },
  { id: 'battery', sizes: ['half'], size: 'half', on: false },
];
const ids = L => L.cards.map(c => c.id);

test('layout: the default follows the catalogue, cards without data go lower but stay, default-off cards are under Add', () => {
  const D = LY.defaultLayout(CAT);
  assert.deepEqual(ids(D), ['today', 'last', 'recovery', 'weight', 'fitness']); assert.deepEqual(D.hidden, ['battery']); assert.equal(D.def, true); assert.equal(D.at, 0);
  assert.equal(D.cards.find(c => c.id === 'fitness').size, 'half');
  const E = LY.defaultLayout(CAT, { empty: ['recovery', 'today'] });
  assert.deepEqual(ids(E), ['last', 'weight', 'fitness', 'today', 'recovery'], 'empty ones after, in their own order, none hidden');
});

test('layout: move, moveBy, remove, add, size, reset', () => {
  let L = LY.normalize(null, CAT);
  L = LY.move(L, 'fitness', 0); assert.deepEqual(ids(L).slice(0, 2), ['fitness', 'today']); assert.equal(L.def, false); assert.ok(L.at > 0);
  L = LY.moveBy(L, 'fitness', 1); assert.deepEqual(ids(L).slice(0, 2), ['today', 'fitness']);
  const top = LY.moveBy(LY.move(L, 'today', 0), 'today', -1); assert.equal(ids(top)[0], 'today', 'not past the top');
  L = LY.remove(L, 'weight'); assert.ok(!ids(L).includes('weight')); assert.ok(L.hidden.includes('weight'));
  L = LY.add(L, 'battery', CAT); assert.equal(ids(L).at(-1), 'battery'); assert.ok(!L.hidden.includes('battery'));
  L = LY.add(L, 'weight', CAT, 0); assert.equal(ids(L)[0], 'weight', 'add at a position');
  L = LY.setSize(L, 'today', 'half', CAT); assert.equal(L.cards.find(c => c.id === 'today').size, 'half');
  const same = LY.setSize(L, 'recovery', 'half', CAT); assert.equal(same.cards.find(c => c.id === 'recovery').size, 'full', 'a size the card does not have is refused');
  const R = LY.reset(CAT, 5); assert.equal(R.def, true); assert.equal(R.at, 5); assert.deepEqual(ids(R), ids(LY.defaultLayout(CAT)));
});

test('layout: stored arrangements are migrated (old ids, unknown ids, new cards) and checked', () => {
  const L = LY.normalize({ v: 1, at: 9, cards: [{ id: 'health', size: 'full' }, { id: 'week', size: 'half' }, { id: 'gone', size: 'half' }, { id: 'fitness', size: 'huge' }], hidden: ['body'] }, CAT);
  assert.deepEqual(ids(L).slice(0, 3), ['recovery', 'today', 'fitness'], 'health -> recovery, week -> today, unknown dropped');
  assert.equal(L.cards.find(c => c.id === 'today').size, 'half'); assert.equal(L.cards.find(c => c.id === 'fitness').size, 'half', 'a bad size falls back to the default');
  assert.ok(L.hidden.includes('weight'), 'body -> weight stays removed'); assert.ok(ids(L).includes('last'), 'a card the old list did not know is appended');
  assert.ok(!ids(L).includes('battery') && L.hidden.includes('battery'), 'a new default-off card is offered, not shown');
  // the server's shape check
  assert.equal(LY.clean(null), null); assert.equal(LY.clean({ at: 0, cards: [] }), null, 'no time');
  assert.deepEqual(LY.clean({ at: 3, def: true, cards: [{ id: 'x', size: 'half' }] }), { v: LY.LAYOUT_V, at: 3, def: true }, 'a default is stored as such');
  assert.equal(LY.clean({ at: 3, cards: [{ id: 'Bad Id', size: 'half' }] }), null);
  assert.equal(LY.clean({ at: 3, cards: [{ id: 'a', size: 'half' }, { id: 'a', size: 'full' }] }), null, 'twice');
  assert.equal(LY.clean({ at: 3, cards: [{ id: 'a', size: 'wide' }] }), null);
  assert.equal(LY.clean({ at: 3, cards: [{ id: 'a', size: 'half' }], hidden: ['a'] }), null, 'shown and hidden');
  assert.equal(LY.clean({ at: 3, cards: Array.from({ length: LY.MAX_CARDS + 1 }, (_, i) => ({ id: 'c' + i, size: 'half' })) }), null, 'too many');
  assert.deepEqual(LY.clean({ at: 3, cards: [{ id: 'a', size: 'half', x: 1 }], hidden: ['b'], junk: 1 }), { v: LY.LAYOUT_V, at: 3, def: false, cards: [{ id: 'a', size: 'half' }], hidden: ['b'] });
});

test('layout: the newer arrangement wins; a whole-settings upload never takes a newer one back', () => {
  const a = { at: 5, cards: [{ id: 'a', size: 'half' }] }, b = { at: 7, cards: [{ id: 'b', size: 'full' }] };
  assert.equal(LY.newer(a, b).at, 7); assert.equal(LY.newer(b, a).at, 7); assert.equal(LY.newer(a, { ...b, at: 5 }).cards[0].id, 'a', 'a tie keeps the first');
  assert.equal(LY.newer(null, a).at, 5); assert.equal(LY.newer('junk', null), null);
  assert.equal(LY.keepHome({ ftp: 260, homeCards: a }, { homeCards: b }).homeCards.at, 7, 'stored newer stays');
  assert.equal(LY.keepHome({ ftp: 260, homeCards: b }, { homeCards: a }).homeCards.at, 7, 'incoming newer wins');
  assert.equal(LY.keepHome({ ftp: 260 }, { homeCards: b }).homeCards.at, 7, 'an upload without it keeps it'); assert.equal(LY.keepHome({ ftp: 260 }, {}).ftp, 260);
  assert.ok(!('homeCards' in LY.keepHome({ homeCards: 'junk' }, null)), 'junk is dropped');
});

test('readiness: fewer than two inputs is no value, never a made-up number', () => {
  const none = readiness({}); assert.equal(none.score, null); assert.equal(none.word, 'Not enough data yet'); assert.match(none.why, /at least two/);
  const one = readiness({ bb: 80 }); assert.equal(one.score, null); assert.match(one.why, /Only body battery/); assert.ok(one.missing.includes('sleep'));
  assert.equal(readiness({ bb: 'x', sleep: 140, rhr: { v: 50 } }).score, null, 'bad values are not inputs');
});

test('readiness: the weighted mean, the word bands, the sentence names what moves it', () => {
  const r = readiness({ bb: 90, rhr: { v: 45, avg: 50 } }); // 90*3 + (75+40 -> 100)*2 = 470 / 5 = 94
  assert.equal(r.score, 94); assert.equal(r.word, 'Ready'); assert.match(r.why, /Body battery is at 90/); assert.match(r.why, /5 below its 7-day average/);
  assert.deepEqual(r.parts.map(p => p.k), ['bb', 'rhr']); assert.equal(r.parts[1].value, '45 (−5 vs 7 d)');
  const t = readiness({ bb: 15, rhr: { v: 58, avg: 50 }, form: -30, load: { y: 200, ctl: 60 } });
  assert.ok(t.score < 35, String(t.score)); assert.equal(t.word, 'Rest and recover'); assert.match(t.why, /only at 15/);
  assert.equal(wordOf(75), 'Ready'); assert.equal(wordOf(74), 'Good to train'); assert.equal(wordOf(55), 'Good to train'); assert.equal(wordOf(54), 'Take it easy'); assert.equal(wordOf(35), 'Take it easy'); assert.equal(wordOf(34), 'Rest and recover');
  const p = Object.fromEntries(parts({ form: 10, load: { y: 0, ctl: 50 }, sleep: 80 }).map(x => [x.k, x]));
  assert.equal(p.form.part, 80); assert.equal(p.load.part, 90); assert.equal(p.load.value, 'rest'); assert.equal(p.sleep.part, 80);
  assert.equal(parts({ load: { y: 500, ctl: 10 } })[0].part, 10, 'the load part is clamped');
  assert.equal(suggestion(readiness({})).kind, 'other'); assert.equal(suggestion({ score: 20 }).kind, 'rest'); assert.match(suggestion({ score: 80 }, 0).title, /Intervals/); assert.match(suggestion({ score: 80 }, -20).title, /Steady/);
});

test('insights: plain rules, at most n, each with a link', () => {
  const now = new Date(2026, 10, 25, 12).getTime(), D = 864e5;
  const acts = [0, 1, 2, 7, 8, 9, 14, 15, 16].map(i => ({ id: 'a' + i, date: now - i * D - 3600e3, duration: 3600, sport: 'bike' }));
  const L = insights({ acts, now, recs: { list: [{ t: now - 2 * D, what: 'Bench press', value: '92.5 kg × 8' }] }, fit: { ctl: 40, d28: 6, empty: false },
    body: { list: [{ t: now - 30 * D, kg: 76.5 }, { t: now - 20 * D, kg: 76 }, { t: now - 7 * D, kg: 75.5 }, { t: now, kg: 75.2 }] }, last: { name: 'Endurance ride', href: 'x.html' } }, 9);
  assert.deepEqual(L.map(x => x.k), ['record', 'weight', 'fitness', 'streak', 'last']);
  assert.match(L[0].text, /^New best on \w+day: bench press 92\.5 kg × 8\.$/); assert.match(L[2].text, /Fitness up 6 in 4 weeks, now 40/); assert.match(L[3].text, /3 weeks in a row/);
  assert.equal(L[4].href, 'x.html'); assert.ok(L.every(x => x.href && x.text));
  assert.equal(insights({ acts, now, fit: { ctl: 40, d28: 6 } }).length <= 4, true); assert.equal(insights({ acts, now, fit: { ctl: 40, d28: 6 }, last: { name: 'R' } }, 2).length, 2);
  assert.deepEqual(insights({}), [], 'nothing known: nothing said');
  assert.ok(!insights({ acts, now, recs: { list: [{ t: now - 9 * D, what: 'X', value: '1' }] } }).some(x => x.k === 'record'), 'an old record is not news');
  assert.match(insights({ acts: [acts[0]], now }).find(x => x.k === 'streak').text, /1 session in the last 4 weeks/);
});

test('plan: entries are checked', () => {
  const now = new Date(2026, 10, 25, 12).getTime();
  assert.deepEqual(validateEntry({ day: '2026-11-26', kind: 'ride' }, { now }).v, { day: '2026-11-26', kind: 'ride', title: 'Ride' }, 'title from the kind');
  assert.deepEqual(validateEntry({ day: '2026-11-26', kind: 'strength', title: '  Push <b>day</b> ', ref: 'w1', minutes: 50, note: 'x' }, { now }).v, { day: '2026-11-26', kind: 'strength', title: 'Push bday/b', ref: 'w1', minutes: 50, note: 'x' });
  for (const [b, re] of [[{ day: '2026-02-30', kind: 'ride' }, /day/], [{ day: '2026-11-26', kind: 'swim' }, /kind/], [{ day: '2026-11-26', kind: 'ride', minutes: 0 }, /minutes/],
    [{ day: '2026-11-26', kind: 'ride', ref: 'a b' }, /ref/], [{ day: '2026-11-26', kind: 'ride', x: 1 }, /Unknown field/], [{ day: '2029-01-01', kind: 'ride' }, /next year/], [[], /object/]])
    assert.match(validateEntry(b, { now }).error || '', re, JSON.stringify(b));
  assert.deepEqual(validateEntry({ minutes: null, ref: null }, { partial: true, now }).v, { minutes: null, ref: null }, 'an edit can clear fields');
  assert.match(validateEntry({ kind: 'nap' }, { partial: true, now }).error, /kind/);
  assert.equal(validateEntry({ day: '2026-11-26', kind: 'ride', title: '   ' }, { now }).v.title, 'Ride', 'a blank new title: the kind\'s name');
  assert.match(validateEntry({ title: '   ' }, { partial: true, now }).error, /title/, 'an edit cannot blank it');
  assert.deepEqual(tidy({ a: 1, b: null, c: '' }), { a: 1 });
});

test('plan: days, the week strip, auto-match, where Start leads', () => {
  assert.equal(addDays('2026-11-30', 2), '2026-12-02'); assert.equal(monday('2026-11-25'), '2026-11-23'); assert.equal(monday('2026-11-29'), '2026-11-23'); assert.ok(Number.isNaN(dayMs('2026-13-01')));
  assert.equal(dayKey(new Date(2026, 2, 29, 23, 30).getTime()), '2026-03-29', 'local days across a DST change'); assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  const E = [{ id: 'p1', day: '2026-11-24', kind: 'ride' }, { id: 'p2', day: '2026-11-25', kind: 'strength' }, { id: 'p3', day: '2026-11-25', kind: 'rest' },
    { id: 'p4', day: '2026-11-26', kind: 'run' }, { id: 'p5', day: '2026-11-23', kind: 'ride', undone: 1 }, { id: 'p6', day: '2026-11-23', kind: 'other' }, { id: 'p7', day: '2026-11-22', kind: 'ride', done: 'a0' }];
  const at = (d, h) => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8), h).getTime();
  const A = [{ id: 'a0', date: at('2026-11-22', 9), kind: 'ride' }, { id: 'a1', date: at('2026-11-24', 9), kind: 'ride' }, { id: 'a2', date: at('2026-11-25', 9), kind: 'strength' },
    { id: 'a3', date: at('2026-11-26', 9), kind: 'run' }, { id: 'a4', date: at('2026-11-23', 9), kind: 'ride' }, { id: 'a5', date: at('2026-11-24', 18), kind: 'run' }];
  assert.deepEqual(autoMatch(E, A, '2026-11-25'), [['p6', 'a4'], ['p1', 'a1'], ['p2', 'a2']], 'same day and kind; other takes any; undone, rest, done and future skipped; an activity counts once');
  const W = week('2026-11-25', E, new Map([['2026-11-24', 2]]), '2026-11-25');
  assert.equal(W.length, 7); assert.equal(W[0].day, '2026-11-23'); assert.equal(W[6].day, '2026-11-29'); assert.equal(W[2].today, true); assert.equal(W[1].past, true); assert.equal(W[1].acts, 2); assert.equal(W[2].entries.length, 2);
  assert.equal(startHref({ kind: 'ride', ref: 'ss 3x10' }), 'pure.html?workout=ss%203x10'); assert.equal(startHref({ kind: 'ride' }), 'outdoor.html');
  assert.equal(startHref({ kind: 'run' }), 'outdoor.html?sport=run'); assert.equal(startHref({ kind: 'strength', ref: 'w1' }), 'kraft.html?watch=w1'); assert.equal(startHref({ kind: 'strength' }), 'kraft.html');
  assert.equal(startHref({ kind: 'rest' }), null); assert.equal(startHref(null), null);
  const fam = g => g === 'bike' || g === 'ebike' ? 'bike' : g;
  assert.equal(kindOfAct({ kraft: true }, { sportOf: () => 'bike', famOf: fam }), 'strength'); assert.equal(kindOfAct({}, { sportOf: () => 'ebike', famOf: fam }), 'ride');
  assert.equal(kindOfAct({}, { sportOf: () => 'run', famOf: fam }), 'run'); assert.equal(kindOfAct({}, { sportOf: () => 'hike', famOf: fam }), 'other');
});
