// #14: what append accepts and refuses (AC1, AC2, AC16, AC27), identity and order (AC11), 64-bit stamps
// (AC10) and the database's own refusal of UPDATE and DELETE (AC18).
import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { openRecord, testStorage, toJson } from '../../../packages/record/src/index.ts';
import type { EventInput, RecordStore } from '../../../packages/record/src/index.ts';
import {
  agentStop, allEvents, app, core, countEvents, ext, expectRefused, fromFixture, hook, makeClock, SECOND, seqAt, T0,
  toolAfter, ulidAt, userAsk,
} from './helpers.ts';

async function fresh(): Promise<{ record: RecordStore; clock: ReturnType<typeof makeClock> }> {
  const clock = makeClock();
  const record = await openRecord({ path: 'record.db', now: clock.now, storage: testStorage() });
  return { record, clock };
}
const S = ulidAt(T0 - SECOND);   // the session under test

describe('AC1 an event that fails its schema is rejected', () => {
  it('AC1 a tool.after without paths, and an event of an unknown kind, are refused naming the pointer, and nothing is appended', async () => {
    const { record } = await fresh();
    const bad = toolAfter(T0, 'shell', [], 'npm test');
    delete (bad.data as { paths?: unknown }).paths;
    const err = await expectRefused(record.append(hook(S), bad), 'schema', {}, 'tool.after without paths');
    expect(err.path, 'names a pointer under /data').toMatch(/^\/data/);
    await expectRefused(record.append(hook(S), { ...toolAfter(T0, 'shell', [], 'x'), kind: 'tool.exploded' }), 'schema', { path: '/kind' }, 'an unknown kind');
    // A store that doesn't validate appends the event.
    expect(await countEvents(record), 'nothing was appended').toBe(0);
    const ok = await record.append(hook(S), toolAfter(T0, 'shell', [], 'npm test'));
    expect(ok.log_pos).toBeGreaterThan(0);
    expect(await countEvents(record)).toBe(1);
  });
});

describe('AC2 a payload that sets its own actor or scope is rejected', () => {
  it('AC2 actor and scope come from the connection; a payload carrying either is refused naming it, a payload writer is ignored', async () => {
    const { record } = await fresh();
    const base = toolAfter(T0, 'shell', [], 'npm test');
    await expectRefused(record.append(hook(S), { ...base, actor: 'someone' } as EventInput), 'forged', { path: '/actor' }, 'a payload with actor');
    await expectRefused(record.append(hook(S), { ...base, scope: 'everyone' } as EventInput), 'forged', { path: '/scope' }, 'a payload with scope');
    // A store that trusts the payload stores actor "someone".
    expect(await countEvents(record), 'nothing was appended').toBe(0);
    const connection = hook(S, { actor: 'maintainer', scope: 'project:app' });
    await record.append(connection, base);
    // Done when: "a forged writer field is ignored".
    const forged = { ...toolAfter(T0 + 1, 'read', ['src/a.ts'], null), writer: 'core' } as EventInput;
    await record.append(connection, forged);
    const events = await allEvents(record);
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.actor, 'actor from the credential').toBe('maintainer');
      expect(e.scope, 'scope from the credential').toBe('project:app');
      expect(e.writer, 'writer from the connection, never the payload').toBe('hook');
    }
  });
});

describe('AC16 a payload that sets log_pos is refused', () => {
  it('AC16 log_pos: 1 in the payload is refused naming the field, nothing is appended, and the hub assigns the next position itself', async () => {
    const { record } = await fresh();
    await expectRefused(record.append(hook(S), { ...toolAfter(T0, 'shell', [], 'ls'), log_pos: 1 } as EventInput), 'forged', { path: '/log_pos' }, 'a payload with log_pos 1');
    // A store that keeps the payload's log_pos has appended an event at 1 here.
    expect(await countEvents(record), 'nothing was appended').toBe(0);
    const first = await record.append(hook(S), toolAfter(T0, 'shell', [], 'ls'));
    expect(Number.isInteger(first.log_pos) && first.log_pos >= 1).toBe(true);
    await expectRefused(record.append(hook(S), { ...toolAfter(T0 + 1, 'shell', [], 'ls'), log_pos: first.log_pos + 1 } as EventInput), 'forged', { path: '/log_pos' }, 'a payload with the next log_pos');
    expect((await allEvents(record)).map((e) => e.log_pos)).toEqual([first.log_pos]);
  });
});

describe('AC27 only the core appends the kinds that record a decision', () => {
  const KINDS = ['verdict.made', 'definition.locked', 'decision.created', 'ask.answered', 'verdict.stale', 'definition.revised', 'decision.applied', 'ask.defaulted'];
  it.each(KINDS)('AC27 %s from ext:done-gate is refused naming the kind and nothing is appended; the same from the core appends', async (kind) => {
    const { record } = await fresh();
    const before = await countEvents(record);
    // A record that checks only the writer's grant lets a first-party extension's verdict in.
    await expectRefused(record.append(ext('done-gate'), fromFixture(kind, T0)), 'writer', { kind }, `${kind} from ext:done-gate`);
    await expectRefused(record.append(app(), fromFixture(kind, T0)), 'writer', { kind }, `${kind} from the app`);
    expect(await countEvents(record), `${kind}: nothing was appended`).toBe(before);
    const ok = await record.append(core(), fromFixture(kind, T0));
    expect(ok.log_pos).toBeGreaterThan(0);
    const events = await allEvents(record);
    expect(events.map((e) => [e.kind, e.writer])).toEqual([[kind, 'core']]);
  });
});

