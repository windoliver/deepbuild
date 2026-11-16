// #2065: recovery finishes a send-back receipt interrupted after its durable task progress.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { fixtures } from '@deepbuild/contracts';
import { openRecord, ulid, type EventInput } from '@deepbuild/record';
import { StopJudging, type StopJudgingOptions } from '../src/stop-judging.js';

it('a committed round without its sent-back receipt is recovered once, before the next stop', async () => {
  const dir = mkdtempSync('/tmp/stall-receipt-');
  const now = () => Date.UTC(2026, 10, 1);
  const options = { path: join(dir, 'record.db'), now };
  const core = { writer: 'core', actor: 'you', scope: 'you', session: 'S1', agent: 'claude-code' };
  const claim = `claim:${ulid(now())}`;
  let record = await openRecord(options);
  try {
    await record.append(core, { v: 2, id: claim.slice(6), kind: 'claim.made', ts: now(), data: { task_ref: 'task:item42', attempt: 1, commit: 'a'.repeat(40), scope: 'session', predictions: [] } });
    const fixture = fixtures('verdict.made@1')[0] as unknown as { data: Record<string, unknown> };
    const verdict = `verdict:${ulid(now())}`;
    await record.append(core, { v: 1, id: verdict.slice(8), kind: 'verdict.made', ts: now(), data: { ...fixture.data, claim, verdict } as EventInput['data'] });
    await record.append(core, { v: 1, id: ulid(now()), kind: 'claim.progress', subject: claim, ts: now(), data: { task: 'task:item42', rounds: 2, last: { items: 'a'.repeat(64), passing: [] }, seen: [], stalled: null } });
    await record.close();
    record = await openRecord(options);
    const asks = await openAsks({ record, now, deliver: () => undefined });
    const judging = new StopJudging({ settings: {}, services: { record, now, asks }, events: {
      connection: (_writer: string, extra: object = {}) => ({ ...core, ...extra }), append: async (c: typeof core, e: EventInput) => { await record.append(c, e); },
    } } as unknown as StopJudgingOptions);
    await judging.recoverGateAnswers();
    const sent = await record.read({ after: 0, kinds: ['claim.sent_back'] });
    expect(sent, 'round 2 was committed before the crash, so its receipt cannot be lost').toHaveLength(1);
    expect(sent[0]!.data).toMatchObject({ claim, verdict, round: 2 });
    await judging.recoverGateAnswers();
    expect(await record.read({ after: 0, kinds: ['claim.sent_back'] }), 'recovery never repeats the receipt').toHaveLength(1);
  } finally { await record.close(); rmSync(dir, { recursive: true, force: true }); }
});
