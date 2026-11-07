// AC1 #426.354a52a7: With a studio environment and a dark sky gradient, the product fixture's background pixels equal the
// gradient's within 1 code value while its reflections show the studio, and with an HDR environment and no background set,
// the background shows the HDR at its rotation.
//
// 1. The product fixture (helpers: productDoc): a chrome ball (metallic 1, roughness 0.15) on a stage with no light item,
//    320 × 240, tone map none at exposure scale 1, so the final target is the sRGB encoding of the linear one.
//    - A uniform "gradient" (top = low = [0.04, 0.05, 0.07]) under `environment: {from: studio}`: every background pixel
//      (the ID target empty, 3 px clear of the ball) reads that color's code within 1, whatever a gradient's shape is.
//    - A real gradient (top [0.01, 0.015, 0.03], low [0.05, 0.05, 0.06]) under the studio: every background pixel equals
//      the same document's pixel with no environment at all (the sky's own fields draw the background) within 1 code, and
//      the gradient isn't flat (the top row and the horizon row differ by at least 2 codes), so the equality says something.
//    - Reflections show the studio: at least half the ball's pixels (2 px inside its rim) differ by at least 8 codes from
//      the no-environment frame, where the chrome reflects only the dark gradient; and `background: environment` leaves
//      the ball's pixels within 1 code of the default frame's (the background field doesn't light) while the studio then
//      shows behind it: at least 90% of background pixels differ from the gradient's by at least 4 codes.
//    - Planted: `background: environment` is the wrong program for the gradient (the studio drawn where the gradient
//      belongs). Run through the same judge as the right one, it fails naming a pixel, for the uniform fixture and the real one.
// 2. HDR, no background set: the grid HDR (helpers: 36 × 9 flat 10° cells below the horizon) as `environment`, intensity 1, no
//    `background` field, a camera at the origin pitched 45° down so every pixel's ray meets a cell. At rotation 0, 90° and
//    37° (the environment turned about +Y, right-handed, README: Assumed surfaces 2) every pixel at least 0.8° of arc from a
//    cell edge reads the flat color of the cell that R_y(−rotation)·ray falls in, within 1 code, at least 5,000 pixels each.
//    The rotations differ: at least 80% of those pixels differ by at least 4 codes between rotation 0 and 90°, so an HDR
//    that ignores its rotation fails. Every failure names its pixel.
// Wrong programs: a studio or HDR drawn over the gradient; the gradient drawn over an HDR; a rotation not applied or turned
// the other way.
import { describe, expect, it } from 'vitest';
import {
  AC, GRID_MARGIN, DARK_GRADIENT, FLAT_DARK, FLAT_GRADIENT, PRODUCT_SIZE, ROT_CAM, ROT_SIZE, STUDIO, codeOff, codes, failsNamingPixels, frameAt, framesOf, gridCell, gridDistinctness,
  gridPixel, judgePixel, nearItem, none, only, productDoc, px, rayAt, readIds, readPng, requireMetal, rotateY, rotationDoc, runGpu, useDir, useGpu, view3dCall, within, writeHdr, writeJson,
  type Image, type Rgb,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();

function backgroundProblems(img: Image, ids: ReturnType<typeof readIds>, want: (x: number, y: number) => Rgb, what: string): { problems: string[]; judged: number } {
  const problems: string[] = []; let judged = 0;
  for (let y = 0; y < PRODUCT_SIZE[1]; y++) for (let x = 0; x < PRODUCT_SIZE[0]; x++) {
    if (ids.at(x, y) !== null || nearItem(ids, x, y, 3)) continue;
    judged++;
    const f = judgePixel(x, y, what, px(img, x, y), want(x, y));
    if (f) problems.push(f);
  }
  return { problems, judged };
}

describe(`${AC[1]} the sky's own fields draw the background under a studio environment; an HDR draws behind the scene at its rotation`, () => {
  it(`${AC[1]} under the studio the background equals the dark gradient within 1 code and the chrome reflects the studio; background: environment is the wrong program and fails naming a pixel`, () => {
    requireMetal();
    const out = dir();
    const call = (name: string, sky: Record<string, unknown>): ReturnType<typeof view3dCall> =>
      view3dCall({ doc: writeJson(out, name, productDoc(sky as never)), size: PRODUCT_SIZE, targets: ['final', 'ids'] });
    const replies = runGpu(bin(), out, [
      call('flat-studio', { ...FLAT_GRADIENT, ...STUDIO }),
      call('grad-studio', { ...DARK_GRADIENT, ...STUDIO }),
      call('grad-plain', { ...DARK_GRADIENT }),
      call('grad-studio-bg-env', { ...DARK_GRADIENT, ...STUDIO, background: 'environment' }),
      call('flat-studio-bg-env', { ...FLAT_GRADIENT, ...STUDIO, background: 'environment' }),
    ]);
    const get = (i: number, what: string): { img: Image; ids: ReturnType<typeof readIds> } => {
      const f = only(replies[i]!, what);
      return { img: readPng(out, f.final, what), ids: readIds(out, f, what) };
    };
    const flat = get(0, 'flat gradient under the studio'); const grad = get(1, 'gradient under the studio'); const plain = get(2, 'gradient, no environment');
    const bgEnv = get(3, 'gradient under the studio, background: environment'); const flatBgEnv = get(4, 'flat gradient, background: environment');

    // The uniform gradient: one known color.
    const flatWant = codes(FLAT_DARK);
    const a = backgroundProblems(flat.img, flat.ids, () => flatWant, 'the uniform gradient under the studio');
    expect(a.judged, 'the fixture has at least 20,000 background pixels').toBeGreaterThanOrEqual(20_000);
    none(a.problems, `background pixels of the uniform gradient (want ${flatWant.join(', ')})`);

    // The real gradient: the sky's own fields, as the same document draws them with no environment.
    const b = backgroundProblems(grad.img, grad.ids, (x, y) => px(plain.img, x, y), 'the gradient under the studio');
    none(b.problems, 'background pixels of the gradient under the studio equal those with no environment');
    expect(codeOff(px(plain.img, 160, 0), px(plain.img, 160, 128)), 'the gradient is not flat: the top row and the horizon row differ by at least 2 codes').toBeGreaterThanOrEqual(2);

    // The studio shows in the chrome.
    let ball = 0; let differ = 0; let moved = 0;
    for (let y = 0; y < PRODUCT_SIZE[1]; y++) for (let x = 0; x < PRODUCT_SIZE[0]; x++) {
      if (!within(grad.ids, x, y, 'product', 2)) continue;
      ball++;
      if (codeOff(px(grad.img, x, y), px(plain.img, x, y)) >= 8) differ++;
      if (codeOff(px(grad.img, x, y), px(bgEnv.img, x, y)) > 1) moved++;
    }
    expect(ball, 'the ball covers at least 5,000 pixels 2 px inside its rim').toBeGreaterThanOrEqual(5000);
    expect(differ / ball, `${differ} of ${ball} ball pixels differ by at least 8 codes from the no-environment frame: the chrome reflects the studio`).toBeGreaterThanOrEqual(0.5);
    expect(moved, 'background: environment changes no ball pixel by more than 1 code (it draws, it does not light)').toBe(0);
    let bg = 0; let shown = 0;
    for (let y = 0; y < PRODUCT_SIZE[1]; y++) for (let x = 0; x < PRODUCT_SIZE[0]; x++) {
      if (grad.ids.at(x, y) !== null || nearItem(grad.ids, x, y, 3)) continue;
      bg++;
      if (codeOff(px(bgEnv.img, x, y), px(plain.img, x, y)) >= 4) shown++;
    }
    expect(shown / bg, 'with background: environment the studio shows: at least 90% of background pixels differ from the gradient by 4 codes').toBeGreaterThanOrEqual(0.9);

    // The planted wrong program, through the same judge.
    failsNamingPixels(backgroundProblems(flatBgEnv.img, flatBgEnv.ids, () => flatWant, 'background: environment').problems, 'the studio drawn as the background, judged against the uniform gradient');
    failsNamingPixels(backgroundProblems(bgEnv.img, bgEnv.ids, (x, y) => px(plain.img, x, y), 'background: environment').problems, 'the studio drawn as the background, judged against the gradient');
  }, 1_800_000);

  it(`${AC[1]} an HDR environment with no background set draws behind the scene at rotation 0, 90 and 37 degrees, each pixel the flat color of its cell within 1 code`, () => {
    requireMetal();
    none(gridDistinctness(), 'the grid HDR\'s cells are at least 4 codes apart');
    const out = dir();
    const hdr = writeHdr(out, [720, 360], gridPixel);
    const rots = [0, 90, 37];
    const docs = rots.map((r) => rotationDoc(hdr.sha, r));
    for (const d of docs) expect(Object.keys(((d['items'] as Record<string, Record<string, Record<string, unknown>>>)['sky'])!['params']!), 'no background is set').not.toContain('background');
    const replies = runGpu(bin(), out, docs.map((d, i) => view3dCall({ doc: writeJson(out, `rot-${i}`, d), size: ROT_SIZE, targets: ['final'], assets: { [hdr.sha]: hdr.path } })));
    const frames = replies.map((r, i) => readPng(out, frameAt(framesOf(r, `rotation ${rots[i]}`), 0, `rotation ${rots[i]}`).final, `rotation ${rots[i]}`));
    let differing = 0; let both = 0;
    rots.forEach((rot, i) => {
      const problems: string[] = []; let judged = 0;
      for (let y = 0; y < ROT_SIZE[1]; y++) for (let x = 0; x < ROT_SIZE[0]; x++) {
        const d = rayAt(ROT_CAM, x + 0.5, y + 0.5);
        const cell = gridCell(rotateY(d, -rot));
        if (cell.margin < GRID_MARGIN) continue;
        judged++;
        const f = judgePixel(x, y, `rotation ${rot}° shows cell ${cell.index}`, px(frames[i]!, x, y), codes(cell.color));
        if (f) problems.push(f);
        if (i === 0) { both++; if (codeOff(px(frames[0]!, x, y), px(frames[1]!, x, y)) >= 4) differing++; }
      }
      expect(judged, `rotation ${rot}: at least 5,000 pixels are judged`).toBeGreaterThanOrEqual(5000);
      none(problems, `the background at rotation ${rot}° shows the HDR at that rotation`);
    });
    expect(differing / both, 'rotation 90° changes at least 80% of the pixels by 4 codes or more').toBeGreaterThanOrEqual(0.8);
  }, 1_800_000);
});
