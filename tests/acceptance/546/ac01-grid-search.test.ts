// Criterion 1 (no upstream test): "The guide's grid search, sized so that done in one step it uses between 1.2 and 3
// times the figure class's app step ceiling and under its fuel budget of 10,000,000, fails logic.budget in that class,
// naming the step, the host app and the ceiling; the guide's version split across steps finds the same route, cell for
// cell, with every step under the ceiling, passes logic.budget, and seeking into the middle of the search equals
// playing by full-state hash; and a planted logic.budget that compares each step with the fuel budget rather than the
// ceiling passes the one-step search and so fails this criterion"
//
// The guide's two searches (`grid_search` and `grid_search_split`, README: The guide's examples) are read from
// deep_kinds and assembled; the figure class's app ceiling at their step rate is deep_kinds' own. The test sizes a
// seeded grid until the one-step search's step 0 spends between 1.2 and 3 times that ceiling and under 10,000,000,
// then: logic.budget fails that piece naming step 0, host app and the ceiling; the split search ends with the same
// route (a shortest route by the test's own breadth-first search), no step over the ceiling, and logic.budget passes
// it; a seek that restores a checkpoint in the middle of the search plays on to the first checkpoint after the search
// ends with playing's step hashes and full-state hash. `budget_holds_steps_to_fuel_budget` reads PASS on the one-step
// search, and the criterion's judgement fails on it.
import { describe, expect, it } from 'vitest';
import {
  AC, FUEL_CAP, TIMEOUT, bakeCall, bakeOf, bins, budgetCall, budgetOf, ceilingOf, example, failsNaming, line, none, onMac,
  piece, prebuild, rateOf, stepTable, guideText, type Bake, type Budget, type Example, type JsonObject, type JsonValue,
} from './helpers.ts';
import { grid, routeProblems, type Grid } from './programs.ts';

prebuild(() => { bins(); });

const SEED = 546_01;
const ID = 'search';
/** The split search must end within this many steps on the test's grid (README: The guide's examples). */
const SPLIT_STEPS = 600;

const flag = (v: JsonValue | undefined): boolean => v === true || v === 1;
function searchPiece(ex: Example, g: Grid, every?: number): JsonObject {
  const budget = { ...(ex.params['budget'] as JsonObject | undefined ?? {}), fuel: FUEL_CAP };
  const checkpoint = every ? { checkpoint: { ...(ex.params['checkpoint'] as JsonObject | undefined ?? {}), every } } : {};
  return piece({ seed: SEED, class: 'figure', items: { [ID]: { program: ex.program, params: { ...ex.params, budget, ...checkpoint }, assets: [g.bytes] } } });
}
/** The search's done flag and route at a step of a bake. */
function at(b: Bake, k: number): { done: boolean; route: number[] } {
  const s = b.steps.find((x) => x.step === k);
  if (!s) return expect.fail(`the bake has no step ${k}`);
  const len = Number(s.arrays[`${ID}.route_len`]?.[0] ?? 0);
  return { done: flag(s.arrays[`${ID}.done`]?.[0]), route: (s.arrays[`${ID}.route`] ?? []).slice(0, len).map(Number) };
}

interface Setup { c: number; one: Example; split: Example; g: Grid; lo: number; hi: number }
let made: Setup | undefined;
/** The guide's searches, the ceiling, and a grid whose one-step search spends between 1.2 and 3 times it, under 10,000,000. */
function setup(): Setup {
  if (made) return made;
  const text = guideText();
  const one = example(text, 'grid_search');
  const split = example(text, 'grid_search_split');
  expect(rateOf(split.params), 'the guide\'s two searches step at one rate').toBe(rateOf(one.params));
  const c = ceilingOf(stepTable(), rateOf(one.params), 'figure', 'app');
  const lo = 1.2 * c;
  const hi = Math.min(3 * c, FUEL_CAP);
  expect(lo < hi, `a step between 1.2 and 3 times the figure class's app ceiling (${c}) and under the fuel budget's ${FUEL_CAP} exists`).toBe(true);
  const target = (lo + hi) / 2;
  let side = 64;
  const tried: string[] = [];
  for (let i = 0; i < 12; i++) {
    const g = grid(side, SEED);
    const [reply] = onMac([bakeCall(searchPiece(one, g), { steps: 1 })]);
    const b = bakeOf(reply!, `the one-step search's bake on a ${side} × ${side} grid`);
    const fuel = b.traps.length ? FUEL_CAP : (b.steps[0]?.items[ID]?.fuel ?? 0);
    tried.push(`${side}: ${fuel}`);
    if (fuel > lo && fuel < hi && !b.traps.length) return (made = { c, one, split, g, lo, hi });
    const next = Math.round(side * Math.sqrt(target / Math.max(fuel, 1)));
    side = Math.max(8, Math.min(1024, next === side ? side + (fuel < lo ? 1 : -1) : next));
  }
  return expect.fail(`no grid up to 1,024 × 1,024 made the guide's one-step search spend between ${lo} and ${hi} fuel at step 0 (side: fuel ${tried.join(', ')})`);
}

/** What the criterion asks of logic.budget on the one-step search: FAIL, with one ceiling failure, step 0, host app, the ceiling. */
function oneStepProblems(b: Budget, c: number): string[] {
  const out: string[] = [];
  if (b.verdict !== 'FAIL') out.push(`logic.budget reads ${b.verdict} on the one-step search, whose step 0 passes the figure class's app ceiling ${c}`);
  const ceiling = b.failures.filter((f) => f.rule === 'ceiling').map((f) => ({ item: f.item, step: f.step, host: f.host, ceiling: f.ceiling }));
  if (JSON.stringify(ceiling) !== JSON.stringify([{ item: ID, step: 0, host: 'app', ceiling: c }])) {
    out.push(`logic.budget's ceiling failures on the one-step search aren't exactly one naming step 0, host app and ceiling ${c}: ${b.failures.map(line).join(', ') || 'none'}`);
  }
  return out;
}

