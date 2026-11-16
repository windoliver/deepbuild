// Shared by #1830's acceptance tests. They reach the change only through what the README names:
// `node scripts/loads-lint.mjs [--root <checkout>]`, scripts/lanes.mjs's `redrafted`, `byHand`, `listed` and `checks`,
// scripts/benchmark.mjs's `judgeLimit` and `fingerprint`, and the redraft folders under tests/acceptance/.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, onTestFinished } from 'vitest';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const twins = join(root, 'tests/acceptance/1830/twins');
export const benchmarkUrl = pathToFileURL(join(root, 'scripts/benchmark.mjs')).href;
const lintScript = join(root, 'scripts/loads-lint.mjs');

/** The suites #1830's Scope names, plus #268 and #968, each with its original files and its blind redraft's folder. */
export const SCOPE: ReadonlyArray<{ suite: string; original: string; redraft: string }> = [
  ...['103', '124', '148', '149', '166', '262'].map(whole),
  { suite: '311/redraft-ac12', original: 'tests/acceptance/311/redraft-ac12/', redraft: 'tests/acceptance/311-redraft-1830/' },
  ...['365', '417', '465'].map(whole),
  { suite: '568/judge.test.mjs', original: 'tests/acceptance/568/judge.test.mjs', redraft: 'tests/acceptance/568-redraft-1830/' },
  whole('761'),
  { suite: '1018/redraft-ac6', original: 'tests/acceptance/1018/redraft-ac6/', redraft: 'tests/acceptance/1018-redraft-1830/' },
  ...['1098', '1425', '1427', '268', '968'].map(whole),
];
function whole(suite: string) {
  return { suite, original: `tests/acceptance/${suite}/`, redraft: `tests/acceptance/${suite}-redraft-1830/` };
}

export const show = (result: SpawnSyncReturns<string>): string =>
  `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}${result.error ? ` (${result.error.message})` : ''}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;

/** scripts/lanes.mjs as the checkout has it. */
export const lanes = async (): Promise<any> => import(pathToFileURL(join(root, 'scripts/lanes.mjs')).href);

/** A scratch folder, removed when the test ends. */
export function scratch(prefix = 'deep-1830-'): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** A scratch checkout for the lint's --root: a copy of this checkout's scripts/ and an empty tests/acceptance/. */
export function checkout(): string {
  const directory = scratch();
  cpSync(join(root, 'scripts'), join(directory, 'scripts'), { recursive: true });
  mkdirSync(join(directory, 'tests/acceptance'), { recursive: true });
  return directory;
}

const SCRIPT = /\.(?:ts|mts|js|mjs)$/;
export const TEST_FILE = /\.test\.(?:ts|mts|js|mjs)$/;

/** The script files at `path` in this checkout (a file, or a folder ending in /), repo-relative. */
export function scriptFiles(path: string): string[] {
  const full = join(root, path);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [path];
  const walk = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
    const entry = join(directory, name);
    if (statSync(entry).isDirectory()) return name === 'node_modules' || name === 'target' ? [] : walk(entry);
    return SCRIPT.test(name) ? [relative(root, entry)] : [];
  });
  return walk(full);
}

/** Copies the script files at `path` into the scratch checkout `to`, each at the same repo-relative path. */
export function copyScripts(path: string, to: string): string[] {
  const files = scriptFiles(path);
  for (const file of files) {
    mkdirSync(dirname(join(to, file)), { recursive: true });
    copyFileSync(join(root, file), join(to, file));
  }
  return files;
}

export interface Lint {
  result: SpawnSyncReturns<string>;
  /** Each FAIL line as `<path>:<line>`. */
  fails: string[];
  /** How many `PASS loads` lines it printed. */
  passes: number;
  output: string;
}

/** Runs `node scripts/loads-lint.mjs`, with `--root <at>` when `at` is given. */
export function lint(at?: string): Lint {
  expect(existsSync(lintScript), 'scripts/loads-lint.mjs is missing: no lint over tests/acceptance finds a judgeLimit call that gives no loads').toBe(true);
  const result = spawnSync(process.execPath, [lintScript, ...(at === undefined ? [] : ['--root', at])], { cwd: root, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  const output = show(result);
  const lines = result.stdout.split('\n').map((line) => line.trimEnd());
  const fails = lines.filter((line) => line.startsWith('FAIL')).map((line) => {
    const match = /^FAIL loads: (.+:\d+): judgeLimit gives no loads$/.exec(line);
    expect(match, `a FAIL line not in the form "FAIL loads: <path>:<line>: judgeLimit gives no loads": ${line}\n${output}`).not.toBeNull();
    return match![1]!;
  });
  return { result, fails, passes: lines.filter((line) => line === 'PASS loads').length, output };
}
