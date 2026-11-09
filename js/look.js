// The rider's look: choices and sanitising. No three.js here, so the lobby and the network code stay light.
export const SKINS = ['#f6d7c3', '#e9b896', '#d39a6f', '#a96f45', '#7a4a2c', '#4e2f1d'];
export const HAIRCOL = ['#1d1612', '#4a2f1f', '#8a5a33', '#d9b36a', '#f1e3b0', '#b8401f', '#9aa0a6', '#e8e8e8', '#ff4fb0', '#3fa9ff'];
export const COLORS = ['#ff5a1f', '#e0452b', '#ffd23f', '#2fb36b', '#18b5c4', '#2f7fd8', '#6b4bd6', '#e84393', '#1b1d22', '#f4f4ef'];
export const OPTIONS = {
  body: [['m', 'Mann'], ['f', 'Frau']],
  hair: [['kurz', 'Kurz'], ['lang', 'Lang'], ['zopf', 'Zopf'], ['dutt', 'Dutt'], ['irokese', 'Irokese'], ['afro', 'Afro'], ['vokuhila', 'Vokuhila'], ['glatze', 'Glatze']],
  beard: [['none', 'Ohne'], ['bart', 'Vollbart'], ['schnauzer', 'Schnauzer'], ['stoppeln', 'Stoppeln']],
  glasses: [['none', 'Ohne'], ['sport', 'Sportbrille'], ['retro', 'Retro rund'], ['sonne', '80er Sonnenbrille']],
  outfit: [['team', 'Team-Trikot'], ['neon80', '80er Neon'], ['retro', 'Retro Wolle'], ['hawaii', 'Hawaii'], ['anzug', 'Business'],
    ['superheld', 'Superheld'], ['banane', 'Banane'], ['wikinger', 'Wikinger'], ['tutu', 'Ballett'], ['dino', 'Dino']],
  helmet: [['aero', 'Aero-Helm'], ['klassisch', 'Helm'], ['cap', 'Radmütze'], ['stirnband', '80er Stirnband'], ['keiner', 'Ohne']],
  shoes: [['rennrad', 'Radschuhe'], ['sneaker', 'Sneaker'], ['clogs', 'Clogs'], ['socken', 'Nur Socken']],
};
export const DEFAULT_LOOK = { body: 'm', height: 1, build: 0.4, skin: 1, hair: 'kurz', hairColor: 1, beard: 'none', glasses: 'sport', outfit: 'team', c1: 0, c2: 8, helmet: 'aero', shoes: 'rennrad', shoeColor: 9 };

const pick = (opts, v, d) => (opts.some(o => o[0] === v) ? v : d);
/** never trust a look from the network or an old save */
export function cleanLook(l = {}) {
  const n = (v, a, b, d) => (Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : d), D = DEFAULT_LOOK, O = OPTIONS;
  return { body: pick(O.body, l.body, D.body), height: n(l.height, 0.88, 1.12, 1), build: n(l.build, 0, 1, 0.4), skin: n(l.skin, 0, SKINS.length - 1, 1) | 0,
    hair: pick(O.hair, l.hair, D.hair), hairColor: n(l.hairColor, 0, HAIRCOL.length - 1, 1) | 0, beard: pick(O.beard, l.beard, 'none'), glasses: pick(O.glasses, l.glasses, 'none'),
    outfit: pick(O.outfit, l.outfit, 'team'), c1: n(l.c1, 0, COLORS.length - 1, 0) | 0, c2: n(l.c2, 0, COLORS.length - 1, 8) | 0,
    helmet: pick(O.helmet, l.helmet, 'aero'), shoes: pick(O.shoes, l.shoes, 'rennrad'), shoeColor: n(l.shoeColor, 0, COLORS.length - 1, 9) | 0 };
}
export function randomLook() {
  const r = a => a[Math.floor(Math.random() * a.length)], O = OPTIONS;
  return cleanLook({ body: r(O.body)[0], height: 0.9 + Math.random() * 0.2, build: Math.random(), skin: Math.random() * SKINS.length | 0, hair: r(O.hair)[0],
    hairColor: Math.random() * HAIRCOL.length | 0, beard: Math.random() < 0.3 ? r(O.beard)[0] : 'none', glasses: r(O.glasses)[0], outfit: r(O.outfit)[0],
    c1: Math.random() * COLORS.length | 0, c2: Math.random() * COLORS.length | 0, helmet: r(O.helmet)[0], shoes: r(O.shoes)[0], shoeColor: Math.random() * COLORS.length | 0 });
}
