// #533.6d69e833: a test build with the logic module and without the physics module seals and plays the flock and
// the quiz; in it a document whose logic item reads a world's occurrence list or fires a world's input is refused
// with module_missing, naming the physics module, since no entry in the build fills `<world ID>.occurrences`, and
// no other document is; and a planted logic module that declares physics among its dependencies is refused at that
// build's seal, naming physics.
//
// The build is deep-show `full,test-leave-out-physics`; the planted one adds `test-logic-needs-physics` (README:
// deep-show). "Plays" is read through `eval`'s arrays at five times, against deep-logic's bake of the same piece and
// against this suite's own mirror of the flock.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FLICKS, REGISTRY, TIMEOUT, arr, bakeCall, board, deepShow, evalArrays, issuesOf, layoutFor, logicBin, logicItem, num, obj, onLogic, piece,
  prebuild, present, putAsset, refusalLine, runShow, scenario, show, startup, stepsOf, useTemp, word, type JsonObject, type ShowFeature,
} from './helpers.ts';
import { FLOCK_WRITES, QUESTIONS, QUIZ_WRITES, flock, flockCx, quiz } from './programs.ts';

const ID = AC[4];
const NO_PHYSICS: ShowFeature[] = ['full', 'test-leave-out-physics'];
const NEEDS_PHYSICS: ShowFeature[] = ['full', 'test-leave-out-physics', 'test-logic-needs-physics'];
prebuild(() => { deepShow(NO_PHYSICS); logicBin(); });
const temp = useTemp();

const SEED = 533_04;
/** The five sampled times: the middle of each of the first five seconds, and the step each frame reads. */
const TIMES = [0, 1, 2, 3, 4].map((s) => (s * 2 + 1) * (FLICKS / 2));
const STEPS = [0, 1, 2, 3, 4].map((s) => 60 * s + 30);
const WORLD = 'lab';

const flockDoc = (): JsonObject => board('Flock', SEED, [logicItem('flock', flock(), { writes: FLOCK_WRITES })]);
const quizDoc = (): JsonObject => board('Quiz', SEED, [logicItem('quiz', quiz(), { writes: QUIZ_WRITES })]);
/** A logic item that reads a world's occurrence list. */
const readsWorld = (): JsonObject => board('Reads a world', SEED, [logicItem('watcher', flock(), { reads: [`${WORLD}.occurrences`], writes: FLOCK_WRITES })]);
/** A logic item that fires a world's input. */
const firesWorld = (): JsonObject => board('Fires a world', SEED, [logicItem('launcher', flock(), { fires: { [WORLD]: ['launch'] }, writes: FLOCK_WRITES })]);

const naming = (reply: JsonObject, module: string, what: string): boolean =>
  issuesOf(reply, what).some((i) => i.code === 'module_missing' && i.severity === 'error' && word(module).test(i.text));
const errors = (reply: JsonObject, what: string): string[] => issuesOf(reply, what).filter((i) => i.severity === 'error').map((i) => show(i.raw));

