// Look of the phone app (Freddy 16.11.): every mode has its own colour and icon, so you always know where you are,
// plus light / dark / like the system. Used by handy, outdoor (ride + run), kraft and pure.
// Settings (kv 'settings'): theme 'auto' | 'dark' | 'light', modeColors true (own colour per mode) or false (one accent for all).
export const MODES = {
  ride: { name: 'Ride outdoors', short: 'Ride', href: 'outdoor.html', color: '#ff5a1f', light: '#e04a12' },
  run: { name: 'Run', short: 'Run', href: 'outdoor.html?sport=run', color: '#2fd3e0', light: '#0a8f9c' },
  trainer: { name: 'Indoor trainer', short: 'Indoor', href: 'pure.html', color: '#8b6cff', light: '#6446e8' },
  world: { name: 'Virtual routes', short: 'Virtual', href: './?desktop', color: '#c6f432', light: '#5f8a00' },
  kraft: { name: 'Strength', short: 'Strength', href: 'kraft.html', color: '#ff4f9a', light: '#d62c78' },
  // the other sports (imported from Strava, a file or entered by hand, js/sports.js): no recording page of their own
  walk: { name: 'Walk & hike', short: 'Walk', color: '#e2a33b', light: '#9a6400' },
  swim: { name: 'Swim', short: 'Swim', color: '#3d7dff', light: '#1e56d6' },
  skate: { name: 'Skating', short: 'Skate', color: '#5ad1a0', light: '#13845a' },
  ski: { name: 'Snow sports', short: 'Snow', color: '#cfe0f5', light: '#4f6b8f' },
  water: { name: 'Water sports', short: 'Water', color: '#00b3a4', light: '#00776d' },
  fit: { name: 'Workout & yoga', short: 'Fitness', color: '#d07cff', light: '#9333d6' },
  ball: { name: 'Ball & racket', short: 'Ball', color: '#ff6b6b', light: '#d13b3b' },
  other: { name: 'Other sports', short: 'Other', color: '#a0a4ab', light: '#5f6368' },
};
export const ACCENTS = { orange: ['#ff5a1f', '#e04a12'], violet: ['#8b6cff', '#6446e8'], lime: ['#c6f432', '#5f8a00'], cyan: ['#2fd3e0', '#0a8f9c'], pink: ['#ff4f9a', '#d62c78'] };

// simple line icons (24×24, stroke = currentColor)
export const ICONS = {
  ride: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h6l3.5 7.5M9 9 12 16.5h-1M15 9l-1.5-3H11"/>',
  run: '<circle cx="15" cy="4.5" r="2"/><path d="m8 21 3-6 3 2v4M6 12l3-4 4 1 2 4 3 1M11 15l-2-3"/>',
  trainer: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/><path d="M4 20h16"/>',
  world: '<path d="m2 19 6-10 4 6 3-4 7 8z"/><circle cx="17" cy="6" r="2"/>',
  kraft: '<path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/>',
  walk: '<circle cx="13" cy="4.5" r="2"/><path d="m9 21 2.5-6.5L14 17v4M8 11l3-3 3 1 1.5 3 2.5 1M11 8l.5 6.5"/>',
  swim: '<circle cx="17" cy="6" r="2"/><path d="m5 13 5-4 3 3 3-2M2 17c2.5 0 2.5-1.5 5-1.5s2.5 1.5 5 1.5 2.5-1.5 5-1.5 2.5 1.5 5 1.5M2 21c2.5 0 2.5-1.5 5-1.5s2.5 1.5 5 1.5 2.5-1.5 5-1.5 2.5 1.5 5 1.5"/>',
  skate: '<path d="M7 3h4v8l7 3v3H7z"/><path d="M4 21h16M10 17v4M15 17v4"/>',
  ski: '<circle cx="15" cy="4.5" r="2"/><path d="m3 15 18 6M7 12l4-4 4 3-3 4M11 8 7 9"/>',
  water: '<path d="M2 15c5 3.5 15 3.5 20 0M5 4l14 14M3.5 5.5l3-3M17.5 19.5l3-3"/>',
  fit: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 3c3.5 3 3.5 15 0 18M3 12h18"/>',
  other: '<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  home: '<path d="M3 11 12 4l9 7M5 10v10h14V10"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  chart: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>',
};
export const icon = (k, cls = 'mico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ''}</svg>`;

const mq = matchMedia('(prefers-color-scheme: light)');
let last = null;
/** sets data-theme and the accent colour for this page; mode = key of MODES or null (home screen) */
export function applyTheme(S = {}, mode = null) {
  last = [S, mode];
  const light = S.theme === 'light' || (S.theme === 'auto' && mq.matches);
  const r = document.documentElement; r.dataset.theme = light ? 'light' : 'dark';
  const own = S.modeColors === true && mode && MODES[mode], a = ACCENTS[S.accent] || ACCENTS.orange;
  document.documentElement.dataset.modecolors = S.modeColors === true ? '1' : '0';
  r.style.setProperty('--accent', own ? (light ? own.light : own.color) : a[light ? 1 : 0]);
  r.style.setProperty('--accent-ink', light ? '#ffffff' : '#0b0b0b');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f4f3ef' : '#0b0b0b');
  if (mode) r.dataset.mode = mode;
}
mq.addEventListener?.('change', () => last && applyTheme(...last));
