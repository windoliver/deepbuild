// #65 AC9: on the reference Mac in the local preflight, compared with the merge base, an item reaches a channel within
// 10 s and a channel plug-in stays under 50 MB. The comparison with the merge base is the perf lane's
// (scripts/benchmark.mjs, benchmarks/budgets.json): a task running benchmarks/channels.mjs, valid against the merge
// base's budgets, as #55's plugin budget is; the merge base has no channel, so all of it is new. The script reports
// what it measured; this suite also times one item from its ask to a channel's provider through a real hub. A number
// counts only on a reference Mac with the load under the core count; anywhere else it is printed and reads
// INCONCLUSIVE, never PASS.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { environmentProblem } from '../40/helpers.ts';
import { NODE, REPO } from '../16/helpers.ts';
import { AC, CHANNELS, MINUTE, cleanup, loadReading, loaded, needChannels, paseoAgent, permission, turnStarts, waitFor, world, type Line } from './helpers.ts';

afterEach(cleanup, 120_000);
const SCRIPT = 'benchmarks/channels.mjs';
const REACH_MS = 10_000;
const PLUGIN_MB = 50;
/** A reading that counts only on a reference Mac in a fit state, unloaded; otherwise INCONCLUSIVE, with the readings. */
function judged(ctx: TestContext, shown: string, within: boolean): void {
  console.log(shown);
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE off the reference Mac (${problem}): ${shown}`);
  if (within) return;
  if (loaded()) ctx.skip(`INCONCLUSIVE under load: ${shown}`);
  throw Error(`${AC[9]} FAIL ${shown}`);
}

describe(`${AC[9]} Budgets, on the reference Mac in the local preflight, compared with the merge base: an item reaches a channel within 10 s, and a channel plug-in stays under 50 MB`, () => {
  it(`${AC[9]} the perf lane has the channels' task, a #65 first measurement, valid against the merge base's budgets`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const tasks = current.tasks.filter((t) => (t.command as string[]).includes(SCRIPT));
    expect(tasks.length, `budgets.json has a task running ${SCRIPT}`).toBeGreaterThan(0);
    for (const t of tasks) expect(String(t.initialReason), `${String(t.id)} says why, naming issue #65`).toMatch(/#65\b/);
  });

  it(`${AC[9]} \`node ${SCRIPT}\` runs, and what it measured holds: an item at a channel within 10 s, each channel plug-in under 50 MB`, (ctx) => {
    needChannels(['paseo', 'chat', 'email', 'text']);
    const out = execFileSync(NODE, [join(REPO, SCRIPT)], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 });
    const last = JSON.parse(out.trim().split('\n').at(-1)!) as { reach_ms: number; rss_mb: Record<string, number> };
    expect(Object.keys(last.rss_mb ?? {}).sort(), `${SCRIPT}'s last line names each channel plug-in's memory: ${out.slice(-500)}`).toEqual(['chat', 'email', 'paseo', 'text']);
    expect(Number.isFinite(last.reach_ms), `${SCRIPT}'s last line has reach_ms`).toBe(true);
    const over = Object.entries(last.rss_mb).filter(([, mb]) => !(mb < PLUGIN_MB));
    judged(ctx, `item to a channel ${last.reach_ms} ms (limit ${REACH_MS}); plug-ins ${Object.entries(last.rss_mb).map(([k, mb]) => `${k} ${mb} MB`).join(', ')} (limit ${PLUGIN_MB}); ${loadReading()}`, last.reach_ms < REACH_MS && !over.length);
  }, 620_000);

  it(`${AC[9]} through a real hub, an ask raised while chat is connected reaches chat's provider within 10 s`, async (ctx) => {
    const w = await world({ channels: ['chat'] });
    const a = paseoAgent(w.repo);
    await turnStarts(w, a);
    const since = Date.now();
    const { ask } = await permission(w, a, 'git push origin main');
    const first = await waitFor(() => w.providers.chat!.posts.find((p) => p.item.thread_key === ask), MINUTE, `${ask} at chat's provider`);
    const took = first.at - since;
    judged(ctx, `ask to chat's provider ${took} ms (limit ${REACH_MS}); ${loadReading()}; plug-ins from ${CHANNELS}`, took < REACH_MS);
  });
});
