// #1417.c04ec518: The estimate is within 2 times the measured layout time for 100, 1,000 and 10,000 nodes.
//
// The estimate: the cost model's frame CPU for a board holding only the graph, read from the document check's
// `over_budget` (deep-show run's deep_show call; #379's estimate, from the reference Mac's coefficients). The measured
// time: graph's own layered layout of the same graph and layout, through `deep-graph layout` (#394's surface), a
// release build, five runs after warm-up. The timing counts only on a reference Mac under the design's conditions;
// anywhere else the pairs are printed and the test ends INCONCLUSIVE, never PASS (README).
import { afterAll, describe, expect, it } from 'vitest';
import { Lines, TIMEOUT, estimates, graphBoard, layeredGraph, machine, notCounted, obj, useBins, within2x, type Estimate } from './helpers.ts';

const ID = '#1417.c04ec518';
const SIZES = [100, 1_000, 10_000];
const WARMUP = 3;
const RUNS = 5;

const bin = useBins([{ bin: 'deep-graph', profile: 'release' }, { bin: 'deep-show', profile: 'debug' }]);

let cached: Map<number, Estimate> | null = null;
/** Every size's estimate, read once in one deep-show run. */
function estimateOf(n: number): Estimate {
  if (!cached) {
    const got = estimates(bin('deep-show'), SIZES.map(graphBoard));
    cached = new Map(SIZES.map((s, k) => [s, got[k]!]));
    for (const s of SIZES) {
      const e = cached.get(s)!;
      console.log(`${ID} estimate at ${s} nodes: ${e.cpu_ms} ms of frame CPU (over_budget ids ${JSON.stringify(e.issue['ids'])}${e.others.length ? `; other over_budget issues: ${JSON.stringify(e.others).slice(0, 600)}` : ''})`);
    }
  }
  return cached.get(n)!;
}

let graph: Lines | null = null;
afterAll(() => { graph?.close(); graph = null; });

/**
 * Five runs after warm-up of graph's layered layout of the n-node graph, in ms per layout. Each run sends a batch of
 * the same graph with a layout `algo` it refuses, then a batch of the line that lays it out, `batch` lines each so a
 * run outlasts the pipe's jitter; the first batch pays the round trip, the JSON text and reading the graph and stops
 * before the layout, so the difference per line is the layout and its answer.
 */
async function measured(n: number): Promise<number[]> {
  graph ??= new Lines(bin('deep-graph'), ['layout']);
  const { graph: g, layout } = layeredGraph(n);
  const line = JSON.stringify({ graph: g, layout });
  const readOnly = JSON.stringify({ graph: g, layout: { ...layout, algo: 'none_such' } });
  const batch = Math.max(1, Math.ceil(20_000 / n));
  const once = async (): Promise<number> => {
    const read = await graph!.ask(readOnly, batch);
    for (const a of read.answers) expect(a, `the ${n}-node graph with an unknown algo is read and refused before any layout`).toMatchObject({ ok: false, code: 'layout.algo_unsupported' });
    const laid = await graph!.ask(line, batch);
    for (const a of laid.answers) {
      expect(a['ok'], `the ${n}-node graph lays out: ${JSON.stringify(a).slice(0, 600)}`).toBe(true);
      expect(Object.keys(obj(a['memory'], 'its layout memory')).length, `every one of the ${n} nodes is placed`).toBe(n);
    }
    return Math.max(0, (laid.ms - read.ms) / batch);
  };
  for (let i = 0; i < WARMUP; i++) await once();
  const runs: number[] = [];
  for (let i = 0; i < RUNS; i++) runs.push(await once());
  return runs;
}

describe(`${ID} the layout's estimate against its measured time`, () => {
  for (const n of SIZES) {
    it(`${ID} at ${n.toLocaleString('en-US')} nodes the cost model's estimate is within 2 times the measured layout time`, async () => {
      const e = estimateOf(n);
      const runs = await measured(n);
      const { verdict, margin } = within2x(e.cpu_ms, runs);
      const flat = SIZES.every((s) => estimateOf(s).cpu_ms === estimateOf(SIZES[0]!).cpu_ms);
      const pairs = `${n} nodes (${layeredGraph(n).edges} edges): estimate ${e.cpu_ms.toFixed(4)} ms; measured ${runs.map((r) => r.toFixed(4)).join(', ')} ms; ratio measured/estimate ${runs.map((r) => (r / e.cpu_ms).toFixed(2)).join(', ')}; band [${(e.cpu_ms / 2).toFixed(4)}, ${(e.cpu_ms * 2).toFixed(4)}] ms; margin ${(margin * 100).toFixed(0)}%`;
      const why = flat
        ? '; the estimate is the same at every size, so the layout declares no cost derived from its nodes and edges'
        : '';
      console.log(`${ID} on ${machine()}: ${pairs}: ${verdict}${why}`);
      const off = notCounted();
      if (off) expect.fail(`INCONCLUSIVE: ${off}, so this timing is a reading, not a result (it would read ${verdict}${why}): ${pairs}`);
      if (verdict === 'FAIL') expect.fail(`FAIL: every run is outside 2 times the estimate by more than the margin${why}: ${pairs}`);
      if (verdict === 'INCONCLUSIVE') expect.fail(`INCONCLUSIVE: the five runs straddle the 2-times band: ${pairs}`);
    }, TIMEOUT);
  }
});
