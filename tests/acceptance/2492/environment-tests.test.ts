// #2492: extension-host's environment-runtime and environment-timeout tests pass, and each fails on a host that skips
// the cleanup it covers. Each test here runs those files, unchanged, through the repo's own vitest (the root config,
// which the unit lane uses) and judges every test in them from vitest's JSON report: none failed, skipped or left todo.
// On a host that skips a cleanup, the file covering it fails, so the expect below fails here, in this file.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const RUNTIME = 'packages/extension-host/test/environment-runtime.test.ts';
const TIMEOUT = 'packages/extension-host/test/environment-timeout.test.ts';

interface Assertion { fullName: string; status: string; failureMessages?: string[] }
interface FileResult { name: string; status: string; message?: string; assertionResults: Assertion[] }

/** Every test vitest ran in `files`, by file, from one run of the repo's vitest; BLOCKED when it wrote no report. */
function run(files: string[]): Map<string, Assertion[]> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-2492-'));
  try {
    const out = join(dir, 'report.json');
    // The child is a vitest run of its own, not a worker of this one.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
    const result = spawnSync(process.execPath, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=json', `--outputFile.json=${out}`, ...files],
      { cwd: REPO, env, encoding: 'utf8', timeout: 900_000, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
    if (!existsSync(out)) throw new Error(`BLOCKED: vitest wrote no report for ${files.join(', ')} (status ${result.status}, signal ${result.signal}): ${(result.stderr ?? '').slice(-2000)}`);
    const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: FileResult[] };
    const byFile = new Map<string, Assertion[]>(files.map((file) => [file, []]));
    for (const file of report.testResults) {
      const path = files.find((f) => file.name.endsWith(f));
      if (!path) continue;
      // A file that failed outside its tests (its imports, a hook) counts as a failed test of its own.
      byFile.get(path)!.push(...file.assertionResults, ...(file.status === 'failed' && !file.assertionResults.some((a) => a.status === 'failed') ? [{ fullName: '(the file, outside its tests)', status: 'failed', failureMessages: [file.message ?? ''] }] : []));
    }
    return byFile;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const notPassed = (tests: Assertion[]): string[] => tests.filter((t) => t.status !== 'passed')
  .map((t) => `${t.status}: ${t.fullName}${t.failureMessages?.[0] ? `\n${t.failureMessages[0].slice(0, 1500)}` : ''}`);

it('#2492.406745f0 environment-runtime.test.ts and environment-timeout.test.ts both pass, every test in them, in one run of the repo\'s vitest', () => {
  const tests = run([RUNTIME, TIMEOUT]);
  for (const file of [RUNTIME, TIMEOUT]) {
    expect(tests.get(file)!.length, `${file} ran a test`).toBeGreaterThan(0);
    expect(notPassed(tests.get(file)!), `${file}'s tests that didn't pass`).toEqual([]);
  }
}, 1_000_000);

it('#2492.eac47520 environment-timeout.test.ts, which covers the late handle\'s down, passes, every test in it', () => {
  const tests = run([TIMEOUT]).get(TIMEOUT)!;
  expect(tests.length, `${TIMEOUT} ran a test`).toBeGreaterThan(0);
  expect(notPassed(tests), `${TIMEOUT}'s tests that didn't pass`).toEqual([]);
}, 1_000_000);

it('#2492.eac47520 environment-runtime.test.ts, which covers the active handle\'s stop on disable, passes, every test in it', () => {
  const tests = run([RUNTIME]).get(RUNTIME)!;
  expect(tests.length, `${RUNTIME} ran a test`).toBeGreaterThan(0);
  expect(notPassed(tests), `${RUNTIME}'s tests that didn't pass`).toEqual([]);
}, 1_000_000);
