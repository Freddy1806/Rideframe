// Simple player accounts, served by serve.mjs under /api/account/* (only where RIDEFRAME is hosted, e.g. the Mac mini).
// Name + password only (Freddy's wish: no email, no security standards beyond a hashed password). Names are unique (case-insensitive).
// Stored in <data>/accounts.json; each account's rides in <data>/users/<id>/rides/<rideId>.json, settings (incl. the chosen rider) in settings.json.
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DATA = process.env.RIDEFRAME_DATA || join(homedir(), 'RIDEFRAME_data');
const ACC = join(DATA, 'accounts.json');
const readJSON = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
const writeJSON = async (f, o) => { await mkdir(join(f, '..'), { recursive: true }); await writeFile(f, JSON.stringify(o)); };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); return true; };
async function body(req, max = 20e6) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw new Error('zu groß'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const hash = (pw, salt) => scryptSync(String(pw), salt, 32).toString('hex');
const userDir = id => join(DATA, 'users', id);
let lock = Promise.resolve(); // serialise writes to accounts.json
function withAcc(fn) {
  const run = lock.then(async () => fn(await readJSON(ACC, { users: {}, tokens: {} })));
  lock = run.catch(() => {}); return run;
}

async function login(a, u) {
  const token = randomBytes(24).toString('hex'); a.tokens[token] = { key: u.name.toLowerCase(), at: Date.now() };
  await writeJSON(ACC, a); return token;
}

/** returns true when the request was an /api/account call (answered here) */
export async function accountsApi(req, res, path) {
  if (!path.startsWith('/api/account/')) return false;
  const op = path.slice(13), token = req.headers['x-rf-token'] || '';
  try {
    if (op === 'ping') return send(res, 200, { ok: true });
    if ((op === 'register' || op === 'login') && req.method === 'POST') {
      const b = await body(req, 1e4), name = String(b.name || '').trim().replace(/\s+/g, ' '), pw = String(b.password || '');
      if (name.length < 2 || name.length > 24 || !/^[\p{L}\p{N} ._-]+$/u.test(name)) return send(res, 400, { error: 'Name: 2–24 Zeichen (Buchstaben, Zahlen, Leerzeichen, . _ -).' });
      if (pw.length < 3) return send(res, 400, { error: 'Passwort: mindestens 3 Zeichen.' });
      return await withAcc(async a => {
        const k = name.toLowerCase(), u = a.users[k];
        if (op === 'register') {
          if (u) return send(res, 409, { error: `Den Namen „${u.name}“ gibt es schon.` });
          const salt = randomBytes(12).toString('hex');
          a.users[k] = { name, salt, hash: hash(pw, salt), id: randomBytes(8).toString('hex'), created: Date.now() };
          return send(res, 200, { token: await login(a, a.users[k]), name });
        }
        if (!u || !timingSafeEqual(Buffer.from(hash(pw, u.salt), 'hex'), Buffer.from(u.hash, 'hex'))) return send(res, 401, { error: 'Name oder Passwort stimmt nicht.' });
        return send(res, 200, { token: await login(a, u), name: u.name });
      });
    }
    const a = await readJSON(ACC, { users: {}, tokens: {} }), t = a.tokens[token], u = t && a.users[t.key];
    if (!u) return send(res, 401, { error: 'Nicht angemeldet.' });
    const dir = userDir(u.id);
    if (op === 'logout' && req.method === 'POST') return await withAcc(async a => { delete a.tokens[token]; await writeJSON(ACC, a); return send(res, 200, { ok: true }); });
    if (op === 'me') { const s = await readJSON(join(dir, 'settings.json'), null); return send(res, 200, { name: u.name, settings: s?.settings || null, settingsAt: s?.at || 0 }); }
    if (op === 'settings' && req.method === 'PUT') { const b = await body(req, 1e6); await writeJSON(join(dir, 'settings.json'), { settings: b.settings || {}, at: +b.at || Date.now() }); return send(res, 200, { ok: true }); }
    if (op === 'rides') { const f = await readdir(join(dir, 'rides')).catch(() => []); return send(res, 200, { ids: f.filter(x => x.endsWith('.json')).map(x => x.slice(0, -5)) }); }
    const m = op.match(/^rides\/([\w-]{1,64})$/);
    if (m) {
      const f = join(dir, 'rides', m[1] + '.json');
      if (req.method === 'PUT') { await writeJSON(f, await body(req)); return send(res, 200, { ok: true }); }
      if (req.method === 'DELETE') { await unlink(f).catch(() => {}); return send(res, 200, { ok: true }); }
      const r = await readJSON(f, null); return r ? send(res, 200, r) : send(res, 404, { error: 'nicht gefunden' });
    }
    return send(res, 404, { error: 'unbekannt' });
  } catch (e) { return send(res, 500, { error: String(e.message || e) }); }
}
