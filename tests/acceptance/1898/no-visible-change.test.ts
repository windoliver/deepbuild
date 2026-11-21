// #1898 AC3: no visible change. The suites that cover the sites the issue names, unchanged from the merge base, pass
// in a run of the repo's own vitest, with every suite in a covered package that names a module the change touched;
// and each package the issue names, or the change touches, type-checks with its own tsconfig. The merge base is
// `git merge-base HEAD origin/main`; the touched files are the diff from it, committed and not, outside this folder.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, it } from 'vitest';
import { REPO } from './walk.ts';

const blocked = (why: string): never => { throw new Error(`BLOCKED: ${why}`); };
const git = (...args: string[]) => spawnSync('/usr/bin/git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });

/**
 * The suites that cover the issue's sites: the lease and entry loads, `deep kinds`, the disk floor. Not
 * packages/hub/test/startup-memory.test.ts: its first test fails at this job's base for a reason outside #1898 (the
 * hub's main thread loads the record's index), and hub-start.test.ts reads the start's kit loads itself.
 */
const COVERING = [
  'packages/cli/test/loads.test.ts',
  'packages/cli/test/kinds.test.ts',
  'packages/hub/test/products-restart-reclaim-2122.test.ts',
];
/** The packages the issue's sites live in: the CLI, the hub, the check kits and conformance. */
const NAMED = ['cli', 'hub', 'conformance', 'checks-command', 'checks-numbers', 'checks-review', 'checks-work'];

function mergeBase(): string {
  const base = git('merge-base', 'HEAD', 'origin/main');
  return base.status === 0 ? base.stdout.trim() : blocked(`no merge base with origin/main: ${base.stderr.trim()}`);
}

/** Files that differ from the merge base, committed or not, untracked included, outside this suite's folder. */
function touched(base: string): string[] {
  const diff = git('diff', '--name-only', base);
  const untracked = git('ls-files', '--others', '--exclude-standard');
  if (diff.status !== 0 || untracked.status !== 0) blocked(`git can't list the change: ${diff.stderr}${untracked.stderr}`);
  return [...new Set([...diff.stdout.split('\n'), ...untracked.stdout.split('\n')].filter((f) => f && !f.startsWith('tests/acceptance/1898/')))];
}

/** For each touched packages/<p>/src module, the suites in packages/<p>/test that name it (`<stem>.js` or `<stem>.ts`). */
function suitesNaming(files: string[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    const m = file.match(/^packages\/([^/]+)\/src\/(.+)\.ts$/);
    if (!m) continue;
    const dir = join(REPO, 'packages', m[1]!, 'test');
    if (!existsSync(dir)) continue;
    const stem = basename(m[2]!);
    for (const name of readdirSync(dir, { recursive: true }) as string[])
      if (/\.test\.ts$/.test(name) && new RegExp(`[/'"]${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(js|ts)['"]`).test(readFileSync(join(dir, name), 'utf8')))
        out.push(`packages/${m[1]}/test/${name}`);
  }
  return out;
}

interface Assertion { fullName: string; status: string; failureMessages?: string[] }
interface FileResult { name: string; status: string; message?: string; assertionResults: Assertion[] }

/** Every test in `files`, by file, from one run of the repo's vitest; BLOCKED when it wrote no report. */
function vitest(files: string[]): Map<string, Assertion[]> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1898-'));
  try {
    const out = join(dir, 'report.json');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
    const result = spawnSync(process.execPath, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=json', `--outputFile.json=${out}`, ...files],
      { cwd: REPO, env, encoding: 'utf8', timeout: 1_500_000, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
    if (!existsSync(out)) blocked(`vitest wrote no report for ${files.join(', ')} (status ${result.status}, signal ${result.signal}): ${(result.stderr ?? '').slice(-2000)}`);
    const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: FileResult[] };
    const byFile = new Map<string, Assertion[]>(files.map((file) => [file, []]));
    for (const file of report.testResults) {
      const path = files.find((f) => file.name.endsWith(f));
      if (!path) continue;
      byFile.get(path)!.push(...file.assertionResults, ...(file.status === 'failed' && !file.assertionResults.some((a) => a.status === 'failed') ? [{ fullName: '(the file, outside its tests)', status: 'failed', failureMessages: [file.message ?? ''] }] : []));
    }
    return byFile;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const notPassed = (tests: Assertion[]): string[] => tests.filter((t) => t.status !== 'passed')
  .map((t) => `${t.status}: ${t.fullName}${t.failureMessages?.[0] ? `\n${t.failureMessages[0].slice(0, 1500)}` : ''}`);

it('#1898.6f3b1f79 the suites that cover the lease path, the hub\'s start and the kits, unchanged from the merge base, pass, and so does every suite naming a module the change touched', () => {
  const base = mergeBase();
  const changed = touched(base);
  for (const suite of COVERING) {
    expect(existsSync(join(REPO, suite)), `${suite} exists`).toBe(true);
    expect(changed.includes(suite), `${suite} is unchanged from the merge base ${base.slice(0, 9)}`).toBe(false);
  }
  const suites = [...new Set([...COVERING, ...suitesNaming(changed)])];
  const tests = vitest(suites);
  for (const suite of suites) {
    expect(tests.get(suite)!.length, `${suite} ran a test`).toBeGreaterThan(0);
    expect(notPassed(tests.get(suite)!), `${suite}'s tests that didn't pass`).toEqual([]);
  }
}, 1_600_000);

it('#1898.6f3b1f79 each package the issue names, and each the change touches, type-checks with its own tsconfig', () => {
  const changed = touched(mergeBase());
  const packages = [...new Set([...NAMED, ...changed.map((f) => f.match(/^packages\/([^/]+)\//)?.[1]).filter((p): p is string => !!p && existsSync(join(REPO, 'packages', p, 'tsconfig.json')))])];
  const failed: string[] = [];
  for (const p of packages) {
    const r = spawnSync(process.execPath, [join(REPO, 'node_modules/typescript/bin/tsc'), '-p', join('packages', p, 'tsconfig.json'), '--noEmit'],
      { cwd: REPO, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL', maxBuffer: 1 << 26 });
    if (r.status === null) blocked(`tsc on packages/${p} didn't finish (signal ${r.signal})`);
    if (r.status !== 0) failed.push(`packages/${p} (exit ${r.status}):\n${(r.stdout + r.stderr).slice(0, 3000)}`);
  }
  expect(failed, `packages whose type-check failed, of ${packages.join(', ')}`).toEqual([]);
}, 1_600_000);
