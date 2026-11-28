// #1686: runs the repo's own test files, unchanged, in a child process from the live checkout, and gives back what
// the runner reported, for the tests here to judge with their own expects. A run that reports nothing throws BLOCKED.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));

export interface Ran { ran: number; notPassed: string[] }

// The child is a run of its own, not a worker of this vitest.
const env = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
const spawn = (args: string[]) => spawnSync(process.execPath, args, { cwd: REPO, env: env(), encoding: 'utf8', timeout: 900_000, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });

interface Assertion { fullName: string; status: string; failureMessages?: string[] }
interface FileResult { name: string; status: string; message?: string; assertionResults: Assertion[] }

/** Every test in `files` (vitest files, or folders of them), from one run of the repo's vitest with the root config. */
export function vitestRun(files: string[]): Ran {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1686-'));
  try {
    const out = join(dir, 'report.json');
    const result = spawn([join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=json', `--outputFile.json=${out}`, ...files]);
    if (!existsSync(out)) throw new Error(`BLOCKED: vitest wrote no report for ${files.join(', ')} (status ${result.status}, signal ${result.signal}): ${(result.stderr ?? '').slice(-2000)}`);
    const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: FileResult[] };
    // A file that failed outside its tests (its imports, a hook) counts as a failed test of its own.
    const tests = report.testResults.flatMap((file) => [...file.assertionResults.map((test) => ({ ...test, fullName: `${file.name.slice(REPO.length)} > ${test.fullName}` })),
      ...(file.status === 'failed' && !file.assertionResults.some((test) => test.status === 'failed') ? [{ fullName: `${file.name.slice(REPO.length)} (the file, outside its tests)`, status: 'failed', failureMessages: [file.message ?? ''] }] : [])]);
    return { ran: tests.length, notPassed: tests.filter((test) => test.status !== 'passed').map((test) => `${test.status}: ${test.fullName}${test.failureMessages?.[0] ? `\n${test.failureMessages[0].slice(0, 1500)}` : ''}`) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every test in a node:test file, from `node --test` on it, as the repo's unit lane runs it. */
export function nodeRun(file: string): Ran {
  const result = spawn(['--test', '--test-reporter=tap', file]);
  const count = (word: string): number => Number(new RegExp(`^# ${word} (\\d+)$`, 'm').exec(result.stdout ?? '')?.[1] ?? NaN);
  const [ran, passed] = [count('tests'), count('pass')];
  if (Number.isNaN(ran) || Number.isNaN(passed)) throw new Error(`BLOCKED: node --test reported no counts for ${file} (status ${result.status}, signal ${result.signal}): ${(result.stderr ?? '').slice(-2000)}`);
  return { ran, notPassed: ran === passed && result.status === 0 ? [] : [`${ran - passed} of ${ran} tests in ${file} did not pass (exit ${result.status}):\n${(result.stdout ?? '').slice(0, 4000)}`] };
}
