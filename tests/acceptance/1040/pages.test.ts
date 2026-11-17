// AC7 #1040.6bb03885: "A quiz whose logic keeps the score exports one end state per path, 27 for three questions of
// three options, each showing the score the app shows at the end of that path; and a piece whose logic counts a
// toggle's flips is refused past 64 states, naming the logic item"
//
// This file holds the first half; the second, shared word for word with criterion 2's page-alone leg, is the refusal
// test in flips.test.ts, tagged with both criteria.
//
// asserts, on the quiz (helpers.ts `quizDoc`: the score kept by the logic item `scorer`) exported as a page (#169's
// `video.codec: page`, 320 × 180 at 10 fps):
//   - the page's manifest holds exactly 27 states held at the marker `end`, whose q1, q2 and q3 are each of the 27
//     answer combinations once;
//   - the fixture: the app's own stills at the end of the 27 paths (png_seq stills at marker `end` on the input track
//     that answers the three questions in turn, #169's) show the four scores apart;
//   - each end state's still, decoded to BGRA8 and hashed with BLAKE3, equals the app's still at the end of its path.
// Wrong programs: the merge base, where the quiz's logic never reads an answer, so every path ends on one score and
// the fixture fails; and the page with the all-right and all-wrong paths' stills swapped (scores 3 and 0), which fails
// naming the path.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, QUIZ, QUIZ_PATHS, TIMEOUT, answersTrack, appStills, exportPage, failsNaming, none, pageExported, pathName, quizDoc, stillHash, useShow, useTemp,
  type PState,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const ALL_RIGHT = QUIZ.questions.map((q) => QUIZ.right[q]!);
const ALL_WRONG = ['a', 'a', 'b'];

describe(`${AC[7]} the quiz whose logic keeps the score: 27 end states, each showing the app's score at the end of its path`, () => {
  it(`${AC[7]} the quiz exported as a page holds one end state per path, 27, and each end state's still is the app's at the end of that path`, () => {
    const evidence = temp();
    const out = join(temp(), 'page');
    const m = pageExported(exportPage(shows(FULL), evidence, quizDoc(evidence), out, { size: QUIZ.size, rate: QUIZ.rate }, 'the quiz page'), out, 'the quiz page');
    const ends = m.states.filter((s) => s.marker === 'end');
    expect(ends.length, `the page holds 27 end states (at the marker end); it holds ${ends.length}`).toBe(27);
    const byPath = new Map<string, PState>();
    for (const s of ends) {
      const a = QUIZ.questions.map((q) => s.controls[q]);
      expect(a.every((v) => typeof v === 'string' && QUIZ.options.includes(v)), `end state ${s.id} holds an answer to each question: ${JSON.stringify(s.controls)}`).toBe(true);
      const name = pathName(a as string[]);
      expect(byPath.has(name), `end state ${s.id} is the only one for ${name}`).toBe(false);
      byPath.set(name, s);
    }
    none(QUIZ_PATHS.map(pathName).filter((n) => !byPath.has(n)).map((n) => `no end state for ${n}`), 'one end state per answer combination');

    const app = appStills(shows(FULL), evidence, quizDoc(evidence), QUIZ_PATHS.map((a) => ({ name: pathName(a), track: answersTrack(a), range: { still: { marker: 'end' } } })),
      { size: QUIZ.size, rate: QUIZ.rate }, temp(), 'the quiz');
    expect(new Set(app.values()).size, 'the fixture: the app shows the four scores apart at the ends of the 27 paths (its logic reads each answer)').toBe(4);
    const failures = (stillFor: (name: string) => string): string[] => QUIZ_PATHS.map(pathName).flatMap((name) => {
      const got = stillHash(out, stillFor(name), `the end state for ${name}`);
      return got === app.get(name) ? [] : [`the end state for ${name} (${byPath.get(name)!.id}) shows ${got}, the app ${String(app.get(name))} at the end of that path`];
    });
    none(failures((name) => byPath.get(name)!.still), "each end state's still equals the app's at the end of its path");
    const [right, wrong] = [pathName(ALL_RIGHT), pathName(ALL_WRONG)];
    failsNaming(failures((name) => byPath.get(name === right ? wrong : name === wrong ? right : name)!.still), right, "the page with two end states' stills swapped");
  }, TIMEOUT);
});
