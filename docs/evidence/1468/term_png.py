# Draws a terminal session that `script` recorded byte for byte as a PNG, so the evidence shows what the terminal showed.
# Usage: python3 -I term_png.py <typescript> <out.png> <title>
import os, re, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

src, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
raw = open(src, "rb").read().decode("utf-8", "replace")
raw = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]", "", raw)

def color(line):
    # Each logical line takes one colour, and its wrapped rows keep it.
    if line.startswith("$ "):
        return (130, 200, 255)
    if line.startswith("# "):
        return (150, 155, 165)
    if re.search(r"died by signal|overflowed|FAILED|fatal runtime error|panicked|: none$|\[exit [1-9]", line):
        return (255, 120, 110)
    if "BLOCKED" in line or "INCONCLUSIVE" in line:
        return (245, 191, 79)
    if re.search(r" \.\.\. ok$|^test result: ok|\[exit 0\]|^exit 0$|nests past the cap|\"outcome\": \"installed\"|\"ok\": true, \"order\"", line):
        return (140, 220, 140)
    return (220, 223, 228)

rows = []
for line in raw.replace("\r\n", "\n").split("\n"):
    line = line.split("\r")[-1]
    if line.startswith("Script started") or line.startswith("Script done"):
        continue
    line = line.replace(os.path.expanduser("~"), "~")
    c = color(line)
    for row in textwrap.wrap(line, 150, subsequent_indent="    ", break_on_hyphens=False, replace_whitespace=False) or [""]:
        rows.append((row, c))
while rows and not rows[-1][0].strip():
    rows.pop()

font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 14)
bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 14)
cw, lh, pad, bar = 8.5, 18, 14, 30
w = int(pad * 2 + cw * max(80, max(len(r) for r, _ in rows)))
h = bar + pad * 2 + lh * len(rows)
img = Image.new("RGB", (w, h), (24, 26, 31))
d = ImageDraw.Draw(img)
d.rectangle([0, 0, w, bar], fill=(46, 49, 56))
for i, c in enumerate([(237, 106, 94), (245, 191, 79), (98, 197, 84)]):
    d.ellipse([12 + i * 20, 9, 24 + i * 20, 21], fill=c)
d.text((80, 7), title, font=bold, fill=(200, 204, 212))
for i, (row, c) in enumerate(rows):
    d.text((pad, bar + pad + i * lh), row, font=font, fill=c)
img.save(out)
print(f"{out}: {w}x{h}, {len(rows)} lines")
