// #19.26a1fd32 (AC17): budgets, on the reference Mac in the local preflight, compared with the merge base: `deep
// status` answers in under 200 ms and `deep doctor` in under 2 s, each under 100 MB peak memory. The merge-base
// comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as #16, #24 and #319 left it; the
// limits are judged here by the design's rule for timing results (five runs after a warm-up; PASS when all five are
// within, FAIL when all five are over by more than the margin, the larger of 5% and the runs' spread, otherwise
// INCONCLUSIVE). A reading off a reference Mac, on battery, with Low Power Mode on or unknown, with a thermal warning
// or under heavy load (1-minute load past the core count) is skipped as INCONCLUSIVE, never passed. Each command is
// first run once anywhere, so a missing or broken command fails here on any machine.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ATTENTION, cleanup, DAY, deep, environmentProblem, HOUR, judge, makeHome, measured, MINUTE, NODE, parse, prefixOf, REPO, REPOS, run, Seeder,
  seedSessions, shown, startHub, THIRTY, type Planned, type Seeded,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const ID = 'AC17 #19.26a1fd32';
const MB = 1024 * 1024;
const TASKS = ['deep-status-30', 'deep-doctor'];

/**
 * The 30 sessions of AC8 on top of a heavy month of history (#16's: 20 sessions a day for 30 days, each with a
 * prompt, eight tool calls, a finished stop and its hooks quiet after), so `deep status` reads a record of a month.
 */
async function seedMonth(root: string, now: number): Promise<Seeded[]> {
  const s = await Seeder.open(root, now - 31 * DAY);
  try {
    const old: Planned[] = [];
    for (let d = 0; d < 30; d++) for (let n = 0; n < 20; n++) old.push({ repo: REPOS[(d + n) % 3]!, agent: n % 4 ? 'claude-code' : 'codex', state: 'quiet', how: `day ${d}`, lead: String(n % 10) });
    let n = 0;
    for (const x of old.map((p, i) => ({ ...p, id: `${(0x10000000 + i).toString(16)}-0000-4000-8000-${String(i).padStart(12, '0')}` }))) {
      const at = now - 31 * DAY + Math.floor(n / 20) * DAY + (n % 20) * 30 * MINUTE;
      await s.at(at).start(x, n);
      await s.at(at + MINUTE).prompt(x, 'fix the flaky test');
      for (let t = 0; t < 8; t++) await s.at(at + (2 + t) * MINUTE).tool(x, `npm test -- --run ${t}`, `call_${n}_${t}`);
      await s.at(at + 11 * MINUTE).stop(x, { cause: 'unknown', outcome: 'finished' });
      await s.at(at + HOUR).attention(x, 'unknown');
      n++;
    }
    return await seedSessions(root, THIRTY, now, s);
  } finally {
    await s.close();
  }
}

describe(`${ID} budgets compared with the merge base in the local preflight`, () => {
  it(`${ID} the perf lane has the tasks ${TASKS.join(' and ')}, #19 first measurements valid against the merge base's budgets, and each runs`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    for (const id of TASKS) {
      const task = current.tasks.find((t) => t.id === id);
      expect(task, `benchmarks/budgets.json has a task ${id}`).toBeDefined();
      expect(String(task!.initialReason), `${id} says why, naming issue #19`).toMatch(/#19\b/);
      const [command, ...args] = task!.command;
      const r = await run(command === 'node' ? NODE : command!, args, { timeoutMs: 600_000 });
      expect(r.code, `${task!.command.join(' ')} exits 0: ${r.stderr.slice(-2000)}`).toBe(0);
    }
  }, 1_200_000);

  it(`${ID} deep status answers in under 200 ms and under 100 MB peak memory, with 30 sessions on a month of history`, async (ctx) => {
    const h = makeHome();
    const sessions = await seedMonth(h.root, Date.now());
    await startHub(h.home);
    const attention = sessions.filter((s) => ATTENTION.has(s.state));
    const once = async (): Promise<{ ms: number; mb: number }> => {
      const r = await measured(h.home, ['status']);
      expect(r.code, `deep status exits 0: ${shown(r)}`).toBe(0);
      const missing = attention.filter((s) => !r.stdout.toLowerCase().includes(prefixOf(s.id)));
      expect(missing.map((s) => `${s.id} (${s.state})`), 'each timed deep status shows every session that needs you, is stuck or is flagged').toEqual([]);
      return { ms: r.ms, mb: r.peakBytes / MB };
    };
    const warm = await once();
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only: ${warm.ms.toFixed(0)} ms, ${warm.mb.toFixed(1)} MB): ${problem}`);
    const runs: { ms: number; mb: number }[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    judge(ctx, '#19 deep status with 30 sessions on a month (ms)', runs.map((r) => r.ms), 200);
    judge(ctx, '#19 deep status peak memory (MB)', runs.map((r) => r.mb), 100);
  }, 600_000);

  it(`${ID} deep doctor answers in under 2 s and under 100 MB peak memory, on a home setup installed into with the hub up`, async (ctx) => {
    const h = makeHome();
    await startHub(h.home);
    const setup = await deep(h.home, ['setup']);
    if (setup.code !== 0) throw Error(`BLOCKED: deep setup, which the doctor's items read, failed: ${shown(setup)}`);
    const once = async (): Promise<{ ms: number; mb: number }> => {
      const r = await measured(h.home, ['doctor']);
      expect(r.code, `deep doctor ran its items: ${shown(r)}`).not.toBe(2);
      expect(r.stdout.trim().length, 'deep doctor prints its items').toBeGreaterThan(0);
      return { ms: r.ms, mb: r.peakBytes / MB };
    };
    const items = await deep(h.home, ['doctor', '--json']);
    expect(items.stdout.split('\n').map(parse).filter(Boolean).length, `deep doctor --json prints one item a line: ${shown(items)}`).toBeGreaterThan(0);
    const warm = await once();
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only: ${warm.ms.toFixed(0)} ms, ${warm.mb.toFixed(1)} MB): ${problem}`);
    const runs: { ms: number; mb: number }[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    judge(ctx, '#19 deep doctor (ms)', runs.map((r) => r.ms), 2000);
    judge(ctx, '#19 deep doctor peak memory (MB)', runs.map((r) => r.mb), 100);
  }, 300_000);
});
