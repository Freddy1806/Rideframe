// A running ride survives a reload, a crash or a closed tab (Freddy 20.11.: "wenn du neu startest, ist ja wieder alles weg").
// js/ride.js writes a checkpoint every 10 s of riding (and on pause, a hidden tab, pagehide) into kv 'rideDraft'; on the next
// start js/app.js offers Continue / Save as it is / Discard. Pure functions here (tested in tools/ridedraft-test.mjs).
export const DRAFT_KEY = 'rideDraft', DRAFT_EVERY = 10, DRAFT_MAX_AGE = 12 * 3600e3;
/** everything a RideSession needs to go on where it stopped (plain data; the samples are the big part, no JSON anywhere:
 *  IndexedDB clones the arrays itself). Positions, clocks, laps, workout clock and offsets, records for the saved ride. */
const KEYS = ['d', 'elapsed', 'lap', 'laps', 'lapOff', '_lapBase', '_lapT0', 'lapList', 'startD', 'lastSample', 'gainAcc', 'segDone', 'lapMarks',
  'manLaps', '_ml', '_mlJ', '_wT0', 'wAdj', 'wAdjE', '_adjAcc', '_adjT', '_stepAdj', '_ergSpans', 'wDone', '_wName', '_wId', 'erg', 'flatRide',
  'berg', 'virtual', 'auto', 'gi', '_holdW', '_jumps', 'manualPower', '_hadTr', '_hadHr', 'ftp'];

/** automated test browsers (navigator.webdriver) keep no drafts unless the page asks (?draft): the other UI tests reload in
 *  the middle of rides and must not meet the resume sheet or a "leave the page?" question. A real browser always does. */
export function draftOn() {
  if (typeof navigator === 'undefined' || !navigator.webdriver) return true;
  return typeof location !== 'undefined' && /[?&]draft(\b|=)/.test(location.search);
}

/** the checkpoint of a ride (r: a RideSession or anything with its fields) */
export function draftOf(r, now = Date.now()) {
  const o = { v: 1, savedAt: now, routeId: r.route.id, routeName: r.route.name || '', group: !!r.group, leg: !!r.route.leg,
    workout: r.workout || null, wDef: r._wDef || null, samples: r.samples, resumed: r.resumed || 0 };
  for (const k of KEYS) if (r[k] !== undefined) o[k] = r[k];
  return o;
}

/** put a checkpoint back into a ride (after its constructor ran): the clocks, position, samples and workout go on from there */
export function restoreDraft(r, dft) {
  for (const k of KEYS) if (dft[k] !== undefined) r[k] = Array.isArray(dft[k]) ? [...dft[k]] : dft[k] && typeof dft[k] === 'object' ? { ...dft[k] } : dft[k];
  r.samples = [...(dft.samples || [])]; r.powerHist = r.samples.map(s => s[2]); // the averages count every second ridden before
  r.workout = dft.workout || null; r._wDef = dft.wDef || dft.workout || null;
  const end = Math.round(dft.elapsed || 0); // an ERG span that was open when the page went: it ends there
  if (r._ergSpans) r._ergSpans = r._ergSpans.map(([a, b]) => [a, b ?? end]); r._ergOn = false;
  r._draftT = dft.elapsed || 0; r.resumed = (dft.resumed || 0) + 1;
  return r;
}

/** metres ridden in the draft (all laps), for the resume sheet */
export const draftRidden = dft => Math.max(0, (dft.lapOff || 0) + (dft.d || 0) - (dft._lapBase || 0));
/** a draft worth offering: has samples and is younger than 12 h */
export const draftUsable = (dft, now = Date.now()) => !!(dft && dft.samples?.length && now - (dft.savedAt || 0) < DRAFT_MAX_AGE);
