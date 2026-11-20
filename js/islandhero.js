// The open-world island on the start page (Freddy 20.11.: "like the island map you sent me, animated, big on the start page,
// join right there, see who is where on the island, click him and jump to him").
// - Relief picture assets/dem/insel_hero.webp + roads, places and tours from assets/dem/insel_map.json (both by tools/island_hero.py).
// - The roads draw themselves in, then a light runs along them; the picture drifts slowly.
// - Friends riding an island tour are dots with their face and name at their km; a click asks to join them (app.js liveJoin).
// - A click on a place: start there (every tour that passes it, at its km). "Ride the island": the six tours.
import { esc, fmtNum } from './util.js';

let MAP = null;
const loadMap = () => MAP ||= fetch('assets/dem/insel_map.json').then(r => r.ok ? r.json() : null).catch(() => null);
const KIND = { coast: 'coast', cliff: 'coast', islet: 'coast', bridge: 'bridge', valley: 'valley', hills: 'valley', pass: 'pass', summit: 'summit' };
const kmTxt = m => fmtNum(m / 1000, m < 10000 ? 1 : 0);

/** where a rider is: the point at km d of an island tour (null when the tour is not on the island) */
export function riderPoint(map, routeId, d) {
  const lg = /^insel_frei:(\w+)-(\w+)$/.exec(routeId || ''); // open world: a road between two junctions
  if (lg) { const e = map.edges.find(x => (x.a === lg[1] && x.b === lg[2]) || (x.b === lg[1] && x.a === lg[2])); if (!e) return null;
    const P = e.a === lg[1] ? e.P : [...e.P].reverse(), f = Math.max(0, Math.min(1, d / e.len)) * (P.length - 1), i = Math.floor(f), j = Math.min(P.length - 1, i + 1), u = f - i;
    return [P[i][0] + (P[j][0] - P[i][0]) * u, P[i][1] + (P[j][1] - P[i][1]) * u]; }
  const t = map?.tours?.[routeId]; if (!t) return null;
  const f = Math.max(0, Math.min(t.P.length - 1, d / t.step)), i = Math.floor(f), j = Math.min(t.P.length - 1, i + 1), u = f - i;
  return [t.P[i][0] + (t.P[j][0] - t.P[i][0]) * u, t.P[i][1] + (t.P[j][1] - t.P[i][1]) * u];
}

