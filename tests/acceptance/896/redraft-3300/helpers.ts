// #3300's blind redraft of #896's made-up readings (README). Everything of the first draft's helpers is used as
// written (`export *` below): the lane's runner, the sample checks, and the judge, gate and rule it takes from #854's
// helpers. Only its made-up readings are redrafted: `settledReading` and `dirtyReading` here are the first draft's,
// line for line, save that every made-up run carries the one-minute load at its start and end, `loadStart` and
// `loadEnd` as `node benchmarks/canvas.mjs judge` reads them (benchmarks/canvas-judge.mjs `loadsOf`).
import { ITEMS, PATCHES, percentile, referenceFingerprint, type JsonObject } from '../../854/helpers.ts';
import { DIRTY, SETTLED, SMALL, STAGES, type Stage } from '../helpers.ts';

export * from '../helpers.ts';

/**
 * A made-up run's one-minute load at its start and at its end: at rest. judgeLimit reads a run as loaded when a load is
 * above the core count of the machine that judges, and no machine has under one core, so a made-up reading's verdict
 * is the same on every Mac.
 */
export const LOAD_AT_REST = 1;

const CPU_STAGES = STAGES.filter((s) => s !== 'gpu');

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

/** A patch-settled reading whose sample `k` of run `run` is `make(run, k)`; every run at rest. */
export function settledReading(make: (run: number, k: number) => Made): JsonObject {
  return { task: SETTLED.id, fingerprint: referenceFingerprint('release'), items: ITEMS, patches: PATCHES,
    runs: five((run) => {
      const s = samples(run, (k) => make(run, k));
      return { p95_ms: percentile(s.map((x) => x['ms'] as number), 0.95), samples: s, loadStart: LOAD_AT_REST, loadEnd: LOAD_AT_REST };
    }) };
}
/** A patch-dirty reading on boards of `sizes` whose sample `k` of a run is `make(run, items, k)`; every run at rest. */
export function dirtyReading(make: (run: number, items: number, k: number) => Made, sizes: number[] = [SMALL, ITEMS]): JsonObject {
  return { task: DIRTY.id, fingerprint: referenceFingerprint('release'), patches: PATCHES,
    runs: five((run) => ({ boards: sizes.map((items) => ({ items, samples: samples(run, (k) => make(run, items, k)) })), loadStart: LOAD_AT_REST, loadEnd: LOAD_AT_REST })) };
}
