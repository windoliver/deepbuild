// AC1 and AC2: deep.asks.create from a sandboxed test extension (test/caller) raises an ask through the asks core,
// written as that extension, and held to the ask schema: one that carries an answer or an outcome is refused.
// Needs you is the asks core's `needsYou()`; the writer is read back from the record's ask.created event.
import { describe, expect, it } from 'vitest';
import { AC1, AC2, callAs, choiceAsk, NOT_WIRED, openHost } from './helpers.ts';

const WRITER = 'ext:test/caller';

describe(`AC1 ${AC1} a test extension's deep.asks.create with a choice ask opens an ask in Needs you, written as that extension`, () => {
  it('AC1 the choice ask is in Needs you, and its ask.created is written as ext:test/caller', async () => {
    const { w, h } = await openHost();
    const [call] = await callAs(h, [{ method: 'deep.asks.create', args: [choiceAsk('Which store for the walk?')] }]);
    expect({ outcome: call?.outcome, error: call?.error }, 'deep.asks.create answers the choice ask').toEqual({ outcome: 'ok', error: null });
    const handle = call!.value as string;
    expect(handle, 'deep.asks.create returns the ask\'s handle').toMatch(/^ask:[0-9A-Z]+$/);
    const card = (await w.asks.needsYou()).find((c) => c.ask === handle);
    expect(card?.kind, 'the ask is in Needs you, as a choice').toBe('choice');
    const created = (await w.events('ask.created')).filter((e) => `ask:${e.id}` === handle || e.subject === handle);
    expect(created.map((e) => e.writer), 'its one ask.created is written as the extension').toEqual([WRITER]);
  }, 120_000);
});

describe(`AC2 ${AC2} an ask the extension creates that carries an answer or an outcome is refused, naming the field`, () => {
  for (const [field, value] of [['answer', 'files'], ['outcome', 'answered']] as const) {
    it(`AC2 an ask carrying ${field} is refused, naming ${field}, and no ask opens`, async () => {
      const { w, h } = await openHost();
      const question = `Which store, already ${field}?`;
      const [call] = await callAs(h, [{ method: 'deep.asks.create', args: [{ ...choiceAsk(question), [field]: value }] }]);
      expect(call?.outcome, 'the ask is refused').toBe('error');
      expect(call?.error ?? '', 'the refusal is the asks core\'s, not the host\'s not-wired error').not.toContain(NOT_WIRED);
      expect(call?.error ?? '', `the refusal names the field ${field}`).toContain(field);
      const opened = (await w.events('ask.created')).filter((e) => (e.data as { question?: string }).question === question);
      expect(opened, 'no ask opened').toEqual([]);
    }, 120_000);
  }
});
