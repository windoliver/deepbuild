// AC2 #463.7c8d3f4b: "Budgets, on the reference Mac in the local preflight, compared with the merge base: each look
// plays the 1080p test scene within the showpiece budget in 2D and 3D, a region's edge costs at most twice the frame
// while in view, and switching looks takes under 100 ms"
//
// As #149's and #417's budgets do, each timing is a perf-lane task in benchmarks/budgets.json, a mode of
// benchmarks/canvas.mjs printing one JSON report as its last stdout line (README: AC2's reports); the lane compares each
// with the merge base at its 50% margin, so the entries must pass the lane's validator against the merge base's file.
// These tests run each mode once and judge its five runs by scripts/benchmark.mjs's `judgeLimit`: PASS only when all
// five are within the limit on a reference Mac, on mains power, with the load at the command's start and end at most
// the core count; FAIL when all five are over it past the margin; INCONCLUSIVE otherwise, never a pass.
//
// - The showpiece budget is the class's 10 ms GPU and 4 ms CPU a frame (crates/deep-canvas/src/budget.rs), held to
//   each run's worst p95 over every look in 2D and in 3D, 300 timed frames each at 1920 × 1080.
// - "At most twice the frame while in view": per look pair, the scene with a region (fixtures/scene-region.json) whose
//   edge is in view on every frame, its p95 GPU ms against the costlier of the two looks drawing the plain scene alone.
// - A switch: from the request to the first frame drawn in the new look, over every ordered pair of art@1 looks.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIMS, LOOKS, REGION_REL, REPO, SCENE_REL, SIZE, ac, arr, inconclusive, judgeLimit, load, none, num, obj, p95, requireGpu, show,
  type JsonObject, type JsonValue,
} from './helpers.ts';

const LANE_MARGIN = 0.5;
const FRAMES = { id: 'canvas-art-frames', mode: 'art-frames', targets: { frame_gpu_p95_ms: 10, frame_cpu_p95_ms: 4 } };
const REGIONS = { id: 'canvas-art-regions', mode: 'art-regions', targets: { edge_frame_ratio: 2 } };
const SWITCH = { id: 'canvas-art-switch', mode: 'art-switch', targets: { switch_ms: 100 } };
const TASKS = [FRAMES, REGIONS, SWITCH];
const BENCH_TIMEOUT = 4 * 3_600_000;

