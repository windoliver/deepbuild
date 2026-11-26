// AC6 #2750.e41e681f: "Budgets, on the reference Mac in the local preflight, compared with the merge base: 30 days with
// 2,000 landed commits recompute in under 2 s (drafted)"
//
// The fixture is fixture.ts's month: 2,000 commits the default branch gained in thirty days, in 200 pushes, 1,800 with a
// PASS on their tree, 100 with a FAIL and 100 from no session. A real hub reads them from the forge and the record
// when you run `deep numbers refresh`, and the reading must list all 2,000 as the fixture says before anything is timed.
//
// A recompute is a rebuild from the event log: a new home is given a copy of the log's files and nothing else, the
// record drops every table built from the log and replays it, and a hub started there answers its first
// `numbers.read`. What the month adds to that is the time on the log the hub wrote, less the time on the log as seeded,
// before the hub ever read the forge: the same record, hub and machine, without the 2,000 landed commits. A run is one
// of each, the order swapped each run; a warm-up and five runs go to the perf lane's own judge (scripts/benchmark.mjs,
// judgeLimit) against 2,000 ms. FAIL fails, PASS passes, and anything else is INCONCLUSIVE, which fails too: off the
// reference Macs, on battery, in Low Power Mode, with a thermal warning or under a load past the core count, the test
// fails as INCONCLUSIVE before it times anything.
//
// Compared with the merge base: the merge base has no such reading, so it has nothing to time, and nothing regresses
// from it; this test fails there at its first assertion on the reading.
//
// Wrong programs: the merge base; a rebuild that takes 2 s or more for the month, as one that joins every commit with
// every verdict by reading git or the forge again would.
import { afterAll, describe, expect, it } from 'vitest';
import { Month, REPO_NAME } from './fixture.ts';
import { AC6, cleanup, judgeLimit, keepLedger, load, machineProblem, rebuilt, World } from './helpers.ts';
import { commitRows, judgeLanded, tally } from './judges.ts';

afterAll(cleanup, 120_000);

const LIMIT_MS = 2000;
const RUNS = 5;
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

describe(`${AC6} budgets, on the reference Mac in the local preflight, compared with the merge base`, () => {
  it(`${AC6} 30 days with 2,000 landed commits recompute in under 2 s: a rebuild from the event log up to the first numbers.read, less the same without the month, five runs on the reference Mac`, async () => {
    const w = await World.make((dir) => Month.build(dir));
    const { expected } = w.fixture;
    expect(tally(expected), 'the month lands 2,000 commits: 1,800 with a PASS on their tree, 100 with a FAIL, 100 from no session').toEqual({ PASS: 1800, FAIL: 100, BLOCKED: 0, INVALID: 0, INCONCLUSIVE: 0, none: 100 });
    const seeded = keepLedger(w.ledger());

    await w.start();
    const made = judgeLanded((await w.read()).reading, REPO_NAME, expected);
    expect(made.slice(0, 12), `before anything is timed, the reading must list the month's 2,000 commits as the fixture says (${made.length} failures, the first here):\n${made.slice(0, 12).join('\n')}\n`).toEqual([]);
    await w.stop();
    const month = keepLedger(w.ledger());
    const forge = w.fixture.forge.url;
    await w.strip();

    const problem = await machineProblem();
    if (problem) inconclusive(`the recompute of 30 days with 2,000 landed commits is timed only on a reference Mac at rest, and nothing was timed here: ${problem}`);
    /** One run: a rebuild with the month and one without, in turn; what the month adds, in ms. */
    const run = async (k: number): Promise<number> => {
      const took = new Map<string[], number>();
      for (const log of k % 2 === 0 ? [month, seeded] : [seeded, month]) {
        const r = await rebuilt(log, forge, { replay: true });
        if (log === month) expect(commitRows(r.reading).length, 'each timed rebuild lists the month\'s commits').toBe(Month.COMMITS);
        took.set(log, r.ms);
      }
      return Math.max(0, took.get(month)! - took.get(seeded)!);
    };
    await run(1);
    const runs: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let k = 0; k < RUNS; k++) { const start = load(); runs.push(await run(k)); loads.push({ start, end: load() }); }
    const v = await judgeLimit(LIMIT_MS, runs, loads);
    console.log(`${AC6} what 2,000 landed commits add to a rebuild from the event log (ms, five runs): ${JSON.stringify({ ...v, loads })}`);
    expect(v.status, `30 days with 2,000 landed commits must recompute in under ${LIMIT_MS} ms: ${JSON.stringify(v)}`).not.toBe('FAIL');
    if (v.status !== 'PASS') inconclusive(`the recompute of 30 days with 2,000 landed commits: ${JSON.stringify(v)}`);
  }, 19 * 60_000);
});
