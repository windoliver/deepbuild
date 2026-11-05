// #325 AC7: budgets, on the reference Mac in the local preflight, compared with the merge base: judging a definition
// with 20 requirements against its runs takes under 50 ms, and pricing a definition under 100 ms.
//
// Both are pure rules, so this is a fast test on the gate's public entry (packages/gate/src/index.ts): judging is its
// `claimVerdict` (#30), which the base already has; pricing is `priceDefinition` (README, Pricing a definition), which
// it doesn't. Each is timed as the median of 9 calls after one warm-up, and each result is checked, so a function that
// returns nothing fast fails. A reading over its budget while other work loads the machine past its core count is
// taken again once; still over and still loaded, it is INCONCLUSIVE, never a fail (design: a timing check under load).
// The harness is itself shown to fail on a planted slow judge.
import { describe, it } from 'vitest';
import * as gate from '../../../packages/gate/src/index.ts';
import type { ClaimedCheck, ClaimedRuns, ClaimRequirement, RecordedRun } from '../../../packages/gate/src/index.ts';
import { AC7, Inconclusive, failureOf, loadReading, loaded, must, sha256, verdict, type PaidKind } from './helpers.ts';

/** The surface this criterion adds (README, Pricing a definition). */
interface PricedRequirement { id: string; check: string | null; paid?: PaidKind }
interface Pricing { total_usd: number | null; checks: { req: string; check: string; paid: PaidKind; usd: number | null }[] }
type PriceDefinition = (requirements: readonly PricedRequirement[], price: (check: { check: string; paid: PaidKind }) => Promise<number | null>) => Promise<Pricing>;
const priceDefinition = (gate as unknown as { priceDefinition?: PriceDefinition }).priceDefinition;

const N = 20;
const KINDS: PaidKind[] = ['live call', 'hosted browser run', 'model job'];
const hex = (s: string) => sha256(s);

/** A run as the command check kind records it. */
function recorded(id: number, passed: boolean): RecordedRun {
  return {
    run: `run:01JR${String(id).padStart(22, '0')}`, outcome: passed ? 'passed' : 'failed', testsRun: 3,
    failures: passed ? [] : [{ test: `case ${id}`, file: `tests/r${id}.test.js`, line: 7, stack: null, assertion: true, message: `expected 401, got 200 (${id})` }],
    evidence: [], read: [`src/r${id}.js`], mask: null, exit: { code: passed ? 0 : 1, signal: null, cause: 'exit' },
    output: { stdout: '', stderr: '', sha256: { stdout: hex(`out ${id}`), stderr: hex(`err ${id}`) } }, attempts: [], seeded: [], contract: null,
  };
}
/** A claim on a definition with 20 requirements, each judged by a check of its own with three runs; R7 and R15 fail on every run. */
function claim20(): ClaimedRuns {
  const failing = new Set([7, 15]);
  const requirements: ClaimRequirement[] = [];
  const checks: ClaimedCheck[] = [];
  for (let i = 1; i <= N; i++) {
    requirements.push({ req: `req:01JQTASK#R${i}`, depth: 'unit', oracle: 'code', on_base: 'passes' });
    checks.push({
      check: `.deepbuild/checks/r${i}.sh`, command: `sh .deepbuild/checks/r${i}.sh`, source: 'definition', covers: [`req:01JQTASK#R${i}`], depth: 'unit', proof: 'test_run',
      runs: [0, 1, 2].map((k) => recorded(i * 10 + k, !failing.has(i))), state: 'ended',
    });
  }
  return { claim: 'claim:01JQCLAIM', agent: 'claude-code', repo: '/tmp/dh325-repo', task: 'task:01JQTASK', commit: 'a'.repeat(40), requirements, checks, now: 1_790_000_000_000 };
}
const DEFINITION: PricedRequirement[] = Array.from({ length: N }, (_, i) => (i % 5 === 3 ? { id: `R${i + 1}`, check: `.deepbuild/checks/r${i + 1}.sh` } : { id: `R${i + 1}`, check: `.deepbuild/checks/r${i + 1}.sh`, paid: KINDS[i % 3]! }));
const PRICE = (check: string): number => 1 + (Number(/r(\d+)\.sh$/.exec(check)?.[1] ?? 0) % 7);

