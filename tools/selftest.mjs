// Self-test for the built-in 3D route: runs the same road/terrain maths as the game (js/world/field.js)
// and checks what a rider would notice. Usage: node tools/selftest.mjs [--fast]
//  1. grade: road surface slope == grade the trainer gets
//  2. terrain mesh (as triangulated by the GPU at each detail level) never pokes through the asphalt
//  3. camera: always above the ground, on the road, view turns smoothly in curves
import { makeCoastTrack } from '../js/routes.js';
import { STEP, gradeAt } from '../js/track.js';
import { Field, ROAD_W, DS, loadDEM } from '../js/world/field.js';

const fast = process.argv.includes('--fast');
const track = makeCoastTrack(), f = new Field(track, await loadDEM()), L = track.length;
const res = []; let fail = 0;
const report = (name, ok, msg) => { res.push(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${msg}`); if (!ok) fail++; };

// --- 1. grade -------------------------------------------------------------------
{
  let worst = 0, at = 0, sum = 0, n = 0;
  for (let d = 0; d + 20 < L; d += 10) {
    const a = f.at(d), b = f.at(d + 20); // what the eye sees over ~20 m
    const vis = (b.e - a.e) / 20 * 100, tr = (gradeAt(track, d) + gradeAt(track, d + 10) + gradeAt(track, d + 20)) / 3;
    const e = Math.abs(vis - tr); sum += e; n++; if (e > worst) { worst = e; at = d; }
  }
  report('Steigung Bild = Trainer', worst < 1.0, `max Abweichung ${worst.toFixed(2)} % bei km ${(at / 1000).toFixed(2)}, Mittel ${(sum / n).toFixed(3)} %`);
}

// --- 2. terrain vs road --------------------------------------------------------
const cache = new Map();
let curS = 2;
const H = (x, z) => { const k = curS + ':' + x + ',' + z; let v = cache.get(k); if (v === undefined) { v = f.vertexHeight(x, z, curS); cache.set(k, v); } return v; };
function meshH(x, z, S) {
  curS = S; // height of the triangulated tile grid with spacing S (PlaneGeometry diagonal b-d)
  const x0 = Math.floor(x / S) * S, z0 = Math.floor(z / S) * S, u = (x - x0) / S, v = (z - z0) / S;
  const ha = H(x0, z0), hb = H(x0, z0 + S), hc = H(x0 + S, z0 + S), hd = H(x0 + S, z0);
  return u + v <= 1 ? ha + (hd - ha) * u + (hb - ha) * v : hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
}
for (const [S, name, tol] of [[2, 'nah (2 m Raster)', 0.0], [4, 'mittel (4 m Raster)', 0.0], [TILE_S(24), 'weit (8 m Raster)', 0.0], [TILE_S(12), 'fern (16 m Raster)', 0.0]]) {
  let bad = 0, worst = 0, at = 0, n = 0;
  for (let d = 0; d < L; d += fast ? 25 : (S > 4 ? 10 : 5)) {
    const p = f.at(d), l = Math.hypot(p.tx, p.tz), rx = -p.tz / l, rz = p.tx / l;
    for (let o = -ROAD_W; o <= ROAD_W + 1e-6; o += 0.55) {
      const x = p.x + rx * o, z = p.z + rz * o, road = f.road(x, z).e + 0.04; // road ribbon height there
      const over = meshH(x, z, S) - road - tol; n++;
      if (over > 0) { bad++; if (over > worst) { worst = over; at = d; } }
    }
    if (cache.size > 2e6) cache.clear();
  }
  report(`Gelände unter Straße ${name}`, bad === 0, bad ? `${bad}/${n} Punkte ragen bis ${worst.toFixed(2)} m durch, schlimmste bei km ${(at / 1000).toFixed(2)}` : `${n} Punkte ok`);
}
function TILE_S(res) { return 192 / res; }

// --- 3. camera -----------------------------------------------------------------
{
  let minClear = 99, minAt = 0, offRoad = 0, maxYawRate = 0, yawAt = 0, maxYawAcc = 0, accAt = 0;
  const fps = 60, dt = 1 / fps; let look = null, yawPrev = null, ratePrev = 0;
  for (let d = 0; d < L - 30;) {
    const g = gradeAt(track, d), v = g > 3 ? 4.2 : g < -3 ? 14 : 10; // m/s
    const p = f.pose(d);
    if (!look) look = { x: p.lx, y: p.ly, z: p.lz };
    const a = 1 - Math.exp(-dt * 7); look.x += (p.lx - look.x) * a; look.y += (p.ly - look.y) * a; look.z += (p.lz - look.z) * a;
    const clear = p.y - meshH(p.x, p.z, 2);
    if (clear < minClear) { minClear = clear; minAt = d; }
    if (f.road(p.x, p.z).d > ROAD_W - 0.3) offRoad++;
    const yaw = Math.atan2(look.x - p.x, look.z - p.z);
    if (yawPrev !== null) {
      let dy = yaw - yawPrev; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const rate = Math.abs(dy) / dt * 180 / Math.PI, acc = Math.abs(rate - ratePrev) / dt;
      if (rate > maxYawRate) { maxYawRate = rate; yawAt = d; }
      if (acc > maxYawAcc) { maxYawAcc = acc; accAt = d; }
      ratePrev = rate;
    }
    yawPrev = yaw; d += v * dt;
    if (cache.size > 2e6) cache.clear();
  }
  report('Kamera über Boden', minClear > 1.2, `min. Abstand ${minClear.toFixed(2)} m bei km ${(minAt / 1000).toFixed(2)}`);
  report('Kamera auf Fahrbahn', offRoad === 0, `${offRoad} Frames neben der Straße`);
  report('Kamera dreht ruhig', maxYawRate < 45, `max ${maxYawRate.toFixed(1)} °/s bei km ${(yawAt / 1000).toFixed(2)}`);
  report('Kamera ruckfrei', maxYawAcc < 400, `max Drehbeschleunigung ${maxYawAcc.toFixed(0)} °/s² bei km ${(accAt / 1000).toFixed(2)}`);
}

// --- 4. road never touches itself ------------------------------------------------
{
  let minGap = 1e9, at = 0;
  for (let j = 0; j < f.n; j += 4) {
    for (let k = j + 120; k < f.n; k += 4) { // > 300 m apart along the road
      const g = Math.hypot(f.x[j] - f.x[k], f.z[j] - f.z[k]);
      if (g < minGap) { minGap = g; at = j * DS; }
      if (g > 3000) k += 400;
    }
  }
  report('Straße kreuzt sich nicht', minGap > 2 * ROAD_W + 12, `kleinster Abstand zweier Abschnitte ${minGap.toFixed(1)} m bei km ${(at / 1000).toFixed(2)}`);
}

// --- 5. no code swallowed by a trailing comment (e.g. "a = 1; // note b = 2;") --------
{
  const fs = await import('node:fs'), path = await import('node:path');
  const dir = new URL('../js/', import.meta.url).pathname, bad = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') && fs.readFileSync(path.join(d, e.name), 'utf8').split('\n').forEach((l, i) => {
    const c = l.indexOf(' // '); if (c < 0 || !l.slice(0, c).trim() || /['"`]/.test(l.slice(c))) return;
    if (/;\s+(this\.|const |let |var |[A-Za-z_$][\w.$]*\s*=[^=>])/.test(l.slice(c))) bad.push(`${e.name}:${i + 1}`);
  }));
  walk(dir);
  report('Kein Code im Kommentar verschluckt', bad.length === 0, bad.length ? bad.join(', ') : 'ok');
}

console.log(res.join('\n'));
console.log(fail ? `\n${fail} Test(s) rot` : '\nAlles grün');
process.exit(fail ? 1 : 0);
