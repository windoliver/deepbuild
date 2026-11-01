// Test-side tools for the #896 acceptance tests: #854's patch-settled task and its new twin patch-dirty run as the
// perf lane runs them (`node benchmarks/canvas.mjs <mode> [--planted <name>]`, the report its last stdout line), a
// sample's stages, uploaded bytes and marks parsed and checked, and readings made up for the lane's judge. The lane's
// judge, the reference-Mac gate and the design's rule for timing results come from #854's helpers unchanged. Nothing
// here stands in for the patch path, the session, the frame, marks2d.frame or the view.

import { spawnSync } from 'node:child_process';
import { expect, type TestContext } from 'vitest';
import {
  BENCH, ITEMS, PATCHES, REPO, arr, commonRuns, int, num, obj, percentile, referenceFingerprint, str,
  type JsonObject, type JsonValue,
} from '../854/helpers.ts';

export {
  ITEMS, PATCHES, REPO, RUNS, judgeOver, judgeWithin, judged, laneVerdict, mentions, percentile, referenceMacProblem, requireMac, str, targetOf,
  type JsonObject,
} from '../854/helpers.ts';

/** The criteria, by the first 8 hex digits of SHA-256 of their text (scripts/proof-change.mjs `criterionId`). */
export const ID = { settled: '#896.b89e4aff', growth: '#896.18600d21', upload: '#896.6987c701' } as const;
/** The small board of the second criterion: "at 1,000 and at 10,000 items". */
export const SMALL = 1_000;
/** A sample's stages (README: Sample): the patch path, the session taking the revision, the frame, the view's present, the GPU. */
export const STAGES = ['patch', 'session', 'frame', 'present', 'gpu'] as const;
export type Stage = (typeof STAGES)[number];
const CPU_STAGES = STAGES.filter((s) => s !== 'gpu');

export const SETTLED = { id: 'canvas-patch-settled', mode: 'patch-settled', planted: 'reloads_revision', limit: 4 } as const;
export const DIRTY = {
  id: 'canvas-patch-dirty', mode: 'patch-dirty', targets: { cpu_growth: 0.25, upload_bytes_per_item: 64 },
  planted: { growth: 'rebuilds_draw_list', upload: 'repaints_every_mark' },
} as const;
/** What nothing missing may be judged as: never PASS (AGENTS.md, invariant 2). */
export const NOT_PASSED = ['BLOCKED', 'INVALID', 'INCONCLUSIVE'];

/** `node benchmarks/canvas.mjs <mode> [--planted <name>]`: exits 0 and prints its report, for `task`, as the last stdout line. */
export function record(mode: string, task: string, planted?: string): JsonObject {
  const args = [BENCH, mode, ...(planted ? ['--planted', planted] : [])];
  const shown = `node benchmarks/canvas.mjs ${args.slice(1).join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', timeout: 3_600_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 * 1024 });
  expect(r.error, `${shown} ran: ${r.error?.message}`).toBeUndefined();
  expect(r.status, `${shown} exits 0; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  let last: JsonValue = null;
  try { last = JSON.parse((r.stdout ?? '').trim().split('\n').at(-1) ?? '') as JsonValue; } catch { last = null; }
  const report = obj(last ?? undefined, `${shown}: its report (the last stdout line)`);
  expect(report['task'], `${shown}: the report names its budgets.json task`).toBe(task);
  return report;
}

export interface Sample {
  patch: number; frame: number; cpu_ms: number; gpu_ms: number; ms: number; ran: Record<string, number>;
  stages: Record<Stage, number>; uploaded_bytes: number; marks: Record<string, number>;
}
const counts = (v: JsonValue | undefined, what: string): Record<string, number> =>
  Object.fromEntries(Object.entries(obj(v, what)).map(([k, n]) => [k, int(n, `${what}.${k}`)]));

