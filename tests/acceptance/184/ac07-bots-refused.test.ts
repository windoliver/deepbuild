// AC7 #184.25600094: "A logic bot that traps makes its run INVALID, and the check can't pass with it; and a policy that
// names a control the piece doesn't declare is refused before any run, naming the control"
//
// On the clean maze: a logic bot that divides by zero at its step 5 (3 runs of 120 s); each run's replica reports the
// bot's trap apart from the piece's, each run's failure (`bot 0 run <i>`) says it's invalid, and the check doesn't pass.
// Then a policy that picks values for `jump`, which the maze doesn't declare: the check doesn't pass, a failure names
// jump, and no replica played anything for it.
import { describe, expect, it } from 'vitest';
import { AC, DOC, Pool, TIMEOUT, canon, driveBin, macOnly, none, openHub, playInput, putPiece, runPlaytest, runsOf, shown, word } from './helpers.ts';
import { logicBot, mazePiece, mazeProgram, trapBotProgram } from './programs.ts';

describe(`${AC[7]} a trapping logic bot makes its run INVALID; a policy naming an undeclared control is refused before any run`, () => {
  it(`${AC[7]} every run of the trapping bot is invalid and the check fails; the policy on jump is refused naming jump, with no play`, async () => {
    macOnly();
    const piece = putPiece(DOC.clean, mazePiece(mazeProgram('clean')));
    const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'loaded' });

    const input = playInput(piece, [logicBot(trapBotProgram())], { runs: 3 });
    const result = await runPlaytest(hub, input);
    expect(result.outcome, `a playtest whose bot traps doesn't pass: ${shown(result)}`).not.toBe('passed');
    const gaps: string[] = [];
    for (const r of runsOf(pool.log, input)) {
      const name = `bot 0 run ${r.i}`;
      const trap = r.play.reply['bot_trap'];
      if (trap === null || typeof trap !== 'object' || trap['step'] !== 5) gaps.push(`${name}: the replica reports no bot trap at the bot's step 5: ${canon(trap)}`);
      if (r.play.reply['trap'] !== null) gaps.push(`${name}: the bot's trap is reported as the piece's: ${canon(r.play.reply['trap'])}`);
      if (!result.failures.some((f) => f.test === name && /\binvalid\b/i.test(f.message))) gaps.push(`${name}: no failure says the run is invalid`);
    }
    none(gaps, 'each run of the trapping bot');

    const before = pool.log.length;
    const jump = playInput(piece, [{ policy: { pick: { jump: { from: [1], every: 0.25 } } } }]);
    const refused = await runPlaytest(hub, jump);
    expect(refused.outcome, `a policy on an undeclared control doesn't pass: ${shown(refused)}`).not.toBe('passed');
    expect(refused.failures.some((f) => word('jump').test(f.message)), `a failure names jump: ${shown(refused)}`).toBe(true);
    expect(pool.log.length, 'no replica played anything for it').toBe(before);
  }, TIMEOUT);
});
