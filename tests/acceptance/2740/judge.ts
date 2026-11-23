// The judge #2740's test reads #1463's suite with (README: What the test holds). Pure functions over what the run
// left: vitest's listing of the suite's cases, its JSON report and its exit, and the suite's files beside main's. No
// hub, app or runner here, so judge.test.ts holds each rule to written inputs.
import { createHash } from 'node:crypto';
import { posix, relative } from 'node:path';

export type State = 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE';
export type Verdict = State | 'PASS';
export interface Finding { state: State; line: string }

/** One case `vitest list --json` found: its suites' and its own names joined by ` > `, and its file. */
export interface Listed { name: string; file: string }
/** One case's row in vitest's JSON report. */
export interface Assertion { ancestorTitles: string[]; title: string; status: string; failureMessages?: string[] }
/** One file's entry in vitest's JSON report. */
export interface FileResult { name: string; status: string; message?: string; assertionResults?: Assertion[] }
export interface Report { numTotalTests?: number; testResults?: FileResult[] }

/** What one run of the suite left. A string where a part is missing says why. */
export interface Run {
  /** The suite's test files, by repo path: main's, since the test checks the folder is main's before it runs. */
  files: string[];
  listed: Listed[] | string;
  report: Report | string;
  /** The runner's exit status; null when it ended on a signal. */
  exit: number | null;
  /** Why the run was stopped before it ended, if it was: its deadline passed, say. */
  stopped?: string;
}

/** The precedence of the states (scripts/lanes.mjs `worst`, the design's verdict table); PASS only with none. */
const ORDER: State[] = ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE'];
export const verdict = (findings: readonly Finding[]): Verdict => ORDER.find((state) => findings.some((f) => f.state === state)) ?? 'PASS';

/** A failure's own lines, before its stack, cut short: what it says, never where vitest threw it. */
export function told(messages: readonly string[] = []): string {
  const lines = (messages[0] ?? '').split('\n');
  const at = lines.findIndex((line) => /^\s+at /.test(line));
  return (at < 0 ? lines : lines.slice(0, at)).join(' ').replace(/\s+/g, ' ').trim().slice(0, 600);
}

/**
 * A case's state from its row. A pass is PASS. A failure keeps the state its first line names, as the lanes read one
 * (scripts/lanes.mjs `stateOf`): BLOCKED, INCONCLUSIVE or INVALID, else FAIL. A case skipped, left todo or pending
 * ran nothing, so it is BLOCKED.
 */
export function caseState(a: Assertion): Verdict {
  if (a.status === 'passed') return 'PASS';
  if (a.status !== 'failed') return 'BLOCKED';
  const first = (a.failureMessages ?? [])[0]?.split('\n')[0] ?? '';
  return (/^(?:\w*Error: )?(BLOCKED|INCONCLUSIVE|INVALID)\b/.exec(first)?.[1] as State | undefined) ?? 'FAIL';
}

/**
 * The run judged case by case, and the run as a whole reconciled with the listing (the design's Case lists): every
 * listed case has its own row, no row runs that the listing didn't find, every test file of the suite was reported,
 * the report's count equals its rows, and a runner that failed with every case passed failed somewhere no row shows.
 */
