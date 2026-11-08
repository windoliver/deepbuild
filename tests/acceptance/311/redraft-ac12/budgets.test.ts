// #311 AC12 #311.5a2a5cc9, blind redraft, timing half (README): "Budgets, on the reference Mac in the local preflight,
// compared with the merge base: validating an event against its schema takes under 20 µs at p95, and the generated types
// add nothing at runtime." The "add nothing at runtime" half is codegen.test.ts's; this file times validation only.
//
// It times real calls of the package's public `validate(name, value)` on whole events: every fixture of the newest
// schema of seventeen event kinds the issue names, taken in turn so each kind weighs the same, each call on its own
// fresh copy of the fixture (so a validator can't answer from an identity cache), each call timed on its own with the
// monotonic clock. Every timed call must accept its valid fixture, so no refused (short-cut) call is counted as fast.
// After a warm-up run of the same calls, five runs; a run's reading is the p95 over its calls, in µs, printed.
// The judge is the design's rule for a timing result, the repo's own (scripts/benchmark.mjs judgeLimit): PASS when
// all five are within 20 µs, FAIL when all five are over it by more than the margin (the larger of 5% and the five
// runs' spread), otherwise INCONCLUSIVE. Off the three reference Macs (model, chip and memory as the design lists
// them), on battery, with Low Power Mode on or unknown, or with the thermal state not nominal, before or after the
// runs, the readings are readings only and the test skips as INCONCLUSIVE; it never passes by skipping.
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';
import { catalogue, fixtures, validate } from '../../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../../packages/contracts/src/index.ts';
import { REPO } from '../helpers.ts';

const AC12 = '#311 AC12 #311.5a2a5cc9';
const LIMIT_US = 20;
const RUNS = 5;
/** Rounds a run: each round validates one fixture of every kind, so a run is 17 × 600 = 10,200 calls. */
const ROUNDS = 600;

/**
 * The kinds the issue names: its new shapes (user.ask, child sessions, tasks, worktrees, doc.patched), the Event
 * primitive's (claim.made), the hook's tool.before, and the decision kinds only the core appends.
 */
const KINDS = [
  'user.ask', 'session.child_started', 'task.created', 'worktree.created', 'worktree.removed', 'doc.patched',
  'claim.made', 'tool.before', 'verdict.made', 'verdict.stale', 'definition.locked', 'definition.revised',
  'decision.created', 'decision.applied', 'ask.created', 'ask.answered', 'ask.defaulted',
] as const;

interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; margin?: number; reason?: string }
interface Benchmark {
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown> }): Judged;
}
const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;

interface Call { schema: string; value: JsonValue }

/** The newest schema of each kind, and its valid fixtures. */
function events(): { kind: string; schema: string; values: JsonValue[] }[] {
  const entries = catalogue();
  return KINDS.map((kind) => {
    const versions = entries.filter((e) => e.kind === kind).sort((a, b) => b.version - a.version);
    expect(versions.length, `FAIL event kind ${kind} is not in the catalogue`).toBeGreaterThan(0);
    const schema = versions[0]!.schema;
    const values = fixtures(schema);
    expect(values.length, `FAIL ${schema} has no valid fixture to time`).toBeGreaterThan(0);
    return { kind, schema, values };
  });
}

/** One run's calls: each round takes the next fixture of every kind, each a fresh copy. */
const calls = (all: ReturnType<typeof events>): Call[] =>
  Array.from({ length: ROUNDS }, (_, r) => all.map(({ schema, values }) => ({ schema, value: structuredClone(values[r % values.length]!) }))).flat();

/** Times each call on its own; returns the times in µs and the calls that weren't accepted. */
function timed(run: readonly Call[]): { us: number[]; refused: string[] } {
  const us = new Array<number>(run.length);
  const refused: string[] = [];
  for (let i = 0; i < run.length; i++) {
    const { schema, value } = run[i]!;
    const start = process.hrtime.bigint();
    const result = validate(schema, value);
    const end = process.hrtime.bigint();
    us[i] = Number(end - start) / 1000;
    if (result?.ok !== true) refused.push(`${schema}: ${JSON.stringify(result)}`);
  }
  return { us, refused };
}

