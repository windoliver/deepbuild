// AC11 #184.a01f1ce5: "A test check plug-in other than the playtest plays the clean maze through deep.canvas.play with
// the track of a recorded playtest run and gets the same track hash, values and final full-state hash as the playtest's
// own replay; a plug-in whose grant doesn't name the piece is refused; and a planted runner that reports PASS from the
// frames' hashes alone, with no values, is refused by the validator, naming the run"
//
// The playtest records one route-bot run of the clean maze (120 s) and replays it. The maze player (granted the clean
// maze; its input giving seed 184, 1 run and that run's recorded track) plays the track through deep.canvas.play and
// gets the playtest replay's track hash, values at the same paths and final hash, and its PASS with the track goes
// through. A maze player granted another document only is refused, naming the piece, and nothing is played. The planted
// runner asks no values and reports passed with its frames' hashes alone: refused, naming run 0.
import { describe, expect, it } from 'vitest';
import { AC, DOC, Pool, SEED, SPAN_S, TIMEOUT, canon, driveBin, macOnly, openHub, playInput, putPiece, runPlayer, runPlaytest, runSeed, runsOf, show, shown, word } from './helpers.ts';
import { mazePiece, mazeProgram, routeBot, routeBotProgram } from './programs.ts';

describe(`${AC[11]} another check plug-in plays a recorded track through deep.canvas.play as the playtest's replay does`, () => {
  it(`${AC[11]} same track hash, values and final hash as the playtest's replay; refused outside its grant; a PASS from frames alone refused naming the run`, async () => {
    macOnly();
    const piece = putPiece(DOC.clean, mazePiece(mazeProgram('clean')));
    const input = playInput(piece, [routeBot(routeBotProgram())], { runs: 1 });
    const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'loaded', player: { docs: [DOC.clean] } });

    const recorded = await runPlaytest(hub, input);
    expect(recorded.outcome, `the playtest of one run passes: ${shown(recorded)}`).toBe('passed');
    const [run] = runsOf(pool.log, input);
    const replay = run!.replays[0];
    expect(replay, 'the playtest replayed its run').toBeDefined();
    const track = run!.play.reply['entries'] as unknown[];
    const paths = Object.keys(replay!.reply['values'] as object);
    expect(paths.length, 'the playtest\'s replay read values').toBeGreaterThan(0);

    const given = { piece, seed: SEED, runs: 1, span: SPAN_S, tracks: [track] };
    const replayed = { piece, run: { seed: runSeed(SEED, 0), span: SPAN_S, track, values: paths, frames: [] } };
    const mine = await runPlayer(hub, given, { plays: [replayed], testsRun: 1, evidence: 'tracks' });
    const got = mine.seen[0]?.reply ?? {};
    expect(got['error'], 'the maze player\'s play goes through').toBeUndefined();
    expect(got['track'], 'the same track hash as the playtest\'s replay').toBe(replay!.reply['track']);
    expect(canon(got['values']), 'the same values').toBe(canon(replay!.reply['values']));
    expect(got['final'], 'the same final full-state hash').toBe(replay!.reply['final']);
    expect(mine.result.outcome, `its PASS with the track goes through: ${shown(mine.result)}`).toBe('passed');

    // The planted runner: no values asked, frames' hashes as its only evidence.
    const framesOnly = { piece, run: { seed: runSeed(SEED, 0), span: SPAN_S, track, values: [], frames: [0, 60] } };
    const planted = await runPlayer(hub, given, { plays: [framesOnly], testsRun: 1, evidence: 'frames' });
    expect(planted.result.outcome, `a PASS from frames alone is refused: ${shown(planted.result)}`).not.toBe('passed');
    expect(planted.result.failures.some((f) => word('run 0').test(f.message)), `the refusal names run 0: ${shown(planted.result)}`).toBe(true);

    // A grant that doesn't name the piece.
    const outside = await openHub({ pool, playtest: 'none', player: { docs: [DOC.other] } });
    const before = pool.log.length;
    const denied = await runPlayer(outside, given, { plays: [replayed], testsRun: 1, evidence: 'tracks' });
    const error = String(denied.seen[0]?.reply['error'] ?? '');
    expect(error, `refused outside the grant: ${show(denied.seen)}`).not.toBe('');
    expect(error, 'the refusal names the piece').toContain(DOC.clean);
    expect(pool.log.length, 'nothing was played').toBe(before);
  }, TIMEOUT);
});
