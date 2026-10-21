// #14: turns and order within a session (AC12, AC13, AC21) and one locked definition per task (AC5).
import { describe, expect, it } from 'vitest';
import { openRecord, PROJECTIONS, testStorage } from '../../../packages/record/src/index.ts';
import type { RecordStore, SessionView } from '../../../packages/record/src/index.ts';
import {
  agentStop, app, claimMade, core, definitionLocked, firstTableDifference, hook, makeClock, rowsBy, SECOND, seqAt,
  sessionStart, sha256, snapshot, T0, taskCreated, toolAfter, toolBefore, ulidAt, userAsk, verdictMade,
} from './helpers.ts';

async function fresh(): Promise<RecordStore> {
  return openRecord({ path: 'record.db', now: makeClock().now, storage: testStorage() });
}
async function view(record: RecordStore, session: string): Promise<SessionView> {
  const v = await record.session(session);
  expect(v, `session ${session} is known to the record`).toBeDefined();
  return v!;
}
/** A stopped turn with a claim and its verdict: the state AC12 and AC13 hold still. */
async function stoppedTurn(record: RecordStore, S: string, at: number, turn: number): Promise<{ stopSeq: string; verdictId: string }> {
  await record.append(hook(S), userAsk(at, turn, `prompt ${turn}`));
  await record.append(hook(S), toolBefore(at + SECOND, 'shell', [], 'npm test'));
  await record.append(hook(S), toolAfter(at + 2 * SECOND, 'shell', [], 'npm test'));
  const stopSeq = seqAt(at + 3 * SECOND);
  await record.append(hook(S), agentStop(at + 3 * SECOND, S, turn, stopSeq));
  const claim = claimMade(at + 3 * SECOND + 1, 'task:01K74FX2B4D6F8H0K2M4P6R8T0', turn);
  await record.append(app(S), claim);
  const verdict = verdictMade(at + 3 * SECOND + 2, claim.id, 'PASS', ['every requirement passed']);
  await record.append(core(), verdict);
  return { stopSeq, verdictId: verdict.id };
}
const sameTables = async (record: RecordStore, names: readonly string[], why: string) => {
  const live = await snapshot(record, names);
  await record.rebuild();
  const rebuilt = await snapshot(record, names);
  expect(firstTableDifference(live, rebuilt), `${why}: live equals the rebuild`).toBeUndefined();
};

describe('AC12 a late PostToolUse is recorded in its stopped turn', () => {
  it('AC12 a PostToolUse whose hook started before the Stop but arrives after it joins that turn: the turn stays finished, no turn opens, the verdict stands', async () => {
    const record = await fresh();
    const S = ulidAt(T0 - SECOND);
    await record.append(hook(S), sessionStart(T0 - SECOND, S));
    await stoppedTurn(record, S, T0, 1);
    const before = await view(record, S);
    const verdictsBefore = await record.table('verdicts');
    const claimsBefore = await record.table('claims');
    expect(before.turns).toHaveLength(1);
    expect(before.turns[0]!.stopped).toBe(true);

    // Its hook started at T0 + 2.5 s, before the stop at T0 + 3 s; it reaches the hub at T0 + 10 s.
    const late = toolAfter(T0 + 10 * SECOND, 'edit', ['src/app.ts'], null, seqAt(T0 + 2500));
    await record.append(hook(S), late);
    const check = async (when: string) => {
      const after = await view(record, S);
      // A store that reopens the turn, or opens a new one for the late event, differs here.
      expect(after.turns.length, `${when}: no turn opened`).toBe(1);
      expect(after.turns[0]!.stopped, `${when}: the turn stays finished`).toBe(true);
      expect(after.turns[0]!.events, `${when}: recorded in that turn`).toContain(late.id);
      const verdicts = await record.table('verdicts');
      expect(verdicts.rows, `${when}: the stop's verdict doesn't change`).toEqual(verdictsBefore.rows);
      expect((await record.table('claims')).rows, `${when}: the claim doesn't change`).toEqual(claimsBefore.rows);
    };
    await check('live');
    await record.rebuild();
    await check('after the rebuild');
  });
});

