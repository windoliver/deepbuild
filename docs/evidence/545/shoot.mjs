// Issue 545's last criterion: screenshots of the 10 Hz item's linear write at 0.15 s and 6.05 s and of the follow
// camera's hold, with a recording of the interpolated item. The positions are what `deep-logic`'s live view draws
// (`frame`'s `draws`); each picture is a frame `deep-canvas-render raster` draws from a figure placing a dot there,
// since no canvas item reads a logic array yet (#266, #284). Usage:
//   node shoot.mjs <repo> <outdir> <framesdir>
// It needs `target/debug/deep-logic`, `target/debug/deep-canvas-render` and the #545 suite's assembler
// (`target/acceptance-545-wat/debug/acceptance-545-wat`, built by any run of that suite).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [repo, out, framesDir] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
mkdirSync(framesDir, { recursive: true });
const FL = 705_600_000;

// The programs: the 10 Hz mover writes x = k m into its vec3 `pos`; the 60 Hz follow camera writes x = k × 0.05 m
// (3 m/s) into its vec3 `position`. Each write region holds its one vec3 at 4096.
const program = (name, x) => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-545-shoot-'));
  const file = join(dir, `${name}.wat`);
  writeFileSync(file, `(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 4096))
  (func (export "init") (param i64))
  (func (export "step") (param $k i64) (f64.store (i32.const 4096) ${x})))`);
  const r = spawnSync(join(repo, 'target/acceptance-545-wat/debug/acceptance-545-wat'), [dir, file], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(r.stderr);
  const bytes = readFileSync(join(dir, `${name}.wasm`));
  rmSync(dir, { recursive: true, force: true });
  return { b64: bytes.toString('base64'), sha: createHash('sha256').update(bytes).digest('hex') };
};
const piece = (id, p, rate, write, interpolate) => ({
  seed: 545, assets: { [p.sha]: p.b64 },
  items: { [id]: { kind: 'logic@1', params: { program: p.sha, step_rate: rate, writes: { [write]: { type: 'vec3', interpolate } } } } },
});
const mover = piece('mover', program('mover', '(f64.convert_i64_s (local.get $k))'), 10, 'pos', 'linear');
const cam = piece('cam', program('cam', '(f64.mul (f64.convert_i64_s (local.get $k)) (f64.const 0.05))'), 60, 'position', 'hold');

// The live views, played a frame at a time: the mover at 60 fps to 6.05 s, the camera at 120 Hz for 8 frames.
const calls = [{ call: 'view', piece: mover, span: 7 }, { call: 'frame', session: 'v1' }];
for (let i = 1; i <= 363; i++) calls.push({ call: 'frame', session: 'v1', play: 1 / 60 });
calls.push({ call: 'view', piece: cam, span: 1 }, { call: 'frame', session: 'v2' });
for (let i = 1; i < 8; i++) calls.push({ call: 'frame', session: 'v2', play: 1 / 120 });
const run = spawnSync(join(repo, 'target/debug/deep-logic'), [], { input: calls.map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 28 });
const replies = run.stdout.trim().split('\n').map((l) => JSON.parse(l));
const frames = replies.filter((r) => r.frame !== undefined);
if (frames.some((f) => !f.ok || f.stale)) throw Error(`a frame didn't land: ${JSON.stringify(frames.find((f) => !f.ok || f.stale))}`);
const moverFrames = frames.slice(0, 364);
const camFrames = frames.slice(364);
const x = (f, path) => f.draws[path][0][0];

// The figures: a metre rule, the values the last two steps stored as rings, and the drawn value as a dot.
const LOOK = { light: { ground: [255, 255, 255], ink: [30, 30, 30], hub: [150, 150, 150], accent: [220, 80, 40] } };
const item = (id, kind, order, params) => ({ id, kind, layer: 'main', name: id, order, params });
const figure = (id, size, list) => ({
  format: 1, id, profile: 'figure', title: id, description: `#545 evidence ${id}`, size,
  layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items: Object.fromEntries(list.map((i) => [i.id, i])),
});
function rule(id, from, to, rings, dot) {
  const px = (m) => 40 + ((m - from) / (to - from)) * 560;
  const list = [item('axis', 'path@1', 'a0', { d: 'M 40 80 L 600 80', paint: { stroke: { role: 'ink', width: 2 } } })];
  for (let m = Math.ceil(from); m <= to; m++) list.push(item(`tick${m}`, 'path@1', `a1${m}`, { d: `M ${px(m)} 70 L ${px(m)} 90`, paint: { stroke: { role: 'ink', width: 2 } } }));
  rings.forEach((m, i) => list.push(item(`ring${i}`, 'circle@1', `b${i}`, { center: [px(m), 50], r: 9, paint: { stroke: { role: 'hub', width: 2 } } })));
  list.push(item('dot', 'circle@1', 'c0', { center: [px(dot), 50], r: 7, paint: { fill: { role: 'accent' } } }));
  return figure(id, [640, 110], list);
}
// The follow camera: one row per 120 Hz frame, its held position as a dot, the position a blend would show as a ring.
function filmstrip(id, rows) {
  const px = (m) => 40 + (m / 0.2) * 560;
  const list = rows.flatMap(([held, smooth], i) => [
    item(`ring${i}`, 'circle@1', `a${i}`, { center: [px(smooth), 20 + i * 24], r: 8, paint: { stroke: { role: 'hub', width: 2 } } }),
    item(`dot${i}`, 'circle@1', `b${i}`, { center: [px(held), 20 + i * 24], r: 6, paint: { fill: { role: 'accent' } } }),
  ]);
  return figure(id, [640, 20 + rows.length * 24], list);
}

const at = (t) => moverFrames[Math.round(t * 60)];
const jobs = [
  { out: join(out, 'linear-0.15s.png'), doc: rule('linear-015', 0, 3, [0, 1], x(at(0.15), 'mover.pos')) },
  { out: join(out, 'linear-6.05s.png'), doc: rule('linear-605', 57, 62, [59, 60], x(at(6.05), 'mover.pos')) },
  { out: join(out, 'follow-hold.png'), doc: filmstrip('follow-hold', camFrames.map((f) => [x(f, 'cam.position'), (f.t / FL) * 3])) },
];
for (let k = 0; k <= 60; k++) {
  const stored = Math.floor(k / 6);
  jobs.push({ out: join(framesDir, `m${String(k).padStart(3, '0')}.png`), doc: rule(`m${k}`, 0, 10, [stored], x(moverFrames[k], 'mover.pos')) });
}
const input = jobs.map((j) => JSON.stringify({ ...j, t: 0, look: LOOK, view: { zoom: 2 } })).join('\n') + '\n';
const r = spawnSync(join(repo, 'target/debug/deep-canvas-render'), ['raster'], { input, encoding: 'utf8', maxBuffer: 1 << 28 });
const answers = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
const bad = answers.filter((a) => !a.ok);
console.log(`${answers.length} frames, ${bad.length} refused${bad.length ? ': ' + JSON.stringify(bad[0]).slice(0, 400) : ''}`);
console.log(`drawn: 0.15 s ${x(at(0.15), 'mover.pos')} m, 6.05 s ${x(at(6.05), 'mover.pos')} m, camera ${camFrames.map((f) => x(f, 'cam.position')).join(', ')} m`);
if (r.stderr) console.error(r.stderr.slice(0, 1000));
