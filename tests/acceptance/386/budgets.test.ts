// #386.b603e2cd: Budgets, on the reference Mac in the local preflight, compared with the merge base: evaluating a
// 10,000-item document takes under 4 ms of CPU per frame with no heap allocation after warm-up; checking it before it
// shows takes under 50 ms; GPU memory stays under 256 MB per window; the upscale's two passes take under 0.3 ms at
// 1080p.
//
// - The merge-base comparison is the perf lane's: a task `canvas-upscale` in benchmarks/budgets.json running `node
//   benchmarks/canvas.mjs upscale`, a #386 first measurement, valid against the merge base's budgets (as #379's and
//   #140's budgets are). The tests below judge the issue's limits on this machine by the design's rule.
// - The live view is #379's `live` call with this suite's `surface` on its session, at internal scale 0.5 through the
//   edge-adaptive upscale: the 10,000-item document (`cityDoc`, a showpiece: "full screen on the reference Mac's
//   display at half resolution while moving", 30 fps) full screen on this reference Mac's display; the upscale's passes
//   on the 1080p frame of `typeDoc` (60 fps). CPU per frame is a frame's `cpu_ms`, the canvas core's threads; heap
//   allocations are #379's counting allocator (`report: ["allocs"]`, the `test-meter` build); the check's time is the
//   first revision's `check_ms` (new, README); GPU memory is Metal's allocated size above its value before the call;
//   the passes' time is the union of the `surface.upscale` and `surface.sharpen` intervals from pass timestamps.
// - Timings: a warm-up run, then five runs, each a p95 over 300 frames after 60 of warm-up (or one check per fresh
//   process), judged by the design's rule: PASS all five within, FAIL all five over by more than the margin, else
//   INCONCLUSIVE, which fails here with that word. Off a reference Mac (Mac15,7 or Mac15,12) every test here is
//   INCONCLUSIVE; power, Low Power Mode and load are not gated (the owner's rule).
// Wrong programs: the base (no task, no `surface`, no `check_ms`); #379's `--planted allocates_per_frame`, which must
// fail the allocation check naming frame 61; `--planted slow_upscale`, whose passes must read over 0.3 ms.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HD, LIVE_WRITER, PLAIN_LOOK, REPO, SHARPEN_PASS, UPSCALE_PASS, WINDOW_CAP_BYTES, cityDoc, judge, liveCall, liveOf, liveSurfaceProblems, p95, payload,
  requireReferenceMac, run1, shown, typeDoc, useBuilds, useOut, writeJson,
  type Build, type Live, type Planted, type SurfaceSpec,
} from './helpers.ts';

const ID = '#386.b603e2cd';
const HALF: SurfaceSpec = { internal_scale: 0.5, upscale: 'edge_adaptive', sharpen: 0.2 };
const WARM = 60;
const MEASURED = 300;
const LIMITS = { cpu_ms: 4, check_ms: 50, upscale_ms: 0.3 };
const TASK = 'canvas-upscale';

const builds = useBuilds(['default', 'test-meter']);
const out = useOut();

/** One live run of the 10,000-item document, full screen at internal scale 0.5. */
function city(build: Build, frames: number, report: ('allocs' | 'memory')[], planted?: Planted): Live {
  const mac = requireReferenceMac();
  const doc = writeJson(out(), 'city', payload(cityDoc(), 'showpiece'));
  const reply = run1(builds.bin(build), out(), liveCall({
    look: PLAIN_LOOK, frames, fps: 30, report, sessions: [{ session: 'city', writer: LIVE_WRITER, doc, size: mac.display, surface: HALF }],
  }), planted ? { planted } : {});
  const live = liveOf(reply, 'the 10,000-item document');
  expect(live.sessions[0]?.state, `the 10,000-item document is live (checked and shown): ${shown(reply['sessions'])}`).toBe('live');
  expect(liveSurfaceProblems(live, 'city', HALF), 'every frame drew it at internal scale 0.5 through the edge-adaptive upscale').toEqual([]);
  return live;
}
/** Frames after warm-up that allocated: one sentence each, at most five. */
function allocProblems(live: Live): string[] {
  const out: string[] = [];
  for (const f of live.frames.filter((x) => x.frame > WARM)) {
    if (f.allocs === null) out.push(`frame ${f.frame}: no allocation count`);
    else if (f.allocs !== 0) out.push(`frame ${f.frame}: ${f.allocs} heap allocations after warm-up`);
    if (out.length >= 5) break;
  }
  return out;
}

