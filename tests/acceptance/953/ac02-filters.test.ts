// AC2 #953.cfdaeec8: "An item on a holder that adds 2 to attack with the filter kind = archer raises every archer stack
// the holder carries by 2 and no other stack, and after the item moves to another holder the first holder's archers lose
// it at the next read; a planted library that tests filters on the source instead of the receiving node fails, naming
// the stack"
//
// Through `deep-logic bake` (README: The surface): scenes.ts's archers, one driver item linking modslib@1's reference
// library through mods.lib@1, every node's attack read after each step. Holder A carries archers 2 and 3, archer 5
// under archer 2, and swordsman 4; holder B carries archer 8 and pikeman 9; another side's hero carries archer 12. The
// item's row (attack +2, kind = archer, reach down) names its holder as source (README: Readings), so at step 0 the
// archers 2, 3 and 5 read 12, every other node its base; at step 1 the item has moved to B (the item node moves, its
// row is removed and added with B as source), and the next read gives A's archers 10 and B's archer 12.
// The wrong program: mods_on_source@1 (programs.ts: library({onSource: true})) tests the filter on the row's source,
// holder A, a hero, so no archer gets the 2; the judgement fails naming archer stack 2.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, prebuild } from '../190/helpers.ts';
import { AC, bakeAndJudge, linkOf, modsPack, piece, type TwinName } from './helpers.ts';
import { expectedOf } from './model.ts';
import { ARCHERS, archersPlan } from './scenes.ts';

prebuild(() => { logicBin(); });

function archers(which: 'ref' | TwinName) {
  const { module, link, packs } = linkOf(which);
  const p = piece({ archers: { plan: archersPlan, nodes: ARCHERS.nodes, reads: ARCHERS.nodes, module, link } }, packs);
  return bakeAndJudge([{ piece: p, steps: archersPlan.steps.length, items: [{ item: 'archers', label: `the archers on ${link.name}`, plan: archersPlan, nodes: ARCHERS.nodes }] }], 1);
}

describe(`${AC[2]} a filter on the receiving node's catalog row decides which stacks an item's modifier raises`, () => {
  it(`${AC[2]} an item adding 2 to attack for kind = archer raises every archer stack its holder carries by 2 and no other stack, and after the item moves to another holder the first holder's archers lose it at the next read`, () => {
    // The rule's reads, worked here, are the issue's: +2 on A's archers only, then on B's archer only.
    const [onA, onB] = expectedOf(archersPlan, ARCHERS.nodes).map((e) => e.values);
    const base = (n: number): number => ({ 1: 5, 7: 5, 11: 5, 4: 12, 9: 8, 6: 0, 0: 0, 10: 0 } as Record<number, number>)[n] ?? 10;
    expect(onA, 'at step 0 archers 2, 3 and 5 read 12, every other node its base').toEqual(Array.from({ length: ARCHERS.nodes }, (_, n) => base(n) + (ARCHERS.archersA.includes(n) ? 2 : 0)));
    expect(onB, 'after the move archer 8 reads 12, A\'s archers their base 10').toEqual(Array.from({ length: ARCHERS.nodes }, (_, n) => base(n) + (n === ARCHERS.archerB ? 2 : 0)));
    const wrong = archers('ref');
    expect(wrong.map((w) => w.message), 'the reference library reads every attack the rule gives, before and after the move').toEqual([]);
  }, TIMEOUT);

  it(`${AC[2]} a planted library that tests filters on the source instead of the receiving node fails, naming the stack`, () => {
    modsPack();
    const wrong = archers('onSource');
    expect(wrong.length, 'mods_on_source@1 reads an attack the rule doesn\'t give').toBe(1);
    const w = wrong[0]!;
    expect([w.step, w.node, w.expected, w.actual], 'it fails at archer stack 2 under holder A: 12 expected, its base 10 read').toEqual([0, ARCHERS.archersA[0], 12, 10]);
    expect(w.message, 'the failure names the stack').toContain(`node ${ARCHERS.archersA[0]}`);
  }, TIMEOUT);
});