describe(`${AC[1]} the guide's grid search: past the ceiling in one step, under it split across steps`, () => {
  it(`${AC[1]} the one-step search fails logic.budget naming step 0, host app and the ceiling; the split search finds the same route under the ceiling, passes, and seeks into its middle as it plays`, () => {
    const { c, one, split, g, lo, hi } = setup();
    // The one-step search: a shortest route at step 0, its fuel in the window, and logic.budget's failure.
    const [oneBake, oneBudget, splitBake, splitBudget] = onMac([
      bakeCall(searchPiece(one, g), { steps: 1 }), budgetCall(searchPiece(one, g), { steps: 1 }, ['app']),
      bakeCall(searchPiece(split, g), { steps: SPLIT_STEPS }), budgetCall(searchPiece(split, g), { steps: SPLIT_STEPS }, ['app']),
    ]);
    const ob = bakeOf(oneBake!, 'the one-step search\'s bake');
    expect(ob.traps, 'the one-step search doesn\'t trap').toEqual([]);
    const fuel = ob.steps[0]?.items[ID]?.fuel ?? 0;
    expect(fuel > lo && fuel < hi, `the one-step search's step 0 spends ${fuel}: between 1.2 and 3 times the ceiling ${c} and under ${FUEL_CAP}`).toBe(true);
    const found = at(ob, 0);
    expect(found.done, 'the one-step search ends at step 0').toBe(true);
    none(routeProblems(g, found.route, 'the one-step search\'s route'), 'the one-step search finds a shortest route');
    none(oneStepProblems(budgetOf(oneBudget!, 'logic.budget of the one-step search'), c), 'logic.budget fails the one-step search as the criterion says');

    // The split search: the same route, cell for cell, no step over the ceiling, and logic.budget passes it.
    const sb = bakeOf(splitBake!, 'the split search\'s bake');
    expect(sb.traps, 'the split search doesn\'t trap').toEqual([]);
    const over = sb.steps.filter((s) => (s.items[ID]?.fuel ?? 0) > c).map((s) => `step ${s.step}: ${s.items[ID]?.fuel}`);
    none(over, `every step of the split search is at or under the ceiling ${c}`);
    const d = sb.steps.find((s) => at(sb, s.step).done)?.step;
    if (d === undefined) return expect.fail(`the split search ends within ${SPLIT_STEPS} steps`);
    expect(d, 'the split search takes more than one step').toBeGreaterThan(0);
    expect(at(sb, d).route, 'the split search finds the one-step search\'s route, cell for cell').toEqual(found.route);
    const sbu = budgetOf(splitBudget!, 'logic.budget of the split search');
    expect(sbu.failures.map(line), 'logic.budget finds nothing in the split search').toEqual([]);
    expect(sbu.verdict, 'logic.budget passes the split search').toBe('PASS');

    // Seeking into the middle: checkpoints every E steps, E in the middle of the search and 2E past its end; a seek
    // to E restores the mid-search checkpoint and plays to 2E with playing's step hashes and full-state hash there.
    const e = Math.floor(d / 2) + 1;
    const [seekBake] = onMac([bakeCall(searchPiece(split, g, e), { steps: 2 * e + 1, seeks: [{ to: e }] })]);
    const kb = bakeOf(seekBake!, `the split search's bake with a checkpoint every ${e} steps and a seek to ${e}`);
    expect(at(kb, e - 1).done, `the search is still pending at the checkpoint at step ${e} (the middle)`).toBe(false);
    expect(at(kb, 2 * e - 1).done, `the search has ended by the checkpoint at step ${2 * e}`).toBe(true);
    const seek = kb.seeks[0];
    if (!seek) return expect.fail('the bake reports the seek');
    expect([seek.from, seek.checkpoint.step], `the seek to ${e} restores the checkpoint at ${e} and plays to the next one, ${2 * e}`).toEqual([e, 2 * e]);
    const playing = (kb.checkpoints[ID] ?? []).find((x) => x.step === 2 * e)?.deep_hash;
    expect(playing, `playing took a checkpoint at step ${2 * e}`).toBeDefined();
    expect(seek.checkpoint.deep_hash[ID], `seeking into the middle of the search equals playing by full-state hash at step ${2 * e}`).toBe(playing);
    const steps = kb.steps.filter((s) => s.step >= e && s.step < 2 * e).map((s) => s.items[ID]?.hash);
    expect(seek.hashes[ID], `the seek's steps ${e} to ${2 * e - 1} have playing's step hashes`).toEqual(steps);
  }, TIMEOUT);

  it(`${AC[1]} budget_holds_steps_to_fuel_budget passes the one-step search, and the criterion fails on it`, () => {
    const { c, one, g } = setup();
    const [planted] = onMac([budgetCall(searchPiece(one, g), { steps: 1 }, ['app'])], ['budget_holds_steps_to_fuel_budget']);
    const b = budgetOf(planted!, 'the planted logic.budget of the one-step search');
    expect(b.verdict, 'the planted logic.budget, holding steps to the fuel budget alone, passes the one-step search').toBe('PASS');
    failsNaming(oneStepProblems(b, c), ['step 0', 'host app'], 'budget_holds_steps_to_fuel_budget');
  }, TIMEOUT);
});
