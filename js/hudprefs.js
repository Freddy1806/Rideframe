// What the ride screen shows: every HUD element can be switched on or off, plus ready-made layouts.
// Stored in settings.hud = { preset, show: { key: bool } }. Used by the ride (live, key I + "Anzeige" button) and the settings page.
export const HUD_ITEMS = [
  ['power', 'Leistung'], ['wkg', 'W/kg'], ['speed', 'Tempo'], ['cad', 'Trittfrequenz'], ['hr', 'Puls'], ['dist', 'Distanz'],
  ['grade', 'Steigung (Zahl)'], ['gradeTag', 'Steigung groß in der Mitte'], ['profile', 'Höhenprofil'], ['map', 'Streckenkarte'],
  ['time', 'Zeit'], ['gear', 'Gang'], ['route', 'Streckenname'], ['buttons', 'Knöpfe (Kamera, Lenker, Musik)'],
];
const ALL = Object.fromEntries(HUD_ITEMS.map(([k]) => [k, true]));
export const HUD_PRESETS = {
  voll: { name: 'Alles', show: { ...ALL, wkg: false } },
  kompakt: { name: 'Kompakt', show: { power: true, speed: true, hr: true, dist: true, gradeTag: true, profile: true, map: true, time: true } },
  training: { name: 'Training', show: { power: true, wkg: true, cad: true, hr: true, gradeTag: false, time: true, gear: true } },
  pur: { name: 'Pur', show: { power: true, gradeTag: true } },
  kino: { name: 'Nur Landschaft', show: {} },
};
export const HUD_ORDER = ['voll', 'kompakt', 'training', 'pur', 'kino'];

export function hudPrefs(s) {
  const h = s.hud || {};
  const base = HUD_PRESETS[h.preset]?.show || HUD_PRESETS.voll.show;
  const show = h.preset === 'eigen' && h.show ? h.show : base;
  return { preset: h.preset || 'voll', show: Object.fromEntries(HUD_ITEMS.map(([k]) => [k, !!show[k]])) };
}

/** hide/show the parts of a ride HUD (elements carry data-hud="key") */
export function applyHud(root, prefs) {
  if (!root) return;
  const on = prefs.show;
  root.querySelectorAll('[data-hud]').forEach(el => { el.style.display = on[el.dataset.hud] ? '' : 'none'; });
  const ms = [...root.querySelectorAll('.metrics > [data-hud]')].filter(el => on[el.dataset.hud]);
  const metrics = root.querySelector('.metrics');
  if (metrics) metrics.style.gridTemplateColumns = ms.map(el => (el.classList.contains('power') ? '1.5fr' : '1fr')).join(' ') || 'none';
  const bottom = root.querySelector('.hud-bottom');
  if (bottom) { bottom.style.display = ms.length || on.profile ? '' : 'none'; bottom.classList.toggle('slim', ms.length <= 3 && !on.profile); }
  const route = root.querySelector('.hud-route'); if (route) route.style.visibility = on.route ? '' : 'hidden';
}

/** the switches (settings page and the in-ride panel share this markup) */
export function hudControlsHTML(prefs) {
  return `<div class="hudpresets">${[...HUD_ORDER, 'eigen'].map(k => `<button class="avchip ${prefs.preset === k ? 'on' : ''}" data-hp="${k}">${k === 'eigen' ? 'Eigene' : HUD_PRESETS[k].name}</button>`).join('')}</div>
    <div class="hudchecks">${HUD_ITEMS.map(([k, t]) => `<label><input type="checkbox" data-hk="${k}" ${prefs.show[k] ? 'checked' : ''}> ${t}</label>`).join('')}</div>`;
}

/** wire the switches; onChange(newHudSetting) is called with the value to store in settings.hud */
export function wireHudControls(box, getSettings, onChange) {
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-hp]'); if (!b) return;
    const s = getSettings(), p = b.dataset.hp;
    onChange(p === 'eigen' ? { preset: 'eigen', show: hudPrefs(s).show } : { preset: p });
  });
  box.addEventListener('change', e => {
    const k = e.target.dataset?.hk; if (!k) return;
    const s = getSettings(), show = { ...hudPrefs(s).show, [k]: e.target.checked };
    onChange({ preset: 'eigen', show });
  });
}
