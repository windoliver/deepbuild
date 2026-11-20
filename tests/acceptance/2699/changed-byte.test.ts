// AC3: a stop on a tree that changed by one byte makes its checkout and runs its checks (README).
//
// The gate runner on the bench (bench.ts): one session, two checks. Its first claim runs both in a checkout of its
// snapshot and both pass, so the claim is PASS. The session then changes one byte of src/price.cjs (`-` to `+`, so the
// total adds the discount) and stops again. The stop must make a checkout of the new snapshot, run both checks there,
// the price check failing on the changed file, and the claim is FAIL. The planted runner `skips-checkout-when-passed`
// (twins.json) skips the checkout whenever the last claim passed and carries its PASS: it fails here, naming the file.
import { afterEach, expect, test } from 'vitest';
import { CODE, CODE_ONE_BYTE, commandsChangingNothing, openBench, PRICE, shownStarts, shownVerdict, SUM, verdict, write, type Bench } from './bench.ts';

const AC3 = 'AC3 #2699.d256b2af';
const CHECKS = [PRICE, SUM];
const FIRST = 'claim:2699B1';
const SECOND = 'claim:2699B2';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 120_000);

test(`${AC3} after a claim whose checks passed, ${CODE} changes by one byte and the session stops: the stop makes its checkout of the new snapshot and runs its checks there, and the claim is judged on the changed ${CODE}, never the last claim's PASS carried`, async (ctx) => verdict(ctx, async () => {
  const b = bench = await openBench();
  await b.stop({ claim: FIRST, checks: CHECKS });
  const first = b.gate.verdictOf(FIRST);
  if (first?.outcome !== 'PASS' || b.starts.filter((s) => s.claim === FIRST && s.outcome === 'passed').length !== CHECKS.length) throw Error(`BLOCKED: ${AC3} the first claim must run both checks and pass: it is ${shownVerdict(first)}; starts: ${shownStarts(b.starts)}`);

  // The turn changes one byte of src/price.cjs, beside a command that changes nothing.
  write(b.repo, { [CODE]: CODE_ONE_BYTE });
  commandsChangingNothing(b.repo);
  await b.count();
  await b.stop({ claim: SECOND, checks: CHECKS });
  const c = await b.counted();

  const v = b.gate.verdictOf(SECOND);
  const seen = `the second claim's verdict is ${shownVerdict(v)}; every start the gate asked for: ${shownStarts(b.starts)}; folders made under the checkouts' folder ${b.root}: ${JSON.stringify(c.checkouts)}`;
  const runs = (check: string) => b.starts.filter((s) => s.claim === SECOND && s.check === check && s.run !== null && s.cwd.startsWith(`${b.root}/`));
  // Its checks run, in a checkout holding the changed file.
  const price = runs(PRICE.check);
  expect(price.map((s) => s.code), `${AC3} ${CODE} changed by one byte since the last claim, so ${PRICE.check} must run for the second claim in a checkout under ${b.root} holding the changed ${CODE}; ${price.length ? '' : `no run of it started there, so the claim carries a result from before ${CODE} changed; `}${seen}`).toEqual([CODE_ONE_BYTE]);
  expect(price.map((s) => s.outcome), `${AC3} ${PRICE.check} fails on the changed ${CODE}, which adds the discount; ${seen}`).toEqual(['failed']);
  expect(runs(SUM.check).map((s) => `${s.outcome} on ${s.code === CODE_ONE_BYTE ? `the changed ${CODE}` : `another ${CODE}`}`), `${AC3} ${SUM.check} runs too, on the changed ${CODE}; ${seen}`).toEqual([`passed on the changed ${CODE}`]);
  // The checkout, counted: one, for the new snapshot.
  expect(c.checkouts, `${AC3} the stop on the tree with ${CODE} changed makes one checkout under ${b.root}; ${seen}`).toHaveLength(1);
  expect(v?.outcome, `${AC3} the claim is judged on the changed ${CODE}, where ${PRICE.check} fails: FAIL, never the last claim's PASS carried; ${seen}`).toBe('FAIL');
}), 900_000);
