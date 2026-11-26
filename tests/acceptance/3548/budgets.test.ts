// #3548.4bf12cec (criterion 6): "Budgets, on the reference Mac in the local preflight, compared with the merge base:
// the idle hub's CPU and memory are no higher".
//
// The comparison is the local preflight's perf lane (scripts/perf.mjs, scripts/benchmark.mjs judgeTask): on a
// reference Mac it runs `hub-idle`, the idle hub's task in benchmarks/budgets.json, on the change and on the merge
// base, 20 rounds a side, and judges the change's time, CPU, peak memory and instructions against the base's. A
// checkout can't run its own merge base, so this file makes no such comparison and judges no CPU or memory budget
// anywhere (README: The budget criterion). It holds what makes the lane's reading count, and what a count can show
// on any machine:
//   1. `hub-idle` is still in budgets.json with the merge base's command, a margin no wider and neither of its two
//      count limits raised or dropped: the lane measures the same thing on both sides, with no more room.
//   2. the task's command runs on this checkout and reports the idle hub's CPU and resident memory, the readings the
//      lane compares, and its hub's wakeups and instructions a second are within the merge base's limits for them.
//      Counts hold on any machine (design: Numbers version 0 has to hold); where the kernel's counters can't be read
//      the test is INCONCLUSIVE, never passed. The CPU and memory are printed as readings and not judged.
// Both pass on the merge base by their nature: it is compared with itself.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bareEnv, built, cleanup, NODE, parse, REPO, run, shown } from './helpers.ts';

afterEach(cleanup, 120_000);

const ID = '#3548.4bf12cec';
/** `hub-idle` at the merge base, 1f114eacc. */
const BASE = { command: ['node', 'benchmarks/hub.mjs', 'idle'], margin: 0.5, limits: { 'report.wakeupsPerSecond': 50, 'report.instructionsPerSecond': 4_500_000 } as Record<string, number> };

describe(`${ID} the idle hub's budgets, compared with the merge base in the local preflight`, () => {
  it(`${ID} hub-idle stays in benchmarks/budgets.json with the merge base's command, a margin no wider than 0.5 and its limits on wakeups and instructions a second neither raised nor dropped, so the local preflight compares the idle hub's CPU and memory with the merge base`, () => {
    const budgets = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command?: unknown; margin?: unknown; limits?: Record<string, unknown> }[] };
    const task = budgets.tasks.find((t) => t.id === 'hub-idle');
    expect(task, 'benchmarks/budgets.json holds hub-idle').toBeDefined();
    const failures: string[] = [];
    if (JSON.stringify(task!.command) !== JSON.stringify(BASE.command)) failures.push(`hub-idle's command is ${JSON.stringify(task!.command)}, not the merge base's ${JSON.stringify(BASE.command)}`);
    if (typeof task!.margin !== 'number' || task!.margin > BASE.margin) failures.push(`hub-idle's margin is ${JSON.stringify(task!.margin)}, wider than the merge base's ${BASE.margin}`);
    for (const [key, was] of Object.entries(BASE.limits)) {
      const now = task!.limits?.[key];
      if (typeof now !== 'number' || now > was) failures.push(`hub-idle's limit ${key} is ${JSON.stringify(now ?? null)}, ${now === undefined ? 'dropped from' : 'above'} the merge base's ${was}`);
    }
    expect(failures, 'hub-idle as the local preflight reads it').toEqual([]);
  }, 60_000);

  it(`${ID} hub-idle's command runs here and reports the idle hub's CPU and resident memory, and its hub wakes and retires instructions within the merge base's limits, 50 and 4,500,000 a second`, async (ctx) => {
    built();
    const ran = await run(NODE, BASE.command.slice(1), { cwd: REPO, env: bareEnv(), timeoutMs: 900_000 });
    // The task gives its hub 10 s to answer, which a busy machine can take: no reading was made, and none is judged.
    if (ran.code !== 0 && /the hub did not answer within 10 s/.test(ran.stderr)) ctx.skip(`INCONCLUSIVE: ${BASE.command.join(' ')} made no reading, since its hub didn't answer within the 10 s the task gives it: ${shown(ran)}`);
    expect(ran.code, `${BASE.command.join(' ')} exits 0: ${shown(ran)}`).toBe(0);
    const report = parse(ran.stdout.trim().split('\n').filter((l) => l.trim().startsWith('{')).at(-1) ?? '') ?? {};
    const read = (name: string): number | null => (typeof report[name] === 'number' && Number.isFinite(report[name]) ? (report[name] as number) : null);
    const [cpu, rss, wakeups, instructions] = [read('idleCpuPercent'), read('rssBytes'), read('wakeupsPerSecond'), read('instructionsPerSecond')];
    console.log(`#3548 idle hub, a reading (the budget is the perf lane's, against the merge base on a reference Mac): CPU ${cpu ?? 'unread'}% of one core, resident ${rss === null ? 'unread' : `${(rss / 1e6).toFixed(1)} MB`}, ${wakeups?.toFixed(1) ?? 'unread'} wakeups and ${instructions === null ? 'unread' : Math.round(instructions).toLocaleString('en-US')} instructions a second`);
    // A hub that never came up, or a task that reads nothing, gives the lane nothing to compare.
    expect(cpu !== null && cpu >= 0 && rss !== null && rss > 0, `hub-idle reports the idle hub's CPU (idleCpuPercent) and resident memory (rssBytes): ${JSON.stringify(report).slice(0, 600)}`).toBe(true);
    if (wakeups === null || instructions === null) ctx.skip(`INCONCLUSIVE: the hub's wakeups and instructions can't be read on this machine (${process.platform}; the benchmarks' reader takes them from the macOS kernel with a C compiler), so its counts are not judged here`);
    // A hub that looks at its log on a timer wakes when idle, and fails here, naming how often.
    expect(wakeups!, `the idle hub woke ${wakeups!.toFixed(1)} times a second; hub-idle's limit at the merge base is ${BASE.limits['report.wakeupsPerSecond']}`).toBeLessThanOrEqual(BASE.limits['report.wakeupsPerSecond']!);
    expect(instructions!, `the idle hub retired ${Math.round(instructions!).toLocaleString('en-US')} instructions a second; hub-idle's limit at the merge base is ${BASE.limits['report.instructionsPerSecond']!.toLocaleString('en-US')}`).toBeLessThanOrEqual(BASE.limits['report.instructionsPerSecond']!);
  }, 1_200_000);
});
