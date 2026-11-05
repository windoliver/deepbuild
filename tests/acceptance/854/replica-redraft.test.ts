// #854.0393e70f, blind redraft of one disputed case in replica.test.ts: "a planted replica that compiles its
// pipelines on the first frame lists them so, and on the reference Mac the lane fails it past 300 ms, naming the
// pipelines". That case is replaced by the tests below; the original's other three tests stand unchanged.
//
// The criterion's wrong program is a replica that compiles its pipelines on the first frame. Cold start counts
// every compile ("from opening the document in a fresh process to its first settled frame, its compiles … included",
// The cost model), so moving the same compiles from before the first frame into it needn't change the time from
// spawn to the settled frame; what makes it wrong is the design's rule that pipelines "compile off-screen before the
// swap, so a change never stalls a frame" (Meter and degrade ladder). So the planted replica fails on what it does,
// read from each run's `pipelines[].on_first_frame`, not on how long it took: the lane's judge fails
// `first_settled_ms` for any run whose first frame compiled a pipeline, on any machine and at any time, as it
// judges the other counts (README: The judge), and its reason names those pipelines. The 300 ms target is unchanged
// and still judged by the design's rule on a reference Mac (replica.test.ts). See REPLICA-REDRAFT.md.
//
// Wrong programs: the base (no task, no judge for it); the planted replica; a judge that never fails, that fails
// only past 300 ms, that fails without naming the pipelines, or that fails a reading with no first-frame compile.
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO, TASKS, arr, commonRuns, judged, machineReading, num, obj, record, referenceFingerprint, requireMac, str, synthetic, targetOf,
  type JsonObject, type JsonValue, type Recorded,
} from './helpers.ts';

const ID = '#854.0393e70f';
const TASK = TASKS.replica;
const LIMIT = TASK.targets.first_settled_ms;

interface Run { ms: number; pipelines: { name: string; on_first_frame: boolean }[] }

// The same reading of a report as replica.test.ts's.
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

/** A made-up run at `ms`, drawing with three pipelines, `first` of them compiled on its first frame. */
const madeUpRun = (ms: number, first: readonly string[]): JsonValue =>
  ({ ms, pipelines: ['marks2d.fill', 'text.glyphs', 'look.status'].map((name) => ({ name, on_first_frame: first.includes(name) })) });

/** The verdict fails on the cold start and its reason names each of `names`. */
function failsNaming(verdict: JsonObject, names: readonly string[], what: string): void {
  const shown = JSON.stringify(verdict).slice(0, 1500);
  expect(verdict['status'], `${what} fails: ${shown}`).toBe('FAIL');
  expect(targetOf(verdict, 'first_settled_ms').status, `${what}: the failing target is the cold start: ${shown}`).toBe('FAIL');
  const reason = str(verdict['reason'], 'verdict.reason');
  expect(names.filter((n) => !reason.includes(n)), `${what}: the failure names every pipeline compiled on the first frame: ${reason.slice(0, 1500)}`).toEqual([]);
}

let shipped: Recorded | undefined;
let planted: Recorded | undefined;
const shippedRuns = (): Run[] => runsOf((shipped ??= record('replica')).report, TASK.id);
const plantedRuns = (): Run[] => runsOf((planted ??= record('replica', true)).report, `${TASK.id} --planted ${TASK.planted}`);

describe(`${ID} a replica reaches its first settled frame in 300 ms from spawn; a planted replica that compiles its pipelines on the first frame fails, naming the pipelines (redraft)`, () => {
  it(`${ID} a planted replica that compiles its pipelines on the first frame lists them so, and the lane fails it on any machine whatever its times, on the cold start, naming the pipelines`, (ctx) => {
    requireMac(ctx);
    const runs = plantedRuns();
    const names = new Set(shippedRuns()[0]!.pipelines.map((p) => p.name));
    runs.forEach((run, r) => expect(run.pipelines.some((p) => p.on_first_frame), `run ${r + 1}: the planted replica compiles pipelines on its first frame`).toBe(true));
    const compiled = onFirst(runs);
    expect(compiled.filter((n) => !names.has(n)), 'the pipelines it compiles on the first frame are the fixture\'s, as the shipped replica lists them').toEqual([]);
    console.log(`${ID} --planted ${TASK.planted}: spawn to first settled frame ${runs.map((r) => r.ms.toFixed(1)).join(', ')} ms against ${LIMIT}; compiled on the first frame: ${compiled.join(', ')}; ${machineReading()}`);
    const verdict = judged(planted!.report);
    failsNaming(verdict, compiled, `the planted replica (${compiled.join(', ')} compiled on the first frame)`);
    const target = targetOf(verdict, 'first_settled_ms');
    expect(target.limit, 'the judge holds the task to 300 ms').toBe(LIMIT);
    target.runs.forEach((v, i) => expect(v, `the judge judges run ${i + 1}'s time`).toBeCloseTo(runs[i]!.ms, 3));
  }, 3_600_000);

  it(`${ID} the lane's judge fails a reading within 300 ms whose first frames compiled pipelines, naming them, and passes its twin whose first frames compiled none`, () => {
    const twin = synthetic('replica');
    twin['runs'] = Array.from({ length: 5 }, (_, i) => madeUpRun(150 + i, []));
    const passed = judged(twin);
    expect(passed['status'], `150 ms with no pipeline compiled on the first frame passes on a reference Mac: ${JSON.stringify(passed).slice(0, 1500)}`).toBe('PASS');
    const report = synthetic('replica');
    report['runs'] = Array.from({ length: 5 }, (_, i) => madeUpRun(150 + i, ['marks2d.fill', 'text.glyphs']));
    failsNaming(judged(report), ['marks2d.fill', 'text.glyphs'], 'the same 150 ms with marks2d.fill and text.glyphs compiled on every first frame');
  }, 600_000);

  it(`${ID} the lane's judge fails a reading in which one run's first frame compiled a pipeline, and one off the reference Macs, naming the pipeline`, () => {
    const once = synthetic('replica');
    once['runs'] = Array.from({ length: 5 }, (_, i) => madeUpRun(150 + i, i === 2 ? ['text.glyphs'] : []));
    failsNaming(judged(once), ['text.glyphs'], 'a reading whose run 3 compiled text.glyphs on its first frame');
    const elsewhere = synthetic('replica');
    elsewhere['fingerprint'] = { ...referenceFingerprint('release'), model: 'Mac16,1', chip: 'Apple M4', memoryBytes: 24 * 2 ** 30 };
    elsewhere['runs'] = Array.from({ length: 5 }, (_, i) => madeUpRun(150 + i, ['marks2d.fill', 'text.glyphs']));
    failsNaming(judged(elsewhere), ['marks2d.fill', 'text.glyphs'], 'a reading off the reference Macs whose first frames compiled marks2d.fill and text.glyphs');
  }, 600_000);
});
