// The arrangeable overview's layout model (25.11., owner: "when you open RIDEFRAME you see all your current data … you can arrange it
// yourself"). Pure functions, no page code: the start page (js/cards.js), the server (tools/home-api.mjs, tools/accounts-api.mjs)
// and the tests (tools/cards-test.mjs) share them.
//
// A layout: { v: 1, at: ms of the last change (0 = never), def: true while it is the default, cards: [{ id, size }], hidden: [id] }.
// cards = the shown cards in their order, size 'half' | 'full'; hidden = the ones taken off (the "Add cards" list).
// The catalogue (cat) is [{ id, sizes: ['half', 'full'] or one of them, size: default size, on: shown by default }], in the default order.
export const LAYOUT_V = 1, MAX_CARDS = 40;
const ID = /^[a-z][a-z0-9]{0,23}$/;
/** old card ids that were renamed: the saved layouts of older versions keep working */
export const ALIASES = { health: 'recovery', week: 'today', body: 'weight' };
const sizeOf = (c, s) => c.sizes.includes(s) ? s : c.sizes.includes(c.size) ? c.size : c.sizes[0];

/** the default for this account: the catalogue's order; cards known to be empty for this user go after the ones with data (never hidden) */
export function defaultLayout(cat, { empty = [] } = {}) {
  const e = new Set(empty), on = cat.filter(c => c.on !== false), full = [...on.filter(c => !e.has(c.id)), ...on.filter(c => e.has(c.id))];
  return { v: LAYOUT_V, at: 0, def: true, cards: full.map(c => ({ id: c.id, size: sizeOf(c, c.size) })), hidden: cat.filter(c => c.on === false).map(c => c.id) };
}

/** any stored value -> a valid layout for this catalogue: unknown ids dropped (renamed ones mapped), doubles removed, sizes the card
 *  does not support fixed, cards the catalogue got since then added (shown ones at the end, the others to the "Add cards" list) */
export function normalize(x, cat, opt = {}) {
  if (!x || typeof x !== 'object' || x.def || !Array.isArray(x.cards)) return { ...defaultLayout(cat, opt), at: +x?.at > 0 ? +x.at : 0 };
  const by = new Map(cat.map(c => [c.id, c])), seen = new Set(), cards = [], hidden = [];
  const id = v => { const s = typeof v === 'string' ? v : v?.id; const k = ALIASES[s] || s; return by.has(k) && !seen.has(k) ? k : null; };
  for (const v of x.cards.slice(0, MAX_CARDS)) { const k = id(v); if (!k) continue; seen.add(k); cards.push({ id: k, size: sizeOf(by.get(k), v?.size) }); }
  for (const v of Array.isArray(x.hidden) ? x.hidden.slice(0, MAX_CARDS) : []) { const k = id(v); if (!k) continue; seen.add(k); hidden.push(k); }
  for (const c of cat) if (!seen.has(c.id)) { if (c.on === false) hidden.push(c.id); else cards.push({ id: c.id, size: sizeOf(c, c.size) }); }
  return { v: LAYOUT_V, at: +x.at > 0 ? +x.at : 0, def: false, cards, hidden };
}
const touch = (L, at) => ({ ...L, def: false, at: at ?? Math.max(Date.now(), (L.at || 0) + 1) });

/** card id to position `to` (0-based, clamped) among the shown cards */
export function move(L, id, to, at) {
  const i = L.cards.findIndex(c => c.id === id); if (i < 0) return L;
  const cards = L.cards.slice(), [c] = cards.splice(i, 1), j = Math.max(0, Math.min(cards.length, to | 0));
  if (j === i) return L; cards.splice(j, 0, c); return touch({ ...L, cards }, at);
}
/** one step up (-1) or down (+1) */
export const moveBy = (L, id, d, at) => { const i = L.cards.findIndex(c => c.id === id); return i < 0 ? L : move(L, id, i + d, at); };
/** off the overview, onto the "Add cards" list */
export function remove(L, id, at) {
  if (!L.cards.some(c => c.id === id)) return L;
  return touch({ ...L, cards: L.cards.filter(c => c.id !== id), hidden: [id, ...L.hidden.filter(h => h !== id)] }, at);
}
/** back onto the overview, at position `to` (default: the end) with the card's default size */
export function add(L, id, cat, to = Infinity, at) {
  const c = cat.find(x => x.id === id); if (!c || L.cards.some(x => x.id === id)) return L;
  const cards = L.cards.slice(); cards.splice(Math.max(0, Math.min(cards.length, to)), 0, { id, size: sizeOf(c, c.size) });
  return touch({ ...L, cards, hidden: L.hidden.filter(h => h !== id) }, at);
}
/** half <-> full where the card has both */
export function setSize(L, id, size, cat, at) {
  const c = cat.find(x => x.id === id), i = L.cards.findIndex(x => x.id === id); if (!c || i < 0 || !c.sizes.includes(size) || L.cards[i].size === size) return L;
  const cards = L.cards.slice(); cards[i] = { id, size }; return touch({ ...L, cards }, at);
}
/** back to the default (kept as "default", so the default can follow the data again), with a new time so it wins everywhere */
export const reset = (cat, at = Date.now(), opt = {}) => ({ ...defaultLayout(cat, opt), at });

/** what is stored: the shape only, ids and sizes checked (the server knows no catalogue); null = not a layout */
export function clean(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const at = +x.at; if (!(at > 0) || !Number.isFinite(at)) return null;
  if (x.def === true) return { v: LAYOUT_V, at, def: true };
  if (!Array.isArray(x.cards) || x.cards.length > MAX_CARDS || (x.hidden != null && (!Array.isArray(x.hidden) || x.hidden.length > MAX_CARDS))) return null;
  const cards = [], hidden = [], seen = new Set();
  for (const c of x.cards) { const id = c?.id; if (typeof id !== 'string' || !ID.test(id) || seen.has(id)) return null; if (c.size !== 'half' && c.size !== 'full') return null; seen.add(id); cards.push({ id, size: c.size }); }
  for (const h of x.hidden || []) { if (typeof h !== 'string' || !ID.test(h) || seen.has(h)) return null; seen.add(h); hidden.push(h); }
  return { v: LAYOUT_V, at, def: false, cards, hidden };
}
/** two stored layouts (this device, the account) -> the newer one; ties keep a (the one already there) */
export function newer(a, b) {
  const A = clean(a), B = clean(b); if (!A) return B; if (!B) return A;
  return B.at > A.at ? B : A;
}
/** a whole-settings upload (PUT /api/account/settings) with the newer of its homeCards and the stored ones, so a device with older
 *  settings never takes a newer arrangement back */
export function keepHome(incoming, stored) {
  const s = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? { ...incoming } : {}, h = newer(stored?.homeCards, s.homeCards);
  if (h) s.homeCards = h; else delete s.homeCards;
  return s;
}
