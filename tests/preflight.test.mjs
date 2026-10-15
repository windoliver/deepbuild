import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const runner = new URL('../scripts/preflight.mjs', import.meta.url).href;

function fixture(t, steps) {
  const cwd = mkdtempSync(join(tmpdir(), 'deep-preflight-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const lanes = steps.map(({ name, error, missing, prelude = 'check started', laterOutput }) => ({
    name,
    fix: `Repair ${name}.`,
    commands: [missing ? [join(cwd, 'missing-executable')] : [process.execPath, '-e', `
      require('node:fs').appendFileSync('ran', ${JSON.stringify(`${name}\n`)});
      console.log(${JSON.stringify(prelude)});
      ${error ? `console.error(${JSON.stringify(error)}); process.exitCode = 1;` : ''}
      ${laterOutput ? `console.log(${JSON.stringify(laterOutput)});` : ''}
    `]],
  }));
  writeFileSync(join(cwd, 'run.mjs'), `
    import { runLanes } from ${JSON.stringify(runner)};
    process.exitCode = await runLanes(${JSON.stringify(lanes)}, { cwd: process.cwd() });
  `);
  const result = spawnSync(process.execPath, ['run.mjs'], { cwd, encoding: 'utf8' });
  return { ...result, ran: () => readFileSync(join(cwd, 'ran'), 'utf8') };
}

test('every lane runs after failures, with each first error and named fix', (t) => {
  const result = fixture(t, [
    { name: 'typecheck', error: 'Error: missing type\nError: later detail' },
    { name: 'lint' },
    { name: 'unit', error: 'AssertionError: expected true, got false' },
    { name: 'parity quick' },
    { name: 'perf' },
  ]);
  assert.notEqual(result.status, 0, result.stderr);
  assert.equal(result.ran(), 'typecheck\nlint\nunit\nparity quick\nperf\n');
  assert.match(result.stdout, /FAIL typecheck: Error: missing type\n\s+Fix: Repair typecheck\./);
  assert.match(result.stdout, /FAIL unit: AssertionError: expected true, got false\n\s+Fix: Repair unit\./);
  assert.match(result.stdout, /PASS perf/);
});

test('successful checks produce evidence and a zero exit', (t) => {
  const result = fixture(t, [{ name: 'unit' }]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.ran(), 'unit\n');
  assert.match(result.stdout, /PASS unit/);
  assert.doesNotMatch(result.stdout, /FAIL|BLOCKED/);
});

test('an unavailable check is blocked and does not suppress the later lane', (t) => {
  const result = fixture(t, [{ name: 'typecheck', missing: true }, { name: 'perf' }]);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /BLOCKED typecheck: .*ENOENT\n\s+Fix: Repair typecheck\./);
  assert.equal(result.ran(), 'perf\n');
  assert.match(result.stdout, /PASS perf/);
});

test('failure summary names a diagnostic instead of an error-related test title', (t) => {
  const result = fixture(t, [{ name: 'unit', prelude: 'testing error handling', error: 'Error: actual failure' }]);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /FAIL unit: Error: actual failure\n\s+Fix: Repair unit\./);
});

test('first failure preserves ordering across stderr and stdout', (t) => {
  const result = fixture(t, [{ name: 'unit', error: 'Error: original failure', laterOutput: 'Error: later cleanup failure' }]);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /FAIL unit: Error: original failure\n\s+Fix: Repair unit\./);
});
