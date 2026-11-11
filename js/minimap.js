// Mini map like in kart games: the whole route from above (north up), the stretch already ridden in orange,
// you as a big dot with a ring, ghost and friends as small coloured dots. Drawn on a small canvas in the ride HUD.
const ME = '#ff5a1f';

export class MiniMap {
  /** pose = optional (d) => {x, z} of the 3D world road (its real bends); otherwise the GPS track (north up) */
  constructor(canvas, track, pose = null) {
    this.c = canvas; this.track = track; this.pts = [];
    if (pose) {
      const N = 600; for (let i = 0; i <= N; i++) { const p = pose(i / N * (track.length - 1)); if (p && isFinite(p.x) && isFinite(p.z)) this.pts.push([p.x, p.z]); }
    } else {
      const la = track.lat, lo = track.lon;
      if (!la?.length || la.length !== lo?.length) return;
      const n = la.length, step = Math.max(1, Math.floor(n / 600)), k = Math.cos(la[0] * Math.PI / 180);
      for (let i = 0; i < n; i += step) this.pts.push([lo[i] * k, -la[i]]);
      if ((n - 1) % step) this.pts.push([lo[n - 1] * k, -la[n - 1]]);
    }
    if (this.pts.length < 2) { this.pts = []; return; }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of this.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    this.box = { x0, y0, w: x1 - x0 || 1e-9, h: y1 - y0 || 1e-9 };
    let len = 0; for (let i = 1; i < this.pts.length; i++) len += Math.hypot(this.pts[i][0] - this.pts[i - 1][0], this.pts[i][1] - this.pts[i - 1][1]);
    this.uPerM = len / track.length;
    // a long, nearly straight route would be a thin line: then show a 3 km window that follows you (the bends become visible)
    this.local = Math.max(this.box.w, this.box.h) / Math.min(this.box.w, this.box.h) > 5 && track.length > 6000;
  }
  get ok() { return this.pts.length > 1; }

  /** position along the route (m) -> map point, interpolated between samples */
  _at(d) {
    const f = Math.max(0, Math.min(1, d / this.track.length)) * (this.pts.length - 1), i = Math.min(this.pts.length - 2, Math.floor(f)), t = f - i;
    const a = this.pts[i], b = this.pts[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  /** me = metres ridden; others = [{ d, color }] */
  draw(me, others = []) {
    if (!this.ok) return;
    const c = this.c, dpr = devicePixelRatio || 1, W = c.clientWidth * dpr, H = c.clientHeight * dpr;
    if (!W || !H) return;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d'), pad = 14 * dpr, barH = 16 * dpr, MH = H - barH;
    let b = this.box;
    if (this.local) { const [cx, cy] = this._at(me), r = 1500 * this.uPerM; b = { x0: cx - r, y0: cy - r, w: 2 * r, h: 2 * r }; }
    const s = Math.min((W - 2 * pad) / b.w, (MH - 2 * pad) / b.h), ox = (W - b.w * s) / 2, oy = (MH - b.h * s) / 2;
    const P = ([x, y]) => [ox + (x - b.x0) * s, oy + (y - b.y0) * s];
    g.clearRect(0, 0, W, H); g.lineCap = g.lineJoin = 'round';
    g.save(); g.beginPath(); g.rect(0, 0, W, MH); g.clip(); // the map above, the whole-route bar below
    const path = (to) => { g.beginPath(); const last = Math.min(this.pts.length, to); for (let i = 0; i < last; i++) { const [x, y] = P(this.pts[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); } };
    // road: dark casing + light line, then the ridden part in orange
    path(Infinity); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 7 * dpr; g.stroke();
    g.strokeStyle = 'rgba(244,244,239,.8)'; g.lineWidth = 3.5 * dpr; g.stroke();
    const f = Math.max(0, Math.min(1, me / this.track.length)) * (this.pts.length - 1);
    path(Math.floor(f) + 1); const [mx, my] = P(this._at(me)); g.lineTo(mx, my); g.strokeStyle = ME; g.lineWidth = 3.5 * dpr; g.stroke();
    // start and finish flags
    const [sx, sy] = P(this.pts[0]), [ex, ey] = P(this.pts[this.pts.length - 1]);
    g.fillStyle = '#f4f4ef'; g.fillRect(ex - 3 * dpr, ey - 3 * dpr, 6 * dpr, 6 * dpr);
    g.fillStyle = '#0b0b0b'; g.fillRect(ex - 3 * dpr, ey - 3 * dpr, 3 * dpr, 3 * dpr); g.fillRect(ex, ey, 3 * dpr, 3 * dpr);
    g.beginPath(); g.arc(sx, sy, 3 * dpr, 0, 7); g.fillStyle = '#f4f4ef'; g.fill();
    // others, then me on top
    for (const o of others) {
      const [x, y] = P(this._at(o.d)); g.beginPath(); g.arc(x, y, 4.5 * dpr, 0, 7);
      g.fillStyle = o.color || '#9aa3ad'; g.fill(); g.lineWidth = 1.5 * dpr; g.strokeStyle = '#0b0b0b'; g.stroke();
    }
    g.beginPath(); g.arc(mx, my, 9 * dpr, 0, 7); g.fillStyle = 'rgba(255,90,31,.25)'; g.fill();
    g.beginPath(); g.arc(mx, my, 5.5 * dpr, 0, 7); g.fillStyle = ME; g.fill(); g.lineWidth = 2 * dpr; g.strokeStyle = '#f4f4ef'; g.stroke();
    g.restore();
    // whole route as a bar underneath: start → finish, everyone's position
    const L = this.track.length, bx = pad, bw = W - 2 * pad, by = H - barH / 2, X = d => bx + Math.max(0, Math.min(1, d / L)) * bw;
    g.lineWidth = 3 * dpr; g.strokeStyle = 'rgba(244,244,239,.35)'; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + bw, by); g.stroke();
    g.strokeStyle = ME; g.beginPath(); g.moveTo(bx, by); g.lineTo(X(me), by); g.stroke();
    for (const o of others) { g.beginPath(); g.arc(X(o.d), by, 3.5 * dpr, 0, 7); g.fillStyle = o.color || '#9aa3ad'; g.fill(); }
    g.beginPath(); g.arc(X(me), by, 4.5 * dpr, 0, 7); g.fillStyle = ME; g.fill(); g.lineWidth = 1.5 * dpr; g.strokeStyle = '#f4f4ef'; g.stroke();
  }
}
