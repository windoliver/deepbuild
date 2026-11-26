// AC1 #1047.310638fa: "A playtest of the clean maze `from` a save written at step 1,800 starts each of its 20 runs at
// step 1,800 with the save's full-state hash, which equals a straight run's at that step, and each run's track replays
// from the save to the same hashes; a planted runner that starts at step 0 fails, naming the run and its first step"
//
// The logic module writes the save: `deep-logic` bakes the clean maze over four recorded presses and the maze asks for
// slot 1 at the end of step 1,799, so the save is at step 1,800 with the token on (3, 1). Its asset ID is its SHA-256,
// and the hub hands its bytes to the replica with every play, as it hands a bot's program. The save's full-state
// hash is formed from its own header as a play forms one, and a straight run, the maze played in a replica from
// step 0 on the same presses for 1,800 steps, must end on it. The playtest plug-in then runs the playtest, its input
// naming the save, through runCheck on two debug replicas, and its PASS is read with what the replicas played: each
// of the 20 runs given the save and starting at step 1,800 with that hash, and each run's recorded track played
// again without its bot, from the same save, to the run's checkpoints and final hash.
//
// The planted runner is #184's maze player, a check plug-in other than the playtest, run on the same check input: it
// plays each of the 20 runs with its bot and its values and reports passed with every run's track, as the shipped
// runner does, but gives no play the save, so each starts at step 0. Its PASS must be refused, naming each run and
// its first step. The wrong programs: the base (where `from` does nothing, so every run starts at step 0), and this
// planted runner.
import { describe, expect, it } from 'vitest';
import {
  DOC, MEASURE, Pool, RUNS, SEED, SPAN_S, TIMEOUT, WON, driveBin, keepAsset, macOnly, none, openHub, playInput, putPiece, runPlayer, runPlaytest, runSeed, runsOf,
  saveOf, scalar, show, shown, type Hub, type Obj,
} from './helpers.ts';
import { notFromSave, notPlayedOn, notRefusedAtStart, replayDiffers, stoodStill, type SaveAt } from './judges.ts';
import { SAVED_AT, SAVED_CELL, SAVED_PRESSES, SAVE_TRACK, mazePiece, mazeProgram } from './programs.ts';
import { ROUTE, routeBot, routeBotProgram } from '../184/programs.ts';

interface Stage { pool: Pool; hub: Hub; body: Obj; piece: string; bot: Obj; input: Obj; save: SaveAt }
let staged: Promise<Stage> | undefined;
/** The clean maze, its save at step 1,800 kept as a hub asset, two replicas, and a hub with the playtest and the maze player. */
const stage = (): Promise<Stage> => (staged ??= (async () => {
  const body = mazePiece(mazeProgram());
  const piece = putPiece(DOC, body);
  const saved = saveOf(body, 'the clean maze');
  keepAsset({ sha: saved.id, b64: saved.b64 });
  const bot = routeBot(routeBotProgram());
  const input = playInput(piece, [bot], { from: { save: saved.id } });
  const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
  const hub = await openHub(pool, { player: true });
  return { pool, hub, body, piece, bot, input, save: { id: saved.id, step: SAVED_AT, hash: saved.hash } };
})());

describe('AC1 #1047.310638fa a playtest of the clean maze from a save written at step 1,800 starts every run there', () => {
  it('AC1 #1047.310638fa each of the 20 runs starts at step 1,800 with the save\'s full-state hash, which a straight run reaches at that step, and its track replays from the save to the same hashes', async () => {
    macOnly();
    const s = await stage();

    // The straight run: the maze played from step 0 on the save's presses, in a replica, for 1,800 steps.
    const straight = await s.pool.play({ piece: s.body, seed: SEED, span: { steps: SAVED_AT }, track: SAVE_TRACK, values: [MEASURE, 'maze.presses'], frames: [] });
    expect(straight['ok'], `the straight run plays: ${show(straight, 800)}`).toBe(true);
    const last = { steps: straight['steps'], cell: straight['values'][MEASURE]?.[SAVED_AT - 1], presses: scalar(straight['values']['maze.presses']?.[SAVED_AT - 1]) };
    expect(last, 'the fixture: after 1,800 steps the token stands on (3, 1) with 4 presses counted, not where it started').toEqual({ steps: SAVED_AT, cell: SAVED_CELL, presses: SAVED_PRESSES });
    expect(straight['final'], 'the save\'s full-state hash equals a straight run\'s at step 1,800').toBe(s.save.hash);
    const zero = (straight['checkpoints'] as Obj[])[0];
    expect(zero?.['step'], 'a play that starts at step 0 says so in its first checkpoint').toBe(0);
    expect(zero?.['hash'], 'and its full-state hash there is another than the save\'s: the hashes differ where the state does').not.toBe(s.save.hash);

    const from = s.pool.log.length;
    const result = await runPlaytest(s.hub, s.input);
    expect(result.outcome, `the clean maze's playtest from the save passes: ${shown(result)}`).toBe('passed');
    expect(result.testsRun, 'testsRun counts its 20 runs').toBe(RUNS);

    // The 20 runs as the replicas played them (runsOf fails on one the log lacks), each with its replays.
    const runs = runsOf(s.pool.log.slice(from), s.input);
    expect(runs.length, 'its 20 runs').toBe(RUNS);
    none(notFromSave(runs, s.save), 'each of the 20 runs starts at step 1,800 with the save\'s full-state hash');
    none(notPlayedOn(runs, 'arrow', ROUTE.slice(SAVED_PRESSES)), 'each run plays on from the state the save holds: from (3, 1) the route bot presses the route\'s last six');
    none(stoodStill(runs, s.save), 'each run played on from the save, so its hashes compare more than its start');
    none(replayDiffers(runs, s.save), 'each run\'s track replays from the save to the same hashes');
  }, TIMEOUT);

  it('AC1 #1047.310638fa a planted runner that starts each run at step 0 fails, naming the run and its first step', async () => {
    macOnly();
    const s = await stage();

    // The same check input, each of its 20 runs played with its bot and its values, with no save given.
    const plays = Array.from({ length: RUNS }, (_, i) => ({ piece: s.piece, run: { seed: runSeed(SEED, i), span: SPAN_S, bot: s.bot, values: [MEASURE, WON], frames: [] } }));
    const planted = await runPlayer(s.hub, s.input, { plays, testsRun: RUNS, evidence: 'tracks' });
    const starts = planted.seen.map((p) => (Array.isArray(p.reply['checkpoints']) ? (p.reply['checkpoints'] as Obj[])[0]?.['step'] : `no play: ${String(p.reply['error'])}`));
    expect(starts, 'the planted runner is the wrong program it is named for: each of its 20 runs was played, from step 0').toEqual(Array.from({ length: RUNS }, () => 0));

    none(notRefusedAtStart(planted.result, plays.map((_, i) => i), 0), `the planted runner's PASS is refused, naming each run and its first step: ${shown(planted.result)}`);
  }, TIMEOUT);
});
