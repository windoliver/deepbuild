// AC6 #551.8bad0f6c: In the two-player piece, a 64 KiB page of logic memory written at match step 610 and again at
// 627, with player 2's entry stamped at step 625 arriving after the copy has run step 628, rolls back to step 625 with
// the on-time run's full-state hash there and matches the on-time run at every confirmed step after, though logic's
// nearest checkpoints, at steps 600 and 660, lie outside the window; a planted ring that keeps each step's pages as
// the step left them fails net.rollback, naming step 625, whether it restores the wrong bytes or steps again from the
// checkpoint at step 600, past the window
//
// The paddle piece's logic writes page 40 at every step k ≡ 10, 27 (mod 60), so at 610 and 627, and nothing else
// writes it; its own checkpoints come every 60 steps (fixtures.ts). Player 2 moves its paddle at step 623 (stamped
// 625) and makes no other entry from 610 to 640; the test relay's `deliver` holds every frame of player 2's carrying
// its message for step 625 from copy 1 until copy 1 has run step 628, and delivers everything else on time. A
// full-state hash at every match step. The planted ring is `net_ring_keeps_after`, under `check: "net.rollback"` and
// the same schedule. Wrong programs it fails: the merge base; a ring of after-images; a rollback that restores logic's
// own checkpoint at 600, outside the window; one that rolls back to another step than 625.
import { describe, expect, it } from 'vitest';
import { EVERY_STEP, WINDOW, lastValue, paddleDoc, rally, withOnly } from './fixtures.ts';
import { AC, FULL, TIMEOUT, failsNaming, none, play, rollbacksOf, sameHashes, show, useBuilds, useChildren, useTemp, type Copy551 } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 700;
const LATE = 625;
const RAN = 628;
const base = rally(2, STEPS);
const moved = lastValue(base, 2, 'paddle2', 610) === 2.5 ? -2.5 : 2.5;
const plays = withOnly(base, 2, 610, 640, [{ step: LATE - 2, control: 'paddle2', value: moved }]);
const relay = { seed: 551, deliver: [{ player: 2, step: LATE, to: 1, at: RAN }] };
const document = paddleDoc({ hash_every: EVERY_STEP });

/** The criterion's judge on copy 1: it rolled back to 625 from step 628 or later, its hash at 625 is the on-time run's,
 * and so is every confirmed step's after. Each failure names the step. */
function judge(c: Copy551, onTime: Copy551, what: string): string[] {
  const f: string[] = [];
  const to = rollbacksOf(c, what).filter((r) => r.from >= RAN).map((r) => r.to);
  if (!to.includes(LATE)) f.push(`${what}: copy 1 didn't roll back to step ${LATE} once it had run step ${RAN}; it rolled back to ${JSON.stringify(to)}`);
  if (to.some((t) => t < RAN - WINDOW)) f.push(`${what}: copy 1 restored step ${Math.min(...to)}, past the window of ${WINDOW} from step ${RAN}, for its entry at step ${LATE}`);
  const at = (x: Copy551): string | undefined => x.hashes.find((h) => h.step === LATE)?.hash;
  if (at(c) === undefined || at(c) !== at(onTime)) f.push(`${what}: copy 1's full-state hash at step ${LATE} is ${String(at(c))}, the on-time run's ${String(at(onTime))}`);
  f.push(...sameHashes({ ...c, hashes: c.hashes.filter((h) => h.step >= LATE) }, onTime, `${what}: copy 1 from step ${LATE} on and the on-time run`, STEPS - LATE - 3 * WINDOW));
  return f;
}

describe(`${AC[6]} a page written at 610 and 627, rolled back to 625 from its before-images`, () => {
  it(`${AC[6]} player 2's entry for step 625, arriving after step 628, rolls back to 625 with the on-time run's hash there and every confirmed step's after, though logic's checkpoints at 600 and 660 lie outside the window`, async () => {
    const onTime = await play(builds.show(), temp(), 'AC6 every message on time', { document, steps: STEPS, plays });
    const held = await play(builds.show(), temp(), 'AC6 the late entry', { document, steps: STEPS, plays, relay });
    none([...judge(held.copies[0]!, onTime.copies[0]!, 'AC6'), ...sameHashes(held.copies[1]!, onTime.copies[1]!, 'AC6 copy 2 and the on-time run', STEPS - 3 * WINDOW)], 'the rollback to step 625');
  }, TIMEOUT);

  it(`${AC[6]} a planted ring that keeps each step's pages as the step left them fails net.rollback, naming step 625`, async () => {
    const twin = await play(builds.show(), temp(), 'AC6 net.rollback, planted', { document, steps: STEPS, plays, relay, check: 'net.rollback', planted: 'net_ring_keeps_after' });
    expect(twin.check!.verdict, `net.rollback fails the planted ring: ${show(twin.check!.raw, 800)}`).toBe('FAIL');
    failsNaming(twin.check!.failures.map((x) => `net.rollback names step ${String(x['step'])}: ${show(x, 300)}`), [new RegExp(`names step ${LATE}:`)], 'the ring that keeps after-images');
    const lowest = twin.check!.failures.map((x) => x['step']).filter((s): s is number => typeof s === 'number').sort((a, b) => a - b)[0];
    expect(lowest, `the first step net.rollback names is ${LATE}`).toBe(LATE);
  }, TIMEOUT);
});
