// #2691.49387bf5: At internal scale 1, every fixture of `tests/acceptance/465/` and `tests/acceptance/166/` hashes the
// same as on the merge base. A planted mirror that halves its size twice fails, naming the size.
//
// The fixtures are the documents those two suites' helpers export as theirs (#465's `mirrors` and `flareShowcase`,
// #166's `harbour`), built here by those helpers, in every variant, look, size and frame the suites' own tests draw
// them at (helpers.ts: `scaleOneFixtures`; README: Ambiguities). One release `deep-gpu run` on this Mac's Metal GPU
// draws them all with no `surface`, so at internal scale 1, each frame opened by a seek at 30 fps, and each frame's
// `pixel_hash` (those suites' own measure) is held to the merge base's: fixtures/base/scale-one.json, the same
// readings as this suite's run on the unchanged base kept them. On another machine the test is INCONCLUSIVE.
//
// The planted run draws the same frames with `--planted mirror_halves_twice` (the mirror's pass at half of half the
// internal size, everything else as shipped; README: Planted programs) and holds them to the same check, which must
// fail naming the size the mirror drew at: 160 × 90 for #465's two mirrors at 640 × 360.
// Each run keeps its readings as target/acceptance/2691/scale-one.json (the planted one's as scale-one-planted.json).
import { describe, expect, it } from 'vitest';
import {
  AC, drawScaleOne, keep, mergeBase, requireMetal, scaleOneFailures, scaleOneFixtures, useOut, useRelease, type Drawn, type JsonObject, type Planted,
} from './helpers.ts';

const bin = useRelease();
const out = useOut();

/** Draws every fixture, keeps the readings, and answers the check against the merge base's. */
function drawn(name: string, planted?: Planted): { frames: Drawn[]; failures: string[] } {
  const frames = drawScaleOne(bin(), out(), planted);
  const hashes: JsonObject = {}; const mirrors: JsonObject = {};
  for (const d of frames) { hashes[`${d.name}@${d.frame}`] = d.pixel_hash; mirrors[`${d.name}@${d.frame}`] = d.mirror_px; }
  console.log(`${AC[2]}: ${frames.length} frames of ${scaleOneFixtures().length} fixtures at internal scale 1${planted ? ` under --planted ${planted}` : ''}; kept as ${keep(name, { hashes, mirror_px: mirrors })}`);
  return { frames, failures: scaleOneFailures(frames, mergeBase('scale-one')) };
}

describe(`${AC[2]} at internal scale 1 nothing changes`, () => {
  it(`${AC[2]} every fixture of tests/acceptance/465/ and tests/acceptance/166/ has, at internal scale 1, the merge base's pixel hash at every frame those suites draw`, () => {
    requireMetal();
    const { frames, failures } = drawn('scale-one');
    expect(frames.length, 'every frame of every fixture was drawn').toBe(scaleOneFixtures().reduce((n, f) => n + f.frames.length, 0));
    expect(failures, 'each frame hashes the same as on the merge base').toEqual([]);
  }, 1_800_000);

  it(`${AC[2]} a planted mirror that halves its size twice fails the same check, which names the size its pass drew at`, () => {
    requireMetal();
    const { failures } = drawn('scale-one-planted', 'mirror_halves_twice');
    expect(failures.length, 'the planted mirror fails the check').toBeGreaterThan(0);
    const room = failures.filter((f) => f.startsWith('465/mirrors-both frame 17:'));
    expect(room, 'the check fails #465\'s two mirrors at 640 × 360, naming the size the planted pass drew at: half of half, 160 × 90').toEqual([expect.stringContaining('its mirror\'s pass drew at 160 × 90')]);
    // The plant is the mirror's alone: a fixture no mirror draws in keeps the merge base's hash.
    expect(failures.filter((f) => f.startsWith('465/taste-flare ')), 'the flare showcase, which has no mirror, still hashes the same').toEqual([]);
  }, 1_800_000);
});
