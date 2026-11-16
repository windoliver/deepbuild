// AC13 #184.0bdc1a84: "Budgets, measured in the scheduled budget window on a reference Mac at the merged commit against its
// merge base; the PR says `Part of #184` until that window closes the issue; unmeasured is never PASS: the clean maze's
// 40 runs of 120 s and their replays finish in under 5 minutes in two replicas, and a piece played without the plug-in
// gains no work per frame"
// AC15 #184.694b8a04: "20 seeded runs of the 2-minute fixture piece finish at 50 times real time or faster on 4 replicas
// from an optimized build, each run's track replaying to the same full-state hashes; a planted run that renders frames it
// doesn't keep falls under 50 times and fails, naming the run …"
//
// The timed file (README: Criteria 13 and 15). Each test, in parts, as #213's budgets are judged:
//   1. On any Mac, debug builds: what the budget times is the clause's work. Criterion 13's "no work per frame": the
//      clean maze played with no bot and no track spends, at every step, the fuel the logic module's own bake of it
//      spends (idle_work counts the steps that differ, 0). Criterion 15's fixture piece: the clean maze played 120 s
//      by criterion 1's policy, each run replaying to the same checkpoints and final hash.
//   2. The record the perf lane and the budget window compare with the merge base: benchmarks/budgets.json's tasks
//      `playtest-maze` and `playtest-throughput`, valid by the lane's validator, naming their criteria, and
//      scripts/lanes.mjs runs this file as a timed one.
//   3. Only where the lane can judge (a reference Mac at rest, else INCONCLUSIVE before anything is timed): release
//      builds, a warm-up and five readings, judged by scripts/benchmark.mjs's judgeLimit. Criterion 15's planted run
//      plays on one of the 4 replicas, a release build with the Cargo feature `test-renders-unkept-frames`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, REPO, SEED, SPAN_S, STEPS_120, TIMEOUT, bench, canon, driveBin, inconclusive, load, macOnly, none, openHub, playInput, played,
  pieceOf, putPiece, readJson, runPlaytest, runSeed, show, type Obj,
} from './helpers.ts';
import { POLICY, mazePiece, mazeProgram, routeBot, routeBotProgram } from './programs.ts';
import { bakeCall, onLogic } from '../533/helpers.ts';

const FILE = 'tests/acceptance/184/budgets.test.ts';
const READINGS = 5;
const MAZE_TASK = { id: 'playtest-maze', command: ['node', 'benchmarks/canvas.mjs', 'playtest-maze'], margin: 0.5, targets: { maze_40_runs_s: 300, idle_work: 0 } };
const THROUGHPUT_TASK = { id: 'playtest-throughput', command: ['node', 'benchmarks/canvas.mjs', 'playtest-throughput'], margin: 0.5, targets: { fixture_realtime_x: 50 } };
const FIXTURE_RUNS = 20;
const REPLICAS = 4;
const FLOOR_X = 50;

