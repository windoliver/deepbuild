// AC2 #269.5fc34243: Where three roles meet at a corner of four cells, two of them one role, every pixel draws one of
// the three roles and none draws `none`; a planted rule that draws a role only where its share passes 1/2 leaves a hole
// at the corner and fails, naming the pixel
//
// The corner fixture (fixtures.ts `cornerDoc`, programs.ts `frontProgram`): an 8 × 8 grid drawn smooth at 32 px a cell,
// role 0 in the top four rows, role 1 below on the left and role 2 below on the right, so cells (3, 3) and (4, 3) hold
// role 0, (3, 4) role 1 and (4, 4) role 2 around the corner at (136, 136). `deep-show run`'s `eval` draws it at step 2.
// Every pixel of the 4 × 4 cells around the corner (whose rebuilt shares read no cell but the three roles') is judged
// (judges.ts `cornerFailures`): it must be a blend of the three roles' colors, in sRGB or in linear light, with at most
// a quarter of the ground in it (a pixel that draws `none` shows the backdrop, the ground). The four cells' centres show
// their own roles, so a picture of one role alone fails too. Each failure names its pixel.
import { describe, expect, it } from 'vitest';
import { frontProgram } from './programs.ts';
import { FRONT_KEY_TOP, cornerDoc, keyCenter } from './fixtures.ts';
import { cornerFailures, nearCorner } from './judges.ts';
import {
  AC, DOC, TIMEOUT, at, binOf, evalCall, failsNaming, keyOf, none, pngOf, prebuild, presented, putEvidence, runShow, scenario, showCall,
  snapshotOf, useTemp, type Image, type Key, type ShowPlant,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = { corner: DOC(2) };
const STEP_AT = 2;

function drawn(planted?: ShowPlant): { im: Image; key: Key } {
  const ev = temp();
  const program = frontProgram();
  putEvidence(ev, program.bytes);
  const doc = cornerDoc(program);
  const sc = scenario(ev, [D.corner], [showCall(D.corner, doc), evalCall(D.corner, at(STEP_AT))]);
  const replies = runShow(binOf(), planted ? { ...sc, planted } : sc, 'AC2 the corner fixture');
  presented(replies[0]!, 'the corner fixture');
  const im = pngOf(ev, snapshotOf(replies[1]!, 'the corner fixture'), 'the corner fixture');
  expect([im.width, im.height], 'the frame is the document\'s size, 1 px a u').toEqual(doc['size']);
  return { im, key: keyOf(im, FRONT_KEY_TOP, keyCenter, 'the corner fixture') };
}

describe(`${AC[2]} three roles at a corner of four cells, two of them one role`, () => {
  it(`${AC[2]} every pixel round the corner draws one of the three roles and none draws none`, () => {
    const { im, key } = drawn();
    none(cornerFailures(im, key), 'the corner fixture at 32 px a cell');
  }, TIMEOUT);

  it(`${AC[2]} planted grid_share_passes_half leaves a hole at the corner and fails, naming the pixel`, () => {
    const { im, key } = drawn('grid_share_passes_half');
    const failures = cornerFailures(im, key);
    const holes = failures.map((f) => /pixel \((\d+), (\d+)\) draws none/.exec(f)).filter((m) => m !== null);
    expect(holes.some((m) => nearCorner(Number(m![1]), Number(m![2]))), `under the planted rule a pixel within a cell of the corner draws none: ${failures.slice(0, 6).join('; ')}`).toBe(true);
    failsNaming(failures, [/pixel \(\d+, \d+\)/, /draws none/], 'the corner under grid_share_passes_half');
  }, TIMEOUT);
});
