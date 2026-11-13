// #546's criterion 1 as amended (#546.4f54d30a), redrafted blind (README): "The guide's grid search, sized so that done
// in one step it uses between 1.2 and 3 times the data view class's app step ceiling and under its fuel budget of
// 10,000,000, fails logic.budget in that class, naming the step, the host app and the ceiling; the guide's version split
// across steps finds the same route, cell for cell, with every step under the ceiling, passes logic.budget, and seeking
// into the middle of the search equals playing by full-state hash; and a planted logic.budget that compares each step
// with the fuel budget rather than the ceiling passes the one-step search and so fails this criterion"
//
// The guide's `grid_search` and `grid_search_split` come from deep_kinds; c is deep_kinds' own data_view app ceiling at
// the one-step search's rate. A seeded grid is sized until the one-step search's step 0 spends over 1.2c and under both
// 3c and 10,000,000. Every piece here is class data_view. One judgement of logic.budget's reply on that piece is applied
// to the real deep-logic and to `--planted budget_holds_steps_to_fuel_budget`.
import { describe, expect, it } from 'vitest';
import {
  FUEL_CAP, TIMEOUT, bakeCall, bakeOf, bins, budgetCall, budgetOf, ceilingOf, example, failsNaming, guideText, line, none,
  onMac, piece, prebuild, rateOf, stepTable, type Bake, type Budget, type Example, type JsonObject,
} from '../546/helpers.ts';
import { grid, routeProblems, type Grid } from '../546/programs.ts';

prebuild(() => { bins(); });

const TAG = '#546.4f54d30a';
const CLASS = 'data_view';
const SEED = 546_101;
const ID = 'search';
/** The split search must end within this many steps (546 README: The guide's examples). */
const SPLIT_STEPS = 600;
/** Grid sizes the search may try, and how many tries it gets. */
const MIN_SIDE = 8;
const MAX_SIDE = 1024;
const TRIES = 32;

/** A data_view piece of one of the guide's searches on grid `g`; its fuel budget the cap, its block's other budget kept. */
function searchPiece(ex: Example, g: Grid, every?: number): JsonObject {
  const budget = { ...(ex.params['budget'] as JsonObject | undefined ?? {}), fuel: FUEL_CAP };
  const params: JsonObject = { ...ex.params, budget };
  if (every !== undefined) params['checkpoint'] = { ...(ex.params['checkpoint'] as JsonObject | undefined ?? {}), every };
  return piece({ seed: SEED, class: CLASS, items: { [ID]: { program: ex.program, params, assets: [g.bytes] } } });
}

/** The search's arrays just after step k: whether it has ended, and its route. */
function after(b: Bake, k: number): { done: boolean; route: number[] } {
  const s = b.steps.find((x) => x.step === k);
  if (!s) return expect.fail(`the bake has no step ${k}`);
  const done = s.arrays[`${ID}.done`]?.[0];
  const len = Number(s.arrays[`${ID}.route_len`]?.[0] ?? 0);
  return { done: done === 1 || done === true, route: (s.arrays[`${ID}.route`] ?? []).slice(0, len).map(Number) };
}

