# RIDEFRAME open world, first sketch: an island of ~48 x 34 km. Roads first (nodes with heights, edges with a planned profile),
# then a heightmap built around them (mountains where the passes need them, a river valley, cliffs and beaches on the coast).
# Output: insel_karte.png (relief + roads + places), insel_profile.png (all edges), insel_netz.json (graph for the game),
# insel_hoehe.u16 (heightmap, decimetres, like assets/dem), a table on stdout.  python3 insel_proto.py <outdir>
import sys, json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'; os.makedirs(OUT, exist_ok=True)
W_KM, H_KM, RES = 48.0, 34.0, 40.0          # km, metres per heightmap pixel (prototype; the game would use ~10-15 m tiles)
NX, NY = int(W_KM * 1000 / RES), int(H_KM * 1000 / RES)
rs = np.random.default_rng(7)

# ---------------- the network (km, metres) ----------------
NODES = {
 'H':  dict(x=44.0, y=14.0, z=6,    name='Hafenstadt (Start, Dorf der Story)'),
 'L':  dict(x=41.5, y=30.0, z=45,   name='Leuchtturm-Kap'),
 'N':  dict(x=24.0, y=31.6, z=8,    name='Fischerdorf Nordbucht'),
 'W':  dict(x=3.6,  y=21.0, z=25,   name='Westkap'),
 'SW': dict(x=8.0,  y=5.0,  z=6,    name='Südwesthafen'),
 'S':  dict(x=26.0, y=2.4,  z=4,    name='Südstrand'),
 'B':  dict(x=26.0, y=14.0, z=262,  name='Bergdorf im Becken'),
 'P1': dict(x=19.0, y=22.6, z=1012, name='Nordpass'),
 'G':  dict(x=24.5, y=24.2, z=1480, name='Burgberg (Burg, Belagerung)'),
 'P2': dict(x=11.5, y=15.5, z=705,  name='Westpass'),
 'P3': dict(x=35.0, y=21.5, z=548,  name='Ostsattel'),
 'P4': dict(x=24.0, y=7.0,  z=385,  name='Südsattel'),
 'K':  dict(x=17.0, y=11.0, z=180,  name='Klosterplateau'),
}
# edge: a, b, kind, winding factor (road length / straight line), via points (km), land
EDGES = [
 ('H', 'L',  'coast',  1.30, [(46.0, 20.0), (45.0, 26.0)], 'Klippenküste Ost (Tunnel, Leuchtturm-Sprint)'),
 ('L', 'N',  'coast',  1.25, [(36.0, 32.6), (30.0, 33.0)], 'Nordküste (Strände, Felsbögen)'),
 ('N', 'W',  'coast',  1.30, [(16.0, 32.0), (8.0, 28.0)], 'Nordwestküste (Fjord)'),
 ('W', 'SW', 'cliff',  1.30, [(2.2, 15.0), (3.5, 9.0)], 'Steilküste West (Straße hoch über dem Meer)'),
 ('SW', 'S', 'coast',  1.20, [(14.0, 2.8), (20.0, 1.8)], 'Südküste (Strände, Dünen)'),
 ('S', 'H',  'coast',  1.25, [(34.0, 3.0), (41.0, 7.0)], 'Südostküste (Weinberge)'),
 ('H', 'B',  'valley', 1.25, [(39.0, 12.5), (33.0, 13.8)], 'Flusstal (Mühlen, Ruderboote)'),
 ('B', 'P1', 'pass',   1.75, [(23.0, 17.0), (21.0, 20.5)], 'Nordpass Südrampe (Kehren)'),
 ('P1', 'N', 'pass',   1.70, [(20.0, 26.0), (22.5, 29.0)], 'Nordpass Nordrampe (Kehren, Wasserfälle)'),
 ('P1', 'G', 'summit', 1.45, [(21.5, 23.8)], 'Gipfelstraße zur Burg (Sackgasse, Belagerung oben)'),
 ('B', 'K',  'valley', 1.20, [(21.0, 12.0)], 'Hochtal zum Kloster'),
 ('K', 'P2', 'pass',   1.65, [(14.0, 13.5)], 'Westpass Ostrampe'),
 ('P2', 'W', 'pass',   1.60, [(8.0, 18.0), (5.5, 20.0)], 'Westpass Westrampe (Abfahrt zum Meer)'),
 ('P2', 'SW', 'pass',  1.55, [(10.0, 10.0)], 'Westpass Südrampe'),
 ('B', 'P4', 'hills',  1.40, [(25.0, 10.5)], 'Südhügel Nordseite'),
 ('P4', 'S', 'hills',  1.45, [(25.0, 4.5)], 'Südhügel Abfahrt'),
 ('H', 'P3', 'hills',  1.50, [(40.0, 17.5)], 'Ostsattel Auffahrt (Abkürzung)'),
 ('P3', 'L', 'hills',  1.45, [(38.0, 26.0)], 'Ostsattel Nordseite'),
]

