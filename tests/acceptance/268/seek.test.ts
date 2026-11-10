// #268.d5fcb247: "With `shore` on, a frame reached by seeking to 20 s equals the one played to 20 s by pixel hash"
//
// The fixture (helpers.ts `harbourDoc`, 320 × 180): a 40 m lake whose material `harbour-water` carries LAKE_WAVES,
// ripples 0.3 and HARBOUR_SHORE (a foam band 0.5 m wide with breakup 0.5, whose noise drifts as a closed form of t; the
// calm swell with near 0.25 and far 20 m; shade 0.6), with a pile, a quay and a floating deck in `harbour-shore`, seen
// from a low camera. The film is played from frame 0 to frame 600 (20 s at 30 fps), and frame 600 is opened cold by a
// seek (`from`): one pixel hash. Not vacuous: at 20 s the same harbour with `shore: "none"`, and with breakup 0 (no
// drifting noise), each draw another frame, so the shore and its time-dependent noise are drawn. Wrong programs: foam
// noise advanced frame by frame, a field rebaked or carried per frame, anything kept from an earlier frame.
import { describe, expect, it } from 'vitest';
import { AC, HARBOUR_SHORE, LAKE_WAVES, type Water, harbourDoc, hashAt, look3d, requireGpu, runGpu, useGpu, useOut, view3d, writeJson } from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [320, 180];
const LOOK = look3d('seek-268');
const AT = 600;
const WATER: Water = { waves: LAKE_WAVES, ripples: { strength: 0.3 }, shore: HARBOUR_SHORE };

describe(`${AC[5]} with shore on, seeking equals playing`, () => {
  it(`${AC[5]} with shore on, the frame seeked to 20 s has the pixel hash of the one played to 20 s, and the shore shows`, () => {
    requireGpu();
    const dir = out();
    const doc = writeJson(dir, 'harbour', harbourDoc('harbour-seek', SIZE, WATER));
    const at20 = (name: string, w: Water) => view3d({ doc: writeJson(dir, name, harbourDoc(`harbour-${name}`, SIZE, w)), look: LOOK, size: SIZE, from: AT, frames: 1, fps: 30 });
    const [played, seeked, bare, solid] = runGpu(bin(), dir, [
      view3d({ doc, look: LOOK, size: SIZE, frames: AT + 1, fps: 30 }),
      view3d({ doc, look: LOOK, size: SIZE, from: AT, frames: 1, fps: 30 }),
      at20('bare', { ...WATER, shore: 'none' }),
      at20('solid', { ...WATER, shore: { ...HARBOUR_SHORE, foam: { width: 0.5, breakup: 0 } } }),
    ]);
    const p = hashAt(played!, AT, 'the played film');
    expect(hashAt(seeked!, AT, 'the seek to 20 s'), 'the frame seeked to 20 s equals the one played to 20 s').toBe(p);
    expect(hashAt(bare!, AT, 'the harbour with shore none'), 'the shore is drawn: with shore none 20 s differs').not.toBe(p);
    expect(hashAt(solid!, AT, 'the harbour with breakup 0'), 'the drifting breakup is drawn: with breakup 0 20 s differs').not.toBe(p);
  });
});
