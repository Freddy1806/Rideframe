// Activities from outside (17.11.): sport mapping, load and bests, Strava records, dedupe, GPX / TCX / FIT parsing.
// Usage: node --test tools/import-test.mjs   (no browser, no network)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRAVA, groupOf, labelOf, pretty, famOf, typeFromText, PICK } from '../js/sports.js';
import { sportOf, isBike, loadOf, profileOf, bests, totals } from '../js/fitness.js';
import { fromStrava, fromEntry, plan, sameAct, sidOf, startOf, dupOf } from '../js/actimport.js';
import { parseGPX, parseTCX, parseFIT, parseActivity, decodeFIT, crc16 } from '../js/actfile.js';
import { iceSkateFit, virtualRideFit, FitWriter, fitTime } from './fitenc.mjs';

const fx = n => readFileSync(new URL('./fixtures/' + n, import.meta.url));
const S0 = Date.UTC(2026, 10, 15, 9, 0, 0);
const sum = (o = {}) => ({ id: 111, name: 'Evening Ice Skate', sport_type: 'IceSkate', type: 'IceSkate', start_date: new Date(S0).toISOString(), elapsed_time: 3700, moving_time: 3500,
  distance: 18234.5, total_elevation_gain: 3.4, average_heartrate: 141.6, max_heartrate: 171, trainer: false, map: { summary_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }, ...o });

test('every listed Strava sport has a group, a label and an icon group the feed knows', () => {
  const need = ['Ride', 'VirtualRide', 'Run', 'TrailRun', 'Walk', 'Hike', 'Swim', 'IceSkate', 'InlineSkate', 'NordicSki', 'AlpineSki', 'Snowboard', 'Rowing', 'Kayaking', 'WeightTraining', 'Workout', 'Yoga', 'Crossfit', 'Soccer', 'Tennis'];
  for (const k of need) assert.ok(STRAVA[k], k);
  const groups = new Set(['ride', 'run', 'trainer', 'world', 'kraft', 'walk', 'swim', 'skate', 'ski', 'water', 'fit', 'ball', 'other']);
  for (const k of Object.keys(STRAVA)) { assert.ok(groups.has(groupOf(k)), k); assert.ok(labelOf(k) && !/[—–]/.test(labelOf(k)), k); }
  assert.equal(labelOf('IceSkate'), 'Ice skating'); assert.equal(groupOf('IceSkate'), 'skate'); assert.equal(groupOf('VirtualRide'), 'trainer'); assert.equal(groupOf('WeightTraining'), 'kraft');
  // unknown future types: prettified raw name, group "other"
  assert.equal(labelOf('UnderwaterHockeyMatch'), 'Underwater hockey match'); assert.equal(groupOf('UnderwaterHockeyMatch'), 'other'); assert.equal(pretty('EBikeRide'), 'E bike ride'); assert.equal(pretty(''), 'Other');
  assert.equal(famOf('trainer'), 'bike'); assert.equal(famOf('world'), 'bike'); assert.equal(famOf('skate'), 'skate');
  assert.equal(new Set(PICK).size, Object.keys(STRAVA).length);
  assert.equal(typeFromText('hiking'), 'Hike'); assert.equal(typeFromText('Running'), 'Run'); assert.equal(typeFromText('cycling'), 'Ride'); assert.equal(typeFromText('IceSkate'), 'IceSkate'); assert.equal(typeFromText(''), '');
});

test('sportOf keeps the old rides and sorts the new ones', () => {
  assert.equal(sportOf({ routeId: 'outdoor' }), 'ride'); assert.equal(sportOf({ routeId: 'run' }), 'run'); assert.equal(sportOf({ routeId: 'pure' }), 'trainer'); assert.equal(sportOf({ routeId: 'kurz' }), 'world'); assert.equal(sportOf({ kraft: true }), 'kraft');
  assert.equal(sportOf(fromStrava(sum())), 'skate'); assert.equal(sportOf(fromStrava(sum({ sport_type: 'TrailRun' }))), 'run'); assert.equal(sportOf(fromStrava(sum({ sport_type: 'GravelRide' }))), 'ride');
  assert.ok(isBike({ routeId: 'kurz' })); assert.ok(isBike(fromStrava(sum({ sport_type: 'VirtualRide' })))); assert.ok(!isBike(fromStrava(sum()))); assert.ok(!isBike({ kraft: true }));
});

