// AC14 #157.d2250c69: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the fidelity
// decode runs at least 8x real time at 1080p60, so a delivery meets #231's 2x, and the color probe takes under 1 s"
//
// Split as #501's and #154's budget suites are: the merge-base comparison is the perf lane's (benchmarks/budgets.json
// has a task whose reason names this criterion's ID, valid against the merge base's budgets, so the preflight compares
// this change's timing with the merge base's on the same work); the issue's limits are judged here by the repo's
// `judgeLimit`, five runs after a warm-up, counted only on a reference Mac on mains power with Low Power Mode off and
// the thermal state nominal, and INCONCLUSIVE anywhere else, never a pass. Each run is a fresh `deep-show run` that
// exports the 10 s fixture film at 1920 × 1080 and 60 fps (600 frames, each different) as H.264 with AAC; the receipt
// times its fidelity decode (`fidelity.decode_seconds`, the decode of the delivery in its fresh decode worker) and its
// colour probe (`color_probe.seconds`). 8x real time on 10 s is 1.25 s. #231's 2x for the whole delivery is #231's
// budget and isn't judged here.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, H264_AAC, REPO, TIMEOUT, exportCall, filmDoc, filmRun, inconclusive, isObject, obj, receiptOf, referenceMacProblem, show, useShow, useTemp,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const SECONDS = 10;

interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
const benchmark = () => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;

/** One run: the 10 s 1080p60 film exported; the receipt's fidelity decode and colour probe times, in seconds. */
function once(): { decode: number; probe: number } {
  const evidence = temp(); const dir = temp();
  const [reply] = filmRun(shows.bin(FULL), evidence, filmDoc(evidence, { frames: SECONDS * 60, size: [1920, 1080], rate: [60, 1] }), [exportCall({ out: join(dir, 'film.mp4'), ...H264_AAC })], 'the 10 s 1080p60 film');
  const r = receiptOf(reply!, 'the 10 s 1080p60 film').raw;
  const decode = obj(r['fidelity'], 'receipt.fidelity')['decode_seconds'];
  const probe = isObject(r['color_probe']) ? r['color_probe']['seconds'] : undefined;
  expect(typeof decode === 'number' && typeof probe === 'number', `the receipt times the fidelity decode and the colour probe in seconds: ${show(decode ?? null)}, ${show(probe ?? null)}`).toBe(true);
  return { decode: decode as number, probe: probe as number };
}
async function judged(what: string, limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads });
  const reading = `${what}: ${runs.map((r) => r.toFixed(3)).join(', ')} s against ${limit} s on ${String(machine['model'])} macOS ${String(machine['macosBuild'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`${AC[14]} ${reading}`);
  expect(result.status, reading).not.toBe('BLOCKED');
  expect(result.status, reading).not.toBe('FAIL');
  if (result.status === 'INCONCLUSIVE') inconclusive(reading);
}

describe(`${AC[14]} budgets: the fidelity decode at 8x real time at 1080p60, the colour probe under 1 s`, () => {
  it(`${AC[14]} the perf lane has a task whose reason names #157.d2250c69, and the budgets are valid against the merge base's`, async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; initialReason?: string; changeReason?: string }[] };
    expect(current.tasks.some((t) => /#157\.d2250c69\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`)), 'benchmarks/budgets.json has a task whose reason names #157.d2250c69').toBe(true);
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  }, TIMEOUT);

  it(`${AC[14]} on the reference Mac the fidelity decode of a 10 s 1080p60 delivery takes at most 1.25 s and the colour probe under 1 s (five runs after a warm-up)`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the budgets count only on a reference Mac in a fit state, so the runs aren't made here: ${problem}`);
    once();
    const decode: number[] = []; const probe: number[] = []; const loads: { start: number; end: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const start = loadavg()[0]!;
      const r = once();
      decode.push(r.decode); probe.push(r.probe); loads.push({ start, end: loadavg()[0]! });
    }
    await judged('the fidelity decode of a 10 s 1080p60 delivery', SECONDS / 8, decode, loads);
    await judged('the colour probe', 1, probe, loads);
  }, TIMEOUT);
});
