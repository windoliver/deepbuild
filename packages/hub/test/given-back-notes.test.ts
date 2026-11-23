// #3309: your notes from the app that a prompt's reply carried, when deep-hook never read that reply, go with the
// session's next prompt, ahead of notes sent since, even when that prompt is set aside for its transcript entry (#567).
// The acceptance suite (tests/acceptance/3309/note.test.ts) proves the usual order end to end; this is the set-aside
// prompt, which the given-back notes must not stop from taking the notes still waiting.
import { expect, it } from 'vitest';
import { AnswerDelivery, type AnswerDeliveryOptions } from '../src/answer-delivery.js';
import type { Draft } from '../src/wire.js';

function delivery() {
  const live = new Map([['s1', {}]]);
  const options = {
    settings: { held: [] },
    services: { now: () => Date.UTC(2026, 10, 23, 12), record: { raw: async () => [] } },
    events: { append: async () => undefined, connection: () => ({}) },
    state: () => ({ live, sessions: new Map(), acks: new Map(), midTurn: new Map(), turnsStarted: new Map(), onScreen: new Map() }),
    schedule: { queue: async () => undefined, askingSoon: () => undefined },
  };
  return new AnswerDelivery(options as unknown as AnswerDeliveryOptions);
}

it('#3309 a set-aside prompt takes the notes a lost reply gave back and the notes sent since, each once', async () => {
  const d = delivery();
  d.inPromptReply('hook-1', 's1', [], [], false, { notes: [{ session: 's1', text: 'Keep the Lisbon rate.', request: 'r1' }] });
  d.promptReplyGone('hook-1');
  await d.note({ session: 's1', text: 'Round to cents.', request: 'r2' });
  const held: Draft[] = [{ kind: 'user.ask', v: 1, id: '01K74FKZVK8Q2X5R7M3N9P0001', ts: 0, data: { msg: 0, text: 'Then run the tests.', tasks: [], from: 'person' }, fill: 'msg' } as unknown as Draft];
  const notes = d.takeCarried('s1', held);
  expect(notes?.map((n) => n.request), 'the given-back note first, then the one sent since').toEqual(['r1', 'r2']);
  expect(held.filter((x) => x.kind === 'user.ask' && x.data.request === 'r2').length, 'the note sent since is recorded with this prompt').toBe(1);
  expect(d.takeCarried('s1'), 'taken once').toBeUndefined();
});

it('#3309 a note a lost reply gave back outlives the session\'s end and goes with the first prompt of its resume', () => {
  const d = delivery();
  d.inPromptReply('hook-1', 's1', [], [], true, { notes: [{ session: 's1', text: 'Keep the Lisbon rate.', request: 'r1' }] });
  d.track({ id: 'hook-2', event: 'SessionEnd', session: 's1', agent: 'claude-code', cwd: '' } as unknown as Parameters<AnswerDelivery['track']>[0]);
  expect(d.takeCarried('s1')?.map((n) => n.request), 'the resumed session\'s first prompt carries it').toEqual(['r1']);
});
