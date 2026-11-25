// Offline check of recorded scale traffic (25.11.): reads the JSON lines that `scale-bridge --scan` / `--record` write and runs them
// through the SAME decoder as the server (tools/scale-decode.mjs), with the recorded times. Prints every decoded frame and each
// finished weigh-in. No Bluetooth, no server: run it anywhere (node 18+).
//   node tools/scale-bridge/replay.mjs scan.jsonl            decode and print
//   node tools/scale-bridge/replay.mjs scan.jsonl --post     also send the lines to the local server, like the bridge would
//                                                            (--server http://127.0.0.1:8765 --data ~/RIDEFRAME_data)
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../scale-decode.mjs';

/** lines: parsed JSON objects ({ kind, id, name, mfr, char, hex, at }); returns [{ at, id, model, frame?, weighIn? }] */
export function replayLines(lines) {
  const per = new Map(), out = []; let lastAt = 0;
  for (const l of lines) {
    const at = +l.at || lastAt + 200; lastAt = at;
    const p = per.get(l.id) || per.set(l.id, { s: D.session() }).get(l.id); if (l.name) p.name = l.name;
    // flush what settled in the meantime
    const fl = D.flush(p.s, at); p.s = fl.s; if (fl.out) out.push({ at, id: l.id, model: p.model, weighIn: fl.out });
    let f = null;
    if (l.kind === 'adv') { p.model = D.identify(p.name, l.mfr) || p.model; if (!p.model) continue; p.mac = D.macOf(p.model, l.mfr) || p.mac; f = D.decodeAdv(p.model, l.mfr); }
    else if (l.kind === 'notify' && p.model) f = D.decodeNotify(p.model, l.char, l.hex);
    if (f) out.push({ at, id: l.id, model: p.model, mac: p.mac, frame: f });
    const r = D.feed(p.s, f, at); p.s = r.s; if (r.out) out.push({ at, id: l.id, model: p.model, weighIn: r.out });
  }
  for (const [id, p] of per) { const r = D.flush(p.s, lastAt + 60e3); if (r.out) out.push({ at: lastAt, id, model: p.model, weighIn: r.out }); }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2), file = a.find(x => !x.startsWith('--') && !/^https?:/.test(x) && a[a.indexOf(x) - 1] !== '--server' && a[a.indexOf(x) - 1] !== '--data');
  if (!file) { console.error('usage: node tools/scale-bridge/replay.mjs <file.jsonl> [--post] [--server URL] [--data DIR]'); process.exit(2); }
  const lines = (await readFile(file, 'utf8')).split('\n').filter(x => x.trim()).map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
  const t0 = lines.find(l => l.at)?.at || 0, ts = t => `+${((t - t0) / 1000).toFixed(1)}s`;
  const evs = replayLines(lines), seen = new Set(evs.map(e => e.id));
  for (const e of evs) {
    if (e.frame) console.log(ts(e.at), e.id.slice(0, 8), e.model, e.mac || '', e.frame.quiet ? 'idle' : `${e.frame.final ? 'FINAL' : 'live '} ${e.frame.kg.toFixed(2)} kg`, e.frame.hr ? `hr ${e.frame.hr}` : '', e.frame.impedance ? `${e.frame.impedance} ohm` : '', e.frame.end ? '(end)' : '');
    else console.log(ts(e.at), e.id.slice(0, 8), e.model, '==> WEIGH-IN', e.weighIn.kg.toFixed(2), 'kg', e.weighIn.hr ? `hr ${e.weighIn.hr}` : '', e.weighIn.impedance ? `${e.weighIn.impedance} ohm` : '');
  }
  const unknown = [...new Set(lines.filter(l => l.kind === 'adv' && !seen.has(l.id) && !D.identify(l.name, l.mfr)).map(l => `${l.name || '(no name)'} ${String(l.mfr || '').slice(0, 8)}`))];
  if (unknown.length) console.log(`\nnot recognised as a eufy scale (${unknown.length}):`, unknown.slice(0, 20).join(' · '));
  if (a.includes('--post')) {
    const server = a[a.indexOf('--server') + 1] && a.includes('--server') ? a[a.indexOf('--server') + 1] : 'http://127.0.0.1:8765';
    const dir = a.includes('--data') ? a[a.indexOf('--data') + 1] : process.env.RIDEFRAME_DATA || join(homedir(), 'RIDEFRAME_data');
    const secret = (await readFile(join(dir, 'scale-bridge.secret'), 'utf8')).trim(); let prev = null;
    for (const l of lines) { if (l.at && prev) await new Promise(r => setTimeout(r, Math.min(6000, Math.max(50, l.at - prev)))); prev = l.at || prev;
      const r = await fetch(server + '/api/scale/frame', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret }, body: JSON.stringify(l) }); if (!r.ok) console.log('server', r.status, await r.text()); }
    await new Promise(r => setTimeout(r, 6000)); console.log('posted', lines.length, 'lines');
  }
}
