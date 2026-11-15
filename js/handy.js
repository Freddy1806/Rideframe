// RIDEFRAME as a phone app (Freddy 15.11.): the home screen of the installed app (app.webmanifest, start_url handy.html).
// Big tiles for what works on the phone: ride outside, strength, the trainer (Pure); the 3D world stays a laptop/TV thing.
import { db } from './db.js';
import { fmtTime, fmtNum, esc } from './util.js';

const el = document.getElementById('handy'), $ = (s, r = document) => r.querySelector(s);
const ACCENTS = { orange: '#ff5a1f', violet: '#8b6cff', lime: '#c6f432', cyan: '#2fd3e0', pink: '#ff4f9a' };
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let S = {}, acc = null, rides = [], kraft = [], installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; render(); });

async function load() {
  S = (await db.kvGet('settings').catch(() => null)) || {};
  document.documentElement.style.setProperty('--accent', ACCENTS[S.accent] || ACCENTS.orange);
  rides = (await db.all('rides').catch(() => [])).sort((a, b) => b.date - a.date);
  kraft = (await db.kvGet('kraft').catch(() => null)) || [];
  try { acc = (await import('./account.js')).account(); } catch {}
}
function render() {
  const wk = Date.now() - 7 * 864e5, wr = rides.filter(r => r.date > wk && r.routeId !== 'demo'), wkr = kraft.filter(w => (w.start || w.date) > wk);
  const out = rides.find(r => r.routeId === 'outdoor'), kw = kraft[0];
  const tile = (href, icon, name, sub) => `<a class="htile" href="${href}"><span class="hico">${icon}</span><b>${name}</b><small>${sub}</small></a>`;
  el.innerHTML = `<header class="ptop"><div class="pbrand" style="font-size:22px">RIDE<span>FRAME</span></div>
      <button class="ppill ${acc ? 'on' : ''}" id="hAcc"><i></i><span class="pname">${acc ? esc(acc.name) : 'Anmelden'}</span></button></header>
    ${!standalone ? installHint() : ''}
    <section class="kcard"><div class="label">Diese Woche</div><div class="kstats">
      <div><b>${wr.length}</b><small>Fahrten</small></div><div><b>${fmtNum(wr.reduce((a, r) => a + r.distance, 0) / 1000, 0)}</b><small>km</small></div>
      <div><b>${fmtNum(wr.reduce((a, r) => a + (r.gain || 0), 0))}</b><small>hm</small></div><div><b>${wkr.length}</b><small>Kraft</small></div></div></section>
    <div class="htiles">
      ${tile('outdoor.html', '◉', 'Draußen fahren', out ? `Zuletzt ${fmtNum(out.distance / 1000, 1)} km · ${new Date(out.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}` : 'GPS, Karte, Tempo, Höhenmeter')}
      ${tile('kraft.html', 'kg', 'Kraft', kw ? `Zuletzt ${esc(kw.name)} · ${new Date(kw.start || kw.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}` : 'Sätze, Gewichte, Graphen')}
      ${tile('pure.html', 'W', 'Rollentrainer', 'Watt, ERG und Workouts ohne 3D')}
      ${tile('./?desktop', '3D', '3D-Welt', 'Am besten am Laptop oder TV')}
    </div>
    ${rides.length ? `<h3 class="ksec">Letzte Fahrten</h3>${rides.slice(0, 5).map(r => `<div class="hrow"><span>${r.routeId === 'outdoor' ? '◉' : r.routeId === 'pure' ? 'W' : '3D'}</span><div><b>${esc(r.workout && (r.routeId === 'outdoor' || r.routeId === 'pure') ? r.workout : r.routeName || (r.routeId === 'outdoor' ? 'Draußen' : 'Indoor'))}</b><small>${new Date(r.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })}</small></div><span>${fmtNum(r.distance / 1000, 1)} km · ${fmtTime(r.duration)}</span></div>`).join('')}` : ''}
    ${!acc ? '<p class="hint" style="margin-top:14px">Melde dich mit deinem RIDEFRAME-Konto an, dann landen Fahrten und Kraft-Workouts vom Handy auch am Laptop.</p>' : ''}`;
  $('#hAcc').onclick = async () => { const a = await import('./account.js'); await a.accountModal({ settings: S }, async () => { await load(); render(); }); };
  const ib = $('#hInstall'); if (ib) ib.onclick = async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; render(); };
}
function installHint() {
  if (installEvt) return `<button class="btn kbig" id="hInstall">Als App installieren</button>`;
  if (ios) return `<div class="pnote"><b>Als App aufs iPhone:</b> in Safari unten auf <b>Teilen</b> (□↑) tippen, dann <b>„Zum Home-Bildschirm“</b>. Danach startet RIDEFRAME wie eine App, ohne Adressleiste.</div>`;
  return `<div class="pnote"><b>Als App installieren:</b> im Browser-Menü <b>„App installieren“</b> oder <b>„Zum Startbildschirm hinzufügen“</b> wählen.</div>`;
}
await load(); render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
