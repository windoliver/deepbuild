// #399.ea818db6: In a layered graph of 40 nodes in 6 ranks, adding one node to rank 4 with one edge from rank 3 leaves
// every node in ranks 1-3 and 5-6 at its x and y bit for bit and every rank's order unchanged, puts the new node in its
// neighbours' barycenter slot, and re-places only rank 4; a planted from-scratch layout with the same seed, which on
// this fixture moves a rank-2 node, fails naming it; and a change whose kept order can't hold returns
// layout.relayout_needed with the old picture kept and no node moved.
//
// `deep-graph layout` (#394's binary) with the memory a previous layout wrote. The memory's ranks count from 0, so the
// criterion's rank 4 is memory rank 3, rank 3 is 2 and rank 2 is 1. fixtures/layered-40.json is a hand-placed layered
// memory whose spacing no fresh layout gives, so a from-scratch layout moves its nodes (README: Fixtures).
import { describe, expect, it } from 'vitest';
import { accepted, arr, expectBadPlanted, fixture, lines, memoryOf, num, obj, show, useBins, type Entry, type JsonObject } from './helpers.ts';

const ID = '#399.ea818db6';
const bin = useBins(['deep-graph']);
const F = fixture('layered-40.json');
const GRAPH = obj(F['graph'], 'graph');
const NODES = arr(GRAPH['nodes'], 'nodes').map((n) => obj(n, 'node'));
const EDGES = arr(GRAPH['edges'], 'edges').map((e) => obj(e, 'edge'));
const ADDED = obj(F['added'], 'added');
const NEW_NODE = obj(ADDED['node'], 'added.node');
const NEW_EDGE = obj(ADDED['edge'], 'added.edge');
const OLD = memoryOf(F['memory'], 'the fixture memory');
const WIDTH = new Map([...NODES, NEW_NODE].map((n) => [String(n['id']), num(n['w'], 'w')]));
const RANK4 = 3; // the criterion's rank 4
const change = (planted?: string): JsonObject => ({
  graph: { nodes: [...NODES, NEW_NODE], edges: [...EDGES, NEW_EDGE] }, layout: F['layout']!, memory: F['memory']!, ...(planted ? { planted } : {}),
});

/** Every node outside rank 4 whose rank, order, x or y differs from the old memory, bit for bit, named with its rank. */
function keptProblems(next: Record<string, Entry>): string[] {
  const out: string[] = [];
  for (const [id, was] of Object.entries(OLD)) {
    if (was.rank === RANK4) continue;
    const now = next[id];
    const same = now && Object.is(now.rank, was.rank) && Object.is(now.order, was.order) && Object.is(now.x, was.x) && Object.is(now.y, was.y);
    if (!same) out.push(`${id} (rank ${was.rank + 1}) moved from ${show([was.rank, was.order, was.x, was.y])} to ${show(now ? [now.rank, now.order, now.x, now.y] : null)}`);
  }
  return out;
}
/** The slot among rank 4's kept nodes left of the new node's neighbours' mean centre x (its one neighbour's). */
function barycenterSlot(): number {
  const p = OLD[String(NEW_EDGE['a'])]!;
  const cx = p.x + WIDTH.get(String(NEW_EDGE['a']))! / 2;
  return Object.entries(OLD).filter(([id, e]) => e.rank === RANK4 && e.x + WIDTH.get(id)! / 2 < cx).length;
}

