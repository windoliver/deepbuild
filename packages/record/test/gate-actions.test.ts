// #2065 regression: a replayable done-gate action must never become an agent's way to change a decision.
import { expect, it } from 'vitest';
import { fixtures } from '@deepbuild/contracts';
import { openRecord, testStorage, type EventInput } from '../src/index.js';

it('an action-bearing ask is core-only, while an ordinary ask still belongs to its caller', async () => {
  const record = await openRecord({ path: 'gate-actions.db', now: () => 1760013451123, storage: testStorage() });
  const as = (writer: string) => ({ writer, actor: 'you', scope: 'you' });
  const event = (value: unknown): EventInput => {
    const { writer: _writer, actor: _actor, scope: _scope, ...input } = value as EventInput & { writer: string; actor: string; scope: string };
    return input;
  };
  try {
    const cases = fixtures('ask.created@5');
    const ordinary = cases.find((e) => !(e as { data: { action?: unknown } }).data.action)!;
    for (const value of cases.filter((e) => (e as { data: { action?: unknown } }).data.action)) {
      for (const writer of ['hook', 'mcp:session1', 'app', 'cli', 'ext:untrusted']) {
        await expect(record.append(as(writer), event(value)), `${writer} cannot attach a done-gate action`).rejects.toMatchObject({ code: 'writer' });
      }
    }
    await record.append(as('mcp:session1'), event(ordinary));
    expect((await record.read({ after: 0, kinds: ['ask.created'] })).length, 'an ordinary ask is still recorded').toBe(1);
  } finally { await record.close(); }
});
