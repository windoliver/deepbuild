// #2495: failure to store evidence is BLOCKED, not a successful eval, and never loses the preflight file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/config-eval.mjs', import.meta.url));
test('an unreachable hub blocks evidence storage, leaves the report and prints no evidence handle', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'eval-storage-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const input = join(home, 'input.json');
  // A refused plan runs no agent: only completion/storage behavior is under test here.
  writeFileSync(input, JSON.stringify({ plan: {
    id: 'storage', cutoff: 1000, tasks: [], fitted: [], repeats: 1, rule: 'paired-mean-one-sided-95',
    variants: { base: { name: 'base', files: {} }, change: { name: 'change', files: {} } },
    models: { agent: 'claude-haiku-5-5', judge: 'gpt-reserve' }, measures: [{ name: 'tokens', better: 'lower' }],
    budget: { ms: 1000, plan_share: 1 },
  }, tasks: [] }));
  const run = spawnSync(process.execPath, [script, 'run', input], { env: { PATH: '/usr/bin:/bin', HOME: home }, encoding: 'utf8', timeout: 10_000 });
  const output = `${run.stdout}${run.stderr}`;
  assert.equal(run.status, 1, output);
  assert.match(output, /BLOCKED config eval:.*evidence/);
  assert.doesNotMatch(output, /ev:[0-9a-f]{64}/);
  const evals = join(home, '.deepbuild', 'evals');
  const files = readdirSync(evals);
  assert.equal(files.length, 1);
  assert.equal(JSON.parse(readFileSync(join(evals, files[0]), 'utf8')).plan.id, 'storage');
});
