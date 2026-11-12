// Simple player accounts, served by serve.mjs under /api/account/* (only where RIDEFRAME is hosted, e.g. the Mac mini).
// Name + password only (Freddy's wish: no email, no security standards beyond a hashed password). Names are unique (case-insensitive).
// Stored in <data>/accounts.json; each account's rides in <data>/users/<id>/rides/<rideId>.json, settings (incl. the chosen rider) in settings.json.
import { readFile, writeFile, mkdir, readdir, unlink, stat, rm } from 'node:fs/promises';
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

/* the week starts Monday 00:00 local time (same key as js/story.js weekKey) */
const monday = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
const weekKey = () => { const d = monday(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let boardCache = null, boardGen = 0; // { at, week, rows } – rebuilt at most every 30 s; boardGen counts changes so a slow rebuild never caches stale rows
const sums = new Map(); /* file -> { m: mtime, date, km, hm } so a rebuild never re-parses big ride files */
/** what the leaderboard and profiles need of a ride (never the samples) */
const summary = (m, r) => ({ m, id: r?.id, date: +r?.date || 0, km: (+r?.distance || 0) / 1000, hm: +r?.gain || 0, demo: r?.routeId === 'demo', routeId: r?.routeId || '', routeName: r?.routeName || '', workout: r?.workout || '', dur: +r?.duration || 0, pw: +r?.avgPower || 0, complete: !!r?.complete });
/** a player's profile for everyone on this host: look, totals, the last 40 rides */
async function profile(u) {
  const rd = join(userDir(u.id), 'rides'), rides = [];
  for (const f of (await readdir(rd).catch(() => [])).filter(x => x.endsWith('.json'))) {
    const fp = join(rd, f), st = await stat(fp).catch(() => null); if (!st) continue;
    let c = sums.get(fp); if (!c || c.m !== st.mtimeMs) { c = summary(st.mtimeMs, await readJSON(fp, null)); sums.set(fp, c); }
    if (!c.demo && c.date) rides.push(c);
  }
  rides.sort((a, b) => b.date - a.date);
  const look = (await readJSON(join(userDir(u.id), 'settings.json'), null))?.settings?.look || null;
  const tot = rides.reduce((t, r) => ({ km: t.km + r.km, hm: t.hm + r.hm, dur: t.dur + r.dur }), { km: 0, hm: 0, dur: 0 });
  return { name: u.name, since: u.created || 0, look, count: rides.length, km: Math.round(tot.km * 10) / 10, hm: Math.round(tot.hm), dur: Math.round(tot.dur),
    rides: rides.slice(0, 40).map(({ m, demo, ...r }) => ({ ...r, km: Math.round(r.km * 10) / 10, hm: Math.round(r.hm) })) };
}

/** weekly leaderboard of every account on this host: km, Hm, minutes, ride days and the story points of the wager */
async function board(a) {
  const wk = weekKey();
  if (boardCache && boardCache.week === wk && Date.now() - boardCache.at < 30e3) return boardCache.rows;
  const since = monday().getTime(), rows = [], gen = boardGen;
  for (const u of Object.values(a.users || {})) {
    const dir = userDir(u.id), rd = join(dir, 'rides'); let km = 0, hm = 0; const days = new Set();
    for (const f of (await readdir(rd).catch(() => [])).filter(x => x.endsWith('.json'))) {
      const fp = join(rd, f), st = await stat(fp).catch(() => null); if (!st || st.mtimeMs < since) continue; /* old files are never this week's rides */
      let c = sums.get(fp);
      if (!c || c.m !== st.mtimeMs) { const r = await readJSON(fp, null); c = summary(st.mtimeMs, r); sums.set(fp, c); }
      if (!(c.date >= since) || c.demo) continue;
      km += c.km; hm += c.hm; days.add(new Date(c.date).toDateString());
    }
    const s = await readJSON(join(dir, 'story.json'), null), pts = s && s.week === wk ? s.pts : null, look = (await readJSON(join(dir, 'settings.json'), null))?.settings?.look || null;
    rows.push({ name: u.name, key: u.name.toLowerCase(), look, km: Math.round(km * 10) / 10, hm: Math.round(hm), days: days.size, pts: pts ? { wizard: +pts.wizard || 0, king: +pts.king || 0, devil: +pts.devil || 0 } : null });
  }
  rows.sort((x, y) => y.km - x.km || y.hm - x.hm);
  if (gen === boardGen) boardCache = { at: Date.now(), week: wk, rows }; return rows;
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
    if (op === 'board') { const rows = await board(a); return send(res, 200, { week: weekKey(), rows: rows.map(r => ({ ...r, me: r.key === t.key })) }); }
    if (op === 'story' && req.method === 'PUT') { /* only this week; per figure the higher value wins, so a second device with an empty ledger never wipes the points */
      const b = await body(req, 1e4), wk = weekKey(); if (b.week !== wk) return send(res, 200, { ok: true, ignored: true });
      const f = join(dir, 'story.json'), old = await readJSON(f, null), op0 = old?.week === wk ? old.pts || {} : {}, pts = {};
      for (const k of ['wizard', 'king', 'devil']) pts[k] = Math.max(+op0[k] || 0, Math.min(1e5, +b.pts?.[k] || 0));
      await writeJSON(f, { week: wk, pts, at: Date.now() }); boardCache = null; boardGen++; return send(res, 200, { ok: true }); }
    const pm = op.match(/^profile\/(.{1,40})$/);
    if (pm) { const v = a.users[decodeURIComponent(pm[1]).toLowerCase()]; return v ? send(res, 200, await profile(v)) : send(res, 404, { error: 'Unbekannter Fahrer.' }); }
    if (op === 'delete' && req.method === 'POST') { /* the whole account: login, settings, all rides, the wager points (wishes stay, they belong to everyone) */
      const b = await body(req, 1e4);
      if (!timingSafeEqual(Buffer.from(hash(String(b.password || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'))) return send(res, 401, { error: 'Passwort stimmt nicht.', keep: true });
      return await withAcc(async a => { delete a.users[t.key]; for (const [k, v] of Object.entries(a.tokens)) if (v.key === t.key) delete a.tokens[k];
        await writeJSON(ACC, a); await rm(dir, { recursive: true, force: true }); boardCache = null; boardGen++; return send(res, 200, { ok: true }); }); }
    if (op === 'wishes' || op.startsWith('wishes/')) return await wishes(req, res, op, u);
    if (op === 'rides') { const f = await readdir(join(dir, 'rides')).catch(() => []); return send(res, 200, { ids: f.filter(x => x.endsWith('.json')).map(x => x.slice(0, -5)) }); }
    const m = op.match(/^rides\/([\w-]{1,64})$/);
    if (m) {
      const f = join(dir, 'rides', m[1] + '.json');
      if (req.method === 'PUT') { await writeJSON(f, await body(req)); boardCache = null; boardGen++; return send(res, 200, { ok: true }); }
      if (req.method === 'DELETE') { await unlink(f).catch(() => {}); sums.delete(f); boardCache = null; boardGen++; return send(res, 200, { ok: true }); }
      const r = await readJSON(f, null); return r ? send(res, 200, r) : send(res, 404, { error: 'nicht gefunden' });
    }
    return send(res, 404, { error: 'unbekannt' });
  } catch (e) { return send(res, 500, { error: String(e.message || e) }); }
}

/* ---- wish list: every player writes wishes, everyone can +1 them; Freddy (RIDEFRAME_ADMIN, default "freddy") sets the status ---- */
const WISH = join(DATA, 'wishes.json'), STATUS = ['neu', 'geplant', 'in Arbeit', 'umgesetzt', 'nicht geplant'];
const ADMINS = new Set((process.env.RIDEFRAME_ADMIN || 'freddy').toLowerCase().split(',').map(x => x.trim()));
let wlock = Promise.resolve();
function withWishes(fn) { const run = wlock.then(async () => fn(await readJSON(WISH, { list: [] }))); wlock = run.catch(() => {}); return run; }
async function wishes(req, res, op, u) {
  const me = u.name.toLowerCase(), admin = ADMINS.has(me);
  const view = w => ({ id: w.id, by: w.by, text: w.text, at: w.at, status: w.status || 'neu', note: w.note || '', votes: w.votes.length, voted: w.votes.includes(me), mine: w.key === me });
  const out = l => send(res, 200, { admin, status: STATUS, list: l.map(view).sort((a, b) => (a.status === 'umgesetzt') - (b.status === 'umgesetzt') || b.votes - a.votes || b.at - a.at) });
  if (op === 'wishes' && req.method === 'GET') return out((await readJSON(WISH, { list: [] })).list);
  if (op === 'wishes' && req.method === 'POST') {
    const b = await body(req, 1e4), text = String(b.text || '').trim().replace(/\s+/g, ' ').slice(0, 500);
    if (text.length < 3) return send(res, 400, { error: 'Bitte einen Wunsch eintragen.' });
    return withWishes(async W => { if (W.list.filter(w => w.key === me && Date.now() - w.at < 864e5).length >= 30) return send(res, 429, { error: 'Heute schon 30 Wünsche, morgen wieder.' });
      W.list.push({ id: randomBytes(6).toString('hex'), key: me, by: u.name, text, at: Date.now(), votes: [me], status: 'neu' }); await writeJSON(WISH, W); return out(W.list); });
  }
  const m = op.match(/^wishes\/([0-9a-f]{12})(\/vote)?$/); if (!m) return send(res, 404, { error: 'unbekannt' });
  return withWishes(async W => {
    const w = W.list.find(x => x.id === m[1]); if (!w) return send(res, 404, { error: 'Wunsch nicht gefunden.' });
    if (m[2] && req.method === 'POST') { const i = w.votes.indexOf(me); i < 0 ? w.votes.push(me) : w.votes.splice(i, 1); }
    else if (req.method === 'DELETE') { if (w.key !== me && !admin) return send(res, 403, { error: 'Nur eigene Wünsche löschen.' }); W.list = W.list.filter(x => x !== w); }
    else if (req.method === 'PUT') { if (!admin) return send(res, 403, { error: 'Nur Freddy setzt den Status.' }); const b = await body(req, 1e4);
      if (STATUS.includes(b.status)) w.status = b.status; if (typeof b.note === 'string') w.note = b.note.trim().slice(0, 300); }
    else return send(res, 405, { error: 'nicht erlaubt' });
    await writeJSON(WISH, W); return out(W.list);
  });
}
