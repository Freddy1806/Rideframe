// Strength numbers and texts shared by the Strength page (kraft.js) and the activity feed (feed.js): exercise names,
// set texts, volume, estimated 1RM and the Strava description. Pure functions, no page code.
import { fmtNum } from './util.js';

// t: w = weight × reps, bw = body weight (reps, optional extra kg), time = seconds
export const CATALOG = [
  ['squat', 'Squat (barbell)', 'w', 'Legs'], ['dead', 'Deadlift', 'w', 'Back'], ['rdl', 'Romanian deadlift', 'w', 'Legs'],
  ['bench', 'Bench press', 'w', 'Chest'], ['incline', 'Incline bench press (dumbbell)', 'w', 'Chest'], ['ohp', 'Overhead press', 'w', 'Shoulders'],
  ['row', 'Bent-over row (barbell)', 'w', 'Back'], ['lat', 'Lat pulldown', 'w', 'Back'], ['cable', 'Seated cable row', 'w', 'Back'],
  ['legpress', 'Leg press', 'w', 'Legs'], ['lunge', 'Lunges', 'w', 'Legs'], ['hipthrust', 'Hip thrust', 'w', 'Legs'],
  ['legcurl', 'Leg curl', 'w', 'Legs'], ['legext', 'Leg extension', 'w', 'Legs'], ['calf', 'Calf raises', 'w', 'Legs'],
  ['curl', 'Biceps curls', 'w', 'Arms'], ['tri', 'Triceps pushdown (cable)', 'w', 'Arms'], ['lateral', 'Lateral raises', 'w', 'Shoulders'], ['facepull', 'Face pulls', 'w', 'Shoulders'],
  ['pull', 'Pull-ups', 'bw', 'Back'], ['chin', 'Chin-ups', 'bw', 'Back'], ['dip', 'Dips', 'bw', 'Chest'], ['push', 'Push-ups', 'bw', 'Chest'],
  ['situp', 'Sit-ups', 'bw', 'Core'], ['legraise', 'Hanging leg raises', 'bw', 'Core'], ['burpee', 'Burpees', 'bw', 'Full body'], ['airsquat', 'Air squats', 'bw', 'Legs'],
  ['stepup', 'Step-ups', 'bw', 'Legs'], ['plank', 'Plank', 'time', 'Core'], ['sideplank', 'Side plank', 'time', 'Core'], ['wallsit', 'Wall sit', 'time', 'Legs'],
].map(([k, n, t, g]) => ({ k, n, t, g }));
export const nm = x => CATALOG.find(e => e.k === x.k)?.n || x.n;
export const e1rm = (kg, r) => kg > 0 && r > 0 ? (r === 1 ? kg : kg * (1 + r / 30)) : 0; // Epley, like Strong
export const vol = sets => sets.filter(s => s.done).reduce((a, s) => a + (+s.kg || 0) * (+s.r || 0), 0);
export const doneSets = s => (s.ex || []).reduce((a, x) => a + x.sets.filter(y => y.done).length, 0);
export const sessVol = s => (s.ex || []).reduce((a, x) => a + vol(x.sets), 0);
export const setTxt = (t, s) => !s ? '–' : t === 'time' ? `${+s.s || 0} s` : t === 'bw' ? `${+s.kg ? '+' + fmtNum(+s.kg, 1) + ' kg × ' : ''}${+s.r || 0} reps` : `${fmtNum(+s.kg || 0, 1)} kg × ${+s.r || 0}`;
export const nSets = n => `${n} ${n === 1 ? 'set' : 'sets'}`;
export const kgTxt = v => v >= 1000 ? fmtNum(v / 1000, 1) + ' t' : fmtNum(v) + ' kg';
export function stravaText(w) {
  return w.ex.map(x => { const d = x.sets.filter(y => !y.warm); const same = d.every(y => setTxt(x.t, y) === setTxt(x.t, d[0]));
    return `${nm(x)}: ${same ? `${d.length} × ${setTxt(x.t, d[0])}` : d.map(y => setTxt(x.t, y)).join(', ')}`; }).join('\n')
    + `\n\n${nSets(doneSets(w))} · ${kgTxt(sessVol(w))} volume${w.prs ? ` · 🏆 ${w.prs} ${w.prs === 1 ? 'record' : 'records'}` : ''}\nRecorded with RIDEFRAME Strength.`;
}
