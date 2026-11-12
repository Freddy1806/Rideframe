// Tiny static server without dependencies: node serve.mjs  ->  http://localhost:8765
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stravaApi } from './tools/strava-api.mjs';
import { accountsApi } from './tools/accounts-api.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const port = +process.env.PORT || 8765;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p.startsWith('/api/') && (await accountsApi(req, res, p) || await stravaApi(req, res, p))) return; // direct Strava upload (tools/strava-api.mjs)
  if (p.endsWith('/')) p += 'index.html';
  const file = join(root, p);
  try {
    const st = await stat(file); if (!file.startsWith(root) || !st.isFile()) throw 0;
    // validators, so a second visit only asks "changed?" and gets 304 instead of downloading every model again (friends over the home upload line)
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`, head = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag, 'Last-Modified': st.mtime.toUTCString() };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
    res.writeHead(200, head);
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`RIDEFRAME läuft auf http://localhost:${port}`));
// the relay to the Unreal view rides along, so "In Unreal fahren" needs nothing extra to start
import('./tools/ue-relay.mjs').catch(e => console.log('Unreal-Relay aus:', e.message));
