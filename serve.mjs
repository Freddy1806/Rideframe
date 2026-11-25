// Tiny static server without dependencies: node serve.mjs  ->  http://localhost:8765
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stravaApi } from './tools/strava-api.mjs';
import { accountsApi } from './tools/accounts-api.mjs';
import { watchApi } from './tools/watch-api.mjs';
import { workoutsApi } from './tools/workouts-api.mjs';
import { liveApi } from './tools/live-api.mjs';
import { remoteApi } from './tools/remote-api.mjs';
import { mcpApi } from './tools/mcp-api.mjs';
import { bodyApi } from './tools/body-api.mjs';
import { stravaLink, startStravaAuto } from './tools/strava-auto.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const port = +process.env.PORT || 8765;
const GZ = new Map(); // gzip cache: file -> { etag, buf }
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
// the link is public (Tailscale Funnel): a few headers every answer gets, and nothing but the game itself is handed out
const SAFE = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' };
const HIDDEN = /(^|\/)\.|^\/(tools|node_modules|qa)\/|^\/[^/]*\.(mjs|command|bat|sh|log|bak|zip)$/i; // dot files, server code, scripts, leftovers
createServer(async (req, res) => {
  for (const k in SAFE) res.setHeader(k, SAFE[k]);
  let p;
  try { p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, ''); }
  catch { res.writeHead(400); res.end('bad request'); return; } // a broken address (e.g. "/%") used to take the whole server down
  try {
    if (p.startsWith('/api/strava/')) await stravaLink(req, p).catch(() => {}); // a signed-in browser tells which account its Strava key belongs to (tools/strava-auto.mjs)
    if (await mcpApi(req, res, p)) return; // Claude connector: the MCP endpoint /mcp/<token> and its links in the settings (tools/mcp-api.mjs)
    if (p.startsWith('/api/') && (await workoutsApi(req, res, p) || await bodyApi(req, res, p) || await accountsApi(req, res, p) || await liveApi(req, res, p) || await watchApi(req, res, p) || await remoteApi(req, res, p) || await stravaApi(req, res, p))) return; // "Riding now" (tools/live-api.mjs), direct Strava upload (tools/strava-api.mjs), Garmin watches (tools/watch-api.mjs), phone remote (tools/remote-api.mjs), body data + the household scale (tools/body-api.mjs)
  } catch (e) { console.log('API-Fehler:', e?.message || e); if (!res.headersSent) res.writeHead(500); res.end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = join(root, p);
  try {
    if (HIDDEN.test(p)) throw 0;
    const st = await stat(file); if (!file.startsWith(root) || !st.isFile()) throw 0;
    // validators, so a second visit only asks "changed?" and gets 304 instead of downloading every model again (friends over the home upload line)
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`, head = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag, 'Last-Modified': st.mtime.toUTCString() };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
    // gzip for text and the terrain .bin files (dem 32 MB, compresses well); compressed once per file version and kept in memory. GLB/JPG are already packed.
    if (/\.(bin|json|js|mjs|css|html|svg)$/.test(file) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && st.size > 1024) {
      let z = GZ.get(file); if (!z || z.etag !== etag) { z = { etag, buf: gzipSync(await readFile(file), { level: 6 }) }; GZ.set(file, z); }
      res.writeHead(200, { ...head, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }); res.end(z.buf); return; }
    res.writeHead(200, head);
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`RIDEFRAME läuft auf http://localhost:${port}`));
startStravaAuto(); // new Strava activities into the linked accounts every 15 min, also while no RIDEFRAME page is open (tools/strava-auto.mjs)
process.on('unhandledRejection', e => console.log('Fehler (abgefangen):', e?.message || e)); // one bad request must never stop the game for everyone
// the relay to the Unreal view rides along, so "In Unreal fahren" needs nothing extra to start
import('./tools/ue-relay.mjs').catch(e => console.log('Unreal-Relay aus:', e.message));
