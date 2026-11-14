// #548's budgets, the `logic-budgets` mode of benchmarks/canvas.mjs (task `canvas-logic-budgets`): the logic module's
// costs for games on a release deep-logic, read from its own calls in one long-lived process. 64 occurrence rows a
// step: 600 steps of an item emitting 64 rows a step in an `open` session, less 600 of its twin with the same stores
// and none emitted, ÷ 600; 1,000 vec3 elements of a linear write: the median frame of a 10 Hz swarm's live view, less
// the same swarm held; a preview of a 4 MiB state: the median frame of a hover change, less a still frame's, no step
// in either; a checkpoint of 3 written pages of a 32 MiB memory: the median store time the ring reports (`ns`) of a
// 480-step bake's checkpoints of pages. Programs are WebAssembly text, assembled by #544's assembler.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const PAGE = 65_536;
const PREVIEW_AT = 8192;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
const head = (pages, more = '') => `(memory (export "memory") ${pages} ${pages}) (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024)) ${more}`;
const loop = (n, body) => `(block $done (loop $each (br_if $done (i32.eq (local.get $i) (i32.const ${n}))) ${body} (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $each)))`;
const PROGRAMS = {
  // 64 rows {a: i, b: k, x: i} of `hit {x: f64}` a step, the count 64, or 0 for the twin.
  ...Object.fromEntries([64, 0].map((rows) => [`emitter${rows}`, `(module ${head(1, '(global (export "emits_at") i32 (i32.const 4096))')} (func (export "init") (param i64))
    (func (export "step") (param $k i64) (local $i i32) (local $row i32) ${loop(64, `(local.set $row (i32.add (i32.const 4100) (i32.shl (local.get $i) (i32.const 4))))
      (i32.store (local.get $row) (local.get $i)) (i32.store offset=4 (local.get $row) (i32.wrap_i64 (local.get $k))) (f64.store offset=8 (local.get $row) (f64.convert_i32_u (local.get $i)))`)}
      (i32.store (i32.const 4096) (i32.const ${rows})) (i32.store (i32.const 1024) (i32.wrap_i64 (local.get $k)))))`])),
  // pos[i] = [k + i, i, 0] for 1,000 boids.
  swarm: `(module ${head(1)} (func (export "init") (param i64)) (func (export "step") (param $k i64) (local $i i32) (local $row i32)
    ${loop(1000, `(local.set $row (i32.add (i32.const 1024) (i32.mul (local.get $i) (i32.const 24))))
      (f64.store (local.get $row) (f64.add (f64.convert_i64_s (local.get $k)) (f64.convert_i32_u (local.get $i)))) (f64.store offset=8 (local.get $row) (f64.convert_i32_u (local.get $i))) (f64.store offset=16 (local.get $row) (f64.const 0))`)}))`,
  // A 4 MiB state, every page touched by init; its preview writes the hovered cell's cx.
  big: `(module ${head(64, `(global (export "preview_at") i32 (i32.const ${PREVIEW_AT}))`)} (func (export "init") (param i64) (local $i i32)
    ${loop(64, `(i32.store (i32.add (i32.mul (local.get $i) (i32.const ${PAGE})) (i32.const 32768)) (i32.add (local.get $i) (i32.const 1)))`)})
    (func (export "step") (param $k i64) (i32.store (i32.const 1024) (i32.wrap_i64 (local.get $k))))
    (func (export "preview") (param i64) (i32.store (i32.const ${PREVIEW_AT + 248}) (i32.trunc_f64_s (f64.load (i32.const ${PREVIEW_AT + 8}))))))`,
  // 32 MiB, every step writing pages 0, 200 and 400.
  pages3: `(module (memory (export "memory") 512 512) (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 4096))
    (global $acc (mut i64) (i64.const 1)) (func (export "init") (param $s i64) (global.set $acc (i64.or (local.get $s) (i64.const 1))))
    (func (export "step") (param $k i64) (local $k32 i32) (local.set $k32 (i32.wrap_i64 (local.get $k)))
      (global.set $acc (i64.add (i64.mul (global.get $acc) (i64.const 6364136223846793005)) (local.get $k)))
      (i64.store (i32.add (i32.const ${200 * PAGE}) (i32.shl (i32.and (local.get $k32) (i32.const 8191)) (i32.const 3))) (global.get $acc))
      (i64.store (i32.add (i32.const ${400 * PAGE}) (i32.shl (i32.and (local.get $k32) (i32.const 63)) (i32.const 3))) (global.get $acc))
      (i32.store (i32.const 4096) (i32.wrap_i64 (i64.shr_u (global.get $acc) (i64.const 32))))))`,
};

