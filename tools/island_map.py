# Pictures of the island built by tools/island.mjs: the map (relief, roads, places), the height profiles of every road,
# and the colour map the game lays over the terrain (assets/dem/insel_sat.jpg, like the satellite image of the Lofoten).
#   python3 tools/island_map.py [outdir]     (needs numpy + Pillow; reads assets/dem/insel.bin + insel_net.json)
import sys, os, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DEM = os.path.join(ROOT, 'assets', 'dem')
OUT = sys.argv[1] if len(sys.argv) > 1 else DEM
os.makedirs(OUT, exist_ok=True)
net = json.load(open(os.path.join(DEM, 'insel_net.json')))
N, PX = net['n'], net['pixel_m']
Z = np.fromfile(os.path.join(DEM, 'insel.bin'), dtype='<u2').reshape(N, N).astype(np.float32) / 10

def font(size, bold=False):
    for f in (['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if bold else
              ['/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']):
        if os.path.exists(f): return ImageFont.truetype(f, size)
    return ImageFont.load_default()

def relief(z, cell):
    gy, gx = np.gradient(z, cell)
    slope = np.hypot(gx, gy)
    shade = np.clip(0.78 + (-gx * 0.75 + gy * 0.75) * 0.9, 0.35, 1.3)  # light from the north-west
    return slope, shade

rnd = np.random.default_rng(5)
def noise(n, scale, seed):
    r = np.random.default_rng(seed); acc = np.zeros((n, n), np.float32); a = 1; t = 0
    for o in range(4):
        m = max(2, int(n / scale * 2 ** o)); g = r.standard_normal((m, m)).astype(np.float32)
        acc += a * np.asarray(Image.fromarray(g, 'F').resize((n, n), Image.BICUBIC)); t += a; a *= .5
    return acc / t

# ---------------- colour map for the game (2048², row 0 = north, same extent as the grid) ----------------
S = 2048; zs = np.asarray(Image.fromarray(Z, 'F').resize((S, S), Image.BILINEAR)); cell = net['size_m'] / S
slope, shade = relief(zs, cell)
nz = noise(S, 64, 3)
def lerpc(a, b, t): return a + (np.array(b, np.float32) - a) * t[..., None]
col = np.zeros((S, S, 3), np.float32) + np.array([86, 112, 58], np.float32)         # meadow
col = lerpc(col, [62, 92, 46], np.clip(0.5 + nz, 0, 1) * 0.7)                      # darker pasture / scrub patches
col = lerpc(col, [56, 74, 40], np.clip((zs - 150) / 500, 0, 1) * np.clip(0.3 + nz, 0, 1))   # forest belt
col = lerpc(col, [118, 116, 84], np.clip((zs - 900) / 300, 0, 1))                  # alpine grass
col = lerpc(col, [128, 122, 112], np.clip((slope - 0.55) / 0.35, 0, 1))             # rock on steep ground
col = lerpc(col, [150, 146, 138], np.clip((zs - 1250) / 200, 0, 1) * np.clip((slope - 0.25) / 0.3, 0, 1))  # scree near the top
col = lerpc(col, [200, 186, 148], np.clip((6 - zs) / 4, 0, 1) * (zs > 0.3))          # sand at the shore
col[zs <= 0.3] = [40, 62, 70]
Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).save(os.path.join(DEM, 'insel_sat.jpg'), quality=88)

# ---------------- map ----------------
MS = 1600; zm = np.asarray(Image.fromarray(Z, 'F').resize((MS, MS), Image.BILINEAR)); mcell = net['size_m'] / MS
slope, shade = relief(zm, mcell)
stops = [(-40, (22, 52, 78)), (0, (40, 86, 118)), (0.3, (214, 202, 160)), (8, (150, 170, 100)), (60, (118, 152, 86)), (300, (92, 128, 70)),
         (700, (132, 124, 90)), (1100, (152, 144, 132)), (1500, (238, 238, 236))]