describe(`${ID} a build with the logic module and without the physics module`, () => {
  it(`${ID} the build seals with logic and without physics, and plays the flock and the quiz: each frame reads the arrays the logic module's own bake gives at that step`, () => {
    // The programs keep their one write at offset 0 of the write region; the logic module's layout says so.
    for (const [name, spec] of [['flock', { program: flock(), writes: FLOCK_WRITES }], ['quiz', { program: quiz(), writes: QUIZ_WRITES }]] as const) {
      const l = layoutFor(spec);
      expect(l.entries.find((e) => e.region === 'writes')?.offset, `${name}'s first write is at offset 0`).toBe(0);
    }
    const [baked] = onLogic([bakeCall(piece({ seed: SEED, items: { flock: { program: flock(), writes: FLOCK_WRITES }, quiz: { program: quiz(), writes: QUIZ_WRITES } } }), [], STEPS.at(-1)! + 1)]);
    const reference = stepsOf(obj(baked!, 'bake')['steps'], 'bake.steps');
    const mirror = flockCx(STEPS.at(-1)! + 1);

    const ev = temp();
    putAsset(ev, flock());
    putAsset(ev, quiz());
    const calls: JsonObject[] = [REGISTRY, present(DOC.a, flockDoc()), present(DOC.b, quizDoc()),
      ...TIMES.map((t) => evalArrays(DOC.a, t, ['flock.cx'])), ...TIMES.map((t) => evalArrays(DOC.b, t, ['quiz.question']))];
    const [reg, shownFlock, shownQuiz, ...evals] = runShow(deepShow(NO_PHYSICS), scenario(ev, calls));
    const modules = arr(reg!['modules'], 'registry.modules').map(String);
    expect(modules, 'the build holds the logic module and the sandbox module').toEqual(expect.arrayContaining(['logic', 'sandbox']));
    expect(modules, 'the build holds no physics module').not.toContain('physics');
    for (const [name, r] of [['the flock', shownFlock!], ['the quiz', shownQuiz!]] as const) {
      expect(r['outcome'], `${name} is presented: ${show(r)}`).toBe('presented');
      expect(errors(r, name), `${name} has no error issue`).toEqual([]);
    }
    const flockAt = evals.slice(0, TIMES.length).map((r, i) => { expect(r['outcome'], `the flock evaluates at ${TIMES[i]}: ${show(r)}`).toBe('evaluated'); return num(obj(r['arrays'], 'eval.arrays')['flock.cx'], `flock.cx at t ${TIMES[i]}`); });
    const quizAt = evals.slice(TIMES.length).map((r, i) => { expect(r['outcome'], `the quiz evaluates at ${TIMES[i]}: ${show(r)}`).toBe('evaluated'); return num(obj(r['arrays'], 'eval.arrays')['quiz.question'], `quiz.question at t ${TIMES[i]}`); });
    expect(flockAt, 'the flock\'s centre at each frame is what its steps computed up to there (this suite\'s mirror)').toEqual(STEPS.map((k) => mirror[k]));
    expect(flockAt, 'the flock\'s centre at each frame is the logic module\'s bake at that step').toEqual(STEPS.map((k) => reference[k]!.arrays['flock.cx']![0]));
    expect(quizAt, 'the quiz asks at each frame what the logic module\'s bake asks at that step').toEqual(STEPS.map((k) => reference[k]!.arrays['quiz.question']![0]));
    expect([...quizAt].sort(), 'the quiz asks each of its five questions once in five seconds').toEqual([...Array(QUESTIONS).keys()]);
  }, TIMEOUT);

  it(`${ID} a document whose logic item reads ${WORLD}.occurrences, and one whose item fires ${WORLD}'s input, are refused with module_missing naming physics; the flock and the quiz are not`, () => {
    const ev = temp();
    putAsset(ev, flock());
    putAsset(ev, quiz());
    const rs = runShow(deepShow(NO_PHYSICS), scenario(ev, [
      present(DOC.a, flockDoc()), present(DOC.b, quizDoc()), present(DOC.c, readsWorld()), present(DOC.d, firesWorld()),
    ]));
    const names = ['the flock', 'the quiz', `the reader of ${WORLD}.occurrences`, `the item firing ${WORLD}'s input`];
    expect(rs.map((r) => r['outcome']), `only the documents that need physics are refused: ${rs.map((r) => show(r).slice(0, 400)).join(' | ')}`).toEqual(['presented', 'presented', 'refused', 'refused']);
    expect(rs.map((r, i) => naming(r, 'physics', names[i]!)), 'each refusal is module_missing naming the physics module, and no other document has one').toEqual([false, false, true, true]);
    expect(rs.slice(0, 2).map((r, i) => errors(r, names[i]!)), 'the flock and the quiz have no error issue').toEqual([[], []]);
  }, TIMEOUT);

  it(`${ID} a planted logic module that declares physics among its dependencies is refused at the seal of the build without physics, naming physics`, () => {
    const line = refusalLine(startup(deepShow(NEEDS_PHYSICS)), 'the build whose logic module depends on physics');
    expect(arr(line['modules'], 'the refusal: modules').map(String), `the refusal names physics (and the logic module that needs it): ${show(line)}`).toEqual(expect.arrayContaining(['physics', 'logic']));
  }, TIMEOUT);
});