interface Setup { c: number; one: Example; split: Example; g: Grid; lo: number; hi: number }
let made: Setup | undefined;
/** The guide's searches, the data view class's app ceiling c, and a grid whose one-step search spends in (1.2c, min(3c, cap)). */
function setup(): Setup {
  if (made) return made;
  const text = guideText();
  const one = example(text, 'grid_search');
  const split = example(text, 'grid_search_split');
  const c = ceilingOf(stepTable(), rateOf(one.params), CLASS, 'app');
  const lo = 1.2 * c;
  const hi = Math.min(3 * c, FUEL_CAP);
  expect(lo < hi, `some fuel lies over 1.2 times the data view class's app ceiling ${c} and under both 3 times it and the fuel budget's ${FUEL_CAP}`).toBe(true);
  const target = Math.sqrt(lo * hi);
  // A bracket of sides, taking the search's fuel to grow with the grid: a side that spent at most lo raises `low` past
  // it, one that spent at least hi (or trapped) lowers `high` below it.
  let low = MIN_SIDE;
  let high = MAX_SIDE;
  let side = 64;
  const tried = new Map<number, number>();
  for (let i = 0; i < TRIES && low <= high; i++) {
    const g = grid(side, SEED);
    const [reply] = onMac([bakeCall(searchPiece(one, g), { steps: 1 })]);
    const b = bakeOf(reply!, `the one-step search's bake on a ${side} × ${side} grid`);
    const fuel = b.traps.length ? Infinity : (b.steps[0]?.items[ID]?.fuel ?? 0);
    tried.set(side, fuel);
    if (fuel > lo && fuel < hi) return (made = { c, one, split, g, lo, hi });
    if (fuel <= lo) low = side + 1; else high = side - 1;
    const guess = Number.isFinite(fuel) && fuel > 0 ? Math.round(side * Math.sqrt(target / fuel)) : Math.floor((low + high) / 2);
    // A guess outside the bracket bisects it instead. Every side tried lies outside [low, high], so none repeats.
    side = guess < low || guess > high ? Math.floor((low + high) / 2) : guess;
  }
  return expect.fail(`no grid from ${MIN_SIDE} to ${MAX_SIDE} a side made the guide's one-step search spend over ${lo} and under ${hi} fuel at step 0 (side: fuel ${[...tried].map(([s, f]) => `${s}: ${f}`).join(', ')})`);
}

/** The criterion's judgement of logic.budget on the one-step search: FAIL, its ceiling failures exactly step 0 on host app at c. */
function oneStepProblems(b: Budget, c: number): string[] {
  const out: string[] = [];
  if (b.verdict !== 'FAIL') out.push(`logic.budget reads ${b.verdict} on the one-step search, whose step 0 passes the data view class's app ceiling ${c} on host app`);
  const ceiling = b.failures.filter((f) => f.rule === 'ceiling').map((f) => ({ item: f.item, step: f.step, host: f.host, ceiling: f.ceiling }));
  if (JSON.stringify(ceiling) !== JSON.stringify([{ item: ID, step: 0, host: 'app', ceiling: c }])) {
    out.push(`logic.budget's ceiling failures on the one-step search aren't exactly one naming item ${ID}, step 0, host app and ceiling ${c}: ${b.failures.map(line).join(', ') || 'none'}`);
  }
  return out;
}

