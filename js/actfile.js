// Activity files from any watch or bike computer (Garmin, Polar, Suunto, Wahoo, Coros …): .gpx, .tcx and .fit, read in the
// browser without any library. Everything ends up as one ride record in the shape outdoor.js writes:
// samples [sec, metres, watts, km/h, cadence, bpm, lat, lon, ele]. Pure functions (Node tests: tools/import-test.mjs).
import { typeFromText } from './sports.js';
import { normPower } from './stats.js';
import { bestAvg } from './util.js';

const ent = s => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e] ?? String.fromCharCode(+e.slice(1))).trim();
/** first <tag>…</tag> (any namespace prefix) inside s */
const tag = (s, t) => { const m = s.match(new RegExp(`<(?:[\\w-]+:)?${t}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${t}>`)); return m ? ent(m[1]) : null; };
const num = v => v == null || v === '' ? null : Number.isFinite(+v) ? +v : null;
const R = 6371008.8, rad = Math.PI / 180;
const hav = (a, b) => { const dLa = (b.lat - a.lat) * rad, dLo = (b.lon - a.lon) * rad, x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(x))); };

/** .gpx: <trkpt lat lon><ele/><time/><extensions> hr, cad, power (Garmin TrackPointExtension and the plain power tag) */
export function parseGPX(text) {
  if (!/<gpx[\s>]/i.test(text)) throw new Error('This is not a GPX file.');
  const pts = [];
  for (const m of text.matchAll(/<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g)) {
    const a = m[1], b = m[2] || '', at = k => num((a.match(new RegExp(`\\b${k}\\s*=\\s*["']([^"']+)`)) || [])[1]);
    pts.push({ t: Date.parse(tag(b, 'time') || ''), lat: at('lat'), lon: at('lon'), ele: num(tag(b, 'ele')), hr: num(tag(b, 'hr') ?? tag(b, 'heartrate')), cad: num(tag(b, 'cad') ?? tag(b, 'cadence')), w: num(tag(b, 'power') ?? tag(b, 'PowerInWatts')) });
  }
  const trk = (text.match(/<trk\b[^>]*>([\s\S]*?)<trkseg/) || [])[1] || '';
  return build(pts, { sportType: typeFromText(tag(trk, 'type')), name: tag(trk, 'name') || tag(text.split(/<trk\b/)[0], 'name') });
}

