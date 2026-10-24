// The canvas conformance kit in the local preflight's quick lane (issue #138): the default `kit` call
// (every part, Vello CPU and wgpu's noop backend, no GPU) over the shipped build's canvas modules,
// through `deep-show run`. It writes the kit's ledger, which a release build embeds and seals by
// (crates/deep-show/build.rs), prints one line per module that isn't PASS, and exits 0 only on PASS.
// Never on push or pull request.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: root, encoding: 'utf8' });
if (build.status !== 0) {
  console.error(`cargo build --bin deep-show failed:\n${build.stderr}`);
  process.exit(1);
}
const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-kit-'));
let answer;
try {
  const ledger = join(root, 'crates', 'deep-show', 'kit-ledger.json');
  const scenario = { evidence, calls: [{ call: 'kit', ledger }] };
  const run = spawnSync(join(root, 'target', 'debug', 'deep-show'), ['run'], { cwd: root, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (run.status !== 0) {
    console.error(`deep-show run exited ${run.status}: ${run.stdout.slice(0, 2000)} ${run.stderr.slice(-2000)}`);
    process.exit(1);
  }
  answer = JSON.parse(run.stdout.trim().split('\n')[0]);
} finally {
  rmSync(evidence, { recursive: true, force: true });
}
if (answer.ok !== true) {
  console.error(`deep-show refused the kit: ${JSON.stringify(answer)}`);
  process.exit(1);
}
const [kit] = answer.replies;
for (const m of kit.modules.filter((x) => x.verdict !== 'PASS')) {
  const failures = [...m.failures, ...m.parts.flatMap((p) => p.failures)].slice(0, 3);
  console.log(`${m.module}: ${m.verdict} ${failures.map((f) => JSON.stringify(f)).join(' ')}`);
}
console.log(`canvas kit: ${kit.verdict} over ${kit.modules.map((m) => m.module).join(', ')} (seed ${kit.seed})`);
process.exit(kit.verdict === 'PASS' ? 0 : 1);
