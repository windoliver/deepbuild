// AC2: with the deepest level open, a window-sized 3D frame stays within the GPU budget, because only what's on
// screen is loaded. The issue says "the GPU budget below" and names no number; these tests use the design's budget
// for a window-sized view (README: Readings, the budget): under 2 ms of GPU per frame and under 256 MB of GPU memory
// per window, judged at p95 over a run's settled frames in five runs on the reference Mac. The city is generated
// (README: Fixtures): 64 parts, 768 tables and 6,144 columns over 833 documents, each part and table opening its own
// document by reference (Level of detail: `open`), and the camera looks down at part 27's table 5 from 10 m, so its
// columns, the deepest level, are open and no other part is in view. Driven through #378's view3d call on `deep-gpu
// run`, with the fields this criterion adds (README: The surface under test). At the base view3d has no `docs`,
// `resident` or `timings`, so no frame reports what it loaded or what it cost.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GPU_BIN, REPO, WINDOW_PX, cityFrames, drawnIds, environmentProblem, expectJudgedFail, fixture, judge, p95, requireGpu, runGpu, useBins, useOut, writeCity,
  type City, type CityFrame, type GpuPlanted, type JsonObject,
} from './helpers.ts';

const bins = useBins([GPU_BIN]);
const out = useOut();
const LOOK = fixture('look.json');
const FRAMES = 360;
const MIN_SETTLED = 300;
const GPU_MS = 2; // technical design, Every task carries its own budgets: "a core view or a window-sized figure under 2 ms of GPU"
const GPU_BYTES = 256_000_000; // the same row: "under 256 MB of GPU memory per window measured on the device"

function view(city: City, extra: JsonObject): JsonObject {
  return { call: 'view3d', doc: city.root, docs: city.docs, look: LOOK, size: WINDOW_PX, frames: FRAMES, fps: 60, ...extra };
}
/** The frames from the first settled one on: the camera rests, so every one after it must be settled too. */
function settledFrames(frames: CityFrame[], what: string): CityFrame[] {
  const first = frames.findIndex((f) => f.settled);
  expect(first, `${what}: some frame settles, with every document the view selects resident`).toBeGreaterThanOrEqual(0);
  const rest = frames.slice(first);
  expect(rest.every((f) => f.settled), `${what}: once settled, a resting view stays settled`).toBe(true);
  expect(rest.length, `${what}: at least ${MIN_SETTLED} settled frames of ${FRAMES}`).toBeGreaterThanOrEqual(MIN_SETTLED);
  return rest;
}

/** Only what's on screen is loaded, as failures: every resident document's opener is drawn, or something inside it is. */
function residentFailures(city: City, last: CityFrame, drawn: Set<string>): string[] {
  const f: string[] = [];
  const openerOf = new Map([...city.opens].map(([item, h]) => [h, item]));
  const onScreen = (item: string): boolean => [...drawn].some((d) => d === item || d.startsWith(`${item}.`));
  for (const h of last.resident) {
    const item = openerOf.get(h);
    if (!item) { f.push(`${h} is resident but no item of the city opens it`); continue; }
    if (!onScreen(item)) f.push(`${h}, which ${item} opens, is loaded while neither ${item} nor anything inside it is on screen`);
    const parent = city.parentOf.get(h);
    if (parent && !last.resident.includes(parent)) f.push(`${h} is resident without the document that holds its opener, ${parent}`);
  }
  if (!last.resident.includes(city.deepest)) f.push(`the deepest level's document ${city.deepest} (p27.t5's columns) isn't resident`);
  const columns = city.deepestColumns.filter((c) => drawn.has(c));
  if (columns.length === 0) f.push(`none of the deepest level's columns is drawn: ${city.deepestColumns.join(', ')}`);
  return f;
}

function loadedRun(planted?: GpuPlanted): string[] {
  const city = writeCity(out());
  const [reply] = runGpu(bins.bin(GPU_BIN), out(), [view(city, { targets: ['ids'], capture: [FRAMES - 1] })], planted);
  const what = `the city at its deepest level${planted ? ` (planted ${planted})` : ''}`;
  const frames = cityFrames(reply!, what);
  expect(frames.map((f) => f.frame), `${what}: every frame from 0 to ${FRAMES - 1} once, in order`).toEqual(Array.from({ length: FRAMES }, (_, i) => i));
  const last = settledFrames(frames, what).pop()!;
  return residentFailures(city, last, drawnIds(out(), last, `${what}: frame ${FRAMES - 1}`));
}

