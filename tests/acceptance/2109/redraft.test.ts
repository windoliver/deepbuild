// Acceptance tests for #2109: #83 AC11's goldens predate #669's test count. Written first and blind, from the issue, the
// design and the base commit (README), never from an implementation.
//
// #83's AC11 goldens start real hubs, so this file runs them once: one child vitest from the repository root with the
// root config, one file at a time, as main's unit lane runs #83's folder. Each criterion reads that run's JSON report by
// test title (README: The surface under test). A golden that failed for its world, not on its line, judged nothing:
// with no other problem the criterion reads INCONCLUSIVE, never PASS (README: Readings, 7).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** #83's suite, the redraft the issue asks for, and the file it replaces. */
const SUITE = 'tests/acceptance/83';
const REDRAFT = `${SUITE}/redraft-669`;
const REPLACED = `${SUITE}/redraft-1460/goldens.test.ts`;
/** #83 AC11's ID, which each of its tests' names starts with (tests/acceptance/83/helpers.ts). */
const AC11 = 'AC11 #83.15ee3b42';
/** The six goldens, by the names the issue gives them. */
const GOLDENS = ['PASS', 'BLOCKED', 'sent back', 'checks running', 'long cause', 'says done'];
/** The wrong-program check: the goldens file's own test of two planted lines (README: Readings, 2). */
const WRONG = `${AC11} (wrong program)`;
/** The shared run's limit, inside the proof lanes' 20 minutes: eight tests that each start a hub take minutes under load. */
const RUN_LIMIT = 15 * 60_000;
const TEST_LIMIT = RUN_LIMIT + 2 * 60_000;

const isFolder = (path: string): boolean => existsSync(join(REPO, path)) && statSync(join(REPO, path)).isDirectory();
const read = (path: string): string | null => (existsSync(join(REPO, path)) && statSync(join(REPO, path)).isFile() ? readFileSync(join(REPO, path), 'utf8') : null);
const firstLine = (text: string): string => text.split('\n').find((line) => line.trim())?.trim() ?? '';
const load = (): string => (loadavg()[0] ?? 0).toFixed(0);

