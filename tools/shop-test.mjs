// The shop (js/shop.js): catalogue, buy / not enough / double buy, wear / take off, your own look only with what you own,
// cleanLook with the new and unknown values (old saves stay valid, the default look is unchanged, randomLook never picks a
// shop item), and the wallet sync: the merge rule and a real serve.mjs with a temp data folder (story PUT / GET, old
// clients' payloads, the leaderboard's one number). Usage: node --test tools/shop-test.mjs   (no real data is touched)
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { CATALOG, SLOTS, itemById, itemFor, itemState, buy, equip, unequip, ownedLook, equipOf, applyEquip, OFF } from '../js/shop.js';
import { OPTIONS, DEFAULT_LOOK, cleanLook, randomLook } from '../js/look.js';
import { mergeWallet, cleanWallet, balanceOf } from '../js/wizpoints.js';

const wallet = (earned = 0, spent = 0, owned = []) => ({ earned, spent, owned: [...owned], v: 1 });

test('catalogue: the first twelve items with id, name, slot, price, description; every one is a look value', () => {
  const want = { 'wizard-hat': 500, 'eagle-feather': 300, crown: 2500, 'star-jersey': 800, 'wizard-cloak': 1200, 'eagle-jersey': 900, 'knight-armour': 1000,
    'wooden-bike': 1500, 'glow-wheels': 1200, 'dragon-frame': 4000, 'golden-bike': 5000, 'wizard-gloves': 400 };
  assert.deepEqual(Object.fromEntries(CATALOG.map(i => [i.id, i.price])), want);
  for (const i of CATALOG) {
    assert.ok(i.name && i.desc && SLOTS.some(([s]) => s === i.slot), i.id);
    const o = OPTIONS[i.key]?.find(x => x[0] === i.value); assert.ok(o && o[2] === 1, `${i.id}: ${i.key}=${i.value} is a marked shop option`);
    assert.equal(itemFor(i.key, i.value), i);
  }
  for (const [k, opts] of Object.entries(OPTIONS)) for (const o of opts) if (o[2]) assert.ok(itemFor(k, o[0]), `marked option ${k}=${o[0]} is sold`);
  assert.equal(new Set(CATALOG.map(i => i.id)).size, CATALOG.length);
});

test('buy: deducts and owns; not enough points says how many are missing; never twice', () => {
  const w = wallet(800, 100);
  assert.deepEqual(itemState(itemById('wizard-hat'), w, DEFAULT_LOOK), { state: 'buy' });
  assert.deepEqual(itemState(itemById('crown'), w, DEFAULT_LOOK), { state: 'short', missing: 1800 });
  const r = buy(w, 'wizard-hat'); assert.ok(r.ok); assert.equal(w.spent, 600); assert.deepEqual(w.owned, ['wizard-hat']); assert.equal(balanceOf(w), 200);
  assert.deepEqual(buy(w, 'wizard-hat'), { ok: false, error: 'owned' }); assert.equal(w.spent, 600, 'double buy costs nothing');
  const s = buy(w, 'eagle-feather'); assert.deepEqual(s, { ok: false, error: 'short', missing: 100 }); assert.equal(w.spent, 600); assert.deepEqual(w.owned, ['wizard-hat']);
  assert.equal(buy(w, 'nope').ok, false);
  assert.equal(buy(wallet(0, 0), 'wizard-gloves').ok, false); assert.ok(buy({ ...wallet(0, 0), grant: 400 }, 'wizard-gloves').ok, 'the ?wp test grant counts');
});

