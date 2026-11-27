// Riding together: (1) share a ride as a file, a friend rides against it as a ghost;
// (2) group ride live with a 5-letter code (js/group.js).
import { db, uid } from './db.js';
import { state, toast, routeById, saveSettings, allRoutes } from './app.js';
import { Group, lastGroup, rejoinAt } from './group.js';
import { cleanLook } from './look.js';
import { esc, fmtTime, fmtKm } from './util.js';
import { account } from './account.js';

// ---------- name ----------
export function riderName(ask = true) {
  let n = state.settings.riderName || account()?.name || ''; // signed in: the account name, as in "Riding now"
  if (!n && ask) { try { n = (prompt('Your name (others see it when riding together)', '') || '').trim().slice(0, 20); } catch { n = ''; } if (n) { state.settings.riderName = n; saveSettings(); } }
  return n || 'Rider';
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
  a.download = `RIDEFRAME_${(route?.name || 'Ride').replace(/[^\wäöüÄÖÜß-]+/g, '_')}_${data.rider.replace(/[^\wäöüÄÖÜß-]+/g, '_')}_${fmtTime(rec.duration).replace(/:/g, '-')}.rideframe`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('File saved. Send it by WhatsApp or mail, for example; your friend drops it into their RIDEFRAME library.', 5000);
}

/** files dropped or picked: .rideframe (or .json with our type). Returns the files that were not ours. */
export async function importShared(files) {
  const rest = [];
  for (const f of files) {
    if (!/\.(rideframe|json)$/i.test(f.name)) { rest.push(f); continue; }
    try {
      const j = JSON.parse(await f.text());
      if (j?.type !== 'rideframe-ride' || !Array.isArray(j.samples) || !j.samples.length) throw new Error('not a RIDEFRAME ride');
      const route = routeById(String(j.routeId));
      if (!route) { toast(`You don't have the route “${j.routeName || j.routeId}”. For your own video routes, both of you must have imported them.`, 6000); continue; }
      const n = v => (Number.isFinite(+v) ? +v : 0);
      const rec = { id: uid(), rider: String(j.rider || 'Friend').slice(0, 20), routeId: route.id, date: n(j.date), duration: n(j.duration), distance: n(j.distance), gain: n(j.gain),
        avgPower: n(j.avgPower), startD: n(j.startD), complete: !!j.complete, look: j.look && typeof j.look === 'object' ? cleanLook(j.look) : null, samples: j.samples.filter(s => Array.isArray(s)).map(s => s.slice(0, 6).map(n)) };
      state.shared = [...(state.shared || []).filter(x => !(x.rider === rec.rider && x.routeId === rec.routeId && x.date === rec.date)), rec];
      await db.kvSet('shared', state.shared);
      state.settings.ghost = 's:' + rec.id; saveSettings();
      toast(`${rec.rider} on ${route.name} (${fmtTime(rec.duration)}) is now your opponent.`, 5000);
      if (state.view === 'detail' || state.view === 'library') import('./app.js').then(m => m.go('detail', route.id));
    } catch (e) { toast(`${f.name}: ${e.message}`); }
  }
  return rest;
}

export async function deleteShared(id) { state.shared = (state.shared || []).filter(x => x.id !== id); await db.kvSet('shared', state.shared); }

// ---------- live group ride ----------
let group = null;
export const currentGroup = () => (group?.open ? group : null);

/** a solo ride becomes a group ride (Freddy 15.11.): host a group right from the pause menu; friends join with the code
 *  and start next to you (the late-join start in group.js), you keep riding where you are */
export async function hostFromRide(routeId) {
  if (group?.open) return group;
  const g = new Group({ name: riderName(false), look: state.settings.look || null, onError: msg => toast(msg, 5000) });
  await g.connect(); g.setRoute(routeId); g.rolling = true; group = g; return g;
}

