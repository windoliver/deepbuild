// AC2 #971.5cd62ea3: A fixture of two walls meeting at a sharp vertical edge, one at 4 stops above middle grey and one
// at 4 stops below, each with a ±0.25-stop checker of 8 px cells, rendered with no tone curve and
// `local: {strength: 0.5}`, puts the walls' mean log2 luminance at +2 and −2 stops within 0.1 stop, measured at least
// 64 px from the edge, and keeps each checker's amplitude at ±0.25 stop within 0.02.
//
// The two walls (helpers.ts `wallsDoc`, 1920 × 1080, the edge at x = 960) are drawn under tone map none, in one process:
// with no `local`, reading #418's `pre_tone` (the fixture as drawn: each wall at its level, each checker at ±0.25 stop);
// with `local: {strength: 0.5}`, reading its pixel hash; and with it again, reading `pre_curve`, the linear image the
// tone curve reads (README: The surface under test). Luminance is Rec. 709's; a level is log2 of it against middle grey,
// linear 0.18 (README: Readings). The mean is over every pixel of a wall whose centre is 64 px or more from the edge; a
// checker's amplitude is half the difference of the means of its higher and its lower cells there. At the base the
// look's `local` is read by nothing: the frame is the one drawn without it, and there is no `pre_curve` target.
import { describe, expect, it } from 'vitest';
import { writeJson } from '../418/helpers.ts';
import {
  AC, FULL, HALF, TIMEOUT, WALLS, drawn, frame, lookWith, none, readLinear, requireGpu, runGpu, useGpu, useOut, view3d, wallLevels, wallsAsGiven,
  wallsDoc, wallsHalved,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();

describe(`${AC[2]} the two walls under local {strength: 0.5}`, () => {
  it(`${AC[2]} with no tone curve and local {strength: 0.5}, the walls' mean log2 luminance 64 px or more from the edge is +2 and −2 stops within 0.1, and each checker's amplitude ±0.25 stop within 0.02`, () => {
    requireGpu();
    const doc = writeJson(out(), 'walls.json', wallsDoc('walls-levels'));
    const [plainReply, hashReply, localReply] = runGpu(bin(), out(), [
      view3d({ doc, look: lookWith('none'), size: FULL, targets: ['pre_tone'], capture: [0] }),
      view3d({ doc, look: lookWith('none', HALF), size: FULL }),
      view3d({ doc, look: lookWith('none', HALF), size: FULL, targets: ['pre_curve'], capture: [0] }),
    ]);
    const plain = frame(drawn(plainReply!, 'the walls without local'), 0, 'the walls without local');
    none(wallsAsGiven(readLinear(out(), plain, 'pre_tone', FULL, 'the walls without local')), 'the fixture is the criterion\'s: walls 4 stops above and below middle grey, each with a ±0.25-stop checker');
    const changed = frame(drawn(hashReply!, 'the walls with local {strength: 0.5}'), 0, 'the walls with local {strength: 0.5}');
    expect(changed.pixel_hash, 'local {strength: 0.5} moves the walls, so its frame is not the one drawn without local').not.toBe(plain.pixel_hash);

    const local = frame(drawn(localReply!, 'the walls with local {strength: 0.5}, pre_curve'), 0, 'the walls with local {strength: 0.5}');
    const got = wallLevels(readLinear(out(), local, 'pre_curve', FULL, 'the walls with local {strength: 0.5}'));
    const failures = wallsHalved(got);
    for (const wall of ['bright', 'dark'] as const) {
      const amplitude = (got[wall].high - got[wall].low) / 2;
      if (!(Math.abs(amplitude - WALLS.checker) <= 0.02)) failures.push(`the ${wall} wall's checker has an amplitude of ±${amplitude.toFixed(4)} stop, not ±${WALLS.checker} within 0.02`);
    }
    console.log(`${AC[2]}: bright wall ${got.bright.mean.toFixed(4)} stops, checker ±${((got.bright.high - got.bright.low) / 2).toFixed(4)}; dark wall ${got.dark.mean.toFixed(4)} stops, checker ±${((got.dark.high - got.dark.low) / 2).toFixed(4)}`);
    none(failures, 'the walls under local {strength: 0.5}');
  }, TIMEOUT);
});
