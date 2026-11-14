// #2065 regression: recovering an issue-budget answer after another restart must not approve it twice.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openRecord } from '@deepbuild/record';
import { openLedger } from '../src/index.js';

it('the same answered ask approves one budget, even after the record and ledger reopen', async () => {
  const dir = mkdtempSync('/tmp/budget-answer-');
  const now = () => Date.UTC(2026, 10, 1);
  const options = { path: join(dir, 'record.db'), now };
  const core = { writer: 'core', actor: 'you', scope: 'you' };
  let record = await openRecord(options);
  try {
    let asks = await openAsks({ record, now, deliver: () => undefined });
    let ledger = await openLedger({ record, asks, now, price: async () => 4 });
    const input = { scope: { kind: 'issue' as const, ref: 'task:item42' }, runs: 1, cap_usd: 4, ends: now() + 604_800_000 };
    const ask = await asks.raise(core, 'budget.issue', {
      kind: 'authority', question: 'Approve $4 for one run?', options: [{ id: 'approve', label: 'Approve $4', decision: 'allow' }, { id: 'decline', label: 'Decline', decision: 'deny' }],
      recommended: null, default: 'decline', deadline: now() + 86_400_000, fallback: 'you', provisional: false, owner: 'you', key: 'a'.repeat(64), pinned_to: { kind: 'evidence', ref: 'a'.repeat(64) },
    }, { steps: [{ does: 'Approve $4 for one run', changes: ['task:item42'], undo: null, public: false, cost: 4 }], diff: 'a'.repeat(64) });
    await asks.answer({ ...core, writer: 'app' }, ask, { option: 'approve', token: 'a-real-card-click', plan_hash: (await asks.card(ask)).plan!.hash });
    const first = await ledger.approveOn(core, ask, input);
    expect(first, `budget ask ${ask} is approved before restart`).toBeTypeOf('string');
    await record.close();
    record = await openRecord(options);
    asks = await openAsks({ record, now, deliver: () => undefined });
    ledger = await openLedger({ record, asks, now, price: async () => 4 });
    const second = await ledger.approveOn(core, ask, input);
    expect(second, `budget ask ${ask} must return the existing budget after restart`).toBe(first);
    const approved = await record.read({ after: 0, kinds: ['spend.approved'] });
    expect(approved, `budget ask ${ask} must record one spend.approved, never two`).toHaveLength(1);
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
