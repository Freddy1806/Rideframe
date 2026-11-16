// Bottom navigation of the phone app (UX review 16.11.): Home · Activities · Stats · Profile on the four browsing pages.
// Not on the recording pages (outdoor, pure, kraft): there the back arrow stays, so a tap cannot leave a running session.
import { icon } from './theme.js';

const ITEMS = [['home', 'handy.html', 'home', 'Home'], ['feed', 'aktivitaeten.html', 'list', 'Activities'], ['stats', 'statistik.html', 'chart', 'Stats'], ['profile', 'profil.html', 'user', 'Profile']];
/** puts the bar at the end of <body> (outside the page root, so re-renders keep it) and marks the body for the bottom padding */
export function nav(active) {
  document.querySelector('.bnav')?.remove();
  const n = document.createElement('nav'); n.className = 'bnav'; n.setAttribute('aria-label', 'Main');
  n.innerHTML = ITEMS.map(([k, href, ic, label]) => `<a href="${href}" class="${k === active ? 'on' : ''}"${k === active ? ' aria-current="page"' : ''}>${icon(ic, 'bico')}<span>${label}</span></a>`).join('');
  document.body.append(n); document.body.classList.add('hasnav');
  return n;
}
