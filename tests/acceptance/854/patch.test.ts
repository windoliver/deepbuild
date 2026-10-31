// #854.ad11ae91: Patch to settled frame is timed over 200 one-item patches on a 10,000-item board, CPU plus GPU,
// and fails past 4 ms at p95; a planted scheduler that runs every node on each frame fails, naming the frame and
// the nodes it ran. Holding 4 ms on the reference Mac moved to #896 (#896.b89e4aff), the owner's call on Oct 31;
// its test is the last block below, kept as written and tagged with #896's criterion.
//
// The perf-lane task `canvas-patch-settled` (`node benchmarks/canvas.mjs patch-settled`) shows a 10,000-item board
// in a window, on a release build, and sends 200 patches a run, each changing one item, timing each from the
// patch's arrival to the settled frame it causes, CPU plus GPU, and naming the nodes that frame ran (README: The
// surface under test). Five runs after warm-up; each run's p95 over its 200 patches is judged against 4 ms by the
// design's rule, on a reference Mac only (elsewhere INCONCLUSIVE, a skip that says so). The planted scheduler is
// `--planted runs_every_node`. The wrong programs: the base (no task, no judge); a scheduler that runs every node on
// each frame; a task that times a debug build, or the CPU or the GPU alone; a judge that never fails, or fails
// without naming the frame and its nodes.
import { describe, expect, it } from 'vitest';
import {
  ITEMS, PATCHES, TASKS, arr, commonRuns, int, judgeOver, judgeWithin, judged, laneVerdict, mentions, num, obj, patchRun, percentile, record,
  referenceMacProblem, requireMac, str, synthetic, targetOf, type JsonObject, type PatchSample, type Recorded,
} from './helpers.ts';

const ID = '#854.ad11ae91';
/** #896's first criterion: patch to settled frame holds 4 ms at p95, moved there from #854's first. */
const HOLD = '#896.b89e4aff';
const RELEASE = '#854.926cdce7';
const TASK = TASKS.patch;
const LIMIT = TASK.targets.settled_p95_ms;

interface Run { p95: number; samples: PatchSample[] }

/** A report's five runs, each checked: 200 one-item patches in order, each timed CPU plus GPU to its own settled frame, with the nodes it ran. */
function runsOf(report: JsonObject, what: string): Run[] {
  const runs = commonRuns(report, what);
  expect(report['items'], `${what}: the board holds 10,000 items`).toBe(ITEMS);
  expect(report['patches'], `${what}: 200 patches a run`).toBe(PATCHES);
  return runs.map((run, r) => {
    const samples = arr(run['samples'], `${what}: run ${r + 1}: samples`).map((v, k) => {
      const s = obj(v, `${what}: run ${r + 1}, patch ${k + 1}`);
      const at = `${what}: run ${r + 1}, patch ${k + 1}`;
      const ran = obj(s['ran'], `${at}: ran`);
      const counts: Record<string, number> = {};
      for (const [op, n] of Object.entries(ran)) counts[op] = int(n, `${at}: ran.${op}`);
      return {
        patch: int(s['patch'], `${at}: patch`), item: str(s['item'], `${at}: the one item it changed`), frame: int(s['frame'], `${at}: frame`),
        cpu_ms: num(s['cpu_ms'], `${at}: cpu_ms`), gpu_ms: num(s['gpu_ms'], `${at}: gpu_ms`), ms: num(s['ms'], `${at}: ms`), ran: counts,
      };
    });
    expect(samples.length, `${what}: run ${r + 1} times 200 patches`).toBe(PATCHES);
    return { p95: num(run['p95_ms'], `${what}: run ${r + 1}: p95_ms`), samples };
  });
}
const total = (ran: Record<string, number>): number => Object.values(ran).reduce((a, b) => a + b, 0);

/** The shape every run of the task has, shipped or planted. */
function shapeProblems(runs: Run[], what: string): string[] {
  const out: string[] = [];
  runs.forEach(({ p95, samples }, r) => {
    const at = `${what}: run ${r + 1}`;
    samples.forEach((s, k) => {
      if (s.patch !== k + 1) out.push(`${at}: sample ${k + 1} is patch ${s.patch}`);
      if (k > 0 && s.frame <= samples[k - 1]!.frame) out.push(`${at}: patch ${s.patch} settled in frame ${s.frame}, not after patch ${k}'s frame ${samples[k - 1]!.frame}`);
      if (!(s.cpu_ms > 0) || !(s.gpu_ms > 0)) out.push(`${at}: patch ${s.patch} isn't timed on both the CPU and the GPU (cpu_ms ${s.cpu_ms}, gpu_ms ${s.gpu_ms})`);
      if (Math.abs(s.ms - (s.cpu_ms + s.gpu_ms)) > 0.001) out.push(`${at}: patch ${s.patch}'s ms ${s.ms} isn't its CPU plus its GPU (${s.cpu_ms} + ${s.gpu_ms})`);
      if (total(s.ran) < 1) out.push(`${at}: patch ${s.patch}'s frame names no node it ran`);
    });
    const want = percentile(samples.map((s) => s.ms), 0.95);
    if (Math.abs(p95 - want) > 0.001) out.push(`${at}: p95_ms ${p95} isn't the p95 of its 200 patches (${want})`);
  });
  return out;
}

let shipped: Recorded | undefined;
let planted: Recorded | undefined;
const shippedRuns = (): Run[] => runsOf((shipped ??= record('patch')).report, TASK.id);
const plantedRuns = (): Run[] => runsOf((planted ??= record('patch', true)).report, `${TASK.id} --planted ${TASK.planted}`);

