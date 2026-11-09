// Riding together: (1) share a ride as a file, a friend rides against it as a ghost;
// (2) group ride live with a 5-letter code (js/group.js).
import { db, uid } from './db.js';
import { state, toast, routeById, saveSettings } from './app.js';
import { Group } from './group.js';
import { cleanLook } from './look.js';
import { esc, fmtTime, fmtKm } from './util.js';

// ---------- name ----------
export function riderName(ask = true) {
  let n = state.settings.riderName;
  if (!n && ask) { n = (prompt('Dein Name (sehen die anderen beim Zusammenfahren)', '') || '').trim().slice(0, 20); if (n) { state.settings.riderName = n; saveSettings(); } }
  return n || 'Fahrer';
}

// ---------- shared rides (files) ----------
export async function loadShared() { state.shared = (await db.kvGet('shared').catch(() => null)) || []; }
export const sharedFor = routeId => (state.shared || []).filter(r => r.routeId === routeId);

/** download one of your rides as a .rideframe file a friend can import and race against */
export function shareRide(rec) {
  const route = routeById(rec.routeId);
  const data = { type: 'rideframe-ride', v: 1, rider: riderName(), routeId: rec.routeId, routeName: route?.name || '', date: rec.date,
    duration: rec.duration, distance: rec.distance, gain: rec.gain, avgPower: rec.avgPower, startD: rec.startD || 0, complete: !!rec.complete, look: state.settings.look || null, samples: rec.samples };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `RIDEFRAME_${(route?.name || 'Fahrt').replace(/[^\wäöüÄÖÜß-]+/g, '_')}_${data.rider.replace(/[^\wäöüÄÖÜß-]+/g, '_')}_${fmtTime(rec.duration).replace(/:/g, '-')}.rideframe`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Datei gespeichert. Schick sie z. B. per WhatsApp oder Mail, dein Freund zieht sie in seine RIDEFRAME-Bibliothek.', 5000);
}

/** files dropped or picked: .rideframe (or .json with our type). Returns the files that were not ours. */
export async function importShared(files) {
  const rest = [];
  for (const f of files) {
    if (!/\.(rideframe|json)$/i.test(f.name)) { rest.push(f); continue; }
    try {
      const j = JSON.parse(await f.text());
      if (j?.type !== 'rideframe-ride' || !Array.isArray(j.samples) || !j.samples.length) throw new Error('keine RIDEFRAME-Fahrt');
      const route = routeById(String(j.routeId));
      if (!route) { toast(`Die Strecke „${j.routeName || j.routeId}“ gibt es bei dir nicht. Eigene Video-Strecken müssen beide importiert haben.`, 6000); continue; }
      const n = v => (Number.isFinite(+v) ? +v : 0);
      const rec = { id: uid(), rider: String(j.rider || 'Freund').slice(0, 20), routeId: route.id, date: n(j.date), duration: n(j.duration), distance: n(j.distance), gain: n(j.gain),
        avgPower: n(j.avgPower), startD: n(j.startD), complete: !!j.complete, look: j.look && typeof j.look === 'object' ? cleanLook(j.look) : null, samples: j.samples.filter(s => Array.isArray(s)).map(s => s.slice(0, 6).map(n)) };
      state.shared = [...(state.shared || []).filter(x => !(x.rider === rec.rider && x.routeId === rec.routeId && x.date === rec.date)), rec];
      await db.kvSet('shared', state.shared);
      state.settings.ghost = 's:' + rec.id; saveSettings();
      toast(`${rec.rider} auf ${route.name} (${fmtTime(rec.duration)}) ist jetzt dein Gegner.`, 5000);
      if (state.view === 'detail' || state.view === 'library') import('./app.js').then(m => m.go('detail', route.id));
    } catch (e) { toast(`${f.name}: ${e.message}`); }
  }
  return rest;
}

export async function deleteShared(id) { state.shared = (state.shared || []).filter(x => x.id !== id); await db.kvSet('shared', state.shared); }

// ---------- live group ride ----------
let group = null;
export const currentGroup = () => (group?.open ? group : null);