def poly(e):
    a, b = NODES[e[0]], NODES[e[1]]; return [(a['x'], a['y'])] + list(e[4]) + [(b['x'], b['y'])]
def plen(p): return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))

# ---------------- terrain ----------------
X, Y = np.meshgrid(np.linspace(0, W_KM, NX), np.linspace(0, H_KM, NY))
def noise(scale, oct=5, seed=1):
    r = np.random.default_rng(seed); acc = np.zeros_like(X); amp = 1.0; tot = 0
    for o in range(oct):
        n = max(2, int(W_KM / scale * 2 ** o)) + 2; m = max(2, int(H_KM / scale * 2 ** o)) + 2
        g = r.standard_normal((m, n)); img = Image.fromarray(g.astype(np.float32), 'F').resize((NX, NY), Image.BICUBIC)
        acc += amp * np.asarray(img); tot += amp; amp *= 0.5
    return acc / tot
# island mask: distorted ellipse, a few bays
cx, cy = 24.0, 17.0
dx, dy = (X - cx) / 21.3, (Y - cy) / 15.0
ang = np.arctan2(dy, dx); r = np.sqrt(dx ** 2 + dy ** 2)
edge = 1 + 0.07 * np.sin(3 * ang + 0.5) + 0.05 * np.sin(7 * ang + 1.3) + 0.10 * noise(9, 3, 3)
land = np.clip((edge - r) / 0.10, -1, 1)                       # >0 land
# mountains: gaussian ridges where the network needs them
def ridge(p0, p1, h, w):
    (x0, y0), (x1, y1) = p0, p1; vx, vy = x1 - x0, y1 - y0; L2 = vx * vx + vy * vy
    t = np.clip(((X - x0) * vx + (Y - y0) * vy) / L2, 0, 1); d = np.hypot(X - (x0 + t * vx), Y - (y0 + t * vy))
    return h * np.exp(-(d / w) ** 2)
def peak(p, h, w): return h * np.exp(-(((X - p[0]) ** 2 + (Y - p[1]) ** 2) / w ** 2))
Z = np.zeros_like(X)
Z = np.maximum(Z, ridge((12, 21.5), (33, 23.5), 1150, 3.2))   # main ridge (north)
Z = np.maximum(Z, peak((24.5, 24.2), 1520, 2.6))              # Burgberg
Z = np.maximum(Z, peak((8.5, 16.0), 1080, 3.4))               # west massif
Z = np.maximum(Z, ridge((5, 12), (12, 19), 820, 2.6))
Z = np.maximum(Z, ridge((19, 6.5), (31, 7.5), 480, 2.8))      # southern hills
Z = np.maximum(Z, ridge((34, 19), (40, 26), 640, 2.4))        # east hills
Z += 140 * noise(4, 5, 11) + 60 * noise(1.5, 4, 12)
# inner basin + river valley to the east coast
Z -= ridge((20, 13), (30, 14.5), 520, 3.6) * 0.0 + 0
basin = np.exp(-(((X - 25) / 6.5) ** 2 + ((Y - 13.5) / 4.0) ** 2)); Z = Z * (1 - 0.75 * basin) + 250 * basin
riv = ridge((26, 14), (46, 13), 1.0, 1.3); Z = Z * (1 - 0.8 * riv) + (60 + 190 * np.clip((46 - X) / 20, 0, 1)) * 0.8 * riv
# saddles where the passes cross
for (px, py, pz, w) in [(19.0, 22.6, 1012, 1.6), (11.5, 15.5, 705, 1.5), (35.0, 21.5, 548, 1.6), (24.0, 7.0, 385, 1.4)]:
    s = np.exp(-(((X - px) ** 2 + (Y - py) ** 2) / w ** 2)); Z = Z * (1 - 0.85 * s) + pz * 0.85 * s
