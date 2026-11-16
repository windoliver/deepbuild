// #1383.9241d5cb: "Seeking and playing a snow line falling 300 m over 10 s match by pixel hash"
//
// Fixture (helpers: fixtureDoc, shot `snow`; README: Fixtures): the fixture document's massifs seen from the east at
// 320 × 180, their snow lines keyed by channels on the `where` thresholds: entry 0's `height.min` from 420 m at 0 s to
// 120 m at 10 s, and the north entry's from 300 m to 0 m, each falling 300 m over 10 s. At 4 frames a second, frame n is
// at n ÷ 4 s; frame 40 is 10 s.
//
// Played: one `deep-gpu run` draws every frame from 0 to 40 in order. Sought: another process opens the document at
// frame 40 and then seeks, through `view3d`'s `seeks`, to frames 0, 20, 10, 30, 3, 39, 15 and 33, in that order.
//
// Expected: each sought frame's `pixel_hash` equals the played frame's. So that nothing still or blank can pass, the
// played frames 0, 20 and 40 differ from each other by pixel hash (the line moves), and each passes #1399's guard (at
// least 32 colours, at least 5% off the modal colour).
// Catches: the base (no cover); snow that accumulates or melts frame by frame, so a frame depends on the frames drawn
// before it; a threshold read from the frame before; a cache of the cover that a seek doesn't refresh.
import { describe, expect, it } from 'vitest';
import { AC, FPS, TIMEOUT, blankness, checkerAsset, finalOf, fixtureDoc, frameAt, framesOf, hashOf, none, requireMetal, runGpu, useGpu, useOut, view3d, writeJson } from './helpers.ts';

const gpu = useGpu();
const out = useOut();
const SIZE: [number, number] = [320, 180];
const LAST = 40;
const SOUGHT = [0, 20, 10, 30, 3, 39, 15, 33];

describe(`${AC[6]} a snow line falling 300 m over 10 s, sought and played`, () => {
  it(`${AC[6]} every sought frame of the falling snow line has the played frame's pixel hash, and the line moves`, () => {
    requireMetal();
    const dir = out();
    const assets = checkerAsset(dir);
    const doc = writeJson(dir, 'snow', fixtureDoc({ shot: 'snow', size: SIZE }));
    const [played] = runGpu(gpu(), dir, [view3d({ doc, size: SIZE, frames: LAST + 1, capture: [0, 20, LAST], assets })]);
    const seeks = [LAST, ...SOUGHT].slice(0, -1).map((after, i) => ({ after, to: SOUGHT[i]! }));
    const [sought] = runGpu(gpu(), dir, [view3d({ doc, size: SIZE, from: LAST, frames: SOUGHT.length + 1, seeks, assets })]);
    const play = framesOf(played!, 'the snow line played');
    const seek = framesOf(sought!, 'the snow line sought');
    expect(seek.map((f) => f['frame']), 'the sought call draws frame 40, then each frame it seeks to, in order').toEqual([LAST, ...SOUGHT]);

    const moving: string[] = [];
    for (const n of [0, 20, LAST]) {
      const why = blankness(finalOf(dir, frameAt(play, n, 'the snow line played'), 'the snow line played'));
      if (why) moving.push(`played frame ${n} is blank by #1399's guard: ${why}`);
    }
    const [h0, h20, h40] = [0, 20, LAST].map((n) => hashOf(frameAt(play, n, 'the snow line played'), 'the snow line played'));
    if (h0 === h20 || h20 === h40 || h0 === h40) moving.push(`the played frames at 0 s, 5 s and 10 s don't all differ (${h0}, ${h20}, ${h40}): the snow line doesn't move`);
    none(moving, 'the snow line is drawn and falls');

    const failures: string[] = [];
    for (const f of seek) {
      const n = f['frame'] as number;
      const p = hashOf(frameAt(play, n, 'the snow line played'), 'the snow line played');
      const s = hashOf(f, 'the snow line sought');
      if (s !== p) failures.push(`frame ${n} (${(n / FPS).toFixed(2)} s): sought ${s}, played ${p}`);
    }
    console.log(`${AC[6]}: ${seek.length} sought frames against the played ones, ${failures.length} differ`);
    none(failures, 'seeking and playing the snow line match by pixel hash');
  }, TIMEOUT);
});
