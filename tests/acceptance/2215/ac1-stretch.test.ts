// AC1 #2215.021cca23: With `anisotropy: {strength: 0.5}` the final’s glow is at least twice as wide along u as along v,
// at 512² and 4,096 samples, and with `strength: 0` the two spreads agree within 5%. A planted tracer that refracts
// through the round distribution reads a ratio within 5% of 1 at strength 0.5 and fails, naming the part and both spreads.
//
// The fixture (helpers: `fixture`; README: The fixture) at strength 0.5 and at strength 0, each drawn as a path-traced
// final at 512 × 512 and 4,096 samples in one `deep-gpu run` (README: Assumed surfaces 1); the reading (helpers:
// `glowOf`) is the glow’s luminance in the linear target, its spread along u (the frame’s x) and along v (its y), each
// the square root of the second moment about the centroid, in pixels. Strength 0.5: along u ≥ 2 × along v. Strength 0:
// the two within 5%. `--planted final_refracts_round`: its ratio at strength 0.5 within 5% of 1, and a failure naming
// `pane` and both its spreads. Without a final (the base has none: #178), BLOCKED naming #178, never a pass.
// Wrong programs: the base (raster only); a refraction through the round lobe; a stretch at strength 0; a stretch across u.
import { describe, expect, it } from 'vitest';
import { AC, f2, failsNaming, none, requireMetal, stretchOnFinal, useDir, useGpu } from './helpers.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();

describe(`${ID} a final’s refraction stretches with anisotropy`, () => {
  it(`${ID} with strength 0.5 the final’s glow is at least twice as wide along u as along v at 512² and 4,096 samples, and within 5% at strength 0; a planted tracer that refracts through the round distribution reads a ratio within 5% of 1 and fails, naming the part and both spreads`, () => {
    requireMetal();
    none(stretchOnFinal(bin(), dir()).failures, 'the final at strength 0.5 and 0');
    const p = stretchOnFinal(bin(), dir(), 'final_refracts_round');
    const ratio = p.half.su / p.half.sv;
    expect(Math.abs(ratio - 1), `--planted final_refracts_round reads a ratio within 5% of 1 at strength 0.5 (${f2(ratio)})`).toBeLessThanOrEqual(0.05);
    failsNaming(p.failures, ['pane', f2(p.half.su), f2(p.half.sv)], '--planted final_refracts_round');
  }, 7_200_000);
});
