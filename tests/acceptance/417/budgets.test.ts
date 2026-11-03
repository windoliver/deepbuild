// AC5: budgets, on the reference Mac in the local preflight, compared with the merge base: switching looks
// takes under 100 ms, and every look stays within the canvas frame budget on its fixture film.
//
// As #379 and #854 did, the budgets are perf-lane tasks in benchmarks/budgets.json, each a mode of
// benchmarks/canvas.mjs that prints one JSON report as its last stdout line (README: AC5's report); the lane
// compares each with the merge base at its 50% margin, and the entries must pass the lane's own validator
// against the merge base's budgets.json. These tests run each mode once, check its report on any Mac, and judge
// its five runs by the design's rule through scripts/benchmark.mjs's `judgeLimit`: PASS when all five are
// within the limit, FAIL when all five are over it by more than the margin, INCONCLUSIVE otherwise and on any
// machine that isn't a reference Mac (Mac15,7 or Mac15,12, Low Power Mode off, thermal state nominal), where a
// judged test skips as INCONCLUSIVE and never passes by skipping. The frame budget is the fixture film's class
// in the cost model's table (canvas primitives: The cost model): fixtures/film.json is a `figure`, 2 ms of GPU
// and 4 ms of CPU a frame, at p95 over every frame of a run of at least 300. The wrong program
// `--planted stops_at_request` stops the switch's clock at the request, before the new look is on screen: the
// ground each sample reads back is then the old look's, which the measure's check catches. At the base neither
// task nor mode exists.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';
import {
  REPO, arr, distance, fixture, fixtureRel, hexColor, num, obj, shippedIds, shippedLook, shown, str, useBinaries, type JsonObject, type JsonValue,
} from './helpers.ts';

useBinaries('deep-canvas-render');

const LANE_MARGIN = 0.5;
const SWITCH = { id: 'canvas-look-switch', mode: 'look-switch', targets: { switch_ms: 100 } };
/** The cost model's frame limits by budget class, GPU and CPU ms a frame (canvas primitives: The cost model). */
const CLASS_LIMITS: Record<string, { gpu: number; cpu: number }> = {
  core_view: { gpu: 1, cpu: 2 }, data_view: { gpu: 2, cpu: 2 }, figure: { gpu: 2, cpu: 4 }, work_product: { gpu: 2, cpu: 4 }, showpiece: { gpu: 10, cpu: 4 },
};
const FILM_CLASS = str(fixture('film.json')['profile'], 'film.json: profile');
const FRAMES = { id: 'canvas-look-frames', mode: 'look-frames', targets: { frame_gpu_p95_ms: CLASS_LIMITS[FILM_CLASS]!.gpu, frame_cpu_p95_ms: CLASS_LIMITS[FILM_CLASS]!.cpu } };

interface Judged { status: string; limit: number; runs: number[]; reason?: string }
type JudgeLimit = (args: { limit: number; runs: number[]; fingerprint: JsonValue }) => Judged;
const judgeLimit = async (): Promise<JudgeLimit> => ((await import(join(REPO, 'scripts/benchmark.mjs'))) as { judgeLimit: JudgeLimit }).judgeLimit;

