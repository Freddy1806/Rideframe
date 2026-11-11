// Direct Strava upload, served by serve.mjs under /api/strava/* (only where RIDEFRAME is hosted, e.g. the Mac mini).
// The Strava app secret never reaches the browser: it lives in <data>/strava.json on the host:
//   { "client_id": "12345", "client_secret": "…", "public_url": "https://mac-mini-….ts.net" }
// Each browser that connects gets a random key (kept in its localStorage); the host keeps that rider's Strava tokens.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DATA = process.env.RIDEFRAME_DATA || join(homedir(), 'RIDEFRAME_data');
const CFG = join(DATA, 'strava.json'), TOK = join(DATA, 'strava_tokens.json');
const API = 'https://www.strava.com/api/v3';
const pending = new Map(); // oauth state -> time

const readJSON = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
async function saveTokens(t) { await mkdir(DATA, { recursive: true }); await writeFile(TOK, JSON.stringify(t, null, 1)); }
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const html = (res, body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:18px system-ui;background:#0b0b0b;color:#f4f4ef;display:grid;place-items:center;height:90vh;text-align:center">${body}`); };
async function body(req, max = 20e6) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw new Error('zu groß'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function baseUrl(req, cfg) {
  if (cfg.public_url) return cfg.public_url.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https')}://${host}`;
}

/** a valid access token for this key (refreshed when it runs out) */
async function access(key, cfg) {
  const all = await readJSON(TOK, {}), t = all[key];
  if (!t) return null;
  if (t.expires_at - 120 > Date.now() / 1000) return t.access_token;
  const r = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.client_id, client_secret: cfg.client_secret, grant_type: 'refresh_token', refresh_token: t.refresh_token }) });
  if (!r.ok) return null;
  const j = await r.json(); Object.assign(t, { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at });
  all[key] = t; await saveTokens(all); return t.access_token;
}

/** returns true when the request was an /api/strava call (answered here) */
export async function stravaApi(req, res, path) {
  if (!path.startsWith('/api/strava/')) return false;
  const cfg = await readJSON(CFG, {}), configured = !!(cfg.client_id && cfg.client_secret);
  const key = req.headers['x-strava-key'] || '', op = path.slice(12);
  try {
    if (op === 'status') {
      const t = key && (await readJSON(TOK, {}))[key];
      return send(res, 200, { configured, connected: !!t, athlete: t?.athlete || null }), true;
    }
    if (!configured) return send(res, 503, { error: 'Strava ist auf diesem Server noch nicht eingerichtet.' }), true;
    if (op === 'connect') {
      const state = randomBytes(12).toString('hex'); pending.set(state, Date.now());
      for (const [s, t] of pending) if (Date.now() - t > 15 * 60e3) pending.delete(s);
      const u = new URL('https://www.strava.com/oauth/authorize');
      u.search = new URLSearchParams({ client_id: cfg.client_id, response_type: 'code', redirect_uri: baseUrl(req, cfg) + '/api/strava/callback', approval_prompt: 'auto', scope: 'activity:write,read', state });
      res.writeHead(302, { Location: u.toString() }); res.end(); return true;
    }
    if (op.startsWith('callback')) {
      const q = new URL(req.url, 'http://x').searchParams;
      if (!pending.delete(q.get('state') || '')) return html(res, 'Die Anmeldung ist abgelaufen. Bitte im Spiel nochmal auf „Mit Strava verbinden“ klicken.'), true;
      if (q.get('error') || !q.get('code')) return html(res, 'Strava-Verbindung abgebrochen. Du kannst dieses Fenster schließen.'), true;
      if (!(q.get('scope') || '').includes('activity:write')) return html(res, 'Bitte beim Verbinden das Hochladen von Aktivitäten erlauben (Haken drin lassen) und nochmal versuchen.'), true;
      const r = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: cfg.client_id, client_secret: cfg.client_secret, code: q.get('code'), grant_type: 'authorization_code' }) });
      const j = await r.json();
      if (!r.ok) return html(res, 'Strava hat die Verbindung abgelehnt: ' + String(j.message || r.status).replace(/</g, '')
        + (r.status === 403 ? '<br><small>Neue Strava-Apps erlauben anfangs nur den Besitzer der App.</small>' : '')), true;
      const k = randomBytes(24).toString('hex'), all = await readJSON(TOK, {});
      all[k] = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, athlete: { id: j.athlete?.id, name: [j.athlete?.firstname, j.athlete?.lastname].filter(Boolean).join(' ') }, at: Date.now() };
      await saveTokens(all);
      return html(res, `<div>Mit Strava verbunden ✓<br><small>Das Fenster schließt sich gleich, sonst einfach schließen.</small></div><script>try{localStorage.setItem('rf_strava_key',${JSON.stringify(k)})}catch(e){}setTimeout(()=>window.close(),900);if(!window.opener)setTimeout(()=>location.href='/',1500)</script>`), true;
    }
    if (op === 'disconnect' && req.method === 'POST') { const all = await readJSON(TOK, {}); delete all[key]; await saveTokens(all); return send(res, 200, { ok: true }), true; }
    const tok = key && await access(key, cfg);
    if (!tok) return send(res, 401, { error: 'Nicht mit Strava verbunden.' }), true;
    if (op === 'upload' && req.method === 'POST') {
      const b = await body(req), fd = new FormData();
      fd.append('file', new Blob([b.tcx], { type: 'application/xml' }), 'rideframe.tcx');
      fd.append('data_type', 'tcx'); fd.append('name', String(b.name || 'RIDEFRAME').slice(0, 200));
      fd.append('description', String(b.description || '').slice(0, 2000)); fd.append('trainer', '1');
      if (b.external_id) fd.append('external_id', String(b.external_id).slice(0, 100));
      const r = await fetch(API + '/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd });
      const j = await r.json(); return send(res, r.ok ? 200 : r.status, r.ok ? { id: j.id_str || j.id, status: j.status, error: j.error } : { error: j.message || 'Upload fehlgeschlagen' }), true;
    }
    const m = op.match(/^upload\/(\d+)$/);
    if (m) {
      const r = await fetch(`${API}/uploads/${m[1]}`, { headers: { Authorization: 'Bearer ' + tok } }), j = await r.json();
      if (j.activity_id && !j.__marked) { // indoor ride: mark it as a virtual ride on the trainer (best effort)
        fetch(`${API}/activities/${j.activity_id}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ sport_type: 'VirtualRide', trainer: true }) }).catch(() => {});
      }
      return send(res, 200, { status: j.status, error: j.error, activity_id: j.activity_id || null }), true;
    }
    return send(res, 404, { error: 'unbekannt' }), true;
  } catch (e) { return send(res, 500, { error: String(e.message || e) }), true; }
}