/** Nearest-rank percentile. */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

const fixed = (xs: readonly number[]): string => `[${xs.map((x) => x.toFixed(2)).join(', ')}]`;

describe(`${AC12} budgets on the reference Mac in the local preflight`, () => {
  it(`${AC12} validating an event against its schema takes under 20 µs at p95`, async (ctx: TestContext) => {
    const { fingerprint, judgeLimit } = await benchmark();
    const before = fingerprint();
    const all = events();
    for (const { schema, values } of all) {
      for (const value of values) {
        const result = validate(schema, structuredClone(value));
        expect(result?.ok, `FAIL ${schema} refuses its own valid fixture, so its time can't be read: ${JSON.stringify(result)}`).toBe(true);
      }
    }

    const warm = timed(calls(all));
    expect(warm.refused, `FAIL the warm-up had refused calls`).toEqual([]);
    const p95s: number[] = [];
    const p50s: number[] = [];
    const maxes: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      const run = calls(all);
      const { us, refused } = timed(run);
      expect(refused, `FAIL run ${r + 1} had refused calls, which would count as fast`).toEqual([]);
      expect(us.length, `FAIL run ${r + 1} timed every call`).toBe(run.length);
      p95s.push(percentile(us, 0.95));
      p50s.push(percentile(us, 0.5));
      maxes.push(Math.max(...us));
      console.log(`${AC12} run ${r + 1}: p95 ${p95s[r]!.toFixed(2)} µs (p50 ${p50s[r]!.toFixed(2)}, max ${maxes[r]!.toFixed(2)}) over ${us.length} validations`);
    }
    const after = fingerprint();

    const kinds = all.map(({ schema, values }) => `${schema}×${values.length}`).join(' ');
    const [load] = loadavg();
    console.log(`${AC12} ${String(before.model)} ${String(before.chip)} ${String(before.memoryBytes)} B, macOS ${String(before.macosBuild)}, power ${String(before.power)}, Low Power Mode ${String(before.lowPowerMode)}, thermal ${String(before.thermalState)} (after: ${String(after.power)}, ${String(after.lowPowerMode)}, ${String(after.thermalState)}); 1-minute load ${load!.toFixed(1)} on ${availableParallelism()} cores`);
    console.log(`${AC12} schemas×fixtures: ${kinds}`);
    console.log(`${AC12} p95 per run ${fixed(p95s)} µs against ${LIMIT_US} µs; p50 ${fixed(p50s)}; max ${fixed(maxes)}`);

    const judged = [before, after].map((machine) => judgeLimit({ limit: LIMIT_US, runs: p95s, fingerprint: machine }));
    console.log(`${AC12} ${judged[0]!.status}${judged[0]!.reason ? ` (${judged[0]!.reason})` : ''}`);
    for (const j of judged) if (j.status === 'BLOCKED') throw Error(`BLOCKED ${j.reason}`);
    const off = judged.find((j) => j.status === 'INCONCLUSIVE' && j.reason?.startsWith('a reading'));
    if (off) { ctx.skip(`INCONCLUSIVE ${off.reason}; p95 per run ${fixed(p95s)} µs`); return; }
    expect(judged[0]!.status, `FAIL all five p95s ${fixed(p95s)} µs are over ${LIMIT_US} µs by more than the ${((judged[0]!.margin ?? 0) * 100).toFixed(1)}% margin`).not.toBe('FAIL');
    if (judged[0]!.status !== 'PASS') { ctx.skip(`INCONCLUSIVE ${judged[0]!.reason}; p95 per run ${fixed(p95s)} µs`); return; }
    expect(judged[0]!.status).toBe('PASS');
  }, 300_000);
});
