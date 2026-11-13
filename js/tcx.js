// Strava export: a ride as Garmin TCX (time, distance, speed, watts, cadence, heart rate; no GPS = virtual ride).
// Upload on strava.com/upload/select (Strava's own API needs a registered app + login, so we hand over the file).

import { eleAt as eleOf, STEP } from './track.js';

/** altitude along the route for the TCX; on real roads (Reine–Å, Küstenweg) it also carries .pos(d) -> [lat, lon], so Strava
 *  draws the ride on the map in Lofoten (Freddy 13.11.), uploaded as a virtual ride */
export function routeFns(track) {
  if (!track?.ele) return null;
  const f = d => eleOf(track, d), la = track.gpsLat, lo = track.gpsLon;
  if (la?.length > 1 && lo?.length === la.length) f.pos = d => { const x = Math.max(0, Math.min(la.length - 1.001, d / STEP)), i = Math.floor(x), t = x - i; return [la[i] + (la[i + 1] - la[i]) * t, lo[i] + (lo[i + 1] - lo[i]) * t]; };
  return f;
}

const xml = v => String(v).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

/** samples: [t s, distance m, watts, km/h, rpm, bpm]; eleAt(d) adds altitude so Strava shows the climbing */
export function toTCX(rec, name, eleAt = null) {
  name = xml(name); const d0 = rec.startD || 0;
  const start = new Date(rec.date - rec.duration * 1000), iso = t => new Date(start.getTime() + t * 1000).toISOString();
  const pts = rec.samples.map(([t, d, w, kmh, cad, hr]) => `<Trackpoint><Time>${iso(t)}</Time>`
    + (eleAt?.pos ? (([la, lo]) => `<Position><LatitudeDegrees>${la.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${lo.toFixed(6)}</LongitudeDegrees></Position>`)(eleAt.pos(d0 + d)) : '')
    + (eleAt ? `<AltitudeMeters>${eleAt(d0 + d).toFixed(1)}</AltitudeMeters>` : '') + `<DistanceMeters>${d}</DistanceMeters>`
    + (hr ? `<HeartRateBpm><Value>${hr}</Value></HeartRateBpm>` : '') + (cad ? `<Cadence>${Math.min(254, cad)}</Cadence>` : '')
    + `<Extensions><TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Speed>${(kmh / 3.6).toFixed(2)}</Speed><Watts>${w}</Watts></TPX></Extensions></Trackpoint>`);
  // laps (Freddy 12.11.: every climb counts as its own lap, like the lap button on a bike computer): split at rec.lapMarks (seconds)
  const marks = [...new Set((rec.lapMarks || []).map(Math.round))].filter(t => t > 0 && t < rec.duration).sort((a, b) => a - b), cuts = [0, ...marks, Infinity];
  const laps = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const idx = []; rec.samples.forEach((s, i) => { if (s[0] > cuts[k] - (k ? 0 : 1) && s[0] <= cuts[k + 1]) idx.push(i); }); if (!idx.length) continue;
    const ss = idx.map(i => rec.samples[i]), t0 = k ? cuts[k] : 0, t1 = Math.min(rec.duration, ss[ss.length - 1][0]), prevD = idx[0] > 0 ? rec.samples[idx[0] - 1][1] : 0;
    const w = ss.reduce((a, s) => a + s[2], 0) / ss.length, hrs = ss.map(s => s[5]).filter(Boolean);
    laps.push(`<Lap StartTime="${iso(t0)}"><TotalTimeSeconds>${Math.max(1, t1 - t0)}</TotalTimeSeconds><DistanceMeters>${Math.max(0, ss[ss.length - 1][1] - prevD)}</DistanceMeters>
<Calories>${Math.round(w * (t1 - t0) / 1000 * 1.1)}</Calories>`
      + (hrs.length ? `<AverageHeartRateBpm><Value>${Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length)}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${Math.max(...hrs)}</Value></MaximumHeartRateBpm>` : '')
      + `<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod><Track>${idx.map(i => pts[i]).join('')}</Track></Lap>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
<Activities><Activity Sport="Biking"><Id>${start.toISOString()}</Id>
${laps.join('\n')}<Notes>RIDEFRAME · ${name}</Notes></Activity></Activities></TrainingCenterDatabase>`;
}

/** Saves the .tcx and opens Strava's upload page next to it. */
export function stravaExport(rec, name, eleAt = null) {
  const blob = new Blob([toTCX(rec, name, eleAt)], { type: 'application/vnd.garmin.tcx+xml' });
  const a = document.createElement('a'), dt = new Date(rec.date), day = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}_${String(dt.getHours()).padStart(2, '0')}${String(dt.getMinutes()).padStart(2, '0')}`; // local time, so two rides a day don't overwrite each other
  a.href = URL.createObjectURL(blob); a.download = `RIDEFRAME_${day}_${name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.tcx`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  window.open('https://www.strava.com/upload/select', '_blank');
}
