// AC7: a test resolver that names a revoked decision of the ask's kind and scope, and one that names an active
// decision saved in another repo, are each refused by the core, and the ask reaches you; a core that checks only
// that the named decision exists applies both and fails, naming the decision.
//
// Revocation is your answer on the trusted path, `Asks.revokeDecision`, recorded as decision.revoked. Another repo
// is another worktree the session started in (README, Readings: what covers an ask). The planted core is the asks
// core opened with `plant: 'decision-exists-only'`.
import { describe, expect, it } from 'vitest';
import { YOU } from './helpers.ts';
import { appliedAndLogged, openResolving, refusedAndReachesYou, type Resolving } from './resolving.ts';

let shared: Resolving | undefined;
const resolving = async (): Promise<Resolving> => (shared ??= await openResolving());

/** A decision of the push ask's kind at repo scope, revoked; then a push ask in that repo with a resolver naming it. */
async function revokedCase(r: Resolving): Promise<{ ask: string; decision: string }> {
  r.play({ skip: true });
  const earlier = await r.ask();
  const decision = await r.decide(earlier.ask, 'repo');
  await r.w.asks.revokeDecision(YOU, decision);
  const revoked = (await r.w.events('decision.revoked')).filter((e) => (e.data as { decision: string }).decision === decision);
  expect(revoked.length, `the record holds the revocation of ${decision}`).toBe(1);
  r.play({ answer: 'approve', because: decision });
  return { ask: (await r.ask()).ask, decision };
}
/** A decision saved at repo scope in the other repo; then a push ask in this repo with a resolver naming it. */
async function otherRepoCase(r: Resolving): Promise<{ ask: string; decision: string }> {
  r.play({ skip: true });
  const elsewhere = await r.ask(r.otherRepo);
  const decision = await r.decide(elsewhere.ask, 'repo');
  r.play({ answer: 'approve', because: decision });
  return { ask: (await r.ask(r.repo)).ask, decision };
}

describe('AC7 #349.70f6262e a resolver naming a revoked decision, or an active one saved in another repo, is refused and the ask reaches you; a core checking only that the decision exists applies both and fails naming the decision', () => {
  it('AC7 a resolver naming a revoked decision of the ask\'s kind and scope is refused, naming the decision, and the ask reaches you', async () => {
    const r = await resolving();
    const { ask, decision } = await revokedCase(r);
    await refusedAndReachesYou(r, ask, decision);
  }, 120_000);

  it('AC7 a resolver naming an active decision saved in another repo is refused, naming the decision, and the ask reaches you; in its own repo the same decision applies', async () => {
    const r = await resolving();
    const { ask, decision } = await otherRepoCase(r);
    await refusedAndReachesYou(r, ask, decision);
    const own = await r.ask(r.otherRepo);
    await appliedAndLogged(r, own.ask, decision);
  }, 120_000);

  it('AC7 (wrong program) a core that checks only that the named decision exists applies the revoked one and the other repo\'s, and fails this test naming each decision', async () => {
    const planted = await openResolving({ plant: 'decision-exists-only' });
    const revoked = await revokedCase(planted);
    await expect(refusedAndReachesYou(planted, revoked.ask, revoked.decision)).rejects.toThrow(revoked.decision);
    const other = await otherRepoCase(planted);
    await expect(refusedAndReachesYou(planted, other.ask, other.decision)).rejects.toThrow(other.decision);
  }, 120_000);
});
