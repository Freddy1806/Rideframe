// Routes to follow outdoors (js/navroute.js): route files, simplification, progress (out-and-back, a route crossing itself),
// off route, turn hints, the next segment ahead, PR delta, KOM text. Usage: node --test tools/route-test.mjs   (no browser, no network)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, simplify, makeRoute, RouteNav, SegAhead, turnsOf, turnText, deltaTxt, xomSec, dist, bearing } from '../js/navroute.js';
import { FitWriter } from './fitenc.mjs';

const O = [48.1, 11.5], k = Math.cos(O[0] * Math.PI / 180), M = 111195;
const P = (x, y, e = null) => [O[0] + y / M, O[1] + x / (M * k), e]; // metres east / north of O
const line = (pts, step = 10) => { const out = []; for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  for (let j = 0; j < n; j++) out.push(P(a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n, a[2] != null ? a[2] + (b[2] - a[2]) * j / n : null)); } const l = pts[pts.length - 1]; out.push(P(l[0], l[1], l[2])); return out; };
const gpx = (kind, pts, name = 'Test') => `<?xml version="1.0"?><gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1">${kind === 'rte' ? `<rte><name>${name}</name>${pts.map(p => `<rtept lat="${p[0]}" lon="${p[1]}"><ele>${p[2]}</ele></rtept>`).join('')}</rte>`
  : `<metadata><name>Meta</name></metadata><trk><name>${name}</name><trkseg>${pts.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}">${p[2] != null ? `<ele>${p[2]}</ele>` : ''}</trkpt>`).join('\n')}</trkseg></trk>`}</gpx>`;

test('GPX route (rte/rtept) and track (trk/trkpt), no timestamps needed', () => {
  const pts = line([[0, 0, 100], [1000, 0, 150], [1000, 1000, 120]], 50);
  const r = parseRoute('Komoot_Tour.gpx', gpx('rte', pts, 'Alpine &amp; Lakes')); assert.equal(r.name, 'Alpine & Lakes'); assert.equal(r.pts.length, pts.length); assert.equal(r.pts[0][2], 100);
  const t = parseRoute('my_track.gpx', gpx('trk', pts, 'Evening loop')); assert.equal(t.name, 'Evening loop'); assert.equal(t.pts.length, pts.length);
  const u = parseRoute('my_track.gpx', gpx('trk', pts, '').replace('<name></name>', '')); assert.equal(u.name, 'Meta');
  const rt = makeRoute(r.name, r.pts); assert.ok(Math.abs(rt.len - 2000) < 5, 'length ' + rt.len); assert.equal(rt.climb, 50);
  assert.throws(() => parseRoute('x.gpx', '<gpx></gpx>'), /No route/); assert.throws(() => parseRoute('x.txt', 'hello'), /Unknown file type/);
});

test('TCX course and FIT course without timestamps', () => {
  const pts = line([[0, 0, 10], [500, 0, 20]], 25);
  const tcx = `<?xml version="1.0"?><TrainingCenterDatabase><Courses><Course><Name>River</Name><Track>${pts.map(p => `<Trackpoint><Position><LatitudeDegrees>${p[0]}</LatitudeDegrees><LongitudeDegrees>${p[1]}</LongitudeDegrees></Position><AltitudeMeters>${p[2]}</AltitudeMeters></Trackpoint>`).join('')}</Track></Course></Courses></TrainingCenterDatabase>`;
  const r = parseRoute('river.tcx', tcx); assert.equal(r.name, 'River'); assert.equal(r.pts.length, pts.length);
  const w = new FitWriter(), sc = 2 ** 31 / 180; w.def(0, 0, [[0, 1, 0]]).data(0, [6]); // file_id: course
  w.def(1, 20, [[0, 4, 0x85], [1, 4, 0x85], [2, 2, 0x84]]); for (const p of pts) w.data(1, [Math.round(p[0] * sc), Math.round(p[1] * sc), Math.round((p[2] + 500) * 5)]);
  const f = parseRoute('Garmin course.fit', w.bytes()); assert.equal(f.pts.length, pts.length); assert.ok(Math.abs(f.pts[3][0] - pts[3][0]) < 1e-6); assert.ok(Math.abs(f.pts[3][2] - pts[3][2]) < .3); assert.equal(f.name, 'Garmin course');
});

test('simplify: at most 2000 points, start and end kept, shape within a few metres', () => {
  const pts = []; for (let i = 0; i <= 20000; i++) { const a = i / 20000 * Math.PI * 6; pts.push(P(Math.cos(a) * 3000 + i * .5, Math.sin(a) * 3000 + Math.sin(i / 7) * 2)); } // wiggly spiral
  const s = simplify(pts); assert.ok(s.length <= 2000 && s.length > 200, 'points ' + s.length); assert.deepEqual(s[0], pts[0]); assert.deepEqual(s[s.length - 1], pts[pts.length - 1]);
  const straight = simplify(line([[0, 0], [5000, 0]], 5)); assert.equal(straight.length, 2);
  const rt = makeRoute('x', pts); assert.ok(rt.pts.length <= 2000);
});

