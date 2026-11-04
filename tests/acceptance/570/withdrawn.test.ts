// #570 AC7: "The ask-task table reaches `withdrawn` only from an event your trusted path appended; a planted handler
// that withdraws a task on an agent's message is refused, naming the task and the event".
// Through a real @deepbuild/record. Your trusted path writes as `app` (the task's row or card) or `cli`; the planted
// handlers append task.withdrawn through the agent's connections (`mcp:<session>`, `hook`) and as the core acting on
// an agent's message (README: The surface).
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Connection } from '../../../packages/record/src/index.ts';
import { app, cleanup, cli, closeRecords, core, hook, ID, json, mcp, newId, openScratchRecord, readTable, tryAppend } from './helpers.ts';

afterEach(closeRecords);
afterAll(cleanup);

/** A record holding one open ask-task; resolves with its task_ref. */
async function withTask() {
  const opened = await openScratchRecord();
  const { record, clock } = opened;
  const task = `task:${newId(clock.now())}`;
  await record.append(core(), { v: 1, id: newId(clock.now()), kind: 'task.created', ts: clock.now(), data: { task_ref: task, thread: 'T1', owner: 'you', title: 'Lifecycle tables' } });
  const row = (await record.table('tasks')).rows.find((r) => r.task_ref === task);
  expect(row?.state, `the task is open before the withdrawal: ${json(row)}`).toBeDefined();
  expect(row?.state, 'an open task is not withdrawn').not.toBe('withdrawn');
  return { ...opened, task, open: row!.state as string };
}
const withdrawal = (task: string, ms: number) => ({ v: 1, id: newId(ms), kind: 'task.withdrawn', subject: task, ts: ms, data: {} });

describe(`${ID.withdrawn} the ask-task table reaches withdrawn only from an event your trusted path appended`, () => {
  it(`${ID.withdrawn} ask_task.machine@1 has withdrawn among its final states, reached only by task.withdrawn under a guard`, () => {
    const t = readTable('ask_task');
    expect(t.final, 'withdrawn is a final state of ask_task.machine@1').toContain('withdrawn');
    const into = t.moves.filter((m) => m.to === 'withdrawn');
    expect(into.length, 'a move reaches withdrawn').toBeGreaterThan(0);
    for (const m of into) {
      expect(m.event, `${JSON.stringify(m)}: withdrawn is reached only by task.withdrawn`).toBe('task.withdrawn');
      expect(typeof m.guard === 'string' && m.guard.length > 0, `${JSON.stringify(m)}: its guard is your trusted path`).toBe(true);
    }
  });

  it.each([['your card (app)', app], ['the CLI (cli)', cli]] as [string, Connection][])(`${ID.withdrawn} your withdrawal from %s moves the task to withdrawn`, async (_, connection) => {
    const { record, clock, task } = await withTask();
    clock.step(1000);
    const thrown = await tryAppend(record, connection, withdrawal(task, clock.now()));
    expect(thrown?.message, 'your withdrawal is appended').toBeUndefined();
    expect((await record.table('tasks')).rows.find((r) => r.task_ref === task)?.state, 'the task is withdrawn').toBe('withdrawn');
    await record.rebuild();
    expect((await record.table('tasks')).rows.find((r) => r.task_ref === task)?.state, 'rebuilt from the log, still withdrawn').toBe('withdrawn');
  });

  it.each([
    ['through the agent\'s MCP connection', mcp('S1')],
    ['through the agent\'s hook connection', hook('S1')],
    ['as the core, acting on an agent\'s message', core('S1')],
  ] as [string, Connection][])(`${ID.withdrawn} a planted handler that withdraws a task on an agent's message, %s, is refused, naming the task and the event`, async (_, connection) => {
    // The trusted path's own withdrawal works, so a refusal below is the table's, not a missing kind.
    readTable('ask_task');
    const { record, clock, task, open } = await withTask();
    clock.step(1000);
    const event = withdrawal(task, clock.now());
    const thrown = await tryAppend(record, connection, event);
    const state = (await record.table('tasks')).rows.find((r) => r.task_ref === task)?.state;
    expect(state, `the task stays open (${open})`).toBe(open);
    const refusals = (await record.read({ after: 0 })).filter((e) => e.kind === 'move.refused').map((e) => json(e.data));
    const naming = (text: string) => text.includes(task.slice('task:'.length)) && (text.includes(event.id) || text.includes('task.withdrawn'));
    expect(
      (thrown !== undefined && naming(thrown.message)) || refusals.some(naming),
      `the refusal names the task (${task}) and the event (${event.id}, task.withdrawn): thrown ${thrown ? JSON.stringify(thrown.message) : 'nothing'}; move.refused ${refusals.join(' | ') || 'none'}`,
    ).toBe(true);
    await record.rebuild();
    expect((await record.table('tasks')).rows.find((r) => r.task_ref === task)?.state, 'rebuilt from the log, still open').toBe(open);
    // And afterwards your withdrawal still lands: the refused one left the task open, not stuck.
    clock.step(1000);
    expect((await tryAppend(record, app, withdrawal(task, clock.now())))?.message, 'your withdrawal is appended').toBeUndefined();
    expect((await record.table('tasks')).rows.find((r) => r.task_ref === task)?.state, 'then the task is withdrawn').toBe('withdrawn');
  });
});
