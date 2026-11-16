// AC7 #184.25600094: "A logic bot that traps makes its run INVALID, and the check can't pass with it; and a policy that
// names a control the piece doesn't declare is refused before any run, naming the control"
//
// Blind redraft of criterion 7, on the first suite's surface (tests/acceptance/184/README.md: The surface) and its
// helpers and programs, imported read-only. Clause 1 plays the clean maze with the route bot beside the trap bot, so
// the goal is reached and nothing gets stuck within the span: the trap bot's invalid runs are the only thing between the
// check and a pass, and the route bot alone, with the same input, passes it. Clause 2 reads "before any run" as the
// replica getting no play call at all, for any bot of the check, with testsRun 0.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, TIMEOUT, driveBin, failureOf, judge, macOnly, none, openHub, playInput, putPiece, runPlaytest, runsOf, show, shown, word,
} from '../184/helpers.ts';
import { logicBot, mazePiece, mazeProgram, routeBot, routeBotProgram, trapBotProgram } from '../184/programs.ts';

/** Fewer runs and a short span (README of the first suite: fewer runs where a criterion names none). 5 s is 300 steps at
 * 60 Hz: the route bot reaches won by step 40, and no run can stay 10 s without moving, so nothing is stuck. */
const SHORT = { runs: 3, span: 5 };
const INVALID = /\binvalid\b/i;

describe(`${AC[7]} a trapping logic bot and a policy on an undeclared control`, () => {
  it(`${AC[7]} a logic bot that traps makes its run INVALID, and the check can't pass with it`, async () => {
    macOnly();
    const piece = putPiece(DOC.clean, mazePiece(mazeProgram('clean')));
    const route = routeBot(routeBotProgram());
    const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'loaded' });

    // The same input with the route bot alone passes, so a failure below is the trap bot's.
    const alone = await runPlaytest(hub, playInput(piece, [route], SHORT));
    expect(alone.outcome, `the route bot alone passes this input: ${shown(alone)}`).toBe('passed');

    const from = pool.log.length;
    const input = playInput(piece, [route, logicBot(trapBotProgram())], SHORT);
    const result = await runPlaytest(hub, input);
    expect(result.outcome, `the check with a trapping bot doesn't pass: ${shown(result)}`).not.toBe('passed');
    const v = judge(result, 'definition');
    expect(v.requirements[0]?.outcome, `its requirement isn't PASS: ${show(v.reasons)}`).not.toBe('PASS');

    const gaps: string[] = [];
    for (const r of runsOf(pool.log.slice(from), input)) {
      const name = `bot ${r.b} run ${r.i}`;
      const reply = r.play.reply;
      const mine = result.failures.filter((f) => f.test === name);
      if (r.b === 0) {
        if (mine.length) gaps.push(`${name}: the route bot's run fails: ${mine.map((f) => f.message).join(' | ')}`);
        continue;
      }
      const trap = reply['bot_trap'];
      if (trap === null || typeof trap !== 'object') { gaps.push(`${name}: its replica reports no bot_trap: ${show(reply['bot_trap'])}`); continue; }
      if (trap['item'] !== 'bot' || Number(trap['step']) !== 5) gaps.push(`${name}: the bot's trap isn't item bot at step 5: ${show(trap)}`);
      if (reply['trap'] !== null) gaps.push(`${name}: the bot's trap is reported as the piece's: ${show(reply['trap'])}`);
      if (!mine.some((f) => INVALID.test(f.message))) gaps.push(`${name}: no failure says the run is invalid: ${show(mine)}`);
      if (failureOf(result, name, 'playtest.trap')) gaps.push(`${name}: the bot's trap fails the run as the piece's playtest.trap`);
    }
    none(gaps, 'each run of the trap bot is invalid, and only those');
  }, TIMEOUT);

  it(`${AC[7]} a policy that names a control the piece doesn't declare is refused before any run, naming the control`, async () => {
    macOnly();
    const piece = putPiece(DOC.clean, mazePiece(mazeProgram('clean')));
    // The maze declares one control, arrow. The policy also picks jump; a valid bot sits beside it, so a refusal made
    // only when the policy's own runs reach the replica still plays the route bot's runs and is caught.
    const policy = { policy: { pick: { arrow: { from: [1, 2, 3, 4], every: 0.25 }, jump: { from: [0, 1], every: 0.25 } } } };
    const input = playInput(piece, [routeBot(routeBotProgram()), policy], SHORT);
    const pool = await Pool.open([{ bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'loaded' });

    const result = await runPlaytest(hub, input);
    expect(pool.log.map((p) => show(p.call, 200)), 'no play reached the replica: the refusal comes before any run').toEqual([]);
    expect(result.outcome, `the playtest doesn't pass: ${shown(result)}`).not.toBe('passed');
    expect(result.testsRun, `no run is counted: ${shown(result)}`).toBe(0);
    expect(result.failures.some((f) => word('jump').test(f.message)), `a failure names the control jump: ${shown(result)}`).toBe(true);
    const v = judge(result, 'definition');
    expect(v.requirements[0]?.outcome, `its requirement isn't PASS: ${show(v.reasons)}`).not.toBe('PASS');
  }, TIMEOUT);
});
