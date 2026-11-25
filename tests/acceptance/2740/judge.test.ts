// The judge #2740's test reads #1463's run with (judge.ts), held to written inputs: no hub, app, git or runner. It
// carries no criterion tag, as #1463's own judges.test.ts carries none: it proves the judge fails a wrong run, naming
// what is wrong, and passes only a whole run that passed.
import { describe, expect, test } from 'vitest';
import { blobId, caseState, differences, importsOf, judgeRun, told, verdict, withTestImports, type Assertion, type Listed, type Report, type Run } from './judge.ts';

const REPO = '/work/repo';
const A = 'tests/acceptance/9/a.test.ts';
const B = 'tests/acceptance/9/sub/b.test.ts';
const at = (path: string): string => `${REPO}/${path}`;
/** A stack as vitest's report gives it after a failure's own lines. */
const STACK = `\n    at ${at(A)}:12:5\n    at file://${REPO}/node_modules/vitest/dist/chunks/run.js:1632:35`;

const passed = (title: string, ancestors = ['outer']): Assertion => ({ ancestorTitles: ancestors, title, status: 'passed', failureMessages: [] });
const failed = (title: string, message: string, ancestors = ['outer']): Assertion => ({ ancestorTitles: ancestors, title, status: 'failed', failureMessages: [`${message}${STACK}`] });
const quiet = (title: string, status: string): Assertion => ({ ancestorTitles: ['outer'], title, status, failureMessages: [] });
const nameOf = (a: Assertion): string => [...a.ancestorTitles, a.title].join(' > ');

/** A run as vitest leaves it: the listing of every case that runs, the report of every row, exit 1 on a failed one. */
function runOf(byFile: Record<string, Assertion[]>): Run {
  const testResults = Object.entries(byFile).map(([file, rows]) => ({ name: at(file), status: rows.some((a) => a.status === 'failed') ? 'failed' : 'passed', message: '', assertionResults: rows }));
  return {
    files: Object.keys(byFile),
    // vitest list leaves skipped and todo cases out.
    listed: Object.entries(byFile).flatMap(([file, rows]) => rows.filter((a) => a.status === 'passed' || a.status === 'failed').map((a) => ({ name: nameOf(a), file: at(file) }))),
    report: { numTotalTests: testResults.reduce((n, f) => n + f.assertionResults.length, 0), testResults },
    exit: testResults.some((f) => f.status === 'failed') ? 1 : 0,
  };
}
const whole = (): Record<string, Assertion[]> => ({ [A]: [passed('one'), passed('two', ['outer', 'inner'])], [B]: [passed('three')] });
/** The report of a run runOf made, to edit into a wrong one. */
const reportOf = (run: Run): Required<Report> => run.report as Required<Report>;
const judged = (run: Run) => judgeRun(REPO, run);
const lines = (run: Run, state: string): string[] => judged(run).findings.filter((f) => f.state === state).map((f) => f.line);

