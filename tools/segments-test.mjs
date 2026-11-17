// Segments on the built-in routes: few, never overlapping, a breather between two (Freddy 17.11.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/routes.js';
import { findSegments } from '../js/segments.js';

const tracks = { coast: R.makeCoastTrack() }; for (const k of Object.keys(R.DESIGNED)) tracks[k] = R.makeBuiltinTrack(k);
for (const [id, t] of Object.entries(tracks)) test(`segments of ${id}`, () => {
  const s = findSegments(t);
  assert.ok(s.length >= 2, 'at least two segments: ' + s.length);
  assert.ok(s.length <= Math.max(3, Math.ceil(t.length / 5000)), 'about one per 5 km at most: ' + s.length);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].from >= s[i - 1].to + 399, `${s[i - 1].name} and ${s[i].name} need 400 m between them`);
  assert.equal(s.filter(x => x.kind === 'descent').length, 0, 'no descents');
  for (const x of s) { if (x.kind === 'climb') assert.ok(x.len >= 800); if (x.kind === 'flat') assert.ok(x.len >= 2500 && x.from >= 2000); assert.ok(x.id && x.name); }
  assert.equal(new Set(s.map(x => x.id)).size, s.length, 'unique ids');
});
