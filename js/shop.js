// The shop (owner 19.11.): cosmetic things for your rider, bought with Wizard points (js/wizpoints.js). Only the look
// changes, never the riding. Pure data and rules (tools/shop-test.mjs); the page is js/shop-ui.js, the shapes are built
// in js/world/avatar.js. Each item is one value of one look key (js/look.js), so items of different keys combine freely
// (cloak over any jersey, glowing wheels on any frame, the feather on any headwear).
import { balanceOf } from './wizpoints.js';

export const SLOTS = [['head', 'Head'], ['outfit', 'Outfit'], ['bike', 'Bike'], ['gloves', 'Gloves']];
export const CATALOG = [
  { id: 'wizard-hat', name: 'Wizard hat', slot: 'head', key: 'helmet', value: 'zauberhut', price: 500, desc: 'Tall bent cone with a wide brim, a buckled band and a few stars. Worn instead of the helmet.' },
  { id: 'eagle-feather', name: 'Eagle feather', slot: 'head', key: 'feather', value: 'adler', price: 300, desc: 'A proud brown and white feather tucked into whatever you wear on your head.' },
  { id: 'crown', name: 'Crown', slot: 'head', key: 'helmet', value: 'krone', price: 2500, desc: 'Solid gold with red, green and blue jewels. For the ruler of the island.' },
  { id: 'star-jersey', name: 'Star and moon jersey', slot: 'outfit', key: 'outfit', value: 'sterne', price: 800, desc: 'Midnight blue with a golden moon and a sky full of stars.' },
  { id: 'wizard-cloak', name: 'Wizard cloak', slot: 'outfit', key: 'cape', value: 'zauber', price: 1200, desc: 'A long dark blue cape with a starry lining. Goes over any jersey.' },
  { id: 'eagle-jersey', name: 'Eagle jersey', slot: 'outfit', key: 'outfit', value: 'adler', price: 900, desc: 'Brown and white feathers from the shoulders down, like the eagle of the island.' },
  { id: 'knight-armour', name: 'Knight armour', slot: 'outfit', key: 'outfit', value: 'ritter', price: 1000, desc: 'Steel plates on chest and shoulders under a red tabard with a golden cross.' },
  { id: 'wooden-bike', name: 'Wooden retro bike', slot: 'bike', key: 'bike', value: 'holz', price: 1500, desc: 'A frame of warm polished wood on cream tyres.' },
  { id: 'glow-wheels', name: 'Glowing wheels', slot: 'bike', key: 'wheels', value: 'glow', price: 1200, desc: 'Rims that glow in your colour. On any frame.' },
  { id: 'dragon-frame', name: 'Dragon frame', slot: 'bike', key: 'bike', value: 'drache', price: 4000, desc: 'Green scales all over and small spines along the top tube.' },
  { id: 'golden-bike', name: 'Golden bike', slot: 'bike', key: 'bike', value: 'gold', price: 5000, desc: 'Gold frame, gold rims. Nobody will miss you in the bunch.' },
  { id: 'wizard-gloves', name: 'Wizard gloves', slot: 'gloves', key: 'gloves', value: 'zauber', price: 400, desc: 'Dark blue with golden stars. You see them on the bars all ride long.' },
];
export const itemById = id => CATALOG.find(i => i.id === id) || null;
/** the shop item behind a look value (null for the free choices) */
export const itemFor = (key, value) => CATALOG.find(i => i.key === key && i.value === value) || null;
/** look values that only the shop sells, per key: randomLook and the editor's free choices skip them */
export const SHOP_VALUES = CATALOG.reduce((o, i) => ((o[i.key] ||= new Set()).add(i.value), o), {});
/** what each shop key falls back to when its item is taken off */
export const OFF = { helmet: 'aero', feather: 'none', outfit: 'team', cape: 'none', bike: 'standard', wheels: 'standard', gloves: 'standard' };

/** state of an item for the shop card: 'wearing' | 'owned' | 'buy' | 'short' (not enough points), with what is missing */
export function itemState(item, wallet, look) {
  if (wallet?.owned?.includes(item.id)) return { state: look?.[item.key] === item.value ? 'wearing' : 'owned' };
  const bal = balanceOf(wallet); return bal >= item.price ? { state: 'buy' } : { state: 'short', missing: item.price - bal };
}
/** buy: deducts, adds to owned. Returns { ok, error } and changes the wallet in place only on success */
export function buy(wallet, id) {
  const it = itemById(id); if (!it) return { ok: false, error: 'unknown' };
  if (wallet.owned.includes(id)) return { ok: false, error: 'owned' };
  if (balanceOf(wallet) < it.price) return { ok: false, error: 'short', missing: it.price - balanceOf(wallet) };
  wallet.spent += it.price; wallet.owned.push(id); return { ok: true, item: it };
}
/** put an owned item on (a new look; the old one stays untouched); unknown or not owned: the look as it was */
export function equip(look, wallet, id) {
  const it = itemById(id); if (!it || !wallet?.owned?.includes(id)) return look;
  return { ...look, [it.key]: it.value };
}
/** take an item off: its key back to the free default */
export function unequip(look, id) {
  const it = itemById(id); if (!it || look?.[it.key] !== it.value) return look;
  return { ...look, [it.key]: OFF[it.key] };
}
/** your own look may only wear what you own: everything else back to the free default (remote riders are never checked) */
export function ownedLook(look, wallet) {
  const out = { ...look }, own = new Set(wallet?.owned || []);
  for (const [k, vals] of Object.entries(SHOP_VALUES)) if (vals.has(out[k]) && !own.has(itemFor(k, out[k]).id)) out[k] = OFF[k];
  return out;
}
/** the worn shop items of a look as { key: value } (for the server, so a new device gets them back) */
export function equipOf(look) {
  const o = {}; for (const k of Object.keys(SHOP_VALUES)) if (look && SHOP_VALUES[k].has(look[k])) o[k] = look[k]; return o;
}
/** server equip back onto a look: only known shop values of owned items */
export function applyEquip(look, equip, wallet) {
  const out = { ...look }; for (const [k, v] of Object.entries(equip || {})) { const it = itemFor(k, v); if (it && wallet?.owned?.includes(it.id)) out[k] = v; } return out;
}
