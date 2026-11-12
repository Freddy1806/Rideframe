// Player profiles: everyone on the host can look at everyone (face of their rider, totals, last rides).
import { loadProfile } from './account.js';
import { portrait } from './world/avatar.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 0) => Number(v || 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const hms = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`; };

/** fill every <img data-look> below el with the rider's face (rendered once per look) */
export function fillFaces(el) {
  el.querySelectorAll('img[data-look]').forEach(async img => {
    let look = null; try { look = JSON.parse(img.dataset.look); } catch {}
    const url = await portrait(look); if (url && img.isConnected) { img.src = url; img.classList.add('on'); }
  });
}
export const faceImg = (look, cls = 'face') => `<img class="${cls}" alt="" data-look="${esc(JSON.stringify(look || null))}">`;

export async function profileModal(key, routeName) {
  const m = document.createElement('div'); m.className = 'modal profile';
  m.innerHTML = '<div class="box"><p class="dim">Lädt …</p></div>'; document.body.append(m);
  const close = () => m.remove(); m.addEventListener('click', e => { if (e.target === m) close(); });
  let p; try { p = await loadProfile(key); } catch (e) { m.querySelector('.box').innerHTML = `<p>${esc(e.message)}</p><div class="actions"><button class="btn" id="pOk">Schließen</button></div>`; m.querySelector('#pOk').onclick = close; return; }
  const rn = r => r.routeId === 'pure' ? (r.workout ? 'Training · ' + r.workout : 'Training') : routeName?.(r.routeId) || r.routeName || 'Eigene Strecke';
  m.querySelector('.box').innerHTML = `<div class="phead">${faceImg(p.look, 'face big')}<div><div class="label">Fahrer</div><h2 class="display">${esc(p.name)}</h2>
      <div class="meta">${p.since ? 'dabei seit ' + new Date(p.since).toLocaleDateString('de-DE') : ''}</div></div></div>
    <div class="pstats"><div><b>${num(p.count)}</b><span>Fahrten</span></div><div><b>${num(p.km, 1)}</b><span>km</span></div><div><b>${num(p.hm)}</b><span>Höhenmeter</span></div><div><b>${hms(p.dur)}</b><span>im Sattel</span></div></div>
    ${p.rides.length ? `<div class="plist"><table class="table"><tr><th class="label">Datum</th><th class="label">Strecke</th><th class="label">Zeit</th><th class="label">km</th><th class="label">Hm</th><th class="label">Ø W</th></tr>
      ${p.rides.map(r => `<tr><td>${new Date(r.date).toLocaleDateString('de-DE')}</td><td>${esc(rn(r))}${r.complete ? '' : ' <span class="dim">(abgebrochen)</span>'}</td><td>${hms(r.dur)}</td><td>${num(r.km, 1)}</td><td>${num(r.hm)}</td><td>${r.pw ? num(r.pw) : '–'}</td></tr>`).join('')}</table></div>`
      : '<p class="dim">Noch keine Fahrten.</p>'}
    <div class="actions"><button class="btn" id="pOk">Schließen</button></div>`;
  m.querySelector('#pOk').onclick = close; fillFaces(m);
}
