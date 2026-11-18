// Criterion 4: "A save taken after a rewind loads with its current branch, its closed branches within depth and seen;
// rewinding after the load reaches the same state as rewinding before the save"
//
// Through `deep-logic` (README: The surface; #534's saves): the story (programs.ts), its piece declaring seen as carried
// state and slot 1 of saves, is read to line 30, rewound 12 stops to line 18 at step 180, continued with option 2 to
// line 24 (step 216) and saved at step 222 (the save is at step 223). Then it is rewound 8 stops at step 228, back past the
// branch to line 16 (step 90), reads on to line 18, takes option 2 again and skip-reads at step 252, which passes lines
// 20 to 24, read on the branches before the save, and stops at line 25. One `deep-logic` process bakes that whole run with
// its saves folder and exits (the app quit); another opens slot 1 (`open_save`) and plays the same track on from the
// save, so the rewind at step 228 comes after the load.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, baked, cargoRuns, closedIn, logic, logicBin, macOnly, none, openSaveCall, openedSave, prebuild, sameAfter, savesDir, shownAt, storyProgram } from './helpers.ts';
import {
  BACK_AFTER_LINE, CLOSED_TEXTS, REWIND_AFTER_AT, REWIND_AT, SAVED_STEP, SKIP_AFTER_AT, SKIP_AFTER_LINE, STOP_STEP, STORY, STORY_DEPTH, STORY_STEPS_4, savedStory,
  storyPiece, textOf,
} from './programs.ts';

prebuild(() => { cargoRuns(); logicBin(); storyProgram(); });

describe(`${AC[4]} a save taken after a rewind keeps the branch, the closed branches within depth and seen`, () => {
  it(`${AC[4]} the save loads with its current branch, its closed branches within depth and seen, and rewinding after the load reaches the state rewinding before the save reached`, () => {
    macOnly();
    cargoRuns();
    const piece = storyPiece(storyProgram(), { seen: true, saves: true });
    const dir = savesDir();
    const track = savedStory();
    const [x] = logic([bakeCall(piece, track, STORY_STEPS_4, { saves_dir: dir })]);
    const run = baked(x!, 'the story saved after a rewind and rewound again, never stopped');
    expect(run.saves.map((s) => [s.item, s.slot, s.step]), 'the story saved slot 1 when step 222 ended').toEqual([[STORY, 1, SAVED_STEP]]);
    const save = run.saves[0]!;
    expect(shownAt(run, REWIND_AFTER_AT + 6)?.line, `the run that never stopped: rewound 8 stops to line ${BACK_AFTER_LINE}, the next line is 17`).toBe(BACK_AFTER_LINE + 1);
    expect([shownAt(run, SKIP_AFTER_AT)?.line, shownAt(run, SKIP_AFTER_AT)?.text], 'and its skip-read stops at line 25 (text 43), the first line no branch read').toEqual([SKIP_AFTER_LINE, textOf(SKIP_AFTER_LINE, 2)]);

    const [y] = logic([openSaveCall(piece, dir, 1, track, STORY_STEPS_4)]);
    const opened = openedSave(y!, 'slot 1 opened in another process');
    expect([opened.hash, opened.step, opened.via], 'the save opens, straight, at step 223').toEqual([save.hash, SAVED_STEP, 'straight']);
    expect(opened.deep_hash[STORY], 'its current branch: the full-state hash the save recorded').toBe(save.deep_hash[STORY]);
    expect(closedIn(opened, 'the opened save'), `its closed branches within depth (${STORY_DEPTH} stops): the one the first rewind closed, from line 18 (step 102) to step 180`).toEqual([{ stop: STOP_STEP, rewind: REWIND_AT }]);
    const after = shownAt(opened, REWIND_AFTER_AT + 6);
    expect(after?.line, `rewound 8 stops after the load, the story is back at line ${BACK_AFTER_LINE}: the next line is 17`).toBe(BACK_AFTER_LINE + 1);
    const read = [...CLOSED_TEXTS, textOf(23, 2), textOf(24, 2)];
    expect(read.filter((t) => after?.seen[t] !== 1), 'and seen holds the lines both branches read before the save (texts 20 to 30, 41 and 42)').toEqual([]);
    expect([shownAt(opened, SKIP_AFTER_AT)?.line, shownAt(opened, SKIP_AFTER_AT)?.text], 'so the skip-read after the load stops at line 25 (text 43)').toEqual([SKIP_AFTER_LINE, textOf(SKIP_AFTER_LINE, 2)]);
    none(sameAfter(opened, run, { item: STORY, from: REWIND_AFTER_AT, named: `the rewind of 8 stops at step ${REWIND_AFTER_AT}`, names: ['the run opened from the save', 'the run that never stopped'] }), `${AC[4]} rewinding after the load reaches the state, step for step and checkpoint for checkpoint, rewinding without the stop reached`);
  }, TIMEOUT);
});
