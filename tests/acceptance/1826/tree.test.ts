// #1826.8c543993: A binary tree of 7 nodes laid out `tree` with direction down puts each child 48 u below its parent and
// each parent centered over its two children within 0.5 u, and the same graph twice gives the same bytes. The same
// graph with one more edge that closes a cycle is refused, naming that edge. A planted layout that ranks nodes by ID
// order instead of depth fails, naming the first misplaced node.
//
// `deep-graph layout` (#394's binary, JSON lines) with `layout.algo: "tree"`. The fixture's IDs are numbered in order
// (n4 the root; n2, n6; n1, n3, n5, n7), so ID order is not depth order and n1, the first ID, is a leaf at depth 2.
// `treeProblems` (helpers.ts) is the one check: it holds the honest layout and must fail on the planted one.
import { describe, expect, it } from 'vitest';
import { CYCLE_EDGE, TREE_EDGES, TREE_NODES, accepted, lines, memoryOf, rawLines, show, treeLine, treeProblems, useBins } from './helpers.ts';

const ID = '#1826.8c543993';
const bin = useBins(['deep-graph']);

describe(`${ID} tree: the 7-node binary tree`, () => {
  it(`${ID} laid out tree, direction down: each child 48 u below its parent, each parent centred over its two children within 0.5 u, and the same graph twice gives the same bytes`, () => {
    const out = accepted(bin('deep-graph'), treeLine(), 'the 7-node tree');
    const memory = memoryOf(out['memory'], 'the tree memory');
    expect(Object.keys(memory).sort(), 'the memory holds the 7 nodes').toEqual(TREE_NODES.map((n) => String(n['id'])).sort());
    expect(treeProblems(memory), 'one rank per depth, each child 48 u below its parent, each parent centred over its children, siblings spacing.node apart').toEqual([]);

    // The same graph, in two processes: the same bytes.
    const [first] = rawLines(bin('deep-graph'), ['layout'], [treeLine()]);
    const [second] = rawLines(bin('deep-graph'), ['layout'], [treeLine()]);
    expect(second, 'the same graph twice gives the same bytes').toBe(first);
  });

  it(`${ID} the same graph with one more edge that closes a cycle is refused, naming that edge`, () => {
    const [out] = lines(bin('deep-graph'), ['layout'], [{ ...treeLine(), graph: { nodes: TREE_NODES, edges: [...TREE_EDGES, CYCLE_EDGE] } }]);
    expect([out!['ok'], out!['code']], `the graph with ${String(CYCLE_EDGE['id'])} is refused as no tree: ${show(out)}`).toEqual([false, 'layout.not_a_tree']);
    expect(out!['names'], 'the refusal names the edge that closes the cycle').toBe(CYCLE_EDGE['id']);
  });

  it(`${ID} a planted layout that ranks nodes by ID order instead of depth fails, naming the first misplaced node`, () => {
    const out = accepted(bin('deep-graph'), treeLine({ planted: 'rank_by_id' }), 'the planted rank_by_id layout');
    const problems = treeProblems(memoryOf(out['memory'], 'the planted memory'));
    // The check that holds the honest tree fails on the plant; its first problem names n1, the first ID, a leaf at
    // depth 2 that any ranking by ID order puts in rank 0.
    expect(problems.length, `the tree check fails on the planted layout: ${problems.join('; ')}`).toBeGreaterThan(0);
    expect(problems[0]!.split(':')[0], `the first misplaced node is named: ${problems[0]}`).toBe('n1');
  });
});
