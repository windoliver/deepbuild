// AC1 #432.e6a02864: A depth-equal pass between geometry and its prepass leaves no missing pixel on a fixture, and the
// first frame of every fixture document compiles no pipeline.
//
// The depth-equal fixture (helpers: `ballDoc`, `BALL`): a ball of radius 5 m and 256 segments fills a 512 × 512
// orthographic view (100 px/m; the frame's corner is 3.62 m from its centre), unlit grey 0.8 at adjust opacity 0.5 over a
// black sky. A part at an opacity under 1 is a fade (#424): a depth pass of its own triangles, then its color where the
// depth is equal, so a vertex stage that places a vertex differently in the two passes leaves pixels where the equal test
// fails and the sky shows. Drawn twice on Metal: with the grey as the material's color, and with the grey from a material
// operator (`grey`). Every pixel of the linear target must read 0.4 (0.5 × 0.8 over 0) within 0.004 (about one 8-bit
// code) on each channel; a missing pixel reads near 0, a missing sample under MSAA 0.3 or less. The check's twin: the same
// image with one pixel at the sky's value fails, naming that pixel.
//
// "Every fixture document" is every document this suite plays (helpers: `everyFixture`): both balls, AC2's chain fused and
// unfused, AC4's product figure in both channel forms and its accepted cap figure, AC5's finish figure with two and with
// three variant sets, and AC6's shadow scene. Each is opened in `live` for two frames on the noop lane and, on macOS, on
// Metal; the first frame its view draws must list no created pipeline (`created`, README: The surface under test).
// Wrong programs: a vertex stage without @invariant in one of the two passes (pixels missing); a warm-up that leaves a
// pipeline to the first frame (named, with its items, feature set and target).
// Its first-frame test is redraft/depth-equal.test.ts's (dispute D1: the fixtures' controls carried no role).
import { describe, expect, it } from 'vitest';
import {
  AC, BALL, ballDoc, readF32Image, requireGpu, run, useBin, useOut, view3dCall, view3dFrame, writeJson, type F32Image,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const expected = BALL.level * BALL.opacity;

/** Every pixel off 0.4 by more than 0.004 on a channel, named; those near the sky's 0 are called missing. */
function pixelProblems(img: F32Image, what: string): string[] {
  const problems: string[] = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const p = img.at(x, y);
      if ([0, 1, 2].some((c) => !(Math.abs(p[c]! - expected) <= 0.004))) {
        const missing = Math.max(p[0], p[1], p[2]) < expected / 2;
        problems.push(`${what}: pixel (${x}, ${y}) reads (${p.slice(0, 3).map((v) => v.toFixed(4)).join(', ')})${missing ? ', missing' : ''}, not ${expected} within 0.004`);
      }
    }
  }
  return problems;
}

describe(`${AC[1]} a depth-equal pass leaves no missing pixel, and no fixture's first frame compiles a pipeline`, () => {
  it(`${AC[1]} a fade of a ball that fills the frame, its color plain and from a material operator, reads 0.4 at every pixel of the linear target; one pixel at the sky's value fails, named`, () => {
    requireGpu();
    const dir = out();
    for (const operator of [false, true]) {
      const what = operator ? 'the ball whose color is a material operator\'s' : 'the plain ball';
      const [reply] = run(bin(), dir, [view3dCall({ doc: writeJson(dir, `ball-${operator}.json`, ballDoc(`ball-${operator}-432`, operator)), size: BALL.size, targets: ['linear'] })], { lane: 'gpu' });
      const img = readF32Image(dir, view3dFrame(reply!, 0, what)['linear'], BALL.size, `${what}: linear`);
      const problems = pixelProblems(img, what);
      console.log(`${AC[1]}: ${what}: ${problems.length} pixels off${problems.length ? `, first: ${problems[0]}` : ''}`);
      expect(problems.slice(0, 20), `${what}: every pixel shows the fade`).toEqual([]);
      const doctored: F32Image = { ...img, at: (x, y) => (x === 200 && y === 300 ? [0, 0, 0, 1] : img.at(x, y)) };
      const caught = pixelProblems(doctored, `${what} (doctored)`);
      expect(caught.length === 1 && caught[0]!.includes('pixel (200, 300)') && caught[0]!.includes('missing'), `the check names a missing pixel: ${caught.slice(0, 3).join('; ')}`).toBe(true);
    }
  }, 1_800_000);
});
