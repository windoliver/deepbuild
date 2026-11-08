// #33 AC6: budgets, on the reference Mac in the local preflight, compared with the merge base: the seeded false done
// is blocked within the 60-second hold.
//
// Two tests. The first runs anywhere: a lane of scripts/lanes.mjs (the local preflight) runs this file with Vitest, one
// file at a time, not excluded. The second times it: five fresh worlds, each playing the seeded-bug case's claim on
// the shipped hub with its default hold (no DEEP_HUB_TEST_STOP_HOLD_MS), each sample the stop's Stop hook from its
// start to deep-hook's reply. Each reply must be a block, and each must come within 60 s; a reply after the hold lets
// the stop through and is no block at all. Off a reference Mac (46's rule), or loaded past its core count, the timing
// is INCONCLUSIVE and the test skips with its readings, never PASS.
//
// The merge base: the base commit has no corpus, so it has no seeded case and no reading; nothing regresses from it.
// When the merge base this checkout runs against holds the corpus, the README says how to compare by hand.
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { AC6, REPO, caseFor, cleanup, decision, inconclusiveOffReference, must, play, readManifest, shown } from './helpers.ts';

afterAll(cleanup, 120_000);

const FILE = 'tests/acceptance/33/budget.test.ts';
const HOLD_MS = 60_000;
const SAMPLES = 5;

describe(`${AC6} the seeded false done is blocked within the 60-second hold, on the reference Mac in the local preflight`, () => {
  it(`${AC6} the local preflight runs ${FILE}: a lane runs it with Vitest, one file at a time, not excluded`, async () => {
    const { checks } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: { name: string; commands: string[][] }[] };
    const covers = (arg: string) => arg === FILE || (arg.endsWith('/') && FILE.startsWith(arg)) || (arg.endsWith('/**') && FILE.startsWith(arg.slice(0, -2)));
    const runs = checks.flatMap((lane) => lane.commands.map((command) => ({ lane: lane.name, command })))
      .filter(({ command }) => command.some((a) => /vitest/.test(a)) && command.includes('--no-file-parallelism') && command.some((a, i) => covers(a) && command[i - 1] !== '--exclude'));
    must(runs.length > 0, `${AC6} some lane of scripts/lanes.mjs must run ${FILE} with Vitest and --no-file-parallelism, not excluded`);
  }, 60_000);

  it(`${AC6} five plays of the seeded false done: each stop is blocked, each reply within ${HOLD_MS / 1000} s of the Stop hook's start`, async (ctx) => {
    const c = caseFor(readManifest(), 'seeded-bug', AC6);
    const samples: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const p = await play(c, 'claim');
      const last = p.stops[p.stops.length - 1]!;
      must(decision(last) === 'deny', `${AC6} sample ${i + 1}: the seeded false done's stop is blocked within the hold: ${shown(last)}`);
      samples.push(last.ms);
      await cleanup();
    }
    const text = `stop to block: ${samples.map((ms) => (ms / 1000).toFixed(1)).join(', ')} s against the ${HOLD_MS / 1000} s hold`;
    console.log(`${AC6} ${text}`);
    inconclusiveOffReference(ctx, text);
    must(samples.every((ms) => ms < HOLD_MS), `${AC6} every sample is under the hold: ${text}`);
  }, 3_600_000);
});