function judge(ctx: TestContext, name: string, verdict: Judged): void {
  const line = `${name}: ${verdict.status} ${verdict.runs.map((r) => r.toFixed(3)).join(', ')} against ${verdict.limit}${verdict.reason ? ` (${verdict.reason})` : ''}`;
  console.log(line);
  expect(['PASS', 'INCONCLUSIVE'], `FAIL or BLOCKED: ${line}`).toContain(verdict.status);
  if (verdict.status === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${line}`);
}

const reports = new Map<string, JsonObject>();
/** `node benchmarks/canvas.mjs <mode> [--planted <name>]`: exits 0 and prints its report, naming its task, as the last stdout line. */
function record(task: { id: string; mode: string }, planted?: string): JsonObject {
  const key = `${task.mode} ${planted ?? ''}`;
  if (reports.has(key)) return reports.get(key)!;
  const args = ['benchmarks/canvas.mjs', task.mode, ...(planted ? ['--planted', planted] : [])];
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', timeout: 3_600_000, killSignal: 'SIGKILL', maxBuffer: 512 * 1024 * 1024 });
  expect(r.error, `node ${args.join(' ')} ran: ${r.error?.message}`).toBeUndefined();
  expect(r.status, `node ${args.join(' ')} exits 0; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
  let last: JsonValue = null;
  try { last = lines.length ? (JSON.parse(lines.at(-1)!) as JsonValue) : null; } catch { last = null; }
  const report = obj(last ?? undefined, `node ${args.join(' ')}: its report (the last stdout line)`);
  expect(report['task'], 'the report names its budgets.json task').toBe(task.id);
  const fp = obj(report['fingerprint'], 'report: fingerprint');
  expect(obj(fp['build'], 'fingerprint.build')['profile'], 'the timed binaries are a release build').toBe('release');
  expect(arr(report['runs'], 'report: runs').length, 'five runs after a warm-up').toBe(5);
  reports.set(key, report);
  return report;
}

interface Sample { from: string; to: string; ms: number; ground: [number, number, number, number] }
function samplesOf(run: JsonValue, i: number): Sample[] {
  return arr(obj(run, `run ${i}`)['samples'], `run ${i}: samples`).map((v, k) => {
    const s = obj(v, `run ${i} sample ${k}`);
    return { from: str(s['from'], 'from'), to: str(s['to'], 'to'), ms: num(s['ms'], 'ms'), ground: hexColor(s['ground'], `run ${i} sample ${k}: ground`) };
  });
}
/** Each way a switch report fails to time a switch to its new look on screen. */
function switchProblems(report: JsonObject): string[] {
  const ids = shippedIds();
  const out: string[] = [];
  if (report['fixture'] !== fixtureRel('film.json')) out.push(`the switches play ${shown(report['fixture'])}, not ${fixtureRel('film.json')}`);
  arr(report['runs'], 'runs').forEach((run, i) => {
    const samples = samplesOf(run, i);
    for (const from of ids) for (const to of ids) {
      if (from !== to && !samples.some((s) => s.from === from && s.to === to)) out.push(`run ${i + 1} never switches ${from} → ${to}`);
    }
    for (const s of samples) {
      if (!(s.ms > 0)) out.push(`run ${i + 1}: ${s.from} → ${s.to} took ${s.ms} ms`);
      const want = shippedLook(s.to).roles.light['ground']!;
      const was = shippedLook(s.from).roles.light['ground']!;
      const dTo = distance(s.ground, want);
      if (dTo > 0.08) out.push(`run ${i + 1}: ${s.from} → ${s.to} stopped on a frame whose ground ${shown(s.ground)} isn't ${s.to}'s (${dTo.toFixed(3)} off)`);
      else if (distance(want, was) > 0.1 && distance(s.ground, was) < dTo) out.push(`run ${i + 1}: ${s.from} → ${s.to} stopped on ${s.from}'s ground`);
    }
  });
  return out;
}

const p95 = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!; };
/** Per run, the worst look's p95 GPU and CPU ms a frame; with each way the report fails to time every look's film. */
function frameReadings(report: JsonObject): { gpu: number[]; cpu: number[]; problems: string[] } {
  const ids = shippedIds();
  const problems: string[] = [];
  const gpu: number[] = []; const cpu: number[] = [];
  arr(report['runs'], 'runs').forEach((run, i) => {
    const looks = obj(obj(run, `run ${i}`)['looks'], `run ${i}: looks`);
    let g = 0; let c = 0;
    for (const id of ids) {
      const entry = looks[id];
      if (!entry) { problems.push(`run ${i + 1} doesn't play ${id}`); continue; }
      const look = obj(entry, `run ${i}.looks.${id}`);
      if (look['fixture'] !== fixtureRel(`looks/${id}.json`)) problems.push(`run ${i + 1}: ${id} plays ${shown(look['fixture'])}, not its fixture film ${fixtureRel(`looks/${id}.json`)}`);
      const frames = arr(look['frames'], `run ${i}.looks.${id}.frames`).map((f, k) => {
        const fr = obj(f, `frame ${k}`);
        return { gpu: num(fr['gpu_ms'], `${id} frame ${k}: gpu_ms`), cpu: num(fr['cpu_ms'], `${id} frame ${k}: cpu_ms`) };
      });
      if (frames.length < 300) problems.push(`run ${i + 1}: ${id} times ${frames.length} frames, not at least 300`);
      if (frames.some((f) => !(f.gpu > 0) || !(f.cpu > 0))) problems.push(`run ${i + 1}: ${id} has a frame that took no GPU or CPU time, so it wasn't drawn`);
      g = Math.max(g, p95(frames.map((f) => f.gpu)));
      c = Math.max(c, p95(frames.map((f) => f.cpu)));
    }
    gpu.push(g); cpu.push(c);
  });
  return { gpu, cpu, problems };
}

