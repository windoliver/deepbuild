// #2126 (blind acceptance, README): a child that exits before it reads its input fails its call and never takes the
// hub or an eval down. Each scenario runs in a Node process of its own (fixtures/scenario.mjs), which records every
// uncaught exception it sees and reports, on its last stdout line, how the call settled. The tests assert on that
// report, so an uncaught `write EPIPE` fails at an assertion here rather than ending a vitest worker.
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIO = join(HERE, 'fixtures', 'scenario.mjs');
const REAL_GIT = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
for (const file of ['standin/git', 'exits-at-once.sh']) chmodSync(join(HERE, 'fixtures', file), 0o755);

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

interface Report {
  scenario: string;
  settled: { resolved?: true; value?: unknown; rejected?: true; name?: string; message?: string };
  uncaught: string[];
  pathListBytes?: number; marked?: boolean; stoppedAt?: string | null; inputBytes?: number; promptBytes?: number;
}
/** Runs one scenario in its own process and reads its report line; `code` is the process's exit code. */
function run(name: 'gate' | 'probe' | 'cli'): Promise<{ code: number | null; signal: string | null; report: Report | undefined; stderr: string }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh2126-')));
  dirs.push(dir);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('GIT_') && !k.startsWith('DEEP_') && !k.startsWith('CLAUDE')) env[k] = v;
  Object.assign(env, { HOME: dir, DH2126_DIR: dir, STANDIN_REAL_GIT: REAL_GIT });
  return new Promise((resolve) => {
    // The spawn's own timeout only turns a hang into a failed assertion below.
    const child = spawn(process.execPath, [SCENARIO, name], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000, killSignal: 'SIGKILL' });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-8000); });
    child.on('close', (code, signal) => {
      const line = out.trim().split('\n').at(-1) ?? '';
      let report: Report | undefined;
      try { report = JSON.parse(line) as Report; } catch { report = undefined; }
      resolve({ code, signal, report, stderr: err });
    });
  });
}

describe('#2126 a child that exits before it reads its input', () => {
  test('#2126.67cc88df A git stopped before it reads its input fails its call and never takes the hub down', async () => {
    const r = await run('gate');
    expect(r.report, r.stderr).toBeDefined();
    const report = r.report!;
    // The scenario happened: the path list for git's stdin is over 1 MiB, and git stopped at the call that takes it.
    expect(report.pathListBytes).toBeGreaterThanOrEqual(1 << 20);
    expect(report.marked).toBe(true);
    expect(report.stoppedAt).toMatch(/ --stdin$/);
    // The hub's process sees no uncaught exception (today: `EPIPE write EPIPE`).
    expect(report.uncaught).toEqual([]);
    // The call rejects as over budget.
    expect(report.settled.rejected).toBe(true);
    expect(report.settled.name).toBe('OverBudget');
    expect(report.settled.message).toMatch(/over budget/);
    expect(r.code).toBe(0);
  }, 600_000);

  test('#2126.74588985 A probe that exits before it reads its input reads as a failed check, never an uncaught error in the hub', async () => {
    const r = await run('probe');
    expect(r.report, r.stderr).toBeDefined();
    const report = r.report!;
    expect(report.inputBytes).toBeGreaterThanOrEqual(2_000_000);
    // No uncaught error in the process that ran the check (today: `EPIPE write EPIPE`).
    expect(report.uncaught).toEqual([]);
    // runProbe resolves, with outcome failed.
    expect(report.settled.resolved).toBe(true);
    expect((report.settled.value as { outcome?: string } | undefined)?.outcome).toBe('failed');
    expect(r.code).toBe(0);
  }, 600_000);

  test('#2126.1680fcd2 A judge or agent CLI that exits before reading its prompt ends as a failed call, never a crashed eval', async () => {
    const r = await run('cli');
    expect(r.report, r.stderr).toBeDefined();
    const report = r.report!;
    expect(report.promptBytes).toBeGreaterThanOrEqual(300_000);
    // The eval's process sees no uncaught error (today: `EPIPE write EPIPE`).
    expect(report.uncaught).toEqual([]);
    // runCli resolves with no lines.
    expect(report.settled.resolved).toBe(true);
    expect(report.settled.value).toEqual([]);
    expect(r.code).toBe(0);
  }, 600_000);
});