/** A folder's test files, as repository paths: `*.test.ts` at any depth, less twins, fixtures and installed packages. */
function testFiles(folder: string): string[] {
  if (!isFolder(folder)) return [];
  return readdirSync(join(REPO, folder), { recursive: true, encoding: 'utf8' })
    .map((path) => `${folder}/${path}`)
    .filter((path) => path.endsWith('.test.ts') && !/\/(?:node_modules|twins|fixtures)\//.test(path) && statSync(join(REPO, path)).isFile())
    .sort();
}

/**
 * The files main runs that hold #83 AC11's tests: test files under #83's folder that name AC11, less those main's lanes
 * keep by hand only (`byHand` in scripts/lanes.mjs, which the unit lane excludes).
 */
async function ac11OnMain(): Promise<string[]> {
  const { byHand, listed } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { byHand: string[]; listed: (list: string[], file: string) => boolean };
  return testFiles(SUITE).filter((path) => /\bAC11\b|#83\.15ee3b42/.test(read(path) ?? '') && !listed(byHand, path));
}

interface Result { file: string; title: string; status: string; message: string; ms: number }
interface Run { files: string[]; results: Result[]; fileErrors: string[]; seconds: number; load: string }
interface Report { testResults?: { name: string; status?: string; message?: string; assertionResults?: { title: string; status: string; failureMessages?: string[]; duration?: number | null }[] }[] }

const shown = (r: Result): string => `${r.status} ${(r.ms / 1000).toFixed(1)} s ${r.file} › ${r.title.slice(0, 110)}${r.status === 'failed' ? `\n      ${firstLine(r.message).slice(0, 400)}` : ''}`;
/** The run's AC11 tests, one line each, and any file that failed outside its tests. */
const listing = (run: Run): string => [...run.results.filter((r) => r.title.startsWith(`${AC11} `)).map(shown), ...run.fileErrors.map((e) => `file error: ${e}`)].join('\n  ') || '(no AC11 test reported)';

/**
 * Runs test files in a child vitest from the repository root, with the root config and one file at a time, and reads its
 * JSON report. The child gets none of this run's vitest variables and no git variables, so a helper's git in a scratch
 * folder can't reach a repository through them. No report reads BLOCKED; a run past RUN_LIMIT is stopped by its PID and
 * reads INCONCLUSIVE.
 */
async function runFiles(files: string[]): Promise<Run> {
  const before = load();
  const started = Date.now();
  if (!files.length) return { files, results: [], fileErrors: [], seconds: 0, load: `${before} on ${availableParallelism()} cores` };
  const vitest = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');
  if (!existsSync(vitest)) throw Error(`BLOCKED: vitest isn't installed at ${vitest} (npm ci)`);
  const dir = mkdtempSync(join(tmpdir(), 'deep-2109-'));
  const report = join(dir, 'report.json');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:VITEST|GIT_)/.test(key) && !['NODE_ENV', 'TEST', 'FORCE_COLOR'].includes(key)));
  try {
    const child = spawn(process.execPath, [vitest, 'run', ...files, '--no-file-parallelism', '--reporter=json', '--outputFile', report], { cwd: REPO, env: { ...env, NO_COLOR: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000); });
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 60_000).unref();
    }, RUN_LIMIT);
    const exit = await new Promise<number | null>((resolve) => { child.on('exit', resolve); child.on('error', () => resolve(null)); });
    clearTimeout(timer);
    const seconds = Math.round((Date.now() - started) / 1000);
    const at = `${before} → ${load()} on ${availableParallelism()} cores`;
    if (!existsSync(report)) throw Error(`${late ? 'INCONCLUSIVE' : 'BLOCKED'}: the run of ${files.join(', ')} ${late ? `was stopped after ${RUN_LIMIT / 60_000} minutes` : `wrote no report (exit ${exit})`}, at load ${at}: ${stderr.trim().slice(-2000)}`);
    const json = JSON.parse(readFileSync(report, 'utf8')) as Report;
    const root = realpathSync(REPO);
    const rel = (name: string): string => relative(root, existsSync(name) ? realpathSync(name) : name);
    const results = (json.testResults ?? []).flatMap((file) => (file.assertionResults ?? []).map((test) => ({ file: rel(file.name), title: test.title, status: test.status, message: (test.failureMessages ?? []).join('\n'), ms: Math.round(test.duration ?? 0) })));
    const fileErrors = (json.testResults ?? []).filter((file) => file.status === 'failed' && file.message).map((file) => `${rel(file.name)}: ${firstLine(file.message ?? '')}`);
    const run = { files, results, fileErrors, seconds, load: at };
    console.log(`#2109: one run of ${files.join(', ')}, ${seconds} s at load ${at}:\n  ${listing(run)}`);
    return run;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let shared: Promise<Run> | undefined;
/** The one run of #83's AC11 goldens each run of this file makes: the redraft's test files and the AC11 files main runs, together. */
const theRun = (): Promise<Run> => (shared ??= (async () => runFiles([...new Set([...testFiles(REDRAFT), ...(await ac11OnMain())])].sort()))());

/**
 * A failure its world caused, which judged no line (README: Readings, 7): the test's own BLOCKED or INCONCLUSIVE (#83's
 * helpers throw BLOCKED when the hub doesn't answer), the hub unreachable, the Stop hook spooling with no reply within
 * its 50 ms so no line was shown, or a test or hook past its timeout.
 */
const unjudged = (r: Result): boolean => r.status === 'failed'
  && (/^(?:\w*Error: )?(?:BLOCKED|INCONCLUSIVE)\b/.test(firstLine(r.message)) || /hub is unreachable|sync didn't finish within the hook's|(?:Test|Hook) timed out in \d/.test(r.message));
