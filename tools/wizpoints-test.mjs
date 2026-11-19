// Wizard points (js/wizpoints.js, js/story.js StoryRide): the formula with the owner's reference rides, the day caps, jumped /
// flown metres, rides under 10 minutes, the trial and challenge bonuses, the strength set, the one-time migration from the
// three-figure wager and the week roll-over. Usage: node --test tools/wizpoints-test.mjs   (no browser, no network)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStep, ridePoints, splitOf, migrateLedger, earn, balanceOf, strengthPts, EXERCISES, STR_DAY, WP, fmtWp } from '../js/wizpoints.js';

const near = (a, b, tol = 3, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} ${a} ≈ ${b} ±${tol}`);
/** load of a steady ride: seconds at an intensity factor */
const loadOf = (sec, IF, ftp = 250) => { let l = 0; for (let t = 0; t < sec; t++) l += loadStep(1, IF * ftp, ftp); return l; };

test('training load: one hour exactly at FTP is 100, no power is 0', () => {
  near(loadOf(3600, 1), 100, 1e-6, 'FTP hour'); near(loadOf(1800, 1), 50, 1e-6, 'half an hour');
  assert.equal(loadStep(1, 0, 250), 0); assert.equal(loadStep(1, 300, 0), 0, 'no FTP: nothing');
  near(loadOf(3600, 0.74), 54.76, 0.01, 'IF 0.74');
});

test('reference rides of the owner (±3)', () => {
  near(ridePoints({ km: 30, hm: 300, load: loadOf(3600, 0.74), minutes: 60 }).total, 88, 3, '1 h Z2, 30 km, 300 Hm, IF 0.74');
  near(ridePoints({ km: 32, hm: 200, load: 85, minutes: 60 }).total, 95, 3, '1 h VO2 workout, 32 km, 200 Hm, load 85');
  near(ridePoints({ km: 90, hm: 1600, load: 200, minutes: 180 }).total, 350, 3, '3 h, 90 km, 1600 Hm, load 200');
});

test('breakdown: 1 per km, 1 per 10 m, half the load; the lines add up to the total', () => {
  const p = ridePoints({ km: 30.4, hm: 304, load: 54.8, trials: 1, wins: 2, strength: 7, minutes: 61 });
  assert.deepEqual([p.distance, p.climbing, p.intensity, p.trial, p.challenges, p.strength], [30, 30, 27, 25, 30, 7]);
  assert.equal(p.total, 30 + 30 + 27 + 25 + 30 + 7);
  assert.equal(ridePoints({ wins: 9, minutes: 30 }).challenges, WP.winsCap * 15, 'at most 3 won challenges a ride');
  assert.deepEqual(splitOf(p), { king: 30, devil: 30, wizard: 27 + 25 + 30 }, 'week colour: distance = King, climbing = Devil, intensity + trial + duels = Wizard');
});

test('a ride under 10 minutes pays nothing', () => {
  assert.equal(ridePoints({ km: 8, hm: 120, load: 20, trials: 1, minutes: 9.9 }).total, 0);
  assert.equal(ridePoints({ km: 8, hm: 120, load: 20, minutes: 10 }).total, 8 + 12 + 10);
});

test('strength after the ride: the old per-rep rates and the daily cap, now in Wizard points', () => {
  const e = id => EXERCISES.find(x => x.id === id);
  assert.equal(strengthPts(e('pull'), 10), 5); assert.equal(strengthPts(e('push'), 25), 5); assert.equal(strengthPts(e('sit'), 40), 5);
  assert.equal(strengthPts(e('plank'), 3), 6, 'plank: 2 points a minute'); assert.equal(strengthPts(e('push'), 500), STR_DAY, 'capped at 30 a day');
  assert.equal(strengthPts(e('push'), 500, 4), 4, 'capped by what is left today'); assert.equal(strengthPts(e('push'), 'x'), 0);
  assert.ok(EXERCISES.every(x => !('who' in x)), 'no "for whom" any more');
});

test('wallet: earn books into the wallet and the week; balance = earned − spent (+ test grant)', () => {
  const L = { wp: { earned: 100, spent: 40, owned: [], v: 1 }, weekWp: 5 };
  assert.equal(earn(L, 12.4), 12); assert.equal(L.wp.earned, 112); assert.equal(L.weekWp, 17); assert.equal(balanceOf(L.wp), 72);
  assert.equal(balanceOf({ ...L.wp, grant: 1000 }), 1072); assert.equal(balanceOf(null), 0); assert.equal(fmtWp(1240), '1 240');
});

test('migration once: lifetime km + Hm / 10 plus this week\'s old three-figure points', () => {
  const L = { week: '2026-11-16', pts: { wizard: 12, king: 40, devil: 18 }, life: { km: 1234.6, hm: 15300 } };
  assert.equal(migrateLedger(L, '2026-11-16'), true);
  assert.deepEqual(L.wp, { earned: Math.round(1234.6 + 1530) + 70, spent: 0, owned: [], v: 1 }); assert.equal(L.weekWp, 70);
  L.wp.spent = 500; assert.equal(migrateLedger(L, '2026-11-16'), false, 'never twice'); assert.equal(L.wp.spent, 500);
  const old = { week: '2026-11-09', pts: { wizard: 50, king: 50, devil: 50 }, life: { km: 100, hm: 1000 } }; migrateLedger(old, '2026-11-16');
  assert.equal(old.wp.earned, 200, 'last week\'s old points are not this week\'s'); assert.equal(old.weekWp, undefined);
  const fresh = {}; migrateLedger(fresh, '2026-11-16'); assert.equal(fresh.wp.earned, 0, 'a new rider starts at 0');
});

// ---- StoryRide in node: a fake IndexedDB-free db (story.js only touches db in loadLedger / saveLedger) ----
const { StoryRide, storyHTML, strengthLeft, WP_INFO } = await import('../js/story.js');
const ledger = (o = {}) => ({ week: 'w', life: { km: 0, hm: 0, hells: 0, trials: 0, rides: 0, training: 0, routes: {} }, day: { key: 'd', km: 0, hm: 0 }, pts: { wizard: 0, king: 0, devil: 0 }, weekWp: 0, wp: { earned: 0, spent: 0, owned: [], v: 1 }, ...o });
/** ride `sec` seconds at v m/s, power W, climbing g (rise per metre) */
function ride(S, sec, { v = 8.33, power = 200, g = 0.01, moving = true } = {}) { for (let t = 0; t < sec; t++) S.tick(1, { dd: v, dh: v * g, power, cadence: 85, moving }); }

test('StoryRide: a Z2 hour books about 88 points into wallet, week and the result block', () => {
  const L = ledger(), S = new StoryRide({ L, ftp: 250, training: true });
  ride(S, 3600, { v: 30000 / 3600, power: 0.74 * 250, g: 0.01 });
  const s = S.finish(60);
  near(s.wp.total, 88, 3, 'ride'); assert.equal(L.wp.earned, s.wp.total); assert.equal(L.weekWp, s.wp.total); assert.equal(s.balance, s.wp.total);
  near(L.life.km, 30, 0.01); near(L.life.hm, 300, 0.5);
  const h = storyHTML(s);
  assert.match(h, /Wizard points/); assert.match(h, /\+8\d/); for (const n of ['Distance', 'Climbing', 'Intensity']) assert.match(h, new RegExp(n));
  assert.match(h, /This week/); assert.match(h, /Balance/); assert.match(h, /id="wpShop"/);
  assert.doesNotMatch(h, /King|Devil|wager|three/i, 'no three kinds of points on screen');
  assert.doesNotMatch(h, /Trial|Challenges/, 'zero bonus lines stay hidden');
  assert.doesNotMatch(WP_INFO, /King|Devil/); assert.equal(WP_INFO.split(/\.\s/).length, 2, 'the "?" explains it in two sentences');
});

test('StoryRide: day caps, flown / paused metres and no power never count; bonuses and the 10 min rule', () => {
  const L = ledger({ day: { key: 'd', km: 145, hm: 2990 } }), S = new StoryRide({ L, ftp: 250, training: true });
  ride(S, 1200, { v: 10, g: 0.05 }); assert.ok(Math.abs(S.km - 5) < 1e-9, 'only 5 km left today: ' + S.km); assert.ok(Math.abs(S.hm - 10) < 1e-9, 'only 10 m left today');
  const F = new StoryRide({ L: ledger(), ftp: 250, training: true });
  ride(F, 600, { moving: false }); ride(F, 600, { power: 0 }); assert.equal(F.km, 0, 'flying or coasting without power: nothing'); assert.equal(F.load, 0);
  F.trialPass(); F.challenge('knight', 'win'); F.challenge('eagle', 'accept'); F.challenge('eagle', 'win'); F.challenge('eagle', 'win');
  ride(F, 900); const s = F.finish(35);
  assert.equal(s.wp.trial, 25); assert.equal(s.wp.challenges, 15, 'a win counts once and only after accepting');
  const T = new StoryRide({ L: ledger(), ftp: 250, training: true }); ride(T, 500); T.trialPass();
  const t = T.finish(500 / 60); assert.equal(t.wp.total, 0, 'under 10 minutes: nothing'); assert.match(storyHTML(t), /under 10 minutes/);
});

test('strength offer only after 20 min, 4 days a week', () => {
  const L = ledger(); assert.equal(strengthLeft({ L, minutes: 19 }), 0); assert.equal(strengthLeft({ L, minutes: 20 }), STR_DAY);
  L.strWeek = { week: 'w', n: 4 }; assert.equal(strengthLeft({ L, minutes: 40 }), 0, 'four strength days used');
  const h = storyHTML({ wp: ridePoints({ km: 20, minutes: 40 }), km: 20, hm: 0, load: 0, week: 20, balance: 20, minutes: 40, L: ledger() });
  assert.match(h, /strength for extra Wizard points/); assert.doesNotMatch(h, /<select/, 'no "for whom" select');
});