/** .tcx: Activity Sport="Running|Biking|Other", laps (timer time, calories), trackpoints with HR, cadence, watts, speed */
export function parseTCX(text) {
  if (!/<TrainingCenterDatabase[\s>]/.test(text)) throw new Error('This is not a TCX file.');
  const act = (text.match(/<Activity\b([^>]*)>/) || [])[1] || '', sport = (act.match(/Sport\s*=\s*["']([^"']+)/) || [])[1] || '';
  const pts = [];
  for (const m of text.matchAll(/<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint>/g)) {
    const b = m[1], hr = (b.match(/<HeartRateBpm\b[^>]*>([\s\S]*?)<\/HeartRateBpm>/) || [])[1];
    pts.push({ t: Date.parse(tag(b, 'Time') || ''), lat: num(tag(b, 'LatitudeDegrees')), lon: num(tag(b, 'LongitudeDegrees')), ele: num(tag(b, 'AltitudeMeters')), d: num(tag(b, 'DistanceMeters')),
      hr: hr ? num(tag(hr, 'Value')) : null, cad: num(tag(b, 'Cadence') ?? tag(b, 'RunCadence')), w: num(tag(b, 'Watts')), v: num(tag(b, 'Speed')) });
  }
  const laps = text.replace(/<Track\b[^>]*>[\s\S]*?<\/Track>/g, '').match(/<Lap\b[^>]*>[\s\S]*?<\/Lap>/g) || [], sum = k => laps.reduce((s, l) => s + (num(tag(l, k)) || 0), 0);
  const notes = tag(act ? text.split(/<\/Lap>/).pop() : '', 'Notes');
  return build(pts, { sportType: typeFromText(sport === 'Biking' ? 'Ride' : sport === 'Running' ? 'Run' : sport), timer: sum('TotalTimeSeconds') || null, kcal: sum('Calories') || null,
    lapDist: sum('DistanceMeters') || null, name: notes && notes.length < 80 ? notes : null });
}

// ---------------- FIT (Garmin's binary format): file_id, record, session and sport messages ----------------
const CRC_T = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];
/** the FIT checksum (CRC-16/ARC as in the FIT SDK) */
export function crc16(b) { let c = 0; for (const x of b) { let t = CRC_T[c & 15]; c = (c >> 4) & 0x0FFF; c = c ^ t ^ CRC_T[x & 15]; t = CRC_T[c & 15]; c = (c >> 4) & 0x0FFF; c = c ^ t ^ CRC_T[(x >> 4) & 15]; } return c; }
const FIT_EPOCH = 631065600; // 1989-12-31 00:00 UTC in Unix seconds
// base type (low 5 bits) -> [bytes, reader, invalid]
const BT = { 0: [1, 'Uint8', 0xFF], 1: [1, 'Int8', 0x7F], 2: [1, 'Uint8', 0xFF], 3: [2, 'Int16', 0x7FFF], 4: [2, 'Uint16', 0xFFFF], 5: [4, 'Int32', 0x7FFFFFFF], 6: [4, 'Uint32', 0xFFFFFFFF],
  8: [4, 'Float32', null], 9: [8, 'Float64', null], 10: [1, 'Uint8', 0], 11: [2, 'Uint16', 0], 12: [4, 'Uint32', 0], 13: [1, 'Uint8', 0xFF] };
// FIT sport (+ sub sport) -> Strava sport_type
const FSPORT = { 1: 'Run', 2: 'Ride', 4: 'Workout', 5: 'Swim', 6: 'Basketball', 7: 'Soccer', 8: 'Tennis', 10: 'Workout', 11: 'Walk', 12: 'NordicSki', 13: 'AlpineSki', 14: 'Snowboard', 15: 'Rowing',
  16: 'Hike', 17: 'Hike', 19: 'Kayaking', 21: 'EBikeRide', 25: 'Golf', 30: 'InlineSkate', 31: 'RockClimbing', 32: 'Sail', 33: 'IceSkate', 35: 'Snowshoe', 37: 'StandUpPaddling', 38: 'Surfing',
  41: 'Kayaking', 43: 'Windsurf', 44: 'Kitesurf' };
const fitType = (sp, sub) => sp === 2 && (sub === 6 || sub === 58) ? 'VirtualRide' : sp === 2 && sub === 8 ? 'MountainBikeRide' : sp === 1 && sub === 3 ? 'TrailRun'
  : (sp === 10 || sp === 4) && sub === 20 ? 'WeightTraining' : sp === 10 && sub === 43 ? 'Yoga' : sp === 10 && sub === 44 ? 'Pilates' : sp === 4 && sub === 14 ? 'VirtualRow'
  : sp === 4 && sub === 15 ? 'Elliptical' : sp === 4 && sub === 16 ? 'StairStepper' : FSPORT[sp] || '';

/** decodes the messages we need; throws on anything that is not a complete, undamaged FIT activity */
export function decodeFIT(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const hs = u8[0];
  if (u8.length < 14 || hs < 12 || String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) !== '.FIT') throw new Error('This is not a FIT file.');
  const end = hs + dv.getUint32(4, true);
  if (end + 2 > u8.length) throw new Error('The FIT file is incomplete.');
  if (hs >= 14 && dv.getUint16(12, true) !== 0 && crc16(u8.subarray(0, 14)) !== 0) throw new Error('The FIT file is damaged (header checksum).');
  if (crc16(u8.subarray(0, end + 2)) !== 0) throw new Error('The FIT file is damaged (checksum).');
  const defs = {}, out = { fileType: null, records: [], sessions: [], sports: [] };
  let p = hs, last = 0;
  const val = (size, bt, le) => {
    const b = BT[bt & 31];
    if (bt === 7 || (bt & 31) === 7) { let s = ''; for (let i = 0; i < size && u8[p + i]; i++) s += String.fromCharCode(u8[p + i]); try { return decodeURIComponent(escape(s)) || null; } catch { return s || null; } }
    if (!b || size < b[0]) return null; // 64-bit and unknown types: not needed
    const v = dv['get' + b[1]](p, le);
    return b[2] === null ? (Number.isFinite(v) ? v : null) : v === b[2] ? null : v;
  };
  const read = d => { const m = {}; for (const [n, size, bt] of d.fields) { if (p + size > end) throw new Error('The FIT file is damaged.'); m[n] = val(size, bt, d.le); p += size; } p += d.dev; return m; };
  const take = (g, m) => {
    if (g === 0) out.fileType = m[0];
    else if (g === 20 && m[253] != null) out.records.push({ t: (m[253] + FIT_EPOCH) * 1000, lat: m[0] != null ? m[0] * 180 / 2 ** 31 : null, lon: m[1] != null ? m[1] * 180 / 2 ** 31 : null,
      ele: m[78] != null ? m[78] / 5 - 500 : m[2] != null ? m[2] / 5 - 500 : null, hr: m[3], cad: m[4], d: m[5] != null ? m[5] / 100 : null, v: m[73] != null ? m[73] / 1000 : m[6] != null ? m[6] / 1000 : null, w: m[7] });
    else if (g === 18) out.sessions.push({ start: m[2] != null ? (m[2] + FIT_EPOCH) * 1000 : null, sport: m[5], sub: m[6], elapsed: m[7] != null ? m[7] / 1000 : null, timer: m[8] != null ? m[8] / 1000 : null,
      dist: m[9] != null ? m[9] / 100 : null, kcal: m[11], avgHr: m[16], maxHr: m[17], avgW: m[20], ascent: m[22] });
    else if (g === 12) out.sports.push({ sport: m[0], sub: m[1], name: m[3] || null });
  };
  while (p < end) {
    const h = u8[p++];
    if (h & 0x80) { // compressed timestamp header: 5 bits of seconds on top of the last full timestamp
      const d = defs[(h >> 5) & 3]; if (!d) throw new Error('The FIT file is damaged.');
      const off = h & 31; last = last - (last % 32) + off + (off < last % 32 ? 32 : 0);
      const m = read(d); if (m[253] == null) m[253] = last; take(d.g, m); continue;
    }
    if (h & 0x40) { // definition message
      if (p + 5 > end) throw new Error('The FIT file is damaged.');
      const le = u8[p + 1] === 0, g = dv.getUint16(p + 2, le), n = u8[p + 4]; p += 5; const fields = [];
      for (let i = 0; i < n; i++, p += 3) fields.push([u8[p], u8[p + 1], u8[p + 2]]);
      let dev = 0; if (h & 0x20) { const nd = u8[p++]; for (let i = 0; i < nd; i++, p += 3) dev += u8[p + 1]; }
      defs[h & 15] = { g, le, fields, dev }; continue;
    }
    const d = defs[h & 15]; if (!d) throw new Error('The FIT file is damaged.');
    const m = read(d); if (m[253] != null) last = m[253]; take(d.g, m);
  }
  return out;
}
/** .fit (ArrayBuffer / Uint8Array) -> record fields like parseGPX */
export function parseFIT(input) {
  const f = decodeFIT(input);
  if (f.fileType != null && f.fileType !== 4) throw new Error('This FIT file holds no activity (maybe a course or settings).');
  const ss = f.sessions, main = ss.slice().sort((a, b) => (b.timer || 0) - (a.timer || 0))[0], sp = main || f.sports[0] || {}, sum = k => ss.some(s => s[k] != null) ? ss.reduce((a, s) => a + (s[k] || 0), 0) : null;
  if (!f.records.length && !main) throw new Error('No activity data in this FIT file.');
  return build(f.records, { sportType: fitType(sp.sport, sp.sub), name: f.sports[0]?.name || null, timer: sum('timer'), elapsed: sum('elapsed'), lapDist: sum('dist'), kcal: sum('kcal'), gain: sum('ascent'),
    start: main?.start || null, avgHr: main?.avgHr || null, maxHr: main?.maxHr || null });
}

/** any of the three by its name / first bytes */
export function parseActivity(name, data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (/\.fit$/i.test(name) || (u8.length > 12 && String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) === '.FIT')) return parseFIT(u8);
  const text = new TextDecoder().decode(u8);
  if (/\.tcx$/i.test(name) || /<TrainingCenterDatabase[\s>]/.test(text)) return parseTCX(text);
  if (/\.gpx$/i.test(name) || /<gpx[\s>]/i.test(text)) return parseGPX(text);
  throw new Error('Unknown file type. Please choose a .gpx, .tcx or .fit file.');
}

