// #2012.53ff430e: goldens recorded on macOS match on Linux step for step.
//
// Three worlds' goldens are recorded on this Mac and replayed (`golden_verify`) in the #1983 lane's pinned image as
// linux/amd64 (helpers: onLane): the pile-and-flyer world (twelve boxes piling up, a flyer at 1.5 m/s), the
// ball-and-goal lab (a kick under a crossbar, with an output), both #2010's, and a 192-box pile with a chain of four
// ball-jointed links swinging through a sensor and eight CCD balls thrown at about 100 m/s (#2010's Oracle scenes, after
// Rapier's snapshot_roundtrip). Each replay's own step hashes must equal its golden's at every step. A replay of the
// first world shifted one ulp at step 120 must differ first at step 120, so a Linux leg that echoed the golden is caught.
import { describe, it } from 'vitest';
import { pile, upstreamScene, withCcdBalls, withJointsAndSensor } from '../2010-oracle/helpers.ts';
import {
  ARCH, CONTAINER_TIMEOUT, CRITERIA, LINUX_X86, ask, ballAndGoal, hostTriple, matchFailures, none, onLane, pileAndFlyer, prebuild, recordHere,
  referenceMac, shift, shiftedFailures, verifyGolden, type JsonObject,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[3];
const AT = 120;

describe(`${ID} goldens recorded on macOS match on Linux step for step`, () => {
  it(`${ID} the goldens of three worlds recorded on this Mac (pile and flyer, ball and goal, chain, sensor and CCD balls over a pile) match on Linux x86_64 at every step hash`, () => {
    referenceMac();
    const worlds: [string, JsonObject, number][] = [
      ['the pile-and-flyer world', pileAndFlyer(), 240],
      ['the ball-and-goal lab', ballAndGoal(), 360],
      ['the chain, sensor and CCD balls over a pile', upstreamScene(withCcdBalls(withJointsAndSensor(pile(false))), 60), 200],
    ];
    const recorded = worlds.map(([name, w, n]) => ({ name, w, n, golden: recordHere(w, n, [LINUX_X86]) }));
    const here = ask(recorded.map((r) => verifyGolden(r.golden, r.w, r.n)), { where: 'this Mac' });
    none(recorded.flatMap((r, i) => matchFailures(here[i]!, r.golden, { target: hostTriple(), arch: ARCH, os: 'macos', machines: 'same' }, `${r.name}, replayed on this Mac`)), 'each golden replays on this Mac step for step, reading machines: same');

    const first = recorded[0]!;
    const linux = onLane('linux/amd64', [
      ...recorded.map((r) => verifyGolden(r.golden, r.w, r.n)),
      verifyGolden(first.golden, first.w, first.n, { shift: shift(AT, 'ball', 'linear.x') }),
    ]);
    none(recorded.flatMap((r, i) => matchFailures(linux[i]!, r.golden, { target: LINUX_X86, arch: 'x86_64', os: 'linux', machines: 'different' }, `${r.name}, replayed on Linux x86_64`)), 'each golden recorded on macOS matches on Linux step for step');
    none(shiftedFailures(linux[recorded.length]!, first.golden, AT, `${first.name}, replayed on Linux x86_64 shifted one ulp at step ${AT}`), 'the Linux leg steps the world itself');
  }, CONTAINER_TIMEOUT);
});
