// #379.7cc48ffe: for each budget class's fixture, the perf lane records three timings on the reference Mac
// with its environment fingerprint: cold, a fresh process opening the fixture to its first settled frame;
// warm, frame times judged against the class; and the authoring loop, once for a patch that moves the Q3 bar
// from 44 to 48 and once for one that adds a mark kind the chart didn't use, and so a new pipeline, each to
// its settled frame. Warm frames pass or fail against the class, while cold and authoring-loop timings are
// kept as readings beside the merge base's and never fail a change. A lane that records warm frames only, or
// one that fails a change on a cold reading, fails this test, naming the class.
//
// The perf lane is `benchmarks/budgets.json`'s tasks run by `scripts/perf.mjs`; each class's task runs
// `node benchmarks/canvas.mjs class <class>`, which prints its report as its last stdout line, and
// `node benchmarks/canvas.mjs judge` judges a report beside the merge base's (README: The perf lane). The
// planted lanes are `class <class> --planted warm_only` and `judge --planted fails_on_cold`. Recording counts
// only on a reference Mac: elsewhere INCONCLUSIVE.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLASSES, CLASS_LIMITS, REPO, arr, isObject, machineModel, num, obj, requireReferenceMac, str, type BudgetClass, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = '#379.7cc48ffe';
const BENCH = join(REPO, 'benchmarks', 'canvas.mjs');
const taskId = (c: BudgetClass): string => `canvas-class-${c.replace(/_/g, '-')}`;

function bench(args: string[], input?: JsonValue): { status: number | null; last: JsonValue | null; stderr: string } {
  const r = spawnSync(process.execPath, [BENCH, ...args], { cwd: REPO, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 256 * 1024 * 1024, ...(input === undefined ? {} : { input: `${JSON.stringify(input)}\n` }) });
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
  let last: JsonValue | null = null;
  try { last = lines.length ? (JSON.parse(lines.at(-1)!) as JsonValue) : null; } catch { last = null; }
  return { status: r.status, last, stderr: r.stderr ?? '' };
}

/** What the criterion asks a class's report to hold: every problem names the class. */
function reportProblems(c: BudgetClass, report: JsonValue | null): string[] {
  if (!isObject(report)) return [`${c}: no report`];
  const out: string[] = [];
  if (report['class'] !== c) out.push(`${c}: the report is for ${JSON.stringify(report['class'])}`);
  const fp = report['fingerprint'];
  if (!isObject(fp) || fp['model'] !== machineModel() || typeof fp['chip'] !== 'string' || typeof fp['macosBuild'] !== 'string') out.push(`${c}: the report doesn't carry this Mac's environment fingerprint: ${JSON.stringify(fp)}`);
  const cold = report['cold'];
  if (!isObject(cold) || !(typeof cold['ms'] === 'number' && cold['ms'] > 0)) out.push(`${c}: no cold timing (a fresh process to its first settled frame)`);
  const warm = report['warm'];
  if (!isObject(warm) || !Array.isArray(warm['runs']) || warm['runs'].length !== 5) out.push(`${c}: no warm frame times in five runs`);
  else {
    const limits = warm['limits'];
    const want = CLASS_LIMITS[c];
    if (!isObject(limits) || limits['gpu_ms'] !== want.gpu_ms || limits['cpu_ms'] !== want.cpu_ms) out.push(`${c}: warm frames aren't judged against the class's limits ${JSON.stringify(want)}: ${JSON.stringify(limits)}`);
    for (const [i, r] of warm['runs'].entries()) {
      if (!isObject(r) || typeof r['frames'] !== 'number' || r['frames'] < 300 || typeof r['gpu_p95_ms'] !== 'number' || typeof r['cpu_p95_ms'] !== 'number') out.push(`${c}: warm run ${i + 1} isn't a p95 of GPU and CPU frame times over at least 300 frames: ${JSON.stringify(r)}`);
    }
  }
  const authoring = report['authoring'];
  const entry = (patch: string): JsonObject | undefined => (Array.isArray(authoring) ? authoring.find((a) => isObject(a) && a['patch'] === patch) as JsonObject | undefined : undefined);
  const values = entry('values');
  const pipeline = entry('pipeline');
  if (!values || typeof values['ms'] !== 'number' || values['pipelines'] !== 0) out.push(`${c}: no authoring-loop timing for the patch that moves the Q3 bar from 44 to 48 (values only, no new pipeline): ${JSON.stringify(values)}`);
  if (!pipeline || typeof pipeline['ms'] !== 'number' || typeof pipeline['pipelines'] !== 'number' || pipeline['pipelines'] < 1) out.push(`${c}: no authoring-loop timing for the patch that adds a mark kind, with its new pipeline: ${JSON.stringify(pipeline)}`);
  const fixture = report['fixture'];
  if (typeof fixture !== 'string' || !existsSync(isAbsolute(fixture) ? fixture : join(REPO, fixture))) out.push(`${c}: the report names no fixture file in the checkout: ${JSON.stringify(fixture)}`);
  return out;
}

