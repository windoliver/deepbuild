// #140's validation lane, which the release preflight runs (scripts/lanes.mjs, releaseLanes): the shipped GPU
// fixtures once through `deep-gpu run --validation`, with Metal's API and shader validation on and the shader
// translator's bounds checks off. It passes only when every fixture passes; a fixture that fails names its findings,
// and one the lane can't check is BLOCKED with its reason, never clean.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-gpu'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(1);
const out = mkdtempSync(join(tmpdir(), 'deep-gpu-validation-'));
try {
  const run = spawnSync(join(root, 'target', 'debug', 'deep-gpu'), ['run', '--validation'], {
    cwd: root, input: `${JSON.stringify({ out, calls: [{ call: 'validate' }] })}\n`, encoding: 'utf8', maxBuffer: 2 ** 28,
  });
  let reply;
  try { reply = JSON.parse(run.stdout.trim().split('\n').at(-1)).replies[0]; } catch { reply = undefined; }
  if (!reply?.fixtures) {
    console.log(`BLOCKED gpu validation: deep-gpu answered ${run.stdout.slice(0, 500) || `nothing (status ${run.status})`}`);
    process.exit(1);
  }
  const bad = reply.fixtures.filter((f) => f.result !== 'PASS');
  for (const f of bad) console.log(`${f.result} gpu validation: ${f.fixture} (${f.kind}): ${f.reason ?? JSON.stringify(f.findings)}`);
  if (reply.lane.bounds_checks || !reply.lane.api_validation || !reply.lane.shader_validation) {
    console.log(`BLOCKED gpu validation: the lane ran with ${JSON.stringify(reply.lane)}`);
    process.exit(1);
  }
  console.log(`gpu validation: ${reply.fixtures.length - bad.length} of ${reply.fixtures.length} fixtures clean`);
  process.exit(bad.length ? 1 : 0);
} finally {
  rmSync(out, { recursive: true, force: true });
}
