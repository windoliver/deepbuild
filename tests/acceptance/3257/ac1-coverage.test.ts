// AC1 #3257.99ce0129: "In the decode worker, with no GPU: a 256 × 256 map with an opaque line one texel wide every 8
// texels each way keeps 23.4% of level 0, and each level down to 16 × 16 keeps within one percentage point of that at
// `alpha_cutoff: 0.5`. The merge base keeps 43.75% of level 1 and nothing from level 2, and that run is shown"
//
// The fence (./chains.ts) as a PNG, made ready by a `transcode` job with `alpha_cutoff: 0.5` in a decode worker, a
// process of `deep-gpu` that opens no GPU; the chain is read from the job's `out` file. First the merge base's own
// deep-gpu runs the same job and its kept shares are printed: 43.75% of level 1 and none of any level from level 2
// down, on the box rule's alphas (the criterion's "that run is shown"). Then this checkout's: level 0 the file's own
// byte for byte (helpers: `readMade`) keeping 15 ÷ 64, levels 1 to 4 within one point of it, every level below level 0
// storing the scope's two alphas, and the reply's `kept` listing each of the nine levels' shares as its bytes keep them.
// Wrong programs: the base (a plain box); a chain that rescales each level's alpha, which can't sit on two values; a
// reply that states shares its bytes don't keep.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, none, useDir, useGpu } from '../1634/helpers.ts';
import { FENCE_SHARE, boxChain, fence, keptShare, named, shareFaults, storedFaults, type Level } from './chains.ts';
import { AC, keptFaults, points, transcode, useBase } from './helpers.ts';

const bin = useGpu();
const base = useBase();
const dir = useDir();
const alphas = (levels: readonly Level[]): Buffer => Buffer.from(levels.slice(1).flatMap((l) => [...l.px].filter((_, i) => i % 4 === 3)));
const listed = (levels: readonly Level[]): string => levels.map((l, i) => `${named(i, l)} ${points(keptShare(l, 0.5))}`).join(', ');

describe(`${AC[1]} the fence keeps its coverage level by level`, () => {
  it(`${AC[1]} each level down to 16 × 16 keeps within a point of 23.4%, where the merge base keeps 43.75% of level 1 and nothing from level 2`, () => {
    const map = fence();
    const [before] = transcode(base(), dir(), [{ name: 'before', map, cutoff: 0.5 }]);
    console.log(`${AC[1]}: the merge base's chain keeps ${listed(before!.levels)}`);
    expect(keptShare(before!.levels[1]!, 0.5), 'the merge base keeps 43.75% of level 1').toBe(0.4375);
    expect(before!.levels.slice(2).filter((l) => keptShare(l, 0.5) > 0).length, 'the merge base keeps nothing from level 2').toBe(0);
    expect(Buffer.compare(alphas(before!.levels), alphas(boxChain(map))), 'the merge base stores the box rule\'s alphas').toBe(0);

    const [after] = transcode(bin(), dir(), [{ name: 'after', map, cutoff: 0.5 }]);
    console.log(`${AC[1]}: this chain keeps ${listed(after!.levels)}`);
    none([
      ...shareFaults(after!.levels, 0.5, FENCE_SHARE),
      ...storedFaults(after!.levels, 0.5),
      ...keptFaults(after!.reply['kept'], after!.levels, 0.5, 'the transcode\'s reply'),
    ], 'the fence\'s chain at alpha_cutoff 0.5');
  }, TIMEOUT);
});
