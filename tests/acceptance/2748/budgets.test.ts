// AC6 #2748.8023bb4b: budgets, on the reference Mac in the local preflight, compared with the merge base: a claim whose
// diff no pass covers starts no job and gains under 5 ms on its hold (drafted). Judged by the design's rule for timing
// results, as #1018's budget test is: five samples after a warm-up; PASS when all are within the limit, FAIL when all
// are over it by more than the margin, otherwise INCONCLUSIVE. Off a reference Mac, on battery, with Low Power Mode on
// or unknown, or with a thermal warning, the test skips as INCONCLUSIVE; it never passes by skipping.
//
// One real hub, one session on PR 21. Your wiki holds one pass, `research`, scoped to src/net/**. A sample is two
// claims whose diffs touch only src/ui/cart.ts: one made with no passes page in the wiki, which is what the merge base
// reads of it, and one made with the page there; what the page adds to the hold is the second stop's time less the
// first's, each read from deep-hook's run of the Stop hook. Neither claim may start a pass run or a runner job the other
// doesn't. Last, a claim whose diff touches src/net/fetch.ts must start the `research` run: on a hub that runs no pass
// at all (the merge base) nothing was measured, and the test is BLOCKED. What "compared with the merge base" reads as
// here is in the README (Ambiguities).
import { afterAll, expect, it, type TestContext } from 'vitest';
import { environmentProblem } from '../29/helpers.ts';
import {
  AC6, CART, FETCH, NET_SCOPE, RESEARCH, TOTAL, TRIM, allEvents, cleanup, holds, must, opened, passRuns, passWorld, progress, removePasses, round, sayJobs,
  sayPassRuns, sayRuns, writePasses, type Change, type Go, type Round,
} from './helpers.ts';

afterAll(async () => { console.log(progress(200)); await cleanup(); }, 120_000);

const LIMIT_MS = 5;
function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.abs(Math.min(...runs)), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}

/** The end of src/ui/cart.ts as the n-th change leaves it: each claim's diff touches only that file, at its end, far from line 6. */
const tail = (n: number): string => (n === 0 ? 'items\`;\n}\n' : `items\`;\n}\n// revision ${n}\n`);
let revision = 0;
/** One claim whose diff touches only src/ui/cart.ts; the first also makes the definition's check pass and opens PR 21. */
async function cartClaim(go: Go, name: string, first = false): Promise<Round> {
  const change: Change = { file: CART, from: tail(revision), to: tail(revision + 1) };
  revision += 1;
  return round(go, name, first ? [TOTAL, change] : [change], { pr: first });
}

it(`${AC6} a claim whose diff no pass covers starts no job and gains under ${LIMIT_MS} ms on its hold, compared with the merge base`, async (ctx) => {
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE ${AC6} ${problem}: a budget counts only on a reference Mac on mains power`);
  const w = passWorld('research');
  const go = await opened(w, AC6);
  const page = (): void => writePasses(w, w.passes);

  // The warm-up: the first claim opens PR 21 and makes the definition's check pass; then one pair nobody counts.
  removePasses(w);
  await cartClaim(go, 'warm-up, no page', true);
  page();
  await cartClaim(go, 'warm-up, page');

  const gains: number[] = [];
  for (const i of [1, 2, 3, 4, 5]) {
    removePasses(w);
    const without = await cartClaim(go, `sample ${i}, no page`);
    page();
    const withPage = await cartClaim(go, `sample ${i}, page`);
    const events = await allEvents(go.hub);
    const runs = passRuns(events, withPage);
    holds(runs.length === 0 && withPage.calls.length === 0 && withPage.jobs.length === without.jobs.length,
      `${AC6} ${withPage.claim}, whose diff touches only ${CART}, which ${RESEARCH} (scoped ${NET_SCOPE}), the wiki's one pass, doesn't cover, starts no job: it starts ${runs.length} pass run(s) (${sayPassRuns(runs)}) and `
      + `${withPage.jobs.length} runner job(s), where the same claim with no passes page starts ${without.jobs.length}: ${sayJobs(withPage.jobs)}`);
    gains.push(withPage.stop.ms - without.stop.ms);
  }

  // The passes are live in this hub: a diff the pass covers starts its run. Otherwise nothing above measured them.
  const net = await round(go, 'net', [TRIM], { last: true });
  const events = await allEvents(go.hub);
  must(passRuns(events, net).some((x) => x.pass === RESEARCH), `BLOCKED: ${AC6} the budget is read on a hub that runs the wiki's passes: ${net.claim}, whose diff touches ${FETCH}, must start the ${RESEARCH} pass run, `
    + `and it started ${sayPassRuns(passRuns(events, net))}, so no sample above measured a pass's scope being read. Its runs: ${sayRuns(events, net.claim)}`);

  judge(ctx, `${AC6} ms the passes page adds to the hold of a claim whose diff no pass covers`, gains, LIMIT_MS);
}, 3_600_000);
