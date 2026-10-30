// Turns raw GPS points into a ride-able track: distance-indexed elevation, grade and video time.
export const STEP = 10; // metres between track samples

const R = 6371008.8;
const rad = d => d * Math.PI / 180;
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function binByTime(points, dt) {
  const out = []; let bin = null;
  for (const p of points) {
    const k = Math.floor(p.t / dt);
    if (!bin || bin.k !== k) { if (bin) out.push(bin); bin = { k, n: 0, t: 0, lat: 0, lon: 0, alt: 0, speed: 0, hasSpeed: true }; }
    bin.n++; bin.t += p.t; bin.lat += p.lat; bin.lon += p.lon; bin.alt += p.alt ?? 0;
    if (p.speed == null) bin.hasSpeed = false; else bin.speed += p.speed;
  }
  if (bin) out.push(bin);
  return out.map(b => ({ t: b.t / b.n, lat: b.lat / b.n, lon: b.lon / b.n, alt: b.alt / b.n, speed: b.hasSpeed ? b.speed / b.n : null }));
}

export function gaussianSmooth(arr, sigma) {
  if (sigma <= 0) return arr.slice();
  const r = Math.ceil(sigma * 3), w = [];
  for (let i = -r; i <= r; i++) w.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  return arr.map((_, i) => {
    let s = 0, ws = 0;
    for (let k = -r; k <= r; k++) { const j = i + k; if (j < 0 || j >= arr.length) continue; s += arr[j] * w[k + r]; ws += w[k + r]; }
    return s / ws;
  });
}

/** points: [{t (s, global video time), lat, lon, alt, speed?}] */
export function buildTrack(points) {
  points = points.filter(p => isFinite(p.lat) && isFinite(p.lon)).sort((a, b) => a.t - b.t);
  if (points.length < 5) throw new Error('Zu wenige GPS-Punkte. Hatte die GoPro GPS-Empfang?');
  let pts = binByTime(points, 0.5);
  // drop teleports (> 40 m/s)
  const clean = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = clean[clean.length - 1], b = pts[i];
    if (haversine(a, b) / Math.max(0.01, b.t - a.t) < 40) clean.push(b);
  }
  pts = clean;
  // cumulative distance: Doppler speed where available (no jitter while standing), else geometry
  const dist = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dt = b.t - a.t;
    const geo = haversine(a, b);
    let d = geo;
    if (a.speed != null && b.speed != null) {
      const v = (a.speed + b.speed) / 2;
      d = v < 0.7 ? 0 : v * dt;
    } else if (geo / dt < 0.7) d = 0;
    dist.push(dist[i - 1] + d);
  }
  const length = dist[dist.length - 1];
  if (length < 20) throw new Error('Die Strecke ist kürzer als 20 m.');
  // resample on a fixed distance grid
  const n = Math.floor(length / STEP) + 1;
  const time = [], lat = [], lon = [], altRaw = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = i * STEP;
    while (j < dist.length - 2 && dist[j + 1] < d) j++;
    const d0 = dist[j], d1 = dist[j + 1];
    const f = d1 > d0 ? Math.min(1, Math.max(0, (d - d0) / (d1 - d0))) : 0;
    const a = pts[j], b = pts[j + 1];
    time.push(a.t + (b.t - a.t) * f);
    lat.push(a.lat + (b.lat - a.lat) * f);
    lon.push(a.lon + (b.lon - a.lon) * f);
    altRaw.push(a.alt + (b.alt - a.alt) * f);
  }
  return finishTrack({ length, time, lat, lon, altRaw, eleSource: 'gps' });
}