/** el: an empty element on the start page. opts: { routeById, startRide, liveJoin, friendsNow, signedIn, face, fillFaces } */
export async function islandHero(el, opts) {
  const map = await loadMap(); if (!map || !el.isConnected) return;
  const [X0, Y0, X1, Y1] = map.extent, W = X1 - X0, H = Y1 - Y0;
  const pct = ([x, y]) => [((x - X0) / W * 100).toFixed(3), ((y - Y0) / H * 100).toFixed(3)];
  const tours = Object.entries(map.tours).filter(([id]) => opts.routeById(id));
  const roadKm = map.edges.reduce((s, e) => s + e.len, 0) / 1000;
  const pts = P => P.map(p => p.join(',')).join(' ');
  const roads = map.edges.map((e, i) => `<polyline class="ihr ${KIND[e.kind] || 'valley'}" data-e="${e.id}" points="${pts(e.P)}" pathLength="1000" style="--i:${i}"/>`).join('');
  const glow = map.edges.map((e, i) => `<polyline class="ihflow" points="${pts(e.P)}" pathLength="1000" style="--i:${i}"/>`).join('');
  const lakes = map.lakes.map(l => `<polygon class="ihlake" points="${pts(l)}"/>`).join('');
  const places = Object.entries(map.nodes).map(([k, n]) => { const [l, t] = pct(n.p);
    return `<button type="button" class="ihnode ${n.kind}${+l > 82 ? ' flip' : ''}" data-n="${k}" style="left:${l}%;top:${t}%"><i></i><span>${esc(n.name)}</span></button>`; }).join('');
  el.innerHTML = `<div class="ihero">
    <div class="ihmap" style="aspect-ratio:${map.size[0]} / ${map.size[1]}">
      <div class="ihdrift"><img src="assets/dem/${map.img}" alt="" draggable="false">
        <svg viewBox="${X0} ${Y0} ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${lakes}<g class="ihroads">${roads}</g><g class="ihglow">${glow}</g></svg>
        <div class="ihplaces">${places}</div><div class="ihriders"></div></div>
    </div>
    <div class="ihtext">
      <div class="label"><i class="ihlive"></i>Open world</div>
      <h1 class="display">The<br>island</h1>
      <div class="meta">${tours.length} routes · ${fmtNum(roadKm, 0)} km of roads · passes, castle, 5 km bridge</div>
      <div class="ihnow" aria-live="polite"></div>
      <div class="ihacts"><button class="btn" type="button" id="ihRide">Ride the island ▸</button></div>
    </div>
    <div class="ihpop" hidden></div>
  </div>`;
  const root = el.querySelector('.ihero'), pop = root.querySelector('.ihpop'), now = root.querySelector('.ihnow'), layer = root.querySelector('.ihriders');
  requestAnimationFrame(() => root.classList.add('in'));

  const close = () => { pop.hidden = true; root.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); };
  const show = (html, at) => {
    pop.innerHTML = `<button type="button" class="ihx" aria-label="Close">×</button>${html}`; pop.hidden = false;
    const r = root.getBoundingClientRect(), w = Math.min(320, r.width - 32);
    pop.style.width = w + 'px'; pop.style.left = Math.max(16, Math.min(r.width - w - 16, at[0] - w / 2)) + 'px';
    pop.style.top = Math.max(16, Math.min(r.height - pop.offsetHeight - 16, at[1] + 18)) + 'px';
    pop.querySelector('.ihx').onclick = close;
    pop.querySelectorAll('[data-ow]').forEach(b => b.onclick = () => { close(); const [a, c] = b.dataset.ow.split('-'); opts.startOpenWorld(a, c); });
    pop.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { close(); opts.startRide(b.dataset.go, +b.dataset.at ? { at: +b.dataset.at } : {}); });
  };
  const local = ev => { const r = root.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const legsHere = k => map.edges.flatMap(e => e.a === k ? [{ b: e.b, edge: e }] : e.b === k && e.a !== k ? [{ b: e.a, edge: e }] : []);
  const tourRow = (id, t, at, label) => `<button type="button" class="ihtour" data-go="${id}" data-at="${at}"><b>${esc(t.name.replace(/^Island:\s*/, ''))}</b><span>${label}</span></button>`;

  root.querySelector('#ihRide').onclick = ev => show(`<div class="label">Ride the island</div>
    ${opts.startOpenWorld ? `<button type="button" class="ihtour ihfree" data-ow="H-L"><b>Open world from Harbour Town</b><span>turn where you like</span></button><p class="hint">Or a fixed tour:</p>` : ''}
    ${tours.map(([id, t]) => tourRow(id, t, 0, `${kmTxt(t.len)} km · ${esc(opts.routeById(id)?.track ? fmtNum(opts.routeById(id).track.gain, 0) + ' m climbing' : '')}`)).join('')}`, local(ev));
  root.querySelectorAll('.ihnode').forEach(b => b.onclick = ev => {
    ev.stopPropagation(); close(); b.classList.add('sel'); const k = b.dataset.n, n = map.nodes[k];
    const here = tours.map(([id, t]) => { const v = t.nodes.find(x => x.id === k); return v ? [id, t, v.at] : null; }).filter(Boolean);
    show(`<div class="label">${esc(n.kind)} · ${fmtNum(n.z, 0)} m</div><h3>${esc(n.name)}</h3>
      ${opts.startOpenWorld ? `<p class="hint">Ride freely, turn wherever you like:</p>${legsHere(k).map(o => `<button type="button" class="ihtour" data-ow="${k}-${o.b}"><b>towards ${esc(map.nodes[o.b].name)}</b><span>${esc(o.edge.name)}</span></button>`).join('')}` : ''}
      ${here.length ? `<p class="hint">Or a tour from here:</p>${here.map(([id, t, at]) => tourRow(id, t, at, at ? `from km ${kmTxt(at)}` : 'start of the tour')).join('')}` : ''}`, local(ev));
  });
  root.querySelectorAll('.ihr').forEach(p => p.addEventListener('click', ev => {
    close(); const e = map.edges.find(x => x.id === p.dataset.e); p.classList.add('sel');
    const via = tours.filter(([id, t]) => { for (let i = 0; i < t.nodes.length - 1; i++) { const a = t.nodes[i].id, b = t.nodes[i + 1].id; if ((a === e.a && b === e.b) || (a === e.b && b === e.a)) return true; } return false; });
    show(`<div class="label">Road · ${kmTxt(e.len)} km</div><h3>${esc(e.name)}</h3>${via.length ? via.map(([id, t]) => tourRow(id, t, t.nodes.find(x => x.id === e.a || x.id === e.b)?.at || 0, 'ride it')).join('') : '<p class="hint">Not on a tour yet.</p>'}`, local(ev));
  }));
  root.querySelector('.ihmap').addEventListener('click', ev => { if (ev.target.closest('.ihnode,.ihrider') || ev.target.classList.contains('ihr')) return; close(); });

  // friends on the island, live (every 8 s while the page is visible)
  const draw = async () => {
    if (!root.isConnected) return stop();
    if (document.hidden) return;
    if (!opts.signedIn()) { now.innerHTML = '<span class="hint">Sign in to see who is on the island right now.</span>'; layer.innerHTML = ''; return; }
    const rs = (await opts.friendsNow()) || [], on = rs.filter(r => map.tours[r.routeId] || /^insel_frei:/.test(r.routeId || ''));
    now.innerHTML = on.length ? `<i class="lvdot" aria-hidden="true"></i><b>${on.length}</b> riding on the island now${rs.length > on.length ? ` · ${rs.length - on.length} elsewhere` : ''}` : '<span class="hint">Nobody on the island right now. Be the first.</span>';
    const keep = new Set();
    for (const r of on) {
      const p = riderPoint(map, r.routeId, r.d); if (!p) continue; const [l, t] = pct(p); keep.add(r.id);
      let d = layer.querySelector(`[data-sid="${CSS.escape(r.id)}"]`);
      if (!d) { d = document.createElement('button'); d.type = 'button'; d.className = 'ihrider'; d.dataset.sid = r.id; layer.append(d);
        d.innerHTML = `${opts.face ? opts.face(r) : ''}<span class="ihname"></span>`; opts.fillFaces?.(d); }
      d.style.left = l + '%'; d.style.top = t + '%';
      d.querySelector('.ihname').innerHTML = `<b>${esc(r.name)}</b> km ${kmTxt(r.d)}`;
      d.title = `${r.name} · ${r.routeName} · click to join`;
      const lg = /^insel_frei:(\w+)-(\w+)$/.exec(r.routeId || '');
      d.onclick = ev => { ev.stopPropagation(); if (lg && opts.startOpenWorld) opts.startOpenWorld(lg[1], lg[2], r.d); else opts.liveJoin(r); }; // open world: you start right where they are
    }
    layer.querySelectorAll('.ihrider').forEach(d => { if (!keep.has(d.dataset.sid)) d.remove(); });
  };
  const t = setInterval(draw, 8000), stop = () => clearInterval(t); draw();
}
