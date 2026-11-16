// AC3 #184.7131c480: "A twin whose exit is walled off fails with playtest.goal_missed, naming won, with no run reaching it"
//
// The walled twin's playtest, with criterion 1's input: a failure `goal won` whose message starts playtest.goal_missed
// and names won, and no run's maze.won is ever 1 in what its replica returned.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, TIMEOUT, WON, driveBin, failureOf, macOnly, none, openHub, playInput, putPiece, runPlaytest, runsOf, scalar, shown, word,
} from './helpers.ts';
import { POLICY, mazePiece, mazeProgram, routeBot, routeBotProgram } from './programs.ts';

describe(`${AC[3]} the twin whose exit is walled off fails with playtest.goal_missed`, () => {
  it(`${AC[3]} playtest.goal_missed names won, and no run reaches it`, async () => {
    macOnly();
    const piece = putPiece(DOC.walled, mazePiece(mazeProgram('walled')));
    const input = playInput(piece, [routeBot(routeBotProgram()), POLICY]);
    const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'loaded' });

    const result = await runPlaytest(hub, input);
    expect(result.outcome, `the walled twin's playtest fails: ${shown(result)}`).toBe('failed');
    const f = failureOf(result, 'goal won', 'playtest.goal_missed');
    expect(f, `a failure "goal won" starting playtest.goal_missed (${shown(result)})`).toBeDefined();
    expect(word('won').test(f!.message.slice('playtest.goal_missed'.length)), `it names won: ${f!.message}`).toBe(true);
    const reached = runsOf(pool.log, input).filter((r) => (r.play.reply['values'][WON] as unknown[]).some((v) => scalar(v) === 1)).map((r) => `bot ${r.b} run ${r.i}`);
    none(reached, 'runs that reached won');
  }, TIMEOUT);
});