/** (Re)compute smoothed elevation, grade and stats. Uses track.altRaw. */
export function finishTrack(track) {
  const sigma = track.eleSource === 'dem' ? 2 : 6; // GPS altitude is noisy -> smooth harder (~60 m)
  const ele = gaussianSmooth(track.altRaw, sigma);
  const k = 3;
  let grade = ele.map((_, i) => {
    const a = Math.max(0, i - k), b = Math.min(ele.length - 1, i + k);
    return b > a ? (ele[b] - ele[a]) / ((b - a) * STEP) * 100 : 0;
  });
  grade = gaussianSmooth(grade, 1.5).map(g => Math.max(-25, Math.min(25, g)));
  let gain = 0;
  for (let i = 1; i < ele.length; i++) if (ele[i] > ele[i - 1]) gain += ele[i] - ele[i - 1];
  // max grade averaged over 100 m
  let maxGrade = 0;
  for (let i = 0; i + 10 < ele.length; i++) maxGrade = Math.max(maxGrade, (ele[i + 10] - ele[i]) / (10 * STEP) * 100);
  const duration = track.time[track.time.length - 1] - track.time[0];
  return {
    ...track,
    ele: ele.map(v => Math.round(v * 10) / 10),
    grade: grade.map(v => Math.round(v * 10) / 10),
    gain: Math.round(gain),
    maxGrade: Math.round(maxGrade * 10) / 10,
    minEle: Math.min(...ele), maxEle: Math.max(...ele),
    duration,
    avgSpeed: track.length / Math.max(1, duration),
  };
}

/** Optional: replace GPS altitude with terrain model elevation (Open-Meteo, free, no key). */
export async function improveElevation(track, onProgress) {
  const every = 3; // one request point per 30 m
  const idx = [];
  for (let i = 0; i < track.lat.length; i += every) idx.push(i);
  if (idx[idx.length - 1] !== track.lat.length - 1) idx.push(track.lat.length - 1);
  const vals = [];
  for (let s = 0; s < idx.length; s += 100) {
    const chunk = idx.slice(s, s + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${chunk.map(i => track.lat[i].toFixed(6)).join(',')}&longitude=${chunk.map(i => track.lon[i].toFixed(6)).join(',')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Höhendienst nicht erreichbar');
    const j = await res.json();
    vals.push(...j.elevation);
    onProgress?.(Math.min(1, (s + 100) / idx.length));
  }
  const alt = track.altRaw.map((_, i) => {
    let k = Math.floor(i / every); if (k >= idx.length - 1) return vals[vals.length - 1];
    const i0 = idx[k], i1 = idx[k + 1]; const f = (i - i0) / (i1 - i0);
    return vals[k] + (vals[k + 1] - vals[k]) * f;
  });
  return finishTrack({ ...track, altRaw: alt, eleSource: 'dem' });
}

// ---------- lookups ----------
export function at(track, arr, d) {
  const x = Math.max(0, Math.min(track.length, d)) / STEP;
  const i = Math.min(arr.length - 2, Math.floor(x)), f = Math.min(1, x - i);
  return arr[i] + (arr[i + 1] - arr[i]) * f;
}
export const eleAt = (t, d) => at(t, t.ele, d);
export const gradeAt = (t, d) => at(t, t.grade, d);
export const timeAt = (t, d) => at(t, t.time, d);

/** Speed of the camera in the footage around distance d (m/s), averaged over ±40 m. */
export function videoSpeedAt(track, d) {
  const a = Math.max(0, d - 40), b = Math.min(track.length, d + 40);
  const dt = timeAt(track, b) - timeAt(track, a);
  return dt > 0.05 ? (b - a) / dt : 30;
}

/** Inverse lookup: which distance belongs to video time t. */
export function distAtTime(track, t) {
  const tm = track.time; let lo = 0, hi = tm.length - 1;
  if (t <= tm[0]) return 0; if (t >= tm[hi]) return track.length;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tm[m] <= t) lo = m; else hi = m; }
  const f = tm[hi] > tm[lo] ? (t - tm[lo]) / (tm[hi] - tm[lo]) : 0;
  return Math.min(track.length, (lo + f) * STEP);
}

// ---------- GPX ----------
export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const pts = [...doc.getElementsByTagName('trkpt')];
  if (!pts.length) throw new Error('Keine Trackpunkte in der GPX-Datei.');
  let t0 = null;
  return pts.map((p, i) => {
    const time = p.getElementsByTagName('time')[0]?.textContent;
    const ts = time ? Date.parse(time) / 1000 : i;
    if (t0 === null) t0 = ts;
    return { t: ts - t0, lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon'), alt: +(p.getElementsByTagName('ele')[0]?.textContent ?? 0), speed: null };
  });
}
