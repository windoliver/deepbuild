// AC3: a test resolver that answers an authority ask without naming an active decision of that ask's kind and
// scope is refused by the core, and the ask reaches you; the same answer naming such a decision is applied and
// logged as decided for you.
//
// The resolver is fixtures/resolver, a first-party package in the hub that registers through `deep.registerResolver`
// and answers as the test tells it to. A decision of the ask's kind and scope is one you saved from your approval of
// the same question (its key) in a session of the same repo, at repo scope (README, Readings: what covers an ask).
import { describe, it } from 'vitest';
import { mergeAsk } from './helpers.ts';
import { appliedAndLogged, openResolving, refusedAndReachesYou, type Resolving } from './resolving.ts';

// One world for the file, opened by its first test (not in a beforeAll, so at the base each test fails, never skips).
let shared: Resolving | undefined;
const resolving = async (): Promise<Resolving> => (shared ??= await openResolving());

describe('AC3 #349.27abd805 a resolver answering an authority ask without naming an active decision of its kind and scope is refused and the ask reaches you; naming one, the answer is applied and logged as decided for you', () => {
  it('AC3 a resolver that answers approve naming no decision is refused by the core, nothing is applied, and the ask reaches you', async () => {
    const r = await resolving();
    r.play({ answer: 'approve', because: null });
    const { ask } = await r.ask();
    await refusedAndReachesYou(r, ask, null);
  }, 120_000);

  it('AC3 a resolver naming an active decision of another kind (saved from a merge ask) is refused for a push ask, naming the decision, and the ask reaches you', async () => {
    const r = await resolving();
    r.play({ skip: true });
    const merge = await r.ask(r.repo, 'effect.merge', mergeAsk());
    const other = await r.decide(merge.ask, 'repo');
    r.play({ answer: 'approve', because: other });
    const { ask } = await r.ask();
    await refusedAndReachesYou(r, ask, other);
  }, 120_000);

  it('AC3 the same answer naming an active decision of the ask\'s kind and scope is applied: decision.applied names it, the ask is logged as decided for you, and the answer reaches the agent', async () => {
    const r = await resolving();
    r.play({ skip: true });
    const earlier = await r.ask();
    const decision = await r.decide(earlier.ask, 'repo');
    r.play({ answer: 'approve', because: decision });
    const { ask } = await r.ask();
    await appliedAndLogged(r, ask, decision);
  }, 120_000);
});
