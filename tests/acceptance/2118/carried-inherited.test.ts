// AC1: a spec check's failure carried from another session runs on the merge base, so a failure main shares reads as
// inherited (README).
//
// The gate runner on the bench (gate.ts): one repo whose main is broken (`total` ignores the discount), and two
// sessions in two linked worktrees of it, each with its own edit to README.md, a file the repo's spec check doesn't
// read. So the two claims hold equal keys for that check: the same repo, command, installs and file names, and the
// same contents of the files its run reads. Session A stops first: the check runs on its snapshot and fails, runs on
// the merge base and fails there too, and A's claim is BLOCKED as inherited. Then session B stops: its claim reads A's
// result as carried and starts no run of the check on its own snapshot. B's verdict must be BLOCKED too, its check
// marked inherited and naming the failing test. On the base no merge-base result reaches B's claim, so it is FAIL.
import { afterEach, expect, test } from 'vitest';
import { openBench, PRICE, PRICE_TEST, shownStarts, verdict, write, type Bench } from './gate.ts';

const AC1 = 'AC1 #2118.b16df21c';
const CLAIM_A = 'claim:2118CA';
const CLAIM_B = 'claim:2118CB';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 120_000);

test(`${AC1} two sessions with equal keys for a spec check that fails on the head and on the merge base: the second session's claim reads the first's result as carried, and its verdict is BLOCKED naming the failure as also on the merge base`, async (ctx) => verdict(ctx, async () => {
  const b = bench = await openBench();
  const other = b.worktree('session-b');
  write(b.repo, { 'README.md': '# shop\n\nSession A is adding its notes here.\n' });
  write(other, { 'README.md': '# shop\n\nSession B is adding other notes here.\n' });

  // Given: session A's claim ran the spec check, which fails on its snapshot and on the merge base.
  await b.stop({ session: 'carried-a', claim: CLAIM_A, cwd: b.repo, checks: [PRICE] });
  const first = b.gate.verdictOf(CLAIM_A);
  const ranA = b.starts.filter((s) => s.claim === CLAIM_A);
  const given = ranA.length === 2 && ranA.every((s) => s.outcome === 'failed') && ranA.filter((s) => s.base).length === 1
    && first?.outcome === 'BLOCKED' && first.checks.find((c) => c.check === PRICE.check)?.inherited === true;
  if (!given) throw Error(`BLOCKED: ${AC1} session A's claim must run the spec check once on its snapshot and once on the merge base, both failing, and be BLOCKED as inherited: it is ${String(first?.outcome)} (${first?.reasons.join('; ') ?? 'no verdict'}); starts: ${shownStarts(b.starts)}`);

  // When: session B stops, and its claim reads A's result as carried.
  await b.stop({ session: 'carried-b', claim: CLAIM_B, cwd: other, checks: [PRICE] });
  const ownHead = b.starts.filter((s) => s.claim === CLAIM_B && !s.base);
  const v = b.gate.verdictOf(CLAIM_B);
  const check = v?.checks.find((c) => c.check === PRICE.check);
  const seen = `session B's verdict is ${String(v?.outcome)} (${v?.reasons.join('; ') || 'no reasons'}); its check ${PRICE.check} is ${String(check?.outcome)}, inherited ${String(check?.inherited)} (${check?.reasons.join('; ') || 'no reasons'}); session A's verdict was ${first.outcome} (${first.reasons.join('; ')}); starts: ${shownStarts(b.starts)}`;
  if (ownHead.length || !check?.counted.includes(ranA.find((s) => !s.base)!.run!)) throw Error(`BLOCKED: ${AC1} session B's claim must read session A's result as carried, starting no run of the check on its own snapshot and counting A's run: the two keys weren't equal; ${seen}`);

  expect(v?.outcome, `${AC1} a failure carried from another session, which the merge base shares, is BLOCKED as inherited, never the claim's own FAIL; ${seen}`).toBe('BLOCKED');
  expect(check?.inherited, `${AC1} the check reads as inherited: its failure is also on the merge base; ${seen}`).toBe(true);
  expect(check?.reasons.join('\n'), `${AC1} the verdict names the failure, "${PRICE_TEST}"; ${seen}`).toContain(PRICE_TEST);
}), 900_000);
