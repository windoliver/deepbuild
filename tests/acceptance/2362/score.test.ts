// AC3 #2362.c889f209: #154's suite passes unchanged.
//
// #154's suite (tests/acceptance/154/ and its blind redraft, tests/acceptance/154-redraft/) is the criterion's proof,
// and the implementer runs both folders unchanged (README); their hub files render stems through the supervisor and
// take hours. This runs, unchanged and in a vitest of their own, the files of the two that hold motion's score check
// through `deep_show` (criterion 6 of #154: score.pad_too_low and score.note_too_long, naming the event, at their
// boundary pairs): the check whose codes, code lists and planted documents this issue changes. A run that fails, skips
// or runs no test fails here.
//
// It passes on the base, where #154's suite passes: it guards the change and can't fail there for its own reason.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC3, REPO, useTemp } from './helpers.ts';

const temp = useTemp();
/** #154's files, of the first draft and its redraft, that check a score through deep-show alone. */
const FILES = ['tests/acceptance/154/rules.test.ts', 'tests/acceptance/154-redraft/limits.test.ts'];

interface Assertion { fullName: string; status: string; failureMessages?: string[] }
interface Report { numTotalTests: number; numPassedTests: number; numFailedTests: number; numPendingTests: number; numTodoTests: number; testResults: { name: string; status: string; message?: string; assertionResults?: Assertion[] }[] }

describe(`${AC3} #154's suite passes unchanged`, () => {
  it(`${AC3} #154's files that hold motion's score check through deep_show (its criterion 6, first draft and redraft) pass unchanged: every test runs and passes`, () => {
    const out = join(temp(), 'report.json');
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    for (const k of Object.keys(env)) if (k.startsWith('VITEST')) delete env[k];
    const r = spawnSync(process.execPath, [join(REPO, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...FILES, '--no-file-parallelism', '--testTimeout=3600000', '--reporter=json', `--outputFile=${out}`], {
      cwd: REPO, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 3_300_000, killSignal: 'SIGKILL',
    });
    expect(r.error, `vitest ran #154's files: ${r.error?.message ?? ''}`).toBeUndefined();
    let report: Report;
    try { report = JSON.parse(readFileSync(out, 'utf8')) as Report; } catch (e) {
      throw Error(`vitest wrote no report (exit ${r.status}): ${(e as Error).message}\n${r.stdout.slice(-3000)}\n${r.stderr.slice(-3000)}`);
    }
    const ran = report.testResults.map((t) => t.name.slice(REPO.length + 1));
    expect(ran.sort(), 'vitest ran each of #154\'s files named').toEqual([...FILES].sort());
    const failed = report.testResults.filter((t) => t.status !== 'passed').map((t) => `${t.name.slice(REPO.length + 1)}: ${t.status} ${(t.message ?? '').slice(0, 1000)}`);
    const tests = report.testResults.flatMap((t) => (t.assertionResults ?? []).filter((a) => a.status !== 'passed').map((a) => `${a.fullName}: ${a.status} ${(a.failureMessages ?? []).join(' ').slice(0, 1500)}`));
    expect([...failed, ...tests], '#154\'s files pass unchanged, every test in them').toEqual([]);
    expect(report.numTotalTests, 'they hold tests').toBeGreaterThan(0);
    expect([report.numFailedTests, report.numPendingTests, report.numTodoTests], 'none fails, skips or is left to do').toEqual([0, 0, 0]);
    expect(report.numPassedTests, 'every test passes').toBe(report.numTotalTests);
    expect(r.status, 'vitest exits 0').toBe(0);
  }, 3_600_000);
});