/** lobby: open a group (host) or join one with a code. startRide(routeId, { group }) starts the ride. */
export function groupModal({ routeId = null, code = null, startRide }) {
  globalThis.__rfMode ||= state.settings.worldMode || 'leer'; import('./world/lofoten.js').catch(() => {}); /* the models download while the group gathers, so "Alle starten" does not wait minutes */
  let name = riderName(false), autoJoined = false;
  const m = document.createElement('div'); m.className = 'modal';
  document.body.append(m);
  const close = () => m.remove();
  // the same frame as the ride's windows (owner 27.11. evening): "‹ Back" top left, the title once, the main action bottom right
  const head = `<div class="mhead"><button type="button" class="btn ghost rmback" id="gClose">‹ Back</button><h2 class="display">Ride together</h2></div>`;
  const foot = (left, main) => `<div class="mfoot"><div class="mfl">${left}</div>${main}</div>`;
  const render = () => {
    const g = group, me = g?.me, others = g ? g.others() : [];
    if (!g) {
      m.innerHTML = `<div class="box gbox">${head}
        <label class="field"><div>Your name</div><input type="text" id="gName" maxlength="20" placeholder="Name" value="${esc(state.settings.riderName || account()?.name || '')}"></label>
        <div class="field"><div>Join with a code</div><div class="gjoin"><input type="text" id="gCode" placeholder="Code" maxlength="5" aria-label="Group code" value="${esc(code || '')}"><button type="button" class="btn ghost" id="gJoin">Join</button></div></div>
        <p id="gMsg" class="gmsg"></p>
        ${foot('<button type="button" class="btn ghost" id="gLook2">Look</button>', '<button type="button" class="btn" id="gHost">Create group</button>')}</div>`;
      m.querySelector('#gClose').onclick = close;
      m.querySelector('#gLook2').onclick = () => import('./avatar-ui.js').then(x => x.avatarModal());
      const go = async opts => {
        const nn = (m.querySelector('#gName')?.value || '').trim().slice(0, 20);
        if (nn && nn !== state.settings.riderName) { state.settings.riderName = nn; saveSettings(); }
        name = nn || riderName(false);
        m.querySelector('#gMsg').textContent = 'Connecting …';
        const g2 = new Group({ name, look: state.settings.look, ...opts, onChange: () => render(), onError: msg => { const el = m.querySelector('#gMsg'); if (el) el.textContent = msg; else toast(msg, 5000); },
          onStart: ({ routeId: rid, at, d }) => { const r = routeById(rid); if (!r) return toast("You don't have this route."); close(); const own = rejoinAt(g2.code, rid, null), dd = own ?? d, el = own != null ? lastGroup()?.el || 0 : 0; setTimeout(() => startRide(rid, { group: g2, ...(dd ? { at: dd } : {}), elapsed0: el, catchUp: own == null }), Math.max(0, at - Date.now())); toast('Starting in a moment!', 3000); } });
        try { await g2.connect(); group = g2; const lg2 = opts.hostCode ? lastGroup() : null, lr = lg2?.routeId; if (g2.host && (routeId || lr)) g2.setRoute(routeId || lr);
          // host reopened his group after a reload: straight back onto the road at his own spot, the others reconnect by themselves
          if (lg2?.d > 0 && lr && routeById(lr)) { g2.rolling = true; close(); toast('Carrying on from where you were', 3000); startRide(lr, { group: g2, at: lg2.d, elapsed0: lg2.el || 0 }); return; }
          render(); }
        catch (e) { g2.close(); m.querySelector('#gMsg').textContent = e.message; }
      };
      const lg = lastGroup(); // you hosted a group in the last hours (page reloaded): the same code again, your friends reconnect by themselves
      m.querySelector('#gHost').onclick = () => go(lg?.host ? { hostCode: lg.code } : {});
      if (lg?.host) m.querySelector('#gHost').textContent = 'Reopen group ' + lg.code;
      else if (lg && !code) m.querySelector('#gCode').value = lg.code;
      m.querySelector('#gJoin').onclick = () => { const c = m.querySelector('#gCode').value.trim().toLowerCase(); if (c.length === 5) go({ code: c }); else m.querySelector('#gMsg').textContent = 'The code has 5 characters.'; };
      if (code && !autoJoined) { autoJoined = true; m.querySelector('#gJoin').click(); } // once: a re-render while connecting must not open a second connection
      return;
    }
    const route = g.routeId ? routeById(g.routeId) : null;
    m.innerHTML = `<div class="box gbox">${head}
      <div class="gcoderow"><div class="group-code">${esc(g.code)}</div><span class="gstat">${g.host ? 'You are the host' : 'Waiting for the host to start'}</span>
      ${g.host ? `<div class="gcopy"><button type="button" class="btn ghost small" id="gCopy">Copy code</button><button type="button" class="btn ghost small" id="gLink">Copy invite link</button></div>` : ''}</div>
      <div class="label" style="margin-top:18px">Route</div>
      ${g.host ? `<select id="gRoute" style="width:100%;margin-bottom:12px">${g.routeId ? '' : '<option value="">Choose route …</option>'}${allRoutes().map(r => `<option value="${esc(r.id)}" ${r.id === g.routeId ? 'selected' : ''}>${esc(r.name)} · ${fmtKm(r.track.length)} km</option>`).join('')}</select>`
        : `<p style="color:var(--paper);font-weight:700">${route ? esc(route.name) + ' · ' + fmtKm(route.track.length) + ' km' : g.routeId ? 'You are missing route “' + esc(g.routeId) + '”' : 'Host is choosing …'}</p>`}
      <div class="label">Riders (${others.length + 1})</div>
      <div class="group-list"><div><span>${esc(me.name)} (you)</span><span>${g.host ? 'Host' : ''}</span></div>${others.map(r => `<div><span>${esc(r.name)}</span><span>${r.riding ? 'riding · ' + fmtKm(r.d) + ' km' : 'ready'}</span></div>`).join('')}</div>
      ${foot('<button type="button" class="btn ghost" id="gLeave">Leave group</button><button type="button" class="btn ghost" id="gLook">Look</button>',
        g.host ? `<button type="button" class="btn" id="gStart" ${route ? '' : 'disabled'}>Start everyone ▸</button>` : `<button type="button" class="btn" id="gSolo" ${route ? '' : 'disabled'}>Start riding now ▸</button>`)}</div>`;
    m.querySelector('#gRoute')?.addEventListener('change', e => { if (e.target.value) g.setRoute(e.target.value); });
    m.querySelector('#gLook').onclick = () => import('./avatar-ui.js').then(x => x.avatarModal({ onDone: () => render() }));
    m.querySelector('#gClose').onclick = close; // the window closes, the group stays open (Ride together opens it again)
    m.querySelector('#gLeave').onclick = () => { group?.close(); group = null; close(); toast('Left the group'); };
    m.querySelector('#gCopy')?.addEventListener('click', () => navigator.clipboard?.writeText(g.code).then(() => toast('Code copied')));
    m.querySelector('#gLink')?.addEventListener('click', () => navigator.clipboard?.writeText(g.link).then(() => toast('Invite link copied', 3000)));
    m.querySelector('#gStart')?.addEventListener('click', () => { const at = g.start(g.routeId); close(); toast('Start in 5 seconds for everyone', 3000); const ra = rejoinAt(g.code, g.routeId); setTimeout(() => startRide(g.routeId, { group: g, ...(ra ? { at: ra } : {}) }), Math.max(0, at - Date.now())); });
    m.querySelector('#gSolo')?.addEventListener('click', () => { close(); const ra = rejoinAt(g.code, g.routeId); startRide(g.routeId, { group: g, ...(ra ? { at: ra } : {}) }); });
  };
  if (group?.open) { if (group.host && routeId && routeId !== group.routeId) group.setRoute(routeId); group.onChange = () => render(); }
  render();
}