interface Timed { gpuP95: number; bytes: number }
function timedRun(planted?: GpuPlanted): Timed {
  const city = writeCity(out());
  const [reply] = runGpu(bins.bin(GPU_BIN), out(), [view(city, { timings: true })], planted);
  const what = `the timed city${planted ? ` (planted ${planted})` : ''}`;
  const settled = settledFrames(cityFrames(reply!, what), what);
  const ms = settled.map((f, i) => { expect(f.gpu_ms, `${what}: settled frame ${i} reports gpu_ms`).not.toBeNull(); return f.gpu_ms!; });
  const bytes = settled.map((f, i) => { expect(f.gpu_bytes, `${what}: settled frame ${i} reports gpu_bytes`).not.toBeNull(); return f.gpu_bytes!; });
  return { gpuP95: p95(ms), bytes: Math.max(...bytes) };
}
/** One warm-up process, discarded, then five fresh ones. */
function timedRuns(planted?: GpuPlanted): Timed[] {
  timedRun(planted);
  return Array.from({ length: 5 }, () => timedRun(planted));
}

describe('AC2 with the deepest level open, a window-sized 3D frame stays within the GPU budget, because only what\'s on screen is loaded', () => {
  it('AC2 with the deepest level open, only what\'s on screen is loaded', () => {
    requireGpu();
    expect(loadedRun(), 'every loaded document is on screen').toEqual([]);
    // Wrong program: residency that loads every document an item opens, wherever the item is, fails, naming one.
    const twin = loadedRun('loads_everything');
    expect(twin.some((x) => x.includes('is loaded while neither')), `the planted loads_everything fails: ${JSON.stringify(twin.slice(0, 3))}`).toBe(true);
  }, 3_600_000);

  it(`AC2 on the reference Mac, the deepest level's window-sized frame takes at most ${GPU_MS} ms of GPU at p95 and at most 256 MB of GPU memory, in five runs`, (ctx) => {
    requireGpu();
    const runs = timedRuns();
    // The measure sees the GPU: a frame that keeps the GPU busy past 10 ms is judged FAIL, whatever the machine's load.
    expectJudgedFail('AC2 planted slow_gpu_frame: GPU ms at p95', timedRuns('slow_gpu_frame').map((r) => r.gpuP95), GPU_MS);
    const problem = environmentProblem();
    if (problem) {
      console.log(`AC2 GPU ms at p95: ${runs.map((r) => r.gpuP95.toFixed(3)).join(', ')} against ${GPU_MS}; GPU bytes: ${runs.map((r) => r.bytes).join(', ')} against ${GPU_BYTES}`);
      ctx.skip(`INCONCLUSIVE (reading only: ${problem}): GPU ms at p95 ${runs.map((r) => r.gpuP95.toFixed(3)).join(', ')} against ${GPU_MS}; GPU bytes ${runs.map((r) => r.bytes).join(', ')} against ${GPU_BYTES}`);
    }
    judge(ctx, 'AC2 GPU ms at p95 over the settled frames', runs.map((r) => r.gpuP95), GPU_MS);
    judge(ctx, 'AC2 GPU bytes, the most of any settled frame', runs.map((r) => r.bytes), GPU_BYTES);
  }, 3_600_000);

  it('AC2 the perf lane has a task map-deepest-level, a #383 first measurement, valid against the merge base\'s budgets, and it runs', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => t.id === 'map-deepest-level');
    expect(task, 'benchmarks/budgets.json has a task map-deepest-level, the deepest level\'s frame compared with the merge base').toBeDefined();
    expect(String(task!.initialReason), 'its first measurement says why, naming issue #383').toMatch(/#383\b/);
    const [command, ...args] = task!.command;
    execFileSync(command === 'node' ? process.execPath : command!, args, { cwd: REPO, stdio: 'pipe', timeout: 1_800_000 });
  }, 1_800_000);
});
