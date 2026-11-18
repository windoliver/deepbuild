// AC5 #556.eb50d272: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the clean
// fixture's 80 runs of 4,000 steps and their replays finish in under 5 minutes in two replicas, rules.legal over them
// adds under 1 minute, grid.reach over 200 recorded floors takes under 1 s, and a piece with no play interface gains no
// work per frame"
//
// A blind redraft of criterion 5 (README), through the first suite's surface and helpers (tests/acceptance/556, read
// only). One test, in parts, as #184's budgets are judged:
//   1. Anywhere on macOS, on debug replicas, every part that doesn't depend on the machine:
//      - no work per frame: #555's clean crawler played with no play interface and no bot for 4,000 steps spends, at
//        every step, the fuel deep-logic's own bake of it spends (idle_work, the steps that differ, is 0);
//      - the record the perf lane and the budget window compare with the merge base: benchmarks/budgets.json's task
//        playtest-crawler as the first suite's surface gives it, naming this criterion and #556, valid by the lane's
//        validator, and scripts/lanes.mjs running this file as a timed one;
//      - grid.reach over 200 recorded floors: 200 descender runs of one step of the clean crawler, each from its own
//        seed, so one floor each; grid.reach passes, every floor reached, and reports search_ms, its own searches' time.
//   2. Only where the perf lane can judge (judgeLimit given five zero readings against a limit of 1 reads PASS: a
//      reference Mac on mains power, Low Power Mode off, thermal state nominal, the load under the core count); else the
//      test fails INCONCLUSIVE before anything is timed, never a pass.
//   3. On two release replicas behind a hub, a warm-up and five readings of each, judged by judgeLimit against the
//      record's numbers: crawler_80_runs_s, the wall time of #555's criterion 1 playtest (20 runs each by the descender,
//      the explorer, the seeded legal bot and the waiting policy, 4,000 steps, each replayed), under 300 s;
//      legal_added_s, the wall time of rules.legal over that playtest's runs, under 60 s; reach_200_floors_s, the
//      search_ms of grid.reach over part 1's 200 floors, under 1 s. Each reading shows from the replicas' own plays that
//      it timed that work.
// The wrong programs: the base (no grid.reach, no record); a play mode that spends other fuel on a piece with no
// interface; a playtest, rules.legal or grid.reach over its limit in all five readings by more than the margin (FAIL);
// a check that times other work than the clause's (other runs, another span, other floors, no replays); a record that
// names another task, number or criterion, or that the lane's validator refuses.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, REPO, TIMEOUT, canon, inconclusive, legalSpec, lockPlay, macOnly, openHub, playtestSpec, putPiece, reachOf, reachSpec,
  runCheck, runSeed, show, shown, type Hub, type Obj, type Played,
} from '../556/helpers.ts';
import { descenderInput } from '../556/programs.ts';
import {
  DESCENDER_BAND, EXPLORER, ID, LEGAL, RUNS, SPAN_STEPS, WAITING_BAND, crawlerInput, crawlerPiece, crawlerPlay, crawlerProgram,
} from '../555/programs.ts';
import { bench, load, none, readJson } from '../184/helpers.ts';
import { bakeCall, onLogic } from '../533/helpers.ts';

