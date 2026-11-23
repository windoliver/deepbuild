// AC1 #550.92355c66: With hashes every 60 match steps, a planted one-unit shift in the ball's x velocity in one copy at
// match step 310 is caught at the hash for step 360, which stops the match on both copies with net.desync naming step
// 310, the ball and that field; and the relay's log shows no message holding anything but the player's entries, the
// match ID and hashes
//
// The piece is fixtures.ts's paddle piece (`court`, 20 Hz; net: 20 Hz, window 0, delay 4, a hash every 60 steps), both
// copies played by `match` in one process over the test relay on an honest rally, with the plant `UNIT_SHIFT` (1 added
// to `court.ball_vx` in copy 2 right after it runs match step 310, each time it runs it) and the relay's log asked for.
// Wrong programs it fails: the merge base (no plant, no locator: the match plays on); a copy that plays on past a
// mismatch; a locator that names the step of the hash (360) or another field; a copy that sends state.
import { describe, it } from 'vitest';
import { BALL_VX_FIELD, UNIT_SHIFT, rally } from './fixtures.ts';
import { AC, FULL, TIMEOUT, caughtFailures, namedFailures, none, play, players, useBuilds, useChildren, useTemp, wireFailures } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();

describe(`${AC[1]} a one-unit shift in the ball's x velocity, located`, () => {
  it(`${AC[1]} caught at the hash for step 360 on both copies, net.desync names step 310 and the ball's x velocity, and the relay carries only entries, the match ID and hashes`, async () => {
    const plays = rally(2, 600);
    const { copies, log } = await play(builds.show(), temp(), 'AC1 the shifted ball', { steps: 600, plays, plant: UNIT_SHIFT, relay: { seed: 550, log: true } });
    const [one, two] = players(copies, 2, 'AC1');
    none([
      ...caughtFailures(one, two, 'AC1'),
      ...namedFailures(one, 'AC1', { step: 310, module: 'logic', field: BALL_VX_FIELD }),
      ...namedFailures(two, 'AC1', { step: 310, module: 'logic', field: BALL_VX_FIELD }),
      ...wireFailures(log ?? [], copies, plays, 'AC1 the relay\'s log'),
    ], 'the shifted ball is caught at 360 and named at 310, and the relay carries nothing but entries, the match ID and hashes');
  }, TIMEOUT);
});