describe('AC13 the wall clock stepped back between a Stop and the next prompt', () => {
  it('AC13 the new turn and its events stay after the stopped turn, in arrival order; the session reads "clock went back"; the stopped turn and its verdict don\'t change', async () => {
    const record = await fresh();
    const S = ulidAt(T0 - SECOND);
    await record.append(hook(S), sessionStart(T0 - SECOND, S));
    await stoppedTurn(record, S, T0, 1);       // its stop is stamped T0 + 3 s
    const first = await view(record, S);
    const verdictsBefore = await record.table('verdicts');
    expect(first.readings, 'no reading yet').not.toContain('clock went back');

    // The clock steps back 5 s: the next prompt and its events are stamped before the stop.
    const back = T0 + 3 * SECOND - 5 * SECOND;
    const prompt = userAsk(back, 2, 'prompt 2', seqAt(back));
    const t1 = toolBefore(back + 500, 'read', ['README.md'], null, seqAt(back + 500));
    const t2 = toolAfter(back + 900, 'read', ['README.md'], null, seqAt(back + 900));
    for (const e of [prompt, t1, t2]) await record.append(hook(S), e);
    const check = async (when: string) => {
      const v = await view(record, S);
      expect(v.turns.length, `${when}: a second turn opened`).toBe(2);
      // A store that orders turns by their stamps puts the new turn first.
      expect(v.turns[0]!.events, `${when}: the stopped turn's events don't change`).toEqual(first.turns[0]!.events);
      expect(v.turns[0]!.stopped, `${when}: the stopped turn stays stopped`).toBe(true);
      expect(v.turns[1]!.stopped, `${when}: the new turn is open`).toBe(false);
      expect(v.turns[1]!.events, `${when}: the new turn's events, in arrival order`).toEqual([prompt.id, t1.id, t2.id]);
      expect(v.readings, `${when}: the session shows a "clock went back" reading`).toContain('clock went back');
      expect((await record.table('verdicts')).rows, `${when}: the stopped turn's verdict doesn't change`).toEqual(verdictsBefore.rows);
    };
    await check('live');
    await record.rebuild();
    await check('after the rebuild');
  });
});

describe('AC21 a stamp never moves an event before the start of its turn', () => {
  it('AC21 an event stamped 2 s before its turn\'s start, arriving after two events of that turn, sorts after both by log_pos though its ID is earlier', async () => {
    const record = await fresh();
    const S = ulidAt(T0 - SECOND);
    await record.append(hook(S), sessionStart(T0 - SECOND, S));
    const prompt = userAsk(T0, 1, 'prompt 1');   // the turn starts at T0
    const a = toolAfter(T0 + SECOND, 'read', ['a.ts'], null);
    const b = toolAfter(T0 + 2 * SECOND, 'read', ['b.ts'], null);
    const early = toolAfter(T0 + 3 * SECOND, 'read', ['c.ts'], null, seqAt(T0 - 2 * SECOND));
    early.id = ulidAt(T0 - 2 * SECOND);   // minted 2 s before the turn, as its stamp says
    expect(early.id < prompt.id && early.id < a.id).toBe(true);
    for (const e of [prompt, a, b, early]) await record.append(hook(S), e);
    const check = async (when: string) => {
      const v = await view(record, S);
      expect(v.turns, `${when}: one turn`).toHaveLength(1);
      const ids = v.turns[0]!.events;
      // An order that breaks ties by ID, or sorts by seq alone, puts the early-stamped event first.
      expect(ids, `${when}: turn ${v.turns[0]!.turn ?? 1} of session ${S}: the early-stamped event sorts after both`).toEqual([prompt.id, a.id, b.id, early.id]);
    };
    await check('live');
    await record.rebuild();
    await check('after the rebuild');
  });
});

describe('AC5 a task\'s second attempt reads the same locked definition as its first', () => {
  it('AC5 one definitions row per task, shared by both attempts; a later lock for the task doesn\'t replace it', async () => {
    const record = await fresh();
    const task = `task:${ulidAt(T0)}`;
    const thread = ulidAt(T0);
    const hash = sha256('the locked definition');
    await record.append(app(), taskCreated(T0, task, thread));
    await record.append(core(), definitionLocked(T0 + 1, task, hash));
    const s1 = ulidAt(T0 + 2), s2 = ulidAt(T0 + 3);
    await record.append(hook(s1), sessionStart(T0 + 2, s1));
    await record.append(app(s1), claimMade(T0 + SECOND, task, 1, 'task'));
    await record.append(hook(s2), sessionStart(T0 + 2 * SECOND, s2));
    await record.append(app(s2), claimMade(T0 + 3 * SECOND, task, 2, 'task'));
    // A store that drafts a definition per attempt has two rows for the task here.
    const definitions = rowsBy(await record.table('definitions'), 'task_ref', task);
    expect(definitions, 'one definition for the task').toHaveLength(1);
    expect(definitions[0]!.hash).toBe(hash);
    const attempts = rowsBy(await record.table('attempts'), 'task_ref', task);
    expect(attempts.map((r) => Number(r.attempt)).sort(), 'both attempts are on the task').toEqual([1, 2]);
    expect(attempts.map((r) => String(r.session_id)).sort()).toEqual([s1, s2].sort());

    // A second lock for the same task can't change the definition after the lock (Ask-task: It can never).
    await record.append(core(), definitionLocked(T0 + 4 * SECOND, task, sha256('another definition'))).catch(() => undefined);
    const again = rowsBy(await record.table('definitions'), 'task_ref', task);
    expect(again, 'still one definition for the task').toHaveLength(1);
    expect(again[0]!.hash, 'the first lock stands').toBe(hash);
    await sameTables(record, PROJECTIONS, 'AC5');
  });
});
