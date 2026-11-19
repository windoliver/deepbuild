// Draws #1619's pictures from the renderer's own frames: `deep-gpu run`'s `film2d` over one test card under each of
// the screen's new fields, the criterion's line fixture enlarged, and a 3 s animation of the band and the roll. Run from
// the repository root after `cargo build --locked --bin deep-gpu` (or name the binary: `node shoot.mjs <deep-gpu>`),
// with ffmpeg on PATH; it writes beside itself and prints each file's SHA-256. Draws on Metal.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = process.argv[2] ?? join(REPO, 'target', 'debug', 'deep-gpu');
const BASE = JSON.parse(readFileSync(join(REPO, 'tests', 'acceptance', '1619', 'fixtures', 'look.json'), 'utf8'));
const W = 480; const H = 270; const FPS = 24; const FRAMES = 72;

const COLORS = {
  night: '#101418', bright: '#ffffff', black: '#000000', grey: '#8b8f97',
  bar0: '#e8e8e8', bar1: '#e6d21e', bar2: '#1ecfd6', bar3: '#28c23c', bar4: '#d228c8', bar5: '#d62a2a', bar6: '#2a3ad6',
};
const look = (finish) => {
  const palette = { ...BASE.palette }; const roles = { ...BASE.roles };
  for (const [role, c] of Object.entries(COLORS)) { palette[`c-${role}`] = c; roles[role] = `c-${role}`; }
  return { ...BASE, id: 'shots-1619', description: 'The #1619 evidence look.', palette, roles, finish };
};
const doc = (id, size, items) => ({
  format: 1, id, profile: 'figure', title: id, description: `The #1619 evidence figure ${id}.`, size, seed: 1619,
  transport: { span: '8s' }, requires: { modules: { effects: '^1' } }, budget: { class: 'showpiece' },
  layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } },
  items: Object.fromEntries(items.map((i) => [i.id, i])),
});
let order = 0;
const next = () => `a${String(order++).padStart(3, '0')}`;
const rect = (id, box, role) => ({ id, kind: 'rect@1', layer: 'main', name: id, order: next(), params: { box, paint: { fill: { role } } } });
const circle = (id, center, r, role) => ({ id, kind: 'circle@1', layer: 'main', name: id, order: next(), params: { center, r, paint: { fill: { role } } } });

// The test card: seven bars, a black field with white hairlines both ways, discs, and a grey step wedge.
const CARD = doc('card-1619', [W, H], [
  rect('ground', [0, 0, W, H], 'night'),
  ...Array.from({ length: 7 }, (_, k) => rect(`bar-${k}`, [24 + k * 62, 20, 62, 120], `bar${k}`)),
  rect('field', [24, 150, 280, 100], 'black'),
  ...Array.from({ length: 9 }, (_, k) => rect(`v-${k}`, [44 + k * 30, 158, 1, 84], 'bright')),
  ...Array.from({ length: 4 }, (_, k) => rect(`h-${k}`, [32, 168 + k * 22, 264, 1], 'bright')),
  circle('disc', [380, 200], 44, 'bright'),
  circle('core', [380, 200], 30, 'black'),
  circle('dot', [380, 200], 10, 'bar5'),
  ...Array.from({ length: 4 }, (_, k) => rect(`step-${k}`, [436, 150 + k * 25, 22, 25], ['bright', 'grey', 'night', 'black'][k])),
]);
const LINE = (vertical) => doc(`line-${vertical ? 'v' : 'h'}-1619`, [48, 48], [
  rect('black', [0, 0, 48, 48], 'black'), rect('line', vertical ? [24, 8, 1, 32] : [8, 24, 32, 1], 'bright'),
]);

