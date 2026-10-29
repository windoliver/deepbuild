// #23.d5c718b3 an answer is saved for its repo and widens only on your confirmation; #23.6ab3f608 your overrule
// holds at that ask's scope while the overruled decision answers elsewhere; #23.86908fce two decisions, or two
// resolvers, that disagree answer nothing and the ask reaches you with both.

import { test } from 'vitest';
import { inWorld } from './helpers.ts';
import { overruled, savedForRepo, twoDecisions, twoResolvers } from './scenarios.ts';

test('#23.d5c718b3 an answer is saved for its repo, even when the agent\'s text claims all your repos; the same question in another repo reaches you with it suggested, and is answered there only once you confirm the wider scope', async () => {
  await inWorld(savedForRepo);
});

test('#23.6ab3f608 after you overrule a decision on one ask in repo A, your answer, saved for repo A, answers the next such ask there, and the overruled decision still answers in repo C', async () => {
  await inWorld(async (w) => { await overruled(w); });
});

test('#23.86908fce two active decisions of one kind that match an ask and disagree answer nothing: it reaches you showing both, and your answer there overrules the other only there', async () => {
  await inWorld(twoDecisions);
});

test('#23.86908fce two resolvers that match one ask and answer differently answer nothing, and the ask reaches you with both', async () => {
  await inWorld(twoResolvers, {}, { resolver: false });
});
