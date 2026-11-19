// #1826.52792868: A grid of 10 nodes lays out in rows of 4, 4 and 2 in stable-ID order. An 11th node whose ID sorts
// last lands at the end of the third row and leaves the first 10 where they were, bit for bit.
//
// `deep-graph layout` with `layout.algo: "grid"`: g01 … g10 (40 × 24 u, listed shuffled), rows of ceil(√10) = 4 at
// spacing.node (24 u, the design's default). The 11th, g11, is laid out with the memory the first answer wrote
// (ceil(√11) is 4 too). Rows are read from the answer as drawn: nodes of one y, left to right.
import { describe, expect, it } from 'vitest';
import {
  GRID_ELEVENTH, GRID_IDS, GRID_LAYOUT, GRID_NODES, H, SPACING_NODE, W, accepted, entryText, gridRows, memoryOf, useBins,
  type Entry,
} from './helpers.ts';

const ID = '#1826.52792868';
const bin = useBins(['deep-graph']);
const FLOAT = 1e-9;

/** Neighbours in a row spacing.node apart, and each row spacing.node below the one above, box edge to box edge. */
function spacingProblems(memory: Record<string, Entry>, rows: string[][]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    for (let i = 1; i < row.length; i++) {
      const gap = memory[row[i]!]!.x - (memory[row[i - 1]!]!.x + W);
      if (Math.abs(gap - SPACING_NODE) > FLOAT) out.push(`${row[i]} stands ${gap} u right of ${row[i - 1]}, not ${SPACING_NODE}`);
    }
  }
  for (let r = 1; r < rows.length; r++) {
    const gap = memory[rows[r]![0]!]!.y - (memory[rows[r - 1]![0]!]!.y + H);
    if (Math.abs(gap - SPACING_NODE) > FLOAT) out.push(`row ${r + 1} stands ${gap} u below row ${r}, not ${SPACING_NODE}`);
  }
  return out;
}

describe(`${ID} grid: 10 nodes, then an 11th`, () => {
  it(`${ID} 10 nodes lay out in rows of 4, 4 and 2 in stable-ID order; an 11th whose ID sorts last lands at the end of the third row and leaves the first 10 where they were, bit for bit`, () => {
    const out = accepted(bin('deep-graph'), { graph: { nodes: GRID_NODES, edges: [] }, layout: GRID_LAYOUT }, 'the 10-node grid');
    const ten = memoryOf(out['memory'], 'the grid memory');
    expect(Object.keys(ten).sort(), 'the memory holds the 10 nodes').toEqual(GRID_IDS);
    const rows = gridRows(ten);
    expect(rows.map((r) => r.length), 'rows of 4, 4 and 2').toEqual([4, 4, 2]);
    expect(rows.flat(), 'the rows read in stable-ID order').toEqual(GRID_IDS);
    expect(spacingProblems(ten, rows), 'at spacing.node').toEqual([]);

    const next = accepted(bin('deep-graph'), { graph: { nodes: [...GRID_NODES, GRID_ELEVENTH], edges: [] }, layout: GRID_LAYOUT, memory: out['memory']! }, 'the grid with g11 added');
    const eleven = memoryOf(next['memory'], 'the grid memory with g11');
    const rows11 = gridRows(eleven);
    expect(rows11.map((r) => r.length), 'rows of 4, 4 and 3').toEqual([4, 4, 3]);
    expect(rows11[2], 'g11 lands at the end of the third row').toEqual(['g09', 'g10', 'g11']);
    expect(spacingProblems(eleven, rows11), 'at spacing.node').toEqual([]);
    const moved = GRID_IDS.filter((id) => !(Object.is(eleven[id]?.x, ten[id]!.x) && Object.is(eleven[id]?.y, ten[id]!.y)))
      .map((id) => `${id} from ${entryText(ten[id])} to ${entryText(eleven[id])}`);
    expect(moved, 'the first 10 stay where they were, x and y bit for bit').toEqual([]);
  });
});
