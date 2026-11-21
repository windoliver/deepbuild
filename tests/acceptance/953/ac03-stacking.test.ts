// AC3 #953.a587d88d: "Base 10 with add 5, percent 20 and cap 16 totals 16, and without the cap totals 18; a planted
// library that applies the percent before the add (giving 17) fails, naming the stat"
//
// Through `deep-logic bake` (README: The surface): scenes.ts's stack, an archer (attack 10 in the catalog) under a hero
// whose rows reach it, read as two driver items of one piece linking modslib@1's reference library through mods.lib@1:
// `capped` (add 5, percent 20, cap 16) and `uncapped` (add 5, percent 20). The rule (model.ts: finish): (10 + 5) × 1.2
// = 18, the lowest cap 16 → 16; without it, 18.
// The wrong program: mods_pct_first@1 (programs.ts: library({pctFirst: true})) gives 10 × 1.2 + 5 = 17 without the cap
// (16 with it, as the cap hides the order); the judgement fails naming the stat, attack.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, prebuild } from '../190/helpers.ts';
import { AC, bakeAndJudge, linkOf, modsPack, piece, type TwinName } from './helpers.ts';
import { expectedOf } from './model.ts';
import { stackPlan } from './scenes.ts';

prebuild(() => { logicBin(); });

function stacks(which: 'ref' | TwinName) {
  const { module, link, packs } = linkOf(which);
  const capped = stackPlan(true), uncapped = stackPlan(false);
  const p = piece({ capped: { plan: capped, nodes: 3, reads: 1, module, link }, uncapped: { plan: uncapped, nodes: 3, reads: 1, module, link } }, packs);
  return bakeAndJudge([{
    piece: p, steps: 1,
    items: [{ item: 'capped', label: `the capped stack on ${link.name}`, plan: capped, nodes: 3 }, { item: 'uncapped', label: `the uncapped stack on ${link.name}`, plan: uncapped, nodes: 3 }],
  }], 1);
}

describe(`${AC[3]} adds, then percents, then the lowest cap, rounded once`, () => {
  it(`${AC[3]} base 10 with add 5, percent 20 and cap 16 totals 16, and without the cap totals 18`, () => {
    expect([expectedOf(stackPlan(true), 3)[0]!.values, expectedOf(stackPlan(false), 3)[0]!.values], 'the rule gives 16 with the cap and 18 without').toEqual([[16], [18]]);
    const wrong = stacks('ref');
    expect(wrong.map((w) => w.message), 'the reference library totals 16 and 18').toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} a planted library that applies the percent before the add (giving 17) fails, naming the stat`, () => {
    modsPack();
    const wrong = stacks('pctFirst');
    expect(wrong.map((w) => [w.item, w.node, w.expected, w.actual]), 'mods_pct_first@1 totals 17 without the cap, where the rule gives 18').toEqual([['uncapped', 2, 18, 17]]);
    expect(wrong[0]!.message, 'the failure names the stat').toContain('stat attack');
  }, TIMEOUT);
});
