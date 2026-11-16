// #1830 AC2 on a fit reference Mac: one redrafted timing suite, #311's AC12 (validation under 20 µs at p95), run for
// real with the planted judge of twins/judge-plant/ in place of scripts/benchmark.mjs, which records every judgeLimit
// call and what the real judgeLimit returned. The redraft reads PASS with runs inside its limit and FAIL with the runs
// moved over it; with the one-minute load planted above the cores, its calls give that load and read INCONCLUSIVE,
// naming it; and the original it replaced, as the merge base runs it, reads INCONCLUSIVE, naming the load. Anywhere
// else, or when the machine stops being fit during a run, the test is skipped as INCONCLUSIVE, never passed.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type TestContext } from 'vitest';
import { benchmarkUrl, root, scratch, show, twins } from './helpers.ts';

const REDRAFT = 'tests/acceptance/311-redraft-1830/';
const ORIGINAL = 'tests/acceptance/311/redraft-ac12/';
const cores = availableParallelism();

interface Judged {
  input: { limit: number; runs: number[]; loads?: Array<{ start: number; end: number }> };
  runs: number[];
  result: { status: string; reason?: string };
}

/** Runs `folder`'s vitest files with the planted judge; `over` moves every run over its limit, `load` plants os.loadavg. */
function planted(folder: string, plant: { over?: boolean; load?: number } = {}) {
  const directory = scratch();
  const log = join(directory, 'judged.jsonl');
  const report = join(directory, 'report.json');
  const imports = [join(twins, 'judge-plant/register.mjs'), ...(plant.load === undefined ? [] : [join(twins, 'machine.mjs')])];
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
  env.NODE_OPTIONS = [process.env.NODE_OPTIONS ?? '', ...imports.map((file) => `--import=${pathToFileURL(file).href}`)].join(' ').trim();
  env.JUDGE_PLANT_LOG = log;
  if (plant.over) env.JUDGE_PLANT_OVER = '1';
  if (plant.load !== undefined) {
    env.PLANT_CORES = String(cores);
    env.PLANT_LOAD = String(plant.load);
  }
  const result = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--root', root, '--config', join(twins, 'judge-plant/vitest.config.mjs'),
    '--no-file-parallelism', '--testTimeout=3600000', '--reporter=json', `--outputFile=${report}`, folder], { cwd: root, env, encoding: 'utf8', timeout: 4 * 3_600_000, maxBuffer: 256 * 1024 * 1024 });
  const judged: Judged[] = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  const tests: { numPassedTests: number; numFailedTests: number; numPendingTests: number } | null = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
  return { result, judged, tests, output: `${show(result)}\njudged:\n${judged.map((call) => JSON.stringify(call)).join('\n')}` };
}

/** A fit reference Mac, as judgeLimit itself decides it: its fingerprint, and the load now at or below the cores. */
async function fit(): Promise<{ status: string; reason?: string }> {
  const { fingerprint, judgeLimit } = await import(benchmarkUrl);
  const load = loadavg()[0]!;
  return judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: fingerprint(), loads: Array.from({ length: 5 }, () => ({ start: load, end: load })) });
}

/**
 * Each call gives five readings of the load, one per run, at its start and end. A load above the cores, or the machine
 * judged off the reference Macs with readable loads (its thermal state or power changed), skips the test as INCONCLUSIVE.
 */
function readsLoads(ctx: TestContext, run: ReturnType<typeof planted>, what: string): void {
  expect(run.judged.length, `the redraft calls judgeLimit where the planted judge sees it, ${what}:\n${run.output}`).toBeGreaterThan(0);
  for (const { input } of run.judged) {
    expect(input.loads?.length, `each call gives one load reading per run, ${what}:\n${run.output}`).toBe(input.runs.length);
    for (const { start, end } of input.loads!) expect(Number.isFinite(start) && start >= 0 && Number.isFinite(end) && end >= 0, `a load reading at each run's start and end, ${what}:\n${run.output}`).toBe(true);
  }
  const loaded = run.judged.find(({ input }) => input.loads!.some(({ start, end }) => start > cores || end > cores));
  if (loaded) ctx.skip(`INCONCLUSIVE: the load rose above the ${cores} cores ${what}: ${JSON.stringify(loaded.input.loads)}`);
  const off = run.judged.find(({ result }) => result.status === 'INCONCLUSIVE' && /reference Macs/.test(result.reason ?? ''));
  if (off) ctx.skip(`INCONCLUSIVE: the machine left fit ${what}: ${off.result.reason}`);
}