# coast: land height fades to the sea, cliffs in the west and north-east
cliff = np.clip((8 - X) / 4, 0, 1) * (Y > 8) + np.clip((X - 40) / 3, 0, 1) * (Y > 18)
coastfade = np.clip(land, 0, 1) ** (0.6 - 0.45 * np.clip(cliff, 0, 1))
Z = np.where(land > 0, np.maximum(Z, 0) * coastfade + 2, -40 + 30 * land)
# coast road: follow the real coastline 0.5 km inland (rays from the centre), coast nodes snap onto it
def landat(x, y):
    i = int(np.clip(y / H_KM * (NY - 1), 0, NY - 1)); j = int(np.clip(x / W_KM * (NX - 1), 0, NX - 1)); return land[i, j]
RING = []
for k in range(1440):
    t = 2 * math.pi * k / 1440; dxu, dyu = math.cos(t), math.sin(t); rr = 0.0
    last = 0.0
    while rr < 40:
        if landat(cx + dxu * rr, cy + dyu * rr) > 0: last = rr
        elif rr - last > 1.5: break
        rr += 0.05
    RING.append([t, last])
rad = np.array([r[1] for r in RING]); k = 41; rad = np.convolve(np.concatenate([rad[-k:], rad, rad[:k]]), np.ones(k) / k, 'same')[k:-k]
rad = np.minimum(rad, np.array([r[1] for r in RING]) + 0.2)
RING = [(t, cx + math.cos(t) * (r - 0.6), cy + math.sin(t) * (r - 0.6)) for (t, _), r in zip(RING, rad)]
def snap(key):
    n = NODES[key]; t = math.atan2(n['y'] - cy, n['x'] - cx) % (2 * math.pi); k = int(round(t / (2 * math.pi) * 1440)) % 1440
    n['x'], n['y'] = RING[k][1], RING[k][2]; n['ring'] = k
for key in ('H', 'L', 'N', 'W', 'SW', 'S'): snap(key)
def ringpath(a, b):
    ka, kb = NODES[a]['ring'], NODES[b]['ring']; pts = []; k = ka
    step = 1 if (kb - ka) % 1440 < 720 else -1
    while k != kb: pts.append((RING[k][1], RING[k][2])); k = (k + step) % 1440
    return pts[1:]
EDGES[:] = [(e[0], e[1], e[2], 1.12, ringpath(e[0], e[1]), e[5]) if e[2] in ('coast', 'cliff') else e for e in EDGES]
# carve the roads: a bench at the planned road height (the road profile wins over the terrain near the road)
def road_heights(e, n=400):
    p = poly(e); L = plen(p); a, b = NODES[e[0]], NODES[e[1]]
    seg = np.cumsum([0] + [math.dist(p[i], p[i + 1]) for i in range(len(p) - 1)]); ts = np.linspace(0, L, n)
    xs = np.interp(ts, seg, [q[0] for q in p]); ys = np.interp(ts, seg, [q[1] for q in p])
    # terrain along the line, smoothed (a road follows the land, but softly), then pinned to the node heights
    ix = np.clip((xs / W_KM * (NX - 1)).astype(int), 0, NX - 1); iy = np.clip((ys / H_KM * (NY - 1)).astype(int), 0, NY - 1)
    tz = Z[iy, ix]; k = np.exp(-np.linspace(-3, 3, 41) ** 2); k /= k.sum(); tz = np.convolve(np.pad(tz, 20, mode='edge'), k, 'valid')
    lin = np.linspace(a['z'], b['z'], n); f = np.sin(np.linspace(0, math.pi, n))
    mix = {'coast': 0.55, 'cliff': 0.45, 'valley': 0.25, 'pass': 0.15, 'summit': 0.1, 'hills': 0.35}[e[2]]
    z = lin * (1 - mix * f) + tz * mix * f
    if e[2] in ('coast',): z = np.clip(z, 3, 90)
    if e[2] == 'cliff': z = np.clip(z, 3, 160)
    return xs, ys, z, L * e[3] * 1000
