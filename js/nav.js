// Bottom navigation of the phone app (UX review 16.11.): Home · Activities · Stats · Profile on the four browsing pages.
// Not on the recording pages (outdoor, pure, kraft): there the back arrow stays, so a tap cannot leave a running session.
import { icon } from './theme.js';

// 25.11. (owner: "so wie das Garmin auch macht … eher so dein Trainingscoach"): Today · Training · Activities · Body · Profile.
// Stats lives under Activities now (its link at the top of the feed, and in Profile), so nav('stats') lights up Activities.
// 27.11. (owner: the Training page "kann komplett weg"): its tab is Workouts, the one home of every workout (js/workoutspage.js).
const ITEMS = [['home', 'handy.html', 'home', 'Today'], ['workouts', 'workouts.html', 'trainer', 'Workouts'], ['feed', 'aktivitaeten.html', 'list', 'Activities'], ['body', 'body.html', 'body', 'Body'], ['profile', 'profil.html', 'user', 'Profile']];
const ALIAS = { stats: 'feed', training: 'workouts' };
/** puts the bar at the end of <body> (outside the page root, so re-renders keep it) and marks the body for the bottom padding */
export function nav(active) {
  active = ALIAS[active] || active;
  document.querySelector('.bnav')?.remove();
  const n = document.createElement('nav'); n.className = 'bnav'; n.setAttribute('aria-label', 'Main');
  n.innerHTML = ITEMS.map(([k, href, ic, label]) => `<a href="${href}" class="${k === active ? 'on' : ''}"${k === active ? ' aria-current="page"' : ''}>${icon(ic, 'bico')}<span>${label}</span></a>`).join('');
  document.body.append(n); document.body.classList.add('hasnav');
  return n;
}