test('Strava summary -> record: raw sport type, times, totals, polyline, no samples', () => {
  const r = fromStrava(sum({ average_watts: 0, kilojoules: 0, calories: 812, external_id: 'garmin_push_123' }));
  assert.equal(r.id, 'st111'); assert.equal(r.source, 'strava'); assert.equal(r.stravaId, '111'); assert.equal(r.strava, 'https://www.strava.com/activities/111');
  assert.equal(r.sportType, 'IceSkate'); assert.equal(r.workout, 'Evening Ice Skate'); assert.equal(r.start, S0); assert.equal(r.date, S0);
  assert.equal(r.duration, 3500); assert.equal(r.elapsed, 3700); assert.equal(r.distance, 18235); assert.equal(r.gain, 3); assert.equal(r.avgHr, 142); assert.equal(r.maxHr, 171); assert.equal(r.kcal, 812);
  assert.equal(r.polyline, '_p~iF~ps|U_ulLnnqC_mqNvxq`@'); assert.equal(r.samples, undefined); assert.equal(r.kj, undefined); assert.equal(r.ext, 'garmin_push_123');
  assert.equal(startOf(r), S0); assert.equal(sidOf(r), '111');
  const bike = fromStrava(sum({ sport_type: 'Ride', average_watts: 201.4, weighted_average_watts: 222, device_watts: true, kilojoules: 700 }));
  assert.equal(bike.avgPower, 201); assert.equal(bike.np, 222); assert.equal(bike.kj, 700); assert.equal(bike.sport, 'ride');
  assert.equal(fromStrava(sum({ sport_type: 'Ride', weighted_average_watts: 222, device_watts: false })).np, undefined); // estimated watts never steer the load
  assert.equal(fromStrava(sum({ sport_type: undefined, type: 'Swim' })).sportType, 'Swim');
});

test('load: heart rate when there is one, duration otherwise; other sports never touch FTP, power bests or run bests', () => {
  const P = { kg: 75, ftp: 250, hrMax: 190, hrRest: 60, runThr: 0 };
  const sk = fromStrava(sum()), L = loadOf(sk, P);
  assert.equal(L.src, 'heart rate'); assert.ok(L.pts > 40 && L.pts < 140, String(L.pts));
  const noHr = fromStrava(sum({ average_heartrate: 0, max_heartrate: 0 }));
  assert.deepEqual(loadOf(noHr, P), { pts: 3500 / 3600 * 45, src: 'duration' });
  assert.equal(loadOf(fromStrava(sum({ sport_type: 'Walk', average_heartrate: 0 })), P).pts, 3500 / 3600 * 25);
  assert.equal(loadOf(fromStrava(sum({ sport_type: 'Ride', average_heartrate: 0, weighted_average_watts: 250, device_watts: true })), P).src, 'power');
  // a long ice skate is not the longest ride, a run with km splits stays the run best
  const ride = { id: 'r1', routeId: 'outdoor', date: S0, duration: 3600, distance: 30000, best20: 260, best5: 300 };
  const longSkate = fromStrava(sum({ distance: 90000 })), run = { id: 'u1', routeId: 'run', sport: 'run', date: S0, duration: 1500, distance: 5000, kmSplits: [300, 300, 300, 300, 300] };
  const B = bests([ride, longSkate, run, fromStrava(sum({ id: 2, sport_type: 'Run', distance: 5000, moving_time: 1200 }))]);
  assert.equal(B.longest.id, 'r1'); assert.equal(B.p20, 260); assert.equal(B.run[5].t, 1500);
  const prof = profileOf({}, [ride, longSkate]); assert.equal(prof.hrSeen, 171); // max HR of the imported summary counts for the heart-rate zones
  const T = totals([ride, longSkate, noHr]); assert.equal(T.skate.n, 2); assert.equal(T.ride.n, 1);
});

