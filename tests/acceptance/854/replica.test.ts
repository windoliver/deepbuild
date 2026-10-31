// #854.0393e70f: A replica reaches its first settled frame in 300 ms from spawn; a planted replica that compiles
// its pipelines on the first frame fails, naming the pipelines.
//
// The perf-lane task `replica-cold-start` (`node benchmarks/canvas.mjs replica-cold-start`) spawns a replica, a
// release build, on a fixture document, and times each run from the spawn to the replica's first settled frame,
// listing the pipelines the fixture draws with and whether each was compiled on that first frame (README: The
// surface under test). Five runs after warm-up, judged by the design's rule on a reference Mac only. The planted
// replica is `--planted compiles_on_first_frame`. The wrong programs: the base (no task, a replica of the app
// shell's views only); a replica that compiles its pipelines on the first frame; a judge that never fails, or
// fails without naming the pipelines.
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO, TASKS, arr, commonRuns, judgeWithin, judged, laneVerdict, num, obj, record, referenceMacProblem, requireMac, str, synthetic,
  targetOf, type JsonObject, type Recorded,
} from './helpers.ts';

const ID = '#854.0393e70f';
const RELEASE = '#854.926cdce7';
const TASK = TASKS.replica;
const LIMIT = TASK.targets.first_settled_ms;

interface Run { ms: number; pipelines: { name: string; on_first_frame: boolean }[] }

function runsOf(report: JsonObject, what: string): Run[] {
  const runs = commonRuns(report, what);
  const fixture = str(report['fixture'], `${what}: fixture`);
  expect(existsSync(isAbsolute(fixture) ? fixture : join(REPO, fixture)), `${what}: the replica opens a fixture file in the checkout: ${fixture}`).toBe(true);
  return runs.map((run, r) => {
    const at = `${what}: run ${r + 1}`;
    const pipelines = arr(run['pipelines'], `${at}: pipelines`).map((p, k) => {
      const o = obj(p, `${at}: pipelines[${k}]`);
      expect(typeof o['on_first_frame'], `${at}: pipelines[${k}].on_first_frame is a boolean`).toBe('boolean');
      return { name: str(o['name'], `${at}: pipelines[${k}].name`), on_first_frame: o['on_first_frame'] as boolean };
    });
    expect(pipelines.length, `${at}: the fixture draws with at least one pipeline, listed`).toBeGreaterThan(0);
    expect(new Set(pipelines.map((p) => p.name)).size, `${at}: each pipeline is listed once`).toBe(pipelines.length);
    const ms = num(run['ms'], `${at}: ms`);
    expect(ms, `${at}: a time from spawn to the first settled frame`).toBeGreaterThan(0);
    return { ms, pipelines };
  });
}
const onFirst = (runs: Run[]): string[] => [...new Set(runs.flatMap((r) => r.pipelines.filter((p) => p.on_first_frame).map((p) => p.name)))];

let shipped: Recorded | undefined;
const shippedRuns = (): Run[] => runsOf((shipped ??= record('replica')).report, TASK.id);

describe(`${ID} a replica reaches its first settled frame in 300 ms from spawn; a planted replica that compiles its pipelines on the first frame fails, naming the pipelines`, () => {
  it(`${ID} ${RELEASE} the task spawns a release-built replica on a fixture document, five runs, each timed from spawn to its first settled frame, and lists the fixture's pipelines, none of them compiled on that first frame`, (ctx) => {
    requireMac(ctx);
    const runs = shippedRuns();
    expect(onFirst(runs), 'the shipped replica compiles no pipeline on its first frame').toEqual([]);
    console.log(`${ID} spawn to first settled frame: ${runs.map((r) => r.ms.toFixed(1)).join(', ')} ms; pipelines ${runs[0]!.pipelines.map((p) => p.name).join(', ')}`);
  }, 3_600_000);

  it(`${ID} on the reference Mac every run reaches its first settled frame within 300 ms of spawn, and the lane's judge passes the task on those same runs`, (ctx) => {
    const problem = referenceMacProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const runs = shippedRuns();
    judgeWithin(ctx, `${TASK.id} ms`, runs.map((r) => r.ms), LIMIT);
    const verdict = judged(shipped!.report);
    const target = targetOf(verdict, 'first_settled_ms');
    expect(target.limit, 'the judge holds the task to 300 ms').toBe(LIMIT);
    target.runs.forEach((v, i) => expect(v, `the judge judges run ${i + 1}'s time`).toBeCloseTo(runs[i]!.ms, 3));
    laneVerdict(ctx, verdict, 'PASS');
  }, 3_600_000);

  it(`${ID} the lane's judge fails a reading past 300 ms in all five runs, naming the pipelines its first frames compiled, and passes its twin within 300 ms`, () => {
    const within = judged(synthetic('replica'));
    expect(within['status'], `a reading within 300 ms on a reference Mac passes: ${JSON.stringify(within).slice(0, 1500)}`).toBe('PASS');
    const report = synthetic('replica');
    report['runs'] = Array.from({ length: 5 }, (_, i) => ({ ms: 700 + i, pipelines: [{ name: 'marks2d.fill', on_first_frame: true }, { name: 'text.glyphs', on_first_frame: true }, { name: 'look.status', on_first_frame: false }] }));
    const verdict = judged(report);
    expect(verdict['status'], `700 ms in every run fails: ${JSON.stringify(verdict).slice(0, 1500)}`).toBe('FAIL');
    const reason = str(verdict['reason'], 'verdict.reason');
    expect(['marks2d.fill', 'text.glyphs'].filter((n) => !reason.includes(n)), `the failure names the pipelines compiled on the first frame: ${reason.slice(0, 1500)}`).toEqual([]);
  }, 600_000);
});
