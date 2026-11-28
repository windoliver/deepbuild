import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bench as perf, load, readJson } from '../184/helpers.ts';
import { DESCENDER, PATH, SIZE, crawlerPiece, crawlerPlay, crawlerProgram } from '../555/programs.ts';
import { DOC, Pool, REPO, inconclusive, lockPlay, macOnly, openHub, ownPlay, putPiece, runSeed, valuesOf, type Hub, type Obj } from '../556/helpers.ts';
import { cellsOfClass, needFact, type Floor } from './floors.ts';
import { TIMEOUT, none, reachSpec, runCheck } from './helpers.ts';
import { BUDGET, recordWrong, searchedWrong } from './judges.ts';
import { SEED, floorPlay, type Need } from './programs.ts';

const ID = 'AC6 #3263.530bc8ce';
const CRITERION = '#3263.530bc8ce';
const FLOORS = 200;
const READINGS = 5;
const NEEDS: Need[] = [
  { goal: 'exit', through: ['door'] },
  { goal: 'key', through: ['door'] },
  { goal: 'locked', through: ['door'] },
  { goal: 'locked', through: ['key'] },
];
const REACH: Obj = { playtest: 'R-floors', goals: ['exit', 'key', 'locked'], every: ['open'], depths: [1], needs: NEEDS };
const WHAT = `grid.reach's own searches over ${FLOORS} floors of ${SIZE} × ${SIZE} with ${NEEDS.length} needs`;

async function floorOfRun(pool: Pool, at: string, i: number): Promise<{ floor: Floor; start: number }> {
  const reply = await ownPlay(pool, at, { seed: runSeed(SEED, i), piece_seed: 'run', span: { steps: 1 }, values: [PATH.grid, PATH.cell], frames: [] });
  const cells = (valuesOf(reply, PATH.grid)[0] as number[] | undefined) ?? [];
  const hero = (valuesOf(reply, PATH.cell)[0] as number[] | undefined) ?? [];
  return { floor: { w: SIZE, h: SIZE, cells: cells.map(Number) }, start: Number(hero[1]) * SIZE + Number(hero[0]) };
}

async function fixtureGaps(pool: Pool, at: string): Promise<string[]> {
  const floors = await Promise.all(Array.from({ length: FLOORS }, (_, i) => floorOfRun(pool, at, i)));
  const gaps: string[] = [];
  floors.forEach(({ floor, start }, i) => {
    if (floor.cells.length !== SIZE * SIZE) gaps.push(`run ${i}'s floor holds ${floor.cells.length} cells, not ${SIZE} × ${SIZE}`);
    for (const need of NEEDS) {
      const fact = needFact(floor, [start], cellsOfClass(floor, String(need.goal)), need.through);
      const held = fact.goal && fact.through > 0 && !fact.closedGoal;
      if (!held) gaps.push(`run ${i}'s floor: the need ${JSON.stringify(need)} isn't one a search judges and passes there: ${JSON.stringify(fact)}`);
    }
  });
  return gaps;
}

async function searchSeconds(hub: Hub, input: Obj): Promise<number> {
  const r = await runCheck(hub, reachSpec(REACH, input));
  none(searchedWrong(r, FLOORS), `grid.reach passes the ${FLOORS} floors with the ${NEEDS.length} needs and reports its own searches' time`);
  return Number(r.reach?.search_ms) / 1000;
}

describe(`${ID} the time budget of a need: one more search a floor`, () => {
  it(`${ID} 200 floors of 32 × 32 with four needs: the record a budget window judges anywhere, and on a reference Mac at rest five readings of the searches' time under a second`, async () => {
    macOnly();
    const pool = await Pool.open(2);
    const hub = await openHub(pool);
    const grid = crawlerPlay()['grid'] as Obj;
    expect([grid['size'], grid['classes'], grid['locks']], 'the crawler\'s grid is 32 × 32, with the classes and the lock this suite\'s own search reads').toEqual([[SIZE, SIZE], floorPlay()['grid']['classes'], floorPlay()['grid']['locks']]);
    const crawler = putPiece(DOC.crawler, crawlerPiece(crawlerProgram('clean'), 'clean'));
    const input: Obj = { piece: crawler, play: await lockPlay(crawlerPlay()), bots: [DESCENDER], runs: FLOORS, seed: SEED, span: { steps: 1 }, goals: [], piece_seed: 'run', frames: { every: 0 } };
    none(await fixtureGaps(pool, crawler), `the fixture, by this suite's own plays and search: ${FLOORS} floors of ${SIZE} × ${SIZE}, one a run, on each of which each of the ${NEEDS.length} needs has its goal reached, cells to close and its goal unreached with them closed`);

    const at = load();
    const once = await searchSeconds(hub, input);
    console.log(`${ID} a reading, not a result: ${WHAT} took ${(once * 1000).toFixed(1)} ms at a one-minute load of ${at.toFixed(1)} to ${load().toFixed(1)}`);

    const budgets = readJson(join(REPO, 'benchmarks', 'budgets.json'));
    none(recordWrong(budgets, CRITERION), `the record a budget window judges this criterion by: benchmarks/budgets.json's task ${BUDGET.task}, its ${BUDGET.target} of ${BUDGET.seconds} s, naming ${CRITERION}`);
    const bn = await perf();
    expect(() => bn.validateBudgets(budgets, { tasks: [] }), 'the perf lane\'s validator takes benchmarks/budgets.json').not.toThrow();

    const idle = Array.from({ length: READINGS }, () => ({ start: load(), end: load() }));
    const gate = bn.judgeLimit({ limit: BUDGET.seconds, runs: Array.from({ length: READINGS }, () => 0), fingerprint: bn.fingerprint(), loads: idle });
    if (gate.status !== 'PASS') inconclusive(`${WHAT} against ${BUDGET.seconds} s: this machine can't judge a timing now, so ${(once * 1000).toFixed(1)} ms is a reading: ${gate.reason ?? gate.status}`);

    const runs: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let n = 0; n < READINGS; n++) {
      const start = load();
      runs.push(await searchSeconds(hub, input));
      loads.push({ start, end: load() });
    }
    const judged = bn.judgeLimit({ limit: BUDGET.seconds, runs, fingerprint: bn.fingerprint(), loads });
    const reading = `${WHAT}: ${runs.map((s) => (s * 1000).toFixed(1)).join(', ')} ms against ${BUDGET.seconds} s: ${judged.status}${judged.reason ? ` (${judged.reason})` : ''}`;
    console.log(`${ID} ${reading}`);
    expect(judged.status, reading).not.toBe('FAIL');
    if (judged.status !== 'PASS') inconclusive(reading);
  }, 2 * TIMEOUT);
});
