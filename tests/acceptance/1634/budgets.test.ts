// AC8 #1634.5a35384c: Budget, on the reference Mac in the local preflight against the merge base: a night city of
// 1,024 fill point and 1,024 fill spot lamps (ranges 6 to 12 m) at 1080p stays within the showpiece class's 10 ms of
// GPU a frame and gives the same pixel hash by seeking and by playing at 10 sampled times; the cluster pass takes at
// most 0.5 ms of GPU, the CPU scoring at most 1 ms a change, and the light lists at most 4 MB. The cost model's
// estimate lands within 25% of each measurement.
//
// The night city (helpers: `cityDoc`): 2,048 lamp posts on a lattice 12 m apart, a point lamp or a spot lamp on each
// by turns, their ranges 6 to 12 m, over a ground slab and 128 blocks; a showpiece whose camera orbits it once in
// 10 s, drawn at 1920 × 1080 and 30 frames a second.
//
// 1. What holds on any Mac (the hash and the size are functional): the orbit played from frame 0 to 285 and each of
//    the 10 sampled times (0.5 s, 1.5 s … 9.5 s: frames 15, 45 … 285) sought cold in its own session give the same
//    pixel hash at each time, and the 10 hashes aren't one (the orbit moves). At each sampled frame, played with
//    `timings: true`, the frame reports its light lists' bytes (`lights.lists_bytes`, README: Assumed surfaces 7), at
//    most 4,000,000 (the budget table's megabyte is 10^6 bytes), with the cost model's estimate of them
//    (`estimate.lists_bytes`) within 25%; and it reports the readings the timing test judges: `gpu_ms`, the cluster
//    pass's time in `passes_ms` and its estimate in `declared_ms` under `scene3d.light_clusters`, `lights.scoring_ms`,
//    `estimate.gpu_ms` and `estimate.scoring_ms`, each above 0. And the perf lane carries the budget beside the merge
//    base: benchmarks/budgets.json holds a task for #1634.5a35384c with a command, passing the lane's own validator
//    against the merge base's file, and scripts/lanes.mjs lists this file in `timed`, the local preflight's perf step.
// 2. The timings, by the design's rule (Every task carries its own budgets; Frame budget): a release build; one
//    untimed warm-up run, then five, each a fresh process playing the orbit's 300 frames with `timings: true` and
//    nothing captured. Each run gives: the p95 over its frames of `gpu_ms` (at most 10), of the cluster pass's time
//    (at most 0.5) and of `lights.scoring_ms` (at most 1; the camera moves every frame, so every frame is a change);
//    and, for each of the three, |median estimate − median measurement| ÷ median measurement (at most 0.25). Each of
//    the six is judged by the perf lane's own `judgeLimit` (scripts/benchmark.mjs, in a child process) with each run's
//    one-minute load at its start and end: PASS only on a reference Mac, Low Power Mode off, thermal state nominal
//    and unloaded, with all five within the limit; FAIL when all five are over by more than the margin; anything
//    else INCONCLUSIVE, which fails here and never passes. The machine is asked first, so one that can't judge says
//    so before it builds or draws anything, and nothing waits for it to quieten.
// Wrong programs: the base (no fill lights, none of these readings, no task); lists carried from frame to frame, so a
// seek differs from a play; a cluster pass, a scoring or lists over their limits; an estimate that doesn't follow the
// lamps; a budget no lane compares with the merge base.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CITY, REPO, TIMEOUT, buildGpu, cityDoc, frameAt, framesOf, inconclusive, isObject, judgeLimit, lane, load, look, median, none, p95, requireMetal, runGpu,
  shown, timedFiles, timingProblem, useDir, useGpu, view3dCall, writeJson, type Frame, type JsonObject, type JsonValue, type Load,
} from './helpers.ts';

const ID = AC[8];
const CRITERION = ID.split(' ')[1]!;
const bin = useGpu();
const dir = useDir();
const LOOK = look('filmic', 2);
const PASS = 'scene3d.light_clusters';
const LIMITS = { frameGpuMs: 10, clusterPassMs: 0.5, scoringMs: 1, listsBytes: 4_000_000, estimateOff: 0.25 } as const;
const FILE = 'tests/acceptance/1634/budgets.test.ts';

