# #2098: draws data.json (make-data.mjs) as frames and one still. Usage: python render.py data.json outdir
import json, math, os, sys
from PIL import Image, ImageDraw, ImageFont
d = json.load(open(sys.argv[1])); out = sys.argv[2]; os.makedirs(out + '/frames', exist_ok=True)
W, H, RATE, STEPS = 1500, 620, 120, 360
F = lambda s: ImageFont.load_default(size=s)
INK, DIM, RED, BLUE, GREEN, PAPER = (20, 24, 32), (120, 126, 138), (200, 60, 50), (40, 100, 200), (30, 140, 80), (250, 250, 247)
def chart(g, box, xs, series, ymax, k, marks=()):
    x0, y0, x1, y1 = box
    g.rectangle(box, outline=DIM)
    px = lambda i: x0 + (x1 - x0) * i / (len(xs) - 1)
    py = lambda v: y1 - (y1 - y0) * max(0, min(v / ymax, 1))
    for v, color, label in marks:
        g.line([(x0, py(v)), (x1, py(v))], fill=color); g.text((x0 + 4, py(v) - 15), label, fill=color, font=F(12))
    for vals, color in series:
        pts = [(px(i), py(vals[i])) for i in range(0, k + 1)]
        if len(pts) > 1: g.line(pts, fill=color, width=2)
        g.ellipse([pts[-1][0] - 4, pts[-1][1] - 4, pts[-1][0] + 4, pts[-1][1] + 4], fill=color)
def square(g, cx, cy, half, deg, color):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    pts = [(cx + half * (ux * c - uy * s), cy - half * (ux * s + uy * c)) for ux, uy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
    g.polygon(pts, outline=color, width=3); g.line([(cx, cy), (cx + half * c, cy - half * s)], fill=color, width=2)
turn = lambda rates, k: sum(rates[1:k + 1]) / RATE
closed = [2 * (1 - math.exp(-2 * i / RATE)) for i in range(STEPS + 1)]
first = next(i for i, v in enumerate(d['wind']['vx']) if abs(v - 2) <= 0.02)
apex = max(d['drop']['y'][i] - 0.1 for i in range(1, 241) if d['drop']['vy'][i] > 0)
def frame(k):
    im = Image.new('RGB', (W, H), PAPER); g = ImageDraw.Draw(im); t = k / RATE
    g.text((20, 12), f"#2098 on deep-physics (release), baked states drawn by a script, not the app      t = {t:4.2f} s   step {k}", fill=INK, font=F(18))
    # 1: the 2D drop
    g.text((20, 50), "1. 2D world on " + d['drop']['backend']['name'] + ' ' + d['drop']['backend']['version'], fill=INK, font=F(17))
    gy = lambda y: 520 - y * 190
    g.line([(30, gy(0)), (470, gy(0))], fill=INK, width=3)
    g.rectangle([30, gy(0.6), 470, gy(0.4)], outline=GREEN); g.text((34, gy(0.6) - 16), "criterion: rebound 0.4 to 0.6 m", fill=GREEN, font=F(12))
    g.line([(60, gy(2.0)), (120, gy(2.0))], fill=DIM); g.text((60, gy(2.0) - 16), "dropped 2 m", fill=DIM, font=F(12))
    y = d['drop']['y'][k]; g.ellipse([250 - 19, gy(y) - 19, 250 + 19, gy(y) + 19], outline=BLUE, width=3)
    g.text((30, 540), f"ball y = {y:6.3f} m   first rebound = {apex:.4f} m ({apex / 2:.3f} of the drop)", fill=INK, font=F(14))
    r = d['refused'][0] if d['refused'] else None
    g.text((30, 562), "same world named rapier3d: refused at " + (f"{r['path']} (actual {r['actual']})" if r else "NOTHING"), fill=RED if r else INK, font=F(14))
    # 2: the wind
    g.text((520, 50), "2. wind (2, 0, 0), aero_triangles, coefficient 1, 1 kg cube", fill=INK, font=F(17))
    xs = list(range(STEPS + 1))
    chart(g, (520, 90, 980, 400), xs, [(closed, DIM), (d['gusty']['vx'], GREEN), (d['wind']['vx'], BLUE)], 4.2, k, marks=[(1.98, RED, "1% of the wind's 2 m/s")])
    xl = 520 + 460 * (2.3026 * RATE) / STEPS; g.line([(xl, 90), (xl, 400)], fill=RED); g.text((xl + 4, 380), "closed form 2.303 s", fill=RED, font=F(12))
    g.text((520, 408), "speed along +x, m/s:  blue steady,  green gusty (seed 7),  grey 2(1 − e^(−2t))", fill=INK, font=F(13))
    cx = 560 + min(d['wind']['x'][k], 4.6) * 85; g.rectangle([cx - 22, 470 - 22, cx + 22, 470 + 22], outline=BLUE, width=3)
    for j in range(5): g.line([(530, 440 + j * 15), (560, 440 + j * 15)], fill=DIM)
    g.text((520, 540), f"steady: {d['wind']['vx'][k]:.4f} m/s   gusty: {d['gusty']['vx'][k]:.4f} m/s", fill=INK, font=F(14))
    g.text((520, 562), f"first within 1% at step {first} = {first / RATE:.4f} s (criterion: steps 274 to 279)", fill=INK, font=F(14))
    # 3: the inertia
    g.text((1030, 50), "3. inertia twice the shape's, same 1 N·m torque", fill=INK, font=F(17))
    k1 = min(k, 240)
    square(g, 1140, 250, 70, turn(d['spin']['plain'], k1), BLUE); square(g, 1360, 250, 70, turn(d['spin']['doubled'], k1), GREEN)
    g.text((1095, 340), "no inertia", fill=BLUE, font=F(14)); g.text((1300, 340), "inertia [2, 2, 2]", fill=GREEN, font=F(14))
    p, q, z = d['spin']['plain'][120], d['spin']['doubled'][120], d['spin']['ignored'][120]
    g.text((1030, 400), f"now: {d['spin']['plain'][k1]:7.3f} deg/s        {d['spin']['doubled'][k1]:7.3f} deg/s", fill=INK, font=F(14))
    g.text((1030, 540), f"after 1 s: {p:.4f} and {q:.4f} deg/s, ratio {q / p:.4f} (criterion 0.5 within 1%)", fill=INK, font=F(14))
    g.text((1030, 562), f"planted inertia_ignored: {z:.4f} deg/s, ratio {z / p:.4f}", fill=RED, font=F(14))
    return im
for n, k in enumerate(range(0, STEPS + 1, 2)): frame(k).save(f"{out}/frames/{n:04d}.png")
frame(STEPS).save(out + '/2098-still.png')
print(json.dumps({'apex': apex, 'first_step': first, 'ratio': d['spin']['doubled'][120] / d['spin']['plain'][120], 'refused': d['refused'][:1], 'backend': d['drop']['backend']}))