describe(`${TAG} the guide's grid search in the data view class: past the app ceiling in one step, under it split across steps`, () => {
  it(`${TAG} the one-step search fails logic.budget naming step 0, host app and the data view ceiling; the split search finds the same route with every step under it, passes, and a seek into its middle equals playing`, () => {
    const { c, one, split, g, lo, hi } = setup();
    const [oneBake, oneBudget, splitBake, splitBudget] = onMac([
      bakeCall(searchPiece(one, g), { steps: 1 }), budgetCall(searchPiece(one, g), { steps: 1 }, ['app']),
      bakeCall(searchPiece(split, g), { steps: SPLIT_STEPS }), budgetCall(searchPiece(split, g), { steps: SPLIT_STEPS }, ['app']),
    ]);

    // Done in one step: in the window, a shortest route, and logic.budget fails it as the criterion says.
    const ob = bakeOf(oneBake!, 'the one-step search\'s bake');
    expect(ob.traps, 'the one-step search doesn\'t trap').toEqual([]);
    const fuel = ob.steps[0]?.items[ID]?.fuel ?? 0;
    expect(fuel > lo && fuel < hi, `the one-step search's step 0 spends ${fuel}: over 1.2 times the ceiling ${c}, under 3 times it and under ${FUEL_CAP}`).toBe(true);
    const found = after(ob, 0);
    expect(found.done, 'the one-step search ends at step 0').toBe(true);
    none(routeProblems(g, found.route, 'the one-step search\'s route'), 'the one-step search finds a shortest route');
    none(oneStepProblems(budgetOf(oneBudget!, 'logic.budget of the one-step search'), c), 'logic.budget fails the one-step search in the data view class as the criterion says');

    // Split across steps: every step at or under c, the same route cell for cell, and logic.budget passes it.
    const sb = bakeOf(splitBake!, 'the split search\'s bake');
    expect(sb.traps, 'the split search doesn\'t trap').toEqual([]);
    none(sb.steps.filter((s) => (s.items[ID]?.fuel ?? 0) > c).map((s) => `step ${s.step}: ${s.items[ID]?.fuel}`), `every step of the split search is at or under the data view class's app ceiling ${c}`);
    const d = sb.steps.find((s) => after(sb, s.step).done)?.step;
    if (d === undefined) return expect.fail(`the split search ends within ${SPLIT_STEPS} steps`);
    expect(d, 'the split search takes more than one step').toBeGreaterThan(0);
    expect(after(sb, d).route, 'the split search finds the one-step search\'s route, cell for cell').toEqual(found.route);
    const sbu = budgetOf(splitBudget!, 'logic.budget of the split search');
    expect(sbu.failures.map(line), 'logic.budget finds nothing in the split search in the data view class').toEqual([]);
    expect(sbu.verdict, 'logic.budget passes the split search in the data view class').toBe('PASS');

    // Seeking into the middle: checkpoints every E = ⌊d/2⌋ + 1 steps, so the one at E holds the search pending and the
    // one at 2E holds it ended; a seek to E restores the one at E and plays to 2E with playing's hashes there.
    const e = Math.floor(d / 2) + 1;
    const [seekBake] = onMac([bakeCall(searchPiece(split, g, e), { steps: 2 * e + 1, seeks: [{ to: e }] })]);
    const kb = bakeOf(seekBake!, `the split search's bake with a checkpoint every ${e} steps and a seek to step ${e}`);
    expect(kb.traps, 'the split search with checkpoints doesn\'t trap').toEqual([]);
    expect(after(kb, e - 1).done, `the search is still pending at the checkpoint at step ${e}`).toBe(false);
    expect(after(kb, 2 * e - 1).done, `the search has ended by the checkpoint at step ${2 * e}`).toBe(true);
    const seek = kb.seeks[0];
    if (!seek) return expect.fail('the bake reports the seek');
    expect([seek.from, seek.checkpoint.step], `the seek to ${e} restores the checkpoint at ${e} and plays to the next one, at ${2 * e}`).toEqual([e, 2 * e]);
    const playing = (kb.checkpoints[ID] ?? []).find((x) => x.step === 2 * e)?.deep_hash;
    expect(playing, `playing took a checkpoint at step ${2 * e}`).toBeDefined();
    expect(seek.checkpoint.deep_hash[ID], `seeking into the middle of the search equals playing by full-state hash at step ${2 * e}`).toBe(playing);
    expect(seek.hashes[ID], `the seek's steps ${e} to ${2 * e - 1} have playing's step hashes`).toEqual(kb.steps.filter((s) => s.step >= e && s.step < 2 * e).map((s) => s.items[ID]?.hash));
  }, TIMEOUT);

  it(`${TAG} budget_holds_steps_to_fuel_budget passes the one-step search, and the criterion fails on it naming step 0 and host app`, () => {
    const { c, one, g } = setup();
    const [planted] = onMac([budgetCall(searchPiece(one, g), { steps: 1 }, ['app'])], ['budget_holds_steps_to_fuel_budget']);
    const b = budgetOf(planted!, 'the planted logic.budget of the one-step search');
    expect(b.verdict, 'the planted logic.budget, holding each step to its fuel budget alone, passes the one-step search').toBe('PASS');
    failsNaming(oneStepProblems(b, c), ['step 0', 'host app'], 'budget_holds_steps_to_fuel_budget');
  }, TIMEOUT);
});
