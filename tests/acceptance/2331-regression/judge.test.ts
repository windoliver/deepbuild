// The judge of #2331's criterion 3 held to right and wrong runs of tests/acceptance/1463, written here, with no hub or app.
// No criterion tag: like 1463's judges.test.ts it proves only that suite-1463.test.ts can't read a wrong run as PASS.
import { describe, expect, test } from 'vitest';
import { judge, MAIN_1463, type Assertion, type Report, type Run } from './judge.ts';

const ROOT = '/repo/tests/acceptance/1463';
const AC8 = '#1463.8ad45787 #1463.8ad45787: an ask that defaults to No at 16:40 today reads "If you don\'t answer: No, at 16:40" in deep inbox, and its --json row holds default and default_at';
const AC7 = '#1463.0c303476 #1463.0c303476: deep answers within 100 ms over the socket on 700 rows';

/** Main's suite, every test passed; `change` edits one file's results. */
function report(change: (file: string, tests: Assertion[]) => Assertion[] = (_, t) => t): Report {
  return {
    success: true,
    testResults: Object.entries(MAIN_1463).map(([file, n]) => ({
      name: `${ROOT}/${file}`,
      assertionResults: change(file, Array.from({ length: n }, (_, i) => ({ fullName: file === 'inbox.test.ts' && i === 0 ? AC8 : file === 'budget.test.ts' && i === 1 ? AC7 : `${file} test ${i}`, status: 'passed', failureMessages: [] }))),
    })),
  };
}
const run = (r: Report | undefined, over: Partial<Run> = {}): Run => ({ exit: 0, finished: true, report: r, output: 'Tests  35 passed (35)', ...over });
const failAt = (name: string, message: string) => (_: string, tests: Assertion[]) => tests.map((t) => (t.fullName === name ? { ...t, status: 'failed', failureMessages: [message] } : t));

describe("judges: #2331 criterion 3's reading of a 1463 run", () => {
  test('main as it is: every test passed, exit 0, is PASS', () => {
    expect(judge(run(report()), ROOT)).toEqual({ verdict: 'PASS', failed: [], blocked: [], inconclusive: [] });
  });

  test('a clock written in UTC: AC8 failing at its assertion is FAIL, naming the test and its message', () => {
    const j = judge(run(report(failAt(AC8, 'AssertionError: deep inbox prints "If you don\'t answer: No, at 11:10" for the 16:40 ask')), { exit: 1 }), ROOT);
    expect(j.verdict).toBe('FAIL');
    expect(j.failed.join('\n')).toContain(AC8);
    expect(j.failed.join('\n')).toContain('at 11:10');
  });

  test('BLOCKED and INCONCLUSIVE tests are never PASS', () => {
    expect(judge(run(report(failAt(AC7, 'AssertionError: INCONCLUSIVE: Mac16,1 is no reference Mac; the timing is a reading only')), { exit: 1 }), ROOT).verdict).toBe('INCONCLUSIVE');
    expect(judge(run(report(failAt(AC8, 'Error: BLOCKED: no built CLI at packages/cli/dist/main.js')), { exit: 1 }), ROOT).verdict).toBe('BLOCKED');
  });

  test('skipped, todo, missing tests, a missing file, an extra file, a file that errored: never PASS', () => {
    for (const status of ['skipped', 'pending', 'todo']) expect(judge(run(report((_, t) => t.map((a) => (a.fullName === AC8 ? { ...a, status } : a)))), ROOT).verdict).not.toBe('PASS');
    expect(judge(run(report((f, t) => (f === 'inbox.test.ts' ? t.slice(1) : t))), ROOT).verdict).toBe('FAIL');
    const missing = report();
    missing.testResults = missing.testResults.filter((f) => !f.name.endsWith('/words.test.ts'));
    expect(judge(run(missing), ROOT).verdict).not.toBe('PASS');
    const extra = report();
    extra.testResults.push({ name: `${ROOT}/other.test.ts`, assertionResults: [] });
    expect(judge(run(extra), ROOT).verdict).toBe('FAIL');
    const errored = report();
    errored.testResults[0] = { name: errored.testResults[0]!.name, status: 'failed', message: 'SyntaxError: no export clockOf', assertionResults: [] };
    expect(judge(run(errored, { exit: 1 }), ROOT).verdict).toBe('FAIL');
  });

  test('no report, an unfinished run, or an error outside the tests: never PASS', () => {
    expect(judge(run(undefined, { exit: 1 }), ROOT).verdict).toBe('INCONCLUSIVE');
    expect(judge(run(report(), { finished: false, exit: null }), ROOT).verdict).toBe('INCONCLUSIVE');
    expect(judge(run(report(), { exit: 1 }), ROOT).verdict).toBe('FAIL');
    expect(judge(run({ ...report(), success: false }), ROOT).verdict).toBe('FAIL');
  });
});