const BAND = { band: 26, rate: 12, shift: 14, seed: 7 };
const STILLS = [
  ['source', [], 0],
  ['convergence-0', [{ screen: { kind: 'crt', convergence: 3, convergence_angle: 0 } }], 0],
  ['convergence-45', [{ screen: { kind: 'crt', convergence: 3, convergence_angle: 45 } }], 0],
  ['convergence-90', [{ screen: { kind: 'crt', convergence: 3, convergence_angle: 90 } }], 0],
  ['tracking', [{ screen: { kind: 'vhs', tracking: BAND } }], 9],
  ['roll', [{ screen: { kind: 'vhs', roll: { period: '2s', amount: 1 } } }], 15],
  ['tape', [{ screen: { kind: 'vhs', scanlines: 135, bleed: 0.5, noise: '8%', convergence: 2, convergence_angle: 20, tracking: BAND, roll: { period: '3s', amount: 0.12 } } }], 30],
  ['console', [{ screen: { kind: 'crt', scanlines: 90, mask: 'aperture', curvature: 0.08, convergence: 1.5, convergence_angle: 135 } }], 0],
];
const FILMS = [STILLS[0], STILLS[4], STILLS[5], STILLS[6]];

const out = mkdtempSync(join(tmpdir(), 'deep-1619-shots-'));
function run(calls) {
  const r = spawnSync(BIN, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw Error(`deep-gpu run exits ${r.status}: ${r.stderr.slice(-2000)}`);
  const a = JSON.parse(r.stdout.trim());
  if (!a.ok) throw Error(JSON.stringify(a).slice(0, 2000));
  for (const reply of a.replies) if (reply.code) throw Error(`refused: ${JSON.stringify(reply)}`);
  return a.replies;
}
const film = (d, finish, extra) => ({ call: 'film2d', doc: d, look: look(finish), fps: FPS, ...extra });
const png = (reply, n) => join(out, `${reply.frames.find((f) => f.frame === n).final}.png`);
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`ffmpeg ${args.join(' ')}: ${r.stderr}`);
}
const written = [];
const keep = (name) => { written.push(name); return join(HERE, name); };

// The stills, each at the frame that shows its field, tiled four across in STILLS' order.
const stills = run(STILLS.map(([, finish, n]) => film(CARD, finish, { from: n, frames: 1, capture: [n] })));
ffmpeg([...STILLS.flatMap((s, i) => ['-i', png(stills[i], s[2])]), '-filter_complex',
  `${STILLS.map((_, i) => `[${i}:v]`).join('')}xstack=inputs=8:layout=0_0|${W}_0|${2 * W}_0|${3 * W}_0|0_${H}|${W}_${H}|${2 * W}_${H}|${3 * W}_${H}`, keep('looks.png')]);

// The criterion's line fixture at convergence 2: the vertical line at 0° and the horizontal at 90°, each pixel 8 wide.
const lines = run([0, 90].map((angle) => film(LINE(angle === 0), [{ screen: { kind: 'crt', convergence: 2, convergence_angle: angle } }], { frames: 1, capture: [0] })));
ffmpeg(['-i', png(lines[0], 0), '-i', png(lines[1], 0), '-filter_complex', '[0:v]scale=384:384:flags=neighbor,pad=392:384:0:0:gray[a];[1:v]scale=384:384:flags=neighbor[b];[a][b]hstack', keep('line.png')]);

// The film: the source, the band, the roll and the tape look, two by two, 3 s played from frame 0.
const all = [...Array(FRAMES).keys()];
const films = run(FILMS.map(([, finish]) => film(CARD, finish, { frames: FRAMES, capture: all })));
FILMS.forEach((_, i) => all.forEach((n) => copyFileSync(png(films[i], n), join(out, `film-${i}-${String(n).padStart(3, '0')}.png`))));
const grid = `${FILMS.map((_, i) => `[${i}:v]`).join('')}xstack=inputs=4:layout=0_0|${W}_0|0_${H}|${W}_${H}`;
const inputs = FILMS.flatMap((_, i) => ['-framerate', String(FPS), '-i', join(out, `film-${i}-%03d.png`)]);
ffmpeg([...inputs, '-filter_complex', `${grid},fps=12,scale=720:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=none`, keep('film.gif')]);

rmSync(out, { recursive: true, force: true });
for (const name of written) console.log(`${createHash('sha256').update(readFileSync(join(HERE, name))).digest('hex')}  ${name}  ${readFileSync(join(HERE, name)).length} bytes`);
