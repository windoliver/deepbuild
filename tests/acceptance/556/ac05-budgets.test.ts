// AC5 #556.eb50d272: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the clean
// fixture's 80 runs of 4,000 steps and their replays finish in under 5 minutes in two replicas, rules.legal over them
// adds under 1 minute, grid.reach over 200 recorded floors takes under 1 s, and a piece with no play interface gains no
// work per frame"
//
// The timed file (README: Criterion 5), judged as #184's budgets are:
//   1. On any Mac, debug builds: what each budget times. "No work per frame": the clean crawler played with no play
//      interface, no bot and no track spends, at every step, the fuel the logic module's own bake of it spends
//      (idle_work counts the steps that differ, 0), the merge base's own measure of a piece's work. grid.reach over a
//      playtest of 200 descender runs of 2 steps, one recorded floor a run: it passes over 200 floors and reports
//      `search_ms`, the time its own searches took (README: The surface).
//   2. The record the local preflight's perf lane and the budget window compare with the merge base:
//      benchmarks/budgets.json's task `playtest-crawler`, valid by the lane's validator, naming this criterion and
//      #556, and scripts/lanes.mjs runs this file as a timed one.
//   3. Only where the lane can judge (a reference Mac on mains power, Low Power Mode off, thermal state nominal, the load
//      under the core count; else INCONCLUSIVE, never a pass): release replicas, a warm-up and five readings each,
//      judged by scripts/benchmark.mjs's judgeLimit: #555's clean playtest (4 bots × 20 runs of 4,000 steps, each run
//      replayed) through the hub on two replicas within 300 s; rules.legal over that playtest's runs within 60 s;
//      grid.reach's search over the 200 floors within 1 s.
// The wrong programs: the base (no grid.reach, no record), a play mode that spends fuel on a piece with no interface,
// a grid.reach that reads the piece's own flags or searches past its budget.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, REPO, TIMEOUT, canon, inconclusive, legalSpec, lockPlay, macOnly, openHub, ownPlay, playtestSpec, putPiece, reachOf, reachSpec, runCheck, shown, show,
  type Hub, type Obj,
} from './helpers.ts';
import { bench, load, readJson } from '../184/helpers.ts';
import { bakeCall, onLogic } from '../533/helpers.ts';
import {
  DESCENDER_BAND, EXPLORER, LEGAL, SEED as CRAWLER_DOC_SEED, WAITING_BAND, crawlerInput, crawlerPiece, crawlerPlay, crawlerProgram,
} from '../555/programs.ts';
import { CRAWLER_REACH, descenderInput } from './programs.ts';

const FILE = 'tests/acceptance/556/ac05-budgets.test.ts';
const READINGS = 5;
const TASK = {
  id: 'playtest-crawler', command: ['node', 'benchmarks/canvas.mjs', 'playtest-crawler'], margin: 0.5,
  targets: { crawler_80_runs_s: 300, legal_added_s: 60, reach_200_floors_s: 1, idle_work: 0 },
};
const IDLE_STEPS = 600;
const FLOORS = 200;

/** The record's gaps: the task as given, naming its criterion and #556, valid by the lane's validator, this file timed. */
async function recordGaps(): Promise<string[]> {
  const gaps: string[] = [];
  const budgets = readJson(join(REPO, 'benchmarks', 'budgets.json'));
  const found = (budgets['tasks'] as Obj[] | undefined)?.find((t) => t['id'] === TASK.id);
  if (!found) gaps.push(`benchmarks/budgets.json has no task ${TASK.id} for the perf lane and the budget window to compare with the merge base`);
  else {
    for (const [k, want] of Object.entries(TASK)) if (canon(found[k]) !== canon(want)) gaps.push(`${TASK.id}.${k} is ${show(found[k])}, not ${show(want)}`);
    if (!(Array.isArray(found['criteria']) && found['criteria'].includes(AC[5]))) gaps.push(`${TASK.id}.criteria doesn't name ${AC[5]}`);
    if (!(typeof found['initialReason'] === 'string' && found['initialReason'].includes('#556'))) gaps.push(`${TASK.id}.initialReason doesn't name #556`);
  }
  try { (await bench()).validateBudgets(budgets, { tasks: [] }); } catch (e) { gaps.push(`the lane's validator refuses benchmarks/budgets.json: ${(e as Error).message}`); }
  const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
  if (!lanes.timed.includes(FILE)) gaps.push(`scripts/lanes.mjs doesn't run ${FILE} as a timed file`);
  return gaps;
}
/** Only on a reference Mac at rest, as the perf lane judges; INCONCLUSIVE elsewhere, never a pass. */
async function gate(): Promise<Obj> {
  const bn = await bench();
  const fingerprint = bn.fingerprint();
  const g = bn.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint, loads: Array.from({ length: READINGS }, () => ({ start: load(), end: load() })) });
  if (g.status !== 'PASS') inconclusive(`the timings are judged only on a reference Mac at rest: ${g.reason ?? g.status}`);
  return fingerprint;
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
/** grid.reach over a playtest of 200 descender runs of 2 steps: one recorded floor a run. */
const floorsSpec = (piece: string, play: Obj): Obj => reachSpec(CRAWLER_REACH, { ...descenderInput(piece, play, FLOORS), span: { steps: 2 } });
async function searchSeconds(hub: Hub, spec: Obj): Promise<number> {
  const r = await runCheck(hub, spec);
  expect(r.outcome, `grid.reach passes over the 200 floors: ${shown(r)}`).toBe('passed');
  const x = reachOf(r);
  expect(x.floors.length, 'it recorded one floor a run: 200').toBe(FLOORS);
  expect(Number.isFinite(x.search_ms) && x.search_ms! >= 0, `it reports search_ms, the time its own searches took: ${show(x.search_ms)}`).toBe(true);
  return x.search_ms! / 1000;
}

