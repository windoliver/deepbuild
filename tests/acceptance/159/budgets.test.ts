// #159 AC18: budgets on the reference Mac in the local preflight, compared with the merge base. Starting a job adds
// under 300 ms beyond the agent's own start, parsing its output adds under 5% to its run time, the runner holds
// under 30 MB per running job, and the status line command adds under 1 ms per update with no network call.
// The merge-base comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json): tasks running
// `benchmarks/runner.mjs`, valid against the merge base's budgets. The numbers are judged here by the design's rule
// for timing (five runs after a warm-up; PASS when all are within the limit, FAIL when all are over it by more than
// the margin, otherwise INCONCLUSIVE) and count only on a reference Mac in a fit state; anywhere else they are
// skipped with the reason, never passed. The status line forwarder's behaviour is checked on any Mac.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT, NODE, REPO, cleanup, closeListeners, coveredVersions, environmentProblem, home, hubListener, install, judge, median, sub, tempDir, waitFor,
  type Line,
} from './helpers.ts';
import { claudeLimits, job, openWorld, room } from './world.ts';

afterEach(async () => { await closeListeners(); await cleanup(); }, 60_000);
const problem = environmentProblem();
const HOOK = join(REPO, 'target/debug/deep-hook');

/** The facts' launch for a read-only job, as the agent's own start: the same binary, flags and stdin, spawned bare. */
function bare(bin: string, prompt: string): Promise<number> {
  const facts = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { launch: { readOnlyJob: { args: string[] } } };
  const cwd = sub(tempDir(), 'bare');
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(bin, facts.launch.readOnlyJob.args, { cwd, env: { HOME: home(), PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'ignore'] });
    child.stdout.resume();
    child.on('error', reject);
    child.on('exit', () => resolve(performance.now() - t0));
    child.stdin.end(prompt);
  });
}
function deepHook(): string {
  if (!existsSync(HOOK)) {
    try {
      execFileSync('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, stdio: 'pipe', timeout: 600_000 });
    } catch (error) {
      throw Error(`BLOCKED: cargo couldn't build deep-hook: ${String((error as { stderr?: Buffer }).stderr ?? error)}`);
    }
  }
  return HOOK;
}
/** Claude Code's status line input for one update. */
const statusInput = (used: number): string => JSON.stringify({
  hook_event_name: 'Status', session_id: 'dh159-status', model: { id: 'claude-haiku-4-5', display_name: 'Haiku' }, workspace: { current_dir: home() },
  version: coveredVersions().at(-1), cost: { total_cost_usd: 0.01 }, rate_limits: claudeLimits(used, Date.now() + 3 * 3_600_000),
});
/** Points the status line forwarder at a stand-in hub socket, with your own status line command. */
function forwarderConfig(socket: string, yours: string): void {
  const dir = join(home(), '.deepbuild');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify({ hub: { address: `unix:${socket}` }, statusline: { yours } }, null, 2)}\n`);
}

describe('AC18 #159.3803772d budgets on the reference Mac, compared with the merge base', () => {
  it('AC18 the perf lane has the runner\'s tasks, a #159 first measurement, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const tasks = current.tasks.filter((t) => (t.command as string[]).includes('benchmarks/runner.mjs'));
    expect(tasks.length, 'budgets.json has a task running benchmarks/runner.mjs').toBeGreaterThan(0);
    for (const t of tasks) expect(String(t.initialReason), `${t.id as string} says why, naming issue #159`).toMatch(/#159/);
  });

  it('AC18 `node benchmarks/runner.mjs` runs and exits 0', () => {
    execFileSync(NODE, [join(REPO, 'benchmarks/runner.mjs')], { cwd: REPO, stdio: 'pipe', timeout: 300_000 });
  }, 300_000);

  it('AC18 the status line command sends the account\'s reading to the hub, then prints your own status line unchanged', async () => {
    const hook = deepHook();
    const socket = join(tempDir(), 'hub.sock');
    const hub = await hubListener(socket);
    forwarderConfig(socket, '/bin/echo yours');
    const run = spawnSync(hook, ['statusline'], { input: statusInput(42), encoding: 'utf8', env: { HOME: home(), PATH: '/usr/bin:/bin' }, timeout: 10_000 });
    expect(run.status, `deep-hook statusline: ${run.stderr}`).toBe(0);
    expect(run.stdout, 'your own status line, printed unchanged').toBe('yours\n');
    const line = await waitFor(() => hub.text().split('\n').map((l) => { try { return JSON.parse(l) as Line; } catch { return undefined; } })
      .find((m) => m?.method === 'windows.report'), 5000, 'a windows.report line at the hub\'s socket');
    expect(line.params, 'the reading, for the account Claude Code keeps beside its login').toMatchObject({ agent: 'claude-code', account: ACCOUNT });
    expect(line.params.rate_limits?.five_hour?.used_percentage, 'the 5-hour window, as the status line had it').toBe(42);
  }, 120_000);

  it('AC18 on the reference Mac: a job\'s start adds under 300 ms to the agent\'s own, parsing under 5% of its run time, under 30 MB per running job, and under 1 ms per status line update', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const bin = install(sub(tempDir(), 'bin'));
    const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin` });
    try {
      await room(w);
      // Start: a job that answers at once, through the runner, against the same launch spawned bare.
      const startOnce = async (): Promise<number> => {
        const a: number[] = [];
        const b: number[] = [];
        for (let i = 0; i < 5; i++) {
          const t0 = performance.now();
          const rec = await w.runner.run(job('read', 'Ok.'));
          if (rec.state !== 'finished') throw Error(`BLOCKED: the timed job didn't finish: ${JSON.stringify(rec)}`);
          a.push(performance.now() - t0);
          b.push(await bare(bin, 'Ok.'));
        }
        return median(a) - median(b);
      };
      await startOnce();
      const starts: number[] = [];
      for (let i = 0; i < 5; i++) starts.push(await startOnce());
      judge(ctx, 'AC18 start added per job (ms)', starts, 300);

      // Parsing: a chatty 8 s job, its added time beyond the start, as a share of its run time.
      const chatty = 'Talk.\n@chatter 4000 2';
      const parses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const t0 = performance.now();
        await w.runner.run(job('read', chatty));
        const through = performance.now() - t0;
        const own = await bare(bin, chatty);
        if (i > 0) parses.push(Math.max(0, through - own - median(starts)) / own);
      }
      judge(ctx, 'AC18 parsing added, as a share of run time', parses, 0.05);

      // Memory: five jobs running at once, the runner's process's resident memory per running job.
      const memory: number[] = [];
      for (let i = 0; i < 5; i++) {
        globalThis.gc?.();
        const before = process.memoryUsage().rss;
        const ids: string[] = await Promise.all([1, 2, 3, 4, 5].map(async (): Promise<string> => (await w.runner.submit(job('read', 'Wait.\n@sleep 4000'))).job));
        await waitFor(async () => (await Promise.all(ids.map((id: string) => w.runner.status(id)))).every((r: { state: string }) => r.state === 'running'), 20_000, 'five running jobs');
        const during = process.memoryUsage().rss;
        await Promise.all(ids.map((id: string) => w.runner.wait(id)));
        memory.push((during - before) / 5 / 2 ** 20);
      }
      judge(ctx, 'AC18 runner memory per running job (MB)', memory, 30);
    } finally {
      await w.close();
    }

    // The status line: deep-hook statusline then yours, against yours alone, per update; IP networking denied.
    const hook = deepHook();
    const socket = join(tempDir(), 'hub.sock');
    await hubListener(socket);
    forwarderConfig(socket, '/bin/echo yours');
    const noNetwork = '(version 1)(allow default)(deny network-outbound (remote ip))';
    const time = (argv: string[]): number => {
      const t0 = performance.now();
      const r = spawnSync(argv[0]!, argv.slice(1), { input: statusInput(42), env: { HOME: home(), PATH: '/usr/bin:/bin' } });
      if (r.status !== 0) throw Error(`${argv.join(' ')} exited ${r.status}: ${r.stderr}`);
      return performance.now() - t0;
    };
    const statusOnce = (): number => {
      const a: number[] = [];
      const b: number[] = [];
      for (let i = 0; i < 50; i++) {
        a.push(time(['/usr/bin/sandbox-exec', '-p', noNetwork, hook, 'statusline']));
        b.push(time(['/usr/bin/sandbox-exec', '-p', noNetwork, '/bin/echo', 'yours']));
      }
      return median(a) - median(b);
    };
    statusOnce();
    const updates: number[] = [];
    for (let i = 0; i < 5; i++) updates.push(statusOnce());
    judge(ctx, 'AC18 status line added per update (ms)', updates, 1);
  }, 900_000);
});