/** One sample; `full` also requires the bytes the view uploaded and the marks each operator built (patch-dirty's). */
export function sampleOf(v: JsonValue, at: string, full: boolean): Sample {
  const s = obj(v, at);
  str(s['item'], `${at}: the one item it changed`);
  const st = obj(s['stages'], `${at}: stages (the time each stage took, so a failure can name one)`);
  expect(Object.keys(st).sort(), `${at}: the stages are ${STAGES.join(', ')}`).toEqual([...STAGES].sort());
  return {
    patch: int(s['patch'], `${at}: patch`), frame: int(s['frame'], `${at}: frame`), cpu_ms: num(s['cpu_ms'], `${at}: cpu_ms`),
    gpu_ms: num(s['gpu_ms'], `${at}: gpu_ms`), ms: num(s['ms'], `${at}: ms`), ran: counts(s['ran'], `${at}: ran`),
    stages: Object.fromEntries(STAGES.map((k) => [k, num(st[k], `${at}: stages.${k}`)])) as Record<Stage, number>,
    uploaded_bytes: full ? int(s['uploaded_bytes'], `${at}: uploaded_bytes`) : NaN,
    marks: full ? counts(s['marks'], `${at}: marks`) : {},
  };
}

/** A board run's 200 samples, each a one-item patch timed to its own settled frame, its stages partitioning its time. */
export function sampleProblems(samples: Sample[], at: string): string[] {
  const out: string[] = [];
  if (samples.length !== PATCHES) out.push(`${at}: ${samples.length} patches, not ${PATCHES}`);
  samples.forEach((s, k) => {
    const p = `${at}: patch ${k + 1}`;
    if (s.patch !== k + 1) out.push(`${p} is numbered ${s.patch}`);
    if (k > 0 && s.frame <= samples[k - 1]!.frame) out.push(`${p} settled in frame ${s.frame}, not after frame ${samples[k - 1]!.frame}`);
    if (!(s.cpu_ms > 0 && s.gpu_ms > 0) || Math.abs(s.ms - s.cpu_ms - s.gpu_ms) > 0.001) out.push(`${p}: ms ${s.ms} isn't CPU ${s.cpu_ms} plus GPU ${s.gpu_ms}, both above 0`);
    if (STAGES.some((k2) => !(s.stages[k2] >= 0))) out.push(`${p}: a stage took less than nothing: ${JSON.stringify(s.stages)}`);
    const cpu = CPU_STAGES.reduce((a, k2) => a + s.stages[k2], 0);
    if (Math.abs(cpu - s.cpu_ms) > 0.01 + 0.001 * s.cpu_ms) out.push(`${p}: its CPU stages sum to ${cpu}, not its cpu_ms ${s.cpu_ms}`);
    if (Math.abs(s.stages.gpu - s.gpu_ms) > 0.001) out.push(`${p}: stages.gpu ${s.stages.gpu} isn't its gpu_ms ${s.gpu_ms}`);
  });
  return out;
}

/** The stage that took the most of a sample's time. */
export const costliest = (s: Sample): Stage => STAGES.reduce((a, b) => (s.stages[b] > s.stages[a] ? b : a));
export const slowest = (samples: Sample[]): Sample => samples.reduce((a, s) => (s.ms > a.ms ? s : a));
export const p50 = (xs: number[]): number => percentile(xs, 0.5);

/** Whether `reason` names, for each run, the costliest stage of its slowest patch as `stage <name>`. */
export const stageNaming = (reason: string, runs: Sample[][]): string[] => runs.flatMap((samples, r) => {
  const c = costliest(slowest(samples));
  return RegExp(`\\bstage\\s+${c}\\b`).test(reason) ? [] : [`run ${r + 1}: the reason doesn't name stage ${c}, which took the most of its slowest patch`];
});

/** patch-settled's five runs on the 10,000-item board. */
export function settledRuns(report: JsonObject, what: string): Sample[][] {
  const runs = commonRuns(report, what);
  expect(report['items'], `${what}: the board holds 10,000 items`).toBe(ITEMS);
  return runs.map((run, r) => arr(run['samples'], `${what}: run ${r + 1}: samples`).map((v, k) => sampleOf(v, `${what}: run ${r + 1}, patch ${k + 1}`, false)));
}

