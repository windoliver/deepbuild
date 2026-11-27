// AC2 #3605.0f6b90fe: "Level 2 entered and left from pause leaves `done[2]` false. Completing it later turns it true,
// and completing it again changes nothing. The shell's full-state hash covers `done`: two runs that complete the same
// levels in the same order end on the same hash, and a run that completes one more doesn't."
//
// The fixture shell's `moves` journey at the reference window. Run A: from the title, the level select; level 2
// (earthing) entered, played to its step 300, paused and left from pause; entered again and completed (its step 900);
// entered a third time and completed again; then level 4 entered and completed. It is played with keys and with a pad
// (two runs that complete the same levels, 2 and 4, in the same order). Run B is A with its last move changed: level 4
// entered, played to its step 300, paused and left from pause, so it completes one level fewer (A completes one more).
// Both check runs pass. In A's keys rows: done[2] is false through the first load of level 2 and up to its second
// load's step 900, true from then on; the third load changes no element of `done`, from the row before it is entered
// to the row before level 4 is entered; the run ends with done [0, 0, 1, 0, 1, 0]. A's keys and pad runs end on the
// same full-state hash (their last rows'). B ends on the level select, as A does, with done [0, 0, 1, 0, 0, 0], and its
// last row's hash differs from A's.
// The wrong programs: the base, a shell that marks a level when it is left from pause or entered, one that clears or
// flips a mark on a second completion, and a full-state hash that leaves `done` out (A and B would end on one hash).
import { describe, expect, it } from 'vitest';
import { AC, DOC, FINISH_AT, TIMEOUT, doneOf, hubOnce, journeysInput, loads, macOnly, none, onePlay, passed, putShell, runJourneys, stepped, type Move } from './helpers.ts';
import { allPrograms, complete, leaveFromPause, programs, shellDocument } from './shell.ts';

const hub = hubOnce();
const RUN_A: Move[] = [{ activate: 'levels_button' }, ...leaveFromPause(2), ...complete(2), ...complete(2), ...complete(4)];
const RUN_B: Move[] = [{ activate: 'levels_button' }, ...leaveFromPause(2), ...complete(2), ...complete(2), ...leaveFromPause(4)];

describe(`${AC[2]} a level left from pause stays unmarked, completing it marks it once, and the full-state hash covers done`, () => {
  it(`${AC[2]} level 2 left from pause leaves done[2] false, completing it turns it true and again changes nothing; equal runs end on one hash and one more completion changes it`, async () => {
    macOnly();
    const p = programs();
    const h = await hub();
    const a = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    passed(await runJourneys(h, journeysInput(a, { journeys: ['moves'], moves: RUN_A, devices: ['keys', 'pad'] })), 'run A with keys and with a pad');
    const keys = stepped(onePlay(h.pool, a, 'moves', 'keys', 'run A with keys'), 'run A with keys');
    const pad = stepped(onePlay(h.pool, a, 'moves', 'pad', 'run A with a pad'), 'run A with a pad');
    const gaps: string[] = [];
    const twos = loads(keys, 2);
    if (twos.length !== 3) gaps.push(`run A loads level 2 ${twos.length} times, not 3`);
    else {
      const firstEnd = keys.indexOf(twos[0]!.at(-1)!);
      if (twos[0]!.some((r) => r.level_step > 400)) gaps.push('level 2\'s first load plays past its step 300 before it is left from pause');
      if (!twos[0]!.some((r) => r.paused)) gaps.push('level 2\'s first load is never paused');
      const secondDone = keys.indexOf(twos[1]!.find((r) => r.level_step === FINISH_AT)!);
      if (secondDone < 0) gaps.push(`level 2's second load never reaches its step ${FINISH_AT}`);
      else {
        const early = keys.slice(0, secondDone + 1).find((r) => r.done[2]);
        if (early) gaps.push(`done[2] is true at step ${early.step}, ${keys.indexOf(early) <= firstEnd ? 'during its first load, left from pause' : 'before its second load\'s step 900 ran'}`);
        const after = keys.slice(secondDone + 1).find((r) => !r.done[2]);
        if (after) gaps.push(`done[2] is false at step ${after.step}, after its second load completed it`);
      }
      const third = keys.indexOf(twos[2]![0]!);
      const four = keys.findIndex((r) => r.level === 4);
      const span = keys.slice(third - 1, four);
      const changed = span.find((r) => doneOf(r) !== doneOf(span[0]!));
      if (changed) gaps.push(`completing level 2 again changes done from ${doneOf(span[0]!)} to ${doneOf(changed)} at step ${changed.step}`);
    }
    if (doneOf(keys.at(-1)!) !== '001010') gaps.push(`run A ends with done ${doneOf(keys.at(-1)!)}, not 001010`);
    if (doneOf(pad.at(-1)!) !== '001010') gaps.push(`run A with a pad ends with done ${doneOf(pad.at(-1)!)}, not 001010`);
    none(gaps, 'run A\'s rows');
    expect(pad.at(-1)!.hash, 'run A with keys and with a pad, completing the same levels in the same order, end on the same full-state hash').toBe(keys.at(-1)!.hash);

    const b = putShell(DOC.again, shellDocument(p), allPrograms(p));
    passed(await runJourneys(h, journeysInput(b, { journeys: ['moves'], moves: RUN_B })), 'run B with keys');
    const one = stepped(onePlay(h.pool, b, 'moves', 'keys', 'run B with keys'), 'run B with keys');
    const [endA, endB] = [keys.at(-1)!, one.at(-1)!];
    expect([endB.screen, endB.level, doneOf(endB)], 'run B ends on the level select with no level loaded, level 4 left unmarked').toEqual(['levels', -1, '001000']);
    expect([endA.screen, endA.level], 'run A ends on the level select with no level loaded').toEqual(['levels', -1]);
    expect(endB.hash, 'run A, which completes one more level than run B, ends on another full-state hash').not.toBe(endA.hash);
  }, TIMEOUT);
});
