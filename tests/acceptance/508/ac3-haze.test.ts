// AC3: "A plume with `haze {strength: 4 px, scale: 0.5 m}` in front of a checkerboard moves no board pixel more than
// 4 px, leaves every pixel outside the plume's screen footprint equal to the frame drawn without haze, and draws the
// same frame by seeking as by playing; the object-ID target and every check's readback equal those of the frame
// without haze, and a planted haze that writes into a check's readback fails, naming the effect"
//
// One `deep-gpu run` (helpers.ts: hazeDoc, hazeCalls): the plume with haze played over frames 0 to 90 at 30 fps; the
// same plume without haze; the board with no plume; and cold seeks (`from`) to frames 45 and 90. At frames 0, 45 and
// 90: every pixel outside the plume's footprint (the frame's `footprints.plume.box`) equals the frame without haze to
// the code value; every pixel inside it that shows a tile's color has that color within 5 px (4 px and the filter's
// reach) in the board drawn alone; the haze bends something there; the object-ID target and every check readback
// (`targets: ["checks"]`) are the ones without haze. Each seek's pixel hash equals the played frame's, and 45 differs
// from 90. Wrong programs: the base (no plume kind, no footprints, no check readbacks); a haze that moves pixels
// farther, spills past its footprint, reads the clock or bends nothing; and `--planted haze_feeds_check_readback`,
// whose failure must name the effect `plume`.
import { describe, it } from 'vitest';
import { TIMEOUT, ac, failsNaming, hazeCalls, hazeFailures, none, requireGpu, runGpu, useBins, useDir } from './helpers.ts';

const bin = useBins();
const dir = useDir();

describe(`${ac(3)} a plume's haze bends only its own footprint, never a check`, () => {
  it(`${ac(3)} the haze of 4 px at 0.5 m moves no board pixel more than 4 px, leaves everything outside the plume's footprint as drawn without haze, seeks as it plays, and leaves the object-ID target and every check readback as they are without haze`, () => {
    requireGpu();
    const out = dir();
    none(hazeFailures(out, runGpu(bin('deep-gpu'), out, hazeCalls(out))), 'the plume with haze in front of the checkerboard');
  }, TIMEOUT);

  it(`${ac(3)} a planted haze that writes into a check's readback (--planted haze_feeds_check_readback) fails, naming the effect`, () => {
    requireGpu();
    const out = dir();
    const failures = hazeFailures(out, runGpu(bin('deep-gpu'), out, hazeCalls(out), 'haze_feeds_check_readback'));
    failsNaming(failures.filter((f) => f.includes('check readback')), ['effect plume'], 'haze_feeds_check_readback: a check readback that differs');
  }, TIMEOUT);
});