const FILE = 'tests/acceptance/556-redraft-ac5/ac5-budgets.test.ts';
const READINGS = 5;
/** The record the budget window compares with the merge base (the first suite's README: The surface, The budget record). */
const TASK = {
  id: 'playtest-crawler', command: ['node', 'benchmarks/canvas.mjs', 'playtest-crawler'], margin: 0.5, limits: {},
  targets: { crawler_80_runs_s: 300, legal_added_s: 60, reach_200_floors_s: 1, idle_work: 0 },
};
type Timed = 'crawler_80_runs_s' | 'legal_added_s' | 'reach_200_floors_s';
/** The clean fixture's 80 runs: #555's criterion 1 bots, 20 runs each (RUNS) of 4,000 steps (SPAN_STEPS), each replayed. */
const BOTS = [DESCENDER_BAND, EXPLORER, LEGAL, WAITING_BAND];
const RUNS_80 = BOTS.length * RUNS;
/** 200 recorded floors: 200 descender runs of one step, each recording its floor at step 0 (The surface: Floors). */
const FLOORS = 200;
const REACH = { playtest: 'R-floors', goals: ['exit'], every: ['open'], depths: [1] };
/** rules.legal over the 80 runs, every field given: the design's samples and unlisted, and a seed of the brief's. */
const LEGAL_INPUT = { playtest: 'R-play', samples: 50, unlisted: 8, seed: 556 };
/** The bots' kinds, as a replica's play call carries a bot (#555's README: The replica's play call). */
const KINDS = ['policy', 'logic', 'legal', 'explorer', 'descender'];
const kindOf = (bot: Obj): string => KINDS.find((k) => k in bot) ?? '?';

/**
 * idle_work: the steps at which #555's clean crawler, played with no play interface and no bot for 4,000 steps, spends
 * other fuel than deep-logic's own bake of it (#184's reading of "no work per frame"); its gaps.
 */
async function idleGaps(pool: Pool, body: Obj): Promise<string[]> {
  const bare = await pool.play({ piece: body, seed: body['seed'], span: { steps: SPAN_STEPS }, values: [], frames: [] });
  if (bare['ok'] !== true) return [`the replica plays the clean crawler with no play interface and no bot: ${show(bare, 800)}`];
  const fuel = (bare['fuel'] as Obj | undefined)?.[ID] as number[] | undefined;
  const [baked] = onLogic([{ ...bakeCall(body as never, [], SPAN_STEPS), arrays: [] }]) as unknown as Obj[];
  if (baked?.['ok'] !== true) return [`deep-logic bakes the clean crawler for ${SPAN_STEPS} steps: ${show(baked, 800)}`];
  const own = (baked['steps'] as { items: Obj }[]).map((s) => Number(s.items[ID]?.['fuel']));
  if (Number(bare['steps']) !== SPAN_STEPS || !Array.isArray(fuel) || fuel.length !== SPAN_STEPS || own.length !== SPAN_STEPS)
    return [`the play ran ${show(bare['steps'])} steps and reports fuel for ${Array.isArray(fuel) ? fuel.length : 'no'} steps, the bake ${own.length}, of ${SPAN_STEPS}`];
  if (!own.some((f) => f > 0)) return [`the bake reports no fuel spent at any step, so equal fuel would show nothing: ${show(own.slice(0, 8))}`];
  const differ = fuel.flatMap((f, k) => (f !== own[k] ? [k] : []));
  if (!differ.length) return [];
  const k = differ[0]!;
  return [`idle_work is ${differ.length}: at ${differ.length} of ${SPAN_STEPS} steps the crawler played with no play interface spends other fuel than the logic module's bake of it, first at step ${k} (${fuel[k]} against ${own[k]})`];
}