/** The tests that didn't pass: those that failed on their own assertions, or were skipped, are problems; the world's are unsure. */
function sorted(results: Result[]): { problems: string[]; unsure: Result[] } {
  const bad = results.filter((r) => r.status !== 'passed');
  return { problems: bad.filter((r) => !unjudged(r)).map(shown), unsure: bad.filter(unjudged) };
}
/** What no test of `results` is named for: each of the six goldens, and the wrong-program check. */
const missing = (results: Result[]): string[] => [
  ...GOLDENS.filter((g) => !results.some((r) => r.title.startsWith(`${AC11} ${g}:`))).map((g) => `no test is named for the golden "${g}" (${AC11} ${g}: …)`),
  ...(results.some((r) => r.title.startsWith(WRONG)) ? [] : [`no test is named for the wrong-program check (${WRONG} …)`]),
];
/**
 * Fails at this assertion, naming every problem; with none, tests that couldn't be judged leave the criterion
 * INCONCLUSIVE, thrown as a plain error so no proof lane reads it as a failure at an assertion; else it passes.
 */
function judge(what: string, problems: string[], unsure: Result[], run: Run): void {
  expect(problems, `${what}:\n  ${problems.join('\n  ')}\n\nThe run, ${run.seconds} s at load ${run.load}:\n  ${listing(run)}\n`).toEqual([]);
  if (unsure.length) throw Error(`INCONCLUSIVE: ${what}: ${unsure.length} of them failed by their world at load ${run.load}, so they judged nothing; this is not a pass:\n  ${unsure.map(shown).join('\n  ')}`);
}

it('AC1 #2109.37a6aeb4 tests/acceptance/83/redraft-669/ holds the blind redraft of #83 AC11, with a README that has "The dispute" and a BASE-FAILURE.txt', async () => {
  expect(isFolder(REDRAFT), `${REDRAFT}/ is a folder of this checkout`).toBe(true);
  const readme = read(`${REDRAFT}/README.md`);
  expect(readme, `${REDRAFT}/README.md is there`).not.toBeNull();
  expect(readme, `${REDRAFT}/README.md has a section headed "The dispute"`).toMatch(/^#{1,6}[ \t]+The dispute\b/m);
  expect(read(`${REDRAFT}/BASE-FAILURE.txt`)?.trim() ?? '', `${REDRAFT}/BASE-FAILURE.txt is there and records something`).not.toBe('');
  const files = testFiles(REDRAFT);
  expect(files, `${REDRAFT}/ holds the redraft's test file`).not.toEqual([]);
  const run = await theRun();
  const gaps = missing(run.results.filter((r) => files.includes(r.file) && r.title.startsWith(`${AC11} `)));
  expect(gaps, `the redraft's tests, as vitest reports them from ${files.join(', ')}, are #83 AC11's, one for each golden and the wrong-program check:\n  ${gaps.join('\n  ')}\n\nThe run:\n  ${listing(run)}\n`).toEqual([]);
}, TEST_LIMIT);

it('AC2 #2109.875b4f4e on main with #1460, all six AC11 goldens of the redraft pass, and so does its wrong-program check', async () => {
  const files = testFiles(REDRAFT);
  expect(files, `${REDRAFT}/ holds the redraft's test file`).not.toEqual([]);
  const run = await theRun();
  const named = run.results.filter((r) => files.includes(r.file) && (GOLDENS.some((g) => r.title.startsWith(`${AC11} ${g}:`)) || r.title.startsWith(WRONG)));
  const { problems, unsure } = sorted(named);
  judge(`the redraft's six AC11 goldens and its wrong-program check, run on this checkout (${files.join(', ')})`, [...missing(named), ...problems], unsure, run);
}, TEST_LIMIT);

it('AC3 #2109.dcf2b9e6 the redraft replaces redraft-1460/goldens.test.ts, so no AC11 golden fails on main', async () => {
  const onMain = await ac11OnMain();
  const run = await theRun();
  const ac11 = run.results.filter((r) => onMain.includes(r.file) && r.title.startsWith(`${AC11} `));
  const { problems, unsure } = sorted(ac11);
  judge(`the AC11 tests main runs (${onMain.join(', ') || 'no file'})`, [
    ...(onMain.includes(REPLACED) ? [`${REPLACED} still runs on main: it is neither removed nor kept by hand (byHand in scripts/lanes.mjs)`] : []),
    ...missing(ac11.filter((r) => r.file.startsWith(`${REDRAFT}/`))).map((gap) => `among them, from ${REDRAFT}/: ${gap}`),
    ...problems,
  ], unsure, run);
}, TEST_LIMIT);
