// Criterion 11 (no upstream test): "In a bake whose worst step runs loops at `rules.rs:10`, `rules.rs:20` and
// `rules.rs:30` for 3,000, 2,000 and 1,000 iterations, logic.budget names those 3 lines in that order, each with its
// fuel from the rewrite's per-block counts; a planted report that charges each block to its function's first line
// names one line and fails"
//
// Through `deep-logic bake`'s `budgets` (README: deep-logic, logic.budget). The Rust program (rules/) runs three
// loops in one function every step, 300, 200 and 100 iterations, and ten times as many at step 7, the bake's worst
// step; each loop is one line, the same xorshift body. "Its fuel from the rewrite's per-block counts" is checked by
// what the counts must give: each line at least one unit per iteration, the three in proportion to their iterations
// (3 : 2 : 1, within 10%), and together no more than the worst step's recorded fuel.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, at, bakeCall, bakeOf, logicBin, onMac, piece, prebuild, rulesProgram, show, type Bake, type JsonObject } from './helpers.ts';

prebuild(() => { logicBin(); rulesProgram(); });

const STEPS = 12;
const WORST = 7;
const LINES = [['rules.rs:10', 3000], ['rules.rs:20', 2000], ['rules.rs:30', 1000]] as const;
const budgetBake = (): JsonObject => {
  const r = rulesProgram();
  return bakeCall(piece({
    seed: 531_11, controls: ['boom'],
    items: { rules: { program: r.program, debug: r.sidecar, reads: ['boom'], writes: { acc: { type: 'i32' } } } },
  }), { steps: STEPS });
};
const ends = (source: string, line: string): boolean => source === line || source.endsWith(`/${line}`) || source.endsWith(`\\${line}`);

function budgetOf(b: Bake, what: string): { step: number; fuel: number; lines: { source: string; fuel: number }[] } {
  expect(b.traps, `${what}: nothing traps`).toEqual([]);
  const mine = b.budgets.filter((x) => x.item === 'rules');
  expect(mine.length, `${what}: one logic.budget report for the item (${show(b.raw['budgets'])})`).toBe(1);
  return mine[0]!;
}

describe(`${AC[11]} logic.budget names the source lines that spent the most fuel in the worst step`, () => {
  it(`${AC[11]} the worst step's loops at rules.rs:10, 20 and 30 (3,000, 2,000 and 1,000 iterations) are named in that order, each with fuel in proportion to its iterations`, () => {
    const b = bakeOf(onMac([budgetBake()])[0]!, 'the bake');
    const fuel = Array.from({ length: STEPS }, (_, k) => at(b.steps, k, 'the bake').items['rules']!.fuel);
    const worst = fuel.indexOf(Math.max(...fuel));
    expect(worst, `step ${WORST} is the bake's worst step (fuel per step: ${fuel.join(', ')})`).toBe(WORST);
    const report = budgetOf(b, 'the bake');
    expect([report.step, report.fuel], 'logic.budget names the worst step and its fuel').toEqual([WORST, fuel[WORST]]);
    expect(report.lines.length, `logic.budget names three lines: ${show(report.lines as unknown as JsonObject[])}`).toBe(3);
    LINES.forEach(([line], i) => expect(ends(report.lines[i]!.source, line), `line ${i + 1} is ${line} (it is ${report.lines[i]!.source})`).toBe(true));
    const [f10, f20, f30] = report.lines.map((l) => l.fuel) as [number, number, number];
    LINES.forEach(([line, n], i) => expect(report.lines[i]!.fuel, `${line}'s fuel covers at least one unit per iteration (${n})`).toBeGreaterThanOrEqual(n));
    expect(f10 / f30, `rules.rs:10 spent about 3 times rules.rs:30's fuel (${f10} : ${f30})`).toBeGreaterThan(2.7);
    expect(f10 / f30).toBeLessThan(3.3);
    expect(f20 / f30, `rules.rs:20 spent about 2 times rules.rs:30's fuel (${f20} : ${f30})`).toBeGreaterThan(1.8);
    expect(f20 / f30).toBeLessThan(2.2);
    expect(f10 + f20 + f30, 'the three lines spent no more than the step recorded').toBeLessThanOrEqual(fuel[WORST]!);
  }, TIMEOUT);

  it(`${AC[11]} a planted report that charges each block to its function's first line (budget_charges_function_first_line) names one line and fails`, () => {
    const report = budgetOf(bakeOf(onMac([budgetBake()], 'budget_charges_function_first_line')[0]!, 'the planted report'), 'the planted report');
    const named = [...new Set(report.lines.map((l) => l.source))];
    expect(named.length, `the planted report names one line: ${show(named)}`).toBe(1);
    const failures = LINES.filter(([line]) => !report.lines.some((l) => ends(l.source, line))).map(([line]) => `logic.budget doesn't name ${line}`);
    expect(failures, 'the planted report fails, missing the three loop lines').toEqual(LINES.map(([line]) => `logic.budget doesn't name ${line}`));
  }, TIMEOUT);
});
