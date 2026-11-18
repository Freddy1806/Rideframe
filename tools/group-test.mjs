// group.js: the host drops riders who stopped sending (no ghosts after Discard / reload), never someone waiting in the lobby
import test from 'node:test'; import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.sessionStorage = globalThis.localStorage;
const { Group } = await import('../js/group.js');
const host = () => Object.assign(Object.create(Group.prototype), { host: true, me: { id: 'host', name: 'A' }, riders: new Map(), conns: [], lastD: new Map() });
test('a rider who rode and went silent leaves after 10 s; the lobby stays', () => {
  const g = host(), sent = [], c = { open: true, send: m => sent.push(m) }; g.conns.push(c);
  g._recv({ t: 'hello', r: { id: 'lobby', name: 'L' } }, {}); g._recv({ t: 'state', r: { id: 'b1', name: 'B', d: 500, w: 200, riding: true } }, {});
  g._relayAll(); assert.deepEqual(sent.at(-1).list.map(r => r.id), ['host', 'lobby', 'b1']);
  for (const r of g.riders.values()) r.seen -= 11000;
  let changed = 0; g.onChange = () => changed++;
  g._relayAll(); assert.deepEqual(sent.at(-1).list.map(r => r.id), ['host', 'lobby']); assert.equal(changed, 1);
  g._recv({ t: 'state', r: { id: 'b1', name: 'B', d: 520, w: 190, riding: true } }, {}); g._relayAll();
  assert.deepEqual(sent.at(-1).list.map(r => r.id), ['host', 'lobby', 'b1'], 'his next state brings him back');
});