ROADS = []
for e in EDGES:
    xs, ys, z, Lm = road_heights(e); ROADS.append((e, xs, ys, z, Lm))
    ix = np.clip((xs / W_KM * (NX - 1)).astype(int), 0, NX - 1); iy = np.clip((ys / H_KM * (NY - 1)).astype(int), 0, NY - 1)
    for i in range(len(xs)):
        y0, y1, x0, x1 = max(0, iy[i] - 3), min(NY, iy[i] + 4), max(0, ix[i] - 3), min(NX, ix[i] + 4)
        Z[y0:y1, x0:x1] = np.where(Z[y0:y1, x0:x1] > -5, 0.5 * Z[y0:y1, x0:x1] + 0.5 * z[i], Z[y0:y1, x0:x1])

# ---------------- table ----------------
def speed(P, g, m=95.5, cda=0.32, crr=0.004):
    lo, hi = 0.5, 25
    for _ in range(50):
        v = (lo + hi) / 2; p = m * 9.81 * (math.sin(math.atan(g)) + crr * math.cos(math.atan(g))) * v + 0.5 * 1.2 * cda * v ** 3
        lo, hi = (v, hi) if p < P else (lo, v)
    return min(lo, 16.0)
rows = []; tot_len = tot_gain = 0
for e, xs, ys, z, Lm in ROADS:
    n = len(z); d = np.linspace(0, Lm, n); dz = np.diff(z); dd = np.diff(d)
    gain = float(dz[dz > 0].sum()); loss = float(-dz[dz < 0].sum())
    g = dz / dd; k = 25; gs = np.convolve(g, np.ones(k) / k, 'same'); gmax = float(np.max(np.abs(gs))) * 100
    t = float(sum(dd[i] / speed(250, g[i]) for i in range(len(dd)))) / 60
    a, b = e[0], e[1]
    rows.append(dict(id=f'{a}-{b}', a=a, b=b, name=e[5], kind=e[2], km=round(Lm / 1000, 1), gain=round(gain), loss=round(loss), maxgrade=round(gmax, 1), min250=round(t)))
    tot_len += Lm / 1000; tot_gain += gain
print(f"{'Strecke':48s} {'km':>6s} {'hm+':>6s} {'hm-':>6s} {'max%':>5s} {'min@250W':>8s}")
for r in rows: print(f"{r['a']+'→'+r['b']+' '+r['name']:48.48s} {r['km']:6.1f} {r['gain']:6d} {r['loss']:6d} {r['maxgrade']:5.1f} {r['min250']:8d}")
print(f"TOTAL {tot_len:.0f} km road, {tot_gain:.0f} m climbing (one direction each), island {W_KM:.0f} x {H_KM:.0f} km, land {float((land > 0).mean() * W_KM * H_KM):.0f} km², highest {float(Z.max()):.0f} m")
ring = sum(r['km'] for r in rows if r['kind'] in ('coast', 'cliff')); print(f"coast ring {ring:.0f} km")

