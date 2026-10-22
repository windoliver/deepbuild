import { describe, expect, it } from 'vitest';
import { GRAPH_BIN, arr, clone, expectBadInput, fixture, num, obj, rawLines, useBinaries, type JsonObject, type JsonValue } from './helpers.ts';

useBinaries('deep-graph');

const INPUT = fixture('layered.graph.json');
const GRAPH = obj(INPUT['graph'], 'the fixture graph');
const NODES = arr(GRAPH['nodes'], 'the fixture nodes').map((n) => obj(n, 'a node'));
const EDGES = arr(GRAPH['edges'], 'the fixture edges').map((e) => obj(e, 'an edge'));
const IDS = NODES.map((n) => n['id'] as string);
/** The layout's spacing defaults (graph@1): between nodes of a rank, and between ranks, in u. */
const NODE_GAP = 24;
const RANK_GAP = 48;

interface Entry { rank: number; order: number; x: number; y: number }

/** The layout memory: node ID → [rank, order, x, y]. */
function memoryOf(out: JsonObject, what: string): Record<string, Entry> {
  const memory = obj(out['memory'], `${what}: memory`);
  const entries: Record<string, Entry> = {};
  for (const [id, value] of Object.entries(memory)) {
    const t = arr(value, `${what}: memory[${id}]`);
    expect(t.length, `${what}: memory[${id}] is [rank, order, x, y]`).toBe(4);
    const [rank, order, x, y] = t.map((v, i) => num(v, `${what}: memory[${id}][${i}]`)) as [number, number, number, number];
    expect(Number.isInteger(rank) && rank >= 0 && Number.isInteger(order) && order >= 0, `${what}: ${id}'s rank and order are whole numbers`).toBe(true);
    entries[id] = { rank, order, x, y };
  }
  return entries;
}

function layout(input: JsonObject): { line: string; memory: Record<string, Entry> } {
  const [line] = rawLines(GRAPH_BIN, 'layout', [input]);
  const out = obj(JSON.parse(line!) as JsonValue, 'deep-graph layout: the answer');
  expect(out['ok'], `deep-graph layout refused: ${line!.slice(0, 2000)}`).toBe(true);
  return { line: line!, memory: memoryOf(out, 'layout') };
}

/** The memory part of an output line, exactly as the binary wrote it. */
const memoryText = (line: string): string => JSON.stringify((JSON.parse(line) as JsonObject)['memory']);

/** The basic layered layout's shape: edges go down the ranks, each rank in order left to right, no overlaps. */
function expectLayered(memory: Record<string, Entry>): void {
  const size = new Map(NODES.map((n) => [n['id'] as string, { w: n['w'] as number, h: n['h'] as number }]));
  for (const e of EDGES) {
    const a = memory[e['a'] as string]!;
    const b = memory[e['b'] as string]!;
    expect(b.rank >= a.rank + 1, `edge ${String(e['id'])} (${String(e['a'])} → ${String(e['b'])}) goes down at least one rank: ${a.rank} → ${b.rank}`).toBe(true);
  }
  const ranks = [...new Set(Object.values(memory).map((m) => m.rank))].sort((p, q) => p - q);
  for (const r of ranks) {
    const row = IDS.filter((id) => memory[id]!.rank === r).sort((p, q) => memory[p]!.order - memory[q]!.order);
    expect(row.map((id) => memory[id]!.order), `rank ${r}'s orders are 0, 1, 2, …`).toEqual(row.map((_, i) => i));
    for (let i = 1; i < row.length; i++) {
      const left = memory[row[i - 1]!]!;
      const right = memory[row[i]!]!;
      expect(right.x >= left.x + size.get(row[i - 1]!)!.w + NODE_GAP, `in rank ${r}, ${row[i]} sits right of ${row[i - 1]} by at least ${NODE_GAP} u`).toBe(true);
    }
  }
  for (let k = 1; k < ranks.length; k++) {
    const above = IDS.filter((id) => memory[id]!.rank === ranks[k - 1]);
    const below = IDS.filter((id) => memory[id]!.rank === ranks[k]);
    const bottom = Math.max(...above.map((id) => memory[id]!.y + size.get(id)!.h));
    const top = Math.min(...below.map((id) => memory[id]!.y));
    expect(top >= bottom + RANK_GAP, `rank ${ranks[k]} starts at least ${RANK_GAP} u below rank ${ranks[k - 1]} (direction down)`).toBe(true);
  }
}

describe('AC2 re-rendering the basic layered layout with no change moves no node, and each node\'s rank, order and position is stored by stable ID', () => {
  it('AC2 the layout memory holds every node by its stable ID as [rank, order, x, y], and it is a layered layout', () => {
    const first = layout(INPUT);
    expect(Object.keys(first.memory).sort(), 'the memory is keyed by the nodes\' own IDs, one entry each').toEqual([...IDS].sort());
    // A layout that returns nothing, or stacks every node at the origin, fails here.
    expectLayered(first.memory);
  });

  it('AC2 re-rendering with the memory and no change moves no node, and the same graph, memory and seed give the same bytes', () => {
    const first = layout(INPUT);
    const again = layout({ ...INPUT, memory: obj(JSON.parse(memoryText(first.line)) as JsonValue, 'memory') });
    // A layout seeded from the clock, or iterating a per-process hash map, moves a node here.
    expect(memoryText(again.line), 're-rendered with its memory and no change, every node keeps its rank, order, x and y, bit for bit').toBe(memoryText(first.line));
    const third = layout({ ...INPUT, memory: obj(JSON.parse(memoryText(first.line)) as JsonValue, 'memory') });
    expect(third.line, 'the same graph, memory and seed give the same bytes in another process').toBe(again.line);
    const fresh = layout(INPUT);
    expect(fresh.line, 'the same graph and seed with no memory give the same bytes in another process').toBe(first.line);
    const twice = rawLines(GRAPH_BIN, 'layout', [INPUT, INPUT]);
    expect(twice[1], 'and twice in one process').toBe(twice[0]);
  });

  it('AC2 the memory is keyed by node ID: the same graph with its rows in another order keeps every node\'s entry', () => {
    const first = layout(INPUT);
    const reordered = clone(INPUT);
    const graph = obj(reordered['graph'], 'graph');
    graph['nodes'] = [...arr(graph['nodes'], 'nodes')].reverse();
    graph['edges'] = [...arr(graph['edges'], 'edges')].reverse();
    const again = layout({ ...reordered, memory: obj(JSON.parse(memoryText(first.line)) as JsonValue, 'memory') });
    // A memory read or written by row position gives the reversed rows other nodes' places.
    for (const id of IDS) {
      expect(again.memory[id], `node ${id} keeps its rank, order, x and y when the rows are reordered`).toEqual(first.memory[id]);
    }
  });

  it('AC2 deep-graph layout answers bad_input to a line it can\'t read', () => {
    expectBadInput(GRAPH_BIN, 'layout');
  });
});
