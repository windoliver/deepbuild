// AC23: a prompt the adapter can't place is `from: unknown` and opens no ask; one you typed is `person` and opens
// one. A prompt you typed has its transcript entry (the user entry whose promptId is the payload's prompt_id, with
// turnOrigin human, as Claude Code 2.1.304 writes it); the unplaced one has a prompt_id no entry carries, and no
// origin field the facts name. "Opens an ask" is read on the prompt's user.ask: its `tasks` names the ask it opens,
// and is empty when it opens none. Through deep-hook into `deep hub run`, read with `events.read`.
import { afterAll, describe, expect, it } from 'vitest';
import { AC23, cleanup, failureOf, kindOf, makeHome, Session, settle, shown, startHub, type Ev, type Hub } from './helpers.ts';

afterAll(cleanup, 60_000);

const TYPED = 'Add a dark mode toggle to the settings page.';
const UNPLACED = 'Summarize what changed in the cart module since yesterday.';

async function twoPrompts(hub: Hub): Promise<{ s: Session; events: Ev[] }> {
  const s = new Session(hub.home);
  await s.start();
  await s.prompt(TYPED, 'human');
  await s.stop('Added the toggle.');
  await s.prompt(UNPLACED, null);
  await s.stop('The cart module changed in two places.');
  const asks = (all: Ev[]) => kindOf(all, s.id, 'user.ask');
  // A prompt's origin may wait on its transcript entry, which can lag the hook: given time to settle.
  const events = await settle(hub, (all) => asks(all).length >= 2 && asks(all).every((e) => e.data.from !== undefined) && asks(all).some((e) => e.data.from === 'person'), { minMs: 5000, timeoutMs: 45_000 });
  return { s, events };
}
const askFor = (events: Ev[], s: Session, text: string) => kindOf(events, s.id, 'user.ask').find((e) => e.data.text === text);

/** The assertions the test and its wrong program share, each naming the prompt it reads. */
function typedOpensAnAsk(events: Ev[], s: Session): void {
  const typed = askFor(events, s, TYPED);
  expect(typed?.data.from, `the prompt "${TYPED}" was typed, matched to its transcript entry: ${shown(typed)}`).toBe('person');
  expect(Array.isArray(typed!.data.tasks) && typed!.data.tasks.length > 0, `the typed prompt "${TYPED}" opens an ask (its user.ask names it in tasks): ${shown(typed)}`).toBe(true);
}
function unplacedOpensNone(events: Ev[], s: Session): void {
  const unplaced = askFor(events, s, UNPLACED);
  expect(unplaced, `the prompt "${UNPLACED}" is recorded`).toBeDefined();
  expect(unplaced!.data.from, `the prompt "${UNPLACED}" matches no transcript entry and carries no origin field, so it is from: unknown: ${shown(unplaced)}`).toBe('unknown');
  expect(unplaced!.data.tasks, `the unplaced prompt "${UNPLACED}" opens no ask: ${shown(unplaced)}`).toEqual([]);
}

describe(`${AC23} an unplaced prompt is from: unknown and opens no ask; a typed one is person and opens one`, () => {
  it(`${AC23} the typed prompt is person and opens an ask; the unplaced prompt is from: unknown and opens none`, async () => {
    const hub = await startHub(makeHome());
    const { s, events } = await twoPrompts(hub);
    typedOpensAnAsk(events, s);
    unplacedOpensNone(events, s);
  }, 120_000);

  it(`${AC23} (wrong program) an adapter that reads an unplaced prompt as person (DEEP_HUB_PLANT=unplaced-is-person) opens an ask nobody typed and fails this test, naming the prompt`, async () => {
    const hub = await startHub(makeHome(), 'unplaced-is-person');
    const { s, events } = await twoPrompts(hub);
    // The plant changes only the unplaced prompt: the typed one still reads as the real adapter reads it.
    typedOpensAnAsk(events, s);
    const failure = await failureOf(() => unplacedOpensNone(events, s));
    expect(failure, 'the planted adapter must fail the unplaced-prompt assertion').not.toBeNull();
    expect(failure, 'the failure names the prompt').toContain(UNPLACED);
    const unplaced = askFor(events, s, UNPLACED);
    expect(unplaced?.data.from, `the plant reads it as person: ${shown(unplaced)}`).toBe('person');
  }, 120_000);
});
