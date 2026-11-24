// Shared by #3300's acceptance tests. They reach the change only through what the README names: scripts/lanes.mjs's
// lists (`redrafted`, `byHand`, `timed`), vitest run on a suite's file by test name with its JSON report, `node
// benchmarks/canvas.mjs judge` on a reading the redrafted helpers make up, and `node scripts/loads-lint.mjs [--root
// <checkout>]`, which prints one `FAIL loads: <path>:<line>: ...` line per finding or one `PASS loads` line.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished } from 'vitest';

/** The checkout root (tests/acceptance/3300 is three levels down). */
export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const SUITE = join(REPO, 'tests/acceptance/3300');

/** Each criterion's tag: `#3300.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs `criterionId`). */
export const AC1 = '#3300.a6ff96a8';
export const AC2 = '#3300.b2574093';
export const AC3 = '#3300.6776e60e';
export const AC4 = '#3300.06b864b2';

/** What the lane's judge says of a run whose load it can't read (scripts/benchmark.mjs judgeLimit), as the issue quotes it. */
export const CANT_READ = "the load at each run's start and end can't be read";

export const show = (result: SpawnSyncReturns<string>): string =>
  `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}${result.error ? ` (${result.error.message})` : ''}\nstdout:\n${result.stdout?.slice(-4000)}\nstderr:\n${result.stderr?.slice(-4000)}`;

/** A scratch folder, removed when the test ends. */
export function scratch(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3300-')));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** scripts/lanes.mjs's lists (scripts/lanes-lists.mjs, re-exported there): the files run by hand only, timed, and the redrafts. */
export interface Lanes { redrafted: Record<string, string>; byHand: string[]; timed: string[] }
export const lanes = async (): Promise<Lanes> => (await import(join(REPO, 'scripts/lanes.mjs'))) as Lanes;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------------------------------
// vitest on one file, as a child, by test name.

export interface Result { fullName: string; title: string; status: string; failureMessages: string[] }

/**
 * `vitest run --root <file's folder> <file> -t <name>` with the JSON reporter, every file in a sub-folder excluded:
 * every test of the file, by its full name, those whose name holds `name` run and the rest skipped. vitest takes a file
 * filter as a part of a path, so the exclude keeps a same-named file in a sub-folder, such as the redraft's, out. A
 * file that can't be collected has no tests.
 */
export function vitestRun(file: string, name: string): { results: Result[]; output: string } {
  const path = join(REPO, file);
  const out = join(scratch(), 'report.json');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
  const result = spawnSync(process.execPath, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', join(path, '..'), path, '--exclude', '*/**', '-t', escape(name), '--reporter=json', `--outputFile=${out}`],
    { cwd: REPO, encoding: 'utf8', env: { ...env, NO_COLOR: '1' }, timeout: 600_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
  let results: Result[] = [];
  try {
    const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: { assertionResults: Result[] }[] };
    results = report.testResults.flatMap((t) => t.assertionResults);
  } catch { /* no report: no results */ }
  return { results, output: show(result) };
}

// ---------------------------------------------------------------------------------------------------
// The loads lint.

/** `node scripts/loads-lint.mjs [--root <at>]`: each FAIL line as `<path>:<line>` (whole, in any other form), and how many PASS lines. */
export function lint(at?: string): { status: number | null; fails: string[]; passes: number; output: string } {
  const result = spawnSync(process.execPath, [join(REPO, 'scripts/loads-lint.mjs'), ...(at ? ['--root', at] : [])], { cwd: REPO, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  const lines = (result.stdout ?? '').split('\n').map((line) => line.trimEnd());
  const fails = lines.filter((line) => line.startsWith('FAIL')).map((line) => /^FAIL loads: (.+?:\d+):/.exec(line)?.[1] ?? line);
  return { status: result.status, fails, passes: lines.filter((line) => line === 'PASS loads').length, output: show(result) };
}

/**
 * Lays fixtures/<name>.txt into the scratch checkout `at` as `<to>/<name>`; `<to>/<name>:<line>` for each line marked
 * `// finding`.
 */
export function plant(at: string, name: string, to: string): string[] {
  const text = readFileSync(join(SUITE, 'fixtures', `${name}.txt`), 'utf8');
  mkdirSync(join(at, to), { recursive: true });
  writeFileSync(join(at, to, name), text);
  return text.split('\n').flatMap((line, index) => (line.trimEnd().endsWith('// finding') ? [`${to}/${name}:${index + 1}`] : []));
}

/** Copies this checkout's `folder` into the scratch checkout `at` at the same path, leaving out the sub-folders named in `without`. */
export function copyFolder(at: string, folder: string, without: readonly string[]): void {
  cpSync(join(REPO, folder), join(at, folder), { recursive: true, filter: (source) => !without.some((name) => source === join(REPO, folder, name) || source.startsWith(join(REPO, folder, name) + '/')) });
}
