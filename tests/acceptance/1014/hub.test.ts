// The real hub through the Claude Code stand-in (the issue's Proof, second half): hook lines on its socket, a
// SubagentStop payload carrying agent_id, read through `deep status` and the record's tables. One session, one hub run;
// each criterion reads what that run saw at each step.

import { beforeAll, describe, expect, it } from 'vitest';
import { openRecord, PROJECTIONS } from '../../../packages/record/src/index.ts';
import { ClaudeCode, deepStatus, rows, until, withHub, type Hub } from './hub.ts';
import { AC, PLANT, sameOrder, turnBoundary, type Row, type TurnRows, type Walk } from './reading.ts';

const CHILD = 'a84d9054868905e4c';
const AGENT = { description: 'check the tests', prompt: 'run the tests', subagent_type: 'general-purpose' };
const SHELL = { command: 'npm test' };

interface Step { row: Row | undefined; returns: Row[]; turns: TurnRows; status: string | undefined; statusText: string; walk: Walk; stops: Row[] }
interface Seen { atChild: Step; afterCall: Step; atOwn: Step; session: string; live: Record<string, string[]>; rebuilt: Record<string, string[]> }

const stopsOf = (hub: Hub, id: string) => rows(hub, "SELECT id, log_pos, CAST(seq AS TEXT) AS seq, json_extract(data, '$.child') AS child, json_extract(data, '$.turn') AS turn, json_extract(data, '$.cause') AS cause FROM events WHERE kind = 'agent.stop' AND session_id = ? ORDER BY log_pos", id);
const eventsOf = (hub: Hub, id: string) => rows(hub, 'SELECT id, kind FROM events WHERE session_id = ? ORDER BY log_pos', id);
const toolEvents = (hub: Hub, id: string) => eventsOf(hub, id).filter((e) => e.kind === 'tool.before' || e.kind === 'tool.after');

/** What the record and `deep status` say of the session now. */
async function step(hub: Hub, id: string): Promise<Step> {
  const status = await deepStatus(hub, id);
  const stops = stopsOf(hub, id);
  const own = stops.find((s) => s.child === null);
  const prompt = eventsOf(hub, id).find((e) => e.kind === 'user.ask');
  return {
    row: rows(hub, 'SELECT status, cause, ended_log_pos FROM sessions WHERE id = ?', id)[0],
    returns: rows(hub, 'SELECT id, session, turn FROM returns WHERE session = ?', id),
    turns: {
      turns: rows(hub, 'SELECT idx, number, CAST(start_seq AS TEXT) AS start_seq, start_id, CAST(stop_seq AS TEXT) AS stop_seq, stopped FROM turns WHERE session_id = ? ORDER BY idx', id),
      turnEvents: rows(hub, 'SELECT event_id, turn_idx FROM turn_events WHERE session_id = ?', id),
    },
    status: status.state,
    statusText: status.text,
    stops,
    walk: { prompt: String(prompt?.id), calls: toolEvents(hub, id).map((e) => String(e.id)), ...(own ? { stop: { id: String(own.id), seq: String(own.seq), turn: Number(own.turn) } } : {}) },
  };
}

/** The session: a shell call, a subagent run to its SubagentStop inside its Agent call, another shell call, its own stop. */
async function run(hub: Hub): Promise<Omit<Seen, 'live' | 'rebuilt'>> {
  const s = new ClaudeCode(hub);
  try {
    await s.hook('SessionStart', { source: 'startup' });
    await s.prompt('run the tests with a subagent');
    await s.pre('toolu_first', 'Bash', SHELL);
    await s.post('toolu_first', 'Bash', SHELL);
    await s.pre('toolu_agent', 'Agent', AGENT);
    await s.subagentStop(CHILD);
    if (!await until(() => stopsOf(hub, s.id).length >= 1)) throw Error(`no agent.stop for the SubagentStop: ${hub.output()}`);
    const atChild = await step(hub, s.id);
    await s.post('toolu_agent', 'Agent', AGENT);
    await s.pre('toolu_second', 'Bash', SHELL);
    await s.post('toolu_second', 'Bash', SHELL);
    if (!await until(() => toolEvents(hub, s.id).length >= 6)) throw Error(`the calls never reached the record: ${JSON.stringify(eventsOf(hub, s.id))}`);
    const afterCall = await step(hub, s.id);
    await s.ownStop();
    if (!await until(() => stopsOf(hub, s.id).length >= 2)) throw Error(`no agent.stop for the Stop: ${hub.output()}`);
    return { atChild, afterCall, atOwn: await step(hub, s.id), session: s.id };
  } finally { s.end(); }
}

