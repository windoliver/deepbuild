// AC2 #3467.6bd8eb71: At 200 seeded times of that fixture, jumped to in a seeded order, the frame shown has the
// planes the canonical decode of that frame gives, by hash. A planted worker that answers a picture it kept for
// another sample fails, naming the frame.
//
// "That fixture" is criterion 1's (fixtures.ts, `REORDERED`), one image@1 drawn at its own size, so the player
// decodes at the source's size and its planes compare with the canonical decode's. One `deep-canvas-render session`
// whose 200 steps each present one frame at a seeded time, in a seeded order (fixtures.ts, `seededJumps`): a step to
// another time is a jump, back as often as forward, and the player and its worker live through all of them. The
// frame shown at each is the `shown` row carrying the step's `t`, and its `planes` must be the SHA-256 the
// canonical decode names for the frame whose presentation interval holds that time: `deep-show run`'s
// `media_decode` with `frames: [0, …, 249]`. The same session with `planted: "answers_picture_kept_for_another"`
// must fail the same check, each failure naming the frame that should have shown.

import { describe, expect, it } from 'vitest';
import { REORDERED, seededJumps } from './fixtures.ts';
import { ITEM, TIMEOUT, board, canonicalHashes, makeFixture, plantedRan, render, sessionLine, stored, useBinary, useTemp } from './helpers.ts';
import { judgeJumps, type JsonObject } from './judges.ts';

const renderBin = useBinary('deep-canvas-render');
const showBin = useBinary('deep-show');
const temp = useTemp('jumps');
const JUMPS = seededJumps(REORDERED, 200);
const PLANTED = 'answers_picture_kept_for_another';

let made: { doc: JsonObject; store: string; canon: string[] } | undefined;
/** The recording in a store, the board that plays it at its own size, and the canonical decode's hash of each frame. */
function fixture(show: string): { doc: JsonObject; store: string; canon: string[] } {
  if (made === undefined) {
    const dir = temp();
    const path = makeFixture(REORDERED, dir);
    const canon = canonicalHashes(show, path, REORDERED.frames, dir);
    const { store, sha } = stored(dir, path);
    made = { doc: board('jumps', sha, [REORDERED.width, REORDERED.height], 12), store, canon };
  }
  return made;
}

describe('AC2 #3467.6bd8eb71 a jump shows the frame at its time, as the canonical decode gives it', () => {
  it('AC2 #3467.6bd8eb71 at 200 seeded times jumped to in a seeded order, the frame shown has the planes of the canonical decode of that frame', () => {
    const [bin, show] = [renderBin(), showBin()];
    const { doc, store, canon } = fixture(show);
    const [answer] = render(bin, 'session', [sessionLine(doc, store, JUMPS.map((j) => j.t))], 'session jumping to 200 seeded times');
    const failures = judgeJumps(answer, ITEM, JUMPS, canon);
    console.log(`AC2 #3467.6bd8eb71 ${failures.length === 0 ? `all ${JUMPS.length} jumps show the canonical decode's frame` : `${failures.length} failures, the first: ${failures[0]}`}`);
    expect(failures, 'each jump shows the frame at its time, by its planes\' hash').toEqual([]);
  }, TIMEOUT);

  it('AC2 #3467.6bd8eb71 a planted worker that answers a picture it kept for another sample fails the same check, naming the frame', () => {
    const [bin, show] = [renderBin(), showBin()];
    const { doc, store, canon } = fixture(show);
    const [answer] = render(bin, 'session', [sessionLine(doc, store, JUMPS.map((j) => j.t), PLANTED)], `session jumping to 200 seeded times, planted ${PLANTED}`);
    plantedRan(answer, PLANTED);
    const failures = judgeJumps(answer, ITEM, JUMPS, canon);
    console.log(`AC2 #3467.6bd8eb71 planted ${PLANTED}: ${failures.length} failures over the ${JUMPS.length} jumps, the first: ${failures[0] ?? 'none'}`);
    expect(failures.length, 'the check fails on the planted worker').toBeGreaterThan(0);
    expect(failures.filter((f) => !/: the item shows .+, not source frame \d+, the frame at that time/.test(f)), 'each failure names the frame that should have shown').toEqual([]);
  }, TIMEOUT);
});