describe("judge.ts: #1463's run, case by case and whole", () => {
  test('a whole run whose every listed case passed is PASS, with each case read by its file and full name', () => {
    const { findings, cases } = judged(runOf(whole()));
    expect(findings).toEqual([]);
    expect(verdict(findings)).toBe('PASS');
    expect(cases).toEqual([
      { key: `${A} › outer > one`, state: 'PASS', why: '' },
      { key: `${A} › outer > inner > two`, state: 'PASS', why: '' },
      { key: `${B} › outer > three`, state: 'PASS', why: '' },
    ]);
  });

  test("a failed case is FAIL, naming the case and what its failure says, without the failure's stack", () => {
    const run = runOf({ ...whole(), [B]: [failed('three', 'AssertionError: deep inbox undo prints "06:51", not the clock time in your time zone: expected false to be true')] });
    const { findings } = judged(run);
    expect(verdict(findings)).toBe('FAIL');
    expect(findings).toEqual([{ state: 'FAIL', line: `${B} › outer > three: AssertionError: deep inbox undo prints "06:51", not the clock time in your time zone: expected false to be true` }]);
    expect(findings[0]!.line).not.toMatch(/node_modules|:12:5/);
  });

  test('a case that names its own state keeps it, read from its first line as the lanes read one, and FAIL outranks every other', () => {
    const timing = 'AssertionError: INCONCLUSIVE: the machine is loaded: 1-minute load average 150.0 on 18 cores; the timing is a reading only\ndeep on 700 rows: 122.4, 123.8, 436.2, 73.2, 87.9 ms against 100 ms';
    const cases: [string, string][] = [
      [timing, 'INCONCLUSIVE'],
      ['Error: BLOCKED: cargo build -p deep-replica failed', 'BLOCKED'],
      ['AssertionError: INVALID: the case reached no row', 'INVALID'],
      ['INCONCLUSIVE: a bare message', 'INCONCLUSIVE'],
      // A state's word inside the text, or in other case, is no state of its own.
      ["AssertionError: expected 'INCONCLUSIVE: x' to be 'PASS'", 'FAIL'],
      ['Error: inconclusive: lower case', 'FAIL'],
      ['TypeError: Cannot read properties of undefined', 'FAIL'],
    ];
    for (const [message, state] of cases) expect(caseState(failed('x', message)), message).toBe(state);
    const read = judged(runOf({ ...whole(), [B]: [failed('three', timing)] }));
    expect(read.findings).toEqual([{ state: 'INCONCLUSIVE', line: `${B} › outer > three: ${timing.replace('\n', ' ')}` }]);
    expect(verdict(read.findings), 'a timing read off a fit, quiet reference Mac is never a pass').toBe('INCONCLUSIVE');
    const mixed = (messages: string[]) => verdict(judged(runOf({ [A]: messages.map((m, i) => failed(`case ${i}`, m)), [B]: [passed('three')] })).findings);
    expect(mixed([timing, 'Error: BLOCKED: no cargo', 'AssertionError: INVALID: x', 'AssertionError: expected 1 to be 2'])).toBe('FAIL');
    expect(mixed([timing, 'Error: BLOCKED: no cargo', 'AssertionError: INVALID: x'])).toBe('INVALID');
    expect(mixed([timing, 'Error: BLOCKED: no cargo'])).toBe('BLOCKED');
    expect(verdict([])).toBe('PASS');
  });

  test('a case skipped, left todo, pending or disabled ran nothing, so it is BLOCKED, naming it', () => {
    for (const status of ['skipped', 'todo', 'pending', 'disabled']) {
      const run = runOf({ ...whole(), [B]: [passed('three'), quiet('four', status)] });
      expect(judged(run).findings, status).toEqual([{ state: 'BLOCKED', line: `${B} › outer > four: ${status}: it ran nothing` }]);
    }
  });

  test('every listed case needs its own row, and a row the listing never found is INVALID', () => {
    const lost = runOf(whole());
    reportOf(lost).testResults[0]!.assertionResults!.pop();
    reportOf(lost).numTotalTests = 2;
    expect(judged(lost).findings).toEqual([{ state: 'BLOCKED', line: `${A} › outer > inner > two: listed, and the run has no row for it (not run)` }]);

    const extra = runOf(whole());
    extra.listed = (extra.listed as Listed[]).filter((l) => l.name !== 'outer > three');
    expect(judged(extra).findings).toEqual([{ state: 'INVALID', line: `${B} › outer > three: the run has a row for it, and the listing didn't find it` }]);

    // Two cases of one full name need two rows; one row can't stand for both.
    const twice = runOf({ [A]: [passed('same'), passed('same')], [B]: [passed('three')] });
    expect(judged(twice).findings).toEqual([]);
    reportOf(twice).testResults[0]!.assertionResults!.pop();
    reportOf(twice).numTotalTests = 2;
    expect(lines(twice, 'BLOCKED')).toEqual([`${A} › outer > same: listed, and the run has no row for it (not run)`]);
  });

  test("the suite's files: one the run never reported is BLOCKED, and one that isn't the suite's is INVALID", () => {
    const unreported = runOf(whole());
    unreported.files = [...unreported.files, 'tests/acceptance/9/c.test.ts'];
    expect(judged(unreported).findings).toEqual([{ state: 'BLOCKED', line: 'tests/acceptance/9/c.test.ts: a test file of the suite the run never reported (not found)' }]);

    const foreign = runOf(whole());
    foreign.files = [A];
    expect(judged(foreign).findings).toEqual([{ state: 'INVALID', line: `${B}: the run reports a file that isn't the suite's` }]);
  });

  test("a file that failed outside its cases, in a hook or on its imports, is FAIL, naming the file and what it said", () => {
    const hook = runOf(whole());
    Object.assign(reportOf(hook).testResults[1]!, { status: 'failed', message: 'Error: afterAll cleanup stopped no hub\n    at x' });
    hook.exit = 1;
    expect(judged(hook).findings).toEqual([{ state: 'FAIL', line: `${B} failed outside its cases: Error: afterAll cleanup stopped no hub` }]);

    const imports = runOf({ [A]: whole()[A]! });
    imports.files.push(B);
    reportOf(imports).testResults.push({ name: at(B), status: 'failed', message: "Cannot find module '../16/helpers.ts'", assertionResults: [] });
    imports.exit = 1;
    expect(judged(imports).findings).toEqual([{ state: 'FAIL', line: `${B} failed outside its cases: Cannot find module '../16/helpers.ts'` }]);
  });

  test('the run as a whole: no report, no listing, no case, a count unlike the rows, a stop and an unexplained exit each name themselves', () => {
    const none = { ...runOf(whole()), report: 'ENOENT: no such file report.json', exit: 1 };
    expect(judged(none).findings).toEqual([{ state: 'BLOCKED', line: 'the run left no report (exit 1): ENOENT: no such file report.json' }]);

    const unlisted = { ...runOf(whole()), listed: "exit 1: Cannot find module 'packages/evidence/dist/patterns.json'" };
    expect(judged(unlisted).findings).toEqual([{ state: 'BLOCKED', line: "vitest could not list the suite's cases: exit 1: Cannot find module 'packages/evidence/dist/patterns.json'" }]);
    // A failure the run shows still outranks a listing that couldn't be made.
    const unlistedFail = { ...runOf({ ...whole(), [B]: [failed('three', 'AssertionError: expected 1 to be 2')] }), listed: 'exit 1: x' };
    expect(verdict(judged(unlistedFail).findings)).toBe('FAIL');

    const empty = { files: [], listed: [], report: { numTotalTests: 0, testResults: [] }, exit: 1 };
    expect(judged(empty).findings).toEqual([{ state: 'BLOCKED', line: 'the run reported no case' }]);

    const miscounted = runOf(whole());
    reportOf(miscounted).numTotalTests = 35;
    expect(judged(miscounted).findings).toEqual([{ state: 'INVALID', line: 'the report counts 35 cases and holds 3 rows' }]);

    const stopped = { ...runOf(whole()), exit: null, stopped: 'it was still running after 7 hours' };
    expect(judged(stopped).findings).toEqual([{ state: 'BLOCKED', line: 'the run was stopped before it ended: it was still running after 7 hours' }]);
    expect(judged({ ...runOf(whole()), exit: null }).findings).toEqual([{ state: 'BLOCKED', line: 'the run ended on a signal' }]);

    const unexplained = { ...runOf(whole()), exit: 1 };
    expect(judged(unexplained).findings).toEqual([{ state: 'FAIL', line: 'vitest exited 1 with no failed case or file to show for it: an error outside the cases' }]);
    // An exit a failed case explains, an INCONCLUSIVE one included, adds nothing.
    const timing = runOf({ ...whole(), [B]: [failed('three', 'AssertionError: INCONCLUSIVE: loaded')] });
    expect(judged(timing).findings.map((f) => f.state)).toEqual(['INCONCLUSIVE']);
  });

  test('told keeps what a failure says and drops where it was thrown', () => {
    expect(told([`AssertionError: first\nsecond line${STACK}`])).toBe('AssertionError: first second line');
    expect(told([])).toBe('');
    expect(told(['x'.repeat(2000)])).toHaveLength(600);
  });
});

