// #399.4bd0e343: Budgets, on the reference Mac in the local preflight, compared with the merge base: a 10,000-node
// graph lays out incrementally in under 50 ms per change; series draw at most 4 vertices per pixel column (first, min,
// max and last); each view stays under 100 MB.
//
// The vertex count is structural and runs everywhere (`geometry`'s `series.rows`). The timings and the memory are
// readings: off a reference Mac, with Low Power Mode on or unknown, a thermal warning or a 1-minute load above half the
// cores, the test skips as INCONCLUSIVE after its structural check, never a pass; on a fit reference Mac the design's
// judge applies (PASS when every run is within the limit, FAIL when every run is over it by more than the margin, else
// INCONCLUSIVE). The merge base's `deep-graph` takes the same change and its answer and time are printed beside ours;
// the limits are absolute, so they are what is judged (README: Budgets).
import { describe, expect, it } from 'vitest';
import {
  SERIES_COLUMNS, accepted, cleanLook, columnOf, environmentProblem, judge, lines, mergeBase, mergeBaseBin, num, seriesData, seriesDoc, seriesRows,
  show, spawn, useBins, useTemp, withPeakMemory, type JsonObject,
} from './helpers.ts';
import { join } from 'node:path';

const ID = '#399.4bd0e343';
const bin = useBins(['deep-graph', 'deep-canvas-render']);
const temp = useTemp('budgets');
const RANKS = 40;
const PER_RANK = 250;
const MB = 2 ** 20;
const LAYOUT = { algo: 'layered', direction: 'down', seed: 399 };

/** 10,000 nodes in 40 ranks of 250, each fed from the node above it (and odd ones also from its left neighbour's). */
function bigGraph(): { nodes: JsonObject[]; edges: JsonObject[] } {
  const nodes: JsonObject[] = []; const edges: JsonObject[] = [];
  for (let r = 0; r < RANKS; r++) for (let j = 0; j < PER_RANK; j++) {
    nodes.push({ id: `v${r}x${j}`, kind: 'step', w: 40 + 8 * ((r + j) % 5), h: 30 });
    if (r > 0) {
      edges.push({ id: `e${r}x${j}`, a: `v${r - 1}x${j}`, b: `v${r}x${j}`, kind: 'flow' });
      if (j % 2 === 1) edges.push({ id: `f${r}x${j}`, a: `v${r - 1}x${j - 1}`, b: `v${r}x${j}`, kind: 'flow' });
    }
  }
  return { nodes, edges };
}
/** Ten changes, each one node added to rank 21 with one edge from rank 20, against the same memory. */
function changes(g: { nodes: JsonObject[]; edges: JsonObject[] }, memory: JsonObject): JsonObject[] {
  return Array.from({ length: 10 }, (_, k) => ({
    graph: { nodes: [...g.nodes, { id: `added${k}`, kind: 'step', w: 48, h: 30 }], edges: [...g.edges, { id: `added-edge${k}`, a: `v19x${25 * k + 3}`, b: `added${k}`, kind: 'flow' }] },
    layout: LAYOUT, memory,
  }));
}

describe(`${ID} the graph and series budgets`, () => {
  it(`${ID} series draw at most 4 vertices per pixel column; on the reference Mac a 10,000-node graph lays out incrementally in under 50 ms per change and each view stays under 100 MB`, (ctx) => {
    // Structural, on every machine: the vertices the series draws, by pixel column.
    const { t } = seriesData();
    const render = bin('deep-canvas-render');
    const rows = seriesRows(accepted(render, ['geometry'], { doc: seriesDoc('m4'), look: cleanLook(render), item: 's' }, 'geometry of the million-row series'));
    const perColumn = new Array<number>(SERIES_COLUMNS).fill(0);
    for (const r of rows) perColumn[columnOf(t[r]!, t[0]!, t.at(-1)!, SERIES_COLUMNS)]!++;
    expect(Math.max(...perColumn), 'the series draws at most 4 vertices in any pixel column').toBeLessThanOrEqual(4);
    expect(perColumn.filter((n) => n === 0).length, 'and at least one in each').toBe(0);

    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE: the timings and memory are read only on a fit reference Mac (${problem}); this is not a pass`);

    const graph = bin('deep-graph');
    const g = bigGraph();
    const full = accepted(graph, ['layout'], { graph: g, layout: LAYOUT }, 'the full layout of 10,000 nodes');
    const lines10 = changes(g, full['memory'] as JsonObject);

    // The merge base, beside ours: its answer and wall time for the first change.
    const sha = mergeBase();
    const base = mergeBaseBin(sha, 'deep-graph');
    if (base.error) console.log(`${ID}: the merge base ${sha.slice(0, 12)} did not build deep-graph: ${base.error.slice(0, 600)}`);
    else {
      const r = spawn(base.path, ['layout'], `${JSON.stringify(lines10[0])}\n`);
      console.log(`${ID}: merge base ${sha.slice(0, 12)} deep-graph layout on one change: ${r.ms.toFixed(1)} ms wall, answer ${r.stdout.slice(0, 160)}`);
    }

    // Five runs of ten changes; each run's reading is its slowest change, by the layout's own `ms`.
    const runs: number[] = [];
    for (let k = 0; k < 5; k++) {
      const answers = lines(graph, ['layout'], lines10);
      answers.forEach((a, i) => expect(a['ok'], `change ${i} is laid out incrementally: ${show(a, 400)}`).toBe(true));
      runs.push(Math.max(...answers.map((a, i) => num(a['ms'], `change ${i}: ms`))));
    }
    const one = `${JSON.stringify(lines10[0])}\n`;
    const graphMb = [0, 1, 2].map(() => withPeakMemory(graph, ['layout'], one).bytes / MB);
    const seriesLine = `${JSON.stringify({ out: join(temp(), 'series.png'), doc: seriesDoc('m4'), look: cleanLook(render), t: 0 })}\n`;
    const seriesMb = [0, 1, 2].map(() => withPeakMemory(render, ['raster'], seriesLine).bytes / MB);
    console.log(`${ID}: peak memory, the 10,000-node graph view ${graphMb.map((m) => m.toFixed(1)).join(', ')} MB; the million-row series view ${seriesMb.map((m) => m.toFixed(1)).join(', ')} MB`);

    judge(ctx, 'a 10,000-node graph laid out incrementally, ms per change (slowest of ten, per run)', runs, 50);
    judge(ctx, 'the 10,000-node graph view, peak MB', graphMb, 100);
    judge(ctx, 'the million-row series view, peak MB', seriesMb, 100);
  });
});