describe(`${ID} graph memory: one node added to rank 4`, () => {
  it(`${ID} adding one node to rank 4 keeps every other rank bit for bit, slots the new node at its neighbour's barycenter and re-places only rank 4; a change whose kept order can't hold is layout.relayout_needed with nothing moved`, () => {
    // The fixture: 40 nodes in 6 ranks, the new node's one edge from rank 3.
    expect([Object.keys(OLD).length, new Set(Object.values(OLD).map((e) => e.rank)).size], 'the fixture is 40 nodes in 6 ranks').toEqual([40, 6]);
    expect(OLD[String(NEW_EDGE['a'])]!.rank, 'the new node\'s one edge comes from rank 3').toBe(RANK4 - 1);
    const slot = barycenterSlot();
    expect(slot > 0 && slot < Object.values(OLD).filter((e) => e.rank === RANK4).length, `the barycenter slot (${slot}) is inside rank 4, not at either end`).toBe(true);

    const out = accepted(bin('deep-graph'), ['layout'], change(), 'the layout with one node added');
    const next = memoryOf(out['memory'], 'the memory after');
    expect(Object.keys(next).sort(), 'the memory holds the 40 nodes and the new one').toEqual([...Object.keys(OLD), 'n41'].sort());
    // A layout that relays out the graph moves a node outside rank 4 here.
    expect(keptProblems(next), 'every node in ranks 1-3 and 5-6 keeps its rank, order, x and y bit for bit').toEqual([]);

    const n = next['n41']!;
    expect([n.rank, n.order], 'the new node is in rank 4 at its neighbour\'s barycenter slot').toEqual([RANK4, slot]);
    const kept = Object.entries(OLD).filter(([, e]) => e.rank === RANK4);
    for (const [id, was] of kept) {
      // Rank 4's kept nodes keep their order among themselves, shifted past the new node.
      expect(next[id]!.order, `${id} keeps its order in rank 4 around the new node`).toBe(was.order + (was.order >= slot ? 1 : 0));
    }
    const row = [...kept.map(([id]) => id), 'n41'].sort((a, b) => next[a]!.order - next[b]!.order);
    for (let i = 1; i < row.length; i++) {
      const [l, r] = [next[row[i - 1]!]!, next[row[i]!]!];
      expect(r.x >= l.x + WIDTH.get(row[i - 1]!)! + 24, `rank 4 is still a rank: ${row[i]} sits at least 24 u right of ${row[i - 1]}`).toBe(true);
    }
    expect(arr(out['replaced'], 'replaced'), 'it re-placed rank 4 only').toEqual([RANK4]);

    // A change whose kept order can't hold: an edge from rank 5 up to rank 2.
    const broken = obj(F['broken'], 'broken');
    expect(OLD[String(broken['a'])]!.rank > OLD[String(broken['b'])]!.rank, 'the broken edge runs up the ranks').toBe(true);
    const [refused] = lines(bin('deep-graph'), ['layout'], [{ graph: { nodes: NODES, edges: [...EDGES, broken] }, layout: F['layout']!, memory: F['memory']! }]);
    expect([refused!['ok'], refused!['code']], `the change is refused with layout.relayout_needed: ${show(refused)}`).toEqual([false, 'layout.relayout_needed']);
    const keptPicture = memoryOf(refused!['memory'], 'the refusal\'s kept memory');
    expect(Object.keys(keptPicture).sort(), 'the old picture is kept: the same 40 nodes').toEqual(Object.keys(OLD).sort());
    const movedAny = Object.entries(OLD).filter(([id, was]) => !['rank', 'order', 'x', 'y'].every((k) => Object.is(keptPicture[id]![k as keyof Entry], was[k as keyof Entry])));
    expect(movedAny.map(([id]) => id), 'no node moved').toEqual([]);
  });

  it(`${ID} a planted from-scratch layout with the same seed moves a rank-2 node and fails, naming it`, () => {
    const out = accepted(bin('deep-graph'), ['layout'], change('from_scratch'), 'the planted from-scratch layout');
    const problems = keptProblems(memoryOf(out['memory'], 'the planted memory'));
    const rank2 = Object.entries(OLD).filter(([, e]) => e.rank === 1).map(([id]) => id);
    // The check that holds the honest layout fails on the planted one, naming a rank-2 node it moved.
    expect(problems.filter((p) => rank2.some((id) => p.startsWith(`${id} (rank 2)`))).length, `the kept-ranks check fails naming a rank-2 node: ${problems.slice(0, 5).join('; ')}`).toBeGreaterThan(0);
    expectBadPlanted(bin('deep-graph'), ['layout'], change());
  });
});