/** points [{ t ms, lat, lon, ele, hr, cad, w, d (m, cumulative), v (m/s) }] + totals the file states -> record fields */
function build(raw, x = {}) {
  const pts = raw.filter(p => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  if (!pts.length) { if (x.timer > 0 && x.start) return { sportType: x.sportType || '', name: x.name, start: x.start, duration: Math.round(x.timer), elapsed: Math.round(x.elapsed || x.timer), distance: Math.round(x.lapDist || 0), gain: Math.round(x.gain || 0), avgHr: x.avgHr || 0, maxHr: x.maxHr || 0, kcal: x.kcal || 0, samples: [] };
    throw new Error('No timed track points in this file.'); }
  const t0 = pts[0].t; let d = 0, moving = 0, gain = 0, anchor = null, lastD = 0;
  const S = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[i - 1], dt = q ? (p.t - q.t) / 1000 : 0;
    const geo = p.lat != null && p.lon != null && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180, qgeo = q && q.lat != null && q.lon != null;
    if (p.d != null && p.d >= lastD) d = lastD = p.d; else if (p.d == null && geo && qgeo) d += hav(q, p);
    if (q && dt > 0 && dt <= 20) moving += dt; // longer gaps are pauses (auto-pause, stopped watch)
    if (p.ele != null) { if (anchor == null || p.ele < anchor) anchor = p.ele; else if (p.ele - anchor >= 2) { gain += p.ele - anchor; anchor = p.ele; } } // 2 m hysteresis against GPS noise
    const v = p.v != null ? p.v : q && dt > 0 && S.length ? Math.max(0, (d - S[S.length - 1][1]) / dt) : 0;
    const sec = Math.round((p.t - t0) / 1000);
    if (S.length && S[S.length - 1][0] === sec) continue; // more than one point per second: keep the first
    S.push([sec, Math.round(d), Math.round(p.w > 0 && p.w < 3000 ? p.w : 0), Math.round(Math.min(v, 60) * 36) / 10, Math.round(p.cad > 0 && p.cad < 255 ? p.cad : 0), Math.round(p.hr > 0 && p.hr < 255 ? p.hr : 0),
      geo ? +p.lat.toFixed(6) : null, geo ? +p.lon.toFixed(6) : null, p.ele != null ? Math.round(p.ele * 10) / 10 : null]);
  }
  const elapsed = Math.round((pts[pts.length - 1].t - t0) / 1000), hr = S.map(s => s[5]).filter(v => v > 0);
  // watts as a 1-second series (gaps up to 5 s carried, longer ones = 0), so NP and the best 5 / 20 minutes mean what they mean for recorded rides
  const pw = []; if (S.filter(s => s[2] > 0).length > S.length * 0.5) for (let i = 0; i < S.length; i++) { const nx = S[i + 1] ? S[i + 1][0] : S[i][0] + 1; for (let t = S[i][0]; t < nx; t++) pw.push(t - S[i][0] <= 5 ? S[i][2] : 0); }
  const out = { sportType: x.sportType || '', name: x.name || null, start: x.start || t0, elapsed: Math.round(x.elapsed || elapsed), duration: Math.round(x.timer > 0 ? x.timer : moving || elapsed),
    distance: Math.round(Math.max(d, x.lapDist || 0)), gain: Math.round(x.gain != null && x.gain >= 0 ? x.gain : gain),
    avgHr: x.avgHr || (hr.length ? Math.round(hr.reduce((a, b) => a + b, 0) / hr.length) : 0), maxHr: x.maxHr || (hr.length ? Math.max(...hr) : 0), kcal: Math.round(x.kcal || 0), samples: S };
  if (pw.length) Object.assign(out, { avgPower: Math.round(pw.reduce((a, b) => a + b, 0) / pw.length), np: Math.round(normPower(pw)), maxPower: Math.max(...pw), best5: bestAvg(pw, 300), best20: bestAvg(pw, 1200), kj: Math.round(pw.reduce((a, b) => a + b, 0) / 1000) });
  if (out.samples.length > 30000) { const k = Math.ceil(out.samples.length / 30000); out.samples = out.samples.filter((_, i) => i % k === 0); } // a very long day: every k-th point, the totals stay exact
  return out;
}
