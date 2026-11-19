// #2760's budget, the `water-rings` mode of benchmarks/canvas.mjs (task `canvas-water-rings`): what 64 live rings add
// to a pond that fills half a 1080p frame. A release deep-gpu draws a 12 m × 8 m pond of 128 × 128 cells, seen straight
// down from 16 m, whose water's `rings` read a logic item's occurrence list (64 touches in one step, every 122 steps, so
// 64 rings are alive at the default span and never more), against the same pond and logic item with `water: {}`, 300
// frames a side at 30 fps; a run's reading is the difference of the sides' median `gpu_ms`. One warm-up run and five,
// each a fresh process. The stage is tests/acceptance/2760/budgets.test.ts's. The program is WebAssembly text,
// assembled by #544's assembler.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIZE = [1920, 1080];
const POND = [12, 8];
const HEIGHT = Math.sqrt((2 * POND[0] * POND[1] * SIZE[0]) / SIZE[1]) / 2 / Math.tan(Math.PI / 6);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// One kind, `touch {point: vec3, n: i32}`, 64 rows a step: the count at 8192, then rows of a, b, the point and n (36
// bytes), on an 8 × 8 grid 1.5 m by 1 m apart.
const SHOWER = `(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global (export "emits_at") i32 (i32.const 8192))
  (func (export "init") (param i64))
  (func (export "step") (param $k i64) (local $i i32) (local $row i32)
    (i32.store (i32.const 8192) (i32.const 0))
    (if (i64.eqz (i64.rem_u (local.get $k) (i64.const 122))) (then
      (loop $each
        (local.set $row (i32.add (i32.const 8196) (i32.mul (local.get $i) (i32.const 36))))
        (i32.store (local.get $row) (i32.add (local.get $i) (i32.const 1)))
        (i32.store offset=4 (local.get $row) (i32.const 0))
        (f64.store offset=8 (local.get $row) (f64.add (f64.const -5.25) (f64.mul (f64.const 1.5) (f64.convert_i32_u (i32.and (local.get $i) (i32.const 7))))))
        (f64.store offset=16 (local.get $row) (f64.const 0))
        (f64.store offset=24 (local.get $row) (f64.add (f64.const -3.5) (f64.convert_i32_u (i32.shr_u (local.get $i) (i32.const 3)))))
        (i32.store offset=32 (local.get $row) (i32.add (local.get $i) (i32.const 1)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $each (i32.lt_u (local.get $i) (i32.const 64))))
      (i32.store (i32.const 8192) (i32.const 64))))))`;

/** The shower's program, assembled into `dir` and named by its SHA-256, as `view3d`'s `assets` reads it. */
function assemble(root, dir) {
  const wat = join(root, 'tests', 'acceptance', '544', 'wat');
  const target = join(root, 'target', 'bench-2760-wat');
  const built = spawnSync('cargo', ['build', '--locked', '--release', '--manifest-path', join(wat, 'Cargo.toml')], { cwd: wat, env: { ...process.env, CARGO_TARGET_DIR: target }, stdio: ['ignore', 'ignore', 'inherit'] });
  if (built.status !== 0) throw Error(`#544's assembler didn't build (exit ${built.status})`);
  writeFileSync(join(dir, 'shower.wat'), SHOWER);
  const run = spawnSync(join(target, 'release', 'acceptance-544-wat'), [dir, join(dir, 'shower.wat')], { encoding: 'utf8' });
  if (run.status !== 0) throw Error(`the assembler refused the program: ${run.stderr}`);
  const bytes = readFileSync(join(dir, 'shower.wasm'));
  const sha = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(dir, sha), bytes);
  return sha;
}

function pond(program, rings) {
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, HEIGHT, 0], target: [0, 0, 0], fov: 60, near: 0.1, far: 1000 } },
    sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-30, 30, 0] } },
    'pond-water': { kind: 'material@1', params: { roughness: 0.05, water: rings ? { rings: { on: { list: 'shower.occurrences', kinds: ['touch'] } } } : {} } },
    pond: { kind: 'plate@1', params: { grid: [128, 128], size: POND }, at: { pos: [0, 0, 0] }, material: 'pond-water' },
    shower: { kind: 'logic@1', params: { program, step_rate: 60, reads: [], emits: { touch: { fields: { point: 'vec3', n: 'i32' }, max_per_step: 64 } } } },
  };
  let order = 0;
  for (const [id, item] of Object.entries(items)) Object.assign(item, { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main' });
  return { format: 1, id: `pond-${rings ? 'rings' : 'bare'}`, profile: 'scene', title: 'Rings', size: SIZE, camera: 'cam', seed: 2760,
    transport: { span: '12s', frame_rate: [60, 1] }, requires: { modules: { scene3d: '^1', logic: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: 'agent:bench', title: 'main', order: 'a0' } }, items };
}

export function waterRings({ root, release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look2d = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'filmic-2760', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const program = assemble(root, dir);
    const side = (name, rings) => {
      const doc = join(dir, `${name}.json`);
      writeFileSync(doc, JSON.stringify(pond(program, rings)));
      return { call: 'view3d', doc, look, size: SIZE, frames: 300, fps: 30, timings: true, assets: { [program]: join(dir, program) } };
    };
    const calls = [side('rings', true), side('bare', false)];
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [ringed, bare] = answer.replies.map((r) => median(r.frames.map((f) => f.gpu_ms)));
      return { rings_pond_gpu_ms: Math.max(0, ringed - bare), bare_gpu_ms: bare };
    });
    console.log(JSON.stringify({ task: 'canvas-water-rings', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
