// #2065: a task's persisted count keeps the selected answer, overlapping stops and each stalled episode distinct.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { fixtures } from '@deepbuild/contracts';
import { openRecord, ulid, type EventInput } from '@deepbuild/record';
import { freshCount, judgeStop } from '@deepbuild/gate';
import { AskTasks } from '../src/ask-tasks.js';
import { GateRunner } from '../src/gate-runner.js';
import { McpOperations } from '../src/mcp-operations.js';
import { SizeScope } from '../src/scope.js';
import { StopJudging, type StopJudgingOptions } from '../src/stop-judging.js';
import type { HookMeta } from '../src/wire.js';

async function world(body: (w: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const w = await setup();
  try { await body(w); } finally { await w.record.close(); rmSync(w.dir, { recursive: true, force: true }); }
}
async function setup() {
  const dir = mkdtempSync('/tmp/stall-progress-');
  const now = () => Date.UTC(2026, 10, 1);
  const record = await openRecord({ path: join(dir, 'record.db'), now });
  const core = { writer: 'core', actor: 'you', scope: 'you' };
  const task = 'task:item42';
  const asks = await openAsks({ record, now, deliver: () => undefined });
  const raw = record.raw.bind(record);
  const judging = new StopJudging({ settings: {}, services: { record, now, asks,
    tasks: new AskTasks({ raw } as ConstructorParameters<typeof AskTasks>[0]),
    gate: new GateRunner({} as ConstructorParameters<typeof GateRunner>[0]),
    sizing: new SizeScope({ raw } as ConstructorParameters<typeof SizeScope>[0]),
  }, mcp: () => new McpOperations({} as ConstructorParameters<typeof McpOperations>[0]),
    events: { append: async (c: typeof core, e: EventInput) => { await record.append(c, e); }, connection: (_writer: string, extra = {}) => ({ ...core, ...extra }), appendReading: async () => undefined },
  } as unknown as StopJudgingOptions);
  const meta = (session: string) => ({ session, agent: 'claude-code', cwd: dir } as HookMeta);
  const claim = async (session: string) => {
    const id = ulid(now());
    await record.append({ ...core, session }, { v: 2, id, kind: 'claim.made', ts: now(), data: { task_ref: task, attempt: 1, commit: 'a'.repeat(40), scope: 'session', predictions: [] } });
    const fixture = fixtures('verdict.made@1')[0] as unknown as { data: Record<string, unknown> };
    const verdict = ulid(now());
    await record.append(core, { v: 1, id: verdict, kind: 'verdict.made', ts: now(), data: { ...fixture.data, claim: `claim:${id}`, verdict: `verdict:${verdict}` } as EventInput['data'] });
    return `claim:${id}`;
  };
  const stalled = async (claim: string) => {
    const count = freshCount();
    const stop = { items: ['A dropped connection is retried'], passing: [], runs: [] };
    judgeStop(count, stop); judgeStop(count, stop);
    await record.append(core, { v: 1, id: ulid(now()), kind: 'claim.progress', ts: now(), subject: claim, data: {
      task, rounds: count.rounds, last: { items: count.last!.items, passing: [] }, seen: [], stalled: count.stalled!,
    } });
  };
  const ask = () => asks.raise(core, 'claim.stalled', { action: { kind: 'claim.stalled', task }, kind: 'exception', question: 'Split, fund, or accept?', options: ['split', 'fund', 'accept'].map((id) => ({ id, label: id, decision: 'none' })), recommended: 'split', default: 'split', deadline: now() + 86_400_000, fallback: 'you', provisional: false, owner: 'you', key: 'a'.repeat(64), pinned_to: { kind: 'evidence', ref: 'a'.repeat(64) } });
  return { dir, now, record, core, task, asks, judging, meta, claim, stalled, ask };
}

it('free text fund does not reset a persisted stall', async () => world(async (w) => {
  const claim = await w.claim('S1');
  await w.stalled(claim);
  const ask = await w.ask();
  await w.asks.answer({ ...w.core, writer: 'app' }, ask, { words: 'fund' });
  w.judging.lastMessage.set('S1', 'Still open:\n- A dropped connection is retried');
  expect(await w.judging.stallGate(w.meta('S1'), claim, 'send back'), 'no option was selected, so the task is still stalled').toBeUndefined();
  expect(await w.record.read({ after: 0, kinds: ['claim.sent_back'] })).toHaveLength(0);
}));

it('concurrent send-backs on one task advance distinct rounds', async () => world(async (w) => {
  const [a, b] = [await w.claim('S1'), await w.claim('S2')];
  w.judging.lastMessage.set('S1', 'Still open:\n- A dropped connection is retried, with backoff');
  w.judging.lastMessage.set('S2', 'Still open:\n- A dropped connection is retried, with jitter');
  await Promise.all([w.judging.stallGate(w.meta('S1'), a, 'send back'), w.judging.stallGate(w.meta('S2'), b, 'send back')]);
  expect((await w.record.read({ after: 0, kinds: ['claim.sent_back'] })).map((e) => (e.data as { round: number }).round), 'neither stop overwrites the other round').toEqual([1, 2]);
}));

it('an old funded ask does not hide the missing ask of a later stalled episode', async () => world(async (w) => {
  const first = await w.claim('S1');
  await w.stalled(first);
  const earlier = await w.ask();
  await w.asks.answer({ ...w.core, writer: 'app' }, earlier, { option: 'fund' });
  const later = await w.claim('S1');
  await w.stalled(later); // crash after this write, before this episode's ask
  w.judging.lastMessage.set('S1', 'Still open:\n- A dropped connection is retried');
  await w.judging.stallGate(w.meta('S1'), later, 'send back');
  expect(await w.record.read({ after: 0, kinds: ['ask.created'] }), 'the later stalled episode reaches the person').toHaveLength(2);
  await w.judging.stallGate(w.meta('S1'), later, 'send back');
  expect(await w.record.read({ after: 0, kinds: ['ask.created'] }), 'the repaired episode is not asked twice').toHaveLength(2);
}));
