// Player accounts on the host (tools/accounts-api.mjs): name + password + email (16.11.: welcome mail, "Passwort vergessen"), keeps settings (incl. the chosen rider) and all rides.
// Without the host (zip on localhost) this stays invisible and everything lives only in this browser as before.
import { db } from './db.js';

const KEY = 'rf_account';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const store = v => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch {} };
let acc = load(), available = null, pushT = 0;

export const account = () => acc;
async function api(path, opt = {}) {
  const r = await fetch('/api/account/' + path, { cache: 'no-store', ...opt, headers: { 'Content-Type': 'application/json', 'X-RF-Token': acc?.token || '', ...(opt.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && acc && path !== 'login' && !j.keep) { acc = null; store(null); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Server antwortet nicht'), { invite: !!j.invite });
  return j;
}
export async function accountsAvailable() {
  if (available === null) available = await fetch('/api/account/ping', { cache: 'no-store' }).then(r => r.ok, () => false);
  return available;
}

/** settings + rides both ways; preferServer = right after logging in to an existing account */
export async function syncAccount(state, preferServer = false) {
  if (!acc) return false;
  const me = await api('me');
  if (acc.email !== (me.email || '')) { acc.email = me.email || ''; store(acc); }
  if (!me.email && !emailAsked) { emailAsked = true; setTimeout(() => emailModal(), 600); } /* accounts from before 16.11.: ask once per visit */
  const localAt = (await db.kvGet('settingsAt').catch(() => 0)) || 0;
  if (me.settings && (preferServer || me.settingsAt > localAt)) {
    Object.assign(state.settings, me.settings); await db.kvSet('settings', state.settings); await db.kvSet('settingsAt', me.settingsAt);
  } else await pushSettings(state.settings, localAt || Date.now());
  const { ids } = await api('rides'), have = new Set(ids), local = await db.all('rides'), mine = new Set(local.map(r => r.id));
  for (const r of local) if (!have.has(r.id)) await pushRide(r);
  for (const id of ids) if (!mine.has(id)) { const r = await api('rides/' + id).catch(() => null); if (r?.id) await db.put('rides', r); }
  await syncKraft().catch(() => {});
  const L = await db.kvGet('story').catch(() => null); if (L) pushStory(L); /* the leaderboard shows this week's wager points too */
  return true;
}
async function pushSettings(settings, at) { if (acc) await api('settings', { method: 'PUT', body: JSON.stringify({ settings, at }) }); }

/** call after every local settings change */
export function settingsChanged(settings) {
  const at = Date.now(); db.kvSet('settingsAt', at).catch(() => {});
  if (!acc) return; clearTimeout(pushT); pushT = setTimeout(() => pushSettings(settings, at).catch(() => {}), 1500);
}
/** call after a ride was saved locally */
export async function pushRide(rec) { if (acc) await api('rides/' + rec.id, { method: 'PUT', body: JSON.stringify(rec) }).catch(() => {}); }

/** strength workouts (kraft.html) live in kv 'kraft' (newest first); both ways like the rides. Returns the merged list. */
export async function syncKraft() {
  const local = (await db.kvGet('kraft').catch(() => null)) || [];
  if (!acc) return local;
  const { ids } = await api('kraft'), have = new Set(ids), mine = new Set(local.map(w => w.id)), gone = new Set((await db.kvGet('kraftGone').catch(() => null)) || []);
  for (const w of local) if (!have.has(w.id)) await pushKraft(w);
  for (const id of gone) if (have.has(id)) await api('kraft/' + id, { method: 'DELETE' }).catch(() => {});
  for (const id of ids) if (!mine.has(id) && !gone.has(id)) { const w = await api('kraft/' + id).catch(() => null); if (w?.id) local.push(w); }
  local.sort((a, b) => b.date - a.date); await db.kvSet('kraft', local); await db.kvSet('kraftGone', []);
  return local;
}
export async function pushKraft(w) { if (acc) await api('kraft/' + w.id, { method: 'PUT', body: JSON.stringify(w) }).catch(() => {}); }
export async function deleteKraftRemote(id) { if (acc) await api('kraft/' + id, { method: 'DELETE' }); }

/** the wager's points of this week, for the friends leaderboard */
export async function pushStory(L) { if (acc && L?.week) await api('story', { method: 'PUT', body: JSON.stringify({ week: L.week, pts: L.pts }) }).catch(() => {}); }
/** weekly leaderboard of all accounts on this host (null without an account) */
export async function loadBoard() { return acc ? api('board').catch(() => null) : null; }

/** another player's profile (look, totals, last rides) */
/** everyone's best segment times on a route: { segs: { id: [{ name, t, w }] }, me } */
export async function loadSegBoard(routeId) { return acc ? api('segs/' + encodeURIComponent(routeId)).catch(() => null) : null; }
export const loadProfile = key => api('profile/' + encodeURIComponent(key));
/** delete one of my rides on the host too (otherwise the next sync brings it back) */
export async function deleteRideRemote(id) { if (acc) await api('rides/' + id, { method: 'DELETE' }); }

/** wish list of all players on this host: list / add / +1 / delete / status (Freddy) */
export const wishApi = {
  list: () => api('wishes'),
  add: text => api('wishes', { method: 'POST', body: JSON.stringify({ text }) }),
  vote: id => api(`wishes/${id}/vote`, { method: 'POST' }),
  del: id => api(`wishes/${id}`, { method: 'DELETE' }),
  set: (id, status, note) => api(`wishes/${id}`, { method: 'PUT', body: JSON.stringify({ status, note }) }),
};

let emailAsked = false;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** login / register / logout dialog; resolves when closed. onChange() after login or logout. */
export function accountModal(state, onChange, { first = false } = {}) {
  return new Promise(done => {
    const m = document.createElement('div'); m.className = 'modal';
    const close = () => { m.remove(); done(); };
    if (acc) {
      m.innerHTML = `<div class="box"><div class="label">Konto</div><h2 class="display">${esc(acc.name)}</h2>
        <p>Deine Fahrten, Einstellungen und dein Fahrer werden auf dem Server gespeichert. Auf einem anderen Gerät einfach mit Name (oder E-Mail) und Passwort anmelden.</p>
        <p style="margin-top:8px">E-Mail: <b>${acc.email ? esc(acc.email) : 'noch keine'}</b> · <button class="btn ghost small" id="aMail">${acc.email ? 'Ändern' : 'Hinzufügen'}</button></p>
        <div id="aDelBox" hidden style="margin-top:12px"><p>Konto, alle Fahrten, Einstellungen und Wett-Punkte werden endgültig gelöscht, auf dem Server und auf diesem Gerät. Zur Sicherheit dein Passwort:</p>
          <div class="field"><div style="min-width:90px">Passwort</div><input type="password" id="aDelPw" autocomplete="current-password"></div>
          <p id="aErr" style="color:var(--accent);min-height:20px;margin-top:8px"></p></div>
        <div class="actions"><button class="btn ghost" id="aDel" style="margin-right:auto">Konto löschen</button><button class="btn ghost" id="aOut">Abmelden</button><button class="btn" id="aOk">Fertig</button></div></div>`;
      document.body.append(m);
      m.querySelector('#aOk').onclick = close;
      m.querySelector('#aMail').onclick = () => { close(); emailModal(); };
      m.querySelector('#aDel').onclick = async () => {
        const box = m.querySelector('#aDelBox'); if (box.hidden) { box.hidden = false; m.querySelector('#aDel').textContent = 'Endgültig löschen'; m.querySelector('#aDelPw').focus(); return; }
        try { await api('delete', { method: 'POST', body: JSON.stringify({ password: m.querySelector('#aDelPw').value }) }); }
        catch (e) { m.querySelector('#aErr').textContent = e.message; return; }
        for (const r of await db.all('rides').catch(() => [])) await db.del('rides', r.id).catch(() => {});
        await db.kvSet('story', null).catch(() => {}); await db.kvSet('kraft', []).catch(() => {}); acc = null; store(null); onChange?.(); close();
      };
      m.querySelector('#aOut').onclick = async () => { await api('logout', { method: 'POST' }).catch(() => {}); acc = null; store(null); onChange?.(); close(); };
      return;
    }
    const F = (id, label, type, extra = '') => `<div class="field" data-f="${id}"><div style="min-width:110px">${label}</div><input type="${type}" id="${id}" ${extra}></div>`;
    m.innerHTML = `<div class="box"><div class="label">${first ? 'Willkommen' : 'Konto'}</div><h2 class="display" id="aH">Anmelden</h2>
      <p id="aTxt"></p>
      <div class="form">
        ${F('aName', 'Name', 'text', 'maxlength="60" autocomplete="username" autocapitalize="off" spellcheck="false"')}
        ${F('aMailIn', 'E-Mail', 'email', 'maxlength="200" autocomplete="email" autocapitalize="off" spellcheck="false" inputmode="email"')}
        ${F('aPw', 'Passwort', 'password', 'autocomplete="current-password"')}
        ${F('aPw2', 'Wiederholen', 'password', 'autocomplete="new-password"')}
        <div class="field" id="aInvRow" hidden><div style="min-width:110px">Einladung</div><input type="text" id="aInv" maxlength="60" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Code von Freddy"></div>
      </div>
      <p style="margin-top:8px"><button class="btn ghost small" id="aForgot">Passwort vergessen?</button></p>
      <p id="aErr" style="color:var(--accent);min-height:20px;margin-top:10px"></p>
      <div class="actions"><button class="btn ghost" id="aSkip" style="margin-right:auto">${first ? 'Ohne Konto weiter' : 'Abbrechen'}</button><button class="btn ghost" id="aSwitch"></button><button class="btn" id="aGo"></button></div></div>`;
    document.body.append(m);
    const $ = s => m.querySelector(s), err = t => { $('#aErr').textContent = t; };
    let mode = 'login';
    const show = md => { mode = md; err('');
      const vis = { login: ['aName', 'aPw'], register: ['aName', 'aMailIn', 'aPw', 'aPw2'], forgot: ['aMailIn'] }[md];
      m.querySelectorAll('[data-f]').forEach(f => f.hidden = !vis.includes(f.dataset.f));
      $('#aH').textContent = { login: 'Anmelden', register: 'Neues Konto', forgot: 'Passwort vergessen' }[md];
      $('#aTxt').textContent = { login: 'Mit Name oder E-Mail und Passwort. Dann sind deine Fahrten, Einstellungen und dein Fahrer gespeichert, auch auf anderen Geräten.',
        register: 'Name (sehen die anderen in der Rangliste), deine E-Mail (nur für „Passwort vergessen“, wird nie angezeigt) und ein Passwort mit mindestens 6 Zeichen.',
        forgot: 'Gib die E-Mail deines Kontos ein. Du bekommst einen Link, mit dem du ein neues Passwort festlegst.' }[md];
      $('[data-f="aName"] div').textContent = md === 'login' ? 'Name / E-Mail' : 'Name';
      $('#aPw').autocomplete = md === 'register' ? 'new-password' : 'current-password';
      $('#aForgot').hidden = md !== 'login';
      $('#aSwitch').textContent = md === 'login' ? 'Neues Konto' : 'Zur Anmeldung';
      $('#aGo').textContent = { login: 'Anmelden', register: 'Konto anlegen', forgot: 'Link schicken' }[md];
      (md === 'forgot' ? $('#aMailIn') : $('#aName')).focus(); };
    show('login');
    $('#aSkip').onclick = close;
    $('#aSwitch').onclick = () => show(mode === 'login' ? 'register' : 'login');
    $('#aForgot').onclick = () => { const v = $('#aName').value.trim(); if (v.includes('@')) $('#aMailIn').value = v; show('forgot'); };
    const busy = on => m.querySelectorAll('button').forEach(b => b.disabled = on);
    const go = async () => {
      const name = $('#aName').value.trim(), email = $('#aMailIn').value.trim(), password = $('#aPw').value, password2 = $('#aPw2').value;
      if (mode === 'forgot') {
        if (!email.includes('@')) return err('Bitte deine E-Mail-Adresse eingeben.');
        busy(true); err('Wird geschickt …');
        try { const j = await api('forgot', { method: 'POST', body: JSON.stringify({ email }) }); busy(false);
          err(j.mail ? 'Wenn es ein Konto mit dieser E-Mail gibt, ist der Link unterwegs. Schau auch im Spam-Ordner nach.' : 'Mails sind auf diesem Server noch nicht eingerichtet. Bitte Freddy fragen.'); }
        catch (e) { busy(false); err(e.message); } return;
      }
      if (!name || !password) return err(mode === 'login' ? 'Bitte Name (oder E-Mail) und Passwort eingeben.' : 'Bitte Name und Passwort eingeben.');
      if (mode === 'register') { if (!email.includes('@')) return err('Bitte deine E-Mail-Adresse eingeben.'); if (password.length < 6) return err('Passwort: mindestens 6 Zeichen.'); if (password !== password2) return err('Die beiden Passwörter sind nicht gleich.'); }
      busy(true); err(mode === 'register' ? 'Konto wird angelegt …' : 'Anmelden …');
      try {
        const j = await api(mode, { method: 'POST', body: JSON.stringify({ name, password, ...(mode === 'register' ? { email, password2 } : {}), invite: $('#aInv').value.trim() || undefined }) });
        acc = { token: j.token, name: j.name }; store(acc); emailAsked = mode === 'register';
        err('Fahrten werden abgeglichen …');
        await syncAccount(state, mode === 'login');
        onChange?.(); close();
      } catch (e) { err(e.message); busy(false);
        if (e.invite) { $('#aInvRow').hidden = false; $('#aInv').focus(); } } // this host only takes new riders with an invitation code
    };
    $('#aGo').onclick = go;
    m.querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') go(); });
  });
}

/** add / change the email of the signed-in account (accounts from before 16.11. have none) */
export function emailModal() {
  if (!acc || document.querySelector('#eMailBox')) return;
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'eMailBox';
  m.innerHTML = `<div class="box"><div class="label">Konto · ${esc(acc.name)}</div><h2 class="display">E-Mail ${acc.email ? 'ändern' : 'hinzufügen'}</h2>
    <p>${acc.email ? '' : 'Neu: Mit deiner E-Mail kannst du dein Passwort zurücksetzen, falls du es vergisst. Sie wird nirgends angezeigt. '}Zur Sicherheit brauchen wir einmal dein Passwort.</p>
    <div class="form"><div class="field"><div style="min-width:110px">E-Mail</div><input type="email" id="eMail" maxlength="200" autocomplete="email" autocapitalize="off" spellcheck="false" inputmode="email" value="${esc(acc.email || '')}"></div>
      <div class="field"><div style="min-width:110px">Passwort</div><input type="password" id="ePw" autocomplete="current-password"></div></div>
    <p id="eErr" style="color:var(--accent);min-height:20px;margin-top:10px"></p>
    <div class="actions"><button class="btn ghost" id="eLater" style="margin-right:auto">${acc.email ? 'Abbrechen' : 'Später'}</button><button class="btn" id="eSave">Speichern</button></div></div>`;
  document.body.append(m);
  const $ = s => m.querySelector(s); $('#eMail').focus();
  $('#eLater').onclick = () => m.remove();
  const save = async () => {
    const email = $('#eMail').value.trim(); if (!email.includes('@')) { $('#eErr').textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.'; return; }
    $('#eSave').disabled = true;
    try { const j = await api('email', { method: 'PUT', body: JSON.stringify({ email, password: $('#ePw').value }) }); acc.email = j.email; store(acc); m.remove(); }
    catch (e) { $('#eErr').textContent = e.message; $('#eSave').disabled = false; }
  };
  $('#eSave').onclick = save; m.querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') save(); });
}
