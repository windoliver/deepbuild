"""DeepBuild brand kit: the Keyframe mark, its small cut, the drawn wordmark, lockups and icon masters, as SVG.

Run: python3 -I build.py   (writes SVGs next to this file; render_png.py makes the PNGs, the .icns and the .ico)
All geometry is built from rectangles, rounded rectangles, circular arcs and squares on their points,
so every outline is exact. Fills use nonzero winding: solids clockwise, holes counter-clockwise.
"""
import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
INK, PAPER, WHITE, SIGNAL, GREY = "#151619", "#F6F6F4", "#FFFFFF", "#F2C440", "#74767D"


def f(x):
    return f"{x:.3f}".rstrip("0").rstrip(".")


def rect(x0, y0, x1, y1):
    return f"M{f(x0)},{f(y0)} H{f(x1)} V{f(y1)} H{f(x0)} Z"


def rrect(x0, y0, x1, y1, r):
    if r <= 0:
        return rect(x0, y0, x1, y1)
    return (f"M{f(x0 + r)},{f(y0)} H{f(x1 - r)} A{f(r)},{f(r)} 0 0 1 {f(x1)},{f(y0 + r)} V{f(y1 - r)} "
            f"A{f(r)},{f(r)} 0 0 1 {f(x1 - r)},{f(y1)} H{f(x0 + r)} A{f(r)},{f(r)} 0 0 1 {f(x0)},{f(y1 - r)} "
            f"V{f(y0 + r)} A{f(r)},{f(r)} 0 0 1 {f(x0 + r)},{f(y0)} Z")


def circle(cx, cy, r, ccw=False):
    s = 0 if ccw else 1
    return f"M{f(cx - r)},{f(cy)} A{f(r)},{f(r)} 0 1 {s} {f(cx + r)},{f(cy)} A{f(r)},{f(r)} 0 1 {s} {f(cx - r)},{f(cy)} Z"


def sector(cx, cy, ro, ri, a0, a1):
    """Annulus sector from angle a0 to a1 (degrees, clockwise in SVG coordinates, a1 > a0)."""
    def p(r, a):
        t = math.radians(a)
        return cx + r * math.cos(t), cy + r * math.sin(t)
    large = 1 if (a1 - a0) > 180 else 0
    x0, y0 = p(ro, a0); x1, y1 = p(ro, a1); x2, y2 = p(ri, a1); x3, y3 = p(ri, a0)
    return (f"M{f(x0)},{f(y0)} A{f(ro)},{f(ro)} 0 {large} 1 {f(x1)},{f(y1)} L{f(x2)},{f(y2)} "
            f"A{f(ri)},{f(ri)} 0 {large} 0 {f(x3)},{f(y3)} Z")


def svg(body, vb="0 0 256 256", extra=""):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"{extra}>{body}</svg>\n'


# ------------------------------------------------------------------ the mark (256 box)
# A D whose counter holds a keyframe: stem, bars and bowl all 42 thick; outer bowl r 92, counter r 50; keyframe r 28.
def diamond(cx, cy, r):
    """A keyframe: a square standing on its point, clockwise."""
    return f"M{f(cx)},{f(cy - r)} L{f(cx + r)},{f(cy)} L{f(cx)},{f(cy + r)} L{f(cx - r)},{f(cy)} Z"


def d_shape(x0, y0, x1, y1, ri, inset=0.0):
    """The D: outer from (x0, y0) to (x1, y1) with a semicircular bowl; its counter as a hole with radius ri."""
    r = (y1 - y0) / 2
    cx = x1 - r
    outer = f"M{f(x0 + inset)},{f(y0 + inset)} H{f(cx)} A{f(r - inset)},{f(r - inset)} 0 0 1 {f(cx)},{f(y1 - inset)} H{f(x0 + inset)} Z"
    t = r - ri                                   # the stroke: bars and bowl
    cy = (y0 + y1) / 2
    hx0 = x0 + t - inset
    hole = (f"M{f(hx0)},{f(cy - ri - inset)} V{f(cy + ri + inset)} H{f(cx)} "
            f"A{f(ri + inset)},{f(ri + inset)} 0 0 0 {f(cx)},{f(cy - ri - inset)} Z")
    return [outer, hole]


D_M = d_shape(44, 36, 212, 220, 50)              # stem 42 (44 to 86), bowl 42 (r 92 to r 50)
KEY_M = diamond(130, 128, 28)
# Reversed (light on dark): every edge 0.75 in, so light on dark looks as heavy as ink on light.
D_R = d_shape(44, 36, 212, 220, 50, inset=0.75)
KEY_R = diamond(130, 128, 27.25)
# Small cut for 24 px and below, on a 16-unit grid (1 unit = 16): stem and bowl 3, counter r 3, keyframe r 2.
U = 16
D_S = d_shape(2 * U, 2 * U, 14 * U, 14 * U, 3 * U)
KEY_S = diamond(8 * U, 8 * U, 2 * U)