/** A synthetic report as the lane records it, on a reference Mac's fingerprint. */
function report(c: BudgetClass, warmMs: { gpu: number; cpu: number }, coldMs: number, authoringMs: number): JsonObject {
  return {
    class: c, fixture: `benchmarks/canvas/${c}.json`,
    fingerprint: { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '25A354' },
    cold: { ms: coldMs },
    warm: { limits: CLASS_LIMITS[c] as unknown as JsonObject, runs: Array.from({ length: 5 }, () => ({ frames: 600, gpu_p95_ms: warmMs.gpu, cpu_p95_ms: warmMs.cpu })) },
    authoring: [{ patch: 'values', ms: authoringMs, pipelines: 0 }, { patch: 'pipeline', ms: authoringMs * 4, pipelines: 1 }],
  };
}
function judged(current: JsonObject, base: JsonObject, planted?: 'fails_on_cold'): JsonObject {
  const r = bench(['judge', ...(planted ? ['--planted', planted] : [])], { current, base });
  expect(r.status, `canvas.mjs judge exits 0: ${r.stderr.slice(-1500)}`).toBe(0);
  return obj(r.last ?? undefined, 'the judge\'s verdict (its last stdout line)');
}
/** The criterion's rule on one verdict: a change with warm frames within the class must not fail, whatever its cold reading; failures name the class. */
function judgeProblems(c: BudgetClass, verdict: JsonObject): string[] {
  const out: string[] = [];
  if (verdict['status'] === 'FAIL') out.push(`${c}: the lane failed a change whose warm frames are within the class (${JSON.stringify(verdict).slice(0, 400)})`);
  const readings = isObject(verdict['readings']) ? verdict['readings'] : {};
  const cold = readings['cold'];
  if (!isObject(cold) || typeof cold['current_ms'] !== 'number' || typeof cold['base_ms'] !== 'number') out.push(`${c}: the cold reading isn't kept beside the merge base's`);
  if (!Array.isArray(readings['authoring']) || readings['authoring'].length !== 2) out.push(`${c}: the authoring-loop readings aren't kept beside the merge base's`);
  return out;
}

