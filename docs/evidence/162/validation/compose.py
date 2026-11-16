"""Side-by-side validation of the Lottie export: our own render | the Lottie file played by the
reference renderer | their luma difference (x4, red), per sampled frame. Writes sheet.png (five
frames) and frames/NNN.png for the video, with labels in a strip above each row, never on a frame."""
import json, math, os, struct, sys, zlib

D = sys.argv[1]
meta = json.load(open(os.path.join(D, 'meta.json')))
W, H = meta['size']
frames = meta['frames']
GROUND = (232, 232, 232)

FONT = {  # 5x7, rows top to bottom, '#' on
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], 'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'], 'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], 'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'], 'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'I': ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'], 'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'], 'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'], 'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'], 'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'], 'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], 'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    'X': ['#...#', '.#.#.', '..#..', '..#..', '..#..', '.#.#.', '#...#'], 'Y': ['#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..', '..#..'],
    '0': ['.###.', '#..##', '#.#.#', '#.#.#', '##..#', '#...#', '.###.'], '1': ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'], '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    '4': ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'], '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'], '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'], '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
    ' ': ['...', '...', '...', '...', '...', '...', '...'], '.': ['.', '.', '.', '.', '.', '.', '#'], ':': ['.', '#', '.', '.', '.', '#', '.'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'], '(': ['.#', '#.', '#.', '#.', '#.', '#.', '.#'], ')': ['#.', '.#', '.#', '.#', '.#', '.#', '#.'],
    '|': ['#', '#', '#', '#', '#', '#', '#'], 'X4': ['#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....', '.....'],
}


class Canvas:
    def __init__(self, w, h, bg=(255, 255, 255)):
        self.w, self.h = w, h
        self.px = bytearray(bytes(bg) * (w * h))

    def put(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = 3 * (y * self.w + x)
            self.px[i:i + 3] = bytes(c)

    def text(self, x, y, s, scale=2, c=(30, 30, 30)):
        for ch in s.upper():
            g = FONT.get(ch, FONT[' '])
            for r, row in enumerate(g):
                for k, on in enumerate(row):
                    if on == '#':
                        for dy in range(scale):
                            for dx in range(scale):
                                self.put(x + k * scale + dx, y + r * scale + dy, c)
            x += (len(g[0]) + 1) * scale

    def blit(self, img, x0, y0, z):
        w, h, px = img
        for y in range(h * z):
            for x in range(w * z):
                i = 3 * ((y // z) * w + x // z)
                self.put(x0 + x, y0 + y, px[i:i + 3])

    def png(self, path):
        rows = b''.join(b'\0' + bytes(self.px[3 * y * self.w:3 * (y + 1) * self.w]) for y in range(self.h))
        c = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + c(b'IHDR', struct.pack('>IIBBBBB', self.w, self.h, 8, 2, 0, 0, 0)) + c(b'IDAT', zlib.compress(rows)) + c(b'IEND', b''))


def rgb(path):
    raw = open(path, 'rb').read()
    out = bytearray()
    for i in range(W * H):
        a = raw[4 * i + 3] / 255
        out += bytes(round(raw[4 * i + k] * a + GROUND[k] * (1 - a)) for k in range(3))
    return out


def luma(p, i):
    return 0.2126 * p[3 * i] + 0.7152 * p[3 * i + 1] + 0.0722 * p[3 * i + 2]


def diff(a, b):
    out = bytearray()
    worst = 0.0
    se = 0.0
    for i in range(W * H):
        d = abs(luma(a, i) - luma(b, i))
        worst = max(worst, d)
        se += d * d
        v = min(255, d * 4)
        out += bytes((255, round(255 - v), round(255 - v)))
    mse = se / (W * H)
    return out, worst, (math.inf if mse == 0 else 10 * math.log10(255 * 255 / mse))


samples = {s['frame']: s for s in meta['receipt']['fidelity']['samples']}
rows = []
for f in frames:
    a = rgb(os.path.join(D, f'raw-{f}.rgba'))
    b = rgb(os.path.join(D, f'read-{f}.rgba'))
    d, worst, p = diff(a, b)
    rows.append((f, a, b, d, worst, p))
    print(f'frame {f:2d}: whole-frame psnr {p if p != math.inf else "inf":>8} max diff {worst:6.1f}; receipt psnr {samples[f]["psnr_y"]} ssim {samples[f].get("ssim")}')

Z, GAP, STRIP = 2, 12, 40
panel = W * Z
os.makedirs(os.path.join(D, 'frames'), exist_ok=True)
heads = ['OUR RENDER', 'LOTTIE FILE (REFERENCE)', 'DIFFERENCE X4']
for n, (f, a, b, d, worst, p) in enumerate(rows):
    c = Canvas(3 * panel + 4 * GAP, H * Z + STRIP + GAP)
    for k, h in enumerate(heads):
        c.text(GAP + k * (panel + GAP), 10, h)
    c.text(3 * panel + 4 * GAP - 330, 10, f'FRAME {f}')
    for k, img in enumerate((a, b, d)):
        c.blit((W, H, img), GAP + k * (panel + GAP), STRIP, Z)
    c.png(os.path.join(D, 'frames', f'{n:03d}.png'))

pick = [0, 12, 24, 36, 45]
sheet = Canvas(3 * panel + 4 * GAP, len(pick) * (H * Z + STRIP + GAP) + GAP)
y = GAP
for f in pick:
    _, a, b, d, worst, p = next(r for r in rows if r[0] == f)
    sheet.text(GAP, y, f'FRAME {f}   ' + '   |   '.join(heads))
    for k, img in enumerate((a, b, d)):
        sheet.blit((W, H, img), GAP + k * (panel + GAP), y + 26, Z)
    y += H * Z + STRIP + GAP
sheet.png(os.path.join(D, 'sheet.png'))
