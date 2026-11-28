import { describe, expect, it } from 'vitest';
import { CAP_DEFERS_FORCED_FRAMES, TEST_DEADLINE_MS, play, useShow, type Planted, type Played } from './helpers.ts';
import { ownTickFailures, type CapName, type Rate } from './judges.ts';

const show = useShow();
const WHERE_A_CAP_SKIPS_TICKS: readonly { cap: CapName; hz: Rate }[] = [{ cap: 'thermal', hz: 120 }, { cap: 'inactive', hz: 60 }, { cap: 'inactive', hz: 120 }];
const FLAGGED_NO_EARLIER_THAN_TICK = 100;

function forcedAndRequired(cap: CapName, hz: Rate, planted?: Planted): { tick: number; plays: Played[] } {
  const planting = planted ? { planted } : {};
  const unflagged = play(show(), { hz, cap, seed: null, ...planting });
  const tick = unflagged.presented.indexOf(false, FLAGGED_NO_EARLIER_THAN_TICK);
  expect(tick, `${unflagged.what}: the cap skips a tick from tick ${FLAGGED_NO_EARLIER_THAN_TICK} on, so a frame that passes the cap there can be told from one the cap lets through`).toBeGreaterThanOrEqual(FLAGGED_NO_EARLIER_THAN_TICK);
  return { tick, plays: [play(show(), { hz, cap, seed: null, forceRenderAt: tick, ...planting }), play(show(), { hz, cap, seed: null, requirePresentationAt: tick, ...planting })] };
}

describe('#3441 a forced render and a frame that requires presentation pass a cap', () => {
  it('AC5 #3441.68159139 a forced render and a frame that requires presentation present on their own tick under either cap, on a tick the cap skips without them; a planted cap that defers one fails, naming the frame', () => {
    const failures = WHERE_A_CAP_SKIPS_TICKS.flatMap(({ cap, hz }) => forcedAndRequired(cap, hz).plays.flatMap(ownTickFailures));
    expect(failures, 'the forced renders and the frames that require presentation that did not present on their own tick').toEqual([]);
    for (const { cap, hz } of WHERE_A_CAP_SKIPS_TICKS) {
      const { tick, plays } = forcedAndRequired(cap, hz, CAP_DEFERS_FORCED_FRAMES);
      const failed = plays.flatMap(ownTickFailures);
      for (const frame of ['forced render', 'frame that requires presentation']) {
        expect(failed.some((failure) => failure.includes(`the ${frame} at tick ${tick} did not present on its own tick`)), `the planted ${CAP_DEFERS_FORCED_FRAMES} fails under the ${cap} cap at ${hz} Hz, naming the ${frame} at tick ${tick}: ${JSON.stringify(failed)}`).toBe(true);
      }
    }
  }, TEST_DEADLINE_MS);
});
