// #1826.f1dd5338: A treemap of 4 leaves whose `size` reads 1, 1, 2 and 4, in a 400 × 200 u box, gives each leaf's
// rectangle an area in proportion within 0.5%, and the rectangles tile the box with no overlap and no gap over 0.5 u. A
// planted treemap that splits the box evenly fails, naming the leaf.
//
// `deep-graph layout` with `layout.algo: "treemap"` and `layout.box: [0, 0, 400, 200]`, the leaves t1, t2, t3, t4 with
// the new node column `size` 1, 1, 2, 4. Each leaf's rectangle is read from the answer's `boxes`. The areas asked are
// closed forms of the issue's numbers: size / 8 × 80,000 u² = 10,000, 10,000, 20,000 and 40,000 u². `treemapProblems`
// (helpers.ts) is the one check: it holds the honest treemap and must fail on the planted one.
import { describe, expect, it } from 'vitest';
import { TREEMAP_BOX, TREEMAP_SIZES, accepted, boxesOf, treemapLine, treemapProblems, useBins } from './helpers.ts';

const ID = '#1826.f1dd5338';
const bin = useBins(['deep-graph']);

describe(`${ID} treemap: 4 leaves sized 1, 1, 2 and 4 in a 400 × 200 u box`, () => {
  it(`${ID} each leaf's area is in proportion to its size within 0.5%, and the rectangles tile the box with no overlap and no gap over 0.5 u`, () => {
    const out = accepted(bin('deep-graph'), treemapLine(), 'the 4-leaf treemap');
    const boxes = boxesOf(out['boxes'], 'the treemap boxes');
    expect(Object.keys(boxes).sort(), 'one rectangle per leaf').toEqual(Object.keys(TREEMAP_SIZES).sort());
    expect(treemapProblems(boxes), `areas in proportion, tiling ${JSON.stringify(TREEMAP_BOX)}`).toEqual([]);
  });

  it(`${ID} a planted treemap that splits the box evenly fails, naming the leaf`, () => {
    const out = accepted(bin('deep-graph'), treemapLine({ planted: 'even_treemap' }), 'the planted even_treemap');
    const problems = treemapProblems(boxesOf(out['boxes'], 'the planted boxes'));
    // An even split gives each leaf 20,000 u²: t1 and t2 (size 1, asking 10,000) and t4 (size 4, asking 40,000) are out
    // of proportion; t3 (size 2) asks 20,000 and is not.
    expect(problems.length, `the treemap check fails on the even split: ${problems.join('; ')}`).toBeGreaterThan(0);
    expect(problems[0]!.split(':')[0], `the check names the leaf: ${problems[0]}`).toBe('t1');
    expect(problems.map((p) => p.split(':')[0]), 'the leaves out of proportion under an even split').toEqual(['t1', 't2', 't4']);
  });
});
