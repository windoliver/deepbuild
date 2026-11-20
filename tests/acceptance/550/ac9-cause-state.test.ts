// AC9 #550.b37be976: The first criterion's planted one-unit shift, with honest entries, still reports cause state, step
// 310, the ball and that field, and the two copies' track hashes agree at step 360
//
// The same match as criterion 1's (`UNIT_SHIFT` on copy 2 at match step 310, an honest rally, a hash every 60 steps),
// read for what the entries-first rule adds: each hash row's `track` (README: A copy's report) and net.desync's `cause`.
// Wrong programs it fails: the merge base (no track hash, no cause); a locator that reports cause entries for a change
// of state; a track hash over what differs between copies though their entries don't (each copy's own writer marks,
// arrival order, its own player).
import { describe, it } from 'vitest';
import { BALL_VX_FIELD, CAUGHT_AT, UNIT_SHIFT, rally } from './fixtures.ts';
import { AC, FULL, TIMEOUT, namedFailures, none, play, players, useBuilds, useChildren, useTemp } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();

describe(`${AC[9]} a change of state, with honest entries, keeps cause state`, () => {
  it(`${AC[9]} net.desync reports cause state, step 310 and the ball's x velocity, and the copies' track hashes agree at step 360`, async () => {
    const { copies } = await play(builds.show(), temp(), 'AC9 the shifted ball, honest entries', { steps: 600, plays: rally(2, 600), plant: UNIT_SHIFT });
    const [one, two] = players(copies, 2, 'AC9');
    const f = [
      ...namedFailures(one, 'AC9', { step: 310, module: 'logic', field: BALL_VX_FIELD, cause: 'state' }),
      ...namedFailures(two, 'AC9', { step: 310, module: 'logic', field: BALL_VX_FIELD, cause: 'state' }),
    ];
    const [ta, tb] = [one.tracks.get(CAUGHT_AT), two.tracks.get(CAUGHT_AT)];
    if (ta === undefined || tb === undefined) f.push(`AC9: a copy's hash row for step ${CAUGHT_AT} carries no track hash (track): ${String(ta)} and ${String(tb)}`);
    else if (!/^[0-9a-f]{16}$/.test(ta) || ta !== tb) f.push(`AC9: the copies' track hashes at step ${CAUGHT_AT} are ${ta} and ${tb}, not one u64 as 16 hex digits`);
    none(f, 'a change of state with honest entries reports cause state, and the track hashes agree');
  }, TIMEOUT);
});
