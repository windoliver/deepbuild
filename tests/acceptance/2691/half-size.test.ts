// #2691.ecd8e156: At internal scale 0.5 the mirrored picture equals, by pixel hash on one machine, a canonical render
// of the same scene made at half that render's size. A planted mirror that samples its target with the wrong scale
// shows the reflection shifted and fails, naming the offset.
//
// The scene is helpers.ts's half-size room: a mirror floor filling the frame under a red marker post and three
// crates, with nothing sized in px of the frame (no blur, no roughness, no line, point or label, no waves). One
// release `deep-gpu run` on this Mac's Metal GPU draws it twice by `view3d`, capturing #166's `reflection` target
// (at each pixel of a part that reflects, the linear color its mirror lookup returned, at the frame's internal size):
//   - the view: 1280 × 720 through a surface at internal scale 0.5, so 640 × 360 internal px;
//   - the canonical render: the same document at 640 × 360 with no surface, so at scale 1.
// Both mirrors are then half of 640 × 360, and the two targets are compared texel for texel by their SHA-256. The
// same pair is drawn with the floor a still water, which reflects through its own mirror (Material: water).
// The planted run draws the mirror pair with `--planted mirror_samples_full_frame` (README: Planted programs): the
// hashes differ, the marker's reflection stands at least a pixel from the canonical render's, and the failure names
// that offset. Off macOS, or with no Metal device, INCONCLUSIVE.
import { describe, expect, it } from 'vitest';
import {
  AC, CANONICAL, HALF_LOOK, VIEW, by, compareReflections, drewOf, halfSizeRoom, readReflection, requireMetal, runGpu, useOut, useRelease, view3d, writeJson,
  type Compared, type Planted,
} from './helpers.ts';

const bin = useRelease();
const out = useOut();
type Floor = 'mirror' | 'water';

/** Each floor's view at internal scale 0.5 and its canonical render at half the size, compared; one process. */
function pairs(floors: Floor[], planted?: Planted): Compared[] {
  const dir = out();
  const calls = floors.flatMap((floor) => [
    view3d({ doc: writeJson(dir, `view-${floor}`, halfSizeRoom(VIEW, floor)), look: HALF_LOOK, size: VIEW, frames: 1, fps: 30, capture: [0], targets: ['reflection'], surface: { internal_scale: 0.5 } }),
    view3d({ doc: writeJson(dir, `canonical-${floor}`, halfSizeRoom(CANONICAL, floor)), look: HALF_LOOK, size: CANONICAL, frames: 1, fps: 30, capture: [0], targets: ['reflection'] }),
  ]);
  const replies = runGpu(bin(), dir, calls, planted);
  return floors.map((floor, k) => {
    const what = `the room over a ${floor === 'mirror' ? 'mirror' : 'still water'}`;
    const [view, canonical] = [replies[2 * k]!, replies[2 * k + 1]!];
    const [v, c] = [drewOf(view, `${what}: the view`), drewOf(canonical, `${what}: the canonical render`)];
    expect([v.internal_scale, v.size_px, v.internal_px], `${what}: the view drew ${by(VIEW)} at internal scale 0.5, ${by(CANONICAL)} internal px`).toEqual([0.5, VIEW, CANONICAL]);
    expect([c.internal_scale, c.size_px, c.internal_px], `${what}: the canonical render drew ${by(CANONICAL)} at scale 1`).toEqual([1, CANONICAL, CANONICAL]);
    return compareReflections(readReflection(dir, view, 0, CANONICAL, `${what}: the view`), readReflection(dir, canonical, 0, CANONICAL, `${what}: the canonical render`), what);
  });
}

describe(`${AC[3]} at internal scale 0.5 the mirrored picture is a half-size canonical render's`, () => {
  it(`${AC[3]} the reflection target of a 1280 × 720 view at internal scale 0.5 has the SHA-256 of the same scene's canonical render at 640 × 360, for a plain mirror and for a still water's own`, () => {
    requireMetal();
    const [mirror, water] = pairs(['mirror', 'water']);
    console.log(`${AC[3]}: ${mirror!.sentence}\n${AC[3]}: ${water!.sentence}`);
    expect.soft(mirror!.view, mirror!.sentence).toBe(mirror!.canonical);
    expect(water!.view, water!.sentence).toBe(water!.canonical);
  }, 1_800_000);

  it(`${AC[3]} a planted mirror that samples its target with the wrong scale shows the reflection shifted and fails, naming the offset`, () => {
    requireMetal();
    const [mirror] = pairs(['mirror'], 'mirror_samples_full_frame');
    console.log(`${AC[3]}: under --planted mirror_samples_full_frame: ${mirror!.sentence}`);
    expect(mirror!.view, 'the planted mirror fails the comparison: the two reflection targets hash apart').not.toBe(mirror!.canonical);
    expect(Math.hypot(...mirror!.offset), `the planted mirror shows the reflection shifted, the marker at least a pixel from the canonical render's: ${mirror!.sentence}`).toBeGreaterThanOrEqual(1);
    expect(mirror!.sentence, 'the failure names the offset in px').toMatch(/the marker's reflection is offset by \(-?\d+\.\d\d, -?\d+\.\d\d\) px/);
  }, 1_800_000);
});
