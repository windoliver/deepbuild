// AC2 #3257.0856a85c: "At each of those levels, each quadrant keeps within two texels of its share. A planted chain that
// keeps the right count and fills it from the first row fails, naming the level and the quadrant"
//
// Those levels are AC1's, the fence's chain at `alpha_cutoff: 0.5` from level 0 down to 16 × 16; a quadrant's share is
// level 0's kept or not, box-filtered down to the level and summed over the quadrant (960, 240, 60 and 15 texels at
// levels 1 to 4). The planted chain is built here (./chains.ts `firstRowChain`): it passes AC1's share check at every
// level and fails this one at levels 1 to 4, its first fault naming level 1's top-left quadrant; the control chain
// passes both, so the checker refuses the fill and not the count. Then the product's chain is held to the checker.
// Wrong programs: the base; a chain filled from the first row; a walk that loses its remainder at a row's end or
// gathers its kept texels to one side.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, failsNaming, none, useDir, useGpu } from '../1634/helpers.ts';
import { FENCE_SHARE, controlChain, fence, firstRowChain, quadrantFaults, shareFaults } from './chains.ts';
import { AC, transcode } from './helpers.ts';

const bin = useGpu();
const dir = useDir();

describe(`${AC[2]} each quadrant of the fence keeps its share`, () => {
  it(`${AC[2]} each quadrant keeps within two texels of its share at each level; a planted chain filled from the first row fails, naming the level and the quadrant`, () => {
    const map = fence();
    const planted = firstRowChain(map);
    none(shareFaults(planted, 0.5, FENCE_SHARE), 'the planted chain keeps the right count at every level');
    const faults = quadrantFaults(planted, 0.5);
    failsNaming(faults, ['level 1 (128 × 128): its top-left quadrant', 'level 2 (64 × 64)', 'level 3 (32 × 32)', 'level 4 (16 × 16)'], 'the planted chain filled from the first row');
    expect(faults[0], 'its first fault names the level and the quadrant').toMatch(/^level 1 \(128 × 128\): its top-left quadrant/);
    none([...shareFaults(controlChain(map), 0.5, FENCE_SHARE), ...quadrantFaults(controlChain(map), 0.5)], 'the control chain');

    const [made] = transcode(bin(), dir(), [{ name: 'fence', map, cutoff: 0.5 }]);
    none(quadrantFaults(made!.levels, 0.5), 'the fence\'s quadrants at alpha_cutoff 0.5');
  }, TIMEOUT);
});
