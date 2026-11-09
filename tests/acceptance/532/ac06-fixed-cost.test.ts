// Criterion 6 (no upstream test): "Logic items whose step does nothing, doubled from 1,000 until their summed fixed
// cost passes the figure class's 4 ms of frame CPU on the reference Mac: every step's fuel share is 0, the report
// names the fixed cost per item per step on the app, and logic.budget with on [app] fails, naming the item count
// and that cost; a planted budget that sums only fuel passes it and fails this criterion"
//
// Through `deep-logic budget` (logic.budget, on [app], README: budget) on this Mac. A piece of the figure class holds
// N items of `idle` (programs.ts), whose step does nothing, for 60 steps; N doubles from 1,000. At each N the report's
// fixed cost per item per step on the app (measured by the logic module with an empty step at 1, 100 and 1,000
// items) times N is the items' summed fixed cost; below 4 ms logic.budget must not fail on it, and at the first N
// past 4 ms it must fail, naming N and that cost. `budget_sums_fuel_only` is a logic.budget whose verdict counts
// fuel alone.
import { describe, expect, it } from 'vitest';
import { AC, FRAME_CPU_NS, TIMEOUT, budgetCall, budgetOf, logicBin, onMac, piece, prebuild, type JsonObject, type Planted } from './helpers.ts';
import { idle } from './programs.ts';

prebuild(() => { logicBin(); });

const FIRST = 1000;
/** Past this many items the fixed cost would be under 31 ns an item step; the doubling stops there. */
const CAP = 128_000;
const idlePiece = (n: number): JsonObject => {
  const program = idle();
  const items = Object.fromEntries(Array.from({ length: n }, (_, i) => [`e${String(i).padStart(6, '0')}`, { program, writes: { v: { type: 'i32' as const } } }]));
  return piece({ seed: 532_06, class: 'figure', items });
};

interface Reading { n: number; perItem: number; verdict: string; fixed: { items: number | null; per_item_ns: number | null }[]; shares: number[]; at: Record<string, number> }
function read(n: number, planted: Planted[]): Reading {
  const [reply] = onMac([budgetCall(idlePiece(n), { steps: 60 }, ['app'])], planted);
  const b = budgetOf(reply!, `logic.budget of ${n} idle items`);
  const app = b.report.fixed['app'];
  expect(app, `the report names the app's fixed cost of a step (${n} items)`).toBeDefined();
  return {
    n, perItem: app!.per_item_ns, verdict: b.verdict, at: app!.at,
    fixed: b.failures.filter((f) => f.rule === 'fixed_cost').map((f) => ({ items: f.items, per_item_ns: f.per_item_ns })),
    shares: Object.values(b.report.items).map((x) => x.share),
  };
}
/** Doubles N from 1,000 until N × the reported cost passes 4 ms; every reading on the way. */
function double(planted: Planted[] = []): Reading[] {
  const out: Reading[] = [];
  for (let n = FIRST; n <= CAP; n *= 2) {
    const r = read(n, planted);
    out.push(r);
    if (r.n * r.perItem > FRAME_CPU_NS) break;
  }
  return out;
}
/** The criterion over the readings, each failure naming its item count. */
function judge(readings: Reading[]): string[] {
  const failures: string[] = [];
  for (const r of readings) {
    if (r.shares.length !== r.n || r.shares.some((s) => s !== 0)) failures.push(`${r.n} items: not every item's busiest step has fuel share 0 (${r.shares.length} items reported)`);
    if (!(r.perItem > 0) || ['1', '100', '1000'].some((k) => !(r.at[k]! > 0))) failures.push(`${r.n} items: the report measures no fixed cost at 1, 100 and 1,000 items (${JSON.stringify(r.at)}, per item ${r.perItem})`);
    const summed = r.n * r.perItem;
    if (summed <= FRAME_CPU_NS && r.fixed.length) failures.push(`${r.n} items: logic.budget fails on a fixed cost of ${summed} ns, within 4 ms`);
    if (summed > FRAME_CPU_NS) {
      if (r.verdict !== 'FAIL') failures.push(`${r.n} items: their summed fixed cost is ${summed} ns, past 4 ms, and logic.budget's verdict is ${r.verdict}`);
      if (!r.fixed.some((f) => f.items === r.n && f.per_item_ns === r.perItem)) failures.push(`${r.n} items: logic.budget doesn't fail naming ${r.n} items at ${r.perItem} ns an item step: ${JSON.stringify(r.fixed)}`);
    }
  }
  const last = readings[readings.length - 1];
  if (!last || last.n * last.perItem <= FRAME_CPU_NS) failures.push(`the summed fixed cost never passed 4 ms up to ${last?.n ?? 0} items`);
  return failures;
}

describe(`${AC[6]} logic.budget counts each item's fixed cost of a step apart from its fuel`, () => {
  it(`${AC[6]} idle items doubled from 1,000 until their summed fixed cost passes 4 ms: every fuel share is 0, the report names the cost per item step on the app, and logic.budget on [app] fails, naming the count and the cost`, () => {
    const readings = double();
    const failures = judge(readings);
    expect(failures, `${readings.map((r) => `${r.n} items × ${r.perItem} ns: ${r.verdict}`).join(', ')}:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[6]} a planted budget that sums only fuel (budget_sums_fuel_only) passes the items past 4 ms and fails the criterion`, () => {
    const readings = double(['budget_sums_fuel_only']);
    const last = readings[readings.length - 1]!;
    expect(last.n * last.perItem, 'the doubling reached a summed fixed cost past 4 ms').toBeGreaterThan(FRAME_CPU_NS);
    expect(last.verdict, `the planted budget passes ${last.n} items`).toBe('PASS');
    expect(judge(readings).some((f) => f.startsWith(`${last.n} items:`)), `the criterion fails at ${last.n} items`).toBe(true);
  }, TIMEOUT);
});
