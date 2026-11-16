// The judge of #2331's criterion 3 (README): reads vitest's JSON report of `tests/acceptance/1463/`, run through its own
// entry, and says what keeps it from passing as it does on main. Only a run in which every one of main's tests, file by
// file, finished `passed`, with no error outside a test, is PASS. A test failed at an assertion is FAIL; a test that failed
// as BLOCKED or INCONCLUSIVE (1463's `blocked`, #1551's `inconclusive`), a skip, a todo, a missing test or file, or a run
// that left no report or never finished is never PASS.

/** Main's suite, file by file (relative to tests/acceptance/1463), with the tests each declares: 35 in 10 files. */
export const MAIN_1463: Record<string, number> = {
  'budget.test.ts': 2,
  'deep.test.ts': 4,
  'detail.test.ts': 1,
  'inbox.test.ts': 5,
  'judges.test.ts': 8,
  'list.test.ts': 4,
  'notification.test.ts': 2,
  'scope.test.ts': 2,
  'words.test.ts': 2,
  'redraft-judges/table-judges.test.ts': 5,
};

export interface Assertion { fullName: string; status: string; failureMessages?: string[] }
export interface FileResult { name: string; status?: string; message?: string; assertionResults: Assertion[] }
export interface Report { success?: boolean; testResults: FileResult[] }
export interface Run { exit: number | null; finished: boolean; report: Report | undefined; output: string }
export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE';
export interface Judged { verdict: Verdict; failed: string[]; blocked: string[]; inconclusive: string[] }

const first = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(0, 4).join(' / ').slice(0, 600);

/** `root` is tests/acceptance/1463's absolute path; each file's `name` in the report is absolute. */
export function judge(run: Run, root: string): Judged {
  const failed: string[] = [], blocked: string[] = [], inconclusive: string[] = [];
  if (!run.finished) inconclusive.push(`the run of tests/acceptance/1463 never finished (killed at its time limit): ${first(run.output.slice(-1500))}`);
  if (!run.report) {
    inconclusive.push(`the run left no JSON report (exit ${run.exit}): ${first(run.output.slice(-1500))}`);
    return { verdict: verdictOf(failed, blocked, inconclusive), failed, blocked, inconclusive };
  }
  const prefix = root.endsWith('/') ? root : `${root}/`;
  const byFile = new Map(run.report.testResults.map((f) => [f.name.startsWith(prefix) ? f.name.slice(prefix.length) : f.name, f]));
  for (const [file, count] of Object.entries(MAIN_1463)) {
    const f = byFile.get(file);
    if (!f) { inconclusive.push(`${file}: not in the run (main runs ${count} tests there)`); continue; }
    if (f.message && f.assertionResults.length === 0) failed.push(`${file}: the file errored before its tests: ${first(f.message)}`);
    else if (f.assertionResults.length !== count) failed.push(`${file}: ${f.assertionResults.length} tests ran, main has ${count}`);
    for (const a of f.assertionResults) {
      const why = first((a.failureMessages ?? []).join('\n'));
      if (a.status === 'passed') continue;
      if (a.status !== 'failed') inconclusive.push(`${a.status}, not run: ${a.fullName}`);
      else if (/\bBLOCKED:/.test(why)) blocked.push(`${a.fullName}: ${why}`);
      else if (/\bINCONCLUSIVE:/.test(why)) inconclusive.push(`${a.fullName}: ${why}`);
      else failed.push(`failed: ${a.fullName}: ${why || 'no message'}`);
    }
  }
  for (const file of byFile.keys()) if (!(file in MAIN_1463)) failed.push(`${file}: a test file main's tests/acceptance/1463 doesn't have`);
  const clean = failed.length + blocked.length + inconclusive.length === 0;
  if (clean && (run.exit !== 0 || run.report.success !== true)) failed.push(`every test passed, but the run exited ${run.exit} with success ${String(run.report.success)} (an error outside a test): ${first(run.output.slice(-1500))}`);
  return { verdict: verdictOf(failed, blocked, inconclusive), failed, blocked, inconclusive };
}

const verdictOf = (failed: string[], blocked: string[], inconclusive: string[]): Verdict =>
  failed.length ? 'FAIL' : blocked.length ? 'BLOCKED' : inconclusive.length ? 'INCONCLUSIVE' : 'PASS';
