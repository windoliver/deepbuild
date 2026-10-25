// Criterion 2: a task with a cost you pay shows the price.

import { expect, test } from 'vitest';
import { cardIn, core, created, inWorld, raised, task } from './helpers.ts';

test('#320.d9222c7a a task with a cost you pay shows its price on its card in Needs you; a task with none shows no price', async () => {
  await inWorld(undefined, async (w) => {
    await w.start('S1', 'T1');
    const paid = await raised(w, core('S1'), task('model-licence', {
      question: 'Accept the licence for the speech model on its site?',
      steps: ["Accept the speech model's licence on its site, paying its fee", 'Answer "I did it": its download check runs again'],
      where: "the model's site",
      why: 'the narration job needs the model, and its weights download only after the licence is accepted',
      proves: 'speech-model.download',
      cost_usd: 49,
    }), 'a task with a cost you pay');
    const free = await raised(w, core('S1'), task('gh-auth'), 'a task with no cost');
    expect((await created(w, paid)).data, `task ${paid} is recorded with its price`).toMatchObject({ cost_usd: 49 });

    const cards = await w.asks.needsYou();
    expect(cardIn(cards, paid)?.cost_usd, `task ${paid}, with a cost you pay, shows its price in Needs you`).toBe(49);
    expect(cardIn(cards, free)?.cost_usd, `task ${free}, with no cost, shows no price`).toBeNull();
    expect((await w.asks.card(paid)).cost_usd, `task ${paid}'s card shows its price`).toBe(49);
  });
});