describe("judge.ts: the suite as main holds it", () => {
  test("blobId is git's blob ID of the bytes, so a file compares with main's tree byte for byte", () => {
    // `printf 'hello\n' | git hash-object --stdin`, and the empty blob.
    expect(blobId(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(blobId(Buffer.from(''))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });

  test('differences names each file not on main, each on main and gone, and each with other bytes, and nothing for equal trees', () => {
    const main = new Map([[A, 'a'.repeat(40)], [B, 'b'.repeat(40)], ['tests/acceptance/16/helpers.ts', 'c'.repeat(40)]]);
    expect(differences(new Map(main), main)).toEqual([]);
    const here = new Map(main);
    here.delete(B);
    here.set('tests/acceptance/9/skip.test.ts', 'd'.repeat(40));
    here.set('tests/acceptance/16/helpers.ts', 'e'.repeat(40));
    expect(differences(here, main)).toEqual([
      'tests/acceptance/16/helpers.ts is eeeeeeeeeeee here and cccccccccccc on main',
      'tests/acceptance/9/skip.test.ts is not on main',
      `${B} is on main and not here`,
    ]);
  });

  test("withTestImports follows the scripts' relative imports under tests/, near and far, and no further", () => {
    const files: Record<string, string> = {
      [A]: "import { x } from './helpers.ts';\nimport type { Y } from '../16/helpers.ts';\n",
      'tests/acceptance/9/helpers.ts': "export * from '../26/helpers.js';\nimport { when } from '../../../packages/hub/src/list.ts';\nconst late = await import('./late.ts');\nimport './side.ts';\nimport { gone } from './gone.ts';\n",
      'tests/acceptance/16/helpers.ts': "import {\n  timingProblem,\n} from '../1551/helpers.ts';\n",
      'tests/acceptance/26/helpers.ts': '',
      'tests/acceptance/1551/helpers.ts': "import { A } from '../16/helpers.ts';\n",
      'tests/acceptance/9/late.ts': '',
      'tests/acceptance/9/side.ts': '',
      // Prose isn't followed, and code under test is no test file.
      'tests/acceptance/9/README.md': "import x from '../99/helpers.ts'\n",
      'tests/acceptance/99/helpers.ts': '',
      'packages/hub/src/list.ts': "import { y } from '../../../tests/acceptance/77/x.ts';\n",
      'tests/acceptance/77/x.ts': '',
    };
    const read = (path: string): string | null => files[path] ?? null;
    expect(importsOf('tests/acceptance/9/helpers.ts', files['tests/acceptance/9/helpers.ts']!)).toEqual([
      'tests/acceptance/26/helpers.js', 'packages/hub/src/list.ts', 'tests/acceptance/9/late.ts', 'tests/acceptance/9/side.ts', 'tests/acceptance/9/gone.ts',
    ]);
    expect(withTestImports([A, 'tests/acceptance/9/README.md'], read)).toEqual([
      'tests/acceptance/1551/helpers.ts', 'tests/acceptance/16/helpers.ts', 'tests/acceptance/26/helpers.ts',
      'tests/acceptance/9/README.md', A, 'tests/acceptance/9/helpers.ts', 'tests/acceptance/9/late.ts', 'tests/acceptance/9/side.ts',
    ]);
  });
});
