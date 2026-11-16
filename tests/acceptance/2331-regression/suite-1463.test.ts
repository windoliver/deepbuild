// #2331 criterion 3, #2331.90748b6c: `tests/acceptance/1463/` passes as it does on main. The suite is main's, unchanged
// (its files as at the merge base with origin/main), run whole through its own entry, as its README runs it:
//   NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1463 --no-file-parallelism
// with vitest's JSON report beside it. Every one of main's 35 tests in its 10 files must finish `passed` (judge.ts).
// A test failed at its assertion fails this one, naming it; BLOCKED, INCONCLUSIVE (off a fit, quiet reference Mac, AC7's
// 100 ms is INCONCLUSIVE), skipped, missing or unfinished is never PASS.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { judge, type Report, type Run } from './judge.ts';

const ID = '#2331.90748b6c';
const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const SUITE = 'tests/acceptance/1463';
const RUN_MS = 3 * 3_600_000;

const git = (args: string[]): string => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function runSuite(): Promise<Run> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-2331-ac3-'));
  const out = join(dir, 'report.json');
  const args = [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', SUITE, '--no-file-parallelism', '--reporter=default', '--reporter=json', `--outputFile.json=${out}`];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: REPO, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let finished = true;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (output += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (output += d));
    const timer = setTimeout(() => { finished = false; child.kill('SIGKILL'); }, RUN_MS);
    child.on('close', (exit) => {
      clearTimeout(timer);
      let report: Report | undefined;
      try { report = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as Report) : undefined; } catch { report = undefined; }
      rmSync(dir, { recursive: true, force: true });
      resolve({ exit, finished, report, output });
    });
  });
}

describe(ID, () => {
  test(`${ID}: tests/acceptance/1463/ passes as it does on main`, async () => {
    let base = '';
    try { base = git(['merge-base', 'HEAD', 'origin/main']); } catch (e) { throw Error(`BLOCKED: no merge base with origin/main to read main's tests/acceptance/1463 from: ${(e as Error).message}`); }
    const changed = git(['diff', '--name-only', base, '--', SUITE]) + git(['ls-files', '--others', '--exclude-standard', '--', SUITE]);
    expect(changed, `tests/acceptance/1463 must be main's as it stands (merge base ${base}); changed or added`).toBe('');

    const run = await runSuite();
    const j = judge(run, join(REPO, SUITE));
    const summary = /Tests\s+([^\n]+)/.exec(run.output)?.[1] ?? 'no summary';
    console.log(`tests/acceptance/1463: exit ${run.exit}, ${summary}; ${j.verdict}`);
    // The criterion's own assertion: no test of main's suite fails here.
    expect(j.failed, `tests/acceptance/1463 must pass as it does on main: exit ${run.exit}, ${summary}`).toEqual([]);
    if (j.blocked.length) expect.fail(`BLOCKED: tests/acceptance/1463 could not run whole:\n${j.blocked.join('\n')}`);
    if (j.inconclusive.length) expect.fail(`INCONCLUSIVE: tests/acceptance/1463 didn't run whole to a verdict:\n${j.inconclusive.join('\n')}`);
    expect(j.verdict).toBe('PASS');
  }, RUN_MS + 600_000);
});