rgb = np.stack([np.interp(zm, [s[0] for s in stops], [s[1][c] for s in stops]) for c in range(3)], -1)
rgb = np.where((zm > 0.3)[..., None], rgb * shade[..., None], rgb)
# crop to the island
k = MS / net['size_m']; x0, y0 = int(2000 * k), int(8600 * k); x1, y1 = int((net['size_m'] - 2000) * k), int((net['size_m'] - 2200) * k)
im = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).crop((x0, y0, x1, y1)); dr = ImageDraw.Draw(im)
P = lambda p: (p[0] * k - x0, p[1] * k - y0)
COL = {'bridge': (255, 106, 0), 'islet': (255, 255, 255), 'coast': (255, 255, 255), 'cliff': (225, 235, 245), 'valley': (255, 214, 120), 'pass': (255, 106, 0), 'summit': (230, 40, 20), 'hills': (255, 160, 60)}
for e in net['edges']:
    pts = [P(p) for p in e['P'][::3]]
    dr.line(pts, fill=(25, 22, 20), width=7, joint='curve'); dr.line(pts, fill=COL[e['kind']], width=4, joint='curve')
f1, f2, f3 = font(26, True), font(17, True), font(15)
for kk, n in net['nodes'].items():
    x, y = P(n['p']); r = 9 if kk in ('H', 'G') else 7
    dr.ellipse((x - r, y - r, x + r, y + r), fill=(255, 106, 0) if n['kind'] in ('pass', 'castle') else (255, 255, 255), outline=(0, 0, 0), width=2)
    t = f"{n['de']} · {round(n['z'])} m"
    tw = dr.textlength(t, font=f2); tx = x + 12 if x + 12 + tw < im.size[0] - 8 else x - 12 - tw
    dr.text((tx, y - 10), t, font=f2, fill=(255, 255, 255), stroke_width=3, stroke_fill=(10, 10, 10))
total = sum(e['len'] for e in net['edges']) / 1000; ring = sum(e['len'] for e in net['edges'] if e['kind'] in ('coast', 'cliff')) / 1000
dr.text((22, 16), f"RIDEFRAME Insel · Entwurf 3 · {total:.0f} km Straßen, davon {ring:.0f} km Küstenring", font=f1, fill=(255, 255, 255), stroke_width=3, stroke_fill=(10, 10, 10))
for i, (lab, c) in enumerate([('Küste', COL['coast']), ('Tal', COL['valley']), ('Pass (Kehren)', COL['pass']), ('Gipfelstraße', COL['summit']), ('Hügel', COL['hills']), ('Lange Brücke', COL['bridge'])]):
    yy = 62 + i * 24; dr.line((24, yy, 60, yy), fill=(20, 20, 20), width=8); dr.line((24, yy, 60, yy), fill=c, width=5)
    dr.text((70, yy - 10), lab, font=f3, fill=(255, 255, 255), stroke_width=2, stroke_fill=(10, 10, 10))
W, H = im.size; bar = 5000 * k
dr.line((W - 40 - bar, H - 30, W - 40, H - 30), fill=(255, 255, 255), width=4); dr.text((W - 40 - bar, H - 56), '5 km', font=f3, fill=(255, 255, 255), stroke_width=2, stroke_fill=(10, 10, 10))
im.save(os.path.join(OUT, 'insel_karte.png'))

# ---------------- profiles (one per road, same scale) ----------------
pw, ph, cols = 620, 150, 3; rows = math.ceil(len(net['edges']) / cols)
pr = Image.new('RGB', (cols * pw, rows * ph), (16, 16, 16)); d2 = ImageDraw.Draw(pr); f4 = font(14, True); f5 = font(13)
LMAX = max(e['len'] for e in net['edges'])
for i, e in enumerate(net['edges']):
    ox, oy = (i % cols) * pw, (i // cols) * ph; z = e['ele']; n = len(z); w = (pw - 30) * e['len'] / LMAX
    pts = [(ox + 15 + j / (n - 1) * w, oy + ph - 14 - z[j] / 1550 * (ph - 56)) for j in range(0, n, 4)]
    d2.polygon(pts + [(ox + 15 + w, oy + ph - 14), (ox + 15, oy + ph - 14)], fill=(70, 46, 30)); d2.line(pts, fill=COL[e['kind']], width=2)
    d2.text((ox + 15, oy + 6), f"{e['de']}", font=f4, fill=(240, 240, 240))
    d2.text((ox + 15, oy + 24), f"{e['len'] / 1000:.1f} km · +{e['gain']} / -{e['loss']} m · max {e['maxGrade']} %", font=f5, fill=(255, 150, 70))
pr.save(os.path.join(OUT, 'insel_profile.png'))
print('written', OUT)
