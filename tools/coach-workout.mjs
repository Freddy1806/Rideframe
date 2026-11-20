// Coach workouts on the command line (js/coachworkouts.js, coach/README.md). Before a coach/workouts.json goes on the host:
//   node tools/coach-workout.mjs check <file>
// prints every workout (name, minutes, steps, highest target in W at the given FTP) and every error; exit code 1 on any error.
//   --ftp <W>  FTP for the %-steps (default 250)
import { readFileSync } from 'node:fs';
import { parseCoach } from '../js/coachworkouts.js';
import { setFtp, workoutDuration, pctAt } from '../js/workouts.js';

const args = process.argv.slice(2), fi = args.indexOf('--ftp'), ftp = fi >= 0 ? +args.splice(fi, 2)[1] : 250;
const [cmd, file] = args;
if (cmd !== 'check' || !file || !(ftp > 0)) { console.log('Usage: node tools/coach-workout.mjs check <file> [--ftp 250]'); process.exit(2); }
let txt; try { txt = readFileSync(file, 'utf8'); } catch (e) { console.log(`✗ cannot read ${file}: ${e.message}`); process.exit(1); }
setFtp(ftp);
const { workouts, errors } = parseCoach(txt);
for (const w of workouts) {
  const maxW = Math.max(...w.steps.map(s => s.watts ?? Math.round(Math.max(pctAt(s, 0), pctAt(s, s.dur)) / 100 * ftp)));
  console.log(`✓ ${w.id}  “${w.name}”  ${Math.round(workoutDuration(w) / 60)} min · ${w.steps.length} steps · max ${maxW} W${w.steps.some(s => s.watts == null) ? ` (% at FTP ${ftp} W)` : ''}`);
}
for (const e of errors) console.log(`✗ ${e}`);
console.log(`${workouts.length} workout${workouts.length === 1 ? '' : 's'} OK, ${errors.length} error${errors.length === 1 ? '' : 's'}.`);
process.exit(errors.length ? 1 : 0);