/** A number a timed frame reports at `path`, or null when it isn't there. */
function reading(f: Frame, path: string[]): number | null {
  let v: JsonValue | undefined = f.raw;
  for (const key of path) v = isObject(v) ? v[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
const READINGS: Record<string, string[]> = {
  gpu_ms: ['gpu_ms'], [`passes_ms.${PASS}`]: ['passes_ms', PASS], [`declared_ms.${PASS}`]: ['declared_ms', PASS], 'lights.scoring_ms': ['lights', 'scoring_ms'],
  'lights.lists_bytes': ['lights', 'lists_bytes'], 'estimate.gpu_ms': ['estimate', 'gpu_ms'], 'estimate.scoring_ms': ['estimate', 'scoring_ms'], 'estimate.lists_bytes': ['estimate', 'lists_bytes'],
};

/** One timing run: the orbit's 300 frames in a fresh process; each limit's reading. */
function timedRun(release: string, out: string): Record<'gpu' | 'pass' | 'scoring' | 'gpuOff' | 'passOff' | 'scoringOff', number> {
  const [reply] = runGpu(release, out, [view3dCall({ doc: writeJson(out, 'city', cityDoc()), look: LOOK, size: CITY.size, fps: CITY.fps, frames: CITY.frames, capture: [], targets: [], timings: true })]);
  const frames = framesOf(out, reply!, CITY.size, 'the night city, timed');
  expect(frames.length, 'every frame of the orbit is reported').toBe(CITY.frames);
  const column = (name: string): number[] => frames.map((f) => { const v = reading(f, READINGS[name]!); expect(v, `frame ${f.frame} reports ${name}`).not.toBeNull(); return v!; });
  const off = (estimate: string, measured: string): number => Math.abs(median(column(estimate)) - median(column(measured))) / median(column(measured));
  return {
    gpu: p95(column('gpu_ms')), pass: p95(column(`passes_ms.${PASS}`)), scoring: p95(column('lights.scoring_ms')),
    gpuOff: off('estimate.gpu_ms', 'gpu_ms'), passOff: off(`declared_ms.${PASS}`, `passes_ms.${PASS}`), scoringOff: off('estimate.scoring_ms', 'lights.scoring_ms'),
  };
}

describe(`${ID} the night city's budgets on the reference Mac, beside the merge base`, () => {
  it(`${ID} the night city of 1,024 fill point and 1,024 fill spot lamps gives the same pixel hash by seeking and by playing at 10 sampled times, its light lists take at most 4 MB with the estimate within 25%, and the perf lane carries the budget beside the merge base`, () => {
    const failures: string[] = [];
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const mine = current.tasks.filter((t) => Array.isArray(t['criteria']) && t['criteria'].includes(CRITERION));
    if (mine.length === 0) failures.push(`benchmarks/budgets.json has no task whose criteria name ${CRITERION}`);
    for (const t of mine) if (!(Array.isArray(t['command']) && t['command'].length > 0)) failures.push(`budgets.json task ${String(t['id'])} has no command the lane runs`);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    if (mergeBase.status !== 0) failures.push(`git merge-base HEAD origin/main: ${mergeBase.stderr}`);
    else {
      const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const verdict = base.status === 0 ? lane('try { b.validateBudgets(input.current, input.base); return "valid"; } catch (e) { return String(e.message); }', { current: current as unknown as JsonObject, base: JSON.parse(base.stdout) as JsonObject }) : base.stderr;
      if (verdict !== 'valid') failures.push(`the lane's validator refuses budgets.json against the merge base's: ${String(verdict)}`);
    }
    if (!timedFiles().includes(FILE)) failures.push(`scripts/lanes.mjs does not list ${FILE} in timed, the local preflight's perf step`);

    requireMetal();
    const out = dir();
    const doc = writeJson(out, 'city', cityDoc());
    const last = CITY.sampled.at(-1)!;
    const common = { doc, look: LOOK, size: CITY.size, fps: CITY.fps, targets: [] };
    const replies = runGpu(bin(), out, [
      view3dCall({ ...common, frames: last + 1, capture: CITY.sampled, timings: true }),
      ...CITY.sampled.map((n) => view3dCall({ ...common, from: n, frames: 1 })),
    ]);
    const played = framesOf(out, replies[0]!, CITY.size, 'the night city, played');
    const hashes = new Set<string>();
    CITY.sampled.forEach((n, k) => {
      const at = `${(n / CITY.fps).toFixed(1)} s (frame ${n})`;
      const p = frameAt(played, n, 'the night city, played');
      const s = frameAt(framesOf(out, replies[k + 1]!, CITY.size, `the night city, sought to frame ${n}`), n, 'the night city, sought');
      if (!p.pixelHash || p.pixelHash !== s.pixelHash) failures.push(`at ${at} the played frame has pixel hash ${String(p.pixelHash).slice(0, 16)}… and the sought one ${String(s.pixelHash).slice(0, 16)}…`);
      if (p.pixelHash) hashes.add(p.pixelHash);
      const missing = Object.keys(READINGS).filter((name) => !((reading(p, READINGS[name]!) ?? 0) > 0));
      if (missing.length) { failures.push(`at ${at} the timed frame doesn't report, above 0: ${missing.join(', ')}`); return; }
      const [bytes, estimate] = [reading(p, READINGS['lights.lists_bytes']!)!, reading(p, READINGS['estimate.lists_bytes']!)!];
      if (bytes > LIMITS.listsBytes) failures.push(`at ${at} the light lists take ${bytes} bytes, over 4 MB (${LIMITS.listsBytes})`);
      if (Math.abs(estimate - bytes) / bytes > LIMITS.estimateOff) failures.push(`at ${at} the cost model estimates the light lists at ${estimate} bytes, more than 25% off their ${bytes}`);
    });
    if (hashes.size < 2) failures.push(`the 10 sampled frames have ${hashes.size} pixel hash between them: the orbit draws one picture`);
    none(failures, `${ID}: the night city's hashes, its lists and the budget's place in the perf lane`);
  }, 2 * TIMEOUT);

  it(`${ID} on the reference Mac the night city stays within 10 ms of GPU a frame, its cluster pass within 0.5 ms and its CPU scoring within 1 ms a change, with the cost model's estimate within 25% of each, five runs each by the lane's rule`, () => {
    requireMetal();
    const problem = timingProblem();
    if (problem) inconclusive(`the budgets count only on a reference Mac at rest: ${problem}`);
    const scratch = mkdtempSync(join(tmpdir(), 'deep-1634-release-'));
    try {
      const release = buildGpu(scratch, true);
      expect(release.error, 'the release binary builds: cargo build --locked --release --bin deep-gpu').toBe('');
      timedRun(release.bin, dir());
      const runs: ReturnType<typeof timedRun>[] = []; const loads: Load[] = [];
      for (let k = 0; k < 5; k++) { const start = load(); runs.push(timedRun(release.bin, dir())); loads.push({ start, end: load() }); }
      const judged: [string, JsonObject][] = [
        ['GPU ms a frame at p95 (the showpiece class: 10)', judgeLimit(LIMITS.frameGpuMs, runs.map((r) => r.gpu), loads)],
        ['the cluster pass, GPU ms at p95 (at most 0.5)', judgeLimit(LIMITS.clusterPassMs, runs.map((r) => r.pass), loads)],
        ['the CPU scoring, ms a change at p95 (at most 1)', judgeLimit(LIMITS.scoringMs, runs.map((r) => r.scoring), loads)],
        ['the estimate of the frame\'s GPU time, off its measurement (at most 0.25)', judgeLimit(LIMITS.estimateOff, runs.map((r) => r.gpuOff), loads)],
        ['the estimate of the cluster pass, off its measurement (at most 0.25)', judgeLimit(LIMITS.estimateOff, runs.map((r) => r.passOff), loads)],
        ['the estimate of the CPU scoring, off its measurement (at most 0.25)', judgeLimit(LIMITS.estimateOff, runs.map((r) => r.scoringOff), loads)],
      ];
      for (const [name, v] of judged) console.log(`${ID} ${name}: ${String(v['status'])} ${shown(v['runs'] ?? null)}${v['reason'] ? ` (${String(v['reason'])})` : ''}`);
      expect(judged.filter(([, v]) => v['status'] === 'FAIL').map(([n, v]) => `${n}: ${shown(v)}`), 'no budget fails').toEqual([]);
      const open = judged.filter(([, v]) => v['status'] !== 'PASS');
      if (open.length) inconclusive(open.map(([n, v]) => `${n}: ${String(v['status'])} ${String(v['reason'] ?? '')}`).join('; '));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 3 * TIMEOUT);
});
