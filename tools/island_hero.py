# The island on the start page (Freddy 20.11.: "like the map you sent me, big on the start page, see who is where, click and join"):
#   assets/dem/insel_hero.webp   relief of the island without roads or labels (the page draws those itself, animated)
#   assets/dem/insel_map.json    extent of that picture in metres, the roads (simplified), the places, and every island tour
#                                sampled every 100 m, so a rider's km on a tour becomes a point on the map
#   python3 tools/island_hero.py      (needs numpy + Pillow; reads assets/dem/insel.bin, insel_net.json, insel_*.json)
import os, json, glob
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DEM = os.path.join(ROOT, 'assets', 'dem')
net = json.load(open(os.path.join(DEM, 'insel_net.json')))
N, PX, SIZE = net['n'], net['pixel_m'], net['size_m']
Z = np.fromfile(os.path.join(DEM, 'insel.bin'), dtype='<u2').reshape(N, N).astype(np.float32) / 10

X0, Y0, X1, Y1 = 2000.0, 8600.0, SIZE - 2000.0, SIZE - 2200.0  # same frame as insel_karte.png
W = 2000; H = round(W * (Y1 - Y0) / (X1 - X0)); m = (X1 - X0) / W
c0, r0, c1, r1 = int(X0 / PX), int(Y0 / PX), int(X1 / PX), int(Y1 / PX)
zm = np.asarray(Image.fromarray(Z[r0:r1, c0:c1], 'F').resize((W, H), Image.BILINEAR))
gy, gx = np.gradient(zm, m)
shade = np.clip(0.80 + (-gx * 0.8 + gy * 0.8) * 0.85, 0.38, 1.32)
stops = [(-60, (14, 34, 52)), (-5, (24, 58, 82)), (0, (40, 92, 116)), (0.3, (205, 192, 150)), (6, (146, 166, 98)), (60, (110, 146, 80)), (300, (84, 120, 64)),
         (700, (124, 118, 86)), (1100, (150, 142, 130)), (1450, (236, 236, 234))]
rgb = np.stack([np.interp(zm, [s[0] for s in stops], [s[1][c] for s in stops]) for c in range(3)], -1)
land = zm > 0.3
rgb = np.where(land[..., None], rgb * shade[..., None], rgb)
# shallow water glows lighter near the shore
near = np.asarray(Image.fromarray((land * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(18))).astype(np.float32) / 255
rgb = np.where(land[..., None], rgb, rgb + near[..., None] * np.array([30, 70, 70], np.float32))
im = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
im.save(os.path.join(DEM, 'insel_hero.webp'), quality=80, method=6)

r1f = lambda v: round(v)
def thin(P, step_m, net_step=10):
    k = max(1, round(step_m / net_step)); out = P[::k]
    if out[-1] != P[-1]: out = out + [P[-1]]
    return [[r1f(x), r1f(y)] for x, y in out]
out = {'about': 'tools/island_hero.py', 'extent': [X0, Y0, X1, Y1], 'img': 'insel_hero.webp', 'size': [W, H],
       'nodes': {k: {'name': n['name'], 'kind': n['kind'], 'z': round(n['z']), 'p': [r1f(n['p'][0]), r1f(n['p'][1])]} for k, n in net['nodes'].items()},
       'edges': [{'id': e['id'], 'a': e['a'], 'b': e['b'], 'kind': e['kind'], 'name': e['name'], 'len': round(e['len']), 'P': thin(e['P'], 60)} for e in net['edges']],
       'lakes': [[[r1f(x), r1f(y)] for x, y in lk['shore'][::4]] for lk in net.get('lakes', [])],
       'tours': {}}
for f in sorted(glob.glob(os.path.join(DEM, 'insel_*.json'))):
    id = os.path.basename(f)[:-5]
    if id in ('insel_net', 'insel_map'): continue
    j = json.load(open(f)); sx, sy = j['start_px'][0] * PX, j['start_px'][1] * PX; st = j['route_step_m']
    P = [[sx + x, sy + y] for x, y in j['route']]
    out['tours'][id] = {'name': j['name'], 'step': 100, 'len': round((len(P) - 1) * st), 'P': thin(P, 100, st),
                        'nodes': [{'id': min(net['nodes'], key=lambda k: (net['nodes'][k]['p'][0] - P[0][0]) ** 2 + (net['nodes'][k]['p'][1] - P[0][1]) ** 2), 'at': 0}] + [{'id': n['id'], 'at': round(n['at_m'])} for n in j['nodes']]}  # the start town first
json.dump(out, open(os.path.join(DEM, 'insel_map.json'), 'w'), separators=(',', ':'))
print('hero', im.size, os.path.getsize(os.path.join(DEM, 'insel_hero.webp')) // 1024, 'KB, map', os.path.getsize(os.path.join(DEM, 'insel_map.json')) // 1024, 'KB')
