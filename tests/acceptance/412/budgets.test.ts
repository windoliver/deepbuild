// AC10: "Budgets, on the reference Mac in the local preflight, compared with the merge base: deep_kinds answers in
// under 100 ms at p95, deep_query of 200 rows in under 50 ms, deep_show's readings add under 20 ms to a render-back,
// and no reply passes 64 KB without a cursor"
//
// asserts: structure first, on any machine: in `core`, every deep_kinds reply (each page of the listing, a search,
// a word, the sheet) is under 64 KB or carries a cursor; deep_query asked for all rows of a 5,000-item board, and
// deep_show's bounds readings on that board, are each under 64 KB or carry a cursor. Then, on a fit reference Mac
// (Mac15,7 or Mac15,12, Low Power Mode off, thermal state nominal, a 1-minute load at most the core count; mains
// power never gates), five runs after a warm-up, each a `deep-show run` kept open and fed one scenario per line, each
// time the wall time of a scenario less the median of its twin without the call under test: deep_kinds' p95 over 20
// calls under 100 ms; deep_query's p95 over 20 reads of a 200-item board's 200 rows under 50 ms (the merge base's
// reading printed beside it); a deep_show of a 200-item board rendered back as a snapshot with the bounds mode's
// readings, its p95 over 20 under the merge base's plain render-back of that board (median of its five p95s) plus
// 20 ms. Elsewhere, or between the limit and the margin, the timings
// skip as INCONCLUSIVE after their structural checks; none passes by skipping.

import { describe, expect, it } from 'vitest';
import {
  ALPHA, CORE, DOC, WORDS, Streamed, answer, arr, baseBuild, board, capFailures, environmentProblem, judgeRuns, kinds, listAll, median, none,
  p95, query, rect, run, scenario, settle, showDoc, useBuilds, useEvidence, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([CORE]);
const evidence = useEvidence();
const ROUNDS = 20;
const RUNS = 5;

const boxes = (n: number): JsonObject => board(`${n} boxes`, Array.from({ length: n }, (_, i) => rect(`b${String(i).padStart(5, '0')}`, [(i % 100) * 6, Math.floor(i / 100) * 6, 5, 5], `a${String(i).padStart(5, '0')}`)));
const BIG = boxes(5_000);
const SMALL = boxes(200);
/** deep_show of `document` rendered back as a snapshot (#393), with or without the bounds mode's readings (#411). */
const renderBack = (document: JsonObject, readings: boolean): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc: DOC.a, document, size: [320, 180], include: ['issues', 'pixels'], ...(readings ? { mode: 'bounds' } : {}) });
const KINDS_CALLS: JsonObject[] = [kinds('list'), kinds('search', { query: 'turntable' }), kinds('word', { word: 'Circle' }), kinds('sheet')];

/**
 * In one process kept open: `ROUNDS` timings of `calls` after `before`, each less the median of `ROUNDS` timings of
 * `before` alone; their p95 in ms.
 */
async function added(bin: string, before: JsonObject[], calls: (k: number) => JsonObject[], world: Parameters<typeof scenario>[2] = {}): Promise<number> {
  const s = Streamed.open(bin);
  try {
    const ev = evidence();
    await s.send(scenario(ev, [...before, ...calls(0)], world));
    const bare: number[] = [];
    const timed: number[] = [];
    for (let k = 0; k < ROUNDS; k++) {
      bare.push((await s.send(scenario(ev, before, world))).ms);
      timed.push((await s.send(scenario(ev, [...before, ...calls(k)], world))).ms);
    }
    const floor = median(bare);
    return p95(timed.map((t) => Math.max(0, t - floor)));
  } finally {
    s.close();
  }
}

describe('AC10 budgets on the reference Mac against the merge base, and no reply past 64 KB without a cursor', () => {
  it('AC10 deep_kinds answers in under 100 ms at p95, and none of its replies passes 64 KB without a cursor', async (ctx) => {
    const bin = builds.bin(CORE);
    const l = listAll(bin, evidence(), { packs: [WORDS] });
    none(l.pages.flatMap((p, i) => capFailures(`deep_kinds list page ${i + 1}`, p)), 'the listing\'s pages');
    const replies = run(bin, scenario(evidence(), KINDS_CALLS, { packs: [WORDS] }));
    replies.forEach((r, i) => answer(r, `deep_kinds ${String(KINDS_CALLS[i]!['op'])}`));
    none(replies.flatMap((r, i) => capFailures(`deep_kinds ${String(KINDS_CALLS[i]!['op'])}`, r)), 'deep_kinds\' replies');
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const runs: number[] = [];
    for (let r = 0; r < RUNS; r++) runs.push(await added(bin, [], (k) => [KINDS_CALLS[k % KINDS_CALLS.length]!], { packs: [WORDS] }));
    settle(ctx, [judgeRuns('AC10 deep_kinds p95 over 20 calls (ms)', runs, 100)]);
  }, 1_800_000);

  it('AC10 deep_query of 200 rows answers in under 50 ms, compared with the merge base, and asked for all 5,000 rows it stays under 64 KB or carries a cursor', async (ctx) => {
    const bin = builds.bin(CORE);
    const [shown, all, two] = run(bin, scenario(evidence(), [showDoc(DOC.a, BIG), query(DOC.a, { cap: 5_000 }), query(DOC.a, { cap: 200 })]));
    expect(shown!['outcome'], 'the 5,000-item board is presented').toBe('presented');
    none(capFailures('deep_query of all 5,000 rows', all!), 'deep_query\'s reply');
    expect(arr(two!['rows'], 'deep_query cap 200: rows').length, 'a read of 200 rows').toBe(200);
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const base = baseBuild('core');
    const reading = async (b: string): Promise<number[]> => {
      const out: number[] = [];
      for (let r = 0; r < RUNS; r++) out.push(await added(b, [showDoc(DOC.a, SMALL)], () => [query(DOC.a, { cap: 200 })]));
      return out;
    };
    const baseRuns = await reading(base.bin);
    console.log(`reading: the merge base ${base.sha.slice(0, 12)}'s deep_query of 200 rows, p95 per run (ms): ${baseRuns.map((x) => x.toFixed(3)).join(', ')}`);
    settle(ctx, [judgeRuns('AC10 deep_query of 200 rows, p95 over 20 reads (ms)', await reading(bin), 50)]);
  }, 7_200_000);

  it('AC10 deep_show\'s readings add under 20 ms to a render-back, compared with the merge base, and on 5,000 items they stay under 64 KB or carry a cursor', async (ctx) => {
    const bin = builds.bin(CORE);
    const [back] = run(bin, scenario(evidence(), [renderBack(BIG, true)]));
    expect(back!['outcome'], 'the 5,000-item board is presented and rendered back').toBe('presented');
    expect(Array.isArray(back!['drawn']), 'the render-back carries the bounds readings').toBe(true);
    none(capFailures('a render-back with the bounds readings of 5,000 items', back!), 'the render-back\'s reply');
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const base = baseBuild('core');
    const plain: number[] = [];
    for (let r = 0; r < RUNS; r++) plain.push(await added(base.bin, [], () => [renderBack(SMALL, false)]));
    const withReadings: number[] = [];
    for (let r = 0; r < RUNS; r++) withReadings.push(await added(bin, [], () => [renderBack(SMALL, true)]));
    const floor = median(plain);
    settle(ctx, [judgeRuns(`AC10 render-back with readings, p95 over 20 (ms), against the merge base ${base.sha.slice(0, 12)}'s plain render-back ${floor.toFixed(3)} + 20`, withReadings, floor + 20)]);
  }, 7_200_000);
});
