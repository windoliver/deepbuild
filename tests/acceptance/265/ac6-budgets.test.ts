// AC6 #265.e3eb2a00: "Budgets, on the reference Mac in the local preflight, compared with the merge base: 8 movers, each
// with a world-space emitter, a 16-segment trail and a wake, read their past steps within the showpiece's 4 ms of frame
// CPU at p95"
//
// Eight movers (helpers.ts: crowdDoc): one logic item moves eight boxes, each on its own lake whose material wakes
// behind it over 8 s, each with a world-space emitter anchored on it and a `mark.line@1` trail of 16 segments; a
// showpiece. "Compared with the merge base" is the perf lane's, as #1634's and #465's suites read it: benchmarks/
// budgets.json holds a task whose `criteria` name #265.e3eb2a00, with a command the lane runs, passing the lane's own
// validator against the merge base's file, and scripts/lanes.mjs lists this file in `timed`, the local preflight's perf
// step. Then:
// - The fixture draws (a dev build, 30 frames at 60 fps, `timings: true`): every frame reports `cpu_ms` (#378's frame CPU:
//   its evaluation, up to handing the scene to the render side), each emitter has live particles and each trail 17
//   points from 1 s on.
// - The timings, by the design's rule (Every task carries its own budgets; Frame budget): a release build; one untimed
//   warm-up run, then five, each a fresh process playing the movers' 600 frames at 1280 × 720 with `timings: true` and
//   nothing captured; each run's reading the p95 of `cpu_ms` over its frames, judged against 4 ms by the perf lane's
//   `judgeLimit` (scripts/benchmark.mjs, through #1634's helpers) with each run's load at its start and end: PASS only on
//   a reference Mac at rest with all five within; FAIL when all five are over by more than the margin; anything else
//   INCONCLUSIVE, which fails here and never passes. The machine is asked before anything is timed.
// Wrong programs: the base (the movers' document is refused; no task); past steps read by replaying the program each
// frame; a budget no lane compares with the merge base.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGpu, judgeLimit, lane, load, p95, timedFiles, timingProblem, type Load } from '../1634/helpers.ts';
import {
  CRITERIA, CROWD, REPO, TIMEOUT, ac, crowdDoc, drawn, framesOf, inconclusive, isObject, none, putPrograms, requireGpu, run, show, trailAt, trailFrames,
  useBins, useDir, view3d, writeJson, type JsonObject,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const FILE = 'tests/acceptance/265/ac6-budgets.test.ts';
const LIMIT_MS = 4;
const SIZE: [number, number] = [1280, 720];
const FRAMES = 600;
const DUST = Array.from({ length: CROWD }, (_, i) => `dust-${i}`);
const TRAILS = Array.from({ length: CROWD }, (_, i) => `trail-${i}`);

/** The perf lane's hold on this budget: its task, the validator against the merge base, the `timed` line. */
function laneProblems(): string[] {
  const out: string[] = [];
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: JsonObject[] };
  const mine = current.tasks.filter((t) => Array.isArray(t['criteria']) && t['criteria'].includes(CRITERIA[6]));
  if (mine.length === 0) out.push(`benchmarks/budgets.json has no task whose criteria name ${CRITERIA[6]}`);
  for (const t of mine) if (!(Array.isArray(t['command']) && t['command'].length > 0)) out.push(`budgets.json task ${String(t['id'])} has no command the lane runs`);
  const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
  if (mergeBase.status !== 0) out.push(`git merge-base HEAD origin/main: ${mergeBase.stderr}`);
  else {
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const verdict = base.status === 0 ? lane('try { b.validateBudgets(input.current, input.base); return "valid"; } catch (e) { return String(e.message); }', { current: current as unknown as JsonObject, base: JSON.parse(base.stdout) as JsonObject }) : base.stderr;
    if (verdict !== 'valid') out.push(`the lane's validator refuses budgets.json against the merge base's: ${String(verdict)}`);
  }
  if (!timedFiles().includes(FILE)) out.push(`scripts/lanes.mjs does not list ${FILE} in timed, the local preflight's perf step`);
  return out;
}