# ---------------- map ----------------
S = 24  # px per km
img_w, img_h = int(W_KM * S), int(H_KM * S)
Zi = np.asarray(Image.fromarray(Z.astype(np.float32), 'F').resize((img_w, img_h), Image.BILINEAR))[::-1]
gy, gx = np.gradient(Zi); shade = np.clip(0.75 + (-gx * 0.7 + gy * 0.7) / 60, 0.35, 1.25)
def colour(z):
    stops = [(-40, (28, 70, 112)), (0, (52, 110, 150)), (1, (216, 204, 160)), (8, (150, 170, 100)), (30, (120, 160, 90)), (300, (92, 136, 72)), (700, (140, 128, 92)), (1100, (150, 140, 128)), (1500, (240, 240, 240))]
    out = np.zeros(z.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(z, [s[0] for s in stops], [s[1][c] for s in stops])
    return out
rgb = colour(Zi); rgb = np.where((Zi > 0)[..., None], rgb * shade[..., None], rgb)
im = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)); dr = ImageDraw.Draw(im)
try: font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 15); small = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 12)
except Exception: font = small = ImageFont.load_default()
P = lambda x, y: (x * S, (H_KM - y) * S)
COL = {'coast': (255, 255, 255), 'cliff': (255, 255, 255), 'valley': (255, 214, 120), 'pass': (255, 90, 31), 'summit': (255, 40, 40), 'hills': (255, 170, 60)}
for e, xs, ys, z, Lm in ROADS:
    pts = [P(x, y) for x, y in zip(xs, ys)]; dr.line(pts, fill=(20, 20, 20), width=6); dr.line(pts, fill=COL[e[2]], width=3)
for k, n in NODES.items():
    x, y = P(n['x'], n['y']); r = 7 if k in ('H', 'G') else 5
    dr.ellipse((x - r, y - r, x + r, y + r), fill=(255, 90, 31) if k in ('P1', 'P2', 'P3', 'P4', 'G') else (255, 255, 255), outline=(0, 0, 0), width=2)
    t = f"{n['name']} · {n['z']} m"; dr.text((x + 9, y - 8), t, font=small, fill=(0, 0, 0)); dr.text((x + 8, y - 9), t, font=small, fill=(255, 255, 255))
dr.text((14, 10), f'RIDEFRAME Insel · Entwurf 1 · {W_KM:.0f} × {H_KM:.0f} km · {tot_len:.0f} km Straßen · höchster Punkt Burgberg', font=font, fill=(255, 255, 255))
for i, (k, c) in enumerate([('Küste', COL['coast']), ('Tal', COL['valley']), ('Pass', COL['pass']), ('Gipfelstraße', COL['summit']), ('Hügel', COL['hills'])]):
    dr.line((14, 40 + i * 18, 44, 40 + i * 18), fill=c, width=4); dr.text((50, 32 + i * 18), k, font=small, fill=(255, 255, 255))
dr.line((img_w - 140, img_h - 20, img_w - 140 + 5 * S, img_h - 20), fill=(255, 255, 255), width=3); dr.text((img_w - 140, img_h - 40), '5 km', font=small, fill=(255, 255, 255))
im.save(os.path.join(OUT, 'insel_karte.png'))

# ---------------- profiles ----------------
pw, ph = 560, 120; cols = 3; rows_n = math.ceil(len(ROADS) / cols)
pr = Image.new('RGB', (cols * pw, rows_n * ph), (18, 18, 18)); d2 = ImageDraw.Draw(pr)
for i, ((e, xs, ys, z, Lm), r) in enumerate(zip(ROADS, rows)):
    ox, oy = (i % cols) * pw, (i // cols) * ph; zmax = 1500
    pts = [(ox + 10 + j / (len(z) - 1) * (pw - 20), oy + ph - 12 - z[j] / zmax * (ph - 40)) for j in range(len(z))]
    d2.polygon(pts + [(ox + pw - 10, oy + ph - 12), (ox + 10, oy + ph - 12)], fill=(60, 40, 30)); d2.line(pts, fill=COL[e[2]], width=2)
    d2.text((ox + 10, oy + 4), f"{r['a']}→{r['b']} {r['name'][:40]}", font=small, fill=(240, 240, 240))
    d2.text((ox + 10, oy + 18), f"{r['km']} km · +{r['gain']} m · max {r['maxgrade']} % · {r['min250']} min @250 W", font=small, fill=(255, 150, 90))
pr.save(os.path.join(OUT, 'insel_profile.png'))
json.dump({'size_km': [W_KM, H_KM], 'nodes': NODES, 'edges': rows}, open(os.path.join(OUT, 'insel_netz.json'), 'w'), ensure_ascii=False, indent=1)
(np.clip(Z, 0, 6500) * 10).astype('<u2').tofile(os.path.join(OUT, 'insel_hoehe.u16'))
print('heightmap', NX, 'x', NY, '@', RES, 'm')
