// AC9 #154.d6804da4: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a 60 s,
// six-stem score renders in under 60 s on the reference Mac's CPU, a cached stem costs nothing, and the job never runs
// on the UI thread"
//
// asserts: (1) the perf lane has a task whose reason names #154, valid against the merge base's budgets
// (scripts/benchmark.mjs validateBudgets, as #501's suite reads it). (2) The concert (README: Fixtures: 60 s at 120
// BPM, six stems: two sampled, two plucked, two synth) renders: one warm-up render, then, only where the perf lane's
// own judgeLimit says this machine can judge a timing (a reference Mac on mains power, Low Power Mode off, thermal
// state nominal, the load under the core count), five more, each from a score item of its own (another seed, so every
// stem is a miss), the six deep_job calls made at once and timed from the first call to the last reply; judgeLimit
// over the five against 60 s must PASS, and anywhere else the leg is INCONCLUSIVE. (3) The same six stems asked again
// are each a cache hit that starts no process. (4) Each miss of the warm-up ran in a process of its own that the hub
// started (the record's process.starting events, at least one per stem), never in the hub's process or deep-show's.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, REPO, TIMEOUT, barBeat, cacheOf, deepJob, done, events, film, inconclusive, jobArgs, keysLibrary, lastPos, packDirs, planOf, planReply, pluck, proof,
  ref, sampled, scoreItem, scoreWorld, synth, tempo, useShow, type Ev, type JsonObject, type Library, type Plan, type World,
} from './helpers.ts';

const showBin = useShow();
const LIB = keysLibrary();
const LIMIT_MS = 60_000;

interface Task { id: string; initialReason?: string; changeReason?: string }

/** The concert: 60 s at 120 BPM (30 bars), six stems, about 700 notes. */
function concert(lib: Library, item: string): JsonObject {
  const events: Record<string, Ev> = {};
  for (let k = 0; k < 120; k++) {
    events[`piano${k}`] = { at: barBeat(k), inst: 'piano', pitch: 60, dur: '0.25s', vel: 0.6 };
    events[`guitar${k}`] = { at: barBeat(k), inst: 'guitar', pitch: 48 + (k % 12), dur: '0.4s', vel: 0.5 };
    events[`lead${k}`] = { at: barBeat(k), inst: 'lead', pitch: 67 + (k % 12), dur: '0.4s', vel: 0.4 };
    if (k % 2 === 0) events[`bell${k}`] = { at: barBeat(k + 1), inst: 'bell', pitch: 72, dur: '0.25s', vel: 0.5 };
  }
  for (let k = 0; k < 240; k++) events[`harp${k}`] = { at: barBeat(k / 2), inst: 'harp', pitch: 60 + (k % 12), dur: '0.2s', vel: 0.5 };
  for (let c = 0; c < 15; c++) [55, 59, 62].forEach((pitch, v) => { events[`pad${c}_${v}`] = { at: barBeat(c * 8), inst: 'pad', pitch, dur: '3.9s', vel: 0.3 }; });
  const instruments = {
    piano: sampled(ref(lib), 'piano', 'piano'), bell: sampled(ref(lib), 'bell', 'bell'), harp: pluck('harp', 'harp'),
    guitar: pluck('nylon', 'guitar'), pad: synth('pad', 'pad'), lead: synth('saw', 'lead'),
  };
  return film([scoreItem(item, instruments, events)], { tempo: tempo(120, 128), packs: [ref(lib)], span: '61s' });
}
/** The six stems' deep_job calls made at once: the time from the first call to the last reply, the processes started. */
async function renderAll(w: World, p: Plan): Promise<{ ms: number; started: number; replies: Record<string, { done: boolean; cache: unknown; text: string }> }> {
  const before = await lastPos(w);
  const names = Object.keys(p.stems).sort();
  const t0 = performance.now();
  const outcomes = await Promise.all(names.map((n) => deepJob(w, jobArgs(p.stems[n]!))));
  const ms = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 500));
  const started = (await events(w, before)).filter((e) => e.kind === 'process.starting').length;
  return { ms, started, replies: Object.fromEntries(names.map((n, i) => [n, { done: done(outcomes[i]!), cache: cacheOf(outcomes[i]!), text: outcomes[i]!.text.slice(0, 400) }])) };
}
const planFor = (w: World, item: string): Plan => planOf(planReply(showBin(), w.evidence, concert(LIB, item), item, packDirs(w), `the concert ${item}`), `the concert ${item}`);