/** The record's gaps: the task as the surface gives it, naming this criterion and #556, valid by the lane's validator, this file timed. */
async function recordGaps(): Promise<string[]> {
  const gaps: string[] = [];
  const budgets = readJson(join(REPO, 'benchmarks', 'budgets.json'));
  const found = (budgets['tasks'] as Obj[] | undefined)?.find((t) => t['id'] === TASK.id);
  if (!found) gaps.push(`benchmarks/budgets.json has no task ${TASK.id} for the perf lane and the budget window to compare with the merge base`);
  else {
    for (const [k, want] of Object.entries(TASK)) if (canon(found[k]) !== canon(want)) gaps.push(`${TASK.id}.${k} is ${show(found[k])}, not ${show(want)}`);
    if (!(Array.isArray(found['criteria']) && found['criteria'].includes(AC[5]))) gaps.push(`${TASK.id}.criteria doesn't name ${AC[5]}`);
    if (!(typeof found['initialReason'] === 'string' && /#556(?![0-9])/.test(found['initialReason']))) gaps.push(`${TASK.id}.initialReason doesn't name #556`);
  }
  try { (await bench()).validateBudgets(budgets, { tasks: [] }); } catch (e) { gaps.push(`the lane's validator refuses benchmarks/budgets.json: ${(e as Error).message}`); }
  const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
  if (!lanes.timed.includes(FILE)) gaps.push(`scripts/lanes.mjs doesn't run ${FILE} as a timed file`);
  return gaps;
}

/**
 * What a check timed, from the replicas' own plays in `log`: each bot's run i played with its bot at hash(seed, i) for
 * the input's span, and with `replays`, its track played again without its bot to the same track and final hash.
 */
function workGaps(log: Played[], input: Obj, replays: boolean): string[] {
  const gaps: string[] = [];
  (input['bots'] as Obj[]).forEach((bot, b) => {
    for (let i = 0; i < Number(input['runs']); i++) {
      const seed = runSeed(Number(input['seed']), i);
      const run = log.find((p) => p.call['bot'] && kindOf(p.call['bot'] as Obj) === kindOf(bot) && p.call['seed'] === seed && p.reply['ok'] === true && Number(p.reply['steps']) > 0);
      if (!run) { gaps.push(`bot ${b} run ${i} (seed ${seed}) wasn't played with its bot`); continue; }
      if (canon(run.call['span']) !== canon(input['span'])) gaps.push(`bot ${b} run ${i} was played for ${show(run.call['span'])}, not ${show(input['span'])}`);
      const again = (p: Played): boolean => !p.call['bot'] && p.call['track'] !== undefined && p.call['seed'] === seed && p.reply['ok'] === true
        && p.reply['track'] === run.reply['track'] && p.reply['final'] === run.reply['final'];
      if (replays && !log.some(again)) gaps.push(`bot ${b} run ${i}: no play of its track without its bot reached its track and final hash`);
    }
  });
  return gaps;
}

/** grid.reach over the 200 one-step runs, checked for the clause's work: 200 floors, each reached; its search_ms. */
async function reachOnce(hub: Hub, pool: Pool, input: Obj): Promise<number> {
  pool.log.splice(0);
  const at = performance.now();
  const r = await runCheck(hub, reachSpec(REACH, input));
  const wall = performance.now() - at;
  expect(r.outcome, `grid.reach passes over the clean crawler's ${FLOORS} one-step runs: ${shown(r)}`).toBe('passed');
  expect(r.testsRun, `it read the ${FLOORS} runs`).toBe(FLOORS);
  const x = reachOf(r);
  const gaps = workGaps(pool.log, input, false);
  if (x.floors.length !== FLOORS) gaps.push(`it recorded ${x.floors.length} floors, not ${FLOORS}, one at step 0 of each run`);
  const named = new Set(x.floors.map((f) => f.run));
  const missing = Array.from({ length: FLOORS }, (_, i) => `bot 0 run ${i}`).filter((n) => !named.has(n));
  if (missing.length) gaps.push(`no floor of ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more runs` : ''}`);
  const unreached = x.floors.filter((f) => !f.reached);
  if (unreached.length) gaps.push(`${unreached.length} floors unreached, the first ${show(unreached[0], 300)}`);
  if (x.coverage['1'] !== FLOORS) gaps.push(`coverage counts ${show(x.coverage['1'])} runs at depth 1, not ${FLOORS}`);
  const ms = x.search_ms;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) gaps.push(`reach.search_ms, the wall time in ms of its own searches over the floors it recorded, is ${show(ms)}`);
  else if (ms > wall) gaps.push(`reach.search_ms ${ms} is more than the whole check's ${wall.toFixed(1)} ms`);
  none(gaps, `grid.reach over ${FLOORS} recorded floors`);
  return ms!;
}

/** A warm-up, then five readings, each with the one-minute load at its start and end (the perf lane's rule). */
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

describe(`${AC[5]} the budgets: 80 runs and replays under 5 min, rules.legal under 1 min, grid.reach over 200 floors under 1 s, no work without an interface`, () => {
  it(`${AC[5]} no work per frame, the record and grid.reach's 200 floors anywhere; on a reference Mac at rest, five readings of each within its limit`, async () => {
    macOnly();
    // 1. What doesn't depend on the machine, on two debug replicas.
    const debug = await Pool.open(2);
    const body = crawlerPiece(crawlerProgram('clean'), 'clean');
    const crawler = putPiece(DOC.crawler, body);
    none([...(await idleGaps(debug, body)), ...(await recordGaps())], 'no work per frame for a piece with no play interface, and the record');
    const play = await lockPlay(crawlerPlay());
    const input200 = { ...descenderInput(crawler, play, FLOORS), span: { steps: 1 } };
    await reachOnce(await openHub(debug), debug, input200);

    // 2. Only on a reference Mac at rest, as the perf lane judges.
    const bn = await bench();
    const gate = bn.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: bn.fingerprint(), loads: Array.from({ length: READINGS }, () => ({ start: load(), end: load() })) });
    if (gate.status !== 'PASS') inconclusive(`the budgets are judged only where the perf lane judges them, on a reference Mac at rest: ${gate.reason ?? gate.status}`);

    // 3. Two release replicas behind a hub; a warm-up and five readings of each.
    const release = await Pool.open(2, { build: 'release' });
    const hub = await openHub(release);
    const input80 = crawlerInput(crawler, play, BOTS);
    const read: Record<Timed, () => Promise<number>> = {
      crawler_80_runs_s: async () => {
        release.log.splice(0);
        const at = performance.now();
        const r = await runCheck(hub, playtestSpec(input80));
        const s = (performance.now() - at) / 1000;
        expect(r.outcome, `the clean crawler's playtest passes in every reading: ${shown(r)}`).toBe('passed');
        expect(r.testsRun, 'it counts the 80 runs').toBe(RUNS_80);
        none(workGaps(release.log, input80, true), 'the reading timed the 80 runs of 4,000 steps and their replays');
        return s;
      },
      legal_added_s: async () => {
        release.log.splice(0);
        const at = performance.now();
        const r = (await runCheck(hub, legalSpec(LEGAL_INPUT, input80))) as Awaited<ReturnType<typeof runCheck>> & { legal?: Obj };
        const s = (performance.now() - at) / 1000;
        expect(r.testsRun, `rules.legal reads the 80 runs in every reading: ${shown(r)}`).toBe(RUNS_80);
        const sampled = new Set(((r.legal?.['samples'] ?? []) as Obj[]).map((x) => x['run']));
        expect([sampled.size, Number(r.legal?.['tested']) > 0], `it samples each of the 80 runs and tests entries there: ${show(r.legal, 400)}`).toEqual([RUNS_80, true]);
        none(workGaps(release.log, input80, false), 'the reading timed rules.legal over the 80 runs of 4,000 steps');
        return s;
      },
      reach_200_floors_s: async () => (await reachOnce(hub, release, input200)) / 1000,
    };
    const judged: { name: Timed; status: string; reason?: string; runs?: number[] }[] = [];
    for (const name of Object.keys(read) as Timed[]) {
      const r = await readings(read[name]);
      judged.push({ name, ...bn.judgeLimit({ limit: TASK.targets[name], ...r, fingerprint: bn.fingerprint() }) });
    }
    const said = (j: (typeof judged)[number]): string => `${j.name}: ${j.status}, ${show(j.runs)} against ${TASK.targets[j.name]}${j.reason ? `, ${j.reason}` : ''}`;
    expect(judged.filter((j) => j.status === 'FAIL').map(said), 'no budget is over its limit in all five readings by more than the margin').toEqual([]);
    const open = judged.filter((j) => j.status !== 'PASS');
    if (open.length) inconclusive(open.map(said).join('; '));
  }, TIMEOUT * 2);
});
