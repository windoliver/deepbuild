// #570 AC2: "A move no table row allows is refused and recorded, naming the object, its state and the event: a
// planted handler that moves a defaulted ask to answered is refused, naming the ask and `defaulted`, and a hub
// that sets state directly accepts it and fails this test".
// The hub moves objects by appending to its record, so the test drives a real @deepbuild/record. The planted
// handler is the append below: the core's ask.answered for an ask the core already defaulted. The hub that sets
// state directly is the merge base: its projection writes the event's status into the asks row whatever the row
// held (README: Wrong programs).
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import { cleanup, closeRecords, core, fixtureData, ID, json, newId, openScratchRecord, readTable, tryAppend } from './helpers.ts';

afterEach(closeRecords);
afterAll(cleanup);

const HOUR = 3_600_000;

describe(`${ID.refused} a move no table row allows is refused and recorded, naming the object, its state and the event`, () => {
  it(`${ID.refused} ask.machine@1 has no row that moves a defaulted ask on ask.answered`, () => {
    const ask = readTable('ask');
    const rows = ask.moves.filter((m) => m.from === 'defaulted' && m.event === 'ask.answered');
    expect(rows, 'no row of ask.machine@1 lets an answer move a defaulted ask').toEqual([]);
  });

  it(`${ID.refused} a planted handler that moves a defaulted ask to answered is refused, naming the ask and defaulted, and the refusal is recorded`, async () => {
    const { record, path, clock } = await openScratchRecord();
    const askId = newId(clock.now());
    await record.append(core(), { v: 4, id: askId, kind: 'ask.created', ts: clock.now(), data: { ...fixtureData('ask.created@4'), deadline: clock.now() + HOUR } });
    clock.step(HOUR + 1);
    await record.append(core(), { v: 1, id: newId(clock.now()), kind: 'ask.defaulted', subject: `ask:${askId}`, ts: clock.now(), data: { answer: 'hold', plan_hash: null, decision: 'deny' } });
    const before = (await record.table('asks')).rows.find((r) => r.id === askId);
    expect(before?.status, `the ask is defaulted before the handler runs: ${json(before)}`).toBe('defaulted');

    // The planted handler: the core's answer to the ask it already defaulted.
    clock.step(1000);
    const answerId = newId(clock.now());
    const thrown = await tryAppend(record, core(), { v: 4, id: answerId, kind: 'ask.answered', subject: `ask:${askId}`, ts: clock.now(), data: fixtureData('ask.answered@4') });

    const after = (await record.table('asks')).rows.find((r) => r.id === askId);
    expect(after?.status, `the answer is refused: the ask stays defaulted${thrown ? ` (append threw: ${thrown.message})` : ''}\n${json(after)}`).toBe('defaulted');

    const events = await record.read({ after: 0 });
    const refusals = events.filter((e) => e.kind === 'move.refused');
    expect(refusals.length, `the refusal is recorded as a move.refused event; the log holds ${events.map((e) => e.kind).join(', ')}`).toBeGreaterThan(0);
    const named = refusals.filter((e) => { const text = json(e.data); return text.includes(askId) && text.includes('"defaulted"') && text.includes('ask.answered'); });
    expect(named.length, `a move.refused names the ask (${askId}), its state (defaulted) and the event (ask.answered): ${refusals.map((e) => json(e.data)).join('\n')}`).toBe(1);
    expect(named[0]!.writer, 'the core records the refusal').toBe('core');

    // The refusal stands when the projections are rebuilt from the log, and when the record is opened again.
    await record.rebuild();
    expect((await record.table('asks')).rows.find((r) => r.id === askId)?.status, 'rebuilt from the log, the ask is still defaulted').toBe('defaulted');
    await record.close();
    const again = await openRecord({ path, now: clock.now });
    try {
      await again.rebuild();
      expect((await again.table('asks')).rows.find((r) => r.id === askId)?.status, 'opened again, the ask is still defaulted').toBe('defaulted');
    } finally {
      await again.close();
    }
  });

  it(`${ID.refused} an answer to an open ask is a move the table allows: it lands, and nothing is refused`, async () => {
    const ask = readTable('ask');
    expect(ask.moves.some((m) => m.from !== 'defaulted' && m.event === 'ask.answered' && m.to === 'answered'), 'ask.machine@1 lets an answer move an ask still waiting to answered').toBe(true);
    const { record, clock } = await openScratchRecord();
    const askId = newId(clock.now());
    await record.append(core(), { v: 4, id: askId, kind: 'ask.created', ts: clock.now(), data: { ...fixtureData('ask.created@4'), deadline: clock.now() + HOUR } });
    clock.step(1000);
    await record.append(core(), { v: 4, id: newId(clock.now()), kind: 'ask.answered', subject: `ask:${askId}`, ts: clock.now(), data: fixtureData('ask.answered@4') });
    expect((await record.table('asks')).rows.find((r) => r.id === askId)?.status, 'the open ask is answered').toBe('answered');
    const refusals = (await record.read({ after: 0 })).filter((e) => e.kind === 'move.refused');
    expect(refusals, 'no move is refused').toEqual([]);
  });
});
