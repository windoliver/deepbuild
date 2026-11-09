// Criterion 8 (README: Criteria to tests): "Two renders at one time on the same machine are byte-equal."
// The grid of all 24 operators, embers and glass included, drawn by two replica processes at the same time of the effect
// clock, 2.5 s, without reduced motion: every pixel byte of the two frames is equal, in light and in dark.
import { describe, expect, it } from 'vitest';
import { AC, APPEARANCES, grid, replica, useBuild } from './helpers.ts';

const bin = useBuild('replica');

describe(`#1436 AC8 ${AC[8]} two renders at one time on the same machine are byte-equal`, () => {
  it.each(APPEARANCES.map((a) => [a]))('AC8 in %s, two renders of all 24 operators at 2.5 s are byte-equal', (appearance) => {
    const [a, b] = [0, 1].map(() => replica(bin(), grid(), { appearance, at: [2.5] }).pngs[0]!);
    const x = Buffer.from(a!.rgba); const y = Buffer.from(b!.rgba);
    let first = -1;
    for (let i = 0; i < x.length && first < 0; i++) if (x[i] !== y[i]) first = i;
    const px = first < 0 ? '' : `pixel (${(first >> 2) % a!.width}, ${Math.floor((first >> 2) / a!.width)})`;
    expect(first, `the two renders' first differing byte${px ? `, at ${px}` : ''}`).toBe(-1);
  }, 3_600_000);
});
