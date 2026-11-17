// Virtual gears on the Indoor page (no hardware, no deps): node tools/geartest.mjs
// Checks the gear -> trainer grade mapping in js/gears.js: higher gear = harder at the same cadence (the bike stays in one
// real gear, so same cadence = same wheel speed), the grade stays within what the trainer is sent (−10 … 20 %), the real
// gear sends the road grade unchanged, and the gear list falls back to the 3D ride's defaults.
const { gearSet, gearName, shiftGrade, virtualGrade, COG_TEETH } = await import('../js/gears.js');

let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${info && !cond ? ' · ' + info : ''}`); };
const MASS = 83.5, WHEEL = 2.105;

const d = gearSet({});
ok('defaults: 50/34 × 11-34, start gear 50×17', d.gears.length > 10 && gearName(d.gears[d.gi]) === '50×17', `${d.gears.length} ${gearName(d.gears[d.gi])}`);
ok('gears sorted easy -> hard', d.gears.every((g, i) => !i || g.ratio > d.gears[i - 1].ratio));
ok('bad cassette text falls back to 11-34', gearSet({ cassette: 'abc' }).gears.length === d.gears.length);
const cog = gearSet({ realGear: '50x' + COG_TEETH });
ok('Zwift Cog: start gear 50×14', gearName(cog.gears[cog.gi]) === '50×14');
ok('one chainring works too', gearSet({ chainrings: '40', cassette: '11-32' }).gears.every(g => g.f === 40));

for (const set of [d, cog, gearSet({ chainrings: '52,36', cassette: '11-28', realGear: '52x14' })]) {
  const real = set.real, bad = [], out = [];
  for (const cad of [50, 70, 90, 110]) for (const grade of [-10, -6, -3, -1, 0, 1, 3, 6, 10, 15, 20]) {
    const ws = cad / 60 * real.ratio * WHEEL; // wheel speed: fixed by the real gear and the cadence
    const g = set.gears.map(x => shiftGrade(grade, x.ratio / real.ratio, ws, MASS));
    if (g.some((x, i) => i && x < g[i - 1] - 1e-9)) bad.push(`${cad} rpm ${grade} %: ${g.map(x => x.toFixed(1)).join(' ')}`);
    if (g.some(x => !(x >= -10 && x <= 20))) out.push(`${cad} rpm ${grade} %`);
  }
  const tag = `${set.gears[0].f}-${set.gears.at(-1).f} real ${real.f}×${real.r}`;
  ok(`monotonic: a harder gear is never easier (${tag})`, !bad.length, bad.slice(0, 3).join(' | '));
  ok(`bounds −10 … 20 % (${tag})`, !out.length, out.join(' | '));
}
// strictly harder where it matters: flat and climbs at a normal cadence
{ const ws = 90 / 60 * d.real.ratio * WHEEL;
  for (const grade of [0, 4, 8]) { const g = d.gears.map(x => shiftGrade(grade, x.ratio / d.real.ratio, ws, MASS)), top = g.findIndex(x => x >= 20);
    ok(`strictly harder up to the 20 % cap at ${grade} %`, g.slice(0, top < 0 ? g.length : top + 1).every((x, i) => !i || x > g[i - 1]), g.map(x => x.toFixed(1)).join(' ')); } }
// the real gear = the plain road grade; uphill / flat = exactly the 3D ride's virtualGrade
for (const ws of [4, 8, 12]) for (const grade of [0, 2, 7, 15]) ok(`real gear sends the road grade (${grade} % at ${ws} m/s)`, Math.abs(shiftGrade(grade, 1, ws, MASS) - grade) < 1e-9);
ok('uphill: same as virtualGrade', [0.7, 1, 1.3, 1.8].every(k => Math.abs(shiftGrade(5, k, 8, MASS) - virtualGrade(5, k, 8, MASS)) < 1e-9));
// physically sensible size: one gear up on the flat at 30 km/h is a noticeable but small step (Zwift-like ~1-2 %)
{ const i = d.gi, ws = 30 / 3.6, a = shiftGrade(0, d.gears[i].ratio / d.real.ratio, ws, MASS), b = shiftGrade(0, d.gears[i + 1].ratio / d.real.ratio, ws, MASS);
  ok('one gear up on the flat: +0.3 … 3 %', b - a > 0.3 && b - a < 3, `${a.toFixed(2)} -> ${b.toFixed(2)}`); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
