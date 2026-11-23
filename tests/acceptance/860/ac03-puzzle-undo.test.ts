// Criterion 3: "A puzzle that marks a stop at each move undoes 5 moves and reaches the same full-state hash as playing the
// first moves alone; rewinding past depth is refused, naming the depth; and a match refuses a rewind entry, naming the
// match"
//
// The puzzle (programs.ts) is the eight-tile sliding puzzle, each move made a stop, its rewind 5 stops deep. In a live
// `deep-logic` session (#531's open, step and append) it makes 8 moves at steps 10 to 80; a rewind of 6 stops is appended
// at step 90 and refused, naming the depth; a rewind of 5 is appended there and taken; at step 100 the session's
// full-state hash is compared with a session that played the first 3 moves alone. In the app (`deep-show run`), the
// puzzle as a lockstep match of two players (`net@1` item `duel`) plays its moves as a match, and the same track with a
// rewind is refused by the match, naming it (README: The surface).
import { describe, expect, it } from 'vitest';
import { live } from '../534/helpers.ts';
import { AC, TIMEOUT, appendCall, cargoRuns, logicBin, macOnly, openCall, prebuild, puzzleProgram, refusedWith, show, stepCall } from './helpers.ts';
import { DOC, present, presented, putEvidence, runShow, scenarioOf, useShowBin, useTemp } from './app.ts';
import { MATCH, MOVES, PUZZLE, PUZZLE_DEPTH, UNDO, UNDO_AT, WEB_STEPS, boardAfter, isRewind, moveEntries, puzzleDoc, puzzlePiece, rewindEntry, type Obj } from './programs.ts';

prebuild(() => { cargoRuns(); logicBin(); puzzleProgram(); });
const showBin = useShowBin(TIMEOUT);
const temp = useTemp();

/** The board and move count a session's `step` reply shows in its record of step `k`. */
function boardAt(reply: Obj, k: number, what: string): { board: number[]; moves: number } {
  expect(reply['ok'], `${what}: the session steps (ok: true): ${show(reply, 800)}`).toBe(true);
  const rec = (reply['steps'] as Obj[] | undefined)?.find((s) => s['step'] === k);
  expect(rec, `${what}: step ${k} ran (a move)`).toBeDefined();
  return { board: (rec!['arrays'][`${PUZZLE}.board`] as number[]).map(Number), moves: Number([rec!['arrays'][`${PUZZLE}.moves`]].flat()[0]) };
}

describe(`${AC[3]} a puzzle's undo is a rewind, held to its depth, and a match refuses it`, () => {
  it(`${AC[3]} the puzzle undoes 5 moves and reaches the full-state hash of playing the first moves alone; rewinding past depth is refused, naming the depth`, async () => {
    macOnly();
    cargoRuns();
    const piece = puzzlePiece(puzzleProgram());
    const firstMoves = MOVES.slice(0, MOVES.length - UNDO);
    const logic = live();
    try {
      // The fixture: 8 moves, each made, then the first 3 alone; boards by the test's own model.
      const all = await logic.call(openCall(piece, moveEntries(MOVES)) as never) as Obj;
      expect(all['ok'], `the 8-move session opens: ${show(all, 800)}`).toBe(true);
      const eight = await logic.call(stepCall(String(all['session']), 85) as never) as Obj;
      expect(boardAt(eight, 80, 'after 8 moves'), 'the 8 moves are all made').toEqual(boardAfter(MOVES));
      const alone = await logic.call(openCall(piece, moveEntries(firstMoves)) as never) as Obj;
      expect(alone['ok'], `the 3-move session opens: ${show(alone, 800)}`).toBe(true);
      const three = await logic.call(stepCall(String(alone['session']), 100) as never) as Obj;
      expect(boardAt(three, 30, 'the first 3 moves alone'), 'the first 3 moves alone').toEqual(boardAfter(firstMoves));
      const want = three['deep_hash']?.[PUZZLE];
      expect(want, 'the session reports its full-state hash').toMatch(/^[0-9a-f]{16}$/);
      expect(eight['deep_hash']?.[PUZZLE], 'after 8 moves the state differs from after 3').not.toBe(want);

      const past = await logic.call(appendCall(String(all['session']), rewindEntry(UNDO_AT, PUZZLE_DEPTH + 1)) as never) as Obj;
      refusedWith(past, 'rewind.past_depth', `a rewind of ${PUZZLE_DEPTH + 1} stops, past the depth of ${PUZZLE_DEPTH}`);
      expect(past['depth'], 'the refusal names the depth').toBe(PUZZLE_DEPTH);
      const undo = await logic.call(appendCall(String(all['session']), rewindEntry(UNDO_AT, UNDO)) as never) as Obj;
      expect(undo['ok'], `a rewind of 5 stops, at the depth, is taken: ${show(undo, 800)}`).toBe(true);
      const undone = await logic.call(stepCall(String(all['session']), 100) as never) as Obj;
      expect(undone['ok'], `the session steps on past the rewind: ${show(undone, 800)}`).toBe(true);
      expect(undone['deep_hash']?.[PUZZLE], `${AC[3]} undoing 5 of 8 moves reaches the full-state hash of the first 3 moves alone`).toBe(want);
      const rewinds = (undone['track'] as Obj[]).filter(isRewind);
      expect(rewinds.map((e) => e['rewind']?.['to']), 'the track holds the rewind taken and not the one refused').toEqual([{ stop: UNDO }]);
    } finally {
      logic.signal('SIGTERM');
    }
  }, TIMEOUT);

  it(`${AC[3]} a match refuses a rewind entry, naming the match`, () => {
    macOnly();
    cargoRuns();
    const program = puzzleProgram();
    const evidence = temp();
    putEvidence(evidence, program.bytes);
    const doc = DOC.match;
    const withRewind = [...moveEntries(MOVES), rewindEntry(UNDO_AT, UNDO)];
    const r = runShow(showBin(), scenarioOf({ evidence, docs: [doc], calls: [
      present(doc, puzzleDoc(doc, program.sha, { match: true })),
      { call: 'track', doc, load: moveEntries(MOVES) },
      { call: 'match', doc, steps: WEB_STEPS },
      { call: 'track', doc, load: withRewind },
      { call: 'match', doc, steps: WEB_STEPS },
    ] }), 'the puzzle as a lockstep match of two');
    presented(r[0], 'the puzzle for two, declaring its rewind beside its net@1 item');
    expect(r[1]!['code'], `the moves load as the document's track: ${show(r[1], 600)}`).toBeUndefined();
    expect(r[2]!['code'], `the match plays the moves: ${show(r[2], 800)}`).toBeUndefined();
    expect((r[2]!['copies'] as Obj[] | undefined)?.length, 'every copy of the match plays').toBe(2);
    expect(r[3]!['code'], `the app takes a recorded track holding a rewind: ${show(r[3], 600)}`).toBeUndefined();
    expect((r[3]!['track'] as Obj[] | undefined)?.some(isRewind), 'and lists the rewind on it').toBe(true);
    expect([r[4]!['code'], r[4]!['match']], `${AC[3]} the match refuses the rewind entry, naming the match: ${show(r[4], 800)}`).toEqual(['rewind.in_match', MATCH]);
    expect(r[4]!['copies'], 'and plays no copy').toBeUndefined();
  }, TIMEOUT);
});
