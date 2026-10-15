"""Render the kit's SVGs to exact-size transparent PNGs through headless Chrome, then build DeepBuild.icns.
Usage: python3 -I render_png.py   (run from anywhere; writes into png/, DeepBuild.iconset/ and DeepBuild.icns)"""
import base64, json, os, re, shutil, subprocess, sys, tempfile
K = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP = tempfile.mkdtemp(prefix="deepbuild-brand-")  # a throwaway Chrome profile and render page, outside the repo
PROFILE = os.path.join(TMP, "chrome-profile")
jobs = []  # (svg file, width, height, out path)
icon_sizes = [(16, "icon_16x16"), (32, "icon_16x16@2x"), (32, "icon_32x32"), (64, "icon_32x32@2x"), (128, "icon_128x128"),
              (256, "icon_128x128@2x"), (256, "icon_256x256"), (512, "icon_256x256@2x"), (512, "icon_512x512"), (1024, "icon_512x512@2x")]
for px, name in icon_sizes:
    jobs.append(("app-icon-small.svg" if px <= 32 else "app-icon.svg", px, px, f"DeepBuild.iconset/{name}.png"))
jobs += [("menubar-template.svg", 16, 16, "png/trayTemplate.png"), ("menubar-template.svg", 32, 32, "png/trayTemplate@2x.png"),
         ("favicon.svg", 16, 16, "png/favicon-16.png"), ("favicon.svg", 32, 32, "png/favicon-32.png"), ("favicon.svg", 48, 48, "png/favicon-48.png"),
         ("app-icon.svg", 180, 180, "png/apple-touch-icon.png"), ("app-icon.svg", 192, 192, "png/icon-192.png"), ("app-icon.svg", 512, 512, "png/icon-512.png"),
         ("symbol-ink.svg", 512, 512, "png/symbol-ink-512.png"), ("symbol-color-dark.svg", 512, 512, "png/symbol-color-dark-512.png"),
         ("lockup-horizontal-ink.svg", 1200, None, "png/lockup-horizontal-ink-1200.png"),
         ("lockup-horizontal-color-dark.svg", 1200, None, "png/lockup-horizontal-color-dark-1200.png")]
items = []
for svgf, w, h, out in jobs:
    s = open(os.path.join(K, svgf), encoding="utf-8").read()
    if h is None:
        vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', s).group(1).split()]
        h = round(w * vb[3] / vb[2])
    items.append({"src": "data:image/svg+xml;base64," + base64.b64encode(s.encode()).decode(), "w": w, "h": h, "out": out})
page = os.path.join(TMP, "render.html")
open(page, "w").write("<!doctype html><pre id=o></pre><script>const items=" + json.dumps(items) + """;
(async()=>{const res={};for(const it of items){const img=new Image();await new Promise(r=>{img.onload=r;img.src=it.src;});
const c=document.createElement('canvas');c.width=it.w;c.height=it.h;const x=c.getContext('2d');x.imageSmoothingQuality='high';
x.drawImage(img,0,0,it.w,it.h);res[it.out]=c.toDataURL('image/png');}document.getElementById('o').textContent=JSON.stringify(res);})();
</script>""")
dom = subprocess.run([CHROME, "--headless=new", "--disable-gpu", f"--user-data-dir={PROFILE}", "--virtual-time-budget=5000",
                      "--dump-dom", "file://" + page], capture_output=True, text=True).stdout
m = re.search(r'<pre id="o">(.*?)</pre>', dom, re.S)
if not m or not m.group(1).strip():
    sys.exit("no output from Chrome")
res = json.loads(m.group(1).replace("&quot;", '"').replace("&amp;", "&"))
for out, url in res.items():
    p = os.path.join(K, out); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(base64.b64decode(url.split(",", 1)[1]))
print(len(res), "PNGs")
subprocess.run(["iconutil", "-c", "icns", os.path.join(K, "DeepBuild.iconset"), "-o", os.path.join(K, "DeepBuild.icns")], check=True)
# favicon.ico with PNG payloads (16, 32, 48)
pngs = [open(os.path.join(K, f"png/favicon-{n}.png"), "rb").read() for n in (16, 32, 48)]
import struct
hdr = struct.pack("<HHH", 0, 1, len(pngs)); off = 6 + 16 * len(pngs); dirs = b""; data = b""
for n, p in zip((16, 32, 48), pngs):
    dirs += struct.pack("<BBBBHHII", n, n, 0, 0, 1, 32, len(p), off + len(data)); data += p
open(os.path.join(K, "png/favicon.ico"), "wb").write(hdr + dirs + data)
print("icns and ico written")
shutil.rmtree(TMP, ignore_errors=True)
