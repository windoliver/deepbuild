// #2065: a count committed before its stalled ask must not strand the task after a crash.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openRecord, ulid } from '@deepbuild/record';
import { freshCount, judgeStop } from '@deepbuild/gate';
import { AskTasks } from '../src/ask-tasks.js';
import { GateRunner } from '../src/gate-runner.js';
import { McpOperations } from '../src/mcp-operations.js';
import { SizeScope } from '../src/scope.js';
import { StopJudging, type StopJudgingOptions } from '../src/stop-judging.js';
import type { HookMeta } from '../src/wire.js';

it('the next unchanged stop repairs a stall whose count committed but whose ask did not', async () => {
  const dir = mkdtempSync('/tmp/stall-recovery-');
  const now = () => Date.UTC(2026, 10, 1);
  const options = { path: join(dir, 'record.db'), now };
  const meta = { session: 'S1', agent: 'claude-code', cwd: dir } as HookMeta;
  const core = { writer: 'core', actor: 'you', scope: 'you', session: meta.session, agent: meta.agent };
  const task = 'task:item42';
  const claim = `claim:${ulid(now())}`;
  let record = await openRecord(options);
  try {
    await record.append(core, { v: 2, id: claim.slice(6), kind: 'claim.made', ts: now(), data: { task_ref: task, attempt: 1, commit: 'a'.repeat(40), scope: 'session', predictions: [] } });
    const count = freshCount();
    const stop = { items: ['A dropped connection is retried'], passing: [], runs: [] };
    judgeStop(count, stop); judgeStop(count, stop);
    await record.append(core, { v: 1, id: ulid(now()), kind: 'claim.progress', subject: claim, ts: now(), data: {
      task, rounds: count.rounds, last: { items: count.last!.items, passing: [] }, seen: [], stalled: count.stalled!,
    } });
    await record.close();
    record = await openRecord(options);
    const asks = await openAsks({ record, now, deliver: () => undefined });
    const raw = record.raw.bind(record);
    const append = async (connection: typeof core, input: Parameters<typeof record.append>[1]) => { await record.append(connection, input); };
    // These are real domain components; only capabilities this path never calls are omitted.
    const tasks = new AskTasks({ raw } as ConstructorParameters<typeof AskTasks>[0]);
    const gate = new GateRunner({} as ConstructorParameters<typeof GateRunner>[0]);
    const sizing = new SizeScope({ raw } as ConstructorParameters<typeof SizeScope>[0]);
    const mcp = new McpOperations({} as ConstructorParameters<typeof McpOperations>[0]);
    const judging = new StopJudging({ settings: {}, services: { record, now, asks, tasks, gate, sizing },
      mcp: () => mcp, events: { append, connection: () => core, appendReading: async () => undefined },
    } as unknown as StopJudgingOptions);
    judging.lastMessage.set(meta.session, 'Still open:\n- A dropped connection is retried');
    expect(await judging.stallGate(meta, claim, 'work on the failing check')).toBeUndefined();
    const raised = await record.read({ after: 0, kinds: ['ask.created'] });
    expect(raised, `${task}: a recorded stall with no ask must reach the person`).toHaveLength(1);
    await judging.stallGate(meta, claim, 'work on the failing check');
    expect(await record.read({ after: 0, kinds: ['ask.created'] }), 'a repaired stall still asks only once').toHaveLength(1);
  } finally { await record.close(); rmSync(dir, { recursive: true, force: true }); }
});