describe('#417 AC5 budgets on the reference Mac, compared with the merge base: a look switch under 100 ms, every look within the frame budget on its fixture film', () => {
  it('AC5 budgets.json has canvas-look-switch and canvas-look-frames, each with the issue\'s targets, the lane\'s 50% margin against the merge base, and passes the lane\'s validator against the merge base\'s budgets', async () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    for (const task of [SWITCH, FRAMES]) {
      const entry = current.tasks.find((t) => t['id'] === task.id);
      expect(entry, `budgets.json has the task ${task.id}`).toBeDefined();
      expect(entry!['command'], `${task.id} runs its mode of the canvas bench`).toEqual(['node', 'benchmarks/canvas.mjs', task.mode]);
      expect(entry!['targets'], `${task.id} holds the issue's numbers`).toEqual(task.targets);
      expect(entry!['margin'], `${task.id} compares with the merge base at the lane's margin`).toBe(LANE_MARGIN);
      expect(String(entry!['initialReason']), `${task.id} says why, naming #417`).toMatch(/#417/);
    }
  }, 120_000);

  it('AC5 look-switch times every switch between shipped looks on the fixture film until the new look is on screen', () => {
    expect(switchProblems(record(SWITCH))).toEqual([]);
  }, 3_600_000);

  it('AC5 the measure sees the new look: a clock that stops at the request (planted stops_at_request) fails the check above', () => {
    const found = switchProblems(record(SWITCH, 'stops_at_request'));
    expect(found.some((p) => /stopped on/.test(p)), `the planted clock is caught: ${found.slice(0, 5).join(' | ')}`).toBe(true);
  }, 3_600_000);

  it('AC5 switching looks takes under 100 ms: each run\'s slowest switch, in five runs', async (ctx) => {
    const report = record(SWITCH);
    const worst = arr(report['runs'], 'runs').map((run, i) => Math.max(...samplesOf(run, i).map((s) => s.ms)));
    judge(ctx, '#417 AC5 slowest look switch (ms)', (await judgeLimit())({ limit: SWITCH.targets.switch_ms, runs: worst, fingerprint: report['fingerprint']! }));
  }, 3_600_000);

  it('AC5 look-frames plays each shipped look\'s fixture film for at least 300 frames, every frame drawn and timed', () => {
    expect(frameReadings(record(FRAMES)).problems).toEqual([]);
  }, 3_600_000);

  it(`AC5 every look stays within the ${FILM_CLASS} class's frame budget on its fixture film: p95 GPU and CPU ms a frame, worst look per run, in five runs`, async (ctx) => {
    const report = record(FRAMES);
    const { gpu, cpu } = frameReadings(report);
    const limit = await judgeLimit();
    const g = limit({ limit: FRAMES.targets.frame_gpu_p95_ms, runs: gpu, fingerprint: report['fingerprint']! });
    const c = limit({ limit: FRAMES.targets.frame_cpu_p95_ms, runs: cpu, fingerprint: report['fingerprint']! });
    console.log(`#417 AC5 frame GPU p95: ${g.status}; CPU p95: ${c.status}`);
    expect(['PASS', 'INCONCLUSIVE'], `GPU: ${shown(g)}`).toContain(g.status);
    judge(ctx, '#417 AC5 worst look\'s p95 frame CPU (ms)', c);
    judge(ctx, '#417 AC5 worst look\'s p95 frame GPU (ms)', g);
  }, 3_600_000);
});
