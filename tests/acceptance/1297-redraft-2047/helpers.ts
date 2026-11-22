// Test-side tools for the blind redraft of #1297's AC2 and AC3: the criteria's IDs, the INCONCLUSIVE rule, the base's
// bytes of the files these criteria hold still, and a run of other suites' files through the checkout's own vitest.
// Nothing here stands in for the renderer: every picture and every verdict comes from the program under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

/** The checkout root (this folder is three levels down). */
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The first 8 hex characters of SHA-256 of each criterion's trimmed, whitespace-collapsed text (README). */
export const AC2 = 'AC2 #1297.b4935a37';
export const AC3 = 'AC3 #1297.a04bad6a';

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The GPU layer draws on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
/** No problems; the message lists them. */
export function none(problems: readonly string[], what: string): void {
  expect(problems, `${what}:\n  ${problems.join('\n  ')}`).toEqual([]);
}

/** Files whose bytes stay as the base ed28a8dce holds them, each with its SHA-256 there. */
export function unchanged(pins: Record<string, string>): string[] {
  return Object.entries(pins).flatMap(([path, want]) => {
    const file = join(REPO, path);
    if (!existsSync(file)) return [`${path} is gone; the base holds it (SHA-256 ${want})`];
    const got = sha256(readFileSync(file));
    return got === want ? [] : [`${path} changed: its SHA-256 is ${got}, the base's ${want}`];
  });
}

export interface Ran { file: string; name: string; status: string; message: string }
export interface SuiteRun { tests: Ran[]; fileErrors: string[]; missing: string[]; seconds: number }

/**
 * Runs `files` (paths from the checkout root) with the checkout's own vitest, one file at a time, as they are: their
 * own timeouts, their own builds. The run's environment is this one's without vitest's worker variables, so the inner
 * run is a run of its own. Each test's status and first failure line come from vitest's JSON report.
 */
export function runSuites(files: readonly string[]): SuiteRun {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1297-suites-'));
  try {
    const report = join(dir, 'report.json');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'DEEP_PROOF_VITEST_REPORT')) as NodeJS.ProcessEnv;
    const started = Date.now();
    const run = spawnSync(process.execPath, [join(REPO, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--no-file-parallelism', '--reporter=json', `--outputFile.json=${report}`, ...files], {
      cwd: REPO, env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 4 * 3_600_000, killSignal: 'SIGKILL',
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    const out = (run.stdout ?? '').slice(-2000); const err = (run.stderr ?? '').slice(-2000);
    expect(run.error === undefined || (run.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT', `vitest on ${files.join(', ')} finished within 4 hours`).toBe(true);
    expect(existsSync(report), `vitest on ${files.join(', ')} wrote its JSON report (exit ${run.status}); its output ends:\n${out}\n${err}`).toBe(true);
    const json = JSON.parse(readFileSync(report, 'utf8')) as { testResults?: { name: string; status: string; message?: string; assertionResults?: { ancestorTitles: string[]; title: string; status: string; failureMessages?: string[] }[] }[] };
    const tests: Ran[] = []; const fileErrors: string[] = []; const seen = new Set<string>();
    for (const f of json.testResults ?? []) {
      const file = relative(realpathSync(REPO), realpathSync(f.name));
      seen.add(file);
      const results = f.assertionResults ?? [];
      const why = (f.message ?? '').split('\n')[0];
      if (f.status === 'failed' && !results.some((t) => t.status === 'failed')) fileErrors.push(`${file} failed outside its tests: ${why}`);
      for (const t of results) tests.push({ file, name: [...t.ancestorTitles, t.title].join(' › '), status: t.status, message: (t.failureMessages?.[0] ?? '').split('\n').filter(Boolean).slice(0, 3).join(' / ') });
    }
    return { tests, fileErrors, missing: files.filter((f) => !seen.has(f)), seconds };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
