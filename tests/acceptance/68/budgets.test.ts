// AC6: each check kind declares its time and cost budget, and the gate refuses a kind with none. The reference Mac's
// timing against the merge base is a reading the preflight's budget window takes (README); here each kind's run on
// its fixed work stays within the time it declares.
import { describe, expect, it } from 'vitest';
import type { CheckRunnerFill } from '../../../packages/conformance/src/index.ts';
import { context, gate, KINDS, piece, work } from './helpers.ts';

describe.each(KINDS)('AC6 the %s kind declares its time and cost budget, and the gate refuses it with none', (kind) => {
  it(`AC6 ${kind}: declares a time and a cost budget, the gate admits it, refuses it without one naming the kind, and its run keeps to its time`, async () => {
    const { admitKind } = await gate();
    const fill = (await work()).workFill(kind);
    const budget = fill.budget;
    expect(Number.isFinite(budget?.time_ms) && budget.time_ms > 0, `${kind}'s time budget: ${JSON.stringify(budget)}`).toBe(true);
    expect(Number.isFinite(budget?.cost_usd) && budget.cost_usd >= 0, `${kind}'s cost budget: ${JSON.stringify(budget)}`).toBe(true);
    expect(admitKind(fill)).toEqual({ admitted: true, reason: null });

    const bare: CheckRunnerFill = { ...fill };
    delete bare.budget;
    const refused = admitKind(bare);
    expect(refused.admitted).toBe(false);
    expect(refused.reason ?? '', 'the refusal names the kind').toContain(kind);

    const fix = await piece(kind, 'fix');
    const started = Date.now();
    const r = await fill.run(fix.spec, context(fix.checkout));
    const took = Date.now() - started;
    expect(r.outcome).toBe('passed');
    expect(took, `${kind}'s run took ${took} ms against its ${budget.time_ms} ms budget`).toBeLessThanOrEqual(budget.time_ms);
  }, 60_000);
});
