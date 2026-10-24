import { describe, expect, it } from 'vitest';
import { FIGURE, keepProof, outcome, run, scenario, show, snapshots, useEvidence, useShowBinary } from './helpers.ts';

useShowBinary();
const evidence = useEvidence();

/** 60 frames a second, the time grammar's default rate: frame k is `${k}f`, and frame 60 is 1 s. */
const FRAMES = 60;

describe('AC3 seeking to 1 s gives the same snapshot hash as playing from 0 s to 1 s', () => {
  it('AC3 a render-back seeked straight to 1 s has the hash of the last frame of a play from 0 s through every frame to 1 s', () => {
    // Seek: a fresh hub whose first and only render-back is at 1 s.
    const seek = run(scenario(evidence(), [show(FIGURE, '1s')]));
    // Play: one hub rendering back every frame from 0 s to 1 s in order, so whatever a renderer
    // carries from frame to frame reaches the last one.
    const play = run(scenario(evidence(), Array.from({ length: FRAMES + 1 }, (_, k) => show(FIGURE, `${k}f`))));
    expect(outcome(seek[0]!), `the seek presents the figure: ${JSON.stringify(seek[0]!['issues'])?.slice(0, 1500)}`).toBe('presented');
    const sought = snapshots(seek[0]!);
    expect(sought.length, 'the seek returns one snapshot').toBe(1);
    const played = play.map((reply, k) => {
      expect(outcome(reply), `the play presents frame ${k}`).toBe('presented');
      const snaps = snapshots(reply, `frame ${k}`);
      expect(snaps.length, `frame ${k} returns one snapshot`).toBe(1);
      return snaps[0]!.sha256;
    });
    keepProof('ac3-hashes', { seek_1s: sought[0]!.sha256, play: played });
    // The marker moves, so the play's first and last frames differ and the comparison below can fail.
    expect(played[FRAMES], 'the play\'s last frame differs from its first (the marker moved)').not.toBe(played[0]);
    // A renderer that steps its motion from frame to frame, or carries state between frames, fails here.
    expect(played[FRAMES], 'the play\'s frame at 1 s has the seek\'s snapshot hash').toBe(sought[0]!.sha256);
  }, 300_000);
});