function assemble(root, dir) {
  const wat = join(root, 'tests', 'acceptance', '544', 'wat');
  const target = join(root, 'target', 'bench-548-wat');
  const built = spawnSync('cargo', ['build', '--locked', '--release', '--manifest-path', join(wat, 'Cargo.toml')], { cwd: wat, env: { ...process.env, CARGO_TARGET_DIR: target }, stdio: ['ignore', 'ignore', 'inherit'] });
  if (built.status !== 0) throw Error(`#544's assembler didn't build (exit ${built.status})`);
  const files = Object.entries(PROGRAMS).map(([name, text]) => { const f = join(dir, `${name}.wat`); writeFileSync(f, text); return f; });
  const run = spawnSync(join(target, 'release', 'acceptance-544-wat'), [dir, ...files], { encoding: 'utf8' });
  if (run.status !== 0) throw Error(`the assembler refused a program: ${run.stderr}`);
  return Object.fromEntries(Object.keys(PROGRAMS).map((name) => {
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    return [name, { sha: createHash('sha256').update(bytes).digest('hex'), b64: bytes.toString('base64') }];
  }));
}

/** One item's piece: its program carried as an asset. */
const piece = (p, id, params, controls) => ({ seed: 548, ...(controls ? { controls } : {}), items: { [id]: { kind: 'logic@1', params: { program: p.sha, ...params } } }, assets: { [p.sha]: p.b64 } });

/** A deep-logic process taking one JSON line at a time: each call's reply and its wall time in ms. */
function driver(bin) {
  const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout });
  const waiting = [];
  lines.on('line', (l) => waiting.shift()?.(JSON.parse(l)));
  const call = (line) => new Promise((resolve) => {
    const t0 = performance.now();
    waiting.push((reply) => resolve({ reply, ms: performance.now() - t0 }));
    child.stdin.write(`${JSON.stringify(line)}\n`);
  });
  return { call, stop: () => child.kill() };
}

/** One run's four readings, in a fresh process. */
async function measure(bin, p) {
  const d = driver(bin);
  try {
    const ok = (r, what) => { if (r.ok !== true) throw Error(`${what}: ${JSON.stringify(r).slice(0, 1500)}`); return r; };
    const perStep = async (prog) => {
      const o = ok((await d.call({ call: 'open', piece: piece(prog, 'shots', { writes: { k: { type: 'i32' } }, emits: { hit: { fields: { x: 'f64' }, max_per_step: 64 } } }), track: [] })).reply, 'open');
      ok((await d.call({ call: 'step', session: o.session, to: 59 })).reply, 'step');
      return (await d.call({ call: 'step', session: o.session, to: 659 })).ms / 600;
    };
    const occ = [];
    for (let n = 0; n < 3; n++) occ.push(await perStep(p.emitter64) - await perStep(p.emitter0));
    const view = async (pc) => String(ok((await d.call({ call: 'view', piece: pc, track: [], span: 5 })).reply, 'view').session);
    const swarm = (interpolate) => piece(p.swarm, 'swarm', { step_rate: 10, writes: { pos: { type: 'vec3', count: 1000, interpolate } } });
    const frames = async (pc) => {
      const s = await view(pc);
      const ms = [];
      for (let n = 0; n < 60; n++) ms.push((await d.call({ call: 'frame', session: s, play: true })).ms);
      return median(ms);
    };
    const linear = await frames(swarm('linear')) - await frames(swarm('hold'));
    const big = piece(p.big, 'big', { writes: { k: { type: 'i32' } }, preview: { reads: ['place.hover'], writes: { seen: { type: 'i32' } } } }, { place: { kind: 'point' } });
    const s = await view(big);
    ok((await d.call({ call: 'frame', session: s, play: true })).reply, 'frame');
    const change = [];
    const still = [];
    for (let n = 0; n < 40; n++) {
      change.push((await d.call({ call: 'frame', session: s, hover: { place: n % 2 ? [3, 4] : [5, 6] } })).ms);
      still.push((await d.call({ call: 'frame', session: s })).ms);
    }
    const pages = piece(p.pages3, 'pages3', { writes: { sum: { type: 'i32' } }, budget: { memory: 32 }, checkpoint: { every: 60, budget: 256 * 1024 * 1024 } });
    const bake = ok((await d.call({ call: 'bake', piece: pages, steps: 480, track: [] })).reply, 'bake');
    const kept = bake.ring.pages3.checkpoints.filter((c) => !c.whole);
    return { occurrences_64_ms: Math.max(0, median(occ)), linear_1000_vec3_ms: Math.max(0, linear), preview_4mib_ms: Math.max(0, median(change) - median(still)),
      checkpoint_3_pages_ms: median(kept.map((c) => c.ns / 1e6)) };
  } finally {
    d.stop();
  }
}

/** The `logic-budgets` workload: release deep-logic, a warm-up run and five, printed as the task's reading. */
export async function logicBudgets({ root, release }) {
  const fingerprint = release('deep-logic', 'deep-logic');
  const dir = mkdtempSync(join(tmpdir(), 'deep-logic-budgets-bench-'));
  try {
    const programs = assemble(root, dir);
    const bin = join(root, 'target', 'release', 'deep-logic');
    await measure(bin, programs);
    const runs = [];
    for (let n = 0; n < 5; n++) runs.push(await measure(bin, programs));
    console.log(JSON.stringify({ task: 'canvas-logic-budgets', fingerprint, runs }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
