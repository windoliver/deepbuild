// AC5 #280.b13fcc01: In the fixture with one mover per seat at 10 m/s that reverses on its player's input every second,
// the test relay delivering each of player 2's messages to copy 1 once copy 1 has run 5 steps past that message's
// step, and frames on the step grid, copy 1's correction p99 for player 2's mover is 2 × 10 m/s × 5 × the step length
// (1.67 m at 60 Hz) within 1 cm, since each of the run's 60 rollbacks, one per reversal, corrects it by that much, a
// message that brings nothing new rolling nothing back; a planted meter that measures a mover's frame-to-frame move
// instead of its jump across the rollback reads 1.5 m at p99 (0.17 m at p50) and fails, naming the item
//
// net.feel runs through `match` on fixtures.ts's eight-seat fixture in its moving form (every mover starts at 10 m/s,
// and its player's entry sets it to 10 m/s × the entry's value) for 3,600 steps. Player 2 reverses its mover once a
// second (60 entries, −1, 1, …); no other player makes an entry. The profile's own delays are 0, and `relay.late`
// (README) hands each of player 2's messages, for step k, to copy 1 once copy 1 has run step k + 5, and not before. `items`
// names player 2's mover, `items/mover_2`. Copy 1's report (#551's `rolled_back`) holds exactly 60 rollbacks. The
// criterion's judge reads copy 1's correction p99 and fails naming the item. The planted meter is
// `net_feel_correction_frame_to_frame`, judged by the same function. Wrong programs it fails: the merge base (net.feel
// isn't a check kind); a meter that measures the frame-to-frame move; a copy that rolls back on a message that brings
// nothing new.
import { describe, expect, it } from 'vitest';
import {
  CM, CORRECTION, FEEL_STEPS, FRAME_TO_FRAME_P50, FRAME_TO_FRAME_P99, LATE, LATE_COPY, ON_TIME, REVERSALS, REVERSER, eightDoc, feel, itemPath, reversals,
} from './fixtures.ts';
import { AC, FULL, TIMEOUT, failsNaming, none, playFeel, readingOf, useBuilds, useChildren, useTemp, type FeelReport } from './helpers.ts';
import { rollbacksOf } from '../551/helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const ITEM = itemPath(REVERSER);
const ask = { document: eightDoc({ moving: true }), steps: FEEL_STEPS, plays: reversals(), feel: feel(ON_TIME, { items: [ITEM] }), relay: { seed: 280, late: [LATE] } };

/** The criterion's judge: copy 1's correction p99 for player 2's mover, 1.67 m within 1 cm. */
function judge(r: FeelReport, what: string): string[] {
  const got = readingOf(r, LATE_COPY).correction.p99;
  return Math.abs(got - CORRECTION) <= CM ? [] : [`${what}: copy ${LATE_COPY}'s correction p99 for ${ITEM} reads ${got.toFixed(4)} m, not ${CORRECTION.toFixed(4)} within 1 cm`];
}

describe(`${AC[5]} net.feel's correction distance for a mover that reverses each second`, () => {
  it(`${AC[5]} with each of player 2's messages reaching copy 1 five steps late, copy 1's correction p99 for player 2's mover is 1.67 m within 1 cm, over 60 rollbacks, one per reversal`, async () => {
    const r = await playFeel(builds.show(), temp(), 'AC5 5 steps late', ask);
    const f = judge(r.report, 'AC5');
    const rolled = rollbacksOf(r.copies[LATE_COPY - 1]!, 'AC5');
    if (rolled.length !== REVERSALS) f.push(`AC5: copy ${LATE_COPY} rolled back ${rolled.length} times, not ${REVERSALS}, one per reversal: ${JSON.stringify(rolled.slice(0, 12))}`);
    none(f, 'copy 1\'s correction p99 for player 2\'s mover is 1.67 m');
  }, TIMEOUT);

  it(`${AC[5]} a planted meter that measures a mover's frame-to-frame move instead of its jump across the rollback reads 1.5 m at p99 (0.17 m at p50) and fails, naming the item`, async () => {
    const r = await playFeel(builds.show(), temp(), 'AC5 planted', { ...ask, planted: 'net_feel_correction_frame_to_frame' });
    const got = readingOf(r.report, LATE_COPY).correction;
    expect(Math.abs(got.p99 - FRAME_TO_FRAME_P99), `the planted meter's copy 1 reads correction p99 ${got.p99} m, 1.5 within 1 cm`).toBeLessThanOrEqual(CM);
    expect(Math.abs(got.p50 - FRAME_TO_FRAME_P50), `the planted meter's copy 1 reads correction p50 ${got.p50} m, 0.17 within 1 cm`).toBeLessThanOrEqual(CM);
    failsNaming(judge(r.report, 'AC5 planted'), [/items\/mover_2/], 'the meter that measures the frame-to-frame move');
  }, TIMEOUT);
});
