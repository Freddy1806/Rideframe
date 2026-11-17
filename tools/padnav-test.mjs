// Menu navigation by gamepad / arrow keys (js/padnav.js): which control is next in a direction, key repeat, stick hysteresis.
// Usage: node --test tools/padnav-test.mjs   (no browser)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickInDir, isCandidate, repeater, stickDir } from '../js/padnav.js';
import { NINTENDO, padButtons } from '../js/controller.js';

const R = (x, y, w = 100, h = 40) => ({ left: x, top: y, right: x + w, bottom: y + h });

test('a 3 × 2 grid: every direction goes to the neighbour, edges stay put', () => {
  const g = [R(0, 0), R(120, 0), R(240, 0), R(0, 60), R(120, 60), R(240, 60)];
  const at = (i, d) => pickInDir(g[i], g, d);
  assert.equal(at(0, 'right'), 1); assert.equal(at(1, 'right'), 2); assert.equal(at(2, 'right'), -1);
  assert.equal(at(1, 'left'), 0); assert.equal(at(0, 'left'), -1);
  assert.equal(at(1, 'down'), 4); assert.equal(at(4, 'up'), 1); assert.equal(at(4, 'down'), -1); assert.equal(at(0, 'up'), -1);
});

test('right at the end of a row stays put instead of jumping to a far row', () => {
  const src = R(800, 400, 300, 300), pill = R(1150, 10, 80, 30), next = R(1150, 690, 80, 40);
  assert.equal(pickInDir(src, [src, pill], 'right'), -1);
  assert.equal(pickInDir(src, [src, pill, next], 'right'), 2, 'a control just past the row still counts');
});

test('left / right keep to the same row even when a diagonal one is nearer', () => {
  const src = R(0, 0), far = R(600, 0), diag = R(110, 50);
  assert.equal(pickInDir(src, [src, far, diag], 'right'), 1);
});

test('down prefers the control below in the same column over a nearer one off to the side', () => {
  const src = R(0, 0, 100, 40), below = R(10, 120), side = R(300, 60);
  assert.equal(pickInDir(src, [src, below, side], 'down'), 1);
});

test('down from a narrow tab reaches a wide card that is not straight below its centre line', () => {
  const tab = R(300, 0, 80, 40), card = R(0, 100, 800, 300), btn = R(900, 60, 100, 40);
  assert.equal(pickInDir(tab, [tab, card, btn], 'down'), 1);
});

test('without overlap the nearest in the direction wins (distance along the direction weighs 13 ×)', () => {
  const src = R(0, 0), a = R(200, 300), b = R(500, 120);
  assert.equal(pickInDir(src, [src, a, b], 'down'), 2);
  const c = R(150, 60), d = R(130, 400);
  assert.equal(pickInDir(src, [src, c, d], 'down'), 1);
});

test('containing or overlapping boxes are not "in" a direction', () => {
  assert.equal(isCandidate(R(0, 0, 100, 100), R(10, 10, 50, 50), 'right'), false);
  assert.equal(isCandidate(R(0, 0), R(50, 0), 'right'), true);
  assert.equal(isCandidate(R(0, 0), R(50, 0), 'left'), false);
  assert.equal(isCandidate(R(0, 0, 100, 40), R(400, 6, 100, 40), 'down'), false, 'same row, 6 px lower: not below');
  assert.equal(isCandidate(R(0, 0, 100, 40), R(400, 6, 100, 40), 'right'), true);
});

test('key repeat: fires on press, after 350 ms, then every 120 ms; release resets', () => {
  const r = repeater(350, 120), fired = [];
  for (let t = 0; t <= 700; t += 10) if (r(true, t)) fired.push(t);
  assert.deepEqual(fired, [0, 350, 470, 590]);
  assert.equal(r(false, 710), false); assert.equal(r(true, 720), true); assert.equal(r(true, 730), false);
});

test('stick: on beyond 0.6, held until under 0.35, dominant axis picks the direction', () => {
  assert.equal(stickDir(0.5, 0, null), null);
  assert.equal(stickDir(0.7, 0, null), 'right');
  assert.equal(stickDir(0.4, 0, 'right'), 'right');
  assert.equal(stickDir(0.3, 0, 'right'), null);
  assert.equal(stickDir(-0.2, -0.9, null), 'up');
  assert.equal(stickDir(0.1, 0.8, null), 'down');
  assert.equal(stickDir(-0.8, 0.1, null), 'left');
});

test('A / B swap only for pads that report as a Switch controller (8BitDo in "D" is taken as it comes)', () => {
  const pad = (id, pressed, mapping = 'standard') => ({ id, mapping, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === pressed })) });
  assert.equal(NINTENDO('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'), true);
  assert.equal(NINTENDO('Joy-Con (L/R)'), true);
  assert.equal(NINTENDO('8BitDo Micro gamepad (Vendor: 2dc8 Product: 9020)'), false);
  assert.equal(NINTENDO('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)'), false);
  assert.equal(padButtons(pad('Pro Controller (Vendor: 057e)', 1))[0], true, 'Switch layout: bottom-right index 1 is the printed A');
  assert.equal(padButtons(pad('8BitDo Micro gamepad (Vendor: 2dc8)', 0, ''))[0], true, '8BitDo in D: raw 0 is A');
  assert.equal(padButtons(pad('8BitDo Micro gamepad (Vendor: 2dc8)', 11, ''))[9], true, '8BitDo in D: raw 11 is Start');
  assert.equal(padButtons({ id: '8BitDo', mapping: '', axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1], buttons: [] })[12], true, 'hat up is D-pad up');
});