describe(`${AC[9]} budgets: a 60 s six-stem score under 60 s, a cached stem free, never on the UI thread`, () => {
  it(`${AC[9]} the perf lane has a task naming #154, valid against the merge base's budgets`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: Task[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    expect(current.tasks.some((t) => /#154\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`)), 'benchmarks/budgets.json has a task whose reason names #154').toBe(true);
  }, TIMEOUT);

  it(`${AC[9]} the 60 s six-stem concert renders in under 60 s on the reference Mac's CPU, judged by the perf lane's rule`, async () => {
    const w = await scoreWorld([LIB]);
    const warm = planFor(w, 'concert0');
    expect(Object.keys(warm.stems).length, 'the concert plans six stems').toBe(6);
    const warmed = await renderAll(w, warm);
    expect(Object.values(warmed.replies).every((r) => r.done && r.cache === 'miss'), `the warm-up renders all six stems fresh: ${JSON.stringify(warmed.replies).slice(0, 1200)}`).toBe(true);
    const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
    const now = () => Array.from({ length: 5 }, () => ({ start: loadavg()[0]!, end: loadavg()[0]! }));
    const here = bench.judgeLimit({ limit: LIMIT_MS, runs: [0, 0, 0, 0, 0], fingerprint: bench.fingerprint(), loads: now() });
    if (here['status'] !== 'PASS') inconclusive(`the 60 s limit is judged only on a reference Mac in a fit state, so the five timed renders aren't made here: ${String(here['reason'])} (the warm-up took ${(warmed.ms / 1000).toFixed(1)} s)`);
    const runs: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let k = 1; k <= 5; k++) {
      const p = planFor(w, `concert${k}`);
      const start = loadavg()[0]!;
      const r = await renderAll(w, p);
      loads.push({ start, end: loadavg()[0]! });
      expect(Object.values(r.replies).every((x) => x.done && x.cache === 'miss'), `run ${k} renders all six stems fresh`).toBe(true);
      runs.push(r.ms);
    }
    const verdict = bench.judgeLimit({ limit: LIMIT_MS, runs, fingerprint: bench.fingerprint(), loads });
    proof('ac9-timing.json', { warm: warmed.ms, runs, loads, verdict });
    expect(verdict['status'], `the concert's render against 60 s: ${JSON.stringify(verdict)}`).not.toBe('FAIL');
    if (verdict['status'] !== 'PASS') inconclusive(`the timing: ${JSON.stringify(verdict)}`);
  }, 4 * TIMEOUT);

  it(`${AC[9]} a cached stem costs nothing, and every render ran in a process of its own, off the UI thread`, async () => {
    const w = await scoreWorld([LIB]);
    const p = planFor(w, 'concert0');
    const first = await renderAll(w, p);
    const again = await renderAll(w, p);
    proof('ac9-cache.json', { first: { started: first.started, replies: first.replies }, again: { started: again.started, ms: again.ms, replies: again.replies } });
    expect(Object.values(first.replies).every((r) => r.done && r.cache === 'miss'), `the first render of the six stems is six misses: ${JSON.stringify(first.replies).slice(0, 1200)}`).toBe(true);
    expect(first.started, 'each miss ran in a process the hub started, outside the hub and deep-show: at least one per stem').toBeGreaterThanOrEqual(6);
    expect(Object.values(again.replies).every((r) => r.done && r.cache === 'hit'), `the six stems asked again are cache hits: ${JSON.stringify(again.replies).slice(0, 1200)}`).toBe(true);
    expect(again.started, 'the cached stems start no process').toBe(0);
  }, TIMEOUT);
});
