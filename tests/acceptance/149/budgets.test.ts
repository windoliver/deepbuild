// AC10 #149.affd8de8: Budgets, on the reference Mac in the local preflight, compared with the merge base: each family's
// fixture plays within the showpiece budget at 1080p, paper adds under 0.2 ms of GPU a frame, and a collection target
// costs no more than its declared bytes.
//
// As #379, #417 and #854 did, the timings are perf-lane tasks in benchmarks/budgets.json, each a mode of
// benchmarks/canvas.mjs printing one JSON report as its last stdout line (README: AC10's reports). The lane compares each
// with the merge base at its 50% margin; the entries must pass the lane's validator against the merge base's budgets.json.
// These tests run each mode once, check its report on any Mac, and judge its five runs by scripts/benchmark.mjs's
// `judgeLimit`: all five within the limit, all five over it by more than the margin, otherwise INCONCLUSIVE, and any
// reading off a reference Mac, or under load, is INCONCLUSIVE too, never a pass.
//
// The showpiece budget is the cost model's table: 10 ms of GPU and 4 ms of CPU a frame, at p95 over every frame of a run
// of at least 300. Paper's cost is the paper family's fixture, a run's median GPU ms with its paper less the same film
// on a flat ground. A target's bytes come from the device's own count on the `layers` call, against the bytes its
// declaration works out to: 960 × 540 × 8 for rgba16float at half 1080p, the design's "about 4 MB". That read is no
// timing, so it runs on any Mac. At the base no mode, task or target exists.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DIMS, FAMILIES, FAMILY_SIZE, REPO, answered, arr, familyFixture, fixtureRel, inconclusive, layersCall, loadPerCore, lookOf, none, num, obj, requireMetal, runGpu, shown, str, useDir,
  useGpu, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = AC[10];
const bin = useGpu();
const dir = useDir();
const LANE_MARGIN = 0.5;
const FRAMES = { id: 'canvas-drawn-frames', mode: 'drawn-frames', targets: { frame_gpu_p95_ms: 10, frame_cpu_p95_ms: 4 } };
const PAPER = { id: 'canvas-paper-cost', mode: 'paper-cost', targets: { paper_added_gpu_ms: 0.2 } };

