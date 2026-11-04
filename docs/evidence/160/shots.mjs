// Issue 160's last criterion: screenshots of a trim on a circle, a repeater, a tapered stroke and an arrow drawn on a
// path, and a recording of the trim and the arrow animating, each drawn by `deep-canvas-render raster` from the
// canvas's own frames. Usage: node shots.mjs <repo> <outdir> <framesdir>
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [repo, out, framesDir] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
mkdirSync(framesDir, { recursive: true });
const BIN = join(repo, 'target', 'debug', 'deep-canvas-render');
const FL = 705_600_000;
const LOOK = { light: { ground: [255, 255, 255], ink: [0, 0, 0], body: [40, 90, 160], petal: [220, 80, 120], hub: [90, 90, 90], rim: [200, 30, 30] } };
const figure = (id, size, list, extra = {}) => ({
  format: 1, id, profile: 'figure', title: id, description: `#160 evidence ${id}`, size,
  layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
  items: Object.fromEntries(list.map((i) => [i.id, i])), ...extra,
});
const item = (id, kind, order, params, extra = {}) => ({ id, kind, layer: 'main', name: id, order, params, ...extra });
const keyed = (target, keys) => ({ target, type: 'f32', keys: Object.fromEntries(keys.map(([t, v], i) => [`k${i}`, { t: `${t}s`, value: v, interp: 'linear' }])) });
const fixture = (n) => JSON.parse(readFileSync(join(repo, 'tests/acceptance/160/fixtures/parity/2d', n), 'utf8'));

// AC1: a trim from 0 to 0.25 with an offset of 90° on a circle, over the whole circle drawn faintly for reference.
const trimCircle = figure('trim-circle', [200, 200], [
  item('guide', 'circle@1', 'a0', { center: [100, 100], r: 70, paint: { stroke: { role: 'hub', width: 1 } } }),
  item('ring', 'circle@1', 'a1', { center: [100, 100], r: 70, ops: [{ trim: { start: 0, end: 0.25, offset: 90 } }], paint: { stroke: { role: 'ink', width: 4 } } }),
]);
// AC2: a bar repeated 3.5 times: four copies, the last at half opacity.
const repeater = figure('repeater', [240, 140], [
  item('bar', 'path@1', 'a0', { d: 'M 30 40 L 54 40 L 54 100 L 30 100 Z', ops: [{ repeater: { copies: 3.5, at: { pos: [48, 0] } } }], paint: { fill: { role: 'body' } } }),
]);
// AC6: a stroke tapered from full width to 0 over its last 20%.
const taper = figure('taper', [440, 120], [
  item('brush', 'path@1', 'a0', { d: 'M 20 60 L 420 60', paint: { stroke: { role: 'ink', width: 12, cap: 'butt', taper: { end: 80, end_width: 0, ease: 0 } } } }),
]);
// AC7: a path drawn on by a trim from 0 to 1 over 1 s with an arrow at its end.
const drawOn = figure('ends-draw-on', [320, 240], [
  item('draw', 'path@1', 'a0', { d: 'M 40 200 L 200 200 L 280 120 L 280 40', ops: [{ trim: { start: 0, end: 0 } }], ends: { end: 'arrow' }, paint: { stroke: { role: 'ink', width: 4 } } }),
], { transport: { span: '2s' }, channels: { 'draw-end': keyed('items/draw/params/ops/0/end', [[0, 0], [1, 1]]) } });

const view = { zoom: 2 };
const jobs = [
  { out: join(out, 'trim-circle.png'), doc: trimCircle, t: 0 },
  { out: join(out, 'repeater.png'), doc: repeater, t: 0 },
  { out: join(out, 'taper.png'), doc: taper, t: 0 },
  { out: join(out, 'arrow-on-path.png'), doc: drawOn, t: Math.round(0.6 * FL) },
];
// The recording: the drawn-on arrow from 0 to 1.25 s, then the loader (a trim whose window grows, follows and
// travels round a ring, an arrow at its end) over its 2 s, both at 30 fps.
const loader = fixture('loader.film');
for (let k = 0; k <= 38; k++) jobs.push({ out: join(framesDir, `a${String(k).padStart(3, '0')}.png`), doc: drawOn, t: Math.round((k / 30) * FL) });
for (let k = 0; k < 60; k++) jobs.push({ out: join(framesDir, `b${String(k).padStart(3, '0')}.png`), doc: loader, t: Math.round((k / 30) * FL) });
const input = jobs.map((j) => JSON.stringify({ ...j, look: LOOK, view })).join('\n') + '\n';
const r = spawnSync(BIN, ['raster'], { input, encoding: 'utf8', maxBuffer: 1 << 28 });
const answers = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
const bad = answers.filter((a) => !a.ok);
console.log(`${answers.length} frames, ${bad.length} refused${bad.length ? ': ' + JSON.stringify(bad[0]).slice(0, 400) : ''}`);
if (r.stderr) console.error(r.stderr.slice(0, 1000));
