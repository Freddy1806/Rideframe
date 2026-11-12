// Player accounts on the host (tools/accounts-api.mjs): name + password, keeps settings (incl. the chosen rider) and all rides.
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
  if (r.status === 401 && acc && path !== 'login') { acc = null; store(null); }
  if (!r.ok) throw new Error(j.error || 'Server antwortet nicht');
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
  const localAt = (await db.kvGet('settingsAt').catch(() => 0)) || 0;
  if (me.settings && (preferServer || me.settingsAt > localAt)) {
    Object.assign(state.settings, me.settings); await db.kvSet('settings', state.settings); await db.kvSet('settingsAt', me.settingsAt);
  } else await pushSettings(state.settings, localAt || Date.now());
  const { ids } = await api('rides'), have = new Set(ids), local = await db.all('rides'), mine = new Set(local.map(r => r.id));
  for (const r of local) if (!have.has(r.id)) await pushRide(r);
  for (const id of ids) if (!mine.has(id)) { const r = await api('rides/' + id).catch(() => null); if (r?.id) await db.put('rides', r); }
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

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** login / register / logout dialog; resolves when closed. onChange() after login or logout. */
export function accountModal(state, onChange, { first = false } = {}) {
  return new Promise(done => {
    const m = document.createElement('div'); m.className = 'modal';
    const close = () => { m.remove(); done(); };
    if (acc) {
      m.innerHTML = `<div class="box"><div class="label">Konto</div><h2 class="display">${esc(acc.name)}</h2>
        <p>Deine Fahrten, Einstellungen und dein Fahrer werden auf dem Server gespeichert. Auf einem anderen Gerät einfach mit Name und Passwort anmelden.</p>
        <div class="actions"><button class="btn ghost" id="aOut">Abmelden</button><button class="btn" id="aOk">Fertig</button></div></div>`;
      document.body.append(m);
      m.querySelector('#aOk').onclick = close;
      m.querySelector('#aOut').onclick = async () => { await api('logout', { method: 'POST' }).catch(() => {}); acc = null; store(null); onChange?.(); close(); };
      return;
    }
    m.innerHTML = `<div class="box"><div class="label">${first ? 'Willkommen' : 'Konto'}</div><h2 class="display">Anmelden</h2>
      <p>Nur ein Name und ein Passwort, keine E-Mail. Dann sind deine Fahrten, Einstellungen und dein Fahrer gespeichert, auch auf anderen Geräten.</p>
      <div class="form">
        <div class="field"><div style="min-width:90px">Name</div><input type="text" id="aName" maxlength="24" autocomplete="username" autocapitalize="off" spellcheck="false"></div>
        <div class="field"><div style="min-width:90px">Passwort</div><input type="password" id="aPw" autocomplete="current-password"></div>
      </div>
      <p id="aErr" style="color:var(--accent);min-height:20px;margin-top:10px"></p>
      <div class="actions"><button class="btn ghost" id="aSkip" style="margin-right:auto">${first ? 'Ohne Konto weiter' : 'Abbrechen'}</button><button class="btn ghost" id="aNew">Neues Konto</button><button class="btn" id="aIn">Anmelden</button></div></div>`;
    document.body.append(m);
    const $ = s => m.querySelector(s), err = t => { $('#aErr').textContent = t; };
    $('#aName').focus();
    $('#aSkip').onclick = close;
    const go = async (op) => {
      const name = $('#aName').value.trim(), password = $('#aPw').value;
      if (!name || !password) return err('Bitte Name und Passwort eingeben.');
      m.querySelectorAll('button').forEach(b => b.disabled = true); err(op === 'register' ? 'Konto wird angelegt …' : 'Anmelden …');
      try {
        const j = await api(op, { method: 'POST', body: JSON.stringify({ name, password }) });
        acc = { token: j.token, name: j.name }; store(acc);
        err('Fahrten werden abgeglichen …');
        await syncAccount(state, op === 'login');
        onChange?.(); close();
      } catch (e) { err(e.message); m.querySelectorAll('button').forEach(b => b.disabled = false); }
    };
    $('#aIn').onclick = () => go('login'); $('#aNew').onclick = () => go('register');
    $('#aPw').onkeydown = e => { if (e.key === 'Enter') go('login'); };
  });
}
