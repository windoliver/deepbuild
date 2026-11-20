// #2760.dc56f46c: "A frame reached by seeking back to 2.25 s from 10 s equals the one played to 2.25 s by pixel hash. A
// planted material that starts a ring when a drawn frame first passes its occurrence draws none after the seek and
// fails, naming the material"
//
// The fixture (helpers.ts `pondDoc`, 480 × 270): criterion 1's still pond and its three touches at 1, 1.5 and 2 s, with
// `rings` at its defaults. One session plays the film from frame 0 to frame 45 at 20 fps (2.25 s). Another opens at
// frame 200 (10 s), draws it, and seeks back to frame 45 (`seeks: [{after: 200, to: 45}]`): the two frames 45 have one
// pixel hash. Not vacuous: the rings are in what is compared (frame 45 of the same pond with `rings: "none"` has another
// hash).
// The planted material (`deep-gpu run --planted water_rings_start_on_drawn_frame`): a ring starts when a drawn frame
// first passes its occurrence and is kept from frame to frame, so the played film still draws its rings, while the
// session that drew 10 s first has passed every occurrence and draws none after it seeks back. The suite's check
// compares the seek with the play and names the water's material: under the plant it must fail at 2.25 s naming
// `rings-water`, the frame after the seek being the ringless pond's. Wrong programs: rings started by the frames drawn,
// rings read from a live simulation or an earlier frame, a seek that restarts or drops them.
import { describe, expect, it } from 'vitest';
import {
  AC, STILL, TAPS, TAP_RINGS, WATER, type JsonObject, type Planted, failsNaming, hashAt, logicItem, look3d, none, pondDoc, putAsset, requireGpu, runGpu, threeTouches,
  useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [480, 270];
const LOOK = look3d('seek-2760');
const FPS = 20;
const AT = 45; // 2.25 s
const FAR = 200; // 10 s

/** Seeking back to 2.25 s from 10 s against playing to 2.25 s; a difference is a failure naming the water's material. */
function seekProblems(planted?: Planted): { failures: string[]; played: string; seeked: string; bare: string } {
  const dir = out();
  const taps = threeTouches();
  const assets = putAsset(dir, taps.program);
  const logic: Record<string, JsonObject> = { [TAPS]: logicItem(taps) };
  const doc = writeJson(dir, 'pond', pondDoc('pond-seek', SIZE, { ...STILL, rings: TAP_RINGS }, logic));
  const ringless = writeJson(dir, 'bare', pondDoc('pond-bare', SIZE, { ...STILL, rings: 'none' }, logic));
  const [play, seek, flat] = runGpu(bin(), dir, [
    view3d({ doc, look: LOOK, size: SIZE, frames: AT + 1, fps: FPS, assets }),
    view3d({ doc, look: LOOK, size: SIZE, from: FAR, frames: 2, fps: FPS, seeks: [{ after: FAR, to: AT }], assets }),
    view3d({ doc: ringless, look: LOOK, size: SIZE, from: AT, frames: 1, fps: FPS, assets }),
  ], planted);
  const played = hashAt(play!, AT, 'the played film'); const seeked = hashAt(seek!, AT, 'the session that seeks back from 10 s');
  const failures = played === seeked ? [] : [`material ${WATER}: the frame reached by seeking back to 2.25 s from 10 s (${seeked.slice(0, 12)}) differs from the one played to 2.25 s (${played.slice(0, 12)})`];
  return { failures, played, seeked, bare: hashAt(flat!, AT, 'the pond with rings: none') };
}

describe(`${AC[3]} rings read the baked list, so a frame seeked equals the frame played`, () => {
  it(`${AC[3]} a frame reached by seeking back to 2.25 s from 10 s equals the one played to 2.25 s by pixel hash`, () => {
    requireGpu();
    const { failures, played, bare } = seekProblems();
    none(failures, 'seeking back to 2.25 s from 10 s equals playing to 2.25 s');
    expect(bare, 'the rings are drawn at 2.25 s: the pond with rings: none has another frame 45').not.toBe(played);
  });

  it(`${AC[3]} a planted material that starts a ring when a drawn frame first passes its occurrence (--planted water_rings_start_on_drawn_frame) draws none after the seek and fails, naming the material`, () => {
    requireGpu();
    const { failures, played, seeked, bare } = seekProblems('water_rings_start_on_drawn_frame');
    failsNaming(failures, [`material ${WATER}`, '2.25 s'], 'water_rings_start_on_drawn_frame');
    expect(seeked, 'under the plant the frame after the seek back draws no ring: it is the frame of the pond with rings: none').toBe(bare);
    expect(played, 'under the plant the played film still draws its rings').not.toBe(bare);
  });
});