export function judgeRun(repo: string, run: Run): { findings: Finding[]; cases: { key: string; state: Verdict; why: string }[] } {
  const findings: Finding[] = [];
  const at = (file: string): string => relative(repo, file);
  const keyOf = (file: string, name: string): string => `${at(file)} › ${name}`;
  const count = (map: Map<string, number>, key: string): void => void map.set(key, (map.get(key) ?? 0) + 1);
  if (run.stopped) findings.push({ state: 'BLOCKED', line: `the run was stopped before it ended: ${run.stopped}` });
  if (typeof run.listed === 'string') findings.push({ state: 'BLOCKED', line: `vitest could not list the suite's cases: ${run.listed}` });
  if (typeof run.report === 'string') {
    findings.push({ state: 'BLOCKED', line: `the run left no report (exit ${run.exit}): ${run.report}` });
    return { findings, cases: [] };
  }
  const files = run.report.testResults ?? [];
  const cases: { key: string; state: Verdict; why: string }[] = [];
  const ran = new Map<string, number>();
  let rows = 0;
  for (const file of files) {
    const results = file.assertionResults ?? [];
    rows += results.length;
    if (!run.files.includes(at(file.name))) findings.push({ state: 'INVALID', line: `${at(file.name)}: the run reports a file that isn't the suite's` });
    if (file.status === 'failed' && !results.some((a) => a.status === 'failed')) {
      findings.push({ state: 'FAIL', line: `${at(file.name)} failed outside its cases: ${told([file.message ?? '']) || 'in a hook or on its imports'}` });
    }
    for (const a of results) {
      const key = keyOf(file.name, [...a.ancestorTitles, a.title].join(' > '));
      const state = caseState(a);
      const why = state === 'PASS' ? '' : a.status === 'failed' ? told(a.failureMessages) : `${a.status}: it ran nothing`;
      cases.push({ key, state, why });
      if (state !== 'PASS') findings.push({ state, line: `${key}: ${why}` });
      // The listing leaves skipped and todo cases out; each is BLOCKED above.
      if (a.status === 'passed' || a.status === 'failed') count(ran, key);
    }
  }
  if (Array.isArray(run.listed)) {
    const planned = new Map<string, number>();
    for (const l of run.listed) count(planned, keyOf(l.file, l.name));
    for (const [key, n] of planned) if ((ran.get(key) ?? 0) < n) findings.push({ state: 'BLOCKED', line: `${key}: listed, and the run has no row for it (not run)` });
    for (const [key, n] of ran) if ((planned.get(key) ?? 0) < n) findings.push({ state: 'INVALID', line: `${key}: the run has a row for it, and the listing didn't find it` });
  }
  for (const file of run.files) if (!files.some((f) => at(f.name) === file)) findings.push({ state: 'BLOCKED', line: `${file}: a test file of the suite the run never reported (not found)` });
  if (run.report.numTotalTests !== rows) findings.push({ state: 'INVALID', line: `the report counts ${run.report.numTotalTests} cases and holds ${rows} rows` });
  if (!rows) findings.push({ state: 'BLOCKED', line: 'the run reported no case' });
  // vitest exits 1 for a failed case or file; any other way it fails, such as an error no test caught, shows in no row.
  const explained = files.some((f) => f.status === 'failed' || (f.assertionResults ?? []).some((a) => a.status === 'failed'));
  if (run.exit === null && !run.stopped) findings.push({ state: 'BLOCKED', line: 'the run ended on a signal' });
  if (rows && run.exit !== null && run.exit !== 0 && !explained) findings.push({ state: 'FAIL', line: `vitest exited ${run.exit} with no failed case or file to show for it: an error outside the cases` });
  return { findings, cases };
}

// ---- The suite as main holds it.

/** Git's blob ID of a file's bytes, as `git hash-object --no-filters` gives it. */
export const blobId = (bytes: Uint8Array): string => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

/** The repo paths a module's relative imports name (`from '…'`, `import('…')`, `import '…'`), before resolution. */
export function importsOf(path: string, source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)(['"])(\.{1,2}\/[^'"]+)\1/gm)]
    .map(([, , specifier]) => posix.normalize(posix.join(posix.dirname(path), specifier!)));
}

/**
 * The files `start` holds and those its scripts reach by relative imports, near and far, that lie under `tests/`: the
 * suite and the helpers it runs with, other suites' included. `read` gives a repo path's text, or null where no file
 * is. An import is found as written, or a `.js` written for its `.ts`, as TypeScript resolves it.
 */
export function withTestImports(start: readonly string[], read: (path: string) => string | null): string[] {
  const seen = new Map<string, string>();
  const visit = (path: string): void => {
    if (seen.has(path)) return;
    const text = read(path);
    if (text === null) return;
    seen.set(path, text);
    if (!/\.[cm]?[jt]sx?$/.test(path)) return;
    for (const named of importsOf(path, text)) {
      const found = [named, named.replace(/\.js$/, '.ts')].find((candidate) => candidate.startsWith('tests/') && (seen.has(candidate) || read(candidate) !== null));
      if (found) visit(found);
    }
  };
  start.forEach(visit);
  return [...seen.keys()].sort();
}

/** How the files here differ from main's, each path to its blob ID: a file main lacks, one main holds and this lacks, other bytes. */
export function differences(here: ReadonlyMap<string, string>, main: ReadonlyMap<string, string>): string[] {
  return [...new Set([...here.keys(), ...main.keys()])].sort().flatMap((path) => {
    const now = here.get(path), then = main.get(path);
    if (then === undefined) return [`${path} is not on main`];
    if (now === undefined) return [`${path} is on main and not here`];
    return now === then ? [] : [`${path} is ${now.slice(0, 12)} here and ${then.slice(0, 12)} on main`];
  });
}
