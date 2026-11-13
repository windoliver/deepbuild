// A retried write that was refused gets its refusal back and writes nothing (#1577): a late answer to a closed ask,
// sent again with its request ID, as a phone that lost the reply does, is refused naming the first answer, and the
// record keeps the one answer.refused the first send wrote.
import { afterAll, expect, it } from 'vitest';
import { cleanup, eventsOf, newRequest, signedCall, world } from '../../../tests/acceptance/1577/helpers.ts';

afterAll(cleanup, 120_000);

it('a late answer sent again with its request ID is refused as the first was, and answer.refused is recorded once', async () => {
  const w = await world({ asks: [{ source: 'deep_ask.choice', question: 'Keep the retry journal in SQLite or in plain files?' }] });
  const ask = w.asks[0]!;
  const first = await signedCall(w, w.device, 'ask.answer', { ask: ask.handle, option: 'sqlite', request: newRequest() });
  expect(first.error, 'the app answers first').toBeUndefined();
  const request = newRequest();
  const late = await signedCall(w, w.phone, 'ask.answer', { ask: ask.handle, option: 'files', request });
  expect(JSON.stringify(late.error), "the phone's late answer is refused, naming the first").toMatch(/\bsqlite\b/);
  const again = await signedCall(w, w.phone, 'ask.answer', { ask: ask.handle, option: 'files', request });
  expect(again.error, 'its retry gets the same refusal back').toEqual(late.error);
  expect((await eventsOf(w, 'answer.refused', ask.handle)).length, 'the retry wrote no second answer.refused').toBe(1);
  expect((await eventsOf(w, 'ask.answered', ask.handle)).map((e) => e.data.answer), 'the first answer stands').toEqual(['sqlite']);
}, 600_000);