test('wear and take off: owned only; items of different keys combine; take off = the free default', () => {
  const w = wallet(9999, 0, ['wizard-hat', 'wizard-cloak', 'star-jersey', 'dragon-frame', 'glow-wheels']);
  let l = equip(DEFAULT_LOOK, w, 'wizard-hat'); assert.equal(l.helmet, 'zauberhut'); assert.deepEqual(itemState(itemById('wizard-hat'), w, l), { state: 'wearing' });
  l = equip(l, w, 'wizard-cloak'); l = equip(l, w, 'star-jersey'); l = equip(l, w, 'dragon-frame'); l = equip(l, w, 'glow-wheels');
  assert.deepEqual([l.helmet, l.cape, l.outfit, l.bike, l.wheels], ['zauberhut', 'zauber', 'sterne', 'drache', 'glow']);
  assert.equal(equip(l, w, 'crown'), l, 'not owned: nothing changes'); assert.equal(equip(l, w, 'nope'), l);
  l = unequip(l, 'wizard-hat'); assert.equal(l.helmet, OFF.helmet); assert.deepEqual(itemState(itemById('wizard-hat'), w, l), { state: 'owned' });
  assert.equal(unequip(l, 'crown'), l, 'taking off what you do not wear changes nothing');
  assert.deepEqual(equipOf(l), { cape: 'zauber', outfit: 'sterne', bike: 'drache', wheels: 'glow' });
});

test('your own look keeps only what you own; a new device gets the worn items back', () => {
  const l = { ...DEFAULT_LOOK, helmet: 'krone', outfit: 'ritter', bike: 'gold', gloves: 'zauber', feather: 'adler' };
  assert.deepEqual(equipOf(ownedLook(l, wallet(0, 0, ['knight-armour']))), { outfit: 'ritter' });
  assert.deepEqual(ownedLook(l, wallet(0, 0, CATALOG.map(i => i.id))), l);
  assert.equal(ownedLook({ ...DEFAULT_LOOK, helmet: 'cap' }, wallet()).helmet, 'cap', 'free choices stay');
  assert.deepEqual(equipOf(applyEquip(DEFAULT_LOOK, { helmet: 'krone', bike: 'gold', evil: 'x', outfit: 'team' }, wallet(0, 0, ['crown']))), { helmet: 'krone' });
});

test('cleanLook: new values pass, unknown ones fall back, old saves stay valid, default unchanged', () => {
  const D = cleanLook(DEFAULT_LOOK);
  assert.deepEqual(D, DEFAULT_LOOK, 'the default look passes unchanged'); assert.deepEqual([D.helmet, D.outfit, D.feather, D.cape, D.bike, D.wheels, D.gloves], ['aero', 'team', 'none', 'none', 'standard', 'standard', 'standard']);
  const old = { body: 'f', height: 1.05, build: 0.2, skin: 3, hair: 'zopf', hairColor: 4, beard: 'none', glasses: 'retro', outfit: 'dino', c1: 2, c2: 5, helmet: 'cap', shoes: 'clogs', shoeColor: 1 };
  assert.deepEqual(cleanLook(old), { ...old, feather: 'none', cape: 'none', bike: 'standard', wheels: 'standard', gloves: 'standard' }, 'a save from before the shop');
  const all = cleanLook({ helmet: 'zauberhut', feather: 'adler', outfit: 'adler', cape: 'zauber', bike: 'holz', wheels: 'glow', gloves: 'zauber' });
  assert.deepEqual([all.helmet, all.feather, all.outfit, all.cape, all.bike, all.wheels, all.gloves], ['zauberhut', 'adler', 'adler', 'zauber', 'holz', 'glow', 'zauber']);
  const bad = cleanLook({ helmet: 'tiara', feather: true, outfit: '<img>', cape: 'zauber ', bike: 'gold2', wheels: 1, gloves: null, __proto__x: 1 });
  assert.deepEqual([bad.helmet, bad.feather, bad.outfit, bad.cape, bad.bike, bad.wheels, bad.gloves], ['aero', 'none', 'team', 'none', 'standard', 'standard', 'standard']);
  assert.ok(!('__proto__x' in bad));
  for (let i = 0; i < 400; i++) assert.deepEqual(equipOf(randomLook()), {}, 'randomLook never picks a shop item');
});