describe(`${ID} the perf lane records cold, warm and the authoring loop for each budget class`, () => {
  it(`${ID} budgets.json has a task per budget class that runs its fixture's bench, valid against the merge base's budgets`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    for (const c of CLASSES) {
      const task = current.tasks.find((t) => t.id === taskId(c));
      expect(task, `${c}: budgets.json has the task ${taskId(c)}`).toBeDefined();
      expect(task!.command, `${c}: its task runs the class's bench`).toEqual(['node', 'benchmarks/canvas.mjs', 'class', c]);
      expect(String(task!.initialReason), `${c}: its task says why, naming #379`).toMatch(/#379/);
    }
  });

  it(`${ID} each class's fixture records three timings on this reference Mac with its fingerprint: cold, warm against the class, and both authoring patches`, () => {
    requireReferenceMac();
    const cargo = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-gpu', '--bin', 'deep-show'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(cargo.status, `the binaries the bench drives build: ${cargo.stderr.slice(-2000)}`).toBe(0);
    for (const c of CLASSES) {
      const r = bench(['class', c]);
      expect(r.status, `${c}: canvas.mjs class ${c} exits 0: ${r.stderr.slice(-1500)}`).toBe(0);
      console.log(`${c}: ${JSON.stringify(r.last)}`);
      expect(reportProblems(c, r.last), `${c}: the report holds the three timings`).toEqual([]);
    }
  }, 3_600_000);

  it(`${ID} a planted lane that records warm frames only fails, naming the class`, () => {
    requireReferenceMac();
    const r = bench(['class', 'data_view', '--planted', 'warm_only']);
    expect(r.status, `the planted lane runs: ${r.stderr.slice(-1500)}`).toBe(0);
    const problems = reportProblems('data_view', r.last);
    expect(problems.length, 'the warm-only lane fails the check').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming the class and the missing cold timing').toMatch(/^data_view: no cold timing/m);
  }, 1_800_000);
});

describe(`${ID} warm frames pass or fail against the class; cold and authoring-loop readings never fail a change`, () => {
  it(`${ID} a change whose cold and authoring-loop readings are ten times the merge base's passes when its warm frames are within the class, the readings kept beside the base's`, () => {
    const verdict = judged(report('data_view', { gpu: 1, cpu: 1 }, 5000, 400), report('data_view', { gpu: 1, cpu: 1 }, 500, 40));
    expect(verdict['class'], 'the verdict names its class').toBe('data_view');
    expect(judgeProblems('data_view', verdict), 'never failed on a cold or authoring reading').toEqual([]);
    expect(verdict['status'], 'warm frames within the class pass').toBe('PASS');
    const cold = obj(obj(verdict['readings'], 'readings')['cold'], 'readings.cold');
    expect([num(cold['current_ms'], 'cold.current_ms'), num(cold['base_ms'], 'cold.base_ms')], 'the cold reading beside the merge base\'s').toEqual([5000, 500]);
  }, 600_000);

  it(`${ID} warm frames over the class fail, naming the class; the class decides (3 ms of CPU fails a data view and passes a figure)`, () => {
    const over = judged(report('data_view', { gpu: 3, cpu: 1 }, 500, 40), report('data_view', { gpu: 1, cpu: 1 }, 500, 40));
    expect(over['status'], `warm GPU frames at 3 ms over the data view's 2 ms fail: ${JSON.stringify(over).slice(0, 600)}`).toBe('FAIL');
    expect(JSON.stringify(over), 'the failure names the class').toContain('data_view');
    const cpuData = judged(report('data_view', { gpu: 1, cpu: 3 }, 500, 40), report('data_view', { gpu: 1, cpu: 1 }, 500, 40));
    expect(cpuData['status'], '3 ms of CPU fails a data view (2 ms)').toBe('FAIL');
    const cpuFigure = judged(report('figure', { gpu: 1, cpu: 3 }, 500, 40), report('figure', { gpu: 1, cpu: 1 }, 500, 40));
    expect(cpuFigure['status'], '3 ms of CPU passes a figure (4 ms)').toBe('PASS');
    expect(arr(obj(cpuFigure['readings'], 'readings')['authoring'], 'readings.authoring').length, 'both authoring readings are kept').toBe(2);
  }, 600_000);

  it(`${ID} a planted lane that fails a change on a cold reading fails this test, naming the class`, () => {
    const verdict = judged(report('data_view', { gpu: 1, cpu: 1 }, 5000, 400), report('data_view', { gpu: 1, cpu: 1 }, 500, 40), 'fails_on_cold');
    const problems = judgeProblems('data_view', verdict);
    expect(problems.length, 'the planted judge fails the check').toBeGreaterThan(0);
    expect(problems[0], 'naming the class').toMatch(/^data_view: the lane failed a change/);
    expect(str(verdict['status'], 'status'), 'it failed the change').toBe('FAIL');
  }, 600_000);
});
