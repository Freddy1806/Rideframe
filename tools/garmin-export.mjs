// RIDEFRAME -> Garmin Connect, step 1 of 2 (owner 27.11.: "dass die Daten aus der App regelmäßig nach Garmin exportiert werden …
// über ein Skript, nicht über Drittanbieter"): writes every ride ONE account recorded in RIDEFRAME as a .tcx file into a folder.
// Step 2 (tools/garmin_upload.py, on the host only) uploads the files. Read only on the data folder; nothing here talks to Garmin.
//   node tools/garmin-export.mjs --user <account name> --out <folder> [--since 2026-11-01] [--data <RIDEFRAME_data>]
// What goes out: rides with per-second samples recorded here (trainer, virtual routes, outdoor page), newer than --since (default:
// the first run's own time, kept in <out>/state.json, so old rides are not pushed by surprise). What never goes out: activities that
// came FROM Strava or a file, hand-entered ones, strength, and rides the watch recorded too (Garmin has those already).
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const OVERLAP = 10 * 60e3;
const startOf = r => (+r.date || 0) - (+(r.elapsed || r.duration) || 0) * 1000;
/** the rides to hand to Garmin: [rec]; pure (tools/garmin-export-test.mjs) */
export function pick(rides, { since = 0, done = [] } = {}) {
  const have = new Set(done), watch = rides.filter(r => r && r.source === 'watch').map(r => +(r.start || startOf(r)) || 0);
  return rides.filter(r => r && r.id && !have.has(r.id) && !r.kraft && !r.unsaved && r.routeId !== 'demo'
    && !['strava', 'watch', 'file', 'manual'].includes(r.source) && !r.stravaId?.startsWith?.('imp')
    && Array.isArray(r.samples) && r.samples.length >= 60 && +r.date >= since
    && !watch.some(w => Math.abs(w - startOf(r)) < OVERLAP)).sort((a, b) => a.date - b.date);
}
export const fileName = r => { const d = new Date(startOf(r)), p = n => String(n).padStart(2, '0'); return `RIDEFRAME_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}_${String(r.id).replace(/[^\w-]/g, '')}.tcx`; };

const readJSON = async (f, dflt) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return dflt; } };
async function main(argv) {
  const arg = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
  const user = arg('user'), out = arg('out'), DATA = arg('data') || process.env.RIDEFRAME_DATA || join(homedir(), 'RIDEFRAME_data');
  if (!user || !out) { console.error('usage: node tools/garmin-export.mjs --user <account name> --out <folder> [--since YYYY-MM-DD]'); process.exit(2); }
  const acc = await readJSON(join(DATA, 'accounts.json'), { users: {} }), u = Object.values(acc.users || {}).find(x => String(x.name).toLowerCase() === user.toLowerCase());
  if (!u) { console.error('no such account'); process.exit(3); }
  await mkdir(out, { recursive: true });
  const sf = join(out, 'state.json'), S = await readJSON(sf, null) || { since: Date.now(), done: [] };
  if (arg('since')) S.since = Date.parse(arg('since')) || S.since;
  const dir = join(DATA, 'users', u.id, 'rides'), rides = [];
  for (const f of (await readdir(dir).catch(() => [])).filter(x => x.endsWith('.json'))) { const r = await readJSON(join(dir, f), null); if (r) rides.push(r); }
  const { toTCX } = await import('../js/tcx.js'); let n = 0;
  for (const r of pick(rides, S)) {
    const name = r.workout || r.routeName || r.name || 'Ride';
    await writeFile(join(out, fileName(r)), toTCX(r, name)); S.done.push(r.id); n++;
  }
  S.done = S.done.slice(-5000); S.at = Date.now(); await writeFile(sf, JSON.stringify(S));
  console.log(`garmin-export: ${n} new file(s), ${rides.length} ride(s) seen`); // counts only: never a name
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2));