/** lobby: open a group (host) or join one with a code. startRide(routeId, { group }) starts the ride. */
export function groupModal({ routeId = null, code = null, startRide }) {
  const name = riderName();
  const m = document.createElement('div'); m.className = 'modal';
  document.body.append(m);
  const close = () => { m.remove(); };
  const render = () => {
    const g = group, me = g?.me, others = g ? g.others() : [];
    if (!g) {
      m.innerHTML = `<div class="box"><div class="label">Zusammen fahren</div><h2 class="display">Live mit<br>Freunden</h2>
        <p>Jeder fährt zu Hause auf seinem Trainer. Ihr seht euch gegenseitig auf der Strecke und den Abstand in Metern. Ihr braucht beide RIDEFRAME und Internet.</p>
        <div class="actions" style="justify-content:flex-start;gap:10px;flex-wrap:wrap">
          <button class="btn" id="gHost">Gruppe erstellen</button>
          <input type="text" id="gCode" placeholder="Code" maxlength="5" style="width:110px;text-transform:lowercase" value="${esc(code || '')}">
          <button class="btn ghost" id="gJoin">Beitreten</button>
          <button class="btn ghost small" id="gLook2">Aussehen</button>
          <button class="btn ghost small" id="gClose" style="margin-left:auto">Schließen</button>
        </div><p id="gMsg"></p></div>`;
      m.querySelector('#gClose').onclick = close;
      m.querySelector('#gLook2').onclick = () => import('./avatar-ui.js').then(x => x.avatarModal());
      const go = async opts => {
        m.querySelector('#gMsg').textContent = 'Verbinde …';
        const g2 = new Group({ name, look: state.settings.look, ...opts, onChange: () => render(), onError: msg => { const el = m.querySelector('#gMsg'); if (el) el.textContent = msg; else toast(msg, 5000); },
          onStart: ({ routeId: rid, at }) => { const r = routeById(rid); if (!r) return toast('Diese Strecke hast du nicht.'); close(); setTimeout(() => startRide(rid, { group: g2 }), Math.max(0, at - Date.now())); toast('Gleich geht es los!', 3000); } });
        try { await g2.connect(); group = g2; if (g2.host && routeId) g2.setRoute(routeId); render(); }
        catch (e) { g2.close(); m.querySelector('#gMsg').textContent = e.message; }
      };
      m.querySelector('#gHost').onclick = () => go({});
      m.querySelector('#gJoin').onclick = () => { const c = m.querySelector('#gCode').value.trim().toLowerCase(); if (c.length === 5) go({ code: c }); else m.querySelector('#gMsg').textContent = 'Der Code hat 5 Zeichen.'; };
      if (code) m.querySelector('#gJoin').click();
      return;
    }
    const route = g.routeId ? routeById(g.routeId) : null;
    m.innerHTML = `<div class="box"><div class="label">Zusammen fahren · ${g.host ? 'Du bist Gastgeber' : 'Beigetreten'}</div>
      <div class="group-code">${esc(g.code)}</div>
      <p>${g.host ? 'Schick diesen Code deinen Freunden. Sie öffnen RIDEFRAME, klicken „Zusammen fahren“ und geben ihn ein.' : 'Warte, bis der Gastgeber startet. Der Start kommt bei allen gleichzeitig.'}</p>
      ${g.host ? `<div class="actions" style="justify-content:flex-start;gap:8px"><button class="btn ghost small" id="gCopy">Code kopieren</button><button class="btn ghost small" id="gLink">Link kopieren</button></div>` : ''}
      <div class="label" style="margin-top:18px">Strecke</div>
      <p style="color:var(--paper);font-weight:700">${route ? esc(route.name) + ' · ' + fmtKm(route.track.length) + ' km' : g.routeId ? 'Strecke „' + esc(g.routeId) + '“ fehlt bei dir' : 'Gastgeber wählt …'}</p>
      <div class="label">Fahrer (${others.length + 1})</div>
      <div class="group-list"><div><span>${esc(me.name)} (du)</span><span>${g.host ? 'Gastgeber' : ''}</span></div>${others.map(r => `<div><span>${esc(r.name)}</span><span>${r.riding ? 'fährt · ' + fmtKm(r.d) + ' km' : 'bereit'}</span></div>`).join('')}</div>
      <div class="actions">
        <button class="btn ghost small" id="gLeave">Gruppe verlassen</button>
        <button class="btn ghost small" id="gLook">Aussehen ändern</button>
        ${g.host ? `<button class="btn" id="gStart" ${route ? '' : 'disabled'}>Alle starten ▸</button>` : `<button class="btn ghost" id="gSolo" ${route ? '' : 'disabled'}>Schon mal losfahren</button>`}
      </div></div>`;
    m.querySelector('#gLook').onclick = () => import('./avatar-ui.js').then(x => x.avatarModal({ onDone: () => render() }));
    m.querySelector('#gLeave').onclick = () => { group?.close(); group = null; close(); toast('Gruppe verlassen'); };
    m.querySelector('#gCopy')?.addEventListener('click', () => navigator.clipboard?.writeText(g.code).then(() => toast('Code kopiert')));
    m.querySelector('#gLink')?.addEventListener('click', () => navigator.clipboard?.writeText(g.link).then(() => toast('Link kopiert. Klappt, wenn dein Freund RIDEFRAME auch unter dieser Adresse laufen hat.', 5000)));
    m.querySelector('#gStart')?.addEventListener('click', () => { const at = g.start(g.routeId); close(); toast('Start in 5 Sekunden für alle', 3000); setTimeout(() => startRide(g.routeId, { group: g }), Math.max(0, at - Date.now())); });
    m.querySelector('#gSolo')?.addEventListener('click', () => { close(); startRide(g.routeId, { group: g }); });
  };
  if (group?.open) { if (group.host && routeId && routeId !== group.routeId) group.setRoute(routeId); group.onChange = () => render(); }
  render();
}
