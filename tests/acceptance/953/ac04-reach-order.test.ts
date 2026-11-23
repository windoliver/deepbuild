// AC4 #953.e5d20c0f: "A modifier with reach `side` reaches every node under its side and none under the other's; a
// modifier of 3 rounds is present at the read before the 3rd round's boundary and gone at the read after it; the same
// rows listed in another order give the same totals; a planted library that rounds at each add differs on at least one
// seeded tree and fails, naming the tree and the node"
//
// Through `deep-logic bake` (README: The surface), every item linking modslib@1's reference library through mods.lib@1:
// - `side` (scenes.ts): archer 2's morale +3, reach side, raises nodes 1 to 6 (everything under side red, the archer
//   itself among them) and none of side blue's (7 to 10).
// - `rounds` (scenes.ts): hero 1's attack +5 to archer 2 for 3 rounds; each round two turn boundaries, then the round's.
//   The archer reads 15 after rounds 1 and 2 and before round 3's boundary, and 10 after it.
// - Order: 25 seeded trees (seeds.json `order`, no two sets sharing a source and a stat, so the tie rule's row order
//   never decides), each built three times in one piece, its rows added as generated, reversed and in a seeded
//   shuffle: every total equal across the three and to the brute-force recompute.
// The wrong program: mods_round_each@1 (programs.ts: library({roundEach: true})) rounds each percent's share toward
// zero on its own; on the same 25 trees it reads a total the rule doesn't give, and the judgement names the tree (its
// seed) and the node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, prebuild } from '../190/helpers.ts';
import { AC, bakeAndJudge, linkOf, modsPack, piece, type DriverItem, type Judged, type TwinName } from './helpers.ts';
import { STATS, caseSeed, expectedOf, rng, seededCase, setupPlan, type Plan } from './model.ts';
import { SIDES, roundsPlan, sidePlan } from './scenes.ts';

prebuild(() => { logicBin(); });

const SEEDS = JSON.parse(readFileSync(new URL('./seeds.json', import.meta.url), 'utf8')) as { order: { seed: number; cases: number; maxNodes: number; maxRows: number } };
const ORDERS = ['as generated', 'reversed', 'shuffled'] as const;

/** The 25 order trees, each in three orders of its rows, as items `o<i>_<order>`. */
function orderItems(which: 'ref' | TwinName, orders: readonly (typeof ORDERS)[number][]) {
  const { module, link, packs } = linkOf(which);
  const items: Record<string, DriverItem> = {};
  const judged: Judged[] = [];
  for (let i = 0; i < SEEDS.order.cases; i++) {
    const c = seededCase(caseSeed(SEEDS.order.seed, i), { maxNodes: SEEDS.order.maxNodes, maxRows: SEEDS.order.maxRows, edits: 0 }, true);
    const r = rng(c.seed ^ 0x5eed);
    const ids = c.adds.map((_, k) => k);
    const shuffled = [...ids];
    for (let k = shuffled.length - 1; k > 0; k--) { const j = r.int(0, k); [shuffled[k], shuffled[j]] = [shuffled[j]!, shuffled[k]!]; }
    const plans: Record<(typeof ORDERS)[number], Plan> = { 'as generated': setupPlan(c), reversed: setupPlan(c, [...ids].reverse()), shuffled: setupPlan(c, shuffled) };
    for (const o of orders) {
      const id = `o${i}_${ORDERS.indexOf(o)}`;
      items[id] = { plan: plans[o], nodes: c.nodes, reads: SEEDS.order.maxNodes * STATS.length, module, link };
      judged.push({ item: id, label: `tree ${c.seed} (order case ${i}, rows ${o})`, plan: plans[o], nodes: c.nodes });
    }
  }
  return { piece: piece(items, packs), steps: 1, items: judged };
}

describe(`${AC[4]} side reach, durations by round, order independence and one rounding`, () => {
  it(`${AC[4]} a modifier with reach side reaches every node under its side and none under the other's, and a modifier of 3 rounds is present at the read before the 3rd round's boundary and gone at the read after it`, () => {
    const [side] = expectedOf(sidePlan, SIDES.nodes);
    const bases = expectedOf({ ...sidePlan, steps: [{ ...sidePlan.steps[0]!, edits: sidePlan.steps[0]!.edits.filter((e) => e.kind !== 'add') }] }, SIDES.nodes)[0]!.values;
    expect(side!.values.map((v, n) => v - bases[n]!), 'by the rule, +3 on every node under side red (1 to 6) and on none of side blue\'s (7 to 10)')
      .toEqual(Array.from({ length: SIDES.nodes }, (_, n) => (SIDES.red.includes(n) ? 3 : 0)));
    expect(expectedOf(roundsPlan, 3).map((e) => e.values[0]), 'by the rule the archer reads 15 until round 3\'s boundary and 10 after it').toEqual([15, 15, 15, 15, 10]);
    const { module, link, packs } = linkOf('ref');
    const p = piece({
      side: { plan: sidePlan, nodes: SIDES.nodes, reads: SIDES.nodes, module, link },
      rounds: { plan: roundsPlan, nodes: 3, reads: 1, module, link },
    }, packs);
    const wrong = bakeAndJudge([{ piece: p, steps: roundsPlan.steps.length, items: [
      { item: 'side', label: 'the aura, reach side', plan: sidePlan, nodes: SIDES.nodes },
      { item: 'rounds', label: 'the 3-round add', plan: roundsPlan, nodes: 3 },
    ] }], 1);
    expect(wrong.map((w) => w.message), 'the reference library reads what the rule gives').toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} the same rows listed in another order give the same totals`, () => {
    const g = orderItems('ref', ORDERS);
    for (let i = 0; i < SEEDS.order.cases; i++) {
      const [a, b, c] = ORDERS.map((_, k) => expectedOf(g.items[3 * i + k]!.plan, g.items[3 * i + k]!.nodes)[0]!.values);
      expect([b, c], `by the rule, order case ${i}'s totals don't depend on the order its rows were added`).toEqual([a, a]);
    }
    const wrong = bakeAndJudge([g], 1);
    expect(wrong.map((w) => w.message), 'the reference library reads, in every order, the totals the rule gives').toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} a planted library that rounds at each add differs on at least one seeded tree and fails, naming the tree and the node`, () => {
    modsPack();
    const g = orderItems('roundEach', ['as generated']);
    const wrong = bakeAndJudge([g], 1);
    expect(wrong.length, 'mods_round_each@1 reads a total the rule doesn\'t give on at least one of the 25 seeded trees').toBeGreaterThan(0);
    const w = wrong[0]!;
    expect(w.message, 'the failure names the tree').toMatch(new RegExp(`^tree ${w.label.split(' ')[1]} `));
    expect(w.message, 'and the node').toContain(`node ${w.node},`);
  }, TIMEOUT);
});
