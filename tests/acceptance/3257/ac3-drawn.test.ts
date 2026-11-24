// AC3 #3257.699e8b81: "Drawn: a 2 m square with that map, seen head-on at the distances where it is 256, 128, 64 and
// 32 px across. The share of its px the object-ID pass keeps is within 3 points of 23.4% at each, a starting value. On
// the merge base the square at 32 px keeps no pixel, and that run is shown"
//
// One `deep-gpu run` a binary, four `view3d` calls: the square (helpers: `squareDoc`), an unlit `mask` material over the
// fence at the default cutoff and the look's default `filter_taps`, centred in a 512 px frame of focal length 256 px at
// 2, 4, 8 and 16 m, so each pixel's centre is a texel's centre of the level its footprint picks. Its drawn share is the
// count of pixels the `ids` target names `fence` over the square's px². First the merge base's, printed, its 32 px
// square keeping none; then this checkout's four, each within 3 points of 23.4375%.
// Wrong programs: the base (43.75% at 128 px, 0 at 64 and 32 px); a chain made and not drawn.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, none, useDir, useGpu } from '../1634/helpers.ts';
import { FENCE_SHARE, fence } from './chains.ts';
import { AC, FAR, drawnShares, onReferenceMac, points, useBase, writeMap } from './helpers.ts';

const bin = useGpu();
const base = useBase();
const dir = useDir();
const listed = (shares: readonly number[]): string => shares.map((s, i) => `${FAR[i]!.px} px ${points(s)}`).join(', ');

describe(`${AC[3]} the fence square keeps its share as it recedes`, () => {
  it(`${AC[3]} the object-ID pass keeps within 3 points of 23.4% of the square's px at 256, 128, 64 and 32 px across, where the merge base keeps no pixel at 32 px`, () => {
    onReferenceMac();
    const map = writeMap(dir(), 'fence', fence());
    const before = drawnShares(base(), dir(), map);
    console.log(`${AC[3]}: the merge base's square keeps ${listed(before)}`);
    expect(before.at(-1), 'the merge base\'s square at 32 px keeps no pixel').toBe(0);
    const after = drawnShares(bin(), dir(), map);
    console.log(`${AC[3]}: this square keeps ${listed(after)}`);
    none(after.flatMap((s, i) => (Math.abs(s - FENCE_SHARE) <= 0.03 ? [] : [`at ${FAR[i]!.px} px across the object-ID pass keeps ${points(s)} of the square's px, not ${points(FENCE_SHARE)} within 3 points`])), 'the fence square\'s drawn shares');
  }, TIMEOUT);
});
