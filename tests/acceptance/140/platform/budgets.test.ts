// #140.18: budgets, on the reference Mac in the local preflight, compared with the merge base: the seams add under 1%
// to the canvas budget fixtures' frame time, and the conformance suites run in under 3 minutes.
//
// - The conformance suites: every seam's suite runs from one command, `node scripts/seams.mjs`, which the local
//   preflight runs as the lane `seams` in scripts/lanes.mjs's `checks`, and whose last stdout line is the map
//   `{"conformance": {seam → {suite, status, backend}}}` over the issue's thirteen seams (README: The surface under
//   test). The merge-base comparison is the perf lane's: a task `seam-suites` in benchmarks/budgets.json running that
//   command, valid against the merge base's budgets (as #105's and #401's budgets are). The issue's 3 minutes is
//   judged by the design's rule on five timed runs after a warm-up one.
// - The frame time: each budget class's fixture as the perf lane records it (`node benchmarks/canvas.mjs class
//   <class>`, #379: five warm runs of 300 frames, each run's p95 GPU and CPU frame time), on this checkout and on its
//   merge base, exported with `git archive` and built apart. Each warm run here must be within 1% of the merge base's
//   median for that class and measure, judged by the design's rule. The frames go through the seams only once the
//   seams exist, so a report must name the GPU seam's backend (`backends.gpu: {name, version}`, the scope's "whose
//   name and version enter every result it feeds"); at the base the reports name none.
// Off a reference Mac (Mac15,7 or Mac15,12, on mains power, Low Power Mode off, thermal state nominal) or with the
// machine loaded past its core count, the timings are readings and the tests skip as INCONCLUSIVE after their
// structural checks; none passes by skipping.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO, arr, backendOf, buildBins, environmentProblem, isObject, judgeRuns, lanes, lastJson, median, num, obj, runCommand, settle, str,
  type JsonValue, type Judged, type Lane,
} from './helpers.ts';

const node = process.execPath;
const SEAMS = ['gpu', 'surface', 'display', 'fonts', 'accessibility', 'input', 'color', 'codecs', 'audio', 'capture', 'cpu', 'headless', 'network'] as const;
const SUITES_LIMIT_MS = 3 * 60_000;
const LANE = 'seams';
const SCRIPT = 'scripts/seams.mjs';
const TASK = 'seam-suites';
const CLASSES = ['core_view', 'data_view', 'figure', 'work_product', 'showpiece', 'export'] as const;
const FRAME_SHARE = 0.01;

// ---------------------------------------------------------------------------------------------------
// The conformance suites

describe('#140.18 the conformance suites run in under 3 minutes, in the local preflight, compared with the merge base', () => {
  it('#140.18 the perf lane has a task seam-suites running node scripts/seams.mjs, a #140 first measurement, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => t.id === TASK);
    expect(task, `budgets.json has a task ${TASK}`).toBeDefined();
    expect(task!.command, `${TASK} runs every seam's suite`).toEqual(['node', SCRIPT]);
    expect(String(task!.initialReason), `${TASK} says why, naming issue #140`).toMatch(/#140/);
  });

  it('#140.18 the lane seams runs every seam\'s conformance suite and passes; five timed runs after a warm-up each finish in under 3 minutes on the reference Mac', async (ctx) => {
    const checks: Lane[] = await lanes();
    const lane = checks.find((l) => l.name === LANE);
    expect(lane, `scripts/lanes.mjs has a lane named ${LANE} in checks (the local preflight)`).toBeDefined();
    expect(lane!.commands, `the ${LANE} lane runs node ${SCRIPT}`).toEqual([[node, SCRIPT]]);
    // The warm-up run, which also builds what the suites drive: it must pass and cover every seam.
    const warm = runCommand([node, SCRIPT], REPO, 3_600_000);
    expect(warm.status, `node ${SCRIPT} exits 0\nstdout: ${warm.stdout.slice(-3000)}\nstderr: ${warm.stderr.slice(-3000)}`).toBe(0);
    const map = obj(obj(lastJson(warm.stdout) ?? undefined, `node ${SCRIPT}: its last stdout line`)['conformance'], `node ${SCRIPT}: conformance`);
    for (const seam of SEAMS) {
      const entry = obj(map[seam], `conformance.${seam} (every seam has its suite)`);
      expect(str(entry['suite'], `conformance.${seam}.suite`).length, `${seam}'s suite is named`).toBeGreaterThan(0);
      str(entry['status'], `conformance.${seam}.status`);
    }
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = runCommand([node, SCRIPT], REPO, 3_600_000);
      expect(r.status, `timed run ${i + 1}: node ${SCRIPT} exits 0\n${r.stderr.slice(-2000)}`).toBe(0);
      times.push(r.ms);
    }
    settle(ctx, [judgeRuns('#140.18 every seam\'s conformance suite, wall time (ms)', times, SUITES_LIMIT_MS)]);
  }, 7_200_000);
});