describe(`${AC[5]} the budgets: 80 runs and replays, rules.legal over them, grid.reach over 200 floors, no work without an interface`, () => {
  it(`${AC[5]} no work per step for a piece played with no play interface; grid.reach's search time over 200 floors; the record; on a reference Mac, five readings within each budget`, async () => {
    macOnly();
    const body = crawlerPiece(crawlerProgram('clean'), 'clean');
    const piece = putPiece(DOC.crawler, body);
    const pool = await Pool.open(2);
    const gaps: string[] = [];
    const bare = await ownPlay(pool, piece, { seed: CRAWLER_DOC_SEED, span: { steps: IDLE_STEPS }, values: [], frames: [] });
    const [baked] = onLogic([bakeCall(body as never, [], IDLE_STEPS)]) as { steps: { items: { crawler: { fuel: number } } }[] }[];
    const own = baked!.steps.map((s) => s.items.crawler.fuel);
    const fuel = (bare['fuel'] as Obj)['crawler'] as number[];
    if (fuel.length !== own.length) gaps.push(`the play reports fuel for ${fuel.length} steps, the bake ${own.length}`);
    const idle = fuel.filter((f, k) => f !== own[k]).length;
    if (idle !== 0) gaps.push(`idle_work: ${idle} steps of the crawler played with no play interface spend other fuel than the logic module's bake of it`);
    const hub = await openHub(pool);
    const play = await lockPlay(crawlerPlay());
    await searchSeconds(hub, floorsSpec(piece, play));
    gaps.push(...(await recordGaps()));
    expect(gaps, 'what the budgets time, and their record').toEqual([]);

    const fingerprint = await gate();
    const bn = await bench();
    const release = await Pool.open(2, { build: 'release' });
    const rhub = await openHub(release);
    const eighty = crawlerInput(piece, play, [DESCENDER_BAND, EXPLORER, LEGAL, WAITING_BAND]);
    const judged: [string, number, { status: string; reason?: string; runs?: number[] }][] = [];
    const runs = await readings(async () => {
      const at = performance.now();
      const r = await runCheck(rhub, playtestSpec(eighty));
      expect(r.outcome, `the clean crawler's playtest passes in every reading: ${shown(r)}`).toBe('passed');
      return (performance.now() - at) / 1000;
    });
    judged.push(['crawler_80_runs_s', TASK.targets.crawler_80_runs_s, bn.judgeLimit({ limit: TASK.targets.crawler_80_runs_s, ...runs, fingerprint })]);
    const legal = await readings(async () => {
      const at = performance.now();
      const r = await runCheck(rhub, legalSpec({ playtest: 'R-crawler', samples: 50, unlisted: 8, seed: 556 }, eighty));
      expect(r.testsRun, `rules.legal read the playtest's 80 runs: ${shown(r)}`).toBe(80);
      return (performance.now() - at) / 1000;
    });
    judged.push(['legal_added_s', TASK.targets.legal_added_s, bn.judgeLimit({ limit: TASK.targets.legal_added_s, ...legal, fingerprint })]);
    const floors = await readings(() => searchSeconds(rhub, floorsSpec(piece, play)));
    judged.push(['reach_200_floors_s', TASK.targets.reach_200_floors_s, bn.judgeLimit({ limit: TASK.targets.reach_200_floors_s, ...floors, fingerprint })]);
    for (const [name, limit, j] of judged) expect(j.status, `${name} within ${limit}: ${show(j.runs)}, ${j.reason ?? ''}`).not.toBe('FAIL');
    const open = judged.filter(([, , j]) => j.status !== 'PASS');
    if (open.length) inconclusive(open.map(([name, , j]) => `${name}: ${j.status}, ${show(j.runs)}, ${j.reason ?? ''}`).join('; '));
  }, TIMEOUT * 2);
});
