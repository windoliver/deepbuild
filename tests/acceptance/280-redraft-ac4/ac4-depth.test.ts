// AC4 #280.3cddbab4: With a fixed 80 ms one-way latency, no jitter, delay 2 at 60 Hz and every player's input changing
// every step, each rollback's depth is within one step of ⌊(80 ms − 2 step lengths) ÷ the step length⌋ + 1 = 3; a
// planted meter that counts depth from the step the late message arrived on reads 0 and fails, naming the copy
//
// Blind redraft of the first draft's tests/acceptance/280/ac4-depth.test.ts (README: Why a redraft). net.feel runs
// through `match` on ../280/fixtures.ts's eight-seat fixture (window 8, delay 2, 60 Hz) for 1,200 steps, each player
// flipping its mover between 1 and −1 at every step, so every message brings an entry. Each rollback's depth is the
// match steps it stepped again (#551's `rolled_back`, `from − to + 1`). The criterion holds the rollbacks the latency
// sets: each one a copy made before it ran the match's last step, 1,199, is within one step of 3. A rollback made once
// the copy has run its last step, as it settles the steps it ran (#551: a copy that ran every step it was given still
// takes late messages, and its `done` waits until every step it ran is settled), steps again only up to that last
// step, so the end of the match cuts it short: it is held to at least 1 and at most 4 (3 and one step). net.feel's
// readings (`depth: {p50, p99}`) are within one step of 3 on every copy, which two or three cut-short rollbacks among
// about 1,200 don't move. The criterion's judge reads net.feel's readings and fails naming the copy; the planted meter
// is `net_feel_depth_from_arrival`, judged by the same function. Wrong programs it fails: the merge base (net.feel
// isn't a check kind); a meter that counts depth from the step the late message arrived on, or from confirmed; a relay
// that adds the latency twice (depth 5 or more); a copy that rolls back further than the latency asks at the match's end.
import { describe, expect, it } from 'vitest';
import { DEPTH, FIXED_80, eightDoc, everyStep, feel } from '../280/fixtures.ts';
import { AC, FULL, TIMEOUT, failsNaming, none, playFeel, useBuilds, useChildren, useTemp, type Copy551, type FeelReport } from '../280/helpers.ts';
import { depthOf, rollbacksOf } from '../551/helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 1200;
/** The match's last step: a rollback from it came once the copy had run every step it was given. */
const LAST = STEPS - 1;
const plays = everyStep(STEPS);
const within = (d: number): boolean => Math.abs(d - DEPTH) <= 1;

/** The criterion's judge: every copy's depth readings, p50 and p99, within one step of 3. */
function judge(r: FeelReport, what: string): string[] {
  const f: string[] = [];
  for (const x of r.readings) if (!within(x.depth.p50) || !within(x.depth.p99)) f.push(`${what}: copy ${x.copy} reads rollback depth p50 ${x.depth.p50}, p99 ${x.depth.p99}, not ${DEPTH} within one step`);
  return f;
}
/** Each copy's rollbacks: before its last step, every one within one step of 3, and at least one for every other step
 * of the match; from its last step, each 1 to 4 deep; none from past it. */
function rollbackFailures(copies: Copy551[], what: string): string[] {
  const f: string[] = [];
  const span = (r: { from: number; to: number }): string => `${r.to}..${r.from} (${depthOf(r)})`;
  for (const c of copies) {
    const all = rollbacksOf(c, what);
    const running = all.filter((r) => r.from < LAST);
    const settling = all.filter((r) => r.from === LAST);
    const past = all.filter((r) => r.from > LAST);
    if (running.length < STEPS / 2) f.push(`${what}: copy ${c.player} rolled back ${running.length} times before step ${LAST} in ${STEPS} steps where every message brings an entry`);
    const off = running.filter((r) => !within(depthOf(r)));
    if (off.length) f.push(`${what}: copy ${c.player} rolled back ${off.length} times before its last step to a depth other than ${DEPTH} within one step, the first ${span(off[0]!)}`);
    const deep = settling.filter((r) => depthOf(r) < 1 || depthOf(r) > DEPTH + 1);
    if (deep.length) f.push(`${what}: copy ${c.player} rolled back from its last step ${deep.length} times past ${DEPTH} and one step, the first ${span(deep[0]!)}`);
    if (past.length) f.push(`${what}: copy ${c.player} rolled back from step ${past[0]!.from}, past the match's last step ${LAST}`);
  }
  return f;
}

describe(`${AC[4]} net.feel's rollback depth at a fixed 80 ms`, () => {
  it(`${AC[4]} with a fixed 80 ms one-way latency, no jitter, delay 2 at 60 Hz and every player's input changing every step, each rollback a copy makes before its last step is within one step of 3, those from its last step no deeper, and net.feel reads depth 3 within one step`, async () => {
    const r = await playFeel(builds.show(), temp(), 'AC4 80 ms', { document: eightDoc(), steps: STEPS, plays, feel: feel(FIXED_80) });
    none([...judge(r.report, 'AC4'), ...rollbackFailures(r.copies, 'AC4')], 'every rollback the latency sets is 3 steps deep within one step');
  }, TIMEOUT);

  it(`${AC[4]} a planted meter that counts depth from the step the late message arrived on reads 0 and fails, naming the copy`, async () => {
    const r = await playFeel(builds.show(), temp(), 'AC4 planted', { document: eightDoc(), steps: STEPS, plays, feel: feel(FIXED_80), planted: 'net_feel_depth_from_arrival' });
    for (const x of r.report.readings) expect([x.depth.p50, x.depth.p99], `the planted meter's copy ${x.copy} reads depth 0`).toEqual([0, 0]);
    failsNaming(judge(r.report, 'AC4 planted'), [/copy [1-8]\b/], 'the meter that counts depth from the step the late message arrived on');
  }, TIMEOUT);
});
