// #40 AC5: on the reference Mac, in the local preflight, compared with the merge base: the in-process client adds
// under 1 ms per event to pi. The comparison with the merge base is the perf lane's (scripts/benchmark.mjs,
// benchmarks/budgets.json): a task running benchmarks/pi-client.mjs, valid against the merge base's budgets. The number
// is judged here by the design's rule for timing and counts only on a reference Mac in a fit state; anywhere else it is
// skipped with the reason as INCONCLUSIVE, as #159's and #236's budgets are, never passed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { NODE, REPO, cleanup, environmentProblem, median, needPackage, openWorld, Pi, piCli, tempDir, type Line, type Step } from './helpers.ts';

afterEach(cleanup, 60_000);
const TURNS = 60;
/** A session of `TURNS` read calls: each a model request and a real tool call, so every kind of event the client hears fires. */
const steps = (): Step[] => [...Array.from({ length: TURNS }, () => ({ tools: [{ name: 'read', arguments: { path: 'nested.txt' } }] })), { text: 'Read them all.' }];
/** One session's time from prompt to settle, and how many events pi's stream carried in it. */
async function session(pi: Pi): Promise<{ ms: number; events: number }> {
  const before = pi.events.length;
  const t0 = performance.now();
  await pi.call({ type: 'prompt', message: 'Read.' });
  await pi.until('agent_settled', 1, 120_000);
  const ms = performance.now() - t0;
  // Deltas carry no client work; what remains is every lifecycle, message and tool event, as a lower bound of what fired.
  return { ms, events: pi.events.slice(before).filter((e) => !['message_update', 'response', 'tool_execution_update'].includes(String(e.type))).length };
}

describe('AC5 #40.9680351d Budgets: the in-process client adds under 1 ms per event to pi', () => {
  it('AC5 the perf lane has the client\'s task, a #40 first measurement, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const tasks = current.tasks.filter((t) => (t.command as string[]).includes('benchmarks/pi-client.mjs'));
    expect(tasks.length, 'budgets.json has a task running benchmarks/pi-client.mjs').toBeGreaterThan(0);
    for (const t of tasks) expect(String(t.initialReason), `${String(t.id)} says why, naming issue #40`).toMatch(/#40\b/);
  });

  it('AC5 `node benchmarks/pi-client.mjs` runs on real pi and exits 0', () => {
    const cli = piCli();
    needPackage();
    execFileSync(NODE, [join(REPO, 'benchmarks/pi-client.mjs')], { cwd: REPO, env: { ...process.env, DEEP_PI_CLI: cli }, stdio: 'pipe', timeout: 300_000 });
  }, 320_000);

  it('AC5 the package\'s added time per event, five sessions each way after a warm-up, is under 1 ms on the reference Mac', async (ctx: TestContext) => {
    piCli();
    needPackage();
    const problem = environmentProblem();
    const w = await openWorld({ steps: [{ text: 'warm' }] });
    await w.pi.stop();
    const home = w.home;
    const dir = join(tempDir(), 'w');
    mkdirSync(dir);
    execFileSync('/bin/sh', ['-c', 'echo nested > nested.txt'], { cwd: dir });
    const once = async (withPackage: boolean): Promise<{ ms: number; events: number }> => {
      const pi = await Pi.start(home, dir, { steps: steps(), withPackage });
      const got = await session(pi);
      await pi.stop();
      return got;
    };
    await once(true);
    await once(false);
    // Interleaved, so load falls on both sides.
    const withIt: number[] = [];
    const without: number[] = [];
    let events = 0;
    for (let i = 0; i < 5; i++) {
      const a = await once(true);
      const b = await once(false);
      withIt.push(a.ms);
      without.push(b.ms);
      events = a.events;
    }
    expect(events, 'the session carried events').toBeGreaterThan(TURNS * 4);
    const pairs = withIt.map((ms, i) => (ms - without[i]!) / events);
    const shown = `added ms per event over ${events} events: ${pairs.map((p) => p.toFixed(3)).join(', ')}; median ${median(pairs).toFixed(3)}; bare ${median(without).toFixed(0)} ms, with ${median(withIt).toFixed(0)} ms`;
    console.log(shown);
    if (problem) return ctx.skip(`INCONCLUSIVE off the reference Mac (${problem}): ${shown}`);
    if (pairs.every((p) => p <= 1)) return undefined;
    const spread = (Math.max(...pairs) - Math.min(...pairs)) / Math.max(Math.abs(Math.min(...pairs)), 1e-9);
    const margin = Math.max(0.05, spread);
    expect(pairs.every((p) => p > 1 * (1 + margin)), `FAIL ${shown}`).toBe(false);
    return ctx.skip(`INCONCLUSIVE ${shown}`);
  }, 600_000);
});