/** The record's gaps: the task as given, naming its criterion and #184, valid by the lane's validator, this file timed. */
async function recordGaps(task: Obj, criterion: string): Promise<string[]> {
  const gaps: string[] = [];
  const budgets = readJson(join(REPO, 'benchmarks', 'budgets.json'));
  const found = (budgets['tasks'] as Obj[] | undefined)?.find((t) => t['id'] === task['id']);
  if (!found) gaps.push(`benchmarks/budgets.json has no task ${String(task['id'])} for the perf lane and the budget window to compare with the merge base`);
  else {
    for (const [k, want] of Object.entries(task)) if (canon(found[k]) !== canon(want)) gaps.push(`${String(task['id'])}.${k} is ${show(found[k])}, not ${show(want)}`);
    if (!(Array.isArray(found['criteria']) && found['criteria'].includes(criterion))) gaps.push(`${String(task['id'])}.criteria doesn't name ${criterion}`);
    if (!(typeof found['initialReason'] === 'string' && found['initialReason'].includes('#184'))) gaps.push(`${String(task['id'])}.initialReason doesn't name #184`);
  }
  try { (await bench()).validateBudgets(budgets, { tasks: [] }); } catch (e) { gaps.push(`the lane's validator refuses benchmarks/budgets.json: ${(e as Error).message}`); }
  const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
  if (!lanes.timed.includes(FILE)) gaps.push(`scripts/lanes.mjs doesn't run ${FILE} as a timed file`);
  return gaps;
}
/** Only on a reference Mac at rest, as the perf lane judges; INCONCLUSIVE elsewhere, never a pass. */
async function gate(): Promise<{ fingerprint: Obj }> {
  const bn = await bench();
  const fingerprint = bn.fingerprint();
  const g = bn.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint, loads: Array.from({ length: READINGS }, () => ({ start: load(), end: load() })) });
  if (g.status !== 'PASS') inconclusive(`the timings are judged only on a reference Mac at rest: ${g.reason ?? g.status}`);
  return { fingerprint };
}
/** A warm-up, then five readings, each with the load at its start and end. */
async function readings(read: () => Promise<number>): Promise<{ runs: number[]; loads: { start: number; end: number }[] }> {
  await read();
  const runs: number[] = [];
  const loads: { start: number; end: number }[] = [];
  for (let n = 0; n < READINGS; n++) {
    const start = load();
    runs.push(await read());
    loads.push({ start, end: load() });
  }
  return { runs, loads };
}

/**
 * One batch of criterion 15's fixture on `pool`'s 4 replicas: each of the 20 runs played by the policy and replayed.
 * A run's own multiple of real time is its share of the batch's: 4 × 120 s over the time its play and replay took on
 * their replicas (queueing for a free replica not counted), so the batch is at 50 times when its runs are on average.
 */
async function batch(pool: Pool, piece: string): Promise<{ seconds: number; runs: { i: number; x: number; gaps: string[] }[] }> {
  const at = performance.now();
  const runs = await Promise.all([...Array(FIXTURE_RUNS)].map(async (_, i) => {
    const seed = runSeed(SEED, i);
    const run = played(await pool.play({ piece: pieceOf(piece), seed, span: SPAN_S, bot: POLICY, values: [], frames: [0] }, piece), `fixture run ${i}`);
    const again = played(await pool.play({ piece: pieceOf(piece), seed, span: SPAN_S, track: run['entries'], values: [], frames: [] }, piece), `fixture run ${i}'s replay`);
    const gaps: string[] = [];
    if (again['track'] !== run['track'] || canon(again['checkpoints']) !== canon(run['checkpoints']) || again['final'] !== run['final']) gaps.push(`fixture run ${i}'s replay doesn't reach its full-state hashes`);
    const ms = pool.log.filter((p) => p.reply === run || p.reply === again).reduce((sum, p) => sum + p.ms, 0);
    return { i, x: (REPLICAS * SPAN_S) / (ms / 1000), gaps };
  }));
  return { seconds: (performance.now() - at) / 1000, runs };
}
/** The floor's judge: a batch under 50 times real time fails, naming each run whose own multiple is under 50. */
const throughputFailures = (b: { seconds: number; runs: { i: number; x: number }[] }): string[] =>
  (FIXTURE_RUNS * SPAN_S) / b.seconds >= FLOOR_X ? [] : b.runs.filter((r) => r.x < FLOOR_X).map((r) => `run ${r.i} played at ${r.x.toFixed(1)} times real time, under ${FLOOR_X}`);

