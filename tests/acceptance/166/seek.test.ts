// #166.cc52bd24: "With waves, ripples and rain on, a frame reached by seeking equals the played one by pixel hash"
//
// The fixture (helpers.ts `harbour`, 480 × 270): the lake (four waves, LAKE_WAVES), its ripples at the default 0.3 and
// rain at 50 drops per m² per s, reflecting a red post and two crates through its own mirror, under a day sky and a sun.
// The film is played from frame 0 to 90 at 30 fps; frames 17, 44 and 89 are each opened cold by a seek (`from`) and
// must have the played frames' pixel hashes.
//
// Not vacuous: the waves move (frames 17 and 44 differ), and at frame 44 the same lake without rain, and without
// ripples, each has another hash, so both are drawn. Wrong programs: rings, ripples or waves advanced frame by frame
// (integrated) instead of read from t; a hash seeded by the frame counter; anything kept from an earlier frame.
import { describe, expect, it } from 'vitest';
import { AC, LAKE_WAVES, harbour, hashAt, look3d, requireGpu, runGpu, useGpu, useOut, view3d, writeJson } from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [480, 270];
const LOOK = look3d('seek-166');

describe(`${AC[2]} with waves, ripples and rain on, seeking equals playing`, () => {
  it(`${AC[2]} frames 17, 44 and 89 reached by seeking have the played frames' pixel hashes, and the waves, ripples and rain show`, () => {
    requireGpu();
    const dir = out();
    const doc = writeJson(dir, 'lake', harbour('lake-seek', SIZE, { waves: LAKE_WAVES, ripples: { strength: 0.3 }, rain: 50 }));
    const dry = writeJson(dir, 'dry', harbour('lake-dry', SIZE, { waves: LAKE_WAVES, ripples: { strength: 0.3 }, rain: 0 }));
    const smooth = writeJson(dir, 'smooth', harbour('lake-smooth', SIZE, { waves: LAKE_WAVES, ripples: { strength: 0 }, rain: 50 }));
    const seekTo = (d: string, n: number) => view3d({ doc: d, look: LOOK, size: SIZE, from: n, frames: 1, fps: 30 });
    const [played, s17, s44, s89, dry44, smooth44] = runGpu(bin(), dir, [
      view3d({ doc, look: LOOK, size: SIZE, frames: 90, fps: 30 }), seekTo(doc, 17), seekTo(doc, 44), seekTo(doc, 89), seekTo(dry, 44), seekTo(smooth, 44),
    ]);
    const p = (n: number) => hashAt(played!, n, 'the played film');
    expect(hashAt(s17!, 17, 'the seek to 17'), 'frame 17 seeked equals frame 17 played').toBe(p(17));
    expect(hashAt(s44!, 44, 'the seek to 44'), 'frame 44 seeked equals frame 44 played').toBe(p(44));
    expect(hashAt(s89!, 89, 'the seek to 89'), 'frame 89 seeked equals frame 89 played').toBe(p(89));
    expect(p(17), 'the waves move between frames 17 and 44').not.toBe(p(44));
    expect(hashAt(dry44!, 44, 'the lake without rain'), 'the rain is drawn: without it frame 44 differs').not.toBe(p(44));
    expect(hashAt(smooth44!, 44, 'the lake without ripples'), 'the ripples are drawn: without them frame 44 differs').not.toBe(p(44));
  });
});
