// The overview's card layout per account (25.11., js/cards.js, js/cardlayout.js): kept in the account's settings.json as
// settings.homeCards, like the other preferences, but with its own endpoint and time, so a device with older settings never
// throws away a newer arrangement (tools/accounts-api.mjs PUT settings keeps the newer homeCards too).
//   GET /api/account/home            -> { layout: stored layout or null }
//   PUT /api/account/home { layout } -> { layout: the one that is stored now (the newer of both), saved: true when it was this one }
import { join } from 'node:path';
import { accountOf, shared } from './accounts-api.mjs';
import { clean, newer } from '../js/cardlayout.js';

const { readJSON, writeJSON, send, body, limited, userDir } = shared;

export async function homeApi(req, res, path) {
  if (path !== '/api/account/home') return false;
  try {
    const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' });
    const f = join(userDir(me.u.id), 'settings.json'), s = await readJSON(f, null);
    if (req.method === 'GET') return send(res, 200, { layout: clean(s?.settings?.homeCards) });
    if (req.method !== 'PUT') return send(res, 405, { error: 'not allowed' });
    if (limited('home:' + me.key, 60, 60e3)) return send(res, 429, { error: 'Too many requests.' });
    const b = await body(req, 2e4), L = clean(b?.layout); if (!L) return send(res, 400, { error: 'layout: { at, cards: [{ id, size }], hidden: [id] } or { at, def: true }.' });
    const keep = newer(s?.settings?.homeCards, L), saved = keep === L || (keep && keep.at === L.at && JSON.stringify(keep) === JSON.stringify(L));
    if (saved) await writeJSON(f, { settings: { ...(s?.settings || {}), homeCards: L }, at: +s?.at || Date.now() }); // the settings' own time stays: this is no change of the other settings
    return send(res, 200, { layout: keep, saved: !!saved });
  } catch (e) { const bad = e instanceof SyntaxError || /too large/.test(e?.message || ''); return send(res, bad ? 400 : 500, { error: bad ? 'Bad request.' : 'Server error.' }); }
}
