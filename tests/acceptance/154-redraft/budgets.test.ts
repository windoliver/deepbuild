// AC9 #154.d6804da4: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a 60 s,
// six-stem score renders in under 60 s on the reference Mac's CPU, a cached stem costs nothing, and the job never runs
// on the UI thread"
//
// Split as other suites' budgets are (#501, #365): the merge-base comparison is the perf lane's (benchmarks/budgets.json
// has a task whose reason names #154, valid against the merge base's budgets, so the preflight compares this change's
// timing with the merge base's on the same work); the issue's limits are judged here by the repo's `judgeLimit`, five
// runs after a warm-up, counted only on a reference Mac on mains power, Low Power Mode off and the thermal state
// nominal, and INCONCLUSIVE anywhere else, never a pass.
//
// The score: 60 s of notes written in seconds, six stems (two sampled instruments of four takes, two plucked strings, a saw and a pad),
// 1,230 notes. A run plans it and renders its six stems through deep_job at once, from the first request to the last
// answer; each run gives the score another item ID, so another seed and other keys, and nothing is a cache hit. "A
// cached stem costs nothing": a stem run again answers `cache: hit` with its key and outputs, and its round trip is
// judged against 100 ms *(chosen)*. "Never on the UI thread": the canvas side (`deep-show run`, whose main thread is
// the app's UI thread) only plans: planning the score writes no audio to the store, and every stem comes from deep_job.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BELLS_FIXTURE, doneOf, inconclusive, KEYS_FIXTURE, once, plan, pluck, REPO, runStem, sampled, scoreDoc, scoreWorld, storeFiles, synth,
  TIMEOUT, useShow, type Event, type Instrument, type Plan, type World,
} from './helpers.ts';

const bin = useShow();
const KEYS = KEYS_FIXTURE();
const BELLS = BELLS_FIXTURE();
/** Times are written in seconds; a "beat" here is 0.5 s (120 BPM). */
const atBeat = (x: number): string => `${x / 2}s`;
const INSTRUMENTS: Record<string, Instrument> = {
  keys: sampled(KEYS, 'keys'), bells: sampled(BELLS, 'bells'), nylon: pluck('nylon', 'nylon'), harp: pluck('harp', 'harp'), saw: synth('saw', 'saw'), pad: synth('pad', 'pad'),
};
const RANGE: Record<string, number[]> = { keys: [65, 67, 69, 71, 72, 73], bells: [72, 74, 76, 77, 79, 80], nylon: [52, 55, 57, 59, 60, 64], harp: [60, 62, 64, 67, 69, 72], saw: [48, 50, 53, 55, 57, 60], pad: [48, 52, 55, 60] };
/** 60 s of eighth notes on five stems and a whole note a bar on the pad: 1,230 notes. */
function events(): Record<string, Event> {
  const out: Record<string, Event> = {};
  for (const inst of ['keys', 'bells', 'nylon', 'harp', 'saw']) for (let i = 0; i < 240; i++) out[`${inst}${i}`] = { at: atBeat(0.5 * i), inst, pitch: RANGE[inst]![i % 6]!, dur: '0.25s', vel: 0.5 + 0.3 * ((i * 7) % 5) / 4, attack: 0.002, release: 0.02 };
  for (let i = 0; i < 30; i++) out[`pad${i}`] = { at: atBeat(4 * i), inst: 'pad', pitch: RANGE.pad![i % 4]!, dur: '2s', vel: 0.6, attack: 0.2, release: 0.5 };
  return out;
}
const doc = (item: string) => scoreDoc({ id: 'budget', item, instruments: INSTRUMENTS, events: events(), span: '64s', packs: [KEYS, BELLS] });
const world = once(() => scoreWorld([KEYS, BELLS]));

interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;
/** One limit judged on five runs: FAIL and BLOCKED fail the test, INCONCLUSIVE fails it as INCONCLUSIVE, never a pass. */
async function judged(what: string, limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads });
  const reading = `${what}: ${runs.map((r) => r.toFixed(1)).join(', ')} ms against ${limit} ms on ${String(machine.model)} macOS ${String(machine.macosBuild)}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`${AC[9]} ${reading}`);
  expect(result.status, reading).not.toBe('BLOCKED');
  expect(result.status, reading).not.toBe('FAIL');
  if (result.status === 'INCONCLUSIVE') inconclusive(reading);
}
/** The six stems rendered at once: the wall time from the first request to the last answer, every stem done. */
async function renderAtOnce(w: World, p: Plan, what: string): Promise<number> {
  const t0 = performance.now();
  const runs = await Promise.all(Object.values(p.stems).map((s) => runStem(w, s)));
  const ms = performance.now() - t0;
  runs.forEach((r, i) => doneOf(r.outcome, r.ms, `${what}: stem ${Object.keys(p.stems)[i]}`));
  return ms;
}

describe(`${AC[9]} budgets: a 60 s six-stem score renders in under 60 s, a cached stem costs nothing, and the job never runs on the UI thread`, () => {
  it(`${AC[9]} the perf lane has a task whose reason names #154, and the budgets are valid against the merge base's`, async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; initialReason?: string; changeReason?: string }[] };
    expect(current.tasks.some((t) => /#154\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`)), 'benchmarks/budgets.json has a task whose reason names #154').toBe(true);
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  }, TIMEOUT);

  it(`${AC[9]} the canvas side only plans: planning the 60 s six-stem score writes no audio to the store, and its six stems come from deep_job`, async () => {
    const { w, dirs } = await world();
    const before = new Set(storeFiles(w.evidence));
    const p = plan(bin(), w.evidence, doc('budget0'), dirs, 'the 60 s score', 'budget0');
    expect(Object.keys(p.stems).sort(), 'six stems').toEqual(['bells', 'harp', 'keys', 'nylon', 'pad', 'saw']);
    const audio = storeFiles(w.evidence).filter((f) => !before.has(f)).filter((f) => {
      const head = readFileSync(join(w.evidence, f.slice(0, 2), f.slice(2))).subarray(0, 4).toString('latin1');
      return head === 'fLaC' || head === 'RIFF';
    });
    expect(audio, 'the canvas side wrote no audio while planning: the score renders only as a job').toEqual([]);
    await renderAtOnce(w, p, 'the 60 s score');
  }, TIMEOUT);

  it(`${AC[9]} on the reference Mac a 60 s six-stem score renders in under 60 s (five runs after a warm-up, each a fresh seed), and a cached stem's run is a cache hit in under 100 ms`, async () => {
    const { w, dirs } = await world();
    const runs: number[] = [];
    const loads: { start: number; end: number }[] = [];
    let last: Plan | undefined;
    for (let r = 1; r <= 6; r++) {
      last = plan(bin(), w.evidence, doc(`budget${r}`), dirs, `run ${r}`, `budget${r}`);
      const start = loadavg()[0]!;
      const ms = await renderAtOnce(w, last, `run ${r}`);
      if (r > 1) { runs.push(ms); loads.push({ start, end: loadavg()[0]! }); }
    }
    const keys = last!.stems.keys!;
    const first = doneOf((await runStem(w, keys)).outcome, 0, 'the keys stem again');
    const hits: number[] = [];
    const hitLoads: { start: number; end: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const start = loadavg()[0]!;
      const { outcome, ms } = await runStem(w, keys);
      const hit = doneOf(outcome, ms, `the cached keys stem, run ${i + 1}`);
      expect({ cache: hit.cache, key: hit.key, stem: hit.stem, meta: hit.meta }, 'a cached stem answers from the cache with its key and outputs').toEqual({ cache: 'hit', key: first.key, stem: first.stem, meta: first.meta });
      hits.push(ms);
      hitLoads.push({ start, end: loadavg()[0]! });
    }
    await judged('the 60 s six-stem score, rendered', 60_000, runs, loads);
    await judged('a cached stem, run again', 100, hits, hitLoads);
  }, TIMEOUT);
});

