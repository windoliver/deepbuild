// The physics module's budgets (issue #524; tests/acceptance/524/README.md: The budgets): node benchmarks/physics.mjs
// <module | soft-labs | judge>. Each mode builds release `deep-physics` (and for `module` release `deep-show`), takes one
// untimed warm-up run and five timed runs, each a fresh process, and prints its report as its last stdout line with this
// machine's fingerprint; `judge` reads {current, base} on stdin and holds each target to its limit by the reference-Mac
// rule (scripts/benchmark.mjs judgeLimit), so the budget window's judgeTargets runs it.
//   module:    bridge_step_ms, the 95th percentile of the rope bridge lab's 120 Hz steps (600 of them, its golden's);
//              stress_step_ms, the same of a 200-body stress world (200 dynamic 0.5 m boxes in a 5 × 8 × 5 stack on a
//              static floor); bake_10s_ms, a 1,200-step bake of the bridge lab, the process's wall time; world_mb, that
//              process's peak resident memory; startup_ms, the time deep-show's seal spends on its interface checks, in
//              whose pass the runtime digest is hashed (registry.seal.interfaces.ms).
//   soft-labs: bridge_step_ms and banner_step_ms, each lab's 600 steps as `module` times the bridge.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, judgeLimit } from '../scripts/benchmark.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const RUNS = 5;
const STEPS = 600;
const LIMITS = {
  module: { bridge_step_ms: 2, stress_step_ms: 2, bake_10s_ms: 1000, world_mb: 50, startup_ms: 5 },
  'soft-labs': { bridge_step_ms: 2, banner_step_ms: 2 },
};

function release(pkg, bin) {
  const built = spawnSync('cargo', ['build', '--locked', '--release', '-p', pkg, '--bin', bin], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (built.status !== 0) throw Error(`cargo build --release -p ${pkg} --bin ${bin} exited ${built.status}`);
  return join(process.env.CARGO_TARGET_DIR ?? join(root, 'target'), 'release', bin);
}

/** One deep-physics process answering `calls`; with `rss`, its peak resident memory in bytes as /usr/bin/time reads it. */
function physics(bin, calls, rss = false) {
  const input = `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`;
  const start = performance.now();
  const r = rss ? spawnSync('/usr/bin/time', ['-l', bin], { input, encoding: 'utf8', maxBuffer: 1 << 30 }) : spawnSync(bin, [], { input, encoding: 'utf8', maxBuffer: 1 << 30 });
  const ms = performance.now() - start;
  if (r.status !== 0) throw Error(`deep-physics exited ${r.status}: ${r.stderr.slice(-2000)}`);
  const replies = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  const peak = rss ? Number(/(\d+)\s+maximum resident set size/.exec(r.stderr)?.[1]) : null;
  return { replies, ms, peak };
}

const lab = (name) => ({ scene: JSON.parse(readFileSync(join(root, 'packs', 'examples', 'labs', `${name}.json`), 'utf8')), world: 'lab' });

/** 200 dynamic 0.5 m boxes in a 5 × 8 × 5 stack on a static floor. */
function stress() {
  const bodies = { floor: { kind: 'static', shapes: [{ shape: 'floor' }], pose: { pos: [0, -0.5, 0] } } };
  for (let x = 0; x < 5; x++) for (let y = 0; y < 8; y++) for (let z = 0; z < 5; z++) {
    bodies[`box_${x}_${y}_${z}`] = { kind: 'dynamic', mass: 1, shapes: [{ shape: 'box' }], pose: { pos: [(x - 2) * 0.5, 0.25 + y * 0.5, (z - 2) * 0.5] } };
  }
  return { world: { kind: 'physics.world@1', step_rate: 120, substeps: 4, seed: 524, capacity: { bodies: 201, shapes: 201, joints: 0, contacts: 4096, particles: 0 },
    backend: { name: 'rapier3d', version: '=0.36.1' }, shapes: { floor: { kind: 'box', half: [10, 0.5, 10] }, box: { kind: 'box', half: [0.25, 0.25, 0.25] } }, bodies } };
}

const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.ceil(0.95 * ms.length) - 1];
/** A world's steps timed in one fresh process, the 95th percentile of its STEPS steps. */
const stepP95 = (bin, subject) => p95(physics(bin, [{ call: 'time', ...subject, steps: STEPS }]).replies[0].ms);
/** One warm-up run, then RUNS runs, each with the load at its start and end. */
function timed(once) {
  once();
  const loads = [];
  const runs = Array.from({ length: RUNS }, () => {
    const start = loadavg()[0];
    const v = once();
    loads.push({ start, end: loadavg()[0] });
    return v;
  });
  return { runs, loads };
}

const modes = {
  module() {
    const bin = release('deep-physics-rapier', 'deep-physics');
    const show = release('deep-show', 'deep-show');
    const bridge = lab('rope-bridge');
    const bake = (rss) => physics(bin, [{ call: 'bake', ...bridge, steps: 1200, every: 1200 }], rss);
    const evidence = mkdtempSync(join(tmpdir(), 'deep-physics-bench-'));
    const seal = () => {
      const r = spawnSync(show, ['run'], { input: `${JSON.stringify({ evidence, calls: [{ call: 'registry' }] })}\n`, encoding: 'utf8', maxBuffer: 1 << 28 });
      if (r.status !== 0) throw Error(`deep-show run exited ${r.status}: ${r.stderr.slice(-2000)}`);
      const ms = JSON.parse(r.stdout.trim().split('\n').at(-1)).replies?.[0]?.seal?.interfaces?.ms;
      if (!Number.isFinite(ms)) throw Error(`deep-show's registry names no seal.interfaces.ms: ${r.stdout.slice(0, 1500)}`);
      return ms;
    };
    try {
      return {
        bridge_step_ms: timed(() => stepP95(bin, bridge)),
        stress_step_ms: timed(() => stepP95(bin, stress())),
        bake_10s_ms: timed(() => bake(false).ms),
        world_mb: timed(() => bake(true).peak / (1024 * 1024)),
        startup_ms: timed(seal),
      };
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
  },
  'soft-labs'() {
    const bin = release('deep-physics-rapier', 'deep-physics');
    return {
      bridge_step_ms: timed(() => stepP95(bin, lab('rope-bridge'))),
      banner_step_ms: timed(() => stepP95(bin, lab('banner'))),
    };
  },
};

const mode = process.argv[2];
if (mode === 'judge') {
  const { current } = JSON.parse(readFileSync(0, 'utf8'));
  const limits = LIMITS[current?.task];
  if (!limits) throw Error(`Unknown task ${current?.task}`);
  const targets = Object.fromEntries(Object.entries(limits).map(([key, limit]) => [key,
    judgeLimit({ limit, runs: current.targets?.[key]?.runs, loads: current.targets?.[key]?.loads, fingerprint: current.fingerprint })]));
  const statuses = Object.values(targets).map((t) => t.status);
  const status = statuses.includes('FAIL') ? 'FAIL' : statuses.includes('BLOCKED') ? 'BLOCKED' : statuses.every((s) => s === 'PASS') ? 'PASS' : 'INCONCLUSIVE';
  console.log(JSON.stringify({ task: current.task, status, targets }));
} else if (modes[mode]) {
  const task = mode === 'module' ? 'physics-module' : 'physics-soft-labs';
  console.log(JSON.stringify({ task, fingerprint: fingerprint(), targets: modes[mode]() }));
} else {
  throw Error(`Unknown mode ${mode}; one of: module, soft-labs, judge`);
}
