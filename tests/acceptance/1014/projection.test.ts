// The record's projection through its public entry, over a recorded session with a SubagentStop between two tool calls
// (the issue's Proof, first half). The child's stop here failed, stuck on a block of yours, with a cause of its own:
// the hardest stop for a projection that reads every agent.stop as the session's own.

import { afterEach, describe, expect, it } from 'vitest';
import { fixtures, type JsonValue } from '../../../packages/contracts/src/index.ts';
import { openRecord, PROJECTIONS, testStorage, ulid } from '../../../packages/record/src/index.ts';
import type { Connection, EventInput, RecordOptions, RecordStore } from '../../../packages/record/src/index.ts';
import { AC, PLANT, sameOrder, turnBoundary, type Row, type TurnRows, type Walk } from './reading.ts';

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const CHILD = 'a84d9054868905e4c';
type Data = Record<string, JsonValue>;
const fixture = (schema: string, pick: (d: Data) => boolean = () => true): Data => {
  const found = (fixtures(schema) as { data: Data }[]).find((f) => pick(f.data));
  if (!found) throw Error(`no fixture of ${schema} fits`);
  return found.data;
};
const OWN = fixture('agent.stop@5', (d) => d.outcome === 'finished' && d.owner === undefined && d.child === undefined);
const CHILDS = fixture('agent.stop@5', (d) => d.outcome === 'failed' && d.owner === 'you');

const open: RecordStore[] = [];
afterEach(async () => { for (const r of open.splice(0)) await r.close(); });

/** One session's events, stamped in order, appended to a real record on test storage as the hub's hook connection appends them. */
class Recorded {
  readonly id = ulid(T0);
  private at = T0;
  private readonly hook: Connection = { writer: 'hook', actor: 'you', scope: 'you', session: this.id, agent: 'claude-code' };
  private constructor(readonly record: RecordStore) {}
  static async open(options: Partial<RecordOptions> = {}): Promise<Recorded> {
    const record = await openRecord({ path: 'record.db', now: () => T0, storage: testStorage(), ...options });
    open.push(record);
    return new Recorded(record);
  }
  private async append(kind: string, v: number, data: Data, subject = false): Promise<{ id: string; seq: string; log_pos: number }> {
    this.at += 1000;
    const event: EventInput = { v, id: ulid(this.at), kind, ts: this.at, seq: `${BigInt(this.at) * 1_000_000n}`, data, ...(subject ? { subject: `session:${this.id}` } : {}) };
    const { log_pos } = await this.record.append(this.hook, event);
    return { id: event.id, seq: event.seq!, log_pos };
  }
  start = () => this.append('session.start', 4, { ...fixture('session.start@4'), loads: [] });
  prompt = () => this.append('user.ask', 2, { msg: 1, text: 'run the tests', tasks: [], from: 'person' });
  /** One tool call, its two events; resolves with their IDs. */
  async call(name: string): Promise<string[]> {
    const call = `toolu_${name}`;
    const before = await this.append('tool.before', 3, { kind: 'shell', paths: [], command: 'npm test', call });
    const after = await this.append('tool.after', 3, { kind: 'shell', paths: [], command: 'npm test', call, outcome: 'ok' });
    return [before.id, after.id];
  }
  stop = (data: Data, v = 5) => this.append('agent.stop', v, data, true);
  childStop = () => this.stop({ ...CHILDS, turn: 1, child: CHILD });
  ownStop = () => this.stop({ ...OWN, turn: 1 });

  private async query(sql: string): Promise<Row[]> { return await this.record.raw(sql, [this.id]) as Row[]; }
  async row(): Promise<Row> {
    const [row] = await this.query('SELECT status, cause, ended_log_pos FROM sessions WHERE id = ?');
    return row!;
  }
  returns = () => this.query('SELECT id, session, turn FROM returns WHERE session = ?');
  async turnRows(): Promise<TurnRows> {
    return {
      turns: await this.query('SELECT idx, number, CAST(start_seq AS TEXT) AS start_seq, start_id, CAST(stop_seq AS TEXT) AS stop_seq, stopped FROM turns WHERE session_id = ? ORDER BY idx'),
      turnEvents: await this.query('SELECT event_id, turn_idx FROM turn_events WHERE session_id = ?'),
    };
  }
  /** Every projection's rows, the reading of turns with them. */
  async tables(): Promise<Record<string, string[]>> {
    const all: Record<string, Row[]> = {};
    for (const name of PROJECTIONS) all[name] = (await this.record.table(name)).rows;
    for (const name of ['turns', 'turn_events']) all[name] = await this.record.raw(`SELECT * FROM ${name}`) as Row[];
    return sameOrder(all);
  }
}

/** The session up to the child's stop: a call before it; the turn is still running. */
async function upToChildsStop(options: Partial<RecordOptions> = {}): Promise<{ s: Recorded; walk: Walk; childStop: string }> {
  const s = await Recorded.open(options);
  await s.start();
  const prompt = await s.prompt();
  const calls = await s.call('before');
  const childStop = await s.childStop();
  return { s, walk: { prompt: prompt.id, calls }, childStop: childStop.id };
}
/** The rest of it: a call after the child's stop, and the session's own stop. */
async function toOwnStop(s: Recorded, walk: Walk): Promise<{ walk: Walk; log_pos: number; id: string }> {
  const calls = await s.call('after');
  const stop = await s.ownStop();
  return { walk: { ...walk, calls: [...walk.calls, ...calls], stop: { id: stop.id, seq: stop.seq, turn: 1 } }, log_pos: stop.log_pos, id: stop.id };
}

