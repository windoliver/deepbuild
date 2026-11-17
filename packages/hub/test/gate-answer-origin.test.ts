// #2065: replay preserves an answer's origin. Text equal to an option ID is not a selected option.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { fixtures } from '@deepbuild/contracts';
import { openRecord, ulid, type EventInput } from '@deepbuild/record';
import { AskTasks } from '../src/ask-tasks.js';
import { OpenItems } from '../src/open-items.js';
import { StopJudging, type StopJudgingOptions } from '../src/stop-judging.js';

it.each(['accept', 'split'])('typing %s without choosing an option does not settle a stalled task after restart', async (words) => {
  const dir = mkdtempSync('/tmp/gate-answer-origin-');
  const now = () => Date.UTC(2026, 10, 1);
  const options = { path: join(dir, 'record.db'), now };
  const core = { writer: 'core', actor: 'you', scope: 'you', session: 'S1', agent: 'claude-code' };
  const task = 'task:item42';
  let record = await openRecord(options);
  try {
    await record.append({ ...core, writer: 'hook' }, { v: 1, id: ulid(now()), kind: 'session.start', ts: now(), data: { agent: 'claude-code', worktree: dir, branch: 'fix', thread: 'S1' } });
    await record.append(core, { v: 1, id: ulid(now()), kind: 'task.created', ts: now(), data: { task_ref: task, thread: 'S1', owner: 'you', title: 'Retry dropped connections' } });
    const locked = fixtures('definition.locked@1')[0] as unknown as { data: Record<string, unknown> };
    await record.append(core, { v: 1, id: ulid(now()), kind: 'definition.locked', ts: now(), data: { ...locked.data, task_ref: task } as EventInput['data'] });
    const asks = await openAsks({ record, now, deliver: () => undefined });
    const ask = await asks.raise(core, 'claim.stalled', {
      action: { kind: 'claim.stalled', task }, kind: 'exception', question: 'Split, fund, or accept what is proven?',
      options: ['split', 'fund', 'accept'].map((id) => ({ id, label: id, decision: 'none' })),
      recommended: 'split', default: 'split', deadline: now() + 86_400_000, fallback: 'you', provisional: false, owner: 'you',
      key: 'a'.repeat(64), pinned_to: { kind: 'evidence', ref: 'a'.repeat(64) },
    });
    await asks.answer({ ...core, writer: 'app' }, ask, { words });
    await record.close();
    record = await openRecord(options);
    const raw = record.raw.bind(record);
    const tasks = new AskTasks({ raw } as ConstructorParameters<typeof AskTasks>[0]);
    const openItems = new OpenItems({ raw } as ConstructorParameters<typeof OpenItems>[0]);
    const append = async (connection: typeof core, input: EventInput) => { await record.append(connection, input); };
    const judging = new StopJudging({ settings: {}, services: { record, now, tasks, openItems }, state: () => ({ live: new Map() }), events: { append, connection: () => core } } as unknown as StopJudgingOptions);
    await judging.recoverGateAnswers();
    expect(await record.read({ after: 0, kinds: ['issue.drafted'] }), `words alone cannot split ${task}`).toHaveLength(0);
    expect(await judging.closesGate('S1', 'gh pr create --body "Closes #42"', dir), `words alone cannot accept ${task}`).toContain('unproven');
  } finally { await record.close(); rmSync(dir, { recursive: true, force: true }); }
});
