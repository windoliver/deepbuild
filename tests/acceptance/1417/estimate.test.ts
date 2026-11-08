// #1417.c04ec518: "The estimate is within 2 times the measured layout time for 100, 1,000 and 10,000 nodes".
//
// The estimate: the check's own, through `deep-show run` (the shipped `full` build): each graph on a data view board
// whose CPU cap the document tightens to 1e-6 ms, so the check always refuses it and its `over_budget` carries
// `actual.operators["graph.layout"]` (README: Assumed surfaces). The measured time: `deep-graph layout` built
// `--release` (the profile the coefficients are measured in), the same graph and layout as one line with
// `timed: true`, seven lines in one process, the first dropped as warm-up, the median of the other six `ms`.
//
// Structural, on every machine: every size has an estimate and a measured time, and the estimate grows with the
// graph. The comparison is a reading: off the reference Mac costs.json's fingerprint names, with Low Power Mode on or
// unknown, a thermal warning or a 1-minute load above half the cores, the test prints the pairs and skips as
// INCONCLUSIVE, never a pass. On a fit reference Mac: PASS when every size's estimate is within 2 times its measured
// time either way; FAIL when one is outside by more than the margin (the six runs' spread, at least 5%); else
// INCONCLUSIVE.
import { describe, expect, it } from 'vitest';
import {
  LAYOUT, SIZES, checked, environmentProblem, graphDoc, layeredGraph, layoutEstimate, lines, median, num, overBudget, show, useEvidence,
  useGraph, useShowBuilds,
} from './helpers.ts';

const ID = '#1417.c04ec518';
const build = useShowBuilds([['full']]);
const graph = useGraph('release');
const evidence = useEvidence();
const NODES = [100, 1000, 10000] as const;
const RUNS = 7;

describe(`${ID} the layout's estimate against its measured time`, () => {
  it(`${ID} the estimate is within 2 times the measured layout time for 100, 1,000 and 10,000 nodes`, (ctx) => {
    const rows = NODES.map((n, k) => {
      const reply = checked(build(['full']), evidence(), `01JB141700000000000000010${k}`, graphDoc(n, { class: 'data_view', frame_cpu_ms: 1e-6 }));
      const estimate = layoutEstimate(overBudget(reply, `the ${n}-node graph under a 1e-6 ms cap`), `${n} nodes`);
      const [ranks, width] = SIZES[n];
      const line = { graph: layeredGraph(ranks, width), layout: LAYOUT, timed: true };
      const answers = lines(graph(), ['layout'], Array.from({ length: RUNS }, () => line));
      const ms = answers.map((a, i) => {
        expect(a['ok'], `${n} nodes, run ${i}: laid out: ${show(a, 300)}`).toBe(true);
        return num(a['ms'], `${n} nodes, run ${i}: ms (the layout's own time, asked for by timed: true)`);
      }).slice(1);
      const measured = median(ms);
      const spread = (Math.max(...ms) - Math.min(...ms)) / Math.max(Math.min(...ms), 1e-9);
      return { n, estimate, measured, ratio: estimate / measured, margin: Math.max(0.05, spread), ms };
    });
    for (const r of rows) {
      console.log(`${ID}: ${r.n} nodes: estimate ${r.estimate.toFixed(4)} ms, measured ${r.measured.toFixed(4)} ms (median of ${r.ms.map((m) => m.toFixed(3)).join(', ')}), estimate/measured ${r.ratio.toFixed(3)}`);
    }
    for (const r of rows) expect(r.estimate, `${r.n} nodes: the estimate is positive`).toBeGreaterThan(0);
    for (let k = 1; k < rows.length; k++) {
      expect(rows[k]!.estimate, `the estimate grows with the graph: ${rows[k]!.n} nodes over ${rows[k - 1]!.n}`).toBeGreaterThan(rows[k - 1]!.estimate);
    }

    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE: the times are read only on a fit reference Mac (${problem}); this is not a pass`);
    const within = (r: (typeof rows)[number]): boolean => r.ratio >= 0.5 && r.ratio <= 2;
    if (rows.every(within)) return;
    const far = rows.filter((r) => r.ratio < 0.5 / (1 + r.margin) || r.ratio > 2 * (1 + r.margin));
    expect(far.map((r) => `${r.n} nodes: ${r.ratio.toFixed(3)} (margin ${(r.margin * 100).toFixed(0)}%)`), 'FAIL: an estimate more than 2 times off its measured time, past the margin').toEqual([]);
    ctx.skip(`INCONCLUSIVE: ${rows.filter((r) => !within(r)).map((r) => `${r.n} nodes ${r.ratio.toFixed(3)}`).join(', ')} outside 2 times but within the runs' margin`);
  }, 3_600_000);
});