test('progress along a route shrinks the distance left and the climb left', () => {
  const rt = makeRoute('r', line([[0, 0, 0], [2000, 0, 100], [2000, 2000, 100]], 20)), nav = new RouteNav(rt);
  assert.ok(Math.abs(nav.len - 4000) < 5); assert.equal(nav.climb, 100);
  let t = 0, last = Infinity, lastC = Infinity;
  for (let x = 0; x <= 2000; x += 100) { const s = nav.update(P(x, 6), t += 15); assert.ok(s.left <= last + .1); assert.ok(s.climbLeft <= lastC + .1); last = s.left; lastC = s.climbLeft; assert.equal(s.off, false); }
  assert.ok(Math.abs(last - 2000) < 10, 'left ' + last); assert.ok(lastC < 2, 'climb left ' + lastC);
});

test('out-and-back: the way back counts on, it does not jump to the way out', () => {
  const rt = makeRoute('oab', line([[0, 0], [3000, 0], [0, 0]], 30)), nav = new RouteNav(rt); let t = 0, s;
  for (let x = 0; x <= 3000; x += 50) s = nav.update(P(x, 3), t += 7);
  assert.ok(Math.abs(s.along - 3000) < 30, 'turnaround ' + s.along);
  for (let x = 2950; x >= 1000; x -= 50) s = nav.update(P(x, -3), t += 7);
  assert.ok(Math.abs(s.along - 5000) < 30, 'way back ' + s.along); assert.ok(Math.abs(s.left - 1000) < 30);
  for (let x = 950; x >= 0; x -= 50) s = nav.update(P(x, -3), t += 7);
  assert.equal(s.done, true); assert.ok(s.events.includes('complete') || nav.done);
  const fresh = new RouteNav(rt); assert.ok(fresh.update(P(10, 0), 0).along < 50, 'a fresh start matches the way out, not the end');
});

test('a route that crosses itself (figure eight): progress stays on the current pass', () => {
  const rt = makeRoute('8', line([[0, 0], [1000, 1000], [1000, 0], [0, 1000], [0, 0]], 20)), nav = new RouteNav(rt); let t = 0, s;
  for (let i = 0; i <= 10; i++) s = nav.update(P(i * 100, i * 100), t += 5);
  for (let i = 1; i <= 10; i++) s = nav.update(P(1000, 1000 - i * 100), t += 5);
  const before = s.along; for (let i = 1; i <= 5; i++) s = nav.update(P(1000 - i * 100, i * 100), t += 5); // through the crossing at (500, 500)
  assert.ok(s.along > before + 600, 'second pass ' + s.along + ' vs ' + before); assert.ok(Math.abs(s.along - (1414.2 + 1000 + 707.1)) < 30);
  const loop = makeRoute('loop', line([[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]], 20)), ln = new RouteNav(loop);
  const st = ln.update(P(0, 2), 0); assert.ok(st.along < 20 && !st.done, 'a loop starts at its start, not its end');
});

test('off route only after > 40 m for > 8 s, with the bearing back; rejoining clears it', () => {
  const rt = makeRoute('r', line([[0, 0], [2000, 0]], 20)), nav = new RouteNav(rt); let s = nav.update(P(0, 0), 0);
  s = nav.update(P(100, 30), 10); assert.equal(s.off, false); // 30 m: still on
  s = nav.update(P(200, 120), 20); assert.equal(s.off, false, 'not yet: just left');
  s = nav.update(P(250, 120), 25); assert.equal(s.off, false, '5 s');
  s = nav.update(P(300, 120), 29); assert.equal(s.off, true); assert.ok(s.events.includes('off')); assert.ok(Math.abs(s.offD - 120) < 3, 'offD ' + s.offD);
  assert.ok(Math.abs(s.back - 180) < 3, 'back to the south: ' + s.back);
  s = nav.update(P(320, 5), 33); assert.equal(s.off, false); assert.ok(s.events.includes('on')); assert.ok(Math.abs(s.along - 320) < 3);
});

