// AC2 #1164.fb851e24: "deep_query reads `rules.board` and `rules.winner` at each press's step, the first at or after
// its flick: the press on a taken cell and the press after the win change nothing, `rules.winner` reads 1 from step
// 180, and the board ends [1, 1, 1, 2, 2, 0, 0, 0, 0]. A planted program that takes a press on a taken cell writes 2 to
// cell 1 at step 60 and fails, naming the step and the array"
//
// asserts: the game played with keys in the app (README: The play); each key appends one entry on its control; then
// deep_query's logic read of `rules` at every step of the 12 s (360 steps), its region map first (the layout the
// program reads). At each press's step (the first at or after its entry's flick) `rules.board` and `rules.winner` read
// the issue's values; the taken-cell press and the press after the win read what the step before read; `rules.winner`
// reads 0 before step 180 and 1 from it; the board ends [1, 1, 1, 2, 2, 0, 0, 0, 0]. Wrong program: the
// `takes_taken_cell` build, whose judgement fails at step 60 naming `rules.board`.
import { describe, it } from 'vitest';
import {
  AC, FINAL, PRESSES, STEPS, Script, TIMEOUT, failsNaming, game, keepProof, layoutFailures, none, prebuild, pressName, program, putEvidence,
  queryCall, readOf, runShow, same, scalar, scenario, show, showBin, stepOf, playedOf, useDir, type Read, type Rules,
} from './helpers.ts';

prebuild(() => { showBin(); program('rules'); program('takes_taken_cell'); });
const dir = useDir();
const ALL = Array.from({ length: STEPS }, (_, k) => k);

/** AC2's judgement of deep_query's reads, given each press's step. */
function judge(read: Read, steps: number[]): string[] {
  const out = layoutFailures(read.regionMap, AC[2]);
  const board = (k: number): unknown => read.steps.get(k)?.board;
  const winner = (k: number): unknown => scalar(read.steps.get(k)?.winner);
  PRESSES.forEach((p, i) => {
    const k = steps[i]!;
    const [b, w] = p.same ? [board(k - 1), winner(k - 1)] : [p.board, p.winner];
    const why = p.same ? `unchanged from step ${k - 1}` : `${p.who} on cell ${p.key}`;
    if (!same(board(k), b)) out.push(`${AC[2]} step ${k} (${pressName(p)}): rules.board reads ${show(board(k))}, expected ${show(b)} (${why})`);
    if (!same(winner(k), w)) out.push(`${AC[2]} step ${k} (${pressName(p)}): rules.winner reads ${show(winner(k))}, expected ${show(w)} (${why})`);
  });
  const late = ALL.find((k) => !same(winner(k), k >= 180 ? 1 : 0));
  if (late !== undefined) out.push(`${AC[2]} step ${late}: rules.winner reads ${show(winner(late))}, expected ${late >= 180 ? 1 : 0} (1 from step 180)`);
  if (!same(board(STEPS - 1), FINAL)) out.push(`${AC[2]} step ${STEPS - 1}: rules.board ends ${show(board(STEPS - 1))}, not ${show(FINAL)}`);
  return out;
}

function playAndRead(name: Rules, what: string): string[] {
  const p = program(name);
  putEvidence(dir(), p.bytes);
  const s = new Script(game(p.sha));
  const q = s.add((at) => queryCall(at, ALL));
  const r = runShow(scenario(dir(), s.calls), what);
  const entries = playedOf(r, s, what);
  const read = readOf(r[q]!, `${what}: deep_query`);
  keepProof(`ac2-${name}.json`, { entries: entries.map((e) => e.raw), query: r[q] });
  return judge(read, entries.map((e) => stepOf(e.t)));
}

describe(`${AC[2]} the board and the winner at each press's step`, () => {
  it(`${AC[2]} deep_query reads rules.board and rules.winner at each press's step: the taken cell and the press after the win change nothing, the winner reads 1 from step 180, the board ends [1, 1, 1, 2, 2, 0, 0, 0, 0]`, () => {
    none(playAndRead('rules', 'AC2: the game'), 'AC2: deep_query reads the issue\'s board and winner');
  }, TIMEOUT);

  it(`${AC[2]} wrong program: a program that takes a press on a taken cell (takes_taken_cell) writes 2 to cell 1 at step 60 and fails, naming the step and the array`, () => {
    failsNaming(playAndRead('takes_taken_cell', 'AC2: the program that takes a taken cell'), AC[2], [/\bstep 60\b/, /rules\.board/], 'AC2: takes_taken_cell');
  }, TIMEOUT);
});
