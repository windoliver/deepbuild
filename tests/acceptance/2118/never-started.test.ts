// AC2: a check whose run never started runs again at the next claim on the same tree (README).
//
// The gate runner on the bench (gate.ts): one session, one check. At the first stop the check's start rejects, so the
// claim is BLOCKED on a missing run naming the cause. The cause goes away; the session stops again with no file
// changed, as the hub hands such a stop to the gate (`same`: no work since the last claim). The check must then have
// one real run on the new claim, and the claim's verdict must be made from that run: it is the only run counted, and
// the check's program passes, so the verdict is PASS. On the base the new claim copies the missing run and starts
// nothing.
import { afterEach, expect, test } from 'vitest';
import { openBench, shownStarts, SUM, verdict, type Bench } from './gate.ts';

const AC2 = 'AC2 #2118.bfff8439';
const CAUSE = 'its budget waits for your answer (the test refused this start)';
const FIRST = 'claim:2118N1';
const SECOND = 'claim:2118N2';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 120_000);

test(`${AC2} a claim whose one check's start rejected is BLOCKED on a missing run; the session stops again on the same tree with the start working: the check has one real run on the new claim and the verdict is made from it`, async (ctx) => verdict(ctx, async () => {
  const b = bench = await openBench();

  // Given: the claim's one check never starts, so the claim is BLOCKED on a missing run.
  b.refuse = () => Error(CAUSE);
  await b.stop({ session: 'never-started', claim: FIRST, cwd: b.repo, checks: [SUM] });
  const first = b.gate.verdictOf(FIRST);
  if (first?.outcome !== 'BLOCKED' || !first.reasons.join('\n').includes(CAUSE)) throw Error(`BLOCKED: ${AC2} the first claim must be BLOCKED on its missing run, naming "${CAUSE}": it is ${String(first?.outcome)} (${first?.reasons.join('; ') ?? 'no verdict'}); starts: ${shownStarts(b.starts)}`);

  // When: the cause is gone, and the session stops again with no file changed.
  b.refuse = undefined;
  await b.stop({ session: 'never-started', claim: SECOND, cwd: b.repo, checks: [SUM], same: true });

  const real = b.starts.filter((s) => s.claim === SECOND && s.run !== null);
  const second = b.gate.verdictOf(SECOND);
  const seen = `the new claim's verdict is ${String(second?.outcome)} (${second?.reasons.join('; ') ?? 'no verdict'}); every start the gate asked for: ${shownStarts(b.starts)}`;
  expect(real.map((s) => `${s.check} ${s.outcome ?? 'going'}`), `${AC2} the check has one real run on the new claim, since the run that never started says nothing of the tree; ${seen}`).toEqual(['sum passed']);
  expect(second?.checks.find((c) => c.check === SUM.check)?.counted, `${AC2} the new claim's verdict counts that run and no other; ${seen}`).toEqual([real[0]!.run]);
  expect(second?.outcome, `${AC2} the verdict is made from the real run, which passed; ${seen}`).toBe('PASS');
}), 900_000);
