// AC5 #550.608848dc: With hashes every 60 match steps, a planted copy that adds 1 to a byte of logic memory no step
// reads each time it runs match step 310 is caught at the hash for step 360, and net.desync names step 310, logic and
// its memory, though every step hash of both copies agrees; a planted locator that compares step hashes alone names no
// step and fails
//
// The paddle piece's match over the test relay with the plant `MEMORY_BYTE`: 1 added to the byte at 0xF000 of
// `court`'s memory, outside every region, which no step reads or writes, right after copy 2 runs match step 310, each
// time it runs it (fixtures.ts). Step hashes are #540's rows' `hash`, per logic item (Logic: checkpoints and bake: a
// step hash covers the globals, the arrays the step wrote and its occurrences, never all of memory). The planted
// locator is `net_locates_by_step_hashes` (README: Planted twins), judged by the same function. Wrong programs it
// fails: the merge base (no plant, no locator); a full-state hash that leaves memory out (nothing is caught); a locator
// that compares step hashes (the planted one), or names the array a step wrote.
import { describe, expect, it } from 'vitest';
import { MEMORY_BYTE, MEMORY_FIELD, rally } from './fixtures.ts';
import { AC, FULL, TIMEOUT, caughtFailures, failsNaming, namedFailures, none, play, players, useBuilds, useChildren, useTemp, type NetCopy } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const plays = rally(2, 600);

/** Every step hash both copies give agrees, over at least the steps up to the hash for 360. */
function stepHashFailures(a: NetCopy, b: NetCopy, what: string): string[] {
  const theirs = new Map(b.rows.map((r) => [r.step, r.hash]));
  let shared = 0;
  const f: string[] = [];
  for (const r of a.rows) {
    if (!theirs.has(r.step)) continue;
    shared += 1;
    if (r.hash === null || theirs.get(r.step) !== r.hash) { f.push(`${what}: the copies' step hashes for court differ at step ${r.step}: ${String(r.hash)} and ${String(theirs.get(r.step))}`); break; }
  }
  if (shared < 361) f.push(`${what}: the copies give step hashes at only ${shared} shared steps, fewer than the 361 up to step 360`);
  return f;
}
/** The criterion's judge: caught at 360, named step 310, logic and its memory, on both copies. */
const located = (one: NetCopy, two: NetCopy, what: string): string[] => [
  ...caughtFailures(one, two, what),
  ...namedFailures(one, what, { step: 310, module: 'logic', field: MEMORY_FIELD }),
  ...namedFailures(two, what, { step: 310, module: 'logic', field: MEMORY_FIELD }),
];

describe(`${AC[5]} a change to logic memory no step reads, located by full-state hashes`, () => {
  it(`${AC[5]} caught at the hash for step 360, net.desync names step 310, logic and its memory, while every step hash agrees`, async () => {
    const { copies } = await play(builds.show(), temp(), 'AC5 the memory byte', { steps: 600, plays, plant: MEMORY_BYTE });
    const [one, two] = players(copies, 2, 'AC5');
    none([...located(one, two, 'AC5'), ...stepHashFailures(one, two, 'AC5')], 'a change to unread memory is caught and named, though the step hashes agree');
  }, TIMEOUT);

  it(`${AC[5]} a planted locator that compares step hashes alone names no step and fails`, async () => {
    const { copies } = await play(builds.show(), temp(), 'AC5 the step-hash locator', { steps: 600, plays, plant: MEMORY_BYTE, planted: 'net_locates_by_step_hashes' });
    const [one, two] = players(copies, 2, 'AC5 planted');
    // The plant still lands where the step hashes can't see it, so the locator's miss is its own.
    expect(stepHashFailures(one, two, 'AC5 planted'), 'with the planted locator, every step hash of both copies still agrees').toEqual([]);
    failsNaming(located(one, two, 'AC5 planted'), [/names step (null|\d+), not 310/], 'the locator that compares step hashes');
  }, TIMEOUT);
});
