// #86 criteria 1 and 8: runs that compete for one budget, decided on what the log holds, with the price
// lookup held open until every competing request is in and released in every order.

import fc from 'fast-check';
import { expect, test } from 'vitest';
import type { Outcome, Reserved } from '../../../packages/budget/src/index.ts';
import { core, flush, GPU, openWorld, permutations, request, inputs, runId, sorted, type World } from './helpers.ts';
import { gpuRace, raiseDefaultsNo, threeAtOnce } from './scenarios.ts';

async function inWorld(scenario: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld();
  try {
    await scenario(w);
  } finally {
    await w.close();
  }
}

test('#86.fb5b8d9b three paid runs started at once against a budget with room for two: two start, the third is BLOCKED with the cause budget, and the cap is never passed', async () => {
  await inWorld(threeAtOnce);
});

for (const order of permutations([0, 1, 2])) {
  test(`#86.60e70718 with the price lookup held open until all three GPU runs are requested and released in the order ${order.map((i) => i + 1).join(', ')}: two start, one is BLOCKED by the GPU's budget, and its issue's budget is whole`, async () => {
    await inWorld(gpuRace(order));
  });
}

test('#86.60e70718 an unanswered budget raise takes no at its 1-day deadline', async () => {
  await inWorld(raiseDefaultsNo);
});

// A rule stated with never and every is tested as a property (design: Universal rules are tested as
// properties). Generator: one GPU budget and one to three issue budgets with integer caps of $0 to $12, one
// to five paid runs of $1 to $6, each for one of the issues and on the GPU or not, every price lookup held
// open until all runs are requested, then released in a generated order. Criteria: #86.fb5b8d9b (the cap
// is never passed) and #86.60e70718 (in every release order; a run BLOCKED by one budget holds no
// reservation in any).
const SEED = 0x86_08;
const RUNS = 1000;
const scenario = fc.record({
  gpuCap: fc.integer({ min: 0, max: 12 }),
  caps: fc.array(fc.integer({ min: 0, max: 12 }), { minLength: 1, maxLength: 3 }),
  runs: fc.array(fc.record({ issue: fc.nat(2), gpu: fc.boolean(), price: fc.integer({ min: 1, max: 6 }) }), { minLength: 1, maxLength: 5 }),
}).chain((s) => fc.shuffledSubarray(s.runs.map((_, i) => i), { minLength: s.runs.length, maxLength: s.runs.length }).map((order) => ({ ...s, order })));

test('#86.60e70718 #86.fb5b8d9b property: in every release order of held price lookups, no budget passes its cap, every started run reserved against every budget that covers it, and a BLOCKED run had no room and holds nothing', async () => {
  await fc.assert(fc.asyncProperty(scenario, async (s) => {
    const w = await openWorld();
    try {
      const gpu = await w.approve('resource', GPU, s.gpuCap);
      const issues: string[] = [];
      for (const [i, cap] of s.caps.entries()) issues.push(await w.approve('issue', `windoliver/deepbuild#${100 + i}`, cap));
      const runs = s.runs.map((r, i) => {
        const issue = r.issue % s.caps.length;
        const check = `check.paid-${i}`;
        w.prices.set(check, r.price);
        const covers = [issues[issue]!, ...(r.gpu ? [gpu] : [])];
        return { id: runId(), check, issue, covers, price: r.price, req: request('', check, inputs(`run ${i}`), `windoliver/deepbuild#${100 + issue}`, r.gpu ? GPU : undefined) };
      });
      w.hold(true);
      const pending = runs.map((r) => w.ledger.request(core, { ...r.req, run: r.id }));
      await w.heldUntil(runs.length);
      const byRun = new Map(w.held.map((h) => [h.request.run, h]));
      for (const i of s.order) {
        byRun.get(runs[i]!.id)?.release();
        await flush(3);
      }
      w.hold(false);
      const outcomes: Outcome[] = await Promise.all(pending);
      const views = new Map<string, Awaited<ReturnType<typeof w.ledger.budget>>>();
      for (const id of [gpu, ...issues]) views.set(id, await w.ledger.budget(id));
      for (const [id, view] of views) {
        expect(view.reserved_usd + view.spent_usd, `budget ${id}: the cap is never passed (${JSON.stringify(s)})`).toBeLessThanOrEqual(view.cap_usd);
        expect(view.reserved_usd, `budget ${id}: what it holds is the sum of its reservations`).toBe(view.reservations.reduce((sum, r) => sum + r.usd, 0));
      }
      for (const [i, r] of runs.entries()) {
        const o = outcomes[i]!;
        if (o.status === 'started') {
          expect(sorted((o as { reserved: Reserved[] }).reserved), `run ${i + 1} started: it reserved its price against every budget that covers it`)
            .toEqual(sorted(r.covers.map((budget) => ({ budget, usd: r.price }))));
          for (const id of r.covers) expect(views.get(id)!.reservations.map((x) => x.run), `budget ${id} holds started run ${i + 1}'s reservation`).toContain(r.id);
        } else {
          expect(o, `run ${i + 1} didn't start: it is BLOCKED with the cause budget, naming a budget that covers it`).toMatchObject({ status: 'BLOCKED', cause: 'budget' });
          const named = (o as { budget: string }).budget;
          expect(r.covers, `run ${i + 1}'s BLOCKED names a budget that covers it`).toContain(named);
          const view = views.get(named)!;
          expect(view.reserved_usd + view.spent_usd + r.price, `run ${i + 1} was BLOCKED by budget ${named}, which had no room for its $${r.price}`).toBeGreaterThan(view.cap_usd);
          for (const [id, v] of views) expect(v.reservations.map((x) => x.run), `BLOCKED run ${i + 1} holds no reservation in budget ${id}`).not.toContain(r.id);
        }
      }
    } finally {
      await w.close();
    }
  }), { seed: SEED, numRuns: RUNS, endOnFailure: true });
}, 600_000);
