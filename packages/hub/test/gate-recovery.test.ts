// #2065 recovery regressions: persisted actions go through the real record and asks, not an in-memory map.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openLedger } from '@deepbuild/budget';
import { openRecord } from '@deepbuild/record';
import { StopJudging, type StopJudgingOptions } from '../src/stop-judging.js';

it('an approved budget cut before its spend event does not prevent startup after its end', async () => {
  const dir = mkdtempSync('/tmp/gate-recovery-');
  let at = Date.UTC(2026, 10, 1);
  const now = () => at;
  const options = { path: join(dir, 'record.db'), now };
  const core = { writer: 'core', actor: 'you', scope: 'you' };
  let record = await openRecord(options);
  try {
    let asks = await openAsks({ record, now, deliver: () => undefined });
    const action = { kind: 'budget.issue', scope: { kind: 'issue', ref: 'task:item42' }, runs: 1, cap_usd: 4, ends: at + 604_800_000 };
    const ask = await asks.raise(core, 'budget.issue', {
      action, kind: 'authority', question: 'Approve $4 for one run?', options: [{ id: 'approve', label: 'Approve', decision: 'allow' }, { id: 'decline', label: 'Decline', decision: 'deny' }],
      recommended: null, default: 'decline', deadline: at + 86_400_000, fallback: 'you', provisional: false, owner: 'you', key: 'a'.repeat(64), pinned_to: { kind: 'evidence', ref: 'a'.repeat(64) },
    }, { steps: [{ does: 'Approve $4 for one run', changes: ['task:item42'], undo: null, public: false, cost: 4 }], diff: 'a'.repeat(64) });
    await asks.answer({ ...core, writer: 'app' }, ask, { option: 'approve', token: 'card-click', plan_hash: (await asks.card(ask)).plan!.hash });
    await record.close();
    at = action.ends + 1;
    record = await openRecord(options);
    asks = await openAsks({ record, now, deliver: () => undefined });
    const ledger = await openLedger({ record, asks, now, price: async () => 4 });
    // Only the capabilities this recovery path consumes; record, asks and budget are real components.
    const judging = new StopJudging({ settings: {}, services: { record, ledger, now }, events: { connection: () => core } } as unknown as StopJudgingOptions);
    await expect(judging.recoverGateAnswers(), `expired ${ask} must not prevent the hub from starting`).resolves.toBeUndefined();
    expect(await record.read({ after: 0, kinds: ['spend.approved'] }), 'no authority is extended past the asked end').toEqual([]);
  } finally { await record.close(); rmSync(dir, { recursive: true, force: true }); }
});