test('merge rule: max earned, max spent, union of owned; garbage from the network is cleaned', () => {
  assert.deepEqual(mergeWallet(wallet(1000, 500, ['wizard-hat']), wallet(1200, 300, ['crown', 'wizard-hat'])), { earned: 1200, spent: 500, owned: ['wizard-hat', 'crown'], v: 1 });
  assert.deepEqual(mergeWallet(null, wallet(10, 0, ['x'])), { earned: 10, spent: 0, owned: ['x'], v: 1 });
  assert.deepEqual(cleanWallet({ earned: '1e99', spent: -5, owned: ['ok-1', 'Bad ID', 7, '../x', 'ok-1'] }), { earned: 1e8, spent: 0, owned: ['ok-1'], v: 1 });
});

// ---- the server: tools/accounts-api.mjs story PUT / GET on a real serve.mjs with a temp data folder ----
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let srv = null, DATA = null;
after(async () => { srv?.kill(); if (DATA) await rm(DATA, { recursive: true, force: true }); });
const weekKey = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('server sync: wallet and worn items survive a new device; old clients stay valid; one number on the leaderboard', async () => {
  DATA = await mkdtemp(join(tmpdir(), 'rf-shop-test-')); const port = await free(), base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/account/ping'); break; } catch { await wait(100); } }
  const call = async (method, p, { body, token } = {}) => { const r = await fetch(base + '/api/account/' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-RF-Token': token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const reg = await call('POST', 'register', { body: { name: 'Shop Tester', email: 'shop@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' } }); assert.equal(reg.status, 200);
  const T = reg.j.token, wk = weekKey();
  assert.equal((await call('GET', 'story')).status, 401, 'needs a login');
  assert.deepEqual((await call('GET', 'story', { token: T })).j, { week: wk, wp: 0, wallet: null, equip: null }, 'nothing yet');
  // device A: rode and bought the hat
  assert.equal((await call('PUT', 'story', { token: T, body: { week: wk, pts: { wizard: 5, king: 20, devil: 10 }, wp: 120, wallet: { earned: 1500, spent: 500, owned: ['wizard-hat'] }, equip: { helmet: 'zauberhut', outfit: 'team', evil: 'x' } } })).status, 200);
  // device B (older ledger, bought the crown elsewhere): merge, never a wipe
  await call('PUT', 'story', { token: T, body: { week: wk, wp: 40, wallet: { earned: 900, spent: 2500, owned: ['crown'] } } });
  const g = (await call('GET', 'story', { token: T })).j;
  assert.deepEqual(g.wallet, { earned: 1500, spent: 2500, owned: ['wizard-hat', 'crown'], v: 1 }); assert.equal(g.wp, 120, 'the week keeps the higher value');
  assert.deepEqual(g.equip, { helmet: 'zauberhut' }, 'only known shop values are kept');
  // an old client: { week, pts } only
  assert.equal((await call('PUT', 'story', { token: T, body: { week: wk, pts: { wizard: 100, king: 50, devil: 20 } } })).status, 200);
  const g2 = (await call('GET', 'story', { token: T })).j; assert.equal(g2.wp, 170, 'old three-figure sum stands in when higher'); assert.deepEqual(g2.wallet.owned, ['wizard-hat', 'crown'], 'wallet untouched');
  // last week's payload: the week part is ignored, the wallet still merges
  await call('PUT', 'story', { token: T, body: { week: '2020-01-06', wp: 9999, wallet: { earned: 1600, spent: 0, owned: [] } } });
  const g3 = (await call('GET', 'story', { token: T })).j; assert.equal(g3.wp, 170); assert.equal(g3.wallet.earned, 1600);
  const b = (await call('GET', 'board', { token: T })).j.rows.find(r => r.me);
  assert.equal(b.wp, 170, 'leaderboard: one number, this week\'s Wizard points'); assert.ok(!('pts' in b), 'no three figures on the board');
});