async function median(fn: () => unknown, runs = 9): Promise<{ median: number; all: number[] }> {
  await fn();
  const all: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    all.push(performance.now() - t0);
  }
  const sorted = [...all].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)]!, all };
}
/** The reading holds its budget; over it while loaded, taken once more; still over and loaded is INCONCLUSIVE. */
async function within(what: string, budgetMs: number, fn: () => unknown): Promise<void> {
  let t = await median(fn);
  if (t.median >= budgetMs && loaded()) t = await median(fn);
  const reading = `median ${t.median.toFixed(2)} ms of ${t.all.length} (${t.all.map((x) => x.toFixed(1)).join(', ')}), ${loadReading()}`;
  if (t.median >= budgetMs && loaded()) throw new Inconclusive(`${AC7} ${what}: ${reading}, over ${budgetMs} ms while the machine is loaded past its cores`);
  must(t.median < budgetMs, `${AC7} ${what} takes under ${budgetMs} ms: ${reading}`);
}

describe(`${AC7} judging a 20-requirement definition under 50 ms, pricing one under 100 ms`, () => {
  it(`${AC7} judging a definition with 20 requirements against its 60 runs (claimVerdict) takes under 50 ms, and its verdict names both failing requirements`, async (ctx) => {
    await verdict(ctx, async () => {
      const input = claim20();
      const v = gate.claimVerdict(input);
      must(v.requirements.length === N, `${AC7} the verdict judges all ${N} requirements: ${v.requirements.length}`);
      must(v.outcome === 'FAIL', `${AC7} two requirements' checks failed on every run, so the verdict is FAIL: ${v.outcome} ${v.reasons.join('; ').slice(0, 400)}`);
      for (const r of ['R7', 'R15']) must(v.requirements.some((q) => q.req.endsWith(`#${r}`) && q.outcome === 'FAIL'), `${AC7} ${r} is judged FAIL: ${JSON.stringify(v.requirements.map((q) => [q.req, q.outcome]))}`);
      await within('judging a definition with 20 requirements against its runs', 50, () => gate.claimVerdict(claim20()));
    });
  });

  it(`${AC7} pricing a definition with 20 requirements, 16 of them paid (priceDefinition), takes under 100 ms and prices exactly the paid checks`, async (ctx) => {
    await verdict(ctx, async () => {
      must(typeof priceDefinition === 'function', `${AC7} the gate's public entry prices a definition: packages/gate/src/index.ts exports no priceDefinition (README, Pricing a definition)`);
      const looked: string[] = [];
      const lookup = async (c: { check: string; paid: PaidKind }) => { looked.push(c.check); return PRICE(c.check); };
      const p = await priceDefinition!(DEFINITION, lookup);
      const paid = DEFINITION.filter((r) => r.paid);
      must(paid.length === 16, `BLOCKED: ${AC7} the fixture has 16 paid requirements`);
      must(JSON.stringify(p.checks.map((c) => [c.req, c.check, c.paid, c.usd])) === JSON.stringify(paid.map((r) => [r.id, r.check, r.paid, PRICE(r.check!)])), `${AC7} the pricing lists each paid check with its kind and price, in the definition's order, and no other: ${JSON.stringify(p.checks).slice(0, 600)}`);
      const total = paid.reduce((sum, r) => sum + PRICE(r.check!), 0);
      must(p.total_usd === total, `${AC7} the definition's price is the sum of its paid checks', $${total}: ${p.total_usd}`);
      must(looked.length === 16 && looked.every((c) => paid.some((r) => r.check === c)), `${AC7} only paid checks are priced: looked up ${JSON.stringify(looked)}`);
      await within('pricing a definition with 20 requirements', 100, () => priceDefinition!(DEFINITION, async (c) => PRICE(c.check)));
    });
  });

  it(`${AC7} (wrong program) the timing reading fails on a judge that takes 60 ms`, async (ctx) => {
    await verdict(ctx, async () => {
      const slow = () => { const t0 = performance.now(); while (performance.now() - t0 < 60) { /* a judge too slow for its budget */ } return gate.claimVerdict(claim20()); };
      const message = await failureOf(() => within('judging (planted slow judge)', 50, slow));
      must(message !== null && /takes under 50 ms/.test(message), `${AC7} a judge that takes 60 ms fails the 50 ms budget: ${message ?? 'it passed'}`);
    });
  });
});
