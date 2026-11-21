// AC11 #551.b7783405: A three-player paddle piece passes net.rollback under 8 seeded schedules and one that holds every
// message 8 steps, including a frame that brings player 2's entry for step 640 and player 3's for step 636 to copy 1 at
// step 643, which rolls back to step 636 and matches the on-time run at every confirmed step; a planted rollback that
// rewinds to the last entry it read, step 640, fails, naming step 636
//
// fixtures.ts's paddle piece for 3 players (player 3 spins), a full-state hash at every match step, 700 match steps.
// net.rollback is `match`'s check: with no schedule given it plays its own 8 seeded schedules and one that holds every
// message exactly the window (8 steps), listed in its report's `schedules`; with `deliver` it plays that schedule. The
// frame: player 2 moves its paddle at step 638 (stamped 640) and player 3 spins at step 634 (stamped 636), neither
// making another entry from 622 to 656, and `deliver` holds both messages from copy 1 until it has run step 643. The
// planted rollback is `net_rewinds_to_last_read`. Wrong programs it fails: the merge base; a rollback to the entry read
// last; schedules that never bring two peers' late entries to one copy.
import { describe, expect, it } from 'vitest';
import { DOC, EVERY_STEP, WINDOW, lastValue, paddleDoc, rally, withOnly } from './fixtures.ts';
import { AC, FULL, TIMEOUT, isObject, lowestNamed, none, play, rollbacksOf, sameHashes, show, useBuilds, useChildren, useTemp } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 700;
const document = paddleDoc({ players: 3, hash_every: EVERY_STEP }, DOC.trio);
const base = rally(3, STEPS);
const moved = lastValue(base, 2, 'paddle2', 622) === 2.5 ? -2.5 : 2.5;
const spun = lastValue(base, 3, 'spin', 622) === 0.75 ? -0.75 : 0.75;
const plays = withOnly(withOnly(base, 2, 622, 656, [{ step: 638, control: 'paddle2', value: moved }]), 3, 622, 656, [{ step: 634, control: 'spin', value: spun }]);
const relay = { seed: 551, deliver: [{ player: 2, step: 640, to: 1, at: 643 }, { player: 3, step: 636, to: 1, at: 643 }] };

describe(`${AC[11]} three players, two late entries for different steps in one frame`, () => {
  it(`${AC[11]} the three-player paddle piece passes net.rollback under 8 seeded schedules and one that holds every message 8 steps`, async () => {
    const r = await play(builds.show(), temp(), 'AC11 net.rollback', { document, steps: STEPS, plays: base, relay: { seed: 551 }, check: 'net.rollback' });
    const c = r.check!;
    const schedules = Array.isArray(c.raw['schedules']) ? c.raw['schedules'].filter(isObject) : [];
    const seeds = new Set(schedules.filter((x) => typeof x['seed'] === 'number').map((x) => x['seed']));
    const f: string[] = [];
    if (c.verdict !== 'PASS' || c.failures.length) f.push(`net.rollback gives ${c.verdict}: ${show(c.failures, 800)}`);
    if (seeds.size !== 8) f.push(`net.rollback played ${seeds.size} seeded schedules, not 8: ${show(schedules, 800)}`);
    if (schedules.filter((x) => x['exactly'] === WINDOW).length !== 1) f.push(`net.rollback didn't play one schedule holding every message exactly ${WINDOW} steps: ${show(schedules, 800)}`);
    if (schedules.length !== 9) f.push(`net.rollback played ${schedules.length} schedules, not 9: ${show(schedules, 800)}`);
    none(f, 'net.rollback on the three-player piece');
  }, TIMEOUT);

  it(`${AC[11]} a frame that brings player 2's entry for step 640 and player 3's for step 636 to copy 1 at step 643 rolls it back to step 636, matching the on-time run at every confirmed step`, async () => {
    const onTime = await play(builds.show(), temp(), 'AC11 every message on time', { document, steps: STEPS, plays });
    const held = await play(builds.show(), temp(), 'AC11 the frame at 643', { document, steps: STEPS, plays, relay, check: 'net.rollback' });
    const f: string[] = [];
    if (held.check!.verdict !== 'PASS' || held.check!.failures.length) f.push(`net.rollback gives ${held.check!.verdict} under the schedule with that frame: ${show(held.check!.failures, 800)}`);
    const back = rollbacksOf(held.copies[0]!, 'AC11').filter((x) => x.from >= 643);
    if (!back.some((x) => x.to === 636)) f.push(`copy 1 didn't roll back to step 636 once it had run step 643; it rolled back ${JSON.stringify(back)}`);
    for (const [i, c] of held.copies.entries()) f.push(...sameHashes(c, onTime.copies[i]!, `copy ${c.player} and the on-time run`, STEPS - 3 * WINDOW));
    none(f, 'the rollback to step 636');
  }, TIMEOUT);

  it(`${AC[11]} a planted rollback that rewinds to the last entry it read, step 640, fails, naming step 636`, async () => {
    const twin = await play(builds.show(), temp(), 'AC11 net.rollback, planted', { document, steps: STEPS, plays, relay, check: 'net.rollback', planted: 'net_rewinds_to_last_read' });
    expect(twin.check!.verdict, `net.rollback fails the planted rollback: ${show(twin.check!.raw, 800)}`).toBe('FAIL');
    expect(lowestNamed(twin.check!), `net.rollback names step 636: ${show(twin.check!.failures, 800)}`).toBe(636);
  }, TIMEOUT);
});
