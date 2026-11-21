// #2310.d9ba72ca: "#523's hand of 0.2 kg hinged to a 40 kg torso that hangs from it, the hand on a ball joint to the
// world, both joints articulated, raises no `physics.mass_ratio`, and no joint opens 0.1 mm in 4 s. With both joints
// separate it raises the lint as #523 says. A world with an articulated joint on a test backend whose `caps()` list no
// articulations is refused, naming the joint and the backend"
//
// The world (README: The worlds) is #523's hand and torso, the torso hanging from the hand by the hinge `wrist` and
// the hand from the world by the ball joint `grip`. With both joints articulated the `check` call's `issues` hold no
// error and no `physics.mass_ratio`, and a bake of 4 s, read from both bodies' states, has neither joint's anchors more
// than 0.1 mm apart at any step. With `articulated` left out of both, the check raises `physics.mass_ratio` naming
// the joint `wrist`, the hand, the torso and the ratio 200, as #523's criterion 7 says.
//
// The test backend is `--backend no_articulations` in the `test-backends` build (README: The test backend): its
// `caps` list no `articulations` while the reference backend's, in the same build, do; it refuses the world with an
// error `physics.backend_cap` at an articulated joint whose sentence names the backend; it accepts the same world with
// both joints separate; and the reference backend, in the same build, accepts the world it refuses.
import { describe, expect, it } from 'vitest';
import {
  AC, BACKEND_CAP, CAP, GRIP, HAND, HAND_MASS, MASS_RATIO, NO_ARTICULATIONS, TIMEOUT, TORSO, TORSO_MASS, WRIST, acceptedFailures, ask, bake,
  capFailures, check, fmt, handAndTorso, judged, manifestOf, namesId, namesRatio, openFailures, prebuild, ratiosOf, runOf, show,
} from './helpers.ts';

prebuild(['release', 'test']);

const ID = AC[6];
const RATIO = Math.round(TORSO_MASS / HAND_MASS);
const WORLD = 'the hand and the torso, both joints articulated';
const SEPARATE = 'the hand and the torso, both joints separate';

describe(`${ID} an articulated joint between a 0.2 kg hand and a 40 kg torso raises no physics.mass_ratio and never opens, and a backend without articulations refuses it`, () => {
  it(`${ID} with both joints articulated the hand and the torso raise no physics.mass_ratio and no joint opens 0.1 mm in 4 s; with both joints separate they raise the lint as #523 says`, () => {
    const [on, off] = [handAndTorso(), handAndTorso(false)];
    const run = ask([check(on), bake(on), check(off)]);
    expect(run.problem, `${run.what} answers the two checks and the bake`).toBe('');
    const failures = [...acceptedFailures(run.replies[0], WORLD)];
    const raised = ratiosOf(run.replies[0], WORLD);
    if (typeof raised === 'string') failures.push(raised);
    else if (raised.length) failures.push(`${WORLD} raise ${MASS_RATIO}, which an articulated joint raises nothing of: ${show(raised)}`);
    failures.push(...judged(runOf(on, run.replies[1], WORLD), (r) => openFailures(on, r)));
    const lint = ratiosOf(run.replies[2], SEPARATE);
    if (typeof lint === 'string') failures.push(lint);
    else if (!lint.some((i) => [WRIST, HAND, TORSO].every((id) => namesId(i, id)) && namesRatio(i, RATIO))) {
      failures.push(`${SEPARATE} raise no ${MASS_RATIO} naming the joint ${WRIST}, ${HAND}, ${TORSO} and the ratio ${RATIO}, as #523 says: ${show(lint)}`);
    }
    expect(failures, `the hand of ${fmt(HAND_MASS)} kg and the torso of ${TORSO_MASS} kg that hangs from it:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} a test backend whose caps() list no articulations (--backend ${NO_ARTICULATIONS}) refuses the world with ${BACKEND_CAP}, naming the joint and the backend, and accepts it with both joints separate`, () => {
    const own = ask([{ call: 'backend' }, check(handAndTorso()), check(handAndTorso(false))], { backend: NO_ARTICULATIONS });
    expect(own.problem, `${own.what} answers: the test-backends build holds the test backend ${NO_ARTICULATIONS}`).toBe('');
    const rapier = ask([{ call: 'backend' }, check(handAndTorso())], { build: 'test' });
    expect(rapier.problem, `${rapier.what} answers (the test-backends build, on the reference backend)`).toBe('');
    const [mine, theirs] = [manifestOf(own.replies[0], `backend (${NO_ARTICULATIONS})`), manifestOf(rapier.replies[0], 'backend (the reference backend, test build)')];
    const failures: string[] = [mine, theirs].filter((m): m is string => typeof m === 'string');
    if (typeof mine !== 'string') {
      if (mine.backend !== NO_ARTICULATIONS) failures.push(`the test backend's manifest names ${mine.backend}, not ${NO_ARTICULATIONS}`);
      if (mine.caps.includes(CAP)) failures.push(`${NO_ARTICULATIONS}'s caps() ${show(mine.caps)} list ${CAP}`);
    }
    // caps() says whether a backend has articulations: the reference backend, in the same build, lists them.
    if (typeof theirs !== 'string' && !theirs.caps.includes(CAP)) failures.push(`the reference backend's caps() ${show(theirs.caps)} don't list ${CAP}, so nothing says it has articulations`);
    failures.push(
      ...capFailures(own.replies[1], [GRIP, WRIST], NO_ARTICULATIONS, `${WORLD}, on ${NO_ARTICULATIONS}`),
      // The refusal is the cap's: the backend takes the same world with no articulated joint, and the reference backend takes the world.
      ...acceptedFailures(own.replies[2], `${SEPARATE}, on ${NO_ARTICULATIONS}`),
      ...acceptedFailures(rapier.replies[1], `${WORLD}, on the reference backend in the same build`),
    );
    expect(failures, `${NO_ARTICULATIONS}:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
