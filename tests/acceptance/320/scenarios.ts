// The scenarios of the three criteria the Proof names, shared by their own tests and plants.test.ts: each
// opens its own world, with the planted wrong program when one is given, and closes it.

import { expect } from 'vitest';
import { validate as realValidate, type Validation } from '../../../packages/contracts/src/index.ts';
import {
  cardIn, core, created, DAY, gitRepo, HOUR, inWorld, raised, requestRow, SAM, T0, task, TASK_PARTS, ulid, UNBLOCK_WAIT, YOU,
  type Obj, type Planting, type World,
} from './helpers.ts';

export type Validate = (name: string, value: unknown) => Validation;
/** A second teammate, so two blocks owned by two people get two requests. */
export const LEE = 'lee';

/**
 * #320.dbf54286: in one session the agent raises a task you own and a block Sam owns. Your task reaches your
 * inbox and Needs you; the block reaches neither, and its drafted request, for Sam, reaches both. That holds
 * when they're raised, past the block's deadline, and after the hub restarts on the same record.
 */
export const blockKeptOut = (plant?: Planting): Promise<void> =>
  inWorld(plant, async (w) => {
    await w.start('S1', 'T1');
    const mine = await raised(w, core('S1'), task('gh-auth'), 'a task you own');
    const block = await raised(w, core('S1'), task('staging-db', {
      question: 'The staging database refuses the release job: its credentials expired. Renew them?',
      owner: SAM,
    }), 'a block Sam owns');
    expect((await created(w, block)).data, `block ${block} is recorded as Sam's`).toMatchObject({ kind: 'unblock', owner: SAM });

    const inbox = async (when: string): Promise<string> => {
      const rows = await w.asks.inbox();
      expect(rows.filter((r) => r.ask === block).map((r) => r.owner), `${when}: block ${block}, owned by someone else, never reaches your inbox`).toEqual([]);
      const own = rows.find((r) => r.ask === mine);
      expect(own, `${when}: your own task ${mine} reaches your inbox`).toBeDefined();
      expect(own!.request, `${when}: your own task ${mine} is no drafted request`).toBeNull();
      const request = requestRow(rows, block);
      expect(request, `${when}: the drafted request for block ${block} reaches your inbox`).toBeDefined();
      expect([request!.request!.to, request!.owner], `${when}: the drafted request for block ${block} is for Sam, and waits in your inbox`).toEqual([SAM, YOU]);
      expect(rows.filter((r) => r.request?.block === block), `${when}: block ${block} has one drafted request`).toHaveLength(1);
      return request!.ask;
    };
    const request = await inbox('when raised');
    const shown = (await w.asks.needsYou()).map((c) => c.ask);
    expect(shown, `block ${block}, owned by someone else, never reaches Needs you`).not.toContain(block);
    expect(shown, `the drafted request for block ${block} reaches Needs you`).toContain(request);
    expect(shown, `your own task ${mine} reaches Needs you`).toContain(mine);

    await w.at(T0 + HOUR);
    expect(await inbox('an hour later'), `the drafted request for block ${block} is the same one`).toBe(request);
    await w.at(T0 + UNBLOCK_WAIT + DAY);
    await inbox("past the block's deadline");
    await w.restart();
    await inbox('after the hub restarts');
  });

/**
 * #320.ce2e38fe: a teammate's commit A breaks the release job, and the block (Sam's) is pinned to it. Before you
 * look, Sam's commit B lands in the worktree, so the item has changed: the drafted request, re-checked against its
 * source when it's shown, says so (A to B). A block Lee owns, pinned to B, shows unchanged. Then commit C lands,
 * and each request, shown again, is re-checked again: each says what changed since its own pin.
 */