/** Every projection as the live hub left them, then as a rebuild from the record gives them, through the record's public entry. */
async function rebuilt(hub: Hub): Promise<Pick<Seen, 'live' | 'rebuilt'>> {
  await hub.stop();
  const tables = () => sameOrder(Object.fromEntries([...PROJECTIONS, 'turns', 'turn_events'].map((t) => [t, rows(hub, `SELECT * FROM ${t}`)])));
  const live = tables();
  const record = await openRecord({ path: hub.ledger, now: Date.now });
  await record.rebuild();
  await record.close();
  return { live, rebuilt: tables() };
}

describe('the real hub, through Claude Code\'s hook lines, with a SubagentStop carrying agent_id', () => {
  let seen: Seen;
  let failure: unknown;
  const got = (): Seen => { if (failure) throw failure; return seen; };
  beforeAll(async () => {
    try {
      seen = await withHub({}, async (hub) => { const walked = await run(hub); return { ...walked, ...await rebuilt(hub) }; });
    } catch (error) { failure = error; }
  }, 120_000);

  it('the SubagentStop is in the record as the parent session\'s agent.stop, naming the child', () => {
    expect(got().atChild.stops.map((s) => s.child)).toEqual([CHILD]);
    expect(got().atOwn.stops.map((s) => s.child), 'and the session\'s own stop names none').toEqual([CHILD, null]);
  });

  it(`${AC.working} status working, cause NULL and ended_log_pos NULL in sessions until the session's own stop`, () => {
    const { atChild, afterCall, atOwn } = got();
    expect(atChild.row, 'at the child\'s stop').toEqual({ status: 'working', cause: null, ended_log_pos: null });
    expect(afterCall.row, 'at the calls after it').toEqual({ status: 'working', cause: null, ended_log_pos: null });
    const own = atOwn.stops.at(-1)!;
    expect(atOwn.row, 'at the session\'s own stop').toMatchObject({ status: 'finished', cause: own.cause });
    // At the stop or at the core's finished right after it, as a session with no child reads (README, How the issue was read).
    expect(Number(atOwn.row!.ended_log_pos), 'the session ended at or after its own stop').toBeGreaterThanOrEqual(Number(own.log_pos));
  });

  it(`${AC.oneTurn} one turn, from the prompt to the session's own stop, with every tool call before and after the child's stop in it`, () => {
    const { atChild, afterCall, atOwn } = got();
    expect(turnBoundary(atChild.turns, atChild.walk), 'at the child\'s stop').toEqual([]);
    expect(turnBoundary(afterCall.turns, afterCall.walk), 'at the calls after it').toEqual([]);
    expect(turnBoundary(atOwn.turns, atOwn.walk), 'at the session\'s own stop').toEqual([]);
    expect(atOwn.walk.calls, 'three calls, before and after').toHaveLength(6);
  });

  it(`${AC.oneReturn} returns holds one row for the turn, the session's own stop, with its turn number`, () => {
    const { atChild, atOwn, session } = got();
    expect(atChild.returns, 'no return of the session at a child\'s stop').toEqual([]);
    // The session's first turn: "the parent's turn count never includes" the child's stop.
    expect(atOwn.returns, 'the session\'s own stop, turn 1 of a session that ran one turn').toEqual([{ id: atOwn.walk.stop!.id, session, turn: 1 }]);
    expect(atOwn.turns.turns.map((t) => t.number), 'the turns table reads the same number').toEqual([1]);
  });

  it(`${AC.status} deep status lists working while the child's stop is the newest stop, and finished only after the session's own`, () => {
    const { atChild, afterCall, atOwn } = got();
    expect(atChild.stops.at(-1)!.child, 'the newest stop is the child\'s').toBe(CHILD);
    expect(atChild.status, `at the child's stop:\n${atChild.statusText}`).toBe('working');
    expect(afterCall.status, `at the calls after it:\n${afterCall.statusText}`).toBe('working');
    expect(atOwn.status, `at the session's own stop:\n${atOwn.statusText}`).toBe('finished');
  });

  it(`${AC.rebuild} a rebuild from the record gives the same rows as the live projection did`, () => {
    const { live, rebuilt: again } = got();
    expect(live.turns, 'the tables compared hold the session').toHaveLength(1);
    expect(again).toEqual(live);
  });
});

describe('the planted projection, on the real hub', () => {
  it(`${AC.plant} a hub whose projection closes the turn at the child's stop fails these tests naming the turn boundary`, async () => {
    // README, The plant. A base that doesn't list the plant has no such hub: `deep hub run` refuses the name.
    const walked = await withHub({ DEEP_HUB_PLANT: PLANT }, run);
    expect(turnBoundary(walked.atChild.turns, walked.atChild.walk).join('\n')).toMatch(/^turn boundary: /);
    expect(turnBoundary(walked.atOwn.turns, walked.atOwn.walk).join('\n')).toMatch(/^turn boundary: /);
  }, 120_000);
});
