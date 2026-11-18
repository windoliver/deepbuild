// Criterion 2: "Lines read on the closed branch stay in `seen` after the rewind, so the story's skip-read control skips them
// on the new branch and stops at the first unread line; a planted rewind that clears seen fails, naming the line"
//
// Through `deep-logic` (README: The surface): the story (programs.ts), its piece declaring `story.seen` as carried state
// in its rewind, read to line 30 on option 1 at each choice (texts 1 to 30 read), rewound 12 stops at step 180 to line
// 18, option 2 at step 186 (line 19), the skip-read control at step 192 and `next` at 198. On option 2, lines 20 to 22
// show the texts the closed branch read (20 to 22) and line 23 shows text 41, which no branch has read, so the skip stops
// at line 23. Beside it, the same option and skip with no rewind before them, where nothing past line 19 was read: there
// the skip stops at line 20, which is where a rewind that drops seen stops it too. The planted rewind is
// `deep-logic --planted rewind_clears_seen`.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, baked, cargoRuns, logic, logicBin, macOnly, none, prebuild, seenFailures, shownAt, storyProgram, type Planted } from './helpers.ts';
import { CLOSED_TEXTS, FIRST_UNREAD, OTHER_AT, SKIP_AT, STORY_STEPS_2, skippingFresh, skippingStory, storyPiece, textOf } from './programs.ts';

prebuild(() => { cargoRuns(); logicBin(); storyProgram(); });

const JUDGED = { firstAfter: OTHER_AT, closedTexts: CLOSED_TEXTS, skipAt: SKIP_AT, firstUnread: { line: FIRST_UNREAD, text: textOf(FIRST_UNREAD, 2) } };
/** The story with seen declared, rewound and skipping (under `planted` when given), after its fixture check. */
function run(planted: Planted[] = []): ReturnType<typeof baked> {
  const piece = storyPiece(storyProgram(), { seen: true });
  // The fixture, with no rewind: nothing past line 19 has been read, so the skip from line 19 stops at line 20.
  const [f] = logic([bakeCall(piece, skippingFresh(), STORY_STEPS_2)]);
  const fresh = baked(f!, 'option 2 and the skip with no rewind before them');
  expect(shownAt(fresh, SKIP_AT)?.line, 'with no line past 19 read, the skip from line 19 stops at line 20').toBe(20);
  const [r] = logic([bakeCall(piece, skippingStory(), STORY_STEPS_2)], planted);
  return baked(r!, `the story read to line 30, rewound 12 stops, option 2 and skip-read${planted.length ? ` (${planted.join(', ')})` : ''}`);
}

describe(`${AC[2]} what the reader has seen survives a rewind, and skip-read skips it on the new branch`, () => {
  it(`${AC[2]} lines read on the closed branch stay in seen after the rewind, so skip-read skips them on the new branch and stops at the first unread line`, () => {
    macOnly();
    cargoRuns();
    const story = run();
    const after = shownAt(story, OTHER_AT);
    expect(after?.line, 'option 2 after the rewind shows line 19: the rewind returned to line 18').toBe(19);
    expect(after?.choices, 'with option 2 at the second choice and the third choice, made on the closed branch, not made: nothing but seen crossed').toEqual([1, 2, 0]);
    none(seenFailures(story, JUDGED), `${AC[2]} seen keeps the closed branch's lines and the skip stops at the first unread line`);
    const next = shownAt(story, SKIP_AT + 6);
    expect([next?.line, next?.text], 'next after the skip shows line 24 (text 42)').toEqual([24, textOf(24, 2)]);
  }, TIMEOUT);

  it(`${AC[2]} a planted rewind that clears seen (rewind_clears_seen) fails, naming the line`, () => {
    macOnly();
    cargoRuns();
    const story = run(['rewind_clears_seen']);
    const stopped = shownAt(story, SKIP_AT)?.line;
    expect(stopped, 'the planted rewind\'s skip stops before the first unread line').not.toBe(FIRST_UNREAD);
    const failures = seenFailures(story, JUDGED);
    expect(failures.length, `${AC[2]} the judgement fails the planted rewind`).toBeGreaterThan(0);
    expect(failures.some((m) => m.includes(`stopped at line ${stopped} `) && m.includes(`line ${FIRST_UNREAD}`)), `a failure names the line the skip stopped at and the first unread line:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
