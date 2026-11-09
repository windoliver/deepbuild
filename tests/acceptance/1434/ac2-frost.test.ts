// Criterion 2 (README: Criteria to tests): a frost effect over a gradient and text, within one code value of the CPU
// reference in the interior. The backdrop is what's drawn under the frost node before its slot, which is the same window
// drawn with the slot omitted (`--omit-effect frost`), since nothing paints after it. The reference is frost@1's
// definition (README: The operator) run on that backdrop here, in f64. The interior is every pixel at least the kernel's
// reach plus one from the node's edge, where clamping at the backdrop's bounds can't reach.
import { describe, expect, it } from 'vitest';
import { at, fixture, frostReference, pixelsOf, replica, useBuild, within, type Rect, type Rgba } from './helpers.ts';

const bin = useBuild('replica');
const FROST = fixture('frost.json');
const NODE: Rect = [80, 40, 440, 160];
const SIGMA = 4;
const TINT: Rgba = [26, 26, 26, 26];
const REACH = Math.ceil(3 * SIGMA) + 1;
const INTERIOR: Rect = [NODE[0] + REACH, NODE[1] + REACH, NODE[2] - 2 * REACH, NODE[3] - 2 * REACH];

describe('#1434 AC2 a frost effect over a gradient and text is within one code value of the CPU reference in the interior', () => {
  it('AC2 frost@1 (σ 4, a 10% white tint) over the gradient and two lines of text matches its reference on the window\'s backdrop at every interior pixel', () => {
    const backdrop = replica(bin(), FROST, { omit: ['frost'] }).png;
    const frosted = replica(bin(), FROST).png;
    const want = frostReference(backdrop, NODE, SIGMA, TINT);
    // The fixture is a test only if frosting changes it: the text's edges blur by far more than one code value.
    let moved = 0;
    for (const [x, y] of pixelsOf(INTERIOR)) moved = Math.max(moved, ...want(x, y).map((v, c) => Math.abs(v - at(backdrop, x, y)[c]!)));
    expect(moved, 'the reference differs from the unfrosted backdrop somewhere in the interior by at least 16').toBeGreaterThanOrEqual(16);
    expect(within(frosted, pixelsOf(INTERIOR), want, 1), 'the frosted interior against the CPU reference').toEqual([]);
  }, 600_000);
});
