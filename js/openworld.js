// Open world on the island (Freddy 20.11.: "with the arrow keys, the controller or the app decide where you turn").
// A free ride is a chain of legs, one road from junction to junction (assets/dem/legs/A-B.json, tools/island.mjs).
// 1.5 km before the junction a strip shows the roads you can take; ← → (keyboard), D-pad left / right (controller, phone remote),
// Zwift Click − / + (only while the strip shows) or the phone's turn buttons pick one. Nothing picked: the road that goes on
// most straight ahead. At the junction the next leg loads behind a short fade (time and km keep counting) - js/ride.js _swapLeg.
import { esc, fmtNum } from './util.js';
import { loadRealTrack } from './routes.js';

let MAP = null;
export const islandMap = () => MAP ||= fetch(new URL('../assets/dem/insel_map.json', import.meta.url)).then(r => r.json());

const ang = (x, y) => Math.atan2(x, -y); // compass heading, 0 = north
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
/** the roads leaving node n, each as { a, b, edge, out (heading out of n) } */
export function legsFrom(map, n) {
  const out = [];
  for (const e of map.edges) {
    if (e.a === n) { const P = e.P, k = Math.min(P.length - 1, 4); out.push({ a: n, b: e.b, edge: e, out: ang(P[k][0] - P[0][0], P[k][1] - P[0][1]) }); }
    if (e.b === n && e.a !== n) { const P = e.P, L = P.length - 1, k = Math.max(0, L - 4); out.push({ a: n, b: e.a, edge: e, out: ang(P[k][0] - P[L][0], P[k][1] - P[L][1]) }); }
  }
  return out;
}
export const legId = l => `legs/${l.a}-${l.b}`;
export async function legRoute(l, map) {
  const track = await loadRealTrack(legId(l)); if (!track) return null;
  const to = map.nodes[l.b]?.name || l.b;
  return { id: 'insel_frei', name: 'Island: Open world', place: `${l.edge.name} → ${to}`, source: 'demo', parts: [], track, leg: l };
}

export class OpenWorld {
  /** s: the RideSession; leg: the leg being ridden ({ a, b, edge }) */
  constructor(s, map, leg) { this.s = s; this.map = map; this.leg = leg; this.pick = -1; this.opts = null; this.busy = false; this.el = null; }
  _arrive() { // heading when reaching the junction (the leg's last metres), the options with their turn angle
    const E = this.leg.edge, P = this.leg.a === E.a ? E.P : [...E.P].reverse(), L = P.length - 1, k = Math.max(0, L - 4);
    const inH = ang(P[L][0] - P[k][0], P[L][1] - P[k][1]);
    const opts = legsFrom(this.map, this.leg.b).map(o => ({ ...o, turn: wrap(o.out - inH) }));
    const back = o => o.b === this.leg.a && o.edge.id === E.id && Math.abs(o.turn) > 2.4; // the way you came
    opts.sort((p, q) => p.turn - q.turn); // left to right
    let best = 0, bv = 1e9; opts.forEach((o, i) => { const v = Math.abs(o.turn) + (back(o) ? 10 : 0); if (v < bv) { bv = v; best = i; } });
    opts.forEach(o => { o.back = back(o); });
    return { opts, best };
  }
  tick() {
    const s = this.s, left = s.track.length - s.d;
    if (!this.opts && left < 1500) { const { opts, best } = this._arrive(); this.opts = opts; this.pick = best; this._show(); }
    if (this.el && this.opts) this.el.querySelector('.owdist').textContent = `${fmtNum(Math.max(0, left) / 1000, 1)} km`;
  }
  /** true when the strip took the input (so the ride does not also shift or steer the camera) */
  choose(dir) {
    if (!this.opts || this.busy) return false;
    this.pick = Math.max(0, Math.min(this.opts.length - 1, this.pick + dir)); this._show(); return true;
  }
  get open() { return !!this.opts && !this.busy; }
  _label(o) {
    const deg = o.turn * 180 / Math.PI, arrow = o.back ? '↩' : deg < -50 ? '⬅' : deg < -15 ? '⬉' : deg > 50 ? '➡' : deg > 15 ? '⬈' : '⬆';
    return `<span class="owarr">${arrow}</span><b>${esc(this.map.nodes[o.b]?.name || o.b)}</b><span>${esc(o.edge.name)} · ${fmtNum(o.edge.len / 1000, 0)} km</span>`;
  }
  _show() {
    const s = this.s; if (!s.el) return;
    if (!this.el) { this.el = document.createElement('div'); this.el.className = 'owturn'; s.el.append(this.el); }
    this.el.innerHTML = `<div class="owhead"><span class="label">Junction · ${esc(this.map.nodes[this.leg.b]?.name || '')} in <span class="owdist"></span></span><span class="owkeys">← → choose</span></div>
      <div class="owopts">${this.opts.map((o, i) => `<button type="button" class="owopt${i === this.pick ? ' on' : ''}" data-i="${i}">${this._label(o)}</button>`).join('')}</div>`;
    this.el.querySelectorAll('.owopt').forEach(b => b.onclick = () => { this.pick = +b.dataset.i; this._show(); });
    this.tick();
  }
  /** at the junction: the picked road (or straight on) */
  next() { if (this.opts) return this.opts[this.pick]; const { opts, best } = this._arrive(); return opts[best]; }
  done(leg) { this.leg = leg; this.opts = null; this.pick = -1; this.el?.remove(); this.el = null; }
}