let cityRuns: Live[] | null = null;
/** A warm-up run, then five, each a fresh process: frames 1 … 360, counted allocations. */
function fiveCityRuns(): Live[] {
  if (cityRuns) return cityRuns;
  city('test-meter', 2, ['allocs']);
  city('test-meter', WARM + MEASURED, ['allocs']);
  cityRuns = Array.from({ length: 5 }, () => city('test-meter', WARM + MEASURED, ['allocs']));
  return cityRuns;
}

/** The union of the upscale's two passes, in ms, per frame after warm-up. */
function upscaleTimes(live: Live): number[] {
  const out: number[] = [];
  for (const f of live.frames.filter((x) => x.frame > WARM)) {
    const ps = (f.passes ?? []).filter((p) => p.name === UPSCALE_PASS || p.name === SHARPEN_PASS);
    expect(ps.map((p) => p.name).sort(), `frame ${f.frame}: both of the upscale's passes ran`).toEqual([SHARPEN_PASS, UPSCALE_PASS]);
    for (const p of ps) expect(p.source, `frame ${f.frame}: ${p.name} timed by pass timestamps`).toBe('timestamps');
    const iv = ps.map((p) => [p.start_ns, p.end_ns] as [number, number]).sort((a, b) => a[0] - b[0]);
    let covered = 0; let end = -Infinity;
    for (const [a, b] of iv) { covered += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
    out.push(covered / 1e6);
  }
  return out;
}
function upscaleRun(planted?: Planted): number {
  requireReferenceMac();
  const doc = writeJson(out(), 'type', payload(typeDoc(), 'showpiece'));
  const reply = run1(builds.bin(), out(), liveCall({
    look: PLAIN_LOOK, frames: WARM + MEASURED, fps: 60, report: ['passes'], sessions: [{ session: 'type', writer: LIVE_WRITER, doc, size: HD, surface: HALF }],
  }), planted ? { planted } : {});
  const live = liveOf(reply, 'the 1080p frame');
  expect(liveSurfaceProblems(live, 'type', HALF), 'every frame drew it at internal scale 0.5 through the edge-adaptive upscale').toEqual([]);
  return p95(upscaleTimes(live));
}

describe(`${ID} the merge-base comparison is the perf lane's`, () => {
  it(`${ID} budgets.json has a task ${TASK} running node benchmarks/canvas.mjs upscale, a #386 first measurement, valid against the merge base's budgets`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => t.id === TASK);
    expect(task, `budgets.json has a task ${TASK}`).toBeDefined();
    expect(task!.command, `${TASK} runs the upscale's bench`).toEqual(['node', 'benchmarks/canvas.mjs', 'upscale']);
    expect(String(task!.initialReason), `${TASK} says why, naming issue #386`).toMatch(/#386/);
  });

  it(`${ID} the perf lane's task runs on this reference Mac and exits 0`, () => {
    requireReferenceMac();
    const cargo = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-gpu'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
    expect(cargo.status, `the binary the bench drives builds: ${cargo.stderr.slice(-2000)}`).toBe(0);
    const r = spawnSync(process.execPath, [join(REPO, 'benchmarks', 'canvas.mjs'), 'upscale'], { cwd: REPO, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 256 * 1024 * 1024 });
    expect(r.status, `node benchmarks/canvas.mjs upscale exits 0: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  }, 3_600_000);
});

describe(`${ID} evaluating a 10,000-item document takes under 4 ms of CPU per frame with no heap allocation after warm-up`, () => {
  it(`${ID} full screen at internal scale 0.5: no heap allocation in frames 61 … 360 of any run, and each run's p95 CPU per frame under 4 ms`, () => {
    const runs = fiveCityRuns();
    for (const [i, live] of runs.entries()) expect(allocProblems(live), `run ${i + 1}: no heap allocation after warm-up`).toEqual([]);
    judge(`${ID} the 10,000-item document's CPU per frame, p95 of frames 61 … 360 (ms)`, runs.map((l) => p95(l.frames.filter((f) => f.frame > WARM).map((f) => f.cpu_ms))), LIMITS.cpu_ms);
  }, 7_200_000);

  it(`${ID} a planted meter that allocates every frame fails the allocation check, naming frame 61`, () => {
    const problems = allocProblems(city('test-meter', WARM + 30, ['allocs'], 'allocates_per_frame'));
    expect(problems.length, '--planted allocates_per_frame allocates after warm-up').toBeGreaterThan(0);
    expect(problems[0], 'naming the first frame after warm-up').toMatch(/^frame 61: /);
  }, 1_800_000);
});

describe(`${ID} checking the 10,000-item document before it shows takes under 50 ms`, () => {
  it(`${ID} each fresh process's check of the first revision, before it shows, under 50 ms`, () => {
    const runs = fiveCityRuns();
    const times = runs.map((live, i) => {
      const rev = live.sessions[0]?.revisions[0];
      expect(rev?.outcome, `run ${i + 1}: the first revision passed its check and became current`).toBe('current');
      expect(rev?.check_ms, `run ${i + 1}: the first revision reports its check's time (check_ms)`).not.toBeNull();
      return rev!.check_ms!;
    });
    judge(`${ID} the 10,000-item document's check before it shows (ms)`, times, LIMITS.check_ms);
  }, 7_200_000);
});

describe(`${ID} GPU memory stays under 256 MB per window`, () => {
  it(`${ID} the 10,000-item document full screen at internal scale 0.5: Metal's allocated size above its value before the window peaks under 256 MB, and above the view's own slots`, () => {
    const mac = requireReferenceMac();
    const live = city('default', 120, ['memory']);
    expect(live.device_before, 'the device\'s allocated size before the call is read').not.toBeNull();
    const peak = Math.max(...live.frames.map((f) => {
      expect(f.device_bytes, `frame ${f.frame}: the device's allocated size is read`).not.toBeNull();
      return f.device_bytes! - live.device_before!;
    }));
    console.log(`${ID}: the window's GPU memory peaks at ${(peak / 1e6).toFixed(1)} MB on ${mac.display.join(' × ')}`);
    expect(peak, 'the measure sees the view: above two full-size BGRA8 slots').toBeGreaterThan(2 * mac.display[0] * mac.display[1] * 4);
    expect(peak, 'under 256 MB per window').toBeLessThan(WINDOW_CAP_BYTES);
  }, 1_800_000);
});

describe(`${ID} the upscale's two passes take under 0.3 ms at 1080p`, () => {
  it(`${ID} at 1080p and internal scale 0.5, each run's p95 of the upscale's and sharpen's covered time under 0.3 ms`, () => {
    upscaleRun();
    judge(`${ID} the upscale's two passes at 1080p, p95 of frames 61 … 360 (ms)`, Array.from({ length: 5 }, () => upscaleRun()), LIMITS.upscale_ms);
  }, 7_200_000);

  it(`${ID} a planted slow upscale reads over 0.3 ms, so the reading sees the passes`, () => {
    const reading = upscaleRun('slow_upscale');
    expect(reading, '--planted slow_upscale\'s passes read over 0.3 ms by more than the 5% margin').toBeGreaterThan(LIMITS.upscale_ms * 1.05);
  }, 1_800_000);
});
