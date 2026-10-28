// AC4: "A test outside pack chart@1.0.0, whose recipe chart.bars@1 lays out n rects from its inputs,
// checks and draws in a build without scene3d: an instance c1 with {n: 5} expands at check into c1.bars.0
// to c1.bars.4, the same bytes twice, and a second instance c2 with equal inputs shares c1's expansion key
// and draws in one instanced batch with it; an n outside the input's range is refused with out_of_range,
// naming n; and a planted expander that seeds by expansion order instead of (instance, step, index) gives
// c2's rects other seeds and fails, naming the item"
//
// asserts: in the `r1` build (no scene3d), a board naming test/chart@1.0.0 with c1 {n: 5} and c2 {n: 5} is
// presented with a snapshot; c1's expansion holds exactly c1.bars.0 … c1.bars.4, each a rect@1; two fresh
// processes give the same expansion bytes; c2's key is c1's and one batch draws all ten derived items;
// c3 {n: 20} (max 12) is refused with out_of_range at items/c3/params/n naming c3; c2's seeds are the same
// alone and beside c1 (`seedFailures`), and `seeds_by_expansion_order` fails that check naming c2.bars.0.

import { describe, expect, it } from 'vitest';
import {
  CHART, DOC, R1, batches, board, canon, derivedIds, errors, expansionOf, failsNaming, instance, issues, none, outcome, packAt, run, scenario, seedFailures,
  show, snapshots, sorted, useBuilds, useEvidence, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();

const c1 = instance('c1', 'chart.bars@1', { n: 5 }, 'a0', [40, 40]);
const c2 = instance('c2', 'chart.bars@1', { n: 5 }, 'a1', [40, 200]);
const pair = board('Two bar charts', [packAt(CHART)], [c1, c2]);
const alone = board('One bar chart', [packAt(CHART)], [c2]);
const C1 = derivedIds('c1', 'bars', 5);
const C2 = derivedIds('c2', 'bars', 5);

function seedsAloneAndTogether(planted?: string): { alone: JsonObject; together: JsonObject } {
  const [a, t] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: 'main', [DOC.b]: 'main' }, [CHART], [
    show(alone, { pixels: true }),
    show(pair, { pixels: true, doc: DOC.b }),
  ], planted ? { planted } : {}));
  return { alone: a!, together: t! };
}

describe('AC4 the 2D chart pack checks and draws without scene3d: expansion at check, shared keys, instanced draws, out_of_range, seeds', () => {
  it('AC4 c1 {n: 5} expands into c1.bars.0 … c1.bars.4, the same bytes in two processes, and c2 shares its key and its instanced batch', () => {
    const play = (): JsonObject => run(builds.bin(R1), scenario(evidence(), { [DOC.a]: 'main' }, [CHART], [show(pair, { pixels: true })]))[0]!;
    const first = play();
    expect(outcome(first), `the pair is presented in the build without scene3d: ${JSON.stringify(first['issues']).slice(0, 600)}`).toBe('presented');
    expect(snapshots(first).length, 'and drawn').toBe(1);
    const e1 = expansionOf(first, 'c1');
    expect(sorted(Object.keys(e1.derived)), 'c1 expands into c1.bars.0 … c1.bars.4').toEqual(C1);
    for (const id of C1) expect(e1.derived[id]!['kind'], `${id} is a rect`).toBe('rect@1');
    expect(e1.pack, 'the expansion came through test/chart@1.0.0').toBe(packAt(CHART));
    const e2 = expansionOf(first, 'c2');
    expect(sorted(Object.keys(e2.derived)), 'c2 expands into c2.bars.0 … c2.bars.4').toEqual(C2);
    expect(e2.key, 'c2, with equal inputs, shares c1\'s expansion key').toBe(e1.key);
    const all = [...C1, ...C2];
    const shared = batches(first).filter((b) => all.every((id) => b.items.includes(id)));
    expect(shared.length, `one instanced batch draws all ten derived items; the batches were ${JSON.stringify(batches(first)).slice(0, 800)}`).toBe(1);
    const second = play();
    expect(canon(second['expansions']), 'a second process expands to the same bytes').toBe(canon(first['expansions']));
    expect(snapshots(second)[0]?.sha256, 'and draws the same pixels').toBe(snapshots(first)[0]?.sha256);
  });

  it('AC4 an n outside the input\'s range is refused with out_of_range naming n', () => {
    const c3 = instance('c3', 'chart.bars@1', { n: 20 }, 'a2', [40, 300]);
    const [reply] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: 'main' }, [CHART], [show(board('Too many bars', [packAt(CHART)], [c1, c3]), { pixels: true })]));
    expect(outcome(reply!), 'the board with n = 20 (max 12) is refused').toBe('refused');
    const range = errors(issues(reply!)).filter((i) => i.code === 'out_of_range');
    expect(range.length, `an out_of_range error: ${JSON.stringify(reply!['issues']).slice(0, 600)}`).toBeGreaterThan(0);
    expect(range.some((i) => i.path === 'items/c3/params/n' && i.ids.includes('c3')), `out_of_range names n at items/c3/params/n on c3: ${JSON.stringify(range.map((i) => [i.path, i.ids]))}`).toBe(true);
  });

  it('AC4 seeds come from (instance, step, index): c2\'s seeds are the same alone and beside c1', () => {
    const { alone: a, together: t } = seedsAloneAndTogether();
    expect(outcome(a), 'c2 alone is presented').toBe('presented');
    expect(outcome(t), 'the pair is presented').toBe('presented');
    none(seedFailures(expansionOf(a, 'c2', 'alone'), expansionOf(t, 'c2', 'beside c1'), 'c2'), 'the seeds of c2\'s derived items');
  });

  it('AC4 a planted expander that seeds by expansion order gives c2\'s rects other seeds and fails this check, naming the item', () => {
    const { alone: a, together: t } = seedsAloneAndTogether('seeds_by_expansion_order');
    failsNaming(seedFailures(expansionOf(a, 'c2', 'alone'), expansionOf(t, 'c2', 'beside c1'), 'c2'), ['c2.bars.0'], 'the expander that seeds by expansion order');
  });
});
