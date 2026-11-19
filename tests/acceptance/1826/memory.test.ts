// #1826.86ed5db7: Adding one leaf under a leaf of the 7-node tree keeps every kept node's rank, order, x and y bit for
// bit, since no kept rank's width changes.
//
// `deep-graph layout` with `layout.algo: "tree"`: the 7-node tree laid out with no memory, then the same graph with n8
// added under leaf n3 (edge e8), laid out with the memory the first answer wrote (Graph and layout memory: the memory
// the view holds). n8 sorts last by ID but hangs under the second leaf from the left.
import { describe, expect, it } from 'vitest';
import { ADDED_EDGE, ADDED_LEAF, TREE_EDGES, TREE_NODES, accepted, entryText, memoryOf, sameEntry, treeLine, useBins } from './helpers.ts';

const ID = '#1826.86ed5db7';
const bin = useBins(['deep-graph']);

describe(`${ID} tree memory: one leaf added under a leaf`, () => {
  it(`${ID} adding one leaf under a leaf of the 7-node tree keeps every kept node's rank, order, x and y bit for bit`, () => {
    const first = accepted(bin('deep-graph'), treeLine(), 'the 7-node tree');
    const before = memoryOf(first['memory'], 'the tree memory');
    expect(Object.keys(before).length, 'the first layout holds the 7 nodes').toBe(7);

    const out = accepted(bin('deep-graph'), {
      ...treeLine(), graph: { nodes: [...TREE_NODES, ADDED_LEAF], edges: [...TREE_EDGES, ADDED_EDGE] }, memory: first['memory']!,
    }, 'the tree with n8 added under n3, with its memory');
    const after = memoryOf(out['memory'], 'the memory after');
    expect(Object.keys(after).sort(), 'the memory holds the 7 kept nodes and n8').toEqual([...Object.keys(before), 'n8'].sort());
    const moved = Object.keys(before).filter((id) => !sameEntry(after[id], before[id])).map((id) => `${id} from ${entryText(before[id])} to ${entryText(after[id])}`);
    expect(moved, 'every kept node keeps its rank, order, x and y bit for bit').toEqual([]);
  });
});