def mark(d, key, d_color, key_color):
    if d_color == key_color:
        return f'<path fill="{d_color}" d="{" ".join(d)} {key}"/>'
    return f'<path fill="{d_color}" d="{" ".join(d)}"/><path fill="{key_color}" d="{key}"/>'


# ------------------------------------------------------------------ the wordmark
# Cap height 100 (y 0 to 100, baseline 100), x-height 72, stems 18, horizontals 16, round overshoot 1.
CAP, XH, ST, HB = 100, 72, 18, 16
XT = CAP - XH  # x-height top, 28
RO, RI = 37, 19  # bowl radii for x-height letters (37 - 19 = 18)
BCY = XT + XH / 2  # x-height bowl centre, 64


def glyph_D(x):
    w, r, ri = 84, 50, 32
    outer = f"M{f(x)},0 H{f(x + w - r)} A{r},{r} 0 0 1 {f(x + w - r)},{CAP} H{f(x)} Z"
    inner = f"M{f(x + ST)},{ST} V{CAP - ST} H{f(x + w - r)} A{ri},{ri} 0 0 0 {f(x + w - r)},{ST} Z"
    return [outer, inner], w


def glyph_e(x):
    cx = x + RO
    ring = sector(cx, BCY, RO, RI, 40, 360)                # open from 0° to 40°, below the bar on the right
    bar = rect(cx - RO + 2, BCY - HB / 2, cx + RO - 1, BCY + HB / 2)
    return [ring, bar], 2 * RO


def glyph_p(x):
    cx = x + RO
    return [rect(x, XT, x + ST, CAP + 32), circle(cx, BCY, RO), circle(cx, BCY, RI, ccw=True)], 2 * RO


def glyph_d(x):
    cx = x + RO
    return [circle(cx, BCY, RO), circle(cx, BCY, RI, ccw=True), rect(x + 2 * RO - ST, 0, x + 2 * RO, CAP)], 2 * RO


def glyph_B(x):
    wu, wl = 74, 80
    mid0, mid1 = 42, 58
    ru, rl = mid1 / 2, (CAP - mid0) / 2
    up_o = f"M{f(x)},0 H{f(x + wu - ru)} A{f(ru)},{f(ru)} 0 0 1 {f(x + wu - ru)},{mid1} H{f(x)} Z"
    up_i = f"M{f(x + ST)},{ST} V{mid0} H{f(x + wu - ru)} A{f((mid0 - ST) / 2)},{f((mid0 - ST) / 2)} 0 0 0 {f(x + wu - ru)},{ST} Z"
    lo_o = f"M{f(x)},{mid0} H{f(x + wl - rl)} A{f(rl)},{f(rl)} 0 0 1 {f(x + wl - rl)},{CAP} H{f(x)} Z"
    lo_i = f"M{f(x + ST)},{mid1} V{CAP - ST} H{f(x + wl - rl)} A{f((CAP - ST - mid1) / 2)},{f((CAP - ST - mid1) / 2)} 0 0 0 {f(x + wl - rl)},{mid1} Z"
    return [up_o, up_i, lo_o, lo_i], wl


def glyph_u(x):
    w = 2 * RO - 2
    r = w / 2
    cx = x + r
    left = rect(x, XT, x + ST, BCY)
    right = rect(x + w - ST, XT, x + w, CAP)
    bowl = sector(cx, BCY, r, r - ST, 0, 180)
    return [left, right, bowl], w


def glyph_i(x, dot):
    stem = rect(x, XT, x + ST, CAP)
    d = diamond(x + ST / 2, 6, 12)           # the i's dot is a small keyframe
    return ([stem], [d]) if dot else ([stem, d], []), ST


def glyph_l(x):
    return [rect(x, 0, x + ST, CAP)], ST


def wordmark(split_dot):
    """Returns (body paths, dot paths, width). With split_dot the i's bob is returned separately for colour."""
    x, body, dots = 0, [], []
    seq = [("D", 10), ("e", 8), ("e", 12), ("p", 15), ("B", 15), ("u", 18), ("i", 18), ("l", 15), ("d", 0)]
    for ch, gap in seq:
        if ch == "D": p, w = glyph_D(x)
        elif ch == "e": p, w = glyph_e(x)
        elif ch == "p": p, w = glyph_p(x)
        elif ch == "B": p, w = glyph_B(x)
        elif ch == "u": p, w = glyph_u(x)
        elif ch == "i":
            (p, dp), w = glyph_i(x, split_dot)
            dots += dp
        elif ch == "l": p, w = glyph_l(x)
        else: p, w = glyph_d(x)
        body += p
        x += w + gap
    return body, dots, x


