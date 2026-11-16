// AC9 #184.1d76cea0: "A playtest whose only bot the working agent wrote leaves its requirement INCONCLUSIVE with one ask
// when it passes, as the agent's own checks do, and the same bot taken from the definition passes it"
//
// The clean maze's playtest by the route bot alone (3 runs of 120 s), twice: once with the bot marked as the working
// agent's (`by: "agent"`), once as the definition gives it. Both runs pass. The plug-in's `playtestSource` gives the
// check's source for each input, and the verdict engine judges the requirement the check covers: INCONCLUSIVE with one
// ask for the agent's bot, PASS for the definition's.
import { describe, expect, it } from 'vitest';
import { AC, DOC, Pool, TIMEOUT, driveBin, judge, macOnly, openHub, playInput, playtestEntry, putPiece, runPlaytest, show, shown } from './helpers.ts';
import { mazePiece, mazeProgram, routeBot, routeBotProgram } from './programs.ts';

describe(`${AC[9]} a playtest whose only bot the working agent wrote can't pass its requirement alone`, () => {
  it(`${AC[9]} the agent's bot passes and leaves the requirement INCONCLUSIVE with one ask; the definition's same bot passes it`, async () => {
    macOnly();
    const piece = putPiece(DOC.clean, mazePiece(mazeProgram('clean')));
    const bot = routeBot(routeBotProgram());
    const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'loaded' });
    const { playtestSource } = await playtestEntry();

    const agents = playInput(piece, [{ ...bot, by: 'agent' }], { runs: 3 });
    const own = await runPlaytest(hub, agents);
    expect(own.outcome, `the agent's bot's playtest passes: ${shown(own)}`).toBe('passed');
    expect(playtestSource(agents), 'a playtest whose only bot the agent wrote is the agent\'s own check').toBe('own');
    const v1 = judge(own, playtestSource(agents));
    expect(v1.requirements[0]?.outcome, `its requirement: ${show(v1.reasons)}`).toBe('INCONCLUSIVE');
    expect(v1.asks.length, `with one ask: ${show(v1.asks)}`).toBe(1);

    const definitions = playInput(piece, [bot], { runs: 3 });
    const theirs = await runPlaytest(hub, definitions);
    expect(theirs.outcome, `the definition's bot's playtest passes: ${shown(theirs)}`).toBe('passed');
    expect(playtestSource(definitions), 'a playtest whose bot the definition gives is the definition\'s check').toBe('definition');
    const v2 = judge(theirs, playtestSource(definitions));
    expect(v2.requirements[0]?.outcome, `its requirement: ${show(v2.reasons)}`).toBe('PASS');
  }, TIMEOUT);
});