/** One timing run in a fresh process: the p95 of the frames' `cpu_ms`. */
function timedRun(bin: string): number {
  const out = dir();
  const f = crowdDoc();
  const [reply] = run(bin, out, [view3d({ doc: writeJson(out, 'movers.json', f.doc), assets: putPrograms(out, f.programs), size: SIZE, fps: 60, from: 0, frames: FRAMES, timings: true, capture: [], targets: [] })]);
  const frames = drawn(reply!, 'the eight movers, timed');
  expect(frames.length, 'every frame of the movers is reported').toBe(FRAMES);
  return p95(frames.map((x) => { expect(typeof x['cpu_ms'], `frame ${String(x['frame'])} reports cpu_ms`).toBe('number'); return x['cpu_ms'] as number; }));
}

describe(`${ac(6)} eight movers with emitters, trails and wakes within the showpiece's frame CPU`, () => {
  it(`${ac(6)} the perf lane carries the budget beside the merge base, the movers draw, and on the reference Mac they read their past steps within 4 ms of frame CPU at p95, five runs by the lane's rule`, () => {
    const fails = laneProblems();
    requireGpu();
    const f = crowdDoc();
    const out = dir();
    const [reply] = run(bins.bin('deep-gpu'), out, [view3d({ doc: writeJson(out, 'movers.json', f.doc), assets: putPrograms(out, f.programs), fps: 60, from: 60, frames: 30, timings: true, particles: DUST, particle_cull: 'none', trails: TRAILS })]);
    if (isObject(reply) && reply['code'] !== undefined) fails.push(`the eight movers aren't drawn: ${show(reply)}`);
    else {
      for (const x of drawn(reply!, 'the eight movers')) if (typeof x['cpu_ms'] !== 'number') fails.push(`frame ${String(x['frame'])} reports no cpu_ms`);
      for (const x of framesOf(reply!, 'the eight movers', DUST)) for (const id of DUST) if ((x.particles.get(id)?.live ?? 0) === 0) fails.push(`frame ${x.frame}: ${id} has no live particle`);
      for (const t of trailFrames(reply!, 'the eight movers', TRAILS)) for (const id of TRAILS) if (trailAt(t, id).traces[0]?.points.length !== 17) fails.push(`frame ${t.frame}: ${id} draws ${trailAt(t, id).traces[0]?.points.length ?? 0} points, not 17`);
    }
    none(fails, 'the budget\'s place in the perf lane and the movers drawn');

    const problem = timingProblem();
    if (problem) inconclusive(`the budget counts only on a reference Mac at rest: ${problem}`);
    const scratch = mkdtempSync(join(tmpdir(), 'deep-265-release-'));
    try {
      const release = buildGpu(scratch, true);
      expect(release.error, 'the release binary builds: cargo build --locked --release --bin deep-gpu').toBe('');
      timedRun(release.bin);
      const runs: number[] = []; const loads: Load[] = [];
      for (let k = 0; k < 5; k++) { const start = load(); runs.push(timedRun(release.bin)); loads.push({ start, end: load() }); }
      const v = judgeLimit(LIMIT_MS, runs, loads);
      console.log(`${ac(6)} frame CPU ms at p95 (the showpiece class: 4): ${String(v['status'])} ${show(v['runs'] ?? runs)}${v['reason'] ? ` (${String(v['reason'])})` : ''}`);
      expect(v['status'], `the eight movers' frame CPU at p95 against 4 ms: ${show(v)}`).not.toBe('FAIL');
      if (v['status'] !== 'PASS') inconclusive(`the five runs don't decide: ${String(v['status'])} ${String(v['reason'] ?? '')}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 3 * TIMEOUT);
});
