// #3218 AC11: budgets, on the reference Mac in the local preflight, compared with the merge base (drafted): a lease
// with units is granted in under 50 ms, and an ask for four resources is decided in under 1 ms with 1,000 leases held.
//
// "Compared with the merge base" is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as #237's budget
// was: benchmarks/budgets.json is valid against the merge base's (so `lease-grant` keeps its frozen definition and
// its run is compared with the merge base's), and a task `lease-ask` measures the ask, a first measurement whose
// reason names #3218. The issue's numbers are judged here by the perf lane's own rule (`judgeLimit`): five runs after a
// warm-up, each the median of 20 calls, the load read at each run's start and end; PASS when all five are within the
// limit, FAIL when all are over it by more than the margin, and INCONCLUSIVE otherwise, off a reference Mac, or at a
// load above the cores. The runs are always measured and printed; INCONCLUSIVE fails the test, never a pass.
//
// - Granted: one `lease` call naming units on a pool, on a record already holding 100 leases of that pool.
// - Decided: one `ask` call naming a cpu.slot, units of two pools and an exact key, with 1,000 leases held; its fourth
//   resource has no room, so each timed ask is read and decided and appends nothing, and the leases held stay 1,000.
//   The grant's append is the first number's.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Need, Resource } from '@deepbuild/leases';
import { bench, git, inconclusive, json, load, median, mergeBase, NODE, REPO, session } from './helpers.ts';
import { as, granted, openWorld, poolKind, slot, TEST_PLUGIN, unitsOf } from './world.ts';

const AC11 = '#3218.776b3d1a';
const RUNS = 5;
const CALLS = 20;

interface Task { id: string; command: string[]; initialReason?: string }

/** One warm-up and five runs of `value`, each with the load at its start and end, judged against `limit` ms. */
async function judged(name: string, limit: number, value: () => Promise<number>): Promise<void> {
  await value();
  const runs: number[] = [];
  const loads: { start: number; end: number }[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = load();
    runs.push(await value());
    loads.push({ start, end: load() });
  }
  const b = await bench();
  const v = b.judgeLimit({ limit, runs, fingerprint: b.fingerprint(), loads });
  console.log(`AC11 ${name} (ms, median of ${CALLS} calls; five runs): ${json({ ...v, loads })}`);
  expect(v.status, `${name} under ${limit} ms: ${json(v)}`).not.toBe('FAIL');
  if (v.status !== 'PASS') inconclusive(`${name}: ${json(v)}`);
}

describe(`AC11 ${AC11} budgets, compared with the merge base`, () => {
  it(`AC11 ${AC11} the perf lane's budgets are valid against the merge base's, and a task lease-ask, a #3218 first measurement, times the ask`, async () => {
    const { validateBudgets } = await bench();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    validateBudgets(current, JSON.parse(git('show', `${mergeBase()}:benchmarks/budgets.json`)));
    expect(current.tasks.find((t) => t.id === 'lease-grant')?.command, 'the lease-grant task, compared with the merge base\'s run').toEqual(['node', 'benchmarks/lease.mjs']);
    const task = current.tasks.find((t) => t.id === 'lease-ask');
    expect(task, 'benchmarks/budgets.json has a task lease-ask').toBeDefined();
    expect(task!.command).toEqual(['node', 'benchmarks/lease-ask.mjs']);
    expect(String(task!.initialReason), 'its first measurement says why, naming issue #3218').toMatch(/#3218/);
  });

  it(`AC11 ${AC11} \`node benchmarks/lease-ask.mjs\` runs and exits 0`, () => {
    execFileSync(NODE, [join(REPO, 'benchmarks/lease-ask.mjs')], { cwd: REPO, stdio: 'pipe', timeout: 600_000 });
  }, 600_000);

  it(`AC11 ${AC11} on the reference Mac, a lease with units is granted in under 50 ms, on a record already holding 100 leases`, async () => {
    const w = await openWorld();
    try {
      await w.declare(TEST_PLUGIN, poolKind('test.timed', 999_999));
      const pool: Resource = { host: 'local', kind: 'test.timed', key: 'k' };
      for (let i = 0; i < 100; i++) granted(await w.table.lease(as(session()), pool, 'exclusive', 10), `held lease ${i + 1}`);
      await judged('a lease with units granted', 50, async () => {
        const took: number[] = [];
        for (let i = 0; i < CALLS; i++) {
          const t0 = performance.now();
          const r = await w.table.lease(as(session()), pool, 'exclusive', 7);
          took.push(performance.now() - t0);
          expect(unitsOf(granted(r, 'a timed lease with units')), 'it carries its 7 units').toBe(7);
        }
        return median(took);
      });
    } finally {
      await w.close();
    }
  }, 600_000);

  it(`AC11 ${AC11} on the reference Mac, an ask for four resources is decided in under 1 ms with 1,000 leases held`, async () => {
    const w = await openWorld({ cores: 4096 });
    try {
      await w.declare(TEST_PLUGIN, poolKind('test.pa', 100_000));
      await w.declare(TEST_PLUGIN, poolKind('test.pb', 2500));
      await w.declare(TEST_PLUGIN, { name: 'test.port', match: 'exact', cap: 100_000, cooldown: 0, cost: 0 });
      const pa: Resource = { host: 'local', kind: 'test.pa', key: 'k' };
      const pb: Resource = { host: 'local', kind: 'test.pb', key: 'k' };
      const port = (k: string): Resource => ({ host: 'local', kind: 'test.port', key: k });
      // 1,000 leases held: 250 each of cpu.slot, test.pa, test.pb (which fills its 2,500) and test.port.
      for (let i = 0; i < 250; i++) {
        const grant = await w.table.ask(as(session()), [
          { resource: slot(), mode: 'exclusive' }, { resource: pa, mode: 'exclusive', units: 10 },
          { resource: pb, mode: 'exclusive', units: 10 }, { resource: port(`held-${i}`), mode: 'exclusive' },
        ]);
        expect(grant.status, `held ask ${i + 1}: ${json(grant)}`).toBe('granted');
      }
      expect((await w.table.leases()).length, '1,000 leases held').toBe(1000);
      let n = 0;
      await judged('an ask for four resources decided', 1, async () => {
        const took: number[] = [];
        for (let i = 0; i < CALLS; i++) {
          const needs: Need[] = [
            { resource: slot(), mode: 'exclusive' }, { resource: pa, mode: 'exclusive', units: 5 },
            { resource: port(`free-${n++}`), mode: 'exclusive' }, { resource: pb, mode: 'exclusive', units: 1 },
          ];
          const t0 = performance.now();
          const r = await w.table.ask(as(session()), needs);
          took.push(performance.now() - t0);
          expect(r.status === 'refused' && r.resource, `a timed ask is decided, refused on its fourth resource: ${json(r)}`).toEqual(pb);
        }
        return median(took);
      });
      expect((await w.table.leases()).length, 'still 1,000 leases held').toBe(1000);
    } finally {
      await w.close();
    }
  }, 600_000);
});