test('dedupe: by Strava id, by RIDEFRAME external id, by start + duration; a second import adds nothing', () => {
  const uploaded = { id: 'abc', routeId: 'outdoor', sport: 'ride', date: S0 + 3600e3, duration: 3500, elapsed: 3600, strava: 'https://www.strava.com/activities/900' };
  const watchRun = { id: 'loc1', routeId: 'run', sport: 'run', date: S0 + 86400e3 + 1800e3, duration: 1780, elapsed: 1800 }; // recorded here, also synced by the watch
  const kraft = { id: 'k1', kraft: true, start: S0 + 2 * 86400e3, date: S0 + 2 * 86400e3, dur: 2400 };
  const inc = [
    sum({ id: 900, sport_type: 'Ride' }), // uploaded by RIDEFRAME: id already on the ride
    sum({ id: 901, sport_type: 'Run', start_date: new Date(S0 + 86400e3 + 60e3).toISOString(), elapsed_time: 1790, moving_time: 1760 }), // same run, 1 min later, 0.6 % longer
    sum({ id: 902, sport_type: 'WeightTraining', start_date: new Date(S0 + 2 * 86400e3).toISOString(), elapsed_time: 2400, external_id: 'rideframe-kraft-k1' }),
    sum({ id: 903 }), // new: ice skating
    sum({ id: 904, sport_type: 'Ride', start_date: new Date(S0 + 86400e3 + 30e3).toISOString(), elapsed_time: 1800, moving_time: 1780 }), // same time as the run but a ride: not the same
    sum({ id: 905, sport_type: 'Run', start_date: new Date(S0 + 86400e3).toISOString(), elapsed_time: 2400, moving_time: 2300 }), // same start, 30 % longer: not the same
    sum({ id: 906 }), // deleted here earlier
    sum({ id: 903 }), // the same page twice (overlap)
  ].map(fromStrava);
  const p = plan([uploaded, watchRun, kraft], inc, ['906']);
  assert.deepEqual(p.add.map(r => r.stravaId), ['903', '904', '905']);
  assert.ok(p.add.every(r => !('ext' in r)));
  assert.deepEqual(p.link.map(l => [l.act.id, l.sid]), [['loc1', '901'], ['k1', '902']]);
  // after saving (linked ones carry the id now), the same answer again adds nothing
  const local = [uploaded, { ...watchRun, stravaId: '901' }, { ...kraft, strava: 'https://www.strava.com/activities/902' }, ...p.add];
  const again = plan(local, inc, ['906']); assert.equal(again.add.length, 0); assert.equal(again.link.length, 0);
  // ±5 % and 2 minutes are the edges
  const a = { routeId: 'ext', sportType: 'Swim', start: S0, date: S0 + 2000e3, duration: 2000, elapsed: 2000 };
  assert.ok(sameAct(a, { ...a, start: S0 + 120e3, duration: 2100, elapsed: 2100 }));
  assert.ok(!sameAct(a, { ...a, start: S0 + 121e3 })); assert.ok(!sameAct(a, { ...a, duration: 2120, elapsed: 2120 }));
  assert.ok(sameAct({ routeId: 'pure', date: S0 + 3600e3, duration: 3600 }, fromStrava(sum({ sport_type: 'VirtualRide', elapsed_time: 3610, moving_time: 3600 })))); // indoor here = VirtualRide there
  assert.equal(dupOf([a], { ...a, id: 'x' }), a);
});

test('manual entry and file -> record', () => {
  const r = fromEntry({ sportType: 'Yoga', start: S0, duration: 2700, note: 'Morning flow', avgHr: 92 }, 'manual', 'm1');
  assert.equal(r.source, 'manual'); assert.equal(r.sportType, 'Yoga'); assert.equal(r.workout, 'Yoga'); assert.equal(r.date, S0); assert.equal(r.duration, 2700); assert.equal(r.note, 'Morning flow'); assert.equal(r.avgHr, 92); assert.equal(sportOf(r), 'fit');
});

