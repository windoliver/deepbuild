// AC10 #184.396b3e5c: "A logic bot that writes north with a new serial on two steps in a row sends two entries and moves
// the maze's token two cells, and one that keeps the serial sends none; a planted replica that makes an entry only when
// the value changes moves the token one cell and fails the maze's two-press fixture, naming the step of the missing
// entry"
//
// Plays of the clean maze in a replica, 30 steps, no plug-in. The two-press bot writes [north, 1] at its step 2 and
// [north, 2] from its step 3 on; each new serial is one entry stamped at the bot's next step, so `arrow` gets north at
// steps 3 and 4 and the token goes (0, 0) → (0, 1) at step 3 → (0, 2) at step 4. The keep-serial bot writes [north, 0],
// the write region's first serial, every step: no entry, the token stays. The two-press fixture's judge reads a play
// of the two-press bot; on a replica planted with DEEP_DRIVE_PLANT=entry-on-change it fails, naming step 4.
import { describe, expect, it } from 'vitest';
import { AC, MEASURE, Pool, SEED, STEP_60, TIMEOUT, canon, driveBin, macOnly, none, played, type Obj } from './helpers.ts';
import { NORTH, keepSerialBotProgram, logicBot, mazePiece, mazeProgram, twoPressBotProgram } from './programs.ts';

const STEPS = 30;

/** The maze's two-press fixture: entries of north at steps 3 and 4, the token at (0, 1) from step 3 and (0, 2) from step 4. */
function twoPressFailures(reply: Obj): string[] {
  const failures: string[] = [];
  const entries = reply['entries'] as Obj[];
  for (const step of [3, 4]) {
    const at = entries.filter((e) => e['t'] === step * STEP_60 && e['control'] === 'arrow' && e['value'] === NORTH && e['writer'] === 'bot');
    if (at.length !== 1) failures.push(`the two-press fixture has ${at.length} bot entries of north at step ${step}, not 1`);
  }
  if (entries.length !== 2) failures.push(`the two-press fixture's track holds ${entries.length} entries, not 2`);
  const cells = reply['values'][MEASURE] as unknown[];
  for (const [step, cell] of [[2, [0, 0]], [3, [0, 1]], [4, [0, 2]], [STEPS - 1, [0, 2]]] as const) {
    if (canon(cells[step]) !== canon(cell)) failures.push(`the two-press fixture's token is at ${canon(cells[step])} at step ${step}, not ${canon(cell)}`);
  }
  return failures;
}

describe(`${AC[10]} a logic bot's new serials are its entries, one each`, () => {
  it(`${AC[10]} two new serials send two entries and move the token two cells; a kept serial sends none; an entry-on-change replica fails the two-press fixture naming step 4`, async () => {
    macOnly();
    const body = mazePiece(mazeProgram('clean'));
    const two = logicBot(twoPressBotProgram());
    const keep = logicBot(keepSerialBotProgram());
    const play = (bot: Obj): Obj => ({ piece: body, seed: SEED, span: { steps: STEPS }, bot, values: [MEASURE], frames: [] });
    const pool = await Pool.open([{ bin: driveBin('debug') }]);
    const planted = await Pool.open([{ bin: driveBin('debug'), plant: 'entry-on-change' }]);

    const twice = played(await pool.play(play(two)), 'the two-press bot');
    none(twoPressFailures(twice), 'the two-press bot on the replica');

    const kept = played(await pool.play(play(keep)), 'the keep-serial bot');
    expect(kept['entries'], 'a bot that keeps its serial sends no entry').toEqual([]);
    expect((kept['values'][MEASURE] as unknown[]).every((c) => canon(c) === canon([0, 0])), 'and the token stays at (0, 0)').toBe(true);

    const once = played(await planted.play(play(two)), 'the two-press bot on the planted replica');
    expect(canon((once['values'][MEASURE] as unknown[])[STEPS - 1]), 'the planted replica moves the token one cell').toBe(canon([0, 1]));
    const failures = twoPressFailures(once);
    expect(failures.some((f) => /\bstep 4\b/.test(f)), `the two-press fixture fails on it, naming step 4: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
