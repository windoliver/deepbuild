// #211's budgets, the `world-pages` mode of benchmarks/canvas.mjs (task `logic-world-pages`): world pages on a release
// deep-logic. A world of 2,048 pages, 64 slots, asks for 8 fresh pages a step into the slots they cycle through and writes
// 5 of every 8 as they land, so from step 11 each step's 8 moves write 5 pages back, and a checkpoint every 10 steps holds
// 50 changed page map entries. The bake gives each step's `pages_ns`, the CPU time the logic module took running the moves
// before it, and each checkpoint's `map_ns` and `map_bytes`, what its map changes took and add; an item without pages
// shows how many steps and checkpoints did such work at all. Programs are WebAssembly text, assembled by #544's assembler.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];

const STEPS = 200;
const PAGES_AT = 65_536;
const SLOTS = 64;
const MOVES = 8;
const head = (pages) => `(memory (export "memory") ${pages} ${pages}) (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 4096))`;
// flood asks for pages next … next + 7 after init and after each step, page p into slot p mod 64, until page 1,608; each
// step k ≥ 3 writes its page number into the first 5 of the 8 that landed then, pages 8(k − 3) to 8(k − 3) + 7.
// idle has no pages: it counts its steps.
const PROGRAMS = {
  flood: `(module ${head(2 + SLOTS)} (global (export "pages_at") i32 (i32.const ${PAGES_AT})) (global $next (mut i32) (i32.const 0))
    (func $ask (local $i i32) (local $p i32)
      (loop $each
        (local.set $p (i32.add (global.get $next) (local.get $i)))
        (if (i32.lt_u (global.get $next) (i32.const 1608))
          (then
            (i32.store (i32.add (i32.const ${PAGES_AT}) (i32.shl (local.get $i) (i32.const 3))) (local.get $p))
            (i32.store (i32.add (i32.const ${PAGES_AT + 4}) (i32.shl (local.get $i) (i32.const 3))) (i32.and (local.get $p) (i32.const ${SLOTS - 1}))))
          (else (i32.store (i32.add (i32.const ${PAGES_AT}) (i32.shl (local.get $i) (i32.const 3))) (i32.const -1))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $each (i32.lt_u (local.get $i) (i32.const ${MOVES}))))
      (global.set $next (i32.add (global.get $next) (i32.const ${MOVES}))))
    (func (export "init") (param i64) (call $ask))
    (func (export "step") (param $k i64) (local $i i32) (local $p i32)
      (if (i64.ge_s (local.get $k) (i64.const 3))
        (then (loop $each
          (local.set $p (i32.add (i32.shl (i32.wrap_i64 (i64.sub (local.get $k) (i64.const 3))) (i32.const 3)) (local.get $i)))
          (i32.store (i32.add (i32.const ${PAGES_AT * 2}) (i32.shl (i32.and (local.get $p) (i32.const ${SLOTS - 1})) (i32.const 16))) (i32.add (local.get $p) (i32.const 1)))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br_if $each (i32.lt_u (local.get $i) (i32.const 5))))))
      (i32.store (i32.const 4096) (i32.wrap_i64 (local.get $k)))
      (call $ask)))`,
  idle: `(module ${head(1)} (func (export "init") (param i64))
    (func (export "step") (param $k i64) (i32.store (i32.const 4096) (i32.wrap_i64 (local.get $k)))))`,
};

function assemble(root, dir) {
  const wat = join(root, 'tests', 'acceptance', '544', 'wat');
  const target = join(root, 'target', 'bench-211-wat');
  const built = spawnSync('cargo', ['build', '--locked', '--release', '--manifest-path', join(wat, 'Cargo.toml')], { cwd: wat, env: { ...process.env, CARGO_TARGET_DIR: target }, stdio: ['ignore', 'ignore', 'inherit'] });
  if (built.status !== 0) throw Error(`#544's assembler didn't build (exit ${built.status})`);
  const files = Object.entries(PROGRAMS).map(([name, text]) => { const f = join(dir, `${name}.wat`); writeFileSync(f, text); return f; });
  const run = spawnSync(join(target, 'release', 'acceptance-544-wat'), [dir, ...files], { encoding: 'utf8' });
  if (run.status !== 0) throw Error(`the assembler refused a program: ${run.stderr}`);
  return Object.fromEntries(Object.keys(PROGRAMS).map((name) => { const bytes = readFileSync(join(dir, `${name}.wasm`)); return [name, { bytes, sha: sha256(bytes) }]; }));
}

const piece = (id, program, params) => ({
  seed: 211, assets: { [program.sha]: program.bytes.toString('base64') },
  items: { [id]: { kind: 'logic@1', params: { program: program.sha, step_rate: 60, writes: { n: { type: 'i32' } }, checkpoint: { every: 10, budget: 1_073_741_824 }, ...params } } },
});

function measure(programs, once) {
  const pages = { max: 2048, slots: SLOTS, moves: MOVES, lead: 4, init: 'zero', written_max: 256, web_max: 256 };
  const baked = once('deep-logic', [], { call: 'bake', piece: piece('world', programs.flood, { pages, budget: { memory: 5 } }), steps: STEPS, track: [] });
  if (baked.ok !== true) throw Error(`the flood didn't bake: ${JSON.stringify(baked).slice(0, 2000)}`);
  const moves = baked.steps.slice(11).map((s) => s.items.world.pages_ns);
  if (moves.some((ns) => !(ns > 0))) throw Error(`a step of 8 moves read no time: ${JSON.stringify(moves)}`);
  const checkpoints = baked.checkpoints.world.filter((c) => c.step >= 30);
  if (checkpoints.some((c) => c.map_changed !== 50)) throw Error(`a checkpoint holds other than 50 changed map entries: ${JSON.stringify(checkpoints.map((c) => c.map_changed))}`);
  const idle = once('deep-logic', [], { call: 'bake', piece: piece('idle', programs.idle, {}), steps: 60, track: [] });
  if (idle.ok !== true) throw Error(`the item without pages didn't bake: ${JSON.stringify(idle).slice(0, 2000)}`);
  const busy = idle.steps.filter((s) => s.items.idle.pages_ns !== 0).length
    + idle.checkpoints.idle.filter((c) => ['map', 'map_changed', 'map_bytes', 'map_ns'].some((k) => k in c)).length;
  return {
    moves_8_ms: median(moves) / 1e6,
    checkpoint_50_ms: median(checkpoints.map((c) => c.map_ns)) / 1e6,
    checkpoint_50_bytes: Math.max(...checkpoints.map((c) => c.map_bytes)),
    idle_work: busy,
  };
}

/** The `world-pages` workload: a release deep-logic, a warm-up run and five, printed as the task's reading. */
export function worldPages({ root, release, once, runs }) {
  const fingerprint = release('deep-logic', 'deep-logic');
  const dir = mkdtempSync(join(tmpdir(), 'deep-world-pages-bench-'));
  try {
    const programs = assemble(root, dir);
    const measured = runs(() => measure(programs, once));
    console.log(JSON.stringify({ task: 'logic-world-pages', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
