// The watch's own segment timing and route following (js/watchfeed.js, the twin of garmin/source/Feed.mc) and the flow's
// route choice (js/watchflow.js RPICK, routeFace, routeNav). Usage: node --test tools/watchfeed-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { SegFeed, RouteTrack, Proj, needSpeed as needW } from '../js/watchfeed.js';
import { needSpeed, deltaTxt } from '../js/navroute.js';
import { newFlow, handle, SCR, setRoutes, setRoute, routeFace, routeNav, routeInfo, recPages, listItems } from '../js/watchflow.js';

const C = [52.5, 13.4], M = 1 / 111195; // ~ degrees per metre north
const north = m => [C[0] + m * M, C[1]], east = (lat, m) => [lat, C[1] + m * M / Math.cos(C[0] * Math.PI / 180)];
// a 2 km segment straight north from C, 41 points
const SEG = { id: '1', n: 'Long drag', len: 2000, pr: 300, kom: 240, p: [...Array(41)].map((_, i) => north(i * 50)) };
const txt = d => (d <= 0 ? '−' : '+') + Math.floor(Math.abs(d) / 60) + ':' + String(Math.abs(d) % 60).padStart(2, '0');

test('segment: warning when close and heading there, start at 25 m, live delta and need like the phone, finish, cooldown', () => {
  const F = new SegFeed(); F.load([SEG, { id: '2', n: 'Far away', len: 500, pr: 0, kom: 0, p: [east(C[0] + .05, 0), east(C[0] + .05, 500)] }], ...north(-800));
  assert.equal(F.n, 2); assert.ok(Math.abs(F.cum[40] - 2000) < 5, 'local metres: ' + F.cum[40]);
  let t = 1000, m = -800, ev = []; const go = (dm, v = 8, h = 0) => { m += dm; const e = F.step(...north(m), h, v, ++t); ev.push(e); return e; };
  for (let i = 0; i < 50 && m < -380; i++) assert.equal(go(8), null, 'far: nothing at ' + m);
  let w = null; for (let i = 0; i < 10 && !w; i++) w = go(8); assert.equal(w.k, 'warn', 'under 45 s away'); assert.ok(m > -380 && m < -300, 'at ' + m); assert.equal(w.name, 'Long drag'); assert.equal(w.pr, 300); assert.ok(Math.abs(w.eta - -m / 8) <= 1, 'eta ' + w.eta);
  const G = new SegFeed(); G.load([SEG], ...north(-250)); G.step(...north(-250), 180, 8, 1); assert.equal(G.step(...north(-245), 180, 8, 2), null, 'heading away from the start: no warning');
  const H = new SegFeed(); H.load([SEG], ...north(-250)); H.step(...north(-250), -1, 1, 1); assert.equal(H.step(...north(-249), -1, 1, 2), null, 'no heading yet: no warning');
  while (m < -40) assert.equal(go(8).k, 'warn');
  let s = go(8); assert.equal(s.k, 'warn', 'not yet at 25 m: ' + m); s = go(8); assert.equal(s.k, 'live', 'started within 25 m: ' + m); assert.equal(s.time, 0); assert.equal(s.ref, 'PR');
  assert.ok(Math.abs(s.need - 2000 / 300) < .01, 'need at the start: 2000 m in 300 s');
  for (let i = 0; i < 100; i++) s = go(7.2);
  const el = s.time, prog = s.done / 2000; assert.equal(el, 100); assert.ok(Math.abs(s.done - (m - 0)) < 3, `done ${s.done} at ${m}`);
  assert.equal(txt(s.delta), deltaTxt(el, 300, prog), 'delta exactly like navroute.deltaTxt'); assert.ok(Math.abs(s.need - needSpeed(2000, el, 300, prog)) < 1e-9, 'need exactly like navroute.needSpeed');
  assert.equal(needW(2000, 400, 300, .5), 0, 'out of reach: 0 (navroute: null)'); assert.equal(needSpeed(2000, 400, 300, .5), null);
  while (m < 1960) { s = go(8); assert.equal(s.k, 'live'); }
  let e = null; for (let i = 0; i < 6 && (!e || e.k !== 'end'); i++) e = go(8); assert.equal(e.k, 'end'); assert.ok(e.time < 300 && e.pr === true && e.delta === e.time - 300, JSON.stringify(e));
  assert.equal(go(8), null, 'after the finish: nothing');
  const K = new SegFeed(); K.load([SEG], ...north(-100)); K.step(...north(-10), 0, 5, 50); // start, then turn back south and away
  assert.equal(K.coolId.length, 0); K.load([SEG], ...north(-100)); K.coolId = ['1']; K.coolAt = [40]; assert.equal(K.step(...north(-10), 0, 5, 100), null, 'cooling down 120 s after a finish');
});
test('segment: lost after more than 10 s more than 60 m off; KOM when there is no PR; no reference', () => {
  const F = new SegFeed(), noPr = { ...SEG, pr: 0 }; F.load([noPr], ...north(-20)); let t = 0;
  let s = F.step(...north(-10), 0, 5, ++t); assert.equal(s.k, 'live'); assert.equal(s.ref, 'KOM'); assert.ok(s.need > 0);
  for (let m = 0; m < 300; m += 6) s = F.step(...north(m), 0, 6, ++t); assert.equal(s.k, 'live');
  const out = east(C[0] + 300 * M, 100); for (let i = 0; i <= 10; i++) { s = F.step(...out, 90, 6, ++t); assert.equal(s.k, 'live', 'still on it at ' + i + ' s off'); }
  s = F.step(...out, 90, 6, ++t); assert.deepEqual(s, { k: 'none', lost: true }, 'lost after 10 s');
  const N = new SegFeed(); N.load([{ ...SEG, pr: 0, kom: 0 }], ...north(-20)); s = N.step(...north(-5), 0, 5, 1); assert.equal(s.ref, ''); assert.equal(s.need, 0); assert.equal(s.delta, 0);
  const W = new SegFeed(); W.load([SEG], ...north(-200)); W.step(...north(-200), 0, 8, 1); assert.equal(W.step(...north(-190), 0, 8, 2).k, 'warn');
  assert.deepEqual(W.step(...east(C[0] - 190 * M, 400), 90, 8, 3), { k: 'none' }, 'turned away: the warning goes'); assert.equal(W.step(...east(C[0] - 190 * M, 420), 90, 8, 4), null);
});
test('route: along, distance left, off route after 8 s, back on; the box matches routeFace', () => {
  const p = [...[...Array(21)].map((_, i) => north(i * 50)), ...[...Array(20)].map((_, i) => east(C[0] + 1000 * M, (i + 1) * 50))]; // 1 km north, then 1 km east
  const r = { id: 'r1', name: 'L route', dist: 2000, p, turns: [[1000, 'R']] }, T = new RouteTrack(r), face = routeFace(r);
  assert.ok(Math.abs(T.len - 2000) < 5); assert.ok(Math.abs(face.len - 2000) < 1); assert.deepEqual(face.turns, [{ at: 1000, dir: 'R', txt: 'Turn right' }]);
  for (const i of [0, 20, 40]) { const q = T.uv(T.xs[i], T.ys[i]); assert.ok(Math.abs(q[0] - face.pts[i][0]) < 1e-9 && Math.abs(q[1] - face.pts[i][1]) < 1e-9, 'same box as the preview'); }
  assert.ok(face.pts[0][1] > face.pts[20][1], 'north is up'); assert.ok(face.pts.every(([u, v]) => u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9));
  let t = 0, s; for (let m = 0; m <= 600; m += 20) s = T.step(...north(m), ++t); assert.ok(Math.abs(s.along - 600) < 2 && s.off === 0, JSON.stringify(s));
  for (let i = 0; i < 8; i++) { s = T.step(...east(C[0] + 600 * M, 120), ++t); } assert.equal(s.off, 0, 'not yet 8 s'); s = T.step(...east(C[0] + 600 * M, 120), ++t); s = T.step(...east(C[0] + 600 * M, 120), ++t); assert.ok(s.off >= 115 && s.off <= 125, 'off route: ' + s.off); assert.ok(Math.abs(s.along - 600) < 2, 'along stays');
  s = T.step(...north(650), ++t); assert.equal(s.off, 0, 'back on'); for (let m = 50; m <= 900; m += 50) s = T.step(...east(C[0] + 1000 * M, m), ++t); assert.ok(Math.abs(s.along - 1900) < 3, 'second leg: ' + s.along);
  const O = new RouteTrack({ p: [north(0), north(500), north(0)] }); let u; for (let m = 0; m <= 500; m += 25) u = O.step(...north(m), m); for (let m = 475; m >= 100; m -= 25) u = O.step(...north(m), 1000 - m);
  assert.ok(Math.abs(u.along - 900) < 3, 'out and back: the way back counts on: ' + u.along);
});
test('flow: ready -> Route list (None + the phone\'s routes), choose loads it, route page follows the watch\'s own position', () => {
  const F = newFlow({ ex: [] }, { id: () => 'x' }); handle(F, 'start', 1); assert.equal(F.scr, SCR.READY); assert.deepEqual(F.out.splice(0), [{ k: 'routes' }], 'the ready screen asks for the list');
  handle(F, 'down', 2); assert.equal(F.scr, SCR.RPICK); assert.deepEqual(listItems(F), ['None']); assert.deepEqual(F.out.splice(0), [{ k: 'routes' }]);
  setRoutes(F, [{ id: 'r1', name: 'L route', dist: 2000, climb: 5 }, { id: 'r2', name: 'Lake', dist: 9000, climb: 40 }, { name: 'no id' }]); assert.deepEqual(listItems(F), ['None', 'L route', 'Lake']);
  handle(F, 'down', 3); handle(F, 'start', 4); assert.equal(F.scr, SCR.READY); assert.equal(F.routeId, 'r1'); assert.deepEqual(F.out.splice(0), [{ k: 'route', id: 'r1' }]);
  const p = [...[...Array(21)].map((_, i) => north(i * 50)), ...[...Array(20)].map((_, i) => east(C[0] + 1000 * M, (i + 1) * 50))];
  setRoute(F, routeFace({ id: 'r1', name: 'L route', dist: 2000, p, turns: [[1000, 'R']] })); assert.equal(F.route.name, 'L route');
  handle(F, 'up', 5); assert.equal(F.scr, SCR.RPICK); assert.equal(F.sel, 1, 'the chosen route is selected'); handle(F, 'back', 6); assert.equal(F.scr, SCR.READY); assert.equal(F.routeId, 'r1');
  handle(F, 'start', 7); assert.equal(F.scr, SCR.REC); assert.equal(recPages(F).at(-1), 'route');
  routeNav(F, 400, 0); let ri = routeInfo(F); assert.ok(Math.abs(ri.left - 1600) < 1e-6 && ri.turn.dir === 'R' && Math.abs(ri.turn.in - 600) < 1e-6 && ri.off === 0, JSON.stringify(ri));
  routeNav(F, 400, 87); ri = routeInfo(F); assert.equal(ri.off, 87); assert.equal(ri.turn, null, 'off route: no turn hint');
  const G = newFlow({ ex: [] }, { id: () => 'x' }); handle(G, 'start', 1); setRoutes(G, [{ id: 'r1', name: 'L route' }]); handle(G, 'down', 2); handle(G, 'down', 3); handle(G, 'start', 4); G.out = [];
  setRoute(G, routeFace({ id: 'r1', p, turns: [] })); handle(G, 'down', 5); handle(G, 'up', 6); handle(G, 'start', 7); assert.equal(G.route, null, 'None: no route'); assert.equal(G.routeId, null); assert.deepEqual(G.out, []);
  const H = newFlow({ ex: [] }, { id: () => 'x', last: 'more', cfg: undefined }); H.out = []; handle(H, 'start', 1); handle(H, 'start', 2); assert.equal(H.scr, SCR.READY); assert.deepEqual(H.out, [], 'other sports: no routes'); handle(H, 'down', 3); assert.equal(H.scr, SCR.READY);
  assert.equal(routeFace({ p: [[1, 2]] }), null);
});
test('flow: the tracker\'s none takes the warning or a lost segment away, a result stays its 5 s', () => {
  const F = newFlow({ ex: [] }, { id: () => 'x' }); handle(F, 'start', 1); handle(F, 'start', 2);
  handle(F, 'seg', 3, { k: 'warn', name: 'a', len: 1, eta: 9 }); assert.equal(F.seg.k, 'warn'); handle(F, 'seg', 4, { k: 'none' }); assert.equal(F.seg, null);
  handle(F, 'seg', 5, { k: 'end', name: 'a', len: 1, time: 9, delta: -1, pr: true, ref: 'PR' }); handle(F, 'seg', 6, { k: 'none' }); assert.equal(F.seg.k, 'end');
});
void Proj;
