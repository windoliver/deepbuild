// AC7 #550.31a59430: A planted one-ulp change, the lowest mantissa bit, to the ball's x velocity on one copy at match
// step 310 is caught at the hash for step 360 and named as step 310, the ball and that field; a planted full-state hash
// that rounds floats to 1e-6 misses it and fails
//
// The paddle piece's match over the test relay with the plant `ONE_ULP`: the lowest bit of `court.ball_vx`'s f64 flipped
// right after copy 2 runs match step 310, each time it runs it (fixtures.ts). The ball moves 0.3 a step from then on, so
// the change stays far below 1e-6 through step 360 and never changes which way a bounce goes. The planted hash is
// `net_hash_rounds_floats` (README: Planted twins), judged by the same function. Wrong programs it fails: the merge
// base (no plant, no locator); a full-state hash that rounds, or reads floats short of every bit (the planted one).
import { describe, it } from 'vitest';
import { BALL_VX_FIELD, ONE_ULP, rally } from './fixtures.ts';
import { AC, FULL, TIMEOUT, caughtFailures, failsNaming, namedFailures, none, play, players, useBuilds, useChildren, useTemp, type NetCopy } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const plays = rally(2, 600);
const located = (one: NetCopy, two: NetCopy, what: string): string[] => [
  ...caughtFailures(one, two, what),
  ...namedFailures(one, what, { step: 310, module: 'logic', field: BALL_VX_FIELD }),
  ...namedFailures(two, what, { step: 310, module: 'logic', field: BALL_VX_FIELD }),
];

describe(`${AC[7]} a one-ulp change to the ball's x velocity`, () => {
  it(`${AC[7]} caught at the hash for step 360 and named as step 310 and the ball's x velocity, and a full-state hash that rounds floats to 1e-6 misses it and fails`, async () => {
    const { copies } = await play(builds.show(), temp(), 'AC7 one ulp', { steps: 600, plays, plant: ONE_ULP });
    const [one, two] = players(copies, 2, 'AC7');
    none(located(one, two, 'AC7'), 'a one-ulp change is caught at 360 and named at 310');
    const rounded = await play(builds.show(), temp(), 'AC7 the rounding hash', { steps: 600, plays, plant: ONE_ULP, planted: 'net_hash_rounds_floats' });
    const [r1, r2] = players(rounded.copies, 2, 'AC7 planted');
    failsNaming(located(r1, r2, 'AC7 planted'), [/agree at the hash for step 360/], 'the full-state hash that rounds floats to 1e-6');
  }, TIMEOUT);
});
