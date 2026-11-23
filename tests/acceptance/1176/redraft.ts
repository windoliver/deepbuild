// What #1176 names: the #806 suite's folder, the redraft (commit 43d428e86, "part of #1176", the one commit of PR 1226's
// branch), and a vitest run of a folder's sessions.test.ts read back as values, test by test.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const SUITE = 'tests/acceptance/806';
/** The redraft, pinned: a grep for "#1176" would also find #11760 and any later commit naming the issue. */
export const REDRAFT = '43d428e8671e90d2c81b0964301fce1a80ed093b';
/** The files of the first draft the redraft changed and the sessions suite runs (REDRAFT.md is the fourth). */
export const STAND_IN = ['helpers.ts', 'figure.ts', 'sessions.test.ts'];

/** git in the repo, with no user diff settings in play; its output, or an error text as a value (never a throw). */
export function git(args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync('git', ['-C', REPO, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? '', err: `${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}
/** `git diff` with the plain format whatever the user's config says. */
export const diff = (args: string[]) => git(['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', ...args]);

/** A file's text at a commit, or undefined when it is not there. */
export function at(commit: string, path: string): string | undefined {
  const r = git(['show', `${commit}:${path}`]);
  return r.ok ? r.out : undefined;
}

// Inner runs, each its own process group, stopped with their group when this process ends, however it ends.
const running = new Set<ChildProcess>();
const stopAll = () => { for (const c of running) { try { process.kill(-c.pid!, 'SIGTERM'); } catch { /* gone */ } } };
let guarded = false;
/** Installed by the first inner run only, so a file that runs none keeps the default signal handling. */
function guard(): void {
  if (guarded) return;
  guarded = true;
  process.once('exit', stopAll);
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(signal, () => { stopAll(); dropBefore(); process.exit(128 + ({ SIGTERM: 15, SIGINT: 2, SIGHUP: 1 })[signal]); });
}

/** The first draft's folder for this process: a sibling of tests/acceptance/806, so its relative imports resolve as the suite's do. */
export const BEFORE = `tests/acceptance/1176-before-${process.pid}`;
export function dropBefore(): void { rmSync(join(REPO, BEFORE), { recursive: true, force: true }); }
/** Folders a run that was killed left behind: their process is gone. */
export function dropStale(): void {
  for (const name of readdirSync(join(REPO, 'tests/acceptance'))) {
    const pid = /^1176-before-(\d+)$/.exec(name)?.[1];
    if (!pid) continue;
    let alive = true;
    try { process.kill(Number(pid), 0); } catch { alive = false; }
    if (!alive || Number(pid) === process.pid) rmSync(join(REPO, 'tests/acceptance', name), { recursive: true, force: true });
  }
}

export interface TestResult { title: string; status: string; failure: string }
export interface SuiteRun { code: number | null; tests: TestResult[]; output: string; ms: number }

/** `vitest run --root <folder> --no-file-parallelism sessions.test.ts [-t pattern]` from the repo, its JSON report read back. */
export async function runSessions(folder: string, timeoutMs: number, pattern?: string): Promise<SuiteRun> {
  guard();
  const out = mkdtempSync(join(tmpdir(), 'acc1176-'));
  const report = join(out, 'report.json');
  const vitest = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');
  const args = [vitest, 'run', '--root', folder, '--no-file-parallelism', '--reporter=json', `--outputFile=${report}`, 'sessions.test.ts', ...(pattern ? ['-t', pattern] : [])];
  const t0 = Date.now();
  let output = '';
  const code = await new Promise<number | null>((done) => {
    const child = spawn(process.execPath, args, { cwd: REPO, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    running.add(child);
    const keep = (d: Buffer) => { output = (output + d.toString('utf8')).slice(-200_000); };
    child.stdout!.on('data', keep);
    child.stderr!.on('data', keep);
    const timer = setTimeout(() => { output += `\n[acceptance 1176: the run passed ${timeoutMs} ms; its group ${child.pid} stopped]`; try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* gone */ } }, timeoutMs);
    child.on('close', (c) => { clearTimeout(timer); running.delete(child); done(c); });
  });
  const tests: TestResult[] = [];
  if (existsSync(report)) {
    try {
      const json = JSON.parse(readFileSync(report, 'utf8')) as { testResults?: { assertionResults?: { title: string; status: string; failureMessages?: string[] }[] }[] };
      for (const file of json.testResults ?? []) for (const a of file.assertionResults ?? []) tests.push({ title: a.title, status: a.status, failure: (a.failureMessages ?? []).join('\n') });
    } catch { /* an unreadable report leaves no tests, which the assertions report */ }
  }
  rmSync(out, { recursive: true, force: true });
  return { code, tests, output, ms: Date.now() - t0 };
}

/** One line per test for an assertion's message. */
export const summary = (run: SuiteRun): string =>
  `${run.tests.map((t) => `${t.status}: ${t.title}${t.failure ? ` -- ${t.failure.split('\n')[0]!.slice(0, 300)}` : ''}`).join('\n')}\n(exit ${run.code}, ${Math.round(run.ms / 1000)} s; tail: ${run.output.slice(-1500)})`;