test('GPX (Garmin, hike with a pause): points, time, HR, distance and climb computed', () => {
  const g = parseGPX(fx('hike.gpx').toString());
  assert.equal(g.sportType, 'Hike'); assert.equal(g.name, 'Morning Hike & Coffee'); assert.equal(g.start, Date.UTC(2026, 10, 16, 7, 30));
  assert.equal(g.samples.length, 120); assert.equal(g.elapsed, 1250); assert.equal(g.duration, 1180); // the 70 s gap is a pause
  assert.ok(Math.abs(g.distance - 1204) < 6, String(g.distance)); assert.equal(g.gain, 58);
  assert.equal(g.maxHr, 124); assert.ok(g.avgHr > 110 && g.avgHr < 124); assert.equal(g.samples[0][4], 55); assert.equal(g.samples[5][6], 47.00045);
  assert.equal(g.avgPower, undefined);
  assert.throws(() => parseGPX('<html></html>'), /not a GPX/);
});

test('TCX (Polar, indoor ride): laps, watts extension, distance from the device', () => {
  const t = parseTCX(fx('ride.tcx').toString());
  assert.equal(t.sportType, 'Ride'); assert.equal(t.start, Date.UTC(2026, 10, 16, 17, 0)); assert.equal(t.samples.length, 180);
  assert.equal(t.duration, 180); assert.equal(t.distance, 1440); assert.equal(t.kcal, 140); assert.equal(t.gain, 16);
  assert.equal(t.avgPower, 230); assert.ok(t.np >= 230 && t.np < 260); assert.equal(t.maxPower, 260); assert.equal(t.samples[100][2], 260); assert.equal(t.samples[3][4], 90); assert.equal(t.samples[3][6], null);
  assert.equal(t.maxHr, 139); assert.equal(t.samples[0][3], 28.8);
});

test('FIT: checksum, ice skating watch file, indoor ride with compressed timestamps, big endian and developer fields', () => {
  assert.equal(crc16(new TextEncoder().encode('123456789')), 0xBB3D); // CRC-16/ARC check value: the FIT SDK checksum
  const f = parseFIT(iceSkateFit());
  assert.equal(f.sportType, 'IceSkate'); assert.equal(f.name, 'Skating'); assert.equal(f.start, Date.UTC(2026, 10, 15, 9, 0));
  assert.equal(f.samples.length, 600); assert.equal(f.duration, 600); assert.equal(f.elapsed, 610); assert.equal(f.distance, 3115); assert.equal(f.gain, 12);
  assert.equal(f.avgHr, 140); assert.equal(f.maxHr, 170); assert.equal(f.kcal, 300);
  assert.ok(Math.abs(f.samples[150][6] - 52.5209) < 1e-4, String(f.samples[150][6])); assert.ok(Math.abs(f.samples[0][7] - 13.4015) < 1e-4); assert.equal(f.samples[0][8], 34); assert.equal(f.samples[0][4], 0); // invalid cadence -> 0
  assert.equal(f.samples[10][3], 18.7); // 5.2 m/s
  const v = parseFIT(virtualRideFit());
  assert.equal(v.sportType, 'VirtualRide'); assert.equal(v.samples.length, 1500); assert.equal(v.samples[1499][0], 1499); assert.equal(v.avgPower, 230); assert.equal(v.best20, 250); assert.ok(v.np > 230);
  assert.equal(v.distance, 13500); assert.equal(v.samples[45][1], 405);
  const bad = iceSkateFit(); bad[400] ^= 0xFF; assert.throws(() => parseFIT(bad), /damaged/);
  assert.throws(() => parseFIT(iceSkateFit().subarray(0, 300)), /incomplete/);
  assert.throws(() => parseFIT(new Uint8Array(20)), /not a FIT/);
  const course = new FitWriter().def(0, 0, [[0, 1, 0]]).data(0, [6]).bytes(); assert.throws(() => parseFIT(course), /no activity/);
  assert.equal(decodeFIT(iceSkateFit()).records.length, 600);
  assert.equal(parseActivity('watch.FIT', iceSkateFit()).sportType, 'IceSkate'); assert.equal(parseActivity('x.gpx', fx('hike.gpx')).sportType, 'Hike'); assert.equal(parseActivity('noext', fx('ride.tcx')).sportType, 'Ride');
  assert.throws(() => parseActivity('a.csv', new TextEncoder().encode('a,b')), /Unknown file type/);
  assert.equal(fitTime(Date.UTC(1989, 11, 31)), 0);
});