interface Judged { status: string; limit: number; runs: number[]; reason?: string }
type JudgeLimit = (args: { limit: number; runs: number[]; fingerprint: JsonValue }) => Judged;
async function judge(name: string, limit: number, runs: number[], fingerprint: JsonValue): Promise<void> {
  const { judgeLimit } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { judgeLimit: JudgeLimit };
  const verdict = judgeLimit({ limit, runs, fingerprint });
  const line = `${name}: ${verdict.status} ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} at load ${loadPerCore().toFixed(2)} a core${verdict.reason ? ` (${verdict.reason})` : ''}`;
  console.log(line);
  if (loadPerCore() > 1) inconclusive(`under load: ${line}`);
  expect(['PASS', 'INCONCLUSIVE'], `FAIL or BLOCKED: ${line}`).toContain(verdict.status);
  if (verdict.status === 'INCONCLUSIVE') inconclusive(line);
}
const reports = new Map<string, JsonObject>();
/** `node benchmarks/canvas.mjs <mode>`: exits 0 and prints its report, naming its task, as the last stdout line. */
function record(task: { id: string; mode: string }): JsonObject {
  if (reports.has(task.mode)) return reports.get(task.mode)!;
  const args = ['benchmarks/canvas.mjs', task.mode];
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', timeout: 3_600_000, killSignal: 'SIGKILL', maxBuffer: 512 * 1024 * 1024 });
  expect(r.error, `node ${args.join(' ')} ran: ${r.error?.message}`).toBeUndefined();
  expect(r.status, `node ${args.join(' ')} exits 0; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
  let last: JsonValue = null;
  try { last = lines.length ? (JSON.parse(lines.at(-1)!) as JsonValue) : null; } catch { last = null; }
  const report = obj(last ?? undefined, `node ${args.join(' ')}: its report (the last stdout line)`);
  expect(report['task'], 'the report names its budgets.json task').toBe(task.id);
  expect(obj(obj(report['fingerprint'], 'fingerprint')['build'], 'fingerprint.build')['profile'], 'the timed binaries are a release build').toBe('release');
  expect(arr(report['runs'], 'report: runs').length, 'five runs after a warm-up').toBe(5);
  reports.set(task.mode, report);
  return report;
}
const p95 = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!; };
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
interface Timed { gpu: number[]; cpu: number[] }
function timed(v: JsonValue | undefined, what: string, problems: string[]): Timed {
  const frames = arr(obj(v, what)['frames'], `${what}: frames`).map((f, k) => obj(f, `${what} frame ${k}`));
  const gpu = frames.map((f, k) => num(f['gpu_ms'], `${what} frame ${k}: gpu_ms`));
  const cpu = frames.map((f, k) => num(f['cpu_ms'], `${what} frame ${k}: cpu_ms`));
  if (frames.length < 300) problems.push(`${what} times ${frames.length} frames, not at least 300`);
  if (gpu.some((g) => !(g > 0)) || cpu.some((c) => !(c > 0))) problems.push(`${what} has a frame that took no GPU or CPU time, so it wasn't drawn`);
  return { gpu, cpu };
}

describe(`${ID} the drawn looks' budgets`, () => {
  it(`${ID} budgets.json has both tasks, with the issue's numbers, the lane's margin against the merge base, and passes the lane's validator`, async () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    for (const task of [FRAMES, PAPER]) {
      const entry = current.tasks.find((t) => t['id'] === task.id);
      expect(entry, `budgets.json has the task ${task.id}`).toBeDefined();
      expect(entry!['command'], `${task.id} runs its mode of the canvas bench`).toEqual(['node', 'benchmarks/canvas.mjs', task.mode]);
      expect(entry!['targets'], `${task.id} holds the issue's numbers`).toEqual(task.targets);
      expect(entry!['margin'], `${task.id} compares with the merge base at the lane's margin`).toBe(LANE_MARGIN);
      expect(String(entry!['initialReason']), `${task.id} says why, naming #149`).toMatch(/#149/);
    }
  });

  it(`${ID} each family's fixture, in 2D and 3D at 1080p, plays within the showpiece budget: worst p95 per run, in five runs`, async () => {
    requireMetal();
    const report = record(FRAMES);
    const problems: string[] = [];
    const gpu: number[] = []; const cpu: number[] = [];
    arr(report['runs'], 'runs').forEach((run, i) => {
      const families = obj(obj(run, `run ${i}`)['families'], `run ${i}: families`);
      let g = 0; let c = 0;
      for (const f of FAMILIES) for (const d of DIMS) {
        const entry = obj(families[f], `run ${i}: ${f}`)[d];
        if (obj(entry, `run ${i}: ${f} ${d}`)['fixture'] !== fixtureRel(`families/${f}.json`)) problems.push(`run ${i + 1}: ${f} ${d} plays ${shown(obj(entry, 'entry')['fixture'])}`);
        if (shown(obj(entry, `run ${i}: ${f} ${d}`)['size']) !== shown([...FAMILY_SIZE])) problems.push(`run ${i + 1}: ${f} ${d} isn't drawn at 1080p`);
        const t = timed(entry, `run ${i + 1}: ${f} ${d}`, problems);
        g = Math.max(g, p95(t.gpu)); c = Math.max(c, p95(t.cpu));
      }
      gpu.push(g); cpu.push(c);
    });
    none(problems, 'the report');
    const fingerprint = report['fingerprint']!;
    await judge(`${ID} worst family's p95 frame CPU (ms)`, FRAMES.targets.frame_cpu_p95_ms, cpu, fingerprint);
    await judge(`${ID} worst family's p95 frame GPU (ms)`, FRAMES.targets.frame_gpu_p95_ms, gpu, fingerprint);
  });

  it(`${ID} paper adds under 0.2 ms of GPU a frame at 1080p, in five runs`, async () => {
    requireMetal();
    const report = record(PAPER);
    const problems: string[] = [];
    const added = arr(report['runs'], 'runs').map((run, i) => {
      const r = obj(run, `run ${i}`);
      if (r['fixture'] !== fixtureRel('families/paper.json')) problems.push(`run ${i + 1} plays ${shown(r['fixture'])}`);
      if (typeof r['paper_hash'] !== 'string' || r['paper_hash'] === r['flat_hash']) problems.push(`run ${i + 1}: the two sides drew the same pixels, so nothing was timed`);
      return median(timed(r['paper'], `run ${i + 1} with paper`, problems).gpu) - median(timed(r['flat'], `run ${i + 1} on a flat ground`, problems).gpu);
    });
    none(problems, 'the report');
    await judge(`${ID} paper's added GPU (ms a frame)`, PAPER.targets.paper_added_gpu_ms, added, report['fingerprint']!);
  });

  it(`${ID} a collection target costs no more than its declared bytes, counted on the device`, () => {
    requireMetal();
    const fixture = familyFixture('targets');
    const [reply] = runGpu(bin(), dir(), [layersCall(obj(fixture['2d'], '2d'), lookOf(fixture), { target_costs: true })]);
    answered(reply!, 'the targets fixture');
    const row = arr(reply!['target_costs'], 'target_costs').map((v) => obj(v, 'a target')).find((t) => t['collection'] === 'fish' && t['output'] === 'pressure');
    expect(row, `the reply lists the fish's pressure target: ${shown(reply!['target_costs'] ?? null)}`).toBeDefined();
    expect([row!['width'], row!['height'], str(row!['format'], 'format')], 'half 1080p in rgba16float').toEqual([960, 540, 'rgba16float']);
    const declared = 960 * 540 * 8;
    expect(num(row!['declared_bytes'], 'declared_bytes'), 'its declaration works out to width × height × 8').toBe(declared);
    const bytes = num(row!['bytes'], 'bytes');
    expect(bytes, 'the device holds it').toBeGreaterThan(0);
    expect(bytes, `the device's count, ${bytes}, is no more than the declared ${declared}`).toBeLessThanOrEqual(declared);
  });
});