def write(name, s):
    with open(os.path.join(HERE, name), "w", encoding="utf-8") as fh:
        fh.write(s)


# symbols
write("symbol-ink.svg", svg(mark(D_M, KEY_M, INK, INK)))
write("symbol-white.svg", svg(mark(D_R, KEY_R, WHITE, WHITE)))
write("symbol-color-dark.svg", svg(mark(D_R, KEY_R, WHITE, SIGNAL)))
write("symbol-small-ink.svg", svg(mark(D_S, KEY_S, INK, INK)))
write("symbol-small-white.svg", svg(mark(D_S, KEY_S, WHITE, WHITE)))
write("symbol-small-color-dark.svg", svg(mark(D_S, KEY_S, WHITE, SIGNAL)))

# wordmark
body, dots, W = wordmark(split_dot=True)
WM_VB = f"-4 -10 {f(W + 8)} {CAP + 32 + 14}"
write("wordmark-ink.svg", svg(f'<path fill="{INK}" d="{" ".join(body + dots)}"/>', WM_VB))
write("wordmark-white.svg", svg(f'<path fill="{WHITE}" d="{" ".join(body + dots)}"/>', WM_VB))
write("wordmark-color-dark.svg", svg(f'<path fill="{WHITE}" d="{" ".join(body)}"/><path fill="{SIGNAL}" d="{" ".join(dots)}"/>', WM_VB))


# The keyframe swings out and settles back once. It is in place at the first and last frame, so a still capture always
# shows the mark, and it holds still under reduced motion.
ANIM_CSS = ("<style>.key{transform-box:fill-box;transform-origin:center;animation:settle 1.6s cubic-bezier(.3,.7,.2,1) 1}"
            "@keyframes settle{0%{transform:none}14%{transform:translateX(-40%) rotate(-90deg) scale(.6)}"
            "78%{transform:translateX(3%) rotate(6deg) scale(1.03)}100%{transform:none}}"
            "@media (prefers-reduced-motion:reduce){.key{animation:none}}</style>")


# lockups: the mark is 1.9 × cap height tall; horizontal: the cap height centred on the mark, then 6 lower, gap 0.45 × mark width
MARK_TOP, MARK_BOTTOM, MARK_LEFT, MARK_RIGHT = 36, 220, 44, 212


def lockup(kind, d_c, key_c, body_c, dot_c, d=D_M, key=KEY_M, animate=False):
    s = 1.9 * CAP / (MARK_BOTTOM - MARK_TOP)
    mx, my = -MARK_LEFT * s, -MARK_TOP * s
    mark_w = (MARK_RIGHT - MARK_LEFT) * s
    if kind == "horizontal":
        gap = 0.45 * mark_w
        tx, ty = mark_w + gap, (1.9 * CAP - CAP) / 2 + 6
        w, h = tx + W, 1.9 * CAP
    else:
        tx, ty = 0, 1.9 * CAP + 0.55 * CAP
        w, h = W, ty + CAP + 32
        mx += (W - mark_w) / 2
    vb = f"-8 -8 {f(w + 16)} {f(h + 16)}"
    inner = mark(d, key, d_c, key_c)
    if animate:   # the keyframe eases into the counter once, then rests; still under reduced motion
        inner = (f'<path fill="{d_c}" d="{" ".join(d)}"/><path class="key" fill="{key_c}" d="{key}"/>')
    g_mark = f'<g transform="translate({f(mx)} {f(my)}) scale({f(s)})">{inner}</g>'
    if dot_c == body_c:
        g_word = f'<g transform="translate({f(tx)} {f(ty)})"><path fill="{body_c}" d="{" ".join(body + dots)}"/></g>'
    else:
        g_word = (f'<g transform="translate({f(tx)} {f(ty)})"><path fill="{body_c}" d="{" ".join(body)}"/>'
                  f'<path fill="{dot_c}" d="{" ".join(dots)}"/></g>')
    style = ""
    if animate:
        style = ANIM_CSS
    return svg(style + g_mark + g_word, vb)


for kind in ("horizontal", "stacked"):
    write(f"lockup-{kind}-ink.svg", lockup(kind, INK, INK, INK, INK))
    write(f"lockup-{kind}-white.svg", lockup(kind, WHITE, WHITE, WHITE, WHITE, D_R, KEY_R))
    write(f"lockup-{kind}-color-dark.svg", lockup(kind, WHITE, SIGNAL, WHITE, SIGNAL, D_R, KEY_R))

