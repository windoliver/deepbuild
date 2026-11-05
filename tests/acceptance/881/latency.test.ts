// AC1: with 1,000,000 events appended after a project's trust decision, a project extension's deny on tool.before
// still reaches the agent, and the trust check adds under 1 ms at p95 to the hook reply. The wrong program the
// criterion names, the host on main, is the base commit: there each call walks the record back to the decision on the
// event loop, so the reply misses the 500 ms deadline and the deny is dropped (BASE-FAILURE.txt).
//
// One world: your trust decision for a repo, then 1,000,000 events appended through the record's own `append`. Two
// hosts on that world, each with the same denying package: on host P it comes with the trusted repo (a project's
// extension, so its trust is checked), on host C it comes with no project (nothing to check). What the trust check
// adds to the hook reply is P's p95 reply time minus C's, over calls made in turn on the same record (README, AC1's
// measurement).
import { beforeAll, describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { appendToolCalls, countAfter, DEADLINE_MS, deniedBy, denier, hookCall, installAndLoad, judgeTiming, openHost, openWorld, p95, tempDir, YOU, type World } from './helpers.ts';
import { judgeDenyReaches } from './judges.ts';

const EVENTS = 1_000_000;
const PROJECT = 'acme/denier';
const CONTROL = 'acme/control';
/** The issue's threshold: what the trust check adds to the hook reply at p95, in ms. */
const LIMIT_MS = 1;
/** Calls per side in each of the five runs, after a warm-up. */
const CALLS = 100;

let world: World;
let P: ExtensionHost;
let C: ExtensionHost;
beforeAll(async () => {
  world = await openWorld();
  const repo = tempDir('repo');
  await world.trust.answer(YOU, repo, true);
  const [decision] = await world.record.read({ after: 0, kinds: ['decision.created'] });
  expect(decision, 'your trust decision is in the record').toBeDefined();
  const started = performance.now();
  await appendToolCalls(world.record, EVENTS);
  const after = await countAfter(world.record, decision!.log_pos);
  console.log(`appended ${after} events after the trust decision in ${((performance.now() - started) / 1000).toFixed(0)} s`);
  expect(after, `at least ${EVENTS} events after the trust decision`).toBeGreaterThanOrEqual(EVENTS);
  P = await openHost(world);
  await installAndLoad(P, denier(PROJECT), repo);
  C = await openHost(world);
  await installAndLoad(C, denier(CONTROL));
}, 1_800_000);

describe(`AC1 #881.3c298943 With 1,000,000 events appended after a project's trust decision, a project extension's deny on \`tool.before\` still reaches the agent, and the trust check adds under 1 ms at p95 to the hook reply; the host on main misses the 500 ms deadline, drops the deny and fails this test, naming the extension`, () => {
  it(`AC1 with ${EVENTS.toLocaleString('en')} events after the trust decision, ${PROJECT}'s deny on tool.before reaches the agent within the ${DEADLINE_MS} ms deadline at every call, nothing of it failed`, async () => {
    const failures: string[] = [];
    let underLoad = 0;
    for (let i = 0; i < 10; i++) {
      const p = await hookCall(P);
      const c = await hookCall(C);
      const problems = judgeDenyReaches(p, PROJECT);
      if (!problems.length) continue;
      // The same call on the same record with no trust check missed too: the machine, not the trust check.
      if (judgeDenyReaches(c, CONTROL).length) underLoad++;
      else failures.push(`call ${i + 1}: ${problems.join('; ')}`);
    }
    expect(failures, `${PROJECT}, a project's extension, with ${EVENTS.toLocaleString('en')} events after its project's trust decision:\n${failures.join('\n')}`).toEqual([]);
    expect(underLoad, `INCONCLUSIVE: ${underLoad} of ${PROJECT}'s calls missed while ${CONTROL}'s, with no trust check, missed too (machine load)`).toBe(0);
  }, 600_000);

  it(`AC1 the trust check adds under ${LIMIT_MS} ms at p95 to ${PROJECT}'s hook reply (its p95 minus ${CONTROL}'s, no project, on the same record; five runs of ${CALLS} calls a side after a warm-up)`, async () => {
    let dropped = 0;
    let controlDropped = 0;
    const call = async (side: 'P' | 'C'): Promise<number> => {
      const { reply, ms } = await hookCall(side === 'P' ? P : C);
      if (side === 'P' && !deniedBy(reply, PROJECT)) dropped++;
      if (side === 'C' && !deniedBy(reply, CONTROL)) controlDropped++;
      return ms;
    };
    for (let i = 0; i < 5; i++) { await call('P'); await call('C'); }
    dropped = 0;
    controlDropped = 0;
    // A run's p95 is the k-th smallest of its calls. Once N-k+1 of P's calls are past the deadline, P's p95 is at
    // least the smallest of those, whatever its remaining calls take, so they are skipped and that bound is the run's
    // reading (it can only understate what the trust check adds). C's calls all run.
    const decided = CALLS - Math.ceil(0.95 * CALLS) + 1;
    const runs: number[] = [];
    for (let run = 0; run < 5; run++) {
      const p: number[] = [];
      const c: number[] = [];
      for (let i = 0; i < CALLS; i++) {
        const pDone = p.filter((ms) => ms > DEADLINE_MS).length >= decided;
        if (i % 2 === 0) {
          if (!pDone) p.push(await call('P'));
          c.push(await call('C'));
        } else {
          c.push(await call('C'));
          if (!pDone) p.push(await call('P'));
        }
      }
      const pDone = p.length < CALLS;
      const pP95 = pDone ? [...p].sort((a, b) => b - a)[decided - 1]! : p95(p);
      console.log(`run ${run + 1}: ${PROJECT} p95 ${pDone ? '>= ' : ''}${pP95.toFixed(3)} ms over ${p.length} calls, ${CONTROL} p95 ${p95(c).toFixed(3)} ms over ${c.length}`);
      runs.push(Math.max(0, pP95 - p95(c)));
    }
    const verdict = judgeTiming(`AC1 ms the trust check adds to ${PROJECT}'s hook reply at p95, ${EVENTS.toLocaleString('en')} events after its trust decision`, runs, LIMIT_MS);
    const lost = dropped ? `; ${PROJECT}'s deny was missing from ${dropped} of its replies` : '';
    expect(verdict === null ? null : `${verdict}${lost}`).toBeNull();
    expect(dropped, `${PROJECT}'s deny was missing from ${dropped} of its timed replies`).toBe(0);
    expect(controlDropped, `${CONTROL}'s deny was missing from ${controlDropped} of its timed replies, so the comparison is void`).toBe(0);
  }, 1_800_000);
});
