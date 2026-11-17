// AC8 #518.b0585e2f: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the hand-off
// to the encode job adds under 5% to a 1080p60 export's time over the merge base"
//
// Split as #157's and #501's budget suites are. The preflight's part: benchmarks/budgets.json has a task whose reason
// or criteria name this criterion's ID, valid against the merge base's budgets, so the perf lane times this change's
// 1080p60 export against the merge base's on the same work from then on. The criterion's own number is judged here,
// against the merge base itself: the pinned merge base's `deep-show` (helpers.ts `useBase`) and this build's each
// export the 10 s fixture film at 1920 × 1080 and 60 fps (600 frames, each different) as H.264 with AAC, in a fresh
// `deep-show run`, timed from outside from the command to its answer. After a warm-up of each, five pairs are run,
// the side that goes first alternating, and each pair's ratio, this build's time over the merge base's, is one
// reading; the repo's `judgeLimit` judges the five against 1.05. It counts only on a reference Mac on mains power with
// Low Power Mode off, the thermal state nominal and the load at or under the core count, and is INCONCLUSIVE anywhere
// else, never a pass. The merge base is built only where the readings would count.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, H264_AAC, REPO, TIMEOUT, exportCall, filmDoc, filmScenario, inconclusive, receiptOf, referenceMacProblem, useBase, useShow, useTemp, watchShow,
  watchedFilm,
} from './helpers.ts';

const shows = useShow([FULL]);
const base = useBase(() => referenceMacProblem(true));
const temp = useTemp();
const ID = AC[8].split(' ')[1]!;
const LIMIT = 1.05;

interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
const benchmark = () => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;

/** One export of the 10 s 1080p60 fixture film as H.264 with AAC by `bin`, delivered: its wall time in seconds. */
async function once(bin: string, what: string): Promise<number> {
  const evidence = temp(); const dir = temp();
  const sc = filmScenario(evidence, filmDoc(evidence, { frames: 600, size: [1920, 1080], rate: [60, 1] }), [exportCall({ out: join(dir, 'film.mp4'), ...H264_AAC })]);
  const w = await watchShow(bin, sc);
  const [reply] = watchedFilm(w, 1, what);
  expect(receiptOf(reply!, what).frame_hashes.length, `${what}: the 10 s 1080p60 film's 600 frames are delivered`).toBe(600);
  return w.ms / 1000;
}

describe(`${AC[8]} budgets: the hand-off to the encode job adds under 5% to a 1080p60 export's time over the merge base`, () => {
  it(`${AC[8]} the perf lane has a task that names ${ID}, and the budgets are valid against the merge base's`, async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; initialReason?: string; changeReason?: string; criteria?: string[] }[] };
    const names = (t: { initialReason?: string; changeReason?: string; criteria?: string[] }): boolean => (t.criteria ?? []).includes(ID) || `${t.initialReason ?? ''} ${t.changeReason ?? ''}`.includes(ID);
    expect(current.tasks.some(names), `benchmarks/budgets.json has a task whose reason or criteria name ${ID}`).toBe(true);
    const mergeBase = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${mergeBase}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })));
  }, TIMEOUT);

  it(`${AC[8]} on the reference Mac a 10 s 1080p60 export as H.264 with AAC takes under 1.05 times the merge base's time (five pairs after a warm-up)`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the budget counts only on a reference Mac in a fit state, so neither side is timed here: ${problem}`);
    const now = shows.bin(FULL); const was = base.bin();
    await once(was, 'the merge base\'s warm-up');
    await once(now, 'this build\'s warm-up');
    const ratios: number[] = []; const loads: { start: number; end: number }[] = []; const shown: string[] = [];
    for (let i = 0; i < 5; i++) {
      const start = loadavg()[0]!;
      let here: number; let there: number;
      if (i % 2 === 0) { there = await once(was, `the merge base, pair ${i + 1}`); here = await once(now, `this build, pair ${i + 1}`); } else { here = await once(now, `this build, pair ${i + 1}`); there = await once(was, `the merge base, pair ${i + 1}`); }
      ratios.push(here / there); loads.push({ start, end: loadavg()[0]! });
      shown.push(`${here.toFixed(2)} s over ${there.toFixed(2)} s`);
    }
    const { fingerprint, judgeLimit } = await benchmark();
    const machine = fingerprint();
    const result = judgeLimit({ limit: LIMIT, runs: ratios, fingerprint: machine, loads });
    const reading = `a 10 s 1080p60 export, this build over the merge base: ${shown.join(', ')} (ratios ${ratios.map((r) => r.toFixed(3)).join(', ')} against ${LIMIT}) on ${String(machine['model'])} macOS ${String(machine['macosBuild'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
    console.log(`${AC[8]} ${reading}`);
    expect(result.status, reading).not.toBe('BLOCKED');
    expect(result.status, reading).not.toBe('FAIL');
    if (result.status === 'INCONCLUSIVE') inconclusive(reading);
  }, 2 * TIMEOUT);
});
