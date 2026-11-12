# Draws a terminal session that `script` recorded byte for byte as a PNG, so the evidence shows what the terminal showed.
# Usage: python3 -I term_png.py <typescript> <out.png> <title>
import os, re, sys
from PIL import Image, ImageDraw, ImageFont

src, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
raw = open(src, "rb").read().decode("utf-8", "replace")
raw = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]", "", raw)
lines = []
for line in raw.replace("\r\n", "\n").split("\n"):
    line = line.split("\r")[-1]
    if line.startswith("Script started") or line.startswith("Script done"):
        continue
    line = line.replace(os.path.expanduser("~"), "~")
    while len(line) > 150:
        lines.append(line[:150])
        line = "  " + line[150:]
    lines.append(line)
while lines and not lines[-1].strip():
    lines.pop()

font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 14)
bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 14)
cw, lh, pad, bar = 8.5, 18, 14, 30
w = int(pad * 2 + cw * max(80, max(len(l) for l in lines)))
h = bar + pad * 2 + lh * len(lines)
img = Image.new("RGB", (w, h), (24, 26, 31))
d = ImageDraw.Draw(img)
d.rectangle([0, 0, w, bar], fill=(46, 49, 56))
for i, c in enumerate([(237, 106, 94), (245, 191, 79), (98, 197, 84)]):
    d.ellipse([12 + i * 20, 9, 24 + i * 20, 21], fill=c)
d.text((80, 7), title, font=bold, fill=(200, 204, 212))
for i, line in enumerate(lines):
    color = (220, 223, 228)
    if line.startswith("$ "):
        color = (130, 200, 255)
    elif re.search(r"died by signal|overflowed|FAILED|fatal runtime error|panicked", line):
        color = (255, 120, 110)
    elif re.search(r"\bok\b|exit 0|refused|nests past the cap", line):
        color = (140, 220, 140)
    elif "BLOCKED" in line or "INCONCLUSIVE" in line:
        color = (245, 191, 79)
    d.text((pad, bar + pad + i * lh), line, font=font, fill=color)
img.save(out)
print(f"{out}: {w}x{h}, {len(lines)} lines")
