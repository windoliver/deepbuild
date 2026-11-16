// AC5 #184.430caa9a: "A twin that steps its logic at 240 Hz with 9,000,000 fuel of work a step fails with
// playtest.over_budget, naming the first step whose fuel passed the ceiling, its fuel and the ceiling, the same on every
// machine, while the clean maze's busiest step stays within its ceiling"
//
// The heavy twin: the maze at 240 Hz whose every step burns 9,000,000 fuel or more (sized by the logic module's own
// bakes), with a fuel budget of 10,000,000 so it never traps. A figure item at 240 Hz is held to ⌊4 ms × 0.75 ÷ 4 ÷
// the metering record's ns per fuel⌋ = 3,000,000 fuel a step. Its playtest (both bots, 2 runs each, 240 steps) fails
// every run with playtest.over_budget at step 0, naming the step, its fuel and the ceiling as plain integers. "The same
// on every machine": every step's fuel the replica reports is the logic module's bake of the same piece and the run's
// recorded track, which counts fuel and times nothing. The clean maze, played by the route bot for 120 s, never
// passes its 60 Hz ceiling.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, SEED, SPAN_S, TIMEOUT, canon, ceiling, driveBin, failureOf, macOnly, none, openHub, playInput, played, putPiece, runPlaytest,
  runsOf, shown, word,
} from './helpers.ts';
import { HEAVY_FUEL, POLICY, heavyMaze, mazePiece, mazeProgram, routeBot, routeBotProgram } from './programs.ts';
import { bakeCall, onLogic } from '../533/helpers.ts';

const HEAVY_STEPS = 240;

describe(`${AC[5]} the 240 Hz twin with 9,000,000 fuel a step fails with playtest.over_budget`, () => {
  it(`${AC[5]} each run names step 0, its fuel and the 240 Hz ceiling, from fuel alone; the clean maze's busiest step stays within its ceiling`, async () => {
    macOnly();
    const heavy = heavyMaze();
    const heavyPiece = mazePiece(heavy.program, { hz: 240, fuel: 10_000_000 });
    const piece = putPiece(DOC.heavy, heavyPiece);
    const bot = routeBot(routeBotProgram());
    const input = playInput(piece, [bot, POLICY], { runs: 2, span: { steps: HEAVY_STEPS } });
    const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'loaded' });

    const result = await runPlaytest(hub, input);
    expect(result.outcome, `the heavy twin's playtest fails: ${shown(result)}`).toBe('failed');
    const limit = ceiling(240);
    expect(limit, 'a 240 Hz figure item\'s ceiling').toBe(3_000_000);
    const gaps: string[] = [];
    for (const r of runsOf(pool.log, input)) {
      const name = `bot ${r.b} run ${r.i}`;
      const reply = r.play.reply;
      const fuel = reply['fuel']['maze'] as number[];
      if (reply['ceilings']['maze'] !== limit) gaps.push(`${name}: the replica holds the maze to ${String(reply['ceilings']['maze'])}, not ${limit}`);
      if (fuel.length !== HEAVY_STEPS) gaps.push(`${name}: fuel for ${fuel.length} steps, not ${HEAVY_STEPS}`);
      if (!(fuel[0]! >= HEAVY_FUEL)) gaps.push(`${name}: step 0 spends ${fuel[0]} fuel, under 9,000,000`);
      // The logic module's bake of the piece alone on the run's recorded track: the same fuel at every step.
      const [baked] = onLogic([bakeCall(heavyPiece as never, reply['entries'], HEAVY_STEPS)]) as { steps: { items: { maze: { fuel: number } } }[] }[];
      const own = baked!.steps.map((s) => s.items.maze.fuel);
      if (canon(own) !== canon(fuel)) gaps.push(`${name}: the replica's fuel isn't the logic module's bake of the same track (first steps ${canon(fuel.slice(0, 4))} against ${canon(own.slice(0, 4))})`);
      const f = failureOf(result, name, 'playtest.over_budget');
      if (!f) { gaps.push(`${name}: no playtest.over_budget failure`); continue; }
      for (const text of ['step 0', String(fuel[0]), String(limit)]) if (!word(text).test(f.message)) gaps.push(`${name}: its failure doesn't name ${text}: ${f.message}`);
    }
    none(gaps, 'each run of the heavy twin');

    // The clean maze at 60 Hz, its busiest step against its ceiling.
    const clean = putPiece(DOC.clean, mazePiece(mazeProgram('clean')));
    const reply = played(await pool.play({ piece: mazePiece(mazeProgram('clean')), seed: SEED, span: SPAN_S, bot, values: [], frames: [] }, clean), 'the clean maze');
    expect(reply['ceilings']['maze'], 'a 60 Hz figure item\'s ceiling').toBe(ceiling(60));
    expect(Math.max(...(reply['fuel']['maze'] as number[])), 'the clean maze\'s busiest step stays within its ceiling').toBeLessThanOrEqual(ceiling(60));
  }, TIMEOUT);
});
