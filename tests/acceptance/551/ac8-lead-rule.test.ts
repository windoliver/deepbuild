// AC8 #551.1600fba6: With one-way latencies of 5 ms and 80 ms to the relay, both copies' mean rollback depth stays
// within one step of each other and no copy waits at the window; a planted copy that ignores the lead rule fails on its
// depth histogram
//
// The paddle piece's match (60 Hz, delay 2, window 8) of 1,200 match steps over the test relay with `relay.latency`
// [5, 80]: player 1's frames take 5 ms to the relay and from it, player 2's 80 ms, on the relay's own clock. Each
// rollback's depth is the match steps it stepped again (`from` − `to` + 1, from the copy's `rolled_back`), and a copy's
// depth histogram counts them. The planted copy is `net_ignores_lead_rule`, judged by the same function. Wrong programs
// it fails: the merge base; a copy that never holds its clock, so the copy nearer the relay rolls back deeper; one that
// waits at the window instead of evening its lead.
import { describe, it } from 'vitest';
import { paddleDoc, rally } from './fixtures.ts';
import { AC, FULL, TIMEOUT, depthOf, failsNaming, none, play, rollbacksOf, useBuilds, useChildren, useTemp, type Copy551 } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 1200;
const plays = rally(2, STEPS);
const relay = { seed: 551, latency: [5, 80] };

/** The criterion's judge: both copies roll back, their mean depths are within one step of each other, and neither
 * waits. A failure on the depths names both copies' depth histograms. */
function judge(copies: Copy551[], what: string): string[] {
  const f: string[] = [];
  const stats = copies.map((c) => {
    const depths = rollbacksOf(c, what).map(depthOf);
    const histogram: Record<number, number> = {};
    for (const d of depths) histogram[d] = (histogram[d] ?? 0) + 1;
    return { player: c.player, mean: depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : Number.NaN, histogram, n: depths.length };
  });
  const said = stats.map((s) => `copy ${s.player}'s depth histogram ${JSON.stringify(s.histogram)} (mean ${s.mean.toFixed(2)} over ${s.n} rollbacks)`).join('; ');
  if (stats.some((s) => s.n === 0)) f.push(`${what}: a copy never rolled back: ${said}`);
  else if (Math.abs(stats[0]!.mean - stats[1]!.mean) > 1) f.push(`${what}: the copies' mean rollback depths differ by more than one step: ${said}`);
  for (const c of copies) if (c.waits.length) f.push(`${what}: copy ${c.player} waited ${c.waits.length} times, first at step ${c.waits[0]!.step} for player ${c.waits[0]!.player}`);
  return f;
}

describe(`${AC[8]} the lead rule evens rollback depth between copies at 5 ms and 80 ms from the relay`, () => {
  it(`${AC[8]} with one-way latencies of 5 ms and 80 ms both copies' mean rollback depth stays within one step of each other and no copy waits at the window`, async () => {
    const r = await play(builds.show(), temp(), 'AC8 5 ms and 80 ms', { document: paddleDoc(), steps: STEPS, plays, relay });
    none(judge(r.copies, 'AC8'), 'the lead rule at 5 ms and 80 ms');
  }, TIMEOUT);

  it(`${AC[8]} a planted copy that ignores the lead rule fails on its depth histogram`, async () => {
    const r = await play(builds.show(), temp(), 'AC8 planted', { document: paddleDoc(), steps: STEPS, plays, relay, planted: 'net_ignores_lead_rule' });
    failsNaming(judge(r.copies, 'AC8 planted'), [/depth histogram/], 'the copy that ignores the lead rule');
  }, TIMEOUT);
});
