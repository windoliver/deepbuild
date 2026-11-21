// AC4 #280.3cddbab4: With a fixed 80 ms one-way latency, no jitter, delay 2 at 60 Hz and every player's input changing
// every step, each rollback's depth is within one step of ⌊(80 ms − 2 step lengths) ÷ the step length⌋ + 1 = 3; a
// planted meter that counts depth from the step the late message arrived on reads 0 and fails, naming the copy
//
// net.feel runs through `match` on fixtures.ts's eight-seat fixture (window 8, delay 2, 60 Hz) for 1,200 steps, each
// player flipping its mover between 1 and −1 at every step, so every message brings an entry. Each rollback's depth is
// the match steps it stepped again: in each copy's report (#551's `rolled_back`, `from − to + 1`), and in net.feel's
// readings (`depth: {p50, p99}`), each within one step of 3. The criterion's judge reads net.feel's readings and fails
// naming the copy. The planted meter is `net_feel_depth_from_arrival`, judged by the same function. Wrong programs it
// fails: the merge base (net.feel isn't a check kind); a meter that counts depth from the step the late message arrived
// on, or from confirmed; a relay that adds the latency twice.
import { describe, expect, it } from 'vitest';
import { DEPTH, FIXED_80, eightDoc, everyStep, feel } from './fixtures.ts';
import { AC, FULL, TIMEOUT, failsNaming, none, playFeel, useBuilds, useChildren, useTemp, type FeelReport } from './helpers.ts';
import { depthOf, rollbacksOf } from '../551/helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 1200;
const plays = everyStep(STEPS);
const within = (d: number): boolean => Math.abs(d - DEPTH) <= 1;

/** The criterion's judge: every copy's depth readings, p50 and p99, within one step of 3. */
function judge(r: FeelReport, what: string): string[] {
  const f: string[] = [];
  for (const x of r.readings) if (!within(x.depth.p50) || !within(x.depth.p99)) f.push(`${what}: copy ${x.copy} reads rollback depth p50 ${x.depth.p50}, p99 ${x.depth.p99}, not ${DEPTH} within one step`);
  return f;
}

describe(`${AC[4]} net.feel's rollback depth at a fixed 80 ms`, () => {
  it(`${AC[4]} with a fixed 80 ms one-way latency, no jitter, delay 2 at 60 Hz and every player's input changing every step, each rollback's depth is within one step of 3`, async () => {
    const r = await playFeel(builds.show(), temp(), 'AC4 80 ms', { document: eightDoc(), steps: STEPS, plays, feel: feel(FIXED_80) });
    const f = judge(r.report, 'AC4');
    for (const c of r.copies) {
      const depths = rollbacksOf(c, 'AC4').map(depthOf);
      if (depths.length < STEPS / 2) f.push(`AC4: copy ${c.player} rolled back ${depths.length} times in ${STEPS} steps where every message brings an entry`);
      const off = depths.filter((d) => !within(d));
      if (off.length) f.push(`AC4: copy ${c.player} rolled back ${off.length} times to a depth other than ${DEPTH} within one step, the first ${off[0]}`);
    }
    none(f, 'every rollback is 3 steps deep within one step');
  }, TIMEOUT);

  it(`${AC[4]} a planted meter that counts depth from the step the late message arrived on reads 0 and fails, naming the copy`, async () => {
    const r = await playFeel(builds.show(), temp(), 'AC4 planted', { document: eightDoc(), steps: STEPS, plays, feel: feel(FIXED_80), planted: 'net_feel_depth_from_arrival' });
    for (const x of r.report.readings) expect([x.depth.p50, x.depth.p99], `the planted meter's copy ${x.copy} reads depth 0`).toEqual([0, 0]);
    failsNaming(judge(r.report, 'AC4 planted'), [/copy [1-8]\b/], 'the meter that counts depth from the step the late message arrived on');
  }, TIMEOUT);
});
