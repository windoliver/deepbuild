// #1580 AC2: a channel with no room for steps gets the item view only, saying where to answer. The channel is the
// planted `watch` (fixtures/watch): a paired device's channel, as paseo's is, that declares it can't draw a plan's
// steps (README, Surfaces). On the merge base every item on a device channel is answerable.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, MINUTE, cleanup, describeItem, planOf, waitFor, world } from './helpers.ts';

afterEach(cleanup, 120_000);

const PUSH = { source: 'effect.push', question: 'Delete the branch feature/1580-old on origin?', plan: planOf('Delete the branch feature/1580-old on origin') } as const;
const CHOICE = { source: 'deep_ask.choice', question: 'Keep the cache in SQLite or in plain files?' } as const;

describe(`${AC[2]} A channel with no room for steps gets the item view only, saying where to answer`, () => {
  it(`${AC[2]} a card with a plan reaches the watch, which can't draw steps, as the item view with no buttons, saying to answer in the app; an ask with no plan stays answerable there`, async () => {
    const w = await world({ channels: ['watch'], seed: [PUSH, CHOICE] });
    const [push, choice] = w.asks as [typeof w.asks[0], typeof w.asks[0]];
    const watch = w.relays.watch!;
    const card = await waitFor(() => watch.latest(push.handle), MINUTE, `${push.handle} on the watch`);
    expect(card.answerable, `the plan's card is the item view only on a channel with no room for steps: ${describeItem(card)}`).toBe('view');
    expect(card.options, 'with no answer buttons').toEqual([]);
    expect(card.summary, 'it shows the item').toContain(push.question);
    expect(card.summary, 'and says where to answer').toMatch(/answer in the app/i);
    const other = await waitFor(() => watch.latest(choice.handle), MINUTE, `${choice.handle} on the watch`);
    expect(other.answerable, `an ask with no plan is answerable on the watch: ${describeItem(other)}`).toBe('answer');
  });
});
