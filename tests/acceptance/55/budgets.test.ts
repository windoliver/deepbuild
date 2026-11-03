// #55 AC11: on the reference Mac in the local preflight, compared with the merge base, the plugin adds under 10 ms at
// p95 per gated event. The comparison with the merge base is the perf lane's (scripts/benchmark.mjs,
// benchmarks/budgets.json): a task running benchmarks/paseo-plugin.mjs, valid against the merge base's budgets, as
// #40's client budget is. Here the number is the time the plugin's handlers hold each gated event (a turn's end of a
// session it gates, and a permission request a saved decision answers), measured where paseo calls them; the merge
// base has no plugin, so all of it is added. It counts only on a reference Mac in a fit state with the load under the
// core count; anywhere else it prints the readings and reads INCONCLUSIVE, never PASS or FAIL.
// First: what you gave the suite by hand, before ../29's helpers delete it (README, Disputes D1).
import { given } from './env.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { NODE, startHub } from '../27/helpers.ts';
import { environmentProblem } from '../40/helpers.ts';
import {
  AC, ASK_SETTINGS, Host, REPO, answer, asksNaming, cleanup, create, editConfig, events, fakeAgent, loadReading, loaded, makeHome, needPlugin, percentile, permissionAsked, permissionOf,
  specRepo, turnEnds, turnStarts, waitFor, type Line,
} from './helpers.ts';

afterEach(cleanup, 120_000);
const ROUNDS = 40;
const LIMIT_MS = 10;

describe(`${AC[11]} Budgets: under 10 ms at p95 added per gated event, against the merge base, on the reference Mac`, () => {
  it(`${AC[11]} the perf lane has the plugin's task, a #55 first measurement, valid against the merge base's budgets`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const tasks = current.tasks.filter((t) => (t.command as string[]).includes('benchmarks/paseo-plugin.mjs'));
    expect(tasks.length, `${AC[11]} budgets.json has a task running benchmarks/paseo-plugin.mjs`).toBeGreaterThan(0);
    for (const t of tasks) expect(String(t.initialReason), `${AC[11]} ${String(t.id)} says why, naming issue #55`).toMatch(/#55\b/);
  });

  it(`${AC[11]} \`node benchmarks/paseo-plugin.mjs\` runs and exits 0`, () => {
    needPlugin();
    execFileSync(NODE, [join(REPO, 'benchmarks/paseo-plugin.mjs')], { cwd: REPO, env: { ...process.env, ...given }, stdio: 'pipe', timeout: 600_000 });
  }, 620_000);

  it(`${AC[11]} each gated event, ${ROUNDS} turn ends and ${ROUNDS} decided permission requests of a Copilot session, is held under ${LIMIT_MS} ms at p95`, async (ctx: TestContext) => {
    needPlugin();
    const problem = environmentProblem();
    const { home } = makeHome();
    editConfig(home, (c) => { c.asks = ASK_SETTINGS; });
    const repo = specRepo(home);
    await startHub(home);
    const host = await Host.start(home);
    const f = fakeAgent('copilot', repo.dir);
    await create(host, f);
    // Your one decision, so every later request is answered from it.
    await turnStarts(host, f, 't0', 'Run the tests.');
    await host.settled(await permissionAsked(host, f, permissionOf(f, { kind: 'tool', name: 'Bash', title: 'Run npm test', input: { command: 'npm test' } })));
    const ask = await waitFor(async () => asksNaming(await events(home), 'npm test')[0], 30_000, 'the npm test ask').catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
    await answer(home, `ask:${ask.id}`, String((ask.data.options as Line[])[0]!.id));
    await host.settled(await turnEnds(host, f, 't0'));
    const turns: number[] = [];
    const permissions: number[] = [];
    for (let i = 1; i <= ROUNDS + 3; i++) {
      await turnStarts(host, f, `t${i}`, `Run the tests again (${i}).`);
      const p = await host.settled(await permissionAsked(host, f, permissionOf(f, { kind: 'tool', name: 'Bash', title: 'Run npm test', input: { command: 'npm test' } })));
      const t = await host.settled(await turnEnds(host, f, `t${i}`));
      // The first rounds warm the plugin and the hub up.
      if (i <= 3) continue;
      permissions.push(Math.max(0, ...(p.ms as number[])));
      turns.push(Math.max(0, ...(t.ms as number[])));
    }
    const all = [...turns, ...permissions];
    const shown = `p95 per gated event ${percentile(all, 95).toFixed(2)} ms (turn ends ${percentile(turns, 95).toFixed(2)}, permission requests ${percentile(permissions, 95).toFixed(2)}), median ${percentile(all, 50).toFixed(2)} ms over ${all.length}; ${loadReading()}`;
    console.log(shown);
    if (problem) return ctx.skip(`INCONCLUSIVE off the reference Mac (${problem}): ${shown}`);
    if (percentile(all, 95) < LIMIT_MS) return undefined;
    if (loaded()) return ctx.skip(`INCONCLUSIVE under load: ${shown}`);
    expect(percentile(all, 95), `${AC[11]} FAIL ${shown}`).toBeLessThan(LIMIT_MS);
    return undefined;
  }, 600_000);
});