test('turn hints from the geometry: left / right / U-turn, one per corner, gentle bends ignored', () => {
  const rt = makeRoute('t', line([[0, 0], [500, 0], [500, 500], [0, 500], [0, 620]], 10)); // E, then N (left), then W (left), then N (right)
  const tt = turnsOf(rt.pts); assert.deepEqual(tt.map(x => x.dir), ['left', 'left', 'right']); assert.ok(Math.abs(tt[0].at - 500) < 15 && Math.abs(tt[1].at - 1000) < 15);
  const bend = []; for (let i = 0; i <= 100; i++) { const a = i / 100 * Math.PI / 4; bend.push(P(Math.sin(a) * 3000, 3000 - Math.cos(a) * 3000)); } assert.equal(turnsOf(simplify(bend)).length, 0, '45 deg over 2.4 km is no turn');
  const ut = turnsOf(makeRoute('u', line([[0, 0], [500, 0], [0, 2]], 10)).pts); assert.equal(ut.length, 1); assert.equal(ut[0].dir, 'uturn');
  const nav = new RouteNav(rt); nav.update(P(0, 0), 0); let s = nav.update(P(250, 0), 30); assert.equal(s.turn, null);
  s = nav.update(P(350, 0), 40); assert.equal(s.turn.dir, 'left'); assert.equal(s.turn.text, 'Turn left in 150 m'); assert.ok(s.events.includes('turn'));
  s = nav.update(P(360, 0), 41); assert.ok(!s.events.includes('turn'), 'told once'); s = nav.update(P(490, 0), 55); assert.equal(s.turn.text, 'Turn left now');
  assert.equal(turnText({ dir: 'right' }, 87), 'Turn right in 90 m');
});

const seg = (id, pts, x = {}) => ({ id, name: 'Seg ' + id, pts, ...x });
test('segment ahead along the route: ETA under 45 s warns, the countdown shrinks, a start behind is ignored', () => {
  const rt = makeRoute('r', line([[0, 0], [3000, 0]], 20)), nav = new RouteNav(rt), a = new SegAhead();
  const s1 = seg(1, line([[1000, 0], [1500, 0]], 50)), back = seg(2, line([[1500, 0], [1000, 0]], 50)), off = seg(3, line([[1000, 400], [1500, 400]], 50));
  nav.update(P(0, 0), 0); let w = a.update([s1, back, off], P(500, 0), 90, 10, (nav.update(P(500, 0), 50), nav)); assert.equal(w, null, '500 m at 10 m/s = 50 s: not yet');
  nav.update(P(600, 0), 60); w = a.update([s1, back, off], P(600, 0), 90, 10, nav); assert.equal(w.seg.id, 1); assert.equal(w.via, 'route'); assert.ok(Math.abs(w.eta - 40) <= 1); assert.ok(Math.abs(w.d - 400) < 3);
  nav.update(P(900, 0), 90); w = a.update([s1, back, off], P(900, 0), 90, 10, nav); assert.ok(Math.abs(w.eta - 10) <= 1);
  nav.update(P(1600, 0), 160); w = a.update([s1, back, off], P(1600, 0), 90, 10, nav); assert.equal(w, null, 'passed: nothing ahead');
  const slow = new SegAhead(), n2 = new RouteNav(rt); n2.update(P(0, 0), 0); n2.update(P(750, 0), 500); w = slow.update([s1], P(750, 0), 90, 1.5, n2); assert.ok(w && w.d === 250, 'slow: under 300 m warns although the ETA is long');
});

test('segment ahead without a route: straight line while closing in and heading towards it', () => {
  const a = new SegAhead(), s1 = seg(1, line([[0, 300], [0, 800]], 50));
  assert.equal(a.update([s1], P(0, 0), 0, 8, null), null, 'first fix: is it closing in? not known yet');
  let w = a.update([s1], P(0, 20), 0, 8, null); assert.equal(w.seg.id, 1); assert.equal(w.via, 'line'); assert.equal(w.d, 280); assert.equal(w.eta, 35);
  w = a.update([s1], P(0, 40), 180, 8, null); assert.equal(w, null, 'heading away');
  w = a.update([s1], P(0, 30), 0, 8, null); assert.equal(w, null, 'distance grew');
  w = a.update([s1], P(0, 60), 0, 8, null, s => s.id === 1); assert.equal(w, null, 'skipped (cooling down / active)');
});

test('PR delta and KOM text', () => {
  assert.equal(deltaTxt(60, 161, .5), '−0:20'); assert.equal(deltaTxt(87, 160, .5), '+0:07'); assert.equal(deltaTxt(80, 160, .5), '−0:00');
  assert.equal(xomSec('5:17'), 317); assert.equal(xomSec('1:02:03'), 3723); assert.equal(xomSec('37s'), 37); assert.equal(xomSec('n/a'), null); assert.equal(xomSec(null), null);
  assert.ok(Math.abs(dist(P(0, 0), P(300, 400)) - 500) < 1); assert.ok(Math.abs(bearing(P(0, 0), P(100, 0)) - 90) < .5);
});