describe('AC10 64-bit stamps are kept exactly', () => {
  const STAMPS = ['1760013451123456789', '1760013451123456790', '9007199254740991', '9007199254740992', '9007199254740993'];
  it('AC10 stamps read back as exact bigints, print back in the record\'s JSON, and survive a replay; a store reading seq as a number fails', async () => {
    const { record } = await fresh();
    await record.append(hook(S), userAsk(T0, 1, 'go', seqAt(T0 - 10)));
    const ids: string[] = [];
    for (const [i, seq] of STAMPS.entries()) {
      const input = toolAfter(T0 + i, 'shell', [], `step ${i}`, seq);
      ids.push(input.id);
      await record.append(hook(S), input);
    }
    const check = async (when: string) => {
      const events = (await allEvents(record)).filter((e) => e.kind === 'tool.after');
      expect(events.map((e) => e.id), `${when}: the stamped events are all there, as separate events`).toEqual(ids);
      for (const [i, e] of events.entries()) {
        // A store that reads seq as a JavaScript number returns 1760013451123456768n for the first two.
        expect(typeof e.seq, `${when}: seq is a bigint`).toBe('bigint');
        expect(e.seq, `${when}: stamp ${STAMPS[i]} read back exactly`).toBe(BigInt(STAMPS[i]!));
        const json = JSON.parse(toJson(e)) as { seq: unknown; log_pos: unknown; id: unknown };
        expect(json.seq, `${when}: the record's JSON carries the stamp as its decimal string`).toBe(STAMPS[i]);
        expect(json.id).toBe(e.id);
        expect(typeof json.log_pos).toBe('number');
      }
    };
    await check('after the append');
    await record.rebuild();
    await check('after the replay');
  });
});

describe('AC11 identity and order', () => {
  it('AC11 two events of one session with the same seq and different IDs are both kept in ID order, live and after dropping every projection', async () => {
    const { record } = await fresh();
    await record.append(hook(S), userAsk(T0, 1, 'start'));
    const seq = seqAt(T0 + SECOND);
    const first = toolAfter(T0 + SECOND, 'read', ['a.ts'], null, seq);   // minted first: the lower ID
    const second = toolAfter(T0 + SECOND, 'read', ['b.ts'], null, seq);  // minted next: the higher ID
    expect(first.id < second.id).toBe(true);
    await record.append(hook(S), second);   // the higher ID arrives first
    await record.append(hook(S), first);
    const order = async (when: string) => {
      const view = await record.session(S);
      expect(view, `${when}: the session is known`).toBeDefined();
      const ids = view!.turns.flatMap((t) => t.events).filter((id) => id === first.id || id === second.id);
      // A store that drops the tie keeps one; one that orders by arrival puts the higher ID first.
      expect(ids, `${when}: both kept, in the order of their IDs`).toEqual([first.id, second.id]);
      expect(await countEvents(record), `${when}: three events`).toBe(3);
    };
    await order('live');
    await record.rebuild();
    await order('after the rebuild');
  });

  it('AC11 the same ID appended twice (a spool replayed again after a crash) is one event; the same ID with other content is refused naming the ID', async () => {
    const { record } = await fresh();
    const event = toolAfter(T0, 'shell', [], 'npm test');
    const first = await record.append(hook(S), event);
    expect(first.existing).toBe(false);
    const again = await record.append(hook(S), structuredClone(event));
    expect(again.existing, 'the second append says the ID was already in the log').toBe(true);
    expect(again.log_pos, 'one event, one position').toBe(first.log_pos);
    // A store that appends the duplicate shows two events here.
    expect(await countEvents(record)).toBe(1);
    const other = { ...event, data: { kind: 'shell', paths: [], command: 'rm -rf build' } as JsonValue };
    await expectRefused(record.append(hook(S), other), 'conflict', { id: event.id }, 'the same ID with other content');
    const events = await allEvents(record);
    expect(events).toHaveLength(1);
    expect((events[0]!.data as { command: string }).command, 'the first content stays').toBe('npm test');
  });
});

describe('AC18 the database refuses UPDATE and DELETE on events', () => {
  it('AC18 an UPDATE or DELETE sent through the store\'s own connection is refused, leaving the row as it was', async () => {
    const { record } = await fresh();
    await record.append(hook(S), userAsk(T0, 1, 'hello'));
    const stop = agentStop(T0 + SECOND, S, 1);
    const { log_pos } = await record.append(hook(S), stop);
    const before = await allEvents(record);
    const count = await record.raw('SELECT count(*) AS n FROM events');
    expect(count, 'the store\'s own connection reads the events table').toHaveLength(1);
    // A store that only lacks an update method lets these through.
    await expect(record.raw(`UPDATE events SET data = '{"turn":9,"did_work":false}' WHERE log_pos = ${log_pos}`), 'UPDATE is refused by the database').rejects.toThrow();
    await expect(record.raw(`DELETE FROM events WHERE log_pos = ${log_pos}`), 'DELETE is refused by the database').rejects.toThrow();
    await expect(record.raw('DELETE FROM events'), 'DELETE of everything is refused by the database').rejects.toThrow();
    const after = await allEvents(record);
    expect(after.map((e) => [e.id, e.log_pos, JSON.stringify(e.data)])).toEqual(before.map((e) => [e.id, e.log_pos, JSON.stringify(e.data)]));
  });
});
