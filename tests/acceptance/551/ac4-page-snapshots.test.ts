// AC4 #551.44ef3626: In the two-player piece, whose logic writes at most 3 of its 64 memory pages in a match step,
// net.budget counts under 12 MiB/s of logic snapshot bytes at 60 Hz, where full copies of its 4 MiB memory would move
// 240 MiB/s; a rollback from these snapshots reaches the same full-state hash at every confirmed step as one from full
// copies; and a planted ring that misses a page written only by memory.fill fails net.rollback, naming the first step
// that differs
//
// The paddle piece's logic `rules` has a memory of 64 pages (4 MiB) and writes page 0 each step, page 50 with
// `memory.fill` alone at every step k ≡ 3 (mod 10) and page 40 at k ≡ 10, 27 (mod 60): at most 3 pages a step
// (fixtures.ts). net.budget's `snapshot_bytes_per_s.logic` is read twice: with the rollback ring as the design keeps
// it, and with `match`'s `ring: "full"`, where logic's rollback checkpoints hold its whole memory, which must count
// 4 MiB × 60 a second. The rollbacks are `match` over the test relay with each frame held back a seeded whole number of
// match steps up to 8, a full-state hash at every match step. The planted ring is `net_ring_misses_fill`, under
// `check: "net.rollback"` and the same schedule. Wrong programs it fails: the merge base; a ring of whole copies; a
// count that leaves out page 0 or counts every re-run step; a rollback that rebuilds memory from a checkpoint
// outside the window; a ring that finds written pages by stores alone.
import { describe, expect, it } from 'vitest';
import { EVERY_STEP, PAGE, PAGES, RATE, WINDOW, paddleDoc, rally } from './fixtures.ts';
import { AC, FULL, TIMEOUT, firstParted, isObject, lowestNamed, none, play, sameHashes, show, useBuilds, useChildren, useTemp, type Check } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 600;
const MIB = 1024 * 1024;
const plays = rally(2, STEPS);
const held = { seed: 551, back: { up_to: WINDOW } } as const;

/** net.budget's count of logic's rollback snapshot bytes a second (README: net.budget's report). */
function logicBytes(c: Check, what: string): number {
  const by = c.raw['snapshot_bytes_per_s'];
  expect(isObject(by) && typeof by['logic'] === 'number', `${what}: net.budget counts each canvas module's rollback snapshot bytes a second (snapshot_bytes_per_s.logic): ${show(c.raw, 800)}`).toBe(true);
  return (by as { logic: number }).logic;
}

describe(`${AC[4]} logic's rollback ring as page diffs`, () => {
  it(`${AC[4]} net.budget counts under 12 MiB/s of logic snapshot bytes at 60 Hz, where full copies of its 4 MiB memory would move 240 MiB/s`, async () => {
    const document = paddleDoc();
    const pages = await play(builds.show(), temp(), 'AC4 net.budget, page diffs', { document, steps: STEPS, plays, check: 'net.budget' });
    const full = await play(builds.show(), temp(), 'AC4 net.budget, whole copies', { document, steps: STEPS, plays, check: 'net.budget', ring: 'full' });
    const [p, w] = [logicBytes(pages.check!, 'AC4 page diffs'), logicBytes(full.check!, 'AC4 whole copies')];
    const whole = PAGES * PAGE * RATE;
    const f: string[] = [];
    if (!(p < 12 * MIB)) f.push(`net.budget counts ${(p / MIB).toFixed(2)} MiB/s of logic snapshot bytes, not under 12 MiB/s`);
    if (p < PAGE * RATE) f.push(`net.budget counts ${(p / MIB).toFixed(2)} MiB/s, less than the one page (page 0) every step writes, ${(PAGE * RATE) / MIB} MiB/s`);
    if (w < whole || w > whole * 1.01) f.push(`with whole copies net.budget counts ${(w / MIB).toFixed(2)} MiB/s, not the 240 MiB/s of 4 MiB at 60 Hz`);
    none(f, 'logic\'s snapshot bytes, counted by net.budget');
  }, TIMEOUT);

  it(`${AC[4]} a rollback from these snapshots reaches the same full-state hash at every confirmed step as one from full copies`, async () => {
    const document = paddleDoc({ hash_every: EVERY_STEP });
    const pages = await play(builds.show(), temp(), 'AC4 rollbacks from page diffs', { document, steps: STEPS, plays, relay: held });
    const full = await play(builds.show(), temp(), 'AC4 rollbacks from whole copies', { document, steps: STEPS, plays, relay: held, ring: 'full' });
    const f: string[] = [];
    for (const c of pages.copies) if (c.rollbacks === 0) f.push(`copy ${c.player} never rolled back from its page diffs`);
    for (const [i, c] of pages.copies.entries()) f.push(...sameHashes(c, full.copies[i]!, `copy ${c.player} from page diffs and from whole copies`, STEPS - 2 * WINDOW));
    none(f, 'rollbacks from page diffs and from whole copies');
  }, TIMEOUT);

  it(`${AC[4]} a planted ring that misses a page written only by memory.fill fails net.rollback, naming the first step that differs`, async () => {
    const document = paddleDoc({ hash_every: EVERY_STEP });
    const onTime = await play(builds.show(), temp(), 'AC4 every message on time', { document, steps: STEPS, plays });
    const twin = await play(builds.show(), temp(), 'AC4 net.rollback, planted', { document, steps: STEPS, plays, relay: held, check: 'net.rollback', planted: 'net_ring_misses_fill' });
    const parted = firstParted(twin.copies, onTime.copies);
    expect(parted, 'under the planted ring, a copy\'s full-state hashes part from the on-time run\'s').not.toBeNull();
    expect(twin.check!.verdict, `net.rollback fails the planted ring: ${JSON.stringify(twin.check!.raw).slice(0, 800)}`).toBe('FAIL');
    expect(lowestNamed(twin.check!), `net.rollback names step ${parted}, the first step that differs: ${JSON.stringify(twin.check!.failures).slice(0, 800)}`).toBe(parted);
  }, TIMEOUT);
});