test('AC2 #1830.c69ecf39 on a fit reference Mac, #311\'s redrafted AC12 reads PASS with runs inside its limit, FAIL with runs over it and INCONCLUSIVE at a planted load, naming it, and the original reads INCONCLUSIVE, naming the load', async (ctx) => {
  expect(existsSync(join(root, REDRAFT)), `${REDRAFT} is missing: #311's AC12 has no blind redraft`).toBe(true);
  const now = await fit();
  if (now.status !== 'PASS') ctx.skip(`INCONCLUSIVE: this test runs only on a fit reference Mac: ${now.reason}`);

  // At a planted load above the cores, every call gives that load at each run's start and end and reads INCONCLUSIVE,
  // naming it; a redraft that skips before measuring calls nothing, and then passes no test.
  const load = cores + 7.25;
  const loaded = planted(REDRAFT, { load });
  if (loaded.judged.length === 0) {
    expect(loaded.tests?.numPassedTests, `at load ${load} the redraft judged nothing, so it passes no test:\n${loaded.output}`).toBe(0);
    expect(loaded.tests?.numFailedTests, loaded.output).toBe(0);
  }
  for (const { input, result } of loaded.judged) {
    expect(input.loads?.length, `each call gives one load reading per run:\n${loaded.output}`).toBe(input.runs.length);
    for (const { start, end } of input.loads!) expect([start, end], `each reading is the one-minute load, planted at ${load}:\n${loaded.output}`).toEqual([load, load]);
    expect(result.status, loaded.output).toBe('INCONCLUSIVE');
    expect(result.reason, loaded.output).toContain(String(load));
  }

  // The original, as the merge base runs it: no loads, so INCONCLUSIVE, naming the load.
  const base = planted(ORIGINAL);
  expect(base.judged.length, `the original calls judgeLimit:\n${base.output}`).toBeGreaterThan(0);
  for (const { result } of base.judged) {
    expect(result.status, base.output).toBe('INCONCLUSIVE');
    expect(result.reason, base.output).toMatch(/load/);
  }

  // Runs moved over the limit: every call reads FAIL, and so does the suite.
  const over = planted(REDRAFT, { over: true });
  readsLoads(ctx, over, 'during the run over the limit');
  expect(over.judged.map(({ result }) => result.status), over.output).toEqual(over.judged.map(() => 'FAIL'));
  expect(over.tests?.numFailedTests, `the suite reads FAIL:\n${over.output}`).toBeGreaterThan(0);
  expect(over.result.status, over.output).not.toBe(0);

  // The redraft as it is: runs inside the limit read PASS, and the suite passes.
  const inside = planted(REDRAFT);
  readsLoads(ctx, inside, 'during the run inside the limit');
  const outside = inside.judged.find(({ runs, input }) => runs.some((run) => run > input.limit));
  if (outside) ctx.skip(`INCONCLUSIVE: a run on this Mac was over its limit, so the PASS half can't be shown: ${JSON.stringify(outside)}`);
  expect(inside.judged.map(({ result }) => result.status), inside.output).toEqual(inside.judged.map(() => 'PASS'));
  expect(inside.tests?.numFailedTests, inside.output).toBe(0);
  expect(inside.tests?.numPassedTests, inside.output).toBeGreaterThan(0);
  expect(inside.tests?.numPendingTests, `no test of the redraft skipped:\n${inside.output}`).toBe(0);
  expect(inside.result.status, inside.output).toBe(0);
}, 16 * 3_600_000);