describe('the projection, over a session whose subagent stops between two tool calls', () => {
  it(`${AC.working} status working, cause NULL and ended_log_pos NULL until the session's own stop`, async () => {
    const { s, walk } = await upToChildsStop();
    expect(await s.row(), 'at the child\'s stop').toEqual({ status: 'working', cause: null, ended_log_pos: null });
    await s.call('after');
    expect(await s.row(), 'at a call after the child\'s stop').toEqual({ status: 'working', cause: null, ended_log_pos: null });
    const stop = await s.ownStop();
    expect(await s.row(), 'at the session\'s own stop, as if there were no child').toEqual({ status: 'finished', cause: OWN.cause, ended_log_pos: stop.log_pos });
    expect(walk.calls).toHaveLength(2);
  });

  it(`${AC.oneTurn} one turn, from the prompt to the session's own stop, with every tool call before and after the child's stop in it`, async () => {
    const { s, walk, childStop } = await upToChildsStop();
    expect(turnBoundary(await s.turnRows(), walk), 'the turn is open at the child\'s stop').toEqual([]);
    const end = await toOwnStop(s, walk);
    expect(turnBoundary(await s.turnRows(), end.walk)).toEqual([]);
    expect(end.walk.calls).toHaveLength(4);
    // The child's stop stays in the record, as an event like any other.
    expect((await s.record.read({ after: 0, kinds: ['agent.stop'] })).map((e) => e.id)).toEqual([childStop, end.id]);
  });

  it(`${AC.oneReturn} returns holds one row for the turn, the session's own stop, with its turn number`, async () => {
    const { s, walk } = await upToChildsStop();
    expect(await s.returns(), 'no return of the session at a child\'s stop').toEqual([]);
    const end = await toOwnStop(s, walk);
    expect(await s.returns()).toEqual([{ id: end.id, session: s.id, turn: 1 }]);
  });

  it(`${AC.rebuild} a rebuild gives the same rows as the live projection did, mid-turn and after the turn`, async () => {
    const { s, walk } = await upToChildsStop();
    const midTurn = await s.tables();
    await s.record.rebuild();
    expect(await s.tables(), 'rebuilt with the child\'s stop the newest stop').toEqual(midTurn);
    // The turn a rebuild read back open is the one the session's own stop closes.
    const end = await toOwnStop(s, walk);
    expect(turnBoundary(await s.turnRows(), end.walk)).toEqual([]);
    const live = await s.tables();
    expect(live.turns, 'the tables read hold the turn').toHaveLength(1);
    await s.record.rebuild();
    expect(await s.tables(), 'rebuilt after the session\'s own stop').toEqual(live);
  });

  it(`${AC.plant} a planted projection that closes the turn at the child's stop fails these tests naming the turn boundary`, async () => {
    // README, The plant: `openRecord` takes `plant`. A record that ignores it reads the turn right and this test fails.
    const { s, walk } = await upToChildsStop({ plant: PLANT } as Partial<RecordOptions>);
    const atChild = turnBoundary(await s.turnRows(), walk);
    const end = await toOwnStop(s, walk);
    const atEnd = turnBoundary(await s.turnRows(), end.walk);
    expect(atChild.join('\n'), `the plant ${PLANT} left the turn open at the child's stop`).toMatch(/^turn boundary: /);
    expect(atEnd.join('\n'), `the plant ${PLANT} left one turn to the session's own stop`).toMatch(/^turn boundary: /);
  });
});

describe('the issue\'s Scope', () => {
  it.each([1, 4])('an agent.stop@%i, with no child field, reads as it does today: it ends the session\'s turn', async (v) => {
    const s = await Recorded.open();
    await s.start();
    const prompt = await s.prompt();
    const calls = await s.call('before');
    const stopData = fixture(`agent.stop@${v}`);
    expect(stopData.child, 'the old stop names no child').toBeUndefined();
    const stop = await s.stop({ ...stopData, turn: 1, ...(v === 1 ? {} : { outcome: 'finished' }) }, v);
    expect(await s.row()).toEqual({ status: 'finished', cause: stopData.cause ?? null, ended_log_pos: stop.log_pos });
    expect(await s.returns()).toEqual([{ id: stop.id, session: s.id, turn: 1 }]);
    expect(turnBoundary(await s.turnRows(), { prompt: prompt.id, calls, stop: { id: stop.id, seq: stop.seq, turn: 1 } })).toEqual([]);
  });

  it('a child\'s stop after the session\'s own changes nothing of the session: no status, end, cause, return or turn', async () => {
    const { s, walk } = await upToChildsStop();
    const end = await toOwnStop(s, walk);
    const before = { row: await s.row(), returns: await s.returns(), turns: await s.turnRows() };
    await s.childStop();
    expect({ row: await s.row(), returns: await s.returns(), turns: await s.turnRows() }).toEqual(before);
    expect(turnBoundary(before.turns, end.walk)).toEqual([]);
  });
});
