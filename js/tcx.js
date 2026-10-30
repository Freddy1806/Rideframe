// Strava export: a ride as Garmin TCX (time, distance, speed, watts, cadence, heart rate; no GPS = virtual ride).
// Upload on strava.com/upload/select (Strava's own API needs a registered app + login, so we hand over the file).

/** samples: [t s, distance m, watts, km/h, rpm, bpm] */
export function toTCX(rec, name) {
  const start = new Date(rec.date - rec.duration * 1000), iso = t => new Date(start.getTime() + t * 1000).toISOString();
  const pts = rec.samples.map(([t, d, w, kmh, cad, hr]) => `<Trackpoint><Time>${iso(t)}</Time><DistanceMeters>${d}</DistanceMeters>`
    + (hr ? `<HeartRateBpm><Value>${hr}</Value></HeartRateBpm>` : '') + (cad ? `<Cadence>${Math.min(254, cad)}</Cadence>` : '')
    + `<Extensions><TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Speed>${(kmh / 3.6).toFixed(2)}</Speed><Watts>${w}</Watts></TPX></Extensions></Trackpoint>`).join('');
  const hrs = rec.samples.map(s => s[5]).filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
<Activities><Activity Sport="Biking"><Id>${start.toISOString()}</Id>
<Lap StartTime="${start.toISOString()}"><TotalTimeSeconds>${rec.duration}</TotalTimeSeconds><DistanceMeters>${rec.distance}</DistanceMeters>
<Calories>${Math.round(rec.avgPower * rec.duration / 1000 * 1.1)}</Calories>`
  + (hrs.length ? `<AverageHeartRateBpm><Value>${Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length)}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${Math.max(...hrs)}</Value></MaximumHeartRateBpm>` : '')
  + `<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod><Track>${pts}</Track>
<Notes>RIDEFRAME · ${name}</Notes></Lap><Notes>RIDEFRAME · ${name}</Notes></Activity></Activities></TrainingCenterDatabase>`;
}

/** Saves the .tcx and opens Strava's upload page next to it. */
export function stravaExport(rec, name) {
  const blob = new Blob([toTCX(rec, name)], { type: 'application/vnd.garmin.tcx+xml' });
  const a = document.createElement('a'), dt = new Date(rec.date), day = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}_${String(dt.getHours()).padStart(2, '0')}${String(dt.getMinutes()).padStart(2, '0')}`; // local time, so two rides a day don't overwrite each other
  a.href = URL.createObjectURL(blob); a.download = `RIDEFRAME_${day}_${name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.tcx`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  window.open('https://www.strava.com/upload/select', '_blank');
}
