// Test-side tools for the #3108 acceptance tests. Criterion 1 runs one named AC3 test of tests/acceptance/1720 as it
// stands, in a child Vitest from this checkout's root with the root config (as the unit lane runs it), and reads the
// child's JSON report. Nothing here stands in for the hub, `deep mcp`, `deep doctor` or the #1720 suite; the #1720
// helpers are imported so the proof lanes follow this suite's imports to the binaries #1720's files run.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO } from '../1720/helpers.ts';

export { REPO };
export const MINUTE = 60_000;
const VITEST = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');

interface Assertion { title: string; fullName?: string; status: string; failureMessages?: string[] }
interface FileResult { name: string; status: string; message?: string; assertionResults: Assertion[] }

/** A home folder written as `~`, so no output this suite keeps names one. */
const tilde = (text: string): string => text.replaceAll(homedir(), '~');
const tail = (text: string, lines = 20): string => tilde(text.trimEnd().split('\n').slice(-lines).join('\n'));
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Runs `file` (relative to the checkout) in a child Vitest filtered to the one test named `title`, and returns what
 * keeps that test from counting as passed: the child wrote no report, the file or the test didn't run, the test was
 * skipped or failed (with its failure message), or the child exited other than 0. An empty list means it ran and passed.
 */
export async function namedTestFailures(file: string, title: string, limitMs: number): Promise<string[]> {
  if (!existsSync(VITEST)) return [`node_modules/vitest is not installed in this checkout (npm ci)`];
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'dh3108-')));
  try {
    const report = join(out, 'report.json');
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('VITEST')) env[key] = value;
    const args = [VITEST, 'run', '--no-file-parallelism', '--reporter=json', `--outputFile=${report}`, '--testNamePattern', escape(title), file];
    // The child's own `timeout` option ends a run that hangs past the file's limit (SIGKILL), so a hang reads as a
    // failure below rather than this file's timeout; it never waits for time to pass.
    const child = await new Promise<{ code: number | null; signal: string | null; text: string }>((resolve) => {
      const p = spawn(process.execPath, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: limitMs, killSignal: 'SIGKILL' });
      let text = '';
      p.stdout.setEncoding('utf8').on('data', (d: string) => (text += d));
      p.stderr.setEncoding('utf8').on('data', (d: string) => (text += d));
      p.on('close', (code, signal) => resolve({ code, signal, text }));
      p.on('error', (error) => resolve({ code: null, signal: null, text: `${text}\n${error.message}` }));
    });
    const ended = child.code ?? child.signal;
    if (!existsSync(report)) return [`${file}: the child Vitest wrote no report (exit ${ended}; it said:\n${tail(child.text)})`];
    const results = (JSON.parse(readFileSync(report, 'utf8')) as { testResults: FileResult[] }).testResults;
    const r = results.find((x) => x.name.endsWith(`/${file}`));
    if (!r) return [`${file}: didn't run (exit ${ended})`];
    const named = r.assertionResults.filter((a) => a.title === title);
    const failures: string[] = [];
    if (!named.length) failures.push(`${file}: no test "${title}" ran (${r.status}${r.message ? `: ${tilde(r.message).slice(0, 800)}` : ''})`);
    for (const a of named) {
      if (a.status !== 'passed') failures.push(`${file}: "${a.fullName ?? a.title}" ${a.status}${a.failureMessages?.length ? `: ${tilde(a.failureMessages.join('\n')).slice(0, 1500)}` : ''}`);
    }
    if (child.code !== 0) failures.push(`${file}: the child Vitest exited ${ended}, not 0; it said:\n${tail(child.text)}`);
    return failures;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
