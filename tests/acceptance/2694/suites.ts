// The suites clause of #2694.b3f057c6 ("`tests/acceptance/806/` and `tests/acceptance/393/` pass unchanged"), for
// ac5-393.test.ts and ac5-806.test.ts (README: The suites clause): a folder run as it is, by this checkout's Vitest
// under the root's config, as the lanes run it: its files one at a time, without the files scripts/lanes.mjs keeps for
// a run by hand, and with main's known failures (scripts/known-failures.json) set apart, as scripts/affected.mjs sets
// them apart. Every other test of every file must pass; a failed, skipped or missing one fails, named.
import { spawnSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll } from 'vitest';
import { REPO, TIMEOUT, brief, must, tempDir } from './helpers.ts';

interface Report { testResults?: { name: string; status: string; message?: string; assertionResults?: { ancestorTitles?: string[]; title: string; status: string; failureMessages?: string[] }[] }[] }

/**
 * Builds what a folder's run needs, as the folder builds it, before its test, so the folder's own run finds it fresh:
 * the canvas core both build themselves, the hub's deep-hook, without which #806's hub doesn't start, and on macOS the
 * app's replica #806 builds. A build that fails makes the test BLOCKED.
 */
export function useSuiteBuilds(): () => void {
  let failed = '';
  beforeAll(() => {
    const builds = [['build', '--locked', '--bin', 'deep-show'], ['build', '--locked', '--bin', 'deep-hook'], ...(process.platform === 'darwin' ? [['build', '--locked', '--bin', 'deep-replica-canvas']] : [])];
    for (const args of builds) {
      const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (run.error || run.status !== 0) { failed = `cargo ${args.join(' ')} failed: ${run.error?.message ?? run.stderr.slice(-3000)}`; return; }
    }
  }, 3_600_000);
  return () => { if (failed) throw Error(`BLOCKED: ${failed}`); };
}

/** The folder's test files as the lanes take them. */
async function lanesFiles(folder: string): Promise<string[]> {
  const { byHand } = (await import(pathToFileURL(join(REPO, 'scripts', 'lanes.mjs')).href)) as { byHand: string[] };
  const kept = (file: string): boolean => !byHand.some((path) => (path.endsWith('/') ? file.startsWith(path) : file === path));
  return globSync(`${folder}**/*.test.ts`, { cwd: REPO }).filter((p) => !p.includes('node_modules')).sort().filter(kept);
}

/** main's known failures, by their key: `<file> › <describe> › <test>`. */
function knownFailures(): Set<string> {
  const file = join(REPO, 'scripts', 'known-failures.json');
  if (!existsSync(file)) return new Set();
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { failures?: Record<string, string> };
  return new Set(Object.keys(parsed.failures ?? {}));
}

/** Runs the folder and fails, naming each of its tests that didn't pass and isn't one of main's known failures. */
export async function folderPasses(folder: string): Promise<void> {
  const files = await lanesFiles(folder);
  must(files.length > 0, `${folder} holds no test file the lanes run`);
  const vitest = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');
  if (!existsSync(vitest)) throw Error(`BLOCKED: no Vitest at ${vitest}; run npm ci`);
  const report = join(tempDir('suite'), 'report.json');
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^VITEST|^TEST$|^NODE_TEST_CONTEXT$/.test(k)) env[k] = v;
  const limit = TIMEOUT - 60_000;
  const run = spawnSync(process.execPath, [vitest, 'run', ...files, '--no-file-parallelism', '--testTimeout=600000', '--reporter=json', `--outputFile=${report}`], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: limit, killSignal: 'SIGKILL' });
  if ((run.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') throw Error(`INCONCLUSIVE: ${folder} didn't finish within ${limit / 60_000} minutes`);
  if (run.error) throw Error(`BLOCKED: Vitest couldn't run ${folder}: ${run.error.message}`);
  if (!existsSync(report)) throw Error(`BLOCKED: Vitest wrote no report for ${folder} (exit ${String(run.status)}): ${run.stderr.slice(-2000)}`);
  const parsed = JSON.parse(readFileSync(report, 'utf8')) as Report;
  const onMain = knownFailures();
  const failed: string[] = [];
  const known: string[] = [];
  const ran = new Set<string>();
  for (const file of parsed.testResults ?? []) {
    const name = file.name.startsWith(REPO) ? file.name.slice(REPO.length + 1) : file.name;
    ran.add(name);
    const tests = file.assertionResults ?? [];
    if (!tests.length) failed.push(`${name}: no test ran (${file.status}): ${brief(file.message ?? '', 600)}`);
    for (const t of tests) {
      if (t.status === 'passed') continue;
      const key = [name, ...(t.ancestorTitles ?? []), t.title].join(' › ');
      // Each failure's first line: its stack would read as this file's own.
      const why = (t.failureMessages ?? []).map((m) => m.split('\n')[0]).join(' | ').slice(0, 600);
      (onMain.has(key) ? known : failed).push(`${key}: ${t.status}${why ? `: ${why}` : ''}`);
    }
  }
  for (const file of files) if (!ran.has(file)) failed.push(`${file}: not in Vitest's report`);
  if (known.length) console.warn(`${folder}: main's known failures, set apart:\n  ${known.join('\n  ')}`);
  must(failed.length === 0, `${folder} doesn't pass: ${failed.length} of its tests didn't:\n  ${failed.join('\n  ')}`);
}
