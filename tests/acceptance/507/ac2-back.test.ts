// AC2 #507.c7ade523: "In present mode on that film, back pressed while the question at 37 s holds returns to the
// question at 33 s and holds there, and a new answer to it is the one the counter counts"
//
// The quiz film (helpers.ts `quizFilm`, criterion 1's) presented full screen on one display. → at 1 s leaves the intro
// stage; B is picked at 10 s, while the timeline holds at 8 s, so it goes on at 21 s and reaches the question at 33 s at
// 22 s. Question 1 is answered wrong (b) at 23 s, so the timeline holds at 37 s from 27 s; ← at 28 s goes back to the
// question at 33 s and holds there; question 1 is answered again, right (a), at 30 s, so the timeline is at 34 s at 31 s
// and holds at 37 s from 34 s; question 2 right (b) at 35 s, question 3 wrong (b) at 40 s, so at 45 s the timeline is at
// 46 s and the counter shows 2: the new answer and question 2. The old answer would make it 1. Wrong programs: back that
// leaves the timeline at 37 s, goes back further, or plays on from 33 s; a counter that keeps the first answer.
import { describe, expect, it } from 'vitest';
import {
  A, DISPLAY_A, DOC, Driver, FLICKS, QUIZ_FPS, TIMEOUT, enterPresent, evalAt, fl, key, none, numbersIn, pick, positionOf, presentEntry, quizFilm,
  secs, str, textsOf, useShow, useTemp,
} from './helpers.ts';

const ID = 'AC2 #507.c7ade523';
const bin = useShow();
const temp = useTemp();

describe(`${ID} back while a question holds returns to the one before, and its new answer counts`, () => {
  it(`${ID} ← while the question at 37 s holds returns to the question at 33 s and holds; its new answer is the one counted`, () => {
    const d = new Driver(bin(), { evidence: temp(), displays: [DISPLAY_A], doc: DOC.quiz });
    enterPresent(d, DOC.quiz, quizFilm(), A, 'the quiz film in present mode');
    const r = d.step([
      key(fl(1), 'ArrowRight'),
      pick(fl(10), 'path', 'B'),
      pick(fl(23), 'q1', 'b'),
      evalAt(fl(27.5), DOC.quiz),
      key(fl(28), 'ArrowLeft'),
      evalAt(fl(28.5), DOC.quiz), evalAt(fl(29.5), DOC.quiz),
      pick(fl(30), 'q1', 'a'),
      evalAt(fl(31), DOC.quiz),
      pick(fl(35), 'q2', 'b'),
      pick(fl(40), 'q3', 'b'),
      evalAt(fl(45), DOC.quiz, { texts: true }),
    ], 'the session');
    const advance = presentEntry(r[0], 'advance', '→ on the intro stage');
    expect(advance.t + fl(8), `the timeline reaches 8 s (${secs(advance.t + fl(8))}) before B is picked at 10 s`).toBeLessThan(fl(10));
    presentEntry(r[4], 'back', '← while the question at 37 s holds');
    const frame = FLICKS / QUIZ_FPS;
    const failures: string[] = [];
    const want = (i: number, at: number, p: number, held: boolean): void => {
      const got = positionOf(r[i], `eval at ${at} s`);
      const off = Math.abs(got - fl(p));
      if (held ? off !== 0 : off > frame) failures.push(`at the clock's ${at} s the timeline is at ${secs(got)}, not ${p} s${held ? ', held' : ''}`);
    };
    want(3, 27.5, 37, true);
    want(5, 28.5, 33, true);
    want(6, 29.5, 33, true);
    want(8, 31, 34, false);
    want(11, 45, 46, false);
    const score = str(textsOf(r[11], 'eval at 45 s')['score'], 'the counter at 45 s');
    if (JSON.stringify(numbersIn(score)) !== '[2]') failures.push(`at 46 s the counter shows ${JSON.stringify(score)}, not 2 (the new answer to question 1 and question 2)`);
    none(failures, 'back to the question at 33 s, and its new answer');
  }, TIMEOUT);
});