# social preview: GitHub's 1280 × 640 card, the colour horizontal lockup on Ink at 60% of the width, centred
SOCIAL_W, SOCIAL_H = 1280, 640
_lockup = lockup("horizontal", WHITE, SIGNAL, WHITE, SIGNAL, D_R, KEY_R)
_vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', _lockup).group(1).split()]
_s = 0.6 * SOCIAL_W / _vb[2]
write("social-preview.svg", svg(
    f'<path fill="{INK}" d="{rect(0, 0, SOCIAL_W, SOCIAL_H)}"/>'
    f'<g transform="translate({f((SOCIAL_W - _vb[2] * _s) / 2 - _vb[0] * _s)} {f((SOCIAL_H - _vb[3] * _s) / 2 - _vb[1] * _s)}) scale({f(_s)})">'
    + _lockup.split(">", 1)[1].rsplit("</svg>", 1)[0] + "</g>", f"0 0 {SOCIAL_W} {SOCIAL_H}"))

# README header: ink on light, colour on dark; the keyframe swings and settles once
write("readme-light.svg", lockup("horizontal", INK, INK, INK, INK, animate=True))
write("readme-dark.svg", lockup("horizontal", WHITE, SIGNAL, WHITE, SIGNAL, D_R, KEY_R, animate=True))
# the mark in motion on its own, for intros and the app's loading state
write("symbol-animated-color-dark.svg", svg(
    ANIM_CSS +
    f'<path fill="{INK}" d="{rrect(0, 0, 256, 256, 56)}"/><g transform="translate(25.6 25.6) scale(0.8)">'
    f'<path fill="{WHITE}" d="{" ".join(D_R)}"/><path class="key" fill="{SIGNAL}" d="{KEY_R}"/></g>'))


# app icon: macOS tile (824 on a 1024 canvas, radius 185), white D and Signal keyframe, mark 62% of the tile
def app_icon(small=False):
    tile = rrect(100, 100, 924, 924, 185)
    if small:
        d, key, top, bottom, left, right = D_S, KEY_S, 2 * U, 14 * U, 2 * U, 14 * U
    else:
        d, key, top, bottom, left, right = D_R, KEY_R, MARK_TOP, MARK_BOTTOM, MARK_LEFT, MARK_RIGHT
    s = 0.62 * 824 / (bottom - top)
    mx = 512 - (left + right) / 2 * s
    my = 512 - (top + bottom) / 2 * s
    return svg(f'<path fill="{INK}" d="{tile}"/><g transform="translate({f(mx)} {f(my)}) scale({f(s)})">'
               f'{mark(d, key, WHITE, SIGNAL)}</g>', "0 0 1024 1024")


write("app-icon.svg", app_icon())
write("app-icon-small.svg", app_icon(small=True))
# menu-bar template icon: black small cut on transparent; macOS tints it
write("menubar-template.svg", svg(mark(D_S, KEY_S, "#000000", "#000000")))
# favicon: the small cut, colour on an ink rounded square
write("favicon.svg", svg(f'<path fill="{INK}" d="{rrect(0, 0, 256, 256, 56)}"/><g transform="translate(16 16) scale(0.875)">'
                         f'{mark(D_S, KEY_S, WHITE, SIGNAL)}</g>'))


# construction drawing: the 8-unit grid, the mark faint underneath, and its parts outlined with their sizes
def construction():
    guide = "#D2401E"
    grid = "".join(f'<path d="M{v} 0V256M0 {v}H256"/>' for v in range(0, 257, 8))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><g opacity=".12" stroke="{INK}" stroke-width=".5">{grid}</g>\n'
            '<image href="symbol-ink.svg" width="256" height="256" opacity=".18"/>\n'
            f'<g fill="none" stroke="{guide}" stroke-width="1.2"><circle cx="120" cy="128" r="92"/><circle cx="120" cy="128" r="50"/>'
            f'<path d="{KEY_M}"/><path d="M44 36V220M86 78V178M120 20V236" stroke-dasharray="4 4"/></g>\n'
            f'<g font-family="-apple-system,system-ui" font-size="8" fill="{guide}"><text x="8" y="30">stem 42 · bars 42</text>'
            '<text x="168" y="30">bowl r 92</text><text x="150" y="106">counter r 50</text><text x="132" y="170">keyframe r 28</text>'
            '<text x="6" y="248">every stroke 42; the keyframe sits on the counter\'s centroid</text></g></svg>\n')


write("construction-keyframe.svg", construction())
print("wordmark width", f(W))
