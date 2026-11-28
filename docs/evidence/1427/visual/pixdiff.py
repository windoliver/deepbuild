"""Usage: python3 -I pixdiff.py <a.png> <b.png> [diff-out.png]
Prints differing pixel count, percent, bounding box (device px) and max channel delta; optionally writes a crop
of a, b and a red diff mask side by side around the differing box."""
import sys
from PIL import Image, ImageChops

a = Image.open(sys.argv[1]).convert("RGBA")
b = Image.open(sys.argv[2]).convert("RGBA")
if a.size != b.size:
    print(f"size differs {a.size} vs {b.size}")
    sys.exit(2)
d = ImageChops.difference(a, b)
r, g, bb, al = d.split()
mask = ImageChops.lighter(ImageChops.lighter(r, g), ImageChops.lighter(bb, al)).point(lambda v: 255 if v else 0)
box = mask.getbbox()
n = mask.histogram()[255]
total = a.size[0] * a.size[1]
maxd = max(hi for _, hi in d.getextrema())
print(f"{n} px differ of {total} ({100 * n / total:.4f}%), box {box}, max channel delta {maxd}")
if box and len(sys.argv) > 3:
    pad = 40
    x0, y0, x1, y1 = max(0, box[0] - pad), max(0, box[1] - pad), min(a.size[0], box[2] + pad), min(a.size[1], box[3] + pad)
    ca, cb = a.crop((x0, y0, x1, y1)), b.crop((x0, y0, x1, y1))
    cm = Image.new("RGBA", ca.size, (255, 255, 255, 255))
    cm.paste((255, 0, 0, 255), (0, 0), mask.crop((x0, y0, x1, y1)))
    w, h = ca.size
    out = Image.new("RGBA", (w * 3 + 20, h), (128, 128, 128, 255))
    out.paste(ca, (0, 0)); out.paste(cb, (w + 10, 0)); out.paste(cm, (2 * w + 20, 0))
    out.save(sys.argv[3])
