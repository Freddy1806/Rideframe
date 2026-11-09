// Rider editor ("Dein Fahrer"), Mii style: turning 3D preview on the left, choices on the right.
// The look is saved in the settings and goes live to the group if you are in one.
import { state, saveSettings, toast } from './app.js';
import { OPTIONS, SKINS, HAIRCOL, COLORS, DEFAULT_LOOK, cleanLook, randomLook, AvatarPreview } from './world/avatar.js';
import { currentGroup } from './share.js';
import { esc } from './util.js';

const TABS = [
  ['body', 'Körper'], ['face', 'Gesicht'], ['hair', 'Haare'], ['outfit', 'Outfit'], ['kopf', 'Helm'], ['shoes', 'Schuhe'],
];

export function avatarModal({ onDone } = {}) {
  let look = cleanLook(state.settings.look || DEFAULT_LOOK), tab = 'body';
  const before = JSON.stringify(look);
  const m = document.createElement('div'); m.className = 'modal avatar-modal';
  m.innerHTML = `<div class="box avbox">
    <div class="avleft"><canvas class="avcanvas"></canvas>
      <div class="avname"><input type="text" id="avName" maxlength="20" placeholder="Dein Name" value="${esc(state.settings.riderName || '')}"></div>
      <div class="avbtns"><button class="btn ghost small" id="avRand">🎲 Zufall</button><button class="btn ghost small" id="avSpin">⟳ Drehen</button></div></div>
    <div class="avright"><div class="label">Dein Fahrer</div><div class="avtabs"></div><div class="avopts"></div>
      <div class="actions"><button class="btn ghost small" id="avCancel">Abbrechen</button><button class="btn" id="avSave">Fertig</button></div></div></div>`;
  document.body.append(m);
  const prev = new AvatarPreview(m.querySelector('.avcanvas')); prev.set(look);
  const q = s => m.querySelector(s);

  const chips = (key, opts) => `<div class="avrow"><div class="avk">${{ body: 'Typ', hair: 'Frisur', beard: 'Bart', glasses: 'Brille', outfit: 'Outfit', helmet: 'Kopf', shoes: 'Schuhe' }[key]}</div><div class="avchips">${
    opts.map(([v, t]) => `<button class="avchip ${look[key] === v ? 'on' : ''}" data-k="${key}" data-v="${v}">${esc(t)}</button>`).join('')}</div></div>`;
  const sw = (key, cols, label) => `<div class="avrow"><div class="avk">${label}</div><div class="swatches avsw">${
    cols.map((c, i) => `<button class="swatch ${look[key] === i ? 'on' : ''}" data-k="${key}" data-i="${i}" style="background:${c}"></button>`).join('')}</div></div>`;
  const slider = (key, label, min, max, step, l, r) => `<div class="avrow"><div class="avk">${label}</div><div class="avslide"><span>${l}</span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${look[key]}"><span>${r}</span></div></div>`;

  const render = () => {
    q('.avtabs').innerHTML = TABS.map(([k, t]) => `<button class="avtab ${tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('');
    q('.avopts').innerHTML = {
      body: () => chips('body', OPTIONS.body) + slider('height', 'Größe', 0.88, 1.12, 0.01, 'klein', 'groß') + slider('build', 'Statur', 0, 1, 0.05, 'schlank', 'muskulös') + sw('skin', SKINS, 'Hautfarbe'),
      face: () => chips('beard', OPTIONS.beard) + chips('glasses', OPTIONS.glasses),
      hair: () => chips('hair', OPTIONS.hair) + sw('hairColor', HAIRCOL, 'Haarfarbe'),
      outfit: () => chips('outfit', OPTIONS.outfit) + sw('c1', COLORS, 'Farbe 1') + sw('c2', COLORS, 'Farbe 2 / Rad'),
      kopf: () => chips('helmet', OPTIONS.helmet) + '<p class="avhint">Ohne Helm, mit Mütze oder Stirnband sieht man die Frisur ganz.</p>',
      shoes: () => chips('shoes', OPTIONS.shoes) + sw('shoeColor', COLORS, 'Schuhfarbe'),
    }[tab]();
  };
  const apply = l => { look = cleanLook(l); prev.set(look); render(); };

  m.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tab) { tab = b.dataset.tab; render(); }
    else if (b.dataset.v != null) apply({ ...look, [b.dataset.k]: b.dataset.v });
    else if (b.dataset.i != null) apply({ ...look, [b.dataset.k]: +b.dataset.i });
  });
  m.addEventListener('input', e => { const k = e.target.dataset?.k; if (k) { look = cleanLook({ ...look, [k]: +e.target.value }); prev.set(look); } });
  q('#avRand').onclick = () => apply(randomLook());
  q('#avSpin').onclick = () => { prev.spin = prev.spin ? 0 : 0.6; };
  const close = () => { prev.destroy(); m.remove(); };
  q('#avCancel').onclick = close;
  q('#avSave').onclick = () => {
    const name = q('#avName').value.trim().slice(0, 20);
    if (name) state.settings.riderName = name;
    state.settings.look = look; saveSettings();
    const g = currentGroup(); if (g) { if (name) g.me.name = name; g.setLook(look); }
    close();
    if (JSON.stringify(look) !== before) toast(g ? 'Neuer Look. Deine Gruppe sieht ihn sofort.' : 'Neuer Look gespeichert. Den sehen auch deine Freunde beim Zusammenfahren.', 3500);
    onDone?.(look);
  };
  render();
}