export const requestRechecked = (plant?: Planting): Promise<void> =>
  inWorld(plant, async (w) => {
    const repo = gitRepo(w.dir);
    const a = repo.commit('db/credentials.ts', 'export const user = "staging";', SAM);
    await w.start('S1', 'T1', repo.path);
    const sams = await raised(w, core('S1'), task('staging-db', { owner: SAM, pinned_to: { kind: 'commit', ref: a } }), 'a block Sam owns, pinned to his commit');
    const b = repo.commit('db/credentials.ts', 'export const user = "staging-2";', SAM);
    const lees = await raised(w, core('S1'), task('fixtures-bucket', { owner: LEE, pinned_to: { kind: 'commit', ref: b } }), 'a block Lee owns, pinned to the newer commit');

    const rows = await w.asks.inbox();
    const samsRequest = requestRow(rows, sams);
    const leesRequest = requestRow(rows, lees);
    expect(samsRequest, `the drafted request for block ${sams} reaches your inbox`).toBeDefined();
    expect(leesRequest, `the drafted request for block ${lees} reaches your inbox`).toBeDefined();

    const shown = async (when: string): Promise<{ sams: Obj | null; lees: Obj | null }> => {
      const cards = await w.asks.needsYou();
      const s = cardIn(cards, samsRequest!.ask);
      const l = cardIn(cards, leesRequest!.ask);
      expect(s, `${when}: the drafted request for block ${sams} shows in Needs you`).toBeDefined();
      expect(l, `${when}: the drafted request for block ${lees} shows in Needs you`).toBeDefined();
      return { sams: s!.changed as Obj | null, lees: l!.changed as Obj | null };
    };
    let seen = await shown('first shown');
    expect(seen.sams, `the drafted request for block ${sams}, whose item changed after it was drafted, says so when it's shown`).toMatchObject({ from: a, to: b, files: ['db/credentials.ts'] });
    expect(seen.lees, `the drafted request for block ${lees}, whose item hasn't changed, says nothing changed`).toBeNull();

    const c = repo.commit('db/credentials.ts', 'export const user = "staging-3";', SAM);
    seen = await shown('shown again');
    expect(seen.lees, `the drafted request for block ${lees} is re-checked against its source each time it's shown, and says its item changed`).toMatchObject({ from: b, to: c, files: ['db/credentials.ts'] });
    expect(seen.sams, `the drafted request for block ${sams}, re-checked again, says what changed since its pin`).toMatchObject({ from: a, to: c });
  });

/** The ask.created version the core writes an unblock task in: the schema a task is held to. */
export async function taskSchemaName(w: World): Promise<string> {
  await w.start('S0', 'T0');
  const whole = await raised(w, core('S0'), task('gh-auth'), 'a task with all its parts');
  return `ask.created@${(await created(w, whole)).v}`;
}

/** An ask.created event carrying this task, as the core writes it. */
export const taskEvent = (name: string, data: Obj): Obj => ({
  v: Number(name.split('@')[1]), id: ulid(T0), kind: 'ask.created', writer: 'core', actor: YOU, scope: YOU, ts: T0,
  data: { ...data, deadline: T0 + UNBLOCK_WAIT },
});

/** Each way a task can lack one of its four parts: the part left out, or present and empty. */
export function lackingTasks(): { part: string; how: string; data: Obj }[] {
  const out: { part: string; how: string; data: Obj }[] = [];
  const EMPTY: Record<(typeof TASK_PARTS)[number], Obj[string]> = { steps: [], where: '', unblocks: [], proves: '' };
  for (const part of TASK_PARTS) {
    const missing = task('gh-auth');
    delete missing[part];
    out.push({ part, how: 'left out', data: missing });
    out.push({ part, how: `empty (${JSON.stringify(EMPTY[part])})`, data: task('gh-auth', { [part]: EMPTY[part] }) });
  }
  return out;
}

/**
 * #320.424a72ad, the schema half: a task with all four parts passes the schema the core writes it in, and a task
 * that lacks any of them, left out or empty, fails it at that part.
 */
export const taskSchemaRefuses = (validate: Validate = realValidate): Promise<void> =>
  inWorld(undefined, async (w) => {
    const name = await taskSchemaName(w);
    expect(validate(name, taskEvent(name, task('gh-auth'))), `${name} takes a task with its steps, where, what it unblocks and its check`).toEqual({ ok: true });
    for (const { part, how, data } of lackingTasks()) {
      const result = validate(name, taskEvent(name, data));
      const at = result.ok ? [] : result.issues.map((i) => i.path);
      expect(at, `a task whose ${part} is ${how} fails ${name}, at /data/${part}`).toContain(`/data/${part}`);
    }
  });
