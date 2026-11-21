// AC3 #280.f6f631ae: net.feel on the eight-seat fixture at window 8, delay 2 and 60 Hz, with every player at 40 ms
// one-way latency, 10 ms jitter and no spikes, reads 0 stall on every copy, since 50 ms stays under 10 steps (166.7 ms);
// with no jitter and `spikes {every: 10, hold: 250, player: 1, first: 5}`, which holds player 1's messages at 5, 15, 25,
// 35, 45 and 55 s of the 60 s run, every other copy's stall reads 6 × (250 + 40 − 166.7) ms = 740 ms a minute, within
// one step length per spike, since each held message for step k arrives 256.7 ms after step k's time while the copy
// reaches its window 133.3 ms after it; a planted meter that counts each stall as the held message's whole delay reads
// 290 ms a spike, 1,740 ms a minute, and fails, naming the copy
//
// net.feel runs through `match` (`check: "net.feel"`, its input in `feel`) on fixtures.ts's eight-seat fixture (8
// players, window 8, delay 2, 60 Hz) for its 3,600 steps, the players' seeded entries in `plays`. Its readings are one
// per copy (`readings[].stall_ms_per_min`). The criterion's judge: every copy but player 1's reads 740 ms a minute
// within 6 step lengths (one a spike); it fails naming the copy. The planted meter is `net_feel_stall_whole_delay`,
// judged by the same function. Wrong programs it fails: the merge base (net.feel isn't a check kind); a meter that times
// a stall by the held message's whole delay, or by the wall clock; a relay that holds nothing, or holds every player.
import { describe, expect, it } from 'vitest';
import { FEEL_STEPS, QUIET, SEAT_LIST, SPIKED, SPIKED_STALL, STALL_TOLERANCE, WHOLE_DELAY_STALL, eightDoc, feel, seededMoves } from './fixtures.ts';
import { AC, FULL, TIMEOUT, failsNaming, none, playFeel, useBuilds, useChildren, useTemp, type FeelReport } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const plays = seededMoves(FEEL_STEPS);
/** Player 1's messages are the ones held; every other copy waits on them. */
const others = SEAT_LIST.filter((s) => s !== 1);

/** The criterion's judge: each copy but player 1's reads `want` ms of stall a minute, within one step length a spike. */
function judge(r: FeelReport, want: number, what: string): string[] {
  const f: string[] = [];
  for (const seat of others) {
    const got = r.readings.find((x) => x.copy === seat)!.stall;
    if (Math.abs(got - want) > STALL_TOLERANCE) f.push(`${what}: copy ${seat} reads ${got.toFixed(1)} ms of stall a minute, not ${want.toFixed(1)} within ${STALL_TOLERANCE.toFixed(1)} (one step length a spike)`);
  }
  return f;
}

describe(`${AC[3]} net.feel's stall on the eight-seat fixture`, () => {
  it(`${AC[3]} with every player at 40 ms one-way latency, 10 ms jitter and no spikes, net.feel reads 0 stall on every copy`, async () => {
    const r = await playFeel(builds.show(), temp(), 'AC3 40 ms and 10 ms jitter', { document: eightDoc(), steps: FEEL_STEPS, plays, feel: feel(QUIET) });
    none(r.report.readings.filter((x) => x.stall !== 0).map((x) => `copy ${x.copy} reads ${x.stall} ms of stall a minute, not 0`), 'every copy reads 0 stall');
  }, TIMEOUT);

  it(`${AC[3]} with no jitter and spikes that hold player 1's messages for 250 ms at 5, 15, 25, 35, 45 and 55 s, every other copy's stall reads 740 ms a minute, within one step length per spike`, async () => {
    const r = await playFeel(builds.show(), temp(), 'AC3 spikes', { document: eightDoc(), steps: FEEL_STEPS, plays, feel: feel(SPIKED) });
    none(judge(r.report, SPIKED_STALL, 'AC3 spikes'), 'every copy but player 1\'s reads 740 ms of stall a minute');
  }, TIMEOUT);

  it(`${AC[3]} a planted meter that counts each stall as the held message's whole delay reads 290 ms a spike, 1,740 ms a minute, and fails, naming the copy`, async () => {
    const r = await playFeel(builds.show(), temp(), 'AC3 planted', { document: eightDoc(), steps: FEEL_STEPS, plays, feel: feel(SPIKED), planted: 'net_feel_stall_whole_delay' });
    for (const seat of others) {
      const got = r.report.readings.find((x) => x.copy === seat)!.stall;
      expect(Math.abs(got - WHOLE_DELAY_STALL), `the planted meter's copy ${seat} reads ${got} ms a minute, 1,740 (290 a spike) within one step length a spike`).toBeLessThanOrEqual(STALL_TOLERANCE);
    }
    failsNaming(judge(r.report, SPIKED_STALL, 'AC3 planted'), [/copy [2-8]\b/], 'the meter that counts each stall as the held message\'s whole delay');
  }, TIMEOUT);
});