interface Report { body: JsonObject; loads: { start: number; end: number }[] }
const reports = new Map<string, Report>();
/** `node benchmarks/canvas.mjs <mode>`: exits 0 and prints its report, naming its task, as its last stdout line. */
function record(task: { id: string; mode: string }): Report {
  const kept = reports.get(task.mode);
  if (kept) return kept;
  const args = ['benchmarks/canvas.mjs', task.mode];
  const start = load();
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', timeout: BENCH_TIMEOUT, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 * 1024 });
  const end = load();
  expect(r.error, `node ${args.join(' ')} ran: ${r.error?.message}`).toBeUndefined();
  expect(r.status, `node ${args.join(' ')} exits 0; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
  let last: JsonValue = null;
  try { last = lines.length ? (JSON.parse(lines.at(-1)!) as JsonValue) : null; } catch { last = null; }
  const body = obj(last ?? undefined, `node ${args.join(' ')}: its report (the last stdout line)`);
  expect(body['task'], 'the report names its budgets.json task').toBe(task.id);
  expect(obj(obj(body['fingerprint'], 'fingerprint')['build'], 'fingerprint.build')['profile'], 'the timed binary is a release build').toBe('release');
  expect(arr(body['runs'], 'report: runs').length, 'five runs after a warm-up').toBe(5);
  // The load is read at the command's start and end, so each of its five runs is bracketed by both readings.
  const report = { body, loads: Array.from({ length: 5 }, () => ({ start, end })) };
  reports.set(task.mode, report);
  return report;
}
async function judge(name: string, limit: number, runs: number[], report: Report): Promise<void> {
  const verdict = await judgeLimit(limit, runs, report.body['fingerprint']!, report.loads);
  const line = `${name}: ${verdict.status}, runs ${runs.map((x) => x.toFixed(3)).join(', ')} against ${limit}${verdict.reason ? ` (${verdict.reason})` : ''}`;
  console.log(line);
  expect(['PASS', 'INCONCLUSIVE'], `FAIL or BLOCKED: ${line}`).toContain(verdict.status);
  if (verdict.status === 'INCONCLUSIVE') inconclusive(line);
}
interface Timed { gpu: number[]; cpu: number[] }
function timed(v: JsonValue | undefined, what: string, problems: string[]): Timed {
  const frames = arr(obj(v, what)['frames'], `${what}: frames`).map((f, k) => obj(f, `${what} frame ${k}`));
  const gpu = frames.map((f, k) => num(f['gpu_ms'], `${what} frame ${k}: gpu_ms`));
  const cpu = frames.map((f, k) => num(f['cpu_ms'], `${what} frame ${k}: cpu_ms`));
  if (frames.length < 300) problems.push(`${what} times ${frames.length} frames, not at least 300`);
  if (gpu.some((g) => !(g > 0)) || cpu.some((c) => !(c > 0))) problems.push(`${what} has a frame that took no GPU or CPU time, so it wasn't drawn`);
  return { gpu, cpu };
}
/** Each look's region pair: the look's scene with a region in the next look of the issue's list, the last with the first. */
const PAIRS = LOOKS.map((look, i) => ({ look, region: LOOKS[(i + 1) % LOOKS.length]! }));

describe(`${ac(2)} art@1's budgets on the reference Mac, against the merge base`, () => {
  it(`${ac(2)} budgets.json has the three tasks, with the issue's numbers and the lane's margin, and passes the lane's validator against the merge base`, async () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    for (const task of TASKS) {
      const entry = current.tasks.find((t) => t['id'] === task.id);
      expect(entry, `budgets.json has the task ${task.id}`).toBeDefined();
      expect(entry!['command'], `${task.id} runs its mode of the canvas bench`).toEqual(['node', 'benchmarks/canvas.mjs', task.mode]);
      expect(entry!['targets'], `${task.id} holds the issue's numbers`).toEqual(task.targets);
      expect(entry!['margin'], `${task.id} compares with the merge base at the lane's margin`).toBe(LANE_MARGIN);
      expect(String(entry!['initialReason']), `${task.id} says why, naming #463`).toMatch(/#463/);
    }
  });

  it(`${ac(2)} each look plays the 1080p test scene within the showpiece budget in 2D and 3D: each run's worst p95, five runs`, async () => {
    requireGpu();
    const report = record(FRAMES);
    const problems: string[] = [];
    const gpu: number[] = []; const cpu: number[] = [];
    arr(report.body['runs'], 'runs').forEach((r, i) => {
      const looks = obj(obj(r, `run ${i + 1}`)['looks'], `run ${i + 1}: looks`);
      if (Object.keys(looks).sort().join() !== [...LOOKS].sort().join()) problems.push(`run ${i + 1} times the looks ${Object.keys(looks).join(', ')}, not the twelve`);
      let g = 0; let c = 0;
      for (const look of LOOKS) for (const dim of DIMS) {
        const entry = obj(obj(looks[look], `run ${i + 1}: ${look}`)[dim], `run ${i + 1}: ${look} ${dim}`);
        if (entry['fixture'] !== SCENE_REL) problems.push(`run ${i + 1}: ${look} ${dim} plays ${show(entry['fixture'])}, not ${SCENE_REL}`);
        if (show(entry['size']) !== show(SIZE)) problems.push(`run ${i + 1}: ${look} ${dim} isn't drawn at 1920 × 1080: ${show(entry['size'])}`);
        const t = timed(entry, `run ${i + 1}: ${look} ${dim}`, problems);
        g = Math.max(g, p95(t.gpu)); c = Math.max(c, p95(t.cpu));
      }
      gpu.push(g); cpu.push(c);
    });
    none(problems, 'the art-frames report');
    await judge(`${ac(2)} the worst look's p95 frame CPU (ms)`, FRAMES.targets.frame_cpu_p95_ms, cpu, report);
    await judge(`${ac(2)} the worst look's p95 frame GPU (ms)`, FRAMES.targets.frame_gpu_p95_ms, gpu, report);
  }, BENCH_TIMEOUT + 600_000);

  it(`${ac(2)} a region's edge in view costs at most twice the frame: each run's worst ratio over every look pair, 2D and 3D`, async () => {
    requireGpu();
    const report = record(REGIONS);
    const problems: string[] = [];
    const worst = arr(report.body['runs'], 'runs').map((r, i) => {
      const pairs = arr(obj(r, `run ${i + 1}`)['pairs'], `run ${i + 1}: pairs`).map((p, k) => obj(p, `run ${i + 1}: pairs[${k}]`));
      let ratio = 0;
      for (const { look, region } of PAIRS) {
        const pair = pairs.find((p) => p['look'] === look && p['region'] === region);
        if (!pair) { problems.push(`run ${i + 1} has no pair ${look} with a region in ${region}`); continue; }
        for (const dim of DIMS) {
          const what = `run ${i + 1}: ${look} with ${region} ${dim}`;
          const e = obj(pair[dim], what);
          if (e['fixture'] !== REGION_REL) problems.push(`${what} plays ${show(e['fixture'])}, not ${REGION_REL}`);
          const h = obj(e['hashes'], `${what}: hashes`);
          if (typeof h['edge'] !== 'string' || h['edge'] === h['outer'] || h['edge'] === h['inner']) problems.push(`${what}: the frame with the region drew the same pixels as one look alone (${show(h)}), so no edge was in view`);
          const [outer, inner, edge] = (['outer', 'inner', 'edge'] as const).map((side) => p95(timed(e[side], `${what} ${side}`, problems).gpu));
          ratio = Math.max(ratio, edge! / Math.max(outer!, inner!));
        }
      }
      return ratio;
    });
    none(problems, 'the art-regions report');
    await judge(`${ac(2)} the worst pair's p95 GPU with an edge in view ÷ the costlier look alone`, REGIONS.targets.edge_frame_ratio, worst, report);
  }, BENCH_TIMEOUT + 600_000);

  it(`${ac(2)} switching looks takes under 100 ms: each run's slowest switch over every ordered pair of art@1 looks`, async () => {
    requireGpu();
    const report = record(SWITCH);
    const problems: string[] = [];
    if (report.body['fixture'] !== SCENE_REL) problems.push(`the switches play ${show(report.body['fixture'])}, not ${SCENE_REL}`);
    const slowest = arr(report.body['runs'], 'runs').map((r, i) => {
      const samples = arr(obj(r, `run ${i + 1}`)['samples'], `run ${i + 1}: samples`).map((s, k) => obj(s, `run ${i + 1}: samples[${k}]`));
      const seen = new Set(samples.map((s) => `${String(s['from'])}>${String(s['to'])}`));
      const missing = LOOKS.flatMap((a) => LOOKS.filter((b) => b !== a && !seen.has(`${a}>${b}`)).map((b) => `${a}>${b}`));
      if (missing.length) problems.push(`run ${i + 1} doesn't switch ${missing.length} ordered pairs, among them ${missing.slice(0, 4).join(', ')}`);
      const ms = samples.map((s, k) => num(s['ms'], `run ${i + 1}: samples[${k}].ms`));
      if (ms.some((m) => !(m > 0))) problems.push(`run ${i + 1} has a switch that took no time`);
      return Math.max(...ms);
    });
    none(problems, 'the art-switch report');
    await judge(`${ac(2)} the slowest switch between art@1 looks (ms)`, SWITCH.targets.switch_ms, slowest, report);
  }, BENCH_TIMEOUT + 600_000);
});
