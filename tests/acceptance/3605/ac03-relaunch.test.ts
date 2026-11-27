// AC3 #3605.e582fe2c: "With the profile record of #1050, a relaunch shows the same marks with nothing opened by hand.
// Start fresh shows every mark clear for that run and leaves the record. A planted shell that keeps `done` in a run's
// save loses the marks on a new run and fails, naming the level."
//
// The fixture shell's `relaunch` journey (README: The relaunch journey, chosen, as #1050 isn't on the base) with keys at
// the reference window: four plays in one profile store that starts empty. The first launch plays the input's moves,
// which complete level 1 (fuses) and level 4 (circuits); then a relaunch, a start fresh and a relaunch again, each with
// no moves (`shell.launch`: first, relaunch, fresh, relaunch). The check passes. The first launch starts with every mark
// clear and ends with done [0, 1, 0, 0, 1, 0]. Each relaunch holds those marks from its first row, its shell track holds
// no entry (nothing opened by hand), and its level select shows Done on rows 1 and 4 and the counts "1 of 3" and
// "1 of 3". The start fresh holds every mark clear at every row and its level select shows To do on every row; the
// relaunch after it holds the marks again, so start fresh left the record.
// On a replica planted with DEEP_DRIVE_PLANT=done-in-save (the shell keeps `done` in the run's save, not in its profile
// record), the relaunch starts with no mark, and the check fails with a failure naming level 1 or level 4.
// The wrong programs: the base (no profile record for the shell), a shell that keeps `done` only in the run (the twin),
// a relaunch that needs a save opened by hand, a start fresh that keeps the marks or deletes the record, and a check
// that never relaunches.
import { describe, expect, it } from 'vitest';
import { AC, DOC, TIMEOUT, doneOf, failed, hubOnce, journeysInput, macOnly, namesLevel, none, passed, playsOf, putShell, runJourneys, show, shown, shellReply, stepped, word, type Move, type ShellReply } from './helpers.ts';
import { LEVEL_NAMES, MARK, allPrograms, complete, programs, shellDocument } from './shell.ts';

const clean = hubOnce();
const planted = hubOnce({ plant: 'done-in-save' });
const MOVES: Move[] = [{ activate: 'levels_button' }, ...complete(1), ...complete(4)];
const MARKED = '010010';

/** The relaunch journey's plays in the order played, each with its launch. */
function launches(h: Awaited<ReturnType<typeof clean>>, piece: string): { launch: string; reply: ShellReply }[] {
  return playsOf(h.pool, piece, 'relaunch', 'keys').map((p, i) => ({ launch: String(p.call['shell']?.['launch']), reply: shellReply(p.reply, `relaunch play ${i}`) }));
}

describe(`${AC[3]} the marks come back on a relaunch from the shell's profile record; start fresh clears them for its run and keeps the record`, () => {
  it(`${AC[3]} a relaunch shows the same marks with nothing opened by hand, and start fresh shows them clear and leaves the record`, async () => {
    macOnly();
    const p = programs();
    const h = await clean();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    passed(await runJourneys(h, journeysInput(piece, { journeys: ['relaunch'], moves: MOVES })), 'the relaunch journey with keys');
    const plays = launches(h, piece);
    expect(plays.map((x) => x.launch), 'the relaunch journey plays a first launch, a relaunch, a start fresh and a relaunch, in that order').toEqual(['first', 'relaunch', 'fresh', 'relaunch']);
    const [first, again, fresh, after] = plays.map((x, i) => ({ rows: stepped(x.reply, `the ${x.launch} play (${i})`), reply: x.reply }));
    const gaps: string[] = [];
    if (doneOf(first!.rows[0]!) !== '000000') gaps.push(`the first launch starts with done ${doneOf(first!.rows[0]!)}, not every mark clear (the store starts empty)`);
    if (doneOf(first!.rows.at(-1)!) !== MARKED) gaps.push(`the first launch ends with done ${doneOf(first!.rows.at(-1)!)}, not ${MARKED}`);
    for (const [name, run] of [['the relaunch', again!], ['the relaunch after start fresh', after!]] as const) {
      const off = run.rows.find((r) => doneOf(r) !== MARKED);
      if (off) gaps.push(`${name} holds done ${doneOf(off)} at step ${off.step}, not the first launch's ${MARKED}`);
      if (run.reply.track.length) gaps.push(`${name}'s shell track holds ${run.reply.track.length} entries, not none: ${show(run.reply.track, 300)}`);
      const texts = run.reply.screens.levels?.texts ?? {};
      for (const i of [1, 4]) if (texts[`row_${i}_done`] !== MARK.done) gaps.push(`${name}'s level select shows ${show(texts[`row_${i}_done`])} on row ${i}, not ${MARK.done}`);
      for (const c of ['ch1_count', 'ch2_count']) if (!word('1 of 3').test(texts[c] ?? '')) gaps.push(`${name}'s ${c} reads ${show(texts[c])}, not 1 of 3`);
    }
    const marked = fresh!.rows.find((r) => r.done.some(Boolean));
    if (marked) gaps.push(`start fresh holds done ${doneOf(marked)} at step ${marked.step}, not every mark clear`);
    const freshTexts = fresh!.reply.screens.levels?.texts ?? {};
    for (let i = 0; i < LEVEL_NAMES.length; i++) if (freshTexts[`row_${i}_todo`] !== MARK.todo) gaps.push(`start fresh's level select shows ${show(freshTexts[`row_${i}_todo`])} on row ${i}, not ${MARK.todo}`);
    none(gaps, 'the four launches\' rows and level selects');
  }, TIMEOUT);

  it(`${AC[3]} a planted shell that keeps done in a run's save loses the marks on a new run and fails, naming the level`, async () => {
    macOnly();
    const p = programs();
    const h = await planted();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['relaunch'], moves: MOVES }));
    const plays = launches(h, piece);
    const relaunch = plays.find((x) => x.launch === 'relaunch');
    expect(relaunch, `the planted run relaunches: ${plays.map((x) => x.launch).join(', ')}`).toBeDefined();
    expect(doneOf(stepped(relaunch!.reply, 'the planted relaunch')[0]!), 'the planted shell starts the relaunch with every mark lost').toBe('000000');
    failed(result, 'the planted shell\'s relaunch journey');
    expect(result.failures.some((f) => namesLevel(f.message, 1, LEVEL_NAMES[1]) || namesLevel(f.message, 4, LEVEL_NAMES[4])),
      `a failure names a level whose mark the relaunch lost, level 1 (${LEVEL_NAMES[1]}) or level 4 (${LEVEL_NAMES[4]}): ${shown(result)}`).toBe(true);
  }, TIMEOUT);
});
