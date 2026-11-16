// AC6 #142.3a4bcf6d: "Budgets, on the reference Mac in the local preflight, compared with the merge base: expanding the
// largest example takes under 20 ms at check, and each example plays within the canvas frame budget"
//
// Everywhere: every example, on each of its stages, reports its recipe's own expansion time at check,
// `timing.expand_ms.<instance>` on `deep show` with `include: ["timing"]` (README: The expansion), as a number.
// Then the perf lane's judgeLimit (scripts/benchmark.mjs) first says whether this machine can judge a timing now (a
// reference Mac on mains power, Low Power Mode off, thermal state nominal, the load under the core count); if not, the
// test is INCONCLUSIVE before anything is built in release, never a pass. If so:
//   - Expanding the largest example (the example whose document is largest as compact JSON), on each of its stages: a
//     release build, one warm-up process, then five fresh processes each reading `timing.expand_ms.<instance>` once;
//     judgeLimit over the five against 20 ms must not FAIL, and anything but PASS is INCONCLUSIVE.
//   - Each example plays within the canvas frame budget: #1899's frame-budget run, `deep-gpu run`'s `frame_budget`
//     (warm-up and five timed runs over the example's span at its size and rate, judged against its budget class), on
//     each stage of each example, given the store's packs (`packs`, README: The frame budget) and the shipped look its
//     recipe names; each must be PASS, a FAIL fails, BLOCKED or INCONCLUSIVE is never a pass.
// "Compared with the merge base": the merge base has no film recipe to expand or play, so there is no base reading;
// the limits are the issue's 20 ms and the class's frame limits (README: Readings).
// Wrong programs: the base (no explain pack, no expand_ms for a recipe); an expansion run per frame; a recipe whose
// expansion or frames cost more than the budgets.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, EXPLAIN, FLICKS, OFFERED, RECIPES, STAGED_3D, TIMEOUT, blocked, brief, buildGpu, buildShow, bytesOf, docId, errors, exampleOf, frameOf,
  inconclusive, isObject, judgeLimit, load, lookOf, none, num, obj, onStage, present, run, runGpu, scenario, spanOf, useFolders, useShow,
  type Example, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const LIMIT_MS = 20;
const RUNS = 5;

const stagesOf = (ex: Example): ('2d' | '3d')[] => ((STAGED_3D as readonly string[]).includes(ex.recipe) ? ['2d', '3d'] : ['2d']);
/** One process presenting the example on a stage: its recipe's own expansion time at check. */
function expandMs(bin: string, ex: Example, stage: '2d' | '3d'): number {
  const [shown] = run(bin, scenario(folder(), [present(docId(1), onStage(ex.doc, stage), ['issues', 'timing'])]));
  expect(shown!['outcome'] === 'presented' && errors(shown!).length === 0, `${ex.recipe} on the ${stage} stage is presented with no error: ${brief(shown!, 1200)}`).toBe(true);
  const timing = obj(shown!['timing'], `${ex.recipe} ${stage}: the reply's timing`);
  return num(obj(timing['expand_ms'], `${ex.recipe} ${stage}: timing.expand_ms`)[ex.instance], `${ex.recipe} ${stage}: timing.expand_ms.${ex.instance}`);
}

describe(`${AC[6]} the largest example expands in under ${LIMIT_MS} ms at check and each example plays within the frame budget`, () => {
  it(`${AC[6]} on the reference Mac: the largest example expands in under ${LIMIT_MS} ms, and every example's frame-budget run passes`, async () => {
    const examples: Example[] = [];
    const missing: string[] = [];
    for (const r of RECIPES) { const ex = exampleOf(r); if (Array.isArray(ex)) missing.push(...ex); else examples.push(ex); }
    none(missing, 'every recipe ships its example');
    for (const ex of examples) for (const s of stagesOf(ex)) expect(expandMs(show(), ex, s), `${ex.recipe} ${s}: expand_ms is a time`).toBeGreaterThanOrEqual(0);

    const now = Array.from({ length: RUNS }, () => ({ start: load(), end: load() }));
    const here = await judgeLimit(LIMIT_MS, Array.from({ length: RUNS }, () => 0), now);
    if (here['status'] !== 'PASS') inconclusive(`this machine can't judge a budget now: ${String(here['reason'])}`);

    const open: string[] = [];
    const largest = examples.reduce((a, b) => (bytesOf(b.doc) > bytesOf(a.doc) ? b : a));
    const release = buildShow(true, folder());
    expect(release.error, 'deep-show builds in release').toBe('');
    for (const stage of stagesOf(largest)) {
      expandMs(release.bin, largest, stage);
      const runs: number[] = []; const loads: { start: number; end: number }[] = [];
      for (let k = 0; k < RUNS; k++) { const start = load(); runs.push(expandMs(release.bin, largest, stage)); loads.push({ start, end: load() }); }
      const verdict = await judgeLimit(LIMIT_MS, runs, loads);
      console.log(`#142 ${largest.recipe} ${stage}, expand_ms per run: ${runs.map((r) => r.toFixed(3)).join(', ')} → ${String(verdict['status'])}`);
      expect(verdict['status'], `expanding ${largest.recipe} on the ${stage} stage against ${LIMIT_MS} ms: ${JSON.stringify(verdict)}`).not.toBe('FAIL');
      if (verdict['status'] !== 'PASS') open.push(`expanding ${largest.recipe} (${stage}): ${JSON.stringify(verdict)}`);
    }

    const gpu = buildGpu(folder());
    expect(gpu.error, 'deep-gpu builds').toBe('');
    const dir = folder();
    for (const ex of examples) {
      for (const stage of stagesOf(ex)) {
        const doc = onStage(ex.doc, stage);
        const file = join(dir, `${ex.recipe}-${stage}.json`);
        writeFileSync(file, JSON.stringify(doc));
        const size = Array.isArray(doc['size']) ? doc['size'] : [1920, 1080];
        const call: JsonObject = {
          call: 'frame_budget', look: lookOf(ex), writer: 'agent:alpha', doc: file, packs: OFFERED.map((p) => ({ id: p.id, dir: p.dir })),
          render: { seconds: spanOf(doc, ex.recipe) / FLICKS, pixels: size }, fps: Math.round(FLICKS / frameOf(doc)),
        };
        const [reply] = runGpu(gpu.bin, [call], `${ex.recipe} ${stage}: the frame budget`);
        const verdict = reply!['verdict'];
        const what = `${ex.recipe} on the ${stage} stage (${EXPLAIN.id}): the frame budget`;
        if (verdict === 'FAIL') expect.fail(`${what} FAILs: ${brief(reply!['limits'] ?? reply!, 2000)}`);
        if (verdict === 'BLOCKED') blocked(`${what} is BLOCKED: ${brief(reply!, 2000)}`);
        if (verdict !== 'PASS') open.push(`${what} reads ${String(verdict)}: ${brief(isObject(reply!['limits']) ? reply!['limits'] : reply!, 600)}`);
      }
    }
    if (open.length) inconclusive(open.join('; '));
  }, 8 * TIMEOUT);
});
