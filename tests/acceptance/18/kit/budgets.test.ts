// AC18: budgets, on the reference Mac in the local preflight, compared with the merge base: mapping a hook payload
// to events adds under 1 ms at p95 in the hub; backfilling 30 days of transcripts for 100 sessions takes under
// 2 minutes.
//
// The merge-base comparison is the perf lane's (scripts/perf.mjs over benchmarks/budgets.json), as #26's, #348's
// and #24's budgets are: two tasks, #18 first measurements, valid against the merge base's budgets. The issue's own
// numbers are judged here, from the bench's readings (README, The surface under test), by the design's rule for
// timing results: a warm-up run, then five runs; PASS when all five are within the limit, FAIL when all five are
// over it by more than the margin (the larger of 5% and the five runs' spread), otherwise INCONCLUSIVE. They count
// only on a reference Mac on mains power, Low Power Mode off and thermal state nominal; anywhere else the test
// skips as INCONCLUSIVE with the warm-up reading, never passes. The warm-up run always runs, so a bench that is
// missing, fails, or measures nothing fails the test on any machine.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { JsonObject } from '../../../../packages/adapters/src/index.ts';
import { AC18, childEnv, cleanup, environmentProblem, judge, lastJson, NODE, REPO } from './helpers.ts';

afterAll(cleanup);

const BENCH = 'benchmarks/claude-code.mjs';
const TASKS = [
  { id: 'claude-code-map', command: ['node', BENCH, 'map'] },
  { id: 'claude-code-backfill', command: ['node', BENCH, 'backfill'] },
];
/** The nine hooks the issue maps; the map bench maps recorded payloads of each. */
const HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'];
const MAP_LIMIT_MS = 1;
const BACKFILL_LIMIT_MS = 2 * 60_000;
const SESSIONS = 100;
const DAYS = 30;
/** This job's floor for a session's transcript (README, Readings): 2,000 lines each. */
const LINES_FLOOR = 2_000 * SESSIONS;

type Task = { id: string; command: string[]; initialReason?: string };
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One run of the bench in `mode`, on a temp HOME: its last line, one JSON object. */
function bench(mode: 'map' | 'backfill'): JsonObject {
  const r = spawnSync(NODE, [join(REPO, BENCH), mode], { cwd: REPO, env: childEnv(), encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  expect(r.status, `node ${BENCH} ${mode} exits 0:\n${r.stdout.slice(-2000)}\n${r.stderr.slice(-2000)}`).toBe(0);
  return lastJson(r.stdout, `node ${BENCH} ${mode}`);
}

/** The map bench's reading: p95 ms per hook, over at least 1,000 hooks, every one of the nine hooks mapped. */
function mapReading(): number {
  const r = bench('map');
  expect(num(r.p95Ms) && r.p95Ms > 0, `the map bench prints p95Ms, ms the hub spends mapping one hook payload to its events at p95: ${JSON.stringify(r)}`).toBe(true);
  expect(num(r.hooks) && r.hooks >= 1000, `the map bench maps at least 1,000 hooks: ${JSON.stringify(r)}`).toBe(true);
  const byHook = (typeof r.byHook === 'object' && r.byHook !== null && !Array.isArray(r.byHook) ? r.byHook : {}) as Record<string, unknown>;
  expect(HOOKS.filter((h) => !(num(byHook[h]) && byHook[h] >= 1)), `the map bench mapped events from recorded payloads of every hook the issue maps: ${JSON.stringify(r)}`).toEqual([]);
  return r.p95Ms as number;
}

/** The backfill bench's reading: ms to backfill 100 sessions' transcripts spread over 30 days into the record. */
function backfillReading(): number {
  const r = bench('backfill');
  expect(num(r.elapsedMs) && r.elapsedMs > 0, `the backfill bench prints elapsedMs: ${JSON.stringify(r)}`).toBe(true);
  expect(r.sessions, `the backfill covers ${SESSIONS} sessions: ${JSON.stringify(r)}`).toBe(SESSIONS);
  expect(r.days, `the sessions' transcripts span ${DAYS} days: ${JSON.stringify(r)}`).toBe(DAYS);
  expect(num(r.lines) && r.lines >= LINES_FLOOR, `the transcripts hold at least ${LINES_FLOOR} lines (2,000 a session): ${JSON.stringify(r)}`).toBe(true);
  expect(num(r.events) && r.events >= SESSIONS, `the record holds events the backfill appended, at least one a session: ${JSON.stringify(r)}`).toBe(true);
  return r.elapsedMs as number;
}

describe(`${AC18} budgets on the reference Mac, compared with the merge base: mapping a hook payload adds under 1 ms at p95 in the hub; backfilling 30 days of transcripts for 100 sessions takes under 2 minutes`, () => {
  it(`${AC18} the perf lane has the tasks ${TASKS.map((t) => t.id).join(' and ')}, #18 first measurements, valid against the merge base's budgets`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    const base = execFileSync('/usr/bin/git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('/usr/bin/git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    for (const want of TASKS) {
      const task = current.tasks.find((t) => t.id === want.id);
      expect(task, `benchmarks/budgets.json has a task ${want.id}`).toBeDefined();
      expect(task!.command, `${want.id} runs ${want.command.join(' ')}`).toEqual(want.command);
      expect(String(task!.initialReason), `${want.id} says why, naming issue #18`).toMatch(/#18\b/);
    }
  });

  it(`${AC18} mapping a hook payload to events adds under ${MAP_LIMIT_MS} ms at p95 in the hub (a warm-up run, then five, by the timing rule)`, (ctx) => {
    const warm = mapReading();
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only, warm-up p95 ${warm.toFixed(3)} ms): ${problem}`);
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(mapReading());
    judge(ctx, `${AC18} hook payload to events, p95 per hook in the hub (ms)`, runs, MAP_LIMIT_MS);
  }, 3_600_000);

  it(`${AC18} backfilling 30 days of transcripts for 100 sessions takes under 2 minutes (a warm-up run, then five, by the timing rule)`, (ctx) => {
    const warm = backfillReading();
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only, warm-up ${(warm / 1000).toFixed(1)} s): ${problem}`);
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(backfillReading());
    judge(ctx, `${AC18} backfill of ${SESSIONS} sessions over ${DAYS} days (ms)`, runs, BACKFILL_LIMIT_MS);
  }, 4_200_000);
});
