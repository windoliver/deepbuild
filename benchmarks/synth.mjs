// 32 voices of an 8-node synth preset played for 10 s of a media document, for the perf lane's budgets (issue #204):
// node benchmarks/synth.mjs. It builds deep-show in release, writes a pack whose one preset is a detuned saw pair
// through a filter, an envelope and an echo, installs it, and renders one strip of it with 32 voices for the
// document's 10 s with `deep-show run`'s media_mix in one segment; it prints the wall time of that run as one JSON
// line. The issue's limits (under 10% of one core, a restore under 50 ms) stay in tests/acceptance/204/budgets.test.ts.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const SEC = 705_600_000;
const built = spawnSync('cargo', ['build', '--locked', '--release', '-p', 'deep-show', '--bin', 'deep-show'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
if (built.status !== 0) throw Error(`cargo build --release -p deep-show exited ${built.status}`);
const target = process.env.CARGO_TARGET_DIR ?? join(root, 'target');

const preset = {
  nodes: {
    a: { kind: 'osc', wave: 'saw', hz: 'hz' },
    b: { kind: 'osc', wave: 'saw', hz: 'hz2' },
    n: { kind: 'noise', color: 'pink' },
    sum: { kind: 'mix' },
    lp: { kind: 'biquad', type: 'lowpass', freq: 1200, q: 0.9 },
    env: { kind: 'env', attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 },
    amp: { kind: 'gain', gain: 0 },
    echo: { kind: 'delay', time: 0.12, feedback: 0.3, mix: 0.3 },
  },
  edges: [['a', 'sum', 'a'], ['b', 'sum', 'b'], ['n', 'sum', 'n'], ['sum', 'lp', 'in'], ['lp', 'amp', 'in'], ['env', 'amp', 'gain'], ['amp', 'echo', 'in']],
  out: 'echo',
  params: { hz: { unit: 'Hz', range: [20, 2000], default: 110 }, hz2: { unit: 'Hz', range: [20, 2000], default: 110.5 } },
  cost: 40,
};
const dir = mkdtempSync(join(tmpdir(), 'deep-synth-bench-'));
try {
  const pack = join(dir, 'pack');
  mkdirSync(pack);
  writeFileSync(join(pack, 'pack.json'), JSON.stringify({ name: 'bench', version: '1.0.0', license: 'MIT', description: 'One synth preset for the synth budget.', requires: { core: '>=0.0.0', modules: { media: '>=0.0.0' } }, presets: { 'pad@1': preset } }));
  const strips = { pad: { src: { synth: { preset: 'bench.pad@1', params: { hz: '80 + 20 * t', hz2: '80.5 + 20 * t' }, voices: 32, seed: 7 } }, start: 0, span: 10 * SEC } };
  const doc = { transport: { sample_rate: 48_000, span: 10 * SEC }, packs: ['bench/bench@1.0.0'], strips, buses: { master: { gain: -30 } } };
  const scenario = { evidence: join(dir, 'evidence'), calls: [{ call: 'install_pack', id: 'bench/bench', dir: pack }, { call: 'media_mix', doc, segments: [{ from: 0, to: 10 * SEC }] }] };
  const t0 = performance.now();
  const run = spawnSync(join(target, 'release', 'deep-show'), ['run'], { input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ms = Math.round(performance.now() - t0);
  const answer = JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}');
  const mixed = answer.replies?.[1]?.mix;
  if (answer.ok !== true || answer.replies?.[0]?.outcome !== 'installed' || !mixed?.segments?.[0]?.sha256) throw Error(`the mix didn't play: ${run.stdout.slice(0, 2000)}${run.stderr.slice(0, 2000)}`);
  console.log(JSON.stringify({ ms }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
