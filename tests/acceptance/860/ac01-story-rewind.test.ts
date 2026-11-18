// Criterion 1: "A fixture story of 40 lines and 3 choices, read to line 30, rewound 12 stops to line 18 (before the second
// choice) and continued with the other option, shows at every later line the same full-state hash as a fresh play of
// the entries up to line 18 followed by that option; a planted rewind that restores only the logic arrays and not the
// read position shows a different line and fails, naming the stop"
//
// Through `deep-logic` (README: The surface): the story (programs.ts) is baked on its recorded track, line 1 at step 0
// and an action every 6 steps to line 30 at step 174, a rewind of 12 stops at step 180, then option 2 at the second
// choice (line 19 at step 186) and on to line 40 (step 312); beside it, a bake of the entries up to line 18 (step 102)
// followed by the same entries from step 186. The story checkpoints after every step that runs, so each line shown has a
// full-state hash. Its piece declares no seen as carried state here, so nothing crosses the branch (README: Readings).
// The planted rewind is `deep-logic --planted rewind_restores_arrays_only`.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, baked, branchFailures, cargoRuns, closedIn, logic, logicBin, macOnly, none, prebuild, shownAt, storyProgram, type Planted } from './helpers.ts';
import {
  BACK, LINES, OTHER_AT, READ_TO, REWIND_AT, STOP_LINE, STOP_STEP, STORY, STORY_STEPS_1, at, branchStep, freshStory, isRewind, lineStep, range, rewoundStory,
  storyPiece, textOf,
} from './programs.ts';

prebuild(() => { cargoRuns(); logicBin(); storyProgram(); });

const STOP = { step: STOP_STEP, line: STOP_LINE };
/** The fresh play of the entries up to line 18 followed by option 2, and the rewound run (under `planted` when given). */
function bakes(planted: Planted[] = []): { fresh: ReturnType<typeof baked>; rewound: ReturnType<typeof baked> } {
  const piece = storyPiece(storyProgram());
  const [f] = logic([bakeCall(piece, freshStory(), STORY_STEPS_1)]);
  const fresh = baked(f!, 'the fresh play of the entries up to line 18 followed by option 2');
  // The fixture, by the test's own count: the fresh play shows line n (19 to 40) at step 186 + 6(n − 19), with option 2's
  // texts, and closes no branch.
  const lines = range(19, LINES);
  expect(lines.map((n) => shownAt(fresh, branchStep(n))?.line), 'the fresh play shows lines 19 to 40 at steps 186 to 312').toEqual(lines);
  expect(lines.map((n) => shownAt(fresh, branchStep(n))?.text), 'with option 2\'s texts (41 to 45 on lines 23 to 27)').toEqual(lines.map((n) => textOf(n, 2)));
  const [r] = logic([bakeCall(piece, rewoundStory(), STORY_STEPS_1)], planted);
  const rewound = baked(r!, `the story read to line 30, rewound ${BACK} stops at step ${REWIND_AT} and continued with option 2${planted.length ? ` (${planted.join(', ')})` : ''}`);
  return { fresh, rewound };
}

describe(`${AC[1]} a story rewound 12 stops and continued with the other option equals a fresh play of its current branch`, () => {
  it(`${AC[1]} read to line 30, rewound 12 stops to line 18 and continued with the other option, the story shows at every later line the full-state hash of a fresh play of the entries up to line 18 followed by that option`, () => {
    macOnly();
    cargoRuns();
    const { fresh, rewound } = bakes();
    expect(range(1, READ_TO).map((n) => shownAt(rewound, lineStep(n))?.line), 'the first reading showed lines 1 to 30 at steps 0 to 174').toEqual(range(1, READ_TO));
    expect(shownAt(rewound, lineStep(STOP_LINE))?.choices, 'line 18 offered the second choice, not yet made').toEqual([1, 0, 0]);
    expect(rewound.track.filter(isRewind), 'the track keeps the rewind as an entry').toHaveLength(1);
    expect(rewound.track.some((e) => e['control'] === 'choose' && e['value'] === 1 && e['t'] === at(lineStep(19))), 'and the closed branch\'s entries, such as option 1 at the second choice (step 108)').toBe(true);
    expect(closedIn(rewound, 'the rewound run'), 'the rewind closed the branch from the stop at line 18 (step 102) to its own step, 180').toEqual([{ stop: STOP_STEP, rewind: REWIND_AT }]);
    expect(closedIn(fresh, 'the fresh play'), 'a fresh play closes no branch').toEqual([]);
    const later = range(19, LINES);
    expect(later.map((n) => shownAt(rewound, branchStep(n))?.line), 'after it the story shows lines 19 to 40 again, on option 2').toEqual(later);
    expect(rewound.checkpoints[STORY]?.filter((c) => c.step > REWIND_AT).map((c) => c.step), 'a full-state hash at every later line: a checkpoint after each step that showed one').toEqual(later.map((n) => branchStep(n) + 1));
    none(branchFailures(rewound, fresh, { item: STORY, rewindAt: REWIND_AT, stop: STOP }), `${AC[1]} every later line's step hash, arrays and full-state hash equal the fresh play's`);
  }, TIMEOUT);

  it(`${AC[1]} a planted rewind that restores only the logic arrays and not the read position (rewind_restores_arrays_only) shows a different line and fails, naming the stop`, () => {
    macOnly();
    cargoRuns();
    const { fresh, rewound } = bakes(['rewind_restores_arrays_only']);
    const shown = shownAt(rewound, OTHER_AT)?.line;
    expect(shown, `the planted rewind shows another line than the fresh play's 19 at step ${OTHER_AT}`).not.toBe(shownAt(fresh, OTHER_AT)?.line);
    const failures = branchFailures(rewound, fresh, { item: STORY, rewindAt: REWIND_AT, stop: STOP });
    expect(failures.length, `${AC[1]} the comparison fails the planted rewind`).toBeGreaterThan(0);
    expect(failures.some((m) => m.includes(`the stop at step ${STOP_STEP} (line ${STOP_LINE})`) && m.includes(`line ${shown}`)), `a failure names the stop and the line the planted rewind shows:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
