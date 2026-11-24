// AC2 #1722.3cd1b369: After a patch to rev 2, a render-back of rev 1 still equals rev 1's first snapshot, and rev 2's
// differs.
//
// The fixture (README: The fixture): AC1's document presented whole at t = 0 and 320 × 240 px, so it is rev 1, and its
// snapshot is rev 1's first; then the agent's next whole revision through `deep_show` (README: Readings, "a patch to
// rev 2"), which becomes rev 2 and moves both layers' content: the box 1.5 m to the right (`items/box/at/pos/0`), a 3D
// change, and the badge 120 px to the right (`items/badge/params/box`), a 2D one. Then, with rev 2 current, a
// render-back of rev 1 and one of rev 2, each at the same t and size.
//
// Rev 1's render-back must have the pixel hash of rev 1's first snapshot; rev 2's must be a snapshot whose pixel hash
// differs from it. Wrong programs this fails on: the merge base (README: The base); a render-back that draws the
// current revision for any `rev`, or rev 1's 3D frame under rev 2's 2D items, or rev 2's 3D frame under rev 1's
// (each changes rev 1's pixels); one that draws rev 1 for any `rev`, or refuses rev 2 (rev 2's would not differ).
import { describe, expect, it } from 'vitest';
import { AC2, changeToRev2, fixtureChecks, judge, present, presented, proof, renderBack, requireMetal, runShow, scenario, shown, useDir, useShow } from './helpers.ts';

const bin = useShow();
const dir = useDir();

describe(`${AC2} render-back of an earlier revision`, () => {
  it(`${AC2} after a patch to rev 2, a render-back of rev 1 still equals rev 1's first snapshot, and rev 2's differs`, () => {
    requireMetal();
    const replies = runShow(bin(), scenario(dir(), [present(), changeToRev2(), renderBack(1), renderBack(2)]), 'present rev 1, change to rev 2, render back rev 1 and rev 2');
    const first = presented(dir(), replies[0]!, 'presenting rev 1');
    fixtureChecks(first, 'presenting rev 1');
    expect(replies[1]!['rev'], `the agent's change on rev 1 makes rev 2: ${shown(replies[1])}`).toBe(2);

    const rev1 = judge(dir(), replies[2]!, first, 'render-back of rev 1 with rev 2 current', 'rev 1\'s first snapshot');
    const rev2 = judge(dir(), replies[3]!, first, 'render-back of rev 2', 'rev 1\'s first snapshot');
    proof('AC2 rev 1 first snapshot, then render-backs of rev 1 and rev 2', {
      first: { sha256: first.sha256, pixel_hash: first.pixelHash },
      rev1: rev1 === null ? { pixel_hash: first.pixelHash, equal: true } : rev1.kind === 'pixel_hash' ? { pixel_hash: rev1.back.pixelHash, equal: false } : replies[2]!,
      rev2: rev2 === null ? { pixel_hash: first.pixelHash, equal: true } : rev2.kind === 'pixel_hash' ? { pixel_hash: rev2.back.pixelHash, equal: false } : replies[3]!,
    });
    const failures: string[] = [];
    if (rev1 !== null) failures.push(rev1.text);
    if (rev2 === null) failures.push(`render-back of rev 2 has rev 1's first snapshot's pixel hash ${first.pixelHash}, though rev 2 moved the box and the badge`);
    else if (rev2.kind !== 'pixel_hash') failures.push(rev2.text);
    expect(failures, 'rev 1\'s render-back equals its first snapshot by pixel hash, and rev 2\'s is a snapshot that differs').toEqual([]);
  }, 1_800_000);
});
