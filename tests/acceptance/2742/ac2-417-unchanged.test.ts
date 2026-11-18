// AC2 #2742.fbe6114c: `film2d`'s rows keep their shape and every frame still draws: `tests/acceptance/417/`'s tests
// other than its budgets pass unchanged.
//
// Not a copy of that suite: it is run as it stands, in a child Vitest, every `*.test.ts` file in tests/acceptance/417
// but budgets.test.ts, one file at a time as its README asks, with the build environment the other suites use (README:
// Run). "Unchanged" is read from git: no file of that folder but budgets.test.ts, its README and its BASE-FAILURE.txt
// differs from the merge base with origin/main, in the working tree or in a commit. Passing means every one of those
// files ran, each test in it ran and passed, and none was skipped. A change that breaks a test there, edits one of its
// files or leaves a file unrun fails this test, naming the test or the file.
//
// At the base, where #2742's change doesn't exist, this test passes: it is the criterion that keeps what works.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC, REPO, buildEnv, inconclusive, requireMetal, useOut } from './helpers.ts';

const SUITE = join(REPO, 'tests', 'acceptance', '417');
/** What the criterion leaves out ("other than its budgets"), and the two files that are no test. */
const LEFT_OUT = new Set(['budgets.test.ts', 'README.md', 'BASE-FAILURE.txt']);
const out = useOut();
// The child run leaves Vitest's cache in tests/acceptance/417/node_modules (README: Run); removed when this run made it.
const CACHE = join(SUITE, 'node_modules');
const hadCache = existsSync(CACHE);
afterAll(() => { if (!hadCache) rmSync(CACHE, { recursive: true, force: true }); });

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) inconclusive(`git ${args.join(' ')} failed: ${(r.stderr ?? '').trim()}`);
  return r.stdout.trim();
}

interface Assertion { title: string; fullName?: string; status: string; failureMessages?: string[] }
interface FileResult { name: string; status: string; message?: string; assertionResults: Assertion[] }

describe('#417 tests other than its budgets, unchanged', () => {
  it(`${AC[2]} tests/acceptance/417's tests other than its budgets are unchanged from the merge base and all pass`, () => {
    requireMetal();
    const base = git(['merge-base', 'HEAD', 'origin/main']);
    const changed = git(['diff', '--name-only', base, '--', 'tests/acceptance/417']).split('\n')
      .filter((p) => p !== '' && !LEFT_OUT.has(p.slice('tests/acceptance/417/'.length)));
    expect(changed, `tests/acceptance/417's tests other than its budgets are unchanged from the merge base ${base}`).toEqual([]);

    const files = readdirSync(SUITE).filter((f) => f.endsWith('.test.ts') && !LEFT_OUT.has(f)).sort();
    expect(files.length, 'tests/acceptance/417 holds test files other than its budgets').toBeGreaterThan(0);
    const report = join(out(), '417.json');
    const vitest = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');
    const run = spawnSync(process.execPath, [vitest, 'run', '--root', SUITE, '--no-file-parallelism', '--reporter=json', `--outputFile=${report}`, ...files], {
      cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...buildEnv(), NO_COLOR: '1' }, timeout: 7_000_000, killSignal: 'SIGKILL',
    });
    if (run.error) throw Error(`the child Vitest over tests/acceptance/417: ${run.error.message}`);
    expect(existsSync(report), `the child Vitest wrote its report (exit ${run.status}, ${run.signal ?? 'no signal'}); stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(true);
    const results = (JSON.parse(readFileSync(report, 'utf8')) as { testResults: FileResult[] }).testResults;

    const failures: string[] = [];
    for (const f of files) {
      const r = results.find((x) => x.name.endsWith(`/tests/acceptance/417/${f}`));
      if (!r) { failures.push(`${f}: didn't run`); continue; }
      if (r.assertionResults.length === 0) failures.push(`${f}: ran no test (${r.status}${r.message ? `: ${r.message.slice(0, 600)}` : ''})`);
      for (const a of r.assertionResults) {
        if (a.status !== 'passed') failures.push(`${f}: "${a.fullName ?? a.title}" ${a.status}${a.failureMessages?.length ? `: ${a.failureMessages.join('\n').slice(0, 800)}` : ''}`);
      }
    }
    for (const r of results) if (!files.some((f) => r.name.endsWith(`/tests/acceptance/417/${f}`))) failures.push(`${r.name}: ran, but it isn't one of the files this criterion names`);
    expect(failures, `tests/acceptance/417's tests other than its budgets, run unchanged:\n  ${failures.join('\n  ')}`).toEqual([]);
    expect(run.status, `the child Vitest exits 0; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  }, 7_200_000);
});
