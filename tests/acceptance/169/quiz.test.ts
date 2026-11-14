// AC3 #169.3b8550af: "A quiz of three questions with three options each exports one end state per answer combination,
// 27 in all, and each end state's score shows what the app shows at the end of that path, by pixel hash on the same
// machine"
//
// The quiz (helpers.ts `quiz`): three stage markers that wait for the choices q1, q2 and q3 (options a, b, c; right
// answers b, c, a), then the stage marker `end` on the film's last frame, where a counter shows the right answers.
//
// asserts, through `deep-show run` and the files the page export writes:
//   - the page's manifest holds exactly 27 states held at the marker `end` (README: The manifest), whose q1, q2 and q3
//     are each of the 27 answer combinations once;
//   - each of them has a still that, decoded to BGRA8 and hashed with BLAKE3, equals the raw frame hash of the app's
//     own still at the end of that path: the png_seq export of `still {marker: end}` on the input track that answers
//     the three questions in turn (#507's waiting path), on the same machine.
// Wrong program: the page with the all-right path's still and the all-wrong path's swapped (scores 3 and 0), which
// fails naming the path.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, QUIZ, TIMEOUT, answersTrack, appStills, failsNaming, manifestOf, none, pageExport, pageReceiptOf, present, presented, quiz, runShow,
  scenarioOf, stillHash, useShow, useTemp, type PageState,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

const PATHS: string[][] = QUIZ.options.flatMap((a) => QUIZ.options.flatMap((b) => QUIZ.options.map((c) => [a, b, c])));
const pathName = (a: readonly string[]): string => `q1=${a[0]} q2=${a[1]} q3=${a[2]}`;
const ALL_RIGHT = QUIZ.questions.map((q) => QUIZ.right[q]!);
const ALL_WRONG = ['a', 'a', 'b'];

describe(`${AC[3]} the quiz's page: 27 end states, each showing the score the app shows at the end of its path`, () => {
  it(`${AC[3]} the page holds one end state per answer combination, 27 in all, and each end state's still equals the app's still at the end of that path by pixel hash`, () => {
    const out = join(temp(), 'page');
    const r = runShow(shows(FULL), scenarioOf({ evidence: temp(), docs: [DOC.quiz], calls: [present(DOC.quiz, quiz()), pageExport(DOC.quiz, out, { size: QUIZ.size, rate: QUIZ.rate })] }), 'the quiz page');
    presented(r[0], 'the quiz');
    pageReceiptOf(r[1], 'the quiz page');
    const m = manifestOf(out, 'the quiz page');
    const ends = m.states.filter((s) => s.marker === 'end');
    expect(ends.length, `the page holds 27 end states (at the marker end); it holds ${ends.length}`).toBe(27);
    const byPath = new Map<string, PageState>();
    for (const s of ends) {
      const a = QUIZ.questions.map((q) => s.controls[q]);
      expect(a.every((v) => typeof v === 'string' && QUIZ.options.includes(v)), `end state ${s.id} holds an answer to each question: ${JSON.stringify(s.controls)}`).toBe(true);
      const name = pathName(a as string[]);
      expect(byPath.has(name), `end state ${s.id} is the only one for ${name}`).toBe(false);
      byPath.set(name, s);
    }
    none(PATHS.map(pathName).filter((n) => !byPath.has(n)).map((n) => `no end state for ${n}`), 'one end state per answer combination');

    const app = appStills(shows(FULL), { evidence: temp(), doc: DOC.quiz, document: quiz() },
      PATHS.map((a) => ({ name: pathName(a), track: answersTrack(a), range: { still: { marker: 'end' } } })), { size: QUIZ.size, rate: QUIZ.rate }, temp(), 'the quiz');
    expect(new Set(app.values()).size, 'the fixture: the app draws the four scores apart').toBe(4);
    const failures = (stillOf: (name: string) => string): string[] => PATHS.map(pathName).flatMap((name) => {
      const got = stillHash(out, stillOf(name), `the end state for ${name}`);
      return got === app.get(name) ? [] : [`the end state for ${name} (${byPath.get(name)!.id}) shows ${got}, the app ${String(app.get(name))} at the end of that path`];
    });
    none(failures((name) => byPath.get(name)!.still), "each end state's still equals the app's at the end of its path");
    // Wrong program: the page with the all-right and the all-wrong end states' stills swapped.
    const [right, wrong] = [pathName(ALL_RIGHT), pathName(ALL_WRONG)];
    failsNaming(failures((name) => byPath.get(name === right ? wrong : name === wrong ? right : name)!.still), right, 'the page with two end states\' stills swapped');
  }, TIMEOUT);
});