// ---------------------------------------------------------------------------------------------------
// The seams' share of the canvas budget fixtures' frame time

interface Warm { gpu: number[]; cpu: number[] }
/** One class's record by the perf lane's bench in `root`: its report, failing the test when it doesn't run. */
function classReport(root: string, cls: string, what: string): { warm: Warm; report: JsonValue } {
  const r = runCommand([node, join(root, 'benchmarks', 'canvas.mjs'), 'class', cls], root, 3_600_000);
  expect(r.status, `${what}: node benchmarks/canvas.mjs class ${cls} exits 0\n${r.stderr.slice(-2000)}`).toBe(0);
  const report = lastJson(r.stdout);
  const warm = obj(obj(report ?? undefined, `${what}: the ${cls} report`)['warm'], `${what}: ${cls}: warm`);
  const runs = arr(warm['runs'], `${what}: ${cls}: warm.runs`).map((x, i) => obj(x, `${what}: ${cls}: warm.runs[${i}]`));
  expect(runs.length, `${what}: ${cls}: five warm runs`).toBe(5);
  return {
    report: report!,
    warm: { gpu: runs.map((x, i) => num(x['gpu_p95_ms'], `${what}: ${cls}: warm.runs[${i}].gpu_p95_ms`)), cpu: runs.map((x, i) => num(x['cpu_p95_ms'], `${what}: ${cls}: warm.runs[${i}].cpu_p95_ms`)) },
  };
}

/** The merge base exported whole by `git archive` into the (git-ignored) target folder, kept between runs so its builds stay warm. */
function mergeBaseCheckout(sha: string): string {
  const dir = join(REPO, 'target', 'acceptance-140-platform-base', sha.slice(0, 12));
  const done = join(dir, '.exported');
  if (!existsSync(done)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = join(dir, '..', `${sha.slice(0, 12)}.tar`);
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(done, sha);
  }
  return dir;
}

describe('#140.18 the seams add under 1% to the canvas budget fixtures\' frame time, compared with the merge base', () => {
  it('#140.18 each budget class\'s fixture, recorded by the perf lane\'s bench on this checkout and on its merge base: every warm run\'s p95 GPU and CPU frame time within 1% of the merge base\'s, on the reference Mac', (ctx) => {
    const built = buildBins(['deep-gpu', 'deep-show']);
    expect(built, 'the binaries the bench drives build on this checkout').toBe('');
    // The frames go through the seams: the report names the GPU seam's backend that drew them.
    const first = classReport(REPO, 'core_view', 'this checkout');
    const backends = isObject(first.report) ? first.report['backends'] : undefined;
    expect(isObject(backends ?? null), `the core_view report names the backends that made it (backends: {seam → {name, version}}), got ${JSON.stringify(backends)}`).toBe(true);
    backendOf((backends as { [k: string]: JsonValue })['gpu'], 'the core_view report: backends.gpu');
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    if (base === head) ctx.skip('INCONCLUSIVE: HEAD is its own merge base, so there is nothing to compare it with');
    const baseDir = mergeBaseCheckout(base);
    expect(buildBins(['deep-gpu', 'deep-show'], [], baseDir), `the merge base ${base.slice(0, 12)}'s binaries build in ${baseDir}`).toBe('');
    const judged: Judged[] = [];
    for (const cls of CLASSES) {
      const b = classReport(baseDir, cls, `the merge base ${base.slice(0, 12)}`);
      const h = classReport(REPO, cls, 'this checkout');
      for (const key of ['gpu', 'cpu'] as const) {
        const limit = median(b.warm[key]) * (1 + FRAME_SHARE);
        judged.push(judgeRuns(`#140.18 ${cls} warm ${key} p95 (ms) against 1.01 × the merge base's median ${median(b.warm[key]).toFixed(3)}`, h.warm[key], limit));
      }
    }
    settle(ctx, judged);
  }, 14_400_000);
});