export interface Board { items: number; samples: Sample[] }
/** patch-dirty's five runs, each the same 200 patches on the 1,000-item board, then on the 10,000-item board. */
export function dirtyRuns(report: JsonObject, what: string): [Board, Board][] {
  const runs = commonRuns(report, what);
  return runs.map((run, r) => {
    const boards = arr(run['boards'], `${what}: run ${r + 1}: boards`).map((b, i) => obj(b, `${what}: run ${r + 1}: boards[${i}]`));
    expect(boards.map((b) => b['items']), `${what}: run ${r + 1} patches a 1,000-item board, then a 10,000-item one`).toEqual([SMALL, ITEMS]);
    return boards.map((b) => ({
      items: b['items'] as number,
      samples: arr(b['samples'], `${what}: run ${r + 1}: ${String(b['items'])} items: samples`).map((v, k) => sampleOf(v, `${what}: run ${r + 1}, ${String(b['items'])} items, patch ${k + 1}`, true)),
    })) as [Board, Board];
  });
}
/** "CPU per patch at 1,000 and at 10,000 items differs by": |p50 at 10,000 − p50 at 1,000| over p50 at 1,000, run by run. */
export const growth = ([small, large]: [Board, Board]): number => {
  const a = p50(small.samples.map((s) => s.cpu_ms)), b = p50(large.samples.map((s) => s.cpu_ms));
  return Math.abs(b - a) / a;
};
export const maxBytes = (boards: Board[]): number => Math.max(...boards.flatMap((b) => b.samples.map((s) => s.uploaded_bytes)));

/** A target's verdict that must be `want`; INCONCLUSIVE only because of the run's power or heat skips, saying so. */
export function targetVerdict(ctx: TestContext, verdict: JsonObject, name: string, want: 'PASS' | 'FAIL'): void {
  const t = obj(obj(verdict['targets'], 'verdict.targets')[name], `verdict.targets.${name}`);
  const shown = JSON.stringify(t).slice(0, 2000);
  if (t['status'] === 'INCONCLUSIVE' && /power|Low Power Mode|thermal/.test(String(t['reason']))) ctx.skip(`INCONCLUSIVE (the lane kept ${name} a reading): ${shown}`);
  expect(t['status'], `the lane judges ${name} ${want}: ${shown}`).toBe(want);
}

// ---------------------------------------------------------------------------------------------------
// Readings made up for the judge, on a reference Mac's fingerprint, from a release build.

interface Made { ms: number; costliest?: Stage; bytes?: number | null; marks?: Record<string, number> }
/** A sample of `ms`, a third of it in its costliest stage (frame by default), the rest spread over the others. */
function madeSample(run: number, k: number, m: Made): JsonObject {
  const top = m.costliest ?? 'frame';
  const stages = Object.fromEntries(STAGES.map((s) => [s, s === top ? m.ms / 3 : (m.ms * 2) / 3 / 4])) as Record<Stage, number>;
  const cpu = CPU_STAGES.reduce((a, s) => a + stages[s], 0);
  return {
    patch: k, item: `r${String(k).padStart(5, '0')}`, frame: 1000 * run + 2 * k, cpu_ms: cpu, gpu_ms: stages.gpu, ms: cpu + stages.gpu,
    ran: { 'core.transform': 1, 'marks2d.frame': 1 }, stages,
    ...(m.bytes === null ? {} : { uploaded_bytes: m.bytes ?? 48 }), marks: m.marks ?? { 'marks2d.item': 1, 'marks2d.frame': 1 },
  };
}
const samples = (run: number, make: (k: number) => Made): JsonObject[] => Array.from({ length: PATCHES }, (_, i) => madeSample(run, i + 1, make(i + 1)));
const five = <T>(make: (run: number) => T): T[] => Array.from({ length: 5 }, (_, i) => make(i + 1));

/** A patch-settled reading whose sample `k` of run `run` is `make(run, k)`. */
export function settledReading(make: (run: number, k: number) => Made): JsonObject {
  return { task: SETTLED.id, fingerprint: referenceFingerprint('release'), items: ITEMS, patches: PATCHES,
    runs: five((run) => {
      const s = samples(run, (k) => make(run, k));
      return { p95_ms: percentile(s.map((x) => x['ms'] as number), 0.95), samples: s };
    }) };
}
/** A patch-dirty reading on boards of `sizes` whose sample `k` of a run is `make(run, items, k)`. */
export function dirtyReading(make: (run: number, items: number, k: number) => Made, sizes: number[] = [SMALL, ITEMS]): JsonObject {
  return { task: DIRTY.id, fingerprint: referenceFingerprint('release'), patches: PATCHES,
    runs: five((run) => ({ boards: sizes.map((items) => ({ items, samples: samples(run, (k) => make(run, items, k)) })) })) };
}