describe(`${AC[13]} the clean maze's 40 runs and replays in under 5 minutes in two replicas, and no work without the plug-in`, () => {
  it(`${AC[13]} no work per step for a piece played without the plug-in; the record; on a reference Mac, five readings under 300 s`, async () => {
    macOnly();
    const body = mazePiece(mazeProgram('clean'));
    const piece = putPiece(DOC.clean, body);
    const pool = await Pool.open([{ bin: driveBin('debug') }]);
    const gaps: string[] = [];
    const bare = played(await pool.play({ piece: body, seed: SEED, span: SPAN_S, values: [], frames: [] }, piece), 'the clean maze with no bot');
    const [baked] = onLogic([bakeCall(body as never, [], STEPS_120)]) as { steps: { items: { maze: { fuel: number } } }[] }[];
    const own = baked!.steps.map((s) => s.items.maze.fuel);
    const fuel = bare['fuel']['maze'] as number[];
    if (fuel.length !== own.length) gaps.push(`the play reports fuel for ${fuel.length} steps, the bake ${own.length}`);
    const idle = fuel.filter((f, k) => f !== own[k]).length;
    if (idle !== 0) gaps.push(`idle_work: ${idle} steps of the piece played without the plug-in spend other fuel than the logic module's bake of it`);
    gaps.push(...(await recordGaps(MAZE_TASK, AC[13])));
    none(gaps, 'what the budget times, and its record');

    const { fingerprint } = await gate();
    const bn = await bench();
    const release = await Pool.open([{ bin: driveBin('release') }, { bin: driveBin('release') }]);
    const hub = await openHub({ pool: release, playtest: 'loaded' });
    const input = playInput(piece, [routeBot(routeBotProgram()), POLICY]);
    const r = await readings(async () => {
      const at = performance.now();
      const result = await runPlaytest(hub, input);
      expect(result.outcome, 'the clean maze passes in every reading').toBe('passed');
      return (performance.now() - at) / 1000;
    });
    const j = bn.judgeLimit({ limit: MAZE_TASK.targets.maze_40_runs_s, ...r, fingerprint });
    expect(j.status, `40 runs and their replays in two replicas: ${show(j.runs)} s, ${j.reason ?? ''}`).not.toBe('FAIL');
    if (j.status !== 'PASS') inconclusive(`maze_40_runs_s: ${j.status}, ${show(j.runs)} s, ${j.reason ?? ''}`);
  }, TIMEOUT * 2);
});

describe(`${AC[15]} 20 seeded runs of the 2-minute fixture at 50 times real time on 4 replicas`, () => {
  it(`${AC[15]} each run replays to its hashes; the record; on a reference Mac five batches at 50x or faster, and a planted run that renders unkept frames named under 50x`, async () => {
    macOnly();
    const piece = putPiece(DOC.clean, mazePiece(mazeProgram('clean')));
    const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }, { bin: driveBin('debug') }, { bin: driveBin('debug') }]);
    const gaps = (await batch(pool, piece)).runs.flatMap((r) => r.gaps);
    gaps.push(...(await recordGaps(THROUGHPUT_TASK, AC[15])));
    none(gaps, 'the fixture\'s runs and the record');

    const { fingerprint } = await gate();
    const bn = await bench();
    const release = await Pool.open([...Array(REPLICAS)].map(() => ({ bin: driveBin('release') })));
    const r = await readings(async () => {
      const b = await batch(release, piece);
      none(b.runs.flatMap((x) => x.gaps), 'each run replays to its full-state hashes');
      return b.seconds;
    });
    const limit = (FIXTURE_RUNS * SPAN_S) / FLOOR_X;
    const j = bn.judgeLimit({ limit, ...r, fingerprint });
    expect(j.status, `20 runs at 50 times real time (${limit} s): ${show(j.runs)} s, ${j.reason ?? ''}`).not.toBe('FAIL');
    if (j.status !== 'PASS') inconclusive(`fixture_realtime_x: ${j.status}, ${show(j.runs)} s, ${j.reason ?? ''}`);
    none(throughputFailures(await batch(release, piece)), 'the floor\'s judge on the optimized build');

    // The planted build: every run renders a frame at every step and keeps only the one asked for.
    const planted = await Pool.open([...Array(REPLICAS)].map(() => ({ bin: driveBin('release-unkept') })));
    const pb = await batch(planted, piece);
    none(pb.runs.flatMap((x) => x.gaps), 'the planted runs still replay to their hashes');
    const failures = throughputFailures(pb);
    expect(failures.length, `the planted runs fall under 50 times real time (${((FIXTURE_RUNS * SPAN_S) / pb.seconds).toFixed(1)} times) and the floor's judge fails, naming them`).toBeGreaterThan(0);
    for (const f of failures) expect(f, 'each failure names its run').toMatch(/^run \d+ played at /);
  }, TIMEOUT * 4);
});
