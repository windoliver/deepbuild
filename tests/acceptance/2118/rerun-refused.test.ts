// AC3: a drift rerun whose run can't start leaves its check BLOCKED on a named missing run, never pending (README).
//
// The gate runner on the bench (gate.ts): a workspace claim (#67) whose one check ran and passed. Its state drifts, so
// rerun() is called for that check with the new reading, and the start rejects. verdictOf(claim) must then be BLOCKED,
// its check BLOCKED with a reason that carries the cause the start rejected with, as a check whose run couldn't start
// reads on a claim's first run. On the base the entry is left with no run and nothing going, which reads as pending.
import { afterEach, expect, test } from 'vitest';
import { openBench, reading, shownStarts, sleep, SUM, verdict, type Bench } from './gate.ts';

const AC3 = 'AC3 #2118.a5258d6e';
const CAUSE = "the claim's checkout is gone (the test refused this start)";
const CLAIM = 'claim:2118R1';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 120_000);

test(`${AC3} a claim whose check ended; rerun() is called for that check and start rejects: verdictOf(claim) is BLOCKED and names the check as one that couldn't start`, async (ctx) => verdict(ctx, async () => {
  const b = bench = await openBench();

  // Given: a claim whose check ended.
  await b.stop({ session: 'rerun-refused', claim: CLAIM, cwd: b.repo, checks: [SUM], state: reading(1) });
  const before = b.gate.verdictOf(CLAIM);
  if (before?.checks.find((c) => c.check === SUM.check)?.outcome !== 'PASS') throw Error(`BLOCKED: ${AC3} the claim's check must have ended, with a passing run, before the rerun: the claim is ${String(before?.outcome)} (${before?.reasons.join('; ') ?? 'no verdict'}); starts: ${shownStarts(b.starts)}`);

  // When: rerun() is called for that check, and start rejects.
  const asked = b.starts.length;
  const told = b.judged.length;
  b.refuse = () => Error(CAUSE);
  if (!b.gate.rerun(CLAIM, [SUM.check], reading(2))) throw Error(`BLOCKED: ${AC3} rerun() must take a claim and check the gate holds: it answered false`);
  // The rerun is over once its start was refused and the gate has read the claim again, or its verdict is made.
  const settled = (): boolean => b.starts.slice(asked).some((s) => s.refused !== null) && (b.judged.length > told || b.gate.verdictOf(CLAIM)?.outcome !== 'pending');
  for (const end = Date.now() + 300_000; !settled() && Date.now() < end;) await sleep(50);
  if (!b.starts.slice(asked).some((s) => s.refused !== null)) throw Error(`BLOCKED: ${AC3} the rerun never asked for its check's start within 300 s; starts: ${shownStarts(b.starts)}`);
  await sleep(200);

  const v = b.gate.verdictOf(CLAIM);
  const check = v?.checks.find((c) => c.check === SUM.check);
  const seen = `verdictOf(${CLAIM}) is ${String(v?.outcome)} (${v?.reasons.join('; ') || 'no reasons'}); its check ${SUM.check} is ${String(check?.outcome)} (${check?.reasons.join('; ') || 'no reasons'}); starts: ${shownStarts(b.starts)}`;
  expect(v?.outcome, `${AC3} after a rerun whose start rejected, the claim is BLOCKED, never pending; ${seen}`).toBe('BLOCKED');
  expect(check?.outcome, `${AC3} its check is BLOCKED; ${seen}`).toBe('BLOCKED');
  expect(check?.reasons.join('\n'), `${AC3} the check is named as one that couldn't start, with the cause its start rejected with; ${seen}`).toContain(CAUSE);
}), 900_000);