/** Whether `reason` names, for each run, a slowest patch's frame and every node that frame ran with its count. */
function namingProblems(reason: string, runs: Run[]): string[] {
  return runs.flatMap(({ samples }, r) => {
    const worst = Math.max(...samples.map((s) => s.ms));
    const named = samples.filter((s) => s.ms === worst).some((s) => RegExp(`frame\\s*${s.frame}(?!\\d)`).test(reason)
      && Object.entries(s.ran).every(([op, n]) => reason.includes(op) && mentions(reason, n)));
    const s = samples.find((x) => x.ms === worst)!;
    return named ? [] : [`run ${r + 1}: the reason doesn't name its slowest frame ${s.frame} and the nodes it ran (${Object.entries(s.ran).map(([op, n]) => `${op} ×${n}`).join(', ')})`];
  });
}

describe(`${ID} patch to settled frame is timed over 200 one-item patches on a 10,000-item board, CPU plus GPU, and fails past 4 ms at p95; a planted scheduler that runs every node on each frame fails, naming the frame and the nodes it ran`, () => {
  it(`${ID} ${RELEASE} the task times, on a release build, five runs of 200 patches each changing one item of a 10,000-item board, each from its arrival to its settled frame on the CPU plus the GPU, naming the nodes that frame ran, and no frame runs every item's nodes`, (ctx) => {
    requireMac(ctx);
    const runs = shippedRuns();
    expect(shapeProblems(runs, TASK.id), 'every run is 200 one-item patches, each timed CPU plus GPU to its own settled frame').toEqual([]);
    const everyNode = runs.flatMap(({ samples }, r) => samples.filter((s) => total(s.ran) >= ITEMS).map((s) => `run ${r + 1}: patch ${s.patch}'s frame ${s.frame} ran ${total(s.ran)} nodes`));
    expect(everyNode, 'a frame after a one-item patch runs fewer nodes than the board has items').toEqual([]);
    console.log(`${ID} p95 per run: ${runs.map((r) => r.p95.toFixed(3)).join(', ')} ms`);
  }, 3_600_000);

  it(`${ID} a planted scheduler that runs every node on each frame runs every item's nodes after each one-item patch, and on the reference Mac the lane fails it past 4 ms, naming for each run its slowest frame and the nodes that frame ran`, (ctx) => {
    requireMac(ctx);
    const runs = plantedRuns();
    expect(shapeProblems(runs, `--planted ${TASK.planted}`), 'the planted runs are recorded like the shipped ones').toEqual([]);
    const fewer = runs.flatMap(({ samples }, r) => samples.filter((s) => total(s.ran) < ITEMS).map((s) => `run ${r + 1}: patch ${s.patch}'s frame ${s.frame} ran ${total(s.ran)} nodes`));
    expect(fewer, 'the planted scheduler runs a node for every item on every frame').toEqual([]);
    const problem = referenceMacProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    judgeOver(ctx, `--planted ${TASK.planted} p95 ms`, runs.map(({ samples }) => percentile(samples.map((s) => s.ms), 0.95)), LIMIT);
    const verdict = judged(planted!.report);
    laneVerdict(ctx, verdict, 'FAIL');
    expect(targetOf(verdict, 'settled_p95_ms').status, 'the failing target is patch to settled frame').toBe('FAIL');
    expect(namingProblems(str(verdict['reason'], 'verdict.reason'), runs), 'the failure names the frame and the nodes it ran').toEqual([]);
  }, 3_600_000);

  it(`${ID} the lane's judge fails a reading whose p95 is past 4 ms in all five runs, naming each run's slowest frame and the nodes it ran, and passes its twin within 4 ms`, () => {
    const within = judged(synthetic('patch'));
    expect(within['status'], `a reading within 4 ms on a reference Mac passes: ${JSON.stringify(within).slice(0, 1500)}`).toBe('PASS');
    const report = synthetic('patch');
    report['runs'] = Array.from({ length: 5 }, (_, i) => patchRun(i + 1, (k) => (k > 180 ? 9 + i + k / 1000 : 2), (k) => (k > 180 ? { 'core.transform': ITEMS, 'marks2d.frame': 1, 'text.shape': 500 + k } : { 'core.transform': 1 })));
    const verdict = judged(report);
    expect(verdict['status'], `p95 at 9 ms or more in every run fails: ${JSON.stringify(verdict).slice(0, 1500)}`).toBe('FAIL');
    expect(targetOf(verdict, 'settled_p95_ms').status, 'the failing target is patch to settled frame').toBe('FAIL');
    expect(namingProblems(str(verdict['reason'], 'verdict.reason'), runsOf(report, 'the made-up reading')), 'the failure names each run\'s slowest frame and the nodes it ran').toEqual([]);
  }, 600_000);
});

describe(`${HOLD} patch to settled frame holds 4 ms at p95 over 200 one-item patches on a 10,000-item board, CPU plus GPU, on the reference Mac (moved from #854 to #896)`, () => {
  it(`${HOLD} on the reference Mac each run's p95 over its 200 patches, CPU plus GPU, is within 4 ms (five runs after warm-up), and the lane's judge passes the task on those same five`, (ctx) => {
    const problem = referenceMacProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const runs = shippedRuns();
    const p95s = runs.map(({ samples }) => percentile(samples.map((s) => s.ms), 0.95));
    judgeWithin(ctx, `${TASK.id} p95 ms`, p95s, LIMIT);
    const verdict = judged(shipped!.report);
    const target = targetOf(verdict, 'settled_p95_ms');
    expect(target.limit, 'the judge holds the task to 4 ms').toBe(LIMIT);
    target.runs.forEach((v, i) => expect(v, `the judge judges run ${i + 1}'s p95`).toBeCloseTo(p95s[i]!, 3));
    laneVerdict(ctx, verdict, 'PASS');
  }, 3_600_000);
});
